import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import { erpRequest, listErpPaymentMethods } from '../config/erpApi';

// Gimnasio MQS - ERP / Finanzas / Caja.
// Toda operacion de escritura ocurre SOLO despues de una confirmacion expresa.
// El backend vuelve a verificar el JWT, los permisos y las transacciones en MySQL.
const PAGE_SIZE = 15;
const MAX_AMOUNT = 999999999999n; // DECIMAL(12,2), expresado en centavos.
const EMPTY_ENTRY = { entry_type: 'EXPENSE', category: '', concept: '', amount: '', id_payment_method: '', notes: '' };
const EMPTY_MOVEMENT_FILTER = { from: '', to: '', movement_kind: '', id_payment_method: '', is_cash: '' };
const EMPTY_ENTRY_FILTER = { from: '', to: '', entry_type: '', category: '', id_payment_method: '' };
const EMPTY_CLOSURE_FILTER = { from: '', to: '' };
const MOVEMENT_NAMES = {
  PAYMENT_IN: 'Cobro de membresía', PAYMENT_REVERSAL: 'Devolución de pago',
  OTHER_IN: 'Otro ingreso', EXPENSE_OUT: 'Gasto',
};
const moneyFormatter = new Intl.NumberFormat('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function boliviaToday() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const find = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${find('year')}-${find('month')}-${find('day')}`;
}

function shiftDay(day, days) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

function validDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function dayLabel(value) {
  const day = typeof value === 'string' ? value.slice(0, 10) : '';
  return validDay(day) ? `${day.slice(8)}/${day.slice(5, 7)}/${day.slice(0, 4)}` : '—';
}

function dateTimeLabel(value) {
  if (!value) return '—';
  const raw = String(value);
  const iso = /^\d{4}-\d{2}-\d{2} \d\d:\d\d:\d\d$/.test(raw)
    ? `${raw.replace(' ', 'T')}Z` : raw;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return raw;
  return new Intl.DateTimeFormat('es-BO', {
    timeZone: 'America/La_Paz', dateStyle: 'short', timeStyle: 'short',
  }).format(date);
}

function asCents(value, allowZero = false) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim().replace(',', '.');
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const result = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  return result <= MAX_AMOUNT && (allowZero || result > 0n) ? result : null;
}

function signedCents(value) {
  const raw = String(value ?? '0').trim();
  const negative = raw.startsWith('-');
  const result = asCents(negative ? raw.slice(1) : raw, true);
  return result === null ? null : negative ? -result : result;
}

