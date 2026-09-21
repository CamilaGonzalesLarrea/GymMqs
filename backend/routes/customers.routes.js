const express = require('express');
const controller = require('../controllers/customers.controller');
const {validate,parseId} = require('../validators/operations');
module.exports = service => {
  const router = express.Router(); const c = controller(service);
  router.get('/', c.findAll);
  router.post('/', validate('customers'), c.create);
  router.patch('/:id', parseId, validate('customers', true), c.update);
  router.patch('/:id/status', parseId, validate('status'), c.changeStatus);
  return router;
};
