import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import { API_URL } from '../config/api';
import { clearErpSession, erpRequest } from '../config/erpApi';

// GymMqs - ERP / Marketing y Ventas / Promociones.
// No modifica Caja ni registra pagos. El backend valida permisos, precios y transacciones.
const PAGE_SIZE = 15;
const MAX_ID = 2147483647;
const MAX_DISCOUNT_CENTS = 999999999999n;
const EMPTY_FILTERS = { search: '', id_plan: '', status: '', valid_today: '' };
const EMPTY_HISTORY_FILTERS = { id_promotion: '', id_membership: '' };
const TYPE_NAMES = {
  PERCENTAGE: 'Porcentaje',
  FIXED_AMOUNT: 'Importe fijo',
  NON_MONETARY: 'Beneficio no monetario',
};
const STATUS_NAMES = { ACTIVE: 'Activa', INACTIVE: 'Inactiva' };
const moneyFormat = new Intl.NumberFormat('es-BO', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function todayInBolivia() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const part = (key) => parts.find((item) => item.type === key)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function addDays(date, amount) {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + amount);
  return parsed.toISOString().slice(0, 10);
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function dateOnly(value) {
  return typeof value === 'string' ? value.slice(0, 10) : '';
}

function showDate(value) {
  const day = dateOnly(value);
  return validDate(day) ? `${day.slice(8)}/${day.slice(5, 7)}/${day.slice(0, 4)}` : '—';
}

function showDateTime(value) {
  if (!value) return '—';
  const text = String(value);
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)
    ? `${text.replace(' ', 'T')}Z` : text;
  const date = new Date(iso);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('es-BO', {
      timeZone: 'America/La_Paz', dateStyle: 'short', timeStyle: 'short',
    }).format(date)
    : text;
}

function positiveId(value) {
  const raw = String(value ?? '');
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const number = Number(raw);
  return Number.isSafeInteger(number) && number <= MAX_ID ? number : null;
}

function cents(value, allowZero = false) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const raw = String(value).trim().replace(',', '.');
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(raw)) return null;
  const [whole, fraction = ''] = raw.split('.');
  const result = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (result > MAX_DISCOUNT_CENTS || (!allowZero && result === 0n)) return null;
  return result;
}

function decimal(c) {
  return `${c / 100n}.${String(c % 100n).padStart(2, '0')}`;
}

function money(value) {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  return Number.isFinite(number) ? `Bs ${moneyFormat.format(number)}` : '—';
}

function discountLabel(promo) {
  if (promo.discount_type === 'PERCENTAGE') return `${Number(promo.discount_value)} %`;
  if (promo.discount_type === 'FIXED_AMOUNT') return money(promo.discount_value);
  return 'Beneficio';
}

function normalizeRole(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

function sessionUser() {
  try {
    const result = JSON.parse(window.localStorage.getItem('user') || 'null');
    return result && typeof result === 'object' && !Array.isArray(result) ? result : null;
  } catch {
    return null;
  }
}

function errorText(error) {
  return typeof error?.message === 'string' && error.message.trim()
    ? error.message : 'No fue posible completar la operación.';
}

function wasCancelled(error) {
  return error?.name === 'AbortError' || error?.code === 'REQUEST_CANCELLED';
}

function initialForm() {
  const today = todayInBolivia();
  return {
    id_plan: '', name: '', description: '', discount_type: 'PERCENTAGE',
    discount_value: '', start_date: today, end_date: addDays(today, 30), status: 'ACTIVE',
  };
}

// erpRequest está restringido intencionalmente a /api/erp/... . Para leer los
// planes/membresías reutilizamos las rutas existentes de Operaciones y su JWT.
async function operationsGet(path, signal) {
  if (path !== '/membership-plans' && path !== '/memberships') {
    throw new Error('Ruta de Operaciones no permitida.');
  }
  const token = window.sessionStorage.getItem('authToken');
  if (!token) {
    clearErpSession();
    throw new Error('Tu sesión venció. Inicia sesión nuevamente.');
  }
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', cancel, { once: true });
  let timedOut = false;
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 20000);
  try {
    const response = await fetch(`${API_URL}${path}`, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      cache: 'no-store', credentials: 'omit', signal: controller.signal,
    });
    if (response.status === 401) {
      clearErpSession();
      throw new Error('La sesión ya no es válida. Inicia sesión nuevamente.');
    }
    const content = await response.text();
    let payload = null;
    if (content.trim()) {
      try { payload = JSON.parse(content); }
      catch { throw new Error('El servidor devolvió datos que no son JSON.'); }
    }
    if (!response.ok) {
      throw new Error(response.status >= 500
        ? 'El servidor no pudo consultar los registros de Operaciones.'
        : (typeof payload?.message === 'string' && payload.message) ||
          `No se pudo consultar Operaciones (HTTP ${response.status}).`);
    }
    if (!Array.isArray(payload)) throw new Error('Operaciones devolvió una lista con formato inesperado.');
    return payload;
  } catch (error) {
    if (error?.name === 'AbortError' && timedOut) {
      throw new Error('La consulta de Operaciones excedió el tiempo de espera.', { cause: error });
    }
    if (error instanceof TypeError) {
      throw new Error('No se pudo conectar con el backend. Comprueba que esté iniciado.', { cause: error });
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
  }
}

function validateForm(data, plans) {
  const idPlan = positiveId(data.id_plan);
  if (!idPlan) return 'Selecciona un plan válido.';
  const plan = plans.find((item) => Number(item.id_plan) === idPlan);
  if (!plan) return 'El plan seleccionado no está disponible en la lista.';
  const name = data.name.trim().replace(/\s+/g, ' ');
  const containsControl = (text) => Array.from(text).some((letter) => {
    const code = letter.charCodeAt(0);
    return code <= 31 || code === 127;
  });
  if (name.length < 3 || name.length > 100 || containsControl(name)) {
    return 'El nombre debe tener entre 3 y 100 caracteres, sin saltos de línea.';
  }
  const description = data.description.trim().replace(/\s+/g, ' ');
  if (description.length > 255 || containsControl(description)) {
    return 'La descripción no puede superar 255 caracteres ni contener caracteres de control.';
  }
  if (!validDate(data.start_date) || !validDate(data.end_date)) return 'Selecciona fechas válidas.';
  if (data.end_date < data.start_date) return 'La fecha final no puede ser anterior a la inicial.';
  const amount = cents(data.discount_value, true);
  if (amount === null) return 'El valor del descuento debe tener como máximo dos decimales.';
  if (data.discount_type === 'PERCENTAGE' && (amount <= 0n || amount >= 10000n)) {
    return 'El descuento porcentual debe ser mayor a 0 y menor a 100 %.';
  }
  if (data.discount_type === 'FIXED_AMOUNT') {
    if (amount <= 0n) return 'El descuento fijo debe ser mayor a cero.';
    const planPrice = cents(plan.price);
    if (planPrice !== null && amount >= planPrice) {
      return 'El descuento fijo debe ser menor al precio actual del plan.';
    }
  }
  if (data.discount_type === 'NON_MONETARY') {
    if (amount !== 0n) return 'El beneficio no monetario debe tener valor 0.00.';
    if (!description) return 'Describe en qué consiste el beneficio no monetario.';
  }
  if (data.status === 'ACTIVE' && plan.status !== 'ACTIVE') {
    return 'No puedes activar promociones de un plan inactivo.';
  }
  return '';
}

