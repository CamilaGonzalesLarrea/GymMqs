
'use strict';

// Gimnasio MQS - Operaciones / Planes de membresía.
// Administrador: consultar, crear, editar y cambiar estados.
// Recepción: consultar planes. JWT y rol verificados en MySQL.

const express = require('express');
const createPlansController = require('../controllers/membership-plans.controller');
const { validate, parseId } = require('../validators/operations');
const { BadRequestException } = require('../middlewares/errors');
const { createErpAuthMiddleware } = require('../middlewares/erp-auth.middleware');

const ADMIN_ROLES = new Set(['administrador', 'admin']);
const RECEPTION_ROLES = new Set(['recepcionista', 'recepcion']);
const MAX_ID = 2147483647;

function normalizeRole(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function isAdmin(req) {
  return req.auth?.verified === true &&
    ADMIN_ROLES.has(normalizeRole(req.auth.role));
}

function requirePlanViewer(req, res, next) {
  const role = normalizeRole(req.auth?.role);

  if (
    req.auth?.verified !== true ||
    (!ADMIN_ROLES.has(role) && !RECEPTION_ROLES.has(role))
  ) {
    return res.status(403).json({
      message: 'No tienes permiso para consultar planes de membresía',
      statusCode: 403,
    });
  }

  return next();
}

function requirePlanAdmin(req, res, next) {
  if (!isAdmin(req)) {
    return res.status(403).json({
      message: 'Solo Administración puede crear o modificar planes',
      statusCode: 403,
    });
  }

  return next();
}

function requireJson(req, res, next) {
  if (!req.is('application/json')) {
    return res.status(415).json({
      message: 'Debes enviar Content-Type: application/json',
      statusCode: 415,
    });
  }

  return next();
}

function requireValidPlanId(req, res, next) {
  // El parseador heredado acepta números negativos y cero.
  if (
    !Number.isSafeInteger(req.recordId) ||
    req.recordId < 1 ||
    req.recordId > MAX_ID
  ) {
    return next(
      new BadRequestException('El identificador del plan no es válido')
    );
  }

  return next();
}

function createMembershipPlansRoutes(service, db) {
  const router = express.Router();
  const c = createPlansController(service);

  router.use((req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    res.set('Pragma', 'no-cache');
    res.set('X-Content-Type-Options', 'nosniff');
    res.vary('Authorization');
    return next();
  });

  // Si app.js no proporciona db, no habilitar rutas sin seguridad.
  if (!db || typeof db.query !== 'function') {
    router.use((req, res) => res.status(503).json({
      message: 'El módulo de planes requiere la conexión MySQL para validar la sesión. Revisa app.js.',
      statusCode: 503,
    }));

    return router;
  }

  // Verifica JWT, usuario activo y rol activo en la base de datos.
  router.use(createErpAuthMiddleware(db));

  // Administrador y Recepción pueden consultar.
  router.get(
    '/',
    requirePlanViewer,
    c.findAll
  );

  // Solo Administración puede crear planes.
  router.post(
    '/',
    requirePlanAdmin,
    requireJson,
    validate('plans'),
    c.create
  );

  // Solo Administración puede editar planes.
  router.patch(
    '/:id',
    requirePlanAdmin,
    parseId,
    requireValidPlanId,
    requireJson,
    validate('plans', true),
    c.update
  );

  // Solo Administración puede activar o desactivar planes.
  router.patch(
    '/:id/status',
    requirePlanAdmin,
    parseId,
    requireValidPlanId,
    requireJson,
    validate('status'),
    c.changeStatus
  );

  return router;
}

module.exports = createMembershipPlansRoutes;
