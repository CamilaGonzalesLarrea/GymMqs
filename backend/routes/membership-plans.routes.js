
'use strict';

// Gimnasio MQS - Operaciones / Planes de membresía.
// Administrador: consultar, crear, editar y cambiar estados.
// Recepción: consultar planes. JWT y rol verificados en MySQL.

const express = require('express');
const createPlansController = require('../controllers/membership-plans.controller');
const { validate, parseId } = require('../validators/operations');
const { BadRequestException } = require('../middlewares/errors');
const MAX_ID = 2147483647;

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

  // El flujo original no exige sesión ni JWT para consultar ni modificar planes.
  router.get('/', c.findAll);

  router.post('/', requireJson, validate('plans'), c.create);

  router.patch('/:id', parseId, requireValidPlanId, requireJson, validate('plans', true), c.update);

  router.patch('/:id/status', parseId, requireValidPlanId, requireJson, validate('status'), c.changeStatus);

  return router;
}

module.exports = createMembershipPlansRoutes;
