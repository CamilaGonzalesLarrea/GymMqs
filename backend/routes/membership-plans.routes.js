const express = require('express');
const controller = require('../controllers/membership-plans.controller');
const {validate,parseId} = require('../validators/operations');
module.exports = service => {
  const router = express.Router(); const c = controller(service);
  router.get('/', c.findAll);
  router.post('/', validate('plans'), c.create);
  router.patch('/:id', parseId, validate('plans', true), c.update);
  router.patch('/:id/status', parseId, validate('status'), c.changeStatus);
  return router;
};
