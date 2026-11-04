const crypto = require('node:crypto');
const express = require('express');
const mongoose = require('mongoose');
const OpenAIService = require('./openaiService');

// Secreto del HMAC: solo desde el entorno (.env). Sin él no arrancamos: nunca un secreto por defecto.
const TOKEN_SECRET = process.env.TOKEN_SECRET;
if (!TOKEN_SECRET) throw new Error('Falta TOKEN_SECRET en .env (ver .env.example)');

const TYPES = ['NAME', 'EMAIL', 'PHONE'];

// Tope de datos privados distintos por mensaje: evita que una sola petición dispare miles de upserts.
const MAX_PII_PER_MESSAGE = 200;

// Una sola regex con alternación (email | teléfono | nombre) y un único replace:
// así un token ya insertado nunca se re-detecta y las mayúsculas de un email no cuentan como nombre.
// ponytail: nombre = palabras capitalizadas seguidas que no abren mensaje ni frase. Un nombre que abra
// frase ("Ana vino") no se detecta; para eso haría falta NER (fuera de alcance del taller).
const PII_REGEX = new RegExp(
  [
    // email: letras Unicode (josé@…); ancla de inicio + {1,64} evitan backtracking cuadrático (ReDoS)
    String.raw`(?<EMAIL>(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]{1,64}@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+)`,
    // teléfono: 7-15 dígitos, con espacios/guiones opcionales
    String.raw`(?<PHONE>\+?\d(?:[\s-]?\d){6,14})`,
    // nombre completo: palabras con mayúscula inicial separadas por espacios. Al inicio del mensaje o
    // tras ! ? ¿ ¡ una sola palabra capitalizada es normal ("Redacta…"), así que ahí se exigen 2+ ("Carlos Mendoza…").
    // El "." no cuenta como fin de frase: en "Sr. Pérez" dejaría el nombre visible.
    String.raw`(?<NAME>(?<!\p{L})(?:(?<!^\s*)(?<![!?¿¡]\s*)\p{Lu}\p{L}*(?:[ \t]+\p{Lu}\p{L}*)*|\p{Lu}\p{L}*(?:[ \t]+\p{Lu}\p{L}*)+))`,
  ].join('|'),
  'gu'
);

// Sin \b: el token tiene largo fijo y puede quedar pegado a letras/dígitos ("Ana2" -> "NAME_…2").
const TOKEN_REGEX = /(?:NAME|EMAIL|PHONE)_[0-9a-f]{12}/g;

// Pareja [información privada, token] con su tipo y fecha de creación. Índice único por token.
const Token = mongoose.model(
  'Token',
  new mongoose.Schema(
    {
      token: { type: String, required: true, unique: true },
      value: { type: String, required: true },
      type: { type: String, required: true, enum: TYPES },
    },
    { timestamps: { createdAt: true, updatedAt: false } }
  )
);

/**
 * Conecta a MongoDB y espera a que existan los índices (incluido el único por token).
 * Falla rápido (5 s) en vez de los 30 s por defecto, para que el error de arranque se vea enseguida.
 */
async function connectDB(uri, options = {}) {
  if (!uri) throw new Error('Falta MONGODB_URI en .env (ver .env.example)');
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000, ...options });
  await Token.init();
}

/** Token determinista de un valor: TIPO_ + 12 hex de HMAC-SHA256. Sin el secreto no se puede revertir. */
function tokenFor(type, value) {
  return `${type}_${crypto.createHmac('sha256', TOKEN_SECRET).update(value).digest('hex').slice(0, 12)}`;
}

/**
 * Guarda la pareja si no existe (upsert idempotente: el token es determinista).
 * Si el token ya existe con OTRO valor es una colisión: fallamos antes que devolver la PII de otra persona.
 */
async function saveToken(token, type, value) {
  const doc = await Token.findOneAndUpdate(
    { token },
    { $setOnInsert: { value, type } },
    { upsert: true, returnDocument: 'after', lean: true }
  );
  if (doc.value !== value) throw new Error(`Colisión de token ${token}`);
}

/** Reemplaza cada nombre, email y teléfono del mensaje por su token y persiste las parejas. */
async function anonymize(message) {
  return (await anonymizeWithTokens(message)).anonymized;
}

