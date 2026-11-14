
'use strict';

// Gimnasio MQS - ERP / Marketing y Ventas - Rutas de Promociones.
// Montaje previsto en app.js:
//   app.use('/api/erp/promotions', require('./routes/erp-promotions.routes')(db));
// Requiere express.json() antes de registrar estas rutas.
// JWT obligatorio en todas las operaciones; el servicio comprueba los permisos
// MV_VIEW, MV_PROMOTIONS_MANAGE, MV_FOLLOWUPS_WRITE y MV_REPORTS_READ en MySQL.
// Solo apply modifica el precio de una membresia pendiente: nunca registra pagos.

const express = require('express');
const ErpPromotionsService = require('../services/erp-promotions.service');
const createErpPromotionsController = require('../controllers/erp-promotions.controller');
const { createErpAuthMiddleware } = require('../middlewares/erp-auth.middleware');

// Exigir JSON para operaciones que reciben datos. Acepta charset=utf-8.
function requireJson(req, res, next) {
  const header = req.headers['content-type'];
  const mediaType = typeof header === 'string'
    ? header.split(';', 1)[0].trim().toLowerCase()
    : '';

  if (mediaType !== 'application/json') {
    return res.status(415).json({
      message: 'Debes enviar Content-Type: application/json',
      statusCode: 415,
    });
  }

  return next();
}

function createErpPromotionsRoutes(db) {
  const router = express.Router();

  // No permitir cachear promociones privadas ni resultados por usuario.
  router.use((req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    res.set('Pragma', 'no-cache');
    res.set('X-Content-Type-Options', 'nosniff');
    res.vary('Authorization');
    return next();
  });

  // Si el servidor no dispone de MySQL transaccional, fallar de forma segura.
  // No habilitar nunca estas rutas sin la verificacion de identidad/permisos.
  if (!db || typeof db.query !== 'function' || typeof db.getConnection !== 'function') {
    router.use((req, res) => res.status(503).json({
      message: 'El modulo de promociones requiere una conexion MySQL transaccional',
      statusCode: 503,
    }));
    return router;
  }

  const service = new ErpPromotionsService(db);
  const controller = createErpPromotionsController(service);

  // Verificar JWT, cuenta activa y rol activo ANTES de todas las rutas.
  router.use(createErpAuthMiddleware(db));

  // Consultas: declaramos las rutas fijas antes de la ruta dinamica /:id.
  router.get('/applications', controller.listPromotionApplications);
  router.get('/', controller.listPromotions);
  router.get('/:id', controller.getPromotionById);

  // Cotizar: calcula el descuento sin modificar ningun registro.
  router.post('/quote', requireJson, controller.quoteMembershipDiscount);

  // Aplicar: solo membresias PENDING sin pagos y en transaccion MySQL.
  router.post('/apply', requireJson, controller.applyPromotion);

  // Administrar promociones: el servicio exige permiso MV_PROMOTIONS_MANAGE.
  router.post('/', requireJson, controller.createPromotion);
  router.patch('/:id/status', requireJson, controller.changePromotionStatus);
  router.patch('/:id', requireJson, controller.updatePromotion);

  return router;
}

module.exports = createErpPromotionsRoutes;
