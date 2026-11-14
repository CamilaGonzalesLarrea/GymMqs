
'use strict';

// Gimnasio MQS - ERP / Finanzas - Rutas de caja.
// Montar en backend/app.js: app.use('/api/erp/cash', createErpCashRoutes(db));
// Requiere express.json() antes del montaje y el manejador de errores despues.
// Todas las rutas pasan primero por autenticacion JWT + verificacion de usuario
// y rol activos. El servicio comprueba de nuevo los permisos en MySQL.

const express = require('express');
const ErpCashService = require('../services/erp-cash.service');
const createErpCashController = require('../controllers/erp-cash.controller');
const { createErpAuthMiddleware } = require('../middlewares/erp-auth.middleware');

function requireJson(req, res, next) {
  // Solo las solicitudes que escriben registros deben enviar JSON.
  // Se acepta application/json con parametros como charset=utf-8.
  const header = req.headers['content-type'];
  const type = typeof header === 'string'
    ? header.split(';', 1)[0].trim().toLowerCase()
    : '';

  if (type !== 'application/json') {
    return res.status(415).json({
      message: 'Debes enviar Content-Type: application/json',
      statusCode: 415,
    });
  }

  // express.json() y el controlador comprueban la sintaxis y el cuerpo.
  return next();
}

function createErpCashRoutes(db) {
  // No aceptar conexiones simuladas o sin capacidad transaccional para caja.
  // ErpCashService exige query() y getConnection() del pool mysql2/promise.
  const service = new ErpCashService(db);
  const controller = createErpCashController(service);
  const requireErpAuth = createErpAuthMiddleware(db);
  const router = express.Router();

  // Nunca permitir cachear respuestas que contienen informacion financiera.
  router.use((req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    res.set('Pragma', 'no-cache');
    res.set('X-Content-Type-Options', 'nosniff');
    res.vary('Authorization');
    next();
  });

  // Proteccion obligatoria para TODAS las operaciones de caja.
  // Nunca agregar endpoints protegidos antes de esta linea.
  router.use(requireErpAuth);

  // Gastos y otros ingresos: solo el servicio autoriza FI_CASH_MANAGE.
  router.post('/entries', requireJson, controller.createFinancialEntry);
  router.get('/entries', controller.listFinancialEntries);
  router.get('/entries/:id', controller.getFinancialEntryById);

  // Consulta de movimientos generados por pagos, reversiones y registros.
  router.get('/movements', controller.listCashMovements);
  router.get('/movements/:id', controller.getCashMovementById);

  // Resumen del dia de Bolivia o de ?business_date=AAAA-MM-DD.
  router.get('/summary', controller.getDailySummary);

  // Cierre irreversible de jornada: el servicio valida caja y permisos.
  router.post('/closures', requireJson, controller.closeCash);
  router.get('/closures', controller.listCashClosures);
  router.get('/closures/:date', controller.getClosureByDate);

  // Reportes financieros por rango ?from=AAAA-MM-DD&to=AAAA-MM-DD.
  router.get('/reports', controller.getFinancialReport);

  return router;
}

module.exports = createErpCashRoutes;
