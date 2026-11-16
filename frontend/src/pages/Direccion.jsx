import { useCallback, useEffect, useMemo, useState } from 'react';
import Sidebar from '../components/Sidebar';
import { erpRequest } from '../config/erpApi';
import DireccionConsultas from './DireccionConsultas';
import './Direccion.css';

const MONEY = new Intl.NumberFormat('es-BO', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const STATUS_COLORS = {
  ACTIVE: '#42c985',
  EXPIRED: '#f05a72',
  PENDING: '#f0b44d',
  CANCELLED: '#777782',
  SCHEDULED: '#6aa7ff',
};

function formatMoney(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? `Bs ${MONEY.format(amount)}` : '—';
}

function formatDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return '';
  return `${value.slice(8, 10)}/${value.slice(5, 7)}`;
}

function MetricCard({ label, value, note, accent = 'red' }) {
  return (
    <article className={`direction-metric ${accent}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </article>
  );
}

function Section({ title, children, className = '' }) {
  return (
    <section className={`direction-section ${className}`}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function FinanceChart({ rows }) {
  if (!rows.length) return <p className="direction-empty">No hay movimientos financieros en el mes.</p>;

  const width = 760;
  const height = 250;
  const padding = { top: 16, right: 12, bottom: 34, left: 48 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const max = Math.max(1, ...rows.flatMap((row) => [row.income, row.expenses]));
  const step = plotWidth / rows.length;
  const barWidth = Math.max(2, Math.min(13, step * 0.32));
  const valueY = (value) => padding.top + plotHeight - (value / max) * plotHeight;
  const tickRows = [0, 0.5, 1];

  return (
    <div className="direction-chart-scroll">
      <svg className="direction-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Ingresos y gastos diarios del mes">
        {tickRows.map((fraction) => {
          const y = padding.top + plotHeight * fraction;
          return (
            <g key={fraction}>
              <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} className="direction-gridline" />
              <text x={padding.left - 7} y={y + 4} textAnchor="end" className="direction-axis-label">
                {fraction === 0 ? '0' : MONEY.format(max * (1 - fraction))}
              </text>
            </g>
          );
        })}
        {rows.map((row, index) => {
          const center = padding.left + index * step + step / 2;
          const incomeY = valueY(row.income);
          const expenseY = valueY(row.expenses);
          return (
            <g key={row.date}>
              <rect x={center - barWidth - 1} y={incomeY} width={barWidth} height={Math.max(1, padding.top + plotHeight - incomeY)} rx="2" className="direction-bar-income">
                <title>{`${row.date}: ingresos ${formatMoney(row.income)}`}</title>
              </rect>
              <rect x={center + 1} y={expenseY} width={barWidth} height={Math.max(1, padding.top + plotHeight - expenseY)} rx="2" className="direction-bar-expense">
                <title>{`${row.date}: gastos ${formatMoney(row.expenses)}`}</title>
              </rect>
              {(index === 0 || index === rows.length - 1 || index % Math.ceil(rows.length / 6) === 0) && (
                <text x={center} y={height - 10} textAnchor="middle" className="direction-axis-label">
                  {formatDay(row.date)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function MembershipChart({ rows }) {
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  if (!total) return <p className="direction-empty">No hay membresías para mostrar.</p>;

  const radius = 70;
  const circumference = 2 * Math.PI * radius;
  const visibleRows = rows.filter((row) => row.total > 0);
  const segments = visibleRows.map((row, index) => ({
    ...row,
    length: (row.total / total) * circumference,
    offset: visibleRows
      .slice(0, index)
      .reduce((sum, previous) => sum + (previous.total / total) * circumference, 0),
  }));
  const labels = {
    ACTIVE: 'Activas',
    EXPIRED: 'Vencidas',
    PENDING: 'Pendientes',
    CANCELLED: 'Canceladas',
    SCHEDULED: 'Programadas',
  };

  return (
    <div className="direction-membership-chart">
      <svg viewBox="0 0 190 190" role="img" aria-label="Membresías por estado">
        <circle cx="95" cy="95" r={radius} className="direction-donut-base" />
        {segments.map((row) => (
          <circle
            key={row.status}
            cx="95"
            cy="95"
            r={radius}
            fill="none"
            stroke={STATUS_COLORS[row.status] || '#a3a3ad'}
            strokeWidth="22"
            strokeDasharray={`${row.length} ${circumference - row.length}`}
            strokeDashoffset={-row.offset}
            transform="rotate(-90 95 95)"
          />
        ))}
        <text x="95" y="91" textAnchor="middle" className="direction-donut-total">{total}</text>
        <text x="95" y="111" textAnchor="middle" className="direction-donut-caption">membresías</text>
      </svg>
      <ul className="direction-legend">
        {rows.map((row) => (
          <li key={row.status}>
            <span className="direction-legend-dot" style={{ backgroundColor: STATUS_COLORS[row.status] || '#a3a3ad' }} />
            <span>{labels[row.status] || row.status}</span>
            <strong>{row.total}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AttendanceChart({ rows }) {
  if (!rows.length) return <p className="direction-empty">No hay asistencias por horario este mes.</p>;
  const width = 760;
  const height = 230;
  const padding = { top: 14, right: 12, bottom: 35, left: 34 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const max = Math.max(1, ...rows.map((row) => row.total));
  const step = plotWidth / rows.length;
  const barWidth = Math.max(4, Math.min(28, step * 0.64));

  return (
    <div className="direction-chart-scroll">
      <svg className="direction-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Asistencias agrupadas por hora durante el mes">
        <line x1={padding.left} x2={width - padding.right} y1={padding.top + plotHeight} y2={padding.top + plotHeight} className="direction-gridline" />
        {rows.map((row, index) => {
          const barHeight = (row.total / max) * plotHeight;
          const x = padding.left + index * step + (step - barWidth) / 2;
          const y = padding.top + plotHeight - barHeight;
          return (
            <g key={row.hour}>
              <rect x={x} y={y} width={barWidth} height={Math.max(1, barHeight)} rx="3" className="direction-bar-attendance">
                <title>{`${String(row.hour).padStart(2, '0')}:00 — ${row.total} asistencias`}</title>
              </rect>
              <text x={x + barWidth / 2} y={height - 10} textAnchor="middle" className="direction-axis-label">
                {String(row.hour).padStart(2, '0')}h
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function Direccion() {
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeView, setActiveView] = useState('dashboard');

  const loadDashboard = useCallback(async (signal) => {
    try {
      const data = await erpRequest('/api/erp/direction/dashboard', { signal });
      setDashboard(data);
    } catch (requestError) {
      if (requestError?.name !== 'AbortError' && requestError?.code !== 'REQUEST_CANCELLED') {
        setError(requestError?.message || 'No se pudo cargar el panel de Dirección.');
      }
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    Promise.resolve().then(() => loadDashboard(controller.signal));
    return () => controller.abort();
  }, [loadDashboard, refreshKey]);

  const hasAnyData = useMemo(() => {
    if (!dashboard) return false;
    const values = [
      ...Object.values(dashboard.customers || {}),
      ...Object.values(dashboard.memberships || {}),
      ...Object.values(dashboard.attendance || {}).filter((value) => typeof value === 'number'),
      dashboard.finances?.incomeToday,
      dashboard.finances?.incomeThisMonth,
      dashboard.finances?.expensesThisMonth,
      dashboard.finances?.validPayments,
      dashboard.finances?.cancelledPayments,
    ];
    return values.some((value) => Number(value) > 0) ||
      dashboard.charts?.finance?.length > 0 ||
      dashboard.charts?.memberships?.length > 0 ||
      dashboard.charts?.attendance?.length > 0;
  }, [dashboard]);

  const topHour = dashboard?.attendance?.peakHour;

  return (
    <div className="direction-page">
      <Sidebar />
      <main className="direction-main">
        <header className="direction-header">
          <div>
            <span className="direction-kicker">GIMNASIO MQS · DIRECCIÓN</span>
            <h1>Panel de Dirección – Gimnasio MQS</h1>
            <p>Indicadores operativos y financieros basados en los registros del sistema.</p>
          </div>
          <button
            type="button"
            className="direction-refresh"
            onClick={() => {
              setLoading(true);
              setError('');
              setRefreshKey((key) => key + 1);
            }}
            disabled={loading}
          >
            {loading ? 'Actualizando…' : 'Actualizar'}
          </button>
        </header>

        <nav className="direction-tabs" aria-label="Secciones de Dirección">
          {[
            ['dashboard', 'Dashboard'],
            ['customers', 'Clientes y membresías'],
            ['plans', 'Planes'],
            ['expiring', 'Próximos vencimientos'],
            ['renewals', 'Renovaciones'],
          ].map(([view, label]) => (
            <button
              key={view}
              type="button"
              className={activeView === view ? 'active' : ''}
              aria-current={activeView === view ? 'page' : undefined}
              onClick={() => setActiveView(view)}
            >
              {label}
            </button>
          ))}
        </nav>

        {activeView !== 'dashboard' && (
          <DireccionConsultas view={activeView} refreshKey={refreshKey} />
        )}

        {activeView === 'dashboard' && (
          <>
        {loading && <div className="direction-notice" role="status">Cargando indicadores desde MySQL…</div>}
        {!loading && error && (
          <div className="direction-notice error" role="alert">
            <strong>No fue posible cargar el dashboard.</strong>
            <span>{error}</span>
          </div>
        )}
        {!loading && dashboard && !hasAnyData && (
          <div className="direction-notice" role="status">
            No hay datos registrados para los periodos consultados. Los indicadores reflejan los valores reales de la base de datos.
          </div>
        )}

        {dashboard && (
          <>
            <div className="direction-period">
              Periodo: mes iniciado el {dashboard.period.monthStart} · datos hasta {dashboard.period.today}
            </div>

            <Section title="Clientes">
              <div className="direction-metric-grid">
                <MetricCard label="Total registrados" value={dashboard.customers.total} />
                <MetricCard label="Activos" value={dashboard.customers.active} accent="green" />
                <MetricCard label="Inactivos" value={dashboard.customers.inactive} accent="muted" />
                <MetricCard label="Nuevos este mes" value={dashboard.customers.newThisMonth} accent="blue" />
              </div>
            </Section>

            <Section title="Membresías">
              <div className="direction-metric-grid">
                <MetricCard label="Activas y vigentes" value={dashboard.memberships.active} accent="green" />
                <MetricCard label="Vencidas" value={dashboard.memberships.expired} accent="red" />
                <MetricCard label={`Próximas a vencer · ${dashboard.period.expiringDays} días`} value={dashboard.memberships.expiring} accent="amber" />
                <MetricCard label="Pendientes de pago" value={dashboard.memberships.pending} accent="blue" />
                <MetricCard label="Renovaciones este mes" value={dashboard.memberships.renewedThisMonth} />
              </div>
            </Section>

            <Section title="Finanzas">
              <div className="direction-metric-grid">
                <MetricCard label="Ingresos del día" value={formatMoney(dashboard.finances.incomeToday)} accent="green" />
                <MetricCard label="Ingresos del mes" value={formatMoney(dashboard.finances.incomeThisMonth)} accent="green" />
                <MetricCard label="Gastos del mes" value={formatMoney(dashboard.finances.expensesThisMonth)} accent="red" />
                <MetricCard label="Saldo neto del mes" value={formatMoney(dashboard.finances.netThisMonth)} accent="blue" />
                <MetricCard label="Pagos válidos este mes" value={dashboard.finances.validPayments} accent="green" />
                <MetricCard label="Pagos anulados este mes" value={dashboard.finances.cancelledPayments} accent="muted" />
              </div>
            </Section>

            <Section title="Asistencia">
              <div className="direction-metric-grid">
                <MetricCard label="Asistencias de hoy" value={dashboard.attendance.today} accent="blue" />
                <MetricCard label="Asistencias del mes" value={dashboard.attendance.thisMonth} accent="blue" />
                <MetricCard
                  label="Horario de mayor concurrencia"
                  value={topHour ? `${String(topHour.start).padStart(2, '0')}:00–${String(topHour.start + 1).padStart(2, '0')}:00` : 'Sin datos'}
                  note={topHour ? `${topHour.total} asistencias en ese horario este mes` : ''}
                  accent="amber"
                />
              </div>
            </Section>

            <div className="direction-chart-grid">
              <Section title="Ingresos y gastos diarios" className="direction-chart-panel">
                <div className="direction-chart-legend">
                  <span><i className="income" /> Ingresos</span>
                  <span><i className="expense" /> Gastos</span>
                </div>
                <FinanceChart rows={dashboard.charts.finance} />
              </Section>
              <Section title="Membresías por estado" className="direction-chart-panel">
                <MembershipChart rows={dashboard.charts.memberships} />
              </Section>
              <Section title="Asistencia por horario" className="direction-chart-panel direction-chart-wide">
                <AttendanceChart rows={dashboard.charts.attendance} />
              </Section>
            </div>
          </>
        )}
          </>
        )}
      </main>
    </div>
  );
}

export default Direccion;
