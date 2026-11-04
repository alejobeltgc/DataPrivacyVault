// Punto de entrada: conecta a MongoDB y, solo si lo logra, abre el puerto.
const { PORT, MONGODB_URI } = require('./src/config');
const { connectDB } = require('./src/db');
const app = require('./src/app');

connectDB(MONGODB_URI)
  // En Express 5 el callback de listen también recibe el error de arranque (p. ej. puerto ocupado).
  // ponytail: solo 127.0.0.1 mientras no haya auth; para exponerlo hacen falta auth y rate limit por cliente.
  .then(() =>
    app.listen(PORT, '127.0.0.1', (err) => {
      if (err) {
        console.error(`No se pudo abrir el puerto ${PORT}: ${err.message}`);
        process.exit(1);
      }
      console.log(`PrivacyVault escuchando en http://localhost:${PORT}`);
    })
  )
  .catch((err) => {
    console.error(`No se pudo conectar a MongoDB: ${err.message}`);
    process.exit(1);
  });
