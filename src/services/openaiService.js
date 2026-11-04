const OpenAI = require('openai');

// Tope de texto por llamada (prompt + system prompt): acota el gasto y el tiempo de cada petición.
const MAX_PROMPT_CHARS = 20_000;

// Códigos de un 429 que significan "sin saldo", no "demasiadas peticiones": esperar no los arregla.
// 'credit_balance_exhausted' se observó en la API real con una cuenta sin créditos.
const QUOTA_CODES = new Set(['insufficient_quota', 'credit_balance_exhausted']);

// Crea un error con el formato que entiende errorHandler (src/middlewares.js): `status` HTTP y `publicMessage` seguro.
// Del error del SDK solo se guardan metadatos: su mensaje en un 401 incluye parte de la API key.
function serviceError(status, publicMessage, sdkError) {
  const cause = sdkError && { status: sdkError.status, code: sdkError.code, requestID: sdkError.requestID };
  return Object.assign(new Error(publicMessage, { cause }), { status, publicMessage });
}

/**
 * Servicio de text completion con la API Chat Completions de OpenAI (SDK oficial `openai`).
 * Lee OPENAI_API_KEY y OPENAI_MODEL del entorno (.env); las opciones del constructor permiten sobreescribirlos.
 *
 * El texto se envía a un tercero: quien lo use debe pasarle SOLO mensajes ya anonimizados, nunca la PII original.
 */
class OpenAIService {
  /**
   * Solo acepta estas opciones (allowlist): nada de baseURL ni cabeceras que puedan desviar la key a otro host.
   * @param {object} [options]
   * @param {string} [options.apiKey]     por defecto process.env.OPENAI_API_KEY
   * @param {string} [options.model]      por defecto process.env.OPENAI_MODEL
   * @param {number} [options.timeout]    ms por intento; el SDK trae 10 min, aquí 30 s para fallar con claridad
   * @param {number} [options.maxRetries] reintentos del SDK (429, timeout, 5xx); con 2, el peor caso ronda los 90 s
   * @param {Function} [options.fetch]    fetch alternativo (los tests lo usan para no salir a la red)
   * @param {number} [options.maxCompletionTokens] tope de tokens de salida (incluye los de razonamiento):
   *   acota el costo de cada llamada; muy bajo puede dejar sin texto a los modelos que razonan
   */
  constructor({
    apiKey = process.env.OPENAI_API_KEY,
    model = process.env.OPENAI_MODEL,
    timeout = 30_000,
    maxRetries = 2,
    fetch,
    maxCompletionTokens = 2048,
  } = {}) {
    if (!apiKey) throw new Error('Falta OPENAI_API_KEY en .env (ver .env.example)');
    if (!model) throw new Error('Falta OPENAI_MODEL en .env (ver .env.example)');
    this.model = model;
    this.maxCompletionTokens = maxCompletionTokens;
    this.client = new OpenAI({ apiKey, timeout, maxRetries, fetch });
  }

  /**
   * Envía el prompt (y opcionalmente un system prompt) y devuelve el texto de la respuesta.
   * Traduce los errores de autenticación, límite de uso, timeout y demás fallos de OpenAI a mensajes claros.
   */
  async complete(prompt, systemPrompt) {
    if (typeof prompt !== 'string' || prompt.trim() === '') {
      throw new TypeError('El prompt debe ser un string no vacío');
    }
    if (prompt.length + (systemPrompt?.length ?? 0) > MAX_PROMPT_CHARS) {
      throw serviceError(413, `El texto supera el máximo de ${MAX_PROMPT_CHARS} caracteres`);
    }
    const messages = systemPrompt
      ? [{ role: 'system', content: systemPrompt }, { role: 'user', content: prompt }]
      : [{ role: 'user', content: prompt }];

    let completion;
    try {
      completion = await this.client.chat.completions.create({
        model: this.model,
        messages,
        max_completion_tokens: this.maxCompletionTokens,
      });
    } catch (err) {
      if (err instanceof OpenAI.AuthenticationError) {
        throw serviceError(502, 'OpenAI rechazó la autenticación: revisa OPENAI_API_KEY en .env', err);
      }
      if (err instanceof OpenAI.RateLimitError) {
        // La cuota o los créditos agotados también llegan como 429, pero no se arreglan esperando.
        const message = QUOTA_CODES.has(err.code)
          ? 'Se agotó la cuota o los créditos de OpenAI: revisa el plan y la facturación de la cuenta'
          : 'Se superó el límite de solicitudes de OpenAI: espera un momento y reintenta';
        throw serviceError(429, message, err);
      }
      if (err instanceof OpenAI.APIConnectionTimeoutError) {
        throw serviceError(504, 'OpenAI no respondió a tiempo: reintenta en unos segundos', err);
      }
      if (err instanceof OpenAI.APIError) {
        // 400/403/404/5xx o red: el fallo es de OpenAI, no del cliente que llamó a nuestra API.
        throw serviceError(502, 'Error al consultar OpenAI', err);
      }
      throw err; // no viene del SDK: es un bug nuestro y debe verse tal cual
    }

    const text = completion.choices[0]?.message?.content;
    if (typeof text !== 'string') {
      throw serviceError(502, 'OpenAI no devolvió texto (respuesta vacía o rechazada por el modelo)');
    }
    return text;
  }
}

module.exports = OpenAIService;
