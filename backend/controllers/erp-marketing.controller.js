
'use strict';

// Gimnasio MQS - ERP / Marketing y Ventas.
// Controlador HTTP de alertas, inactividad, seguimiento, renovaciones y reportes.
// Requiere que las rutas apliquen createErpAuthMiddleware(db) ANTES de usarlo.
// El servicio valida los permisos MV_* y las reglas de negocio en MySQL.
// Este archivo no ejecuta SQL ni modifica pagos, membresias o caja directamente.

const { HttpError, BadRequestException } = require('../middlewares/errors');

const MAX_ID = 2147483647;
const MAX_FILTER_LENGTH = 250;

// Nombres exactos del servicio backend/services/erp-marketing.service.js.
const REQUIRED_METHODS = Object.freeze([
  'generateAlerts',
  'listAlerts',
  'resolveAlert',
  'listInactiveCustomers',
  'listFollowups',
  'getFollowupById',
  'createFollowup',
  'updateFollowup',
  'createRenewalRequest',
  'listRenewalRequests',
  'rejectRenewalRequest',
  'getCommercialReport',
]);

const ALERT_FILTERS = Object.freeze([
  'page', 'limit', 'status', 'alert_type', 'id_customer', 'id_plan',
]);

const INACTIVE_FILTERS = Object.freeze([
  'page', 'limit', 'id_plan', 'min_days',
]);

const FOLLOWUP_FILTERS = Object.freeze([
  'page', 'limit', 'id_customer', 'reason', 'result',
  'responsible_user', 'due_only',
]);

const RENEWAL_FILTERS = Object.freeze([
  'page', 'limit', 'status', 'id_customer',
]);

const REPORT_FILTERS = Object.freeze(['from', 'to']);

function isPlainObject(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
}

function positiveId(value, label) {
  const raw = typeof value === 'number' && Number.isSafeInteger(value)
    ? String(value)
    : typeof value === 'string' ? value : '';

  // Prohibe decimales, ceros iniciales, notacion cientifica, signos y espacios.
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new BadRequestException(
      `${label} debe ser un entero positivo`
    );
  }

  const id = Number(raw);

  if (!Number.isSafeInteger(id) || id > MAX_ID) {
    throw new BadRequestException(
      `${label} esta fuera de rango`
    );
  }

  return id;
}

function authenticatedActorId(req) {
  // El usuario NUNCA se toma del body, la URL ni los filtros.
  if (
    !isPlainObject(req.auth) ||
    req.auth.verified !== true
  ) {
    throw new HttpError(
      401,
      'Debes iniciar sesion para continuar'
    );
  }

  try {
    return positiveId(
      req.auth.id_user,
      'El usuario autenticado'
    );
  } catch {
    throw new HttpError(
      401,
      'La sesion no contiene un usuario valido'
    );
  }
}

function routeId(req, label) {
  return positiveId(req.params?.id, label);
}

function jsonBody(req) {
  if (!isPlainObject(req.body)) {
    throw new BadRequestException(
      'El cuerpo debe ser un objeto JSON'
    );
  }

  // Los campos concretos, enumeraciones y fechas se validan en el servicio.
  return req.body;
}

function parseFilters(req, permitted) {
  const query = req.query === undefined ? {} : req.query;

  if (!isPlainObject(query)) {
    throw new BadRequestException(
      'Los filtros de busqueda no son validos'
    );
  }

  const filters = Object.create(null);

  for (const [key, value] of Object.entries(query)) {
    if (!permitted.includes(key)) {
      throw new BadRequestException(
        `Filtro no permitido: ${key}`
      );
    }

    // Rechaza filtros duplicados, objetos anidados y valores excesivos.
    if (
      typeof value !== 'string' ||
      value.length > MAX_FILTER_LENGTH
    ) {
      throw new BadRequestException(
        `El filtro ${key} debe tener un solo valor de texto`
      );
    }

    filters[key] = value;
  }

  return filters;
}

function privateResponse(res) {
  res.set('Cache-Control', 'private, no-store');
  res.set('Pragma', 'no-cache');
  res.set('X-Content-Type-Options', 'nosniff');
  res.vary('Authorization');
}

function handle(action) {
  return (req, res, next) => {
    privateResponse(res);

    return Promise.resolve()
      .then(() => action(req, res))
      .catch(next);
  };
}

