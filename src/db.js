// Capa de datos: conexión a MongoDB y modelo de la pareja [información privada, token].
const mongoose = require('mongoose');
const { TYPES } = require('./services/pii');

// Pareja [información privada, token] con su tipo y fecha de creación. Índice único por token.
const Token = mongoose.model(
  'Token',
  new mongoose.Schema(
    {
      token: { type: String, required: true, unique: true },
      value: { type: String, required: true },
      type: { type: String, required: true, enum: TYPES },
    },
    { timestamps: { createdAt: true, updatedAt: false } }
  )
);

/**
 * Conecta a MongoDB y espera a que existan los índices (incluido el único por token).
 * Falla rápido (5 s) en vez de los 30 s por defecto, para que el error de arranque se vea enseguida.
 */
async function connectDB(uri, options = {}) {
  if (!uri) throw new Error('Falta MONGODB_URI en .env (ver .env.example)');
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000, ...options });
  await Token.init();
}

module.exports = { Token, connectDB };
