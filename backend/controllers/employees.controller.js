const db = require("../database");


exports.getEmployees = (req, res) => {

    const sql = `
        SELECT
            e.id_employee,
            e.id_position,
            e.first_name,
            e.last_name,
            e.phone,
            e.email,
            e.hire_date,
            e.status,
            p.name AS position_name
        FROM employees e
        LEFT JOIN positions p
            ON e.id_position = p.id_position
        ORDER BY e.id_employee DESC
    `;


    db.query(sql, (error, results) => {

        if (error) {

            console.log("Error al obtener empleados:", error);

            return res.status(500).json({
                message: "Error al obtener empleados"
            });

        }


        res.status(200).json(results);

    });

};


exports.getPositions = (req, res) => {

    const sql = `
        SELECT
            id_position,
            name,
            description
        FROM positions
        WHERE status = 'ACTIVE'
        ORDER BY name ASC
    `;


    db.query(sql, (error, results) => {

        if (error) {

            console.log("Error al obtener cargos:", error);

            return res.status(500).json({
                message: "Error al obtener cargos"
            });

        }


        res.status(200).json(results);

    });

};



exports.createEmployee = (req, res) => {

    const {
        id_position,
        first_name,
        last_name,
        phone,
        email,
        hire_date,
        status
    } = req.body;


    if (
        !id_position ||
        !first_name ||
        !last_name ||
        !hire_date
    ) {

        return res.status(400).json({
            message: "Complete los campos obligatorios"
        });

    }


    const sql = `
        INSERT INTO employees
        (
            id_position,
            first_name,
            last_name,
            phone,
            email,
            hire_date,
            status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `;


    const values = [
        id_position,
        first_name,
        last_name,
        phone || null,
        email || null,
        hire_date,
        status || "ACTIVE"
    ];


    db.query(sql, values, (error, result) => {

        if (error) {

            console.log("Error al crear empleado:", error);

            return res.status(500).json({
                message: "Error al registrar empleado"
            });

        }


        res.status(201).json({

            message: "Empleado registrado correctamente",

            id_employee: result.insertId

        });

    });

};