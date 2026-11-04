// Detección de PII por regex y generación de tokens deterministas. Lógica pura: sin base de datos ni HTTP.
const crypto = require('node:crypto');
const { TOKEN_SECRET } = require('../config');

const TYPES = ['NAME', 'EMAIL', 'PHONE'];

// Una sola regex con alternación (email | teléfono | nombre) y un único replace:
// así un token ya insertado nunca se re-detecta y las mayúsculas de un email no cuentan como nombre.
// ponytail: nombre = palabras capitalizadas seguidas que no abren mensaje ni frase. Un nombre que abra
// frase ("Ana vino") no se detecta; para eso haría falta NER (fuera de alcance del taller).
const PII_REGEX = new RegExp(
  [
    // email: letras Unicode (josé@…); ancla de inicio + {1,64} evitan backtracking cuadrático (ReDoS)
    String.raw`(?<EMAIL>(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]{1,64}@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+)`,
    // teléfono: 7-15 dígitos, con espacios/guiones opcionales
    String.raw`(?<PHONE>\+?\d(?:[\s-]?\d){6,14})`,
    // nombre completo: palabras con mayúscula inicial separadas por espacios. Al inicio del mensaje o
    // tras ! ? ¿ ¡ una sola palabra capitalizada es normal ("Redacta…"), así que ahí se exigen 2+ ("Carlos Mendoza…").
    // El "." no cuenta como fin de frase: en "Sr. Pérez" dejaría el nombre visible.
    String.raw`(?<NAME>(?<!\p{L})(?:(?<!^\s*)(?<![!?¿¡]\s*)\p{Lu}\p{L}*(?:[ \t]+\p{Lu}\p{L}*)*|\p{Lu}\p{L}*(?:[ \t]+\p{Lu}\p{L}*)+))`,
  ].join('|'),
  'gu'
);

// Sin \b: el token tiene largo fijo y puede quedar pegado a letras/dígitos ("Ana2" -> "NAME_…2").
const TOKEN_REGEX = /(?:NAME|EMAIL|PHONE)_[0-9a-f]{12}/g;

/** Token determinista de un valor: TIPO_ + 12 hex de HMAC-SHA256. Sin el secreto no se puede revertir. */
function tokenFor(type, value) {
  return `${type}_${crypto.createHmac('sha256', TOKEN_SECRET).update(value).digest('hex').slice(0, 12)}`;
}

module.exports = { TYPES, PII_REGEX, TOKEN_REGEX, tokenFor };
