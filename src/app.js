// Arma la aplicación Express (sin abrir el puerto: eso lo hace server.js).
// Orden: guarda de Host -> parseo JSON -> rutas -> manejador de errores.
const express = require('express');
const { PORT } = require('./config');
const { hostGuard, errorHandler } = require('./middlewares');
const routes = require('./routes');

const app = express();
app.use(hostGuard(PORT));
app.use(express.json());
app.use(routes);
app.use(errorHandler);

module.exports = app;
