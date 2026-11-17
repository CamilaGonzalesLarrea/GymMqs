'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHmac, randomUUID } = require('node:crypto');
const { once } = require('node:events');
const ErpDirectionService = require('../services/erp-direction.service');
const { createApp } = require('../app');

function dashboardDb() {
  const views = [
    { TABLE_NAME: 'vw_erp_finance_daily', VIEW_DEFINITION: 'SELECT business_date, SUM(amount) AS total_income, SUM(expenses) AS total_expenses FROM erp_cash_movements GROUP BY business_date' },
    { TABLE_NAME: 'vw_erp_membership_status', VIEW_DEFINITION: "SELECT id_membership, CASE WHEN start_date <= CURRENT_DATE AND end_date >= CURRENT_DATE THEN 'ACTIVE' END AS effective_status FROM memberships" },
    { TABLE_NAME: 'vw_erp_attendance_hourly', VIEW_DEFINITION: 'SELECT attendance_date, HOUR(entry_time) AS attendance_hour, COUNT(*) AS attendance_count FROM customer_attendances GROUP BY attendance_date, attendance_hour' },
  ];

  return {
    async query(sql) {
      if (sql.includes('INFORMATION_SCHEMA.VIEWS')) return [views];
      if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) {
        return [[
          { TABLE_NAME: 'vw_erp_finance_daily', COLUMN_NAME: 'business_date', DATA_TYPE: 'date' },
          { TABLE_NAME: 'vw_erp_finance_daily', COLUMN_NAME: 'total_income', DATA_TYPE: 'decimal' },
          { TABLE_NAME: 'vw_erp_finance_daily', COLUMN_NAME: 'total_expenses', DATA_TYPE: 'decimal' },
          { TABLE_NAME: 'vw_erp_membership_status', COLUMN_NAME: 'id_membership', DATA_TYPE: 'int' },
          { TABLE_NAME: 'vw_erp_membership_status', COLUMN_NAME: 'stored_status', DATA_TYPE: 'varchar' },
          { TABLE_NAME: 'vw_erp_membership_status', COLUMN_NAME: 'start_date', DATA_TYPE: 'date' },
          { TABLE_NAME: 'vw_erp_membership_status', COLUMN_NAME: 'end_date', DATA_TYPE: 'date' },
          { TABLE_NAME: 'vw_erp_attendance_hourly', COLUMN_NAME: 'attendance_date', DATA_TYPE: 'date' },
          { TABLE_NAME: 'vw_erp_attendance_hourly', COLUMN_NAME: 'attendance_hour', DATA_TYPE: 'int' },
          { TABLE_NAME: 'vw_erp_attendance_hourly', COLUMN_NAME: 'attendance_count', DATA_TYPE: 'bigint' },
        ]];
      }
      if (sql.includes('DATE_FORMAT(UTC_TIMESTAMP()')) {
        return [[{ business_date: '2026-11-16', month_start: '2026-11-01' }]];
      }
      if (sql.includes('SELECT COUNT(*) AS total') && sql.includes('FROM erp_cash_movements')) {
        return [[{ total: 4 }]];
      }
      if (sql.includes('SELECT COUNT(*) AS total') && sql.includes('FROM erp_cash_closures')) {
        return [[{ total: 2 }]];
      }
      if (sql.includes('FROM payments p') && sql.includes('COUNT(*) AS total')) {
        return [[{ total: 0 }]];
      }
      if (sql.includes('FROM erp_payment_cancellations')) {
        return sql.includes('COUNT(*) AS total') ? [[{ total: 0 }]] : [[]];
      }
      if (sql.includes('FROM payment_methods pm')) return [[]];
      if (sql.includes('FROM erp_cash_closures cl')) {
        return sql.includes('COUNT(*) AS total') ? [[{ total: 0 }]] : [[]];
      }
      if (sql.includes('FROM payments p')) return [[]];
      if (sql.includes('FROM customers')) {
        return [[{ total: 20, active: 18, inactive: 2, new_this_month: 3 }]];
      }
      if (sql.includes('FROM memberships') && sql.includes('COUNT(*) AS total')) {
        return [[{ total: 12, active: 5, expired: 2, expiring: 1, pending: 4, scheduled: 0, cancelled: 1 }]];
      }
      if (sql.includes('FROM erp_renewal_requests')) return [[{ total: 1 }]];
      if (sql.includes('FROM payments')) return [[{ valid: 7, cancelled: 2 }]];
      if (sql.includes('FROM erp_cash_movements')) {
        return [[{ income_today: '50.00', income_month: '100.00', expenses_month: '30.00', reversals_month: '5.00' }]];
      }
      if (sql.includes('AS this_week')) {
        return [[{ today: 3, this_week: 6, this_month: 12 }]];
      }
      if (sql.includes('COUNT(DISTINCT id_customer)')) {
        return [[{ total: 6, unique_customers: 4 }]];
      }
      if (sql.includes('GROUP BY attendance_date')) {
        return [[
          { date: '2026-11-01', total: 2 },
          { date: '2026-11-03', total: 4 },
        ]];
      }
      if (sql.includes('FROM customer_attendances')) return [[{ today: 3, this_month: 12 }]];
      if (sql.includes('FROM `vw_erp_finance_daily`')) {
        return [[{ date: '2026-11-16', income: '100.00', expenses: '30.00' }]];
      }
      if (sql.includes('FROM `vw_erp_membership_status`')) {
        return [[{ status: 'ACTIVE', total: 5 }, { status: 'PENDING', total: 4 }, { status: 'EXPIRED', total: 2 }]];
      }
      if (sql.includes('FROM `vw_erp_attendance_hourly`')) {
        return [[{ hour: 18, total: 9 }, { hour: 19, total: 3 }]];
      }
      throw new Error(`Consulta inesperada: ${sql}`);
    },
  };
}

