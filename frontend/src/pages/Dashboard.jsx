import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import Sidebar from '../components/Sidebar';
import { API_URL } from '../config/api';
import './Dashboard.css';

const MONTHS = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

const getLocalDateString = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
};

const formatTime = (value) => {
  if (!value) return '-';
  return String(value).slice(0, 5);
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

const formatDateTime = (date) => {
  if (!date) return '-';

  const parsedDate =
    date instanceof Date
      ? date
      : new Date(date);

  if (Number.isNaN(parsedDate.getTime())) {
    return String(date);
  }

  return parsedDate.toLocaleString('es-BO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
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

const formatPeriod = (month, year) => {
  const monthIndex = Number(month) - 1;

  if (
    monthIndex < 0 ||
    monthIndex >= MONTHS.length
  ) {
    return `${month}/${year}`;
  }

  return `${MONTHS[monthIndex]} ${year}`;
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

const getLateMinutes = (record) => {
  if (
    record.late_minutes !== null &&
    record.late_minutes !== undefined
  ) {
    return Math.max(
      0,
      Number(record.late_minutes),
    );
  }

  const shiftStart =
    record.shift_start_time ||
    record.start_time ||
    null;

  const entryTime =
    record.entry_time ||
    record.check_in ||
    null;

  const startMinutes =
    timeToMinutes(shiftStart);

  const entryMinutes =
    timeToMinutes(entryTime);

  if (
    startMinutes === null ||
    entryMinutes === null
  ) {
    return null;
  }

  return Math.max(
    0,
    entryMinutes - startMinutes,
  );
};

const getInitials = (name) => {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!parts.length) return '?';

  return parts
    .slice(0, 2)
    .map((part) =>
      part.charAt(0).toUpperCase(),
    )
    .join('');
};

const getPayrollStatusLabel = (status) => {
  const normalized =
    String(status || '').toUpperCase();

  if (normalized === 'PAID') {
    return 'Pagada';
  }

  if (normalized === 'CANCELLED') {
    return 'Cancelada';
  }

  return 'Generada';
};

const getPayrollStatusStyle = (status) => {
  const normalized =
    String(status || '').toUpperCase();

  if (normalized === 'PAID') {
    return {
      background: 'rgba(30, 150, 80, 0.12)',
      color: '#5cc98a',
      border: '1px solid rgba(30, 150, 80, 0.25)',
    };
  }

  if (normalized === 'CANCELLED') {
    return {
      background: 'rgba(224, 0, 45, 0.12)',
      color: '#ff6b82',
      border: '1px solid rgba(224, 0, 45, 0.25)',
    };
  }

  return {
    background: 'rgba(255, 184, 0, 0.10)',
    color: '#ffc94d',
    border: '1px solid rgba(255, 184, 0, 0.25)',
  };
};

function Dashboard() {
  const navigate = useNavigate();

  const [user, setUser] = useState(null);

  const [employees, setEmployees] = useState([]);
  const [positions, setPositions] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [salaries, setSalaries] = useState([]);
  const [payrolls, setPayrolls] = useState([]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);

  const today = getLocalDateString();

  const requestJson = async (
    url,
    fallbackMessage,
  ) => {
    const response = await fetch(url);
    const data = await parseResponse(response);

    if (!response.ok) {
      throw new Error(
        getErrorMessage(
          data,
          fallbackMessage,
        ),
      );
    }

    return data;
  };

  const loadDashboardData = useCallback(
    async (manualRefresh = false) => {
      try {
        if (manualRefresh) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }

        setError('');

        const [
          employeesData,
          positionsData,
          shiftsData,
          attendanceData,
          salariesData,
          payrollsData,
        ] = await Promise.all([
          requestJson(
            `${API_URL}/api/employees`,
            'No se pudieron cargar los empleados.',
          ),
          requestJson(
            `${API_URL}/api/positions`,
            'No se pudieron cargar los cargos.',
          ),
          requestJson(
            `${API_URL}/api/shifts`,
            'No se pudieron cargar los turnos.',
          ),
          requestJson(
            `${API_URL}/api/employee-attendance?date_from=${today}&date_to=${today}`,
            'No se pudo cargar la asistencia de hoy.',
          ),
          requestJson(
            `${API_URL}/api/salaries`,
            'No se pudieron cargar los salarios.',
          ),
          requestJson(
            `${API_URL}/api/payrolls`,
            'No se pudieron cargar las planillas.',
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

        setSalaries(
          Array.isArray(salariesData)
            ? salariesData
            : [],
        );

        setPayrolls(
          Array.isArray(payrollsData)
            ? payrollsData
            : [],
        );

        setLastUpdated(new Date());
      } catch (dashboardError) {
        console.error(
          'Error cargando dashboard:',
          dashboardError,
        );

        setError(
          dashboardError.message ||
            'No se pudieron cargar todos los datos del dashboard.',
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [today],
  );

  useEffect(() => {
    const storedUser =
      localStorage.getItem('user');

    if (!storedUser) {
      navigate('/', {
        replace: true,
      });

      return;
    }

    try {
      const parsedUser =
        JSON.parse(storedUser);

      if (
        !parsedUser ||
        typeof parsedUser !== 'object' ||
        !parsedUser.username ||
        !parsedUser.role ||
        String(
          parsedUser.status || 'ACTIVE',
        ).toUpperCase() === 'INACTIVE'
      ) {
        localStorage.removeItem('user');

        navigate('/', {
          replace: true,
        });

        return;
      }

      setUser(parsedUser);
    } catch (storageError) {
      console.error(
        'Error leyendo el usuario:',
        storageError,
      );

      localStorage.removeItem('user');

      navigate('/', {
        replace: true,
      });

      return;
    }

    loadDashboardData();
  }, [navigate, loadDashboardData]);

  const activeSalaryByEmployee = useMemo(() => {
    const map = new Map();

    salaries
      .filter((salary) =>
        isActive(salary.status),
      )
      .sort((a, b) => {
        const dateA =
          String(
            a.effective_date || '',
          ).slice(0, 10);

        const dateB =
          String(
            b.effective_date || '',
          ).slice(0, 10);

        if (dateA !== dateB) {
          return dateB.localeCompare(
            dateA,
          );
        }

        return (
          Number(b.id_salary || 0) -
          Number(a.id_salary || 0)
        );
      })
      .forEach((salary) => {
        const key =
          String(
            salary.id_employee,
          );

        if (!map.has(key)) {
          map.set(
            key,
            salary,
          );
        }
      });

    return map;
  }, [salaries]);

  const dashboardSummary = useMemo(() => {
    const activeEmployees =
      employees.filter((employee) =>
        isActive(employee.status),
      );

    const inactiveEmployees =
      employees.filter(
        (employee) =>
          !isActive(employee.status),
      );

    const activePositions =
      positions.filter((position) =>
        isActive(position.status),
      );

    const activeShifts =
      shifts.filter((shift) =>
        isActive(shift.status),
      );

    const activeEmployeeIds =
      new Set(
        activeEmployees.map(
          (employee) =>
            String(
              employee.id_employee,
            ),
        ),
      );

    const employeesWithActiveShift =
      new Set(
        activeShifts
          .filter((shift) =>
            activeEmployeeIds.has(
              String(
                shift.id_employee,
              ),
            ),
          )
          .map((shift) =>
            String(
              shift.id_employee,
            ),
          ),
      );

    const employeesWithoutShift =
      activeEmployees.filter(
        (employee) =>
          !employeesWithActiveShift.has(
            String(
              employee.id_employee,
            ),
          ),
      );

    const employeesWithoutSalary =
      activeEmployees.filter(
        (employee) =>
          !activeSalaryByEmployee.has(
            String(
              employee.id_employee,
            ),
          ),
      );

    const activeSalaries =
      Array.from(
        activeSalaryByEmployee.values(),
      );

    const monthlySalaryTotal =
      activeSalaries.reduce(
        (sum, salary) =>
          sum +
          (Number(
            salary.base_salary,
          ) || 0),
        0,
      );

    const averageSalary =
      activeSalaries.length
        ? monthlySalaryTotal /
          activeSalaries.length
        : 0;

    let lateToday = 0;
    let onTimeToday = 0;
    let completedToday = 0;

    attendance.forEach((record) => {
      const lateMinutes =
        getLateMinutes(record);

      if (lateMinutes !== null) {
        if (lateMinutes > 0) {
          lateToday += 1;
        } else {
          onTimeToday += 1;
        }
      }

      if (
        record.exit_time ||
        record.check_out
      ) {
        completedToday += 1;
      }
    });

    const generatedPayrolls =
      payrolls.filter(
        (payroll) =>
          String(
            payroll.status || '',
          ).toUpperCase() ===
          'GENERATED',
      );

    const paidPayrolls =
      payrolls.filter(
        (payroll) =>
          String(
            payroll.status || '',
          ).toUpperCase() ===
          'PAID',
      );

    const pendingPayrollAmount =
      generatedPayrolls.reduce(
        (sum, payroll) =>
          sum +
          (Number(
            payroll.total_net_salary,
          ) || 0),
        0,
      );

    const paidPayrollAmount =
      paidPayrolls.reduce(
        (sum, payroll) =>
          sum +
          (Number(
            payroll.total_net_salary,
          ) || 0),
        0,
      );

    const currentMonth =
      new Date().getMonth() + 1;

    const currentYear =
      new Date().getFullYear();

    const currentPayroll =
      payrolls.find(
        (payroll) =>
          Number(
            payroll.payroll_month,
          ) === currentMonth &&
          Number(
            payroll.payroll_year,
          ) === currentYear &&
          String(
            payroll.status || '',
          ).toUpperCase() !==
            'CANCELLED',
      ) || null;

    return {
      totalEmployees:
        employees.length,
      activeEmployees:
        activeEmployees.length,
      inactiveEmployees:
        inactiveEmployees.length,
      activePositions:
        activePositions.length,
      activeShifts:
        activeShifts.length,
      attendanceToday:
        attendance.length,
      lateToday,
      onTimeToday,
      completedToday,
      employeesWithoutShift,
      employeesWithoutSalary,
      employeesWithSalary:
        activeEmployees.length -
        employeesWithoutSalary.length,
      monthlySalaryTotal,
      averageSalary,
      payrollsTotal:
        payrolls.length,
      generatedPayrolls:
        generatedPayrolls.length,
      paidPayrolls:
        paidPayrolls.length,
      pendingPayrollAmount,
      paidPayrollAmount,
      currentPayroll,
    };
  }, [
    attendance,
    activeSalaryByEmployee,
    employees,
    payrolls,
    positions,
    shifts,
  ]);

  const recentAttendance = useMemo(() => {
    return [...attendance]
      .sort((a, b) => {
        const timeA =
          String(
            a.entry_time ||
              a.check_in ||
              '',
          );

        const timeB =
          String(
            b.entry_time ||
              b.check_in ||
              '',
          );

        return timeB.localeCompare(
          timeA,
        );
      })
      .slice(0, 6);
  }, [attendance]);

  const recentPayrolls = useMemo(() => {
    return [...payrolls]
      .sort((a, b) => {
        const keyA =
          Number(
            a.payroll_year,
          ) *
            100 +
          Number(
            a.payroll_month,
          );

        const keyB =
          Number(
            b.payroll_year,
          ) *
            100 +
          Number(
            b.payroll_month,
          );

        if (keyA !== keyB) {
          return keyB - keyA;
        }

        return (
          Number(
            b.id_payroll || 0,
          ) -
          Number(
            a.id_payroll || 0,
          )
        );
      })
      .slice(0, 5);
  }, [payrolls]);

  const getUserInitial = () => {
    const value =
      user?.username ||
      user?.role ||
      'U';

    return String(value)
      .charAt(0)
      .toUpperCase();
  };

  const getUserName = () => {
    if (user?.username) {
      return user.username;
    }

    return 'Usuario';
  };

  const getUserRole = () => {
    if (user?.role) {
      return user.role;
    }

    return 'Sin rol';
  };

  const getAttendanceStatus = (record) => {
    const lateMinutes =
      getLateMinutes(record);

    if (lateMinutes === null) {
      return {
        label: 'Sin datos',
        className:
          'status inactive',
      };
    }

    if (lateMinutes > 0) {
      return {
        label:
          `Tarde ${lateMinutes} min`,
        className: '',
      };
    }

    return {
      label: 'Puntual',
      className:
        'status active',
    };
  };

  const metricCardStyle = {
    background: '#171717',
    border:
      '1px solid #292929',
    borderRadius: '12px',
    padding: '18px 16px',
  };

  const metricLabelStyle = {
    color: '#777777',
    fontSize: '11px',
    textTransform:
      'uppercase',
    letterSpacing: '1px',
  };

  const metricValueStyle = {
    marginTop: '8px',
    fontSize: '28px',
    fontWeight: 700,
    color: '#ffffff',
  };

  const miniInfoStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent:
      'space-between',
    gap: '12px',
    padding: '12px 0',
    borderBottom:
      '1px solid #242424',
  };

  const quickActionStyle = {
    width: '100%',
    marginBottom: '10px',
  };

  return (
    <div className="dashboard-page">
      <Sidebar />

      <main className="dashboard-content">
        <header className="dashboard-header">
          <div>
            <span>
              RECURSOS HUMANOS
            </span>

            <h1>
              Dashboard
            </h1>

            <p>
              Resumen general del personal, salarios y planillas del Gimnasio MQS
            </p>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              flexWrap: 'wrap',
              justifyContent:
                'flex-end',
            }}
          >
            <button
              type="button"
              className="action-button"
              onClick={() =>
                loadDashboardData(
                  true,
                )
              }
              disabled={
                loading ||
                refreshing
              }
            >
              {refreshing
                ? 'Actualizando...'
                : 'Actualizar'}
            </button>

            <div className="dashboard-user">
              <div className="user-circle">
                {getUserInitial()}
              </div>

              <div>
                <strong>
                  {getUserName()}
                </strong>

                <small>
                  {getUserRole()} · Usuario activo
                </small>
              </div>
            </div>
          </div>
        </header>

        {error && (
          <div
            className="error"
            style={{
              marginBottom:
                '20px',
            }}
          >
            <div
              style={{
                display:
                  'flex',
                alignItems:
                  'center',
                justifyContent:
                  'space-between',
                gap: '12px',
                flexWrap:
                  'wrap',
              }}
            >
              <span>
                {error}
              </span>

              <button
                type="button"
                className="action-button"
                onClick={() =>
                  loadDashboardData(
                    true,
                  )
                }
                disabled={
                  refreshing
                }
              >
                Reintentar
              </button>
            </div>
          </div>
        )}

        <div
          style={{
            color: '#777777',
            fontSize: '11px',
            marginBottom:
              '15px',
          }}
        >
          {lastUpdated
            ? `Última actualización: ${formatDateTime(
                lastUpdated,
              )}`
            : 'Cargando información...'}
        </div>

        <section
          style={{
            display: 'grid',
            gridTemplateColumns:
              'repeat(auto-fit, minmax(170px, 1fr))',
            gap: '16px',
            marginBottom:
              '22px',
          }}
        >
          <div style={metricCardStyle}>
            <div style={metricLabelStyle}>
              Empleados activos
            </div>

            <div style={metricValueStyle}>
              {loading
                ? '...'
                : dashboardSummary.activeEmployees}
            </div>

            <small>
              Personal vigente
            </small>
          </div>

          <div style={metricCardStyle}>
            <div style={metricLabelStyle}>
              Turnos activos
            </div>

            <div style={metricValueStyle}>
              {loading
                ? '...'
                : dashboardSummary.activeShifts}
            </div>

            <small>
              Horarios vigentes
            </small>
          </div>

          <div style={metricCardStyle}>
            <div style={metricLabelStyle}>
              Asistencias hoy
            </div>

            <div style={metricValueStyle}>
              {loading
                ? '...'
                : dashboardSummary.attendanceToday}
            </div>

            <small>
              Registros del día
            </small>
          </div>

          <div style={metricCardStyle}>
            <div style={metricLabelStyle}>
              Puntuales hoy
            </div>

            <div style={metricValueStyle}>
              {loading
                ? '...'
                : dashboardSummary.onTimeToday}
            </div>

            <small>
              Llegadas a tiempo
            </small>
          </div>

          <div style={metricCardStyle}>
            <div style={metricLabelStyle}>
              Con salario vigente
            </div>

            <div style={metricValueStyle}>
              {loading
                ? '...'
                : dashboardSummary.employeesWithSalary}
            </div>

            <small>
              Empleados activos
            </small>
          </div>

          <div style={metricCardStyle}>
            <div style={metricLabelStyle}>
              Nómina mensual estimada
            </div>

            <div
              style={{
                ...metricValueStyle,
                fontSize: '22px',
              }}
            >
              {loading
                ? '...'
                : formatMoney(
                    dashboardSummary.monthlySalaryTotal,
                  )}
            </div>

            <small>
              Salarios vigentes
            </small>
          </div>

          <div style={metricCardStyle}>
            <div style={metricLabelStyle}>
              Planillas pendientes
            </div>

            <div style={metricValueStyle}>
              {loading
                ? '...'
                : dashboardSummary.generatedPayrolls}
            </div>

            <small>
              Generadas sin pagar
            </small>
          </div>

          <div style={metricCardStyle}>
            <div style={metricLabelStyle}>
              Pendiente de pago
            </div>

            <div
              style={{
                ...metricValueStyle,
                fontSize: '22px',
              }}
            >
              {loading
                ? '...'
                : formatMoney(
                    dashboardSummary.pendingPayrollAmount,
                  )}
            </div>

            <small>
              Total neto pendiente
            </small>
          </div>
        </section>

        {!loading &&
          dashboardSummary
            .employeesWithoutShift
            .length > 0 && (
            <div
              style={{
                marginBottom:
                  '12px',
                padding:
                  '13px 16px',
                borderRadius:
                  '8px',
                border:
                  '1px solid rgba(255, 184, 0, 0.35)',
                background:
                  'rgba(255, 184, 0, 0.08)',
                color:
                  '#ffc94d',
                fontSize:
                  '12px',
              }}
            >
              Hay{' '}
              {
                dashboardSummary
                  .employeesWithoutShift
                  .length
              }{' '}
              empleado(s) activo(s) sin turnos activos asignados.
            </div>
          )}

        {!loading &&
          dashboardSummary
            .employeesWithoutSalary
            .length > 0 && (
            <div
              style={{
                marginBottom:
                  '20px',
                padding:
                  '13px 16px',
                borderRadius:
                  '8px',
                border:
                  '1px solid rgba(255, 184, 0, 0.35)',
                background:
                  'rgba(255, 184, 0, 0.08)',
                color:
                  '#ffc94d',
                fontSize:
                  '12px',
              }}
            >
              Hay{' '}
              {
                dashboardSummary
                  .employeesWithoutSalary
                  .length
              }{' '}
              empleado(s) activo(s) sin salario vigente. Debes registrar sus salarios antes de generar la planilla actual.
            </div>
          )}

        <section className="dashboard-panels">
          <div className="dashboard-panel">
            <h2>
              Estado del personal
            </h2>

            <p>
              Indicadores principales de Recursos Humanos
            </p>

            <div className="activity">
              <div style={miniInfoStyle}>
                <div>
                  <strong>
                    Cobertura de turnos
                  </strong>

                  <span>
                    Empleados activos con al menos un turno activo.
                  </span>
                </div>

                <strong>
                  {loading
                    ? '...'
                    : `${
                        dashboardSummary.activeEmployees -
                        dashboardSummary
                          .employeesWithoutShift
                          .length
                      } / ${
                        dashboardSummary.activeEmployees
                      }`}
                </strong>
              </div>

              <div style={miniInfoStyle}>
                <div>
                  <strong>
                    Cobertura salarial
                  </strong>

                  <span>
                    Empleados activos con salario vigente.
                  </span>
                </div>

                <strong>
                  {loading
                    ? '...'
                    : `${
                        dashboardSummary.employeesWithSalary
                      } / ${
                        dashboardSummary.activeEmployees
                      }`}
                </strong>
              </div>

              <div style={miniInfoStyle}>
                <div>
                  <strong>
                    Jornadas finalizadas hoy
                  </strong>

                  <span>
                    Registros con hora de salida.
                  </span>
                </div>

                <strong>
                  {loading
                    ? '...'
                    : dashboardSummary.completedToday}
                </strong>
              </div>

              <div
                style={{
                  ...miniInfoStyle,
                  borderBottom:
                    'none',
                }}
              >
                <div>
                  <strong>
                    Tardanzas hoy
                  </strong>

                  <span>
                    Llegadas posteriores al inicio del turno.
                  </span>
                </div>

                <strong>
                  {loading
                    ? '...'
                    : dashboardSummary.lateToday}
                </strong>
              </div>
            </div>
          </div>

          <div className="dashboard-panel">
            <h2>
              Salarios y planillas
            </h2>

            <p>
              Estado actual de la nómina de Recursos Humanos
            </p>

            <div className="activity">
              <div style={miniInfoStyle}>
                <div>
                  <strong>
                    Salario promedio
                  </strong>

                  <span>
                    Promedio entre salarios vigentes.
                  </span>
                </div>

                <strong>
                  {loading
                    ? '...'
                    : formatMoney(
                        dashboardSummary.averageSalary,
                      )}
                </strong>
              </div>

              <div style={miniInfoStyle}>
                <div>
                  <strong>
                    Planilla del mes actual
                  </strong>

                  <span>
                    Estado de la planilla correspondiente al periodo actual.
                  </span>
                </div>

                <strong>
                  {loading
                    ? '...'
                    : dashboardSummary.currentPayroll
                      ? getPayrollStatusLabel(
                          dashboardSummary.currentPayroll.status,
                        )
                      : 'Sin generar'}
                </strong>
              </div>

              <div style={miniInfoStyle}>
                <div>
                  <strong>
                    Planillas pagadas
                  </strong>

                  <span>
                    Total de planillas marcadas como pagadas.
                  </span>
                </div>

                <strong>
                  {loading
                    ? '...'
                    : dashboardSummary.paidPayrolls}
                </strong>
              </div>

              <div
                style={{
                  ...miniInfoStyle,
                  borderBottom:
                    'none',
                }}
              >
                <div>
                  <strong>
                    Total histórico pagado
                  </strong>

                  <span>
                    Suma neta de planillas pagadas registradas.
                  </span>
                </div>

                <strong>
                  {loading
                    ? '...'
                    : formatMoney(
                        dashboardSummary.paidPayrollAmount,
                      )}
                </strong>
              </div>
            </div>
          </div>

          <div className="dashboard-panel">
            <h2>
              Acciones rápidas
            </h2>

            <p>
              Operaciones frecuentes de Recursos Humanos
            </p>

            <button
              type="button"
              style={quickActionStyle}
              onClick={() =>
                navigate(
                  '/employees',
                )
              }
            >
              Gestionar empleados
            </button>

            <button
              type="button"
              style={quickActionStyle}
              onClick={() =>
                navigate(
                  '/attendance',
                )
              }
            >
              Registrar asistencia
            </button>

            <button
              type="button"
              style={quickActionStyle}
              onClick={() =>
                navigate(
                  '/salaries',
                )
              }
            >
              Gestionar salarios
            </button>

            <button
              type="button"
              style={quickActionStyle}
              onClick={() =>
                navigate(
                  '/payrolls',
                )
              }
            >
              Gestionar planillas
            </button>

            <button
              type="button"
              style={quickActionStyle}
              onClick={() =>
                navigate(
                  '/reports',
                )
              }
            >
              Ver reportes
            </button>
          </div>
        </section>

        <section
          className="dashboard-panel"
          style={{
            marginTop:
              '20px',
          }}
        >
          <div
            style={{
              display:
                'flex',
              justifyContent:
                'space-between',
              alignItems:
                'center',
              gap: '12px',
              flexWrap:
                'wrap',
              marginBottom:
                '18px',
            }}
          >
            <div>
              <h2
                style={{
                  margin:
                    '0 0 5px',
                }}
              >
                Asistencia de hoy
              </h2>

              <p
                style={{
                  margin: 0,
                }}
              >
                Últimos registros de entrada del personal
              </p>
            </div>

            <button
              type="button"
              className="action-button"
              onClick={() =>
                navigate(
                  '/attendance',
                )
              }
            >
              Ver asistencia
            </button>
          </div>

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
                    Entrada
                  </th>
                  <th>
                    Salida
                  </th>
                  <th>
                    Puntualidad
                  </th>
                </tr>
              </thead>

              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan="5">
                      Cargando...
                    </td>
                  </tr>
                ) : recentAttendance.length ===
                  0 ? (
                  <tr>
                    <td colSpan="5">
                      No hay asistencias registradas hoy.
                    </td>
                  </tr>
                ) : (
                  recentAttendance.map(
                    (record) => {
                      const attendanceStatus =
                        getAttendanceStatus(
                          record,
                        );

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
                                  {
                                    employeeName
                                  }
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
                            {attendanceStatus.className ? (
                              <span
                                className={
                                  attendanceStatus.className
                                }
                              >
                                {
                                  attendanceStatus.label
                                }
                              </span>
                            ) : (
                              <span
                                style={{
                                  display:
                                    'inline-block',
                                  padding:
                                    '5px 9px',
                                  borderRadius:
                                    '20px',
                                  background:
                                    'rgba(224, 0, 45, 0.12)',
                                  color:
                                    '#ff6b82',
                                  fontSize:
                                    '11px',
                                  fontWeight:
                                    600,
                                }}
                              >
                                {
                                  attendanceStatus.label
                                }
                              </span>
                            )}
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

        <section
          className="dashboard-panel"
          style={{
            marginTop:
              '20px',
          }}
        >
          <div
            style={{
              display:
                'flex',
              justifyContent:
                'space-between',
              alignItems:
                'center',
              gap: '12px',
              flexWrap:
                'wrap',
              marginBottom:
                '18px',
            }}
          >
            <div>
              <h2
                style={{
                  margin:
                    '0 0 5px',
                }}
              >
                Planillas recientes
              </h2>

              <p
                style={{
                  margin: 0,
                }}
              >
                Últimos periodos salariales registrados
              </p>
            </div>

            <button
              type="button"
              className="action-button"
              onClick={() =>
                navigate(
                  '/payrolls',
                )
              }
            >
              Ver planillas
            </button>
          </div>

          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>
                    Periodo
                  </th>
                  <th>
                    Estado
                  </th>
                  <th>
                    Empleados
                  </th>
                  <th>
                    Total base
                  </th>
                  <th>
                    Total neto
                  </th>
                  <th>
                    Fecha de pago
                  </th>
                </tr>
              </thead>

              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan="6">
                      Cargando...
                    </td>
                  </tr>
                ) : recentPayrolls.length ===
                  0 ? (
                  <tr>
                    <td colSpan="6">
                      No hay planillas registradas.
                    </td>
                  </tr>
                ) : (
                  recentPayrolls.map(
                    (payroll) => (
                      <tr
                        key={
                          payroll.id_payroll
                        }
                      >
                        <td>
                          <strong>
                            {formatPeriod(
                              payroll.payroll_month,
                              payroll.payroll_year,
                            )}
                          </strong>
                        </td>

                        <td>
                          <span
                            style={{
                              display:
                                'inline-block',
                              padding:
                                '5px 9px',
                              borderRadius:
                                '20px',
                              fontSize:
                                '11px',
                              fontWeight:
                                600,
                              ...getPayrollStatusStyle(
                                payroll.status,
                              ),
                            }}
                          >
                            {getPayrollStatusLabel(
                              payroll.status,
                            )}
                          </span>
                        </td>

                        <td>
                          {
                            payroll.employee_count
                          }
                        </td>

                        <td>
                          {formatMoney(
                            payroll.total_base_salary,
                          )}
                        </td>

                        <td>
                          <strong>
                            {formatMoney(
                              payroll.total_net_salary,
                            )}
                          </strong>
                        </td>

                        <td>
                          {formatDate(
                            payroll.payment_date,
                          )}
                        </td>
                      </tr>
                    ),
                  )
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}

export default Dashboard;
