import { useEffect, useMemo, useState } from 'react';
import Sidebar from '../components/Sidebar';
import { API_URL } from '../config/api';
import './Employees.css';

const SHIFT_DAYS = [
  { value: 'MONDAY', label: 'LUNES' },
  { value: 'TUESDAY', label: 'MARTES' },
  { value: 'WEDNESDAY', label: 'MIERCOLES' },
  { value: 'THURSDAY', label: 'JUEVES' },
  { value: 'FRIDAY', label: 'VIERNES' },
  { value: 'SATURDAY', label: 'SABADO' },
  { value: 'SUNDAY', label: 'DOMINGO' },
];

const DAY_LABELS = Object.fromEntries(
  SHIFT_DAYS.map((day) => [day.value, day.label]),
);

const DAY_ORDER = Object.fromEntries(
  SHIFT_DAYS.map((day, index) => [day.value, index]),
);

const createEmptyForm = () => ({
  id_employee: '',
  days: ['MONDAY'],
  start_time: '08:00',
  end_time: '16:00',
  status: 'ACTIVE',
});

const formatTime = (value) => {
  if (!value) return '-';
  return String(value).slice(0, 5);
};

const timeToMinutes = (value) => {
  if (!value) return null;

  const [hours, minutes] = String(value)
    .slice(0, 5)
    .split(':')
    .map(Number);

  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes)
  ) {
    return null;
  }

  return hours * 60 + minutes;
};