test('Dirección calcula indicadores con datos reales y valida primero las vistas', async () => {
  const dashboard = await new ErpDirectionService(dashboardDb()).getDashboard();
  assert.deepEqual(dashboard.customers, {
    total: 20, active: 18, inactive: 2, newThisMonth: 3,
  });
  assert.deepEqual(dashboard.memberships, {
    active: 5, expired: 2, expiring: 1, pending: 4, renewedThisMonth: 1,
  });
  assert.deepEqual(dashboard.finances, {
    incomeToday: '50.00',
    incomeThisMonth: '100.00',
    expensesThisMonth: '30.00',
    netThisMonth: '65.00',
    validPayments: 7,
    cancelledPayments: 2,
  });
  assert.deepEqual(dashboard.attendance, {
    today: 3,
    thisMonth: 12,
    peakHour: { start: 18, total: 9 },
  });
  assert.equal(dashboard.charts.finance[0].income, 100);
  assert.equal(dashboard.charts.memberships[0].status, 'ACTIVE');
  assert.deepEqual(dashboard.charts.attendance[0], { hour: 18, total: 9 });
});

test('Dirección no usa una vista financiera con joins que puedan duplicar movimientos', async () => {
  const db = dashboardDb();
  const originalQuery = db.query;
  db.query = async (sql, params) => {
    if (sql.includes('INFORMATION_SCHEMA.VIEWS')) {
      const [rows] = await originalQuery(sql, params);
      rows[0].VIEW_DEFINITION += ' JOIN payments ON payments.id_payment = erp_cash_movements.id_payment';
      return [rows];
    }
    return originalQuery(sql, params);
  };
  await assert.rejects(
    () => new ErpDirectionService(db).getDashboard(),
    { status: 503 },
  );
});

test('filtro de membresías vencidas mantiene búsqueda dentro del mismo predicado', async () => {
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('COUNT(*) AS total')) return [[{ total: 0 }]];
      if (sql.includes('SELECT c.id_customer')) return [[]];
      throw new Error(`Consulta inesperada: ${sql}`);
    },
  };

  const result = await new ErpDirectionService(db).getCustomers({
    filter: 'membership_expired',
    search: 'cliente',
  });

  assert.equal(result.total, 0);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.match(
      call.sql,
      /WHERE \(m\.status = 'EXPIRED' OR[\s\S]*?end_date < DATE\(UTC_TIMESTAMP\(\) - INTERVAL 4 HOUR\)\)\)\s+AND\s+\(/,
    );
    assert.deepEqual(call.params, ['%cliente%', '%cliente%', ...(call.params.length === 4 ? [20, 0] : [])]);
  }
});

test('resumen financiero de Dirección conserva importes y fórmula del dashboard', async () => {
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('DATE_FORMAT(UTC_TIMESTAMP()')) {
        return [[{ business_date: '2026-11-16', month_start: '2026-11-01' }]];
      }
      if (sql.includes('AS income_today')) {
        return [[{
          income_today: '8.00',
          income_month: '130.75',
          expenses_month: '21.20',
          reversals_month: '9.55',
        }]];
      }
      if (sql.includes('FROM payments') && sql.includes('AS valid')) {
        return [[{ valid: 3, cancelled: 1 }]];
      }
      if (sql.includes('FROM erp_cash_movements')) return [[{ total: 7 }]];
      if (sql.includes('FROM erp_cash_closures')) return [[{ total: 2 }]];
      throw new Error(`Consulta inesperada: ${sql}`);
    },
  };
  const summary = await new ErpDirectionService(db).getFinancialSummary();
  assert.deepEqual(summary, {
    from: '2026-11-01',
    to: '2026-11-16',
    totals: {
      income: '130.75',
      expenses: '21.20',
      reversals: '9.55',
      net: '100.00',
      validPayments: 3,
      cancelledPayments: 1,
      movements: 7,
      closures: 2,
    },
  });
  assert.ok(calls.every(({ sql }) => !/\b(INSERT|UPDATE|DELETE)\b/i.test(sql)));
});

