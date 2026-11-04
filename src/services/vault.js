// Vault: reemplaza la PII por tokens, guarda las parejas en MongoDB y las revierte.
const { Token } = require('../db');
const { TYPES, PII_REGEX, TOKEN_REGEX, tokenFor } = require('./pii');

// Tope de datos privados distintos por mensaje: evita que una sola petición dispare miles de upserts.
const MAX_PII_PER_MESSAGE = 200;

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

module.exports = { anonymize, anonymizeWithTokens, deanonymize };
