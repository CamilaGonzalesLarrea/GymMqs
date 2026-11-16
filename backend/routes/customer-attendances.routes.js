
'use strict';

// Gimnasio MQS - Operaciones / Asistencias de clientes.
// Se conservan los endpoints originales GET / y POST /.
// El backend comprueba la firma JWT, el estado del usuario y su rol en MySQL.
// El servicio existente valida cliente activo, membresía vigente y duplicados.

const express = require('express');
const createAttendancesController = require('../controllers/customer-attendances.controller');
const { validate } = require('../validators/operations');

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

  // El flujo original no exige sesión ni JWT para consultar o registrar asistencias.
  router.get('/', controller.findAll);

  // Registrar asistencia: Administrador y Recepción.
  // El servicio realiza las reglas de negocio (no se duplican aquí).
  router.post('/', requireJson, validate('attendance'), controller.create);

  return router;
}

module.exports = createCustomerAttendancesRoutes;
