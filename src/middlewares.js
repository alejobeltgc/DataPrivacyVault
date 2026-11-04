// Middlewares transversales de Express: protección del Host, rate limit y respuesta de errores.

/** Anti DNS rebinding: el servicio escucha en 127.0.0.1, así que solo acepta Host local en su puerto. */
function isAllowedHost(host, port) {
  return host === `localhost:${port}` || host === `127.0.0.1:${port}`;
}

/** Middleware que responde 403 si el Host no es local (ver isAllowedHost). */
function hostGuard(port) {
  return (req, res, next) =>
    isAllowedHost(req.headers.host, port) ? next() : res.status(403).json({ error: 'Host no permitido' });
}

/**
 * Rate limit de ventana fija: como máximo `max` peticiones cada `windowMs`; el resto recibe 429.
 * ponytail: contador global (el servicio solo escucha en localhost); por cliente si se expone.
 */
function rateLimit(max, windowMs) {
  let windowStart = 0;
  let count = 0;
  return (req, res, next) => {
    const now = Date.now();
    if (now - windowStart >= windowMs) {
      windowStart = now;
      count = 0;
    }
    if (++count > max) {
      return res.status(429).json({ error: `Demasiadas solicitudes: máximo ${max} cada ${windowMs / 1000} s` });
    }
    next();
  };
}

// Errores (JSON mal formado, fallo de MongoDB…) -> JSON sin stack trace, para no filtrar internos.
// Express 5 trae aquí también los rechazos de los handlers async. Solo `publicMessage` llega al cliente.
function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  if (status >= 500) console.error(err.message);
  res.status(status).json({ error: err.publicMessage ?? (status < 500 ? 'Petición inválida' : 'Error interno') });
}

module.exports = { isAllowedHost, hostGuard, rateLimit, errorHandler };
