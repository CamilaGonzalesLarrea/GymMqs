import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_URL } from '../config/api';
import './Operations.css';

// Operaciones utiliza las rutas existentes. El JWT se adjunta para las
// solicitudes actuales y futuras; los permisos deben aplicarse en Express.
const REQUEST_TIMEOUT_MS = 20000;
const MAX_USER_ID = 2147483647;

function validId(value) {
  return /^[1-9]\d*$/.test(String(value ?? '')) &&
    Number.isSafeInteger(Number(value)) && Number(value) <= MAX_USER_ID;
}

function datePart(value) {
  return typeof value === 'string' ? value.slice(0, 10) : '';
}

function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function todayInBolivia() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const part = (name) => parts.find((item) => item.type === name)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function isValidMoney(value) {
  const text = String(value ?? '').trim();
  return /^\d{1,8}(?:\.\d{1,2})?$/.test(text) && Number(text) > 0;
}

function clearLocalSession() {
  try { window.localStorage.removeItem('user'); } catch { /* almacenamiento restringido */ }
  try {
    window.sessionStorage.removeItem('authToken');
    window.sessionStorage.removeItem('authTokenExpiresAt');
  } catch { /* almacenamiento restringido */ }
  // App.jsx vuelve a verificar la sesión cuando recibe focus.
  window.dispatchEvent(new Event('focus'));
}

function sessionToken() {
  try {
    const token = window.sessionStorage.getItem('authToken');
    const rawExpiry = window.sessionStorage.getItem('authTokenExpiresAt');
    const expiry = Number(rawExpiry);
    if (!token || token.length > 4096 || !Number.isSafeInteger(expiry) ||
        expiry <= Date.now() || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
      return null;
    }
    return token;
  } catch {
    return null;
  }
}

async function apiRequest(path, options = {}) {
  if (typeof path !== 'string' || !/^\/[a-z][A-Za-z0-9/_-]*(?:\/[1-9]\d*)?(?:\/[a-z]+)?$/i.test(path)) {
    throw new Error('La ruta de la solicitud no es válida.');
  }

  const token = sessionToken();
  if (!token) {
    clearLocalSession();
    throw new Error('La sesión ha vencido. Vuelve a iniciar sesión.');
  }

  const headers = new Headers(options.headers || {});
  headers.set('Accept', 'application/json');
  headers.set('Authorization', `Bearer ${token}`);

  const controller = new AbortController();
  const externalSignal = options.signal;
  const cancel = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', cancel, { once: true });
  }
  let timedOut = false;
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers,
      signal: controller.signal,
      cache: 'no-store',
    });

    if (response.status === 401) {
      clearLocalSession();
      throw new Error('La sesión ya no es válida. Inicia sesión nuevamente.');
    }
    const contentType = response.headers.get('content-type') || '';
    let data = null;
    if (response.status !== 204) {
      const text = await response.text();
      if (text) {
        if (!contentType.toLowerCase().includes('application/json')) {
          throw new Error('El servidor devolvió una respuesta inesperada.');
        }
        try { data = JSON.parse(text); }
        catch { throw new Error('No se pudo interpretar la respuesta del servidor.'); }
      }
    }
    if (!response.ok) {
      const details = Array.isArray(data?.message)
        ? data.message.join(', ')
        : typeof data?.message === 'string' ? data.message : '';
      // No mostrar detalles internos del servidor al usuario.
      const message = response.status >= 500
        ? 'No se pudo completar la operación por un error del servidor.'
        : details || `La solicitud fue rechazada (HTTP ${response.status}).`;
      throw new Error(message);
    }
    return data;
  } catch (error) {
    if (error?.name === 'AbortError') {
      if (timedOut) throw new Error('El servidor tardó demasiado en responder. Actualiza y vuelve a intentar.', { cause: error });
      throw error;
    }
    if (error instanceof TypeError) {
      throw new Error('No fue posible conectar con el servidor. Verifica que el backend esté iniciado.', { cause: error });
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
    if (externalSignal) externalSignal.removeEventListener('abort', cancel);
  }
}

