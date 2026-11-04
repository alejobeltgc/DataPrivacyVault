// Chat seguro con OpenAI: la PII se anonimiza antes de salir y se restaura en la respuesta.
const crypto = require('node:crypto');
const { TOKEN_REGEX } = require('./pii');
const { anonymizeWithTokens } = require('./vault');

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
 * `openai` es cualquier objeto con complete(prompt, systemPrompt): en producción, OpenAIService.
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

module.exports = { secureChat, SECURE_CHAT_SYSTEM_PROMPT };
