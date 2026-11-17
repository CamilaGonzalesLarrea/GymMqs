import { useEffect, useMemo, useState } from 'react';
import { erpRequest } from '../config/erpApi';
import './DireccionReportes.css';

const PAGE_SIZE = 15;
const REPORT_OPTIONS = [
  ['customers', 'Reporte de clientes'],
  ['memberships', 'Reporte de membresías'],
  ['finance', 'Reporte financiero'],
  ['payments', 'Reporte de pagos'],
  ['attendance', 'Reporte de asistencias'],
  ['sales-by-plan', 'Reporte de ventas por plan'],
  ['renewals', 'Reporte de renovaciones'],
  ['commercial', 'Alertas y seguimiento comercial'],
];

const MEMBERSHIP_LABELS = {
  ACTIVE: 'Activa',
  EXPIRED: 'Vencida',
  PENDING: 'Pendiente',
  CANCELLED: 'Cancelada',
  SCHEDULED: 'Programada',
};

const CUSTOMER_LABELS = { ACTIVE: 'Activo', INACTIVE: 'Inactivo' };
const RENEWAL_LABELS = {
  REQUESTED: 'Solicitada',
  COMPLETED: 'Completada',
  REJECTED: 'Rechazada',
  CANCELLED: 'Cancelada',
};
const PAYMENT_LABELS = { REGISTERED: 'Registrado', CANCELLED: 'Anulado' };
const MOVEMENT_LABELS = {
  PAYMENT_IN: 'Cobro de membresía',
  PAYMENT_REVERSAL: 'Reversión de pago',
  OTHER_IN: 'Otro ingreso',
  EXPENSE_OUT: 'Gasto',
};
const COMMERCIAL_LABELS = {
  EXPIRING: 'Por vencer',
  EXPIRED: 'Vencida',
  LOW_ATTENDANCE: 'Baja asistencia',
  PENDING: 'Pendiente',
  CONTACTED: 'Contactada',
  DISMISSED: 'Descartada',
  PHONE: 'Teléfono',
  WHATSAPP: 'WhatsApp',
  EMAIL: 'Correo',
  IN_PERSON: 'Presencial',
  OTHER: 'Otro',
  RENEWAL_ACCEPTED: 'Aceptó renovar',
  DECLINED: 'Rechazó',
  NO_RESPONSE: 'Sin respuesta',
};

function currentBusinessDate() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/La_Paz',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (name) => parts.find((item) => item.type === name)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function monthRange(today) {
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

function addDays(value, days) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function weekRange(today) {
  const date = new Date(`${today}T00:00:00.000Z`);
  const start = addDays(today, -((date.getUTCDay() + 6) % 7));
  return { from: start, to: addDays(start, 6) };
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function dateLabel(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '—';
}

function dateTimeLabel(value) {
  if (!value) return '—';
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(value));
  return match ? `${match[3]}/${match[2]}/${match[1]} ${match[4]}:${match[5]}` : String(value);
}

function money(value) {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? `Bs ${new Intl.NumberFormat('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)}`
    : '—';
}

function statusLabel(value) {
  return MEMBERSHIP_LABELS[value] || CUSTOMER_LABELS[value] || RENEWAL_LABELS[value] ||
    PAYMENT_LABELS[value] || COMMERCIAL_LABELS[value] || value || '—';
}

function emptyFilters() {
  return {
    search: '',
    status: '',
    id_plan: '',
    id_payment_method: '',
    movement_kind: '',
    alert_type: '',
    reason: '',
  };
}

