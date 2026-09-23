const express = require("express");

const router = express.Router();


const {
    getEmployees,
    getPositions,
    createEmployee,
    updateEmployee
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


router.put(
    "/:id",
    updateEmployee
);


module.exports = router;