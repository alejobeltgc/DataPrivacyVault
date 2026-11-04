// Tests sin red: un fetch falso simula las respuestas HTTP de OpenAI y el SDK real las convierte en sus errores.
const { test } = require('node:test');
const assert = require('node:assert');
const OpenAIService = require('../src/services/openaiService');

const json = (status, body) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
const apiError = (status, code) => () => json(status, { error: { message: 'x', type: 'error', code } });

// Servicio de prueba: credenciales falsas y sin reintentos para que los tests sean rápidos.
const service = (fetch, options = {}) =>
  new OpenAIService({ apiKey: 'sk-test', model: 'modelo-test', maxRetries: 0, fetch, ...options });

test('devuelve el texto y envía system + user al modelo configurado', async () => {
  let sent;
  const fetch = (url, init) => {
    sent = { url: String(url), body: JSON.parse(init.body) };
    return json(200, { choices: [{ index: 0, message: { role: 'assistant', content: 'hola!' } }] });
  };
  assert.strictEqual(await service(fetch).complete('saluda', 'eres breve'), 'hola!');
  assert.match(sent.url, /\/chat\/completions$/);
  assert.strictEqual(sent.body.model, 'modelo-test');
  assert.strictEqual(sent.body.max_completion_tokens, 2048, 'la salida debe tener tope (costo acotado)');
  assert.deepStrictEqual(sent.body.messages, [
    { role: 'system', content: 'eres breve' },
    { role: 'user', content: 'saluda' },
  ]);
});

test('sin system prompt solo envía el mensaje del usuario', async () => {
  let messages;
  const fetch = (url, init) => {
    messages = JSON.parse(init.body).messages;
    return json(200, { choices: [{ index: 0, message: { role: 'assistant', content: 'ok' } }] });
  };
  await service(fetch).complete('hola');
  assert.deepStrictEqual(messages, [{ role: 'user', content: 'hola' }]);
});

test('401 -> error claro de autenticación, sin filtrar la API key', async () => {
  // Como la API real: el mensaje del 401 incluye la key. No debe llegar a ningún lado del error.
  const fetch = () =>
    json(401, { error: { message: 'Incorrect API key provided: sk-test', type: 'invalid_request_error', code: 'invalid_api_key' } });
  await assert.rejects(service(fetch).complete('hola'), (err) => {
    assert.strictEqual(err.status, 502);
    assert.match(err.publicMessage, /OPENAI_API_KEY/);
    assert.deepStrictEqual(Object.keys(err.cause).sort(), ['code', 'requestID', 'status']);
    for (const text of [err.message, err.publicMessage, JSON.stringify(err), JSON.stringify(err.cause)]) {
      assert.ok(!text.includes('sk-test'), text);
    }
    return true;
  });
});

test('otros errores de OpenAI (400, 404…) -> 502, no se confunden con errores del cliente', async () => {
  await assert.rejects(service(apiError(404, 'model_not_found')).complete('hola'), (err) => {
    assert.strictEqual(err.status, 502);
    assert.match(err.publicMessage, /OpenAI/);
    return true;
  });
});

test('respuesta sin texto (content null / refusal) -> error claro, no string vacío', async () => {
  const fetch = () =>
    json(200, { choices: [{ index: 0, message: { role: 'assistant', content: null, refusal: 'no' } }] });
  await assert.rejects(service(fetch).complete('hola'), (err) => err.status === 502 && /texto/.test(err.publicMessage));
});

test('prompt demasiado largo -> 413 antes de llamar a OpenAI', async () => {
  let called = false;
  const fetch = () => { called = true; return apiError(500)(); };
  await assert.rejects(service(fetch).complete('a'.repeat(20_001)), (err) => err.status === 413);
  assert.strictEqual(called, false);
});

test('solo acepta opciones permitidas: baseURL no puede desviar la key a otro host', async () => {
  let url;
  const fetch = (u) => { url = String(u); return json(200, { choices: [{ index: 0, message: { role: 'assistant', content: 'ok' } }] }); };
  await service(fetch, { baseURL: 'https://evil.example' }).complete('hola');
  assert.match(url, /^https:\/\/api\.openai\.com\//);
});

test('429 por límite de solicitudes -> error claro', async () => {
  await assert.rejects(service(apiError(429, 'rate_limit_exceeded')).complete('hola'), (err) => {
    assert.strictEqual(err.status, 429);
    assert.match(err.publicMessage, /límite de solicitudes/);
    return true;
  });
});

test('429 por cuota o créditos agotados -> mensaje distinto (no se arregla esperando)', async () => {
  // 'credit_balance_exhausted' se observó en la API real con una cuenta sin créditos.
  for (const code of ['insufficient_quota', 'credit_balance_exhausted']) {
    await assert.rejects(service(apiError(429, code)).complete('hola'), (err) => {
      assert.strictEqual(err.status, 429);
      assert.match(err.publicMessage, /cuota|créditos/, code);
      assert.doesNotMatch(err.publicMessage, /espera/, code);
      return true;
    });
  }
});

test('timeout -> error claro', async () => {
  const hang = (url, init) =>
    new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
  await assert.rejects(service(hang, { timeout: 50 }).complete('hola'), (err) => {
    assert.strictEqual(err.status, 504);
    assert.match(err.publicMessage, /tiempo/);
    return true;
  });
});

test('configuración o prompt inválidos -> error claro antes de llamar a OpenAI', () => {
  assert.throws(() => new OpenAIService({ apiKey: '', model: 'm' }), /OPENAI_API_KEY/);
  assert.throws(() => new OpenAIService({ apiKey: 'k', model: '' }), /OPENAI_MODEL/);
  return assert.rejects(service(apiError(500)).complete(''), /prompt/);
});
