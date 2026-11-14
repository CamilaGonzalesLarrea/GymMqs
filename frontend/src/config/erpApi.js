import { API_URL } from './api';

// Cliente HTTP para los modulos ERP del Gimnasio MQS.
// Conserva el contrato de Login.jsx y App.jsx sin modificar las rutas antiguas.
// La autorizacion real (firma JWT, usuario y permisos) siempre se hace en Express.

const USER_KEY = 'user';
const TOKEN_KEY = 'authToken';
const TOKEN_EXPIRY_KEY = 'authTokenExpiresAt';
const MAX_TOKEN_LENGTH = 4096;
const MAX_MYSQL_ID = 2147483647;
const DEFAULT_TIMEOUT_MS = 15000;
const MAX_TIMEOUT_MS = 60000;

export class ErpApiError extends Error {
  constructor(message, { status = 0, code = 'API_ERROR', details = null } = {}) {
    super(message);
    this.name = 'ErpApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function isRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validId(value) {
  const text = typeof value === 'number' && Number.isSafeInteger(value)
    ? String(value)
    : typeof value === 'string' ? value : '';

  if (!/^[1-9]\d*$/.test(text)) return null;
  const id = Number(text);
  return Number.isSafeInteger(id) && id <= MAX_MYSQL_ID ? id : null;
}

function getClaims(token) {
  try {
    if (
      typeof token !== 'string' ||
      token.length > MAX_TOKEN_LENGTH ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)
    ) return null;

    const encoded = token.split('.')[1];
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const claims = JSON.parse(window.atob(padded));
    return isRecord(claims) ? claims : null;
  } catch {
    return null;
  }
}

function notifySessionChange() {
  // App.jsx ya vuelve a comprobar la sesion cuando recibe un evento focus.
  // Esto evita que una respuesta HTTP 401 deje una pagina protegida visible.
  try {
    window.dispatchEvent(new Event('focus'));
  } catch {
    // Si el navegador no admite este evento, App.jsx revisa focus/visibility.
  }
}

export function clearErpSession() {
  try {
    window.localStorage.removeItem(USER_KEY);
  } catch {
    // El almacenamiento puede estar restringido por el navegador.
  }

  try {
    window.sessionStorage.removeItem(TOKEN_KEY);
    window.sessionStorage.removeItem(TOKEN_EXPIRY_KEY);
  } catch {
    // Nunca conservar voluntariamente un token tras cerrar la sesion.
  }

  notifySessionChange();
}

function requireSessionToken() {
  let token;
  let rawUser;
  let rawExpiresAt;

  try {
    token = window.sessionStorage.getItem(TOKEN_KEY);
    rawExpiresAt = window.sessionStorage.getItem(TOKEN_EXPIRY_KEY);
    rawUser = window.localStorage.getItem(USER_KEY);
  } catch {
    clearErpSession();
    throw new ErpApiError('No se pudo acceder a tu sesión. Inicia sesión nuevamente.', {
      status: 401,
      code: 'SESSION_UNAVAILABLE',
    });
  }

  let user;
  try {
    user = JSON.parse(rawUser);
  } catch {
    user = null;
  }

  const claims = getClaims(token);
  const expiresAt = Number(rawExpiresAt);
  const userId = validId(user?.id);

  if (
    !isRecord(user) ||
    !userId ||
    typeof user.username !== 'string' ||
    !user.username.trim() ||
    typeof user.role !== 'string' ||
    !user.role.trim() ||
    (user.status && user.status !== 'ACTIVE') ||
    !claims ||
    claims.sub !== String(userId) ||
    claims.iss !== 'gym-mqs-api' ||
    claims.aud !== 'gym-mqs-web' ||
    !Number.isSafeInteger(claims.exp) ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= 0 ||
    Math.min(expiresAt, claims.exp * 1000) <= Date.now()
  ) {
    clearErpSession();
    throw new ErpApiError('Tu sesión venció. Inicia sesión nuevamente.', {
      status: 401,
      code: 'SESSION_EXPIRED',
    });
  }

  // Esta comprobacion local es para UX, NO verifica criptograficamente el JWT.
  // El backend siempre valida la firma, estado del usuario y permisos.
  return token;
}

