process.env.TOKEN_SECRET = 'secreto-de-test';

const test = require('node:test');
const assert = require('node:assert');
const { anonymize, deanonymize, findUnknownTokens } = require('./index');

const T = (type) => `${type}_[0-9a-f]{12}`;
const EXAMPLE = 'oferta de trabajo para Carlos Mendoza con email cmendoza@example.com y teléfono 3001234567';

test('anonimiza el ejemplo con tokens prefijados y nombre completo en un token', () => {
  const out = anonymize(EXAMPLE);
  assert.match(out, new RegExp(`^oferta de trabajo para ${T('NAME')} con email ${T('EMAIL')} y teléfono ${T('PHONE')}$`));
  for (const pii of ['Carlos', 'Mendoza', 'cmendoza@example.com', '3001234567']) assert.ok(!out.includes(pii));
});

test('deanonymize devuelve el mensaje original (ida y vuelta)', () => {
  assert.strictEqual(deanonymize(anonymize(EXAMPLE)), EXAMPLE);
});

test('ida y vuelta exacta, incluso con PII pegada a letras, dígitos o _', () => {
  for (const msg of [
    'a José Muñoz al +57 315 231 9157', 'la Dra. Ana Gómez', 'escribe a josé.pérez@correo.co',
    'ver Ana2 hoy', 'ver Ana_x', 'ref abc3001234567', 'cmendoza@example.com_x', 'num 30012345671234567',
  ]) {
    assert.strictEqual(deanonymize(anonymize(msg)), msg);
  }
});

test('la misma PII produce siempre el mismo token', () => {
  assert.strictEqual(anonymize('a Carlos Mendoza'), anonymize('a Carlos Mendoza'));
});

test('findUnknownTokens lista solo los tokens que no están en el vault (sin repetir)', () => {
  const known = anonymize('a Carlos Mendoza');
  assert.deepStrictEqual(findUnknownTokens(`${known} NAME_000000000000 NAME_000000000000`), ['NAME_000000000000']);
  assert.deepStrictEqual(findUnknownTokens('sin tokens'), []);
});

test('la palabra al inicio de mensaje o de frase no se tokeniza', () => {
  assert.match(
    anonymize('Oferta para Ana María Pérez? Gracias, ¿Hablamos?'),
    new RegExp(`^Oferta para ${T('NAME')}\\? Gracias, ¿Hablamos\\?$`)
  );
});

test('el nombre tras una abreviatura (Sr., Dra.) se tokeniza', () => {
  for (const msg of ['al Sr. Pérez hoy', 'la Dra. Ana Gómez']) {
    assert.ok(!/Pérez|Ana|Gómez/.test(anonymize(msg)), msg);
  }
});

test('mensaje sin PII queda igual', () => {
  const msg = 'Hola, ¿cómo estás? Nos vemos mañana a las 3!';
  assert.strictEqual(anonymize(msg), msg);
});

test('nombres con tilde/ñ y teléfonos con espacios o +57', () => {
  assert.match(
    anonymize('a José Muñoz y a Íñigo Ñúñez al +57 315 231 9157'),
    new RegExp(`^a ${T('NAME')} y a ${T('NAME')} al ${T('PHONE')}$`)
  );
});

test('emails con tilde/ñ o mayúsculas se tokenizan completos', () => {
  for (const email of ['josé@gmail.com', 'josé.pérez@correo.co', 'ana@dominió.com', 'Carlos.Mendoza@Example.com']) {
    assert.match(anonymize(`a ${email} b`), new RegExp(`^a ${T('EMAIL')} b$`), email);
  }
});

test('texto largo no bloquea (sin ReDoS)', () => {
  const start = Date.now();
  anonymize('a'.repeat(100000));
  anonymize('Ab '.repeat(33000));
  assert.ok(Date.now() - start < 500, `tardó ${Date.now() - start} ms`);
});
