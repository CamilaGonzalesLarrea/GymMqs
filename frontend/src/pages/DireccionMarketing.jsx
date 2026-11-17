import { useCallback, useEffect, useMemo, useState } from 'react';
import { erpRequest } from '../config/erpApi';
import './DireccionMarketing.css';

const MONEY = new Intl.NumberFormat('es-BO', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const PAGE_SIZE = 10;

const labels = {
  ACTIVE: 'Vigente',
  INACTIVE: 'Desactivada',
  UPCOMING: 'Próxima',
  EXPIRED: 'Vencida',
  REQUESTED: 'Solicitada',
  COMPLETED: 'Completada',
  REJECTED: 'Rechazada',
  CANCELLED: 'Cancelada',
  EXPIRING: 'Por vencer',
  EXPIRED_ALERT: 'Vencida',
  LOW_ATTENDANCE: 'Baja asistencia',
  PENDING: 'Pendiente',
  CONTACTED: 'Contactada',
  DISMISSED: 'Descartada',
  RENEWAL_ACCEPTED: 'Aceptó renovar',
  DECLINED: 'Rechazó',
  NO_RESPONSE: 'Sin respuesta',
  OTHER: 'Otro',
  PHONE: 'Teléfono',
  WHATSAPP: 'WhatsApp',
  EMAIL: 'Correo',
  IN_PERSON: 'Presencial',
};

function label(value) {
  return labels[value] || value || '—';
}

function money(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? `Bs ${MONEY.format(amount)}` : '—';
}

function businessPeriod() {
  const today = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

function Metric({ title, value, note, accent = '' }) {
  return (
    <article className={`direction-marketing-metric ${accent}`}>
      <span>{title}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </article>
  );
}

function Empty({ children }) {
  return <p className="direction-marketing-empty">{children}</p>;
}

function PageControls({ data, onChange }) {
  if (!data || data.total <= data.limit) return null;
  const pages = Math.ceil(data.total / data.limit);
  return (
    <div className="direction-marketing-pages">
      <span>Página {data.page} de {pages} · {data.total} registros</span>
      <div>
        <button type="button" disabled={data.page <= 1} onClick={() => onChange(data.page - 1)}>Anterior</button>
        <button type="button" disabled={data.page >= pages} onClick={() => onChange(data.page + 1)}>Siguiente</button>
      </div>
    </div>
  );
}

function DailyChart({ rows }) {
  const data = useMemo(() => {
    const dates = new Map();
    rows.forEach((row) => {
      const current = dates.get(row.date) || { date: row.date, sales: 0, collected: 0 };
      current[row.type] = row.amount;
      dates.set(row.date, current);
    });
    return [...dates.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [rows]);

  if (!data.length) return <Empty>No hay membresías ni cobros registrados en este período.</Empty>;

  const width = 760;
  const height = 235;
  const padding = { top: 14, right: 12, bottom: 34, left: 52 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const max = Math.max(1, ...data.flatMap((row) => [row.sales, row.collected]));
  const step = plotWidth / data.length;
  const barWidth = Math.max(2, Math.min(12, step * 0.32));

  return (
    <div className="direction-marketing-chart-scroll">
      <svg className="direction-marketing-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Membresías registradas y pagos cobrados por fecha">
        {[0, 0.5, 1].map((fraction) => {
          const y = padding.top + plotHeight * fraction;
          return (
            <g key={fraction}>
              <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} className="direction-marketing-gridline" />
              <text x={padding.left - 7} y={y + 4} textAnchor="end" className="direction-marketing-axis">
                {MONEY.format(max * (1 - fraction))}
              </text>
            </g>
          );
        })}
        {data.map((row, index) => {
          const center = padding.left + index * step + step / 2;
          const salesY = padding.top + plotHeight * (1 - row.sales / max);
          const collectedY = padding.top + plotHeight * (1 - row.collected / max);
          return (
            <g key={row.date}>
              <rect x={center - barWidth - 1} y={salesY} width={barWidth} height={Math.max(1, padding.top + plotHeight - salesY)} className="direction-marketing-bar-sales">
                <title>{`${row.date}: membresías, ${money(row.sales)}`}</title>
              </rect>
              <rect x={center + 1} y={collectedY} width={barWidth} height={Math.max(1, padding.top + plotHeight - collectedY)} className="direction-marketing-bar-collected">
                <title>{`${row.date}: cobros válidos, ${money(row.collected)}`}</title>
              </rect>
              {(index === 0 || index === data.length - 1 || index % Math.ceil(data.length / 6) === 0) && (
                <text x={center} y={height - 10} textAnchor="middle" className="direction-marketing-axis">
                  {row.date.slice(8, 10)}/{row.date.slice(5, 7)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function Breakdown({ title, rows, keyName, valueName }) {
  const max = Math.max(1, ...rows.map((row) => row[valueName]));
  return (
    <section className="direction-marketing-card">
      <h3>{title}</h3>
      {rows.length ? (
        <ul className="direction-marketing-breakdown">
          {rows.map((row) => (
            <li key={row[keyName]}>
              <span>{label(row[keyName])}</span>
              <div><i style={{ width: `${Math.max(3, (row[valueName] / max) * 100)}%` }} /></div>
              <strong>{row[valueName]}</strong>
            </li>
          ))}
        </ul>
      ) : <Empty>No hay registros para mostrar.</Empty>}
    </section>
  );
}

function DireccionMarketing({ refreshKey }) {
  const initialPeriod = useMemo(() => businessPeriod(), []);
  const [period, setPeriod] = useState(initialPeriod);
  const [draft, setDraft] = useState(initialPeriod);
  const [summary, setSummary] = useState(null);
  const [promotions, setPromotions] = useState(null);
  const [renewals, setRenewals] = useState(null);
  const [alerts, setAlerts] = useState(null);
  const [followups, setFollowups] = useState(null);
  const [pages, setPages] = useState({ promotions: 1, renewals: 1, alerts: 1, followups: 1 });
  const [filters, setFilters] = useState({ promotion: '', renewal: '', alert: 'PENDING', followup: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadReports = useCallback(async (signal) => {
    setLoading(true);
    try {
      const listParams = { ...period, limit: PAGE_SIZE };
      const [nextSummary, nextPromotions, nextRenewals, nextAlerts, nextFollowups] = await Promise.all([
        erpRequest('/api/erp/direction/commercial/summary', { params: period, signal }),
        erpRequest('/api/erp/direction/commercial/promotions', {
          params: { ...listParams, page: pages.promotions, status: filters.promotion },
          signal,
        }),
        erpRequest('/api/erp/direction/commercial/renewals', {
          params: { ...listParams, page: pages.renewals, status: filters.renewal },
          signal,
        }),
        erpRequest('/api/erp/direction/commercial/alerts', {
          params: { ...period, page: pages.alerts, limit: PAGE_SIZE, status: filters.alert },
          signal,
        }),
        erpRequest('/api/erp/direction/commercial/followups', {
          params: { ...listParams, page: pages.followups, result: filters.followup },
          signal,
        }),
      ]);
      setSummary(nextSummary);
      setPromotions(nextPromotions);
      setRenewals(nextRenewals);
      setAlerts(nextAlerts);
      setFollowups(nextFollowups);
      setError('');
    } catch (requestError) {
      if (requestError?.name !== 'AbortError' && requestError?.code !== 'REQUEST_CANCELLED') {
        setError(requestError?.message || 'No se pudieron cargar los reportes comerciales.');
      }
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [filters, pages, period]);

  useEffect(() => {
    const controller = new AbortController();
    Promise.resolve().then(() => loadReports(controller.signal));
    return () => controller.abort();
  }, [loadReports, refreshKey]);

  const anyData = Boolean(
    summary && (
      summary.sales.memberships ||
      Number(summary.payments.collected) ||
      summary.promotionsUsed.length ||
      summary.renewals.byStatus.length ||
      summary.alerts.length ||
      summary.followups.length
    ),
  );

  function changePage(key, page) {
    setPages((current) => ({ ...current, [key]: page }));
  }

  function changeFilter(key, value, pageKey) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPages((current) => ({ ...current, [pageKey]: 1 }));
  }

  return (
    <section className="direction-marketing" aria-label="Seguimiento comercial">
      <div className="direction-marketing-heading">
        <div>
          <h2>Marketing y seguimiento comercial</h2>
          <p>Reportes de membresías, cobros válidos, promociones, renovaciones, alertas y seguimientos registrados.</p>
        </div>
      </div>

      <form className="direction-marketing-filters" onSubmit={(event) => {
        event.preventDefault();
        setPeriod(draft);
        setPages({ promotions: 1, renewals: 1, alerts: 1, followups: 1 });
      }}>
        <label>Desde<input type="date" required value={draft.from} onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value }))} /></label>
        <label>Hasta<input type="date" required value={draft.to} onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))} /></label>
        <button type="submit" disabled={loading}>Consultar período</button>
      </form>

      {loading && <p className="direction-marketing-notice" role="status">Cargando reportes desde MySQL…</p>}
      {!loading && error && <p className="direction-marketing-notice error" role="alert">{error}</p>}
      {!loading && summary && !anyData && (
        <p className="direction-marketing-notice" role="status">No hay registros comerciales en el período seleccionado.</p>
      )}

      {summary && (
        <>
          <p className="direction-marketing-period">Período: {summary.from} al {summary.to}. Los importes de membresías son precios registrados; los cobros válidos se muestran por separado.</p>

          <div className="direction-marketing-metrics">
            <Metric title="Membresías registradas" value={summary.sales.memberships} note="Excluye registros cancelados" />
            <Metric title="Valor registrado" value={money(summary.sales.recordedValue)} note="No equivale a dinero cobrado" accent="blue" />
            <Metric title="Pagos válidos cobrados" value={money(summary.payments.collected)} accent="green" />
            <Metric title="Pagos válidos" value={summary.payments.valid} accent="green" />
            <Metric title="Pagos anulados" value={summary.payments.cancelled} accent="muted" />
            <Metric title="Renovaciones completadas" value={summary.renewals.completed} accent="amber" />
          </div>

          <section className="direction-marketing-card direction-marketing-chart-card">
            <h3>Valor de membresías y cobros válidos por día</h3>
            <div className="direction-marketing-legend">
              <span><i className="sales" /> Valor registrado de membresías</span>
              <span><i className="collected" /> Pagos cobrados (REGISTERED)</span>
            </div>
            <DailyChart rows={summary.charts.salesAndCollections} />
          </section>

          <div className="direction-marketing-grid">
            <section className="direction-marketing-card">
              <h3>Membresías registradas por plan</h3>
              {summary.sales.byPlan.length ? (
                <div className="direction-marketing-table-wrap"><table>
                  <thead><tr><th>Plan</th><th>Membresías</th><th>Valor registrado</th></tr></thead>
                  <tbody>{summary.sales.byPlan.map((row) => (
                    <tr key={row.idPlan}><td>{row.planName}</td><td>{row.memberships}</td><td>{money(row.recordedValue)}</td></tr>
                  ))}</tbody>
                </table></div>
              ) : <Empty>Sin membresías creadas en este período.</Empty>}
            </section>
            <Breakdown title="Solicitudes de renovación por estado" rows={summary.renewals.byStatus} keyName="status" valueName="total" />
            <Breakdown title="Alertas creadas por tipo y estado" rows={summary.alerts.map((row) => ({ ...row, label: `${label(row.type)} · ${label(row.status)}` }))} keyName="label" valueName="total" />
            <Breakdown title="Resultados de seguimiento" rows={summary.followups.map((row) => ({ ...row, resultLabel: label(row.result) }))} keyName="resultLabel" valueName="total" />
          </div>

          <section className="direction-marketing-card">
            <div className="direction-marketing-section-title">
              <h3>Promociones: vigencia y uso</h3>
              <select aria-label="Filtrar promociones" value={filters.promotion} onChange={(event) => changeFilter('promotion', event.target.value, 'promotions')}>
                <option value="">Todos los estados</option><option value="ACTIVE">Vigentes</option><option value="UPCOMING">Próximas</option><option value="EXPIRED">Vencidas</option><option value="INACTIVE">Desactivadas</option>
              </select>
            </div>
            {promotions?.items.length ? (
              <div className="direction-marketing-table-wrap"><table>
                <thead><tr><th>Promoción</th><th>Plan</th><th>Estado</th><th>Vigencia</th><th>Usos</th><th>Descuentos aplicados</th></tr></thead>
                <tbody>{promotions.items.map((row) => (
                  <tr key={row.id}><td>{row.name}</td><td>{row.planName}</td><td>{label(row.status)}</td><td>{row.startDate} – {row.endDate}</td><td>{row.uses}</td><td>{money(row.discounts)}</td></tr>
                ))}</tbody>
              </table></div>
            ) : <Empty>No hay promociones para los filtros seleccionados.</Empty>}
            <PageControls data={promotions} onChange={(page) => changePage('promotions', page)} />
          </section>

          <section className="direction-marketing-card">
            <div className="direction-marketing-section-title">
              <h3>Solicitudes de renovación</h3>
              <select aria-label="Filtrar renovaciones" value={filters.renewal} onChange={(event) => changeFilter('renewal', event.target.value, 'renewals')}>
                <option value="">Todos los estados</option><option value="REQUESTED">Solicitadas</option><option value="COMPLETED">Completadas</option><option value="REJECTED">Rechazadas</option><option value="CANCELLED">Canceladas</option>
              </select>
            </div>
            {renewals?.items.length ? (
              <div className="direction-marketing-table-wrap"><table>
                <thead><tr><th>Cliente</th><th>Plan anterior</th><th>Nuevo plan</th><th>Estado</th><th>Solicitada</th><th>Completada</th></tr></thead>
                <tbody>{renewals.items.map((row) => (
                  <tr key={row.id_renewal_request}><td>{row.customer_name}</td><td>{row.previous_plan}</td><td>{row.new_plan || '—'}</td><td>{label(row.status)}</td><td>{row.requested_at}</td><td>{row.completed_at || '—'}</td></tr>
                ))}</tbody>
              </table></div>
            ) : <Empty>No hay solicitudes de renovación en este período.</Empty>}
            <PageControls data={renewals} onChange={(page) => changePage('renewals', page)} />
          </section>

          <section className="direction-marketing-card">
            <div className="direction-marketing-section-title">
              <h3>Alertas de membresía</h3>
              <select aria-label="Filtrar alertas" value={filters.alert} onChange={(event) => changeFilter('alert', event.target.value, 'alerts')}>
                <option value="">Todos los estados</option><option value="PENDING">Pendientes</option><option value="CONTACTED">Contactadas</option><option value="DISMISSED">Descartadas</option>
              </select>
            </div>
            {alerts?.items.length ? (
              <div className="direction-marketing-table-wrap"><table>
                <thead><tr><th>Cliente</th><th>Plan</th><th>Alerta</th><th>Estado</th><th>Vencimiento</th><th>Fecha de referencia</th></tr></thead>
                <tbody>{alerts.items.map((row) => (
                  <tr key={row.id_alert}><td>{row.customer_name}</td><td>{row.plan_name}</td><td>{label(row.alert_type)}</td><td>{label(row.status)}</td><td>{row.membership_end_date}</td><td>{row.reference_date}</td></tr>
                ))}</tbody>
              </table></div>
            ) : <Empty>No hay alertas para los filtros seleccionados.</Empty>}
            <PageControls data={alerts} onChange={(page) => changePage('alerts', page)} />
          </section>

          <section className="direction-marketing-card">
            <div className="direction-marketing-section-title">
              <h3>Seguimientos comerciales y resultados</h3>
              <select aria-label="Filtrar seguimientos" value={filters.followup} onChange={(event) => changeFilter('followup', event.target.value, 'followups')}>
                <option value="">Todos los resultados</option><option value="PENDING">Pendientes</option><option value="CONTACTED">Contactados</option><option value="RENEWAL_ACCEPTED">Aceptó renovar</option><option value="DECLINED">Rechazó</option><option value="NO_RESPONSE">Sin respuesta</option>
              </select>
            </div>
            {followups?.items.length ? (
              <div className="direction-marketing-table-wrap"><table>
                <thead><tr><th>Cliente</th><th>Plan</th><th>Motivo</th><th>Contacto</th><th>Resultado</th><th>Fecha</th><th>Próxima acción</th></tr></thead>
                <tbody>{followups.items.map((row) => (
                  <tr key={row.id_followup}><td>{row.customer_name}</td><td>{row.plan_name || '—'}</td><td>{label(row.reason)}</td><td>{label(row.contact_method)}</td><td>{label(row.result)}</td><td>{row.contact_date}</td><td>{row.next_action_at || '—'}</td></tr>
                ))}</tbody>
              </table></div>
            ) : <Empty>No hay seguimientos comerciales en este período.</Empty>}
            <PageControls data={followups} onChange={(page) => changePage('followups', page)} />
          </section>
        </>
      )}
    </section>
  );
}

export default DireccionMarketing;
