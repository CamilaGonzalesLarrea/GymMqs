const express = require('express');
const controller = require('../controllers/customer-attendances.controller');
const {validate,parseId} = require('../validators/operations');
module.exports = service => {
  const router = express.Router(); const c = controller(service);
  router.get('/', c.findAll);
  router.post('/', validate('attendance'), c.create);
  return router;
};