function Metric({ label, value, accent = '' }) {
  return (
    <article className={`direction-report-metric ${accent}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function Empty({ children }) {
  return <p className="direction-report-empty">{children}</p>;
}

function ReportTable({ columns, rows, rowKey, emptyMessage }) {
  if (!rows.length) return <Empty>{emptyMessage}</Empty>;
  return (
    <div className="direction-report-table-scroll">
      <table className="direction-report-table">
        <thead><tr>{columns.map((column) => <th key={column.label}>{column.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((column) => (
                <td key={column.label}>
                  {column.render ? column.render(row) : (row[column.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Pagination({ report, onChange }) {
  if (!report || report.totalPages <= 1) return null;
  return (
    <div className="direction-report-pagination">
      <button type="button" disabled={report.page <= 1} onClick={() => onChange(report.page - 1)}>Anterior</button>
      <span>Página {report.page} de {report.totalPages} · {report.total} registros</span>
      <button type="button" disabled={report.page >= report.totalPages} onClick={() => onChange(report.page + 1)}>Siguiente</button>
    </div>
  );
}

function BarChart({ rows, categoryKey, series, ariaLabel, moneyValues = false }) {
  if (!rows.length) return <Empty>No hay datos para graficar con estos filtros.</Empty>;

  const width = 780;
  const height = 250;
  const padding = { top: 16, right: 12, bottom: 42, left: 54 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const values = rows.flatMap((row) => series.map((item) => Number(row[item.key]) || 0));
  const max = Math.max(1, ...values);
  const step = plotWidth / rows.length;
  const groupWidth = Math.min(42, step * 0.8);
  const barWidth = Math.max(2, Math.min(16, (groupWidth - (series.length - 1) * 3) / series.length));
  const labelStep = Math.max(1, Math.ceil(rows.length / 8));

  return (
    <div className="direction-report-chart-scroll">
      <svg className="direction-report-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
        {[0, 0.5, 1].map((fraction) => {
          const y = padding.top + plotHeight * fraction;
          return (
            <g key={fraction}>
              <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} className="direction-report-gridline" />
              <text x={padding.left - 7} y={y + 4} textAnchor="end" className="direction-report-axis">
                {moneyValues ? MONEY_AXIS(max * (1 - fraction)) : Math.round(max * (1 - fraction))}
              </text>
            </g>
          );
        })}
        {rows.map((row, rowIndex) => {
          const center = padding.left + rowIndex * step + step / 2;
          const totalWidth = series.length * barWidth + (series.length - 1) * 3;
          return (
            <g key={row[categoryKey]}>
              {series.map((item, seriesIndex) => {
                const value = Number(row[item.key]) || 0;
                const barHeight = (value / max) * plotHeight;
                const x = center - totalWidth / 2 + seriesIndex * (barWidth + 3);
                const y = padding.top + plotHeight - barHeight;
                return (
                  <rect key={item.key} x={x} y={y} width={barWidth} height={Math.max(1, barHeight)} rx="2" fill={item.color}>
                    <title>{`${row[categoryKey]}: ${item.label} ${moneyValues ? money(value) : value}`}</title>
                  </rect>
                );
              })}
              {(rowIndex === 0 || rowIndex === rows.length - 1 || rowIndex % labelStep === 0) && (
                <text x={center} y={height - 10} textAnchor="middle" className="direction-report-axis">
                  {chartLabel(row[categoryKey])}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function MONEY_AXIS(value) {
  return new Intl.NumberFormat('es-BO', { maximumFractionDigits: 0 }).format(value);
}

function chartLabel(value) {
  const text = String(value || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text.slice(5);
  return text.length > 9 ? `${text.slice(0, 8)}…` : text;
}

function ReportFilters({
  type,
  section,
  periodMode,
  range,
  filters,
  plans,
  methods,
  loading,
  onRangeChange,
  onPeriodModeChange,
  onFilterChange,
  onSectionChange,
  onApply,
  onClear,
}) {
  const hasSearch = ['customers', 'memberships', 'payments', 'attendance', 'renewals', 'commercial'].includes(type);
  const hasPlan = ['customers', 'memberships', 'sales-by-plan'].includes(type);
  const hasMethod = ['finance', 'payments'].includes(type);
  const hasStatus = ['customers', 'memberships', 'payments', 'renewals', 'commercial'].includes(type);

  let statusOptions = [];
  if (type === 'customers') statusOptions = [['ACTIVE', 'Activo'], ['INACTIVE', 'Inactivo']];
  if (type === 'memberships') statusOptions = Object.entries(MEMBERSHIP_LABELS);
  if (type === 'payments') statusOptions = Object.entries(PAYMENT_LABELS);
  if (type === 'renewals') statusOptions = Object.entries(RENEWAL_LABELS);
  if (type === 'commercial' && section === 'alerts') {
    statusOptions = [['PENDING', 'Pendiente'], ['CONTACTED', 'Contactada'], ['DISMISSED', 'Descartada']];
  }
  if (type === 'commercial' && section === 'followups') {
    statusOptions = [['PENDING', 'Pendiente'], ['CONTACTED', 'Contactado'], ['RENEWAL_ACCEPTED', 'Aceptó renovar'], ['DECLINED', 'Rechazó'], ['NO_RESPONSE', 'Sin respuesta']];
  }

  return (
    <form className="direction-report-filters" onSubmit={onApply}>
      <label>Período rápido
        <select value={periodMode} onChange={(event) => onPeriodModeChange(event.target.value)}>
          <option value="day">Día de hoy</option>
          <option value="week">Semana (lunes a domingo)</option>
          <option value="month">Mes actual</option>
          <option value="custom">Rango personalizado</option>
        </select>
      </label>
      <label>Desde
        <input type="date" value={range.from} onChange={(event) => onRangeChange('from', event.target.value)} />
      </label>
      <label>Hasta
        <input type="date" value={range.to} onChange={(event) => onRangeChange('to', event.target.value)} />
      </label>

      {type === 'commercial' && (
        <label>Datos comerciales
          <select value={section} onChange={(event) => onSectionChange(event.target.value)}>
            <option value="alerts">Alertas</option>
            <option value="followups">Seguimientos</option>
          </select>
        </label>
      )}

      {hasSearch && (
        <label>Cliente o identificador
          <input
            value={filters.search}
            maxLength={100}
            onChange={(event) => onFilterChange('search', event.target.value)}
            placeholder="Nombre o código"
          />
        </label>
      )}

      {hasStatus && (
        <label>{type === 'commercial' && section === 'followups' ? 'Resultado' : 'Estado'}
          <select value={filters.status} onChange={(event) => onFilterChange('status', event.target.value)}>
            <option value="">Todos</option>
            {statusOptions.map(([value, name]) => <option key={value} value={value}>{name}</option>)}
          </select>
        </label>
      )}

      {hasPlan && (
        <label>Plan
          <select value={filters.id_plan} onChange={(event) => onFilterChange('id_plan', event.target.value)}>
            <option value="">Todos</option>
            {plans.map((plan) => <option key={plan.id_plan} value={plan.id_plan}>{plan.plan_name}</option>)}
          </select>
        </label>
      )}

      {hasMethod && (
        <label>Método de pago
          <select value={filters.id_payment_method} onChange={(event) => onFilterChange('id_payment_method', event.target.value)}>
            <option value="">Todos</option>
            {methods.map((method) => (
              <option key={method.id_payment_method} value={method.id_payment_method}>{method.payment_method}</option>
            ))}
          </select>
        </label>
      )}

      {type === 'finance' && (
        <label>Tipo de movimiento
          <select value={filters.movement_kind} onChange={(event) => onFilterChange('movement_kind', event.target.value)}>
            <option value="">Ingresos, gastos y reversiones</option>
            {Object.entries(MOVEMENT_LABELS).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
          </select>
        </label>
      )}

      {type === 'commercial' && section === 'alerts' && (
        <label>Tipo de alerta
          <select value={filters.alert_type} onChange={(event) => onFilterChange('alert_type', event.target.value)}>
            <option value="">Todos</option>
            <option value="EXPIRING">Por vencer</option>
            <option value="EXPIRED">Vencida</option>
            <option value="LOW_ATTENDANCE">Baja asistencia</option>
          </select>
        </label>
      )}

      {type === 'commercial' && section === 'followups' && (
        <label>Motivo
          <select value={filters.reason} onChange={(event) => onFilterChange('reason', event.target.value)}>
            <option value="">Todos</option>
            <option value="EXPIRING">Por vencer</option>
            <option value="EXPIRED">Vencida</option>
            <option value="LOW_ATTENDANCE">Baja asistencia</option>
            <option value="OTHER">Otro</option>
          </select>
        </label>
      )}

      <div className="direction-report-filter-actions">
        <button type="submit" disabled={loading}>Aplicar filtros</button>
        <button type="button" className="secondary" onClick={onClear}>Limpiar filtros</button>
      </div>
    </form>
  );
}

function columnsFor(type, section) {
  if (type === 'customers') return [
    { label: 'Identificador', key: 'id_customer' },
    { label: 'Cliente', key: 'customer_name' },
    { label: 'Estado administrativo', render: (row) => CUSTOMER_LABELS[row.customer_status] || row.customer_status },
    { label: 'Plan vigente', key: 'plan_name' },
    { label: 'Estado de membresía', render: (row) => statusLabel(row.membership_status) },
    { label: 'Registro', render: (row) => dateLabel(row.registration_date) },
  ];
  if (type === 'memberships') return [
    { label: 'Cliente', key: 'customer_name' },
    { label: 'Plan', key: 'plan_name' },
    { label: 'Inicio', render: (row) => dateLabel(row.start_date) },
    { label: 'Vencimiento', render: (row) => dateLabel(row.end_date) },
    { label: 'Estado efectivo', render: (row) => statusLabel(row.effective_status) },
    { label: 'Importe registrado', render: (row) => money(row.applied_price) },
  ];
  if (type === 'finance') return [
    { label: 'Fecha', render: (row) => dateLabel(row.business_date) },
    { label: 'Tipo', render: (row) => MOVEMENT_LABELS[row.movement_kind] || row.movement_kind },
    { label: 'Concepto', render: (row) => row.description || row.notes || row.category || '—' },
    { label: 'Importe', render: (row) => money(row.amount) },
    { label: 'Método', key: 'payment_method' },
    { label: 'Referencia', render: (row) => row.id_payment ? `Pago #${row.id_payment}` : row.id_financial_entry ? `Registro #${row.id_financial_entry}` : `Movimiento #${row.id_cash_movement}` },
  ];
  if (type === 'payments') return [
    { label: 'Fecha', render: (row) => dateTimeLabel(row.payment_date) },
    { label: 'Cliente', key: 'customer_name' },
    { label: 'Concepto', key: 'concept' },
    { label: 'Importe', render: (row) => money(row.amount) },
    { label: 'Método', key: 'payment_method' },
    { label: 'Estado', render: (row) => statusLabel(row.status) },
  ];
  if (type === 'attendance') return [
    { label: 'Fecha', render: (row) => dateLabel(row.attendance_date) },
    { label: 'Cliente', key: 'customer_name' },
    { label: 'Hora de ingreso', key: 'entry_time' },
    { label: 'Registro', key: 'id_attendance' },
  ];
  if (type === 'sales-by-plan') return [
    { label: 'Plan', key: 'plan_name' },
    { label: 'Membresías registradas', key: 'membership_count' },
    { label: 'Valor registrado', render: (row) => money(row.recorded_value) },
    { label: 'Pagos válidos relacionados', key: 'valid_payment_count' },
    { label: 'Cobros válidos', render: (row) => money(row.collected_value) },
  ];
  if (type === 'renewals') return [
    { label: 'Cliente', key: 'customer_name' },
    { label: 'Plan', key: 'plan_name' },
    { label: 'Solicitada', render: (row) => dateTimeLabel(row.requested_at) },
    { label: 'Estado', render: (row) => statusLabel(row.status) },
    { label: 'Finalizada', render: (row) => dateTimeLabel(row.completed_at) },
  ];
  if (section === 'alerts') return [
    { label: 'Cliente', key: 'customer_name' },
    { label: 'Tipo', render: (row) => statusLabel(row.alert_type) },
    { label: 'Fecha de referencia', render: (row) => dateLabel(row.reference_date) },
    { label: 'Registrada', render: (row) => dateTimeLabel(row.created_at) },
    { label: 'Estado', render: (row) => statusLabel(row.status) },
  ];
  return [
    { label: 'Cliente', key: 'customer_name' },
    { label: 'Fecha', render: (row) => dateTimeLabel(row.contact_date) },
    { label: 'Motivo', render: (row) => statusLabel(row.reason) },
    { label: 'Método', render: (row) => statusLabel(row.contact_method) },
    { label: 'Resultado', render: (row) => statusLabel(row.result) },
    { label: 'Próxima acción', render: (row) => dateTimeLabel(row.next_action_at) },
  ];
}

export default function DireccionReportes({ refreshKey: externalRefresh = 0 }) {
  const initialRange = useMemo(() => monthRange(currentBusinessDate()), []);
  const [type, setType] = useState('customers');
  const [section, setSection] = useState('alerts');
  const [periodMode, setPeriodMode] = useState('month');
  const [rangeDraft, setRangeDraft] = useState(initialRange);
  const [range, setRange] = useState(initialRange);
  const [filterDraft, setFilterDraft] = useState(emptyFilters);
  const [filters, setFilters] = useState(emptyFilters);
  const [page, setPage] = useState(1);
  const [rangeNotice, setRangeNotice] = useState('');
  const [loaded, setLoaded] = useState(null);
  const refresh = externalRefresh;

  const params = useMemo(() => {
    const values = { ...range, page, limit: PAGE_SIZE };
    if (['customers', 'memberships', 'payments', 'attendance', 'renewals', 'commercial'].includes(type)) {
      values.search = filters.search;
    }
    if (['customers', 'memberships', 'sales-by-plan'].includes(type)) values.id_plan = filters.id_plan;
    if (['customers', 'memberships', 'payments', 'renewals'].includes(type)) values.status = filters.status;
    if (['finance', 'payments'].includes(type)) values.id_payment_method = filters.id_payment_method;
    if (type === 'finance') values.movement_kind = filters.movement_kind;
    if (type === 'sales-by-plan') values.id_plan = filters.id_plan;
    if (type === 'commercial') {
      values.section = section;
      values.status = filters.status;
      if (section === 'alerts') values.alert_type = filters.alert_type;
      else values.reason = filters.reason;
    }
    return values;
  }, [filters, page, range, section, type]);

  const serializedParams = JSON.stringify(params);
  const reportPath = `/api/erp/direction/reports/${type}`;
  const requestKey = JSON.stringify([reportPath, serializedParams, refresh]);
  const needsPlans = ['customers', 'memberships', 'sales-by-plan'].includes(type);
  const needsMethods = ['finance', 'payments'].includes(type);
  const methodParams = JSON.stringify({ from: range.from, to: range.to });

  useEffect(() => {
    const controller = new AbortController();
    const requestParams = JSON.parse(serializedParams);
    const requests = [
      erpRequest(reportPath, { params: requestParams, signal: controller.signal }),
    ];
    if (needsPlans) {
      requests.push(erpRequest('/api/erp/direction/membership-plans', {
        params: { page: 1, limit: 100 },
        signal: controller.signal,
      }));
    }
    if (needsMethods) {
      requests.push(erpRequest('/api/erp/direction/finance/payment-methods', {
        params: JSON.parse(methodParams),
        signal: controller.signal,
      }));
    }
    Promise.all(requests).then((results) => {
      let index = 1;
      const plans = needsPlans ? (results[index++]?.data || []) : [];
      const methods = needsMethods ? (results[index]?.data || []) : [];
      setLoaded({
        requestKey,
        report: results[0],
        plans,
        methods,
        error: '',
        complete: true,
      });
    }).catch((error) => {
      if (error?.name !== 'AbortError' && error?.code !== 'REQUEST_CANCELLED') {
        setLoaded({
          requestKey,
          report: null,
          plans: [],
          methods: [],
          error: error?.message || 'No se pudo cargar el reporte solicitado.',
          complete: true,
        });
      }
    });
    return () => controller.abort();
  }, [methodParams, needsMethods, needsPlans, reportPath, requestKey, serializedParams]);

  const current = loaded?.requestKey === requestKey ? loaded : null;
  const report = current?.report || null;
  const loading = !current?.complete;
  const error = current?.error || '';
  const plans = current?.plans || [];
  const methods = current?.methods || [];

  function setFilter(name, value) {
    setFilterDraft((previous) => ({ ...previous, [name]: value }));
  }

  function choosePeriod(mode) {
    const today = currentBusinessDate();
    setPeriodMode(mode);
    if (mode === 'day') setRangeDraft({ from: today, to: today });
    if (mode === 'week') setRangeDraft(weekRange(today));
    if (mode === 'month') setRangeDraft(monthRange(today));
  }

  function applyFilters(event) {
    event.preventDefault();
    if (!validDate(rangeDraft.from) || !validDate(rangeDraft.to) || rangeDraft.from > rangeDraft.to) {
      setRangeNotice('Selecciona fechas válidas y verifica que la fecha inicial no supere la final.');
      return;
    }
    const days = (Date.parse(`${rangeDraft.to}T00:00:00Z`) - Date.parse(`${rangeDraft.from}T00:00:00Z`)) / 86400000;
    if (days >= 366) {
      setRangeNotice('El período máximo permitido es de 366 días.');
      return;
    }
    setRange({ ...rangeDraft });
    setFilters({ ...filterDraft });
    setPage(1);
    setRangeNotice('');
  }

  function clearFilters() {
    const clean = emptyFilters();
    setPeriodMode('month');
    setRangeDraft(initialRange);
    setRange(initialRange);
    setFilterDraft(clean);
    setFilters(clean);
    setPage(1);
    setRangeNotice('');
  }

  function changeType(nextType) {
    setType(nextType);
    setFilterDraft(emptyFilters());
    setFilters(emptyFilters());
    setPage(1);
  }

  function changeSection(nextSection) {
    setSection(nextSection);
    setFilterDraft(emptyFilters());
    setFilters(emptyFilters());
    setPage(1);
  }

  const columns = columnsFor(type, section);
  const rowKey = (row) => row.id_customer ?? row.id_membership ?? row.id_payment ??
    row.id_attendance ?? row.id_plan ?? row.id_renewal_request ?? row.id_alert ?? row.id_followup;
  const reportRows = report?.data || [];
  const summary = report?.summary;
  const title = REPORT_OPTIONS.find(([key]) => key === type)?.[1] || 'Reporte';

  return (
    <section className="direction-reports" aria-label="Reportes generales">
      <header className="direction-reports-heading">
        <div>
          <span className="direction-reports-kicker">DIRECCIÓN · CONSULTA DE SOLO LECTURA</span>
          <h2>Reportes Generales</h2>
          <p>Selecciona un reporte para consultar datos reales de los módulos del ERP.</p>
        </div>
      </header>

      <label className="direction-reports-selector">Tipo de reporte
        <select value={type} onChange={(event) => changeType(event.target.value)}>
          {REPORT_OPTIONS.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
        </select>
      </label>

      <ReportFilters
        type={type}
        section={section}
        periodMode={periodMode}
        range={rangeDraft}
        filters={filterDraft}
        plans={plans}
        methods={methods}
        loading={loading}
        onRangeChange={(key, value) => {
          setPeriodMode('custom');
          setRangeDraft((previous) => ({ ...previous, [key]: value }));
        }}
        onPeriodModeChange={choosePeriod}
        onFilterChange={setFilter}
        onSectionChange={changeSection}
        onApply={applyFilters}
        onClear={clearFilters}
      />
      {rangeNotice && <p className="direction-reports-message error" role="alert">{rangeNotice}</p>}
      {loading && <p className="direction-reports-message" role="status">Cargando {title.toLowerCase()} desde MySQL…</p>}
      {!loading && error && <p className="direction-reports-message error" role="alert">{error}</p>}

      {!loading && !error && report && (
        <>
          <div className="direction-reports-period">
            <h3>{type === 'commercial' ? `${title} · ${section === 'alerts' ? 'Alertas' : 'Seguimientos'}` : title}</h3>
            <span>Período: {dateLabel(report.from)} – {dateLabel(report.to)}</span>
          </div>

          {type === 'customers' && summary && (
            <div className="direction-reports-metrics">
              <Metric label="Clientes encontrados" value={summary.total} />
              <Metric label="Administrativamente activos" value={summary.active} accent="green" />
              <Metric label="Administrativamente inactivos" value={summary.inactive} accent="muted" />
            </div>
          )}

          {type === 'memberships' && summary && (
            <>
              <div className="direction-reports-metrics">
                <Metric label="Membresías encontradas" value={summary.total} />
                <Metric label="Valor registrado" value={money(summary.recordedValue)} accent="blue" />
              </div>
              <div className="direction-reports-statuses">
                {summary.byStatus.map((row) => <span key={row.status}>{statusLabel(row.status)}: <strong>{row.total}</strong></span>)}
              </div>
            </>
          )}

          {type === 'finance' && summary && (
            <>
              <div className="direction-reports-metrics">
                <Metric label="Ingresos" value={money(summary.income)} accent="green" />
                <Metric label="Gastos" value={money(summary.expenses)} accent="red" />
                <Metric label="Reversiones o ajustes" value={money(summary.reversals)} accent="amber" />
                <Metric label="Saldo neto" value={money(summary.net)} accent="blue" />
              </div>
              <p className="direction-reports-note">Saldo neto = ingresos − gastos − reversiones. No representa efectivo disponible en caja. Se calcula desde movimientos de caja sin volver a sumar pagos ni entradas financieras relacionadas.</p>
              <section className="direction-reports-panel">
                <h3>Ingresos y gastos por fecha</h3>
                <div className="direction-reports-legend">
                  <span><i className="income" /> Ingresos</span><span><i className="expense" /> Gastos</span>
                </div>
                <BarChart rows={report.chart} categoryKey="date" moneyValues
                  ariaLabel="Ingresos y gastos diarios del período"
                  series={[{ key: 'income', label: 'Ingresos', color: '#42c985' }, { key: 'expenses', label: 'Gastos', color: '#f05a72' }]} />
              </section>
            </>
          )}

          {type === 'payments' && summary && (
            <div className="direction-reports-metrics">
              <Metric label="Pagos registrados" value={`${summary.registeredCount} · ${money(summary.registeredAmount)}`} accent="green" />
              <Metric label="Pagos anulados (separados)" value={`${summary.cancelledCount} · ${money(summary.cancelledAmount)}`} accent="muted" />
            </div>
          )}

          {type === 'attendance' && summary && (
            <>
              <div className="direction-reports-metrics">
                <Metric label="Registros del período" value={summary.total} accent="blue" />
                <Metric label="Clientes únicos" value={summary.uniqueCustomers} accent="green" />
              </div>
              <section className="direction-reports-panel">
                <h3>Asistencias por fecha</h3>
                <BarChart rows={report.chart} categoryKey="date" ariaLabel="Asistencias por fecha"
                  series={[{ key: 'total', label: 'Asistencias', color: '#d2254d' }]} />
              </section>
            </>
          )}

          {type === 'sales-by-plan' && summary && (
            <>
              <div className="direction-reports-metrics">
                <Metric label="Membresías registradas" value={summary.memberships} />
                <Metric label="Valor registrado" value={money(summary.recordedValue)} accent="blue" />
                <Metric label="Pagos válidos relacionados" value={summary.validPayments} accent="green" />
                <Metric label="Cobros válidos" value={money(summary.collected)} accent="green" />
              </div>
              <p className="direction-reports-note">El valor de membresías usa el precio guardado al registrarlas. Los cobros se calculan aparte desde pagos REGISTERED del período.</p>
              <section className="direction-reports-panel">
                <h3>Valor registrado y cobros válidos por plan</h3>
                <div className="direction-reports-legend">
                  <span><i className="sales" /> Valor registrado</span><span><i className="collected" /> Cobros válidos</span>
                </div>
                <BarChart rows={report.chart} categoryKey="planName" moneyValues ariaLabel="Valor registrado y cobros por plan"
                  series={[{ key: 'recordedValue', label: 'Valor registrado', color: '#6aa7ff' }, { key: 'collected', label: 'Cobros válidos', color: '#42c985' }]} />
              </section>
            </>
          )}

          {type === 'renewals' && summary && (
            <>
              <div className="direction-reports-metrics">
                <Metric label="Solicitudes del período" value={summary.total} />
                <Metric label="Completadas por fecha de finalización" value={summary.completed} accent="green" />
              </div>
              <div className="direction-reports-statuses">
                {summary.byStatus.map((row) => <span key={row.status}>{statusLabel(row.status)}: <strong>{row.total}</strong></span>)}
              </div>
            </>
          )}

          {type === 'commercial' && summary && (
            <>
              <div className="direction-reports-metrics">
                <Metric label={section === 'alerts' ? 'Alertas registradas' : 'Seguimientos registrados'} value={summary.total} accent="amber" />
              </div>
              <div className="direction-reports-statuses">
                {(summary.byStatus || summary.byResult || []).map((row, index) => {
                  const key = row.status || row.result || `${row.type}-${index}`;
                  const text = section === 'alerts' ? `${statusLabel(row.type)} · ${statusLabel(row.status)}` : statusLabel(row.result);
                  return <span key={key}>{text}: <strong>{row.total}</strong></span>;
                })}
              </div>
              <p className="direction-reports-note">Las alertas mostradas son registros almacenados, no vencimientos calculados. Un resultado de seguimiento no se interpreta como una venta.</p>
            </>
          )}

          <section className="direction-reports-panel">
            <ReportTable
              columns={columns}
              rows={reportRows}
              rowKey={rowKey}
              emptyMessage={`No hay datos para ${title.toLowerCase()} con estos filtros.`}
            />
            <Pagination report={report} onChange={setPage} />
            <p className="direction-reports-total">{report.total} registros encontrados</p>
          </section>
        </>
      )}
    </section>
  );
}
