import { useEffect, useState } from 'react';
import { erpRequest } from '../config/erpApi';
import './DireccionConsultas.css';

const PAGE_SIZE = 10;

const MEMBERSHIP_STATUS = {
  ACTIVE: 'Activa',
  EXPIRED: 'Vencida',
  PENDING: 'Pendiente de pago',
  CANCELLED: 'Cancelada',
  SCHEDULED: 'Programada',
};

const RECORD_STATUS = {
  ACTIVE: 'Activo',
  INACTIVE: 'Inactivo',
};

const RENEWAL_STATUS = {
  REQUESTED: 'Solicitada',
  COMPLETED: 'Completada',
  REJECTED: 'Rechazada',
  CANCELLED: 'Cancelada',
};

function money(value) {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? `Bs ${new Intl.NumberFormat('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)}`
    : '—';
}

function date(value) {
  if (!value) return '—';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(value);
}

function ReadOnlyTable({ columns, rows, rowKey, emptyMessage }) {
  if (!rows.length) return <p className="direction-readonly-empty">{emptyMessage}</p>;

  return (
    <div className="direction-readonly-table-wrap">
      <table className="direction-readonly-table">
        <thead>
          <tr>{columns.map((column) => <th key={column.label}>{column.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((column) => (
                <td key={column.label}>{column.render ? column.render(row) : row[column.key] ?? '—'}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QueryState({ loading, error, children }) {
  return (
    <section className="direction-readonly-panel">
      {loading && <p className="direction-readonly-message" role="status">Cargando información desde MySQL…</p>}
      {!loading && error && <p className="direction-readonly-message error" role="alert">{error}</p>}
      {!loading && !error && children}
    </section>
  );
}

function Pager({ page, totalPages, onPageChange }) {
  if (totalPages <= 1) return null;
  return (
    <div className="direction-readonly-pager">
      <button type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>Anterior</button>
      <span>Página {page} de {totalPages}</span>
      <button type="button" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>Siguiente</button>
    </div>
  );
}

function useDirectionQuery(path, params, refreshKey) {
  const query = JSON.stringify(params);
  const requestKey = JSON.stringify([path, query, refreshKey]);
  const [response, setResponse] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    erpRequest(path, { params: JSON.parse(query), signal: controller.signal })
      .then((result) => setResponse({
        requestKey, result, error: '', complete: true,
      }))
      .catch((requestError) => {
        if (requestError?.name !== 'AbortError' && requestError?.code !== 'REQUEST_CANCELLED') {
          setResponse({
            requestKey,
            result: null,
            error: requestError?.message || 'No se pudo cargar la información solicitada.',
            complete: true,
          });
        }
      });
    return () => controller.abort();
  }, [path, query, refreshKey, requestKey]);

  const current = response?.requestKey === requestKey ? response : null;
  return {
    result: current?.result || null,
    loading: !current?.complete,
    error: current?.error || '',
  };
}

function CustomerPanel({ refreshKey }) {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState(null);
  const { result, loading, error } = useDirectionQuery(
    '/api/erp/direction/customers',
    { page, limit: PAGE_SIZE, search, filter },
    refreshKey,
  );
  const rows = result?.data || [];

  function applySearch(event) {
    event.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  }

  return (
    <>
      <section className="direction-readonly-panel">
        <div className="direction-readonly-toolbar">
          <form onSubmit={applySearch} className="direction-readonly-search">
            <label htmlFor="direction-customer-search">Buscar por nombre o código</label>
            <input id="direction-customer-search" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} maxLength={100} />
            <button type="submit">Buscar</button>
          </form>
          <label className="direction-readonly-select">
            Estado
            <select value={filter} onChange={(event) => { setFilter(event.target.value); setPage(1); }}>
              <option value="all">Todos</option>
              <option value="customer_active">Clientes activos</option>
              <option value="customer_inactive">Clientes inactivos</option>
              <option value="membership_active">Membresía vigente</option>
              <option value="membership_expired">Membresía vencida</option>
              <option value="membership_expiring">Vence en 7 días</option>
            </select>
          </label>
        </div>
        {loading && <p className="direction-readonly-message" role="status">Cargando clientes…</p>}
        {!loading && error && <p className="direction-readonly-message error" role="alert">{error}</p>}
        {!loading && !error && (
          <>
            <ReadOnlyTable
              columns={[
                { label: 'Código', key: 'id_customer' },
                { label: 'Cliente', render: (row) => <button type="button" className="direction-readonly-link" onClick={() => setSelectedId(row.id_customer)}>{row.customer_name}</button> },
                { label: 'Teléfono', key: 'phone' },
                { label: 'Estado cliente', render: (row) => RECORD_STATUS[row.customer_status] || row.customer_status },
                { label: 'Membresía', render: (row) => MEMBERSHIP_STATUS[row.membership_status] || 'Sin membresía' },
                { label: 'Plan', key: 'plan_name' },
                { label: 'Vencimiento', render: (row) => date(row.membership_end_date) },
              ]}
              rows={rows}
              rowKey={(row) => row.id_customer}
              emptyMessage="No hay clientes que coincidan con los filtros."
            />
            <Pager page={result.page} totalPages={result.totalPages} onPageChange={setPage} />
            <p className="direction-readonly-total">{result.total} clientes encontrados</p>
          </>
        )}
      </section>
      {selectedId !== null && (
        <CustomerDetail customerId={selectedId} refreshKey={refreshKey} onClose={() => setSelectedId(null)} />
      )}
    </>
  );
}

function CustomerDetail({ customerId, refreshKey, onClose }) {
  const [membershipPage, setMembershipPage] = useState(1);
  const requestKey = `${customerId}:${refreshKey}:${membershipPage}`;
  const [response, setResponse] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      erpRequest(`/api/erp/direction/customers/${customerId}`, { signal: controller.signal }),
      erpRequest(`/api/erp/direction/customers/${customerId}/memberships`, {
        params: { page: membershipPage, limit: PAGE_SIZE },
        signal: controller.signal,
      }),
    ]).then(([customerData, membershipData]) => {
      setResponse({
        requestKey,
        detail: customerData,
        history: membershipData,
        error: '',
        complete: true,
      });
    }).catch((requestError) => {
      if (requestError?.name !== 'AbortError' && requestError?.code !== 'REQUEST_CANCELLED') {
        setResponse({
          requestKey,
          detail: null,
          history: null,
          error: requestError?.message || 'No se pudo cargar el detalle del cliente.',
          complete: true,
        });
      }
    });
    return () => controller.abort();
  }, [customerId, membershipPage, refreshKey, requestKey]);

  const current = response?.requestKey === requestKey ? response : null;
  const loading = !current?.complete;
  const error = current?.error || '';
  const detail = current?.detail;
  const history = current?.history;

  return (
    <section className="direction-readonly-panel direction-readonly-detail" aria-label="Detalle de cliente">
      <div className="direction-readonly-detail-heading">
        <h3>Detalle e historial del cliente</h3>
        <button type="button" onClick={onClose}>Cerrar</button>
      </div>
      {loading && <p className="direction-readonly-message" role="status">Cargando detalle…</p>}
      {!loading && error && <p className="direction-readonly-message error" role="alert">{error}</p>}
      {!loading && !error && detail && (
        <>
          <dl className="direction-readonly-customer">
            <div><dt>Cliente</dt><dd>{detail.customer.customer_name}</dd></div>
            <div><dt>Código</dt><dd>{detail.customer.id_customer}</dd></div>
            <div><dt>Estado</dt><dd>{detail.customer.customer_status}</dd></div>
            <div><dt>Teléfono</dt><dd>{detail.customer.phone || '—'}</dd></div>
            <div><dt>Correo</dt><dd>{detail.customer.email || '—'}</dd></div>
            <div><dt>Registro</dt><dd>{date(detail.customer.registration_date)}</dd></div>
            <div><dt>Membresía actual</dt><dd>{detail.currentMembership ? `${detail.currentMembership.plan_name} · ${MEMBERSHIP_STATUS[detail.currentMembership.effective_status] || detail.currentMembership.effective_status}` : 'Sin membresía'}</dd></div>
          </dl>
          <h4>Historial de membresías y promociones aplicadas</h4>
          <ReadOnlyTable
            columns={[
              { label: 'Plan', key: 'plan_name' },
              { label: 'Estado', render: (row) => MEMBERSHIP_STATUS[row.effective_status] || row.effective_status },
              { label: 'Inicio', render: (row) => date(row.start_date) },
              { label: 'Vencimiento', render: (row) => date(row.end_date) },
              { label: 'Precio aplicado', render: (row) => money(row.applied_price) },
              { label: 'Promoción aplicada', render: (row) => row.promotion_name ? `${row.promotion_name} (${money(row.promotion_discount)} de descuento)` : '—' },
              { label: 'Precio con promoción', render: (row) => row.promotion_name ? money(row.promotion_final_price) : '—' },
            ]}
            rows={history?.data || []}
            rowKey={(row) => row.id_membership}
            emptyMessage="Este cliente aún no tiene membresías registradas."
          />
          {history && (
            <Pager
              page={history.page}
              totalPages={history.totalPages}
              onPageChange={setMembershipPage}
            />
          )}
        </>
      )}
    </section>
  );
}

