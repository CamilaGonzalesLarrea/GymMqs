
'use strict';

// Gimnasio MQS - ERP / Finanzas
// Rutas HTTP de pagos. Montar en app.js en /api/erp/payments.
// Todas las operaciones requieren un JWT verificado y un usuario activo.
// Los permisos concretos se vuelven a comprobar dentro del servicio.

const express = require('express');
const ErpPaymentsService = require('../services/erp-payments.service');
const createErpPaymentsController = require('../controllers/erp-payments.controller');
const { createErpAuthMiddleware } = require('../middlewares/erp-auth.middleware');

function requireJson(req, res, next) {
  // express.json() del app debe ejecutarse antes de montar este router.
  // Solo se aceptan cuerpos JSON en operaciones que modifican registros.
  const header = req.headers['content-type'];
  const mediaType = typeof header === 'string'
    ? header.split(';', 1)[0].trim().toLowerCase()
    : '';

  if (mediaType !== 'application/json') {
    res.set('Cache-Control', 'no-store');
    return res.status(415).json({
      message: 'Debes enviar Content-Type: application/json',
      statusCode: 415,
    });
  }

  return next();
}

function createErpPaymentsRoutes(db) {
  // db es el pool mysql2 en modo promise que recibe createApp(db).
  // Los constructores fallan al iniciar si hay dependencias incorrectas.
  const service = new ErpPaymentsService(db);
  const controller = createErpPaymentsController(service);
  const requireErpAuth = createErpAuthMiddleware(db);
  const router = express.Router();

  // Impide almacenar respuestas con información financiera en caché.
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  // Nunca definir operaciones de pagos fuera de este middleware.
  router.use(requireErpAuth);

  // ¡Importante! La ruta fija /methods va antes de la dinámica /:id.
  router.get('/methods', controller.listPaymentMethods);
  router.get('/', controller.listPayments);
  router.get('/:id', controller.getPaymentById);

  // El controlador valida los parámetros y el servicio aplica las reglas
  // de negocio, permisos, concurrencia, auditoría y transacciones MySQL.
  router.post('/', requireJson, controller.registerPayment);
  router.post('/:id/cancel', requireJson, controller.cancelPayment);

  return router;
}

module.exports = createErpPaymentsRoutes;