function createErpMarketingController(service) {
  if (!service || typeof service !== 'object') {
    throw new TypeError(
      'Debes proporcionar una instancia del servicio de Marketing'
    );
  }

  for (const method of REQUIRED_METHODS) {
    if (typeof service[method] !== 'function') {
      throw new TypeError(
        `El servicio de Marketing no implementa ${method}()`
      );
    }
  }

  return {
    // POST /api/erp/marketing/alerts/generate
    generateAlerts: handle(async (req, res) => {
      const actorId = authenticatedActorId(req);

      const result = await service.generateAlerts(actorId);

      return res.status(200).json(result);
    }),

    // GET /api/erp/marketing/alerts
    listAlerts: handle(async (req, res) => {
      const actorId = authenticatedActorId(req);
      const filters = parseFilters(req, ALERT_FILTERS);

      const result = await service.listAlerts(filters, actorId);

      return res.status(200).json(result);
    }),

    // PATCH /api/erp/marketing/alerts/:id/resolve
    resolveAlert: handle(async (req, res) => {
      const actorId = authenticatedActorId(req);
      const id = routeId(
        req,
        'El identificador de la alerta'
      );
      const input = jsonBody(req);

      const result = await service.resolveAlert(
        id,
        input,
        actorId
      );

      return res.status(200).json(result);
    }),

    // GET /api/erp/marketing/inactive-customers
    listInactiveCustomers: handle(async (req, res) => {
      const actorId = authenticatedActorId(req);
      const filters = parseFilters(req, INACTIVE_FILTERS);

      const result = await service.listInactiveCustomers(
        filters,
        actorId
      );

      return res.status(200).json(result);
    }),

    // GET /api/erp/marketing/followups
    listFollowups: handle(async (req, res) => {
      const actorId = authenticatedActorId(req);
      const filters = parseFilters(req, FOLLOWUP_FILTERS);

      const result = await service.listFollowups(
        filters,
        actorId
      );

      return res.status(200).json(result);
    }),

    // GET /api/erp/marketing/followups/:id
    getFollowupById: handle(async (req, res) => {
      const actorId = authenticatedActorId(req);
      const id = routeId(
        req,
        'El identificador del seguimiento'
      );

      parseFilters(req, []);

      const result = await service.getFollowupById(
        id,
        actorId
      );

      return res.status(200).json(result);
    }),

    // POST /api/erp/marketing/followups
    createFollowup: handle(async (req, res) => {
      const actorId = authenticatedActorId(req);
      const input = jsonBody(req);

      const result = await service.createFollowup(
        input,
        actorId
      );

      return res.status(201).json(result);
    }),

    // PATCH /api/erp/marketing/followups/:id
    updateFollowup: handle(async (req, res) => {
      const actorId = authenticatedActorId(req);
      const id = routeId(
        req,
        'El identificador del seguimiento'
      );
      const input = jsonBody(req);

      const result = await service.updateFollowup(
        id,
        input,
        actorId
      );

      return res.status(200).json(result);
    }),

    // POST /api/erp/marketing/renewals
    // Registra una solicitud, sin crear membresias ni cobrar.
    createRenewalRequest: handle(async (req, res) => {
      const actorId = authenticatedActorId(req);
      const input = jsonBody(req);

      const result = await service.createRenewalRequest(
        input,
        actorId
      );

      return res.status(201).json(result);
    }),

    // GET /api/erp/marketing/renewals
    listRenewalRequests: handle(async (req, res) => {
      const actorId = authenticatedActorId(req);
      const filters = parseFilters(req, RENEWAL_FILTERS);

      const result = await service.listRenewalRequests(
        filters,
        actorId
      );

      return res.status(200).json(result);
    }),

    // PATCH /api/erp/marketing/renewals/:id/close
    // Rechaza o cancela solicitudes sin alterar pagos ni membresias.
    rejectRenewalRequest: handle(async (req, res) => {
      const actorId = authenticatedActorId(req);
      const id = routeId(
        req,
        'El identificador de la solicitud'
      );
      const input = jsonBody(req);

      const result = await service.rejectRenewalRequest(
        id,
        input,
        actorId
      );

      return res.status(200).json(result);
    }),

    // GET /api/erp/marketing/reports/commercial
    getCommercialReport: handle(async (req, res) => {
      const actorId = authenticatedActorId(req);
      const filters = parseFilters(req, REPORT_FILTERS);

      const result = await service.getCommercialReport(
        filters,
        actorId
      );

      return res.status(200).json(result);
    }),
  };
}

module.exports = createErpMarketingController;
