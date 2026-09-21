const express = require('express');
const {createAuthController} = require('../controllers/auth.controller');
module.exports = (db, verify) => {
  const router = express.Router();
  router.post('/login', createAuthController(db, verify).login);
  return router;
};
