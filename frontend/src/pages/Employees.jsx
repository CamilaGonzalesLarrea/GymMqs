import { useEffect, useMemo, useState } from "react";

import Sidebar from "../components/Sidebar";
import { API_URL } from "../config/api";

import "./Employees.css";

const createEmptyForm = () => ({
    first_name: "",
    last_name: "",
    phone: "",
    email: "",
    id_position: "",
    hire_date: "",
    status: "ACTIVE",
});

const getLocalDateString = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
};

const formatDate = (value) => {
    if (!value) {
        return "-";
    }

    const normalized = String(value).slice(0, 10);
    const [year, month, day] = normalized.split("-");

    if (!year || !month || !day) {
        return normalized;
    }

    return `${day}/${month}/${year}`;
};

const normalizePhone = (value) =>
    String(value || "").replace(/\D/g, "");

const normalizeEmail = (value) =>
    String(value || "").trim().toLowerCase();

const normalizeName = (value) =>
    String(value || "")
        .trim()
        .replace(/\s+/g, " ");

const getInitials = (employee) => {
    const first = String(employee?.first_name || "").trim();
    const last = String(employee?.last_name || "").trim();

    return `${first.charAt(0)}${last.charAt(0)}`
        .trim()
        .toUpperCase() || "?";
};

const parseResponse = async (response) => {
    const text = await response.text();

    if (!text) {
        return {};
    }

    try {
        return JSON.parse(text);
    } catch {
        return { message: text };
    }
};

const getErrorMessage = (data, fallback) => {
    if (
        data &&
        typeof data === "object" &&
        typeof data.message === "string" &&
        data.message.trim()
    ) {
        return data.message;
    }

    return fallback;
};

const calculateSeniority = (hireDate) => {
    if (!hireDate) {
        return "-";
    }

    const normalized = String(hireDate).slice(0, 10);
    const [year, month, day] = normalized.split("-").map(Number);

    if (!year || !month || !day) {
        return "-";
    }

    const start = new Date(year, month - 1, day);
    const now = new Date();

    if (start > now) {
        return "-";
    }

    let years = now.getFullYear() - start.getFullYear();
    let months = now.getMonth() - start.getMonth();

    if (now.getDate() < start.getDate()) {
        months -= 1;
    }

    if (months < 0) {
        years -= 1;
        months += 12;
    }

    if (years > 0) {
        return `${years} año${years === 1 ? "" : "s"}${
            months > 0
                ? ` ${months} mes${months === 1 ? "" : "es"}`
                : ""
        }`;
    }

    if (months > 0) {
        return `${months} mes${months === 1 ? "" : "es"}`;
    }

    const days = Math.max(
        0,
        Math.floor(
            (now.getTime() - start.getTime()) /
                (1000 * 60 * 60 * 24),
        ),
    );

    return `${days} día${days === 1 ? "" : "s"}`;
};

