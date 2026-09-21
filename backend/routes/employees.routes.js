const express = require("express");

const router = express.Router();


const {
    getEmployees,
    getPositions,
    createEmployee
} = require("../controllers/employees.controller");


// Obtener empleados

router.get(
    "/",
    getEmployees
);


// Obtener cargos

router.get(
    "/positions",
    getPositions
);


// Crear empleado

router.post(
    "/",
    createEmployee
);


module.exports = router;