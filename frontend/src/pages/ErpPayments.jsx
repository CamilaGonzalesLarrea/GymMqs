import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import { API_URL } from '../config/api';
import {
  listErpPaymentMethods,
  listErpPayments,
  getErpPaymentById,
  registerErpPayment,
  cancelErpPayment,
  erpRequest,
  clearErpSession,
} from '../config/erpApi';

// Consulta Operaciones mediante JWT y conserva los cobros transaccionales del ERP.
// El backend vuelve a validar sesión, permisos, precio, renovaciones y caja.
const PAGE_SIZE = 15;
const MAX_ID = 2147483647;
const INITIAL_FILTERS = {
  status: '',
  id_customer: '',
  id_membership: '',
  from: '',
  to: '',
};
const moneyFormatter = new Intl.NumberFormat('es-BO', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function positiveId(value) {
  const text = String(value ?? '');
  if (!/^[1-9]\d*$/.test(text)) return null;
  const id = Number(text);
  return Number.isSafeInteger(id) && id <= MAX_ID ? id : null;
}

function decimalAmount(value) {
  const text = String(value ?? '');
  if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) && number > 0
    ? number.toFixed(2)
    : null;
}

function moneyLabel(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `Bs ${moneyFormatter.format(number)}` : '—';
}

function datePart(value) {
  if (typeof value !== 'string') return '';
  return value.slice(0, 10);
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function todayInBolivia() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const part = (key) => parts.find((item) => item.type === key)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function formatDate(value) {
  const date = datePart(value);
  return validDate(date) ? `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}` : '—';
}

function formatDateTime(value) {
  if (!value) return '—';
  const input = String(value);
  // MySQL DATETIME de este proyecto se almacena en UTC.
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(input)
    ? `${input.replace(' ', 'T')}Z`
    : input;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return input;
  return new Intl.DateTimeFormat('es-BO', {
    dateStyle: 'short', timeStyle: 'short', timeZone: 'America/La_Paz',
  }).format(date);
}

function errorMessage(error, fallback) {
  return typeof error?.message === 'string' && error.message.trim()
    ? error.message
    : fallback;
}

function isAbort(error) {
  return error?.name === 'AbortError' || error?.code === 'REQUEST_CANCELLED';
}

function normalizeRole(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

function currentUser() {
  try {
    const user = JSON.parse(localStorage.getItem('user') ?? 'null');
    return user && typeof user === 'object' && !Array.isArray(user) ? user : null;
  } catch {
    return null;
  }
}

async function loadLegacyList(endpoint, signal) {
  // Operaciones usa JWT; erpRequest solo admite rutas /api/erp/.
  // Estas peticiones son exclusivamente de lectura, nunca generan cobros.
  if (!['/memberships', '/customers', '/membership-plans'].includes(endpoint)) {
    throw new Error('La consulta a Operaciones no está permitida.');
  }

  let token;
  try {
    token = window.sessionStorage.getItem('authToken');
  } catch {
    throw new Error('No se puede acceder a tu sesión. Inicia sesión de nuevo.');
  }
  if (!token || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
    throw new Error('La sesión no es válida. Inicia sesión nuevamente.');
  }

  const response = await fetch(`${API_URL}${endpoint}`, {
    method: 'GET',
    signal,
    cache: 'no-store',
    credentials: 'omit',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });
  if (response.status === 401) {
    clearErpSession();
    throw new Error('Tu sesión venció. Inicia sesión nuevamente.');
  }
  if (!response.ok) {
    if (response.status === 403) {
      throw new Error(`No tienes permiso para consultar ${endpoint}.`);
    }
    throw new Error(`No se pudo cargar ${endpoint} (HTTP ${response.status}).`);
  }
  const data = await response.json();
  if (!Array.isArray(data)) {
    throw new Error(`Operaciones devolvió un listado inválido desde ${endpoint}.`);
  }
  return data;
}

const styles = `
.erp-payments-page { min-height:100vh; background:radial-gradient(circle at 85% 4%, rgba(192,0,37,.13), transparent 38%), #090909; color:#f8f8f8; font-family: 'Segoe UI',Arial,sans-serif; }
.erp-payments-page * { box-sizing:border-box; }
.erp-payments-main { margin-left:245px; padding:35px 38px 65px; max-width:1750px; }
.erp-payments-top { display:flex; justify-content:space-between; align-items:flex-start; gap:18px; margin-bottom:24px; }
.erp-payments-kicker { color:#f04462; letter-spacing:2px; font-size:11px; font-weight:800; }
.erp-payments-page h1 { margin:8px 0 7px; font-size:32px; font-weight:650; }
.erp-payments-page h2 { font-size:20px; margin:0 0 8px; font-weight:650; }
.erp-payments-page p { line-height:1.5; }
.erp-payments-subtitle { color:#9c9ca5; margin:0; font-size:14px; }
.erp-payments-actions { display:flex; align-items:center; gap:9px; flex-wrap:wrap; }
.erp-payments-card { background:#141416; border:1px solid #303037; border-radius:13px; padding:24px; margin:18px 0; }
.erp-payments-tabs { display:flex; gap:6px; padding:5px; background:#151517; border:1px solid #29292d; border-radius:11px; width:fit-content; }
.erp-payments-tabs button { border:0; padding:11px 17px; border-radius:8px; background:transparent; color:#aaaab4; font-size:14px; cursor:pointer; }
.erp-payments-tabs button[aria-selected="true"] { background:#bc002d; color:white; font-weight:700; }
.erp-payments-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; }
.erp-payments-field { display:flex; flex-direction:column; gap:8px; font-size:13px; color:#cfcfd2; font-weight:600; }
.erp-payments-field input, .erp-payments-field select, .erp-payments-field textarea { background:#1e1e21; border:1px solid #38383d; border-radius:8px; padding:12px 13px; color:#fff; font:inherit; font-weight:400; min-width:0; width:100%; }
.erp-payments-field textarea { resize:vertical; min-height:85px; }
.erp-payments-field input:focus, .erp-payments-field select:focus, .erp-payments-field textarea:focus { outline:2px solid rgba(213,23,66,.45); border-color:#db194e; }
.erp-payments-field input:disabled, .erp-payments-field select:disabled { opacity:.55; cursor:not-allowed; }
.erp-payments-field small { font-size:12px; color:#92929c; font-weight:400; }
.erp-payments-wide { grid-column:1 / -1; }
.erp-payments-btn { border:1px solid #3c3c43; border-radius:8px; background:#242427; color:#fff; padding:11px 15px; font-size:13px; font-weight:650; cursor:pointer; }
.erp-payments-btn:hover:not(:disabled) { background:#303036; }
.erp-payments-btn:disabled { opacity:.45; cursor:not-allowed; }
.erp-payments-primary { background:#c0002b; border-color:#c0002b; }
.erp-payments-primary:hover:not(:disabled) { background:#e00034; }
.erp-payments-danger { border-color:#a42d48; background:#431522; }
.erp-payments-danger:hover:not(:disabled) { background:#662033; }
.erp-payments-footer { display:flex; align-items:center; justify-content:flex-end; flex-wrap:wrap; gap:11px; margin-top:22px; }
.erp-payments-summary { display:flex; gap:15px; flex-wrap:wrap; padding:14px 17px; background:#1b1b1d; border:1px solid #303036; border-radius:10px; margin:20px 0; }
.erp-payments-summary span { color:#a8a8b1; font-size:12px; }
.erp-payments-summary strong { color:#fff; font-size:15px; }
.erp-payments-notice { padding:13px 16px; margin:15px 0; border-radius:9px; border:1px solid #444049; background:#221e25; color:#e6dce2; font-size:13px; }
.erp-payments-notice.error { border-color:#8a3444; background:#32191f; color:#ffd3dc; }
.erp-payments-notice.success { border-color:#2a7658; background:#152e24; color:#b9f2d1; }
.erp-payments-table-wrap { overflow:auto; border:1px solid #313136; border-radius:10px; margin-top:16px; }
.erp-payments-table { width:100%; min-width:760px; border-collapse:collapse; text-align:left; }
.erp-payments-table th { padding:13px 12px; background:#1c1c20; color:#a1a1aa; text-transform:uppercase; font-size:11px; font-weight:700; }
.erp-payments-table td { padding:14px 12px; font-size:13px; border-top:1px solid #303036; vertical-align:middle; }
.erp-payments-table tr:hover td { background:#1b1b1e; }
.erp-payments-muted { color:#9898a2; font-size:12px; }
.erp-payments-pill { display:inline-block; padding:5px 9px; border-radius:99px; font-size:11px; font-weight:700; }
.erp-payments-pill.paid { color:#b3edd0; background:#173a2b; }
.erp-payments-pill.cancelled { color:#ffb4c0; background:#4c1e2b; }
.erp-payments-checkbox { display:flex; gap:10px; align-items:flex-start; color:#d9d9df; font-size:13px; line-height:1.5; cursor:pointer; }
.erp-payments-checkbox input { margin-top:3px; accent-color:#cf0030; }
.erp-payments-empty { padding:30px 15px; text-align:center; color:#a8a8b1; }
.erp-payments-pagination { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px; margin-top:20px; color:#b4b4bc; font-size:13px; }
.erp-payments-modal-bg { position:fixed; inset:0; z-index:200; background:rgba(0,0,0,.78); display:flex; justify-content:center; align-items:center; padding:16px; }
.erp-payments-modal { background:#151517; border:1px solid #65313e; border-radius:14px; padding:25px; width:min(100%,570px); max-height:90vh; overflow:auto; box-shadow:0 18px 80px #000a; }
.erp-payments-modal p { color:#b9b9c1; font-size:13px; }
.erp-payments-modal .erp-payments-field { margin:15px 0; }
.erp-payments-inline { display:flex; align-items:center; gap:12px; justify-content:space-between; flex-wrap:wrap; }
.erp-payments-renewal { background:#1c1921; border:1px solid #48323e; border-radius:10px; padding:17px; margin-top:2px; }
.erp-payments-renewal h3 { font-size:15px; margin:0 0 7px; color:#fff; }
.erp-payments-renewal p { color:#bcb0ba; font-size:12px; margin:0 0 13px; }
.erp-payments-renewal-hint { display:block; margin-top:8px; color:#a9a9b4; font-size:12px; line-height:1.5; }
.erp-payments-renewal .erp-payments-checkbox { margin-top:14px; }
.erp-payments-renewal .erp-payments-checkbox input { width:auto; }
@media(max-width:900px) { .erp-payments-main { margin-left:0; padding:24px 17px 45px; } .erp-payments-page .sidebar { display:none; } .erp-payments-grid { grid-template-columns:1fr; } .erp-payments-top { flex-direction:column; } .erp-payments-page h1 { font-size:27px; } }
`;

export default function ErpPayments() {
  const navigate = useNavigate();
  const user = useMemo(() => currentUser(), []);
  const role = normalizeRole(user?.role);
  const isAdmin = role === 'admin' || role === 'administrador';
  const canWorkWithPayments = isAdmin || role === 'recepcionista' || role === 'recepcion';

  const [tab, setTab] = useState('register');
  const [methods, setMethods] = useState([]);
  const [memberships, setMemberships] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [plans, setPlans] = useState([]);
  const [refsLoading, setRefsLoading] = useState(true);
  const [refsWarning, setRefsWarning] = useState('');
  const [selectedMembershipId, setSelectedMembershipId] = useState('');
  const [selectedMethodId, setSelectedMethodId] = useState('');
  const [notes, setNotes] = useState('');
  const [received, setReceived] = useState(false);
  // Vinculación opcional con una solicitud de Marketing ya existente.
  // El cobro y el cambio de estado se realizan exclusivamente en el backend.
  const [renewalRequestId, setRenewalRequestId] = useState('');
  const [noRenewalConfirmed, setNoRenewalConfirmed] = useState(false);
  const [renewalLookup, setRenewalLookup] = useState({
    customerId: null, items: [], loading: false, error: '', incomplete: false,
  });
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);
  const inFlight = useRef(false);

  const [history, setHistory] = useState([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [draftFilters, setDraftFilters] = useState(INITIAL_FILTERS);
  const [activeFilters, setActiveFilters] = useState({});
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);

  const [details, setDetails] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [refundReference, setRefundReference] = useState('');
  const [refundConfirmed, setRefundConfirmed] = useState(false);
  const [modalError, setModalError] = useState('');

  const today = todayInBolivia();
  const pending = useMemo(() => memberships.filter((item) =>
    item.status === 'PENDING' && validDate(datePart(item.end_date)) &&
    datePart(item.end_date) >= today,
  ), [memberships, today]);

  const customerById = useMemo(() =>
    new Map(customers.map((item) => [Number(item.id_customer), item])), [customers]);
  const planById = useMemo(() =>
    new Map(plans.map((item) => [Number(item.id_plan), item])), [plans]);

  const selectedMembership = useMemo(() =>
    pending.find((item) => String(item.id_membership) === selectedMembershipId) || null,
  [pending, selectedMembershipId]);
  const selectedCustomer = selectedMembership
    ? customerById.get(Number(selectedMembership.id_customer)) : null;
  const selectedPlan = selectedMembership
    ? planById.get(Number(selectedMembership.id_plan)) : null;
  const selectedMethod = methods.find((item) => String(item.id_payment_method) === selectedMethodId);
  const amount = selectedMembership ? decimalAmount(selectedMembership.applied_price) : null;
  const selectedCustomerId = selectedMembership ? Number(selectedMembership.id_customer) : null;
  const renewalLookupCurrent = renewalLookup.customerId === selectedCustomerId;
  const eligibleRenewals = useMemo(() => {
    if (!selectedMembership || !renewalLookupCurrent) return [];
    return renewalLookup.items.filter((item) =>
      item.status === 'REQUESTED' &&
      Number(item.id_customer) === selectedCustomerId &&
      Number(item.id_previous_membership) !== Number(selectedMembership.id_membership) &&
      (item.id_new_membership == null ||
        Number(item.id_new_membership) === Number(selectedMembership.id_membership)) &&
      // Una renovación debe empezar después de la membresía anterior.
      (!validDate(datePart(item.previous_end_date)) ||
        datePart(selectedMembership.start_date) > datePart(item.previous_end_date)),
    );
  }, [selectedMembership, selectedCustomerId, renewalLookupCurrent, renewalLookup.items]);
  const alreadyLinked = eligibleRenewals.find((item) =>
    Number(item.id_new_membership) === Number(selectedMembership?.id_membership));
  const effectiveRenewalId = renewalRequestId ||
    (alreadyLinked ? String(alreadyLinked.id_renewal_request) : '');
  const renewalLookupBusy = selectedCustomerId != null &&
    (!renewalLookupCurrent || renewalLookup.loading);
  const renewalUncertain = Boolean(renewalLookupCurrent &&
    (renewalLookup.error || renewalLookup.incomplete));
  const needsRenewalDecision = !effectiveRenewalId &&
    (eligibleRenewals.length > 0 || renewalUncertain);


  const loadReferenceData = useCallback(async (signal) => {
    setRefsLoading(true);
    const queries = await Promise.allSettled([
      listErpPaymentMethods({ signal }),
      loadLegacyList('/memberships', signal),
      loadLegacyList('/customers', signal),
      loadLegacyList('/membership-plans', signal),
    ]);
    if (signal?.aborted) return;
    const [methodsResult, membershipsResult, customersResult, plansResult] = queries;
    if (methodsResult.status === 'fulfilled' && Array.isArray(methodsResult.value)) {
      setMethods(methodsResult.value);
    } else {
      setMethods([]);
    }
    setMemberships(membershipsResult.status === 'fulfilled' ? membershipsResult.value : []);
    setCustomers(customersResult.status === 'fulfilled' ? customersResult.value : []);
    setPlans(plansResult.status === 'fulfilled' ? plansResult.value : []);
    const errors = queries.filter((item) => item.status === 'rejected' && !isAbort(item.reason));
    setRefsWarning(errors.length
      ? 'No se pudieron cargar todos los datos. Revisa la conexión, tus permisos y vuelve a actualizar.'
      : '');
    setRefsLoading(false);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    Promise.resolve().then(() => {
      if (canWorkWithPayments && !controller.signal.aborted) {
        return loadReferenceData(controller.signal);
      }
      return undefined;
    });
    return () => controller.abort();
  }, [canWorkWithPayments, loadReferenceData, refreshKey]);

  useEffect(() => {
    if (!canWorkWithPayments || !positiveId(selectedCustomerId)) return undefined;

    const customerId = selectedCustomerId;
    const controller = new AbortController();
    // Evita mezclar solicitudes cuando se selecciona otro cliente.
    Promise.resolve().then(() => {
      if (!controller.signal.aborted) {
        setRenewalLookup({
          customerId, items: [], loading: true, error: '', incomplete: false,
        });
      }
    });

    erpRequest('/api/erp/marketing/renewals', {
      params: { status: 'REQUESTED', id_customer: customerId, page: 1, limit: 100 },
      signal: controller.signal,
    })
      .then((data) => {
        if (controller.signal.aborted) return;
        if (!data || !Array.isArray(data.items) || !Number.isFinite(Number(data.total))) {
          throw new Error('Marketing devolvió solicitudes con formato incorrecto.');
        }
        setRenewalLookup({
          customerId,
          items: data.items,
          loading: false,
          error: '',
          incomplete: Number(data.total) > data.items.length,
        });
      })
      .catch((error) => {
        if (controller.signal.aborted || isAbort(error)) return;
        setRenewalLookup({
          customerId, items: [], loading: false,
          error: errorMessage(error, 'No se pudieron consultar las renovaciones.'),
          incomplete: false,
        });
      });

    return () => controller.abort();
  }, [canWorkWithPayments, selectedCustomerId, refreshKey]);

  useEffect(() => {
    if (!canWorkWithPayments) return undefined;
    const controller = new AbortController();
    Promise.resolve().then(() => {
      if (controller.signal.aborted) return;
      setHistoryLoading(true);
      setHistoryError('');
      return listErpPayments({ ...activeFilters, page, limit: PAGE_SIZE }, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        if (!result || !Array.isArray(result.data) || !Number.isFinite(Number(result.total))) {
          throw new Error('El servidor devolvió un historial con formato inesperado.');
        }
        setHistory(result.data);
        setHistoryTotal(Math.max(0, Number(result.total)));
      })
      .catch((error) => {
        if (controller.signal.aborted || isAbort(error)) return;
        setHistory([]);
        setHistoryTotal(0);
        setHistoryError(errorMessage(error, 'No se pudo consultar el historial.'));
      })
      .finally(() => { if (!controller.signal.aborted) setHistoryLoading(false); });
    });
    return () => controller.abort();
  }, [canWorkWithPayments, activeFilters, page, refreshKey]);

  const reloadAll = () => setRefreshKey((value) => value + 1);

  function submitFilters(event) {
    event.preventDefault();
    if (draftFilters.id_customer && !positiveId(draftFilters.id_customer)) {
      setHistoryError('El ID de cliente debe ser un entero positivo.');
      return;
    }
    if (draftFilters.id_membership && !positiveId(draftFilters.id_membership)) {
      setHistoryError('El ID de membresía debe ser un entero positivo.');
      return;
    }
    for (const field of ['from', 'to']) {
      if (draftFilters[field] && !validDate(draftFilters[field])) {
        setHistoryError(`La fecha ${field === 'from' ? 'inicial' : 'final'} no es válida.`);
        return;
      }
    }
    if (draftFilters.from && draftFilters.to && draftFilters.from > draftFilters.to) {
      setHistoryError('La fecha inicial no puede ser posterior a la final.');
      return;
    }
    setHistoryError('');
    setActiveFilters(Object.fromEntries(Object.entries(draftFilters).filter(([, value]) => value !== '')));
    setPage(1);
  }

  async function submitPayment(event) {
    event.preventDefault();
    if (inFlight.current || saving) return;
    if (!selectedMembership || !positiveId(selectedMembership.id_membership)) {
      setNotice({ type: 'error', text: 'Selecciona una membresía pendiente y vigente.' });
      return;
    }
    if (!selectedCustomer || selectedCustomer.status !== 'ACTIVE' ||
        !selectedPlan || selectedPlan.status !== 'ACTIVE') {
      setNotice({ type: 'error', text: 'El cliente y el plan deben estar activos. Actualiza los datos.' });
      return;
    }
    if (!amount || !selectedMethod || !positiveId(selectedMethod.id_payment_method)) {
      setNotice({ type: 'error', text: 'Verifica el importe y selecciona un método de pago.' });
      return;
    }
    if (notes.trim().length > 1000) {
      setNotice({ type: 'error', text: 'Las observaciones no pueden superar 1000 caracteres.' });
      return;
    }
    if (renewalLookupBusy) {
      setNotice({ type: 'error', text: 'Espera a que termine la consulta de solicitudes de renovación.' });
      return;
    }
    const renewalId = effectiveRenewalId.trim() ? positiveId(effectiveRenewalId.trim()) : null;
    if (effectiveRenewalId.trim() && !renewalId) {
      setNotice({ type: 'error', text: 'El ID de solicitud de renovación debe ser un entero positivo válido.' });
      return;
    }
    if (needsRenewalDecision && !noRenewalConfirmed) {
      setNotice({ type: 'error', text: 'Selecciona una solicitud de renovación o confirma que este cobro no debe vincularse.' });
      return;
    }
    if (!received) {
      setNotice({ type: 'error', text: 'Debes confirmar que recibiste el importe antes de registrarlo.' });
      return;
    }
    const renewalSuffix = renewalId ? ` También se completará la solicitud comercial #${renewalId}.` : '';
    const confirmation = `¿Confirmar cobro de ${moneyLabel(amount)} con ${selectedMethod.name} para la membresía #${selectedMembership.id_membership}? Se registrará un ingreso en caja.${renewalSuffix}`;
    if (!window.confirm(confirmation)) return;

    inFlight.current = true;
    setSaving(true);
    setNotice(null);
    try {
      const registered = await registerErpPayment({
        id_membership: Number(selectedMembership.id_membership),
        id_payment_method: Number(selectedMethod.id_payment_method),
        amount,
        ...(renewalId ? { id_renewal_request: renewalId } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      if (!positiveId(registered?.id_payment)) throw new Error('El servidor no confirmó el número de pago. Consulta el historial antes de repetir el cobro.');
      const renewalInfo = registered.id_renewal_request
        ? ` Solicitud de renovación #${registered.id_renewal_request} completada.`
        : '';
      setNotice({ type: 'success', text: `Pago #${registered.id_payment} registrado correctamente. Se actualizó la membresía y el movimiento de caja.${renewalInfo}` });
      setSelectedMembershipId('');
      setRenewalRequestId('');
      setNoRenewalConfirmed(false);
      setSelectedMethodId('');
      setNotes('');
      setReceived(false);
      setPage(1);
      reloadAll();
    } catch (error) {
      setNotice({ type: 'error', text: errorMessage(error, 'No se pudo registrar el pago. Comprueba el historial antes de intentar de nuevo.') });
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  async function showPayment(id, forCancellation = false) {
    if (detailLoading) return;
    setDetailLoading(true);
    setNotice(null);
    try {
      const result = await getErpPaymentById(id);
      if (!result || !positiveId(result.id_payment)) throw new Error('No se encontró el pago solicitado.');
      if (forCancellation) {
        if (!isAdmin || result.status !== 'REGISTERED') throw new Error('Este pago no puede anularse desde tu cuenta.');
        setCancelTarget(result);
        setModalError('');
        setCancelReason('');
        setRefundReference('');
        setRefundConfirmed(false);
      } else {
        setDetails(result);
      }
    } catch (error) {
      setNotice({ type: 'error', text: errorMessage(error, 'No se pudo consultar el pago.') });
    } finally {
      setDetailLoading(false);
    }
  }

  async function submitCancellation(event) {
    event.preventDefault();
    if (!cancelTarget || !isAdmin || inFlight.current || saving) return;
    const reason = cancelReason.trim();
    const reference = refundReference.trim();
    const cash = String(cancelTarget.payment_method ?? '').trim().toLowerCase() === 'efectivo';
    if (reason.length < 10 || reason.length > 500) {
      setModalError('El motivo debe contener entre 10 y 500 caracteres.');
      return;
    }
    if (!refundConfirmed) {
      setModalError('Debes confirmar que el reembolso ya fue realizado.');
      return;
    }
    if (!cash && !reference) {
      setModalError('Para QR o transferencia, indica la referencia de devolución.');
      return;
    }
    if (reference.length > 120) {
      setModalError('La referencia no puede superar 120 caracteres.');
      return;
    }
    if (!window.confirm(`¿Confirmas la anulación del pago #${cancelTarget.id_payment}? Quedará registrada junto con la devolución y no se podrá deshacer desde esta pantalla.`)) return;

    inFlight.current = true;
    setSaving(true);
    setNotice(null);
    try {
      await cancelErpPayment(cancelTarget.id_payment, {
        reason,
        refund_confirmed: true,
        ...(reference ? { refund_reference: reference } : {}),
      });
      setCancelTarget(null);
      setNotice({ type: 'success', text: `Pago #${cancelTarget.id_payment} anulado y reversión registrada. La membresía asociada quedó cancelada.` });
      setPage(1);
      reloadAll();
    } catch (error) {
      setModalError(errorMessage(error, 'No se pudo anular el pago.'));
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  const setFilter = (key, value) => setDraftFilters((current) => ({ ...current, [key]: value }));
  const pageCount = Math.max(1, Math.ceil(historyTotal / PAGE_SIZE));

  if (!canWorkWithPayments) {
    return (
      <div className="erp-payments-page">
        <style>{styles}</style>
        <Sidebar />
        <main className="erp-payments-main">
          <h1>Acceso no autorizado</h1>
          <p>Tu rol no tiene acceso a esta pantalla de Finanzas.</p>
          <button className="erp-payments-btn" type="button" onClick={() => navigate('/home')}>Volver a mi área</button>
        </main>
      </div>
    );
  }

  return (
    <div className="erp-payments-page">
      <style>{styles}</style>
      <Sidebar />
      <main className="erp-payments-main">
        <div className="erp-payments-top">
          <div>
            <span className="erp-payments-kicker">ERP MQS / FINANZAS</span>
            <h1>Pagos de membresías</h1>
            <p className="erp-payments-subtitle">Registro, consulta y control de cobros vinculados a caja.</p>
          </div>
          <div className="erp-payments-actions">
            <button type="button" className="erp-payments-btn" onClick={() => navigate('/operations')}>Ir a Operaciones</button>
            <button type="button" className="erp-payments-btn" onClick={reloadAll} disabled={saving}>Actualizar</button>
          </div>
        </div>

        {notice && <div role="alert" className={`erp-payments-notice ${notice.type}`}>{notice.text}</div>}
        <div className="erp-payments-tabs" role="tablist" aria-label="Secciones de pagos">
          <button type="button" role="tab" aria-selected={tab === 'register'} onClick={() => setTab('register')}>Registrar pago</button>
          <button type="button" role="tab" aria-selected={tab === 'history'} onClick={() => setTab('history')}>Historial de pagos</button>
        </div>

        {tab === 'register' && (
          <section className="erp-payments-card" aria-labelledby="erp-register-title">
            <h2 id="erp-register-title">Registrar un cobro</h2>
            <p className="erp-payments-subtitle">Selecciona una membresía pendiente. El precio se toma del registro original y no puede modificarse aquí.</p>
            {refsWarning && <p className="erp-payments-notice error" role="alert">{refsWarning}</p>}
            {refsLoading ? <p className="erp-payments-muted" role="status">Cargando clientes, membresías y métodos…</p> :
              pending.length === 0 && <div className="erp-payments-notice">No hay membresías pendientes y vigentes. Primero crea una membresía en <strong>Operaciones → Membresías</strong>; después podrás cobrarla aquí.</div>}

            <form onSubmit={submitPayment}>
              <div className="erp-payments-grid" style={{ marginTop: 21 }}>
                <label className="erp-payments-field erp-payments-wide">
                  Membresía pendiente *
                  <select value={selectedMembershipId} onChange={(event) => {
                  setSelectedMembershipId(event.target.value);
                  setRenewalRequestId('');
                  setNoRenewalConfirmed(false);
                  setReceived(false);
                }} required disabled={saving || refsLoading || !pending.length}>
                    <option value="">Seleccionar membresía</option>
                    {pending.map((membership) => {
                      const customer = customerById.get(Number(membership.id_customer));
                      const plan = planById.get(Number(membership.id_plan));
                      return (
                        <option key={membership.id_membership} value={String(membership.id_membership)}>
                          #{membership.id_membership} · {customer ? `${customer.first_name} ${customer.last_name}` : `Cliente #${membership.id_customer}`} · {plan?.plan_name || `Plan #${membership.id_plan}`} · {moneyLabel(membership.applied_price)}
                        </option>
                      );
                    })}
                  </select>
                  <small>Solo se muestran membresías con estado PENDING y sin fecha de fin vencida.</small>
                </label>
                <div className="erp-payments-field">
                  Cliente
                  <input readOnly value={selectedCustomer ? `${selectedCustomer.first_name} ${selectedCustomer.last_name}` : 'Selecciona una membresía'} />
                </div>
                <div className="erp-payments-field">
                  Plan
                  <input readOnly value={selectedPlan?.plan_name || '—'} />
                </div>
                <div className="erp-payments-field">
                  Vigencia de la membresía
                  <input readOnly value={selectedMembership ? `${formatDate(selectedMembership.start_date)} – ${formatDate(selectedMembership.end_date)}` : '—'} />
                </div>
                <div className="erp-payments-field">
                  Importe a cobrar (Bs)
                  <input readOnly value={amount || '—'} aria-label="Importe a cobrar en bolivianos" />
                </div>
                <label className="erp-payments-field">
                  Método de pago *
                  <select required value={selectedMethodId} onChange={(event) => setSelectedMethodId(event.target.value)} disabled={saving || refsLoading || !methods.length}>
                    <option value="">Seleccionar método</option>
                    {methods.map((method) => <option key={method.id_payment_method} value={String(method.id_payment_method)}>{method.name}</option>)}
                  </select>
                </label>
                {selectedMembership && (
                  <div className="erp-payments-renewal erp-payments-wide">
                    <h3>Solicitud de renovación (si corresponde)</h3>
                    <p>
                      Si el cliente solicitó renovar desde Marketing, vincula aquí la solicitud
                      pendiente. El backend comprobará cliente, membresía anterior, fechas y estado.
                    </p>
                    <label className="erp-payments-field">
                      ID de solicitud comercial
                      <input
                        inputMode="numeric"
                        pattern="[0-9]*"
                        list="erp-payments-renewal-options"
                        value={effectiveRenewalId}
                        onChange={(event) => {
                          setRenewalRequestId(event.target.value);
                          setNoRenewalConfirmed(false);
                          setReceived(false);
                        }}
                        disabled={saving || renewalLookupBusy || Boolean(alreadyLinked)}
                        placeholder="Opcional · Ej.: 12"
                        aria-describedby="erp-payments-renewal-help"
                      />
                      <datalist id="erp-payments-renewal-options">
                        {eligibleRenewals.map((item) => (
                          <option key={item.id_renewal_request}
                            value={String(item.id_renewal_request)}
                            label={`Solicitud #${item.id_renewal_request} · membresía anterior #${item.id_previous_membership}`} />
                        ))}
                      </datalist>
                    </label>
                    <small id="erp-payments-renewal-help" className="erp-payments-renewal-hint">
                      {renewalLookupBusy
                        ? 'Buscando solicitudes pendientes de este cliente…'
                        : alreadyLinked
                          ? `Esta membresía ya está asociada a la solicitud #${alreadyLinked.id_renewal_request}; se completará al cobrar.`
                          : eligibleRenewals.length > 0
                            ? `${eligibleRenewals.length} solicitud(es) posible(s): ${eligibleRenewals.map((item) => `#${item.id_renewal_request} (anterior #${item.id_previous_membership})`).join(', ')}.`
                            : 'No se encontraron solicitudes compatibles. Solo introduce un ID si Marketing ya creó la solicitud.'}
                    </small>
                    {renewalUncertain && (
                      <p className="erp-payments-notice error" role="alert">
                        No se pudo verificar la lista completa de renovaciones.
                        {renewalLookup.error ? ` ${renewalLookup.error}` : ' Hay más de 100 solicitudes pendientes.'}
                        {' '}Si corresponde una renovación, introduce su ID manualmente.
                      </p>
                    )}
                    {needsRenewalDecision && (
                      <label className="erp-payments-checkbox">
                        <input type="checkbox" checked={noRenewalConfirmed}
                          onChange={(event) => setNoRenewalConfirmed(event.target.checked)}
                          disabled={saving} />
                        Confirmo que este cobro NO debe vincularse con una solicitud de renovación pendiente.
                      </label>
                    )}
                  </div>
                )}
                <label className="erp-payments-field erp-payments-wide">
                  Observaciones (opcional)
                  <textarea maxLength={1000} value={notes} onChange={(event) => setNotes(event.target.value)} disabled={saving} placeholder="Ej. Referencia del cobro o información relevante" />
                  <small>{notes.length}/1000 caracteres</small>
                </label>
                <label className="erp-payments-checkbox erp-payments-wide">
                  <input type="checkbox" checked={received} onChange={(event) => setReceived(event.target.checked)} disabled={saving || !selectedMembership} />
                  Confirmo que el gimnasio ya recibió <strong>{moneyLabel(amount)}</strong> mediante el método seleccionado y autorizo su registro en caja.
                </label>
              </div>
              <div className="erp-payments-footer">
                <span className="erp-payments-muted">El backend volverá a comprobar precio, permisos, vigencia y caja abierta.</span>
                <button className="erp-payments-btn erp-payments-primary" type="submit" disabled={saving || refsLoading || renewalLookupBusy || !selectedMembership || !selectedCustomer || !selectedPlan || !selectedMethod || !amount || !received || (needsRenewalDecision && !noRenewalConfirmed)}>
                  {saving ? 'Guardando…' : 'Confirmar y registrar pago'}
                </button>
              </div>
            </form>
          </section>
        )}

        {tab === 'history' && (
          <section className="erp-payments-card" aria-labelledby="erp-history-title">
            <div className="erp-payments-inline">
              <div>
                <h2 id="erp-history-title">Historial de pagos</h2>
                <p className="erp-payments-subtitle">Filtra y consulta pagos registrados o anulados.</p>
              </div>
              <strong>{historyTotal} pago(s)</strong>
            </div>
            <form onSubmit={submitFilters} className="erp-payments-grid" style={{ marginTop: 22 }}>
              <label className="erp-payments-field">Estado
                <select value={draftFilters.status} onChange={(event) => setFilter('status', event.target.value)}>
                  <option value="">Todos</option>
                  <option value="REGISTERED">Registrado</option>
                  <option value="CANCELLED">Anulado</option>
                </select>
              </label>
              <label className="erp-payments-field">ID de cliente
                <input inputMode="numeric" pattern="[0-9]*" placeholder="Todos" value={draftFilters.id_customer} onChange={(event) => setFilter('id_customer', event.target.value)} />
              </label>
              <label className="erp-payments-field">ID de membresía
                <input inputMode="numeric" pattern="[0-9]*" placeholder="Todas" value={draftFilters.id_membership} onChange={(event) => setFilter('id_membership', event.target.value)} />
              </label>
              <label className="erp-payments-field">Desde
                <input type="date" value={draftFilters.from} onChange={(event) => setFilter('from', event.target.value)} />
              </label>
              <label className="erp-payments-field">Hasta
                <input type="date" value={draftFilters.to} onChange={(event) => setFilter('to', event.target.value)} />
              </label>
              <div className="erp-payments-footer">
                <button type="button" className="erp-payments-btn" onClick={() => { setDraftFilters(INITIAL_FILTERS); setActiveFilters({}); setPage(1); setHistoryError(''); }}>Limpiar</button>
                <button type="submit" className="erp-payments-btn erp-payments-primary">Aplicar filtros</button>
              </div>
            </form>
            {historyError && <p role="alert" className="erp-payments-notice error">{historyError}</p>}
            <div className="erp-payments-table-wrap">
              <table className="erp-payments-table">
                <thead><tr><th>Pago</th><th>Cliente / plan</th><th>Membresía</th><th>Fecha</th><th>Método</th><th>Importe</th><th>Estado</th><th>Acciones</th></tr></thead>
                <tbody>
                  {historyLoading ? <tr><td colSpan={8} className="erp-payments-empty">Cargando historial…</td></tr> : history.length === 0 ?
                    <tr><td colSpan={8} className="erp-payments-empty">No hay pagos para los filtros seleccionados.</td></tr> :
                    history.map((row) => (
                      <tr key={row.id_payment}>
                        <td>#{row.id_payment}</td>
                        <td><strong>{row.customer_name || `Cliente #${row.id_customer}`}</strong><div className="erp-payments-muted">{row.plan_name || '—'}</div></td>
                        <td>#{row.id_membership}</td>
                        <td>{formatDateTime(row.payment_date)}</td>
                        <td>{row.payment_method || '—'}</td>
                        <td><strong>{moneyLabel(row.amount)}</strong></td>
                        <td><span className={`erp-payments-pill ${row.status === 'REGISTERED' ? 'paid' : 'cancelled'}`}>{row.status === 'REGISTERED' ? 'Registrado' : 'Anulado'}</span></td>
                        <td><div className="erp-payments-actions">
                          <button type="button" className="erp-payments-btn" onClick={() => showPayment(row.id_payment)} disabled={detailLoading || saving}>Ver</button>
                          {isAdmin && row.status === 'REGISTERED' && <button type="button" className="erp-payments-btn erp-payments-danger" onClick={() => showPayment(row.id_payment, true)} disabled={detailLoading || saving}>Anular</button>}
                        </div></td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <div className="erp-payments-pagination">
              <span>Mostrando página {page} de {pageCount} · {historyTotal} registro(s)</span>
              <div className="erp-payments-actions">
                <button type="button" className="erp-payments-btn" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1 || historyLoading}>Anterior</button>
                <button type="button" className="erp-payments-btn" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={page >= pageCount || historyLoading}>Siguiente</button>
              </div>
            </div>
          </section>
        )}
      </main>

      {details && (
        <div className="erp-payments-modal-bg" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetails(null); }}>
          <section className="erp-payments-modal" role="dialog" aria-modal="true" aria-labelledby="erp-details-title">
            <h2 id="erp-details-title">Pago #{details.id_payment}</h2>
            <div className="erp-payments-summary">
              <span>Cliente <strong>{details.customer_name || `#${details.id_customer}`}</strong></span>
              <span>Plan <strong>{details.plan_name || '—'}</strong></span>
              <span>Membresía <strong>#{details.id_membership}</strong></span>
              <span>Método <strong>{details.payment_method}</strong></span>
              <span>Importe <strong>{moneyLabel(details.amount)}</strong></span>
              <span>Estado <strong>{details.status === 'REGISTERED' ? 'Registrado' : 'Anulado'}</strong></span>
              <span>Fecha <strong>{formatDateTime(details.payment_date)}</strong></span>
            </div>
            {details.notes && <p><strong>Observaciones:</strong> {details.notes}</p>}
            {details.cancellation_reason && <p><strong>Motivo de anulación:</strong> {details.cancellation_reason}</p>}
            {details.cancelled_at && <p><strong>Anulado:</strong> {formatDateTime(details.cancelled_at)}</p>}
            <div className="erp-payments-footer"><button className="erp-payments-btn" type="button" onClick={() => setDetails(null)}>Cerrar</button></div>
          </section>
        </div>
      )}

      {cancelTarget && (
        <div className="erp-payments-modal-bg" role="presentation">
          <section className="erp-payments-modal" role="dialog" aria-modal="true" aria-labelledby="erp-cancel-title">
            <h2 id="erp-cancel-title">Anular pago #{cancelTarget.id_payment}</h2>
            <p>Esta operación también cancelará la membresía relacionada y registrará la reversión del ingreso. El reembolso debe haberse realizado antes de confirmar.</p>
            <div className="erp-payments-summary"><span>Monto <strong>{moneyLabel(cancelTarget.amount)}</strong></span><span>Método <strong>{cancelTarget.payment_method}</strong></span></div>
            {modalError && <p className="erp-payments-notice error" role="alert">{modalError}</p>}
            <form onSubmit={submitCancellation}>
              <label className="erp-payments-field">Motivo de anulación *
                <textarea required minLength={10} maxLength={500} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} disabled={saving} placeholder="Describe el motivo con al menos 10 caracteres" />
                <small>{cancelReason.length}/500 caracteres</small>
              </label>
              <label className="erp-payments-field">Referencia de reembolso {String(cancelTarget.payment_method).toLowerCase() === 'efectivo' ? '(opcional)' : '*'}
                <input maxLength={120} value={refundReference} onChange={(event) => setRefundReference(event.target.value)} disabled={saving} placeholder="Comprobante, referencia bancaria o QR" />
              </label>
              <label className="erp-payments-checkbox">
                <input type="checkbox" checked={refundConfirmed} onChange={(event) => setRefundConfirmed(event.target.checked)} disabled={saving} />
                Confirmo que la devolución al cliente ya fue realizada y autorizo la anulación.
              </label>
              <div className="erp-payments-footer">
                <button type="button" className="erp-payments-btn" onClick={() => { setCancelTarget(null); setModalError(''); }} disabled={saving}>Volver</button>
                <button className="erp-payments-btn erp-payments-danger" type="submit" disabled={saving || !refundConfirmed || cancelReason.trim().length < 10}>
                  {saving ? 'Anulando…' : 'Confirmar anulación'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
