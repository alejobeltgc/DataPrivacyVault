// Tests contra MongoDB: usan MONGODB_URI de .env, pero en una base de datos aparte.
process.env.TOKEN_SECRET = 'secreto-de-test';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const { anonymize, deanonymize, connectDB, Token } = require('./index');

const TEST_DB = 'privacyvault_test';
const T = (type) => `${type}_[0-9a-f]{12}`;
const EXAMPLE = 'oferta de trabajo para Carlos Mendoza con email cmendoza@example.com y teléfono 3001234567';
const roundTrip = async (msg) => (await deanonymize(await anonymize(msg))).message;

// Base limpia en cada corrida: si quedaran datos viejos, los tests no detectarían que se quitó la persistencia.
before(async () => {
  await connectDB(process.env.MONGODB_URI, { dbName: TEST_DB });
  // Guarda de seguridad: solo se borra la base de test, nunca la real.
  assert.strictEqual(mongoose.connection.name, TEST_DB);
  await mongoose.connection.dropDatabase();
  await Token.syncIndexes(); // recrea los índices desde el schema (incluido el único por token)
});
after(() => mongoose.disconnect());

test('más de 200 datos distintos en un mensaje -> 413 y no se guarda nada', async () => {
  const msg = Array.from({ length: 201 }, (_, i) => `u${i}@correo.co`).join(' ');
  await assert.rejects(anonymize(msg), (err) => err.status === 413 && /200/.test(err.publicMessage));
  assert.strictEqual(await Token.countDocuments({ value: 'u0@correo.co' }), 0);
});

test('connectDB sin MONGODB_URI da un error claro', async () => {
  await assert.rejects(connectDB(''), /MONGODB_URI/);
});

test('anonimiza el ejemplo con tokens prefijados y nombre completo en un token', async () => {
  const out = await anonymize(EXAMPLE);
  assert.match(out, new RegExp(`^oferta de trabajo para ${T('NAME')} con email ${T('EMAIL')} y teléfono ${T('PHONE')}$`));
  for (const pii of ['Carlos', 'Mendoza', 'cmendoza@example.com', '3001234567']) assert.ok(!out.includes(pii));
});

test('guarda cada par en MongoDB con tipo, fecha de creación e índice único por token', async () => {
  const out = await anonymize('a Carlos Mendoza');
  const doc = await Token.findOne({ token: out.slice(2) }).lean();
  assert.strictEqual(doc.value, 'Carlos Mendoza');
  assert.strictEqual(doc.type, 'NAME');
  assert.ok(doc.createdAt instanceof Date);
  const indexes = await Token.collection.indexes();
  assert.ok(indexes.some((i) => i.key.token === 1 && i.unique), 'falta índice único en token');
});

test('ida y vuelta exacta, incluso con PII pegada a letras, dígitos o _', async () => {
  for (const msg of [
    EXAMPLE, 'a José Muñoz al +57 315 231 9157', 'la Dra. Ana Gómez', 'escribe a josé.pérez@correo.co',
    'ver Ana2 hoy', 'ver Ana_x', 'ref abc3001234567', 'cmendoza@example.com_x', 'num 30012345671234567',
  ]) {
    assert.strictEqual(await roundTrip(msg), msg);
  }
});

test('la misma PII produce siempre el mismo token', async () => {
  assert.strictEqual(await anonymize('a Carlos Mendoza'), await anonymize('a Carlos Mendoza'));
});

test('deanonymize reporta los tokens desconocidos (sin repetir)', async () => {
  const known = await anonymize('a Carlos Mendoza');
  const { unknown } = await deanonymize(`${known} NAME_000000000000 NAME_000000000000`);
  assert.deepStrictEqual(unknown, ['NAME_000000000000']);
  assert.deepStrictEqual((await deanonymize('sin tokens')).unknown, []);
});

test('la palabra al inicio de mensaje o de frase no se tokeniza', async () => {
  assert.match(
    await anonymize('Oferta para Ana María Pérez? Gracias, ¿Hablamos?'),
    new RegExp(`^Oferta para ${T('NAME')}\\? Gracias, ¿Hablamos\\?$`)
  );
});

test('el nombre tras una abreviatura (Sr., Dra.) se tokeniza', async () => {
  for (const msg of ['al Sr. Pérez hoy', 'la Dra. Ana Gómez']) {
    assert.ok(!/Pérez|Ana|Gómez/.test(await anonymize(msg)), msg);
  }
});

test('mensaje sin PII queda igual', async () => {
  const msg = 'Hola, ¿cómo estás? Nos vemos mañana a las 3!';
  assert.strictEqual(await anonymize(msg), msg);
});

test('nombres con tilde/ñ y teléfonos con espacios o +57', async () => {
  assert.match(
    await anonymize('a José Muñoz y a Íñigo Ñúñez al +57 315 231 9157'),
    new RegExp(`^a ${T('NAME')} y a ${T('NAME')} al ${T('PHONE')}$`)
  );
});

test('emails con tilde/ñ o mayúsculas se tokenizan completos', async () => {
  for (const email of ['josé@gmail.com', 'josé.pérez@correo.co', 'ana@dominió.com', 'Carlos.Mendoza@Example.com']) {
    assert.match(await anonymize(`a ${email} b`), new RegExp(`^a ${T('EMAIL')} b$`), email);
  }
});

test('texto largo no bloquea (sin ReDoS)', async () => {
  const start = Date.now();
  await anonymize('a'.repeat(100000));
  await anonymize('Ab '.repeat(33000)); // un solo nombre largo: no supera el tope de 200
  // Margen amplio por la latencia de red a Atlas; el ReDoS original tardaba ~16 s.
  assert.ok(Date.now() - start < 3000, `tardó ${Date.now() - start} ms`);
});
