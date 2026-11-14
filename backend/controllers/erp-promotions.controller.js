
'use strict';

// Gimnasio MQS - ERP / Marketing y Ventas - Controlador de promociones.
// Compatible con backend/services/erp-promotions.service.js.
//
// IMPORTANTE: todas las rutas deben usar primero
// createErpAuthMiddleware(db) para verificar el JWT y el usuario.
//
// El servicio valida nuevamente los permisos MV_* en MySQL.
// Los cobros se siguen realizando exclusivamente desde Finanzas / Pagos.

const {
  HttpError,
  BadRequestException,
} = require('../middlewares/errors');

const MAX_MYSQL_ID = 2147483647;
const MAX_FILTER_LENGTH = 250;

const REQUIRED_METHODS = Object.freeze([
  'listPromotions',
  'getPromotionById',
  'createPromotion',
  'updatePromotion',
  'changePromotionStatus',
  'quoteMembershipDiscount',
  'applyPromotion',
  'listPromotionApplications',
]);

const PROMOTION_FILTERS = Object.freeze([
  'page',
  'limit',
  'id_plan',
  'status',
  'search',
  'valid_today',
]);

const APPLICATION_FILTERS = Object.freeze([
  'id_promotion',
  'id_membership',
  'page',
  'limit',
]);

// Comprobar que los datos sean objetos JSON simples.
function isRecord(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);

  return (
    prototype === Object.prototype ||
    prototype === null
  );
}

// Validar identificadores MySQL.
function positiveId(value, label) {
  const raw =
    typeof value === 'number' && Number.isSafeInteger(value)
      ? String(value)
      : typeof value === 'string'
        ? value
        : '';

  if (!/^[1-9]\d*$/.test(raw)) {
    throw new BadRequestException(
      `${label} debe ser un entero positivo`
    );
  }

  const parsed = Number(raw);

  if (
    !Number.isSafeInteger(parsed) ||
    parsed > MAX_MYSQL_ID
  ) {
    throw new BadRequestException(
      `${label} esta fuera de rango`
    );
  }

  return parsed;
}

// Obtener el usuario autenticado.
// Nunca recibir el ID del usuario desde el body o los parámetros.
function authenticatedActorId(req) {
  if (
    !isRecord(req.auth) ||
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

// Validar el ID de una promoción enviado en la ruta.
function promotionId(req) {
  return positiveId(
    req.params?.id,
    'El identificador de la promocion'
  );
}

// Validar que el cuerpo de la solicitud sea JSON.
function jsonBody(req) {
  if (!isRecord(req.body)) {
    throw new BadRequestException(
      'El cuerpo debe ser un objeto JSON'
    );
  }

  // El servicio comprueba los campos, precios y reglas de negocio.
  return req.body;
}

// Comprobar los filtros permitidos de las consultas.
function parseFilters(req, allowed) {
  const query =
    req.query === undefined ? {} : req.query;

  if (!isRecord(query)) {
    throw new BadRequestException(
      'Los filtros de busqueda son incorrectos'
    );
  }

  const output = Object.create(null);

  for (const [key, value] of Object.entries(query)) {
    if (!allowed.includes(key)) {
      throw new BadRequestException(
        `Filtro no permitido: ${key}`
      );
    }

    if (
      typeof value !== 'string' ||
      value.length > MAX_FILTER_LENGTH
    ) {
      throw new BadRequestException(
        `El filtro ${key} debe tener un unico valor de texto`
      );
    }

    output[key] = value;
  }

  return output;
}

// Evitar almacenar en caché información comercial.
function noCache(res) {
  res.set('Cache-Control', 'private, no-store');
  res.set('Pragma', 'no-cache');
  res.set('X-Content-Type-Options', 'nosniff');
  res.vary('Authorization');
}

// Delegar errores al manejador centralizado del backend.
function handle(action) {
  return (req, res, next) => {
    noCache(res);

    return Promise.resolve()
      .then(() => action(req, res))
      .catch(next);
  };
}

// Crear el controlador con el servicio existente.
function createErpPromotionsController(service) {
  if (!service || typeof service !== 'object') {
    throw new TypeError(
      'Se requiere una instancia del servicio ERP de promociones'
    );
  }

  // Comprobar que el servicio tenga todas las operaciones.
  for (const method of REQUIRED_METHODS) {
    if (typeof service[method] !== 'function') {
      throw new TypeError(
        `El servicio ERP de promociones no implementa ${method}()`
      );
    }
  }

  return {
    // GET /api/erp/promotions
    // Consultar promociones con filtros y paginación.
    listPromotions: handle(async (req, res) => {
      const actorId = authenticatedActorId(req);
      const filters = parseFilters(
        req,
        PROMOTION_FILTERS
      );

      const result = await service.listPromotions(
        filters,
        actorId
      );

      return res.status(200).json(result);
    }),

    // GET /api/erp/promotions/:id
    // Consultar una promoción específica.
    getPromotionById: handle(async (req, res) => {
      const actorId = authenticatedActorId(req);
      const id = promotionId(req);

      parseFilters(req, []);

      const result = await service.getPromotionById(
        id,
        actorId
      );

      return res.status(200).json(result);
    }),

    // POST /api/erp/promotions
    // Crear una nueva promoción.
    createPromotion: handle(async (req, res) => {
      const actorId = authenticatedActorId(req);
      const input = jsonBody(req);

      const result = await service.createPromotion(
        input,
        actorId
      );

      return res.status(201).json(result);
    }),

    // PATCH /api/erp/promotions/:id
    // Editar una promoción que todavía no fue aplicada.
    updatePromotion: handle(async (req, res) => {
      const actorId = authenticatedActorId(req);
      const id = promotionId(req);
      const input = jsonBody(req);

      const result = await service.updatePromotion(
        id,
        input,
        actorId
      );

      return res.status(200).json(result);
    }),

    // PATCH /api/erp/promotions/:id/status
    // Activar o desactivar una promoción.
    changePromotionStatus: handle(async (req, res) => {
      const actorId = authenticatedActorId(req);
      const id = promotionId(req);
      const input = jsonBody(req);

      const result = await service.changePromotionStatus(
        id,
        input,
        actorId
      );

      return res.status(200).json(result);
    }),

    // POST /api/erp/promotions/quote
    // Calcular un descuento sin modificar la membresía.
    quoteMembershipDiscount: handle(async (req, res) => {
      const actorId = authenticatedActorId(req);
      const input = jsonBody(req);

      const result = await service.quoteMembershipDiscount(
        input,
        actorId
      );

      return res.status(200).json(result);
    }),

    // POST /api/erp/promotions/apply
    // Aplicar una promoción a una membresía pendiente.
    // El servicio realiza las verificaciones y la transacción.
    applyPromotion: handle(async (req, res) => {
      const actorId = authenticatedActorId(req);
      const input = jsonBody(req);

      const result = await service.applyPromotion(
        input,
        actorId
      );

      return res.status(201).json(result);
    }),

    // GET /api/erp/promotions/applications
    // Consultar el historial de promociones aplicadas.
    listPromotionApplications: handle(async (req, res) => {
      const actorId = authenticatedActorId(req);
      const filters = parseFilters(
        req,
        APPLICATION_FILTERS
      );

      const result = await service.listPromotionApplications(
        filters,
        actorId
      );

      return res.status(200).json(result);
    }),
  };
}

module.exports = createErpPromotionsController;
