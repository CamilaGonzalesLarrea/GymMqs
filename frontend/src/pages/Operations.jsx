import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_URL } from '../config/api';
import './Operations.css';

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, options);

  if (!response.ok) {
    let message = 'Ocurrió un error';

    try {
      const data = await response.json();

      if (Array.isArray(data.message)) {
        message = data.message.join(', ');
      } else if (data.message) {
        message = data.message;
      }
    } catch {
      message = 'No se pudo completar la operación';
    }

    throw new Error(message);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
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
    localStorage.removeItem('user');

    navigate('/', {
      replace: true,
    });
  };

  const handleGoToDashboard = () => {
    navigate('/dashboard');
  };

  const [section, setSection] = useState('customers');

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

  const getToday = () => {
    const today = new Date();

    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(
      2,
      '0',
    );
    const day = String(today.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
  };

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

  const loadCustomers = async () => {
    try {
      const data = await apiRequest('/customers');
      setCustomers(data);
    } catch (error) {
      console.error('Error cargando clientes:', error);
    }
  };

  const loadPlans = async () => {
    try {
      const data = await apiRequest('/membership-plans');
      setPlans(data);
    } catch (error) {
      console.error('Error cargando planes:', error);
    }
  };

  const loadMemberships = async () => {
    try {
      const data = await apiRequest('/memberships');
      setMemberships(data);
    } catch (error) {
      console.error('Error cargando membresías:', error);
    }
  };

  const loadAttendances = async () => {
    try {
      const data = await apiRequest(
        '/customer-attendances',
      );

      setAttendances(data);
    } catch (error) {
      console.error('Error cargando asistencias:', error);
    }
  };

  useEffect(() => {
    loadCustomers();
    loadPlans();
    loadMemberships();
    loadAttendances();
  }, []);

  // =====================================================
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
      birth_date: customer.birth_date || '',
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
      email: customerForm.email || null,
      birth_date: customerForm.birth_date || null,
      notes: customerForm.notes || null,
    };

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
  };

  const handleCustomerStatusChange = async (customer) => {
    const newStatus =
      customer.status === 'ACTIVE'
        ? 'INACTIVE'
        : 'ACTIVE';

    try {
      await apiRequest(
        `/customers/${customer.id_customer}/status`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            status: newStatus,
          }),
        },
      );

      await loadCustomers();
    } catch (error) {
      alert(error.message);
    }
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
    setEditingPlanId(null);
    setPlanForm(emptyPlanForm);
    setShowPlanForm(true);
  };

  const handleEditPlan = (plan) => {
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

    const url = editingPlanId
      ? `/membership-plans/${editingPlanId}`
      : '/membership-plans';

    const method = editingPlanId ? 'PATCH' : 'POST';

    const body = {
      plan_name: planForm.plan_name.trim(),
      duration_days: Number(planForm.duration_days),
      price: planForm.price,
      description: planForm.description,
    };

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
  };

  const handlePlanStatusChange = async (plan) => {
    const newStatus =
      plan.status === 'ACTIVE'
        ? 'INACTIVE'
        : 'ACTIVE';

    try {
      await apiRequest(
        `/membership-plans/${plan.id_plan}/status`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            status: newStatus,
          }),
        },
      );

      await loadPlans();
    } catch (error) {
      alert(error.message);
    }
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

    if (!membershipForm.start_date) {
      alert('Selecciona una fecha de inicio.');
      return;
    }

    const body = {
      id_customer: customer.id_customer,
      id_plan: plan.id_plan,
      start_date: membershipForm.start_date,
    };

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
  };

  const handleActivateMembership = async (
    membership,
  ) => {
    try {
      await apiRequest(
        `/memberships/${membership.id_membership}/activate`,
        {
          method: 'PATCH',
        },
      );

      await loadMemberships();
    } catch (error) {
      alert(error.message);
    }
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

    if (!renewalForm.id_plan) {
      alert('Selecciona un plan para la renovación');
      return;
    }

    if (
      membership.status === 'EXPIRED' &&
      !renewalForm.renewal_date
    ) {
      alert('Selecciona la fecha de renovación');
      return;
    }

    const body = {
      id_plan: Number(renewalForm.id_plan),
    };

    if (membership.status === 'EXPIRED') {
      body.renewal_date = renewalForm.renewal_date;
    }

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
        'Renovación creada correctamente. La nueva membresía quedó pendiente de activación.',
      );
    } catch (error) {
      alert(error.message);
    }
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
    if (!dateString) {
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

          {section === 'plans' && (
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

          {showPlanForm && (
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
                      min="0"
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
                      <div className="action-buttons">
                        <button
                          className="edit-button"
                          onClick={() =>
                            handleEditPlan(plan)
                          }
                        >
                          Editar
                        </button>

                        <button
                          className={
                            plan.status === 'ACTIVE'
                              ? 'status-button deactivate-button'
                              : 'status-button activate-button'
                          }
                          onClick={() =>
                            handlePlanStatusChange(plan)
                          }
                        >
                          {plan.status === 'ACTIVE'
                            ? 'Desactivar'
                            : 'Activar'}
                        </button>
                      </div>
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
              Registro, activación y renovación de
              membresías
            </p>
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
                      !selectedMembershipCustomer ||
                      !selectedMembershipPlan ||
                      !membershipForm.start_date
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
                    disabled={!selectedRenewalPlan}
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
                            className="status-button activate-button"
                            onClick={() =>
                              handleActivateMembership(
                                membership,
                              )
                            }
                          >
                            Activar
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
