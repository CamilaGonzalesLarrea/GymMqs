
'use strict';

const argon2 = require('argon2');
const { createHmac, randomUUID } = require('node:crypto');

// Gimnasio MQS - autenticación.
// Mantiene { message, user } como espera el frontend y añade { token, ... }.
// El token SOLO podrá aceptarse tras verificar su firma en un middleware.
const ACCESS_TOKEN_SECONDS = 2 * 60 * 60;
const JWT_ISSUER = 'gym-mqs-api';
const JWT_AUDIENCE = 'gym-mqs-web';
const MAX_USERNAME_LENGTH = 50; // users.username VARCHAR(50)
const MAX_PASSWORD_BYTES = 4096;
const MAX_MYSQL_ID = 2147483647;
const INVALID_CREDENTIALS = 'Usuario o contraseña incorrectos';

// Hash Argon2id válido para verificar una contraseña ficticia cuando el usuario
// no existe. Ayuda a reducir diferencias de tiempo entre ambos casos.
const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$VSbQUWVJ6oIHpPhZpCTrSg$D0i35aJ5n8pA8nUd6HnWP2BK/eGr73HEInWVgJ3TN2k';

function isObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function parseCredentials(body) {
  if (!isObject(body)) return null;
  if (typeof body.username !== 'string' || typeof body.password !== 'string') {
    return null;
  }

  const username = body.username.trim();
  const password = body.password; // Nunca quitar espacios a una contraseña.

  if (
    !username || !password ||
    username.length > MAX_USERNAME_LENGTH ||
    /[\u0000-\u001f\u007f]/u.test(username) ||
    Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES
  ) {
    return null;
  }

  return { username, password };
}

function validId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 && id <= MAX_MYSQL_ID;
}

function accountIsEnabled(user) {
  return Boolean(
    user &&
    validId(user.id_user) &&
    validId(user.id_role) &&
    typeof user.username === 'string' &&
    user.username.length > 0 &&
    typeof user.role === 'string' &&
    user.role.trim() &&
    user.status === 'ACTIVE' &&
    user.role_status === 'ACTIVE'
  );
}

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (typeof secret !== 'string' || Buffer.byteLength(secret, 'utf8') < 32) {
    return null; // Nunca usar un secreto predeterminado o débil.
  }
  return secret;
}

// Firma un JWT HS256 estándar sin añadir dependencias nuevas al proyecto.
// El middleware de autenticación deberá verificar firma, alg, iss, aud y exp.
function signToken(userId, secret) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'HS256' }))
    .toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: String(userId),
    iss: JWT_ISSUER,
    aud: JWT_AUDIENCE,
    iat: now,
    exp: now + ACCESS_TOKEN_SECONDS,
    jti: randomUUID(),
  })).toString('base64url');
  const unsigned = `${header}.${payload}`;
  const signature = createHmac('sha256', secret)
    .update(unsigned, 'utf8')
    .digest('base64url');
  return `${unsigned}.${signature}`;
}

function preventCaching(res) {
  res.set('Cache-Control', 'no-store');
  res.set('Pragma', 'no-cache');
}

// Se conserva la firma de fábrica que usa auth.routes.js:
// createAuthController(db, verifyPassword)
exports.createAuthController = (db, verify = argon2.verify) => {
  if (!db || typeof db.query !== 'function') {
    throw new TypeError('Se requiere una conexión de base de datos válida');
  }
  if (typeof verify !== 'function') {
    throw new TypeError('El verificador de contraseña debe ser una función');
  }

  return {
    async login(req, res) {
      preventCaching(res);
      const credentials = parseCredentials(req.body);
      if (!credentials) {
        return res.status(400).json({
          message: 'Usuario y contraseña válidos son obligatorios',
        });
      }

      let rows;
      try {
        [rows] = await db.query(`
          SELECT u.id_user, u.username, u.password_hash, u.status,
                 r.id_role, r.name AS role, r.status AS role_status
          FROM users AS u
          INNER JOIN roles AS r ON r.id_role = u.id_role
          WHERE u.username = ?
          LIMIT 1
        `, [credentials.username]);
        if (!Array.isArray(rows)) throw new TypeError('Resultado SQL inválido');
      } catch (error) {
        console.error('Error al consultar usuarios:', error.code || error.name);
        return res.status(500).json({ message: 'Error en base de datos' });
      }

      const user = rows[0] || null;
      const savedHash = typeof user?.password_hash === 'string' && user.password_hash
        ? user.password_hash
        : DUMMY_HASH;

      let passwordMatches = false;
      try {
        passwordMatches = (await verify(savedHash, credentials.password)) === true;
      } catch (error) {
        // Un hash corrupto es un error interno; no revelar detalles al cliente.
        console.error('Error al verificar credenciales:', error.code || error.name);
        return res.status(500).json({ message: 'No se pudo completar la autenticación' });
      }

      if (!user) {
        return res.status(404).json({ message: 'Usuario no encontrado' });
      }

      if (!passwordMatches || !accountIsEnabled(user)) {
        return res.status(401).json({ message: INVALID_CREDENTIALS });
      }

      const secret = getJwtSecret();
      if (!secret) {
        console.error('Configuración inválida: JWT_SECRET debe tener al menos 32 bytes');
        return res.status(503).json({
          message: 'Autenticación temporalmente no disponible',
        });
      }

      let token;
      try {
        token = signToken(user.id_user, secret);
      } catch (error) {
        console.error('No se pudo generar el token:', error.name);
        return res.status(500).json({ message: 'No se pudo iniciar sesión' });
      }

      return res.status(200).json({
        message: 'Login correcto',
        user: {
          id: Number(user.id_user),
          username: user.username,
          role: user.role,
          id_role: Number(user.id_role),
          status: user.status,
        },
        token,
        token_type: 'Bearer',
        expires_in: ACCESS_TOKEN_SECONDS,
      });
    },
  };
};