function buildErpUrl(path, params) {
  if (
    typeof path !== 'string' ||
    !/^\/api\/erp\/[A-Za-z0-9/_-]+$/.test(path) ||
    path.split('/').some((part) => part === '.' || part === '..')
  ) {
    throw new ErpApiError('La ruta solicitada al ERP no es válida.', {
      status: 400,
      code: 'INVALID_PATH',
    });
  }

  const base = String(API_URL || '').replace(/\/+$/, '');
  let url;
  try {
    url = new URL(`${base}${path}`);
    const apiOrigin = new URL(base).origin;
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== apiOrigin) {
      throw new Error('Origen inesperado');
    }
  } catch {
    throw new ErpApiError('La dirección de la API no está configurada correctamente.', {
      code: 'INVALID_API_URL',
    });
  }

  if (params !== undefined) {
    if (!isRecord(params) || Object.keys(params).length > 30) {
      throw new ErpApiError('Los filtros de búsqueda no son válidos.', {
        status: 400,
        code: 'INVALID_FILTERS',
      });
    }
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue;
      if (
        !/^[A-Za-z][A-Za-z0-9_]*$/.test(key) ||
        !['string', 'number', 'boolean'].includes(typeof value) ||
        (typeof value === 'number' && !Number.isFinite(value)) ||
        String(value).length > 250
      ) {
        throw new ErpApiError(`El filtro ${key} no es válido.`, {
          status: 400,
          code: 'INVALID_FILTER',
        });
      }
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

function serverMessage(data, fallback) {
  const message = data?.message;
  if (typeof message === 'string' && message.trim()) {
    return message.trim().slice(0, 350);
  }
  if (Array.isArray(message)) {
    const combined = message.filter((item) => typeof item === 'string').join(', ');
    if (combined.trim()) return combined.trim().slice(0, 350);
  }
  return fallback;
}

function defaultHttpMessage(status) {
  if (status === 400) return 'Revisa los datos enviados.';
  if (status === 401) return 'Debes iniciar sesión nuevamente.';
  if (status === 403) return 'No tienes permiso para realizar esta operación.';
  if (status === 404) return 'No se encontró el recurso solicitado.';
  if (status === 409) return 'La operación entra en conflicto con otros registros.';
  if (status === 415) return 'El servidor no acepta el formato enviado.';
  if (status === 422) return 'Los datos no cumplen las reglas del sistema.';
  if (status === 429) return 'Demasiadas solicitudes. Intenta más tarde.';
  if (status >= 500) return 'El servidor no pudo completar la operación.';
  return 'No se pudo completar la solicitud.';
}

/**
 * Realiza peticiones autenticadas exclusivamente a /api/erp/... del backend.
 * OPTIONS: method, body (objeto JSON), params (filtros), signal, timeoutMs.
 * Devuelve la respuesta JSON tal como la envia el backend; 204 devuelve null.
 */
export async function erpRequest(
  path,
  { method = 'GET', body, params, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = {},
) {
  const normalizedMethod = String(method).toUpperCase();
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(normalizedMethod)) {
    throw new ErpApiError('Método HTTP no permitido.', { status: 400, code: 'INVALID_METHOD' });
  }
  if (body !== undefined && (normalizedMethod === 'GET' || !isRecord(body))) {
    throw new ErpApiError('El cuerpo de la solicitud debe ser un objeto JSON.', {
      status: 400,
      code: 'INVALID_BODY',
    });
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new ErpApiError('El tiempo de espera indicado no es válido.', {
      status: 400,
      code: 'INVALID_TIMEOUT',
    });
  }

  const url = buildErpUrl(path, params);
  const token = requireSessionToken();

  if (signal?.aborted) {
    throw new ErpApiError('Solicitud cancelada.', { code: 'REQUEST_CANCELLED' });
  }

  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  if (signal) signal.addEventListener('abort', forwardAbort, { once: true });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const headers = {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    };
    const requestOptions = {
      method: normalizedMethod,
      headers,
      cache: 'no-store',
      credentials: 'omit',
      signal: controller.signal,
    };

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      try {
        requestOptions.body = JSON.stringify(body);
        if (requestOptions.body === undefined) throw new Error('JSON inválido');
      } catch {
        throw new ErpApiError('No se pudieron preparar los datos para enviar.', {
          status: 400,
          code: 'INVALID_JSON',
        });
      }
    }

    const response = await fetch(url, requestOptions);
    let data = null;

    if (response.status !== 204) {
      const text = await response.text();
      if (text.trim()) {
        try {
          data = JSON.parse(text);
        } catch {
          if (response.ok) {
            throw new ErpApiError('El servidor devolvió una respuesta no válida.', {
              status: 502,
              code: 'INVALID_RESPONSE',
            });
          }
        }
      }
    }

    if (response.status === 401) {
      clearErpSession();
      throw new ErpApiError('Tu sesión ya no es válida. Inicia sesión nuevamente.', {
        status: 401,
        code: 'UNAUTHORIZED',
      });
    }

    if (!response.ok) {
      const fallback = defaultHttpMessage(response.status);
      // No mostrar detalles internos del servidor en errores 5xx.
      const message = response.status >= 500 ? fallback : serverMessage(data, fallback);
      throw new ErpApiError(message, {
        status: response.status,
        code: response.status === 403 ? 'FORBIDDEN' : 'HTTP_ERROR',
        details: response.status < 500 && isRecord(data) ? data : null,
      });
    }

    return data;
  } catch (error) {
    if (error instanceof ErpApiError) throw error;
    if (error?.name === 'AbortError' || controller.signal.aborted) {
      throw new ErpApiError(
        timedOut ? 'La solicitud tardó demasiado. Intenta nuevamente.' : 'Solicitud cancelada.',
        { code: timedOut ? 'TIMEOUT' : 'REQUEST_CANCELLED' },
      );
    }
    if (error instanceof TypeError) {
      throw new ErpApiError('No se pudo conectar con el servidor del gimnasio.', {
        code: 'NETWORK_ERROR',
      });
    }
    throw new ErpApiError('Ocurrió un error inesperado al consultar el ERP.', {
      code: 'UNEXPECTED_ERROR',
    });
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', forwardAbort);
  }
}

