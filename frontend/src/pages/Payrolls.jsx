import { useEffect, useMemo, useState } from 'react';
import Sidebar from '../components/Sidebar';
import { API_URL } from '../config/api';
import './Employees.css';

const MONTHS = [
  { value: 1, label: 'Enero' },
  { value: 2, label: 'Febrero' },
  { value: 3, label: 'Marzo' },
  { value: 4, label: 'Abril' },
  { value: 5, label: 'Mayo' },
  { value: 6, label: 'Junio' },
  { value: 7, label: 'Julio' },
  { value: 8, label: 'Agosto' },
  { value: 9, label: 'Septiembre' },
  { value: 10, label: 'Octubre' },
  { value: 11, label: 'Noviembre' },
  { value: 12, label: 'Diciembre' },
];

const PAYROLL_STATUS_OPTIONS = [
  {
    value: 'GENERATED',
    label: 'Generada',
  },
  {
    value: 'PAID',
    label: 'Pagada',
  },
  {
    value: 'CANCELLED',
    label: 'Cancelada',
  },
];

const getTodayString = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(
    now.getMonth() + 1,
  ).padStart(2, '0');
  const day = String(
    now.getDate(),
  ).padStart(2, '0');

  return `${year}-${month}-${day}`;
};

const formatDate = (value) => {
  if (!value) return '-';

  const normalized =
    String(value).slice(0, 10);

  const [
    year,
    month,
    day,
  ] = normalized.split('-');

  if (!year || !month || !day) {
    return normalized;
  }

  return `${day}/${month}/${year}`;
};

const formatDateTime = (value) => {
  if (!value) return '-';

  const date = new Date(value);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return String(value);
  }

  return date.toLocaleString(
    'es-BO',
    {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    },
  );
};

const formatMoney = (value) => {
  const amount = Number(value);

  if (!Number.isFinite(amount)) {
    return 'Bs 0,00';
  }

  return new Intl.NumberFormat(
    'es-BO',
    {
      style: 'currency',
      currency: 'BOB',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    },
  ).format(amount);
};

const parseMoney = (value) => {
  const normalized =
    String(value ?? '')
      .replace(',', '.')
      .trim();

  const amount =
    Number(normalized);

  return Number.isFinite(amount)
    ? amount
    : NaN;
};

const parseResponse = async (
  response,
) => {
  const text =
    await response.text();

  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    return {
      message: text,
    };
  }
};

const getErrorMessage = (
  data,
  fallback,
) => {
  if (
    data &&
    typeof data === 'object' &&
    typeof data.message ===
      'string' &&
    data.message.trim()
  ) {
    return data.message;
  }

  return fallback;
};

const normalizeSearchText = (
  value,
) =>
  String(value || '')
    .trim()
    .toLocaleLowerCase('es');

const getMonthLabel = (month) =>
  MONTHS.find(
    (item) =>
      Number(item.value) ===
      Number(month),
  )?.label || `Mes ${month}`;

const formatPeriod = (
  month,
  year,
) =>
  `${getMonthLabel(month)} ${year}`;

const getPayrollStatusLabel = (
  status,
) => {
  const normalized =
    String(status || '')
      .trim()
      .toUpperCase();

  if (normalized === 'PAID') {
    return 'Pagada';
  }

  if (
    normalized === 'CANCELLED'
  ) {
    return 'Cancelada';
  }

  return 'Generada';
};

const getPayrollStatusStyle = (
  status,
) => {
  const normalized =
    String(status || '')
      .trim()
      .toUpperCase();

  if (normalized === 'PAID') {
    return {
      background:
        'rgba(30, 150, 80, 0.12)',
      color: '#5cc98a',
      border:
        '1px solid rgba(30, 150, 80, 0.25)',
    };
  }

  if (
    normalized === 'CANCELLED'
  ) {
    return {
      background:
        'rgba(224, 0, 45, 0.12)',
      color: '#ff6b82',
      border:
        '1px solid rgba(224, 0, 45, 0.25)',
    };
  }

  return {
    background:
      'rgba(255, 184, 0, 0.10)',
    color: '#ffc94d',
    border:
      '1px solid rgba(255, 184, 0, 0.25)',
  };
};

const csvEscape = (value) => {
  const text =
    String(
      value === null ||
        value === undefined
        ? ''
        : value,
    );

  return `"${text.replace(
    /"/g,
    '""',
  )}"`;
};

const downloadCsv = (
  filename,
  rows,
) => {
  const csv =
    rows
      .map((row) =>
        row
          .map(csvEscape)
          .join(';'),
      )
      .join('\n');

  const blob =
    new Blob(
      [`\uFEFF${csv}`],
      {
        type:
          'text/csv;charset=utf-8;',
      },
    );

  const url =
    URL.createObjectURL(blob);

  const link =
    document.createElement('a');

  link.href = url;
  link.setAttribute(
    'download',
    filename,
  );

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
};

