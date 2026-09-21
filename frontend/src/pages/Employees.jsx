import { useEffect, useState } from "react";

import Sidebar from "../components/Sidebar";

import "./Employees.css";


function Employees() {


    // =================================================
    // ESTADOS
    // =================================================

    const [employees, setEmployees] = useState([]);

    const [positions, setPositions] = useState([]);

    const [loading, setLoading] = useState(true);

    const [error, setError] = useState("");

    const [search, setSearch] = useState("");

    const [showForm, setShowForm] = useState(false);


    const [form, setForm] = useState({

        first_name: "",
        last_name: "",
        phone: "",
        email: "",
        id_position: "",
        hire_date: "",
        status: "ACTIVE"

    });


    // =================================================
    // CARGAR DATOS AL ABRIR LA PÁGINA
    // =================================================

    useEffect(() => {

        loadEmployees();

        loadPositions();

    }, []);


    // =================================================
    // OBTENER EMPLEADOS
    // =================================================

    const loadEmployees = async () => {

        try {

            setLoading(true);

            const response = await fetch(
                "http://localhost:3000/api/employees"
            );


            const data = await response.json();


            if (!response.ok) {

                throw new Error(
                    data.message ||
                    "Error al obtener empleados"
                );

            }


            setEmployees(data);

            setError("");


        } catch (error) {

            console.log(error);

            setError(
                "No se pudieron cargar los empleados"
            );


        } finally {

            setLoading(false);

        }

    };


    // =================================================
    // OBTENER CARGOS
    // =================================================

    const loadPositions = async () => {

        try {

            const response = await fetch(
                "http://localhost:3000/api/employees/positions"
            );


            const data = await response.json();


            if (!response.ok) {

                throw new Error(
                    data.message ||
                    "Error al obtener cargos"
                );

            }


            setPositions(data);


        } catch (error) {

            console.log(error);

        }

    };


    // =================================================
    // CAMBIAR FORMULARIO
    // =================================================

    const handleChange = (event) => {

        const {
            name,
            value
        } = event.target;


        setForm({

            ...form,

            [name]: value

        });

    };


    // =================================================
    // GUARDAR EMPLEADO
    // =================================================

    const handleSubmit = async (event) => {

        event.preventDefault();


        try {

            const response = await fetch(
                "http://localhost:3000/api/employees",
                {

                    method: "POST",

                    headers: {
                        "Content-Type": "application/json"
                    },

                    body: JSON.stringify(form)

                }
            );


            const data = await response.json();


            if (!response.ok) {

                alert(
                    data.message ||
                    "No se pudo registrar el empleado"
                );

                return;

            }


            alert(
                "Empleado registrado correctamente"
            );


            setForm({

                first_name: "",
                last_name: "",
                phone: "",
                email: "",
                id_position: "",
                hire_date: "",
                status: "ACTIVE"

            });


            setShowForm(false);


            loadEmployees();


        } catch (error) {

            console.log(error);

            alert(
                "No se pudo conectar con el servidor"
            );

        }

    };


    // =================================================
    // FILTRAR EMPLEADOS
    // =================================================

    const filteredEmployees = employees.filter(
        (employee) => {

            const fullName = (
                employee.first_name +
                " " +
                employee.last_name
            ).toLowerCase();


            const position = (
                employee.position_name || ""
            ).toLowerCase();


            const searchText =
                search.toLowerCase();


            return (
                fullName.includes(searchText) ||
                position.includes(searchText)
            );

        }
    );


    // =================================================
    // INTERFAZ
    // =================================================

    return (

        <div className="employees-page">


            <Sidebar />


            <main className="employees-content">


                {/* HEADER */}

                <header className="employees-header">

                    <div>

                        <span>
                            RECURSOS HUMANOS
                        </span>


                        <h1>
                            Empleados
                        </h1>


                        <p>
                            Gestiona el personal registrado en el gimnasio
                        </p>

                    </div>


                    <button
                        className="new-employee-button"
                        onClick={() => setShowForm(true)}
                    >
                        + Nuevo empleado
                    </button>

                </header>


                {/* TABLA */}

                <section className="employees-panel">


                    <div className="employees-toolbar">


                        <div>

                            <h2>
                                Personal registrado
                            </h2>


                            <p>
                                {employees.length} empleados registrados
                            </p>

                        </div>


                        <input

                            type="text"

                            placeholder="Buscar empleado..."

                            className="search-input"

                            value={search}

                            onChange={(event) =>
                                setSearch(
                                    event.target.value
                                )
                            }

                        />

                    </div>


                    {loading && (

                        <div className="table-message">

                            Cargando empleados...

                        </div>

                    )}


                    {error && !loading && (

                        <div className="table-error">

                            {error}

                        </div>

                    )}


                    {!loading && !error && (

                        <div className="table-container">


                            <table>


                                <thead>

                                    <tr>

                                        <th>
                                            Empleado
                                        </th>

                                        <th>
                                            Cargo
                                        </th>

                                        <th>
                                            Teléfono
                                        </th>

                                        <th>
                                            Fecha ingreso
                                        </th>

                                        <th>
                                            Estado
                                        </th>

                                        <th>
                                            Acción
                                        </th>

                                    </tr>

                                </thead>


                                <tbody>


                                    {filteredEmployees.length === 0 ? (

                                        <tr>

                                            <td
                                                colSpan="6"
                                                className="empty-table"
                                            >
                                                No se encontraron empleados
                                            </td>

                                        </tr>

                                    ) : (

                                        filteredEmployees.map(
                                            (employee) => (

                                                <tr
                                                    key={
                                                        employee.id_employee
                                                    }
                                                >


                                                    <td>

                                                        <div className="employee-name">


                                                            <div className="employee-avatar">

                                                                {employee.first_name
                                                                    ?.charAt(0)
                                                                    .toUpperCase()
                                                                }

                                                            </div>


                                                            <div>

                                                                <strong>

                                                                    {
                                                                        employee.first_name
                                                                    }{" "}

                                                                    {
                                                                        employee.last_name
                                                                    }

                                                                </strong>


                                                                <span>

                                                                    {
                                                                        employee.email ||
                                                                        "Sin correo"
                                                                    }

                                                                </span>

                                                            </div>


                                                        </div>

                                                    </td>


                                                    <td>

                                                        {
                                                            employee.position_name ||
                                                            "Sin cargo"
                                                        }

                                                    </td>


                                                    <td>

                                                        {
                                                            employee.phone ||
                                                            "Sin teléfono"
                                                        }

                                                    </td>


                                                    <td>

                                                        {
                                                            employee.hire_date
                                                                ? new Date(
                                                                    employee.hire_date
                                                                ).toLocaleDateString(
                                                                    "es-BO"
                                                                )
                                                                : "-"
                                                        }

                                                    </td>


                                                    <td>

                                                        <span
                                                            className={
                                                                employee.status ===
                                                                "ACTIVE"
                                                                    ? "status active"
                                                                    : "status inactive"
                                                            }
                                                        >

                                                            {
                                                                employee.status ===
                                                                "ACTIVE"
                                                                    ? "Activo"
                                                                    : "Inactivo"
                                                            }

                                                        </span>

                                                    </td>


                                                    <td>

                                                        <button
                                                            className="action-button"
                                                        >
                                                            Ver
                                                        </button>

                                                    </td>


                                                </tr>

                                            )
                                        )

                                    )}


                                </tbody>


                            </table>


                        </div>

                    )}


                </section>


            </main>


            {/* MODAL */}

            {showForm && (

                <div className="modal-background">


                    <div className="employee-modal">


                        <div className="modal-header">


                            <div>

                                <span>
                                    RECURSOS HUMANOS
                                </span>


                                <h2>
                                    Nuevo empleado
                                </h2>

                            </div>


                            <button
                                className="close-button"
                                onClick={() =>
                                    setShowForm(false)
                                }
                            >
                                ×
                            </button>

                        </div>


                        <form
                            onSubmit={handleSubmit}
                        >


                            <div className="form-grid">


                                <div className="form-group">

                                    <label>
                                        Nombre
                                    </label>


                                    <input

                                        type="text"

                                        name="first_name"

                                        value={
                                            form.first_name
                                        }

                                        onChange={
                                            handleChange
                                        }

                                        required

                                    />

                                </div>


                                <div className="form-group">

                                    <label>
                                        Apellido
                                    </label>


                                    <input

                                        type="text"

                                        name="last_name"

                                        value={
                                            form.last_name
                                        }

                                        onChange={
                                            handleChange
                                        }

                                        required

                                    />

                                </div>


                                <div className="form-group">

                                    <label>
                                        Teléfono
                                    </label>


                                    <input

                                        type="text"

                                        name="phone"

                                        value={
                                            form.phone
                                        }

                                        onChange={
                                            handleChange
                                        }

                                    />

                                </div>


                                <div className="form-group">

                                    <label>
                                        Correo electrónico
                                    </label>


                                    <input

                                        type="email"

                                        name="email"

                                        value={
                                            form.email
                                        }

                                        onChange={
                                            handleChange
                                        }

                                    />

                                </div>


                                <div className="form-group">

                                    <label>
                                        Cargo
                                    </label>


                                    <select

                                        name="id_position"

                                        value={
                                            form.id_position
                                        }

                                        onChange={
                                            handleChange
                                        }

                                        required

                                    >

                                        <option value="">
                                            Seleccionar cargo
                                        </option>


                                        {positions.map(
                                            (position) => (

                                                <option
                                                    key={
                                                        position.id_position
                                                    }
                                                    value={
                                                        position.id_position
                                                    }
                                                >

                                                    {
                                                        position.name
                                                    }

                                                </option>

                                            )
                                        )}

                                    </select>

                                </div>


                                <div className="form-group">

                                    <label>
                                        Fecha de ingreso
                                    </label>


                                    <input

                                        type="date"

                                        name="hire_date"

                                        value={
                                            form.hire_date
                                        }

                                        onChange={
                                            handleChange
                                        }

                                        required

                                    />

                                </div>


                                <div className="form-group">

                                    <label>
                                        Estado
                                    </label>


                                    <select

                                        name="status"

                                        value={
                                            form.status
                                        }

                                        onChange={
                                            handleChange
                                        }

                                    >

                                        <option value="ACTIVE">
                                            Activo
                                        </option>


                                        <option value="INACTIVE">
                                            Inactivo
                                        </option>

                                    </select>

                                </div>


                            </div>


                            <div className="modal-actions">


                                <button

                                    type="button"

                                    className="cancel-button"

                                    onClick={() =>
                                        setShowForm(false)
                                    }

                                >
                                    Cancelar

                                </button>


                                <button

                                    type="submit"

                                    className="save-button"

                                >
                                    Guardar empleado

                                </button>


                            </div>


                        </form>


                    </div>


                </div>

            )}


        </div>

    );

}


export default Employees;