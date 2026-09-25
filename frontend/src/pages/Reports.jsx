import { useEffect, useMemo, useState } from 'react';
import Sidebar from '../components/Sidebar';
import { API_URL } from '../config/api';
import './Employees.css';

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

const formatTime = (value) => {
  if (!value) return '-';
  return String(value).slice(0, 5);
};

const formatDateTime = (date) => {
  if (!date) return '-';

  return date.toLocaleString('es-BO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
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

const minutesBetween = (start, end) => {
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

  if (hours === 0) return `${rest} min`;
  if (rest === 0) return `${hours} h`;

  return `${hours} h ${rest} min`;
};

const formatHours = (minutes) => {
  if (
    minutes === null ||
    minutes === undefined ||
    Number.isNaN(Number(minutes))
  ) {
    return '0.0 h';
  }

  return `${(Number(minutes) / 60).toFixed(1)} h`;
};

const safeNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const formatMoney = (value) =>
  new Intl.NumberFormat('es-BO', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(safeNumber(value));

const getPayrollStatusText = (value) => {
  const status = String(value || '').toUpperCase();

  if (status === 'PAID') return 'Pagada';
  if (status === 'CANCELLED') return 'Cancelada';
  return 'Generada';
};

const getPayrollStatusClass = (value) => {
  const status = String(value || '').toUpperCase();

  if (status === 'PAID') return 'active';
  if (status === 'CANCELLED') return 'inactive';
  return 'inactive';
};

const getPayrollPeriodText = (month, year) => {
  const names = [
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

  const monthNumber = Number(month);
  const monthName =
    monthNumber >= 1 && monthNumber <= 12
      ? names[monthNumber - 1]
      : `Mes ${month || '-'}`;

  return `${monthName} ${year || ''}`.trim();
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

  const directWorkedDifference =
    entry && exit
      ? minutesBetween(entry, exit)
      : null;

  const invalidTime =
    directWorkedDifference !== null &&
    directWorkedDifference < 0;

  let lateMinutes =
    record.late_minutes !== null &&
    record.late_minutes !== undefined
      ? safeNumber(record.late_minutes)
      : null;

  let workedMinutes =
    record.worked_minutes !== null &&
    record.worked_minutes !== undefined
      ? safeNumber(record.worked_minutes)
      : null;

  let scheduledMinutes =
    record.scheduled_minutes !== null &&
    record.scheduled_minutes !== undefined
      ? safeNumber(record.scheduled_minutes)
      : null;

  let overtimeMinutes =
    record.overtime_minutes !== null &&
    record.overtime_minutes !== undefined
      ? safeNumber(record.overtime_minutes)
      : null;

  if (lateMinutes === null && shiftStart && entry) {
    const difference = minutesBetween(
      shiftStart,
      entry,
    );

    lateMinutes =
      difference === null
        ? null
        : Math.max(0, difference);
  }

  if (invalidTime) {
    workedMinutes = null;
    overtimeMinutes = null;
  } else if (
    workedMinutes === null &&
    directWorkedDifference !== null
  ) {
    workedMinutes = directWorkedDifference;
  }

  if (
    scheduledMinutes === null &&
    shiftStart &&
    shiftEnd
  ) {
    const difference = minutesBetween(
      shiftStart,
      shiftEnd,
    );

    scheduledMinutes =
      difference === null || difference < 0
        ? null
        : difference;
  }

  if (
    !invalidTime &&
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
    invalidTime,
    punctuality:
      lateMinutes === null
        ? 'SIN_DATOS'
        : lateMinutes > 0
          ? 'LATE'
          : 'ON_TIME',
  };
};

const csvEscape = (value) => {
  const text = String(
    value === null || value === undefined
      ? ''
      : value,
  );

  return `"${text.replace(/"/g, '""')}"`;
};

const downloadCsv = (filename, rows) => {
  const csv = rows
    .map((row) =>
      row.map(csvEscape).join(','),
    )
    .join('\n');

  const blob = new Blob(
    [`\uFEFF${csv}`],
    {
      type: 'text/csv;charset=utf-8;',
    },
  );

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.setAttribute('download', filename);

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
};

function Reports() {
  const [employees, setEmployees] = useState([]);
  const [positions, setPositions] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [payrolls, setPayrolls] = useState([]);
  const [payrollDetails, setPayrollDetails] =
    useState({});
  const [selectedPayrollId, setSelectedPayrollId] =
    useState('');

  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [feedback, setFeedback] = useState('');

  const [activeTab, setActiveTab] =
    useState('attendance');

  const [payrollFilters, setPayrollFilters] =
    useState({
      month: '',
      year: '',
      status: '',
    });

  const [search, setSearch] =
    useState('');

  const [filters, setFilters] = useState({
    id_employee: '',
    id_position: '',
    employee_status: '',
    date_from: '',
    date_to: '',
  });

  const [lastUpdated, setLastUpdated] =
    useState(null);

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

  const loadData = async (
    appliedFilters = filters,
  ) => {
    try {
      setLoading(true);
      setPageError('');
      setFeedback('');

      if (
        appliedFilters.date_from &&
        appliedFilters.date_to &&
        appliedFilters.date_from >
          appliedFilters.date_to
      ) {
        throw new Error(
          'La fecha inicial no puede ser posterior a la fecha final',
        );
      }

      const params =
        new URLSearchParams();

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

      const attendanceQuery =
        params.toString();

      const attendanceUrl =
        attendanceQuery
          ? `${API_URL}/api/employee-attendance?${attendanceQuery}`
          : `${API_URL}/api/employee-attendance`;

      const [
        employeesData,
        positionsData,
        attendanceData,
        payrollsData,
      ] = await Promise.all([
        requestJson(
          `${API_URL}/api/employees`,
          {},
          'No se pudieron cargar los empleados',
        ),
        requestJson(
          `${API_URL}/api/positions`,
          {},
          'No se pudieron cargar los cargos',
        ),
        requestJson(
          attendanceUrl,
          {},
          'No se pudo cargar la asistencia',
        ),
        requestJson(
          `${API_URL}/api/payrolls`,
          {},
          'No se pudieron cargar las planillas',
        ),
      ]);

      const payrollList =
        Array.isArray(payrollsData)
          ? payrollsData
          : [];

      const payrollDetailEntries =
        await Promise.all(
          payrollList.map(async (payroll) => {
            const detail = await requestJson(
              `${API_URL}/api/payrolls/${payroll.id_payroll}`,
              {},
              'No se pudo cargar el detalle de una planilla',
            );

            return [
              String(payroll.id_payroll),
              detail,
            ];
          }),
        );

      const payrollDetailsMap =
        Object.fromEntries(
          payrollDetailEntries,
        );

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

      setAttendance(
        Array.isArray(attendanceData)
          ? attendanceData
          : [],
      );

      setPayrolls(payrollList);
      setPayrollDetails(
        payrollDetailsMap,
      );

      setSelectedPayrollId((current) => {
        if (
          current &&
          payrollList.some(
            (payroll) =>
              String(payroll.id_payroll) ===
              String(current),
          )
        ) {
          return current;
        }

        return payrollList.length
          ? String(
              payrollList[0].id_payroll,
            )
          : '';
      });

      setLastUpdated(new Date());
    } catch (error) {
      console.error(error);

      setPageError(
        error.message ||
          'No se pudieron cargar los reportes',
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const selectedEmployee = useMemo(
    () =>
      employees.find(
        (employee) =>
          String(employee.id_employee) ===
          String(filters.id_employee),
      ) || null,
    [employees, filters.id_employee],
  );

  const selectedPosition = useMemo(
    () =>
      positions.find(
        (position) =>
          String(position.id_position) ===
          String(filters.id_position),
      ) || null,
    [positions, filters.id_position],
  );

  const filteredEmployees = useMemo(() => {
    const normalizedSearch =
      search.trim().toLowerCase();

    return employees
      .filter((employee) => {
        if (
          filters.id_employee &&
          String(employee.id_employee) !==
            String(filters.id_employee)
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

        if (
          filters.employee_status &&
          String(employee.status).toUpperCase() !==
            filters.employee_status
        ) {
          return false;
        }

        if (!normalizedSearch) {
          return true;
        }

        const values = [
          employee.first_name,
          employee.last_name,
          `${employee.first_name || ''} ${
            employee.last_name || ''
          }`,
          employee.position_name,
          employee.email,
          employee.phone,
          isActive(employee.status)
            ? 'activo'
            : 'inactivo',
        ];

        return values.some((value) =>
          String(value || '')
            .toLowerCase()
            .includes(normalizedSearch),
        );
      })
      .sort((a, b) =>
        `${a.first_name || ''} ${
          a.last_name || ''
        }`.localeCompare(
          `${b.first_name || ''} ${
            b.last_name || ''
          }`,
          'es',
        ),
      );
  }, [
    employees,
    filters.employee_status,
    filters.id_employee,
    filters.id_position,
    search,
  ]);

  const visibleEmployeeIds = useMemo(
    () =>
      new Set(
        filteredEmployees.map(
          (employee) =>
            String(employee.id_employee),
        ),
      ),
    [filteredEmployees],
  );

  const filteredAttendance = useMemo(() => {
    const normalizedSearch =
      search.trim().toLowerCase();

    return attendance
      .filter((record) => {
        if (
          filters.id_employee &&
          String(record.id_employee) !==
            String(filters.id_employee)
        ) {
          return false;
        }

        if (
          filters.id_position ||
          filters.employee_status
        ) {
          if (
            !visibleEmployeeIds.has(
              String(record.id_employee),
            )
          ) {
            return false;
          }
        }

        if (!normalizedSearch) {
          return true;
        }

        const values = [
          record.employee_name,
          record.position_name,
          record.date,
          record.attendance_date,
          formatDate(
            record.date ||
              record.attendance_date,
          ),
          record.notes,
        ];

        return values.some((value) =>
          String(value || '')
            .toLowerCase()
            .includes(normalizedSearch),
        );
      })
      .sort((a, b) => {
        const dateA = String(
          a.date ||
            a.attendance_date ||
            '',
        );

        const dateB = String(
          b.date ||
            b.attendance_date ||
            '',
        );

        if (dateA !== dateB) {
          return dateB.localeCompare(dateA);
        }

        return String(
          a.employee_name || '',
        ).localeCompare(
          String(
            b.employee_name || '',
          ),
          'es',
        );
      });
  }, [
    attendance,
    filters.employee_status,
    filters.id_employee,
    filters.id_position,
    search,
    visibleEmployeeIds,
  ]);

  const filteredPositions = useMemo(() => {
    const normalizedSearch =
      search.trim().toLowerCase();

    return positions
      .filter((position) => {
        if (
          filters.id_position &&
          String(position.id_position) !==
            String(filters.id_position)
        ) {
          return false;
        }

        if (!normalizedSearch) {
          return true;
        }

        return `${position.name || ''} ${
          position.description || ''
        }`
          .toLowerCase()
          .includes(normalizedSearch);
      })
      .sort((a, b) =>
        String(a.name || '').localeCompare(
          String(b.name || ''),
          'es',
        ),
      );
  }, [
    filters.id_position,
    positions,
    search,
  ]);

  const generalSummary = useMemo(() => {
    const employeeBase =
      filters.id_employee ||
      filters.id_position ||
      filters.employee_status ||
      search
        ? filteredEmployees
        : employees;

    const positionBase =
      filters.id_position || search
        ? filteredPositions
        : positions;

    const activeEmployees =
      employeeBase.filter((employee) =>
        isActive(employee.status),
      ).length;

    const activePositions =
      positionBase.filter((position) =>
        isActive(position.status),
      ).length;

    let lateCount = 0;
    let onTimeCount = 0;
    let completedCount = 0;
    let workedMinutes = 0;
    let overtimeMinutes = 0;
    let invalidRecords = 0;

    filteredAttendance.forEach((record) => {
      const metrics =
        getAttendanceMetrics(record);

      if (metrics.invalidTime) {
        invalidRecords += 1;
      }

      if (
        metrics.lateMinutes !== null
      ) {
        if (metrics.lateMinutes > 0) {
          lateCount += 1;
        } else {
          onTimeCount += 1;
        }
      }

      if (
        record.exit_time ||
        record.check_out
      ) {
        completedCount += 1;
      }

      if (
        metrics.workedMinutes !== null
      ) {
        workedMinutes +=
          metrics.workedMinutes;
      }

      if (
        metrics.overtimeMinutes !== null
      ) {
        overtimeMinutes +=
          metrics.overtimeMinutes;
      }
    });

    return {
      totalEmployees:
        employeeBase.length,
      activeEmployees,
      inactiveEmployees:
        employeeBase.length -
        activeEmployees,
      activePositions,
      attendanceRecords:
        filteredAttendance.length,
      lateCount,
      onTimeCount,
      completedCount,
      workedMinutes,
      overtimeMinutes,
      invalidRecords,
    };
  }, [
    employees,
    filteredAttendance,
    filteredEmployees,
    filteredPositions,
    filters.employee_status,
    filters.id_employee,
    filters.id_position,
    positions,
    search,
  ]);

  const employeeReport = useMemo(() => {
    return filteredEmployees
      .map((employee) => {
        const records =
          filteredAttendance.filter(
            (record) =>
              String(record.id_employee) ===
              String(employee.id_employee),
          );

        let lateCount = 0;
        let onTimeCount = 0;
        let workedMinutes = 0;
        let overtimeMinutes = 0;
        let invalidRecords = 0;

        records.forEach((record) => {
          const metrics =
            getAttendanceMetrics(record);

          if (metrics.invalidTime) {
            invalidRecords += 1;
          }

          if (
            metrics.lateMinutes !== null
          ) {
            if (
              metrics.lateMinutes > 0
            ) {
              lateCount += 1;
            } else {
              onTimeCount += 1;
            }
          }

          if (
            metrics.workedMinutes !== null
          ) {
            workedMinutes +=
              metrics.workedMinutes;
          }

          if (
            metrics.overtimeMinutes !== null
          ) {
            overtimeMinutes +=
              metrics.overtimeMinutes;
          }
        });

        return {
          ...employee,
          attendance_count:
            records.length,
          late_count:
            lateCount,
          on_time_count:
            onTimeCount,
          worked_minutes:
            workedMinutes,
          overtime_minutes:
            overtimeMinutes,
          invalid_records:
            invalidRecords,
        };
      })
      .sort((a, b) => {
        if (
          b.attendance_count !==
          a.attendance_count
        ) {
          return (
            b.attendance_count -
            a.attendance_count
          );
        }

        return `${a.first_name || ''} ${
          a.last_name || ''
        }`.localeCompare(
          `${b.first_name || ''} ${
            b.last_name || ''
          }`,
          'es',
        );
      });
  }, [
    filteredAttendance,
    filteredEmployees,
  ]);

  const positionReport = useMemo(() => {
    return filteredPositions.map(
      (position) => {
        const employeesInPosition =
          employees.filter((employee) => {
            if (
              String(employee.id_position) !==
              String(position.id_position)
            ) {
              return false;
            }

            if (
              filters.id_employee &&
              String(employee.id_employee) !==
                String(filters.id_employee)
            ) {
              return false;
            }

            if (
              filters.employee_status &&
              String(employee.status).toUpperCase() !==
                filters.employee_status
            ) {
              return false;
            }

            return true;
          });

        const activeEmployees =
          employeesInPosition.filter(
            (employee) =>
              isActive(employee.status),
          );

        const employeeIds =
          new Set(
            employeesInPosition.map(
              (employee) =>
                String(
                  employee.id_employee,
                ),
            ),
          );

        const attendanceRecords =
          filteredAttendance.filter(
            (record) =>
              employeeIds.has(
                String(
                  record.id_employee,
                ),
              ),
          );

        let lateCount = 0;
        let workedMinutes = 0;
        let invalidRecords = 0;

        attendanceRecords.forEach(
          (record) => {
            const metrics =
              getAttendanceMetrics(record);

            if (metrics.invalidTime) {
              invalidRecords += 1;
            }

            if (
              metrics.lateMinutes > 0
            ) {
              lateCount += 1;
            }

            if (
              metrics.workedMinutes !==
              null
            ) {
              workedMinutes +=
                metrics.workedMinutes;
            }
          },
        );

        return {
          ...position,
          total_employees:
            employeesInPosition.length,
          active_employees:
            activeEmployees.length,
          attendance_count:
            attendanceRecords.length,
          late_count:
            lateCount,
          worked_minutes:
            workedMinutes,
          invalid_records:
            invalidRecords,
        };
      },
    );
  }, [
    employees,
    filteredAttendance,
    filteredPositions,
    filters.employee_status,
    filters.id_employee,
  ]);

  const payrollYears = useMemo(() => {
    return Array.from(
      new Set(
        payrolls.map((payroll) =>
          String(payroll.payroll_year),
        ),
      ),
    )
      .filter(Boolean)
      .sort((a, b) => Number(b) - Number(a));
  }, [payrolls]);

  const filteredPayrolls = useMemo(() => {
    const normalizedSearch =
      search.trim().toLowerCase();

    return payrolls.filter((payroll) => {
      if (
        payrollFilters.month &&
        String(payroll.payroll_month) !==
          String(payrollFilters.month)
      ) {
        return false;
      }

      if (
        payrollFilters.year &&
        String(payroll.payroll_year) !==
          String(payrollFilters.year)
      ) {
        return false;
      }

      if (
        payrollFilters.status &&
        String(payroll.status).toUpperCase() !==
          payrollFilters.status
      ) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      const details =
        payrollDetails[
          String(payroll.id_payroll)
        ]?.details || [];

      const values = [
        getPayrollPeriodText(
          payroll.payroll_month,
          payroll.payroll_year,
        ),
        payroll.payroll_month,
        payroll.payroll_year,
        getPayrollStatusText(
          payroll.status,
        ),
        payroll.payment_date,
        ...details.flatMap((detail) => [
          detail.employee_name,
          detail.position_name,
        ]),
      ];

      return values.some((value) =>
        String(value || '')
          .toLowerCase()
          .includes(normalizedSearch),
      );
    });
  }, [
    payrollDetails,
    payrollFilters.month,
    payrollFilters.status,
    payrollFilters.year,
    payrolls,
    search,
  ]);

  const payrollSummary = useMemo(() => {
    const paid = filteredPayrolls.filter(
      (payroll) =>
        String(payroll.status).toUpperCase() ===
        'PAID',
    );

    return {
      total: filteredPayrolls.length,
      generated: filteredPayrolls.filter(
        (payroll) =>
          String(payroll.status).toUpperCase() ===
          'GENERATED',
      ).length,
      paid: paid.length,
      cancelled: filteredPayrolls.filter(
        (payroll) =>
          String(payroll.status).toUpperCase() ===
          'CANCELLED',
      ).length,
      totalPaid: paid.reduce(
        (sum, payroll) =>
          sum +
          safeNumber(
            payroll.total_net_salary,
          ),
        0,
      ),
    };
  }, [filteredPayrolls]);

  const selectedPayroll = useMemo(
    () =>
      payrolls.find(
        (payroll) =>
          String(payroll.id_payroll) ===
          String(selectedPayrollId),
      ) || null,
    [payrolls, selectedPayrollId],
  );

  const selectedPayrollDetails = useMemo(
    () =>
      payrollDetails[
        String(selectedPayrollId)
      ]?.details || [],
    [payrollDetails, selectedPayrollId],
  );

  const handlePayrollFilterChange = (
    event,
  ) => {
    const { name, value } = event.target;

    setPayrollFilters((current) => ({
      ...current,
      [name]: value,
    }));
  };

  const clearPayrollFilters = () => {
    setPayrollFilters({
      month: '',
      year: '',
      status: '',
    });
  };

  const reportFiltersText = useMemo(() => {
    const employeeText =
      selectedEmployee
        ? `${selectedEmployee.first_name} ${selectedEmployee.last_name}`
        : 'Todos';

    const positionText =
      selectedPosition
        ? selectedPosition.name
        : 'Todos';

    const statusText =
      filters.employee_status === 'ACTIVE'
        ? 'Activos'
        : filters.employee_status === 'INACTIVE'
          ? 'Inactivos'
          : 'Todos';

    const dateText =
      filters.date_from ||
      filters.date_to
        ? `${filters.date_from ? formatDate(filters.date_from) : 'Inicio'} - ${
            filters.date_to ? formatDate(filters.date_to) : 'Hoy'
          }`
        : 'Todo el historial';

    return {
      employeeText,
      positionText,
      statusText,
      dateText,
    };
  }, [
    filters.date_from,
    filters.date_to,
    filters.employee_status,
    selectedEmployee,
    selectedPosition,
  ]);

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
      filters.date_from >
        filters.date_to
    ) {
      setPageError(
        'La fecha inicial no puede ser posterior a la fecha final',
      );
      return;
    }

    await loadData(filters);
  };

  const clearFilters = async () => {
    const clean = {
      id_employee: '',
      id_position: '',
      employee_status: '',
      date_from: '',
      date_to: '',
    };

    setFilters(clean);
    setSearch('');

    await loadData(clean);
  };

  const exportAttendance = () => {
    const rows = [
      [
        'Empleado',
        'Cargo',
        'Fecha',
        'Entrada',
        'Salida',
        'Puntualidad',
        'Tardanza (min)',
        'Tiempo trabajado (min)',
        'Horas extra (min)',
        'Observación de datos',
        'Notas',
      ],
      ...filteredAttendance.map(
        (record) => {
          const metrics =
            getAttendanceMetrics(record);

          return [
            record.employee_name || '',
            record.position_name || '',
            formatDate(
              record.date ||
                record.attendance_date,
            ),
            formatTime(
              record.entry_time ||
                record.check_in,
            ),
            formatTime(
              record.exit_time ||
                record.check_out,
            ),
            metrics.lateMinutes === null
              ? 'Sin datos'
              : metrics.lateMinutes > 0
                ? 'Tarde'
                : 'Puntual',
            metrics.lateMinutes ?? '',
            metrics.workedMinutes ?? '',
            metrics.overtimeMinutes ?? '',
            metrics.invalidTime
              ? 'Hora de salida anterior a la entrada'
              : '',
            record.notes || '',
          ];
        },
      ),
    ];

    downloadCsv(
      'reporte_asistencia_rrhh.csv',
      rows,
    );

    setFeedback(
      'Reporte de asistencia exportado correctamente',
    );
  };

  const exportEmployees = () => {
    const rows = [
      [
        'Empleado',
        'Cargo',
        'Estado',
        'Correo',
        'Teléfono',
        'Asistencias',
        'Tardanzas',
        'Puntuales',
        'Horas trabajadas',
        'Horas extra',
        'Registros a revisar',
      ],
      ...employeeReport.map(
        (employee) => [
          `${employee.first_name || ''} ${
            employee.last_name || ''
          }`.trim(),
          employee.position_name || '',
          isActive(employee.status)
            ? 'Activo'
            : 'Inactivo',
          employee.email || '',
          employee.phone || '',
          employee.attendance_count,
          employee.late_count,
          employee.on_time_count,
          (
            employee.worked_minutes /
            60
          ).toFixed(2),
          (
            employee.overtime_minutes /
            60
          ).toFixed(2),
          employee.invalid_records,
        ],
      ),
    ];

    downloadCsv(
      'reporte_empleados_rrhh.csv',
      rows,
    );

    setFeedback(
      'Reporte de empleados exportado correctamente',
    );
  };

  const exportPositions = () => {
    const rows = [
      [
        'Cargo',
        'Estado',
        'Empleados',
        'Empleados activos',
        'Asistencias',
        'Tardanzas',
        'Horas trabajadas',
        'Registros a revisar',
      ],
      ...positionReport.map(
        (position) => [
          position.name || '',
          isActive(position.status)
            ? 'Activo'
            : 'Inactivo',
          position.total_employees,
          position.active_employees,
          position.attendance_count,
          position.late_count,
          (
            position.worked_minutes /
            60
          ).toFixed(2),
          position.invalid_records,
        ],
      ),
    ];

    downloadCsv(
      'reporte_cargos_rrhh.csv',
      rows,
    );

    setFeedback(
      'Reporte de cargos exportado correctamente',
    );
  };

  const exportPayrolls = () => {
    const rows = [
      [
        'Periodo',
        'Estado',
        'Empleados',
        'Total salario base',
        'Total salario neto',
        'Fecha de pago',
      ],
      ...filteredPayrolls.map(
        (payroll) => [
          getPayrollPeriodText(
            payroll.payroll_month,
            payroll.payroll_year,
          ),
          getPayrollStatusText(
            payroll.status,
          ),
          payroll.employee_count,
          safeNumber(
            payroll.total_base_salary,
          ).toFixed(2),
          safeNumber(
            payroll.total_net_salary,
          ).toFixed(2),
          formatDate(
            payroll.payment_date,
          ),
        ],
      ),
    ];

    downloadCsv(
      'reporte_planillas_rrhh.csv',
      rows,
    );

    setFeedback(
      'Reporte de planillas exportado correctamente',
    );
  };

  const exportSelectedPayroll = () => {
    if (!selectedPayroll) {
      return;
    }

    const rows = [
      [
        'Periodo',
        getPayrollPeriodText(
          selectedPayroll.payroll_month,
          selectedPayroll.payroll_year,
        ),
      ],
      [
        'Estado',
        getPayrollStatusText(
          selectedPayroll.status,
        ),
      ],
      [
        'Fecha de pago',
        formatDate(
          selectedPayroll.payment_date,
        ),
      ],
      [],
      [
        'Empleado',
        'Cargo',
        'Salario base',
        'Salario neto',
        'Estado en planilla',
      ],
      ...selectedPayrollDetails.map(
        (detail) => [
          detail.employee_name || '',
          detail.position_name || '',
          safeNumber(
            detail.base_salary,
          ).toFixed(2),
          safeNumber(
            detail.net_salary,
          ).toFixed(2),
          isActive(detail.status)
            ? 'Activo'
            : 'Inactivo',
        ],
      ),
    ];

    downloadCsv(
      `detalle_planilla_${selectedPayroll.payroll_year}_${String(
        selectedPayroll.payroll_month,
      ).padStart(2, '0')}.csv`,
      rows,
    );

    setFeedback(
      'Detalle de la planilla exportado correctamente',
    );
  };

  const printReport = () => {
    setFeedback('');
    window.print();
  };

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

  const filterInputStyle = {
    minWidth: '160px',
    padding: '10px 12px',
    background: '#1a1a1a',
    border:
      '1px solid #333333',
    borderRadius: '8px',
    color: '#ffffff',
    outline: 'none',
  };

  const tabButtonStyle = (
    selected,
  ) => ({
    border: 'none',
    borderBottom:
      selected
        ? '2px solid #ffffff'
        : '2px solid transparent',
    background:
      'transparent',
    color:
      selected
        ? '#ffffff'
        : '#777777',
    padding:
      '12px 16px',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: '12px',
  });

  const renderPunctuality = (record) => {
    const metrics =
      getAttendanceMetrics(record);

    if (metrics.lateMinutes === null) {
      return (
        <span className="status inactive">
          Sin datos
        </span>
      );
    }

    if (metrics.lateMinutes > 0) {
      return (
        <span
          style={{
            display: 'inline-block',
            padding: '5px 9px',
            borderRadius: '20px',
            background:
              'rgba(224, 0, 45, 0.12)',
            color: '#ff6b82',
            fontSize: '11px',
            fontWeight: 600,
          }}
        >
          Tarde {metrics.lateMinutes} min
        </span>
      );
    }

    return (
      <span className="status active">
        Puntual
      </span>
    );
  };

  return (
    <>
      <style>
        {`
          .print-report {
            display: none;
          }

          @media print {
  @page {
    size: 297mm 210mm;
    margin: 10mm;
  }

  html,
  body {
    width: 297mm !important;
    min-width: 297mm !important;
    height: auto !important;
    margin: 0 !important;
    padding: 0 !important;
    background: #ffffff !important;
    color: #111111 !important;
  }

  body {
    overflow: visible !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }

  .reports-screen {
    display: none !important;
  }

  .print-report {
    display: block !important;

    /* A4 horizontal:
       297 mm - 20 mm de márgenes = 277 mm útiles */
    width: 277mm !important;
    max-width: 277mm !important;
    min-width: 0 !important;

    margin: 0 auto !important;
    padding: 0 !important;

    color: #111111 !important;
    background: #ffffff !important;

    font-family: Arial, Helvetica, sans-serif;
    font-size: 9pt;

    transform: none !important;
    rotate: none !important;

    overflow: visible !important;
  }

  .print-report * {
    box-sizing: border-box;
  }

  .print-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;

    gap: 20px;

    width: 100%;

    padding-bottom: 10px;
    margin-bottom: 12px;

    border-bottom: 2px solid #8c1738;
  }

  .print-brand {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .print-logo {
    width: 54px;
    height: 54px;

    flex-shrink: 0;

    border-radius: 8px;

    display: flex;
    align-items: center;
    justify-content: center;

    background: #8c1738 !important;
    color: #ffffff !important;

    font-size: 16pt;
    font-weight: 800;
    letter-spacing: 1px;
  }

  .print-title {
    min-width: 0;
  }

  .print-title h1 {
    margin: 0 0 3px;

    font-size: 16pt;
    color: #111111;
  }

  .print-title p {
    margin: 0;

    color: #555555;
    font-size: 9pt;
  }

  .print-meta {
    flex-shrink: 0;

    text-align: right;

    font-size: 8pt;
    line-height: 1.5;

    color: #555555;
  }

  .print-filter-box {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));

    gap: 8px;

    width: 100%;

    margin-bottom: 12px;
    padding: 9px 10px;

    border: 1px solid #d4d4d4;
    border-radius: 6px;

    background: #f8f8f8 !important;

    break-inside: avoid;
    page-break-inside: avoid;
  }

  .print-filter-item {
    min-width: 0;
  }

  .print-filter-label {
    display: block;

    margin-bottom: 2px;

    color: #777777;

    font-size: 7pt;

    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .print-filter-value {
    display: block;

    color: #111111;

    font-weight: 700;

    white-space: normal;
    overflow-wrap: anywhere;
  }

  .print-summary {
    display: grid;
    grid-template-columns:
      repeat(6, minmax(0, 1fr));

    gap: 7px;

    width: 100%;

    margin-bottom: 14px;

    break-inside: avoid;
    page-break-inside: avoid;
  }

  .print-summary-card {
    min-width: 0;

    border: 1px solid #d4d4d4;
    border-radius: 6px;

    padding: 8px 9px;

    background: #ffffff !important;
  }

  .print-summary-label {
    display: block;

    min-height: 18px;

    color: #666666;

    font-size: 7pt;

    text-transform: uppercase;
    letter-spacing: 0.4px;
  }

  .print-summary-value {
    display: block;

    margin-top: 3px;

    color: #111111;

    font-size: 14pt;
    font-weight: 800;

    white-space: nowrap;
  }

  .print-warning {
    margin: 0 0 12px;

    padding: 8px 10px;

    border: 1px solid #d5a227;
    border-radius: 5px;

    background: #fff9e7 !important;

    color: #694b00;

    font-size: 8pt;

    break-inside: avoid;
    page-break-inside: avoid;
  }

  .print-section {
    width: 100%;

    margin-top: 14px;

    break-before: auto;
    page-break-before: auto;
  }

  .print-section + .print-section {
    break-before: page;
    page-break-before: always;
  }

  .print-section-title {
    display: flex;
    align-items: baseline;
    justify-content: space-between;

    gap: 10px;

    width: 100%;

    margin-bottom: 6px;

    break-after: avoid;
    page-break-after: avoid;
  }

  .print-section-title h2 {
    margin: 0;

    font-size: 11pt;

    color: #8c1738;
  }

  .print-section-title span {
    flex-shrink: 0;

    color: #777777;

    font-size: 8pt;
  }

  .print-table {
    width: 100% !important;
    max-width: 100% !important;

    border-collapse: collapse;

    table-layout: fixed;

    margin: 0;

    break-inside: auto;
    page-break-inside: auto;
  }

  .print-table thead {
    display: table-header-group;
  }

  .print-table tbody {
    display: table-row-group;
  }

  .print-table tr {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  .print-table th {
    padding: 6px 5px;

    border: 1px solid #c7c7c7;

    background: #eeeeee !important;

    color: #222222;

    text-align: left;

    font-size: 7.5pt;
    font-weight: 700;

    text-transform: uppercase;

    overflow-wrap: anywhere;
  }

  .print-table td {
    padding: 6px 5px;

    border: 1px solid #dddddd;

    color: #222222;

    font-size: 8pt;

    vertical-align: top;

    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .print-table tbody tr:nth-child(even) td {
    background: #fafafa !important;
  }

  .print-badge {
    display: inline-block;

    padding: 2px 5px;

    border-radius: 10px;
    border: 1px solid #bdbdbd;

    font-size: 7pt;
    font-weight: 700;

    white-space: nowrap;
  }

  .print-badge.good {
    border-color: #75a67f;

    color: #276039;

    background: #eef8f0 !important;
  }

  .print-badge.bad {
    border-color: #ce7b88;

    color: #8b2034;

    background: #fff1f3 !important;
  }

  .print-badge.neutral {
    color: #555555;

    background: #f4f4f4 !important;
  }

  .print-invalid {
    color: #8b2034;

    font-weight: 700;
  }

  .print-empty {
    padding: 14px !important;

    text-align: center;

    color: #777777 !important;
  }

  .print-footer {
    width: 100%;

    margin-top: 14px;
    padding-top: 7px;

    border-top: 1px solid #d4d4d4;

    display: flex;
    justify-content: space-between;

    gap: 12px;

    color: #777777;

    font-size: 7pt;

    break-inside: avoid;
    page-break-inside: avoid;
  }
}
        `}
      </style>

      <div className="employees-page reports-screen">
        <Sidebar />

        <main className="employees-content">
          <header className="employees-header">
            <div>
              <span>RECURSOS HUMANOS</span>
              <h1>Reportes</h1>
              <p>
                Analiza personal, asistencia, puntualidad, horas trabajadas y planillas
              </p>
            </div>

            <button
              type="button"
              className="new-employee-button"
              onClick={printReport}
              disabled={loading}
            >
              Imprimir reporte
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

          {generalSummary.invalidRecords > 0 && (
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
              Hay {generalSummary.invalidRecords} registro(s) histórico(s) con hora de salida anterior a la hora de entrada. Esos registros no se incluyen en el cálculo de horas trabajadas.
            </div>
          )}

          <section
            className="employees-panel"
            style={{ marginBottom: '20px' }}
          >
            <div style={{ padding: '20px 24px' }}>
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
                      </option>
                    ))}
                  </select>
                </div>

                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    flex: '1 1 190px',
                  }}
                >
                  <label
                    style={{
                      color: '#888888',
                      fontSize: '11px',
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
                      width: '100%',
                    }}
                  >
                    <option value="">
                      Todos los cargos
                    </option>

                    {positions.map((position) => (
                      <option
                        key={position.id_position}
                        value={position.id_position}
                      >
                        {position.name}
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
                    name="employee_status"
                    value={
                      filters.employee_status
                    }
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
                  Aplicar
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

          <section
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(160px, 1fr))',
              gap: '16px',
              marginBottom: '20px',
            }}
          >
            <div style={statCardStyle}>
              <div style={statLabelStyle}>
                Empleados
              </div>
              <div style={statValueStyle}>
                {generalSummary.totalEmployees}
              </div>
            </div>

            <div style={statCardStyle}>
              <div style={statLabelStyle}>
                Activos
              </div>
              <div style={statValueStyle}>
                {generalSummary.activeEmployees}
              </div>
            </div>

            <div style={statCardStyle}>
              <div style={statLabelStyle}>
                Inactivos
              </div>
              <div style={statValueStyle}>
                {generalSummary.inactiveEmployees}
              </div>
            </div>

            <div style={statCardStyle}>
              <div style={statLabelStyle}>
                Cargos activos
              </div>
              <div style={statValueStyle}>
                {generalSummary.activePositions}
              </div>
            </div>

            <div style={statCardStyle}>
              <div style={statLabelStyle}>
                Asistencias
              </div>
              <div style={statValueStyle}>
                {generalSummary.attendanceRecords}
              </div>
            </div>

            <div style={statCardStyle}>
              <div style={statLabelStyle}>
                Tardanzas
              </div>
              <div style={statValueStyle}>
                {generalSummary.lateCount}
              </div>
            </div>

            <div style={statCardStyle}>
              <div style={statLabelStyle}>
                Puntuales
              </div>
              <div style={statValueStyle}>
                {generalSummary.onTimeCount}
              </div>
            </div>

            <div style={statCardStyle}>
              <div style={statLabelStyle}>
                Horas trabajadas
              </div>
              <div style={statValueStyle}>
                {formatHours(
                  generalSummary.workedMinutes,
                )}
              </div>
            </div>

            <div style={statCardStyle}>
              <div style={statLabelStyle}>
                Horas extra
              </div>
              <div style={statValueStyle}>
                {formatHours(
                  generalSummary.overtimeMinutes,
                )}
              </div>
            </div>
          </section>

          <section className="employees-panel">
            <div
              style={{
                padding: '0 24px',
                borderBottom:
                  '1px solid #292929',
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent:
                  'space-between',
                gap: '12px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                }}
              >
                <button
                  type="button"
                  style={tabButtonStyle(
                    activeTab ===
                      'attendance',
                  )}
                  onClick={() =>
                    setActiveTab(
                      'attendance',
                    )
                  }
                >
                  Asistencia
                </button>

                <button
                  type="button"
                  style={tabButtonStyle(
                    activeTab ===
                      'employees',
                  )}
                  onClick={() =>
                    setActiveTab(
                      'employees',
                    )
                  }
                >
                  Por empleado
                </button>

                <button
                  type="button"
                  style={tabButtonStyle(
                    activeTab ===
                      'positions',
                  )}
                  onClick={() =>
                    setActiveTab(
                      'positions',
                    )
                  }
                >
                  Por cargo
                </button>

                <button
                  type="button"
                  style={tabButtonStyle(
                    activeTab ===
                      'payrolls',
                  )}
                  onClick={() =>
                    setActiveTab(
                      'payrolls',
                    )
                  }
                >
                  Planillas
                </button>
              </div>

              <input
                type="text"
                className="search-input"
                value={search}
                onChange={(event) =>
                  setSearch(
                    event.target.value,
                  )
                }
                placeholder="Buscar dentro del reporte..."
                style={{
                  margin: '10px 0',
                }}
              />
            </div>

            {loading ? (
              <div
                style={{
                  padding: '24px',
                }}
              >
                Cargando reportes...
              </div>
            ) : activeTab ===
              'attendance' ? (
              <>
                <div
                  style={{
                    padding:
                      '18px 24px 0',
                    display: 'flex',
                    justifyContent:
                      'space-between',
                    alignItems:
                      'center',
                    gap: '12px',
                    flexWrap: 'wrap',
                  }}
                >
                  <div>
                    <h2
                      style={{
                        margin:
                          '0 0 4px',
                      }}
                    >
                      Reporte de asistencia
                    </h2>
                    <p
                      style={{
                        margin: 0,
                        color:
                          '#777777',
                      }}
                    >
                      {
                        filteredAttendance.length
                      }{' '}
                      registros
                    </p>
                  </div>

                  <button
                    type="button"
                    className="action-button"
                    onClick={
                      exportAttendance
                    }
                    disabled={
                      filteredAttendance.length ===
                      0
                    }
                  >
                    Exportar CSV
                  </button>
                </div>

                <div className="table-container">
                  <table>
                    <thead>
                      <tr>
                        <th>Empleado</th>
                        <th>Cargo</th>
                        <th>Fecha</th>
                        <th>Entrada</th>
                        <th>Salida</th>
                        <th>Puntualidad</th>
                        <th>Tiempo trabajado</th>
                        <th>Horas extra</th>
                        <th>Notas</th>
                      </tr>
                    </thead>

                    <tbody>
                      {filteredAttendance.length ===
                      0 ? (
                        <tr>
                          <td colSpan="9">
                            No hay registros de asistencia para los filtros seleccionados.
                          </td>
                        </tr>
                      ) : (
                        filteredAttendance.map(
                          (record) => {
                            const metrics =
                              getAttendanceMetrics(
                                record,
                              );

                            return (
                              <tr
                                key={
                                  record.id_employee_attendance
                                }
                              >
                                <td>
                                  {record.employee_name ||
                                    'Sin empleado'}
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
                                  {renderPunctuality(
                                    record,
                                  )}
                                </td>

                                <td>
                                  {metrics.invalidTime
                                    ? (
                                      <span
                                        style={{
                                          color:
                                            '#ff6b82',
                                          fontWeight:
                                            600,
                                        }}
                                      >
                                        Revisar dato
                                      </span>
                                    )
                                    : formatDuration(
                                        metrics.workedMinutes,
                                      )}
                                </td>

                                <td>
                                  {metrics.invalidTime
                                    ? '-'
                                    : formatDuration(
                                        metrics.overtimeMinutes,
                                      )}
                                </td>

                                <td>
                                  {record.notes ||
                                    '-'}
                                </td>
                              </tr>
                            );
                          },
                        )
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            ) : activeTab ===
              'employees' ? (
              <>
                <div
                  style={{
                    padding:
                      '18px 24px 0',
                    display: 'flex',
                    justifyContent:
                      'space-between',
                    alignItems:
                      'center',
                    gap: '12px',
                    flexWrap: 'wrap',
                  }}
                >
                  <div>
                    <h2
                      style={{
                        margin:
                          '0 0 4px',
                      }}
                    >
                      Reporte por empleado
                    </h2>
                    <p
                      style={{
                        margin: 0,
                        color:
                          '#777777',
                      }}
                    >
                      Resumen de asistencia y tiempo trabajado
                    </p>
                  </div>

                  <button
                    type="button"
                    className="action-button"
                    onClick={
                      exportEmployees
                    }
                    disabled={
                      employeeReport.length ===
                      0
                    }
                  >
                    Exportar CSV
                  </button>
                </div>

                <div className="table-container">
                  <table>
                    <thead>
                      <tr>
                        <th>Empleado</th>
                        <th>Cargo</th>
                        <th>Estado</th>
                        <th>Asistencias</th>
                        <th>Puntuales</th>
                        <th>Tardanzas</th>
                        <th>Horas trabajadas</th>
                        <th>Horas extra</th>
                      </tr>
                    </thead>

                    <tbody>
                      {employeeReport.length ===
                      0 ? (
                        <tr>
                          <td colSpan="8">
                            No hay empleados para reportar.
                          </td>
                        </tr>
                      ) : (
                        employeeReport.map(
                          (employee) => (
                            <tr
                              key={
                                employee.id_employee
                              }
                            >
                              <td>
                                {
                                  employee.first_name
                                }{' '}
                                {
                                  employee.last_name
                                }
                              </td>

                              <td>
                                {employee.position_name ||
                                  'Sin cargo'}
                              </td>

                              <td>
                                <span
                                  className={`status ${
                                    isActive(
                                      employee.status,
                                    )
                                      ? 'active'
                                      : 'inactive'
                                  }`}
                                >
                                  {isActive(
                                    employee.status,
                                  )
                                    ? 'Activo'
                                    : 'Inactivo'}
                                </span>
                              </td>

                              <td>
                                {
                                  employee.attendance_count
                                }
                              </td>

                              <td>
                                {
                                  employee.on_time_count
                                }
                              </td>

                              <td>
                                {
                                  employee.late_count
                                }
                              </td>

                              <td>
                                {formatDuration(
                                  employee.worked_minutes,
                                )}
                              </td>

                              <td>
                                {formatDuration(
                                  employee.overtime_minutes,
                                )}
                              </td>
                            </tr>
                          ),
                        )
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            ) : activeTab ===
              'positions' ? (
              <>
                <div
                  style={{
                    padding:
                      '18px 24px 0',
                    display: 'flex',
                    justifyContent:
                      'space-between',
                    alignItems:
                      'center',
                    gap: '12px',
                    flexWrap: 'wrap',
                  }}
                >
                  <div>
                    <h2
                      style={{
                        margin:
                          '0 0 4px',
                      }}
                    >
                      Reporte por cargo
                    </h2>
                    <p
                      style={{
                        margin: 0,
                        color:
                          '#777777',
                      }}
                    >
                      Distribución del personal y asistencia por cargo
                    </p>
                  </div>

                  <button
                    type="button"
                    className="action-button"
                    onClick={
                      exportPositions
                    }
                    disabled={
                      positionReport.length ===
                      0
                    }
                  >
                    Exportar CSV
                  </button>
                </div>

                <div className="table-container">
                  <table>
                    <thead>
                      <tr>
                        <th>Cargo</th>
                        <th>Estado</th>
                        <th>Personal</th>
                        <th>Personal activo</th>
                        <th>Asistencias</th>
                        <th>Tardanzas</th>
                        <th>Horas trabajadas</th>
                      </tr>
                    </thead>

                    <tbody>
                      {positionReport.length ===
                      0 ? (
                        <tr>
                          <td colSpan="7">
                            No hay cargos para reportar.
                          </td>
                        </tr>
                      ) : (
                        positionReport.map(
                          (position) => (
                            <tr
                              key={
                                position.id_position
                              }
                            >
                              <td>
                                <strong>
                                  {
                                    position.name
                                  }
                                </strong>
                              </td>

                              <td>
                                <span
                                  className={`status ${
                                    isActive(
                                      position.status,
                                    )
                                      ? 'active'
                                      : 'inactive'
                                  }`}
                                >
                                  {isActive(
                                    position.status,
                                  )
                                    ? 'Activo'
                                    : 'Inactivo'}
                                </span>
                              </td>

                              <td>
                                {
                                  position.total_employees
                                }
                              </td>

                              <td>
                                {
                                  position.active_employees
                                }
                              </td>

                              <td>
                                {
                                  position.attendance_count
                                }
                              </td>

                              <td>
                                {
                                  position.late_count
                                }
                              </td>

                              <td>
                                {formatDuration(
                                  position.worked_minutes,
                                )}
                              </td>
                            </tr>
                          ),
                        )
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <>
                <div
                  style={{
                    padding: '18px 24px',
                    borderBottom:
                      '1px solid #292929',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent:
                        'space-between',
                      alignItems: 'flex-start',
                      gap: '16px',
                      flexWrap: 'wrap',
                    }}
                  >
                    <div>
                      <h2
                        style={{
                          margin: '0 0 4px',
                        }}
                      >
                        Reporte de planillas
                      </h2>
                      <p
                        style={{
                          margin: 0,
                          color: '#777777',
                        }}
                      >
                        Estado, pago y detalle de las planillas de salarios
                      </p>
                    </div>

                    <button
                      type="button"
                      className="action-button"
                      onClick={exportPayrolls}
                      disabled={
                        filteredPayrolls.length ===
                        0
                      }
                    >
                      Exportar CSV
                    </button>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '10px',
                      marginTop: '16px',
                      alignItems: 'end',
                    }}
                  >
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
                        Mes
                      </label>
                      <select
                        name="month"
                        value={
                          payrollFilters.month
                        }
                        onChange={
                          handlePayrollFilterChange
                        }
                        style={filterInputStyle}
                      >
                        <option value="">
                          Todos
                        </option>
                        {[
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
                        ].map(
                          (monthName, index) => (
                            <option
                              key={monthName}
                              value={index + 1}
                            >
                              {monthName}
                            </option>
                          ),
                        )}
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
                        Año
                      </label>
                      <select
                        name="year"
                        value={
                          payrollFilters.year
                        }
                        onChange={
                          handlePayrollFilterChange
                        }
                        style={filterInputStyle}
                      >
                        <option value="">
                          Todos
                        </option>
                        {payrollYears.map(
                          (year) => (
                            <option
                              key={year}
                              value={year}
                            >
                              {year}
                            </option>
                          ),
                        )}
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
                        value={
                          payrollFilters.status
                        }
                        onChange={
                          handlePayrollFilterChange
                        }
                        style={filterInputStyle}
                      >
                        <option value="">
                          Todos
                        </option>
                        <option value="GENERATED">
                          Generada
                        </option>
                        <option value="PAID">
                          Pagada
                        </option>
                        <option value="CANCELLED">
                          Cancelada
                        </option>
                      </select>
                    </div>

                    <button
                      type="button"
                      className="cancel-button"
                      onClick={
                        clearPayrollFilters
                      }
                    >
                      Limpiar
                    </button>
                  </div>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns:
                      'repeat(auto-fit, minmax(150px, 1fr))',
                    gap: '12px',
                    padding: '18px 24px 0',
                  }}
                >
                  <div style={statCardStyle}>
                    <div style={statLabelStyle}>
                      Planillas
                    </div>
                    <div style={statValueStyle}>
                      {payrollSummary.total}
                    </div>
                  </div>

                  <div style={statCardStyle}>
                    <div style={statLabelStyle}>
                      Generadas
                    </div>
                    <div style={statValueStyle}>
                      {payrollSummary.generated}
                    </div>
                  </div>

                  <div style={statCardStyle}>
                    <div style={statLabelStyle}>
                      Pagadas
                    </div>
                    <div style={statValueStyle}>
                      {payrollSummary.paid}
                    </div>
                  </div>

                  <div style={statCardStyle}>
                    <div style={statLabelStyle}>
                      Canceladas
                    </div>
                    <div style={statValueStyle}>
                      {payrollSummary.cancelled}
                    </div>
                  </div>

                  <div style={statCardStyle}>
                    <div style={statLabelStyle}>
                      Total pagado
                    </div>
                    <div style={statValueStyle}>
                      Bs {formatMoney(
                        payrollSummary.totalPaid,
                      )}
                    </div>
                  </div>
                </div>

                <div className="table-container">
                  <table>
                    <thead>
                      <tr>
                        <th>Periodo</th>
                        <th>Estado</th>
                        <th>Empleados</th>
                        <th>Total base</th>
                        <th>Total neto</th>
                        <th>Fecha de pago</th>
                        <th>Detalle</th>
                      </tr>
                    </thead>

                    <tbody>
                      {filteredPayrolls.length ===
                      0 ? (
                        <tr>
                          <td colSpan="7">
                            No hay planillas para los filtros seleccionados.
                          </td>
                        </tr>
                      ) : (
                        filteredPayrolls.map(
                          (payroll) => (
                            <tr
                              key={
                                payroll.id_payroll
                              }
                            >
                              <td>
                                <strong>
                                  {getPayrollPeriodText(
                                    payroll.payroll_month,
                                    payroll.payroll_year,
                                  )}
                                </strong>
                              </td>
                              <td>
                                <span
                                  className={`status ${getPayrollStatusClass(
                                    payroll.status,
                                  )}`}
                                >
                                  {getPayrollStatusText(
                                    payroll.status,
                                  )}
                                </span>
                              </td>
                              <td>
                                {payroll.employee_count}
                              </td>
                              <td>
                                Bs {formatMoney(
                                  payroll.total_base_salary,
                                )}
                              </td>
                              <td>
                                Bs {formatMoney(
                                  payroll.total_net_salary,
                                )}
                              </td>
                              <td>
                                {formatDate(
                                  payroll.payment_date,
                                )}
                              </td>
                              <td>
                                <button
                                  type="button"
                                  className="action-button"
                                  onClick={() =>
                                    setSelectedPayrollId(
                                      String(
                                        payroll.id_payroll,
                                      ),
                                    )
                                  }
                                >
                                  Ver detalle
                                </button>
                              </td>
                            </tr>
                          ),
                        )
                      )}
                    </tbody>
                  </table>
                </div>

                {selectedPayroll && (
                  <div
                    style={{
                      margin: '20px 24px 24px',
                      border:
                        '1px solid #292929',
                      borderRadius: '10px',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        padding: '16px 18px',
                        display: 'flex',
                        justifyContent:
                          'space-between',
                        alignItems: 'center',
                        gap: '12px',
                        flexWrap: 'wrap',
                        borderBottom:
                          '1px solid #292929',
                      }}
                    >
                      <div>
                        <h3
                          style={{
                            margin: '0 0 4px',
                          }}
                        >
                          Detalle de{' '}
                          {getPayrollPeriodText(
                            selectedPayroll.payroll_month,
                            selectedPayroll.payroll_year,
                          )}
                        </h3>
                        <p
                          style={{
                            margin: 0,
                            color: '#777777',
                            fontSize: '12px',
                          }}
                        >
                          {getPayrollStatusText(
                            selectedPayroll.status,
                          )}
                          {' · '}
                          Fecha de pago:{' '}
                          {formatDate(
                            selectedPayroll.payment_date,
                          )}
                        </p>
                      </div>

                      <button
                        type="button"
                        className="action-button"
                        onClick={
                          exportSelectedPayroll
                        }
                        disabled={
                          selectedPayrollDetails.length ===
                          0
                        }
                      >
                        Exportar detalle
                      </button>
                    </div>

                    <div className="table-container">
                      <table>
                        <thead>
                          <tr>
                            <th>Empleado</th>
                            <th>Cargo</th>
                            <th>Salario base</th>
                            <th>Salario neto</th>
                            <th>Estado</th>
                          </tr>
                        </thead>

                        <tbody>
                          {selectedPayrollDetails.length ===
                          0 ? (
                            <tr>
                              <td colSpan="5">
                                La planilla no tiene empleados registrados.
                              </td>
                            </tr>
                          ) : (
                            selectedPayrollDetails.map(
                              (detail) => (
                                <tr
                                  key={
                                    detail.id_payroll_detail
                                  }
                                >
                                  <td>
                                    {detail.employee_name ||
                                      'Sin empleado'}
                                  </td>
                                  <td>
                                    {detail.position_name ||
                                      '-'}
                                  </td>
                                  <td>
                                    Bs {formatMoney(
                                      detail.base_salary,
                                    )}
                                  </td>
                                  <td>
                                    Bs {formatMoney(
                                      detail.net_salary,
                                    )}
                                  </td>
                                  <td>
                                    <span
                                      className={`status ${
                                        isActive(
                                          detail.status,
                                        )
                                          ? 'active'
                                          : 'inactive'
                                      }`}
                                    >
                                      {isActive(
                                        detail.status,
                                      )
                                        ? 'Activo'
                                        : 'Inactivo'}
                                    </span>
                                  </td>
                                </tr>
                              ),
                            )
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>

          <div
            style={{
              marginTop: '12px',
              color: '#666666',
              fontSize: '10px',
              textAlign: 'right',
            }}
          >
            {lastUpdated
              ? `Datos actualizados: ${formatDateTime(
                  lastUpdated,
                )}`
              : ''}
          </div>
        </main>
      </div>

      <div className="print-report">
        <header className="print-header">
          <div className="print-brand">
            <div className="print-logo">
              MQS
            </div>

            <div className="print-title">
              <h1>
                Gimnasio MQS
              </h1>
              <p>
                Recursos Humanos · Reporte de personal, asistencia y planillas
              </p>
            </div>
          </div>

          <div className="print-meta">
            <strong>
              Reporte administrativo
            </strong>
            <br />
            Generado: {formatDateTime(new Date())}
            <br />
            {lastUpdated
              ? `Datos actualizados: ${formatDateTime(
                  lastUpdated,
                )}`
              : ''}
          </div>
        </header>

        <div className="print-filter-box">
          <div className="print-filter-item">
            <span className="print-filter-label">
              Empleado
            </span>
            <span className="print-filter-value">
              {reportFiltersText.employeeText}
            </span>
          </div>

          <div className="print-filter-item">
            <span className="print-filter-label">
              Cargo
            </span>
            <span className="print-filter-value">
              {reportFiltersText.positionText}
            </span>
          </div>

          <div className="print-filter-item">
            <span className="print-filter-label">
              Estado
            </span>
            <span className="print-filter-value">
              {reportFiltersText.statusText}
            </span>
          </div>

          <div className="print-filter-item">
            <span className="print-filter-label">
              Periodo
            </span>
            <span className="print-filter-value">
              {reportFiltersText.dateText}
            </span>
          </div>
        </div>

        <div className="print-summary">
          <div className="print-summary-card">
            <span className="print-summary-label">
              Empleados
            </span>
            <span className="print-summary-value">
              {generalSummary.totalEmployees}
            </span>
          </div>

          <div className="print-summary-card">
            <span className="print-summary-label">
              Activos
            </span>
            <span className="print-summary-value">
              {generalSummary.activeEmployees}
            </span>
          </div>

          <div className="print-summary-card">
            <span className="print-summary-label">
              Asistencias
            </span>
            <span className="print-summary-value">
              {generalSummary.attendanceRecords}
            </span>
          </div>

          <div className="print-summary-card">
            <span className="print-summary-label">
              Puntuales
            </span>
            <span className="print-summary-value">
              {generalSummary.onTimeCount}
            </span>
          </div>

          <div className="print-summary-card">
            <span className="print-summary-label">
              Tardanzas
            </span>
            <span className="print-summary-value">
              {generalSummary.lateCount}
            </span>
          </div>

          <div className="print-summary-card">
            <span className="print-summary-label">
              Horas trabajadas
            </span>
            <span className="print-summary-value">
              {formatHours(
                generalSummary.workedMinutes,
              )}
            </span>
          </div>
        </div>

        {generalSummary.invalidRecords > 0 && (
          <div className="print-warning">
            Atención: existen {generalSummary.invalidRecords} registro(s) con hora de salida anterior a la entrada. Se muestran marcados para revisión y no se consideran en el cálculo de horas trabajadas.
          </div>
        )}

        <section className="print-section">
          <div className="print-section-title">
            <h2>
              Asistencia
            </h2>
            <span>
              {filteredAttendance.length} registro(s)
            </span>
          </div>

          <table className="print-table">
            <thead>
              <tr>
                <th style={{ width: '16%' }}>
                  Empleado
                </th>
                <th style={{ width: '12%' }}>
                  Cargo
                </th>
                <th style={{ width: '9%' }}>
                  Fecha
                </th>
                <th style={{ width: '8%' }}>
                  Entrada
                </th>
                <th style={{ width: '8%' }}>
                  Salida
                </th>
                <th style={{ width: '12%' }}>
                  Puntualidad
                </th>
                <th style={{ width: '12%' }}>
                  Trabajado
                </th>
                <th style={{ width: '10%' }}>
                  Extra
                </th>
                <th style={{ width: '13%' }}>
                  Notas
                </th>
              </tr>
            </thead>

            <tbody>
              {filteredAttendance.length === 0 ? (
                <tr>
                  <td
                    colSpan="9"
                    className="print-empty"
                  >
                    No hay registros de asistencia para los filtros seleccionados.
                  </td>
                </tr>
              ) : (
                filteredAttendance.map(
                  (record) => {
                    const metrics =
                      getAttendanceMetrics(
                        record,
                      );

                    return (
                      <tr
                        key={`print-attendance-${record.id_employee_attendance}`}
                      >
                        <td>
                          {record.employee_name ||
                            'Sin empleado'}
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
                            <span className="print-badge neutral">
                              Sin datos
                            </span>
                          ) : metrics.lateMinutes >
                            0 ? (
                            <span className="print-badge bad">
                              Tarde {metrics.lateMinutes} min
                            </span>
                          ) : (
                            <span className="print-badge good">
                              Puntual
                            </span>
                          )}
                        </td>
                        <td>
                          {metrics.invalidTime ? (
                            <span className="print-invalid">
                              Revisar
                            </span>
                          ) : (
                            formatDuration(
                              metrics.workedMinutes,
                            )
                          )}
                        </td>
                        <td>
                          {metrics.invalidTime
                            ? '-'
                            : formatDuration(
                                metrics.overtimeMinutes,
                              )}
                        </td>
                        <td>
                          {record.notes || '-'}
                        </td>
                      </tr>
                    );
                  },
                )
              )}
            </tbody>
          </table>
        </section>

        <section className="print-section">
          <div className="print-section-title">
            <h2>
              Resumen por empleado
            </h2>
            <span>
              {employeeReport.length} empleado(s)
            </span>
          </div>

          <table className="print-table">
            <thead>
              <tr>
                <th>Empleado</th>
                <th>Cargo</th>
                <th>Estado</th>
                <th>Asistencias</th>
                <th>Puntuales</th>
                <th>Tardanzas</th>
                <th>Horas trabajadas</th>
                <th>Horas extra</th>
              </tr>
            </thead>

            <tbody>
              {employeeReport.length === 0 ? (
                <tr>
                  <td
                    colSpan="8"
                    className="print-empty"
                  >
                    No hay empleados para reportar.
                  </td>
                </tr>
              ) : (
                employeeReport.map(
                  (employee) => (
                    <tr
                      key={`print-employee-${employee.id_employee}`}
                    >
                      <td>
                        {employee.first_name}{' '}
                        {employee.last_name}
                      </td>
                      <td>
                        {employee.position_name ||
                          'Sin cargo'}
                      </td>
                      <td>
                        <span
                          className={`print-badge ${
                            isActive(
                              employee.status,
                            )
                              ? 'good'
                              : 'neutral'
                          }`}
                        >
                          {isActive(
                            employee.status,
                          )
                            ? 'Activo'
                            : 'Inactivo'}
                        </span>
                      </td>
                      <td>
                        {employee.attendance_count}
                      </td>
                      <td>
                        {employee.on_time_count}
                      </td>
                      <td>
                        {employee.late_count}
                      </td>
                      <td>
                        {formatDuration(
                          employee.worked_minutes,
                        )}
                      </td>
                      <td>
                        {formatDuration(
                          employee.overtime_minutes,
                        )}
                      </td>
                    </tr>
                  ),
                )
              )}
            </tbody>
          </table>
        </section>

        <section className="print-section">
          <div className="print-section-title">
            <h2>
              Resumen por cargo
            </h2>
            <span>
              {positionReport.length} cargo(s)
            </span>
          </div>

          <table className="print-table">
            <thead>
              <tr>
                <th>Cargo</th>
                <th>Estado</th>
                <th>Personal</th>
                <th>Personal activo</th>
                <th>Asistencias</th>
                <th>Tardanzas</th>
                <th>Horas trabajadas</th>
              </tr>
            </thead>

            <tbody>
              {positionReport.length === 0 ? (
                <tr>
                  <td
                    colSpan="7"
                    className="print-empty"
                  >
                    No hay cargos para reportar.
                  </td>
                </tr>
              ) : (
                positionReport.map(
                  (position) => (
                    <tr
                      key={`print-position-${position.id_position}`}
                    >
                      <td>
                        {position.name}
                      </td>
                      <td>
                        <span
                          className={`print-badge ${
                            isActive(
                              position.status,
                            )
                              ? 'good'
                              : 'neutral'
                          }`}
                        >
                          {isActive(
                            position.status,
                          )
                            ? 'Activo'
                            : 'Inactivo'}
                        </span>
                      </td>
                      <td>
                        {position.total_employees}
                      </td>
                      <td>
                        {position.active_employees}
                      </td>
                      <td>
                        {position.attendance_count}
                      </td>
                      <td>
                        {position.late_count}
                      </td>
                      <td>
                        {formatDuration(
                          position.worked_minutes,
                        )}
                      </td>
                    </tr>
                  ),
                )
              )}
            </tbody>
          </table>
        </section>

        <section className="print-section">
          <div className="print-section-title">
            <h2>
              Planillas de salarios
            </h2>
            <span>
              {filteredPayrolls.length} planilla(s)
            </span>
          </div>

          <table className="print-table">
            <thead>
              <tr>
                <th>Periodo</th>
                <th>Estado</th>
                <th>Empleados</th>
                <th>Total base</th>
                <th>Total neto</th>
                <th>Fecha de pago</th>
              </tr>
            </thead>

            <tbody>
              {filteredPayrolls.length === 0 ? (
                <tr>
                  <td
                    colSpan="6"
                    className="print-empty"
                  >
                    No hay planillas para reportar.
                  </td>
                </tr>
              ) : (
                filteredPayrolls.map(
                  (payroll) => (
                    <tr
                      key={`print-payroll-${payroll.id_payroll}`}
                    >
                      <td>
                        {getPayrollPeriodText(
                          payroll.payroll_month,
                          payroll.payroll_year,
                        )}
                      </td>
                      <td>
                        <span
                          className={`print-badge ${
                            String(
                              payroll.status,
                            ).toUpperCase() ===
                            'PAID'
                              ? 'good'
                              : String(
                                    payroll.status,
                                  ).toUpperCase() ===
                                  'CANCELLED'
                                ? 'bad'
                                : 'neutral'
                          }`}
                        >
                          {getPayrollStatusText(
                            payroll.status,
                          )}
                        </span>
                      </td>
                      <td>
                        {payroll.employee_count}
                      </td>
                      <td>
                        Bs {formatMoney(
                          payroll.total_base_salary,
                        )}
                      </td>
                      <td>
                        Bs {formatMoney(
                          payroll.total_net_salary,
                        )}
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
        </section>

        {selectedPayroll && (
          <section className="print-section">
            <div className="print-section-title">
              <h2>
                Detalle de planilla ·{' '}
                {getPayrollPeriodText(
                  selectedPayroll.payroll_month,
                  selectedPayroll.payroll_year,
                )}
              </h2>
              <span>
                {selectedPayrollDetails.length}{' '}
                empleado(s)
              </span>
            </div>

            <table className="print-table">
              <thead>
                <tr>
                  <th>Empleado</th>
                  <th>Cargo</th>
                  <th>Salario base</th>
                  <th>Salario neto</th>
                  <th>Estado</th>
                </tr>
              </thead>

              <tbody>
                {selectedPayrollDetails.length ===
                0 ? (
                  <tr>
                    <td
                      colSpan="5"
                      className="print-empty"
                    >
                      La planilla no tiene empleados registrados.
                    </td>
                  </tr>
                ) : (
                  selectedPayrollDetails.map(
                    (detail) => (
                      <tr
                        key={`print-payroll-detail-${detail.id_payroll_detail}`}
                      >
                        <td>
                          {detail.employee_name ||
                            'Sin empleado'}
                        </td>
                        <td>
                          {detail.position_name ||
                            '-'}
                        </td>
                        <td>
                          Bs {formatMoney(
                            detail.base_salary,
                          )}
                        </td>
                        <td>
                          Bs {formatMoney(
                            detail.net_salary,
                          )}
                        </td>
                        <td>
                          {isActive(
                            detail.status,
                          )
                            ? 'Activo'
                            : 'Inactivo'}
                        </td>
                      </tr>
                    ),
                  )
                )}
              </tbody>
            </table>
          </section>
        )}

        <footer className="print-footer">
          <span>
            Gimnasio MQS · Recursos Humanos
          </span>
          <span>
            Documento generado desde el sistema de gestión
          </span>
        </footer>
      </div>
    </>
  );
}

export default Reports;
