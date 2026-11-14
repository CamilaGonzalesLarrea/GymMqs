
'use strict';

// Gimnasio MQS - Operaciones / Asistencias de clientes.
// Se conservan los endpoints originales GET / y POST /.
// El backend comprueba la firma JWT, el estado del usuario y su rol en MySQL.
// El servicio existente valida cliente activo, membresía vigente y duplicados.

const express = require('express');
const createAttendancesController = require('../controllers/customer-attendances.controller');
const { validate } = require('../validators/operations');
const { createErpAuthMiddleware } = require('../middlewares/erp-auth.middleware');

const ALLOWED_ROLES = new Set([
  'administrador',
  'admin',
  'recepcionista',
  'recepcion',
]);

function normalizeRole(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function requireOperationsRole(req, res, next) {
  if (
    req.auth?.verified !== true ||
    !ALLOWED_ROLES.has(normalizeRole(req.auth.role))
  ) {
    return res.status(403).json({
      message: 'No tienes permiso para consultar o registrar asistencias',
      statusCode: 403,
    });
  }

  return next();
}

function requireJson(req, res, next) {
  // Express reconoce también application/json; charset=utf-8.
  // El validador existente revisa que el body sea un objeto JSON y
  // que id_customer sea un entero positivo válido.
  if (!req.is('application/json')) {
    return res.status(415).json({
      message: 'Debes enviar Content-Type: application/json',
      statusCode: 415,
    });
  }

  return next();
}

function createCustomerAttendancesRoutes(service, db) {
  const router = express.Router();
  const controller = createAttendancesController(service);

  // Evitar caché de información personal y registros de asistencia.
  router.use((req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    res.set('Pragma', 'no-cache');
    res.set('X-Content-Type-Options', 'nosniff');
    res.vary('Authorization');
    return next();
  });

  // No habilitar rutas sin autenticación si falta db en app.js.
  if (!db || typeof db.query !== 'function') {
    router.use((req, res) => res.status(503).json({
      message: 'El módulo de asistencias requiere la conexión MySQL para validar la sesión. Revisa app.js.',
      statusCode: 503,
    }));

    return router;
  }

  // El middleware valida el token y consulta usuario/rol activos en MySQL.
  router.use(createErpAuthMiddleware(db));
  router.use(requireOperationsRole);

  // Consultar asistencias: Administrador y Recepción.
  router.get('/', controller.findAll);

  // Registrar asistencia: Administrador y Recepción.
  // El servicio realiza las reglas de negocio (no se duplican aquí).
  router.post('/', requireJson, validate('attendance'), controller.create);

  return router;
}

module.exports = createCustomerAttendancesRoutes;
