
'use strict';

// Gimnasio MQS - ERP / Finanzas - Controlador HTTP de caja.
// Compatible con Express 5 y backend/services/erp-cash.service.js.
//
// IMPORTANTE: todas estas rutas DEBEN estar detrás de
// createErpAuthMiddleware(db). Este middleware verifica el JWT y la BD
// y asigna req.auth = { verified: true, id_user: <entero positivo>, ... }.
// Los permisos FI_CASH_READ, FI_CASH_MANAGE y FI_REPORTS_READ se vuelven
// a validar en la base de datos dentro del servicio.
//
// Contrato para el archivo de rutas que se creará después:
// POST /api/erp/cash/entries            -> createFinancialEntry
// GET  /api/erp/cash/entries            -> listFinancialEntries
// GET  /api/erp/cash/entries/:id        -> getFinancialEntryById
// GET  /api/erp/cash/movements          -> listCashMovements
// GET  /api/erp/cash/movements/:id      -> getCashMovementById
// GET  /api/erp/cash/summary            -> getDailySummary
// POST /api/erp/cash/closures           -> closeCash
// GET  /api/erp/cash/closures           -> listCashClosures
// GET  /api/erp/cash/closures/:date     -> getClosureByDate
// GET  /api/erp/cash/reports            -> getFinancialReport

const {
  HttpError,
  BadRequestException,
} = require('../middlewares/errors');

const MAX_MYSQL_ID = 2147483647;

const REQUIRED_METHODS = Object.freeze([
  'createFinancialEntry',
  'getFinancialEntryById',
  'listFinancialEntries',
  'getCashMovementById',
  'listCashMovements',
  'getDailySummary',
  'closeCash',
  'listCashClosures',
  'getClosureByDate',
  'getFinancialReport',
]);

const ENTRY_FILTERS = Object.freeze([
  'page',
  'limit',
  'entry_type',
  'category',
  'id_payment_method',
  'from',
  'to',
]);

const MOVEMENT_FILTERS = Object.freeze([
  'page',
  'limit',
  'from',
  'to',
  'business_date',
  'movement_kind',
  'id_payment_method',
  'is_cash',
]);

const CLOSURE_FILTERS = Object.freeze([
  'page',
  'limit',
  'from',
  'to',
]);

const REPORT_FILTERS = Object.freeze([
  'from',
  'to',
]);

function isPlainObject(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    return false;
  }

  const proto = Object.getPrototypeOf(value);

  return (
    proto === Object.prototype ||
    proto === null
  );
}

function authenticatedUserId(req) {
  // Nunca tomar la identidad del usuario desde el cliente.
  // req.auth procede del middleware JWT del backend.
  const auth = req.auth;

  if (
    !isPlainObject(auth) ||
    auth.verified !== true
  ) {
    throw new HttpError(
      401,
      'Debes iniciar sesión para continuar'
    );
  }

  const raw = auth.id_user;

  const text =
    typeof raw === 'number' &&
    Number.isSafeInteger(raw)
      ? String(raw)
      : typeof raw === 'string'
        ? raw
        : '';

  if (!/^[1-9]\d*$/.test(text)) {
    throw new HttpError(
      401,
      'La sesión no contiene un usuario válido'
    );
  }

  const userId = Number(text);

  if (
    !Number.isSafeInteger(userId) ||
    userId > MAX_MYSQL_ID
  ) {
    throw new HttpError(
      401,
      'La sesión no contiene un usuario válido'
    );
  }

  return userId;
}

function requiredId(req, name = 'id') {
  const raw = req.params?.[name];

  if (
    typeof raw !== 'string' ||
    !/^[1-9]\d*$/.test(raw)
  ) {
    throw new BadRequestException(
      'El identificador debe ser un entero positivo'
    );
  }

  const result = Number(raw);

  if (
    !Number.isSafeInteger(result) ||
    result > MAX_MYSQL_ID
  ) {
    throw new BadRequestException(
      'El identificador está fuera de rango'
    );
  }

  return result;
}

function requiredDate(req, name = 'date') {
  const value = req.params?.[name];

  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    throw new BadRequestException(
      'La fecha debe tener formato AAAA-MM-DD'
    );
  }

  const parsed = new Date(
    `${value}T00:00:00.000Z`
  );

  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new BadRequestException(
      'La fecha indicada no es válida'
    );
  }

  return value;
}

function jsonBody(req) {
  if (!isPlainObject(req.body)) {
    throw new BadRequestException(
      'El cuerpo de la solicitud debe ser un objeto JSON'
    );
  }

  // El servicio valida los campos, montos y reglas de negocio.
  return req.body;
}