function Operations() {
  const navigate = useNavigate();

  const [currentUser] = useState(() => {
    try {
      const storedUser = localStorage.getItem('user');

      if (!storedUser) {
        return null;
      }

      return JSON.parse(storedUser);
    } catch {
      return null;
    }
  });

  const currentRole =
    typeof currentUser?.role === 'string'
      ? currentUser.role
      : currentUser?.role?.name || '';

  const normalizedRole = String(currentRole)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');

  const isAdmin =
    normalizedRole === 'administrador' ||
    normalizedRole === 'admin';

  const handleLogout = () => {
    clearLocalSession();
    navigate('/', { replace: true });
  };

  const handleGoToDashboard = () => {
    navigate('/dashboard');
  };

  const [section, setSection] = useState('customers');
  const [loadingError, setLoadingError] = useState('');
  const [saving, setSaving] = useState(false);
  const actionLock = useRef(false);

  // Evita dos envíos simultáneos, incluso con doble clic rápido.
  const withLock = async (operation) => {
    if (actionLock.current) return;
    actionLock.current = true;
    setSaving(true);
    try { await operation(); }
    finally { actionLock.current = false; setSaving(false); }
  };

  // =====================================================
  // CLIENTES
  // =====================================================

  const [customers, setCustomers] = useState([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] =
    useState(null);
  const [showCustomerForm, setShowCustomerForm] =
    useState(false);
  const [editingCustomerId, setEditingCustomerId] =
    useState(null);

  const emptyCustomerForm = {
    first_name: '',
    last_name: '',
    phone: '',
    email: '',
    birth_date: '',
    notes: '',
  };

  const [customerForm, setCustomerForm] =
    useState(emptyCustomerForm);

  // =====================================================
  // PLANES
  // =====================================================

  const [plans, setPlans] = useState([]);
  const [showPlanForm, setShowPlanForm] = useState(false);
  const [editingPlanId, setEditingPlanId] = useState(null);

  const emptyPlanForm = {
    plan_name: '',
    duration_days: '',
    price: '',
    description: '',
  };

  const [planForm, setPlanForm] = useState(emptyPlanForm);

  // =====================================================
  // MEMBRESÍAS
  // =====================================================

  const [memberships, setMemberships] = useState([]);
  const [showMembershipForm, setShowMembershipForm] =
    useState(false);

  const [renewingMembershipId, setRenewingMembershipId] =
    useState(null);

  const [renewalForm, setRenewalForm] = useState({
    id_plan: '',
    renewal_date: '',
  });

  // =====================================================
  // ASISTENCIAS
  // =====================================================

  const [attendances, setAttendances] = useState([]);
  const [showAttendanceForm, setShowAttendanceForm] =
    useState(false);

  const emptyAttendanceForm = {
    id_customer: '',
  };

  const [attendanceForm, setAttendanceForm] =
    useState(emptyAttendanceForm);

  // =====================================================
  // FECHA ACTUAL
  // =====================================================

  // Todas las fechas operativas corresponden al día de Bolivia (UTC-04:00).
  const getToday = todayInBolivia;

  const emptyMembershipForm = {
    id_customer: '',
    id_plan: '',
    start_date: getToday(),
  };

  const [membershipForm, setMembershipForm] =
    useState(emptyMembershipForm);

  // =====================================================
  // CARGAR DATOS
  // =====================================================

  const loadCustomers = useCallback(async (signal) => {
    const data = await apiRequest('/customers', { signal });
    if (!Array.isArray(data)) throw new Error('La respuesta de clientes es incorrecta.');
    if (!signal?.aborted) setCustomers(data);
  }, []);

  const loadPlans = useCallback(async (signal) => {
    const data = await apiRequest('/membership-plans', { signal });
    if (!Array.isArray(data)) throw new Error('La respuesta de planes es incorrecta.');
    if (!signal?.aborted) setPlans(data);
  }, []);

  const loadMemberships = useCallback(async (signal) => {
    const data = await apiRequest('/memberships', { signal });
    if (!Array.isArray(data)) throw new Error('La respuesta de membresías es incorrecta.');
    if (!signal?.aborted) setMemberships(data);
  }, []);

  const loadAttendances = useCallback(async (signal) => {
    const data = await apiRequest('/customer-attendances', { signal });
    if (!Array.isArray(data)) throw new Error('La respuesta de asistencias es incorrecta.');
    if (!signal?.aborted) setAttendances(data);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    Promise.resolve().then(() => {
      if (controller.signal.aborted) return [];
      return Promise.allSettled([
        loadCustomers(controller.signal),
        loadPlans(controller.signal),
        loadMemberships(controller.signal),
        loadAttendances(controller.signal),
      ]);
    }).then((results) => {
      if (controller.signal.aborted) return;
      const rejected = results.filter((item) => item.status === 'rejected' &&
        item.reason?.name !== 'AbortError');
      if (rejected.length > 0) {
        setLoadingError(`No se pudieron cargar ${rejected.length} de las 4 secciones. ` +
          'Comprueba la conexión y los permisos.');
      } else {
        setLoadingError('');
      }
    });
    return () => controller.abort();
  }, [loadCustomers, loadPlans, loadMemberships, loadAttendances]);

  // =====================================================
  // CAMBIAR SECCIÓN  // =====================================================
  // CAMBIAR SECCIÓN
  // =====================================================

  const changeSection = (newSection) => {
    setSection(newSection);

    setShowCustomerForm(false);
    setEditingCustomerId(null);
    setCustomerForm(emptyCustomerForm);
    setCustomerSearch('');
    setSelectedCustomerId(null);

    setShowPlanForm(false);
    setEditingPlanId(null);
    setPlanForm(emptyPlanForm);

    setShowMembershipForm(false);
    setMembershipForm({
      id_customer: '',
      id_plan: '',
      start_date: getToday(),
    });

    setRenewingMembershipId(null);
    setRenewalForm({
      id_plan: '',
      renewal_date: '',
    });

    setShowAttendanceForm(false);
    setAttendanceForm(emptyAttendanceForm);
  };

  // =====================================================
  // CLIENTES
  // =====================================================

  const handleCustomerChange = (event) => {
    setCustomerForm({
      ...customerForm,
      [event.target.name]: event.target.value,
    });
  };

  const handleNewCustomer = () => {
    setSelectedCustomerId(null);
    setEditingCustomerId(null);
    setCustomerForm(emptyCustomerForm);
    setShowCustomerForm(true);
  };

  const handleEditCustomer = (customer) => {
    setSelectedCustomerId(null);
    setEditingCustomerId(customer.id_customer);

    setCustomerForm({
      first_name: customer.first_name || '',
      last_name: customer.last_name || '',
      phone: customer.phone || '',
      email: customer.email || '',
      birth_date: datePart(customer.birth_date),
      notes: customer.notes || '',
    });

    setShowCustomerForm(true);
  };

  const handleCancelCustomer = () => {
    setShowCustomerForm(false);
    setEditingCustomerId(null);
    setCustomerForm(emptyCustomerForm);
  };

  const handleViewCustomer = (customer) => {
    setShowCustomerForm(false);
    setEditingCustomerId(null);
    setCustomerForm(emptyCustomerForm);
    setSelectedCustomerId(customer.id_customer);
  };

  const handleCloseCustomerDetail = () => {
    setSelectedCustomerId(null);
  };

  const handleCustomerSubmit = async (event) => {
    event.preventDefault();

    const url = editingCustomerId
      ? `/customers/${editingCustomerId}`
      : '/customers';

    const method = editingCustomerId ? 'PATCH' : 'POST';

    const body = {
      first_name: customerForm.first_name.trim(),
      last_name: customerForm.last_name.trim(),
      phone: customerForm.phone.trim(),
      email: customerForm.email.trim() || null,
      birth_date: customerForm.birth_date || null,
      notes: customerForm.notes.trim() || null,
    };

    if (!/^[^\d]{1,50}$/.test(body.first_name) || !/^[^\d]{1,50}$/.test(body.last_name)) {
      alert('El nombre y apellido deben ser válidos y tener como máximo 50 caracteres.');
      return;
    }
    if (body.phone.replace(/\D/g, '').length < 7 || body.phone.replace(/\D/g, '').length > 15) {
      alert('El teléfono debe contener entre 7 y 15 dígitos.');
      return;
    }
    if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(body.email.trim())) {
      alert('El correo electrónico no tiene un formato válido.');
      return;
    }
    if (body.birth_date && (!isDate(body.birth_date) || body.birth_date > todayInBolivia())) {
      alert('La fecha de nacimiento es inválida o futura.');
      return;
    }

    await withLock(async () => {
    try {
      await apiRequest(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      handleCancelCustomer();
      await loadCustomers();
    } catch (error) {
      alert(error.message);
    }
    });
  };

  const handleCustomerStatusChange = async (customer) => {
    if (!validId(customer.id_customer)) return;
    const newStatus = customer.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    if (!window.confirm(
      `¿Confirmas ${newStatus === 'ACTIVE' ? 'activar' : 'desactivar'} al cliente ` +
      `${customer.first_name} ${customer.last_name}?`,
    )) return;

    await withLock(async () => {
      try {
        await apiRequest(`/customers/${customer.id_customer}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus }),
        });
        await loadCustomers();
      } catch (error) { alert(error.message); }
    });
  };

  // =====================================================
  // PLANES
  // =====================================================

  const handlePlanChange = (event) => {
    setPlanForm({
      ...planForm,
      [event.target.name]: event.target.value,
    });
  };

  const handleNewPlan = () => {
    if (!isAdmin) return;
    setEditingPlanId(null);
    setPlanForm(emptyPlanForm);
    setShowPlanForm(true);
  };

  const handleEditPlan = (plan) => {
    if (!isAdmin) return;
    setEditingPlanId(plan.id_plan);

    setPlanForm({
      plan_name: plan.plan_name || '',
      duration_days: plan.duration_days || '',
      price: plan.price || '',
      description: plan.description || '',
    });

    setShowPlanForm(true);
  };

  const handleCancelPlan = () => {
    setShowPlanForm(false);
    setEditingPlanId(null);
    setPlanForm(emptyPlanForm);
  };

  const handlePlanSubmit = async (event) => {
    event.preventDefault();
    if (!isAdmin) {
      alert('Solo Administración puede crear o modificar planes.');
      return;
    }

    const url = editingPlanId
      ? `/membership-plans/${editingPlanId}`
      : '/membership-plans';

    const method = editingPlanId ? 'PATCH' : 'POST';

    const body = {
      plan_name: planForm.plan_name.trim(),
      duration_days: Number(planForm.duration_days),
      price: String(planForm.price).trim(),
      description: planForm.description.trim(),
    };

    const name = body.plan_name;
    const duration = body.duration_days;
    if (!name || name.length > 80) {
      alert('El nombre del plan es obligatorio y no puede superar 80 caracteres.');
      return;
    }
    if (!Number.isSafeInteger(duration) || duration < 1 || duration > 3650) {
      alert('La duración debe ser un número entero de 1 a 3650 días.');
      return;
    }
    if (!isValidMoney(body.price)) {
      alert('El precio debe ser mayor a cero, con hasta dos decimales y dentro del límite permitido.');
      return;
    }
    if (String(body.description ?? '').length > 500) {
      alert('La descripción no puede superar los 500 caracteres.');
      return;
    }

    await withLock(async () => {
    try {
      await apiRequest(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      handleCancelPlan();
      await loadPlans();
    } catch (error) {
      alert(error.message);
    }
    });
  };

  const handlePlanStatusChange = async (plan) => {
    if (!isAdmin || !validId(plan.id_plan)) return;
    const newStatus = plan.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    if (!window.confirm(
      `¿Confirmas ${newStatus === 'ACTIVE' ? 'activar' : 'desactivar'} ` +
      `el plan ${plan.plan_name}?`,
    )) return;

    await withLock(async () => {
      try {
        await apiRequest(`/membership-plans/${plan.id_plan}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus }),
        });
        await loadPlans();
      } catch (error) { alert(error.message); }
    });
  };

  // =====================================================
  // MEMBRESÍAS
  // =====================================================

  const handleMembershipChange = (event) => {
    setMembershipForm({
      ...membershipForm,
      [event.target.name]: event.target.value,
    });
  };

  const handleNewMembership = () => {
    setRenewingMembershipId(null);
    setRenewalForm({
      id_plan: '',
      renewal_date: '',
    });

    setMembershipForm({
      id_customer: '',
      id_plan: '',
      start_date: getToday(),
    });

    setShowMembershipForm(true);
  };

  const handleCancelMembership = () => {
    setShowMembershipForm(false);

    setMembershipForm({
      id_customer: '',
      id_plan: '',
      start_date: getToday(),
    });
  };

  const handleMembershipSubmit = async (event) => {
    event.preventDefault();

    const customer = customers.find(
      (item) =>
        item.id_customer ===
        Number(membershipForm.id_customer),
    );

    if (!customer || customer.status !== 'ACTIVE') {
      alert(
        'Selecciona un cliente activo antes de registrar la membresía.',
      );
      return;
    }

    const plan = plans.find(
      (item) =>
        item.id_plan === Number(membershipForm.id_plan),
    );

    if (!plan || plan.status !== 'ACTIVE') {
      alert(
        'Selecciona un plan activo antes de registrar la membresía.',
      );
      return;
    }

    if (!isDate(membershipForm.start_date)) {
      alert('Selecciona una fecha de inicio válida.');
      return;
    }
    if (!isValidMoney(plan.price)) {
      alert('El plan debe tener un precio positivo válido para poder cobrarlo.');
      return;
    }
    const lastDay = addDaysToDateString(membershipForm.start_date, Number(plan.duration_days) - 1);
    if (!isDate(lastDay) || lastDay < todayInBolivia()) {
      alert('La membresía no puede tener un vencimiento anterior al día de hoy.');
      return;
    }

    const body = {
      id_customer: customer.id_customer,
      id_plan: plan.id_plan,
      start_date: membershipForm.start_date,
    };

    await withLock(async () => {
    try {
      await apiRequest('/memberships', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      handleCancelMembership();
      await loadMemberships();
    } catch (error) {
      alert(error.message);
    }
    });
  };

  const handleActivateMembership = (membership) => {
    // El cobro del ERP registra el pago + ingreso en caja + activación en una
    // sola transacción. No utilizar la antigua ruta /memberships/:id/activate.
    if (membership.status !== 'PENDING' || !validId(membership.id_membership)) return;
    alert(`Para activar la membresía #${membership.id_membership}, selecciónala en Finanzas / Pagos y confirma el cobro.`);
    navigate('/erp/payments');
  };

  const handleCancelMembershipStatus = async (membership) => {
    if (!validId(membership.id_membership)) {
      alert('La membresía seleccionada no es válida.');
      return;
    }
    if (membership.status === 'ACTIVE') {
      // La anulación financiera revierte el ingreso y cancela la membresía.
      // Evita dejar en caja un cobro de una membresía cancelada manualmente.
      alert(`Para anular la membresía activa #${membership.id_membership}, busca su pago en el historial de Finanzas y realiza la anulación autorizada. Si es una membresía antigua sin pago ERP, debe regularizarse primero.`);
      navigate('/erp/payments');
      return;
    }
    if (membership.status !== 'PENDING') {
      alert('Solo se pueden cancelar membresías pendientes desde Operaciones.');
      return;
    }

    if (!window.confirm(
      `¿Cancelar la membresía pendiente #${membership.id_membership}? No se registrará ningún movimiento de caja.`,
    )) return;

    await withLock(async () => {
      try {
        // Se vuelve a consultar para reducir el riesgo de actuar sobre un
        // estado obsoleto; el backend también deberá aplicar esta regla.
        const current = await apiRequest('/memberships');
        const fresh = Array.isArray(current) ? current.find((item) =>
          Number(item.id_membership) === Number(membership.id_membership)) : null;
        if (!fresh || fresh.status !== 'PENDING') {
          setMemberships(Array.isArray(current) ? current : []);
          throw new Error('La membresía ya cambió de estado. Actualiza antes de continuar.');
        }
        await apiRequest(`/memberships/${membership.id_membership}/cancel`, {
          method: 'PATCH',
        });
        await loadMemberships();
        alert('Membresía pendiente cancelada correctamente.');
      } catch (error) { alert(error.message); }
    });
  };

  const handleRenewMembership = (membership) => {
    const customer = customers.find(
      (item) =>
        item.id_customer === membership.id_customer,
    );

    if (!customer) {
      alert('No se encontró el cliente');
      return;
    }

    if (customer.status !== 'ACTIVE') {
      alert(
        'El cliente está inactivo. Debes activarlo antes de renovar la membresía.',
      );
      return;
    }

    const currentPlanIsActive = plans.some(
      (plan) =>
        plan.id_plan === membership.id_plan &&
        plan.status === 'ACTIVE',
    );

    setShowMembershipForm(false);

    setRenewingMembershipId(
      membership.id_membership,
    );

    setRenewalForm({
      id_plan: currentPlanIsActive
        ? String(membership.id_plan)
        : '',
      renewal_date: getToday(),
    });
  };

  const handleRenewalChange = (event) => {
    setRenewalForm({
      ...renewalForm,
      [event.target.name]: event.target.value,
    });
  };

  const handleCancelRenewal = () => {
    setRenewingMembershipId(null);
    setRenewalForm({
      id_plan: '',
      renewal_date: '',
    });
  };

  const handleRenewalSubmit = async (event) => {
    event.preventDefault();

    const membership = memberships.find(
      (item) =>
        item.id_membership === renewingMembershipId,
    );

    if (!membership) {
      alert('No se encontró la membresía a renovar');
      handleCancelRenewal();
      return;
    }

    const plan = plans.find((item) => Number(item.id_plan) === Number(renewalForm.id_plan));
    if (!plan || plan.status !== 'ACTIVE' || !isValidMoney(plan.price)) {
      alert('Debes elegir un plan activo con precio válido.');
      return;
    }
    if (membership.status !== 'ACTIVE' && membership.status !== 'EXPIRED') {
      alert('Solo se pueden renovar membresías activas o vencidas.');
      return;
    }
    if (membership.status === 'EXPIRED' &&
      (!isDate(renewalForm.renewal_date) ||
        renewalForm.renewal_date < todayInBolivia())) {
      alert('Selecciona una fecha de renovación válida desde hoy en adelante.');
      return;
    }

    const body = {
      id_plan: Number(renewalForm.id_plan),
    };

    if (membership.status === 'EXPIRED') {
      body.renewal_date = renewalForm.renewal_date;
    }

    await withLock(async () => {
    try {
      await apiRequest(
        `/memberships/${membership.id_membership}/renew`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        },
      );

      handleCancelRenewal();
      await loadMemberships();

      alert(
        'Renovación creada correctamente. La nueva membresía quedó pendiente de pago en Finanzas.',
      );
    } catch (error) {
      alert(error.message);
    }
    });
  };

  // =====================================================
  // ASISTENCIAS
  // =====================================================

  const handleNewAttendance = () => {
    setAttendanceForm({
      id_customer: '',
    });

    setShowAttendanceForm(true);
  };

  const handleCancelAttendance = () => {
    setShowAttendanceForm(false);
    setAttendanceForm(emptyAttendanceForm);
  };

  const handleAttendanceChange = (event) => {
    setAttendanceForm({
      ...attendanceForm,
      [event.target.name]: event.target.value,
    });
  };

  const handleAttendanceSubmit = async (event) => {
    event.preventDefault();

    if (!attendanceForm.id_customer) {
      alert('Selecciona un cliente');
      return;
    }

    if (!selectedAttendanceCustomer) {
      alert('Selecciona un cliente activo');
      return;
    }

    if (!validAttendanceMembership) {
      alert(
        'El cliente no tiene una membresía activa y vigente para registrar asistencia.',
      );
      return;
    }

    await withLock(async () => {
    try {
      await apiRequest('/customer-attendances', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id_customer: Number(
            attendanceForm.id_customer,
          ),
        }),
      });

      handleCancelAttendance();
      await loadAttendances();
      await loadMemberships();

      alert('Asistencia registrada correctamente');
    } catch (error) {
      alert(error.message);
    }
    });
  };

  const handleAttendanceRenewal = async () => {
    if (!latestExpiredAttendanceMembership) {
      alert(
        'No se encontró una membresía vencida para renovar.',
      );
      return;
    }

    try {
      /*
        Volvemos a consultar las membresías antes de abrir
        la renovación. El backend actualiza automáticamente
        las ACTIVE cuya fecha ya terminó a EXPIRED.
        Así evitamos trabajar con un estado desactualizado
        si la aplicación quedó abierta durante mucho tiempo.
      */
      const freshMemberships = await apiRequest(
        '/memberships',
      );

      setMemberships(freshMemberships);

      const membershipToRenew = freshMemberships.find(
        (membership) =>
          membership.id_membership ===
          latestExpiredAttendanceMembership.id_membership,
      );

      if (!membershipToRenew) {
        alert('No se encontró la membresía a renovar.');
        return;
      }

      if (membershipToRenew.status !== 'EXPIRED') {
        alert(
          'La membresía ya no figura como vencida. Actualiza la información e inténtalo nuevamente.',
        );
        return;
      }

      setShowAttendanceForm(false);
      setAttendanceForm(emptyAttendanceForm);
      setSection('memberships');

      handleRenewMembership(membershipToRenew);
    } catch (error) {
      alert(error.message);
    }
  };

  // =====================================================
  // FUNCIONES AUXILIARES
  // =====================================================

  const getCustomerName = (idCustomer) => {
    const customer = customers.find(
      (item) => item.id_customer === idCustomer,
    );

    if (!customer) {
      return `Cliente #${idCustomer}`;
    }

    return `${customer.first_name} ${customer.last_name}`;
  };

  const getPlanName = (idPlan) => {
    const plan = plans.find(
      (item) => item.id_plan === idPlan,
    );

    if (!plan) {
      return `Plan #${idPlan}`;
    }

    return plan.plan_name;
  };

  const getMembershipById = (idMembership) => {
    return memberships.find(
      (membership) =>
        membership.id_membership === idMembership,
    );
  };

  const getAttendancePlanName = (attendance) => {
    const membership = getMembershipById(
      attendance.id_membership,
    );

    if (!membership) {
      return '-';
    }

    return getPlanName(membership.id_plan);
  };

  const getMembershipStatusLabel = (status) => {
    switch (status) {
      case 'PENDING':
        return 'Pendiente';

      case 'ACTIVE':
        return 'Activa';

      case 'EXPIRED':
        return 'Vencida';

      case 'CANCELLED':
        return 'Cancelada';

      default:
        return status;
    }
  };

  const getMembershipStatusClass = (status) => {
    switch (status) {
      case 'ACTIVE':
        return 'status active';

      case 'PENDING':
        return 'status pending';

      case 'EXPIRED':
        return 'status expired';

      case 'CANCELLED':
        return 'status cancelled';

      default:
        return 'status';
    }
  };

  const addDaysToDateString = (dateString, days) => {
    if (!isDate(dateString) || !Number.isSafeInteger(Number(days))) {
      return '';
    }

    const date = new Date(
      `${dateString}T00:00:00.000Z`,
    );

    if (Number.isNaN(date.getTime())) {
      return '';
    }

    date.setUTCDate(date.getUTCDate() + days);

    return date.toISOString().split('T')[0];
  };

  const normalizeSearchValue = (value) => {
    return String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  };

  const normalizedCustomerSearch =
    normalizeSearchValue(customerSearch);

  const filteredCustomers = customers.filter((customer) => {
    if (!normalizedCustomerSearch) {
      return true;
    }

    const fullName = `${customer.first_name ?? ''} ${
      customer.last_name ?? ''
    }`;

    const searchableValues = [
      customer.id_customer,
      customer.first_name,
      customer.last_name,
      fullName,
      customer.phone,
      customer.email,
    ];

    return searchableValues.some((value) =>
      normalizeSearchValue(value).includes(
        normalizedCustomerSearch,
      ),
    );
  });

  const selectedCustomer = customers.find(
    (customer) =>
      customer.id_customer === selectedCustomerId,
  );

  const selectedCustomerMemberships = selectedCustomer
    ? memberships
        .filter(
          (membership) =>
            membership.id_customer ===
            selectedCustomer.id_customer,
        )
        .sort(
          (a, b) =>
            b.id_membership - a.id_membership,
        )
    : [];

  const selectedCustomerAttendances = selectedCustomer
    ? attendances
        .filter(
          (attendance) =>
            attendance.id_customer ===
            selectedCustomer.id_customer,
        )
        .sort((a, b) => {
          const valueA = `${a.attendance_date} ${a.entry_time}`;
          const valueB = `${b.attendance_date} ${b.entry_time}`;

          return valueB.localeCompare(valueA);
        })
    : [];

  const today = getToday();

  const selectedMembershipCustomer = customers.find(
    (customer) =>
      customer.id_customer ===
      Number(membershipForm.id_customer),
  );

  const selectedMembershipPlan = plans.find(
    (plan) =>
      plan.id_plan === Number(membershipForm.id_plan),
  );

  const membershipEndDate =
    membershipForm.start_date && selectedMembershipPlan
      ? addDaysToDateString(
          membershipForm.start_date,
          Number(selectedMembershipPlan.duration_days) - 1,
        )
      : '';

  const renewingMembership = memberships.find(
    (membership) =>
      membership.id_membership ===
      renewingMembershipId,
  );

  const selectedRenewalPlan = plans.find(
    (plan) =>
      plan.id_plan === Number(renewalForm.id_plan),
  );

  const renewalStartDate = renewingMembership
    ? renewingMembership.status === 'ACTIVE'
      ? addDaysToDateString(
          renewingMembership.end_date,
          1,
        )
      : renewalForm.renewal_date
    : '';

  const renewalEndDate =
    renewalStartDate && selectedRenewalPlan
      ? addDaysToDateString(
          renewalStartDate,
          Number(selectedRenewalPlan.duration_days) - 1,
        )
      : '';

  const activeCustomers = customers.filter(
    (customer) => customer.status === 'ACTIVE',
  );

  const eligibleAttendanceCustomers = activeCustomers.filter(
    (customer) =>
      memberships.some(
        (membership) =>
          membership.id_customer ===
            customer.id_customer &&
          membership.status === 'ACTIVE' &&
          membership.start_date <= today &&
          membership.end_date >= today,
      ),
  );

  const selectedAttendanceCustomer = activeCustomers.find(
    (customer) =>
      customer.id_customer ===
      Number(attendanceForm.id_customer),
  );

  const selectedAttendanceMemberships =
    selectedAttendanceCustomer
      ? memberships
          .filter(
            (membership) =>
              membership.id_customer ===
              selectedAttendanceCustomer.id_customer,
          )
          .sort((a, b) => {
            const endDateComparison = String(
              b.end_date || '',
            ).localeCompare(String(a.end_date || ''));

            if (endDateComparison !== 0) {
              return endDateComparison;
            }

            return (
              b.id_membership - a.id_membership
            );
          })
      : [];

  const validAttendanceMembership =
    selectedAttendanceMemberships.find(
      (membership) =>
        membership.status === 'ACTIVE' &&
        membership.start_date <= today &&
        membership.end_date >= today,
    );

  const pendingAttendanceMembership =
    selectedAttendanceMemberships.find(
      (membership) =>
        membership.status === 'PENDING',
    );

  const futureAttendanceMembership =
    selectedAttendanceMemberships.find(
      (membership) =>
        membership.status === 'ACTIVE' &&
        membership.start_date > today,
    );

  const latestExpiredAttendanceMembership =
    selectedAttendanceMemberships.find(
      (membership) =>
        membership.status === 'EXPIRED' ||
        (membership.status === 'ACTIVE' &&
          membership.end_date < today),
    );

  const sortedAttendances = [...attendances].sort(
    (a, b) => {
      const valueA = `${a.attendance_date} ${a.entry_time}`;
      const valueB = `${b.attendance_date} ${b.entry_time}`;

      return valueB.localeCompare(valueA);
    },
  );

  // =====================================================
  // INTERFAZ
  // =====================================================

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>Gimnasio MQS</h1>
          <p>Producción / Operaciones</p>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: '10px',
            flexWrap: 'wrap',
          }}
        >
          {section === 'customers' && (
            <button
              type="button"
              className="primary-button"
              onClick={handleNewCustomer}
            >
              + Nuevo cliente
            </button>
          )}

          {section === 'plans' && isAdmin && (
            <button
              type="button"
              className="primary-button"
              onClick={handleNewPlan}
            >
              + Nuevo plan
            </button>
          )}

          {section === 'memberships' && (
            <button
              type="button"
              className="primary-button"
              onClick={handleNewMembership}
            >
              + Nueva membresía
            </button>
          )}

          {section === 'attendances' && (
            <button
              type="button"
              className="primary-button"
              onClick={handleNewAttendance}
            >
              + Registrar asistencia
            </button>
          )}

          {isAdmin && (
            <button
              type="button"
              className="cancel-button"
              onClick={handleGoToDashboard}
            >
              Dashboard
            </button>
          )}

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              minWidth: '120px',
              lineHeight: 1.2,
            }}
          >
            <strong>
              {currentUser?.username || 'Usuario'}
            </strong>

            <span
              style={{
                marginTop: '4px',
                color: '#9ca3af',
                fontSize: '13px',
              }}
            >
              {currentRole || 'Sin rol'}
            </span>
          </div>

          <button
            type="button"
            className="cancel-button"
            onClick={handleLogout}
          >
            Cerrar sesión
          </button>
        </div>
      </header>

      {saving && (
        <div role="status" className="form-info" style={{ margin: '12px 24px' }}>
          Guardando cambios… Evita repetir la operación.
        </div>
      )}

      {loadingError && (
        <div className="form-warning" role="alert" style={{ margin: '12px 24px' }}>
          {loadingError}{' '}
          <button type="button" onClick={() => window.location.reload()}>
            Reintentar
          </button>
        </div>
      )}

      <nav className="navigation">
        <button
          className={
            section === 'customers'
              ? 'nav-button active-nav'
              : 'nav-button'
          }
          onClick={() => changeSection('customers')}
        >
          Clientes
        </button>

        <button
          className={
            section === 'plans'
              ? 'nav-button active-nav'
              : 'nav-button'
          }
          onClick={() => changeSection('plans')}
        >
          Planes
        </button>

        <button
          className={
            section === 'memberships'
              ? 'nav-button active-nav'
              : 'nav-button'
          }
          onClick={() => changeSection('memberships')}
        >
          Membresías
        </button>

        <button
          className={
            section === 'attendances'
              ? 'nav-button active-nav'
              : 'nav-button'
          }
          onClick={() => changeSection('attendances')}
        >
          Asistencias
        </button>
      </nav>

      {/* =================================================
          CLIENTES
      ================================================= */}

      {section === 'customers' && (
        <main className="content">
          <div className="section-header">
            <h2>
              {selectedCustomer
                ? 'Ficha del Cliente'
                : 'Gestión de Clientes'}
            </h2>

            <p>
              {selectedCustomer
                ? 'Consulta de datos, membresías y asistencias del cliente'
                : 'Registro y administración de clientes del gimnasio'}
            </p>
          </div>

          {!selectedCustomer && (
            <div
              className="form-container"
              style={{ marginBottom: '20px' }}
            >
              <div
                className="form-grid"
                style={{
                  gridTemplateColumns:
                    'minmax(280px, 1fr) auto',
                  alignItems: 'end',
                }}
              >
                <div>
                  <label htmlFor="customer-search">
                    Buscar cliente
                  </label>

                  <input
                    id="customer-search"
                    type="search"
                    value={customerSearch}
                    onChange={(event) =>
                      setCustomerSearch(event.target.value)
                    }
                    placeholder="Nombre, apellido, teléfono o ID"
                    autoComplete="off"
                  />
                </div>

                {customerSearch && (
                  <div>
                    <button
                      type="button"
                      className="cancel-button"
                      onClick={() => setCustomerSearch('')}
                    >
                      Limpiar búsqueda
                    </button>
                  </div>
                )}
              </div>

              <div
                className="form-info"
                style={{ marginTop: '12px' }}
              >
                Mostrando {filteredCustomers.length} de{' '}
                {customers.length} cliente(s).
              </div>
            </div>
          )}

          {showCustomerForm && (
            <div className="form-container">
              <h3>
                {editingCustomerId
                  ? 'Editar cliente'
                  : 'Registrar nuevo cliente'}
              </h3>

              <form onSubmit={handleCustomerSubmit}>
                <div className="form-grid">
                  <div>
                    <label>Nombre</label>

                    <input
                      type="text"
                      name="first_name"
                      value={customerForm.first_name}
                      onChange={handleCustomerChange}
                      required
                    />
                  </div>

                  <div>
                    <label>Apellido</label>

                    <input
                      type="text"
                      name="last_name"
                      value={customerForm.last_name}
                      onChange={handleCustomerChange}
                      required
                    />
                  </div>

                  <div>
                    <label>Teléfono</label>

                    <input
                      type="text"
                      name="phone"
                      value={customerForm.phone}
                      onChange={handleCustomerChange}
                      required
                    />
                  </div>

                  <div>
                    <label>Correo</label>

                    <input
                      type="email"
                      name="email"
                      value={customerForm.email}
                      onChange={handleCustomerChange}
                    />
                  </div>

                  <div>
                    <label>Fecha de nacimiento</label>

                    <input
                      type="date"
                      name="birth_date"
                      value={customerForm.birth_date}
                      onChange={handleCustomerChange}
                    />
                  </div>

                  <div>
                    <label>Observaciones</label>

                    <input
                      type="text"
                      name="notes"
                      value={customerForm.notes}
                      onChange={handleCustomerChange}
                    />
                  </div>
                </div>

                <div className="form-actions">
                  <button
                    type="button"
                    className="cancel-button"
                    onClick={handleCancelCustomer}
                  >
                    Cancelar
                  </button>

                  <button
                    type="submit"
                    className="primary-button"
                  >
                    {editingCustomerId
                      ? 'Guardar cambios'
                      : 'Guardar cliente'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {selectedCustomer && (
            <div
              className="form-container"
              style={{ marginBottom: '20px' }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '16px',
                  marginBottom: '18px',
                  flexWrap: 'wrap',
                }}
              >
                <div>
                  <h3 style={{ marginBottom: '6px' }}>
                    Ficha integral del cliente
                  </h3>

                  <p style={{ margin: 0 }}>
                    {selectedCustomer.first_name}{' '}
                    {selectedCustomer.last_name}
                  </p>
                </div>

                <button
                  type="button"
                  className="cancel-button"
                  onClick={handleCloseCustomerDetail}
                >
                  ← Volver a clientes
                </button>
              </div>

              <div className="form-grid">
                <div>
                  <label>ID del cliente</label>
                  <input
                    type="text"
                    value={selectedCustomer.id_customer}
                    disabled
                  />
                </div>

                <div>
                  <label>Nombre completo</label>
                  <input
                    type="text"
                    value={`${selectedCustomer.first_name} ${selectedCustomer.last_name}`}
                    disabled
                  />
                </div>

                <div>
                  <label>Teléfono</label>
                  <input
                    type="text"
                    value={selectedCustomer.phone || '-'}
                    disabled
                  />
                </div>

                <div>
                  <label>Correo</label>
                  <input
                    type="text"
                    value={selectedCustomer.email || '-'}
                    disabled
                  />
                </div>

                <div>
                  <label>Fecha de nacimiento</label>
                  <input
                    type="text"
                    value={
                      selectedCustomer.birth_date || '-'
                    }
                    disabled
                  />
                </div>

                <div>
                  <label>Estado</label>
                  <input
                    type="text"
                    value={
                      selectedCustomer.status === 'ACTIVE'
                        ? 'Activo'
                        : 'Inactivo'
                    }
                    disabled
                  />
                </div>

                <div>
                  <label>Fecha de registro</label>
                  <input
                    type="text"
                    value={
                      selectedCustomer.registration_date ||
                      selectedCustomer.creationDate ||
                      '-'
                    }
                    disabled
                  />
                </div>

                <div>
                  <label>Observaciones</label>
                  <input
                    type="text"
                    value={selectedCustomer.notes || '-'}
                    disabled
                  />
                </div>
              </div>

              <div
                className="attendance-summary"
                style={{ marginTop: '20px' }}
              >
                <div className="summary-card">
                  <span className="summary-label">
                    Membresías registradas
                  </span>

                  <strong>
                    {selectedCustomerMemberships.length}
                  </strong>
                </div>

                <div className="summary-card">
                  <span className="summary-label">
                    Asistencias registradas
                  </span>

                  <strong>
                    {selectedCustomerAttendances.length}
                  </strong>
                </div>
              </div>

              <h3 style={{ marginTop: '22px' }}>
                Historial de membresías
              </h3>

              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Plan</th>
                      <th>Inicio</th>
                      <th>Vencimiento</th>
                      <th>Precio</th>
                      <th>Estado</th>
                    </tr>
                  </thead>

                  <tbody>
                    {selectedCustomerMemberships.map(
                      (membership) => (
                        <tr
                          key={membership.id_membership}
                        >
                          <td>
                            {membership.id_membership}
                          </td>

                          <td>
                            {getPlanName(
                              membership.id_plan,
                            )}
                          </td>

                          <td>
                            {membership.start_date}
                          </td>

                          <td>
                            {membership.end_date}
                          </td>

                          <td>
                            Bs {membership.applied_price}
                          </td>

                          <td>
                            <span
                              className={getMembershipStatusClass(
                                membership.status,
                              )}
                            >
                              {getMembershipStatusLabel(
                                membership.status,
                              )}
                            </span>
                          </td>
                        </tr>
                      ),
                    )}

                    {selectedCustomerMemberships.length ===
                      0 && (
                      <tr>
                        <td
                          colSpan="6"
                          className="empty"
                        >
                          Este cliente no tiene membresías
                          registradas.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <h3 style={{ marginTop: '22px' }}>
                Historial de asistencias
              </h3>

              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Membresía</th>
                      <th>Plan</th>
                      <th>Fecha</th>
                      <th>Hora de entrada</th>
                    </tr>
                  </thead>

                  <tbody>
                    {selectedCustomerAttendances.map(
                      (attendance) => (
                        <tr
                          key={attendance.id_attendance}
                        >
                          <td>
                            {attendance.id_attendance}
                          </td>

                          <td>
                            #{attendance.id_membership}
                          </td>

                          <td>
                            {getAttendancePlanName(
                              attendance,
                            )}
                          </td>

                          <td>
                            {attendance.attendance_date}
                          </td>

                          <td>
                            {attendance.entry_time}
                          </td>
                        </tr>
                      ),
                    )}

                    {selectedCustomerAttendances.length ===
                      0 && (
                      <tr>
                        <td
                          colSpan="5"
                          className="empty"
                        >
                          Este cliente no tiene asistencias
                          registradas.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {!selectedCustomer && (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Cliente</th>
                    <th>Teléfono</th>
                    <th>Correo</th>
                    <th>Estado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredCustomers.map((customer) => (
                    <tr key={customer.id_customer}>
                      <td>{customer.id_customer}</td>

                      <td>
                        {customer.first_name}{' '}
                        {customer.last_name}
                      </td>

                      <td>{customer.phone}</td>

                      <td>{customer.email || '-'}</td>

                      <td>
                        <span
                          className={
                            customer.status === 'ACTIVE'
                              ? 'status active'
                              : 'status inactive'
                          }
                        >
                          {customer.status === 'ACTIVE'
                            ? 'Activo'
                            : 'Inactivo'}
                        </span>
                      </td>

                      <td>
                        <div className="action-buttons">
                          <button
                            className="renew-button"
                            onClick={() =>
                              handleViewCustomer(customer)
                            }
                          >
                            Ver ficha
                          </button>

                          <button
                            className="edit-button"
                            onClick={() =>
                              handleEditCustomer(customer)
                            }
                          >
                            Editar
                          </button>

                          <button
                            className={
                              customer.status === 'ACTIVE'
                                ? 'status-button deactivate-button'
                                : 'status-button activate-button'
                            }
                            onClick={() =>
                              handleCustomerStatusChange(
                                customer,
                              )
                            }
                          >
                            {customer.status === 'ACTIVE'
                              ? 'Desactivar'
                              : 'Activar'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}

                  {filteredCustomers.length === 0 && (
                    <tr>
                      <td colSpan="6" className="empty">
                        {customers.length === 0
                          ? 'No hay clientes registrados.'
                          : 'No se encontraron clientes con esa búsqueda.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </main>
      )}

      {/* =================================================
          PLANES
      ================================================= */}

      {section === 'plans' && (
        <main className="content">
          <div className="section-header">
            <h2>Planes de Membresía</h2>

            <p>
              Administración de los planes disponibles del
              gimnasio
            </p>
          </div>

          {!isAdmin && (
            <p className="form-info" role="note">
              La edición y administración de planes corresponde a Administración.
            </p>
          )}

          {showPlanForm && isAdmin && (
            <div className="form-container">
              <h3>
                {editingPlanId
                  ? 'Editar plan'
                  : 'Registrar nuevo plan'}
              </h3>

              <form onSubmit={handlePlanSubmit}>
                <div className="form-grid">
                  <div>
                    <label>Nombre del plan</label>

                    <input
                      type="text"
                      name="plan_name"
                      value={planForm.plan_name}
                      onChange={handlePlanChange}
                      required
                    />
                  </div>

                  <div>
                    <label>Duración en días</label>

                    <input
                      type="number"
                      min="1"
                      name="duration_days"
                      value={planForm.duration_days}
                      onChange={handlePlanChange}
                      required
                    />
                  </div>

                  <div>
                    <label>Precio (Bs)</label>

                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      name="price"
                      value={planForm.price}
                      onChange={handlePlanChange}
                      required
                    />
                  </div>

                  <div>
                    <label>Descripción</label>

                    <input
                      type="text"
                      name="description"
                      value={planForm.description}
                      onChange={handlePlanChange}
                    />
                  </div>
                </div>

                <div className="form-actions">
                  <button
                    type="button"
                    className="cancel-button"
                    onClick={handleCancelPlan}
                  >
                    Cancelar
                  </button>

                  <button
                    type="submit"
                    className="primary-button"
                  >
                    {editingPlanId
                      ? 'Guardar cambios'
                      : 'Guardar plan'}
                  </button>
                </div>
              </form>
            </div>
          )}

          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Plan</th>
                  <th>Duración</th>
                  <th>Precio</th>
                  <th>Descripción</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>

              <tbody>
                {plans.map((plan) => (
                  <tr key={plan.id_plan}>
                    <td>{plan.id_plan}</td>

                    <td>{plan.plan_name}</td>

                    <td>{plan.duration_days} días</td>

                    <td>Bs {plan.price}</td>

                    <td>{plan.description || '-'}</td>

                    <td>
                      <span
                        className={
                          plan.status === 'ACTIVE'
                            ? 'status active'
                            : 'status inactive'
                        }
                      >
                        {plan.status === 'ACTIVE'
                          ? 'Activo'
                          : 'Inactivo'}
                      </span>
                    </td>

                    <td>
                      {isAdmin ? (
                        <div className="action-buttons">
                          <button type="button" className="edit-button" disabled={saving}
                            onClick={() => handleEditPlan(plan)}>
                            Editar
                          </button>
                          <button type="button" disabled={saving}
                            className={plan.status === 'ACTIVE'
                              ? 'status-button deactivate-button'
                              : 'status-button activate-button'}
                            onClick={() => handlePlanStatusChange(plan)}>
                            {plan.status === 'ACTIVE' ? 'Desactivar' : 'Activar'}
                          </button>
                        </div>
                      ) : 'Solo lectura'}
                    </td>
                  </tr>
                ))}

                {plans.length === 0 && (
                  <tr>
                    <td colSpan="7" className="empty">
                      No hay planes registrados.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </main>
      )}

      {/* =================================================
          MEMBRESÍAS
      ================================================= */}

      {section === 'memberships' && (
        <main className="content">
          <div className="section-header">
            <h2>Membresías y Renovaciones</h2>

            <p>
              Registro, cobro en Finanzas y renovación de
              membresías
            </p>
            <div className="form-info" role="note" style={{ marginTop: '12px' }}>
              Las membresías nuevas y renovadas quedan pendientes. Para activarlas,
              registra el pago desde <strong>Finanzas / Pagos</strong>. Un cobro
              confirmado genera automáticamente el movimiento de Caja.
            </div>
          </div>

          {showMembershipForm && (
            <div className="form-container">
              <h3>Registrar nueva membresía</h3>

              <form onSubmit={handleMembershipSubmit}>
                <div className="form-grid">
                  <div>
                    <label>Cliente</label>

                    <select
                      name="id_customer"
                      value={membershipForm.id_customer}
                      onChange={handleMembershipChange}
                      required
                    >
                      <option value="">
                        Seleccione un cliente
                      </option>

                      {customers
                        .filter(
                          (customer) =>
                            customer.status === 'ACTIVE',
                        )
                        .map((customer) => (
                          <option
                            key={customer.id_customer}
                            value={
                              customer.id_customer
                            }
                          >
                            {customer.first_name}{' '}
                            {customer.last_name}
                          </option>
                        ))}
                    </select>
                  </div>

                  <div>
                    <label>Plan de membresía</label>

                    <select
                      name="id_plan"
                      value={membershipForm.id_plan}
                      onChange={handleMembershipChange}
                      required
                    >
                      <option value="">
                        Seleccione un plan
                      </option>

                      {plans
                        .filter(
                          (plan) =>
                            plan.status === 'ACTIVE',
                        )
                        .map((plan) => (
                          <option
                            key={plan.id_plan}
                            value={plan.id_plan}
                          >
                            {plan.plan_name} -{' '}
                            {plan.duration_days} días - Bs{' '}
                            {plan.price}
                          </option>
                        ))}
                    </select>
                  </div>

                  <div>
                    <label>Fecha de inicio</label>

                    <input
                      type="date"
                      name="start_date"
                      value={membershipForm.start_date}
                      onChange={handleMembershipChange}
                      required
                    />
                  </div>
                </div>

                {selectedMembershipCustomer &&
                selectedMembershipPlan &&
                membershipForm.start_date ? (
                  <>
                    <h3 style={{ marginTop: '22px' }}>
                      Resumen de la membresía
                    </h3>

                    <div
                      className="attendance-summary"
                      style={{ marginTop: '12px' }}
                    >
                      <div className="summary-card">
                        <span className="summary-label">
                          Cliente
                        </span>

                        <strong>
                          {selectedMembershipCustomer.first_name}{' '}
                          {selectedMembershipCustomer.last_name}
                        </strong>
                      </div>

                      <div className="summary-card">
                        <span className="summary-label">
                          Plan
                        </span>

                        <strong>
                          {selectedMembershipPlan.plan_name}
                        </strong>
                      </div>

                      <div className="summary-card">
                        <span className="summary-label">
                          Duración
                        </span>

                        <strong>
                          {selectedMembershipPlan.duration_days}{' '}
                          días
                        </strong>
                      </div>

                      <div className="summary-card">
                        <span className="summary-label">
                          Precio aplicado
                        </span>

                        <strong>
                          Bs {selectedMembershipPlan.price}
                        </strong>
                      </div>

                      <div className="summary-card">
                        <span className="summary-label">
                          Fecha de inicio
                        </span>

                        <strong>
                          {membershipForm.start_date}
                        </strong>
                      </div>

                      <div className="summary-card">
                        <span className="summary-label">
                          Fecha de vencimiento
                        </span>

                        <strong>
                          {membershipEndDate || '-'}
                        </strong>
                      </div>
                    </div>

                    <div
                      className="form-info"
                      style={{ marginTop: '16px' }}
                    >
                      <strong>Verifica los datos:</strong>{' '}
                      la membresía se registrará con el precio
                      actual del plan y el vencimiento calculado
                      automáticamente. Al confirmar, quedará
                      pendiente de activación.
                    </div>
                  </>
                ) : (
                  <div className="form-warning">
                    Selecciona un cliente activo, un plan activo
                    y una fecha de inicio para ver el resumen
                    antes de confirmar la membresía.
                  </div>
                )}

                <div className="form-actions">
                  <button
                    type="button"
                    className="cancel-button"
                    onClick={handleCancelMembership}
                  >
                    Cancelar
                  </button>

                  <button
                    type="submit"
                    className="primary-button"
                    disabled={
                      saving ||
                      !selectedMembershipCustomer ||
                      !selectedMembershipPlan ||
                      !isDate(membershipForm.start_date) ||
                      !isValidMoney(selectedMembershipPlan.price)
                    }
                  >
                    Confirmar y guardar membresía
                  </button>
                </div>
              </form>
            </div>
          )}

          {renewingMembership && (
            <div className="form-container">
              <h3>
                Renovar membresía #
                {renewingMembership.id_membership}
              </h3>

              <form onSubmit={handleRenewalSubmit}>
                <div className="form-grid">
                  <div>
                    <label>Cliente</label>

                    <input
                      type="text"
                      value={getCustomerName(
                        renewingMembership.id_customer,
                      )}
                      disabled
                    />
                  </div>

                  <div>
                    <label>Plan actual</label>

                    <input
                      type="text"
                      value={getPlanName(
                        renewingMembership.id_plan,
                      )}
                      disabled
                    />
                  </div>

                  <div>
                    <label>Vencimiento actual</label>

                    <input
                      type="date"
                      value={renewingMembership.end_date}
                      disabled
                    />
                  </div>

                  <div>
                    <label>Nuevo plan</label>

                    <select
                      name="id_plan"
                      value={renewalForm.id_plan}
                      onChange={handleRenewalChange}
                      required
                    >
                      <option value="">
                        Seleccione un plan
                      </option>

                      {plans
                        .filter(
                          (plan) =>
                            plan.status === 'ACTIVE',
                        )
                        .map((plan) => (
                          <option
                            key={plan.id_plan}
                            value={plan.id_plan}
                          >
                            {plan.plan_name} -{' '}
                            {plan.duration_days} días - Bs{' '}
                            {plan.price}
                          </option>
                        ))}
                    </select>
                  </div>

                  {renewingMembership.status ===
                  'EXPIRED' ? (
                    <div>
                      <label>Fecha de renovación</label>

                      <input
                        type="date"
                        name="renewal_date"
                        value={renewalForm.renewal_date}
                        onChange={handleRenewalChange}
                        required
                      />
                    </div>
                  ) : (
                    <div>
                      <label>Inicio nueva vigencia</label>

                      <input
                        type="date"
                        value={renewalStartDate}
                        disabled
                      />
                    </div>
                  )}

                  <div>
                    <label>Nuevo vencimiento</label>

                    <input
                      type="date"
                      value={renewalEndDate}
                      disabled
                    />
                  </div>
                </div>

                {selectedRenewalPlan ? (
                  <div className="form-info">
                    <strong>Resumen:</strong>{' '}
                    {selectedRenewalPlan.plan_name} -{' '}
                    {selectedRenewalPlan.duration_days} días -
                    Bs {selectedRenewalPlan.price}. Nueva
                    vigencia estimada: {renewalStartDate || '-'}{' '}
                    → {renewalEndDate || '-'}.
                  </div>
                ) : (
                  <div className="form-warning">
                    Selecciona un plan activo para continuar
                    con la renovación.
                  </div>
                )}

                {renewingMembership.status === 'ACTIVE' && (
                  <div className="form-info">
                    Como la membresía todavía está activa, la
                    nueva vigencia comenzará automáticamente
                    el día siguiente a su vencimiento actual.
                  </div>
                )}

                <div className="form-actions">
                  <button
                    type="button"
                    className="cancel-button"
                    onClick={handleCancelRenewal}
                  >
                    Cancelar
                  </button>

                  <button
                    type="submit"
                    className="primary-button"
                    disabled={saving || !selectedRenewalPlan || !isValidMoney(selectedRenewalPlan.price)}
                  >
                    Confirmar renovación
                  </button>
                </div>
              </form>
            </div>
          )}

          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Cliente</th>
                  <th>Plan</th>
                  <th>Inicio</th>
                  <th>Vencimiento</th>
                  <th>Precio</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>

              <tbody>
                {memberships.map((membership) => (
                  <tr key={membership.id_membership}>
                    <td>
                      {membership.id_membership}
                    </td>

                    <td>
                      {getCustomerName(
                        membership.id_customer,
                      )}
                    </td>

                    <td>
                      {getPlanName(membership.id_plan)}
                    </td>

                    <td>{membership.start_date}</td>

                    <td>{membership.end_date}</td>

                    <td>
                      Bs {membership.applied_price}
                    </td>

                    <td>
                      <span
                        className={getMembershipStatusClass(
                          membership.status,
                        )}
                      >
                        {getMembershipStatusLabel(
                          membership.status,
                        )}
                      </span>
                    </td>

                    <td>
                      <div className="action-buttons">
                        {membership.status ===
                          'PENDING' && (
                          <button
                            type="button"
                            className="status-button activate-button"
                            disabled={saving}
                            onClick={() =>
                              handleActivateMembership(
                                membership,
                              )
                            }
                          >
                            Cobrar / activar
                          </button>
                        )}

                        {(membership.status ===
                          'ACTIVE' ||
                          membership.status ===
                            'EXPIRED') && (
                          <button
                            className="renew-button"
                            onClick={() =>
                              handleRenewMembership(
                                membership,
                              )
                            }
                          >
                            Renovar
                          </button>
                        )}
{(membership.status === 'PENDING' ||
  membership.status === 'ACTIVE') && (
  <button
    type="button"
    className="status-button deactivate-button"
    disabled={saving}
    onClick={() => handleCancelMembershipStatus(membership)}
  >
    {membership.status === 'ACTIVE' ? 'Gestionar anulación' : 'Cancelar pendiente'}
  </button>
)}
                        {membership.status ===
                          'CANCELLED' && (
                          <span className="no-action">
                            Sin acciones
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}

                {memberships.length === 0 && (
                  <tr>
                    <td colSpan="8" className="empty">
                      No hay membresías registradas.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </main>
      )}

      {/* =================================================
          ASISTENCIAS
      ================================================= */}

      {section === 'attendances' && (
        <main className="content">
          <div className="section-header">
            <h2>Asistencia de Clientes</h2>

            <p>
              Registro y consulta de ingresos al gimnasio
            </p>
          </div>

          <div className="attendance-summary">
            <div className="summary-card">
              <span className="summary-label">
                Asistencias registradas
              </span>

              <strong>{attendances.length}</strong>
            </div>

            <div className="summary-card">
              <span className="summary-label">
                Clientes habilitados hoy
              </span>

              <strong>
                {eligibleAttendanceCustomers.length}
              </strong>
            </div>
          </div>

          {showAttendanceForm && (
            <div className="form-container">
              <h3>Registrar asistencia</h3>

              <form onSubmit={handleAttendanceSubmit}>
                <div className="form-grid">
                  <div>
                    <label>Cliente</label>

                    <select
                      name="id_customer"
                      value={attendanceForm.id_customer}
                      onChange={handleAttendanceChange}
                      required
                    >
                      <option value="">
                        Seleccione un cliente
                      </option>

                      {activeCustomers.map((customer) => (
                        <option
                          key={customer.id_customer}
                          value={customer.id_customer}
                        >
                          {customer.first_name}{' '}
                          {customer.last_name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label>Fecha</label>

                    <input
                      type="date"
                      value={today}
                      disabled
                    />
                  </div>
                </div>

                {activeCustomers.length === 0 && (
                  <div className="form-warning">
                    No hay clientes activos registrados.
                    Debes activar o registrar un cliente
                    antes de controlar su asistencia.
                  </div>
                )}

                {activeCustomers.length > 0 &&
                  !selectedAttendanceCustomer && (
                    <div className="form-info">
                      Selecciona un cliente para verificar
                      automáticamente si puede ingresar hoy.
                    </div>
                  )}

                {selectedAttendanceCustomer &&
                  validAttendanceMembership && (
                    <div className="form-info">
                      <strong>Ingreso habilitado.</strong>{' '}
                      Membresía #
                      {validAttendanceMembership.id_membership}{' '}
                      -{' '}
                      {getPlanName(
                        validAttendanceMembership.id_plan,
                      )}. Vigente hasta{' '}
                      {validAttendanceMembership.end_date}.
                      La hora de entrada y la membresía
                      utilizada se registrarán
                      automáticamente.
                    </div>
                  )}

                {selectedAttendanceCustomer &&
                  !validAttendanceMembership &&
                  pendingAttendanceMembership && (
                    <div className="form-warning">
                      <strong>Ingreso no habilitado.</strong>{' '}
                      El cliente tiene la membresía #
                      {pendingAttendanceMembership.id_membership}{' '}
                      pendiente de activación. No se puede
                      registrar asistencia hasta que la
                      membresía esté activa.
                    </div>
                  )}

                {selectedAttendanceCustomer &&
                  !validAttendanceMembership &&
                  !pendingAttendanceMembership &&
                  futureAttendanceMembership && (
                    <div className="form-warning">
                      <strong>Ingreso no habilitado.</strong>{' '}
                      La membresía #
                      {futureAttendanceMembership.id_membership}{' '}
                      comienza el{' '}
                      {futureAttendanceMembership.start_date}.
                      Todavía no está vigente para registrar
                      asistencia.
                    </div>
                  )}

                {selectedAttendanceCustomer &&
                  !validAttendanceMembership &&
                  !pendingAttendanceMembership &&
                  !futureAttendanceMembership &&
                  latestExpiredAttendanceMembership && (
                    <div className="form-warning">
                      <strong>Membresía vencida.</strong>{' '}
                      La última membresía del cliente venció
                      el{' '}
                      {latestExpiredAttendanceMembership.end_date}.
                      No se registrará una asistencia válida
                      hasta que renueve su membresía.

                      <div
                        className="form-actions"
                        style={{ marginTop: '12px' }}
                      >
                        <button
                          type="button"
                          className="renew-button"
                          onClick={handleAttendanceRenewal}
                        >
                          Renovar membresía
                        </button>
                      </div>
                    </div>
                  )}

                {selectedAttendanceCustomer &&
                  !validAttendanceMembership &&
                  !pendingAttendanceMembership &&
                  !futureAttendanceMembership &&
                  !latestExpiredAttendanceMembership && (
                    <div className="form-warning">
                      <strong>Ingreso no habilitado.</strong>{' '}
                      El cliente no tiene una membresía
                      activa y vigente. Debe registrar una
                      membresía antes de poder ingresar.
                    </div>
                  )}

                <div className="form-actions">
                  <button
                    type="button"
                    className="cancel-button"
                    onClick={handleCancelAttendance}
                  >
                    Cancelar
                  </button>

                  <button
                    type="submit"
                    className="primary-button"
                    disabled={!validAttendanceMembership}
                  >
                    Registrar entrada
                  </button>
                </div>
              </form>
            </div>
          )}

          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Cliente</th>
                  <th>Membresía</th>
                  <th>Plan</th>
                  <th>Fecha</th>
                  <th>Hora de entrada</th>
                </tr>
              </thead>

              <tbody>
                {sortedAttendances.map(
                  (attendance) => (
                    <tr
                      key={attendance.id_attendance}
                    >
                      <td>
                        {attendance.id_attendance}
                      </td>

                      <td>
                        {getCustomerName(
                          attendance.id_customer,
                        )}
                      </td>

                      <td>
                        #
                        {
                          attendance.id_membership
                        }
                      </td>

                      <td>
                        {getAttendancePlanName(
                          attendance,
                        )}
                      </td>

                      <td>
                        {attendance.attendance_date}
                      </td>

                      <td>
                        {attendance.entry_time}
                      </td>
                    </tr>
                  ),
                )}

                {sortedAttendances.length === 0 && (
                  <tr>
                    <td colSpan="6" className="empty">
                      No hay asistencias registradas.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </main>
      )}
    </div>
  );
}

export default Operations;