test('resumen de asistencia coincide con el Dashboard y distingue registros, personas y días calendario', async () => {
  const db = dashboardDb();
  const calls = [];
  const query = db.query.bind(db);
  db.query = async (sql, params) => {
    calls.push({ sql, params });
    return query(sql, params);
  };

  const summary = await new ErpDirectionService(db).getAttendanceSummary({
    from: '2026-11-01',
    to: '2026-11-03',
  });

  assert.equal(summary.today, 3);
  assert.deepEqual(summary.week, { from: '2026-11-16', to: '2026-11-22', total: 6 });
  assert.deepEqual(summary.month, { from: '2026-11-01', to: '2026-11-16', total: 12 });
  assert.deepEqual(summary.period, {
    from: '2026-11-01',
    to: '2026-11-03',
    total: 6,
    uniqueCustomers: 4,
    calendarDays: 3,
    averagePerCalendarDay: 2,
  });
  assert.deepEqual(summary.daily, [
    { date: '2026-11-01', total: 2 },
    { date: '2026-11-03', total: 4 },
  ]);
  assert.deepEqual(summary.peakHour, { hour: 18, total: 9 });
  assert.ok(calls.some(({ sql, params }) => (
    sql.includes('FROM `vw_erp_attendance_hourly`') &&
    JSON.stringify(params) === JSON.stringify(['2026-11-01', '2026-11-03'])
  )));
  assert.ok(calls.every(({ sql }) => /^\s*SELECT\b/i.test(sql)));
});

test('filtro y paginación de registros de asistencia son parametrizados', async () => {
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('DATE_FORMAT(UTC_TIMESTAMP()')) {
        return [[{ business_date: '2026-11-16', month_start: '2026-11-01' }]];
      }
      if (sql.includes('SELECT COUNT(*) AS total')) return [[{ total: 11 }]];
      if (sql.includes('SELECT\n        a.id_attendance')) {
        return [[{
          id_attendance: 11,
          attendance_date: '2026-11-12',
          entry_time: '18:30:00',
          id_customer: 9,
          customer_name: 'Cliente MQS',
        }]];
      }
      throw new Error(`Consulta inesperada: ${sql}`);
    },
  };

  const result = await new ErpDirectionService(db).getAttendanceRecords({
    from: '2026-11-01',
    to: '2026-11-16',
    search: 'Cliente MQS',
    id_customer: '9',
    page: '3',
    limit: '5',
  });
  assert.equal(result.total, 11);
  assert.equal(result.data[0].id_customer, 9);
  assert.equal(result.page, 3);
  assert.equal(result.totalPages, 3);
  assert.ok(calls.every(({ sql }) => !/\b(INSERT|UPDATE|DELETE)\b/i.test(sql)));
  assert.deepEqual(calls[2].params, [
    '2026-11-01', '2026-11-16', 9, '%Cliente MQS%', '%Cliente MQS%', 5, 10,
  ]);
});

test('historial individual expone solo columnas reales y maneja clientes sin registros', async () => {
  const statements = [];
  const db = {
    async query(sql) {
      statements.push(sql);
      if (sql.includes('DATE_FORMAT(UTC_TIMESTAMP()')) {
        return [[{ business_date: '2026-11-16', month_start: '2026-11-01' }]];
      }
      if (sql.includes('CONCAT(first_name, \' \', last_name) AS customer_name')) {
        return [[{ id_customer: 14, customer_name: 'Cliente Sin Asistencia', customer_status: 'ACTIVE' }]];
      }
      if (sql.includes('MAX(attendance_date)')) {
        return [[{ total: 0, last_attendance_date: null }]];
      }
      if (sql.includes('SELECT id_attendance, attendance_date, entry_time')) return [[]];
      throw new Error(`Consulta inesperada: ${sql}`);
    },
  };
  const history = await new ErpDirectionService(db).getCustomerAttendance(14);
  assert.equal(history.customer.id_customer, 14);
  assert.deepEqual(history.summary, { total: 0, lastAttendanceDate: null });
  assert.deepEqual(history.data, []);
  assert.ok(statements.every((sql) => !/exit_time/i.test(sql)));
});

