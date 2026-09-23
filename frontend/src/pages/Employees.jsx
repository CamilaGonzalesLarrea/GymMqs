import { useEffect, useState } from "react";

import Sidebar from "../components/Sidebar";

import "./Employees.css";

const API_URL = "http://localhost:3000";

const emptyForm = {
    first_name: "",
    last_name: "",
    phone: "",
    email: "",
    id_position: "",
    hire_date: "",
    status: "ACTIVE",
};

function Employees() {
    const [employees, setEmployees] = useState([]);
    const [positions, setPositions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [search, setSearch] = useState("");
    const [showForm, setShowForm] = useState(false);
    const [selectedEmployee, setSelectedEmployee] = useState(null);
    const [editingEmployee, setEditingEmployee] = useState(null);
    const [form, setForm] = useState(emptyForm);

    useEffect(() => {
        loadEmployees();
        loadPositions();
    }, []);

    const loadEmployees = async () => {
        try {
            setLoading(true);
            const response = await fetch(`${API_URL}/api/employees`);
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || "Error al obtener empleados");
            }

            setEmployees(data);
            setError("");
        } catch (error) {
            console.log(error);
            setError("No se pudieron cargar los empleados");
        } finally {
            setLoading(false);
        }
    };

    const loadPositions = async () => {
        try {
            const response = await fetch(`${API_URL}/api/employees/positions`);
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || "Error al obtener cargos");
            }

            setPositions(data);
        } catch (error) {
            console.log(error);
        }
    };

    const handleChange = (event) => {
        const { name, value } = event.target;
        setForm({ ...form, [name]: value });
    };

    const resetForm = () => {
        setForm(emptyForm);
        setEditingEmployee(null);
        setShowForm(false);
    };

    const openCreateForm = () => {
        setEditingEmployee(null);
        setForm(emptyForm);
        setShowForm(true);
    };

    const openEditForm = (employee) => {
        setEditingEmployee(employee);
        setSelectedEmployee(null);
        setForm({
            first_name: employee.first_name || "",
            last_name: employee.last_name || "",
            phone: employee.phone || "",
            email: employee.email || "",
            id_position: employee.id_position ? String(employee.id_position) : "",
            hire_date: employee.hire_date || "",
            status: employee.status || "ACTIVE",
        });
        setShowForm(true);
    };

    const handleSubmit = async (event) => {
        event.preventDefault();

        try {
            const url = editingEmployee
                ? `${API_URL}/api/employees/${editingEmployee.id_employee}`
                : `${API_URL}/api/employees`;

            const method = editingEmployee ? "PUT" : "POST";

            const response = await fetch(url, {
                method,
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(form),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || "No se pudo guardar el empleado");
            }

            alert(
                editingEmployee
                    ? "Empleado actualizado correctamente"
                    : "Empleado registrado correctamente",
            );

            resetForm();
            await loadEmployees();
        } catch (error) {
            console.log(error);
            alert(error.message || "No se pudo conectar con el servidor");
        }
    };

    const handleDelete = async (employee) => {
        const confirmed = window.confirm(
            `¿Deseas desactivar al empleado ${employee.first_name} ${employee.last_name}?`,
        );

        if (!confirmed) {
            return;
        }

        try {
            const response = await fetch(
                `${API_URL}/api/employees/${employee.id_employee}/status`,
                {
                    method: "PATCH",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ status: "INACTIVE" }),
                },
            );

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || "No se pudo eliminar el empleado");
            }

            alert("Empleado inactivado correctamente");
            await loadEmployees();
            setSelectedEmployee(null);
        } catch (error) {
            console.log(error);
            alert(error.message || "No se pudo eliminar el empleado");
        }
    };

    const filteredEmployees = employees.filter((employee) => {
        const fullName = `${employee.first_name || ""} ${employee.last_name || ""}`.toLowerCase();
        const position = (employee.position_name || "").toLowerCase();
        const searchText = search.toLowerCase();

        return fullName.includes(searchText) || position.includes(searchText);
    });

    return (
        <div className="employees-page">
            <Sidebar />

            <main className="employees-content">
                <header className="employees-header">
                    <div>
                        <span>RECURSOS HUMANOS</span>
                        <h1>Empleados</h1>
                        <p>Gestiona el personal registrado en el gimnasio</p>
                    </div>

                    <button className="new-employee-button" onClick={openCreateForm}>
                        + Nuevo empleado
                    </button>
                </header>

                <section className="employees-panel">
                    <div className="employees-toolbar">
                        <div>
                            <h2>Personal registrado</h2>
                            <p>{employees.length} empleados registrados</p>
                        </div>

                        <input
                            type="text"
                            placeholder="Buscar empleado..."
                            className="search-input"
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                        />
                    </div>

                    {loading && <div className="table-message">Cargando empleados...</div>}

                    {error && !loading && <div className="table-error">{error}</div>}

                    {!loading && !error && (
                        <div className="table-container">
                            <table>
                                <thead>
                                    <tr>
                                        <th>Empleado</th>
                                        <th>Cargo</th>
                                        <th>Teléfono</th>
                                        <th>Fecha ingreso</th>
                                        <th>Estado</th>
                                        <th>Acción</th>
                                    </tr>
                                </thead>

                                <tbody>
                                    {filteredEmployees.length === 0 ? (
                                        <tr>
                                            <td colSpan="6" className="empty-table">
                                                No se encontraron empleados
                                            </td>
                                        </tr>
                                    ) : (
                                        filteredEmployees.map((employee) => (
                                            <tr key={employee.id_employee}>
                                                <td>
                                                    <div className="employee-name">
                                                        <div className="employee-avatar">
                                                            {employee.first_name?.charAt(0).toUpperCase()}
                                                        </div>

                                                        <div>
                                                            <strong>
                                                                {employee.first_name} {employee.last_name}
                                                            </strong>
                                                            <span>{employee.email || "Sin correo"}</span>
                                                        </div>
                                                    </div>
                                                </td>

                                                <td>{employee.position_name || "Sin cargo"}</td>
                                                <td>{employee.phone || "Sin teléfono"}</td>
                                                <td>
                                                    {employee.hire_date
                                                        ? new Date(employee.hire_date).toLocaleDateString("es-BO")
                                                        : "-"}
                                                </td>
                                                <td>
                                                    <span
                                                        className={
                                                            employee.status === "ACTIVE" ? "status active" : "status inactive"
                                                        }
                                                    >
                                                        {employee.status === "ACTIVE" ? "Activo" : "Inactivo"}
                                                    </span>
                                                </td>
                                                <td>
                                                    <button
                                                        type="button"
                                                        className="action-button"
                                                        onClick={() => setSelectedEmployee(employee)}
                                                        style={{ marginRight: "8px" }}
                                                    >
                                                        Ver
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="action-button"
                                                        onClick={() => openEditForm(employee)}
                                                        style={{ marginRight: "8px" }}
                                                    >
                                                        Editar
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="action-button"
                                                        onClick={() => handleDelete(employee)}
                                                    >
                                                        Eliminar
                                                    </button>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}
                </section>
            </main>

            {selectedEmployee && (
                <div className="modal-background" onClick={() => setSelectedEmployee(null)}>
                    <div className="employee-modal" onClick={(event) => event.stopPropagation()}>
                        <div className="modal-header">
                            <div>
                                <span>RECURSOS HUMANOS</span>
                                <h2>
                                    {selectedEmployee.first_name} {selectedEmployee.last_name}
                                </h2>
                            </div>

                            <button className="close-button" onClick={() => setSelectedEmployee(null)}>
                                ×
                            </button>
                        </div>

                        <div className="form-grid">
                            <div className="form-group">
                                <label>Cargo</label>
                                <input value={selectedEmployee.position_name || "Sin cargo"} readOnly />
                            </div>

                            <div className="form-group">
                                <label>Estado</label>
                                <input value={selectedEmployee.status === "ACTIVE" ? "Activo" : "Inactivo"} readOnly />
                            </div>

                            <div className="form-group">
                                <label>Teléfono</label>
                                <input value={selectedEmployee.phone || "Sin teléfono"} readOnly />
                            </div>

                            <div className="form-group">
                                <label>Correo</label>
                                <input value={selectedEmployee.email || "Sin correo"} readOnly />
                            </div>

                            <div className="form-group">
                                <label>Fecha de ingreso</label>
                                <input
                                    value={
                                        selectedEmployee.hire_date
                                            ? new Date(selectedEmployee.hire_date).toLocaleDateString("es-BO")
                                            : "-"
                                    }
                                    readOnly
                                />
                            </div>
                        </div>

                        <div className="modal-actions">
                            <button type="button" className="cancel-button" onClick={() => setSelectedEmployee(null)}>
                                Cerrar
                            </button>
                            <button type="button" className="save-button" onClick={() => openEditForm(selectedEmployee)}>
                                Editar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showForm && (
                <div className="modal-background" onClick={resetForm}>
                    <div className="employee-modal" onClick={(event) => event.stopPropagation()}>
                        <div className="modal-header">
                            <div>
                                <span>RECURSOS HUMANOS</span>
                                <h2>{editingEmployee ? "Editar empleado" : "Nuevo empleado"}</h2>
                            </div>

                            <button className="close-button" onClick={resetForm}>
                                ×
                            </button>
                        </div>

                        <form onSubmit={handleSubmit}>
                            <div className="form-grid">
                                <div className="form-group">
                                    <label>Nombre</label>
                                    <input
                                        type="text"
                                        name="first_name"
                                        value={form.first_name}
                                        onChange={handleChange}
                                        required
                                    />
                                </div>

                                <div className="form-group">
                                    <label>Apellido</label>
                                    <input
                                        type="text"
                                        name="last_name"
                                        value={form.last_name}
                                        onChange={handleChange}
                                        required
                                    />
                                </div>

                                <div className="form-group">
                                    <label>Teléfono</label>
                                    <input type="text" name="phone" value={form.phone} onChange={handleChange} />
                                </div>

                                <div className="form-group">
                                    <label>Correo electrónico</label>
                                    <input type="email" name="email" value={form.email} onChange={handleChange} />
                                </div>

                                <div className="form-group">
                                    <label>Cargo</label>
                                    <select
                                        name="id_position"
                                        value={form.id_position}
                                        onChange={handleChange}
                                        required
                                    >
                                        <option value="">Seleccionar cargo</option>

                                        {positions.map((position) => (
                                            <option key={position.id_position} value={position.id_position}>
                                                {position.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div className="form-group">
                                    <label>Fecha de ingreso</label>
                                    <input
                                        type="date"
                                        name="hire_date"
                                        value={form.hire_date}
                                        onChange={handleChange}
                                        required
                                    />
                                </div>

                                <div className="form-group">
                                    <label>Estado</label>
                                    <select name="status" value={form.status} onChange={handleChange}>
                                        <option value="ACTIVE">Activo</option>
                                        <option value="INACTIVE">Inactivo</option>
                                    </select>
                                </div>
                            </div>

                            <div className="modal-actions">
                                <button type="button" className="cancel-button" onClick={resetForm}>
                                    Cancelar
                                </button>
                                <button type="submit" className="save-button">
                                    {editingEmployee ? "Guardar cambios" : "Guardar empleado"}
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