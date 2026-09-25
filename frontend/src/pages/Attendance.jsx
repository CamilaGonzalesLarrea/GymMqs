import { useEffect, useMemo, useState } from 'react';
import Sidebar from '../components/Sidebar';
import { API_URL } from '../config/api';
import './Employees.css';

const DAY_LABELS = {
  MONDAY: 'LUNES',
  TUESDAY: 'MARTES',
  WEDNESDAY: 'MIERCOLES',
  THURSDAY: 'JUEVES',
  FRIDAY: 'VIERNES',
  SATURDAY: 'SABADO',
  SUNDAY: 'DOMINGO',
};

const DAY_BY_INDEX = [
  'SUNDAY',
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
];

const getLocalDateString = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
};

const createEmptyForm = () => ({
  id_employee: '',
  id_shift: '',
  attendance_date: getLocalDateString(),
  check_in: '08:00',
  check_out: '',
  notes: '',
});

const formatTime = (value) => {
  if (!value) return '-';
  return String(value).slice(0, 5);
};

const formatDate = (value) => {
  if (!value) return '-';

  const normalized = String(value).slice(0, 10);
  const parts = normalized.split('-');

  if (parts.length !== 3) return normalized;

  return `${parts[2]}/${parts[1]}/${parts[0]}`;
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

const minutesDifference = (start, end) => {
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

  if (hours === 0) {
    return `${rest} min`;
  }

  if (rest === 0) {
    return `${hours} h`;
  }

  return `${hours} h ${rest} min`;
};

const getDayFromDate = (value) => {
  if (!value) return '';

  const [year, month, day] = String(value)
    .slice(0, 10)
    .split('-')
    .map(Number);

  if (!year || !month || !day) return '';

  const weekday = new Date(
    Date.UTC(year, month - 1, day, 12, 0, 0),
  ).getUTCDay();

  return DAY_BY_INDEX[weekday] || '';
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

const parseResponse = async (response) => {
  const text = await response.text();

  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
};

const getAttendanceMetrics = (record) => {
  const shiftStart =
    record.shift_start_time ||
    record.start_time ||
    null;

  const shiftEnd =
    record.shift_end_time ||
    record.end_time ||
    null;

  const entry =
    record.entry_time ||
    record.check_in ||
    null;

  const exit =
    record.exit_time ||
    record.check_out ||
    null;

  let lateMinutes =
    record.late_minutes !== null &&
    record.late_minutes !== undefined
      ? Number(record.late_minutes)
      : null;

  let workedMinutes =
    record.worked_minutes !== null &&
    record.worked_minutes !== undefined
      ? Number(record.worked_minutes)
      : null;

  let scheduledMinutes =
    record.scheduled_minutes !== null &&
    record.scheduled_minutes !== undefined
      ? Number(record.scheduled_minutes)
      : null;

  let overtimeMinutes =
    record.overtime_minutes !== null &&
    record.overtime_minutes !== undefined
      ? Number(record.overtime_minutes)
      : null;

  if (lateMinutes === null && shiftStart && entry) {
    const difference = minutesDifference(
      shiftStart,
      entry,
    );

    lateMinutes =
      difference === null
        ? null
        : Math.max(0, difference);
  }

  if (workedMinutes === null && entry && exit) {
    const difference = minutesDifference(
      entry,
      exit,
    );

    workedMinutes =
      difference === null
        ? null
        : Math.max(0, difference);
  }

  if (
    scheduledMinutes === null &&
    shiftStart &&
    shiftEnd
  ) {
    const difference = minutesDifference(
      shiftStart,
      shiftEnd,
    );

    scheduledMinutes =
      difference === null
        ? null
        : Math.max(0, difference);
  }

  if (
    overtimeMinutes === null &&
    workedMinutes !== null &&
    scheduledMinutes !== null
  ) {
    overtimeMinutes = Math.max(
      0,
      workedMinutes - scheduledMinutes,
    );
  }

  return {
    lateMinutes,
    workedMinutes,
    scheduledMinutes,
    overtimeMinutes,
    punctuality:
      lateMinutes === null
        ? 'SIN_DATOS'
        : lateMinutes > 0
          ? 'LATE'
          : 'ON_TIME',
  };
};

function Attendance() {
  const [attendance, setAttendance] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(createEmptyForm);
  const [formError, setFormError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [pageError, setPageError] = useState('');
  const [filters, setFilters] = useState({
    id_employee: '',
    date_from: '',
    date_to: '',
  });

  const today = getLocalDateString();

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

  const loadInitialData = async () => {
    try {
      setLoading(true);
      setPageError('');

      const [
        employeesData,
        shiftsData,
        attendanceData,
      ] = await Promise.all([
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
        requestJson(
          `${API_URL}/api/employee-attendance`,
          {},
          'No se pudo cargar el historial de asistencia',
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

      setAttendance(
        Array.isArray(attendanceData)
          ? attendanceData
          : [],
      );
    } catch (error) {
      console.error(error);
      setPageError(
        error.message ||
          'No se pudo cargar la información de asistencia',
      );
    } finally {
      setLoading(false);
    }
  };

  const loadAttendance = async (
    appliedFilters = filters,
  ) => {
    try {
      setLoading(true);
      setPageError('');

      const params = new URLSearchParams();

      if (appliedFilters.id_employee) {
        params.set(
          'id_employee',
          appliedFilters.id_employee,
        );
      }

      if (appliedFilters.date_from) {
        params.set(
          'date_from',
          appliedFilters.date_from,
        );
      }

      if (appliedFilters.date_to) {
        params.set(
          'date_to',
          appliedFilters.date_to,
        );
      }

      const query = params.toString();
      const url = query
        ? `${API_URL}/api/employee-attendance?${query}`
        : `${API_URL}/api/employee-attendance`;

      const data = await requestJson(
        url,
        {},
        'No se pudo cargar el historial de asistencia',
      );

      setAttendance(
        Array.isArray(data) ? data : [],
      );
    } catch (error) {
      console.error(error);
      setPageError(
        error.message ||
          'No se pudo cargar el historial de asistencia',
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInitialData();
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
      employees.filter(
        (employee) =>
          String(
            employee.status || 'ACTIVE',
          ).toUpperCase() === 'ACTIVE',
      ),
    [employees],
  );

  const employeeOptions = useMemo(() => {
    if (!editing) {
      return activeEmployees;
    }

    const selectedId = String(
      form.id_employee || '',
    );

    return employees.filter(
      (employee) =>
        String(employee.status).toUpperCase() ===
          'ACTIVE' ||
        String(employee.id_employee) === selectedId,
    );
  }, [
    activeEmployees,
    editing,
    employees,
    form.id_employee,
  ]);

  const availableShifts = useMemo(() => {
    if (!form.id_employee) return [];

    return shifts.filter((shift) => {
      const sameEmployee =
        String(shift.id_employee) ===
        String(form.id_employee);

      if (!sameEmployee) return false;

      const isActive =
        String(
          shift.status || 'ACTIVE',
        ).toUpperCase() === 'ACTIVE';

      if (!editing) {
        return isActive;
      }

      return (
        isActive ||
        String(shift.id_shift) ===
          String(form.id_shift)
      );
    });
  }, [
    editing,
    form.id_employee,
    form.id_shift,
    shifts,
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

  const selectedShift = useMemo(
    () =>
      shifts.find(
        (shift) =>
          String(shift.id_shift) ===
          String(form.id_shift),
      ) || null,
    [shifts, form.id_shift],
  );

  const formMetrics = useMemo(() => {
    if (!selectedShift) {
      return {
        lateMinutes: null,
        workedMinutes: null,
        scheduledMinutes: null,
        overtimeMinutes: null,
        punctuality: 'SIN_DATOS',
      };
    }

    return getAttendanceMetrics({
      shift_start_time: selectedShift.start_time,
      shift_end_time: selectedShift.end_time,
      entry_time: form.check_in,
      exit_time: form.check_out || null,
    });
  }, [
    selectedShift,
    form.check_in,
    form.check_out,
  ]);

  const filteredAttendance = useMemo(() => {
    const normalizedSearch = search
      .trim()
      .toLowerCase();

    if (!normalizedSearch) {
      return attendance;
    }

    return attendance.filter((record) => {
      const values = [
        record.employee_name,
        record.position_name,
        record.date,
        formatDate(record.date),
        record.notes,
        DAY_LABELS[
          record.shift_day ||
            record.day ||
            record.day_of_week
        ],
      ];

      return values.some((value) =>
        String(value || '')
          .toLowerCase()
          .includes(normalizedSearch),
      );
    });
  }, [attendance, search]);

  const summary = useMemo(() => {
    return filteredAttendance.reduce(
      (result, record) => {
        const metrics =
          getAttendanceMetrics(record);

        result.total += 1;

        if (
          record.exit_time ||
          record.check_out
        ) {
          result.completed += 1;
        }

        if (metrics.lateMinutes !== null) {
          if (metrics.lateMinutes > 0) {
            result.late += 1;
          } else {
            result.onTime += 1;
          }
        }

        if (metrics.workedMinutes !== null) {
          result.workedMinutes +=
            metrics.workedMinutes;
        }

        return result;
      },
      {
        total: 0,
        completed: 0,
        late: 0,
        onTime: 0,
        workedMinutes: 0,
      },
    );
  }, [filteredAttendance]);

  const resetForm = () => {
    setShowForm(false);
    setEditing(null);
    setForm(createEmptyForm());
    setFormError('');
  };

  const openNewAttendance = () => {
    setEditing(null);
    setForm(createEmptyForm());
    setFormError('');
    setFeedback('');
    setShowForm(true);
  };

  const handleChange = (event) => {
    const { name, value } = event.target;

    setFormError('');

    if (name === 'id_employee') {
      setForm((current) => ({
        ...current,
        id_employee: value,
        id_shift: '',
      }));

      return;
    }

    if (name === 'id_shift') {
      const shift = shifts.find(
        (item) =>
          String(item.id_shift) ===
          String(value),
      );

      setForm((current) => ({
        ...current,
        id_shift: value,
        check_in: shift?.start_time
          ? formatTime(shift.start_time)
          : current.check_in,
      }));

      return;
    }

    setForm((current) => ({
      ...current,
      [name]: value,
    }));
  };

  const validateForm = () => {
    if (!form.id_employee) {
      return 'Seleccione un empleado';
    }

    if (!form.id_shift) {
      return 'Seleccione un turno';
    }

    if (!form.attendance_date) {
      return 'Seleccione la fecha de asistencia';
    }

    if (!form.check_in) {
      return 'Ingrese la hora de entrada';
    }

    if (form.attendance_date > today) {
      return 'No se puede registrar una asistencia con fecha futura';
    }

    if (!selectedEmployee) {
      return 'El empleado seleccionado no existe';
    }

    if (
      !editing &&
      String(
        selectedEmployee.status,
      ).toUpperCase() !== 'ACTIVE'
    ) {
      return 'No se puede registrar asistencia para un empleado inactivo';
    }

    if (
      selectedEmployee.hire_date &&
      String(selectedEmployee.hire_date).slice(
        0,
        10,
      ) > form.attendance_date
    ) {
      return 'La asistencia no puede ser anterior a la fecha de contratación del empleado';
    }

    if (!selectedShift) {
      return 'El turno seleccionado no existe';
    }

    if (
      String(selectedShift.id_employee) !==
      String(form.id_employee)
    ) {
      return 'El turno seleccionado no pertenece al empleado';
    }

    if (
      !editing &&
      String(
        selectedShift.status,
      ).toUpperCase() !== 'ACTIVE'
    ) {
      return 'El turno seleccionado está inactivo';
    }

    const shiftDay =
      selectedShift.day ||
      selectedShift.day_of_week ||
      '';

    const attendanceDay = getDayFromDate(
      form.attendance_date,
    );

    if (
      shiftDay &&
      attendanceDay &&
      String(shiftDay).toUpperCase() !==
        attendanceDay
    ) {
      return `La fecha seleccionada corresponde a ${
        DAY_LABELS[attendanceDay] ||
        attendanceDay
      }, pero el turno es de ${
        DAY_LABELS[
          String(shiftDay).toUpperCase()
        ] || shiftDay
      }`;
    }

    if (form.check_out) {
      const entryMinutes = timeToMinutes(
        form.check_in,
      );

      const exitMinutes = timeToMinutes(
        form.check_out,
      );

      if (
        entryMinutes !== null &&
        exitMinutes !== null &&
        exitMinutes < entryMinutes
      ) {
        return 'La hora de salida no puede ser anterior a la hora de entrada';
      }
    }

    if (
      String(form.notes || '').length > 1000
    ) {
      return 'Las notas no pueden superar 1000 caracteres';
    }

    const duplicate = attendance.find(
      (record) =>
        String(record.id_employee) ===
          String(form.id_employee) &&
        String(record.id_shift) ===
          String(form.id_shift) &&
        String(
          record.date ||
            record.attendance_date ||
            '',
        ).slice(0, 10) ===
          form.attendance_date &&
        String(
          record.id_employee_attendance,
        ) !==
          String(
            editing?.id_employee_attendance ||
              '',
          ),
    );

    if (duplicate) {
      return 'Ya existe una asistencia para este empleado, turno y fecha';
    }

    return '';
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

      const url = editing
        ? `${API_URL}/api/employee-attendance/${editing.id_employee_attendance}`
        : `${API_URL}/api/employee-attendance`;

      const method = editing ? 'PUT' : 'POST';

      const payload = {
        id_employee: Number(form.id_employee),
        id_shift: Number(form.id_shift),
        date: form.attendance_date,
        attendance_date:
          form.attendance_date,
        entry_time: form.check_in,
        check_in: form.check_in,
        exit_time: form.check_out || null,
        check_out: form.check_out || null,
        notes: form.notes.trim() || null,
      };

      await requestJson(
        url,
        {
          method,
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        },
        editing
          ? 'No se pudo actualizar la asistencia'
          : 'No se pudo registrar la asistencia',
      );

      const message = editing
        ? 'Asistencia actualizada correctamente'
        : 'Asistencia registrada correctamente';

      resetForm();
      setFeedback(message);
      await loadAttendance(filters);
    } catch (error) {
      console.error(error);
      setFormError(
        error.message ||
          'No se pudo guardar la asistencia',
      );
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (record) => {
    setEditing(record);
    setFeedback('');
    setFormError('');

    setForm({
      id_employee: String(
        record.id_employee || '',
      ),
      id_shift: record.id_shift
        ? String(record.id_shift)
        : '',
      attendance_date: String(
        record.attendance_date ||
          record.date ||
          getLocalDateString(),
      ).slice(0, 10),
      check_in: formatTime(
        record.check_in ||
          record.entry_time ||
          '08:00',
      ),
      check_out:
        record.check_out ||
        record.exit_time
          ? formatTime(
              record.check_out ||
                record.exit_time,
            )
          : '',
      notes: record.notes || '',
    });

    setShowForm(true);
  };

  const handleFilterChange = (event) => {
    const { name, value } = event.target;

    setFilters((current) => ({
      ...current,
      [name]: value,
    }));
  };

  const applyFilters = async () => {
    if (
      filters.date_from &&
      filters.date_to &&
      filters.date_from > filters.date_to
    ) {
      setPageError(
        'La fecha inicial no puede ser posterior a la fecha final',
      );
      return;
    }

    await loadAttendance(filters);
  };

  const clearFilters = async () => {
    const cleanFilters = {
      id_employee: '',
      date_from: '',
      date_to: '',
    };

    setFilters(cleanFilters);
    setSearch('');
    await loadAttendance(cleanFilters);
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
    minWidth: '150px',
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
            <h1>Asistencia</h1>
            <p>
              Controla entradas, salidas, puntualidad y horas trabajadas
            </p>
          </div>

          <button
            type="button"
            className="new-employee-button"
            onClick={openNewAttendance}
            disabled={loading}
          >
            + Registrar asistencia
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
              Registros mostrados
            </div>
            <div style={statValueStyle}>
              {summary.total}
            </div>
          </div>

          <div style={statCardStyle}>
            <div style={statLabelStyle}>
              Puntuales
            </div>
            <div style={statValueStyle}>
              {summary.onTime}
            </div>
          </div>

          <div style={statCardStyle}>
            <div style={statLabelStyle}>
              Tardanzas
            </div>
            <div style={statValueStyle}>
              {summary.late}
            </div>
          </div>

          <div style={statCardStyle}>
            <div style={statLabelStyle}>
              Jornadas finalizadas
            </div>
            <div style={statValueStyle}>
              {summary.completed}
            </div>
          </div>

          <div style={statCardStyle}>
            <div style={statLabelStyle}>
              Horas registradas
            </div>
            <div style={statValueStyle}>
              {formatDuration(
                summary.workedMinutes,
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
                  Desde
                </label>
                <input
                  type="date"
                  name="date_from"
                  value={filters.date_from}
                  onChange={handleFilterChange}
                  max={today}
                  style={filterInputStyle}
                />
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
                  Hasta
                </label>
                <input
                  type="date"
                  name="date_to"
                  value={filters.date_to}
                  onChange={handleFilterChange}
                  max={today}
                  style={filterInputStyle}
                />
              </div>

              <button
                type="button"
                className="save-button"
                onClick={applyFilters}
                disabled={loading}
              >
                Aplicar filtros
              </button>

              <button
                type="button"
                className="cancel-button"
                onClick={clearFilters}
                disabled={loading}
              >
                Limpiar
              </button>
            </div>
          </div>
        </section>

        <section className="employees-panel">
          <div className="employees-toolbar">
            <div>
              <h2>
                Historial de asistencia
              </h2>
              <p>
                {filteredAttendance.length}{' '}
                registro
                {filteredAttendance.length === 1
                  ? ''
                  : 's'}
              </p>
            </div>

            <input
              type="text"
              className="search-input"
              value={search}
              onChange={(event) =>
                setSearch(event.target.value)
              }
              placeholder="Buscar empleado, cargo, fecha o nota..."
            />
          </div>

          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Empleado</th>
                  <th>Cargo</th>
                  <th>Fecha</th>
                  <th>Turno</th>
                  <th>Entrada</th>
                  <th>Salida</th>
                  <th>Puntualidad</th>
                  <th>Tiempo trabajado</th>
                  <th>Notas</th>
                  <th>Acciones</th>
                </tr>
              </thead>

              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan="10">
                      Cargando...
                    </td>
                  </tr>
                ) : filteredAttendance.length ===
                  0 ? (
                  <tr>
                    <td colSpan="10">
                      No existe historial de asistencia para los filtros seleccionados.
                    </td>
                  </tr>
                ) : (
                  filteredAttendance.map(
                    (record) => {
                      const metrics =
                        getAttendanceMetrics(
                          record,
                        );

                      const shiftDay =
                        record.shift_day ||
                        record.day ||
                        record.day_of_week;

                      const shiftStart =
                        record.shift_start_time ||
                        record.start_time;

                      const shiftEnd =
                        record.shift_end_time ||
                        record.end_time;

                      const employeeName =
                        record.employee_name ||
                        'Sin empleado';

                      return (
                        <tr
                          key={
                            record.id_employee_attendance
                          }
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
                                  {record.employee_status ===
                                  'INACTIVE'
                                    ? 'Empleado inactivo'
                                    : 'Empleado activo'}
                                </span>
                              </div>
                            </div>
                          </td>

                          <td>
                            {record.position_name ||
                              '-'}
                          </td>

                          <td>
                            {formatDate(
                              record.date ||
                                record.attendance_date,
                            )}
                          </td>

                          <td>
                            {shiftDay
                              ? `${
                                  DAY_LABELS[
                                    String(
                                      shiftDay,
                                    ).toUpperCase()
                                  ] || shiftDay
                                } ${formatTime(
                                  shiftStart,
                                )} - ${formatTime(
                                  shiftEnd,
                                )}`
                              : '-'}
                          </td>

                          <td>
                            {formatTime(
                              record.entry_time ||
                                record.check_in,
                            )}
                          </td>

                          <td>
                            {formatTime(
                              record.exit_time ||
                                record.check_out,
                            )}
                          </td>

                          <td>
                            {metrics.lateMinutes ===
                            null ? (
                              <span
                                className="status inactive"
                              >
                                Sin datos
                              </span>
                            ) : metrics.lateMinutes >
                              0 ? (
                              <span
                                style={{
                                  display:
                                    'inline-block',
                                  padding:
                                    '5px 10px',
                                  borderRadius:
                                    '20px',
                                  fontSize:
                                    '11px',
                                  fontWeight:
                                    '600',
                                  background:
                                    'rgba(224, 0, 45, 0.12)',
                                  color:
                                    '#ff6b82',
                                }}
                              >
                                Tarde{' '}
                                {
                                  metrics.lateMinutes
                                }{' '}
                                min
                              </span>
                            ) : (
                              <span className="status active">
                                Puntual
                              </span>
                            )}
                          </td>

                          <td>
                            <div>
                              {formatDuration(
                                metrics.workedMinutes,
                              )}
                            </div>
                            {metrics.overtimeMinutes >
                              0 && (
                              <span
                                style={{
                                  display:
                                    'block',
                                  marginTop:
                                    '4px',
                                  color:
                                    '#5cc98a',
                                  fontSize:
                                    '11px',
                                }}
                              >
                                +
                                {formatDuration(
                                  metrics.overtimeMinutes,
                                )}{' '}
                                extra
                              </span>
                            )}
                          </td>

                          <td>
                            {record.notes || '-'}
                          </td>

                          <td>
                            <button
                              type="button"
                              className="action-button"
                              onClick={() =>
                                handleEdit(
                                  record,
                                )
                              }
                            >
                              Editar
                            </button>
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
                      ? 'Editar asistencia'
                      : 'Nueva asistencia'}
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
                    <label htmlFor="attendance-employee">
                      Empleado
                    </label>

                    <select
                      id="attendance-employee"
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
                    <label htmlFor="attendance-shift">
                      Turno
                    </label>

                    <select
                      id="attendance-shift"
                      name="id_shift"
                      value={form.id_shift}
                      onChange={handleChange}
                      required
                      disabled={
                        saving ||
                        !form.id_employee
                      }
                    >
                      <option value="">
                        {form.id_employee
                          ? 'Seleccione un turno'
                          : 'Seleccione primero un empleado'}
                      </option>

                      {availableShifts.map(
                        (shift) => {
                          const day =
                            shift.day ||
                            shift.day_of_week;

                          return (
                            <option
                              key={
                                shift.id_shift
                              }
                              value={
                                shift.id_shift
                              }
                            >
                              {DAY_LABELS[
                                String(
                                  day,
                                ).toUpperCase()
                              ] || day}{' '}
                              (
                              {formatTime(
                                shift.start_time,
                              )}{' '}
                              -{' '}
                              {formatTime(
                                shift.end_time,
                              )}
                              )
                              {shift.status ===
                              'INACTIVE'
                                ? ' - Inactivo'
                                : ''}
                            </option>
                          );
                        },
                      )}
                    </select>

                    {form.id_employee &&
                      availableShifts.length ===
                        0 && (
                        <span
                          style={{
                            color:
                              '#ff6b82',
                            fontSize:
                              '11px',
                          }}
                        >
                          Este empleado no tiene turnos activos disponibles.
                        </span>
                      )}
                  </div>

                  <div className="form-group">
                    <label htmlFor="attendance-date">
                      Fecha
                    </label>

                    <input
                      id="attendance-date"
                      type="date"
                      name="attendance_date"
                      value={
                        form.attendance_date
                      }
                      onChange={handleChange}
                      max={today}
                      required
                      disabled={saving}
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="attendance-entry">
                      Hora de entrada
                    </label>

                    <input
                      id="attendance-entry"
                      type="time"
                      name="check_in"
                      value={form.check_in}
                      onChange={handleChange}
                      required
                      disabled={saving}
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="attendance-exit">
                      Hora de salida
                    </label>

                    <input
                      id="attendance-exit"
                      type="time"
                      name="check_out"
                      value={form.check_out}
                      onChange={handleChange}
                      disabled={saving}
                    />
                  </div>

                  <div className="form-group">
                    <label>
                      Estado calculado
                    </label>

                    <div
                      style={{
                        minHeight: '42px',
                        display: 'flex',
                        alignItems:
                          'center',
                        gap: '8px',
                        flexWrap: 'wrap',
                        padding:
                          '0 2px',
                      }}
                    >
                      {!selectedShift ? (
                        <span className="status inactive">
                          Seleccione un turno
                        </span>
                      ) : formMetrics.lateMinutes ===
                        null ? (
                        <span className="status inactive">
                          Sin datos
                        </span>
                      ) : formMetrics.lateMinutes >
                        0 ? (
                        <span
                          style={{
                            display:
                              'inline-block',
                            padding:
                              '5px 10px',
                            borderRadius:
                              '20px',
                            fontSize:
                              '11px',
                            fontWeight:
                              '600',
                            background:
                              'rgba(224, 0, 45, 0.12)',
                            color:
                              '#ff6b82',
                          }}
                        >
                          Tarde{' '}
                          {
                            formMetrics.lateMinutes
                          }{' '}
                          min
                        </span>
                      ) : (
                        <span className="status active">
                          Puntual
                        </span>
                      )}

                      {formMetrics.workedMinutes !==
                        null && (
                        <span
                          style={{
                            color:
                              '#bbbbbb',
                            fontSize:
                              '12px',
                          }}
                        >
                          {formatDuration(
                            formMetrics.workedMinutes,
                          )}{' '}
                          trabajadas
                        </span>
                      )}
                    </div>
                  </div>

                  {selectedShift && (
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
                            '14px 16px',
                          background:
                            '#1a1a1a',
                          border:
                            '1px solid #333333',
                          borderRadius:
                            '8px',
                          display: 'grid',
                          gridTemplateColumns:
                            'repeat(auto-fit, minmax(140px, 1fr))',
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
                            Empleado
                          </span>
                          <strong
                            style={{
                              fontSize:
                                '12px',
                            }}
                          >
                            {selectedEmployee
                              ? `${selectedEmployee.first_name} ${selectedEmployee.last_name}`
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
                            Cargo
                          </span>
                          <strong
                            style={{
                              fontSize:
                                '12px',
                            }}
                          >
                            {selectedEmployee?.position_name ||
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
                                '5px',
                              textTransform:
                                'uppercase',
                            }}
                          >
                            Día del turno
                          </span>
                          <strong
                            style={{
                              fontSize:
                                '12px',
                            }}
                          >
                            {DAY_LABELS[
                              String(
                                selectedShift.day ||
                                  selectedShift.day_of_week ||
                                  '',
                              ).toUpperCase()
                            ] ||
                              selectedShift.day ||
                              selectedShift.day_of_week ||
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
                                '5px',
                              textTransform:
                                'uppercase',
                            }}
                          >
                            Horario
                          </span>
                          <strong
                            style={{
                              fontSize:
                                '12px',
                            }}
                          >
                            {formatTime(
                              selectedShift.start_time,
                            )}{' '}
                            -{' '}
                            {formatTime(
                              selectedShift.end_time,
                            )}
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
                            Duración programada
                          </span>
                          <strong
                            style={{
                              fontSize:
                                '12px',
                            }}
                          >
                            {formatDuration(
                              formMetrics.scheduledMinutes,
                            )}
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
                            Tiempo extra
                          </span>
                          <strong
                            style={{
                              fontSize:
                                '12px',
                              color:
                                formMetrics.overtimeMinutes >
                                0
                                  ? '#5cc98a'
                                  : '#ffffff',
                            }}
                          >
                            {formatDuration(
                              formMetrics.overtimeMinutes,
                            )}
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
                    <label htmlFor="attendance-notes">
                      Notas
                    </label>

                    <textarea
                      id="attendance-notes"
                      name="notes"
                      value={form.notes}
                      onChange={handleChange}
                      placeholder="Observaciones de la asistencia"
                      maxLength={1000}
                      disabled={saving}
                    />

                    <span
                      style={{
                        color: '#666666',
                        fontSize: '10px',
                        textAlign: 'right',
                      }}
                    >
                      {form.notes.length}/1000
                    </span>
                  </div>
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
                      (!editing &&
                        activeEmployees.length ===
                          0)
                    }
                  >
                    {saving
                      ? 'Guardando...'
                      : editing
                        ? 'Guardar cambios'
                        : 'Guardar asistencia'}
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

export default Attendance;
