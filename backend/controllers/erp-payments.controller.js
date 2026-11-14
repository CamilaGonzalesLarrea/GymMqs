'use strict';

// Gimnasio MQS - ERP / Finanzas
// Controlador HTTP para los pagos del ERP.
// Compatible con Express 5 y con backend/services/erp-payments.service.js.
//
// SEGURIDAD: todas las rutas deben ejecutar ANTES un middleware que compruebe
// una sesión/token válido y establezca en el servidor:
//   req.auth = { verified: true, id_user: <entero positivo> };
// El controlador NO acepta la identidad desde body, query, params o cabeceras.
// La autorización por permisos se vuelve a comprobar en el servicio y en BD.
//
// Contrato previsto para las rutas (se integrarán por separado):
// GET    /api/erp/payments/methods    -> listPaymentMethods
// GET    /api/erp/payments            -> listPayments
// GET    /api/erp/payments/:id        -> getPaymentById
// POST   /api/erp/payments            -> registerPayment
// POST   /api/erp/payments/:id/cancel -> cancelPayment

const {
  HttpError,
  BadRequestException,
} = require('../middlewares/errors');

const MAX_MYSQL_ID = 2147483647;
const REQUIRED_SERVICE_METHODS = [
  'registerPayment',
  'cancelPayment',
  'getPaymentById',
  'listPayments',
  'listPaymentMethods',
];

function isRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireAuthenticatedUser(req) {
  // req.auth debe proceder ÚNICAMENTE del middleware de autenticación.
  const auth = req.auth;
  if (!isRecord(auth) || auth.verified !== true) {
    throw new HttpError(401, 'Debes iniciar sesión para continuar');
  }

  const raw = auth.id_user;
  const text = typeof raw === 'number' && Number.isSafeInteger(raw)
    ? String(raw)
    : typeof raw === 'string' ? raw : '';

  if (!/^[1-9]\d*$/.test(text)) {
    throw new HttpError(401, 'La sesión no tiene un usuario válido');
  }

  const id = Number(text);
  if (!Number.isSafeInteger(id) || id > MAX_MYSQL_ID) {
    throw new HttpError(401, 'La sesión no tiene un usuario válido');
  }

  return id;
}

function requirePaymentId(req) {
  const raw = req.params?.id;
  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw)) {
    throw new BadRequestException('El identificador del pago debe ser un entero positivo');
  }

  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id > MAX_MYSQL_ID) {
    throw new BadRequestException('El identificador del pago está fuera de rango');
  }

  return id;
}

function requireJsonObject(req) {
  if (!isRecord(req.body)) {
    throw new BadRequestException('El cuerpo debe ser un objeto JSON');
  }
  return req.body;
}

function requireQuery(req) {
  const query = req.query === undefined ? {} : req.query;
  if (!isRecord(query)) {
    throw new BadRequestException('Los filtros de búsqueda son incorrectos');
  }

  // Express entrega parámetros de URL como texto. Rechazar arrays u objetos
  // evita parámetros repetidos y consultas anidadas ambiguas.
  for (const [key, value] of Object.entries(query)) {
    if (typeof value !== 'string') {
      throw new BadRequestException(`El filtro ${key} debe tener un solo valor`);
    }
  }

  // El servicio comprueba nombres, rangos, estados, fechas y paginación.
  return query;
}

function noStore(res) {
  // Los pagos y sus datos personales no deben quedar cacheados por el navegador.
  res.set('Cache-Control', 'no-store');
  return res;
}

function handle(handler) {
  return (req, res, next) =>
    Promise.resolve()
      .then(() => handler(req, res))
      .catch(next);
}

module.exports = function createErpPaymentsController(service) {
  if (!service || typeof service !== 'object') {
    throw new TypeError('Debe proporcionarse una instancia del servicio ERP de pagos');
  }
  for (const method of REQUIRED_SERVICE_METHODS) {
    if (typeof service[method] !== 'function') {
      throw new TypeError(`El servicio ERP de pagos no implementa ${method}()`);
    }
  }

  return {
    // POST /api/erp/payments
    // El servicio valida membresía pendiente, precio exacto, método activo,
    // usuario, permisos, superposiciones y caja abierta; usa transacción.
    registerPayment: handle(async (req, res) => {
      const actorId = requireAuthenticatedUser(req);
      const data = requireJsonObject(req);
      const payment = await service.registerPayment(data, actorId);
      return noStore(res).status(201).json(payment);
    }),

    // POST /api/erp/payments/:id/cancel
    // Requiere motivo, confirmación de devolución y permisos administrativos.
    cancelPayment: handle(async (req, res) => {
      const actorId = requireAuthenticatedUser(req);
      const paymentId = requirePaymentId(req);
      const data = requireJsonObject(req);
      const result = await service.cancelPayment(paymentId, data, actorId);
      return noStore(res).status(200).json(result);
    }),

    // GET /api/erp/payments/:id
    getPaymentById: handle(async (req, res) => {
      const actorId = requireAuthenticatedUser(req);
      const paymentId = requirePaymentId(req);
      const payment = await service.getPaymentById(paymentId, actorId);
      return noStore(res).status(200).json(payment);
    }),

    // GET /api/erp/payments?page=1&limit=20&status=REGISTERED...
    listPayments: handle(async (req, res) => {
      const actorId = requireAuthenticatedUser(req);
      const query = requireQuery(req);
      const result = await service.listPayments(query, actorId);
      return noStore(res).status(200).json(result);
    }),

    // GET /api/erp/payments/methods
    listPaymentMethods: handle(async (req, res) => {
      const actorId = requireAuthenticatedUser(req);
      const methods = await service.listPaymentMethods(actorId);
      return noStore(res).status(200).json(methods);
    }),
  };
};