/** Igual que anonymize, pero devuelve también las parejas encontradas (token -> { type, value }). */
async function anonymizeWithTokens(message) {
  const found = new Map(); // token -> { type, value }, sin repetir
  const anonymized = message.replace(PII_REGEX, (match, ...args) => {
    const groups = args.at(-1);
    const type = TYPES.find((key) => groups[key] !== undefined);
    const token = tokenFor(type, match);
    found.set(token, { type, value: match });
    return token;
  });
  if (found.size > MAX_PII_PER_MESSAGE) {
    throw Object.assign(new Error('Demasiados datos privados'), {
      status: 413,
      publicMessage: `El mensaje supera el máximo de ${MAX_PII_PER_MESSAGE} datos privados distintos`,
    });
  }
  await Promise.all([...found].map(([token, { type, value }]) => saveToken(token, type, value)));
  return { anonymized, found };
}

/**
 * Reemplaza cada token por su valor original con una sola consulta.
 * Devuelve también los tokens que no existen, para que el endpoint responda con un error claro.
 */
async function deanonymize(anonymizedMessage) {
  const tokens = [...new Set(anonymizedMessage.match(TOKEN_REGEX) ?? [])];
  const docs = tokens.length ? await Token.find({ token: { $in: tokens } }, { token: 1, value: 1 }).lean() : [];
  const values = new Map(docs.map((doc) => [doc.token, doc.value]));
  return {
    message: anonymizedMessage.replace(TOKEN_REGEX, (token) => values.get(token) ?? token),
    unknown: tokens.filter((token) => !values.has(token)),
  };
}

// Le pide al modelo tratar los tokens como los datos reales y copiarlos intactos, para poder desanonimizar.
const SECURE_CHAT_SYSTEM_PROMPT = [
  'Algunos datos personales del mensaje fueron reemplazados por tokens con el formato',
  'NAME_xxxxxxxxxxxx, EMAIL_xxxxxxxxxxxx o PHONE_xxxxxxxxxxxx (x = 12 caracteres hexadecimales).',
  'Trata cada token como el dato real que representa (un nombre, un email o un teléfono).',
  'Cuando lo menciones, copia el token exactamente como aparece: no lo modifiques, no lo traduzcas,',
  'no lo separes, no cambies mayúsculas ni minúsculas, no le agregues espacios ni signos y no inventes tokens nuevos.',
].join(' ');

/**
 * Chat seguro: anonimiza el prompt (y lo guarda en el vault), lo envía a OpenAI y desanonimiza la respuesta.
 * A OpenAI no van los tokens del vault sino alias aleatorios de esta petición (mismo formato):
 *  - OpenAI no puede enlazar a la misma persona entre peticiones (los tokens del vault son deterministas);
 *  - la respuesta solo se desanonimiza con los alias de ESTA petición: un token de otra persona queda tal cual.
 * Si el modelo altera un alias (minúsculas, hex en mayúsculas, espacio tras "_", prefijo traducido) se
 * resuelve igual por su hex: es aleatorio y solo existe en esta petición. Uno inventado queda tal cual.
 * Límite conocido: la PII que la regex no detecta (p. ej. nombres en minúscula) sí sale; para eso haría falta NER.
 */
async function secureChat(prompt, openai) {
  const { anonymized, found } = await anonymizeWithTokens(prompt);
  const aliasOf = new Map(); // token del vault -> alias de esta petición
  const valueOfHex = new Map(); // hex del alias -> valor original
  for (const [token, { type, value }] of found) {
    const hex = crypto.randomBytes(6).toString('hex');
    aliasOf.set(token, `${type}_${hex}`);
    valueOfHex.set(hex, value);
  }
  const anonymizedPrompt = anonymized.replace(TOKEN_REGEX, (token) => aliasOf.get(token) ?? token);
  const answer = await openai.complete(anonymizedPrompt, SECURE_CHAT_SYSTEM_PROMPT);
  // Tolerante a lo que suelen cambiar los modelos: cualquier prefijo, mayúsculas y un espacio tras "_".
  // Ancla (?<!\p{L}) + prefijo {1,20}: evita backtracking cuadrático con textos largos sin "_".
  const response = answer.replace(/(?<!\p{L})\p{L}{1,20}_ ?([0-9a-fA-F]{12})/gu, (match, hex) => valueOfHex.get(hex.toLowerCase()) ?? match);
  return { response, anonymizedPrompt };
}

