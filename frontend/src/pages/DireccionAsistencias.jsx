import { useEffect, useState } from 'react';
import { erpRequest } from '../config/erpApi';
import './DireccionAsistencias.css';

const ROOT = '/api/erp/direction/attendance';
const PAGE_SIZE = 15;

function boliviaToday() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/La_Paz',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (name) => parts.find((item) => item.type === name)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function addDays(value, days) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function mondayOf(value) {
  const date = new Date(`${value}T00:00:00.000Z`);
  return addDays(value, -((date.getUTCDay() + 6) % 7));
}

function monthStart(value) {
  return `${value.slice(0, 7)}-01`;
}

function dateLabel(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '—';
}

function timeLabel(value) {
  const match = /^(\d{2}):(\d{2})/.exec(String(value || ''));
  return match ? `${match[1]}:${match[2]}` : '—';
}

function statusLabel(status) {
  if (status === 'ACTIVE') return 'Activo';
  if (status === 'INACTIVE') return 'Inactivo';
  return status || '—';
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function useAttendanceRead(path, params, enabled, refreshKey) {
  const serializedParams = JSON.stringify(params);
  const requestKey = JSON.stringify([path, serializedParams, refreshKey]);
  const [response, setResponse] = useState(null);

  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    erpRequest(path, {
      params: JSON.parse(serializedParams),
      signal: controller.signal,
    }).then((data) => {
      setResponse({ requestKey, data, error: '', complete: true });
    }).catch((error) => {
      if (error?.name !== 'AbortError' && error?.code !== 'REQUEST_CANCELLED') {
        setResponse({
          requestKey,
          data: null,
          error: error?.message || 'No se pudo consultar la asistencia.',
          complete: true,
        });
      }
    });
    return () => controller.abort();
  }, [enabled, path, refreshKey, requestKey, serializedParams]);

  const current = response?.requestKey === requestKey ? response : null;
  return {
    data: current?.data || null,
    loading: enabled && !current?.complete,
    error: current?.error || '',
  };
}