function cleanFilters(filters) {
  return Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== ''));
}

const styles = `
.erp-promo-page{background:radial-gradient(circle at 89% 5%,rgba(192,0,43,.13),transparent 34%),#0a0a0b;color:#f5f5f7;min-height:100vh;font-family:'Segoe UI',Arial,sans-serif}
.erp-promo-page *{box-sizing:border-box}.erp-promo-main{margin-left:245px;padding:36px 38px 90px;max-width:1840px}
.erp-promo-page h1{font-size:32px;line-height:1.18;margin:8px 0 10px;letter-spacing:-.6px}.erp-promo-page h2{font-size:21px;margin:0 0 8px}
.erp-promo-page h3{font-size:16px;margin:0 0 8px}.erp-promo-page p{line-height:1.55}.erp-promo-muted{color:#a8a8b2;font-size:13px;line-height:1.55}
.erp-promo-kicker{color:#fa6482;letter-spacing:1.8px;font-size:11px;font-weight:800}.erp-promo-top,.erp-promo-between,.erp-promo-actions{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap}
.erp-promo-actions{justify-content:flex-start}.erp-promo-btn{appearance:none;background:#27272b;border:1px solid #44444c;border-radius:9px;color:#f5f5f7;cursor:pointer;padding:10px 14px;font-size:13px;font-weight:700;transition:background .15s,border-color .15s}
.erp-promo-btn:hover:not(:disabled){background:#36363c;border-color:#656571}.erp-promo-btn:disabled{opacity:.48;cursor:not-allowed}
.erp-promo-primary{background:#c00030;border-color:#c00030;color:#fff}.erp-promo-primary:hover:not(:disabled){background:#df1248;border-color:#df1248}
.erp-promo-small{padding:7px 10px;font-size:12px}.erp-promo-ghost{background:transparent}.erp-promo-danger{color:#ffd4db;border-color:#a54157;background:#3a2028}
.erp-promo-card{background:#17171a;border:1px solid #34343b;border-radius:14px;padding:24px;margin:20px 0;box-shadow:0 10px 26px rgba(0,0,0,.08)}
.erp-promo-cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin:25px 0 16px}.erp-promo-stat{background:#17171a;border:1px solid #32323a;padding:20px;border-radius:12px;display:flex;flex-direction:column;gap:10px}
.erp-promo-stat span{color:#a7a7b4;font-size:12px;font-weight:650}.erp-promo-stat strong{font-size:28px;line-height:1.1;letter-spacing:-.5px}
.erp-promo-tabs{display:flex;flex-wrap:wrap;gap:5px;padding:5px;background:#19191c;border:1px solid #33333a;border-radius:10px;width:fit-content;margin:24px 0}
.erp-promo-tabs button{border:0;background:transparent;color:#b9b9c4;cursor:pointer;padding:11px 15px;border-radius:7px;font-size:13px;font-weight:750}
.erp-promo-tabs button[aria-selected=true]{background:#c00030;color:#fff}.erp-promo-tabs button:focus-visible{outline:2px solid #ff809c}
.erp-promo-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.erp-promo-span{grid-column:1/-1}.erp-promo-field{display:flex;flex-direction:column;gap:7px;font-size:13px;color:#d8d8df;font-weight:650}
.erp-promo-field input,.erp-promo-field select,.erp-promo-field textarea{min-width:0;width:100%;border:1px solid #45454e;background:#222226;color:#fafafa;border-radius:9px;padding:11px 12px;font:inherit;font-weight:400}
.erp-promo-field textarea{min-height:85px;resize:vertical}.erp-promo-field input:focus,.erp-promo-field select:focus,.erp-promo-field textarea:focus{outline:2px solid #974257;outline-offset:1px;border-color:#e33e69}
.erp-promo-field small{font-size:11px;color:#a8a8b2;font-weight:400}.erp-promo-field :disabled{opacity:.57;cursor:not-allowed}
.erp-promo-tablebox{overflow:auto;border:1px solid #37373f;border-radius:10px;margin-top:16px}.erp-promo-table{border-collapse:collapse;width:100%;min-width:800px;font-size:13px}
.erp-promo-table th{text-align:left;background:#222227;color:#bfbfc9;font-size:12px;letter-spacing:.2px;white-space:nowrap;padding:13px 14px;border-bottom:1px solid #3c3c43}
.erp-promo-table td{padding:15px 14px;border-top:1px solid #33333a;vertical-align:middle}.erp-promo-table tbody tr:hover{background:#202025}.erp-promo-table .erp-promo-cell-sub{display:block;font-size:11px;margin-top:4px;color:#9d9daa}
.erp-promo-tag{display:inline-block;white-space:nowrap;padding:5px 9px;border-radius:6px;font-size:11px;font-weight:800;background:#323238;color:#dedee7}
.erp-promo-tag.active{background:rgba(35,157,106,.15);color:#89dfb0;border:1px solid rgba(35,157,106,.35)}.erp-promo-tag.inactive{background:#37272d;color:#ffc1cc;border:1px solid #754554}
.erp-promo-notice{position:sticky;top:8px;z-index:5;margin:18px 0;border:1px solid #456b5a;background:#173329;color:#b7f5d0;border-radius:10px;padding:13px 15px;font-size:13px;display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.erp-promo-notice.error{border-color:#9f4c62;background:#371d25;color:#ffd0db}.erp-promo-notice button{color:inherit;border:0;background:none;cursor:pointer;font-weight:800}
.erp-promo-empty{text-align:center;padding:35px 18px;color:#b0b0bd;font-size:13px}.erp-promo-pagination{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:14px;margin-top:16px;color:#b7b7c0;font-size:12px}
.erp-promo-kv{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.erp-promo-kv div{padding:12px;border:1px solid #3c3c44;border-radius:8px;background:#202025}.erp-promo-kv span{display:block;font-size:11px;color:#a6a6b3;margin-bottom:7px}.erp-promo-kv strong{font-size:15px;overflow-wrap:anywhere}
.erp-promo-overlay{position:fixed;inset:0;background:rgba(0,0,0,.76);display:grid;place-items:center;padding:22px;z-index:1000}.erp-promo-dialog{width:min(100%,580px);max-height:90vh;overflow:auto;background:#1b1b20;color:#fafafa;border:1px solid #55505a;border-radius:14px;padding:26px;box-shadow:0 20px 70px rgba(0,0,0,.5)}
.erp-promo-checkbox{display:flex;gap:9px;align-items:flex-start;color:#dbdbe0;font-size:13px;line-height:1.5}.erp-promo-checkbox input{accent-color:#c00030;margin-top:4px}
.erp-promo-note{background:#232329;border-left:3px solid #d4355f;padding:13px 15px;border-radius:6px;margin-top:15px;font-size:12px;color:#cacad4;line-height:1.55}
.erp-promo-link{color:#ffa7bc;background:none;border:0;text-decoration:underline;cursor:pointer;font:inherit;padding:0}
@media(max-width:1000px){.erp-promo-main{margin-left:245px;padding:28px 21px}.erp-promo-cards{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:760px){.erp-promo-main{margin-left:0;padding:26px 16px}.erp-promo-page .sidebar{position:static;width:100%;height:auto;min-height:auto}.erp-promo-page{display:block}.erp-promo-grid,.erp-promo-cards,.erp-promo-kv{grid-template-columns:1fr}.erp-promo-span{grid-column:auto}.erp-promo-card{padding:18px}.erp-promo-page h1{font-size:26px}}
`;

