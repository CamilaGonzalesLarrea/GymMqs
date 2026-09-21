const express = require('express');
const controller = require('../controllers/memberships.controller');
const {validate,parseId} = require('../validators/operations');
module.exports = service => {
  const router = express.Router(); const c = controller(service);
  router.get('/', c.findAll);
  router.post('/', validate('memberships'), c.create);
  router.post('/:id/renew', parseId, validate('renew'), c.renew);
  router.patch('/:id/activate', parseId, c.activate);
  return router;
};