const formatDuration = (minutes) => {
  if (
    minutes === null ||
    minutes === undefined ||
    Number.isNaN(Number(minutes))
  ) {
    return '-';
  }

  const total = Math.max(0, Number(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;

  if (hours === 0) return `${rest} min`;
  if (rest === 0) return `${hours} h`;

  return `${hours} h ${rest} min`;
};

const getDurationMinutes = (start, end) => {
  const startMinutes = timeToMinutes(start);
  const endMinutes = timeToMinutes(end);

  if (
    startMinutes === null ||
    endMinutes === null
  ) {
    return null;
  }

  return endMinutes - startMinutes;
};

const getInitials = (name) => {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!parts.length) return '?';

  return parts
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
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

const getShiftDay = (shift) =>
  String(
    shift?.day_of_week ||
      shift?.day ||
      '',
  ).toUpperCase();

const isActive = (value) =>
  String(value || '').toUpperCase() === 'ACTIVE';

const shiftsOverlap = (
  startA,
  endA,
  startB,
  endB,
) => {
  const startAMinutes = timeToMinutes(startA);
  const endAMinutes = timeToMinutes(endA);
  const startBMinutes = timeToMinutes(startB);
  const endBMinutes = timeToMinutes(endB);

  if (
    startAMinutes === null ||
    endAMinutes === null ||
    startBMinutes === null ||
    endBMinutes === null
  ) {
    return false;
  }

  return (
    startAMinutes < endBMinutes &&
    endAMinutes > startBMinutes
  );
};

function Shifts() {
  const [shifts, setShifts] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusChangingId, setStatusChangingId] =
    useState(null);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(createEmptyForm);
  const [formError, setFormError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [pageError, setPageError] = useState('');
  const [filters, setFilters] = useState({
    id_employee: '',
    day: '',
    status: '',
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

      const [employeesData, shiftsData] =
        await Promise.all([
          requestJson(
            `${API_URL}/api/employees`,
            {},
            'No se pudieron cargar los empleados',
          ),
          requestJson(
            `${API_URL}/api/shifts`,
            {},
            'No se pudieron cargar los turnos',
          ),
        ]);

      setEmployees(
        Array.isArray(employeesData)
          ? employeesData
          : [],
      );

      setShifts(
        Array.isArray(shiftsData)
          ? shiftsData
          : [],
      );
    } catch (error) {
      console.error(error);
      setPageError(
        error.message ||
          'No se pudo cargar la información de turnos',
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (!showForm) return undefined;

    const handleEscape = (event) => {
      if (event.key === 'Escape' && !saving) {
        resetForm();
      }
    };

    window.addEventListener(
      'keydown',
      handleEscape,
    );

    return () => {
      window.removeEventListener(
        'keydown',
        handleEscape,
      );
    };
  }, [showForm, saving]);

  const activeEmployees = useMemo(
    () =>
      employees.filter((employee) =>
        isActive(employee.status),
      ),
    [employees],
  );

  const employeeOptions = useMemo(() => {
    if (!editing) return activeEmployees;

    const selectedId = String(
      form.id_employee || '',
    );

    return employees.filter(
      (employee) =>
        isActive(employee.status) ||
        String(employee.id_employee) ===
          selectedId,
    );
  }, [
    activeEmployees,
    editing,
    employees,
    form.id_employee,
  ]);

  const selectedEmployee = useMemo(
    () =>
      employees.find(
        (employee) =>
          String(employee.id_employee) ===
          String(form.id_employee),
      ) || null,
    [employees, form.id_employee],
  );

  const durationMinutes = useMemo(
    () =>
      getDurationMinutes(
        form.start_time,
        form.end_time,
      ),
    [form.start_time, form.end_time],
  );

  const conflicts = useMemo(() => {
    if (
      !form.id_employee ||
      !form.start_time ||
      !form.end_time ||
      form.status !== 'ACTIVE' ||
      durationMinutes === null ||
      durationMinutes <= 0
    ) {
      return [];
    }

    const selectedDays = new Set(
      form.days.map((day) =>
        String(day).toUpperCase(),
      ),
    );

    return shifts.filter((shift) => {
      if (
        String(shift.id_employee) !==
        String(form.id_employee)
      ) {
        return false;
      }

      if (!isActive(shift.status)) {
        return false;
      }

      if (
        editing &&
        String(shift.id_shift) ===
          String(editing.id_shift)
      ) {
        return false;
      }

      const shiftDay = getShiftDay(shift);

      if (!selectedDays.has(shiftDay)) {
        return false;
      }

      return shiftsOverlap(
        form.start_time,
        form.end_time,
        shift.start_time,
        shift.end_time,
      );
    });
  }, [
    durationMinutes,
    editing,
    form.days,
    form.end_time,
    form.id_employee,
    form.start_time,
    form.status,
    shifts,
  ]);

  const filteredShifts = useMemo(() => {
    const searchText = search
      .trim()
      .toLowerCase();

    return shifts
      .filter((shift) => {
        if (
          filters.id_employee &&
          String(shift.id_employee) !==
            String(filters.id_employee)
        ) {
          return false;
        }

        if (
          filters.day &&
          getShiftDay(shift) !== filters.day
        ) {
          return false;
        }

        if (
          filters.status &&
          String(shift.status).toUpperCase() !==
            filters.status
        ) {
          return false;
        }

        if (!searchText) return true;

        const values = [
          shift.employee_name,
          shift.position_name,
          shift.status,
          getShiftDay(shift),
          DAY_LABELS[getShiftDay(shift)],
          formatTime(shift.start_time),
          formatTime(shift.end_time),
        ];

        return values.some((value) =>
          String(value || '')
            .toLowerCase()
            .includes(searchText),
        );
      })
      .sort((a, b) => {
        const employeeA = String(
          a.employee_name || '',
        ).localeCompare(
          String(b.employee_name || ''),
          'es',
        );

        if (employeeA !== 0) return employeeA;

        const dayA =
          DAY_ORDER[getShiftDay(a)] ?? 99;
        const dayB =
          DAY_ORDER[getShiftDay(b)] ?? 99;

        if (dayA !== dayB) {
          return dayA - dayB;
        }

        return String(a.start_time || '').localeCompare(
          String(b.start_time || ''),
        );
      });
  }, [filters, search, shifts]);

  const summary = useMemo(() => {
    const result = {
      total: filteredShifts.length,
      active: 0,
      inactive: 0,
      employees: new Set(),
      weeklyMinutes: 0,
    };

    filteredShifts.forEach((shift) => {
      if (isActive(shift.status)) {
        result.active += 1;

        const duration = getDurationMinutes(
          shift.start_time,
          shift.end_time,
        );

        if (duration !== null && duration > 0) {
          result.weeklyMinutes += duration;
        }
      } else {
        result.inactive += 1;
      }

      if (shift.id_employee) {
        result.employees.add(
          String(shift.id_employee),
        );
      }
    });

    return {
      total: result.total,
      active: result.active,
      inactive: result.inactive,
      employees: result.employees.size,
      weeklyMinutes: result.weeklyMinutes,
    };
  }, [filteredShifts]);

  const resetForm = () => {
    setShowForm(false);
    setEditing(null);
    setForm(createEmptyForm());
    setFormError('');
  };

  const openNewShift = () => {
    setEditing(null);
    setForm(createEmptyForm());
    setFormError('');
    setFeedback('');
    setShowForm(true);
  };

  const handleChange = (event) => {
    const { name, value } = event.target;

    setFormError('');

    setForm((current) => ({
      ...current,
      [name]: value,
    }));
  };

  const handleDayChange = (event) => {
    const { value, checked } = event.target;

    if (editing) {
      if (checked) {
        setForm((current) => ({
          ...current,
          days: [value],
        }));
      }

      return;
    }

    setFormError('');

    setForm((current) => {
      const nextDays = checked
        ? Array.from(
            new Set([...current.days, value]),
          )
        : current.days.filter(
            (day) => day !== value,
          );

      return {
        ...current,
        days: SHIFT_DAYS.map(
          (day) => day.value,
        ).filter((day) =>
          nextDays.includes(day),
        ),
      };
    });
  };

  const selectWeekdays = () => {
    if (editing) return;

    setFormError('');

    setForm((current) => ({
      ...current,
      days: [
        'MONDAY',
        'TUESDAY',
        'WEDNESDAY',
        'THURSDAY',
        'FRIDAY',
      ],
    }));
  };

  const selectAllDays = () => {
    if (editing) return;

    setFormError('');

    setForm((current) => ({
      ...current,
      days: SHIFT_DAYS.map(
        (day) => day.value,
      ),
    }));
  };

  const clearDays = () => {
    if (editing) return;

    setFormError('');

    setForm((current) => ({
      ...current,
      days: [],
    }));
  };

  const validateForm = () => {
    if (!form.id_employee) {
      return 'Seleccione un empleado';
    }

    if (!selectedEmployee) {
      return 'El empleado seleccionado no existe';
    }

    if (form.days.length === 0) {
      return 'Seleccione al menos un día';
    }

    const invalidDay = form.days.find(
      (day) => !DAY_LABELS[day],
    );

    if (invalidDay) {
      return 'Uno de los días seleccionados no es válido';
    }

    if (!form.start_time) {
      return 'Ingrese la hora de entrada';
    }

    if (!form.end_time) {
      return 'Ingrese la hora de salida';
    }

    if (
      durationMinutes === null ||
      durationMinutes <= 0
    ) {
      return 'La hora de salida debe ser posterior a la hora de entrada';
    }

    if (durationMinutes > 16 * 60) {
      return 'Un turno no puede superar 16 horas';
    }

    if (
      form.status === 'ACTIVE' &&
      !isActive(selectedEmployee.status)
    ) {
      return 'No se puede asignar un turno activo a un empleado inactivo';
    }

    if (conflicts.length > 0) {
      const firstConflict = conflicts[0];
      const day = getShiftDay(firstConflict);

      return `Existe un conflicto el ${
        DAY_LABELS[day] || day
      } con el turno ${formatTime(
        firstConflict.start_time,
      )} - ${formatTime(
        firstConflict.end_time,
      )}`;
    }

    return '';
  };

  const saveSingleShift = async ({
    idEmployee,
    day,
    startTime,
    endTime,
    status,
  }) => {
    return requestJson(
      `${API_URL}/api/shifts`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id_employee: Number(idEmployee),
          day,
          start_time: startTime,
          end_time: endTime,
          status,
        }),
      },
      `No se pudo registrar el turno del ${
        DAY_LABELS[day] || day
      }`,
    );
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
      setFormError('');
      setFeedback('');

      if (editing) {
        const day = form.days[0];

        await requestJson(
          `${API_URL}/api/shifts/${editing.id_shift}`,
          {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              id_employee: Number(
                form.id_employee,
              ),
              day,
              start_time: form.start_time,
              end_time: form.end_time,
              status: form.status,
            }),
          },
          'No se pudo actualizar el turno',
        );

        resetForm();
        setFeedback(
          'Turno actualizado correctamente',
        );
        await loadData();
        return;
      }

      let created = 0;

      for (const day of form.days) {
        try {
          await saveSingleShift({
            idEmployee: form.id_employee,
            day,
            startTime: form.start_time,
            endTime: form.end_time,
            status: form.status,
          });

          created += 1;
        } catch (error) {
          if (created > 0) {
            await loadData();

            throw new Error(
              `Se registraron ${created} de ${form.days.length} turnos. No se pudo completar el ${
                DAY_LABELS[day] || day
              }: ${error.message}`,
            );
          }

          throw error;
        }
      }

      resetForm();
      setFeedback(
        created === 1
          ? 'Turno registrado correctamente'
          : `${created} turnos registrados correctamente`,
      );
      await loadData();
    } catch (error) {
      console.error(error);
      setFormError(
        error.message ||
          'No se pudo guardar el turno',
      );
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (shift) => {
    const dayValue =
      getShiftDay(shift) || 'MONDAY';

    setEditing(shift);
    setFeedback('');
    setFormError('');

    setForm({
      id_employee: String(
        shift.id_employee || '',
      ),
      days: [dayValue],
      start_time:
        formatTime(shift.start_time) === '-'
          ? '08:00'
          : formatTime(shift.start_time),
      end_time:
        formatTime(shift.end_time) === '-'
          ? '16:00'
          : formatTime(shift.end_time),
      status: isActive(shift.status)
        ? 'ACTIVE'
        : 'INACTIVE',
    });

    setShowForm(true);
  };

  const handleToggleStatus = async (shift) => {
    const nextStatus = isActive(shift.status)
      ? 'INACTIVE'
      : 'ACTIVE';

    const action =
      nextStatus === 'ACTIVE'
        ? 'activar'
        : 'inactivar';

    const confirmed = window.confirm(
      `¿Desea ${action} este turno?`,
    );

    if (!confirmed) return;

    try {
      setStatusChangingId(shift.id_shift);
      setPageError('');
      setFeedback('');

      await requestJson(
        `${API_URL}/api/shifts/${shift.id_shift}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            id_employee: Number(
              shift.id_employee,
            ),
            day: getShiftDay(shift),
            start_time: formatTime(
              shift.start_time,
            ),
            end_time: formatTime(
              shift.end_time,
            ),
            status: nextStatus,
          }),
        },
        `No se pudo ${action} el turno`,
      );

      setFeedback(
        nextStatus === 'ACTIVE'
          ? 'Turno activado correctamente'
          : 'Turno inactivado correctamente',
      );

      await loadData();
    } catch (error) {
      console.error(error);
      setPageError(
        error.message ||
          `No se pudo ${action} el turno`,
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
      id_employee: '',
      day: '',
      status: '',
    });
    setSearch('');
  };

  const statCardStyle = {
    background: '#121212',
    border: '1px solid #292929',
    borderRadius: '12px',
    padding: '18px 20px',
    minWidth: '150px',
    flex: '1 1 160px',
  };

  const statLabelStyle = {
    color: '#777777',
    fontSize: '11px',
    textTransform: 'uppercase',
    letterSpacing: '1px',
    marginBottom: '8px',
  };

  const statValueStyle = {
    color: '#ffffff',
    fontSize: '25px',
    fontWeight: '700',
  };

  const filterInputStyle = {
    minWidth: '160px',
    padding: '10px 12px',
    background: '#1a1a1a',
    border: '1px solid #333333',
    borderRadius: '8px',
    color: '#ffffff',
    outline: 'none',
  };

  return (
    <div className="employees-page">
      <Sidebar />

      <main className="employees-content">
        <header className="employees-header">
          <div>
            <span>RECURSOS HUMANOS</span>
            <h1>Turnos</h1>
            <p>
              Asigna horarios laborales y evita conflictos de turnos
            </p>
          </div>

          <button
            type="button"
            className="new-employee-button"
            onClick={openNewShift}
            disabled={
              loading ||
              activeEmployees.length === 0
            }
          >
            + Nuevo turno
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

        {activeEmployees.length === 0 &&
          !loading && (
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
                fontSize: '13px',
              }}
            >
              No hay empleados activos disponibles para asignar nuevos turnos.
            </div>
          )}

        <section
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '14px',
            marginBottom: '20px',
          }}
        >
          <div style={statCardStyle}>
            <div style={statLabelStyle}>
              Turnos mostrados
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
              Personal con turno
            </div>
            <div style={statValueStyle}>
              {summary.employees}
            </div>
          </div>

          <div style={statCardStyle}>
            <div style={statLabelStyle}>
              Horas semanales
            </div>
            <div style={statValueStyle}>
              {formatDuration(
                summary.weeklyMinutes,
              )}
            </div>
          </div>
        </section>

        <section
          className="employees-panel"
          style={{ marginBottom: '20px' }}
        >
          <div
            style={{
              padding: '20px 25px',
              borderBottom: '1px solid #292929',
            }}
          >
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'end',
                gap: '12px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  flex: '1 1 220px',
                }}
              >
                <label
                  style={{
                    color: '#888888',
                    fontSize: '11px',
                  }}
                >
                  Empleado
                </label>

                <select
                  name="id_employee"
                  value={filters.id_employee}
                  onChange={handleFilterChange}
                  style={{
                    ...filterInputStyle,
                    width: '100%',
                  }}
                >
                  <option value="">
                    Todos los empleados
                  </option>

                  {employees.map((employee) => (
                    <option
                      key={employee.id_employee}
                      value={employee.id_employee}
                    >
                      {employee.first_name}{' '}
                      {employee.last_name}
                      {employee.status ===
                      'INACTIVE'
                        ? ' - Inactivo'
                        : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                }}
              >
                <label
                  style={{
                    color: '#888888',
                    fontSize: '11px',
                  }}
                >
                  Día
                </label>

                <select
                  name="day"
                  value={filters.day}
                  onChange={handleFilterChange}
                  style={filterInputStyle}
                >
                  <option value="">
                    Todos los días
                  </option>

                  {SHIFT_DAYS.map((day) => (
                    <option
                      key={day.value}
                      value={day.value}
                    >
                      {day.label}
                    </option>
                  ))}
                </select>
              </div>

              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                }}
              >
                <label
                  style={{
                    color: '#888888',
                    fontSize: '11px',
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
              <h2>Horarios del personal</h2>
              <p>
                {filteredShifts.length}{' '}
                turno
                {filteredShifts.length === 1
                  ? ''
                  : 's'}{' '}
                encontrados
              </p>
            </div>

            <input
              type="text"
              className="search-input"
              value={search}
              onChange={(event) =>
                setSearch(event.target.value)
              }
              placeholder="Buscar empleado, cargo, día u horario..."
            />
          </div>

          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Empleado</th>
                  <th>Cargo</th>
                  <th>Día</th>
                  <th>Entrada</th>
                  <th>Salida</th>
                  <th>Duración</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>

              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan="8">
                      Cargando...
                    </td>
                  </tr>
                ) : filteredShifts.length ===
                  0 ? (
                  <tr>
                    <td colSpan="8">
                      No hay turnos para mostrar.
                    </td>
                  </tr>
                ) : (
                  filteredShifts.map(
                    (shift) => {
                      const day =
                        getShiftDay(shift);

                      const duration =
                        getDurationMinutes(
                          shift.start_time,
                          shift.end_time,
                        );

                      const employeeName =
                        shift.employee_name ||
                        'Sin empleado';

                      const employeeIsInactive =
                        String(
                          shift.employee_status ||
                            '',
                        ).toUpperCase() ===
                        'INACTIVE';

                      return (
                        <tr
                          key={shift.id_shift}
                        >
                          <td>
                            <div className="employee-name">
                              <div className="employee-avatar">
                                {getInitials(
                                  employeeName,
                                )}
                              </div>

                              <div>
                                <strong>
                                  {employeeName}
                                </strong>
                                <span>
                                  {employeeIsInactive
                                    ? 'Empleado inactivo'
                                    : 'Empleado activo'}
                                </span>
                              </div>
                            </div>
                          </td>

                          <td>
                            {shift.position_name ||
                              '-'}
                          </td>

                          <td>
                            {DAY_LABELS[day] ||
                              day ||
                              '-'}
                          </td>

                          <td>
                            {formatTime(
                              shift.start_time,
                            )}
                          </td>

                          <td>
                            {formatTime(
                              shift.end_time,
                            )}
                          </td>

                          <td>
                            {formatDuration(
                              duration,
                            )}
                          </td>

                          <td>
                            <span
                              className={`status ${
                                isActive(
                                  shift.status,
                                )
                                  ? 'active'
                                  : 'inactive'
                              }`}
                            >
                              {isActive(
                                shift.status,
                              )
                                ? 'Activo'
                                : 'Inactivo'}
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
                                  handleEdit(
                                    shift,
                                  )
                                }
                                disabled={
                                  statusChangingId ===
                                  shift.id_shift
                                }
                              >
                                Editar
                              </button>

                              <button
                                type="button"
                                className="action-button"
                                onClick={() =>
                                  handleToggleStatus(
                                    shift,
                                  )
                                }
                                disabled={
                                  statusChangingId ===
                                  shift.id_shift
                                }
                              >
                                {statusChangingId ===
                                shift.id_shift
                                  ? 'Guardando...'
                                  : isActive(
                                        shift.status,
                                      )
                                    ? 'Inactivar'
                                    : 'Activar'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    },
                  )
                )}
              </tbody>
            </table>
          </div>
        </section>

        {showForm && (
          <div
            className="modal-background"
            onClick={() => {
              if (!saving) resetForm();
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
                  <span>RRHH</span>
                  <h2>
                    {editing
                      ? 'Editar turno'
                      : 'Nuevo turno'}
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
                    marginBottom: '18px',
                    padding: '12px 14px',
                    borderRadius: '8px',
                    border:
                      '1px solid rgba(224, 0, 45, 0.35)',
                    background:
                      'rgba(224, 0, 45, 0.10)',
                    color: '#ff6b82',
                    fontSize: '12px',
                  }}
                >
                  {formError}
                </div>
              )}

              <form onSubmit={handleSubmit}>
                <div className="form-grid">
                  <div className="form-group">
                    <label htmlFor="shift-employee">
                      Empleado
                    </label>

                    <select
                      id="shift-employee"
                      name="id_employee"
                      value={form.id_employee}
                      onChange={handleChange}
                      required
                      disabled={saving}
                    >
                      <option value="">
                        Seleccione un empleado
                      </option>

                      {employeeOptions.map(
                        (employee) => (
                          <option
                            key={
                              employee.id_employee
                            }
                            value={
                              employee.id_employee
                            }
                          >
                            {
                              employee.first_name
                            }{' '}
                            {
                              employee.last_name
                            }
                            {employee.position_name
                              ? ` - ${employee.position_name}`
                              : ''}
                            {employee.status ===
                            'INACTIVE'
                              ? ' - Inactivo'
                              : ''}
                          </option>
                        ),
                      )}
                    </select>
                  </div>

                  <div className="form-group">
                    <label htmlFor="shift-status">
                      Estado
                    </label>

                    <select
                      id="shift-status"
                      name="status"
                      value={form.status}
                      onChange={handleChange}
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

                  {selectedEmployee && (
                    <div
                      className="form-group"
                      style={{
                        gridColumn:
                          '1 / -1',
                      }}
                    >
                      <div
                        style={{
                          padding:
                            '13px 15px',
                          border:
                            '1px solid #333333',
                          borderRadius:
                            '8px',
                          background:
                            '#1a1a1a',
                          display:
                            'flex',
                          flexWrap:
                            'wrap',
                          gap: '18px',
                        }}
                      >
                        <div>
                          <span
                            style={{
                              display:
                                'block',
                              color:
                                '#777777',
                              fontSize:
                                '10px',
                              marginBottom:
                                '4px',
                              textTransform:
                                'uppercase',
                            }}
                          >
                            Empleado
                          </span>
                          <strong
                            style={{
                              fontSize:
                                '12px',
                            }}
                          >
                            {
                              selectedEmployee.first_name
                            }{' '}
                            {
                              selectedEmployee.last_name
                            }
                          </strong>
                        </div>

                        <div>
                          <span
                            style={{
                              display:
                                'block',
                              color:
                                '#777777',
                              fontSize:
                                '10px',
                              marginBottom:
                                '4px',
                              textTransform:
                                'uppercase',
                            }}
                          >
                            Cargo
                          </span>
                          <strong
                            style={{
                              fontSize:
                                '12px',
                            }}
                          >
                            {selectedEmployee.position_name ||
                              '-'}
                          </strong>
                        </div>

                        <div>
                          <span
                            style={{
                              display:
                                'block',
                              color:
                                '#777777',
                              fontSize:
                                '10px',
                              marginBottom:
                                '4px',
                              textTransform:
                                'uppercase',
                            }}
                          >
                            Estado
                          </span>
                          <strong
                            style={{
                              fontSize:
                                '12px',
                              color:
                                isActive(
                                  selectedEmployee.status,
                                )
                                  ? '#5cc98a'
                                  : '#ff6b82',
                            }}
                          >
                            {isActive(
                              selectedEmployee.status,
                            )
                              ? 'Activo'
                              : 'Inactivo'}
                          </strong>
                        </div>
                      </div>
                    </div>
                  )}

                  <div
                    className="form-group"
                    style={{
                      gridColumn: '1 / -1',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems:
                          'center',
                        justifyContent:
                          'space-between',
                        gap: '12px',
                        marginBottom:
                          '8px',
                        flexWrap:
                          'wrap',
                      }}
                    >
                      <span className="form-label">
                        Días
                      </span>

                      {!editing && (
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
                            onClick={
                              selectWeekdays
                            }
                            disabled={saving}
                          >
                            Lun - Vie
                          </button>

                          <button
                            type="button"
                            className="action-button"
                            onClick={
                              selectAllDays
                            }
                            disabled={saving}
                          >
                            Todos
                          </button>

                          <button
                            type="button"
                            className="action-button"
                            onClick={
                              clearDays
                            }
                            disabled={saving}
                          >
                            Limpiar
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="checkbox-group">
                      {SHIFT_DAYS.map(
                        (day) => (
                          <label
                            key={day.value}
                          >
                            <input
                              type="checkbox"
                              value={
                                day.value
                              }
                              checked={form.days.includes(
                                day.value,
                              )}
                              onChange={
                                handleDayChange
                              }
                              disabled={
                                saving ||
                                (Boolean(
                                  editing,
                                ) &&
                                  form.days[0] !==
                                    day.value)
                              }
                            />
                            {day.label}
                          </label>
                        ),
                      )}
                    </div>

                    {!editing && (
                      <span
                        style={{
                          color:
                            '#777777',
                          fontSize: '10px',
                          marginTop:
                            '7px',
                        }}
                      >
                        Se creará un turno independiente por cada día seleccionado.
                      </span>
                    )}
                  </div>

                  <div className="form-group">
                    <label htmlFor="shift-entry">
                      Hora de entrada
                    </label>

                    <input
                      id="shift-entry"
                      type="time"
                      name="start_time"
                      value={form.start_time}
                      onChange={handleChange}
                      required
                      disabled={saving}
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="shift-exit">
                      Hora de salida
                    </label>

                    <input
                      id="shift-exit"
                      type="time"
                      name="end_time"
                      value={form.end_time}
                      onChange={handleChange}
                      required
                      disabled={saving}
                    />
                  </div>

                  <div
                    className="form-group"
                    style={{
                      gridColumn: '1 / -1',
                    }}
                  >
                    <div
                      style={{
                        padding:
                          '14px 16px',
                        background:
                          '#1a1a1a',
                        border:
                          `1px solid ${
                            conflicts.length >
                            0
                              ? 'rgba(224, 0, 45, 0.55)'
                              : '#333333'
                          }`,
                        borderRadius:
                          '8px',
                        display: 'grid',
                        gridTemplateColumns:
                          'repeat(auto-fit, minmax(145px, 1fr))',
                        gap: '12px',
                      }}
                    >
                      <div>
                        <span
                          style={{
                            display:
                              'block',
                            color:
                              '#777777',
                            fontSize:
                              '10px',
                            marginBottom:
                              '5px',
                            textTransform:
                              'uppercase',
                          }}
                        >
                          Duración
                        </span>
                        <strong>
                          {durationMinutes !==
                            null &&
                          durationMinutes > 0
                            ? formatDuration(
                                durationMinutes,
                              )
                            : '-'}
                        </strong>
                      </div>

                      <div>
                        <span
                          style={{
                            display:
                              'block',
                            color:
                              '#777777',
                            fontSize:
                              '10px',
                            marginBottom:
                              '5px',
                            textTransform:
                              'uppercase',
                          }}
                        >
                          Días seleccionados
                        </span>
                        <strong>
                          {
                            form.days
                              .length
                          }
                        </strong>
                      </div>

                      <div>
                        <span
                          style={{
                            display:
                              'block',
                            color:
                              '#777777',
                            fontSize:
                              '10px',
                            marginBottom:
                              '5px',
                            textTransform:
                              'uppercase',
                          }}
                        >
                          Horas semanales
                        </span>
                        <strong>
                          {durationMinutes !==
                            null &&
                          durationMinutes > 0
                            ? formatDuration(
                                durationMinutes *
                                  form.days
                                    .length,
                              )
                            : '-'}
                        </strong>
                      </div>

                      <div>
                        <span
                          style={{
                            display:
                              'block',
                            color:
                              '#777777',
                            fontSize:
                              '10px',
                            marginBottom:
                              '5px',
                            textTransform:
                              'uppercase',
                          }}
                        >
                          Conflictos
                        </span>
                        <strong
                          style={{
                            color:
                              conflicts.length >
                              0
                                ? '#ff6b82'
                                : '#5cc98a',
                          }}
                        >
                          {conflicts.length}
                        </strong>
                      </div>
                    </div>
                  </div>

                  {conflicts.length > 0 && (
                    <div
                      className="form-group"
                      style={{
                        gridColumn:
                          '1 / -1',
                      }}
                    >
                      <div
                        style={{
                          padding:
                            '13px 15px',
                          border:
                            '1px solid rgba(224, 0, 45, 0.35)',
                          borderRadius:
                            '8px',
                          background:
                            'rgba(224, 0, 45, 0.08)',
                          color:
                            '#ff8798',
                          fontSize:
                            '12px',
                        }}
                      >
                        <strong>
                          Conflictos detectados:
                        </strong>

                        <div
                          style={{
                            marginTop:
                              '8px',
                            display:
                              'flex',
                            flexDirection:
                              'column',
                            gap: '5px',
                          }}
                        >
                          {conflicts.map(
                            (conflict) => {
                              const day =
                                getShiftDay(
                                  conflict,
                                );

                              return (
                                <span
                                  key={
                                    conflict.id_shift
                                  }
                                >
                                  {DAY_LABELS[
                                    day
                                  ] ||
                                    day}
                                  :{' '}
                                  {formatTime(
                                    conflict.start_time,
                                  )}{' '}
                                  -{' '}
                                  {formatTime(
                                    conflict.end_time,
                                  )}
                                </span>
                              );
                            },
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

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
                      form.days.length ===
                        0 ||
                      conflicts.length >
                        0 ||
                      durationMinutes ===
                        null ||
                      durationMinutes <=
                        0 ||
                      (form.status ===
                        'ACTIVE' &&
                        selectedEmployee &&
                        !isActive(
                          selectedEmployee.status,
                        ))
                    }
                  >
                    {saving
                      ? 'Guardando...'
                      : editing
                        ? 'Guardar cambios'
                        : form.days.length >
                            1
                          ? `Guardar ${form.days.length} turnos`
                          : 'Guardar turno'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default Shifts;
