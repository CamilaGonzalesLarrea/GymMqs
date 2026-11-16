'use strict';

const express = require('express');
const ErpDirectionService = require('../services/erp-direction.service');
const createErpDirectionController = require('../controllers/erp-direction.controller');
const { createErpAuthMiddleware } = require('../middlewares/erp-auth.middleware');

const ALLOWED_ROLES = new Set(['administrador', 'admin', 'director', 'direccion']);

function normalizeRole(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

function createErpDirectionRoutes(db) {
  const service = new ErpDirectionService(db);
  const controller = createErpDirectionController(service);
  const router = express.Router();

  router.use((req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    res.set('Pragma', 'no-cache');
    res.set('X-Content-Type-Options', 'nosniff');
    res.vary('Authorization');
    next();
  });

  router.use(createErpAuthMiddleware(db));

  router.use((req, res, next) => {
    if (
      req.auth?.verified !== true ||
      !ALLOWED_ROLES.has(normalizeRole(req.auth.role))
    ) {
      return res.status(403).json({
        message: 'Solo Administrador y Director pueden consultar este panel.',
        statusCode: 403,
      });
    }
    return next();
  });

  router.get('/customers', controller.listCustomers);
  router.get('/customers/:id/memberships', controller.getCustomerMemberships);
  router.get('/customers/:id', controller.getCustomer);
  router.get('/membership-plans', controller.listMembershipPlans);
  router.get('/memberships/expiring', controller.listExpiringMemberships);
  router.get('/renewals', controller.listRenewals);
  router.get('/dashboard', controller.getDashboard);
  return router;
}

module.exports = createErpDirectionRoutes;