function centsText(value) {
  const abs = value < 0n ? -value : value;
  return `${value < 0n ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

function money(value) {
  if (value === null || value === undefined || value === '') return '—';
  const num = Number(value);
  return Number.isFinite(num) ? `Bs ${moneyFormatter.format(num)}` : '—';
}

function positiveId(value) {
  const text = String(value ?? '');
  if (!/^[1-9]\d*$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) && parsed <= 2147483647 ? parsed : null;
}

function normalizeRole(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

function getUser() {
  try {
    const value = JSON.parse(window.localStorage.getItem('user') || 'null');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch { return null; }
}

function errText(error, fallback = 'No se pudo completar la solicitud.') {
  return typeof error?.message === 'string' && error.message.trim() ? error.message : fallback;
}

function aborted(error) {
  return error?.name === 'AbortError' || error?.code === 'REQUEST_CANCELLED';
}

function validateRange(filters) {
  const { from, to } = filters;
  if ((from && !validDay(from)) || (to && !validDay(to))) return 'Indica fechas válidas.';
  if (from && to && from > to) return 'La fecha inicial no puede ser posterior a la final.';
  return '';
}

function cleanParams(filters) {
  return Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== ''));
}

function valueText(value) {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

function Detail({ title, data, close }) {
  if (!data) return null;
  return (
    <div className="erp-cash-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section className="erp-cash-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="erp-cash-between"><h2>{title}</h2><button type="button" className="erp-cash-btn" onClick={close}>Cerrar</button></div>
        <dl className="erp-cash-detail">
          {Object.entries(data).filter(([, value]) => value !== null && typeof value !== 'object').map(([key, value]) => (
            <div key={key}><dt>{key.replaceAll('_', ' ')}</dt><dd>{valueText(value)}</dd></div>
          ))}
        </dl>
      </section>
    </div>
  );
}

const styles = `
.erp-cash-page{min-height:100vh;background:radial-gradient(circle at 88% 4%,rgba(192,0,44,.14),transparent 37%),#090909;color:#f6f6f7;font-family:'Segoe UI',Arial,sans-serif}
.erp-cash-page *{box-sizing:border-box}.erp-cash-main{margin-left:245px;padding:35px 38px 80px;max-width:1780px}
.erp-cash-top,.erp-cash-between,.erp-cash-toolbar{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}
.erp-cash-kicker{color:#f0476b;letter-spacing:2px;font-size:11px;font-weight:800}.erp-cash-page h1{font-size:32px;margin:9px 0}.erp-cash-page h2{font-size:20px;margin:0 0 9px}
.erp-cash-page h3{font-size:15px;margin:0 0 10px}.erp-cash-muted{color:#9e9eaa;font-size:13px;line-height:1.55}.erp-cash-page p{line-height:1.55}
.erp-cash-card{padding:24px;border:1px solid #303036;border-radius:13px;background:#141416;margin:18px 0}
.erp-cash-tabs{display:flex;flex-wrap:wrap;gap:6px;margin:24px 0 18px;padding:5px;border-radius:10px;background:#161618;border:1px solid #303036;width:fit-content}
.erp-cash-tabs button{background:transparent;border:0;border-radius:7px;color:#b4b4bd;cursor:pointer;padding:11px 15px;font-size:13px;font-weight:600}
.erp-cash-tabs button[aria-selected=true]{background:#c00030;color:#fff}
.erp-cash-btn{display:inline-flex;justify-content:center;align-items:center;gap:6px;background:#26262b;border:1px solid #424249;border-radius:8px;color:white;padding:11px 15px;cursor:pointer;font-size:13px;font-weight:650}
.erp-cash-btn:hover:not(:disabled){background:#35353c}.erp-cash-btn:disabled{opacity:.48;cursor:not-allowed}.erp-cash-primary{background:#c00030;border-color:#c00030}.erp-cash-primary:hover:not(:disabled){background:#e00037}
.erp-cash-warn{background:#381e26;border-color:#9c344d}.erp-cash-danger-text{color:#ffb4c5}
.erp-cash-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.erp-cash-span{grid-column:1/-1}
.erp-cash-field{display:flex;flex-direction:column;gap:7px;color:#d0d0d5;font-size:13px;font-weight:600}
.erp-cash-field input,.erp-cash-field select,.erp-cash-field textarea{width:100%;min-width:0;background:#202023;border:1px solid #3b3b42;border-radius:8px;padding:12px;color:white;font:inherit;font-weight:400}
.erp-cash-field textarea{min-height:90px;resize:vertical}.erp-cash-field input:focus,.erp-cash-field select:focus,.erp-cash-field textarea:focus{outline:2px solid rgba(231,30,81,.45);border-color:#db2455}
.erp-cash-field :disabled{opacity:.55;cursor:not-allowed}.erp-cash-field small{font-size:12px;font-weight:400;color:#a4a4b0}
.erp-cash-check{display:flex;align-items:flex-start;gap:10px;line-height:1.5;font-size:13px}.erp-cash-check input{accent-color:#c00030;margin-top:4px}
.erp-cash-notice{padding:13px 15px;border-radius:9px;background:#222027;border:1px solid #48424a;color:#e4e0e5;margin:16px 0;font-size:13px}
.erp-cash-notice.error{background:#351920;border-color:#963349;color:#ffd5df}.erp-cash-notice.success{background:#183026;border-color:#327d58;color:#baf4d5}
.erp-cash-stat-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin:20px 0}
.erp-cash-stat{border:1px solid #303037;background:#19191c;border-radius:11px;padding:17px}.erp-cash-stat span{display:block;color:#a1a1aa;font-size:12px;margin-bottom:9px}
.erp-cash-stat strong{display:block;font-size:19px;word-break:break-word}.erp-cash-stat small{display:block;color:#9696a0;margin-top:5px}
.erp-cash-badge{display:inline-block;border-radius:99px;padding:5px 9px;font-size:11px;font-weight:700;background:#343139;color:#dad7e0}
.erp-cash-badge.ok{background:#173d2b;color:#c1f3d7}.erp-cash-badge.danger{background:#4b1d29;color:#ffc3cf}
.erp-cash-table-box{width:100%;overflow-x:auto;border:1px solid #34343a;border-radius:10px;margin-top:17px}
.erp-cash-table{border-collapse:collapse;width:100%;min-width:720px;text-align:left}.erp-cash-table th{background:#1e1e22;font-size:11px;text-transform:uppercase;color:#a1a1ad;letter-spacing:.3px;padding:13px}
.erp-cash-table td{padding:13px;border-top:1px solid #323238;font-size:13px;vertical-align:middle}.erp-cash-table tr:hover td{background:#202025}
.erp-cash-pagination{display:flex;gap:12px;align-items:center;justify-content:flex-end;flex-wrap:wrap;margin-top:17px}.erp-cash-form-actions{display:flex;justify-content:flex-end;align-items:center;gap:12px;flex-wrap:wrap;margin-top:20px}
.erp-cash-overlay{position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:5000;display:grid;place-items:center;padding:20px}.erp-cash-modal{width:min(700px,100%);max-height:85vh;overflow:auto;background:#19191d;border:1px solid #55515b;border-radius:12px;padding:24px}
.erp-cash-detail{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.erp-cash-detail>div{border-bottom:1px solid #34343b;padding:8px 0;overflow-wrap:anywhere}
.erp-cash-detail dt{color:#9e9eaa;font-size:11px;text-transform:capitalize}.erp-cash-detail dd{margin:5px 0 0;font-size:13px}.erp-cash-divider{border:0;border-top:1px solid #36363c;margin:22px 0}
@media(max-width:1100px){.erp-cash-stat-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.erp-cash-main{padding:25px 18px 60px}}
@media(max-width:760px){.erp-cash-main{margin-left:0;padding:20px 13px 55px}.erp-cash-grid,.erp-cash-detail{grid-template-columns:1fr}.erp-cash-stat-grid{grid-template-columns:1fr 1fr}.erp-cash-page h1{font-size:26px}}
@media(max-width:460px){.erp-cash-stat-grid{grid-template-columns:1fr}.erp-cash-card{padding:17px}.erp-cash-tabs{width:100%}}
`;

export default function ErpCash() {
  const navigate = useNavigate();
  const user = getUser();
  const role = normalizeRole(user?.role);
  const admin = ['administrador', 'admin'].includes(role);
  const reception = ['recepcionista', 'recepcion'].includes(role);
  const canRead = admin || reception;
  const today = boliviaToday();

  const [tab, setTab] = useState('summary');
  const [day, setDay] = useState(today);
  const [refresh, setRefresh] = useState(0);
  const [notice, setNotice] = useState(null);
  const [methods, setMethods] = useState([]);
  const [methodError, setMethodError] = useState('');
  const [loadingMethods, setLoadingMethods] = useState(false);
  const [summary, setSummary] = useState(null);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [summaryError, setSummaryError] = useState('');
  const [entry, setEntry] = useState(EMPTY_ENTRY);
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const [acknowledge, setAcknowledge] = useState(false);
  const [closeOpening, setCloseOpening] = useState('');
  const [closeCounted, setCloseCounted] = useState('');
  const [closeNotes, setCloseNotes] = useState('');
  const [closeAcknowledged, setCloseAcknowledged] = useState(false);
  const [moveDraft, setMoveDraft] = useState(EMPTY_MOVEMENT_FILTER);
  const [moveApplied, setMoveApplied] = useState({});
  const [movePage, setMovePage] = useState(1);
  const [entryDraft, setEntryDraft] = useState(EMPTY_ENTRY_FILTER);
  const [entryApplied, setEntryApplied] = useState({});
  const [entryPage, setEntryPage] = useState(1);
  const [closureDraft, setClosureDraft] = useState(EMPTY_CLOSURE_FILTER);
  const [closureApplied, setClosureApplied] = useState({});
  const [closurePage, setClosurePage] = useState(1);
  const [reportDraft, setReportDraft] = useState(() => ({ from: shiftDay(today, -29), to: today }));
  const [reportApplied, setReportApplied] = useState(() => ({ from: shiftDay(today, -29), to: today }));
  const [listing, setListing] = useState({ data: [], total: 0, page: 1, limit: PAGE_SIZE });
  const [listingBusy, setListingBusy] = useState(false);
  const [listingError, setListingError] = useState('');
  const [report, setReport] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailBusy, setDetailBusy] = useState(false);

  const get = useCallback((path, options = {}) => erpRequest(`/api/erp/cash${path}`, options), []);

  useEffect(() => {
    if (!canRead) return undefined;
    const controller = new AbortController();
    Promise.resolve().then(() => {
      if (controller.signal.aborted) return null;
      setLoadingMethods(true);
      setMethodError('');
      return listErpPaymentMethods({ signal: controller.signal });
    })
      .then((result) => {
        if (controller.signal.aborted) return;
        if (!Array.isArray(result)) throw new Error('El servidor devolvió métodos de pago inválidos.');
        setMethods(result.filter((item) => positiveId(item.id_payment_method) && typeof item.name === 'string'));
      })
      .catch((error) => { if (!aborted(error)) setMethodError(errText(error, 'No se pudieron cargar los métodos de pago.')); })
      .finally(() => { if (!controller.signal.aborted) setLoadingMethods(false); });
    return () => controller.abort();
  }, [canRead, refresh]);

  useEffect(() => {
    if (!canRead || !validDay(day)) return undefined;
    const controller = new AbortController();
    Promise.resolve().then(() => {
      if (controller.signal.aborted) return null;
      setSummaryBusy(true);
      setSummaryError('');
      return get('/summary', { params: { business_date: day }, signal: controller.signal });
    })
      .then((result) => {
        if (controller.signal.aborted) return;
        if (!result || typeof result !== 'object' || !result.totals) throw new Error('El resumen recibido no es válido.');
        setSummary(result);
      })
      .catch((error) => { if (!aborted(error)) { setSummary(null); setSummaryError(errText(error)); } })
      .finally(() => { if (!controller.signal.aborted) setSummaryBusy(false); });
    return () => controller.abort();
  }, [canRead, day, get, refresh]);

  useEffect(() => {
    const endpoints = {
      movements: ['/movements', { ...moveApplied, page: movePage, limit: PAGE_SIZE }],
      entries: ['/entries', { ...entryApplied, page: entryPage, limit: PAGE_SIZE }],
      closures: ['/closures', { ...closureApplied, page: closurePage, limit: PAGE_SIZE }],
    };
    if (!canRead || !endpoints[tab]) return undefined;
    const controller = new AbortController();
    const [endpoint, params] = endpoints[tab];
    Promise.resolve().then(() => {
      if (controller.signal.aborted) return null;
      setListingBusy(true); setListingError('');
      return get(endpoint, { params, signal: controller.signal });
    })
      .then((result) => {
        if (controller.signal.aborted) return;
        if (!result || !Array.isArray(result.data) || !Number.isFinite(Number(result.total))) {
          throw new Error('El servidor devolvió un historial inválido.');
        }
        setListing(result);
      })
      .catch((error) => { if (!aborted(error)) { setListing({ data: [], total: 0, page: 1, limit: PAGE_SIZE }); setListingError(errText(error)); } })
      .finally(() => { if (!controller.signal.aborted) setListingBusy(false); });
    return () => controller.abort();
  }, [canRead, tab, moveApplied, movePage, entryApplied, entryPage, closureApplied, closurePage, get, refresh]);

  useEffect(() => {
    if (!admin || tab !== 'reports') return undefined;
    const controller = new AbortController();
    Promise.resolve().then(() => {
      if (controller.signal.aborted) return null;
      setListingBusy(true); setListingError('');
      return get('/reports', { params: reportApplied, signal: controller.signal });
    })
      .then((result) => {
        if (controller.signal.aborted) return;
        if (!result || !result.totals || !Array.isArray(result.by_method) || !Array.isArray(result.by_category)) {
          throw new Error('El servidor devolvió un reporte inválido.');
        }
        setReport(result);
      })
      .catch((error) => { if (!aborted(error)) { setReport(null); setListingError(errText(error)); } })
      .finally(() => { if (!controller.signal.aborted) setListingBusy(false); });
    return () => controller.abort();
  }, [admin, tab, reportApplied, get, refresh]);

  const updateEntry = (key, value) => setEntry((current) => ({ ...current, [key]: value }));
  const updateFilter = (setter, key, value) => setter((current) => ({ ...current, [key]: value }));
  const refreshData = () => { setNotice(null); setDetail(null); setRefresh((current) => current + 1); };
  const showNotice = (type, text) => setNotice({ type, text });
  const totals = summary?.totals || {};
  const netCash = signedCents(totals.net_cash_change ?? '0.00');
  const opening = summary?.suggested_opening_cash !== null && summary?.suggested_opening_cash !== undefined
    ? asCents(summary.suggested_opening_cash, true) : asCents(closeOpening, true);
  const expected = opening === null || netCash === null ? null : opening + netCash;
  const counted = asCents(closeCounted, true);
  const difference = expected !== null && counted !== null ? counted - expected : null;
  const canClose = admin && !summaryBusy && !!summary && summary.business_date === day && !summary.closed && day <= today && expected !== null && expected >= 0n && expected <= MAX_AMOUNT;

  const movementCount = Math.max(1, Math.ceil(Number(listing.total || 0) / PAGE_SIZE));
  const currentPage = tab === 'movements' ? movePage : tab === 'entries' ? entryPage : closurePage;
  const setCurrentPage = tab === 'movements' ? setMovePage : tab === 'entries' ? setEntryPage : setClosurePage;

  function applyFilters(event, filters, setApplied, setPage) {
    event.preventDefault();
    const message = validateRange(filters);
    if (message) { showNotice('error', message); return; }
    if (filters.category && (filters.category.trim().length < 2 || filters.category.trim().length > 80)) {
      showNotice('error', 'La categoría debe tener entre 2 y 80 caracteres.'); return;
    }
    setPage(1); setApplied(cleanParams(filters)); setNotice(null);
  }

  async function submitEntry(event) {
    event.preventDefault();
    if (!admin || inFlight.current) return;
    const type = entry.entry_type;
    const category = entry.category.replace(/\s+/g, ' ').trim();
    const concept = entry.concept.replace(/\s+/g, ' ').trim();
    const amount = asCents(entry.amount);
    const methodId = positiveId(entry.id_payment_method);
    const notes = entry.notes.trim();
    if (!['EXPENSE', 'OTHER_INCOME'].includes(type)) return showNotice('error', 'Selecciona un tipo válido.');
    if (category.length < 2 || category.length > 80) return showNotice('error', 'La categoría debe tener entre 2 y 80 caracteres.');
    if (concept.length < 4 || concept.length > 255) return showNotice('error', 'El concepto debe tener entre 4 y 255 caracteres.');
    if (amount === null) return showNotice('error', 'El importe debe ser mayor a cero, con máximo dos decimales.');
    if (!methodId || !methods.some((method) => Number(method.id_payment_method) === methodId)) return showNotice('error', 'Selecciona un método de pago activo.');
    if (notes.length > 2000) return showNotice('error', 'Las observaciones no pueden superar 2000 caracteres.');
    if (summaryBusy || !summary || summary.closed || summary.business_date !== today) return showNotice('error', 'La caja de hoy no está disponible para movimientos. Actualiza el resumen.');
    if (!acknowledge) return showNotice('error', 'Confirma que el movimiento corresponde a una operación real.');
    if (!window.confirm(`¿Confirmas el registro de ${type === 'EXPENSE' ? 'un GASTO' : 'OTRO INGRESO'} por ${money(centsText(amount))}? La operación quedará registrada en caja.`)) return;

    inFlight.current = true; setSaving(true); setNotice(null);
    try {
      const created = await get('/entries', {
        method: 'POST',
        body: { entry_type: type, category, concept, amount: centsText(amount), id_payment_method: methodId, ...(notes ? { notes } : {}) },
      });
      setEntry(EMPTY_ENTRY); setAcknowledge(false);
      showNotice('success', `Movimiento #${created.id_financial_entry} registrado correctamente en caja.`);
      setRefresh((current) => current + 1);
    } catch (error) { showNotice('error', errText(error, 'No se pudo registrar el movimiento.')); }
    finally { inFlight.current = false; setSaving(false); }
  }

  async function submitClosure(event) {
    event.preventDefault();
    if (!canClose || inFlight.current) return;
    if (counted === null) return showNotice('error', 'Indica el efectivo físico contado; acepta cero si no hay dinero.');
    if (difference !== null && difference !== 0n && closeNotes.trim().length < 10) {
      return showNotice('error', 'Si existe una diferencia de caja, explica el motivo en al menos 10 caracteres.');
    }
    if (closeNotes.trim().length > 2000) return showNotice('error', 'Las observaciones no pueden superar 2000 caracteres.');
    if (!closeAcknowledged) return showNotice('error', 'Confirma que verificaste los movimientos y contaste el efectivo.');
    const prompt = `¿Cerrar definitivamente la caja del ${dayLabel(day)}?\nEfectivo esperado: ${money(centsText(expected))}\nEfectivo contado: ${money(centsText(counted))}\nDiferencia: ${money(centsText(difference))}\nNo podrás registrar más movimientos en esa jornada.`;
    if (!window.confirm(prompt)) return;

    inFlight.current = true; setSaving(true); setNotice(null);
    try {
      const body = { business_date: day, counted_cash: centsText(counted) };
      if (summary.suggested_opening_cash === null) body.opening_cash = centsText(opening);
      if (closeNotes.trim()) body.notes = closeNotes.trim();
      const created = await get('/closures', { method: 'POST', body });
      showNotice('success', `Caja del ${dayLabel(created.business_date)} cerrada correctamente.`);
      setCloseAcknowledged(false); setRefresh((current) => current + 1);
    } catch (error) { showNotice('error', errText(error, 'No se pudo cerrar la caja.')); }
    finally { inFlight.current = false; setSaving(false); }
  }

  async function viewDetails(path, title) {
    if (detailBusy) return;
    setDetailBusy(true); setNotice(null);
    try {
      const data = await get(path);
      setDetail({ title, data });
    } catch (error) { showNotice('error', errText(error, 'No se pudo consultar el detalle.')); }
    finally { setDetailBusy(false); }
  }

  const table = useMemo(() => {
    if (tab === 'movements') return {
      columns: ['ID', 'Fecha', 'Tipo', 'Concepto', 'Método', 'Importe', 'Responsable'],
      cells: (row) => [row.id_cash_movement, dayLabel(row.business_date), MOVEMENT_NAMES[row.movement_kind] || row.movement_kind, row.concept || (row.id_payment ? `Pago #${row.id_payment}` : '—'), row.payment_method, money(row.amount), row.registered_by_name || row.registered_by],
      path: (row) => `/movements/${row.id_cash_movement}`,
      name: 'Movimiento',
    };
    if (tab === 'entries') return {
      columns: ['ID', 'Fecha', 'Tipo', 'Categoría', 'Concepto', 'Método', 'Importe'],
      cells: (row) => [row.id_financial_entry, dateTimeLabel(row.entry_date), row.entry_type === 'EXPENSE' ? 'Gasto' : 'Otro ingreso', row.category, row.concept, row.payment_method, money(row.amount)],
      path: (row) => `/entries/${row.id_financial_entry}`,
      name: 'Registro financiero',
    };
    return {
      columns: ['Fecha', 'Saldo inicial', 'Ingresos', 'Gastos', 'Reversiones', 'Efectivo esperado', 'Diferencia'],
      cells: (row) => [dayLabel(row.business_date), money(row.opening_cash), money(row.total_income), money(row.total_expenses), money(row.total_reversals), money(row.expected_cash), money(row.difference_cash)],
      path: (row) => `/closures/${row.business_date}`,
      name: 'Cierre de caja',
    };
  }, [tab]);

  if (!canRead) return (
    <div className="erp-cash-page"><style>{styles}</style><Sidebar /><main className="erp-cash-main">
      <h1>Acceso no autorizado</h1><p>No tienes acceso al módulo de Caja.</p>
      <button className="erp-cash-btn" onClick={() => navigate('/home')} type="button">Volver a mi área</button>
    </main></div>
  );

  return (
    <div className="erp-cash-page">
      <style>{styles}</style>
      <Sidebar />
      <main className="erp-cash-main">
        <header className="erp-cash-top">
          <div><span className="erp-cash-kicker">ERP MQS / FINANZAS</span><h1>Caja y movimientos</h1>
            <p className="erp-cash-muted">Control de ingresos, gastos, movimientos, cierres y reportes financieros.</p></div>
          <div className="erp-cash-toolbar">
            <button type="button" className="erp-cash-btn" onClick={() => navigate('/erp/payments')}>Pagos de membresías</button>
            <button type="button" className="erp-cash-btn" onClick={refreshData} disabled={saving}>Actualizar datos</button>
          </div>
        </header>

        {notice && <p className={`erp-cash-notice ${notice.type}`} role="alert">{notice.text}</p>}
        {methodError && <p className="erp-cash-notice error" role="alert">Métodos de pago: {methodError}</p>}

        <nav className="erp-cash-tabs" aria-label="Secciones de caja">
          {[
            ['summary', 'Resumen diario'],
            ...(admin ? [['new', 'Gasto / Otro ingreso']] : []),
            ['movements', 'Movimientos'],
            ['entries', 'Registros financieros'],
            ['closures', 'Cierres de caja'],
            ...(admin ? [['reports', 'Reportes']] : []),
          ].map(([key, label]) => (
            <button type="button" key={key} aria-current={tab === key ? 'page' : undefined}
              aria-selected={tab === key} onClick={() => { setTab(key); setNotice(null); setDetail(null); }}>
              {label}
            </button>
          ))}
        </nav>

        {(tab === 'summary' || tab === 'new' || tab === 'closures') && (
          <section className="erp-cash-card" aria-label="Estado diario de caja">
            <div className="erp-cash-between">
              <div><h2>Estado de caja</h2><p className="erp-cash-muted">Fecha comercial de Bolivia (UTC−04:00).</p></div>
              <label className="erp-cash-field">Fecha
                <input type="date" value={day} max={today} onChange={(event) => {
                  setDay(event.target.value);
                  setCloseOpening(''); setCloseCounted(''); setCloseNotes(''); setCloseAcknowledged(false);
                }} disabled={saving} />
              </label>
            </div>
            {!validDay(day) && <p className="erp-cash-notice error">Selecciona una fecha válida.</p>}
            {summaryBusy && <p className="erp-cash-muted" role="status">Consultando caja…</p>}
            {summaryError && <p className="erp-cash-notice error" role="alert">{summaryError}</p>}
            {summary && !summaryBusy && summary.business_date === day && (
              <>
                <p><span className={`erp-cash-badge ${summary.closed ? 'danger' : 'ok'}`}>{summary.closed ? 'Jornada cerrada' : 'Jornada abierta'}</span>
                  {' '}<span className="erp-cash-muted">{dayLabel(summary.business_date)} · {Number(totals.movement_count || 0)} movimientos</span></p>
                <div className="erp-cash-stat-grid">
                  <div className="erp-cash-stat"><span>Ingresos del día</span><strong>{money(totals.total_income)}</strong><small>Incluye pagos y otros ingresos</small></div>
                  <div className="erp-cash-stat"><span>Gastos</span><strong>{money(totals.total_expenses)}</strong><small>Egresos registrados</small></div>
                  <div className="erp-cash-stat"><span>Devoluciones</span><strong>{money(totals.total_reversals)}</strong><small>Reversiones de pagos</small></div>
                  <div className="erp-cash-stat"><span>Resultado neto</span><strong>{money(totals.net_income)}</strong><small>Ingresos − gastos − devoluciones</small></div>
                  <div className="erp-cash-stat"><span>Ingreso en efectivo</span><strong>{money(totals.cash_income)}</strong></div>
                  <div className="erp-cash-stat"><span>Gastos en efectivo</span><strong>{money(totals.cash_expenses)}</strong></div>
                  <div className="erp-cash-stat"><span>Reversiones en efectivo</span><strong>{money(totals.cash_reversals)}</strong></div>
                  <div className="erp-cash-stat"><span>Cambio neto de efectivo</span><strong>{money(totals.net_cash_change)}</strong></div>
                </div>
                <p className="erp-cash-muted">Saldo inicial sugerido: <strong>{money(summary.suggested_opening_cash)}</strong> · Efectivo estimado: <strong>{money(summary.estimated_cash)}</strong>.</p>
                {!summary.suggested_opening_cash && !summary.closed && <p className="erp-cash-notice">Aún no existe un cierre previo. En el primer cierre deberás indicar cuánto efectivo había al abrir caja.</p>}
              </>
            )}
          </section>
        )}

        {tab === 'new' && admin && (
          <section className="erp-cash-card" aria-labelledby="cash-entry-title">
            <h2 id="cash-entry-title">Registrar gasto u otro ingreso</h2>
            <p className="erp-cash-muted">Solo para operaciones reales. Los pagos de membresía se registran en su propia pantalla y se reflejan automáticamente en caja.</p>
            {summary?.closed && <p className="erp-cash-notice error">La caja de hoy está cerrada. No se permiten nuevos movimientos.</p>}
            <form onSubmit={submitEntry}>
              <div className="erp-cash-grid">
                <label className="erp-cash-field">Tipo de movimiento *
                  <select value={entry.entry_type} onChange={(event) => updateEntry('entry_type', event.target.value)} disabled={saving}>
                    <option value="EXPENSE">Gasto</option><option value="OTHER_INCOME">Otro ingreso (no membresía)</option>
                  </select>
                </label>
                <label className="erp-cash-field">Método de pago *
                  <select value={entry.id_payment_method} onChange={(event) => updateEntry('id_payment_method', event.target.value)} disabled={saving || loadingMethods} required>
                    <option value="">Seleccionar método</option>
                    {methods.map((method) => <option key={method.id_payment_method} value={method.id_payment_method}>{method.name}</option>)}
                  </select>
                </label>
                <label className="erp-cash-field">Categoría *
                  <input value={entry.category} onChange={(event) => updateEntry('category', event.target.value)} maxLength={80} required disabled={saving} placeholder="Ej. Mantenimiento" />
                </label>
                <label className="erp-cash-field">Importe (Bs) *
                  <input type="text" inputMode="decimal" value={entry.amount} onChange={(event) => updateEntry('amount', event.target.value)} maxLength={14} required disabled={saving} placeholder="0.00" />
                  <small>Importe mayor a cero, con máximo dos decimales.</small>
                </label>
                <label className="erp-cash-field erp-cash-span">Concepto *
                  <input value={entry.concept} onChange={(event) => updateEntry('concept', event.target.value)} maxLength={255} minLength={4} required disabled={saving} placeholder="Describe la operación" />
                </label>
                <label className="erp-cash-field erp-cash-span">Observaciones (opcional)
                  <textarea value={entry.notes} onChange={(event) => updateEntry('notes', event.target.value)} maxLength={2000} disabled={saving} placeholder="Referencia, comprobante o detalle adicional" />
                  <small>{entry.notes.length}/2000 caracteres</small>
                </label>
                <label className="erp-cash-check erp-cash-span"><input type="checkbox" checked={acknowledge} onChange={(event) => setAcknowledge(event.target.checked)} disabled={saving} />
                  Confirmo que esta operación ocurrió realmente y autorizo su registro en caja.
                </label>
              </div>
              <div className="erp-cash-form-actions"><span className="erp-cash-muted">Se registrarán usuario, fecha, movimiento y auditoría.</span>
                <button className="erp-cash-btn erp-cash-primary" type="submit" disabled={saving || loadingMethods || summaryBusy || !summary || summary.closed || summary.business_date !== today || !acknowledge}>
                  {saving ? 'Registrando…' : 'Confirmar y registrar movimiento'}
                </button>
              </div>
            </form>
          </section>
        )}

        {['movements', 'entries', 'closures'].includes(tab) && (
          <section className="erp-cash-card">
            <div className="erp-cash-between"><div><h2>{tab === 'movements' ? 'Historial de caja' : tab === 'entries' ? 'Gastos y otros ingresos' : 'Historial de cierres'}</h2>
              <p className="erp-cash-muted">Consulta de registros guardados en MySQL, con paginación.</p></div>
              <strong>{Number(listing.total || 0)} registro(s)</strong></div>
            <form className="erp-cash-grid" style={{ marginTop: 18 }} onSubmit={(event) => {
              if (tab === 'movements') applyFilters(event, moveDraft, setMoveApplied, setMovePage);
              else if (tab === 'entries') applyFilters(event, entryDraft, setEntryApplied, setEntryPage);
              else applyFilters(event, closureDraft, setClosureApplied, setClosurePage);
            }}>
              {(tab === 'movements' ? [moveDraft, setMoveDraft] : tab === 'entries' ? [entryDraft, setEntryDraft] : [closureDraft, setClosureDraft]).slice(0, 1).map((draft) => (
                <div key={tab} className="erp-cash-grid erp-cash-span">
                  <label className="erp-cash-field">Desde
                    <input type="date" value={draft.from} onChange={(event) => updateFilter(tab === 'movements' ? setMoveDraft : tab === 'entries' ? setEntryDraft : setClosureDraft, 'from', event.target.value)} />
                  </label>
                  <label className="erp-cash-field">Hasta
                    <input type="date" value={draft.to} onChange={(event) => updateFilter(tab === 'movements' ? setMoveDraft : tab === 'entries' ? setEntryDraft : setClosureDraft, 'to', event.target.value)} />
                  </label>
                </div>
              ))}
              {tab === 'movements' && <>
                <label className="erp-cash-field">Tipo de movimiento
                  <select value={moveDraft.movement_kind} onChange={(event) => updateFilter(setMoveDraft, 'movement_kind', event.target.value)}>
                    <option value="">Todos</option>{Object.entries(MOVEMENT_NAMES).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
                  </select>
                </label>
                <label className="erp-cash-field">Forma de cobro
                  <select value={moveDraft.is_cash} onChange={(event) => updateFilter(setMoveDraft, 'is_cash', event.target.value)}>
                    <option value="">Todas</option><option value="1">Efectivo</option><option value="0">No efectivo</option>
                  </select>
                </label>
              </>}
              {tab === 'entries' && <>
                <label className="erp-cash-field">Tipo
                  <select value={entryDraft.entry_type} onChange={(event) => updateFilter(setEntryDraft, 'entry_type', event.target.value)}>
                    <option value="">Todos</option><option value="EXPENSE">Gastos</option><option value="OTHER_INCOME">Otros ingresos</option>
                  </select>
                </label>
                <label className="erp-cash-field">Categoría exacta
                  <input maxLength={80} value={entryDraft.category} onChange={(event) => updateFilter(setEntryDraft, 'category', event.target.value)} placeholder="Opcional" />
                </label>
              </>}
              {tab !== 'closures' && <label className="erp-cash-field">Método de pago
                <select value={tab === 'entries' ? entryDraft.id_payment_method : moveDraft.id_payment_method}
                  onChange={(event) => updateFilter(tab === 'entries' ? setEntryDraft : setMoveDraft, 'id_payment_method', event.target.value)}>
                  <option value="">Todos</option>{methods.map((method) => <option key={method.id_payment_method} value={method.id_payment_method}>{method.name}</option>)}
                </select>
              </label>}
              <div className="erp-cash-form-actions erp-cash-span">
                <button className="erp-cash-btn erp-cash-primary" type="submit">Aplicar filtros</button>
                <button className="erp-cash-btn" type="button" onClick={() => {
                  if (tab === 'movements') { setMoveDraft(EMPTY_MOVEMENT_FILTER); setMoveApplied({}); setMovePage(1); }
                  else if (tab === 'entries') { setEntryDraft(EMPTY_ENTRY_FILTER); setEntryApplied({}); setEntryPage(1); }
                  else { setClosureDraft(EMPTY_CLOSURE_FILTER); setClosureApplied({}); setClosurePage(1); }
                }}>Limpiar</button>
              </div>
            </form>
            {listingBusy && <p role="status" className="erp-cash-muted">Cargando registros…</p>}
            {listingError && <p role="alert" className="erp-cash-notice error">{listingError}</p>}
            {!listingBusy && !listingError && (
              <div className="erp-cash-table-box"><table className="erp-cash-table"><thead><tr>{table.columns.map((col) => <th key={col}>{col}</th>)}<th>Detalle</th></tr></thead>
                <tbody>{listing.data.length ? listing.data.map((row, index) => (
                  <tr key={row.id_cash_movement ?? row.id_financial_entry ?? row.id_cash_closure ?? `${row.business_date}-${index}`}>
                    {table.cells(row).map((cell, i) => <td key={`${i}-${index}`}>{valueText(cell)}</td>)}
                    <td><button className="erp-cash-btn" type="button" disabled={detailBusy} onClick={() => viewDetails(table.path(row), `${table.name} #${row.id_cash_movement || row.id_financial_entry || row.id_cash_closure}`)}>Ver</button></td>
                  </tr>
                )) : <tr><td colSpan={table.columns.length + 1}>No hay registros para los filtros seleccionados.</td></tr>}</tbody>
              </table></div>
            )}
            {!listingBusy && !listingError && <div className="erp-cash-pagination">
              <button className="erp-cash-btn" type="button" disabled={currentPage <= 1} onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}>Anterior</button>
              <span className="erp-cash-muted">Página {currentPage} de {movementCount}</span>
              <button className="erp-cash-btn" type="button" disabled={currentPage >= movementCount} onClick={() => setCurrentPage((p) => p + 1)}>Siguiente</button>
            </div>}
          </section>
        )}

        {tab === 'closures' && admin && (
          <section className="erp-cash-card" aria-labelledby="close-title">
            <h2 id="close-title">Realizar cierre de caja</h2>
            <p className="erp-cash-muted">Se cierra la fecha elegida en el resumen. El cierre es definitivo y registra un asiento de auditoría.</p>
            {!canClose && <p className="erp-cash-notice">No se puede cerrar esta fecha: comprueba que esté abierta, que el resumen haya cargado y que el efectivo esperado sea válido.</p>}
            <form onSubmit={submitClosure}>
              <div className="erp-cash-grid">
                <label className="erp-cash-field">Efectivo inicial (Bs)
                  {summary?.suggested_opening_cash === null ? (
                    <input type="text" inputMode="decimal" placeholder="0.00" value={closeOpening} onChange={(event) => setCloseOpening(event.target.value)} disabled={saving || !summary || summary.closed} required />
                  ) : <input readOnly value={summary?.suggested_opening_cash ?? '—'} />}
                  <small>El primer cierre requiere el saldo inicial; los siguientes lo heredan del cierre anterior.</small>
                </label>
                <label className="erp-cash-field">Efectivo físico contado (Bs) *
                  <input type="text" inputMode="decimal" placeholder="0.00" value={closeCounted} onChange={(event) => setCloseCounted(event.target.value)} disabled={saving || !canClose} required />
                </label>
                <div className="erp-cash-field"><span>Efectivo esperado</span><strong>{expected === null ? '—' : money(centsText(expected))}</strong></div>
                <div className="erp-cash-field"><span>Diferencia (contado − esperado)</span>
                  <strong className={difference !== null && difference !== 0n ? 'erp-cash-danger-text' : ''}>{difference === null ? '—' : money(centsText(difference))}</strong>
                </div>
                <label className="erp-cash-field erp-cash-span">Observaciones / explicación de diferencias
                  <textarea value={closeNotes} maxLength={2000} onChange={(event) => setCloseNotes(event.target.value)} disabled={saving || !canClose} placeholder="Si hay diferencias, explica el motivo (mínimo 10 caracteres)." />
                </label>
                <label className="erp-cash-check erp-cash-span"><input type="checkbox" checked={closeAcknowledged} onChange={(event) => setCloseAcknowledged(event.target.checked)} disabled={saving || !canClose} />
                  Revisé ingresos, gastos y devoluciones, conté el efectivo y autorizo el cierre definitivo de esta fecha.
                </label>
              </div>
              <div className="erp-cash-form-actions"><button type="submit" className="erp-cash-btn erp-cash-primary" disabled={!canClose || saving || !closeAcknowledged || counted === null}>
                {saving ? 'Cerrando…' : `Confirmar cierre del ${dayLabel(day)}`}
              </button></div>
            </form>
          </section>
        )}

        {tab === 'reports' && admin && (
          <section className="erp-cash-card" aria-labelledby="report-title">
            <h2 id="report-title">Reporte financiero</h2>
            <p className="erp-cash-muted">Resumen contable por métodos y categorías. Período máximo: 366 días.</p>
            <form className="erp-cash-grid" onSubmit={(event) => {
              event.preventDefault(); const message = validateRange(reportDraft);
              if (message || !reportDraft.from || !reportDraft.to) return showNotice('error', message || 'Selecciona fecha inicial y final.');
              const days = (Date.parse(`${reportDraft.to}T00:00:00Z`) - Date.parse(`${reportDraft.from}T00:00:00Z`)) / 86400000;
              if (days > 365) return showNotice('error', 'El reporte permite como máximo 366 días.');
              setNotice(null); setReportApplied({ ...reportDraft });
            }}>
              <label className="erp-cash-field">Desde<input type="date" required value={reportDraft.from} onChange={(event) => setReportDraft((prev) => ({ ...prev, from: event.target.value }))} /></label>
              <label className="erp-cash-field">Hasta<input type="date" required value={reportDraft.to} onChange={(event) => setReportDraft((prev) => ({ ...prev, to: event.target.value }))} /></label>
              <div className="erp-cash-form-actions erp-cash-span"><button className="erp-cash-btn erp-cash-primary" type="submit">Generar reporte</button></div>
            </form>
            {listingBusy && <p className="erp-cash-muted" role="status">Generando reporte…</p>}
            {listingError && <p className="erp-cash-notice error" role="alert">{listingError}</p>}
            {report && !listingBusy && !listingError && <>
              <p className="erp-cash-muted">Período: {dayLabel(report.from)} – {dayLabel(report.to)}</p>
              <div className="erp-cash-stat-grid">
                {[
                  ['Ingresos', 'total_income'], ['Gastos', 'total_expenses'],
                  ['Reversiones', 'total_reversals'], ['Resultado neto', 'net_income'],
                ].map(([label, field]) => <div className="erp-cash-stat" key={field}><span>{label}</span><strong>{money(report.totals[field])}</strong></div>)}
              </div>
              <h3>Por método de pago</h3>
              <div className="erp-cash-table-box"><table className="erp-cash-table"><thead><tr><th>Método</th><th>Tipo</th><th>Operaciones</th><th>Total</th></tr></thead>
                <tbody>{report.by_method.length ? report.by_method.map((row, index) => <tr key={`${row.id_payment_method}-${row.movement_kind}-${index}`}>
                  <td>{row.payment_method}</td><td>{MOVEMENT_NAMES[row.movement_kind] || row.movement_kind}</td><td>{row.operations}</td><td>{money(row.total_amount)}</td>
                </tr>) : <tr><td colSpan={4}>Sin movimientos.</td></tr>}</tbody></table></div>
              <h3 style={{ marginTop: 22 }}>Por categoría</h3>
              <div className="erp-cash-table-box"><table className="erp-cash-table"><thead><tr><th>Tipo</th><th>Categoría</th><th>Operaciones</th><th>Total</th></tr></thead>
                <tbody>{report.by_category.length ? report.by_category.map((row, index) => <tr key={`${row.entry_type}-${row.category}-${index}`}>
                  <td>{row.entry_type === 'EXPENSE' ? 'Gasto' : 'Otro ingreso'}</td><td>{row.category}</td><td>{row.operations}</td><td>{money(row.total_amount)}</td>
                </tr>) : <tr><td colSpan={4}>Sin registros de gastos u otros ingresos.</td></tr>}</tbody></table></div>
            </>}
          </section>
        )}
        {detail && <Detail title={detail.title} data={detail.data} close={() => setDetail(null)} />}
      </main>
    </div>
  );
}