function Notice({ notice, dismiss }) {
  if (!notice) return null;
  return <div className={`erp-promo-notice ${notice.type === 'error' ? 'error' : ''}`} role={notice.type === 'error' ? 'alert' : 'status'}>
    <span>{notice.message}</span>
    <button type="button" aria-label="Cerrar mensaje" onClick={dismiss}>✕</button>
  </div>;
}

function ConfirmDialog({ title, description, confirmText, danger, busy, onCancel, onConfirm }) {
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape' && !busy) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);
  return <div className="erp-promo-overlay" onMouseDown={(event) => {
    if (event.target === event.currentTarget && !busy) onCancel();
  }} role="presentation">
    <section className="erp-promo-dialog" role="dialog" aria-modal="true" aria-labelledby="erp-promo-confirm-title">
      <h2 id="erp-promo-confirm-title">{title}</h2>
      <p className="erp-promo-muted">{description}</p>
      <div className="erp-promo-actions" style={{ justifyContent: 'flex-end', marginTop: 26 }}>
        <button type="button" className="erp-promo-btn" onClick={onCancel} disabled={busy} autoFocus>Volver</button>
        <button type="button" className={`erp-promo-btn ${danger ? 'erp-promo-danger' : 'erp-promo-primary'}`} onClick={onConfirm} disabled={busy}>
          {busy ? 'Guardando…' : confirmText}
        </button>
      </div>
    </section>
  </div>;
}