const PORT = Number(process.env.PORT) || 3001;

/** Anti DNS rebinding: el servicio escucha en 127.0.0.1, así que solo acepta Host local en su puerto. */
function isAllowedHost(host, port) {
  return host === `localhost:${port}` || host === `127.0.0.1:${port}`;
}

/**
 * Rate limit de ventana fija: como máximo `max` peticiones cada `windowMs`; el resto recibe 429.
 * ponytail: contador global (el servicio solo escucha en localhost); por cliente si se expone.
 */
function rateLimit(max, windowMs) {
  let windowStart = 0;
  let count = 0;
  return (req, res, next) => {
    const now = Date.now();
    if (now - windowStart >= windowMs) {
      windowStart = now;
      count = 0;
    }
    if (++count > max) {
      return res.status(429).json({ error: `Demasiadas solicitudes: máximo ${max} cada ${windowMs / 1000} s` });
    }
    next();
  };
}

// OpenAIService se crea en la primera petición, no al arrancar: así /anonymize y /deanonymize
// siguen funcionando aunque falte la configuración de OpenAI.
let openaiService;
function getOpenAIService() {
  try {
    return (openaiService ??= new OpenAIService());
  } catch (err) {
    throw Object.assign(err, { status: 503, publicMessage: 'OpenAI no está configurado en el servidor (OPENAI_API_KEY / OPENAI_MODEL)' });
  }
}

const app = express();
app.use((req, res, next) =>
  isAllowedHost(req.headers.host, PORT) ? next() : res.status(403).json({ error: 'Host no permitido' })
);
app.use(express.json());

// POST /anonymize  { message } -> { anonymizedMessage }
app.post('/anonymize', async (req, res) => {
  const { message } = req.body ?? {};
  if (typeof message !== 'string') {
    return res.status(400).json({ error: 'El campo "message" debe ser un string' });
  }
  res.json({ anonymizedMessage: await anonymize(message) });
});

// POST /deanonymize  { anonymizedMessage } -> { message }
app.post('/deanonymize', async (req, res) => {
  const { anonymizedMessage } = req.body ?? {};
  if (typeof anonymizedMessage !== 'string') {
    return res.status(400).json({ error: 'El campo "anonymizedMessage" debe ser un string' });
  }
  const { message, unknown } = await deanonymize(anonymizedMessage);
  if (unknown.length > 0) {
    return res.status(404).json({ error: `Token(s) no encontrado(s): ${unknown.join(', ')}` });
  }
  res.json({ message });
});

// POST /secureChatGPT  { prompt } -> { response, anonymizedPrompt }
// Cada llamada cuesta dinero en OpenAI: como máximo 20 por minuto.
app.post('/secureChatGPT', rateLimit(20, 60_000), async (req, res) => {
  const { prompt } = req.body ?? {};
  if (typeof prompt !== 'string' || prompt.trim() === '') {
    return res.status(400).json({ error: 'El campo "prompt" debe ser un string no vacío' });
  }
  res.json(await secureChat(prompt, getOpenAIService()));
});

// Errores (JSON mal formado, fallo de MongoDB…) -> JSON sin stack trace, para no filtrar internos.
// Express 5 trae aquí también los rechazos de los handlers async. Solo `publicMessage` llega al cliente.
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err.message);
  res.status(status).json({ error: err.publicMessage ?? (status < 500 ? 'Petición inválida' : 'Error interno') });
});

if (require.main === module) {
  connectDB(process.env.MONGODB_URI)
    // En Express 5 el callback de listen también recibe el error de arranque (p. ej. puerto ocupado).
    // ponytail: solo 127.0.0.1 mientras no haya auth; para exponerlo hacen falta auth y rate limit por cliente.
    .then(() =>
      app.listen(PORT, '127.0.0.1', (err) => {
        if (err) {
          console.error(`No se pudo abrir el puerto ${PORT}: ${err.message}`);
          process.exit(1);
        }
        console.log(`PrivacyVault escuchando en http://localhost:${PORT}`);
      })
    )
    .catch((err) => {
      console.error(`No se pudo conectar a MongoDB: ${err.message}`);
      process.exit(1);
    });
}

module.exports = { anonymize, deanonymize, connectDB, Token, secureChat, SECURE_CHAT_SYSTEM_PROMPT, isAllowedHost, rateLimit };