test('inactividad considera solo clientes activos con membresía vigente y respeta su inicio', async () => {
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('DATE_FORMAT(UTC_TIMESTAMP()')) {
        return [[{ business_date: '2026-11-16', month_start: '2026-11-01' }]];
      }
      if (sql.includes('COUNT(*) AS total')) return [[{ total: 1 }]];
      if (sql.includes('latest.last_attendance_date')) {
        return [[{
          id_customer: 5,
          customer_name: 'Cliente Vigente',
          plan_name: 'Mensual',
          membership_start_date: '2026-10-01',
          membership_end_date: '2026-11-30',
          last_attendance_date: null,
        }]];
      }
      throw new Error(`Consulta inesperada: ${sql}`);
    },
  };

  const result = await new ErpDirectionService(db).getInactiveCustomers({ days: '15' });
  assert.equal(result.total, 1);
  assert.equal(result.data[0].last_attendance_date, null);
  assert.equal(result.data[0].daysSinceLastAttendance, null);
  const query = calls.find(({ sql }) => sql.includes('DATEDIFF'));
  assert.match(query.sql, /c\.status = 'ACTIVE'/);
  assert.match(query.sql, /current_m\.status = 'ACTIVE'/);
  assert.match(query.sql, /current_m\.start_date <= \?/);
  assert.match(query.sql, /current_m\.end_date >= \?/);
  assert.match(query.sql, /GREATEST\(COALESCE\(latest\.last_attendance_date, m\.start_date\), m\.start_date\)/);
  assert.ok(query.params.includes(15));
});

test('consultas de asistencia rechazan fechas, identificadores y umbrales inválidos', async () => {
  const service = new ErpDirectionService({ async query() { throw new Error('No debe consultar MySQL'); } });
  await assert.rejects(
    () => service.getAttendanceSummary({ from: '2026-02-30' }),
    { status: 400 },
  );
  await assert.rejects(
    () => service.getAttendanceRecords({ id_customer: '0' }),
    { status: 400 },
  );
  await assert.rejects(
    () => service.getInactiveCustomers({ days: '14' }),
    { status: 400 },
  );
});

test('resumen comercial separa membresías registradas de cobros válidos y evita joins multiplicadores', async () => {
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("AS business_date")) {
        return [[{ business_date: '2026-11-16', month_start: '2026-11-01' }]];
      }
      if (sql.includes('AS membership_count') && sql.includes('GROUP BY m.id_plan')) {
        return [[{ id_plan: 3, plan_name: 'Mensual', membership_count: 2, recorded_value: '240.00' }]];
      }
      if (sql.includes('AS membership_count')) {
        return [[{ membership_count: 2, recorded_value: '240.00' }]];
      }
      if (sql.includes('AS valid_count')) {
        return [[{ valid_count: 1, cancelled_count: 1, collected: '120.00' }]];
      }
      if (sql.includes('GROUP BY DATE_FORMAT(DATE(p.payment_date')) {
        return [[{ date: '2026-11-04', collected: '120.00' }]];
      }
      if (sql.includes('GROUP BY DATE_FORMAT(DATE(m.creationDate')) {
        return [[{ date: '2026-11-03', recorded_value: '240.00' }]];
      }
      if (sql.includes('FROM erp_promotion_applications a')) {
        return [[{ id_promotion: 5, promotion_name: 'Descuento', uses: 1, discounts: '20.00' }]];
      }
      if (sql.includes('SELECT r.status, COUNT(*)')) return [[{ status: 'REQUESTED', total: 1 }]];
      if (sql.includes('FROM erp_renewal_requests r') && sql.includes('COUNT(*) AS total')) {
        return [[{ total: 0 }]];
      }
      if (sql.includes('FROM erp_membership_alerts al') && sql.includes('GROUP BY')) {
        return [[{ alert_type: 'EXPIRING', status: 'PENDING', total: 1 }]];
      }
      if (sql.includes('FROM erp_commercial_followups f') && sql.includes('GROUP BY')) {
        return [[{ result: 'CONTACTED', total: 2 }]];
      }
      throw new Error(`Consulta comercial inesperada: ${sql}`);
    },
  };

  const result = await new ErpDirectionService(db).getCommercialSummary({
    from: '2026-11-01',
    to: '2026-11-16',
  });

  assert.deepEqual(result.sales, {
    memberships: 2,
    recordedValue: '240.00',
    byPlan: [{ idPlan: 3, planName: 'Mensual', memberships: 2, recordedValue: '240.00' }],
  });
  assert.deepEqual(result.payments, {
    valid: 1,
    cancelled: 1,
    collected: '120.00',
  });
  assert.deepEqual(result.promotionsUsed, [{
    idPromotion: 5, name: 'Descuento', uses: 1, discounts: '20.00',
  }]);
  assert.deepEqual(result.renewals, {
    completed: 0,
    byStatus: [{ status: 'REQUESTED', total: 1 }],
  });
  assert.ok(calls.every(({ sql }) => /^\s*SELECT\b/i.test(sql)));
  assert.ok(calls.some(({ sql }) => (
    sql.includes("CASE WHEN p.status = 'REGISTERED' THEN p.amount ELSE 0 END")
  )));
  assert.ok(calls.filter(({ sql }) => sql.includes('FROM erp_promotion_applications a'))
    .every(({ sql }) => !sql.includes('JOIN payments')));
  assert.ok(calls.every(({ params }) => (params || []).includes('2026-11-01') || !params?.length));
});

