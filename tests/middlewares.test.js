// Tests de los middlewares: lógica pura, sin base de datos ni red.
const { test } = require('node:test');
const assert = require('node:assert');
const { isAllowedHost, rateLimit } = require('../src/middlewares');

test('isAllowedHost: solo localhost/127.0.0.1 en el puerto del servicio (anti DNS rebinding)', () => {
  assert.ok(isAllowedHost('localhost:3001', 3001));
  assert.ok(isAllowedHost('127.0.0.1:3001', 3001));
  for (const host of ['evil.example:3001', 'localhost:9999', 'localhost.evil.example:3001', undefined]) {
    assert.ok(!isAllowedHost(host, 3001), String(host));
  }
});

test('rateLimit: deja pasar hasta el máximo por ventana y luego responde 429', () => {
  const limiter = rateLimit(2, 60_000);
  const statuses = [];
  for (let i = 0; i < 3; i++) {
    const res = { status: (code) => (statuses.push(code), { json: () => {} }) };
    limiter({}, res, () => statuses.push('next'));
  }
  assert.deepStrictEqual(statuses, ['next', 'next', 429]);
});