export default function ErpPromotions() {
  const navigate = useNavigate();
  const [actor] = useState(sessionUser);
  const role = normalizeRole(actor?.role);
  const canManage = role === 'administrador' || role === 'admin';
  const canUseMarketing = canManage || role === 'recepcion' || role === 'recepcionista';

  const [tab, setTab] = useState('promotions');
  const [notice, setNotice] = useState(null);
  const [plans, setPlans] = useState([]);
  const [plansError, setPlansError] = useState('');
  const [plansLoading, setPlansLoading] = useState(true);

  const [filtersDraft, setFiltersDraft] = useState(EMPTY_FILTERS);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [promotions, setPromotions] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [reload, setReload] = useState(0);

  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(initialForm);
  const [formError, setFormError] = useState('');
  const [detail, setDetail] = useState(null);
  const [detailError, setDetailError] = useState('');
  const [detailBusy, setDetailBusy] = useState(false);
  const [confirmStatus, setConfirmStatus] = useState(null);

  const [memberships, setMemberships] = useState([]);
  const [membershipsLoading, setMembershipsLoading] = useState(false);
  const [membershipsError, setMembershipsError] = useState('');
  const [selectedMembership, setSelectedMembership] = useState('');
  const [availablePromos, setAvailablePromos] = useState([]);
  const [availableError, setAvailableError] = useState('');
  const [availableLoading, setAvailableLoading] = useState(false);
  const [selectedPromotion, setSelectedPromotion] = useState('');
  const [quote, setQuote] = useState(null);
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [applyConfirmed, setApplyConfirmed] = useState(false);

  const [historyDraft, setHistoryDraft] = useState(EMPTY_HISTORY_FILTERS);
  const [historyFilters, setHistoryFilters] = useState(EMPTY_HISTORY_FILTERS);
  const [historyPage, setHistoryPage] = useState(1);
  const [history, setHistory] = useState([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [historyReload, setHistoryReload] = useState(0);

  const [saving, setSaving] = useState(false);
  const actionLock = useRef(false);
  const quoteVersion = useRef(0);

  const notify = useCallback((type, message) => setNotice({ type, message }), []);
  const requestPromos = useCallback((path, options) => erpRequest(path, options), []);

  const planById = useMemo(() => new Map(plans.map((item) => [Number(item.id_plan), item])), [plans]);
  const pending = useMemo(() => memberships.filter((item) => item.status === 'PENDING'), [memberships]);
  const chosenMembership = useMemo(() => pending.find((item) =>
    String(item.id_membership) === selectedMembership), [pending, selectedMembership]);
  const today = todayInBolivia();

  useEffect(() => {
    const abort = new AbortController();
    Promise.resolve().then(() => { if (!abort.signal.aborted) setPlansLoading(true); });
    operationsGet('/membership-plans', abort.signal)
      .then((data) => { if (!abort.signal.aborted) { setPlans(data); setPlansError(''); } })
      .catch((error) => { if (!abort.signal.aborted) setPlansError(errorText(error)); })
      .finally(() => { if (!abort.signal.aborted) setPlansLoading(false); });
    return () => abort.abort();
  }, []);

  useEffect(() => {
    if (tab !== 'promotions') return undefined;
    const abort = new AbortController();
    Promise.resolve().then(() => {
      if (!abort.signal.aborted) { setLoading(true); setListError(''); }
    });
    requestPromos('/api/erp/promotions', {
      params: { ...cleanFilters(filters), page, limit: PAGE_SIZE }, signal: abort.signal,
    }).then((data) => {
      if (abort.signal.aborted) return;
      if (!Array.isArray(data?.items)) throw new Error('Listado de promociones inválido.');
      setPromotions(data.items);
      setTotal(Number(data.total) || 0);
    }).catch((error) => {
      if (!abort.signal.aborted && !wasCancelled(error)) setListError(errorText(error));
    }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [tab, filters, page, reload, requestPromos]);

  useEffect(() => {
    if (tab !== 'apply') return undefined;
    const abort = new AbortController();
    Promise.resolve().then(() => {
      if (!abort.signal.aborted) { setMembershipsLoading(true); setMembershipsError(''); }
    });
    operationsGet('/memberships', abort.signal)
      .then((items) => { if (!abort.signal.aborted) setMemberships(items); })
      .catch((error) => { if (!abort.signal.aborted) setMembershipsError(errorText(error)); })
      .finally(() => { if (!abort.signal.aborted) setMembershipsLoading(false); });
    return () => abort.abort();
  }, [tab, reload]);

  useEffect(() => {
    if (tab !== 'apply' || !chosenMembership || !positiveId(chosenMembership.id_plan)) return undefined;
    const abort = new AbortController();
    Promise.resolve().then(() => {
      if (!abort.signal.aborted) {
        setAvailableLoading(true); setAvailableError(''); setAvailablePromos([]);
      }
    });
    const load = async () => {
      const all = [];
      let p = 1;
      let count;
      do {
        const data = await requestPromos('/api/erp/promotions', {
          params: { id_plan: chosenMembership.id_plan, status: 'ACTIVE', valid_today: true, page: p, limit: 100 },
          signal: abort.signal,
        });
        if (!Array.isArray(data?.items)) throw new Error('Las promociones disponibles no tienen el formato esperado.');
        all.push(...data.items);
        count = Number(data.total) || 0;
        p += 1;
        if (p > 40 && all.length < count) throw new Error('Hay demasiadas promociones. Comunícate con Administración para reducir la lista.');
      } while (all.length < count && !abort.signal.aborted);
      if (!abort.signal.aborted) setAvailablePromos(all);
    };
    load().catch((error) => {
      if (!abort.signal.aborted && !wasCancelled(error)) setAvailableError(errorText(error));
    }).finally(() => { if (!abort.signal.aborted) setAvailableLoading(false); });
    return () => abort.abort();
  }, [tab, chosenMembership, reload, requestPromos]);

  useEffect(() => {
    if (tab !== 'history') return undefined;
    const abort = new AbortController();
    Promise.resolve().then(() => {
      if (!abort.signal.aborted) { setHistoryLoading(true); setHistoryError(''); }
    });
    requestPromos('/api/erp/promotions/applications', {
      params: { ...cleanFilters(historyFilters), page: historyPage, limit: PAGE_SIZE },
      signal: abort.signal,
    }).then((data) => {
      if (abort.signal.aborted) return;
      if (!Array.isArray(data?.items)) throw new Error('Historial de promociones inválido.');
      setHistory(data.items);
      setHistoryTotal(Number(data.total) || 0);
    }).catch((error) => {
      if (!abort.signal.aborted && !wasCancelled(error)) setHistoryError(errorText(error));
    }).finally(() => { if (!abort.signal.aborted) setHistoryLoading(false); });
    return () => abort.abort();
  }, [tab, historyFilters, historyPage, historyReload, requestPromos]);

  const sendAction = async (callback, successMessage) => {
    if (actionLock.current) return false;
    actionLock.current = true;
    setSaving(true);
    setNotice(null);
    try {
      await callback();
      notify('success', successMessage);
      return true;
    } catch (error) {
      notify('error', errorText(error));
      return false;
    } finally {
      actionLock.current = false;
      setSaving(false);
    }
  };

  const changeTab = (nextTab) => {
    if (nextTab !== 'apply') {
      quoteVersion.current += 1;
      setQuote(null);
      setApplyConfirmed(false);
      setSelectedPromotion('');
    }
    setTab(nextTab);
  };

  const applyListFilters = (event) => {
    event.preventDefault();
    const search = filtersDraft.search.trim();
    if (search.length > 100) return notify('error', 'La búsqueda admite como máximo 100 caracteres.');
    setFilters({ ...filtersDraft, search });
    setPage(1);
    setNotice(null);
  };

  const showNewForm = () => {
    setEditId(null);
    setForm(initialForm());
    setFormError('');
    setFormOpen(true);
  };

  const showEditForm = (promo) => {
    setEditId(Number(promo.id_promotion));
    setForm({
      id_plan: String(promo.id_plan), name: promo.name ?? '', description: promo.description ?? '',
      discount_type: promo.discount_type, discount_value: String(promo.discount_value ?? ''),
      start_date: dateOnly(promo.start_date), end_date: dateOnly(promo.end_date), status: promo.status,
    });
    setFormError('');
    setFormOpen(true);
  };

  const submitForm = async (event) => {
    event.preventDefault();
    if (!canManage) return notify('error', 'Solo Administración puede gestionar promociones.');
    const validation = validateForm(form, plans);
    if (validation) { setFormError(validation); return; }
    setFormError('');
    const amount = cents(form.discount_value, true);
    const payload = {
      id_plan: Number(form.id_plan), name: form.name.trim().replace(/\s+/g, ' '),
      description: form.description.trim().replace(/\s+/g, ' ') || null,
      discount_type: form.discount_type, discount_value: decimal(amount),
      start_date: form.start_date, end_date: form.end_date,
    };
    if (editId === null) payload.status = form.status;
    const created = editId === null;
    const ok = await sendAction(() => requestPromos(created
      ? '/api/erp/promotions' : `/api/erp/promotions/${editId}`, {
      method: created ? 'POST' : 'PATCH', body: payload,
    }), created ? 'Promoción creada correctamente.' : 'Promoción actualizada correctamente.');
    if (ok) {
      setFormOpen(false);
      setEditId(null);
      setPage(1);
      setFilters(EMPTY_FILTERS);
      setFiltersDraft(EMPTY_FILTERS);
      setReload((n) => n + 1);
    }
  };

  const openDetails = async (promoId) => {
    setDetail(null);
    setDetailError('');
    setDetailBusy(true);
    try {
      const data = await requestPromos(`/api/erp/promotions/${promoId}`);
      setDetail(data);
    } catch (error) { setDetailError(errorText(error)); }
    finally { setDetailBusy(false); }
  };

  const submitStatus = async () => {
    if (!confirmStatus || !canManage) return;
    const { id_promotion, status } = confirmStatus;
    const nextStatus = status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    const ok = await sendAction(() => requestPromos(`/api/erp/promotions/${id_promotion}/status`, {
      method: 'PATCH', body: { status: nextStatus },
    }), nextStatus === 'ACTIVE' ? 'Promoción activada.' : 'Promoción desactivada.');
    if (ok) {
      setConfirmStatus(null);
      setDetail(null);
      setReload((n) => n + 1);
    }
  };

  const submitQuote = async (event) => {
    event.preventDefault();
    if (!positiveId(selectedMembership) || !positiveId(selectedPromotion)) {
      return notify('error', 'Selecciona una membresía pendiente y una promoción vigente.');
    }
    const version = ++quoteVersion.current;
    setQuoteBusy(true);
    setQuote(null);
    setApplyConfirmed(false);
    setNotice(null);
    try {
      const result = await requestPromos('/api/erp/promotions/quote', {
        method: 'POST', body: {
          id_membership: Number(selectedMembership), id_promotion: Number(selectedPromotion),
        },
      });
      if (quoteVersion.current === version) setQuote(result);
    } catch (error) {
      if (quoteVersion.current === version) notify('error', errorText(error));
    } finally { if (quoteVersion.current === version) setQuoteBusy(false); }
  };

  const submitApply = async () => {
    if (!canUseMarketing || !applyConfirmed || !quote ||
      String(quote.id_membership) !== selectedMembership ||
      String(quote.id_promotion) !== selectedPromotion) {
      return notify('error', 'Vuelve a cotizar y confirma los datos antes de aplicar.');
    }
    const ok = await sendAction(() => requestPromos('/api/erp/promotions/apply', {
      method: 'POST',
      body: { id_membership: Number(selectedMembership), id_promotion: Number(selectedPromotion) },
    }), 'Promoción aplicada y precio de la membresía actualizado. Finanzas podrá cobrar el nuevo importe.');
    if (ok) {
      setQuote(null);
      setApplyConfirmed(false);
      setSelectedMembership('');
      setSelectedPromotion('');
      setAvailablePromos([]);
      setReload((n) => n + 1);
      setHistoryReload((n) => n + 1);
    }
  };

  const submitHistoryFilters = (event) => {
    event.preventDefault();
    if ((historyDraft.id_promotion && !positiveId(historyDraft.id_promotion)) ||
        (historyDraft.id_membership && !positiveId(historyDraft.id_membership))) {
      return notify('error', 'Los filtros del historial deben ser identificadores positivos válidos.');
    }
    setHistoryFilters({ ...historyDraft });
    setHistoryPage(1);
    setNotice(null);
  };

  const listActive = promotions.filter((p) => p.status === 'ACTIVE').length;
  const listCurrent = promotions.filter((p) => Number(p.is_current) === 1).length;
  const listPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const historyPages = Math.max(1, Math.ceil(historyTotal / PAGE_SIZE));

  return <div className="erp-promo-page">
    <style>{styles}</style>
    <Sidebar />
    <main className="erp-promo-main">
      <header className="erp-promo-top">
        <div>
          <span className="erp-promo-kicker">GIMNASIO MQS · ERP · MARKETING Y VENTAS</span>
          <h1>Promociones</h1>
          <p className="erp-promo-muted" style={{ margin: 0 }}>
            Gestiona ofertas, cotiza descuentos y conserva su historial. Los pagos se registran únicamente en Finanzas.
          </p>
        </div>
        <div className="erp-promo-actions">
          <button type="button" className="erp-promo-btn" onClick={() => navigate('/operations')}>Ir a Operaciones</button>
          <button type="button" className="erp-promo-btn" onClick={() => {
            if (tab === 'promotions') setReload((n) => n + 1);
            else if (tab === 'history') setHistoryReload((n) => n + 1);
            else { quoteVersion.current += 1; setQuote(null); setApplyConfirmed(false); setSelectedPromotion(''); setReload((n) => n + 1); }
          }} disabled={saving}>Actualizar</button>
          {canManage && tab === 'promotions' && <button type="button" className="erp-promo-btn erp-promo-primary" onClick={showNewForm}>+ Nueva promoción</button>}
        </div>
      </header>

      <Notice notice={notice} dismiss={() => setNotice(null)} />
      {plansError && <div className="erp-promo-notice error" role="alert">No se pudieron cargar los planes: {plansError}</div>}
      <div className="erp-promo-cards" aria-label="Resumen de promociones en la página consultada">
        <div className="erp-promo-stat"><span>Promociones con los filtros actuales</span><strong>{loading ? '…' : total}</strong></div>
        <div className="erp-promo-stat"><span>Activas en la página visible</span><strong>{loading ? '…' : listActive}</strong></div>
        <div className="erp-promo-stat"><span>Vigentes hoy en la página visible</span><strong>{loading ? '…' : listCurrent}</strong></div>
      </div>

      <div className="erp-promo-tabs" role="tablist" aria-label="Secciones de Promociones">
        <button type="button" role="tab" aria-selected={tab === 'promotions'} onClick={() => changeTab('promotions')}>Promociones</button>
        <button type="button" role="tab" aria-selected={tab === 'apply'} onClick={() => changeTab('apply')}>Cotizar y aplicar</button>
        {canManage && <button type="button" role="tab" aria-selected={tab === 'history'} onClick={() => changeTab('history')}>Historial</button>}
      </div>

      {tab === 'promotions' && formOpen && canManage && <section className="erp-promo-card" aria-labelledby="promo-form-title">
        <div className="erp-promo-between"><h2 id="promo-form-title">{editId === null ? 'Crear promoción' : `Editar promoción #${editId}`}</h2>
          <button type="button" className="erp-promo-btn" onClick={() => setFormOpen(false)} disabled={saving}>Cerrar formulario</button></div>
        <p className="erp-promo-muted">Los descuentos se aplican únicamente a membresías pendientes. Editar una promoción ya utilizada está bloqueado por el backend.</p>
        <form className="erp-promo-grid" onSubmit={submitForm}>
          <label className="erp-promo-field">Plan de membresía *
            <select value={form.id_plan} required disabled={saving || plansLoading} onChange={(e) => setForm((f) => ({ ...f, id_plan: e.target.value }))}>
              <option value="">Selecciona un plan</option>
              {plans.map((p) => <option key={p.id_plan} value={p.id_plan}>{p.plan_name} · {money(p.price)} {p.status !== 'ACTIVE' ? '(inactivo)' : ''}</option>)}
            </select>
          </label>
          <label className="erp-promo-field">Nombre *
            <input required maxLength={100} minLength={3} value={form.name} disabled={saving} placeholder="Ej. Descuento de fin de mes" onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </label>
          <label className="erp-promo-field">Tipo de beneficio *
            <select value={form.discount_type} disabled={saving} onChange={(e) => setForm((f) => ({ ...f, discount_type: e.target.value, discount_value: e.target.value === 'NON_MONETARY' ? '0.00' : '' }))}>
              <option value="PERCENTAGE">Descuento porcentual</option><option value="FIXED_AMOUNT">Descuento fijo en bolivianos</option><option value="NON_MONETARY">Beneficio no monetario</option>
            </select>
          </label>
          <label className="erp-promo-field">{form.discount_type === 'PERCENTAGE' ? 'Porcentaje (%) *' : form.discount_type === 'FIXED_AMOUNT' ? 'Monto del descuento (Bs) *' : 'Valor (0.00) *'}
            <input required inputMode="decimal" value={form.discount_value} maxLength={13} disabled={saving || form.discount_type === 'NON_MONETARY'} placeholder={form.discount_type === 'NON_MONETARY' ? '0.00' : 'Ej. 10.00'} onChange={(e) => setForm((f) => ({ ...f, discount_value: e.target.value }))} />
            <small>{form.discount_type === 'PERCENTAGE' ? 'Mayor a 0 y menor a 100. Admite dos decimales.' : form.discount_type === 'FIXED_AMOUNT' ? 'Menor al precio del plan, para permitir el cobro.' : 'No modifica el importe de la membresía.'}</small>
          </label>
          <label className="erp-promo-field">Fecha inicial *
            <input type="date" required value={form.start_date} disabled={saving} onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} />
          </label>
          <label className="erp-promo-field">Fecha final *
            <input type="date" required min={form.start_date || undefined} value={form.end_date} disabled={saving} onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))} />
          </label>
          {editId === null && <label className="erp-promo-field">Estado inicial
            <select value={form.status} disabled={saving} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
              <option value="ACTIVE">Activa</option><option value="INACTIVE">Inactiva</option>
            </select>
          </label>}
          <label className="erp-promo-field erp-promo-span">Descripción {form.discount_type === 'NON_MONETARY' ? '*' : '(opcional)'}
            <textarea value={form.description} required={form.discount_type === 'NON_MONETARY'} maxLength={255} disabled={saving} placeholder="Condiciones y descripción del beneficio" onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            <small>{form.description.length}/255 caracteres</small>
          </label>
          {formError && <div className="erp-promo-notice error erp-promo-span" role="alert">{formError}</div>}
          <div className="erp-promo-actions erp-promo-span">
            <button type="submit" className="erp-promo-btn erp-promo-primary" disabled={saving || plansLoading || !!plansError}>{saving ? 'Guardando…' : editId === null ? 'Crear promoción' : 'Guardar cambios'}</button>
            <button type="button" className="erp-promo-btn" disabled={saving} onClick={() => setFormOpen(false)}>Cancelar</button>
          </div>
        </form>
      </section>}

      {tab === 'promotions' && <section className="erp-promo-card" aria-label="Gestión de promociones">
        <div className="erp-promo-between"><div><h2>Catálogo de promociones</h2><p className="erp-promo-muted" style={{ margin: 0 }}>Busca por nombre, plan, estado o vigencia.</p></div></div>
        <form className="erp-promo-grid" style={{ marginTop: 20 }} onSubmit={applyListFilters}>
          <label className="erp-promo-field">Buscar
            <input value={filtersDraft.search} maxLength={100} placeholder="Nombre, descripción o plan" onChange={(e) => setFiltersDraft((f) => ({ ...f, search: e.target.value }))} />
          </label>
          <label className="erp-promo-field">Plan
            <select value={filtersDraft.id_plan} onChange={(e) => setFiltersDraft((f) => ({ ...f, id_plan: e.target.value }))}>
              <option value="">Todos los planes</option>
              {plans.map((plan) => <option key={plan.id_plan} value={plan.id_plan}>{plan.plan_name} (#{plan.id_plan})</option>)}
            </select>
          </label>
          <label className="erp-promo-field">Estado
            <select value={filtersDraft.status} onChange={(e) => setFiltersDraft((f) => ({ ...f, status: e.target.value }))}>
              <option value="">Todos</option><option value="ACTIVE">Activas</option><option value="INACTIVE">Inactivas</option>
            </select>
          </label>
          <label className="erp-promo-field">Vigencia actual
            <select value={filtersDraft.valid_today} onChange={(e) => setFiltersDraft((f) => ({ ...f, valid_today: e.target.value }))}>
              <option value="">Todas</option><option value="true">Vigentes hoy</option><option value="false">No vigentes hoy</option>
            </select>
          </label>
          <div className="erp-promo-actions erp-promo-span">
            <button type="submit" className="erp-promo-btn erp-promo-primary" disabled={loading}>Buscar</button>
            <button type="button" className="erp-promo-btn" onClick={() => { setFiltersDraft(EMPTY_FILTERS); setFilters(EMPTY_FILTERS); setPage(1); }}>Limpiar filtros</button>
          </div>
        </form>
        {loading && <p role="status" className="erp-promo-muted">Cargando promociones…</p>}
        {listError && <div className="erp-promo-notice error" role="alert">{listError}</div>}
        {!loading && !listError && <>
          <div className="erp-promo-tablebox"><table className="erp-promo-table">
            <thead><tr><th>Promoción</th><th>Plan</th><th>Beneficio</th><th>Vigencia</th><th>Estado</th><th>Acciones</th></tr></thead>
            <tbody>{promotions.length ? promotions.map((promo) => <tr key={promo.id_promotion}>
              <td><strong>{promo.name}</strong><span className="erp-promo-cell-sub">#{promo.id_promotion} · {promo.description || 'Sin descripción'}</span></td>
              <td>{promo.plan_name || planById.get(Number(promo.id_plan))?.plan_name || `Plan #${promo.id_plan}`}</td>
              <td><strong>{discountLabel(promo)}</strong><span className="erp-promo-cell-sub">{TYPE_NAMES[promo.discount_type] || promo.discount_type}</span></td>
              <td>{showDate(promo.start_date)} – {showDate(promo.end_date)}<span className="erp-promo-cell-sub">{Number(promo.is_current) === 1 ? 'Aplicable hoy' : 'Fuera de vigencia'}</span></td>
              <td><span className={`erp-promo-tag ${promo.status === 'ACTIVE' ? 'active' : 'inactive'}`}>{STATUS_NAMES[promo.status] || promo.status}</span></td>
              <td><div className="erp-promo-actions">
                <button type="button" className="erp-promo-btn erp-promo-small" disabled={detailBusy} onClick={() => openDetails(promo.id_promotion)}>Ver</button>
                {canManage && <>
                  <button type="button" className="erp-promo-btn erp-promo-small" onClick={() => showEditForm(promo)}>Editar</button>
                  <button type="button" className="erp-promo-btn erp-promo-small" onClick={() => setConfirmStatus(promo)}>{promo.status === 'ACTIVE' ? 'Desactivar' : 'Activar'}</button>
                </>}
              </div></td>
            </tr>) : <tr><td colSpan={6} className="erp-promo-empty">No se encontraron promociones con estos filtros.</td></tr>}</tbody>
          </table></div>
          <div className="erp-promo-pagination"><span>{total} resultados · Página {page} de {listPages}</span>
            <div className="erp-promo-actions"><button type="button" className="erp-promo-btn erp-promo-small" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Anterior</button>
              <button type="button" className="erp-promo-btn erp-promo-small" disabled={page >= listPages} onClick={() => setPage((p) => p + 1)}>Siguiente</button></div>
          </div>
        </>}
        {detailBusy && <p role="status" className="erp-promo-muted">Consultando detalle…</p>}
        {detailError && <div className="erp-promo-notice error" role="alert">{detailError}</div>}
        {detail && <div className="erp-promo-card" style={{ background: '#1f1f23', marginBottom: 0 }}>
          <div className="erp-promo-between"><h3>Detalle de {detail.name}</h3><button className="erp-promo-btn erp-promo-small" onClick={() => setDetail(null)} type="button">Cerrar detalle</button></div>
          <div className="erp-promo-kv">
            <div><span>Identificador</span><strong>#{detail.id_promotion}</strong></div>
            <div><span>Plan</span><strong>{detail.plan_name}</strong></div>
            <div><span>Estado</span><strong>{STATUS_NAMES[detail.status] || detail.status}</strong></div>
            <div><span>Descuento</span><strong>{discountLabel(detail)}</strong></div>
            <div><span>Aplicaciones registradas</span><strong>{Number(detail.total_applications) || 0}</strong></div>
            <div><span>Descuentos históricos</span><strong>{money(detail.total_discount)}</strong></div>
          </div>
          <p className="erp-promo-muted">El historial de promociones aplicadas no se altera si cambias su estado.</p>
        </div>}
      </section>}

      {tab === 'apply' && <section className="erp-promo-card" aria-labelledby="apply-title">
        <h2 id="apply-title">Cotizar y aplicar una promoción</h2>
        <p className="erp-promo-muted">Primero selecciona una membresía pendiente. La cotización no modifica datos. Solo al confirmar la aplicación se actualiza el precio que después cobra Finanzas.</p>
        {membershipsLoading && <p className="erp-promo-muted" role="status">Cargando membresías pendientes…</p>}
        {membershipsError && <div className="erp-promo-notice error" role="alert">{membershipsError}</div>}
        <form className="erp-promo-grid" onSubmit={submitQuote}>
          <label className="erp-promo-field">Membresía pendiente *
            <select required value={selectedMembership} disabled={saving || membershipsLoading} onChange={(e) => { quoteVersion.current += 1; setSelectedMembership(e.target.value); setSelectedPromotion(''); setAvailablePromos([]); setQuote(null); setQuoteBusy(false); setApplyConfirmed(false); }}>
              <option value="">Selecciona una membresía</option>
              {pending.map((item) => <option key={item.id_membership} value={item.id_membership}>
                #{item.id_membership} · Cliente #{item.id_customer} · {planById.get(Number(item.id_plan))?.plan_name || `Plan #${item.id_plan}`} · {money(item.applied_price)}
              </option>)}
            </select>
            <small>Solo aparecen las membresías PENDING; el servidor vuelve a comprobar que no tengan pagos.</small>
          </label>
          <label className="erp-promo-field">Promoción vigente para el plan *
            <select required value={selectedPromotion} disabled={!chosenMembership || availableLoading || saving} onChange={(e) => { quoteVersion.current += 1; setSelectedPromotion(e.target.value); setQuote(null); setQuoteBusy(false); setApplyConfirmed(false); }}>
              <option value="">Selecciona una promoción</option>
              {availablePromos.map((promo) => <option key={promo.id_promotion} value={promo.id_promotion}>{promo.name} · {discountLabel(promo)}</option>)}
            </select>
            <small>{availableLoading ? 'Buscando promociones vigentes…' : `${availablePromos.length} promociones disponibles para el plan seleccionado.`}</small>
          </label>
          {availableError && <div className="erp-promo-notice error erp-promo-span" role="alert">{availableError}</div>}
          {chosenMembership && <div className="erp-promo-kv erp-promo-span">
            <div><span>Cliente</span><strong>#{chosenMembership.id_customer}</strong></div>
            <div><span>Plan</span><strong>{planById.get(Number(chosenMembership.id_plan))?.plan_name || `#${chosenMembership.id_plan}`}</strong></div>
            <div><span>Precio actual</span><strong>{money(chosenMembership.applied_price)}</strong></div>
            <div><span>Estado</span><strong>Pendiente de pago</strong></div>
          </div>}
          <div className="erp-promo-actions erp-promo-span">
            <button type="submit" className="erp-promo-btn erp-promo-primary" disabled={!selectedMembership || !selectedPromotion || quoteBusy || saving || availableLoading}>
              {quoteBusy ? 'Calculando…' : 'Cotizar sin aplicar'}
            </button>
            <button type="button" className="erp-promo-btn" onClick={() => { quoteVersion.current += 1; setSelectedMembership(''); setSelectedPromotion(''); setQuote(null); setQuoteBusy(false); setApplyConfirmed(false); }} disabled={saving}>Limpiar selección</button>
          </div>
        </form>
        {quote && <div className="erp-promo-card" style={{ background: '#202025', marginBottom: 0 }}>
          <h3>Resultado de la cotización</h3>
          <div className="erp-promo-kv">
            <div><span>Precio original</span><strong>{money(quote.base_price)}</strong></div>
            <div><span>Descuento</span><strong>{money(quote.discount_amount)}</strong></div>
            <div><span>Precio final para Finanzas</span><strong>{money(quote.final_price)}</strong></div>
            <div><span>Promoción</span><strong>{quote.promotion_name || `#${quote.id_promotion}`}</strong></div>
          </div>
          <p className="erp-promo-note">La cotización corresponde al {showDate(quote.business_date)}. Al aplicar, el servidor recalculará el importe y comprobará otra vez vigencia, membresía pendiente y pagos.</p>
          <label className="erp-promo-checkbox"><input type="checkbox" checked={applyConfirmed} onChange={(e) => setApplyConfirmed(e.target.checked)} disabled={saving} />
            Revisé el cliente, la membresía y el precio final. Autorizo aplicar esta promoción, sin registrar todavía un cobro.
          </label>
          <div className="erp-promo-actions" style={{ marginTop: 18 }}>
            <button type="button" className="erp-promo-btn erp-promo-primary" disabled={!applyConfirmed || saving} onClick={submitApply}>{saving ? 'Aplicando…' : 'Confirmar aplicación del descuento'}</button>
          </div>
        </div>}
        {!membershipsLoading && !membershipsError && !pending.length && <p className="erp-promo-muted">No hay membresías pendientes para aplicar promociones.</p>}
      </section>}

      {tab === 'history' && canManage && <section className="erp-promo-card" aria-labelledby="history-title">
        <h2 id="history-title">Historial de promociones aplicadas</h2>
        <p className="erp-promo-muted">Cada aplicación conserva el precio original, descuento, precio final y usuario que la registró.</p>
        <form className="erp-promo-grid" onSubmit={submitHistoryFilters}>
          <label className="erp-promo-field">ID de promoción
            <input inputMode="numeric" placeholder="Todas" value={historyDraft.id_promotion} onChange={(e) => setHistoryDraft((f) => ({ ...f, id_promotion: e.target.value }))} />
          </label>
          <label className="erp-promo-field">ID de membresía
            <input inputMode="numeric" placeholder="Todas" value={historyDraft.id_membership} onChange={(e) => setHistoryDraft((f) => ({ ...f, id_membership: e.target.value }))} />
          </label>
          <div className="erp-promo-actions erp-promo-span"><button type="submit" className="erp-promo-btn erp-promo-primary" disabled={historyLoading}>Buscar</button>
            <button type="button" className="erp-promo-btn" onClick={() => { setHistoryDraft(EMPTY_HISTORY_FILTERS); setHistoryFilters(EMPTY_HISTORY_FILTERS); setHistoryPage(1); }}>Limpiar</button></div>
        </form>
        {historyLoading && <p className="erp-promo-muted" role="status">Cargando historial…</p>}
        {historyError && <div className="erp-promo-notice error" role="alert">{historyError}</div>}
        {!historyLoading && !historyError && <>
          <div className="erp-promo-tablebox"><table className="erp-promo-table">
            <thead><tr><th>Aplicación</th><th>Promoción</th><th>Membresía</th><th>Precio original</th><th>Descuento</th><th>Precio final</th><th>Registrado</th></tr></thead>
            <tbody>{history.length ? history.map((item) => <tr key={item.id_application}>
              <td>#{item.id_application}</td><td>{item.promotion_name || `#${item.id_promotion}`}</td>
              <td>#{item.id_membership}<span className="erp-promo-cell-sub">Cliente #{item.id_customer}</span></td>
              <td>{money(item.base_price)}</td><td>{money(item.discount_amount)}</td><td><strong>{money(item.final_price)}</strong></td>
              <td>{showDateTime(item.applied_at)}<span className="erp-promo-cell-sub">Usuario #{item.applied_by}</span></td>
            </tr>) : <tr><td colSpan={7} className="erp-promo-empty">No hay promociones aplicadas con estos filtros.</td></tr>}</tbody>
          </table></div>
          <div className="erp-promo-pagination"><span>{historyTotal} aplicaciones · Página {historyPage} de {historyPages}</span>
            <div className="erp-promo-actions"><button className="erp-promo-btn erp-promo-small" type="button" disabled={historyPage <= 1} onClick={() => setHistoryPage((p) => p - 1)}>Anterior</button>
              <button className="erp-promo-btn erp-promo-small" type="button" disabled={historyPage >= historyPages} onClick={() => setHistoryPage((p) => p + 1)}>Siguiente</button></div>
          </div>
        </>}
      </section>}
      <p className="erp-promo-muted">Fecha del gimnasio: {showDate(today)} (Bolivia). Los permisos, fechas y precios se verifican nuevamente en MySQL.</p>
      {confirmStatus && <ConfirmDialog
        title={confirmStatus.status === 'ACTIVE' ? 'Desactivar promoción' : 'Activar promoción'}
        description={`${confirmStatus.status === 'ACTIVE' ? '¿Quieres desactivar' : '¿Quieres activar'} “${confirmStatus.name}”? Los descuentos que ya fueron aplicados conservarán su importe histórico.`}
        confirmText={confirmStatus.status === 'ACTIVE' ? 'Sí, desactivar' : 'Sí, activar'}
        danger={confirmStatus.status === 'ACTIVE'} busy={saving}
        onCancel={() => setConfirmStatus(null)} onConfirm={submitStatus}
      />}
    </main>
  </div>;
}