function Metric({ label, value, accent = '' }) {
  return (
    <article className={`direction-attendance-metric ${accent}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function AttendanceChart({ rows, type }) {
  if (!rows.length) {
    return <p className="direction-attendance-empty">No existen asistencias para el período seleccionado.</p>;
  }

  const width = 780;
  const height = 250;
  const padding = { top: 16, right: 12, bottom: 38, left: 36 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const max = Math.max(1, ...rows.map((row) => row.total));
  const step = plotWidth / rows.length;
  const barWidth = Math.max(3, Math.min(type === 'hourly' ? 24 : 18, step * 0.62));
  const labelStep = Math.max(1, Math.ceil(rows.length / 8));
  const countLabel = type === 'hourly' ? 'ingresos' : 'asistencias';

  return (
    <div className="direction-attendance-chart-scroll">
      <svg
        className="direction-attendance-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={type === 'hourly' ? 'Ingresos registrados por hora' : 'Asistencias por fecha'}
      >
        <line
          x1={padding.left}
          x2={width - padding.right}
          y1={padding.top + plotHeight}
          y2={padding.top + plotHeight}
          className="direction-attendance-gridline"
        />
        {rows.map((row, index) => {
          const barHeight = (row.total / max) * plotHeight;
          const x = padding.left + index * step + (step - barWidth) / 2;
          const y = padding.top + plotHeight - barHeight;
          const label = type === 'hourly'
            ? `${String(row.hour).padStart(2, '0')}:00`
            : dateLabel(row.date);
          return (
            <g key={type === 'hourly' ? row.hour : row.date}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={Math.max(1, barHeight)}
                rx="3"
                className="direction-attendance-bar"
              >
                <title>{`${label}: ${row.total} ${countLabel}`}</title>
              </rect>
              {(index === 0 || index === rows.length - 1 || index % labelStep === 0) && (
                <text
                  x={x + barWidth / 2}
                  y={height - 10}
                  textAnchor="middle"
                  className="direction-attendance-axis-label"
                >
                  {type === 'hourly' ? `${String(row.hour).padStart(2, '0')}h` : label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function Pager({ result, page, setPage }) {
  if (!result || result.totalPages <= 1) return null;
  return (
    <div className="direction-attendance-pager">
      <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</button>
      <span>Página {page} de {result.totalPages} · {result.total} registros</span>
      <button type="button" disabled={page >= result.totalPages} onClick={() => setPage(page + 1)}>Siguiente</button>
    </div>
  );
}

function ReadOnlyTable({ columns, rows, emptyMessage }) {
  if (!rows.length) return <p className="direction-attendance-empty">{emptyMessage}</p>;
  return (
    <div className="direction-attendance-table-scroll">
      <table className="direction-attendance-table">
        <thead><tr>{columns.map((column) => <th key={column.label}>{column.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id_attendance ?? row.id_customer}>
              {columns.map((column) => (
                <td key={column.label}>{column.render ? column.render(row) : (row[column.key] ?? '—')}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DireccionAsistencias({ refreshKey: externalRefresh = 0 }) {
  const today = boliviaToday();
  const [view, setView] = useState('report');
  const [periodMode, setPeriodMode] = useState('month');
  const [rangeDraft, setRangeDraft] = useState({ from: monthStart(today), to: today });
  const [range, setRange] = useState({ from: monthStart(today), to: today });
  const [rangeNotice, setRangeNotice] = useState('');
  const [localRefresh, setLocalRefresh] = useState(0);
  const [recordSearchDraft, setRecordSearchDraft] = useState('');
  const [recordSearch, setRecordSearch] = useState('');
  const [recordPage, setRecordPage] = useState(1);
  const [customerSearchDraft, setCustomerSearchDraft] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [inactiveDays, setInactiveDays] = useState(7);
  const [inactiveSearchDraft, setInactiveSearchDraft] = useState('');
  const [inactiveSearch, setInactiveSearch] = useState('');
  const [inactivePage, setInactivePage] = useState(1);
  const refreshKey = `${externalRefresh}:${localRefresh}`;

  const report = useAttendanceRead(
    `${ROOT}/summary`,
    range,
    view === 'report',
    refreshKey,
  );
  const records = useAttendanceRead(
    `${ROOT}/records`,
    { ...range, page: recordPage, limit: PAGE_SIZE, search: recordSearch },
    view === 'records',
    refreshKey,
  );
  const customerOptions = useAttendanceRead(
    `${ROOT}/customers`,
    { search: customerSearch },
    view === 'history' && Boolean(customerSearch),
    refreshKey,
  );
  const history = useAttendanceRead(
    `${ROOT}/customers/${selectedCustomer?.id_customer || 1}`,
    { ...range, page: historyPage, limit: PAGE_SIZE },
    view === 'history' && Boolean(selectedCustomer),
    refreshKey,
  );
  const inactive = useAttendanceRead(
    `${ROOT}/inactive`,
    { days: inactiveDays, search: inactiveSearch, page: inactivePage, limit: PAGE_SIZE },
    view === 'inactive',
    refreshKey,
  );

  function choosePeriod(mode) {
    let next;
    if (mode === 'day') next = { from: today, to: today };
    else if (mode === 'week') {
      const from = mondayOf(today);
      next = { from, to: addDays(from, 6) };
    } else if (mode === 'month') next = { from: monthStart(today), to: today };
    else {
      setPeriodMode('custom');
      return;
    }
    setPeriodMode(mode);
    setRangeDraft(next);
    setRange(next);
    setRangeNotice('');
  }

  function applyRange(event) {
    event.preventDefault();
    if (!validDate(rangeDraft.from) || !validDate(rangeDraft.to) || rangeDraft.from > rangeDraft.to) {
      setRangeNotice('Selecciona un rango de fechas válido.');
      return;
    }
    const days = (Date.parse(`${rangeDraft.to}T00:00:00Z`) - Date.parse(`${rangeDraft.from}T00:00:00Z`)) / 86400000;
    if (days >= 366) {
      setRangeNotice('El período máximo permitido es de 366 días.');
      return;
    }
    setRange(rangeDraft);
    setRangeNotice('');
  }

  function submitRecordSearch(event) {
    event.preventDefault();
    setRecordSearch(recordSearchDraft.trim());
    setRecordPage(1);
  }

  function submitCustomerSearch(event) {
    event.preventDefault();
    setCustomerSearch(customerSearchDraft.trim());
    setSelectedCustomer(null);
    setHistoryPage(1);
  }

  function submitInactiveSearch(event) {
    event.preventDefault();
    setInactiveSearch(inactiveSearchDraft.trim());
    setInactivePage(1);
  }

  const summary = report.data;
  const recordResult = records.data;
  const historyResult = history.data;
  const inactiveResult = inactive.data;

  return (
    <section className="direction-attendance">
      <header className="direction-attendance-heading">
        <div>
          <span className="direction-attendance-kicker">DIRECCIÓN · CONSULTA DE SOLO LECTURA</span>
          <h2>Asistencia y Actividad</h2>
          <p>Registros de ingreso e indicadores consultados directamente desde MySQL.</p>
        </div>
        <button type="button" onClick={() => setLocalRefresh((value) => value + 1)}>
          Actualizar
        </button>
      </header>

      <nav className="direction-attendance-tabs" aria-label="Consultas de asistencia">
        {[
          ['report', 'Resumen y reportes'],
          ['history', 'Historial individual'],
          ['inactive', 'Poca actividad'],
          ['records', 'Todos los registros'],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={view === key ? 'active' : ''}
            aria-selected={view === key}
            onClick={() => setView(key)}
          >
            {label}
          </button>
        ))}
      </nav>

      {view === 'report' && (
        <>
          <form className="direction-attendance-period" onSubmit={applyRange}>
            <label>
              Período
              <select value={periodMode} onChange={(event) => choosePeriod(event.target.value)}>
                <option value="day">Día de hoy</option>
                <option value="week">Semana (lunes a domingo)</option>
                <option value="month">Mes actual</option>
                <option value="custom">Rango personalizado</option>
              </select>
            </label>
            <label>Desde
              <input
                type="date"
                value={rangeDraft.from}
                onChange={(event) => {
                  setPeriodMode('custom');
                  setRangeDraft({ ...rangeDraft, from: event.target.value });
                }}
              />
            </label>
            <label>Hasta
              <input
                type="date"
                value={rangeDraft.to}
                onChange={(event) => {
                  setPeriodMode('custom');
                  setRangeDraft({ ...rangeDraft, to: event.target.value });
                }}
              />
            </label>
            <button type="submit">Consultar período</button>
          </form>
          {rangeNotice && <p className="direction-attendance-message error" role="alert">{rangeNotice}</p>}
          {report.loading && <p className="direction-attendance-message" role="status">Cargando asistencias…</p>}
          {!report.loading && report.error && <p className="direction-attendance-message error" role="alert">{report.error}</p>}
          {!report.loading && !report.error && summary && (
            <>
              <p className="direction-attendance-caption">
                Período seleccionado: {dateLabel(summary.period.from)} – {dateLabel(summary.period.to)}.
                Semana definida de lunes a domingo.
              </p>
              <div className="direction-attendance-metrics">
                <Metric label="Asistencias de hoy" value={summary.today} accent="blue" />
                <Metric label="Asistencias de esta semana" value={summary.week.total} accent="blue" />
                <Metric label="Asistencias del mes" value={summary.month.total} accent="blue" />
                <Metric label="Clientes únicos del período" value={summary.period.uniqueCustomers} accent="green" />
                <Metric label="Promedio diario" value={summary.period.averagePerCalendarDay.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} accent="amber" />
                <Metric
                  label="Hora con más ingresos"
                  value={summary.peakHour ? `${String(summary.peakHour.hour).padStart(2, '0')}:00` : 'Sin datos'}
                  accent="red"
                />
              </div>
              <p className="direction-attendance-note">
                El promedio se calcula usando todos los días calendario del período, incluso los que no tienen registros.
                Los gráficos muestran ingresos registrados, no ocupación simultánea. Si hay empate en el horario máximo,
                se muestra la hora más temprana.
              </p>
              <div className="direction-attendance-chart-grid">
                <section className="direction-attendance-panel">
                  <h3>Asistencias por fecha</h3>
                  <p>{summary.period.total} registros · {summary.period.uniqueCustomers} clientes únicos</p>
                  <AttendanceChart rows={summary.daily} type="daily" />
                </section>
                <section className="direction-attendance-panel">
                  <h3>Ingresos registrados por hora</h3>
                  {summary.peakHour && (
                    <p>Mayor concurrencia: {String(summary.peakHour.hour).padStart(2, '0')}:00 ({summary.peakHour.total} ingresos).</p>
                  )}
                  <AttendanceChart rows={summary.hourly} type="hourly" />
                </section>
              </div>
            </>
          )}
        </>
      )}

      {view === 'history' && (
        <>
          <form className="direction-attendance-search" onSubmit={submitCustomerSearch}>
            <label>Buscar cliente por nombre o identificador
              <input
                value={customerSearchDraft}
                onChange={(event) => setCustomerSearchDraft(event.target.value)}
                maxLength={100}
              />
            </label>
            <button type="submit">Buscar cliente</button>
          </form>
          {customerOptions.loading && <p className="direction-attendance-message" role="status">Buscando clientes…</p>}
          {!customerOptions.loading && customerOptions.error && <p className="direction-attendance-message error" role="alert">{customerOptions.error}</p>}
          {!customerOptions.loading && customerOptions.data?.data?.length > 0 && (
            <div className="direction-attendance-customer-options">
              {customerOptions.data.data.map((customer) => (
                <button
                  key={customer.id_customer}
                  type="button"
                  onClick={() => {
                    setSelectedCustomer(customer);
                    setHistoryPage(1);
                  }}
                >
                  #{customer.id_customer} · {customer.customer_name} · {statusLabel(customer.customer_status)}
                </button>
              ))}
            </div>
          )}
          {selectedCustomer && (
            <>
              <p className="direction-attendance-caption">
                Cliente seleccionado: #{selectedCustomer.id_customer} · {selectedCustomer.customer_name}
              </p>
              {history.loading && <p className="direction-attendance-message" role="status">Cargando historial…</p>}
              {!history.loading && history.error && <p className="direction-attendance-message error" role="alert">{history.error}</p>}
              {!history.loading && !history.error && historyResult && (
                <>
                  <div className="direction-attendance-customer-summary">
                    <Metric label="Estado administrativo" value={statusLabel(historyResult.customer.customer_status)} />
                    <Metric label="Asistencias del período" value={historyResult.summary.total} accent="blue" />
                    <Metric label="Última asistencia del período" value={dateLabel(historyResult.summary.lastAttendanceDate)} accent="green" />
                  </div>
                  <p className="direction-attendance-caption">
                    Historial entre {dateLabel(historyResult.from)} y {dateLabel(historyResult.to)}.
                    Cambia el período en “Resumen y reportes” para consultar otras fechas.
                  </p>
                  <ReadOnlyTable
                    columns={[
                      { label: 'Fecha', render: (row) => dateLabel(row.attendance_date) },
                      { label: 'Hora de ingreso', render: (row) => timeLabel(row.entry_time) },
                      { label: 'Registro', key: 'id_attendance' },
                    ]}
                    rows={historyResult.data}
                    emptyMessage="No existen asistencias registradas para este cliente."
                  />
                  <Pager result={historyResult} page={historyPage} setPage={setHistoryPage} />
                </>
              )}
            </>
          )}
        </>
      )}

      {view === 'inactive' && (
        <>
          <form className="direction-attendance-search" onSubmit={submitInactiveSearch}>
            <label>Buscar cliente
              <input
                value={inactiveSearchDraft}
                onChange={(event) => setInactiveSearchDraft(event.target.value)}
                maxLength={100}
              />
            </label>
            <label>Sin actividad durante
              <select
                value={inactiveDays}
                onChange={(event) => {
                  setInactiveDays(Number(event.target.value));
                  setInactivePage(1);
                }}
              >
                <option value={7}>7 días</option>
                <option value={15}>15 días</option>
                <option value={30}>30 días</option>
              </select>
            </label>
            <button type="submit">Buscar</button>
          </form>
          <p className="direction-attendance-note">
            Solo aparecen clientes administrativamente activos con una membresía ACTIVE vigente.
            La antigüedad de actividad se cuenta desde la asistencia más reciente, o desde el inicio de la membresía
            si no hay asistencias posteriores; así no se penaliza un período anterior a la membresía actual.
          </p>
          {inactive.loading && <p className="direction-attendance-message" role="status">Consultando actividad…</p>}
          {!inactive.loading && inactive.error && <p className="direction-attendance-message error" role="alert">{inactive.error}</p>}
          {!inactive.loading && !inactive.error && inactiveResult && (
            <>
              <ReadOnlyTable
                columns={[
                  { label: 'Cliente', key: 'customer_name' },
                  { label: 'Código', key: 'id_customer' },
                  { label: 'Plan vigente', key: 'plan_name' },
                  { label: 'Última asistencia', render: (row) => row.last_attendance_date ? dateLabel(row.last_attendance_date) : 'Sin asistencias registradas' },
                  { label: 'Días desde la última', render: (row) => row.daysSinceLastAttendance ?? '—' },
                  { label: 'Vencimiento de membresía', render: (row) => dateLabel(row.membership_end_date) },
                ]}
                rows={inactiveResult.data}
                emptyMessage={`No hay clientes con membresía vigente sin actividad durante ${inactiveDays} días.`}
              />
              <Pager result={inactiveResult} page={inactivePage} setPage={setInactivePage} />
              <p className="direction-attendance-caption">{inactiveResult.total} clientes · información al {dateLabel(inactiveResult.asOf)}</p>
            </>
          )}
        </>
      )}

      {view === 'records' && (
        <>
          <form className="direction-attendance-search" onSubmit={submitRecordSearch}>
            <label>Buscar por cliente o identificador
              <input
                value={recordSearchDraft}
                onChange={(event) => setRecordSearchDraft(event.target.value)}
                maxLength={100}
              />
            </label>
            <label>Desde
              <input
                type="date"
                value={rangeDraft.from}
                onChange={(event) => {
                  setPeriodMode('custom');
                  setRangeDraft({ ...rangeDraft, from: event.target.value });
                }}
              />
            </label>
            <label>Hasta
              <input
                type="date"
                value={rangeDraft.to}
                onChange={(event) => {
                  setPeriodMode('custom');
                  setRangeDraft({ ...rangeDraft, to: event.target.value });
                }}
              />
            </label>
            <button type="submit">Buscar</button>
          </form>
          <form className="direction-attendance-range-submit" onSubmit={applyRange}>
            <button type="submit">Aplicar fechas</button>
          </form>
          {rangeNotice && <p className="direction-attendance-message error" role="alert">{rangeNotice}</p>}
          {records.loading && <p className="direction-attendance-message" role="status">Cargando registros…</p>}
          {!records.loading && records.error && <p className="direction-attendance-message error" role="alert">{records.error}</p>}
          {!records.loading && !records.error && recordResult && (
            <>
              <ReadOnlyTable
                columns={[
                  { label: 'Fecha', render: (row) => dateLabel(row.attendance_date) },
                  { label: 'Hora', render: (row) => timeLabel(row.entry_time) },
                  { label: 'Cliente', key: 'customer_name' },
                  { label: 'Identificador', key: 'id_customer' },
                  { label: 'Registro', key: 'id_attendance' },
                ]}
                rows={recordResult.data}
                emptyMessage="No hay asistencias registradas para los filtros seleccionados."
              />
              <Pager result={recordResult} page={recordPage} setPage={setRecordPage} />
            </>
          )}
        </>
      )}
    </section>
  );
}
