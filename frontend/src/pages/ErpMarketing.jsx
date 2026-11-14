import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import { erpRequest } from '../config/erpApi';

// Gimnasio MQS - ERP / Marketing y Ventas.
// Consumimos exclusivamente los 12 endpoints de /api/erp/marketing.
// No creamos membresías, cobramos pagos ni enviamos mensajes automáticamente.
const ROOT = '/api/erp/marketing';
const PAGE_SIZE = 15;
const MAX_ID = 2147483647;
const TABS = [
  { key: 'alerts', label: 'Alertas' },
  { key: 'inactive', label: 'Clientes inactivos' },
  { key: 'followups', label: 'Seguimientos' },
  { key: 'renewals', label: 'Renovaciones' },
  { key: 'reports', label: 'Reportes' },
];
const ALERT_TYPES = {
  EXPIRING: 'Por vencer', EXPIRED: 'Vencida', LOW_ATTENDANCE: 'Poca asistencia',
};
const ALERT_STATUS = {
  PENDING: 'Pendiente', CONTACTED: 'Contactado', DISMISSED: 'Descartada',
};
const REASONS = {
  EXPIRING: 'Próxima a vencer', EXPIRED: 'Vencida',
  LOW_ATTENDANCE: 'Poca asistencia', OTHER: 'Otro',
};
const CONTACT_METHODS = {
  PHONE: 'Teléfono', WHATSAPP: 'WhatsApp', EMAIL: 'Correo electrónico',
  IN_PERSON: 'Presencial', OTHER: 'Otro',
};
const RESULTS = {
  PENDING: 'Pendiente', CONTACTED: 'Contactado', RENEWAL_ACCEPTED: 'Aceptó renovar',
  DECLINED: 'No está interesado', NO_RESPONSE: 'Sin respuesta',
};
const RENEWAL_STATUS = {
  REQUESTED: 'Solicitada', COMPLETED: 'Completada',
  REJECTED: 'Rechazada', CANCELLED: 'Cancelada',
};
const EMPTY_ALERT_FILTERS = { status: '', alert_type: '', id_customer: '', id_plan: '' };
const EMPTY_INACTIVE_FILTERS = { id_plan: '', min_days: '' };
const EMPTY_FOLLOWUP_FILTERS = {
  id_customer: '', reason: '', result: '', responsible_user: '', due_only: '',
};
const EMPTY_RENEWAL_FILTERS = { status: '', id_customer: '' };
const EMPTY_FOLLOWUP_FORM = {
  id_customer: '', id_membership: '', id_renewal_request: '', reason: 'EXPIRING',
  contact_method: 'PHONE', result: 'PENDING', notes: '', next_action_at: '',
};
const EMPTY_RENEWAL_FORM = { id_previous_membership: '', id_new_membership: '', notes: '' };
const numberFormat = new Intl.NumberFormat('es-BO');
const currencyFormat = new Intl.NumberFormat('es-BO', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const timeFormat = new Intl.DateTimeFormat('es-BO', {
  timeZone: 'America/La_Paz', dateStyle: 'short', timeStyle: 'short',
});

function boliviaToday() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const get = (key) => parts.find((item) => item.type === key)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function offsetDays(day, number) {
  const value = new Date(`${day}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + number);
  return value.toISOString().slice(0, 10);
}

function validDate(day) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const date = new Date(`${day}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day;
}

function validId(value) {
  const raw = String(value ?? '').trim();
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id <= MAX_ID ? id : null;
}

function optionalId(value, label) {
  if (value === '' || value === undefined || value === null) return null;
  const parsed = validId(value);
  if (!parsed) throw new Error(`${label} debe ser un entero positivo válido.`);
  return parsed;
}

function requiredId(value, label) {
  const id = validId(value);
  if (!id) throw new Error(`${label} debe ser un entero positivo válido.`);
  return id;
}

function safeText(value, maxLength = 2000) {
  if (typeof value !== 'string') throw new Error('Las notas deben ser texto válido.');
  if (Array.from(value).some((letter) => {
    const code = letter.charCodeAt(0);
    return code < 32 && ![9, 10, 13].includes(code) || code === 127;
  })) {
    throw new Error('El texto contiene caracteres no permitidos.');
  }
  const normalized = value.replace(/[\t\r\n ]+/g, ' ').trim();
  if (normalized.length > maxLength) throw new Error(`El texto no puede superar ${maxLength} caracteres.`);
  return normalized || null;
}

function localToUtc(value) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) || !validDate(value.slice(0, 10))) {
    throw new Error('La próxima acción debe tener una fecha y hora válidas.');
  }
  const hours = Number(value.slice(11, 13));
  const minutes = Number(value.slice(14, 16));
  if (hours > 23 || minutes > 59) throw new Error('La hora de la próxima acción no es válida.');
  // El gimnasio usa la zona de Bolivia (UTC-04:00), sin horario de verano.
  const parsed = new Date(`${value}:00-04:00`);
  if (!Number.isFinite(parsed.getTime()) || parsed.getTime() <= Date.now()) {
    throw new Error('La próxima acción debe ser posterior a la hora actual.');
  }
  return parsed.toISOString();
}

function dateFromServer(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw)
    ? `${raw.replace(' ', 'T')}Z` : raw;
  const parsed = new Date(iso);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function serverToBoliviaInput(value) {
  const parsed = dateFromServer(value);
  if (!parsed) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(parsed);
  const part = (type) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

function dateLabel(value) {
  const raw = typeof value === 'string' ? value.slice(0, 10) : '';
  return validDate(raw) ? `${raw.slice(8)}/${raw.slice(5, 7)}/${raw.slice(0, 4)}` : '—';
}

function timeLabel(value) {
  const parsed = dateFromServer(value);
  return parsed ? timeFormat.format(parsed) : '—';
}

function money(value) {
  if (value === undefined || value === null || value === '') return 'Bs 0,00';
  const num = Number(value);
  return Number.isFinite(num) ? `Bs ${currencyFormat.format(num)}` : '—';
}

function count(value) {
  const num = Number(value);
  return Number.isFinite(num) ? numberFormat.format(num) : '0';
}

function message(error) {
  return typeof error?.message === 'string' && error.message.trim()
    ? error.message : 'No fue posible completar la operación.';
}

function cancelled(error) {
  return error?.code === 'REQUEST_CANCELLED' || error?.name === 'AbortError';
}

function sessionIdentity() {
  // Esta identidad solo controla la presentación. Cada petición se valida
  // nuevamente con JWT y permisos de MySQL en el backend.
  try {
    const user = JSON.parse(window.localStorage.getItem('user') || 'null');
    const role = String(user?.role || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
    return { role, id: validId(user?.id) };
  } catch {
    return { role: '', id: null };
  }
}

function cleaned(filters) {
  return Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== ''));
}

function serializeFilters(draft) {
  const result = cleaned(draft);
  for (const [key, value] of Object.entries(result)) {
    if (key.startsWith('id_') || key === 'responsible_user') {
      requiredId(value, key);
    }
    if (key === 'min_days') {
      const days = requiredId(value, 'Días sin asistir');
      if (days > 365) throw new Error('El filtro de inactividad no puede superar 365 días.');
    }
  }
  return result;
}

