
'use strict';

// Gimnasio MQS - autenticación para las rutas del ERP.
// Compatible con el JWT HS256 emitido por controllers/auth.controller.js.
// Uso: const requireErpAuth = createErpAuthMiddleware(db);

const { createHmac, timingSafeEqual } = require('node:crypto');

const ISSUER = 'gym-mqs-api';
const AUDIENCE = 'gym-mqs-web';
const MAX_TOKEN_SECONDS = 2 * 60 * 60;
const MAX_TOKEN_LENGTH = 4096;
const MAX_USER_ID = 2147483647;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function decodeJsonSegment(segment) {
  if (!segment || segment.length > MAX_TOKEN_LENGTH || !/^[A-Za-z0-9_-]+$/.test(segment)) {
    return null;
  }

  try {
    const bytes = Buffer.from(segment, 'base64url');
    if (bytes.toString('base64url') !== segment) return null;

    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const value = JSON.parse(decoded);

    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

function tokenFromRequest(req) {
  const header = req.headers?.authorization;

  if (typeof header !== 'string' || header.length > MAX_TOKEN_LENGTH + 10) {
    return null;
  }

  // Evita interpretar cabeceras Authorization duplicadas.
  if (Array.isArray(req.rawHeaders)) {
    let count = 0;

    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      if (String(req.rawHeaders[i]).toLowerCase() === 'authorization') {
        count += 1;
      }
      if (count > 1) return null;
    }
  }

  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(header);

  return match && match[1].length <= MAX_TOKEN_LENGTH
    ? match[1]
    : null;
}

function validUserId(raw) {
  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw)) {
    return null;
  }

  const id = Number(raw);

  return Number.isSafeInteger(id) && id <= MAX_USER_ID
    ? id
    : null;
}

function verifyToken(token, key, now = Math.floor(Date.now() / 1000)) {
  if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) {
    return null;
  }

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, encodedSignature] = parts;

  // La firma se verifica antes de confiar en cualquier dato del JWT.
  if (!/^[A-Za-z0-9_-]{43}$/.test(encodedSignature)) {
    return null;
  }

  const signature = Buffer.from(encodedSignature, 'base64url');

  if (
    signature.length !== 32 ||
    signature.toString('base64url') !== encodedSignature
  ) {
    return null;
  }

  const expected = createHmac('sha256', key)
    .update(`${encodedHeader}.${encodedPayload}`, 'utf8')
    .digest();

  if (!timingSafeEqual(signature, expected)) {
    return null;
  }

  const header = decodeJsonSegment(encodedHeader);
  const claims = decodeJsonSegment(encodedPayload);

  if (
    !header ||
    !claims ||
    header.alg !== 'HS256' ||
    header.typ !== 'JWT'
  ) {
    return null;
  }

  // El controlador de login solo firma esos dos atributos.
  if (Object.keys(header).length !== 2) {
    return null;
  }

  if (claims.iss !== ISSUER || claims.aud !== AUDIENCE) {
    return null;
  }

  if (
    !Number.isSafeInteger(claims.iat) ||
    !Number.isSafeInteger(claims.exp)
  ) {
    return null;
  }

  if (claims.iat > now + 30 || claims.exp <= now) {
    return null;
  }

  if (
    claims.exp <= claims.iat ||
    claims.exp - claims.iat > MAX_TOKEN_SECONDS
  ) {
    return null;
  }

  if (
    typeof claims.jti !== 'string' ||
    !UUID_V4.test(claims.jti)
  ) {
    return null;
  }

  return validUserId(claims.sub);
}

function reject(res) {
  res.set('Cache-Control', 'no-store');
  res.set('WWW-Authenticate', 'Bearer realm="GymMqs"');

  return res.status(401).json({
    message: 'Debes iniciar sesión nuevamente',
    statusCode: 401,
  });
}

function createErpAuthMiddleware(db) {
  if (!db || typeof db.query !== 'function') {
    throw new TypeError('Se requiere la conexión MySQL del backend');
  }

  const secret = process.env.JWT_SECRET;

  if (
    typeof secret !== 'string' ||
    Buffer.byteLength(secret, 'utf8') < 32
  ) {
    throw new Error(
      'JWT_SECRET debe tener al menos 32 bytes y cargarse desde .env'
    );
  }

  const key = Buffer.from(secret, 'utf8');

  return async function requireErpAuth(req, res, next) {
    // Nunca confiar en identidades introducidas por el cliente.
    delete req.auth;

    try {
      const token = tokenFromRequest(req);
      const userId = token ? verifyToken(token, key) : null;

      if (!userId) {
        return reject(res);
      }

      // Comprobar en MySQL que el usuario y su rol sigan activos.
      const [rows] = await db.query(`
        SELECT
          u.id_user,
          u.username,
          u.status AS user_status,
          r.id_role,
          r.name AS role,
          r.status AS role_status
        FROM users AS u
        INNER JOIN roles AS r
          ON r.id_role = u.id_role
        WHERE u.id_user = ?
        LIMIT 1
      `, [userId]);

      if (!Array.isArray(rows) || rows.length !== 1) {
        return reject(res);
      }

      const user = rows[0];
      const id = validUserId(String(user.id_user));
      const roleId = validUserId(String(user.id_role));

      if (
        id !== userId ||
        !roleId ||
        user.user_status !== 'ACTIVE' ||
        user.role_status !== 'ACTIVE' ||
        typeof user.role !== 'string' ||
        !user.role.trim() ||
        typeof user.username !== 'string' ||
        !user.username.trim()
      ) {
        return reject(res);
      }

      // Identidad verificada por JWT y por la base de datos.
      req.auth = {
        verified: true,
        id_user: id,
        id_role: roleId,
        role: user.role,
        username: user.username,
      };

      res.set('Cache-Control', 'no-store');

      return next();
    } catch (error) {
      // Ante errores de MySQL no se permite continuar.
      return next(error);
    }
  };
}

module.exports = { createErpAuthMiddleware };
