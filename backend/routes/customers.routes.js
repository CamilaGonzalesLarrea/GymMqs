
'use strict';

// Gimnasio MQS - Operaciones / Clientes.
// Mantiene los endpoints originales y exige JWT y rol activo en MySQL.
// app.js debe montar este router con (service, db).

const express = require('express');
const createCustomersController = require('../controllers/customers.controller');
const { validate, parseId } = require('../validators/operations');
const { BadRequestException } = require('../middlewares/errors');
const { createErpAuthMiddleware } = require('../middlewares/erp-auth.middleware');

const MAX_ID = 2147483647;
const OPERATIONS_ROLES = new Set([
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

function requireCustomerRole(req, res, next) {
  if (
    req.auth?.verified !== true ||
    !OPERATIONS_ROLES.has(normalizeRole(req.auth.role))
  ) {
    return res.status(403).json({
      message: 'No tienes permiso para gestionar clientes',
      statusCode: 403,
    });
  }
  return next();
}

function requireJson(req, res, next) {
  // Acepta application/json y application/json; charset=utf-8.
  if (!req.is('application/json')) {
    return res.status(415).json({
      message: 'Debes enviar Content-Type: application/json',
      statusCode: 415,
    });
  }
  return next();
}

function requireValidCustomerId(req, res, next) {
  // parseId comprueba la forma numérica, pero no limita a IDs positivos.
  if (
    !Number.isSafeInteger(req.recordId) ||
    req.recordId < 1 ||
    req.recordId > MAX_ID
  ) {
    return next(new BadRequestException('El identificador del cliente no es válido'));
  }
  return next();
}

function createCustomerRoutes(service, db) {
  const router = express.Router();
  const controller = createCustomersController(service);

  // Evita que navegadores o intermediarios guarden datos personales.
  router.use((req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    res.set('Pragma', 'no-cache');
    res.set('X-Content-Type-Options', 'nosniff');
    res.vary('Authorization');
    return next();
  });

  // Nunca habilitar rutas sin autenticación si falta la conexión.
  if (!db || typeof db.query !== 'function') {
    router.use((req, res) => res.status(503).json({
      message: 'El módulo de clientes requiere MySQL para validar la sesión. Revisa app.js.',
      statusCode: 503,
    }));
    return router;
  }

  // Verifica firma JWT, expiración, usuario y rol activos en MySQL.
  router.use(createErpAuthMiddleware(db));
  router.use(requireCustomerRole);

  // Se mantienen rutas, métodos, validadores y respuestas del proyecto.
  router.get('/', controller.findAll);
  router.post('/', requireJson, validate('customers'), controller.create);
  router.patch(
    '/:id',
    parseId,
    requireValidCustomerId,
    requireJson,
    validate('customers', true),
    controller.update,
  );
  router.patch(
    '/:id/status',
    parseId,
    requireValidCustomerId,
    requireJson,
    validate('status'),
    controller.changeStatus,
  );

  return router;
}

module.exports = createCustomerRoutes;