function usePagedData(active, path, filters, page, refresh) {
  const [data, setData] = useState({ items: [], total: 0, page: 1 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const query = JSON.stringify({ ...filters, page, limit: PAGE_SIZE });

  useEffect(() => {
    if (!active) return undefined;
    const controller = new AbortController();
    Promise.resolve().then(() => {
      if (!controller.signal.aborted) { setLoading(true); setError(''); }
    });
    erpRequest(path, { params: JSON.parse(query), signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted) return;
        if (!response || !Array.isArray(response.items)) {
          throw new Error('El servidor devolvió un listado con formato incorrecto.');
        }
        setData({ items: response.items, total: Number(response.total) || 0, page });
      })
      .catch((failure) => {
        if (controller.signal.aborted || cancelled(failure)) return;
        setData({ items: [], total: 0, page });
        setError(message(failure));
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [active, path, query, page, refresh]);

  return { ...data, loading, error };
}

function Notice({ notice, onClose }) {
  if (!notice) return null;
  return (
    <div className={`erp-mkt-notice ${notice.type === 'error' ? 'error' : ''}`}
      role={notice.type === 'error' ? 'alert' : 'status'}>
      <span>{notice.text}</span>
      <button type="button" onClick={onClose} aria-label="Cerrar aviso">✕</button>
    </div>
  );
}

function Pill({ text, kind = '' }) {
  return <span className={`erp-mkt-pill ${kind}`}>{text || '—'}</span>;
}

function PageNav({ page, total, busy, onChange }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <div className="erp-mkt-paging">
      <span>{count(total)} registros · Página {page} de {pages}</span>
      <div className="erp-mkt-actions">
        <button type="button" className="erp-mkt-btn erp-mkt-small"
          onClick={() => onChange(Math.max(1, page - 1))} disabled={busy || page <= 1}>Anterior</button>
        <button type="button" className="erp-mkt-btn erp-mkt-small"
          onClick={() => onChange(Math.min(pages, page + 1))} disabled={busy || page >= pages}>Siguiente</button>
      </div>
    </div>
  );
}

function FilterPanel({ title, onSubmit, onReset, children }) {
  return (
    <form className="erp-mkt-filters" onSubmit={onSubmit}>
      <strong>{title}</strong>
      <div className="erp-mkt-filtergrid">{children}</div>
      <div className="erp-mkt-actions">
        <button type="submit" className="erp-mkt-btn erp-mkt-primary">Buscar</button>
        <button type="button" className="erp-mkt-btn" onClick={onReset}>Limpiar</button>
      </div>
    </form>
  );
}

function Field({ label, children, hint, wide = false }) {
  return (
    <label className={`erp-mkt-field ${wide ? 'erp-mkt-span' : ''}`}>
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

function Blank({ children }) {
  return <p className="erp-mkt-empty">{children}</p>;
}

function Confirm({ value, busy, cancel, accept }) {
  useEffect(() => {
    if (!value) return undefined;
    const listener = (event) => { if (event.key === 'Escape' && !busy) cancel(); };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [value, busy, cancel]);
  if (!value) return null;
  return (
    <div className="erp-mkt-overlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) cancel();
    }}>
      <div className="erp-mkt-dialog" role="dialog" aria-modal="true" aria-labelledby="erp-mkt-confirm-title">
        <h2 id="erp-mkt-confirm-title">{value.title}</h2>
        <p>{value.description}</p>
        <div className="erp-mkt-actions erp-mkt-dialog-actions">
          <button type="button" className="erp-mkt-btn" disabled={busy} onClick={cancel}>Volver</button>
          <button type="button" className={`erp-mkt-btn ${value.danger ? 'erp-mkt-danger' : 'erp-mkt-primary'}`}
            disabled={busy} onClick={accept} autoFocus>{busy ? 'Procesando…' : value.label}</button>
        </div>
      </div>
    </div>
  );
}

function csvEscape(value) {
  const str = String(value ?? '');
  // Impide que un nombre o una nota se interprete como fórmula en una hoja de cálculo.
  const safe = /^[\s]*[=+@-]/.test(str) ? `'${str}` : str;
  return `"${safe.replace(/"/g, '""')}"`;
}

function exportReport(report) {
  const rows = [['Sección', 'Concepto', 'Cantidad', 'Importe Bs', 'Adicional']];
  const summary = report.summary || {};
  rows.push(['Resumen', 'Ventas registradas', summary.sales_count ?? 0, summary.revenue ?? 0, '']);
  rows.push(['Resumen', 'Descuentos aplicados', summary.promoted_sales ?? 0, summary.total_discounts ?? 0, '']);
  rows.push(['Resumen', 'Renovaciones completadas', summary.completed_renewals ?? 0, '', '']);
  for (const plan of report.sales_by_plan || []) {
    rows.push(['Planes', plan.plan_name, plan.sales_count, plan.revenue, `Renovaciones: ${plan.renewals || 0}`]);
  }
  for (const promotion of report.promotions || []) {
    rows.push(['Promociones', promotion.promotion_name, promotion.uses, promotion.revenue,
      `Descuento: ${promotion.total_discount || 0}`]);
  }
  for (const item of report.followups_by_result || []) {
    rows.push(['Seguimientos', RESULTS[item.result] || item.result, item.total, '', '']);
  }
  for (const item of report.renewal_requests_by_status || []) {
    rows.push(['Solicitudes', RENEWAL_STATUS[item.status] || item.status, item.total, '', '']);
  }
  const csv = `\ufeff${rows.map((row) => row.map(csvEscape).join(';')).join('\r\n')}`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `marketing_${report.from}_${report.to}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ErpMarketing() {
  const navigate = useNavigate();
  const session = useMemo(() => sessionIdentity(), []);
  const role = session.role;
  const isAdmin = role === 'administrador' || role === 'admin';
  const allowedRole = isAdmin || role === 'recepcionista' || role === 'recepcion';
  // El esquema ERP otorga MV_REPORTS_READ al Administrador, no a Recepción.
  // El servidor sigue siendo la autoridad final incluso para usuarios admin.
  const canReadReports = isAdmin;
  const visibleTabs = canReadReports ? TABS : TABS.filter((item) => item.key !== 'reports');

  const [tab, setTab] = useState('alerts');
  const [notice, setNotice] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [acting, setActing] = useState(false);
  const actionLock = useRef(false);
  const [refresh, setRefresh] = useState({ alerts: 0, inactive: 0, followups: 0, renewals: 0, reports: 0 });
  const reload = useCallback((...keys) => setRefresh((previous) => {
    const next = { ...previous };
    keys.forEach((key) => { next[key] += 1; });
    return next;
  }), []);
  const notify = useCallback((type, text) => setNotice({ type, text }), []);

  const [alertDraft, setAlertDraft] = useState(EMPTY_ALERT_FILTERS);
  const [alertFilters, setAlertFilters] = useState({});
  const [alertPage, setAlertPage] = useState(1);
  const [inactiveDraft, setInactiveDraft] = useState(EMPTY_INACTIVE_FILTERS);
  const [inactiveFilters, setInactiveFilters] = useState({});
  const [inactivePage, setInactivePage] = useState(1);
  const [followupDraft, setFollowupDraft] = useState(EMPTY_FOLLOWUP_FILTERS);
  const [followupFilters, setFollowupFilters] = useState({});
  const [followupPage, setFollowupPage] = useState(1);
  const [renewalDraft, setRenewalDraft] = useState(EMPTY_RENEWAL_FILTERS);
  const [renewalFilters, setRenewalFilters] = useState({});
  const [renewalPage, setRenewalPage] = useState(1);

  const alertData = usePagedData(tab === 'alerts', `${ROOT}/alerts`, alertFilters, alertPage, refresh.alerts);
  const inactiveData = usePagedData(tab === 'inactive', `${ROOT}/inactive-customers`, inactiveFilters, inactivePage, refresh.inactive);
  const followupData = usePagedData(tab === 'followups', `${ROOT}/followups`, followupFilters, followupPage, refresh.followups);
  const renewalData = usePagedData(tab === 'renewals', `${ROOT}/renewals`, renewalFilters, renewalPage, refresh.renewals);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FOLLOWUP_FORM);
  const [formBaseline, setFormBaseline] = useState(null);
  const [renewalFormOpen, setRenewalFormOpen] = useState(false);
  const [renewalForm, setRenewalForm] = useState(EMPTY_RENEWAL_FORM);
  const [closeRequest, setCloseRequest] = useState(null);
  const today = boliviaToday();
  const [reportDraft, setReportDraft] = useState(() => ({ from: offsetDays(boliviaToday(), -29), to: boliviaToday() }));
  const [reportFilters, setReportFilters] = useState(() => ({ from: offsetDays(boliviaToday(), -29), to: boliviaToday() }));
  const [report, setReport] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState('');
  const reportQuery = JSON.stringify(reportFilters);

  useEffect(() => {
    if (!canReadReports || tab !== 'reports') return undefined;
    const abort = new AbortController();
    Promise.resolve().then(() => {
      if (!abort.signal.aborted) { setReportLoading(true); setReportError(''); }
    });
    erpRequest(`${ROOT}/reports/commercial`, {
      params: JSON.parse(reportQuery), signal: abort.signal,
    }).then((data) => {
      if (abort.signal.aborted) return;
      if (!data || typeof data.summary !== 'object' ||
        !Array.isArray(data.sales_by_plan) || !Array.isArray(data.promotions) ||
        !Array.isArray(data.followups_by_result) || !Array.isArray(data.renewal_requests_by_status)) {
        throw new Error('El reporte tiene un formato inesperado.');
      }
      setReport(data);
    }).catch((error) => {
      if (!abort.signal.aborted && !cancelled(error)) { setReport(null); setReportError(message(error)); }
    }).finally(() => { if (!abort.signal.aborted) setReportLoading(false); });
    return () => abort.abort();
  }, [canReadReports, tab, reportQuery, refresh.reports]);

  const handleConfirm = useCallback(async () => {
    if (!confirm || actionLock.current) return;
    actionLock.current = true;
    setActing(true);
    try {
      const result = await confirm.run();
      if (typeof confirm.after === 'function') confirm.after(result);
      notify('success', typeof confirm.success === 'function' ? confirm.success(result) : confirm.success);
      setConfirm(null);
    } catch (error) {
      setConfirm(null);
      notify('error', message(error));
    } finally {
      actionLock.current = false;
      setActing(false);
    }
  }, [confirm, notify, setConfirm]);

  const showTab = (key) => {
    // Un usuario de Recepción no debe navegar ni solicitar reportes comerciales.
    if (!visibleTabs.some((item) => item.key === key)) return;
    setNotice(null);
    setTab(key);
  };

  const applyFilters = (event, draft, update, updatePage) => {
    event.preventDefault();
    try {
      update(serializeFilters(draft));
      updatePage(1);
    } catch (error) {
      notify('error', message(error));
    }
  };

  const resetFilters = (empty, setDraft, setFilters, setPage) => {
    setDraft({ ...empty });
    setFilters({});
    setPage(1);
  };

  const newFollowup = (initial = {}) => {
    setEditing(null);
    setFormBaseline(null);
    setForm({ ...EMPTY_FOLLOWUP_FORM, ...initial });
    setFormOpen(true);
    setTab('followups');
    setNotice(null);
  };

  const fromAlert = (row) => newFollowup({
    id_customer: String(row.id_customer),
    id_membership: String(row.id_membership),
    reason: REASONS[row.alert_type] ? row.alert_type : 'OTHER',
  });

  const fromInactive = (row) => newFollowup({
    id_customer: String(row.id_customer),
    id_membership: row.id_membership == null ? '' : String(row.id_membership),
    reason: 'LOW_ATTENDANCE',
  });

  const openFollowupEdit = async (id) => {
    if (actionLock.current) return;
    actionLock.current = true;
    setActing(true);
    try {
      const data = await erpRequest(`${ROOT}/followups/${requiredId(id, 'Seguimiento')}`);
      const current = {
        result: data.result || 'PENDING', notes: data.notes || '',
        next_action_at: serverToBoliviaInput(data.next_action_at),
      };
      setEditing(Number(id));
      setFormBaseline(current);
      setForm({ ...EMPTY_FOLLOWUP_FORM, ...current });
      setFormOpen(true);
      setTab('followups');
      setNotice(null);
    } catch (error) {
      notify('error', message(error));
    } finally {
      actionLock.current = false;
      setActing(false);
    }
  };

  const saveFollowup = (event) => {
    event.preventDefault();
    try {
      const result = form.result;
      if (!Object.hasOwn(RESULTS, result)) throw new Error('Selecciona un resultado válido.');
      const notes = safeText(form.notes);
      if (['RENEWAL_ACCEPTED', 'DECLINED'].includes(result) && form.next_action_at) {
        throw new Error('Un seguimiento cerrado no debe tener próxima acción.');
      }
      if (editing) {
        const input = { result, notes };
        if (formBaseline?.next_action_at !== form.next_action_at) {
          input.next_action_at = localToUtc(form.next_action_at);
        }
        const currentId = requiredId(editing, 'Seguimiento');
        setConfirm({
          title: 'Guardar cambios del seguimiento',
          description: `Se actualizará el resultado y las notas del seguimiento #${currentId}.`,
          label: 'Guardar cambios',
          run: () => erpRequest(`${ROOT}/followups/${currentId}`, { method: 'PATCH', body: input }),
          after: () => { setFormOpen(false); setEditing(null); reload('followups'); },
          success: 'El seguimiento se actualizó correctamente.',
        });
        return;
      }
      const customerId = requiredId(form.id_customer, 'ID del cliente');
      if (!Object.hasOwn(REASONS, form.reason) || !Object.hasOwn(CONTACT_METHODS, form.contact_method)) {
        throw new Error('Selecciona un motivo y un medio de contacto válidos.');
      }
      const input = {
        id_customer: customerId,
        id_membership: optionalId(form.id_membership, 'ID de la membresía'),
        id_renewal_request: optionalId(form.id_renewal_request, 'ID de la solicitud'),
        reason: form.reason,
        contact_method: form.contact_method,
        result, notes,
        next_action_at: localToUtc(form.next_action_at),
      };
      setConfirm({
        title: 'Registrar seguimiento comercial',
        description: `Se guardará un registro para el cliente #${customerId}. Este registro no envía mensajes ni genera pagos.`,
        label: 'Registrar seguimiento',
        run: () => erpRequest(`${ROOT}/followups`, { method: 'POST', body: input }),
        after: () => { setFormOpen(false); setForm(EMPTY_FOLLOWUP_FORM); reload('followups'); },
        success: 'El seguimiento se registró correctamente.',
      });
    } catch (error) {
      notify('error', message(error));
    }
  };

  const submitRenewal = (event) => {
    event.preventDefault();
    try {
      const previous = requiredId(renewalForm.id_previous_membership, 'Membresía anterior');
      const next = optionalId(renewalForm.id_new_membership, 'Membresía nueva');
      if (next === previous) throw new Error('La membresía nueva debe ser distinta de la anterior.');
      const input = { id_previous_membership: previous, id_new_membership: next,
        notes: safeText(renewalForm.notes) };
      setConfirm({
        title: 'Solicitar renovación',
        description: `Se registrará una solicitud comercial para la membresía #${previous}. La solicitud NO crea una nueva membresía ni realiza ningún cobro.`,
        label: 'Crear solicitud',
        run: () => erpRequest(`${ROOT}/renewals`, { method: 'POST', body: input }),
        after: () => { setRenewalFormOpen(false); setRenewalForm(EMPTY_RENEWAL_FORM); reload('renewals'); },
        success: 'Solicitud registrada. La renovación operativa se gestiona desde Operaciones y Finanzas.',
      });
    } catch (error) {
      notify('error', message(error));
    }
  };

  const submitClose = (event) => {
    event.preventDefault();
    if (!closeRequest) return;
    try {
      const notes = safeText(closeRequest.notes);
      if (!notes) throw new Error('Es obligatorio indicar el motivo del cierre.');
      const id = requiredId(closeRequest.id, 'Solicitud');
      const status = closeRequest.status;
      if (!['REJECTED', 'CANCELLED'].includes(status)) throw new Error('Estado de cierre no válido.');
      setConfirm({
        title: status === 'CANCELLED' ? 'Cancelar solicitud' : 'Rechazar solicitud',
        description: `Se cerrará la solicitud #${id}. Solo se permite cerrar solicitudes pendientes sin membresía nueva vinculada.`,
        label: 'Confirmar cierre', danger: true,
        run: () => erpRequest(`${ROOT}/renewals/${id}/close`, { method: 'PATCH', body: { status, notes } }),
        after: () => { setCloseRequest(null); reload('renewals'); },
        success: 'Solicitud cerrada correctamente.',
      });
    } catch (error) {
      notify('error', message(error));
    }
  };

  const submitReport = (event) => {
    event.preventDefault();
    if (!canReadReports) return;
    const { from, to } = reportDraft;
    if (!validDate(from) || !validDate(to)) return notify('error', 'Selecciona fechas válidas para el reporte.');
    const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000;
    if (days < 0 || days > 366) return notify('error', 'El rango debe estar ordenado y no superar 367 días inclusivos.');
    setReportFilters({ from, to });
    reload('reports');
    return undefined;
  };

  const pendingAlertsHere = alertData.items.filter((row) => row.status === 'PENDING').length;
  const openFollowupsHere = followupData.items.filter((row) =>
    ['PENDING', 'CONTACTED', 'NO_RESPONSE'].includes(row.result)).length;
  const summary = report?.summary || {};

  if (!allowedRole) {
    return (
      <div className="erp-mkt-page">
        <style>{css}</style>
        <Sidebar />
        <main className="erp-mkt-main"><h1>Marketing y Ventas</h1>
          <p>No tienes acceso a esta sección.</p>
          <button type="button" className="erp-mkt-btn" onClick={() => navigate('/home')}>Volver</button>
        </main>
      </div>
    );
  }

  return (
    <div className="erp-mkt-page">
      <style>{css}</style>
      <Sidebar />
      <main className="erp-mkt-main">
        <div className="erp-mkt-top">
          <div>
            <span className="erp-mkt-eyebrow">GIMNASIO MQS · ERP</span>
            <h1>Marketing y Ventas</h1>
            <p className="erp-mkt-subtitle">Alertas de membresías, inactividad, contactos, renovaciones y resultados comerciales.</p>
          </div>
          <div className="erp-mkt-actions">
            <button type="button" className="erp-mkt-btn" onClick={() => reload(tab)}>Actualizar</button>
            <button type="button" className="erp-mkt-btn" onClick={() => navigate('/erp/promotions')}>Ver promociones</button>
          </div>
        </div>
        <Notice notice={notice} onClose={() => setNotice(null)} />
        <nav className="erp-mkt-tabs" aria-label="Secciones de Marketing">
          {visibleTabs.map((entry) => (
            <button key={entry.key} type="button" className={tab === entry.key ? 'selected' : ''}
              aria-current={tab === entry.key ? 'page' : undefined}
              onClick={() => showTab(entry.key)}>{entry.label}</button>
          ))}
        </nav>

        {tab === 'alerts' && (
          <section aria-label="Alertas comerciales">
            <div className="erp-mkt-section-head">
              <div><h2>Alertas de membresías</h2><p>Se generan bajo demanda, usando registros reales; no envían mensajes automáticamente.</p></div>
              <button type="button" className="erp-mkt-btn erp-mkt-primary" disabled={acting}
                onClick={() => setConfirm({
                  title: 'Actualizar alertas',
                  description: 'Se buscarán membresías próximas a vencer, vencidas y clientes con poca asistencia. Las alertas existentes no se duplicarán.',
                  label: 'Generar alertas',
                  run: () => erpRequest(`${ROOT}/alerts/generate`, { method: 'POST', timeoutMs: 60000 }),
                  after: () => reload('alerts', 'inactive'),
                  success: (data) => `${data?.message || 'Alertas actualizadas.'} Nuevas: ${count(data?.total_created)}.`,
                })}>Generar / actualizar alertas</button>
            </div>
            <div className="erp-mkt-metrics">
              <div><span>Alertas encontradas</span><strong>{count(alertData.total)}</strong></div>
              <div><span>Pendientes en esta página</span><strong>{count(pendingAlertsHere)}</strong></div>
              <div><span>Fecha del gimnasio</span><strong>{dateLabel(today)}</strong></div>
            </div>
            <FilterPanel title="Filtrar alertas"
              onSubmit={(e) => applyFilters(e, alertDraft, setAlertFilters, setAlertPage)}
              onReset={() => resetFilters(EMPTY_ALERT_FILTERS, setAlertDraft, setAlertFilters, setAlertPage)}>
              <Field label="Estado"><select value={alertDraft.status} onChange={(e) => setAlertDraft((p) => ({ ...p, status: e.target.value }))}>
                <option value="">Todos</option>{Object.entries(ALERT_STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select></Field>
              <Field label="Tipo"><select value={alertDraft.alert_type} onChange={(e) => setAlertDraft((p) => ({ ...p, alert_type: e.target.value }))}>
                <option value="">Todos</option>{Object.entries(ALERT_TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select></Field>
              <Field label="ID de cliente"><input inputMode="numeric" value={alertDraft.id_customer} onChange={(e) => setAlertDraft((p) => ({ ...p, id_customer: e.target.value }))} placeholder="Opcional" /></Field>
              <Field label="ID de plan"><input inputMode="numeric" value={alertDraft.id_plan} onChange={(e) => setAlertDraft((p) => ({ ...p, id_plan: e.target.value }))} placeholder="Opcional" /></Field>
            </FilterPanel>
            {alertData.loading && <p className="erp-mkt-hint" role="status">Cargando alertas…</p>}
            {alertData.error && <p className="erp-mkt-error" role="alert">{alertData.error}</p>}
            {!alertData.loading && !alertData.error && (
              <div className="erp-mkt-tablewrap"><table>
                <thead><tr><th>Cliente</th><th>Plan / Membresía</th><th>Alerta</th><th>Referencia</th><th>Estado</th><th>Acciones</th></tr></thead>
                <tbody>{alertData.items.map((row) => (
                  <tr key={row.id_alert}>
                    <td><strong>{row.first_name} {row.last_name}</strong><small>Cliente #{row.id_customer}{row.phone ? ` · ${row.phone}` : ''}</small></td>
                    <td>{row.plan_name}<small>Membresía #{row.id_membership} · Vence {dateLabel(row.membership_end_date)}</small></td>
                    <td><Pill text={ALERT_TYPES[row.alert_type] || row.alert_type} kind={row.alert_type === 'EXPIRED' ? 'danger' : 'warning'} /></td>
                    <td>{dateLabel(row.reference_date)}<small>{row.days_to_expire == null ? '' : `${count(Math.abs(Number(row.days_to_expire)))} día(s) ${Number(row.days_to_expire) < 0 ? 'vencida' : 'para vencer'}`}</small></td>
                    <td><Pill text={ALERT_STATUS[row.status] || row.status} kind={row.status === 'PENDING' ? 'warning' : 'success'} /></td>
                    <td><div className="erp-mkt-rowbuttons">
                      <button type="button" className="erp-mkt-btn erp-mkt-small" onClick={() => fromAlert(row)}>Seguimiento</button>
                      {['ACTIVE', 'EXPIRED'].includes(row.membership_status) && (
                        <button type="button" className="erp-mkt-btn erp-mkt-small" onClick={() => {
                          setRenewalForm({ ...EMPTY_RENEWAL_FORM, id_previous_membership: String(row.id_membership) });
                          setRenewalFormOpen(true); showTab('renewals');
                        }}>Solicitar renovación</button>
                      )}
                      {row.status === 'PENDING' && <>
                        <button type="button" className="erp-mkt-btn erp-mkt-small" disabled={acting}
                          onClick={() => setConfirm({
                            title: 'Marcar alerta como contactada',
                            description: `Confirma que el cliente #${row.id_customer} ya fue contactado. Si necesitas conservar detalles de la conversación, registra además un seguimiento.`,
                            label: 'Marcar contactado',
                            run: () => erpRequest(`${ROOT}/alerts/${row.id_alert}/resolve`, { method: 'PATCH', body: { status: 'CONTACTED' } }),
                            after: () => reload('alerts'), success: 'La alerta se marcó como contactada.',
                          })}>Atendida</button>
                        <button type="button" className="erp-mkt-btn erp-mkt-small erp-mkt-danger" disabled={acting}
                          onClick={() => setConfirm({
                            title: 'Descartar alerta', description: `La alerta #${row.id_alert} dejará de figurar como pendiente.`,
                            label: 'Descartar', danger: true,
                            run: () => erpRequest(`${ROOT}/alerts/${row.id_alert}/resolve`, { method: 'PATCH', body: { status: 'DISMISSED' } }),
                            after: () => reload('alerts'), success: 'La alerta fue descartada.',
                          })}>Descartar</button>
                      </>}
                    </div></td>
                  </tr>
                ))}</tbody>
              </table>{!alertData.items.length && <Blank>No hay alertas para los filtros seleccionados.</Blank>}</div>
            )}
            <PageNav page={alertPage} total={alertData.total} busy={alertData.loading} onChange={setAlertPage} />
          </section>
        )}

        {tab === 'inactive' && (
          <section aria-label="Clientes inactivos">
            <div className="erp-mkt-section-head"><div>
              <h2>Clientes que dejaron de asistir</h2>
              <p>Solo aparecen clientes activos con membresía vigente. Se calcula desde las asistencias registradas.</p>
            </div></div>
            <FilterPanel title="Filtrar inactividad"
              onSubmit={(e) => applyFilters(e, inactiveDraft, setInactiveFilters, setInactivePage)}
              onReset={() => resetFilters(EMPTY_INACTIVE_FILTERS, setInactiveDraft, setInactiveFilters, setInactivePage)}>
              <Field label="ID de plan"><input inputMode="numeric" value={inactiveDraft.id_plan} onChange={(e) => setInactiveDraft((p) => ({ ...p, id_plan: e.target.value }))} placeholder="Todos" /></Field>
              <Field label="Días mínimos sin asistir"><input inputMode="numeric" value={inactiveDraft.min_days} onChange={(e) => setInactiveDraft((p) => ({ ...p, min_days: e.target.value }))} placeholder="Configuración ERP" /></Field>
            </FilterPanel>
            {inactiveData.loading && <p className="erp-mkt-hint" role="status">Consultando asistencias…</p>}
            {inactiveData.error && <p className="erp-mkt-error" role="alert">{inactiveData.error}</p>}
            {!inactiveData.loading && !inactiveData.error && (
              <div className="erp-mkt-tablewrap"><table>
                <thead><tr><th>Cliente</th><th>Plan / Membresía</th><th>Última asistencia</th><th>Días sin asistir</th><th>Acciones</th></tr></thead>
                <tbody>{inactiveData.items.map((row) => <tr key={`${row.id_customer}-${row.id_membership}`}>
                  <td><strong>{row.first_name} {row.last_name}</strong><small>Cliente #{row.id_customer}{row.phone ? ` · ${row.phone}` : ''}</small></td>
                  <td>{row.plan_name}<small>Membresía #{row.id_membership} · Hasta {dateLabel(row.end_date)}</small></td>
                  <td>{row.last_attendance_date ? dateLabel(row.last_attendance_date) : 'No registra asistencias'}</td>
                  <td><Pill text={`${count(row.days_inactive)} días`} kind="warning" /></td>
                  <td><button type="button" className="erp-mkt-btn erp-mkt-small" onClick={() => fromInactive(row)}>Registrar seguimiento</button></td>
                </tr>)}</tbody>
              </table>{!inactiveData.items.length && <Blank>No hay clientes inactivos para estos filtros.</Blank>}</div>
            )}
            <PageNav page={inactivePage} total={inactiveData.total} busy={inactiveData.loading} onChange={setInactivePage} />
          </section>
        )}

        {tab === 'followups' && (
          <section aria-label="Seguimientos comerciales">
            <div className="erp-mkt-section-head">
              <div><h2>Seguimientos comerciales</h2><p>Registra el contacto realizado, su resultado y la próxima acción pendiente.</p></div>
              <button type="button" className="erp-mkt-btn erp-mkt-primary" onClick={() => {
                if (formOpen && !editing) { setFormOpen(false); return; }
                newFollowup();
              }}>{formOpen && !editing ? 'Cerrar formulario' : 'Nuevo seguimiento'}</button>
            </div>
            <div className="erp-mkt-metrics">
              <div><span>Seguimientos encontrados</span><strong>{count(followupData.total)}</strong></div>
              <div><span>Abiertos en esta página</span><strong>{count(openFollowupsHere)}</strong></div>
            </div>
            {formOpen && (
              <form className="erp-mkt-card" onSubmit={saveFollowup}>
                <div className="erp-mkt-section-head"><div>
                  <h3>{editing ? `Editar seguimiento #${editing}` : 'Registrar un contacto'}</h3>
                  <p>{editing ? 'Solo se pueden cambiar el resultado, las notas y la próxima acción.' : 'Los campos con * son obligatorios.'}</p>
                </div></div>
                {!editing && <div className="erp-mkt-formgrid">
                  <Field label="ID del cliente *"><input inputMode="numeric" required value={form.id_customer} onChange={(e) => setForm((p) => ({ ...p, id_customer: e.target.value }))} placeholder="Ej.: 12" /></Field>
                  <Field label="ID de membresía"><input inputMode="numeric" value={form.id_membership} onChange={(e) => setForm((p) => ({ ...p, id_membership: e.target.value }))} placeholder="Opcional" /></Field>
                  <Field label="ID de solicitud de renovación"><input inputMode="numeric" value={form.id_renewal_request} onChange={(e) => setForm((p) => ({ ...p, id_renewal_request: e.target.value }))} placeholder="Opcional" /></Field>
                  <Field label="Motivo *"><select value={form.reason} onChange={(e) => setForm((p) => ({ ...p, reason: e.target.value }))}>{Object.entries(REASONS).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></Field>
                  <Field label="Medio de contacto *"><select value={form.contact_method} onChange={(e) => setForm((p) => ({ ...p, contact_method: e.target.value }))}>{Object.entries(CONTACT_METHODS).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></Field>
                </div>}
                <div className="erp-mkt-formgrid">
                  <Field label="Resultado *"><select value={form.result} onChange={(e) => setForm((p) => ({
                    ...p, result: e.target.value,
                    next_action_at: ['RENEWAL_ACCEPTED', 'DECLINED'].includes(e.target.value) ? '' : p.next_action_at,
                  }))}>{Object.entries(RESULTS).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></Field>
                  <Field label="Próxima acción (hora de Bolivia)" hint="Debe ser futura. Vacío significa sin próxima acción.">
                    <input type="datetime-local" value={form.next_action_at}
                      disabled={['RENEWAL_ACCEPTED', 'DECLINED'].includes(form.result)}
                      onChange={(e) => setForm((p) => ({ ...p, next_action_at: e.target.value }))} />
                  </Field>
                  <Field label="Notas" wide hint="Máximo 2000 caracteres. No se envían mensajes de manera automática.">
                    <textarea maxLength={2000} rows={4} value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} placeholder="Resume la conversación y los siguientes pasos." />
                  </Field>
                </div>
                <div className="erp-mkt-actions" style={{ marginTop: 18 }}>
                  <button type="submit" className="erp-mkt-btn erp-mkt-primary" disabled={acting}>{editing ? 'Guardar cambios' : 'Registrar seguimiento'}</button>
                  <button type="button" className="erp-mkt-btn" onClick={() => { setFormOpen(false); setEditing(null); }}>Cancelar</button>
                </div>
              </form>
            )}
            <FilterPanel title="Filtrar seguimientos"
              onSubmit={(e) => applyFilters(e, followupDraft, setFollowupFilters, setFollowupPage)}
              onReset={() => resetFilters(EMPTY_FOLLOWUP_FILTERS, setFollowupDraft, setFollowupFilters, setFollowupPage)}>
              <Field label="ID de cliente"><input inputMode="numeric" value={followupDraft.id_customer} onChange={(e) => setFollowupDraft((p) => ({ ...p, id_customer: e.target.value }))} placeholder="Todos" /></Field>
              <Field label="Motivo"><select value={followupDraft.reason} onChange={(e) => setFollowupDraft((p) => ({ ...p, reason: e.target.value }))}><option value="">Todos</option>{Object.entries(REASONS).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></Field>
              <Field label="Resultado"><select value={followupDraft.result} onChange={(e) => setFollowupDraft((p) => ({ ...p, result: e.target.value }))}><option value="">Todos</option>{Object.entries(RESULTS).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></Field>
              <Field label="ID de responsable"><input inputMode="numeric" value={followupDraft.responsible_user} onChange={(e) => setFollowupDraft((p) => ({ ...p, responsible_user: e.target.value }))} placeholder="Todos" /></Field>
              <Field label="Próxima acción vencida"><select value={followupDraft.due_only} onChange={(e) => setFollowupDraft((p) => ({ ...p, due_only: e.target.value }))}>
                <option value="">Todas</option><option value="true">Solo pendientes vencidas</option>
              </select></Field>
            </FilterPanel>
            {followupData.loading && <p className="erp-mkt-hint" role="status">Cargando seguimientos…</p>}
            {followupData.error && <p className="erp-mkt-error" role="alert">{followupData.error}</p>}
            {!followupData.loading && !followupData.error && (
              <div className="erp-mkt-tablewrap"><table>
                <thead><tr><th>Cliente</th><th>Motivo y contacto</th><th>Resultado</th><th>Próxima acción</th><th>Responsable</th><th>Acciones</th></tr></thead>
                <tbody>{followupData.items.map((row) => <tr key={row.id_followup}>
                  <td><strong>{row.first_name} {row.last_name}</strong><small>Cliente #{row.id_customer} · Seguimiento #{row.id_followup}</small></td>
                  <td>{REASONS[row.reason] || row.reason}<small>{CONTACT_METHODS[row.contact_method] || row.contact_method} · {timeLabel(row.contact_date)}</small>
                    {row.notes && <small className="erp-mkt-notes">{row.notes}</small>}
                  </td>
                  <td><Pill text={RESULTS[row.result] || row.result} kind={['RENEWAL_ACCEPTED', 'DECLINED'].includes(row.result) ? 'success' : 'warning'} /></td>
                  <td>{timeLabel(row.next_action_at)}</td>
                  <td>{row.responsible_username || `Usuario #${row.responsible_user}`}</td>
                  <td>{isAdmin || (session.id !== null && Number(row.responsible_user) === session.id)
                    ? <button type="button" className="erp-mkt-btn erp-mkt-small" disabled={acting}
                      onClick={() => openFollowupEdit(row.id_followup)}>Editar</button>
                    : <span className="erp-mkt-hint" title="Solo el responsable o un administrador puede modificar este seguimiento">Solo consulta</span>}
                  </td>
                </tr>)}</tbody>
              </table>{!followupData.items.length && <Blank>No hay seguimientos para estos filtros.</Blank>}</div>
            )}
            <PageNav page={followupPage} total={followupData.total} busy={followupData.loading} onChange={setFollowupPage} />
          </section>
        )}

        {tab === 'renewals' && (
          <section aria-label="Solicitudes comerciales de renovación">
            <div className="erp-mkt-section-head">
              <div><h2>Solicitudes de renovación</h2>
                <p>Este módulo solo registra solicitudes. Operaciones crea la nueva membresía; Finanzas la cobra.</p></div>
              <button type="button" className="erp-mkt-btn erp-mkt-primary" onClick={() => {
                if (renewalFormOpen) setRenewalFormOpen(false);
                else { setRenewalForm(EMPTY_RENEWAL_FORM); setRenewalFormOpen(true); }
              }}>{renewalFormOpen ? 'Cerrar formulario' : 'Nueva solicitud'}</button>
            </div>
            {renewalFormOpen && (
              <form className="erp-mkt-card" onSubmit={submitRenewal}>
                <h3>Registrar solicitud comercial</h3>
                <p className="erp-mkt-hint">No crea ni activa una nueva membresía. El ID nuevo es opcional si Operaciones aún no ha generado la renovación.</p>
                <div className="erp-mkt-formgrid">
                  <Field label="ID de membresía anterior *"><input required inputMode="numeric" value={renewalForm.id_previous_membership}
                    onChange={(e) => setRenewalForm((p) => ({ ...p, id_previous_membership: e.target.value }))} /></Field>
                  <Field label="ID de membresía nueva"><input inputMode="numeric" value={renewalForm.id_new_membership}
                    onChange={(e) => setRenewalForm((p) => ({ ...p, id_new_membership: e.target.value }))} placeholder="Opcional; debe estar pendiente" /></Field>
                  <Field label="Observaciones" wide><textarea maxLength={2000} rows={3} value={renewalForm.notes}
                    onChange={(e) => setRenewalForm((p) => ({ ...p, notes: e.target.value }))} /></Field>
                </div>
                <div className="erp-mkt-actions" style={{ marginTop: 16 }}>
                  <button type="submit" className="erp-mkt-btn erp-mkt-primary" disabled={acting}>Guardar solicitud</button>
                  <button type="button" className="erp-mkt-btn" onClick={() => setRenewalFormOpen(false)}>Cancelar</button>
                </div>
              </form>
            )}
            {closeRequest && (
              <form className="erp-mkt-card erp-mkt-closure" onSubmit={submitClose}>
                <h3>{closeRequest.status === 'REJECTED' ? 'Rechazar' : 'Cancelar'} solicitud #{closeRequest.id}</h3>
                <p className="erp-mkt-hint">Solo puedes cerrar solicitudes pendientes sin una membresía nueva vinculada. Debes explicar el motivo.</p>
                <Field label="Motivo del cierre *" wide><textarea maxLength={2000} rows={3} required
                  value={closeRequest.notes} onChange={(e) => setCloseRequest((p) => ({ ...p, notes: e.target.value }))} /></Field>
                <div className="erp-mkt-actions" style={{ marginTop: 16 }}>
                  <button type="submit" className="erp-mkt-btn erp-mkt-danger" disabled={acting}>Confirmar cierre</button>
                  <button type="button" className="erp-mkt-btn" onClick={() => setCloseRequest(null)}>Volver</button>
                </div>
              </form>
            )}
            <FilterPanel title="Filtrar solicitudes"
              onSubmit={(e) => applyFilters(e, renewalDraft, setRenewalFilters, setRenewalPage)}
              onReset={() => resetFilters(EMPTY_RENEWAL_FILTERS, setRenewalDraft, setRenewalFilters, setRenewalPage)}>
              <Field label="Estado"><select value={renewalDraft.status} onChange={(e) => setRenewalDraft((p) => ({ ...p, status: e.target.value }))}>
                <option value="">Todos</option>{Object.entries(RENEWAL_STATUS).map(([key, value]) => <option key={key} value={key}>{value}</option>)}
              </select></Field>
              <Field label="ID de cliente"><input inputMode="numeric" value={renewalDraft.id_customer}
                onChange={(e) => setRenewalDraft((p) => ({ ...p, id_customer: e.target.value }))} placeholder="Todos" /></Field>
            </FilterPanel>
            {renewalData.loading && <p className="erp-mkt-hint" role="status">Cargando solicitudes…</p>}
            {renewalData.error && <p className="erp-mkt-error" role="alert">{renewalData.error}</p>}
            {!renewalData.loading && !renewalData.error && (
              <div className="erp-mkt-tablewrap"><table>
                <thead><tr><th>Cliente</th><th>Solicitud</th><th>Membresías</th><th>Estado</th><th>Fecha</th><th>Acciones</th></tr></thead>
                <tbody>{renewalData.items.map((row) => <tr key={row.id_renewal_request}>
                  <td><strong>{row.first_name} {row.last_name}</strong><small>Cliente #{row.id_customer}</small></td>
                  <td>#{row.id_renewal_request}<small>{row.notes || 'Sin observaciones'}</small></td>
                  <td>Anterior #{row.id_previous_membership}<small>Venció {dateLabel(row.previous_end_date)}</small>
                    <small>{row.id_new_membership ? `Nueva #${row.id_new_membership}` : 'Sin nueva membresía vinculada'}</small></td>
                  <td><Pill text={RENEWAL_STATUS[row.status] || row.status} kind={row.status === 'REQUESTED' ? 'warning' : 'success'} /></td>
                  <td>{timeLabel(row.requested_at)}{row.completed_at && <small>Completada {timeLabel(row.completed_at)}</small>}</td>
                  <td>{row.status === 'REQUESTED' && row.id_new_membership == null ? (
                    <div className="erp-mkt-rowbuttons">
                      <button type="button" className="erp-mkt-btn erp-mkt-small" onClick={() => setCloseRequest({ id: row.id_renewal_request, status: 'CANCELLED', notes: '' })}>Cancelar</button>
                      <button type="button" className="erp-mkt-btn erp-mkt-small erp-mkt-danger" onClick={() => setCloseRequest({ id: row.id_renewal_request, status: 'REJECTED', notes: '' })}>Rechazar</button>
                    </div>
                  ) : <span className="erp-mkt-hint">Sin cambios disponibles</span>}</td>
                </tr>)}</tbody>
              </table>{!renewalData.items.length && <Blank>No hay solicitudes para estos filtros.</Blank>}</div>
            )}
            <PageNav page={renewalPage} total={renewalData.total} busy={renewalData.loading} onChange={setRenewalPage} />
            <p className="erp-mkt-hint">Para crear la membresía pendiente, utiliza Operaciones. Para completar la renovación, registra el pago desde Finanzas.</p>
          </section>
        )}

        {canReadReports && tab === 'reports' && (
          <section aria-label="Reportes comerciales">
            <div className="erp-mkt-section-head">
              <div><h2>Indicadores y reportes</h2><p>Ventas registradas, planes vendidos, descuentos, renovaciones y resultados del seguimiento comercial.</p></div>
              <button type="button" className="erp-mkt-btn" disabled={!report || reportLoading} onClick={() => {
                try { exportReport(report); } catch (error) { notify('error', message(error)); }
              }}>Exportar CSV</button>
            </div>
            <form className="erp-mkt-filters" onSubmit={submitReport}>
              <strong>Período del reporte (fecha de Bolivia)</strong>
              <div className="erp-mkt-filtergrid">
                <Field label="Desde"><input type="date" required value={reportDraft.from} onChange={(e) => setReportDraft((p) => ({ ...p, from: e.target.value }))} /></Field>
                <Field label="Hasta"><input type="date" required value={reportDraft.to} onChange={(e) => setReportDraft((p) => ({ ...p, to: e.target.value }))} /></Field>
              </div>
              <button type="submit" className="erp-mkt-btn erp-mkt-primary">Consultar reporte</button>
            </form>
            {reportLoading && <p className="erp-mkt-hint" role="status">Calculando reporte comercial…</p>}
            {reportError && <p className="erp-mkt-error" role="alert">{reportError}</p>}
            {!reportLoading && !reportError && report && <>
              <p className="erp-mkt-hint">Período consultado: {dateLabel(report.from)} al {dateLabel(report.to)}. Solo se consideran pagos registrados.</p>
              <div className="erp-mkt-metrics">
                <div><span>Ventas confirmadas</span><strong>{count(summary.sales_count)}</strong></div>
                <div><span>Ingresos por ventas</span><strong>{money(summary.revenue)}</strong></div>
                <div><span>Renovaciones completadas</span><strong>{count(summary.completed_renewals)}</strong></div>
                <div><span>Ventas con promoción</span><strong>{count(summary.promoted_sales)}</strong></div>
                <div><span>Descuentos aplicados</span><strong>{money(summary.total_discounts)}</strong></div>
              </div>
              <div className="erp-mkt-card"><h3>Ventas por plan</h3>
                <div className="erp-mkt-tablewrap"><table><thead><tr><th>Plan</th><th>Ventas</th><th>Ingresos</th><th>Renovaciones</th><th>Con promoción</th></tr></thead>
                  <tbody>{report.sales_by_plan.map((row) => <tr key={row.id_plan}><td>{row.plan_name}</td><td>{count(row.sales_count)}</td><td>{money(row.revenue)}</td><td>{count(row.renewals)}</td><td>{count(row.promoted_sales)}</td></tr>)}</tbody></table>
                  {!report.sales_by_plan.length && <Blank>Sin ventas registradas en este período.</Blank>}</div>
              </div>
              <div className="erp-mkt-card"><h3>Promociones utilizadas</h3>
                <div className="erp-mkt-tablewrap"><table><thead><tr><th>Promoción</th><th>Usos</th><th>Descuentos</th><th>Ingresos asociados</th></tr></thead>
                  <tbody>{report.promotions.map((row) => <tr key={row.id_promotion}><td>{row.promotion_name}</td><td>{count(row.uses)}</td><td>{money(row.total_discount)}</td><td>{money(row.revenue)}</td></tr>)}</tbody></table>
                  {!report.promotions.length && <Blank>No hay promociones aplicadas a ventas del período.</Blank>}</div>
              </div>
              <div className="erp-mkt-reportgrid">
                <div className="erp-mkt-card"><h3>Resultados de seguimiento</h3>
                  <div className="erp-mkt-tablewrap"><table><thead><tr><th>Resultado</th><th>Cantidad</th></tr></thead>
                    <tbody>{report.followups_by_result.map((row) => <tr key={row.result}><td>{RESULTS[row.result] || row.result}</td><td>{count(row.total)}</td></tr>)}</tbody></table>
                    {!report.followups_by_result.length && <Blank>Sin seguimientos en el período.</Blank>}</div>
                </div>
                <div className="erp-mkt-card"><h3>Solicitudes por estado</h3>
                  <div className="erp-mkt-tablewrap"><table><thead><tr><th>Estado</th><th>Cantidad</th></tr></thead>
                    <tbody>{report.renewal_requests_by_status.map((row) => <tr key={row.status}><td>{RENEWAL_STATUS[row.status] || row.status}</td><td>{count(row.total)}</td></tr>)}</tbody></table>
                    {!report.renewal_requests_by_status.length && <Blank>Sin solicitudes en el período.</Blank>}</div>
                </div>
              </div>
            </>}
          </section>
        )}
        <div className="erp-mkt-footer">Las solicitudes comerciales no sustituyen el registro de membresías ni los pagos de Finanzas. La autorización se verifica en el servidor.</div>
      </main>
      <Confirm value={confirm} busy={acting} cancel={() => setConfirm(null)} accept={handleConfirm} />
    </div>
  );
}

const css = `
.erp-mkt-page{min-height:100vh;background:radial-gradient(circle at 90% 3%,rgba(185,0,48,.12),transparent 36%),#0b0b0e;color:#f3f3f5;font-family:'Segoe UI',Arial,sans-serif}
.erp-mkt-page *{box-sizing:border-box}.erp-mkt-main{margin-left:245px;padding:38px 38px 85px;max-width:1850px}
.erp-mkt-page h1{font-size:33px;letter-spacing:-.7px;line-height:1.2;margin:8px 0 10px}
.erp-mkt-page h2{font-size:23px;letter-spacing:-.25px;margin:0 0 9px}.erp-mkt-page h3{font-size:17px;margin:0 0 11px}
.erp-mkt-page p{line-height:1.55}.erp-mkt-eyebrow{color:#fa718d;font-weight:800;letter-spacing:1.6px;font-size:11px}
.erp-mkt-subtitle,.erp-mkt-section-head p,.erp-mkt-hint,.erp-mkt-footer{color:#b1b1bc;font-size:13px;line-height:1.55}
.erp-mkt-top,.erp-mkt-section-head,.erp-mkt-actions,.erp-mkt-paging{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
.erp-mkt-section-head{margin:23px 0 18px;align-items:start}.erp-mkt-section-head p{margin:3px 0 0}
.erp-mkt-actions{justify-content:flex-start;gap:8px}.erp-mkt-btn{appearance:none;cursor:pointer;color:#f4f4f6;background:#252529;border:1px solid #44444e;border-radius:8px;padding:11px 15px;font-size:13px;font-weight:700;line-height:1.2;transition:background .15s,border-color .15s}
.erp-mkt-btn:hover:not(:disabled){background:#34343b;border-color:#656571}.erp-mkt-btn:disabled{opacity:.5;cursor:not-allowed}
.erp-mkt-primary{background:#ba123e;border-color:#ba123e;color:white}.erp-mkt-primary:hover:not(:disabled){background:#d8174d;border-color:#d8174d}
.erp-mkt-small{padding:7px 10px;font-size:12px}.erp-mkt-danger{border-color:#9d4455;background:#3c2229;color:#ffd7df}
.erp-mkt-notice{background:#192d25;border:1px solid #39664d;border-radius:10px;padding:13px 15px;color:#d1f5dd;display:flex;justify-content:space-between;gap:14px;align-items:center;margin:17px 0}
.erp-mkt-notice.error,.erp-mkt-error{background:#342126;border:1px solid #985269;color:#ffd9e0;border-radius:10px;padding:12px 14px}
.erp-mkt-notice button{border:0;background:transparent;color:inherit;cursor:pointer;font-size:17px}
.erp-mkt-tabs{display:flex;gap:6px;flex-wrap:wrap;background:#1a1a1f;border:1px solid #35353c;border-radius:11px;padding:5px;width:fit-content;margin:25px 0 23px}
.erp-mkt-tabs button{border:0;cursor:pointer;background:transparent;color:#bcbcc5;border-radius:8px;padding:12px 15px;font-size:13px;font-weight:700}
.erp-mkt-tabs button.selected{background:#bb133f;color:white}.erp-mkt-page :focus-visible{outline:2px solid #f97e9f;outline-offset:2px}
.erp-mkt-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(195px,1fr));gap:14px;margin:19px 0}
.erp-mkt-metrics>div{display:flex;flex-direction:column;gap:12px;padding:22px 20px;background:#1a1a1e;border:1px solid #36363f;border-radius:12px}
.erp-mkt-metrics span{font-size:12px;color:#b5b5c1;font-weight:700}.erp-mkt-metrics strong{font-size:25px;line-height:1.3;overflow-wrap:anywhere}
.erp-mkt-filters,.erp-mkt-card{margin:18px 0;padding:22px;background:#19191d;border:1px solid #383841;border-radius:13px}
.erp-mkt-filters{display:flex;flex-direction:column;gap:16px}.erp-mkt-filtergrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px}
.erp-mkt-formgrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:15px;margin-top:16px}.erp-mkt-span{grid-column:1/-1}
.erp-mkt-field{display:flex;flex-direction:column;gap:6px;font-size:13px;font-weight:650;color:#dddde4;min-width:0}
.erp-mkt-field input,.erp-mkt-field select,.erp-mkt-field textarea{min-height:42px;width:100%;min-width:0;background:#242429;border:1px solid #4b4b56;color:#fbfbfc;border-radius:8px;padding:10px 12px;font:inherit;font-weight:400}
.erp-mkt-field textarea{resize:vertical;min-height:92px}.erp-mkt-field small{color:#a6a6af;font-size:11px;font-weight:400}
.erp-mkt-tablewrap{overflow-x:auto;border:1px solid #393942;border-radius:10px;margin:16px 0 9px}
.erp-mkt-tablewrap table{border-collapse:collapse;width:100%;min-width:740px;font-size:13px;text-align:left}
.erp-mkt-tablewrap th{font-size:12px;white-space:nowrap;color:#c1c1cb;background:#242429;padding:13px 14px;border-bottom:1px solid #45454e}
.erp-mkt-tablewrap td{padding:15px 14px;vertical-align:top;border-bottom:1px solid #34343c;line-height:1.6;overflow-wrap:anywhere}
.erp-mkt-tablewrap tbody tr:last-child td{border-bottom:0}.erp-mkt-tablewrap tr:hover td{background:#1e1e23}
.erp-mkt-tablewrap td small{display:block;margin-top:4px;color:#a9a9b4;font-size:11px}.erp-mkt-tablewrap td strong{font-size:13px}
.erp-mkt-notes{max-width:400px;white-space:normal;word-break:break-word}
.erp-mkt-pill{display:inline-flex;padding:4px 9px;font-weight:750;font-size:11px;white-space:nowrap;border-radius:99px;color:#d6d5ee;background:#363540}
.erp-mkt-pill.warning{background:#44351b;color:#f5d69b}.erp-mkt-pill.danger{background:#4b2630;color:#ffc1cd}.erp-mkt-pill.success{background:#203d34;color:#b5e8d0}
.erp-mkt-rowbuttons{display:flex;align-items:start;gap:6px;flex-wrap:wrap;min-width:170px}
.erp-mkt-empty{padding:28px 16px;text-align:center;color:#b9b9c3;margin:0}.erp-mkt-paging{margin:16px 0 25px;color:#b2b2be;font-size:12px}
.erp-mkt-closure{border-color:#ad5065}.erp-mkt-overlay{position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.82);display:flex;align-items:center;justify-content:center;padding:18px}
.erp-mkt-dialog{width:min(100%,500px);max-height:90vh;overflow:auto;padding:27px;border-radius:14px;background:#1e1e24;border:1px solid #5e5661;box-shadow:0 25px 80px #0009}
.erp-mkt-dialog p{font-size:14px;line-height:1.65;color:#ccccd6}.erp-mkt-dialog-actions{margin-top:24px;justify-content:flex-end}
.erp-mkt-reportgrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.erp-mkt-footer{padding-top:26px;border-top:1px solid #303037;margin-top:36px}
@media(max-width:1000px){.erp-mkt-main{padding:30px 22px;margin-left:245px}.erp-mkt-reportgrid{grid-template-columns:1fr}}
@media(max-width:760px){.erp-mkt-main{margin-left:0;padding:26px 14px 65px}.erp-mkt-page .sidebar{position:static;width:100%;height:auto;min-height:auto}.erp-mkt-page{display:block}.erp-mkt-formgrid{grid-template-columns:1fr}.erp-mkt-span{grid-column:auto}.erp-mkt-page h1{font-size:27px}.erp-mkt-card,.erp-mkt-filters{padding:17px}}
`;
