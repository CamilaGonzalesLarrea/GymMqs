
'use strict';

// Gimnasio MQS - ERP / Marketing y Ventas.
// Rutas de alertas, clientes inactivos, seguimientos, renovaciones y reportes.
// Montaje en app.js:
//   app.use('/api/erp/marketing', require('./routes/erp-marketing.routes')(db));
// IMPORTANTE: express.json() debe estar configurado antes del montaje.
// La autenticación se aplica a TODAS las rutas; el servicio valida permisos MV_*.
// Las renovaciones y seguimientos NO registran pagos ni modifican Caja.

const express = require('express');
const ErpMarketingService = require('../services/erp-marketing.service');
const createErpMarketingController = require('../controllers/erp-marketing.controller');
const { createErpAuthMiddleware } = require('../middlewares/erp-auth.middleware');

// Solo las rutas que reciben datos exigen JSON (también admite charset=utf-8).
// La validación de campos, estados y fechas se hace en el servicio.
function requireJson(req, res, next) {
  const contentType = req.headers['content-type'];
  const mediaType = typeof contentType === 'string'
    ? contentType.split(';', 1)[0].trim().toLowerCase()
    : '';

  if (mediaType !== 'application/json') {
    return res.status(415).json({
      message: 'Debes enviar Content-Type: application/json',
      statusCode: 415,
    });
  }

  return next();
}

function createErpMarketingRoutes(db) {
  const router = express.Router();

  // Datos de clientes y seguimientos: no deben almacenarse en caché.
  router.use((req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    res.set('Pragma', 'no-cache');
    res.set('X-Content-Type-Options', 'nosniff');
    res.vary('Authorization');
    return next();
  });

  // Fallar de forma segura si no se proporciona el pool transaccional.
  // Nunca dejar abiertas las rutas ante un error de configuración.
  if (!db || typeof db.query !== 'function' || typeof db.getConnection !== 'function') {
    router.use((req, res) => res.status(503).json({
      message: 'El módulo de Marketing requiere una conexión MySQL transaccional',
      statusCode: 503,
    }));
    return router;
  }

  const service = new ErpMarketingService(db);
  const controller = createErpMarketingController(service);

  // Identidad validada mediante JWT y usuario/rol activos en MySQL.
  // La autorización específica (MV_VIEW, MV_FOLLOWUPS_WRITE,
  // MV_REPORTS_READ) se vuelve a comprobar dentro de cada método del servicio.
  router.use(createErpAuthMiddleware(db));

  // Alertas de vencimiento, membresías vencidas y baja asistencia.
  router.get('/alerts', controller.listAlerts);
  router.post('/alerts/generate', controller.generateAlerts); // Sin body obligatorio.
  router.patch('/alerts/:id/resolve', requireJson, controller.resolveAlert);

  // Clientes con membresía activa que llevan días sin asistir.
  router.get('/inactive-customers', controller.listInactiveCustomers);

  // Seguimientos comerciales: registros de contactos y próximas acciones.
  router.get('/followups', controller.listFollowups);
  router.get('/followups/:id', controller.getFollowupById);
  router.post('/followups', requireJson, controller.createFollowup);
  router.patch('/followups/:id', requireJson, controller.updateFollowup);

  // Solicitudes comerciales de renovación: no crean otra membresía ni cobran.
  router.get('/renewals', controller.listRenewalRequests);
  router.post('/renewals', requireJson, controller.createRenewalRequest);
  router.patch('/renewals/:id/close', requireJson, controller.rejectRenewalRequest);

  // Indicadores comerciales basados en pagos registrados, sin modificar datos.
  router.get('/reports/commercial', controller.getCommercialReport);

  return router;
}

module.exports = createErpMarketingRoutes;
