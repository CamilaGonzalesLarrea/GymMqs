import { useEffect, useMemo, useState } from 'react';
import Sidebar from '../components/Sidebar';
import { API_URL } from '../config/api';
import './Employees.css';

const STATUS_OPTIONS = [
  { value: 'ACTIVE', label: 'Activo' },
  { value: 'INACTIVE', label: 'Inactivo' },
];

const getLocalDateString = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
};

const formatDate = (value) => {
  if (!value) return '-';

  const normalized = String(value).slice(0, 10);
  const [year, month, day] = normalized.split('-');

  if (!year || !month || !day) {
    return normalized;
  }

  return `${day}/${month}/${year}`;
};

const parseMoney = (value) => {
  const normalized = String(value ?? '')
    .replace(',', '.')
    .trim();

  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : NaN;
};

const formatMoney = (value) => {
  const amount = Number(value);

  if (!Number.isFinite(amount)) {
    return 'Bs 0,00';
  }

  return new Intl.NumberFormat('es-BO', {
    style: 'currency',
    currency: 'BOB',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
};

const parseResponse = async (response) => {
  const text = await response.text();

  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
};

const getErrorMessage = (data, fallback) => {
  if (
    data &&
    typeof data === 'object' &&
    typeof data.message === 'string' &&
    data.message.trim()
  ) {
    return data.message;
  }

  return fallback;
};

const isActive = (value) =>
  String(value || '').toUpperCase() === 'ACTIVE';

const getEmployeeName = (employee) =>
  `${employee?.first_name || ''} ${employee?.last_name || ''}`.trim();

const getSalaryEmployeeName = (salary) =>
  String(salary?.employee_name || '').trim() || 'Sin empleado';

const getEmployeeHireDate = (employee) =>
  String(employee?.hire_date || '').slice(0, 10);

const getSalaryDate = (salary) =>
  String(salary?.effective_date || '').slice(0, 10);

const normalizeSearchText = (value) =>
  String(value || '')
    .trim()
    .toLocaleLowerCase('es');

function Salaries() {
  const today = getLocalDateString();

  const [employees, setEmployees] = useState([]);
  const [salaries, setSalaries] = useState([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pageError, setPageError] = useState('');
  const [feedback, setFeedback] = useState('');

  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({
    id_employee: '',
    status: '',
  });

  const [showForm, setShowForm] = useState(false);
  const [editingSalary, setEditingSalary] = useState(null);
  const [detailSalary, setDetailSalary] = useState(null);

  const [form, setForm] = useState({
    id_employee: '',
    base_salary: '',
    effective_date: today,
    status: 'ACTIVE',
  });

  const requestJson = async (
    url,
    options = {},
    fallbackMessage = 'Ocurrió un error',
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
      setPageError('');

      const [employeesData, salariesData] =
        await Promise.all([
          requestJson(
            `${API_URL}/api/employees`,
            {},
            'No se pudieron cargar los empleados',
          ),
          requestJson(
            `${API_URL}/api/salaries`,
            {},
            'No se pudieron cargar los salarios',
          ),
        ]);

      setEmployees(
        Array.isArray(employeesData)
          ? employeesData
          : [],
      );

      setSalaries(
        Array.isArray(salariesData)
          ? salariesData
          : [],
      );
    } catch (error) {
      console.error(error);
      setPageError(
        error.message ||
          'No se pudo cargar la gestión de salarios',
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (!feedback) return undefined;

    const timeout = window.setTimeout(() => {
      setFeedback('');
    }, 3500);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [feedback]);

  useEffect(() => {
    const handleEscape = (event) => {
      if (event.key !== 'Escape') return;

      if (detailSalary) {
        setDetailSalary(null);
        return;
      }

      if (showForm && !saving) {
        setShowForm(false);
        setEditingSalary(null);
      }
    };

    window.addEventListener('keydown', handleEscape);

    return () => {
      window.removeEventListener(
        'keydown',
        handleEscape,
      );
    };
  }, [detailSalary, saving, showForm]);

  const activeEmployees = useMemo(
    () =>
      employees.filter((employee) =>
        isActive(employee.status),
      ),
    [employees],
  );

  const activeSalaryByEmployee = useMemo(() => {
    const map = new Map();

    salaries
      .filter((salary) => isActive(salary.status))
      .sort((a, b) => {
        const dateComparison =
          getSalaryDate(b).localeCompare(
            getSalaryDate(a),
          );

        if (dateComparison !== 0) {
          return dateComparison;
        }

        return (
          Number(b.id_salary || 0) -
          Number(a.id_salary || 0)
        );
      })
      .forEach((salary) => {
        const key = String(salary.id_employee);

        if (!map.has(key)) {
          map.set(key, salary);
        }
      });

    return map;
  }, [salaries]);

  const currentActiveSalaries = useMemo(
    () =>
      Array.from(
        activeSalaryByEmployee.values(),
      ),
    [activeSalaryByEmployee],
  );

  const employeesWithoutActiveSalary = useMemo(
    () =>
      activeEmployees.filter(
        (employee) =>
          !activeSalaryByEmployee.has(
            String(employee.id_employee),
          ),
      ),
    [
      activeEmployees,
      activeSalaryByEmployee,
    ],
  );

  const averageActiveSalary = useMemo(() => {
    if (!currentActiveSalaries.length) {
      return 0;
    }

    const total =
      currentActiveSalaries.reduce(
        (sum, salary) =>
          sum +
          (Number(
            salary.base_salary,
          ) || 0),
        0,
      );

    return total /
      currentActiveSalaries.length;
  }, [currentActiveSalaries]);

  const monthlyActivePayrollEstimate =
    useMemo(
      () =>
        currentActiveSalaries.reduce(
          (sum, salary) =>
            sum +
            (Number(
              salary.base_salary,
            ) || 0),
          0,
        ),
      [currentActiveSalaries],
    );

  const filteredSalaries = useMemo(() => {
    const normalizedSearch =
      normalizeSearchText(search);

    return salaries
      .filter((salary) => {
        if (
          filters.id_employee &&
          String(salary.id_employee) !==
            String(filters.id_employee)
        ) {
          return false;
        }

        if (
          filters.status &&
          String(
            salary.status || '',
          ).toUpperCase() !==
            filters.status
        ) {
          return false;
        }

        if (!normalizedSearch) {
          return true;
        }

        const values = [
          salary.employee_name,
          salary.position_name,
          salary.base_salary,
          formatMoney(salary.base_salary),
          salary.effective_date,
          formatDate(salary.effective_date),
          isActive(salary.status)
            ? 'activo vigente'
            : 'inactivo histórico',
        ];

        return values.some((value) =>
          normalizeSearchText(value).includes(
            normalizedSearch,
          ),
        );
      })
      .sort((a, b) => {
        const dateComparison =
          getSalaryDate(b).localeCompare(
            getSalaryDate(a),
          );

        if (dateComparison !== 0) {
          return dateComparison;
        }

        return (
          Number(b.id_salary || 0) -
          Number(a.id_salary || 0)
        );
      });
  }, [
    filters.id_employee,
    filters.status,
    salaries,
    search,
  ]);

  const selectedFormEmployee = useMemo(
    () =>
      employees.find(
        (employee) =>
          String(employee.id_employee) ===
          String(form.id_employee),
      ) || null,
    [employees, form.id_employee],
  );

  const selectableEmployees = useMemo(() => {
    if (!editingSalary) {
      return activeEmployees;
    }

    const editingEmployee = employees.find(
      (employee) =>
        String(employee.id_employee) ===
        String(editingSalary.id_employee),
    );

    if (
      !editingEmployee ||
      isActive(editingEmployee.status)
    ) {
      return activeEmployees;
    }

    return [
      editingEmployee,
      ...activeEmployees.filter(
        (employee) =>
          String(employee.id_employee) !==
          String(
            editingEmployee.id_employee,
          ),
      ),
    ];
  }, [
    activeEmployees,
    editingSalary,
    employees,
  ]);

  const resetForm = () => {
    setForm({
      id_employee: '',
      base_salary: '',
      effective_date: today,
      status: 'ACTIVE',
    });

    setEditingSalary(null);
  };

  const openCreateForm = () => {
    resetForm();
    setPageError('');
    setFeedback('');
    setShowForm(true);
  };

  const openEditForm = (salary) => {
    setEditingSalary(salary);

    setForm({
      id_employee:
        String(salary.id_employee || ''),
      base_salary:
        salary.base_salary !==
          null &&
        salary.base_salary !==
          undefined
          ? String(salary.base_salary)
          : '',
      effective_date:
        getSalaryDate(salary),
      status:
        String(
          salary.status || 'INACTIVE',
        ).toUpperCase(),
    });

    setPageError('');
    setFeedback('');
    setShowForm(true);
  };

  const closeForm = () => {
    if (saving) return;

    setShowForm(false);
    resetForm();
  };

  const handleFormChange = (event) => {
    const { name, value } = event.target;

    setForm((current) => ({
      ...current,
      [name]: value,
    }));
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
      id_employee: '',
      status: '',
    });

    setSearch('');
  };

  const validateForm = () => {
    if (!form.id_employee) {
      return 'Selecciona un empleado';
    }

    const employee = selectedFormEmployee;

    if (!employee) {
      return 'El empleado seleccionado no existe';
    }

    const salaryValue =
      parseMoney(form.base_salary);

    if (
      !Number.isFinite(salaryValue) ||
      salaryValue <= 0
    ) {
      return 'El salario base debe ser mayor a 0';
    }

    if (salaryValue > 99999999.99) {
      return 'El salario base es demasiado alto';
    }

    if (!form.effective_date) {
      return 'La fecha de vigencia es obligatoria';
    }

    if (
      form.effective_date > today
    ) {
      return 'La fecha de vigencia no puede ser futura';
    }

    const hireDate =
      getEmployeeHireDate(employee);

    if (
      hireDate &&
      form.effective_date < hireDate
    ) {
      return `La fecha de vigencia no puede ser anterior a la contratación del empleado (${formatDate(
        hireDate,
      )})`;
    }

    if (
      form.status === 'ACTIVE' &&
      !isActive(employee.status)
    ) {
      return 'No se puede activar un salario para un empleado inactivo';
    }

    const duplicateDate =
      salaries.some((salary) => {
        if (
          editingSalary &&
          String(salary.id_salary) ===
            String(
              editingSalary.id_salary,
            )
        ) {
          return false;
        }

        return (
          String(
            salary.id_employee,
          ) ===
            String(form.id_employee) &&
          getSalaryDate(salary) ===
            form.effective_date
        );
      });

    if (duplicateDate) {
      return 'Este empleado ya tiene un salario registrado con la misma fecha de vigencia';
    }

    return '';
  };

  const saveSalary = async (
    event,
  ) => {
    event.preventDefault();

    const validationError =
      validateForm();

    if (validationError) {
      setPageError(validationError);
      return;
    }

    const employee =
      selectedFormEmployee;

    const currentActive =
      activeSalaryByEmployee.get(
        String(form.id_employee),
      );

    if (
      !editingSalary &&
      form.status === 'ACTIVE' &&
      currentActive
    ) {
      const confirmed =
        window.confirm(
          `${getEmployeeName(
            employee,
          )} ya tiene un salario activo de ${formatMoney(
            currentActive.base_salary,
          )}. Al registrar este nuevo salario como activo, el anterior pasará a histórico. ¿Deseas continuar?`,
        );

      if (!confirmed) return;
    }

    if (
      editingSalary &&
      form.status === 'ACTIVE' &&
      currentActive &&
      String(
        currentActive.id_salary,
      ) !==
        String(
          editingSalary.id_salary,
        )
    ) {
      const confirmed =
        window.confirm(
          `Al activar este salario se inactivará el salario vigente de ${getEmployeeName(
            employee,
          )}. ¿Deseas continuar?`,
        );

      if (!confirmed) return;
    }

    const payload = {
      id_employee:
        Number(form.id_employee),
      base_salary:
        Number(
          parseMoney(
            form.base_salary,
          ).toFixed(2),
        ),
      effective_date:
        form.effective_date,
      status: form.status,
    };

    try {
      setSaving(true);
      setPageError('');
      setFeedback('');

      if (editingSalary) {
        await requestJson(
          `${API_URL}/api/salaries/${editingSalary.id_salary}`,
          {
            method: 'PUT',
            headers: {
              'Content-Type':
                'application/json',
            },
            body: JSON.stringify(
              payload,
            ),
          },
          'No se pudo actualizar el salario',
        );

        setFeedback(
          'Salario actualizado correctamente',
        );
      } else {
        await requestJson(
          `${API_URL}/api/salaries`,
          {
            method: 'POST',
            headers: {
              'Content-Type':
                'application/json',
            },
            body: JSON.stringify(
              payload,
            ),
          },
          'No se pudo registrar el salario',
        );

        setFeedback(
          'Salario registrado correctamente',
        );
      }

      setShowForm(false);
      resetForm();
      await loadData();
    } catch (error) {
      console.error(error);
      setPageError(
        error.message ||
          'No se pudo guardar el salario',
      );
    } finally {
      setSaving(false);
    }
  };

  const toggleSalaryStatus = async (
    salary,
  ) => {
    const nextStatus =
      isActive(salary.status)
        ? 'INACTIVE'
        : 'ACTIVE';

    const actionText =
      nextStatus === 'ACTIVE'
        ? 'activar'
        : 'inactivar';

    const employee = employees.find(
      (item) =>
        String(item.id_employee) ===
        String(salary.id_employee),
    );

    if (
      nextStatus === 'ACTIVE' &&
      employee &&
      !isActive(employee.status)
    ) {
      setPageError(
        'No se puede activar el salario porque el empleado está inactivo',
      );
      return;
    }

    const currentActive =
      activeSalaryByEmployee.get(
        String(salary.id_employee),
      );

    let message =
      `¿Deseas ${actionText} el salario de ${getSalaryEmployeeName(
        salary,
      )}?`;

    if (
      nextStatus === 'ACTIVE' &&
      currentActive &&
      String(
        currentActive.id_salary,
      ) !==
        String(salary.id_salary)
    ) {
      message +=
        ` El salario activo actual de ${formatMoney(
          currentActive.base_salary,
        )} pasará a histórico.`;
    }

    const confirmed =
      window.confirm(message);

    if (!confirmed) return;

    try {
      setSaving(true);
      setPageError('');
      setFeedback('');

      await requestJson(
        `${API_URL}/api/salaries/${salary.id_salary}/status`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type':
              'application/json',
          },
          body: JSON.stringify({
            status: nextStatus,
          }),
        },
        `No se pudo ${actionText} el salario`,
      );

      setFeedback(
        `Salario ${
          nextStatus === 'ACTIVE'
            ? 'activado'
            : 'inactivado'
        } correctamente`,
      );

      await loadData();
    } catch (error) {
      console.error(error);
      setPageError(
        error.message ||
          `No se pudo ${actionText} el salario`,
      );
    } finally {
      setSaving(false);
    }
  };

  const formEmployeeCurrentSalary =
    useMemo(() => {
      if (!form.id_employee) {
        return null;
      }

      return activeSalaryByEmployee.get(
        String(form.id_employee),
      ) || null;
    }, [
      activeSalaryByEmployee,
      form.id_employee,
    ]);

  const statCardStyle = {
    background: '#171717',
    border:
      '1px solid #292929',
    borderRadius: '12px',
    padding: '18px 16px',
  };

  const statLabelStyle = {
    color: '#777777',
    fontSize: '11px',
    textTransform:
      'uppercase',
    letterSpacing: '1px',
  };

  const statValueStyle = {
    marginTop: '8px',
    fontSize: '27px',
    fontWeight: 700,
    color: '#ffffff',
  };

  const selectStyle = {
    width: '100%',
    padding: '11px 12px',
    background: '#1a1a1a',
    border:
      '1px solid #333333',
    borderRadius: '8px',
    color: '#ffffff',
    outline: 'none',
  };

  const modalOverlayStyle = {
    position: 'fixed',
    inset: 0,
    zIndex: 1000,
    background:
      'rgba(0, 0, 0, 0.72)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
  };

  const modalStyle = {
    width: '100%',
    maxWidth: '720px',
    maxHeight: '90vh',
    overflowY: 'auto',
    background: '#111111',
    border:
      '1px solid #2b2b2b',
    borderRadius: '14px',
    boxShadow:
      '0 24px 80px rgba(0,0,0,0.45)',
  };

  return (
    <div className="employees-page">
      <Sidebar />

      <main className="employees-content">
        <header className="employees-header">
          <div>
            <span>
              RECURSOS HUMANOS
            </span>
            <h1>Salarios</h1>
            <p>
              Gestiona el salario vigente y el historial salarial de los empleados
            </p>
          </div>

          <button
            type="button"
            className="new-employee-button"
            onClick={openCreateForm}
            disabled={loading || saving}
          >
            Nuevo salario
          </button>
        </header>

        {feedback && (
          <div
            style={{
              marginBottom: '20px',
              padding: '13px 16px',
              borderRadius: '8px',
              border:
                '1px solid rgba(30, 150, 80, 0.35)',
              background:
                'rgba(30, 150, 80, 0.10)',
              color: '#5cc98a',
              fontSize: '13px',
            }}
          >
            {feedback}
          </div>
        )}

        {pageError && (
          <div
            style={{
              marginBottom: '20px',
              padding: '13px 16px',
              borderRadius: '8px',
              border:
                '1px solid rgba(224, 0, 45, 0.35)',
              background:
                'rgba(224, 0, 45, 0.10)',
              color: '#ff6b82',
              fontSize: '13px',
            }}
          >
            {pageError}
          </div>
        )}

        {employeesWithoutActiveSalary.length >
          0 && (
          <div
            style={{
              marginBottom: '20px',
              padding: '13px 16px',
              borderRadius: '8px',
              border:
                '1px solid rgba(255, 184, 0, 0.35)',
              background:
                'rgba(255, 184, 0, 0.08)',
              color: '#ffc94d',
              fontSize: '12px',
            }}
          >
            Hay{' '}
            {
              employeesWithoutActiveSalary.length
            }{' '}
            empleado(s) activo(s) sin salario vigente. Antes de generar una planilla mensual, todos los empleados activos deben tener un salario registrado.
          </div>
        )}

        <section
          style={{
            display: 'grid',
            gridTemplateColumns:
              'repeat(auto-fit, minmax(180px, 1fr))',
            gap: '16px',
            marginBottom: '20px',
          }}
        >
          <div style={statCardStyle}>
            <div style={statLabelStyle}>
              Empleados activos
            </div>
            <div style={statValueStyle}>
              {activeEmployees.length}
            </div>
          </div>

          <div style={statCardStyle}>
            <div style={statLabelStyle}>
              Con salario vigente
            </div>
            <div style={statValueStyle}>
              {currentActiveSalaries.length}
            </div>
          </div>

          <div style={statCardStyle}>
            <div style={statLabelStyle}>
              Sin salario vigente
            </div>
            <div style={statValueStyle}>
              {
                employeesWithoutActiveSalary.length
              }
            </div>
          </div>

          <div style={statCardStyle}>
            <div style={statLabelStyle}>
              Salario promedio
            </div>
            <div
              style={{
                ...statValueStyle,
                fontSize: '22px',
              }}
            >
              {formatMoney(
                averageActiveSalary,
              )}
            </div>
          </div>

          <div style={statCardStyle}>
            <div style={statLabelStyle}>
              Total mensual estimado
            </div>
            <div
              style={{
                ...statValueStyle,
                fontSize: '22px',
              }}
            >
              {formatMoney(
                monthlyActivePayrollEstimate,
              )}
            </div>
          </div>
        </section>

        <section
          className="employees-panel"
          style={{
            marginBottom: '20px',
          }}
        >
          <div
            style={{
              padding: '18px 24px',
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'end',
              gap: '12px',
            }}
          >
            <div
              style={{
                flex: '1 1 280px',
              }}
            >
              <label
                style={{
                  display: 'block',
                  marginBottom: '6px',
                  color: '#888888',
                  fontSize: '11px',
                }}
              >
                Buscar
              </label>

              <input
                type="text"
                className="search-input"
                value={search}
                onChange={(event) =>
                  setSearch(
                    event.target.value,
                  )
                }
                placeholder="Empleado, cargo, salario o fecha..."
                style={{
                  width: '100%',
                  margin: 0,
                }}
              />
            </div>

            <div
              style={{
                minWidth: '220px',
                flex: '0 1 260px',
              }}
            >
              <label
                style={{
                  display: 'block',
                  marginBottom: '6px',
                  color: '#888888',
                  fontSize: '11px',
                }}
              >
                Empleado
              </label>

              <select
                name="id_employee"
                value={
                  filters.id_employee
                }
                onChange={
                  handleFilterChange
                }
                style={selectStyle}
              >
                <option value="">
                  Todos los empleados
                </option>

                {employees.map(
                  (employee) => (
                    <option
                      key={
                        employee.id_employee
                      }
                      value={
                        employee.id_employee
                      }
                    >
                      {getEmployeeName(
                        employee,
                      )}
                    </option>
                  ),
                )}
              </select>
            </div>

            <div
              style={{
                minWidth: '170px',
              }}
            >
              <label
                style={{
                  display: 'block',
                  marginBottom: '6px',
                  color: '#888888',
                  fontSize: '11px',
                }}
              >
                Estado
              </label>

              <select
                name="status"
                value={filters.status}
                onChange={
                  handleFilterChange
                }
                style={selectStyle}
              >
                <option value="">
                  Todos
                </option>

                {STATUS_OPTIONS.map(
                  (option) => (
                    <option
                      key={option.value}
                      value={option.value}
                    >
                      {option.label}
                    </option>
                  ),
                )}
              </select>
            </div>

            <button
              type="button"
              className="cancel-button"
              onClick={clearFilters}
              disabled={loading}
            >
              Limpiar
            </button>

            <button
              type="button"
              className="action-button"
              onClick={loadData}
              disabled={loading}
            >
              {loading
                ? 'Actualizando...'
                : 'Actualizar'}
            </button>
          </div>
        </section>

        <section className="employees-panel">
          <div
            style={{
              padding:
                '18px 24px 12px',
              display: 'flex',
              justifyContent:
                'space-between',
              alignItems: 'center',
              gap: '12px',
              flexWrap: 'wrap',
            }}
          >
            <div>
              <h2
                style={{
                  margin: '0 0 4px',
                }}
              >
                Historial salarial
              </h2>

              <p
                style={{
                  margin: 0,
                  color: '#777777',
                  fontSize: '12px',
                }}
              >
                {
                  filteredSalaries.length
                }{' '}
                registro(s)
              </p>
            </div>

            <div
              style={{
                color: '#777777',
                fontSize: '11px',
                maxWidth: '480px',
                textAlign: 'right',
              }}
            >
              Para un aumento o cambio salarial real, registra un nuevo salario con una nueva fecha de vigencia. Así se conserva el historial.
            </div>
          </div>

          {loading ? (
            <div
              style={{
                padding: '24px',
              }}
            >
              Cargando salarios...
            </div>
          ) : (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Empleado</th>
                    <th>Cargo</th>
                    <th>Salario base</th>
                    <th>Vigente desde</th>
                    <th>Estado</th>
                    <th>Situación empleado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredSalaries.length ===
                  0 ? (
                    <tr>
                      <td colSpan="7">
                        No hay salarios para los filtros seleccionados.
                      </td>
                    </tr>
                  ) : (
                    filteredSalaries.map(
                      (salary) => (
                        <tr
                          key={
                            salary.id_salary
                          }
                        >
                          <td>
                            <div
                              style={{
                                fontWeight:
                                  600,
                              }}
                            >
                              {getSalaryEmployeeName(
                                salary,
                              )}
                            </div>
                          </td>

                          <td>
                            {salary.position_name ||
                              'Sin cargo'}
                          </td>

                          <td>
                            <strong>
                              {formatMoney(
                                salary.base_salary,
                              )}
                            </strong>
                          </td>

                          <td>
                            {formatDate(
                              salary.effective_date,
                            )}
                          </td>

                          <td>
                            <span
                              className={`status ${
                                isActive(
                                  salary.status,
                                )
                                  ? 'active'
                                  : 'inactive'
                              }`}
                            >
                              {isActive(
                                salary.status,
                              )
                                ? 'Vigente'
                                : 'Histórico'}
                            </span>
                          </td>

                          <td>
                            <span
                              className={`status ${
                                isActive(
                                  salary.employee_status,
                                )
                                  ? 'active'
                                  : 'inactive'
                              }`}
                            >
                              {isActive(
                                salary.employee_status,
                              )
                                ? 'Empleado activo'
                                : 'Empleado inactivo'}
                            </span>
                          </td>

                          <td>
                            <div
                              style={{
                                display:
                                  'flex',
                                gap: '8px',
                                flexWrap:
                                  'wrap',
                              }}
                            >
                              <button
                                type="button"
                                className="action-button"
                                onClick={() =>
                                  setDetailSalary(
                                    salary,
                                  )
                                }
                              >
                                Ver
                              </button>

                              <button
                                type="button"
                                className="action-button"
                                onClick={() =>
                                  openEditForm(
                                    salary,
                                  )
                                }
                                disabled={saving}
                              >
                                Editar
                              </button>

                              <button
                                type="button"
                                className={
                                  isActive(
                                    salary.status,
                                  )
                                    ? 'cancel-button'
                                    : 'save-button'
                                }
                                onClick={() =>
                                  toggleSalaryStatus(
                                    salary,
                                  )
                                }
                                disabled={saving}
                              >
                                {isActive(
                                  salary.status,
                                )
                                  ? 'Inactivar'
                                  : 'Activar'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ),
                    )
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      {showForm && (
        <div
          style={modalOverlayStyle}
          onMouseDown={(event) => {
            if (
              event.target ===
                event.currentTarget &&
              !saving
            ) {
              closeForm();
            }
          }}
        >
          <div style={modalStyle}>
            <div
              style={{
                padding: '22px 24px',
                borderBottom:
                  '1px solid #292929',
                display: 'flex',
                justifyContent:
                  'space-between',
                alignItems: 'flex-start',
                gap: '16px',
              }}
            >
              <div>
                <span
                  style={{
                    color: '#e0002d',
                    fontSize: '11px',
                    fontWeight: 700,
                    letterSpacing: '1px',
                  }}
                >
                  RECURSOS HUMANOS
                </span>

                <h2
                  style={{
                    margin:
                      '5px 0 5px',
                  }}
                >
                  {editingSalary
                    ? 'Editar salario'
                    : 'Registrar salario'}
                </h2>

                <p
                  style={{
                    margin: 0,
                    color: '#777777',
                    fontSize: '12px',
                  }}
                >
                  {editingSalary
                    ? 'Usa la edición para corregir un registro. Para un aumento salarial, crea un nuevo registro.'
                    : 'El nuevo registro conservará el historial salarial del empleado.'}
                </p>
              </div>

              <button
                type="button"
                className="action-button"
                onClick={closeForm}
                disabled={saving}
              >
                Cerrar
              </button>
            </div>

            <form
              onSubmit={saveSalary}
              style={{
                padding: '24px',
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns:
                    'repeat(auto-fit, minmax(240px, 1fr))',
                  gap: '18px',
                }}
              >
                <div>
                  <label
                    style={{
                      display: 'block',
                      marginBottom: '7px',
                      color: '#999999',
                      fontSize: '12px',
                    }}
                  >
                    Empleado *
                  </label>

                  <select
                    name="id_employee"
                    value={
                      form.id_employee
                    }
                    onChange={
                      handleFormChange
                    }
                    style={selectStyle}
                    disabled={saving}
                    required
                  >
                    <option value="">
                      Selecciona un empleado
                    </option>

                    {selectableEmployees.map(
                      (employee) => (
                        <option
                          key={
                            employee.id_employee
                          }
                          value={
                            employee.id_employee
                          }
                        >
                          {getEmployeeName(
                            employee,
                          )}
                          {' · '}
                          {employee.position_name ||
                            'Sin cargo'}
                          {!isActive(
                            employee.status,
                          )
                            ? ' · Inactivo'
                            : ''}
                        </option>
                      ),
                    )}
                  </select>
                </div>

                <div>
                  <label
                    style={{
                      display: 'block',
                      marginBottom: '7px',
                      color: '#999999',
                      fontSize: '12px',
                    }}
                  >
                    Salario base mensual (Bs) *
                  </label>

                  <input
                    type="number"
                    name="base_salary"
                    min="0.01"
                    max="99999999.99"
                    step="0.01"
                    value={
                      form.base_salary
                    }
                    onChange={
                      handleFormChange
                    }
                    placeholder="Ej. 2500.00"
                    style={selectStyle}
                    disabled={saving}
                    required
                  />
                </div>

                <div>
                  <label
                    style={{
                      display: 'block',
                      marginBottom: '7px',
                      color: '#999999',
                      fontSize: '12px',
                    }}
                  >
                    Vigente desde *
                  </label>

                  <input
                    type="date"
                    name="effective_date"
                    value={
                      form.effective_date
                    }
                    onChange={
                      handleFormChange
                    }
                    min={
                      selectedFormEmployee
                        ? getEmployeeHireDate(
                            selectedFormEmployee,
                          )
                        : undefined
                    }
                    max={today}
                    style={selectStyle}
                    disabled={saving}
                    required
                  />
                </div>

                <div>
                  <label
                    style={{
                      display: 'block',
                      marginBottom: '7px',
                      color: '#999999',
                      fontSize: '12px',
                    }}
                  >
                    Estado *
                  </label>

                  <select
                    name="status"
                    value={form.status}
                    onChange={
                      handleFormChange
                    }
                    style={selectStyle}
                    disabled={saving}
                  >
                    {STATUS_OPTIONS.map(
                      (option) => (
                        <option
                          key={option.value}
                          value={option.value}
                        >
                          {option.label}
                        </option>
                      ),
                    )}
                  </select>
                </div>
              </div>

              {selectedFormEmployee && (
                <div
                  style={{
                    marginTop: '18px',
                    padding: '14px 16px',
                    borderRadius: '10px',
                    background:
                      '#171717',
                    border:
                      '1px solid #292929',
                    display: 'grid',
                    gridTemplateColumns:
                      'repeat(auto-fit, minmax(170px, 1fr))',
                    gap: '12px',
                  }}
                >
                  <div>
                    <div
                      style={{
                        color: '#777777',
                        fontSize: '10px',
                        textTransform:
                          'uppercase',
                      }}
                    >
                      Cargo
                    </div>
                    <div
                      style={{
                        marginTop: '4px',
                      }}
                    >
                      {selectedFormEmployee.position_name ||
                        'Sin cargo'}
                    </div>
                  </div>

                  <div>
                    <div
                      style={{
                        color: '#777777',
                        fontSize: '10px',
                        textTransform:
                          'uppercase',
                      }}
                    >
                      Contratación
                    </div>
                    <div
                      style={{
                        marginTop: '4px',
                      }}
                    >
                      {formatDate(
                        selectedFormEmployee.hire_date,
                      )}
                    </div>
                  </div>

                  <div>
                    <div
                      style={{
                        color: '#777777',
                        fontSize: '10px',
                        textTransform:
                          'uppercase',
                      }}
                    >
                      Salario vigente
                    </div>
                    <div
                      style={{
                        marginTop: '4px',
                        fontWeight: 700,
                      }}
                    >
                      {formEmployeeCurrentSalary
                        ? formatMoney(
                            formEmployeeCurrentSalary.base_salary,
                          )
                        : 'Sin salario'}
                    </div>
                  </div>
                </div>
              )}

              {form.status ===
                'ACTIVE' &&
                formEmployeeCurrentSalary &&
                (!editingSalary ||
                  String(
                    formEmployeeCurrentSalary.id_salary,
                  ) !==
                    String(
                      editingSalary.id_salary,
                    )) && (
                  <div
                    style={{
                      marginTop: '16px',
                      padding: '12px 14px',
                      borderRadius: '8px',
                      border:
                        '1px solid rgba(255, 184, 0, 0.35)',
                      background:
                        'rgba(255, 184, 0, 0.08)',
                      color: '#ffc94d',
                      fontSize: '12px',
                    }}
                  >
                    Este empleado ya tiene un salario activo de{' '}
                    <strong>
                      {formatMoney(
                        formEmployeeCurrentSalary.base_salary,
                      )}
                    </strong>
                    . Al guardar este registro como activo, el salario anterior pasará automáticamente a histórico.
                  </div>
                )}

              <div
                style={{
                  marginTop: '24px',
                  display: 'flex',
                  justifyContent:
                    'flex-end',
                  gap: '10px',
                  flexWrap: 'wrap',
                }}
              >
                <button
                  type="button"
                  className="cancel-button"
                  onClick={closeForm}
                  disabled={saving}
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  className="save-button"
                  disabled={saving}
                >
                  {saving
                    ? 'Guardando...'
                    : editingSalary
                      ? 'Guardar cambios'
                      : 'Registrar salario'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {detailSalary && (
        <div
          style={modalOverlayStyle}
          onMouseDown={(event) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              setDetailSalary(null);
            }
          }}
        >
          <div
            style={{
              ...modalStyle,
              maxWidth: '560px',
            }}
          >
            <div
              style={{
                padding: '22px 24px',
                borderBottom:
                  '1px solid #292929',
                display: 'flex',
                justifyContent:
                  'space-between',
                alignItems: 'center',
                gap: '16px',
              }}
            >
              <div>
                <span
                  style={{
                    color: '#e0002d',
                    fontSize: '11px',
                    fontWeight: 700,
                    letterSpacing: '1px',
                  }}
                >
                  DETALLE SALARIAL
                </span>

                <h2
                  style={{
                    margin:
                      '5px 0 0',
                  }}
                >
                  {getSalaryEmployeeName(
                    detailSalary,
                  )}
                </h2>
              </div>

              <button
                type="button"
                className="action-button"
                onClick={() =>
                  setDetailSalary(null)
                }
              >
                Cerrar
              </button>
            </div>

            <div
              style={{
                padding: '24px',
                display: 'grid',
                gridTemplateColumns:
                  'repeat(2, minmax(0, 1fr))',
                gap: '14px',
              }}
            >
              {[
                [
                  'Cargo',
                  detailSalary.position_name ||
                    'Sin cargo',
                ],
                [
                  'Salario base',
                  formatMoney(
                    detailSalary.base_salary,
                  ),
                ],
                [
                  'Vigente desde',
                  formatDate(
                    detailSalary.effective_date,
                  ),
                ],
                [
                  'Estado',
                  isActive(
                    detailSalary.status,
                  )
                    ? 'Vigente'
                    : 'Histórico',
                ],
                [
                  'Estado del empleado',
                  isActive(
                    detailSalary.employee_status,
                  )
                    ? 'Activo'
                    : 'Inactivo',
                ],
                [
                  'ID de salario',
                  detailSalary.id_salary,
                ],
              ].map(([label, value]) => (
                <div
                  key={label}
                  style={{
                    padding:
                      '14px 15px',
                    borderRadius:
                      '10px',
                    background:
                      '#171717',
                    border:
                      '1px solid #292929',
                  }}
                >
                  <div
                    style={{
                      color: '#777777',
                      fontSize: '10px',
                      textTransform:
                        'uppercase',
                      letterSpacing:
                        '0.6px',
                    }}
                  >
                    {label}
                  </div>

                  <div
                    style={{
                      marginTop: '6px',
                      fontWeight: 600,
                    }}
                  >
                    {value}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Salaries;