function requiredPaymentId(id) {
  const parsed = validId(id);
  if (!parsed) {
    throw new ErpApiError('El identificador del pago no es válido.', {
      status: 400,
      code: 'INVALID_PAYMENT_ID',
    });
  }
  return parsed;
}

// Rutas existentes del backend: backend/routes/erp-payments.routes.js.
export function listErpPaymentMethods(options = {}) {
  return erpRequest('/api/erp/payments/methods', options);
}

export function listErpPayments(filters = {}, options = {}) {
  return erpRequest('/api/erp/payments', { ...options, params: filters });
}

export function getErpPaymentById(id, options = {}) {
  return erpRequest(`/api/erp/payments/${requiredPaymentId(id)}`, options);
}

export function registerErpPayment(paymentData, options = {}) {
  return erpRequest('/api/erp/payments', {
    ...options,
    method: 'POST',
    body: paymentData,
  });
}

export function cancelErpPayment(id, cancellationData, options = {}) {
  return erpRequest(`/api/erp/payments/${requiredPaymentId(id)}/cancel`, {
    ...options,
    method: 'POST',
    body: cancellationData,
  });
}

const erpApi = {
  request: erpRequest,
  listPaymentMethods: listErpPaymentMethods,
  listPayments: listErpPayments,
  getPaymentById: getErpPaymentById,
  registerPayment: registerErpPayment,
  cancelPayment: cancelErpPayment,
  clearSession: clearErpSession,
};

export default erpApi;
