// Configuración leída del entorno (.env). Se valida al cargar: si falta algo obligatorio, el servicio no arranca.
// MONGODB_URI la valida connectDB y OPENAI_* la valida OpenAIService (solo hace falta para /secureChatGPT).

// Secreto del HMAC: solo desde el entorno. Sin él no arrancamos: nunca un secreto por defecto.
const TOKEN_SECRET = process.env.TOKEN_SECRET;
if (!TOKEN_SECRET) throw new Error('Falta TOKEN_SECRET en .env (ver .env.example)');

module.exports = {
  TOKEN_SECRET,
  PORT: Number(process.env.PORT) || 3001,
  MONGODB_URI: process.env.MONGODB_URI,
};