function PlansPanel({ refreshKey }) {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const { result, loading, error } = useDirectionQuery(
    '/api/erp/direction/membership-plans',
    { page, limit: PAGE_SIZE, search, status },
    refreshKey,
  );
  return (
    <QueryState loading={loading} error={error}>
      <form className="direction-readonly-toolbar" onSubmit={(event) => { event.preventDefault(); setPage(1); setSearch(searchInput.trim()); }}>
        <label className="direction-readonly-search">Buscar plan
          <input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} maxLength={100} />
        </label>
        <label className="direction-readonly-select">Estado
          <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
            <option value="">Todos</option><option value="ACTIVE">Activo</option><option value="INACTIVE">Inactivo</option>
          </select>
        </label>
        <button type="submit">Aplicar</button>
      </form>
      <ReadOnlyTable
        columns={[
          { label: 'Plan', key: 'plan_name' },
          { label: 'Precio', render: (row) => money(row.price) },
          { label: 'Duración', render: (row) => `${row.duration_days} días` },
          { label: 'Estado', render: (row) => RECORD_STATUS[row.status] || row.status },
          { label: 'Descripción', key: 'description' },
        ]}
        rows={result?.data || []}
        rowKey={(row) => row.id_plan}
        emptyMessage="No hay planes registrados para estos filtros."
      />
      {result && <><Pager page={result.page} totalPages={result.totalPages} onPageChange={setPage} /><p className="direction-readonly-total">{result.total} planes encontrados</p></>}
    </QueryState>
  );
}

