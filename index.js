const crypto = require('node:crypto');
const express = require('express');

// Secreto del HMAC: solo desde el entorno (.env). Sin él no arrancamos: nunca un secreto por defecto.
const TOKEN_SECRET = process.env.TOKEN_SECRET;
if (!TOKEN_SECRET) throw new Error('Falta TOKEN_SECRET en .env (ver .env.example)');

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
    // nombre completo: palabras con mayúscula inicial separadas por espacios, salvo al inicio del
    // mensaje o tras ! ? ¿ ¡. El "." no cuenta como fin de frase: en "Sr. Pérez" dejaría el nombre visible.
    String.raw`(?<NAME>(?<!\p{L})(?<!^\s*)(?<![!?¿¡]\s*)\p{Lu}\p{L}*(?:[ \t]+\p{Lu}\p{L}*)*)`,
  ].join('|'),
  'gu'
);

// Sin \b: el token tiene largo fijo y puede quedar pegado a letras/dígitos ("Ana2" -> "NAME_…2").
const TOKEN_REGEX = /(?:NAME|EMAIL|PHONE)_[0-9a-f]{12}/g;

// ponytail: almacén en memoria; se pierde al reiniciar y crece sin límite. La fase 2 lo pasa a MongoDB.
const vault = new Map();

/**
 * Devuelve el token determinista de un valor (TIPO_ + 12 hex de HMAC-SHA256) y guarda el par.
 * Determinista: la misma PII produce siempre el mismo token; sin el secreto no se puede revertir.
 */
function tokenize(type, value) {
  const hash = crypto.createHmac('sha256', TOKEN_SECRET).update(value).digest('hex').slice(0, 12);
  const token = `${type}_${hash}`;
  vault.set(token, value);
  return token;
}

/** Reemplaza cada nombre, email y teléfono del mensaje por su token. */
function anonymize(message) {
  return message.replace(PII_REGEX, (match, ...args) => {
    const groups = args.at(-1);
    const type = Object.keys(groups).find((key) => groups[key] !== undefined);
    return tokenize(type, match);
  });
}

/** Devuelve los tokens del texto que no existen en el vault, sin repetir. */
function findUnknownTokens(text) {
  return [...new Set(text.match(TOKEN_REGEX) ?? [])].filter((token) => !vault.has(token));
}

/** Reemplaza cada token conocido por su valor original; los desconocidos quedan tal cual. */
function deanonymize(anonymizedMessage) {
  return anonymizedMessage.replace(TOKEN_REGEX, (token) => vault.get(token) ?? token);
}

const app = express();
app.use(express.json());

// POST /anonymize  { message } -> { anonymizedMessage }
app.post('/anonymize', (req, res) => {
  const { message } = req.body ?? {};
  if (typeof message !== 'string') {
    return res.status(400).json({ error: 'El campo "message" debe ser un string' });
  }
  res.json({ anonymizedMessage: anonymize(message) });
});

// POST /deanonymize  { anonymizedMessage } -> { message }
app.post('/deanonymize', (req, res) => {
  const { anonymizedMessage } = req.body ?? {};
  if (typeof anonymizedMessage !== 'string') {
    return res.status(400).json({ error: 'El campo "anonymizedMessage" debe ser un string' });
  }
  const unknown = findUnknownTokens(anonymizedMessage);
  if (unknown.length > 0) {
    return res.status(404).json({ error: `Token(s) no encontrado(s): ${unknown.join(', ')}` });
  }
  res.json({ message: deanonymize(anonymizedMessage) });
});

// Errores (p. ej. JSON mal formado) -> JSON sin stack trace, para no filtrar internos.
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status < 500 ? 'Petición inválida' : 'Error interno' });
});

if (require.main === module) {
  const port = process.env.PORT || 3001;
  app.listen(port, () => console.log(`PrivacyVault escuchando en http://localhost:${port}`));
}

module.exports = { anonymize, deanonymize, findUnknownTokens };