test('estados de promociones se calculan desde el estado almacenado y sus fechas', async () => {
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('AS business_date')) {
        return [[{ business_date: '2026-11-16', month_start: '2026-11-01' }]];
      }
      if (sql.includes('SELECT COUNT(*) AS total FROM erp_promotions')) return [[{ total: 1 }]];
      if (sql.includes('FROM erp_promotions p')) {
        return [[{
          id_promotion: 8,
          name: 'Promo',
          description: null,
          discount_type: 'PERCENTAGE',
          discount_value: '10.00',
          start_date: '2026-11-01',
          end_date: '2026-11-30',
          stored_status: 'ACTIVE',
          effective_status: 'ACTIVE',
          plan_name: 'Mensual',
          uses: 2,
          discounts: '20.00',
        }]];
      }
      throw new Error(`Consulta comercial inesperada: ${sql}`);
    },
  };

  const result = await new ErpDirectionService(db).getCommercialPromotions({
    from: '2026-11-01',
    to: '2026-11-16',
    status: 'active',
  });

  assert.equal(result.items[0].status, 'ACTIVE');
  assert.equal(result.items[0].storedStatus, 'ACTIVE');
  assert.equal(result.items[0].uses, 2);
  assert.ok(calls[1].sql.includes("WHEN p.start_date > ? THEN 'UPCOMING'"));
  assert.ok(calls[2].sql.includes("WHEN p.end_date < ? THEN 'EXPIRED'"));
  assert.ok(calls[2].sql.includes('LEFT JOIN ('));
  assert.ok(!calls[2].sql.includes('JOIN payments'));
});

function tokenFor(secret) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'HS256' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: '7',
    iss: 'gym-mqs-api',
    aud: 'gym-mqs-web',
    iat: now,
    exp: now + 600,
    jti: randomUUID(),
  })).toString('base64url');
  const unsigned = `${header}.${payload}`;
  const signature = createHmac('sha256', secret).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}