function ExpiringPanel({ refreshKey }) {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const { result, loading, error } = useDirectionQuery(
    '/api/erp/direction/memberships/expiring',
    { page, limit: PAGE_SIZE, search },
    refreshKey,
  );
  return (
    <QueryState loading={loading} error={error}>
      <form className="direction-readonly-toolbar" onSubmit={(event) => { event.preventDefault(); setPage(1); setSearch(searchInput.trim()); }}>
        <label className="direction-readonly-search">Buscar cliente o código
          <input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} maxLength={100} />
        </label>
        <button type="submit">Aplicar</button>
      </form>
      <ReadOnlyTable
        columns={[
          { label: 'Cliente', key: 'customer_name' },
          { label: 'Código', key: 'id_customer' },
          { label: 'Teléfono', key: 'phone' },
          { label: 'Plan', key: 'plan_name' },
          { label: 'Vencimiento', render: (row) => date(row.end_date) },
          { label: 'Días restantes', key: 'days_remaining' },
        ]}
        rows={result?.data || []}
        rowKey={(row) => row.id_membership}
        emptyMessage="No hay membresías activas que venzan en los próximos 7 días."
      />
      {result && <><Pager page={result.page} totalPages={result.totalPages} onPageChange={setPage} /><p className="direction-readonly-total">{result.total} membresías próximas a vencer</p></>}
    </QueryState>
  );
}

function RenewalsPanel({ refreshKey }) {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const { result, loading, error } = useDirectionQuery(
    '/api/erp/direction/renewals',
    { page, limit: PAGE_SIZE, search, status },
    refreshKey,
  );
  return (
    <QueryState loading={loading} error={error}>
      <form className="direction-readonly-toolbar" onSubmit={(event) => { event.preventDefault(); setPage(1); setSearch(searchInput.trim()); }}>
        <label className="direction-readonly-search">Buscar cliente, código o membresía
          <input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} maxLength={100} />
        </label>
        <label className="direction-readonly-select">Estado
          <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
            <option value="">Todos</option>
            <option value="REQUESTED">Solicitada</option><option value="COMPLETED">Completada</option>
            <option value="REJECTED">Rechazada</option><option value="CANCELLED">Cancelada</option>
          </select>
        </label>
        <button type="submit">Aplicar</button>
      </form>
      <ReadOnlyTable
        columns={[
          { label: 'Cliente', key: 'customer_name' },
          { label: 'Plan', key: 'plan_name' },
          { label: 'Membresía anterior', key: 'id_previous_membership' },
          { label: 'Nueva membresía', key: 'id_new_membership' },
          { label: 'Solicitud', render: (row) => date(row.requested_at) },
          { label: 'Completada', render: (row) => date(row.completed_at) },
          { label: 'Estado', render: (row) => RENEWAL_STATUS[row.status] || row.status },
        ]}
        rows={result?.data || []}
        rowKey={(row) => row.id_renewal_request}
        emptyMessage="No hay renovaciones registradas para estos filtros."
      />
      {result && <><Pager page={result.page} totalPages={result.totalPages} onPageChange={setPage} /><p className="direction-readonly-total">{result.total} renovaciones encontradas</p></>}
    </QueryState>
  );
}

export default function DireccionConsultas({ view, refreshKey }) {
  if (view === 'customers') return <CustomerPanel refreshKey={refreshKey} />;
  if (view === 'plans') return <PlansPanel refreshKey={refreshKey} />;
  if (view === 'expiring') return <ExpiringPanel refreshKey={refreshKey} />;
  if (view === 'renewals') return <RenewalsPanel refreshKey={refreshKey} />;
  return null;
}