function Employees() {
    const [employees, setEmployees] = useState([]);
    const [positions, setPositions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [statusChangingId, setStatusChangingId] = useState(null);

    const [error, setError] = useState("");
    const [feedback, setFeedback] = useState("");
    const [formError, setFormError] = useState("");

    const [search, setSearch] = useState("");
    const [filters, setFilters] = useState({
        status: "",
        id_position: "",
    });

    const [showForm, setShowForm] = useState(false);
    const [selectedEmployee, setSelectedEmployee] = useState(null);
    const [editingEmployee, setEditingEmployee] = useState(null);
    const [form, setForm] = useState(createEmptyForm);

    const today = getLocalDateString();

    const requestJson = async (
        url,
        options = {},
        fallbackMessage = "Ocurrió un error",
    ) => {
        const response = await fetch(url, options);
        const data = await parseResponse(response);

        if (!response.ok) {
            throw new Error(
                getErrorMessage(data, fallbackMessage),
            );
        }

        return data;
    };

    const loadData = async () => {
        try {
            setLoading(true);
            setError("");

            const [employeesData, positionsData] =
                await Promise.all([
                    requestJson(
                        `${API_URL}/api/employees`,
                        {},
                        "No se pudieron cargar los empleados",
                    ),
                    requestJson(
                        `${API_URL}/api/positions`,
                        {},
                        "No se pudieron cargar los cargos",
                    ),
                ]);

            setEmployees(
                Array.isArray(employeesData)
                    ? employeesData
                    : [],
            );

            setPositions(
                Array.isArray(positionsData)
                    ? positionsData
                    : [],
            );
        } catch (loadError) {
            console.error(loadError);
            setError(
                loadError.message ||
                    "No se pudo cargar la información de empleados",
            );
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, []);

    useEffect(() => {
        if (!showForm && !selectedEmployee) {
            return undefined;
        }

        const handleEscape = (event) => {
            if (event.key !== "Escape") {
                return;
            }

            if (saving || statusChangingId) {
                return;
            }

            if (showForm) {
                resetForm();
                return;
            }

            setSelectedEmployee(null);
        };

        window.addEventListener("keydown", handleEscape);

        return () => {
            window.removeEventListener(
                "keydown",
                handleEscape,
            );
        };
    }, [
        selectedEmployee,
        showForm,
        saving,
        statusChangingId,
    ]);

    const activePositions = useMemo(
        () =>
            positions.filter(
                (position) =>
                    String(position.status).toUpperCase() ===
                    "ACTIVE",
            ),
        [positions],
    );

    const positionOptions = useMemo(() => {
        if (!editingEmployee) {
            return activePositions;
        }

        const currentPositionId = String(
            form.id_position || "",
        );

        return positions.filter(
            (position) =>
                String(position.status).toUpperCase() ===
                    "ACTIVE" ||
                String(position.id_position) ===
                    currentPositionId,
        );
    }, [
        activePositions,
        editingEmployee,
        form.id_position,
        positions,
    ]);

    const selectedPosition = useMemo(
        () =>
            positions.find(
                (position) =>
                    String(position.id_position) ===
                    String(form.id_position),
            ) || null,
        [form.id_position, positions],
    );

    const filteredEmployees = useMemo(() => {
        const searchText = search
            .trim()
            .toLowerCase();

        return employees
            .filter((employee) => {
                if (
                    filters.status &&
                    String(employee.status).toUpperCase() !==
                        filters.status
                ) {
                    return false;
                }

                if (
                    filters.id_position &&
                    String(employee.id_position) !==
                        String(filters.id_position)
                ) {
                    return false;
                }

                if (!searchText) {
                    return true;
                }

                const values = [
                    employee.first_name,
                    employee.last_name,
                    `${employee.first_name || ""} ${
                        employee.last_name || ""
                    }`,
                    employee.position_name,
                    employee.phone,
                    employee.email,
                    employee.status === "ACTIVE"
                        ? "activo"
                        : "inactivo",
                ];

                return values.some((value) =>
                    String(value || "")
                        .toLowerCase()
                        .includes(searchText),
                );
            })
            .sort((a, b) => {
                const statusA =
                    String(a.status).toUpperCase() === "ACTIVE"
                        ? 0
                        : 1;

                const statusB =
                    String(b.status).toUpperCase() === "ACTIVE"
                        ? 0
                        : 1;

                if (statusA !== statusB) {
                    return statusA - statusB;
                }

                return `${a.first_name || ""} ${
                    a.last_name || ""
                }`.localeCompare(
                    `${b.first_name || ""} ${
                        b.last_name || ""
                    }`,
                    "es",
                );
            });
    }, [employees, filters, search]);

    const summary = useMemo(() => {
        const active = employees.filter(
            (employee) =>
                String(employee.status).toUpperCase() ===
                "ACTIVE",
        ).length;

        const inactive = employees.length - active;

        const activePositionIds = new Set(
            employees
                .filter(
                    (employee) =>
                        String(employee.status).toUpperCase() ===
                        "ACTIVE",
                )
                .map((employee) =>
                    String(employee.id_position || ""),
                )
                .filter(Boolean),
        );

        return {
            total: employees.length,
            active,
            inactive,
            activePositions: activePositionIds.size,
        };
    }, [employees]);

    const resetForm = () => {
        setForm(createEmptyForm());
        setEditingEmployee(null);
        setShowForm(false);
        setFormError("");
    };

    const openCreateForm = () => {
        setSelectedEmployee(null);
        setEditingEmployee(null);
        setForm(createEmptyForm());
        setFormError("");
        setFeedback("");
        setShowForm(true);
    };

    const openEditForm = (employee) => {
        setEditingEmployee(employee);
        setSelectedEmployee(null);
        setFormError("");
        setFeedback("");

        setForm({
            first_name: employee.first_name || "",
            last_name: employee.last_name || "",
            phone: employee.phone || "",
            email: employee.email || "",
            id_position: employee.id_position
                ? String(employee.id_position)
                : "",
            hire_date: employee.hire_date
                ? String(employee.hire_date).slice(0, 10)
                : "",
            status: employee.status || "ACTIVE",
        });

        setShowForm(true);
    };

    const handleChange = (event) => {
        const { name, value } = event.target;

        setFormError("");

        setForm((current) => ({
            ...current,
            [name]: value,
        }));
    };

    const validateForm = () => {
        const firstName = normalizeName(form.first_name);
        const lastName = normalizeName(form.last_name);
        const phone = normalizePhone(form.phone);
        const email = normalizeEmail(form.email);

        if (!firstName) {
            return "El nombre es obligatorio";
        }

        if (!lastName) {
            return "El apellido es obligatorio";
        }

        if (firstName.length > 80) {
            return "El nombre no puede superar 80 caracteres";
        }

        if (lastName.length > 80) {
            return "El apellido no puede superar 80 caracteres";
        }

        if (/\d/.test(firstName)) {
            return "El nombre no debe contener números";
        }

        if (/\d/.test(lastName)) {
            return "El apellido no debe contener números";
        }

        if (form.phone && (phone.length < 7 || phone.length > 15)) {
            return "El teléfono debe contener entre 7 y 15 dígitos";
        }

        if (email) {
            const emailRegex =
                /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;

            if (!emailRegex.test(email)) {
                return "El correo electrónico no tiene un formato válido";
            }
        }

        if (!form.id_position) {
            return "Seleccione un cargo";
        }

        if (!selectedPosition) {
            return "El cargo seleccionado no existe";
        }

        if (
            form.status === "ACTIVE" &&
            String(selectedPosition.status).toUpperCase() !==
                "ACTIVE"
        ) {
            return "No se puede asignar un cargo inactivo a un empleado activo";
        }

        if (!form.hire_date) {
            return "La fecha de ingreso es obligatoria";
        }

        if (form.hire_date > today) {
            return "La fecha de ingreso no puede ser futura";
        }

        const duplicate = employees.find((employee) => {
            if (
                editingEmployee &&
                String(employee.id_employee) ===
                    String(editingEmployee.id_employee)
            ) {
                return false;
            }

            const duplicateName =
                normalizeName(employee.first_name).toLowerCase() ===
                    firstName.toLowerCase() &&
                normalizeName(employee.last_name).toLowerCase() ===
                    lastName.toLowerCase();

            const duplicatePhone =
                phone &&
                normalizePhone(employee.phone) &&
                normalizePhone(employee.phone) === phone;

            const duplicateEmail =
                email &&
                normalizeEmail(employee.email) &&
                normalizeEmail(employee.email) === email;

            return (
                duplicateName ||
                duplicatePhone ||
                duplicateEmail
            );
        });

        if (duplicate) {
            const duplicatePhone =
                phone &&
                normalizePhone(duplicate.phone) === phone;

            const duplicateEmail =
                email &&
                normalizeEmail(duplicate.email) === email;

            if (duplicatePhone) {
                return "Ya existe un empleado con ese teléfono";
            }

            if (duplicateEmail) {
                return "Ya existe un empleado con ese correo electrónico";
            }

            return "Ya existe un empleado con el mismo nombre y apellido";
        }

        return "";
    };

    const handleSubmit = async (event) => {
        event.preventDefault();

        const validationError = validateForm();

        if (validationError) {
            setFormError(validationError);
            return;
        }

        try {
            setSaving(true);
            setFormError("");
            setFeedback("");

            const url = editingEmployee
                ? `${API_URL}/api/employees/${editingEmployee.id_employee}`
                : `${API_URL}/api/employees`;

            const method = editingEmployee
                ? "PUT"
                : "POST";

            const payload = {
                first_name: normalizeName(form.first_name),
                last_name: normalizeName(form.last_name),
                phone: normalizePhone(form.phone) || null,
                email: normalizeEmail(form.email) || null,
                id_position: Number(form.id_position),
                hire_date: form.hire_date,
                status: form.status,
            };

            await requestJson(
                url,
                {
                    method,
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(payload),
                },
                editingEmployee
                    ? "No se pudo actualizar el empleado"
                    : "No se pudo registrar el empleado",
            );

            const message = editingEmployee
                ? "Empleado actualizado correctamente"
                : "Empleado registrado correctamente";

            resetForm();
            setFeedback(message);
            await loadData();
        } catch (submitError) {
            console.error(submitError);
            setFormError(
                submitError.message ||
                    "No se pudo guardar el empleado",
            );
        } finally {
            setSaving(false);
        }
    };

    const handleStatusChange = async (
        employee,
        nextStatus,
    ) => {
        const isActivating = nextStatus === "ACTIVE";

        const confirmed = window.confirm(
            isActivating
                ? `¿Deseas activar al empleado ${employee.first_name} ${employee.last_name}?`
                : `¿Deseas inactivar al empleado ${employee.first_name} ${employee.last_name}? Sus turnos activos también serán inactivados.`,
        );

        if (!confirmed) {
            return;
        }

        try {
            setStatusChangingId(employee.id_employee);
            setError("");
            setFeedback("");

            const data = await requestJson(
                `${API_URL}/api/employees/${employee.id_employee}/status`,
                {
                    method: "PATCH",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        status: nextStatus,
                    }),
                },
                isActivating
                    ? "No se pudo activar el empleado"
                    : "No se pudo inactivar el empleado",
            );

            let message = isActivating
                ? "Empleado activado correctamente"
                : "Empleado inactivado correctamente";

            if (
                !isActivating &&
                Number(data.disabled_shifts || 0) > 0
            ) {
                message += `. Se inactivaron ${data.disabled_shifts} turno(s) activo(s).`;
            }

            setFeedback(message);
            setSelectedEmployee(null);
            await loadData();
        } catch (statusError) {
            console.error(statusError);
            setError(
                statusError.message ||
                    "No se pudo actualizar el estado del empleado",
            );
        } finally {
            setStatusChangingId(null);
        }
    };

    const handleFilterChange = (event) => {
        const { name, value } = event.target;

        setFilters((current) => ({
            ...current,
            [name]: value,
        }));
    };

    const clearFilters = () => {
        setFilters({
            status: "",
            id_position: "",
        });
        setSearch("");
    };

    const statCardStyle = {
        background: "#121212",
        border: "1px solid #292929",
        borderRadius: "12px",
        padding: "18px 20px",
        minWidth: "150px",
        flex: "1 1 160px",
    };

    const statLabelStyle = {
        color: "#777777",
        fontSize: "11px",
        textTransform: "uppercase",
        letterSpacing: "1px",
        marginBottom: "8px",
    };

    const statValueStyle = {
        color: "#ffffff",
        fontSize: "25px",
        fontWeight: "700",
    };

    const filterInputStyle = {
        minWidth: "170px",
        padding: "10px 12px",
        background: "#1a1a1a",
        border: "1px solid #333333",
        borderRadius: "8px",
        color: "#ffffff",
        outline: "none",
    };

    return (
        <div className="employees-page">
            <Sidebar />

            <main className="employees-content">
                <header className="employees-header">
                    <div>
                        <span>RECURSOS HUMANOS</span>
                        <h1>Empleados</h1>
                        <p>
                            Gestiona los datos, cargos y estado del personal
                        </p>
                    </div>

                    <button
                        type="button"
                        className="new-employee-button"
                        onClick={openCreateForm}
                        disabled={
                            loading ||
                            activePositions.length === 0
                        }
                    >
                        + Nuevo empleado
                    </button>
                </header>

                {feedback && (
                    <div
                        style={{
                            marginBottom: "20px",
                            padding: "13px 16px",
                            borderRadius: "8px",
                            border:
                                "1px solid rgba(30, 150, 80, 0.35)",
                            background:
                                "rgba(30, 150, 80, 0.10)",
                            color: "#5cc98a",
                            fontSize: "13px",
                        }}
                    >
                        {feedback}
                    </div>
                )}

                {error && (
                    <div
                        style={{
                            marginBottom: "20px",
                            padding: "13px 16px",
                            borderRadius: "8px",
                            border:
                                "1px solid rgba(224, 0, 45, 0.35)",
                            background:
                                "rgba(224, 0, 45, 0.10)",
                            color: "#ff6b82",
                            fontSize: "13px",
                        }}
                    >
                        {error}
                    </div>
                )}

                {!loading &&
                    activePositions.length === 0 && (
                        <div
                            style={{
                                marginBottom: "20px",
                                padding: "13px 16px",
                                borderRadius: "8px",
                                border:
                                    "1px solid rgba(255, 184, 0, 0.35)",
                                background:
                                    "rgba(255, 184, 0, 0.08)",
                                color: "#ffc94d",
                                fontSize: "13px",
                            }}
                        >
                            No hay cargos activos disponibles. Debes activar o crear un cargo antes de registrar empleados activos.
                        </div>
                    )}

                <section
                    style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "14px",
                        marginBottom: "20px",
                    }}
                >
                    <div style={statCardStyle}>
                        <div style={statLabelStyle}>
                            Total empleados
                        </div>
                        <div style={statValueStyle}>
                            {summary.total}
                        </div>
                    </div>

                    <div style={statCardStyle}>
                        <div style={statLabelStyle}>
                            Activos
                        </div>
                        <div style={statValueStyle}>
                            {summary.active}
                        </div>
                    </div>

                    <div style={statCardStyle}>
                        <div style={statLabelStyle}>
                            Inactivos
                        </div>
                        <div style={statValueStyle}>
                            {summary.inactive}
                        </div>
                    </div>

                    <div style={statCardStyle}>
                        <div style={statLabelStyle}>
                            Cargos con personal activo
                        </div>
                        <div style={statValueStyle}>
                            {summary.activePositions}
                        </div>
                    </div>
                </section>

                <section
                    className="employees-panel"
                    style={{ marginBottom: "20px" }}
                >
                    <div
                        style={{
                            padding: "20px 25px",
                            borderBottom: "1px solid #292929",
                        }}
                    >
                        <div
                            style={{
                                display: "flex",
                                flexWrap: "wrap",
                                alignItems: "end",
                                gap: "12px",
                            }}
                        >
                            <div
                                style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: "6px",
                                    flex: "1 1 230px",
                                }}
                            >
                                <label
                                    style={{
                                        color: "#888888",
                                        fontSize: "11px",
                                    }}
                                >
                                    Cargo
                                </label>

                                <select
                                    name="id_position"
                                    value={filters.id_position}
                                    onChange={handleFilterChange}
                                    style={{
                                        ...filterInputStyle,
                                        width: "100%",
                                    }}
                                >
                                    <option value="">
                                        Todos los cargos
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
                                                {position.name}
                                                {position.status ===
                                                "INACTIVE"
                                                    ? " - Inactivo"
                                                    : ""}
                                            </option>
                                        ),
                                    )}
                                </select>
                            </div>

                            <div
                                style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: "6px",
                                }}
                            >
                                <label
                                    style={{
                                        color: "#888888",
                                        fontSize: "11px",
                                    }}
                                >
                                    Estado
                                </label>

                                <select
                                    name="status"
                                    value={filters.status}
                                    onChange={handleFilterChange}
                                    style={filterInputStyle}
                                >
                                    <option value="">
                                        Todos
                                    </option>
                                    <option value="ACTIVE">
                                        Activos
                                    </option>
                                    <option value="INACTIVE">
                                        Inactivos
                                    </option>
                                </select>
                            </div>

                            <button
                                type="button"
                                className="cancel-button"
                                onClick={clearFilters}
                                disabled={loading}
                            >
                                Limpiar filtros
                            </button>
                        </div>
                    </div>
                </section>

                <section className="employees-panel">
                    <div className="employees-toolbar">
                        <div>
                            <h2>
                                Personal registrado
                            </h2>
                            <p>
                                {filteredEmployees.length} empleado
                                {filteredEmployees.length === 1
                                    ? ""
                                    : "s"}{" "}
                                encontrado
                                {filteredEmployees.length === 1
                                    ? ""
                                    : "s"}
                            </p>
                        </div>

                        <input
                            type="text"
                            placeholder="Buscar por nombre, cargo, teléfono o correo..."
                            className="search-input"
                            value={search}
                            onChange={(event) =>
                                setSearch(
                                    event.target.value,
                                )
                            }
                        />
                    </div>

                    {loading ? (
                        <div className="table-message">
                            Cargando empleados...
                        </div>
                    ) : filteredEmployees.length === 0 ? (
                        <div className="table-message">
                            No se encontraron empleados.
                        </div>
                    ) : (
                        <div className="table-container">
                            <table>
                                <thead>
                                    <tr>
                                        <th>Empleado</th>
                                        <th>Cargo</th>
                                        <th>Teléfono</th>
                                        <th>Fecha ingreso</th>
                                        <th>Antigüedad</th>
                                        <th>Estado</th>
                                        <th>Acciones</th>
                                    </tr>
                                </thead>

                                <tbody>
                                    {filteredEmployees.map(
                                        (employee) => (
                                            <tr
                                                key={
                                                    employee.id_employee
                                                }
                                            >
                                                <td>
                                                    <div className="employee-name">
                                                        <div className="employee-avatar">
                                                            {getInitials(
                                                                employee,
                                                            )}
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
                                                                {employee.email ||
                                                                    "Sin correo"}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </td>

                                                <td>
                                                    {employee.position_name ||
                                                        "Sin cargo"}
                                                </td>

                                                <td>
                                                    {employee.phone ||
                                                        "Sin teléfono"}
                                                </td>

                                                <td>
                                                    {formatDate(
                                                        employee.hire_date,
                                                    )}
                                                </td>

                                                <td>
                                                    {calculateSeniority(
                                                        employee.hire_date,
                                                    )}
                                                </td>

                                                <td>
                                                    <span
                                                        className={`status ${
                                                            employee.status ===
                                                            "ACTIVE"
                                                                ? "active"
                                                                : "inactive"
                                                        }`}
                                                    >
                                                        {employee.status ===
                                                        "ACTIVE"
                                                            ? "Activo"
                                                            : "Inactivo"}
                                                    </span>
                                                </td>

                                                <td>
                                                    <div
                                                        style={{
                                                            display:
                                                                "flex",
                                                            flexWrap:
                                                                "wrap",
                                                            gap: "8px",
                                                        }}
                                                    >
                                                        <button
                                                            type="button"
                                                            className="action-button"
                                                            onClick={() =>
                                                                setSelectedEmployee(
                                                                    employee,
                                                                )
                                                            }
                                                            disabled={
                                                                statusChangingId ===
                                                                employee.id_employee
                                                            }
                                                        >
                                                            Ver
                                                        </button>

                                                        <button
                                                            type="button"
                                                            className="action-button"
                                                            onClick={() =>
                                                                openEditForm(
                                                                    employee,
                                                                )
                                                            }
                                                            disabled={
                                                                statusChangingId ===
                                                                employee.id_employee
                                                            }
                                                        >
                                                            Editar
                                                        </button>

                                                        <button
                                                            type="button"
                                                            className="action-button"
                                                            onClick={() =>
                                                                handleStatusChange(
                                                                    employee,
                                                                    employee.status ===
                                                                        "ACTIVE"
                                                                        ? "INACTIVE"
                                                                        : "ACTIVE",
                                                                )
                                                            }
                                                            disabled={
                                                                statusChangingId ===
                                                                employee.id_employee
                                                            }
                                                        >
                                                            {statusChangingId ===
                                                            employee.id_employee
                                                                ? "Guardando..."
                                                                : employee.status ===
                                                                    "ACTIVE"
                                                                  ? "Inactivar"
                                                                  : "Activar"}
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ),
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}
                </section>
            </main>

            {selectedEmployee && (
                <div
                    className="modal-background"
                    onClick={() =>
                        setSelectedEmployee(null)
                    }
                >
                    <div
                        className="employee-modal"
                        onClick={(event) =>
                            event.stopPropagation()
                        }
                    >
                        <div className="modal-header">
                            <div>
                                <span>
                                    RECURSOS HUMANOS
                                </span>

                                <h2>
                                    {
                                        selectedEmployee.first_name
                                    }{" "}
                                    {
                                        selectedEmployee.last_name
                                    }
                                </h2>
                            </div>

                            <button
                                type="button"
                                className="close-button"
                                onClick={() =>
                                    setSelectedEmployee(
                                        null,
                                    )
                                }
                            >
                                ×
                            </button>
                        </div>

                        <div
                            style={{
                                marginBottom: "18px",
                                display: "flex",
                                alignItems: "center",
                                gap: "14px",
                            }}
                        >
                            <div
                                className="employee-avatar"
                                style={{
                                    width: "48px",
                                    height: "48px",
                                    fontSize: "16px",
                                }}
                            >
                                {getInitials(
                                    selectedEmployee,
                                )}
                            </div>

                            <div>
                                <strong
                                    style={{
                                        display: "block",
                                        marginBottom: "5px",
                                    }}
                                >
                                    {
                                        selectedEmployee.first_name
                                    }{" "}
                                    {
                                        selectedEmployee.last_name
                                    }
                                </strong>

                                <span
                                    className={`status ${
                                        selectedEmployee.status ===
                                        "ACTIVE"
                                            ? "active"
                                            : "inactive"
                                    }`}
                                >
                                    {selectedEmployee.status ===
                                    "ACTIVE"
                                        ? "Activo"
                                        : "Inactivo"}
                                </span>
                            </div>
                        </div>

                        <div className="form-grid">
                            <div className="form-group">
                                <label>Cargo</label>
                                <input
                                    value={
                                        selectedEmployee.position_name ||
                                        "Sin cargo"
                                    }
                                    readOnly
                                />
                            </div>

                            <div className="form-group">
                                <label>
                                    Fecha de ingreso
                                </label>
                                <input
                                    value={formatDate(
                                        selectedEmployee.hire_date,
                                    )}
                                    readOnly
                                />
                            </div>

                            <div className="form-group">
                                <label>Antigüedad</label>
                                <input
                                    value={calculateSeniority(
                                        selectedEmployee.hire_date,
                                    )}
                                    readOnly
                                />
                            </div>

                            <div className="form-group">
                                <label>Teléfono</label>
                                <input
                                    value={
                                        selectedEmployee.phone ||
                                        "Sin teléfono"
                                    }
                                    readOnly
                                />
                            </div>

                            <div className="form-group">
                                <label>Correo</label>
                                <input
                                    value={
                                        selectedEmployee.email ||
                                        "Sin correo"
                                    }
                                    readOnly
                                />
                            </div>

                            <div className="form-group">
                                <label>Estado</label>
                                <input
                                    value={
                                        selectedEmployee.status ===
                                        "ACTIVE"
                                            ? "Activo"
                                            : "Inactivo"
                                    }
                                    readOnly
                                />
                            </div>
                        </div>

                        <div className="modal-actions">
                            <button
                                type="button"
                                className="cancel-button"
                                onClick={() =>
                                    setSelectedEmployee(
                                        null,
                                    )
                                }
                            >
                                Cerrar
                            </button>

                            <button
                                type="button"
                                className="save-button"
                                onClick={() =>
                                    openEditForm(
                                        selectedEmployee,
                                    )
                                }
                            >
                                Editar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showForm && (
                <div
                    className="modal-background"
                    onClick={() => {
                        if (!saving) {
                            resetForm();
                        }
                    }}
                >
                    <div
                        className="employee-modal"
                        onClick={(event) =>
                            event.stopPropagation()
                        }
                    >
                        <div className="modal-header">
                            <div>
                                <span>
                                    RECURSOS HUMANOS
                                </span>

                                <h2>
                                    {editingEmployee
                                        ? "Editar empleado"
                                        : "Nuevo empleado"}
                                </h2>
                            </div>

                            <button
                                type="button"
                                className="close-button"
                                onClick={resetForm}
                                disabled={saving}
                            >
                                ×
                            </button>
                        </div>

                        {formError && (
                            <div
                                style={{
                                    marginBottom: "18px",
                                    padding:
                                        "12px 14px",
                                    borderRadius: "8px",
                                    border:
                                        "1px solid rgba(224, 0, 45, 0.35)",
                                    background:
                                        "rgba(224, 0, 45, 0.10)",
                                    color: "#ff6b82",
                                    fontSize: "12px",
                                }}
                            >
                                {formError}
                            </div>
                        )}

                        <form
                            onSubmit={handleSubmit}
                        >
                            <div className="form-grid">
                                <div className="form-group">
                                    <label htmlFor="employee-first-name">
                                        Nombre
                                    </label>

                                    <input
                                        id="employee-first-name"
                                        type="text"
                                        name="first_name"
                                        value={
                                            form.first_name
                                        }
                                        onChange={
                                            handleChange
                                        }
                                        maxLength={80}
                                        autoComplete="off"
                                        required
                                        disabled={saving}
                                    />
                                </div>

                                <div className="form-group">
                                    <label htmlFor="employee-last-name">
                                        Apellido
                                    </label>

                                    <input
                                        id="employee-last-name"
                                        type="text"
                                        name="last_name"
                                        value={
                                            form.last_name
                                        }
                                        onChange={
                                            handleChange
                                        }
                                        maxLength={80}
                                        autoComplete="off"
                                        required
                                        disabled={saving}
                                    />
                                </div>

                                <div className="form-group">
                                    <label htmlFor="employee-phone">
                                        Teléfono
                                    </label>

                                    <input
                                        id="employee-phone"
                                        type="tel"
                                        name="phone"
                                        value={
                                            form.phone
                                        }
                                        onChange={
                                            handleChange
                                        }
                                        inputMode="tel"
                                        maxLength={20}
                                        placeholder="Ej. 70700000"
                                        disabled={saving}
                                    />

                                    <span
                                        style={{
                                            color: "#666666",
                                            fontSize: "10px",
                                        }}
                                    >
                                        Entre 7 y 15 dígitos
                                    </span>
                                </div>

                                <div className="form-group">
                                    <label htmlFor="employee-email">
                                        Correo electrónico
                                    </label>

                                    <input
                                        id="employee-email"
                                        type="email"
                                        name="email"
                                        value={
                                            form.email
                                        }
                                        onChange={
                                            handleChange
                                        }
                                        maxLength={150}
                                        autoComplete="email"
                                        placeholder="empleado@correo.com"
                                        disabled={saving}
                                    />
                                </div>

                                <div className="form-group">
                                    <label htmlFor="employee-position">
                                        Cargo
                                    </label>

                                    <select
                                        id="employee-position"
                                        name="id_position"
                                        value={
                                            form.id_position
                                        }
                                        onChange={
                                            handleChange
                                        }
                                        required
                                        disabled={saving}
                                    >
                                        <option value="">
                                            Seleccionar cargo
                                        </option>

                                        {positionOptions.map(
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
                                                    {position.status ===
                                                    "INACTIVE"
                                                        ? " - Inactivo"
                                                        : ""}
                                                </option>
                                            ),
                                        )}
                                    </select>

                                    {form.status ===
                                        "ACTIVE" &&
                                        selectedPosition &&
                                        selectedPosition.status ===
                                            "INACTIVE" && (
                                            <span
                                                style={{
                                                    color:
                                                        "#ff6b82",
                                                    fontSize:
                                                        "10px",
                                                }}
                                            >
                                                Un empleado activo no puede tener un cargo inactivo.
                                            </span>
                                        )}
                                </div>

                                <div className="form-group">
                                    <label htmlFor="employee-hire-date">
                                        Fecha de ingreso
                                    </label>

                                    <input
                                        id="employee-hire-date"
                                        type="date"
                                        name="hire_date"
                                        value={
                                            form.hire_date
                                        }
                                        onChange={
                                            handleChange
                                        }
                                        max={today}
                                        required
                                        disabled={saving}
                                    />
                                </div>

                                <div className="form-group">
                                    <label htmlFor="employee-status">
                                        Estado
                                    </label>

                                    <select
                                        id="employee-status"
                                        name="status"
                                        value={
                                            form.status
                                        }
                                        onChange={
                                            handleChange
                                        }
                                        disabled={saving}
                                    >
                                        <option value="ACTIVE">
                                            Activo
                                        </option>
                                        <option value="INACTIVE">
                                            Inactivo
                                        </option>
                                    </select>
                                </div>

                                <div className="form-group">
                                    <label>
                                        Resumen
                                    </label>

                                    <div
                                        style={{
                                            minHeight:
                                                "42px",
                                            padding:
                                                "11px 12px",
                                            border:
                                                "1px solid #333333",
                                            borderRadius:
                                                "8px",
                                            background:
                                                "#1a1a1a",
                                            fontSize:
                                                "11px",
                                            color:
                                                "#bbbbbb",
                                            display:
                                                "flex",
                                            alignItems:
                                                "center",
                                        }}
                                    >
                                        {form.id_position &&
                                        form.hire_date
                                            ? `${
                                                  selectedPosition?.name ||
                                                  "Cargo seleccionado"
                                              } · ${calculateSeniority(
                                                  form.hire_date,
                                              )} de antigüedad`
                                            : "Complete cargo y fecha de ingreso"}
                                    </div>
                                </div>
                            </div>

                            {editingEmployee &&
                                form.status ===
                                    "INACTIVE" &&
                                editingEmployee.status ===
                                    "ACTIVE" && (
                                    <div
                                        style={{
                                            marginTop:
                                                "15px",
                                            padding:
                                                "12px 14px",
                                            borderRadius:
                                                "8px",
                                            border:
                                                "1px solid rgba(255, 184, 0, 0.35)",
                                            background:
                                                "rgba(255, 184, 0, 0.08)",
                                            color:
                                                "#ffc94d",
                                            fontSize:
                                                "11px",
                                        }}
                                    >
                                        Al guardar el empleado como inactivo, sus turnos activos también serán inactivados.
                                    </div>
                                )}

                            <div className="modal-actions">
                                <button
                                    type="button"
                                    className="cancel-button"
                                    onClick={resetForm}
                                    disabled={saving}
                                >
                                    Cancelar
                                </button>

                                <button
                                    type="submit"
                                    className="save-button"
                                    disabled={
                                        saving ||
                                        (!editingEmployee &&
                                            activePositions.length ===
                                                0)
                                    }
                                >
                                    {saving
                                        ? "Guardando..."
                                        : editingEmployee
                                          ? "Guardar cambios"
                                          : "Guardar empleado"}
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