test('API Dirección requiere JWT y bloquea a Recepción', async () => {
  const secret = 'direction-dashboard-test-secret-at-least-32-bytes';
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = secret;
  let actorRole = 'Recepcionista';
  const db = {
    async query(sql) {
      assert.match(sql, /FROM users AS u/);
      return [[{
        id_user: 7,
        username: 'recepcion',
        user_status: 'ACTIVE',
        id_role: 2,
        role: actorRole,
        role_status: 'ACTIVE',
      }]];
    },
  };
  const server = createApp(db).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/erp/direction/dashboard`;
    const anonymous = await fetch(url);
    assert.equal(anonymous.status, 401);
    const anonymousAttendance = await fetch(url.replace('/dashboard', '/attendance/summary'));
    assert.equal(anonymousAttendance.status, 401);

    const receptionist = await fetch(url, {
      headers: { Authorization: `Bearer ${tokenFor(secret)}` },
    });
    assert.equal(receptionist.status, 403);

    const receptionistCustomers = await fetch(
      url.replace('/dashboard', '/customers'),
      { headers: { Authorization: `Bearer ${tokenFor(secret)}` } },
    );
    assert.equal(receptionistCustomers.status, 403);
    const receptionistFinance = await fetch(
      url.replace('/dashboard', '/finance/summary'),
      { headers: { Authorization: `Bearer ${tokenFor(secret)}` } },
    );
    assert.equal(receptionistFinance.status, 403);
    const receptionistAttendance = await fetch(
      url.replace('/dashboard', '/attendance/summary'),
      { headers: { Authorization: `Bearer ${tokenFor(secret)}` } },
    );
    assert.equal(receptionistAttendance.status, 403);
    const receptionistCommercial = await fetch(
      url.replace('/dashboard', '/commercial/summary'),
      { headers: { Authorization: `Bearer ${tokenFor(secret)}` } },
    );
    assert.equal(receptionistCommercial.status, 403);
    const anonymousCommercial = await fetch(url.replace('/dashboard', '/commercial/summary'));
    assert.equal(anonymousCommercial.status, 401);
    const anonymousReport = await fetch(url.replace('/dashboard', '/reports/customers'));
    assert.equal(anonymousReport.status, 401);
    const receptionistReport = await fetch(
    url.replace('/dashboard', '/reports/customers'),
    { headers: { Authorization: `Bearer ${tokenFor(secret)}` } },
    );
    assert.equal(receptionistReport.status, 403);
    actorRole = 'Entrenador';
    const trainerAttendance = await fetch(
      url.replace('/dashboard', '/attendance/summary'),
      { headers: { Authorization: `Bearer ${tokenFor(secret)}` } },
    );
    assert.equal(trainerAttendance.status, 403);
    const trainerReport = await fetch(
    url.replace('/dashboard', '/reports/customers'),
    { headers: { Authorization: `Bearer ${tokenFor(secret)}` } },
    );
    assert.equal(trainerReport.status, 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});

test('Director autenticado consulta el endpoint de solo lectura', async () => {
  const secret = 'direction-dashboard-test-secret-at-least-32-bytes';
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = secret;
  const source = dashboardDb();
  let actorRole = 'Director';
  const dashboardQuery = source.query.bind(source);
  source.query = async (sql, params) => {
    if (sql.includes('FROM users AS u')) {
      return [[{
        id_user: 7,
        username: 'director',
        user_status: 'ACTIVE',
        id_role: 4,
        role: actorRole,
        role_status: 'ACTIVE',
      }]];
    }
    return dashboardQuery(sql, params);
  };
  const server = createApp(source).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/erp/direction/dashboard`,
      { headers: { Authorization: `Bearer ${tokenFor(secret)}` } },
    );
    assert.equal(response.status, 200);
    const dashboard = await response.json();
    assert.equal(dashboard.customers.total, 20);
    assert.equal(dashboard.finances.netThisMonth, '65.00');

    const customersResponse = await fetch(
      `http://127.0.0.1:${server.address().port}/api/erp/direction/customers`,
      { headers: { Authorization: `Bearer ${tokenFor(secret)}` } },
    );
    assert.equal(customersResponse.status, 200);
    assert.ok(Array.isArray((await customersResponse.json()).data));

    const financeResponse = await fetch(
      `http://127.0.0.1:${server.address().port}/api/erp/direction/finance/summary`,
      { headers: { Authorization: `Bearer ${tokenFor(secret)}` } },
    );
    assert.equal(financeResponse.status, 200);
    const finance = await financeResponse.json();
    assert.equal(finance.totals.net, '65.00');

    const attendanceResponse = await fetch(
      `http://127.0.0.1:${server.address().port}/api/erp/direction/attendance/summary?from=2026-11-01&to=2026-11-16`,
      { headers: { Authorization: `Bearer ${tokenFor(secret)}` } },
    );
    assert.equal(attendanceResponse.status, 200);
    const attendance = await attendanceResponse.json();
    assert.equal(attendance.month.total, 12);
    assert.equal(attendance.period.uniqueCustomers, 4);

    actorRole = 'Administrador';
    const adminAttendanceResponse = await fetch(
      `http://127.0.0.1:${server.address().port}/api/erp/direction/attendance/summary`,
      { headers: { Authorization: `Bearer ${tokenFor(secret)}` } },
    );
    assert.equal(adminAttendanceResponse.status, 200);
    const adminFinanceResponse = await fetch(
      `http://127.0.0.1:${server.address().port}/api/erp/direction/finance/summary`,
      { headers: { Authorization: `Bearer ${tokenFor(secret)}` } },
    );
    assert.equal(adminFinanceResponse.status, 200);

    const writeAttendanceResponse = await fetch(
      `http://127.0.0.1:${server.address().port}/api/erp/direction/attendance/records`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenFor(secret)}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id_customer: 1 }),
      },
    );
    assert.equal(writeAttendanceResponse.status, 404);

    const mutationResponse = await fetch(
      `http://127.0.0.1:${server.address().port}/api/erp/direction/customers`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenFor(secret)}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ first_name: 'No debe crearse' }),
      },
    );
    assert.equal(mutationResponse.status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});

