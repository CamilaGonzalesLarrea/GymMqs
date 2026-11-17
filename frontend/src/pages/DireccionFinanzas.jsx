import { useEffect, useState } from 'react';
import { erpRequest } from '../config/erpApi';
import './DireccionFinanzas.css';

const ROOT = '/api/erp/direction/finance';
const PAGE_SIZE = 15;

const MOVEMENT_LABELS = {
  PAYMENT_IN: 'Pago de membresía',
  PAYMENT_REVERSAL: 'Reversión de pago',
  OTHER_IN: 'Otro ingreso',
  EXPENSE_OUT: 'Gasto',
};

const DIFFERENCE_LABELS = {
  BALANCED: 'Sin diferencia',
  SHORTAGE: 'Faltante',
  SURPLUS: 'Sobrante',
  WITHOUT_COUNT: 'Sin conteo',
};

const PAYMENT_STATUS_LABELS = {
  REGISTERED: 'Registrado',
  CANCELLED: 'Anulado',
};

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

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
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
  if (value === null || value === undefined || value === '') return '—';
  const amount = Number(value);
  return Number.isFinite(amount)
    ? `Bs ${new Intl.NumberFormat('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)}`
    : '—';
}

function useFinanceRead(path, params, enabled, refreshKey) {
  const serializedParams = JSON.stringify(params);
  const requestKey = JSON.stringify([path, serializedParams, refreshKey]);
  const [response, setResponse] = useState(null);

  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    erpRequest(path, { params: JSON.parse(serializedParams), signal: controller.signal })
      .then((data) => setResponse({ requestKey, data, error: '', complete: true }))
      .catch((error) => {
        if (error?.name !== 'AbortError' && error?.code !== 'REQUEST_CANCELLED') {
          setResponse({
            requestKey,
            data: null,
            error: error?.message || 'No se pudo consultar la información financiera.',
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

function FinanceMetric({ label, value, accent = '' }) {
  return (
    <article className={`direction-finance-metric ${accent}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function FinanceTable({ columns, rows, emptyMessage }) {
  if (!rows.length) return <p className="direction-finance-empty">{emptyMessage}</p>;
  return (
    <div className="direction-finance-table-scroll">
      <table className="direction-finance-table">
        <thead><tr>{columns.map((column) => <th key={column.label}>{column.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id_payment ?? row.id_cash_movement ?? row.id_cash_closure ?? row.id_cancellation}>
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

function Pagination({ result, page, setPage }) {
  if (!result || result.totalPages <= 1) return null;
  return (
    <div className="direction-finance-pagination">
      <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</button>
      <span>Página {page} de {result.totalPages} · {result.total} registros</span>
      <button type="button" disabled={page >= result.totalPages} onClick={() => setPage(page + 1)}>Siguiente</button>
    </div>
  );
}

function FinanceDetail({ title, data, onClose }) {
  if (!data) return null;
  const ignored = new Set(['password', 'password_hash', 'token', 'secret']);
  return (
    <div className="direction-finance-overlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="direction-finance-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="direction-finance-dialog-heading">
          <h3>{title}</h3>
          <button type="button" onClick={onClose}>Cerrar</button>
        </div>
        <dl>
          {Object.entries(data).filter(([key, value]) => (
            !ignored.has(key.toLowerCase()) && value !== null && typeof value !== 'object'
          )).map(([key, value]) => (
            <div key={key}>
              <dt>{key.replaceAll('_', ' ')}</dt>
              <dd>{key.toLowerCase().includes('amount') || key.toLowerCase().includes('cash') ||
                key.toLowerCase().includes('income') || key.toLowerCase().includes('expenses') ||
                key.toLowerCase().includes('reversals') || key.toLowerCase().includes('expected')
                ? money(value) : String(value)}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

function FinanceFilters({
  tab, draft, setDraft, onApply, onClear, methods,
}) {
  const hasSearch = ['payments', 'cancellations', 'entries', 'movements'].includes(tab);
  return (
    <form className="direction-finance-filter-grid" onSubmit={onApply}>
      {hasSearch && (
        <label>Buscar cliente o referencia
          <input value={draft.search} maxLength={100} onChange={(event) => setDraft({ ...draft, search: event.target.value })} />
        </label>
      )}
      {tab === 'payments' && (
        <label>Estado del pago
          <select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}>
            <option value="">Todos</option>
            <option value="REGISTERED">Registrado</option>
            <option value="CANCELLED">Anulado</option>
          </select>
        </label>
      )}
      {tab === 'entries' && (
        <label>Tipo
          <select value={draft.group} onChange={(event) => setDraft({ ...draft, group: event.target.value })}>
            <option value="all">Ingresos y gastos</option>
            <option value="income">Ingresos</option>
            <option value="expense">Gastos</option>
          </select>
        </label>
      )}
      {tab === 'movements' && (
        <label>Tipo de movimiento
          <select value={draft.movement_kind} onChange={(event) => setDraft({ ...draft, movement_kind: event.target.value })}>
            <option value="">Todos</option>
            {Object.entries(MOVEMENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      )}
      {['entries', 'movements'].includes(tab) && methods.length > 0 && (
        <label>Método de pago
          <select value={draft.id_payment_method} onChange={(event) => setDraft({ ...draft, id_payment_method: event.target.value })}>
            <option value="">Todos</option>
            {methods.map((method) => (
              <option key={method.id_payment_method} value={method.id_payment_method}>{method.payment_method}</option>
            ))}
          </select>
        </label>
      )}
      {['closures', 'differences'].includes(tab) && (
        <label>Diferencia
          <select value={draft.difference} onChange={(event) => setDraft({ ...draft, difference: event.target.value })}>
            <option value="all">Todos los cierres</option>
            <option value="without_difference">Sin diferencia</option>
            <option value="shortage">Faltante</option>
            <option value="surplus">Sobrante</option>
            <option value="without_count">Sin conteo</option>
          </select>
        </label>
      )}
      {hasSearch && (
        <div className="direction-finance-filter-actions">
          <button type="submit">Aplicar filtros</button>
          <button type="button" className="secondary" onClick={onClear}>Limpiar</button>
        </div>
      )}
      {!hasSearch && ['closures', 'differences'].includes(tab) && (
        <button type="submit">Aplicar filtros</button>
      )}
    </form>
  );
}

function DetailTarget({ target, refreshKey, onClose }) {
  const { data, loading, error } = useFinanceRead(
    target?.path || `${ROOT}/summary`,
    {},
    Boolean(target),
    refreshKey,
  );
  if (!target) return null;
  if (loading) {
    return <div className="direction-finance-overlay"><p role="status">Cargando detalle…</p></div>;
  }
  if (error) {
    return (
      <div className="direction-finance-overlay">
        <section className="direction-finance-dialog" role="alert">
          <p>{error}</p><button type="button" onClick={onClose}>Cerrar</button>
        </section>
      </div>
    );
  }
  return <FinanceDetail title={target.title} data={data} onClose={onClose} />;
}

export default function DireccionFinanzas({ refreshKey: externalRefresh = 0 }) {
  const today = boliviaToday();
  const currentMonth = `${today.slice(0, 7)}-01`;
  const [tab, setTab] = useState('summary');
  const [rangeDraft, setRangeDraft] = useState({ from: currentMonth, to: today });
  const [range, setRange] = useState({ from: currentMonth, to: today });
  const [filterDraft, setFilterDraft] = useState({
    search: '', status: '', group: 'all', movement_kind: '',
    id_payment_method: '', difference: 'all',
  });
  const [filters, setFilters] = useState({ ...filterDraft });
  const [page, setPage] = useState(1);
  const [localRefresh, setLocalRefresh] = useState(0);
  const [notice, setNotice] = useState('');
  const [detailTarget, setDetailTarget] = useState(null);

  const refresh = `${externalRefresh}:${localRefresh}`;
  const dataPath = {
    summary: `${ROOT}/summary`,
    payments: `${ROOT}/payments`,
    cancellations: `${ROOT}/cancellations`,
    entries: `${ROOT}/entries`,
    movements: `${ROOT}/movements`,
    methods: `${ROOT}/payment-methods`,
    closures: `${ROOT}/closures`,
    differences: `${ROOT}/closures`,
  }[tab];
  const dataParams = tab === 'summary' || tab === 'methods'
    ? { ...range }
    : tab === 'payments'
      ? { ...range, page, limit: PAGE_SIZE, search: filters.search, status: filters.status }
      : tab === 'cancellations'
        ? { ...range, page, limit: PAGE_SIZE, search: filters.search }
        : tab === 'entries'
          ? {
            ...range, page, limit: PAGE_SIZE, search: filters.search,
            group: filters.group, id_payment_method: filters.id_payment_method,
          }
          : tab === 'movements'
            ? {
              ...range, page, limit: PAGE_SIZE, search: filters.search,
              movement_kind: filters.movement_kind, id_payment_method: filters.id_payment_method,
            }
            : { ...range, page, limit: PAGE_SIZE, difference: filters.difference };
  const { data, loading, error } = useFinanceRead(dataPath, dataParams, true, refresh);
  const { data: methodsData } = useFinanceRead(
    `${ROOT}/payment-methods`,
    range,
    true,
    refresh,
  );
  const methodRows = tab === 'methods'
    ? (data?.data || []).filter((row) => Number(row.payment_count) > 0) : [];
  const methodOptions = methodsData?.data || [];
  const listResult = data && Array.isArray(data.data) ? data : null;
  const rows = listResult?.data || [];

  function applyRange(event) {
    event.preventDefault();
    if (!validDate(rangeDraft.from) || !validDate(rangeDraft.to) || rangeDraft.from > rangeDraft.to) {
      setNotice('Selecciona un rango de fechas válido.');
      return;
    }
    const dayCount = (Date.parse(`${rangeDraft.to}T00:00:00Z`) - Date.parse(`${rangeDraft.from}T00:00:00Z`)) / 86400000;
    if (dayCount >= 366) {
      setNotice('El período máximo permitido es de 366 días.');
      return;
    }
    setNotice('');
    setRange({ ...rangeDraft });
    setPage(1);
  }

  function applyFilters(event) {
    event.preventDefault();
    setFilters({ ...filterDraft });
    setPage(1);
  }

  function clearFilters() {
    const cleared = { ...filterDraft, search: '', status: '', movement_kind: '', id_payment_method: '' };
    setFilterDraft(cleared);
    setFilters(cleared);
    setPage(1);
  }

  const summary = data?.totals;
  const columns = tab === 'payments' ? [
    { label: 'Pago', render: (row) => <button type="button" className="direction-finance-link" onClick={() => setDetailTarget({ path: `${ROOT}/payments/${row.id_payment}`, title: `Pago #${row.id_payment}` })}>#{row.id_payment}</button> },
    { label: 'Cliente / concepto', render: (row) => <>{row.customer_name}<small>{row.plan_name}</small></> },
    { label: 'Fecha', render: (row) => dateTimeLabel(row.payment_date) },
    { label: 'Importe', render: (row) => money(row.amount) },
    { label: 'Método', key: 'payment_method' },
    { label: 'Estado', render: (row) => PAYMENT_STATUS_LABELS[row.status] || row.status },
  ] : tab === 'cancellations' ? [
    { label: 'Pago', render: (row) => `#${row.id_payment}` },
    { label: 'Cliente', key: 'customer_name' },
    { label: 'Importe original', render: (row) => money(row.original_amount) },
    { label: 'Fecha del pago', render: (row) => dateTimeLabel(row.payment_date) },
    { label: 'Fecha de anulación', render: (row) => dateTimeLabel(row.cancelled_at) },
    { label: 'Motivo', key: 'reason' },
    { label: 'Usuario', key: 'cancelled_by' },
  ] : tab === 'entries' ? [
    { label: 'Fecha', render: (row) => dateLabel(row.business_date) },
    { label: 'Concepto', render: (row) => row.description || row.notes || '—' },
    { label: 'Categoría', key: 'category' },
    { label: 'Importe', render: (row) => money(row.amount) },
    { label: 'Método', key: 'payment_method' },
    { label: 'Referencia', render: (row) => row.id_payment ? `Pago #${row.id_payment}` : row.id_financial_entry ? `Registro #${row.id_financial_entry}` : `Movimiento #${row.id_cash_movement}` },
    { label: 'Estado del pago', render: (row) => row.payment_status === 'CANCELLED' ? 'Anulado / revertido' : PAYMENT_STATUS_LABELS[row.payment_status] || 'Registrado' },
  ] : tab === 'movements' ? [
    { label: 'Fecha', render: (row) => dateLabel(row.business_date) },
    { label: 'Tipo', render: (row) => MOVEMENT_LABELS[row.movement_kind] || row.movement_kind },
    { label: 'Concepto', render: (row) => row.description || row.notes || '—' },
    { label: 'Importe', render: (row) => money(row.amount) },
    { label: 'Método', key: 'payment_method' },
    { label: 'Referencia', render: (row) => row.id_payment ? `Pago #${row.id_payment}` : row.id_financial_entry ? `Registro #${row.id_financial_entry}` : '—' },
    { label: 'Responsable', key: 'registered_by_name' },
    { label: 'Detalle', render: (row) => <button type="button" className="direction-finance-link" onClick={() => setDetailTarget({ path: `${ROOT}/movements/${row.id_cash_movement}`, title: `Movimiento #${row.id_cash_movement}` })}>Ver</button> },
  ] : [
    { label: 'Cierre', render: (row) => <button type="button" className="direction-finance-link" onClick={() => setDetailTarget({ path: `${ROOT}/closures/${row.id_cash_closure}`, title: `Cierre #${row.id_cash_closure}` })}>#{row.id_cash_closure}</button> },
    { label: 'Fecha', render: (row) => dateLabel(row.business_date) },
    { label: 'Responsable', key: 'closed_by_name' },
    { label: 'Saldo inicial', render: (row) => money(row.opening_cash) },
    { label: 'Ingresos', render: (row) => money(row.total_income) },
    { label: 'Gastos', render: (row) => money(row.total_expenses) },
    { label: 'Reversiones', render: (row) => money(row.total_reversals) },
    { label: 'Esperado', render: (row) => money(row.expected_cash) },
    { label: 'Contado', render: (row) => money(row.counted_cash) },
    { label: 'Diferencia', render: (row) => money(row.difference_cash) },
    { label: 'Clasificación', render: (row) => DIFFERENCE_LABELS[row.difference_status] || '—' },
  ];

  return (
    <section className="direction-finance">
      <header className="direction-finance-heading">
        <div>
          <span className="direction-finance-kicker">DIRECCIÓN · CONSULTA DE SOLO LECTURA</span>
          <h2>Pagos, Finanzas y Caja</h2>
          <p>Consultas financieras basadas en los movimientos y registros de MySQL.</p>
        </div>
        <button type="button" onClick={() => setLocalRefresh((value) => value + 1)} disabled={loading}>
          {loading ? 'Actualizando…' : 'Actualizar'}
        </button>
      </header>

      <form className="direction-finance-period" onSubmit={applyRange}>
        <label>Desde<input type="date" value={rangeDraft.from} onChange={(event) => setRangeDraft({ ...rangeDraft, from: event.target.value })} /></label>
        <label>Hasta<input type="date" value={rangeDraft.to} onChange={(event) => setRangeDraft({ ...rangeDraft, to: event.target.value })} /></label>
        <button type="submit">Consultar período</button>
      </form>
      {notice && <p className="direction-finance-message error" role="alert">{notice}</p>}

      <nav className="direction-finance-tabs" aria-label="Consultas de Pagos, Finanzas y Caja">
        {[
          ['summary', 'Resumen'],
          ['payments', 'Pagos'],
          ['cancellations', 'Anulaciones'],
          ['entries', 'Ingresos y gastos'],
          ['movements', 'Movimientos'],
          ['methods', 'Métodos de pago'],
          ['closures', 'Cierres de caja'],
          ['differences', 'Diferencias'],
        ].map(([key, label]) => (
          <button key={key} type="button" aria-selected={tab === key}
            className={tab === key ? 'active' : ''} onClick={() => { setTab(key); setPage(1); }}>
            {label}
          </button>
        ))}
      </nav>

      {!['summary', 'methods'].includes(tab) && (
        <FinanceFilters
          tab={tab}
          draft={filterDraft}
          setDraft={setFilterDraft}
          onApply={applyFilters}
          onClear={clearFilters}
          methods={methodOptions}
        />
      )}

      {loading && <p className="direction-finance-message" role="status">Cargando información financiera…</p>}
      {!loading && error && <p className="direction-finance-message error" role="alert">{error}</p>}

      {!loading && !error && tab === 'summary' && summary && (
        <>
          <p className="direction-finance-period-label">Período: {dateLabel(data.from)} – {dateLabel(data.to)}</p>
          <div className="direction-finance-metrics">
            <FinanceMetric label="Ingresos" value={money(summary.income)} accent="green" />
            <FinanceMetric label="Gastos" value={money(summary.expenses)} accent="red" />
            <FinanceMetric label="Reversiones" value={money(summary.reversals)} accent="amber" />
            <FinanceMetric label="Saldo neto" value={money(summary.net)} accent="blue" />
            <FinanceMetric label="Pagos válidos" value={summary.validPayments} accent="green" />
            <FinanceMetric label="Pagos anulados" value={summary.cancelledPayments} />
            <FinanceMetric label="Movimientos" value={summary.movements} />
            <FinanceMetric label="Cierres de caja" value={summary.closures} />
          </div>
          <p className="direction-finance-note">
            El saldo neto conserva la fórmula del Dashboard: ingresos − gastos − reversiones.
            Ingresos y gastos se consultan desde movimientos de caja; los registros financieros relacionados no se vuelven a sumar.
          </p>
        </>
      )}

      {!loading && !error && tab === 'methods' && (
        <>
          <p className="direction-finance-period-label">Pagos vigentes del período: {dateLabel(data.from)} – {dateLabel(data.to)}</p>
          {methodRows.length ? (
            <div className="direction-method-list">
              {methodRows.map((row) => {
                const maxAmount = Math.max(1, ...methodRows.map((method) => Number(method.total_amount) || 0));
                const percent = Math.max(0, Number(row.total_amount) / maxAmount * 100);
                return (
                  <article key={row.id_payment_method} className="direction-method-row">
                    <div><strong>{row.payment_method}</strong><span>{row.payment_count} pagos · {money(row.total_amount)}</span></div>
                    <div className="direction-method-track" aria-label={`${row.payment_method}: ${percent.toFixed(0)}%`}>
                      <span style={{ width: `${percent}%` }} />
                    </div>
                  </article>
                );
              })}
            </div>
          ) : <p className="direction-finance-empty">No hay pagos válidos por método en este período.</p>}
          <p className="direction-finance-note">Los pagos anulados se excluyen de este resumen por método.</p>
        </>
      )}

      {!loading && !error && ['payments', 'cancellations', 'entries', 'movements', 'closures', 'differences'].includes(tab) && (
        <section className="direction-finance-panel">
          {tab === 'entries' && filters.group === 'income' && (
            <p className="direction-finance-note">Los cobros anulados se identifican y sus reversiones se descuentan del saldo neto.</p>
          )}
          <FinanceTable
            columns={columns}
            rows={rows}
            emptyMessage={tab === 'payments' ? 'No hay pagos para los filtros seleccionados.'
              : tab === 'cancellations' ? 'No hay anulaciones registradas para este período.'
                : tab === 'entries' ? 'No hay ingresos o gastos para los filtros seleccionados.'
                  : tab === 'movements' ? 'No hay movimientos para los filtros seleccionados.'
                    : tab === 'differences' ? 'No hay cierres con los filtros de diferencia seleccionados.'
                      : 'No hay cierres de caja para este período.'}
          />
          <Pagination result={listResult} page={page} setPage={setPage} />
        </section>
      )}

      <DetailTarget
        target={detailTarget}
        refreshKey={refresh}
        onClose={() => setDetailTarget(null)}
      />
    </section>
  );
}
