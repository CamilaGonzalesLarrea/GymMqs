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
  const db = {
    async query(sql) {
      assert.match(sql, /FROM users AS u/);
      return [[{
        id_user: 7,
        username: 'recepcion',
        user_status: 'ACTIVE',
        id_role: 2,
        role: 'Recepcionista',
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

    const receptionist = await fetch(url, {
      headers: { Authorization: `Bearer ${tokenFor(secret)}` },
    });
    assert.equal(receptionist.status, 403);

    const receptionistCustomers = await fetch(
      url.replace('/dashboard', '/customers'),
      { headers: { Authorization: `Bearer ${tokenFor(secret)}` } },
    );
    assert.equal(receptionistCustomers.status, 403);
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
  const dashboardQuery = source.query.bind(source);
  source.query = async (sql, params) => {
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