test('Director puede consultar promociones comerciales por el endpoint protegido', async () => {
  const secret = 'direction-dashboard-test-secret-at-least-32-bytes';
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = secret;
  const db = {
    async query(sql) {
      if (sql.includes('FROM users AS u')) {
        return [[{
          id_user: 7,
          username: 'director',
          user_status: 'ACTIVE',
          id_role: 4,
          role: 'Director',
          role_status: 'ACTIVE',
        }]];
      }
      if (sql.includes('AS business_date')) {
        return [[{ business_date: '2026-11-16', month_start: '2026-11-01' }]];
      }
      if (sql.includes('SELECT COUNT(*) AS total FROM erp_promotions')) return [[{ total: 1 }]];
      if (sql.includes('FROM erp_promotions p')) {
        return [[{
          id_promotion: 8,
          name: 'Promo',
          description: null,
          discount_type: 'PERCENTAGE',
          discount_value: '10.00',
          start_date: '2026-11-01',
          end_date: '2026-11-30',
          stored_status: 'ACTIVE',
          effective_status: 'ACTIVE',
          plan_name: 'Mensual',
          uses: 2,
          discounts: '20.00',
        }]];
      }
      throw new Error(`Consulta inesperada: ${sql}`);
    },
  };
  const server = createApp(db).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/erp/direction/commercial/promotions?from=2026-11-01&to=2026-11-16`,
      { headers: { Authorization: `Bearer ${tokenFor(secret)}` } },
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.items[0].status, 'ACTIVE');
    assert.equal(body.items[0].uses, 2);
    assert.match(response.headers.get('cache-control'), /no-store/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});

test('reporte financiero aplica filtros, paginación y la fórmula neta sin duplicar movimientos', async () => {
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('DATE_FORMAT(UTC_TIMESTAMP()')) {
        return [[{ business_date: '2026-11-16', month_start: '2026-11-01' }]];
      }
      if (sql.includes('GROUP BY DATE_FORMAT(m.business_date')) {
        return [[{
          date: '2026-11-04',
          income: '100.00',
          expenses: '25.00',
          reversals: '5.00',
        }]];
      }
      if (sql.includes('COUNT(DISTINCT m.id_cash_movement)')) return [[{ total: 7 }]];
      if (sql.includes('SELECT m.id_cash_movement')) {
        return [[{ id_cash_movement: 8, movement_kind: 'PAYMENT_IN', amount: '100.00' }]];
      }
      if (sql.includes('AS income') && sql.includes('FROM erp_cash_movements m')) {
        return [[{ income: '100.00', expenses: '25.00', reversals: '5.00' }]];
      }
      throw new Error(`Consulta financiera inesperada: ${sql}`);
    },
  };

  const result = await new ErpDirectionService(db).getGeneralReport('finance', {
    from: '2026-11-01',
    to: '2026-11-16',
    movement_kind: 'PAYMENT_IN',
    id_payment_method: '2',
    page: '2',
    limit: '5',
  });

  assert.deepEqual(result.summary, {
    income: '100.00',
    expenses: '25.00',
    reversals: '5.00',
    net: '70.00',
  });
  assert.deepEqual(result.chart, [{
    date: '2026-11-04',
    income: 100,
    expenses: 25,
    reversals: 5,
  }]);
  assert.deepEqual(result.data, [{
    id_cash_movement: 8,
    movement_kind: 'PAYMENT_IN',
    amount: '100.00',
  }]);
  assert.equal(result.page, 2);
  assert.equal(result.limit, 5);
  assert.equal(result.totalPages, 2);
  const movementQueries = calls.filter(({ sql }) => sql.includes('FROM erp_cash_movements m'));
  assert.equal(movementQueries.length, 4);
  assert.ok(movementQueries.every(({ sql, params }) => (
    sql.includes('m.movement_kind = ?')
    && sql.includes('m.id_payment_method = ?')
    && params.includes('PAYMENT_IN')
    && params.includes(2)
    && /^\s*SELECT\b/i.test(sql)
  )));
  assert.deepEqual(movementQueries.find(({ sql }) => sql.includes('COUNT(DISTINCT')).params, [
    '2026-11-01', '2026-11-16', 'PAYMENT_IN', 2,
  ]);
  assert.deepEqual(movementQueries.find(({ sql }) => sql.includes('SELECT m.id_cash_movement')).params, [
    '2026-11-01', '2026-11-16', 'PAYMENT_IN', 2, 5, 5,
  ]);
});

test('reporte de pagos mantiene anulados separados y combina estado, método, búsqueda y página', async () => {
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('DATE_FORMAT(UTC_TIMESTAMP()')) {
        return [[{ business_date: '2026-11-16', month_start: '2026-11-01' }]];
      }
      if (sql.includes('AS registered_amount')) {
        return [[{
          registered_count: 0,
          cancelled_count: 1,
          registered_amount: '0.00',
          cancelled_amount: '120.00',
        }]];
      }
      if (sql.includes('SELECT COUNT(*) AS total') && sql.includes('FROM payments p')) {
        return [[{ total: 7 }]];
      }
      if (sql.includes('SELECT p.id_payment')) {
        return [[{
          id_payment: 9,
          id_customer: 3,
          customer_name: 'Ada Lovelace',
          concept: 'Mensual',
          amount: '120.00',
          payment_method: 'Efectivo',
          status: 'CANCELLED',
        }]];
      }
      throw new Error(`Consulta de pagos inesperada: ${sql}`);
    },
  };

  const result = await new ErpDirectionService(db).getGeneralReport('payments', {
    from: '2026-11-01',
    to: '2026-11-16',
    status: 'CANCELLED',
    id_payment_method: '2',
    search: 'Ada',
    page: '2',
    limit: '5',
  });

  assert.deepEqual(result.summary, {
    registeredCount: 0,
    cancelledCount: 1,
    registeredAmount: '0.00',
    cancelledAmount: '120.00',
  });
  assert.equal(result.data[0].status, 'CANCELLED');
  assert.equal(result.page, 2);
  const reportQueries = calls.filter(({ sql }) => sql.includes('FROM payments p'));
  assert.equal(reportQueries.length, 3);
  assert.ok(reportQueries.every(({ sql, params }) => (
    sql.includes('p.status = ?')
    && sql.includes('p.id_payment_method = ?')
    && sql.includes('CAST(p.id_payment AS CHAR) LIKE ?')
    && params.includes('CANCELLED')
    && params.includes(2)
    && params.filter((value) => value === '%Ada%').length === 3
    && /^\s*SELECT\b/i.test(sql)
  )));
  assert.ok(reportQueries.some(({ sql }) => (
    sql.includes("CASE WHEN p.status = 'REGISTERED' THEN p.amount ELSE 0 END")
    && sql.includes("CASE WHEN p.status = 'CANCELLED' THEN p.amount ELSE 0 END")
  )));
  assert.deepEqual(reportQueries.find(({ sql }) => sql.includes('SELECT p.id_payment')).params, [
    '2026-11-01', '2026-11-16', 'CANCELLED', 2,
    '%Ada%', '%Ada%', '%Ada%', 5, 5,
  ]);
});

test('reporte de ventas agrupa membresías y cobros válidos en subconsultas independientes', async () => {
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('DATE_FORMAT(UTC_TIMESTAMP()')) {
        return [[{ business_date: '2026-11-16', month_start: '2026-11-01' }]];
      }
      if (sql.includes('SELECT COUNT(*) AS total') && sql.includes('FROM membership_plans pl')) {
        return [[{ total: 7 }]];
      }
      if (sql.includes('SELECT pl.id_plan')) {
        return [[{
          id_plan: 3,
          plan_name: 'Mensual',
          membership_count: 2,
          recorded_value: '240.00',
          valid_payment_count: 1,
          collected_value: '120.00',
        }]];
      }
      throw new Error(`Consulta de ventas inesperada: ${sql}`);
    },
  };

  const result = await new ErpDirectionService(db).getGeneralReport('sales-by-plan', {
    from: '2026-11-01',
    to: '2026-11-16',
    id_plan: '3',
    page: '2',
    limit: '5',
  });

  assert.deepEqual(result.summary, {
    memberships: 2,
    recordedValue: '240.00',
    validPayments: 1,
    collected: '120.00',
  });
  assert.deepEqual(result.chart, [{
    idPlan: 3,
    planName: 'Mensual',
    recordedValue: 240,
    collected: 120,
  }]);
  assert.equal(result.page, 2);
  const reportQueries = calls.filter(({ sql }) => sql.includes('FROM membership_plans pl'));
  assert.equal(reportQueries.length, 3);
  assert.ok(reportQueries.every(({ sql, params }) => (
    sql.includes('LEFT JOIN (')
    && sql.includes('FROM memberships m')
    && sql.includes('FROM payments p')
    && sql.includes("p.status = 'REGISTERED'")
    && sql.includes('pl.id_plan = ?')
    && params.includes(3)
    && !sql.includes('erp_financial_entries')
    && !sql.includes('erp_cash_movements')
    && /^\s*SELECT\b/i.test(sql)
  )));
  assert.ok(reportQueries.every(({ params }) => (
    params.slice(0, 4).join(',') === '2026-11-01,2026-11-16,2026-11-01,2026-11-16'
  )));
});

test('reporte general está protegido y Director solo puede consultar por GET', async () => {
  const secret = 'direction-dashboard-test-secret-at-least-32-bytes';
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = secret;
  const queries = [];
  let actorRole = 'Director';
  const db = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes('FROM users AS u')) {
        return [[{
          id_user: 7,
          username: 'director',
          user_status: 'ACTIVE',
          id_role: 4,
          role: actorRole,
          role_status: 'ACTIVE',
        }]];
      }
      if (sql.includes('DATE_FORMAT(UTC_TIMESTAMP()')) {
        return [[{ business_date: '2026-11-16', month_start: '2026-11-01' }]];
      }
      if (sql.includes('SELECT COUNT(DISTINCT c.id_customer) AS total')) {
        return [[{ total: 1, active: 1, inactive: 0 }]];
      }
      if (sql.includes('SELECT c.id_customer')) {
        return [[{
          id_customer: 3,
          customer_name: 'Ada Lovelace',
          customer_status: 'ACTIVE',
          plan_name: 'Mensual',
          membership_status: 'ACTIVE',
          registration_date: '2026-11-04',
        }]];
      }
      throw new Error(`Consulta de reporte inesperada: ${sql}`);
    },
  };
  const server = createApp(db).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/erp/direction/reports/customers`;
    const anonymous = await fetch(url);
    assert.equal(anonymous.status, 401);

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${tokenFor(secret)}` },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.summary.total, 1);
    assert.equal(body.data[0].customer_name, 'Ada Lovelace');
    assert.match(response.headers.get('cache-control'), /no-store/);

    actorRole = 'Administrador';
    const adminResponse = await fetch(url, {
      headers: { Authorization: `Bearer ${tokenFor(secret)}` },
    });
    assert.equal(adminResponse.status, 200);

    const mutation = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenFor(secret)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ first_name: 'No debe crearse' }),
    });
    assert.equal(mutation.status, 404);
    assert.ok(queries.every(({ sql }) => /^\s*SELECT\b/i.test(sql)));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});
