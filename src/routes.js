// Capa web: valida el input de cada endpoint y delega en los servicios. Sin lógica de negocio.
const express = require('express');
const { anonymize, deanonymize } = require('./services/vault');
const { secureChat } = require('./services/secureChat');
const OpenAIService = require('./services/openaiService');
const { rateLimit } = require('./middlewares');

const router = express.Router();

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

// POST /anonymize  { message } -> { anonymizedMessage }
router.post('/anonymize', async (req, res) => {
  const { message } = req.body ?? {};
  if (typeof message !== 'string') {
    return res.status(400).json({ error: 'El campo "message" debe ser un string' });
  }
  res.json({ anonymizedMessage: await anonymize(message) });
});

// POST /deanonymize  { anonymizedMessage } -> { message }
router.post('/deanonymize', async (req, res) => {
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
router.post('/secureChatGPT', rateLimit(20, 60_000), async (req, res) => {
  const { prompt } = req.body ?? {};
  if (typeof prompt !== 'string' || prompt.trim() === '') {
    return res.status(400).json({ error: 'El campo "prompt" debe ser un string no vacío' });
  }
  res.json(await secureChat(prompt, getOpenAIService()));
});

module.exports = router;