function Payrolls() {
  const today =
    getTodayString();

  const now =
    new Date();

  const currentMonth =
    now.getMonth() + 1;

  const currentYear =
    now.getFullYear();

  const [payrolls, setPayrolls] =
    useState([]);

  const [employees, setEmployees] =
    useState([]);

  const [salaries, setSalaries] =
    useState([]);

  const [loading, setLoading] =
    useState(true);

  const [
    detailsLoading,
    setDetailsLoading,
  ] = useState(false);

  const [saving, setSaving] =
    useState(false);

  const [
    pageError,
    setPageError,
  ] = useState('');

  const [feedback, setFeedback] =
    useState('');

  const [search, setSearch] =
    useState('');

  const [filters, setFilters] =
    useState({
      month: '',
      year: '',
      status: '',
    });

  const [
    showGenerateModal,
    setShowGenerateModal,
  ] = useState(false);

  const [
    generateForm,
    setGenerateForm,
  ] = useState({
    payroll_month:
      String(currentMonth),
    payroll_year:
      String(currentYear),
  });

  const [
    selectedPayroll,
    setSelectedPayroll,
  ] = useState(null);

  const [
    netSalaryDrafts,
    setNetSalaryDrafts,
  ] = useState({});

  const [
    paymentDate,
    setPaymentDate,
  ] = useState(today);

  const [
    printPayroll,
    setPrintPayroll,
  ] = useState(null);

  const requestJson = async (
    url,
    options = {},
    fallbackMessage =
      'Ocurrió un error',
  ) => {
    const response =
      await fetch(
        url,
        options,
      );

    const data =
      await parseResponse(
        response,
      );

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

  const buildPayrollUrl = (
    appliedFilters = filters,
  ) => {
    const params =
      new URLSearchParams();

    if (
      appliedFilters.month
    ) {
      params.set(
        'month',
        appliedFilters.month,
      );
    }

    if (
      appliedFilters.year
    ) {
      params.set(
        'year',
        appliedFilters.year,
      );
    }

    if (
      appliedFilters.status
    ) {
      params.set(
        'status',
        appliedFilters.status,
      );
    }

    const query =
      params.toString();

    return query
      ? `${API_URL}/api/payrolls?${query}`
      : `${API_URL}/api/payrolls`;
  };

  const loadData = async (
    appliedFilters = filters,
  ) => {
    try {
      setLoading(true);
      setPageError('');

      const [
        payrollData,
        employeeData,
        salaryData,
      ] = await Promise.all([
        requestJson(
          buildPayrollUrl(
            appliedFilters,
          ),
          {},
          'No se pudieron cargar las planillas',
        ),
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

      setPayrolls(
        Array.isArray(payrollData)
          ? payrollData
          : [],
      );

      setEmployees(
        Array.isArray(employeeData)
          ? employeeData
          : [],
      );

      setSalaries(
        Array.isArray(salaryData)
          ? salaryData
          : [],
      );
    } catch (error) {
      console.error(error);

      setPageError(
        error.message ||
          'No se pudo cargar la gestión de planillas',
      );
    } finally {
      setLoading(false);
    }
  };

  const loadPayrollDetail =
    async (
      idPayroll,
      {
        keepError = false,
      } = {},
    ) => {
      try {
        setDetailsLoading(true);

        if (!keepError) {
          setPageError('');
        }

        const data =
          await requestJson(
            `${API_URL}/api/payrolls/${idPayroll}`,
            {},
            'No se pudo cargar el detalle de la planilla',
          );

        setSelectedPayroll(
          data,
        );

        setPaymentDate(
          data.payment_date
            ? String(
                data.payment_date,
              ).slice(0, 10)
            : today,
        );

        const drafts = {};

        (
          Array.isArray(
            data.details,
          )
            ? data.details
            : []
        ).forEach((detail) => {
          drafts[
            detail.id_payroll_detail
          ] = String(
            detail.net_salary ??
              '',
          );
        });

        setNetSalaryDrafts(
          drafts,
        );

        return data;
      } catch (error) {
        console.error(error);

        setPageError(
          error.message ||
            'No se pudo cargar el detalle de la planilla',
        );

        return null;
      } finally {
        setDetailsLoading(false);
      }
    };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (!feedback) {
      return undefined;
    }

    const timeout =
      window.setTimeout(
        () => {
          setFeedback('');
        },
        3500,
      );

    return () => {
      window.clearTimeout(
        timeout,
      );
    };
  }, [feedback]);

  useEffect(() => {
    const handleEscape = (
      event,
    ) => {
      if (
        event.key !==
        'Escape'
      ) {
        return;
      }

      if (
        showGenerateModal &&
        !saving
      ) {
        setShowGenerateModal(
          false,
        );
        return;
      }

      if (
        selectedPayroll &&
        !saving
      ) {
        setSelectedPayroll(
          null,
        );
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
  }, [
    saving,
    selectedPayroll,
    showGenerateModal,
  ]);

  const activeEmployees =
    useMemo(
      () =>
        employees.filter(
          (employee) =>
            String(
              employee.status ||
                '',
            ).toUpperCase() ===
            'ACTIVE',
        ),
      [employees],
    );

  const activeSalaryByEmployee =
    useMemo(() => {
      const map =
        new Map();

      salaries
        .filter(
          (salary) =>
            String(
              salary.status ||
                '',
            ).toUpperCase() ===
            'ACTIVE',
        )
        .sort((a, b) => {
          const dateA =
            String(
              a.effective_date ||
                '',
            ).slice(0, 10);

          const dateB =
            String(
              b.effective_date ||
                '',
            ).slice(0, 10);

          if (
            dateA !== dateB
          ) {
            return dateB.localeCompare(
              dateA,
            );
          }

          return (
            Number(
              b.id_salary ||
                0,
            ) -
            Number(
              a.id_salary ||
                0,
            )
          );
        })
        .forEach(
          (salary) => {
            const key =
              String(
                salary.id_employee,
              );

            if (
              !map.has(key)
            ) {
              map.set(
                key,
                salary,
              );
            }
          },
        );

      return map;
    }, [salaries]);

  const employeesWithoutSalary =
    useMemo(
      () =>
        activeEmployees.filter(
          (employee) =>
            !activeSalaryByEmployee.has(
              String(
                employee.id_employee,
              ),
            ),
        ),
      [
        activeEmployees,
        activeSalaryByEmployee,
      ],
    );

  const filteredPayrolls =
    useMemo(() => {
      const normalizedSearch =
        normalizeSearchText(
          search,
        );

      return payrolls
        .filter(
          (payroll) => {
            if (
              !normalizedSearch
            ) {
              return true;
            }

            const values = [
              payroll.id_payroll,
              formatPeriod(
                payroll.payroll_month,
                payroll.payroll_year,
              ),
              getPayrollStatusLabel(
                payroll.status,
              ),
              payroll.employee_count,
              formatMoney(
                payroll.total_base_salary,
              ),
              formatMoney(
                payroll.total_net_salary,
              ),
              payroll.payment_date,
              formatDate(
                payroll.payment_date,
              ),
            ];

            return values.some(
              (value) =>
                normalizeSearchText(
                  value,
                ).includes(
                  normalizedSearch,
                ),
            );
          },
        )
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

          if (
            keyA !== keyB
          ) {
            return keyB - keyA;
          }

          return (
            Number(
              b.id_payroll ||
                0,
            ) -
            Number(
              a.id_payroll ||
                0,
            )
          );
        });
    }, [
      payrolls,
      search,
    ]);

  const dashboardSummary =
    useMemo(() => {
      let generated = 0;
      let paid = 0;
      let cancelled = 0;
      let pendingAmount = 0;
      let paidAmount = 0;

      payrolls.forEach(
        (payroll) => {
          const status =
            String(
              payroll.status ||
                '',
            ).toUpperCase();

          const amount =
            Number(
              payroll.total_net_salary,
            ) || 0;

          if (
            status ===
            'PAID'
          ) {
            paid += 1;
            paidAmount +=
              amount;
          } else if (
            status ===
            'CANCELLED'
          ) {
            cancelled += 1;
          } else {
            generated += 1;
            pendingAmount +=
              amount;
          }
        },
      );

      return {
        total:
          payrolls.length,
        generated,
        paid,
        cancelled,
        pendingAmount,
        paidAmount,
      };
    }, [payrolls]);

  const selectedActiveDetails =
    useMemo(
      () =>
        (
          selectedPayroll?.details ||
          []
        ).filter(
          (detail) =>
            String(
              detail.status ||
                '',
            ).toUpperCase() ===
            'ACTIVE',
        ),
      [selectedPayroll],
    );

  const selectedInactiveDetails =
    useMemo(
      () =>
        (
          selectedPayroll?.details ||
          []
        ).filter(
          (detail) =>
            String(
              detail.status ||
                '',
            ).toUpperCase() ===
            'INACTIVE',
        ),
      [selectedPayroll],
    );

  const selectedCalculatedTotals =
    useMemo(() => {
      return selectedActiveDetails.reduce(
        (accumulator, detail) => {
          accumulator.base +=
            Number(
              detail.base_salary,
            ) || 0;

          accumulator.net +=
            Number(
              detail.net_salary,
            ) || 0;

          return accumulator;
        },
        {
          base: 0,
          net: 0,
        },
      );
    }, [
      selectedActiveDetails,
    ]);

  const yearOptions =
    useMemo(() => {
      const years = [];

      for (
        let year =
          currentYear;
        year >= 2000;
        year -= 1
      ) {
        years.push(year);
      }

      return years;
    }, [currentYear]);

  const existingPeriodKeys =
    useMemo(
      () =>
        new Set(
          payrolls
            .filter(
              (payroll) =>
                String(
                  payroll.status ||
                    '',
                ).toUpperCase() !==
                'CANCELLED',
            )
            .map(
              (payroll) =>
                `${payroll.payroll_year}-${payroll.payroll_month}`,
            ),
        ),
      [payrolls],
    );

  const handleFilterChange = (
    event,
  ) => {
    const {
      name,
      value,
    } = event.target;

    setFilters(
      (current) => ({
        ...current,
        [name]:
          value,
      }),
    );
  };

  const applyFilters =
    async () => {
      await loadData(
        filters,
      );
    };

  const clearFilters =
    async () => {
      const clean = {
        month: '',
        year: '',
        status: '',
      };

      setFilters(clean);
      setSearch('');
      await loadData(clean);
    };

  const handleGenerateChange =
    (event) => {
      const {
        name,
        value,
      } = event.target;

      setGenerateForm(
        (current) => ({
          ...current,
          [name]:
            value,
        }),
      );
    };

  const openGenerateModal =
    () => {
      setGenerateForm({
        payroll_month:
          String(
            currentMonth,
          ),
        payroll_year:
          String(
            currentYear,
          ),
      });

      setPageError('');
      setFeedback('');

      setShowGenerateModal(
        true,
      );
    };

  const validateGenerateForm =
    () => {
      const month =
        Number(
          generateForm.payroll_month,
        );

      const year =
        Number(
          generateForm.payroll_year,
        );

      if (
        !Number.isInteger(month) ||
        month < 1 ||
        month > 12
      ) {
        return 'Selecciona un mes válido';
      }

      if (
        !Number.isInteger(year) ||
        year < 2000 ||
        year >
          currentYear
      ) {
        return 'Selecciona un año válido';
      }

      const currentKey =
        currentYear * 100 +
        currentMonth;

      const requestedKey =
        year * 100 +
        month;

      if (
        requestedKey >
        currentKey
      ) {
        return 'No se puede generar una planilla para un periodo futuro';
      }

      const key =
        `${year}-${month}`;

      if (
        existingPeriodKeys.has(
          key,
        )
      ) {
        return 'Ya existe una planilla vigente para ese mes y año';
      }

      return '';
    };

  const generatePayroll =
    async (event) => {
      event.preventDefault();

      const validationError =
        validateGenerateForm();

      if (
        validationError
      ) {
        setPageError(
          validationError,
        );
        return;
      }

      const month =
        Number(
          generateForm.payroll_month,
        );

      const year =
        Number(
          generateForm.payroll_year,
        );

      const confirmed =
        window.confirm(
          `Se generará la planilla de ${formatPeriod(
            month,
            year,
          )} con los empleados y salarios válidos para ese periodo. ¿Deseas continuar?`,
        );

      if (!confirmed) {
        return;
      }

      try {
        setSaving(true);
        setPageError('');
        setFeedback('');

        const result =
          await requestJson(
            `${API_URL}/api/payrolls`,
            {
              method: 'POST',
              headers: {
                'Content-Type':
                  'application/json',
              },
              body:
                JSON.stringify({
                  payroll_month:
                    month,
                  payroll_year:
                    year,
                }),
            },
            'No se pudo generar la planilla',
          );

        setShowGenerateModal(
          false,
        );

        setFeedback(
          'Planilla generada correctamente',
        );

        await loadData(
          filters,
        );

        if (
          result.id_payroll
        ) {
          await loadPayrollDetail(
            result.id_payroll,
          );
        }
      } catch (error) {
        console.error(
          error,
        );

        setPageError(
          error.message ||
            'No se pudo generar la planilla',
        );
      } finally {
        setSaving(false);
      }
    };

  const openPayrollDetail =
    async (payroll) => {
      setPageError('');
      setFeedback('');

      await loadPayrollDetail(
        payroll.id_payroll,
      );
    };

  const closePayrollDetail =
    () => {
      if (saving) return;

      setSelectedPayroll(
        null,
      );

      setNetSalaryDrafts(
        {},
      );
    };

  const updateNetSalaryDraft =
    (
      idPayrollDetail,
      value,
    ) => {
      setNetSalaryDrafts(
        (current) => ({
          ...current,
          [idPayrollDetail]:
            value,
        }),
      );
    };

  const saveNetSalary =
    async (detail) => {
      if (
        !selectedPayroll ||
        String(
          selectedPayroll.status ||
            '',
        ).toUpperCase() !==
          'GENERATED'
      ) {
        setPageError(
          'Solo se puede modificar una planilla que está generada y pendiente de pago',
        );
        return;
      }

      if (
        String(
          detail.status ||
            '',
        ).toUpperCase() !==
        'ACTIVE'
      ) {
        setPageError(
          'Activa primero el detalle para poder ajustar su salario neto',
        );
        return;
      }

      const amount =
        parseMoney(
          netSalaryDrafts[
            detail.id_payroll_detail
          ],
        );

      if (
        !Number.isFinite(
          amount,
        ) ||
        amount < 0
      ) {
        setPageError(
          'El salario neto debe ser un monto válido y no puede ser negativo',
        );
        return;
      }

      if (
        amount >
        99999999.99
      ) {
        setPageError(
          'El salario neto supera el monto máximo permitido',
        );
        return;
      }

      const original =
        Number(
          detail.net_salary,
        ) || 0;

      if (
        Number(
          amount.toFixed(2),
        ) ===
        Number(
          original.toFixed(2),
        )
      ) {
        setFeedback(
          'No hay cambios en el salario neto',
        );
        return;
      }

      try {
        setSaving(true);
        setPageError('');
        setFeedback('');

        await requestJson(
          `${API_URL}/api/payroll-details/${detail.id_payroll_detail}/net-salary`,
          {
            method:
              'PATCH',
            headers: {
              'Content-Type':
                'application/json',
            },
            body:
              JSON.stringify({
                net_salary:
                  Number(
                    amount.toFixed(
                      2,
                    ),
                  ),
              }),
          },
          'No se pudo actualizar el salario neto',
        );

        setFeedback(
          'Salario neto actualizado correctamente',
        );

        await Promise.all([
          loadPayrollDetail(
            selectedPayroll.id_payroll,
            {
              keepError:
                true,
            },
          ),
          loadData(
            filters,
          ),
        ]);
      } catch (error) {
        console.error(
          error,
        );

        setPageError(
          error.message ||
            'No se pudo actualizar el salario neto',
        );
      } finally {
        setSaving(false);
      }
    };

  const toggleDetailStatus =
    async (detail) => {
      if (
        !selectedPayroll ||
        String(
          selectedPayroll.status ||
            '',
        ).toUpperCase() !==
          'GENERATED'
      ) {
        setPageError(
          'Solo se pueden modificar los detalles de una planilla generada y pendiente de pago',
        );
        return;
      }

      const nextStatus =
        String(
          detail.status ||
            '',
        ).toUpperCase() ===
        'ACTIVE'
          ? 'INACTIVE'
          : 'ACTIVE';

      const verb =
        nextStatus ===
        'ACTIVE'
          ? 'reactivar'
          : 'excluir';

      const confirmed =
        window.confirm(
          `¿Deseas ${verb} a ${detail.employee_name} en esta planilla?`,
        );

      if (!confirmed) {
        return;
      }

      try {
        setSaving(true);
        setPageError('');
        setFeedback('');

        await requestJson(
          `${API_URL}/api/payroll-details/${detail.id_payroll_detail}/status`,
          {
            method:
              'PATCH',
            headers: {
              'Content-Type':
                'application/json',
            },
            body:
              JSON.stringify({
                status:
                  nextStatus,
              }),
          },
          'No se pudo actualizar el detalle de la planilla',
        );

        setFeedback(
          nextStatus ===
            'ACTIVE'
            ? 'Empleado reincorporado a la planilla'
            : 'Empleado excluido de la planilla',
        );

        await Promise.all([
          loadPayrollDetail(
            selectedPayroll.id_payroll,
            {
              keepError:
                true,
            },
          ),
          loadData(
            filters,
          ),
        ]);
      } catch (error) {
        console.error(
          error,
        );

        setPageError(
          error.message ||
            'No se pudo actualizar el detalle de la planilla',
        );
      } finally {
        setSaving(false);
      }
    };

  const markPayrollPaid =
    async () => {
      if (
        !selectedPayroll
      ) {
        return;
      }

      if (
        String(
          selectedPayroll.status ||
            '',
        ).toUpperCase() !==
          'GENERATED'
      ) {
        setPageError(
          'Solo una planilla generada puede marcarse como pagada',
        );
        return;
      }

      if (
        !selectedActiveDetails.length
      ) {
        setPageError(
          'La planilla debe tener al menos un detalle activo antes de marcarla como pagada',
        );
        return;
      }

      if (!paymentDate) {
        setPageError(
          'Selecciona una fecha de pago',
        );
        return;
      }

      if (
        paymentDate > today
      ) {
        setPageError(
          'La fecha de pago no puede ser futura',
        );
        return;
      }

      const confirmed =
        window.confirm(
          `¿Confirmas el pago de la planilla de ${formatPeriod(
            selectedPayroll.payroll_month,
            selectedPayroll.payroll_year,
          )} por un total neto de ${formatMoney(
            selectedCalculatedTotals.net,
          )}? Después de marcarla como pagada ya no se podrá modificar.`,
        );

      if (!confirmed) {
        return;
      }

      try {
        setSaving(true);
        setPageError('');
        setFeedback('');

        await requestJson(
          `${API_URL}/api/payrolls/${selectedPayroll.id_payroll}/status`,
          {
            method:
              'PATCH',
            headers: {
              'Content-Type':
                'application/json',
            },
            body:
              JSON.stringify({
                status:
                  'PAID',
                payment_date:
                  paymentDate,
              }),
          },
          'No se pudo marcar la planilla como pagada',
        );

        setFeedback(
          'Planilla marcada como pagada correctamente',
        );

        await Promise.all([
          loadPayrollDetail(
            selectedPayroll.id_payroll,
            {
              keepError:
                true,
            },
          ),
          loadData(
            filters,
          ),
        ]);
      } catch (error) {
        console.error(
          error,
        );

        setPageError(
          error.message ||
            'No se pudo marcar la planilla como pagada',
        );
      } finally {
        setSaving(false);
      }
    };

  const cancelPayroll =
    async () => {
      if (
        !selectedPayroll
      ) {
        return;
      }

      if (
        String(
          selectedPayroll.status ||
            '',
        ).toUpperCase() !==
          'GENERATED'
      ) {
        setPageError(
          'Solo una planilla generada puede cancelarse',
        );
        return;
      }

      const confirmed =
        window.confirm(
          `¿Cancelar la planilla de ${formatPeriod(
            selectedPayroll.payroll_month,
            selectedPayroll.payroll_year,
          )}? Esta acción no puede revertirse.`,
        );

      if (!confirmed) {
        return;
      }

      try {
        setSaving(true);
        setPageError('');
        setFeedback('');

        await requestJson(
          `${API_URL}/api/payrolls/${selectedPayroll.id_payroll}/status`,
          {
            method:
              'PATCH',
            headers: {
              'Content-Type':
                'application/json',
            },
            body:
              JSON.stringify({
                status:
                  'CANCELLED',
              }),
          },
          'No se pudo cancelar la planilla',
        );

        setFeedback(
          'Planilla cancelada correctamente',
        );

        await Promise.all([
          loadPayrollDetail(
            selectedPayroll.id_payroll,
            {
              keepError:
                true,
            },
          ),
          loadData(
            filters,
          ),
        ]);
      } catch (error) {
        console.error(
          error,
        );

        setPageError(
          error.message ||
            'No se pudo cancelar la planilla',
        );
      } finally {
        setSaving(false);
      }
    };

  const exportSelectedPayroll =
    () => {
      if (
        !selectedPayroll
      ) {
        return;
      }

      const rows = [
        [
          'Planilla',
          formatPeriod(
            selectedPayroll.payroll_month,
            selectedPayroll.payroll_year,
          ),
        ],
        [
          'Estado',
          getPayrollStatusLabel(
            selectedPayroll.status,
          ),
        ],
        [
          'Fecha de pago',
          selectedPayroll.payment_date
            ? formatDate(
                selectedPayroll.payment_date,
              )
            : '',
        ],
        [],
        [
          'Empleado',
          'Cargo',
          'Salario base',
          'Salario neto',
          'Vigencia del salario',
          'Estado del detalle',
        ],
        ...(
          selectedPayroll.details ||
          []
        ).map(
          (detail) => [
            detail.employee_name ||
              '',
            detail.position_name ||
              '',
            Number(
              detail.base_salary,
            ).toFixed(2),
            Number(
              detail.net_salary,
            ).toFixed(2),
            formatDate(
              detail.salary_effective_date,
            ),
            String(
              detail.status ||
                '',
            ).toUpperCase() ===
              'ACTIVE'
              ? 'Incluido'
              : 'Excluido',
          ],
        ),
        [],
        [
          '',
          'TOTAL ACTIVO',
          selectedCalculatedTotals.base.toFixed(
            2,
          ),
          selectedCalculatedTotals.net.toFixed(
            2,
          ),
          '',
          '',
        ],
      ];

      downloadCsv(
        `planilla_${selectedPayroll.payroll_year}_${String(
          selectedPayroll.payroll_month,
        ).padStart(
          2,
          '0',
        )}.csv`,
        rows,
      );

      setFeedback(
        'Planilla exportada correctamente',
      );
    };

  const printSelectedPayroll =
    () => {
      if (
        !selectedPayroll
      ) {
        return;
      }

      setPrintPayroll(
        selectedPayroll,
      );

      window.setTimeout(
        () => {
          window.print();
        },
        50,
      );
    };

  const statCardStyle = {
    background:
      '#171717',
    border:
      '1px solid #292929',
    borderRadius:
      '12px',
    padding:
      '18px 16px',
  };

  const statLabelStyle = {
    color: '#777777',
    fontSize: '11px',
    textTransform:
      'uppercase',
    letterSpacing:
      '1px',
  };

  const statValueStyle = {
    marginTop: '8px',
    fontSize: '27px',
    fontWeight: 700,
    color: '#ffffff',
  };

  const inputStyle = {
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
      'rgba(0, 0, 0, 0.74)',
    display: 'flex',
    alignItems:
      'center',
    justifyContent:
      'center',
    padding: '24px',
  };

  const modalStyle = {
    width: '100%',
    maxWidth: '1180px',
    maxHeight: '92vh',
    overflowY: 'auto',
    background: '#111111',
    border:
      '1px solid #2b2b2b',
    borderRadius: '14px',
    boxShadow:
      '0 24px 80px rgba(0,0,0,0.45)',
  };

  return (
    <>
      <style>
        {`
          .payroll-print-view {
            display: none;
          }

          @media print {
            @page {
              size: A4 landscape;
              margin: 10mm;
            }

            html,
            body {
              background: #ffffff !important;
              color: #111111 !important;
              margin: 0 !important;
              padding: 0 !important;
            }

            body {
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }

            .payroll-screen {
              display: none !important;
            }

            .payroll-print-view {
              display: block !important;
              width: 100%;
              background: #ffffff !important;
              color: #111111 !important;
              font-family: Arial, Helvetica, sans-serif;
              font-size: 9pt;
            }

            .payroll-print-header {
              display: flex;
              justify-content: space-between;
              align-items: flex-start;
              gap: 18px;
              padding-bottom: 10px;
              border-bottom: 2px solid #8c1738;
              margin-bottom: 12px;
            }

            .payroll-print-brand {
              display: flex;
              align-items: center;
              gap: 12px;
            }

            .payroll-print-logo {
              width: 54px;
              height: 54px;
              border-radius: 8px;
              display: flex;
              align-items: center;
              justify-content: center;
              background: #8c1738 !important;
              color: #ffffff !important;
              font-size: 16pt;
              font-weight: 800;
            }

            .payroll-print-title h1 {
              margin: 0 0 3px;
              font-size: 16pt;
            }

            .payroll-print-title p {
              margin: 0;
              color: #555555;
            }

            .payroll-print-meta {
              text-align: right;
              color: #555555;
              font-size: 8pt;
              line-height: 1.5;
            }

            .payroll-print-summary {
              display: grid;
              grid-template-columns: repeat(5, 1fr);
              gap: 7px;
              margin-bottom: 12px;
            }

            .payroll-print-card {
              border: 1px solid #d4d4d4;
              border-radius: 6px;
              padding: 8px 9px;
            }

            .payroll-print-card span {
              display: block;
              color: #666666;
              font-size: 7pt;
              text-transform: uppercase;
              margin-bottom: 3px;
            }

            .payroll-print-card strong {
              font-size: 12pt;
            }

            .payroll-print-table {
              width: 100%;
              border-collapse: collapse;
              table-layout: fixed;
            }

            .payroll-print-table thead {
              display: table-header-group;
            }

            .payroll-print-table tr {
              break-inside: avoid;
              page-break-inside: avoid;
            }

            .payroll-print-table th {
              background: #eeeeee !important;
              border: 1px solid #c7c7c7;
              padding: 6px 5px;
              text-align: left;
              font-size: 7.5pt;
              text-transform: uppercase;
            }

            .payroll-print-table td {
              border: 1px solid #dddddd;
              padding: 6px 5px;
              font-size: 8pt;
              vertical-align: top;
              overflow-wrap: anywhere;
            }

            .payroll-print-table tbody tr:nth-child(even) td {
              background: #fafafa !important;
            }

            .payroll-print-footer {
              display: flex;
              justify-content: space-between;
              gap: 12px;
              border-top: 1px solid #d4d4d4;
              margin-top: 12px;
              padding-top: 7px;
              color: #777777;
              font-size: 7pt;
            }
          }
        `}
      </style>

      <div className="employees-page payroll-screen">
        <Sidebar />

        <main className="employees-content">
          <header className="employees-header">
            <div>
              <span>
                RECURSOS HUMANOS
              </span>

              <h1>
                Planillas
              </h1>

              <p>
                Genera, revisa y controla las planillas mensuales del personal
              </p>
            </div>

            <button
              type="button"
              className="new-employee-button"
              onClick={
                openGenerateModal
              }
              disabled={
                loading ||
                saving
              }
            >
              Generar planilla
            </button>
          </header>

          {feedback && (
            <div
              style={{
                marginBottom:
                  '20px',
                padding:
                  '13px 16px',
                borderRadius:
                  '8px',
                border:
                  '1px solid rgba(30, 150, 80, 0.35)',
                background:
                  'rgba(30, 150, 80, 0.10)',
                color:
                  '#5cc98a',
                fontSize:
                  '13px',
              }}
            >
              {feedback}
            </div>
          )}

          {pageError && (
            <div
              style={{
                marginBottom:
                  '20px',
                padding:
                  '13px 16px',
                borderRadius:
                  '8px',
                border:
                  '1px solid rgba(224, 0, 45, 0.35)',
                background:
                  'rgba(224, 0, 45, 0.10)',
                color:
                  '#ff6b82',
                fontSize:
                  '13px',
              }}
            >
              {pageError}
            </div>
          )}

          {employeesWithoutSalary.length >
            0 && (
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
                employeesWithoutSalary.length
              }{' '}
              empleado(s) activo(s) sin salario vigente. La planilla del periodo actual no podrá generarse hasta que todos tengan un salario activo.
            </div>
          )}

          <section
            style={{
              display:
                'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(170px, 1fr))',
              gap: '16px',
              marginBottom:
                '20px',
            }}
          >
            <div
              style={
                statCardStyle
              }
            >
              <div
                style={
                  statLabelStyle
                }
              >
                Planillas
              </div>

              <div
                style={
                  statValueStyle
                }
              >
                {
                  dashboardSummary.total
                }
              </div>
            </div>

            <div
              style={
                statCardStyle
              }
            >
              <div
                style={
                  statLabelStyle
                }
              >
                Pendientes
              </div>

              <div
                style={
                  statValueStyle
                }
              >
                {
                  dashboardSummary.generated
                }
              </div>
            </div>

            <div
              style={
                statCardStyle
              }
            >
              <div
                style={
                  statLabelStyle
                }
              >
                Pagadas
              </div>

              <div
                style={
                  statValueStyle
                }
              >
                {
                  dashboardSummary.paid
                }
              </div>
            </div>

            <div
              style={
                statCardStyle
              }
            >
              <div
                style={
                  statLabelStyle
                }
              >
                Canceladas
              </div>

              <div
                style={
                  statValueStyle
                }
              >
                {
                  dashboardSummary.cancelled
                }
              </div>
            </div>

            <div
              style={
                statCardStyle
              }
            >
              <div
                style={
                  statLabelStyle
                }
              >
                Pendiente de pago
              </div>

              <div
                style={{
                  ...statValueStyle,
                  fontSize:
                    '22px',
                }}
              >
                {formatMoney(
                  dashboardSummary.pendingAmount,
                )}
              </div>
            </div>

            <div
              style={
                statCardStyle
              }
            >
              <div
                style={
                  statLabelStyle
                }
              >
                Total pagado
              </div>

              <div
                style={{
                  ...statValueStyle,
                  fontSize:
                    '22px',
                }}
              >
                {formatMoney(
                  dashboardSummary.paidAmount,
                )}
              </div>
            </div>
          </section>

          <section
            className="employees-panel"
            style={{
              marginBottom:
                '20px',
            }}
          >
            <div
              style={{
                padding:
                  '18px 24px',
                display:
                  'flex',
                flexWrap:
                  'wrap',
                alignItems:
                  'end',
                gap: '12px',
              }}
            >
              <div
                style={{
                  flex:
                    '1 1 280px',
                }}
              >
                <label
                  style={{
                    display:
                      'block',
                    marginBottom:
                      '6px',
                    color:
                      '#888888',
                    fontSize:
                      '11px',
                  }}
                >
                  Buscar
                </label>

                <input
                  type="text"
                  className="search-input"
                  value={
                    search
                  }
                  onChange={(
                    event,
                  ) =>
                    setSearch(
                      event
                        .target
                        .value,
                    )
                  }
                  placeholder="Periodo, estado, monto o ID..."
                  style={{
                    width:
                      '100%',
                    margin: 0,
                  }}
                />
              </div>

              <div
                style={{
                  minWidth:
                    '170px',
                }}
              >
                <label
                  style={{
                    display:
                      'block',
                    marginBottom:
                      '6px',
                    color:
                      '#888888',
                    fontSize:
                      '11px',
                  }}
                >
                  Mes
                </label>

                <select
                  name="month"
                  value={
                    filters.month
                  }
                  onChange={
                    handleFilterChange
                  }
                  style={
                    inputStyle
                  }
                >
                  <option value="">
                    Todos
                  </option>

                  {MONTHS.map(
                    (month) => (
                      <option
                        key={
                          month.value
                        }
                        value={
                          month.value
                        }
                      >
                        {
                          month.label
                        }
                      </option>
                    ),
                  )}
                </select>
              </div>

              <div
                style={{
                  minWidth:
                    '150px',
                }}
              >
                <label
                  style={{
                    display:
                      'block',
                    marginBottom:
                      '6px',
                    color:
                      '#888888',
                    fontSize:
                      '11px',
                  }}
                >
                  Año
                </label>

                <select
                  name="year"
                  value={
                    filters.year
                  }
                  onChange={
                    handleFilterChange
                  }
                  style={
                    inputStyle
                  }
                >
                  <option value="">
                    Todos
                  </option>

                  {yearOptions.map(
                    (year) => (
                      <option
                        key={
                          year
                        }
                        value={
                          year
                        }
                      >
                        {year}
                      </option>
                    ),
                  )}
                </select>
              </div>

              <div
                style={{
                  minWidth:
                    '170px',
                }}
              >
                <label
                  style={{
                    display:
                      'block',
                    marginBottom:
                      '6px',
                    color:
                      '#888888',
                    fontSize:
                      '11px',
                  }}
                >
                  Estado
                </label>

                <select
                  name="status"
                  value={
                    filters.status
                  }
                  onChange={
                    handleFilterChange
                  }
                  style={
                    inputStyle
                  }
                >
                  <option value="">
                    Todos
                  </option>

                  {PAYROLL_STATUS_OPTIONS.map(
                    (option) => (
                      <option
                        key={
                          option.value
                        }
                        value={
                          option.value
                        }
                      >
                        {
                          option.label
                        }
                      </option>
                    ),
                  )}
                </select>
              </div>

              <button
                type="button"
                className="save-button"
                onClick={
                  applyFilters
                }
                disabled={
                  loading
                }
              >
                Aplicar
              </button>

              <button
                type="button"
                className="cancel-button"
                onClick={
                  clearFilters
                }
                disabled={
                  loading
                }
              >
                Limpiar
              </button>
            </div>
          </section>

          <section className="employees-panel">
            <div
              style={{
                padding:
                  '18px 24px 12px',
                display:
                  'flex',
                justifyContent:
                  'space-between',
                alignItems:
                  'center',
                gap: '12px',
                flexWrap:
                  'wrap',
              }}
            >
              <div>
                <h2
                  style={{
                    margin:
                      '0 0 4px',
                  }}
                >
                  Historial de planillas
                </h2>

                <p
                  style={{
                    margin: 0,
                    color:
                      '#777777',
                    fontSize:
                      '12px',
                  }}
                >
                  {
                    filteredPayrolls.length
                  }{' '}
                  registro(s)
                </p>
              </div>

              <button
                type="button"
                className="action-button"
                onClick={() =>
                  loadData(
                    filters,
                  )
                }
                disabled={
                  loading
                }
              >
                {loading
                  ? 'Actualizando...'
                  : 'Actualizar'}
              </button>
            </div>

            {loading ? (
              <div
                style={{
                  padding:
                    '24px',
                }}
              >
                Cargando planillas...
              </div>
            ) : (
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
                        Fecha pago
                      </th>
                      <th>
                        Creada
                      </th>
                      <th>
                        Acciones
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {filteredPayrolls.length ===
                    0 ? (
                      <tr>
                        <td
                          colSpan="8"
                        >
                          No hay planillas para los filtros seleccionados.
                        </td>
                      </tr>
                    ) : (
                      filteredPayrolls.map(
                        (
                          payroll,
                        ) => (
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

                              <div
                                style={{
                                  marginTop:
                                    '3px',
                                  color:
                                    '#666666',
                                  fontSize:
                                    '10px',
                                }}
                              >
                                ID #
                                {
                                  payroll.id_payroll
                                }
                              </div>
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

                            <td>
                              {formatDateTime(
                                payroll.creationDate,
                              )}
                            </td>

                            <td>
                              <button
                                type="button"
                                className="action-button"
                                onClick={() =>
                                  openPayrollDetail(
                                    payroll,
                                  )
                                }
                                disabled={
                                  detailsLoading
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
            )}
          </section>
        </main>

        {showGenerateModal && (
          <div
            style={
              modalOverlayStyle
            }
            onMouseDown={(
              event,
            ) => {
              if (
                event.target ===
                  event.currentTarget &&
                !saving
              ) {
                setShowGenerateModal(
                  false,
                );
              }
            }}
          >
            <div
              style={{
                ...modalStyle,
                maxWidth:
                  '620px',
              }}
            >
              <div
                style={{
                  padding:
                    '22px 24px',
                  borderBottom:
                    '1px solid #292929',
                  display:
                    'flex',
                  justifyContent:
                    'space-between',
                  alignItems:
                    'flex-start',
                  gap: '16px',
                }}
              >
                <div>
                  <span
                    style={{
                      color:
                        '#e0002d',
                      fontSize:
                        '11px',
                      fontWeight:
                        700,
                      letterSpacing:
                        '1px',
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
                    Generar planilla
                  </h2>

                  <p
                    style={{
                      margin: 0,
                      color:
                        '#777777',
                      fontSize:
                        '12px',
                    }}
                  >
                    La planilla copiará el salario correspondiente de cada empleado para conservar el historial.
                  </p>
                </div>

                <button
                  type="button"
                  className="action-button"
                  onClick={() =>
                    setShowGenerateModal(
                      false,
                    )
                  }
                  disabled={
                    saving
                  }
                >
                  Cerrar
                </button>
              </div>

              <form
                onSubmit={
                  generatePayroll
                }
                style={{
                  padding:
                    '24px',
                }}
              >
                <div
                  style={{
                    display:
                      'grid',
                    gridTemplateColumns:
                      'repeat(2, minmax(0, 1fr))',
                    gap:
                      '16px',
                  }}
                >
                  <div>
                    <label
                      style={{
                        display:
                          'block',
                        marginBottom:
                          '7px',
                        color:
                          '#999999',
                        fontSize:
                          '12px',
                      }}
                    >
                      Mes *
                    </label>

                    <select
                      name="payroll_month"
                      value={
                        generateForm.payroll_month
                      }
                      onChange={
                        handleGenerateChange
                      }
                      style={
                        inputStyle
                      }
                      disabled={
                        saving
                      }
                    >
                      {MONTHS.map(
                        (
                          month,
                        ) => {
                          const selectedYear =
                            Number(
                              generateForm.payroll_year,
                            );

                          const isFuture =
                            selectedYear ===
                              currentYear &&
                            month.value >
                              currentMonth;

                          return (
                            <option
                              key={
                                month.value
                              }
                              value={
                                month.value
                              }
                              disabled={
                                isFuture
                              }
                            >
                              {
                                month.label
                              }
                            </option>
                          );
                        },
                      )}
                    </select>
                  </div>

                  <div>
                    <label
                      style={{
                        display:
                          'block',
                        marginBottom:
                          '7px',
                        color:
                          '#999999',
                        fontSize:
                          '12px',
                      }}
                    >
                      Año *
                    </label>

                    <select
                      name="payroll_year"
                      value={
                        generateForm.payroll_year
                      }
                      onChange={
                        handleGenerateChange
                      }
                      style={
                        inputStyle
                      }
                      disabled={
                        saving
                      }
                    >
                      {yearOptions.map(
                        (
                          year,
                        ) => (
                          <option
                            key={
                              year
                            }
                            value={
                              year
                            }
                          >
                            {
                              year
                            }
                          </option>
                        ),
                      )}
                    </select>
                  </div>
                </div>

                <div
                  style={{
                    marginTop:
                      '18px',
                    padding:
                      '14px 16px',
                    borderRadius:
                      '10px',
                    border:
                      '1px solid #292929',
                    background:
                      '#171717',
                  }}
                >
                  <div
                    style={{
                      color:
                        '#777777',
                      fontSize:
                        '10px',
                      textTransform:
                        'uppercase',
                      letterSpacing:
                        '0.6px',
                    }}
                  >
                    Periodo seleccionado
                  </div>

                  <div
                    style={{
                      marginTop:
                        '5px',
                      fontSize:
                        '18px',
                      fontWeight:
                        700,
                    }}
                  >
                    {formatPeriod(
                      Number(
                        generateForm.payroll_month,
                      ),
                      Number(
                        generateForm.payroll_year,
                      ),
                    )}
                  </div>

                  <div
                    style={{
                      marginTop:
                        '8px',
                      color:
                        '#888888',
                      fontSize:
                        '12px',
                      lineHeight:
                        1.5,
                    }}
                  >
                    El backend validará empleados activos, fechas de contratación, salarios correspondientes al periodo y evitará duplicar una planilla vigente del mismo mes.
                  </div>
                </div>

                {employeesWithoutSalary.length >
                  0 &&
                  Number(
                    generateForm.payroll_year,
                  ) ===
                    currentYear &&
                  Number(
                    generateForm.payroll_month,
                  ) ===
                    currentMonth && (
                    <div
                      style={{
                        marginTop:
                          '16px',
                        padding:
                          '12px 14px',
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
                      La planilla actual no podrá generarse porque hay{' '}
                      {
                        employeesWithoutSalary.length
                      }{' '}
                      empleado(s) activo(s) sin salario vigente.
                    </div>
                  )}

                <div
                  style={{
                    marginTop:
                      '24px',
                    display:
                      'flex',
                    justifyContent:
                      'flex-end',
                    gap:
                      '10px',
                    flexWrap:
                      'wrap',
                  }}
                >
                  <button
                    type="button"
                    className="cancel-button"
                    onClick={() =>
                      setShowGenerateModal(
                        false,
                      )
                    }
                    disabled={
                      saving
                    }
                  >
                    Cancelar
                  </button>

                  <button
                    type="submit"
                    className="save-button"
                    disabled={
                      saving
                    }
                  >
                    {saving
                      ? 'Generando...'
                      : 'Generar planilla'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {selectedPayroll && (
          <div
            style={
              modalOverlayStyle
            }
            onMouseDown={(
              event,
            ) => {
              if (
                event.target ===
                  event.currentTarget &&
                !saving
              ) {
                closePayrollDetail();
              }
            }}
          >
            <div
              style={
                modalStyle
              }
            >
              <div
                style={{
                  padding:
                    '22px 24px',
                  borderBottom:
                    '1px solid #292929',
                  display:
                    'flex',
                  justifyContent:
                    'space-between',
                  alignItems:
                    'flex-start',
                  gap: '16px',
                  flexWrap:
                    'wrap',
                }}
              >
                <div>
                  <span
                    style={{
                      color:
                        '#e0002d',
                      fontSize:
                        '11px',
                      fontWeight:
                        700,
                      letterSpacing:
                        '1px',
                    }}
                  >
                    DETALLE DE PLANILLA
                  </span>

                  <h2
                    style={{
                      margin:
                        '5px 0 5px',
                    }}
                  >
                    {formatPeriod(
                      selectedPayroll.payroll_month,
                      selectedPayroll.payroll_year,
                    )}
                  </h2>

                  <div
                    style={{
                      display:
                        'flex',
                      alignItems:
                        'center',
                      gap:
                        '8px',
                      flexWrap:
                        'wrap',
                    }}
                  >
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
                          selectedPayroll.status,
                        ),
                      }}
                    >
                      {getPayrollStatusLabel(
                        selectedPayroll.status,
                      )}
                    </span>

                    <span
                      style={{
                        color:
                          '#777777',
                        fontSize:
                          '11px',
                      }}
                    >
                      ID #
                      {
                        selectedPayroll.id_payroll
                      }
                    </span>
                  </div>
                </div>

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
                      exportSelectedPayroll
                    }
                  >
                    Exportar CSV
                  </button>

                  <button
                    type="button"
                    className="action-button"
                    onClick={
                      printSelectedPayroll
                    }
                  >
                    Imprimir
                  </button>

                  <button
                    type="button"
                    className="action-button"
                    onClick={
                      closePayrollDetail
                    }
                    disabled={
                      saving
                    }
                  >
                    Cerrar
                  </button>
                </div>
              </div>

              {detailsLoading ? (
                <div
                  style={{
                    padding:
                      '30px',
                  }}
                >
                  Cargando detalle...
                </div>
              ) : (
                <>
                  <div
                    style={{
                      padding:
                        '20px 24px',
                      display:
                        'grid',
                      gridTemplateColumns:
                        'repeat(auto-fit, minmax(180px, 1fr))',
                      gap:
                        '12px',
                    }}
                  >
                    <div
                      style={
                        statCardStyle
                      }
                    >
                      <div
                        style={
                          statLabelStyle
                        }
                      >
                        Empleados incluidos
                      </div>

                      <div
                        style={
                          statValueStyle
                        }
                      >
                        {
                          selectedActiveDetails.length
                        }
                      </div>
                    </div>

                    <div
                      style={
                        statCardStyle
                      }
                    >
                      <div
                        style={
                          statLabelStyle
                        }
                      >
                        Excluidos
                      </div>

                      <div
                        style={
                          statValueStyle
                        }
                      >
                        {
                          selectedInactiveDetails.length
                        }
                      </div>
                    </div>

                    <div
                      style={
                        statCardStyle
                      }
                    >
                      <div
                        style={
                          statLabelStyle
                        }
                      >
                        Total base
                      </div>

                      <div
                        style={{
                          ...statValueStyle,
                          fontSize:
                            '22px',
                        }}
                      >
                        {formatMoney(
                          selectedCalculatedTotals.base,
                        )}
                      </div>
                    </div>

                    <div
                      style={
                        statCardStyle
                      }
                    >
                      <div
                        style={
                          statLabelStyle
                        }
                      >
                        Total neto
                      </div>

                      <div
                        style={{
                          ...statValueStyle,
                          fontSize:
                            '22px',
                        }}
                      >
                        {formatMoney(
                          selectedCalculatedTotals.net,
                        )}
                      </div>
                    </div>

                    <div
                      style={
                        statCardStyle
                      }
                    >
                      <div
                        style={
                          statLabelStyle
                        }
                      >
                        Fecha de pago
                      </div>

                      <div
                        style={{
                          ...statValueStyle,
                          fontSize:
                            '18px',
                        }}
                      >
                        {formatDate(
                          selectedPayroll.payment_date,
                        )}
                      </div>
                    </div>
                  </div>

                  {String(
                    selectedPayroll.status ||
                      '',
                  ).toUpperCase() ===
                    'GENERATED' && (
                    <div
                      style={{
                        margin:
                          '0 24px 20px',
                        padding:
                          '16px',
                        borderRadius:
                          '10px',
                        border:
                          '1px solid #292929',
                        background:
                          '#171717',
                        display:
                          'flex',
                        alignItems:
                          'end',
                        gap:
                          '12px',
                        flexWrap:
                          'wrap',
                      }}
                    >
                      <div
                        style={{
                          minWidth:
                            '190px',
                        }}
                      >
                        <label
                          style={{
                            display:
                              'block',
                            marginBottom:
                              '6px',
                            color:
                              '#888888',
                            fontSize:
                              '11px',
                          }}
                        >
                          Fecha de pago
                        </label>

                        <input
                          type="date"
                          value={
                            paymentDate
                          }
                          onChange={(
                            event,
                          ) =>
                            setPaymentDate(
                              event
                                .target
                                .value,
                            )
                          }
                          max={
                            today
                          }
                          style={
                            inputStyle
                          }
                          disabled={
                            saving
                          }
                        />
                      </div>

                      <button
                        type="button"
                        className="save-button"
                        onClick={
                          markPayrollPaid
                        }
                        disabled={
                          saving ||
                          !selectedActiveDetails.length
                        }
                      >
                        Marcar como pagada
                      </button>

                      <button
                        type="button"
                        className="cancel-button"
                        onClick={
                          cancelPayroll
                        }
                        disabled={
                          saving
                        }
                      >
                        Cancelar planilla
                      </button>

                      <div
                        style={{
                          flex:
                            '1 1 260px',
                          color:
                            '#777777',
                          fontSize:
                            '11px',
                          lineHeight:
                            1.5,
                        }}
                      >
                        Antes de pagar puedes ajustar manualmente el salario neto o excluir un detalle. Una vez pagada o cancelada la planilla queda bloqueada.
                      </div>
                    </div>
                  )}

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
                            Salario base
                          </th>
                          <th>
                            Salario neto
                          </th>
                          <th>
                            Vigencia salario
                          </th>
                          <th>
                            Estado
                          </th>
                          <th>
                            Acciones
                          </th>
                        </tr>
                      </thead>

                      <tbody>
                        {!selectedPayroll.details ||
                        selectedPayroll.details.length ===
                          0 ? (
                          <tr>
                            <td
                              colSpan="7"
                            >
                              La planilla no tiene detalles.
                            </td>
                          </tr>
                        ) : (
                          selectedPayroll.details.map(
                            (
                              detail,
                            ) => {
                              const detailActive =
                                String(
                                  detail.status ||
                                    '',
                                ).toUpperCase() ===
                                'ACTIVE';

                              const editable =
                                String(
                                  selectedPayroll.status ||
                                    '',
                                ).toUpperCase() ===
                                  'GENERATED' &&
                                detailActive;

                              const changed =
                                Number(
                                  parseMoney(
                                    netSalaryDrafts[
                                      detail.id_payroll_detail
                                    ],
                                  ).toFixed?.(
                                    2,
                                  ),
                                ) !==
                                Number(
                                  Number(
                                    detail.net_salary,
                                  ).toFixed(
                                    2,
                                  ),
                                );

                              return (
                                <tr
                                  key={
                                    detail.id_payroll_detail
                                  }
                                  style={{
                                    opacity:
                                      detailActive
                                        ? 1
                                        : 0.55,
                                  }}
                                >
                                  <td>
                                    <strong>
                                      {detail.employee_name ||
                                        'Sin empleado'}
                                    </strong>

                                    <div
                                      style={{
                                        marginTop:
                                          '3px',
                                        color:
                                          '#666666',
                                        fontSize:
                                          '10px',
                                      }}
                                    >
                                      ID empleado #
                                      {
                                        detail.id_employee
                                      }
                                    </div>
                                  </td>

                                  <td>
                                    {detail.position_name ||
                                      'Sin cargo'}
                                  </td>

                                  <td>
                                    {formatMoney(
                                      detail.base_salary,
                                    )}
                                  </td>

                                  <td>
                                    {editable ? (
                                      <div
                                        style={{
                                          display:
                                            'flex',
                                          alignItems:
                                            'center',
                                          gap:
                                            '8px',
                                          minWidth:
                                            '210px',
                                        }}
                                      >
                                        <input
                                          type="number"
                                          min="0"
                                          max="99999999.99"
                                          step="0.01"
                                          value={
                                            netSalaryDrafts[
                                              detail.id_payroll_detail
                                            ] ??
                                            ''
                                          }
                                          onChange={(
                                            event,
                                          ) =>
                                            updateNetSalaryDraft(
                                              detail.id_payroll_detail,
                                              event
                                                .target
                                                .value,
                                            )
                                          }
                                          style={{
                                            ...inputStyle,
                                            minWidth:
                                              '120px',
                                            padding:
                                              '8px 10px',
                                          }}
                                          disabled={
                                            saving
                                          }
                                        />

                                        <button
                                          type="button"
                                          className="action-button"
                                          onClick={() =>
                                            saveNetSalary(
                                              detail,
                                            )
                                          }
                                          disabled={
                                            saving ||
                                            !changed
                                          }
                                        >
                                          Guardar
                                        </button>
                                      </div>
                                    ) : (
                                      <strong>
                                        {formatMoney(
                                          detail.net_salary,
                                        )}
                                      </strong>
                                    )}
                                  </td>

                                  <td>
                                    {formatDate(
                                      detail.salary_effective_date,
                                    )}
                                  </td>

                                  <td>
                                    <span
                                      className={`status ${
                                        detailActive
                                          ? 'active'
                                          : 'inactive'
                                      }`}
                                    >
                                      {detailActive
                                        ? 'Incluido'
                                        : 'Excluido'}
                                    </span>
                                  </td>

                                  <td>
                                    {String(
                                      selectedPayroll.status ||
                                        '',
                                    ).toUpperCase() ===
                                    'GENERATED' ? (
                                      <button
                                        type="button"
                                        className={
                                          detailActive
                                            ? 'cancel-button'
                                            : 'save-button'
                                        }
                                        onClick={() =>
                                          toggleDetailStatus(
                                            detail,
                                          )
                                        }
                                        disabled={
                                          saving
                                        }
                                      >
                                        {detailActive
                                          ? 'Excluir'
                                          : 'Reincorporar'}
                                      </button>
                                    ) : (
                                      <span
                                        style={{
                                          color:
                                            '#666666',
                                          fontSize:
                                            '11px',
                                        }}
                                      >
                                        Bloqueado
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

                  <div
                    style={{
                      padding:
                        '16px 24px 22px',
                      display:
                        'flex',
                      justifyContent:
                        'space-between',
                      alignItems:
                        'center',
                      gap:
                        '16px',
                      flexWrap:
                        'wrap',
                      borderTop:
                        '1px solid #292929',
                    }}
                  >
                    <div
                      style={{
                        color:
                          '#777777',
                        fontSize:
                          '11px',
                      }}
                    >
                      Creada:{' '}
                      {formatDateTime(
                        selectedPayroll.creationDate,
                      )}
                    </div>

                    <div
                      style={{
                        display:
                          'flex',
                        gap:
                          '20px',
                        flexWrap:
                          'wrap',
                      }}
                    >
                      <div>
                        <span
                          style={{
                            color:
                              '#777777',
                            fontSize:
                              '10px',
                            textTransform:
                              'uppercase',
                          }}
                        >
                          Total base
                        </span>

                        <div
                          style={{
                            marginTop:
                              '3px',
                            fontWeight:
                              700,
                          }}
                        >
                          {formatMoney(
                            selectedCalculatedTotals.base,
                          )}
                        </div>
                      </div>

                      <div>
                        <span
                          style={{
                            color:
                              '#777777',
                            fontSize:
                              '10px',
                            textTransform:
                              'uppercase',
                          }}
                        >
                          Total neto
                        </span>

                        <div
                          style={{
                            marginTop:
                              '3px',
                            fontWeight:
                              700,
                            color:
                              '#ffffff',
                          }}
                        >
                          {formatMoney(
                            selectedCalculatedTotals.net,
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {printPayroll && (
        <div className="payroll-print-view">
          <div className="payroll-print-header">
            <div className="payroll-print-brand">
              <div className="payroll-print-logo">
                MQS
              </div>

              <div className="payroll-print-title">
                <h1>
                  Gimnasio MQS
                </h1>

                <p>
                  Recursos Humanos · Planilla de sueldos
                </p>
              </div>
            </div>

            <div className="payroll-print-meta">
              <strong>
                {formatPeriod(
                  printPayroll.payroll_month,
                  printPayroll.payroll_year,
                )}
              </strong>
              <br />
              Estado:{' '}
              {getPayrollStatusLabel(
                printPayroll.status,
              )}
              <br />
              Generado:{' '}
              {formatDateTime(
                new Date(),
              )}
            </div>
          </div>

          <div className="payroll-print-summary">
            <div className="payroll-print-card">
              <span>
                Periodo
              </span>

              <strong>
                {formatPeriod(
                  printPayroll.payroll_month,
                  printPayroll.payroll_year,
                )}
              </strong>
            </div>

            <div className="payroll-print-card">
              <span>
                Estado
              </span>

              <strong>
                {getPayrollStatusLabel(
                  printPayroll.status,
                )}
              </strong>
            </div>

            <div className="payroll-print-card">
              <span>
                Empleados incluidos
              </span>

              <strong>
                {
                  selectedActiveDetails.length
                }
              </strong>
            </div>

            <div className="payroll-print-card">
              <span>
                Total base
              </span>

              <strong>
                {formatMoney(
                  selectedCalculatedTotals.base,
                )}
              </strong>
            </div>

            <div className="payroll-print-card">
              <span>
                Total neto
              </span>

              <strong>
                {formatMoney(
                  selectedCalculatedTotals.net,
                )}
              </strong>
            </div>
          </div>

          <table className="payroll-print-table">
            <thead>
              <tr>
                <th>
                  Empleado
                </th>
                <th>
                  Cargo
                </th>
                <th>
                  Salario base
                </th>
                <th>
                  Salario neto
                </th>
                <th>
                  Vigencia salario
                </th>
                <th>
                  Estado
                </th>
              </tr>
            </thead>

            <tbody>
              {(printPayroll.details ||
                []).map(
                (detail) => (
                  <tr
                    key={`print-${detail.id_payroll_detail}`}
                  >
                    <td>
                      {
                        detail.employee_name
                      }
                    </td>

                    <td>
                      {detail.position_name ||
                        'Sin cargo'}
                    </td>

                    <td>
                      {formatMoney(
                        detail.base_salary,
                      )}
                    </td>

                    <td>
                      {formatMoney(
                        detail.net_salary,
                      )}
                    </td>

                    <td>
                      {formatDate(
                        detail.salary_effective_date,
                      )}
                    </td>

                    <td>
                      {String(
                        detail.status ||
                          '',
                      ).toUpperCase() ===
                      'ACTIVE'
                        ? 'Incluido'
                        : 'Excluido'}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>

          <div className="payroll-print-footer">
            <span>
              Gimnasio MQS · Recursos Humanos
            </span>

            <span>
              Fecha de pago:{' '}
              {formatDate(
                printPayroll.payment_date,
              )}
            </span>
          </div>
        </div>
      )}
    </>
  );
}

export default Payrolls;
