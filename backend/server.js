const express = require("express");
const cors = require("cors");

require("dotenv").config();

const app = express();

// MIDDLEWARE

app.use(cors());

app.use(express.json());

// RUTAS

const authRoutes = require("./routes/auth.routes");

const employeesRoutes = require("./routes/employees.routes");


app.use(
    "/api/auth",
    authRoutes
);


app.use(
    "/api/employees",
    employeesRoutes
);


// SERVIDOR
app.listen(3000, () => {

    console.log(
        "Servidor corriendo en puerto 3000"
    );

});