function filters(req, allowedKeys) {
  const query =
    req.query === undefined
      ? {}
      : req.query;

  if (!isPlainObject(query)) {
    throw new BadRequestException(
      'Los filtros de búsqueda son incorrectos'
    );
  }

  const clean = Object.create(null);

  for (const [key, value] of Object.entries(query)) {
    if (!allowedKeys.includes(key)) {
      throw new BadRequestException(
        `Filtro no permitido: ${key}`
      );
    }

    // No aceptar arrays, objetos ni parámetros repetidos.
    if (
      typeof value !== 'string' ||
      value.length > 250
    ) {
      throw new BadRequestException(
        `El filtro ${key} debe tener un único valor de texto`
      );
    }

    clean[key] = value;
  }

  return clean;
}

function noCache(res) {
  res.set('Cache-Control', 'private, no-store');
  res.set('Pragma', 'no-cache');
}

function handle(action) {
  // Los errores se envían al manejador centralizado de Express.
  return (req, res, next) => {
    noCache(res);

    return Promise.resolve()
      .then(() => action(req, res))
      .catch(next);
  };
}

function createErpCashController(service) {
  if (
    !service ||
    typeof service !== 'object'
  ) {
    throw new TypeError(
      'Se requiere una instancia del servicio de caja ERP'
    );
  }

  for (const name of REQUIRED_METHODS) {
    if (typeof service[name] !== 'function') {
      throw new TypeError(
        `El servicio de caja no implementa ${name}()`
      );
    }
  }

  return {
    // POST /api/erp/cash/entries
    createFinancialEntry: handle(async (req, res) => {
      const actorId = authenticatedUserId(req);
      const data = jsonBody(req);

      const created =
        await service.createFinancialEntry(
          data,
          actorId
        );

      return res.status(201).json(created);
    }),

    // GET /api/erp/cash/entries/:id
    getFinancialEntryById: handle(async (req, res) => {
      const actorId = authenticatedUserId(req);
      const entryId = requiredId(req);

      filters(req, []);

      const entry =
        await service.getFinancialEntryById(
          entryId,
          actorId
        );

      return res.status(200).json(entry);
    }),

    // GET /api/erp/cash/entries
    listFinancialEntries: handle(async (req, res) => {
      const actorId = authenticatedUserId(req);
      const query = filters(req, ENTRY_FILTERS);

      const result =
        await service.listFinancialEntries(
          query,
          actorId
        );

      return res.status(200).json(result);
    }),

    // GET /api/erp/cash/movements/:id
    getCashMovementById: handle(async (req, res) => {
      const actorId = authenticatedUserId(req);
      const movementId = requiredId(req);

      filters(req, []);

      const movement =
        await service.getCashMovementById(
          movementId,
          actorId
        );

      return res.status(200).json(movement);
    }),

    // GET /api/erp/cash/movements
    listCashMovements: handle(async (req, res) => {
      const actorId = authenticatedUserId(req);
      const query = filters(req, MOVEMENT_FILTERS);

      const result =
        await service.listCashMovements(
          query,
          actorId
        );

      return res.status(200).json(result);
    }),

    // GET /api/erp/cash/summary
    getDailySummary: handle(async (req, res) => {
      const actorId = authenticatedUserId(req);

      const query = filters(req, [
        'business_date',
      ]);

      const result =
        await service.getDailySummary(
          query.business_date,
          actorId
        );

      return res.status(200).json(result);
    }),

    // POST /api/erp/cash/closures
    closeCash: handle(async (req, res) => {
      const actorId = authenticatedUserId(req);
      const data = jsonBody(req);

      const result =
        await service.closeCash(
          data,
          actorId
        );

      return res.status(201).json(result);
    }),

    // GET /api/erp/cash/closures
    listCashClosures: handle(async (req, res) => {
      const actorId = authenticatedUserId(req);
      const query = filters(req, CLOSURE_FILTERS);

      const result =
        await service.listCashClosures(
          query,
          actorId
        );

      return res.status(200).json(result);
    }),

    // GET /api/erp/cash/closures/:date
    getClosureByDate: handle(async (req, res) => {
      const actorId = authenticatedUserId(req);
      const businessDate = requiredDate(req);

      filters(req, []);

      const result =
        await service.getClosureByDate(
          businessDate,
          actorId
        );

      return res.status(200).json(result);
    }),

    // GET /api/erp/cash/reports
    getFinancialReport: handle(async (req, res) => {
      const actorId = authenticatedUserId(req);
      const query = filters(req, REPORT_FILTERS);

      const result =
        await service.getFinancialReport(
          query,
          actorId
        );

      return res.status(200).json(result);
    }),
  };
}

module.exports = createErpCashController;
