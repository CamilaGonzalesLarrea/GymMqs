'use strict';

const {
  HttpError,
  BadRequestException,
  NotFoundException,
} = require('../middlewares/errors');

const BUSINESS_DATE_SQL = 'DATE(UTC_TIMESTAMP() - INTERVAL 4 HOUR)';
const MAX_ID = 2147483647;
const RENEWAL_STATUSES = new Set(['REQUESTED', 'COMPLETED', 'REJECTED', 'CANCELLED']);

const VIEWS = {
  finance: {
    name: 'vw_erp_finance_daily',
    source: 'erp_cash_movements',
  },
  membership: {
    name: 'vw_erp_membership_status',
    source: 'memberships',
  },
  attendance: {
    name: 'vw_erp_attendance_hourly',
    source: 'customer_attendances',
  },
};

class DashboardUnavailableError extends HttpError {
  constructor(message) {
    super(503, message);
  }
}

function normalizedSql(value) {
  return String(value || '').toLowerCase().replace(/[`"]/g, '');
}

function assertViewDefinition(view, definition) {
  const sql = normalizedSql(definition);
  const sourcePattern = new RegExp(`\\b${view.source}\\b`, 'gi');
  const sourceReferences = sql.match(sourcePattern) || [];
  if (!sql || sourceReferences.length !== 1) {
    throw new DashboardUnavailableError(
      `La vista ${view.name} no existe o no utiliza la tabla esperada.`,
    );
  }
  if (view.name === 'vw_erp_finance_daily') {
    const closureReferences = sql.match(/\berp_cash_closures\b/g) || [];
    if (/\bunion\b/i.test(sql)) {
      throw new DashboardUnavailableError(
        'La vista financiera combina fuentes y no se puede validar sin riesgo de duplicar movimientos.',
      );
    }
    if (closureReferences.length) {
      const movementAlias = sql.match(/\berp_cash_movements\s+(?:as\s+)?([a-z0-9_]+)/i)?.[1];
      const closureAlias = sql.match(/\berp_cash_closures\s+(?:as\s+)?([a-z0-9_]+)/i)?.[1];
      const joinCondition = sql.replace(/[()]/g, ' ').replace(/\s+/g, ' ')
        .match(/\bon\b(.*?)\bgroup\s+by\b/i)?.[1] || '';
      const expectedJoin = movementAlias && closureAlias && new RegExp(
        `\\b${closureAlias}\\.business_date\\s*=\\s*${movementAlias}\\.business_date\\b|` +
        `\\b${movementAlias}\\.business_date\\s*=\\s*${closureAlias}\\.business_date\\b`,
        'i',
      ).test(joinCondition);
      if (
        closureReferences.length !== 1 ||
        (sql.match(/\bjoin\b/g) || []).length !== 1 ||
        !/\bleft\s+join\s+(?:[a-z0-9_]+\.)?erp_cash_closures\b/i.test(sql) ||
        !expectedJoin ||
        !new RegExp(`\\bgroup\\s+by\\s+${movementAlias}\\.business_date\\b`, 'i').test(sql)
      ) {
        throw new DashboardUnavailableError(
          'La vista financiera no garantiza una relación única entre movimientos y cierres.',
        );
      }
    } else if (/\bjoin\b/i.test(sql)) {
      throw new DashboardUnavailableError(
        'La vista financiera contiene una relación no verificada que podría duplicar movimientos.',
      );
    }
  }
}

function columnName(columns, candidates) {
  for (const candidate of candidates) {
    const found = columns.find((column) => column.toLowerCase() === candidate);
    if (found) return found;
  }
  return null;
}

function countValue(value) {
  const result = Number(value || 0);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error('MySQL devolvió un contador inválido para Dirección');
  }
  return result;
}

function decimalCents(value) {
  const raw = String(value ?? '0').trim();
  const match = /^(-?)(\d{1,12})(?:\.(\d{1,2}))?$/.exec(raw);
  if (!match) throw new Error('MySQL devolvió un importe inválido para Dirección');
  const cents = BigInt(match[2]) * 100n + BigInt((match[3] || '').padEnd(2, '0'));
  return match[1] ? -cents : cents;
}

function decimalText(cents) {
  const absolute = cents < 0n ? -cents : cents;
  return `${cents < 0n ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}

function numericValue(value) {
  const cents = decimalCents(value);
  return Number(cents) / 100;
}

function validateQuery(query, allowedKeys) {
  for (const key of Object.keys(query || {})) {
    if (!allowedKeys.includes(key)) {
      throw new BadRequestException(`Filtro no permitido: ${key}`);
    }
  }
}

function positiveInteger(value, label, defaultValue = null, maxValue = MAX_ID) {
  if (value === undefined && defaultValue !== null) return defaultValue;
  const raw = typeof value === 'number' && Number.isSafeInteger(value)
    ? String(value)
    : typeof value === 'string' ? value : '';
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new BadRequestException(`${label} debe ser un entero positivo`);
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed > maxValue) {
    throw new BadRequestException(`${label} está fuera de rango`);
  }
  return parsed;
}

function pagination(query) {
  const page = positiveInteger(query.page, 'page', 1, 100000);
  const limit = positiveInteger(query.limit, 'limit', 20, 100);
  return { page, limit, offset: (page - 1) * limit };
}

function searchValue(value) {
  if (value === undefined || value === null || value === '') return '';
  if (
    typeof value !== 'string' ||
    value.trim().length > 100 ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new BadRequestException('La búsqueda debe ser texto de hasta 100 caracteres');
  }
  return value.trim();
}

function currentMembershipRank(alias) {
  return `CASE
    WHEN ${alias}.status = 'ACTIVE'
      AND ${alias}.start_date <= ${BUSINESS_DATE_SQL}
      AND ${alias}.end_date >= ${BUSINESS_DATE_SQL} THEN 0
    WHEN ${alias}.status = 'PENDING' THEN 1
    WHEN ${alias}.status = 'ACTIVE'
      AND ${alias}.start_date > ${BUSINESS_DATE_SQL} THEN 2
    WHEN ${alias}.status = 'EXPIRED'
      OR (${alias}.status = 'ACTIVE' AND ${alias}.end_date < ${BUSINESS_DATE_SQL}) THEN 3
    WHEN ${alias}.status = 'CANCELLED' THEN 4
    ELSE 5
  END`;
}

function effectiveMembershipStatus(alias) {
  return `CASE
    WHEN ${alias}.status = 'CANCELLED' THEN 'CANCELLED'
    WHEN ${alias}.status = 'PENDING' THEN 'PENDING'
    WHEN ${alias}.status = 'EXPIRED'
      OR (${alias}.status = 'ACTIVE' AND ${alias}.end_date < ${BUSINESS_DATE_SQL}) THEN 'EXPIRED'
    WHEN ${alias}.status = 'ACTIVE'
      AND ${alias}.start_date > ${BUSINESS_DATE_SQL} THEN 'SCHEDULED'
    ELSE 'ACTIVE'
  END`;
}

const CUSTOMER_MEMBERSHIP_FROM = `
  FROM customers c
  LEFT JOIN memberships m ON m.id_membership = (
    SELECT candidate.id_membership
    FROM memberships candidate
    WHERE candidate.id_customer = c.id_customer
    ORDER BY ${currentMembershipRank('candidate')},
      candidate.start_date DESC, candidate.id_membership DESC
    LIMIT 1
  )
  LEFT JOIN membership_plans pl ON pl.id_plan = m.id_plan
`;

class ErpDirectionService {
  constructor(db) {
    if (!db || typeof db.query !== 'function') {
      throw new TypeError('Se requiere una conexión MySQL para consultar Dirección');
    }
    this.db = db;
  }

  async inspectViews() {
    const [rows] = await this.db.query(`
      SELECT TABLE_NAME, VIEW_DEFINITION
      FROM INFORMATION_SCHEMA.VIEWS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN (?, ?, ?)
    `, [VIEWS.finance.name, VIEWS.membership.name, VIEWS.attendance.name]);

    const definitions = new Map(
      (rows || []).map((row) => [row.TABLE_NAME, row.VIEW_DEFINITION]),
    );

    for (const view of Object.values(VIEWS)) {
      assertViewDefinition(view, definitions.get(view.name));
    }

    const [columns] = await this.db.query(`
      SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN (?, ?, ?)
      ORDER BY TABLE_NAME, ORDINAL_POSITION
    `, [VIEWS.finance.name, VIEWS.membership.name, VIEWS.attendance.name]);

    const result = new Map(Object.values(VIEWS).map((view) => [view.name, []]));
    for (const column of columns || []) {
      result.get(column.TABLE_NAME)?.push(column);
    }
    for (const view of Object.values(VIEWS)) {
      if (!result.get(view.name)?.length) {
        throw new DashboardUnavailableError(
          `No se pudieron verificar las columnas de ${view.name}.`,
        );
      }
    }
    const financeDefinition = normalizedSql(
      definitions.get(VIEWS.finance.name),
    );
    if (/\berp_cash_closures\b/.test(financeDefinition)) {
      const [indexes] = await this.db.query(`
        SELECT INDEX_NAME, NON_UNIQUE, COLUMN_NAME
        FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'erp_cash_closures'
          AND NON_UNIQUE = 0
      `);
      const uniqueColumns = new Map();
      for (const index of indexes || []) {
        if (!uniqueColumns.has(index.INDEX_NAME)) uniqueColumns.set(index.INDEX_NAME, []);
        uniqueColumns.get(index.INDEX_NAME).push(index.COLUMN_NAME);
      }
      const hasUniqueBusinessDate = [...uniqueColumns.values()].some(
        (indexColumns) => indexColumns.length === 1 && indexColumns[0] === 'business_date',
      );
      if (!hasUniqueBusinessDate) {
        throw new DashboardUnavailableError(
          'No se pudo confirmar que cada cierre corresponda a un único día.',
        );
      }
    }
    return { columns: result, definitions };
  }

  async getToday() {
    const [rows] = await this.db.query(`
      SELECT
        DATE_FORMAT(UTC_TIMESTAMP() - INTERVAL 4 HOUR, '%Y-%m-%d') AS business_date,
        DATE_FORMAT(UTC_TIMESTAMP() - INTERVAL 4 HOUR, '%Y-%m-01') AS month_start
    `);
    if (!rows?.[0]?.business_date || !rows?.[0]?.month_start) {
      throw new Error('MySQL no devolvió el periodo comercial de Dirección');
    }
    return rows[0];
  }

  async getCustomerMetrics(monthStart, today) {
    const [rows] = await this.db.query(`
      SELECT
        COUNT(*) AS total,
        COALESCE(SUM(status = 'ACTIVE'), 0) AS active,
        COALESCE(SUM(status = 'INACTIVE'), 0) AS inactive,
        COALESCE(SUM(registration_date BETWEEN ? AND ?), 0) AS new_this_month
      FROM customers
    `, [monthStart, today]);
    return rows[0] || {};
  }

  async getMembershipMetrics(today) {
    const [rows] = await this.db.query(`
      SELECT
        COUNT(*) AS total,
        COALESCE(SUM(status = 'ACTIVE' AND start_date <= ? AND end_date >= ?), 0) AS active,
        COALESCE(SUM(status = 'EXPIRED' OR (status = 'ACTIVE' AND end_date < ?)), 0) AS expired,
        COALESCE(SUM(status = 'ACTIVE' AND start_date <= ? AND end_date BETWEEN ? AND DATE_ADD(?, INTERVAL 7 DAY)), 0) AS expiring,
        COALESCE(SUM(status = 'PENDING'), 0) AS pending,
        COALESCE(SUM(status = 'ACTIVE' AND start_date > ?), 0) AS scheduled,
        COALESCE(SUM(status = 'CANCELLED'), 0) AS cancelled
      FROM memberships
    `, [today, today, today, today, today, today, today]);
    return rows[0] || {};
  }

  async getRenewalCount(monthStart, today) {
    const [rows] = await this.db.query(`
      SELECT COUNT(*) AS total
      FROM erp_renewal_requests
      WHERE status = 'COMPLETED'
        AND DATE(completed_at - INTERVAL 4 HOUR) BETWEEN ? AND ?
    `, [monthStart, today]);
    return rows[0]?.total || 0;
  }

  async getPaymentCounts(monthStart, today) {
    const [rows] = await this.db.query(`
      SELECT
        COALESCE(SUM(status = 'REGISTERED'), 0) AS valid,
        COALESCE(SUM(status = 'CANCELLED'), 0) AS cancelled
      FROM payments
      WHERE DATE(payment_date - INTERVAL 4 HOUR) BETWEEN ? AND ?
    `, [monthStart, today]);
    return rows[0] || {};
  }

  async getFinancialTotals(today, monthStart) {
    const [rows] = await this.db.query(`
      SELECT
        COALESCE(SUM(CASE WHEN business_date = ? AND movement_kind IN ('PAYMENT_IN', 'OTHER_IN') THEN amount ELSE 0 END), 0) AS income_today,
        COALESCE(SUM(CASE WHEN business_date BETWEEN ? AND ? AND movement_kind IN ('PAYMENT_IN', 'OTHER_IN') THEN amount ELSE 0 END), 0) AS income_month,
        COALESCE(SUM(CASE WHEN business_date BETWEEN ? AND ? AND movement_kind = 'EXPENSE_OUT' THEN amount ELSE 0 END), 0) AS expenses_month,
        COALESCE(SUM(CASE WHEN business_date BETWEEN ? AND ? AND movement_kind = 'PAYMENT_REVERSAL' THEN amount ELSE 0 END), 0) AS reversals_month
      FROM erp_cash_movements
      WHERE business_date BETWEEN ? AND ?
    `, [today, monthStart, today, monthStart, today, monthStart, today, monthStart, today]);
    return rows[0] || {};
  }

  async getAttendanceMetrics(today, monthStart) {
    const [rows] = await this.db.query(`
      SELECT
        COALESCE(SUM(attendance_date = ?), 0) AS today,
        COALESCE(SUM(attendance_date BETWEEN ? AND ?), 0) AS this_month
      FROM customer_attendances
      WHERE attendance_date BETWEEN ? AND ?
    `, [today, monthStart, today, monthStart, today]);
    return rows[0] || {};
  }

  async getFinanceChart(columns, monthStart, today) {
    const rows = columns.get(VIEWS.finance.name) || [];
    const names = rows.map((row) => row.COLUMN_NAME);
    const day = columnName(names, ['business_date', 'finance_date', 'report_date', 'date']);
    const income = columnName(names, ['total_income', 'income', 'income_amount']);
    const expenses = columnName(names, ['total_expenses', 'expenses', 'expense_amount']);
    if (!day || !income || !expenses) {
      throw new DashboardUnavailableError(
        'La vista financiera no expone fecha, ingresos y gastos con columnas verificables.',
      );
    }
    const [chartRows] = await this.db.query(`
      SELECT DATE(\`${day}\`) AS date,
        COALESCE(SUM(\`${income}\`), 0) AS income,
        COALESCE(SUM(\`${expenses}\`), 0) AS expenses
      FROM \`${VIEWS.finance.name}\`
      WHERE \`${day}\` BETWEEN ? AND ?
      GROUP BY DATE(\`${day}\`)
      ORDER BY DATE(\`${day}\`)
    `, [monthStart, today]);
    return chartRows || [];
  }

  async getMembershipChart(columns, today, definition) {
    const rows = columns.get(VIEWS.membership.name) || [];
    const names = rows.map((row) => row.COLUMN_NAME);
    const id = columnName(names, ['id_membership']);
    const storedStatus = columnName(names, ['stored_status', 'status']);
    const start = columnName(names, ['start_date']);
    const end = columnName(names, ['end_date']);
    const membershipSql = normalizedSql(definition);
    if (
      !id || !storedStatus || !start || !end ||
      !/\bstart_date\b/.test(membershipSql) ||
      !/\bend_date\b/.test(membershipSql)
    ) {
      return this.getMembershipStatusFromTable(today);
    }
    const [chartRows] = await this.db.query(`
      SELECT
        CASE
          WHEN UPPER(\`${storedStatus}\`) = 'CANCELLED' THEN 'CANCELLED'
          WHEN UPPER(\`${storedStatus}\`) = 'PENDING' THEN 'PENDING'
          WHEN UPPER(\`${storedStatus}\`) = 'EXPIRED' OR \`${end}\` < ? THEN 'EXPIRED'
          WHEN \`${start}\` > ? THEN 'SCHEDULED'
          ELSE 'ACTIVE'
        END AS status,
        COUNT(DISTINCT \`${id}\`) AS total
      FROM \`${VIEWS.membership.name}\`
      GROUP BY status
    `, [today, today]);

    if (chartRows?.length) return chartRows;
    return this.getMembershipStatusFromTable(today);
  }

  async getMembershipStatusFromTable(today) {
    const [rows] = await this.db.query(`
      SELECT
        CASE
          WHEN status = 'ACTIVE' AND start_date <= ? AND end_date >= ? THEN 'ACTIVE'
          WHEN status = 'ACTIVE' AND start_date > ? THEN 'SCHEDULED'
          WHEN status = 'EXPIRED' OR (status = 'ACTIVE' AND end_date < ?) THEN 'EXPIRED'
          ELSE status
        END AS status,
        COUNT(*) AS total
      FROM memberships
      GROUP BY status
    `, [today, today, today, today]);
    return rows || [];
  }

  async getAttendanceChart(columns, monthStart, today) {
    const rows = columns.get(VIEWS.attendance.name) || [];
    const names = rows.map((row) => row.COLUMN_NAME);
    const day = columnName(names, ['attendance_date', 'business_date', 'date']);
    const hour = columnName(names, ['attendance_hour', 'hour_of_day', 'hour', 'entry_hour', 'entry_time']);
    const count = columnName(names, ['attendance_count', 'total_attendances', 'attendance_total']);
    const id = columnName(names, ['id_attendance', 'id_customer_attendance']);

    if (day && hour && (count || id)) {
      const hourExpression = /hour|_hour$/.test(hour.toLowerCase())
        ? `CAST(\`${hour}\` AS UNSIGNED)`
        : `HOUR(\`${hour}\`)`;
      const countExpression = count
        ? `SUM(\`${count}\`)`
        : `COUNT(DISTINCT \`${id}\`)`;
      const [chartRows] = await this.db.query(`
        SELECT ${hourExpression} AS hour, ${countExpression} AS total
        FROM \`${VIEWS.attendance.name}\`
        WHERE \`${day}\` BETWEEN ? AND ?
        GROUP BY ${hourExpression}
        ORDER BY hour
      `, [monthStart, today]);
      if (chartRows?.length) return chartRows;
    }

    const [chartRows] = await this.db.query(`
      SELECT HOUR(entry_time) AS hour, COUNT(*) AS total
      FROM customer_attendances
      WHERE attendance_date BETWEEN ? AND ?
      GROUP BY HOUR(entry_time)
      ORDER BY hour
    `, [monthStart, today]);
    return chartRows || [];
  }

  async getCustomers(query = {}) {
    validateQuery(query, ['page', 'limit', 'search', 'filter']);
    const { page, limit, offset } = pagination(query);
    const search = searchValue(query.search);
    const filter = query.filter || 'all';
    const conditions = [];
    const params = [];

    if (!['all', 'customer_active', 'customer_inactive', 'membership_active',
      'membership_expired', 'membership_expiring'].includes(filter)) {
      throw new BadRequestException('Filtro de clientes inválido');
    }
    if (filter === 'customer_active') conditions.push("c.status = 'ACTIVE'");
    if (filter === 'customer_inactive') conditions.push("c.status = 'INACTIVE'");
    if (filter === 'membership_active') {
      conditions.push(`m.status = 'ACTIVE' AND m.start_date <= ${BUSINESS_DATE_SQL}
        AND m.end_date >= ${BUSINESS_DATE_SQL}`);
    }
    if (filter === 'membership_expired') {
      conditions.push(`(m.status = 'EXPIRED' OR
        (m.status = 'ACTIVE' AND m.end_date < ${BUSINESS_DATE_SQL}))`);
    }
    if (filter === 'membership_expiring') {
      conditions.push(`m.status = 'ACTIVE' AND m.start_date <= ${BUSINESS_DATE_SQL}
        AND m.end_date BETWEEN ${BUSINESS_DATE_SQL}
        AND DATE_ADD(${BUSINESS_DATE_SQL}, INTERVAL 7 DAY)`);
    }
    if (search) {
      conditions.push(`(
        CAST(c.id_customer AS CHAR) LIKE ?
        OR CONCAT(c.first_name, ' ', c.last_name) LIKE ?
      )`);
      params.push(`%${search}%`, `%${search}%`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [countRows] = await this.db.query(`
      SELECT COUNT(*) AS total
      ${CUSTOMER_MEMBERSHIP_FROM}
      ${where}
    `, params);
    const [rows] = await this.db.query(`
      SELECT c.id_customer, c.first_name, c.last_name,
        CONCAT(c.first_name, ' ', c.last_name) AS customer_name,
        c.phone, c.status AS customer_status,
        m.id_membership, pl.plan_name,
        DATE_FORMAT(m.end_date, '%Y-%m-%d') AS membership_end_date,
        ${effectiveMembershipStatus('m')} AS membership_status
      ${CUSTOMER_MEMBERSHIP_FROM}
      ${where}
      ORDER BY c.id_customer DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);
    const total = countValue(countRows[0]?.total);
    return {
      data: rows || [],
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getCustomer(customerId) {
    const id = positiveInteger(customerId, 'id_customer');
    const [customerRows] = await this.db.query(`
      SELECT id_customer, first_name, last_name,
        CONCAT(first_name, ' ', last_name) AS customer_name,
        phone, email, status AS customer_status,
        DATE_FORMAT(registration_date, '%Y-%m-%d') AS registration_date
      FROM customers
      WHERE id_customer = ?
      LIMIT 1
    `, [id]);
    if (!customerRows?.length) throw new NotFoundException('Cliente no encontrado');

    const [membershipRows] = await this.db.query(`
      SELECT m.id_membership, m.id_plan, pl.plan_name,
        DATE_FORMAT(m.start_date, '%Y-%m-%d') AS start_date,
        DATE_FORMAT(m.end_date, '%Y-%m-%d') AS end_date,
        m.applied_price, m.status AS stored_status,
        ${effectiveMembershipStatus('m')} AS effective_status
      FROM memberships m
      JOIN membership_plans pl ON pl.id_plan = m.id_plan
      WHERE m.id_customer = ?
      ORDER BY ${currentMembershipRank('m')},
        m.start_date DESC, m.id_membership DESC
      LIMIT 1
    `, [id]);

    return {
      customer: customerRows[0],
      currentMembership: membershipRows?.[0] || null,
    };
  }

  async getCustomerMemberships(customerId, query = {}) {
    const id = positiveInteger(customerId, 'id_customer');
    validateQuery(query, ['page', 'limit']);
    const { page, limit, offset } = pagination(query);
    const [customerRows] = await this.db.query(
      'SELECT id_customer FROM customers WHERE id_customer = ? LIMIT 1',
      [id],
    );
    if (!customerRows?.length) throw new NotFoundException('Cliente no encontrado');

    const [countRows] = await this.db.query(
      'SELECT COUNT(*) AS total FROM memberships WHERE id_customer = ?',
      [id],
    );
    const [rows] = await this.db.query(`
      SELECT m.id_membership, m.id_plan, pl.plan_name,
        DATE_FORMAT(m.start_date, '%Y-%m-%d') AS start_date,
        DATE_FORMAT(m.end_date, '%Y-%m-%d') AS end_date,
        m.applied_price, m.status AS stored_status,
        ${effectiveMembershipStatus('m')} AS effective_status,
        promo.name AS promotion_name,
        application.discount_amount AS promotion_discount,
        application.final_price AS promotion_final_price,
        DATE_FORMAT(application.applied_at - INTERVAL 4 HOUR, '%Y-%m-%d %H:%i') AS promotion_applied_at
      FROM memberships m
      JOIN membership_plans pl ON pl.id_plan = m.id_plan
      LEFT JOIN erp_promotion_applications application
        ON application.id_membership = m.id_membership
      LEFT JOIN erp_promotions promo
        ON promo.id_promotion = application.id_promotion
      WHERE m.id_customer = ?
      ORDER BY m.start_date DESC, m.id_membership DESC
      LIMIT ? OFFSET ?
    `, [id, limit, offset]);
    const total = countValue(countRows[0]?.total);
    return {
      data: rows || [],
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getMembershipPlans(query = {}) {
    validateQuery(query, ['page', 'limit', 'search', 'status']);
    const { page, limit, offset } = pagination(query);
    const search = searchValue(query.search);
    const conditions = [];
    const params = [];
    if (query.status !== undefined && query.status !== '') {
      const status = String(query.status).toUpperCase();
      if (!['ACTIVE', 'INACTIVE'].includes(status)) {
        throw new BadRequestException('Estado del plan inválido');
      }
      conditions.push('status = ?');
      params.push(status);
    }
    if (search) {
      conditions.push('plan_name LIKE ?');
      params.push(`%${search}%`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [countRows] = await this.db.query(
      `SELECT COUNT(*) AS total FROM membership_plans ${where}`,
      params,
    );
    const [rows] = await this.db.query(`
      SELECT id_plan, plan_name, price, duration_days, status, description
      FROM membership_plans
      ${where}
      ORDER BY plan_name ASC, id_plan ASC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);
    const total = countValue(countRows[0]?.total);
    return {
      data: rows || [],
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getExpiringMemberships(query = {}) {
    validateQuery(query, ['page', 'limit', 'search']);
    const { page, limit, offset } = pagination(query);
    const search = searchValue(query.search);
    const conditions = [
      "m.status = 'ACTIVE'",
      `m.start_date <= ${BUSINESS_DATE_SQL}`,
      `m.end_date BETWEEN ${BUSINESS_DATE_SQL}
        AND DATE_ADD(${BUSINESS_DATE_SQL}, INTERVAL 7 DAY)`,
    ];
    const params = [];
    if (search) {
      conditions.push(`(
        CAST(c.id_customer AS CHAR) LIKE ?
        OR CONCAT(c.first_name, ' ', c.last_name) LIKE ?
      )`);
      params.push(`%${search}%`, `%${search}%`);
    }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const from = `
      FROM memberships m
      JOIN customers c ON c.id_customer = m.id_customer
      JOIN membership_plans pl ON pl.id_plan = m.id_plan
      ${where}
    `;
    const [countRows] = await this.db.query(`SELECT COUNT(*) AS total ${from}`, params);
    const [rows] = await this.db.query(`
      SELECT m.id_membership, c.id_customer,
        CONCAT(c.first_name, ' ', c.last_name) AS customer_name,
        c.phone, pl.plan_name,
        DATE_FORMAT(m.end_date, '%Y-%m-%d') AS end_date,
        DATEDIFF(m.end_date, ${BUSINESS_DATE_SQL}) AS days_remaining,
        ${effectiveMembershipStatus('m')} AS membership_status
      ${from}
      ORDER BY m.end_date ASC, c.id_customer ASC, m.id_membership ASC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);
    const total = countValue(countRows[0]?.total);
    return {
      data: rows || [],
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getRenewals(query = {}) {
    validateQuery(query, ['page', 'limit', 'search', 'status']);
    const { page, limit, offset } = pagination(query);
    const search = searchValue(query.search);
    const conditions = [];
    const params = [];
    if (query.status !== undefined && query.status !== '') {
      const status = String(query.status).toUpperCase();
      if (!RENEWAL_STATUSES.has(status)) {
        throw new BadRequestException('Estado de renovación inválido');
      }
      conditions.push('r.status = ?');
      params.push(status);
    }
    if (search) {
      conditions.push(`(
        CAST(c.id_customer AS CHAR) LIKE ?
        OR CONCAT(c.first_name, ' ', c.last_name) LIKE ?
        OR CAST(r.id_previous_membership AS CHAR) LIKE ?
        OR CAST(r.id_new_membership AS CHAR) LIKE ?
      )`);
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const from = `
      FROM erp_renewal_requests r
      JOIN customers c ON c.id_customer = r.id_customer
      JOIN memberships previous ON previous.id_membership = r.id_previous_membership
      JOIN membership_plans previous_plan ON previous_plan.id_plan = previous.id_plan
      LEFT JOIN memberships newer ON newer.id_membership = r.id_new_membership
      LEFT JOIN membership_plans next_plan ON next_plan.id_plan = newer.id_plan
      ${where}
    `;
    const [countRows] = await this.db.query(
      `SELECT COUNT(*) AS total ${from}`,
      params,
    );
    const [rows] = await this.db.query(`
      SELECT r.id_renewal_request, r.id_customer,
        CONCAT(c.first_name, ' ', c.last_name) AS customer_name,
        r.id_previous_membership, r.id_new_membership,
        COALESCE(next_plan.plan_name, previous_plan.plan_name) AS plan_name,
        DATE_FORMAT(r.requested_at - INTERVAL 4 HOUR, '%Y-%m-%d %H:%i') AS requested_at,
        DATE_FORMAT(r.completed_at - INTERVAL 4 HOUR, '%Y-%m-%d %H:%i') AS completed_at,
        r.status
      ${from}
      ORDER BY r.requested_at DESC, r.id_renewal_request DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);
    const total = countValue(countRows[0]?.total);
    return {
      data: rows || [],
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getDashboard() {
    const viewMetadata = await this.inspectViews();
    const viewColumns = viewMetadata.columns;
    const { business_date: today, month_start: monthStart } = await this.getToday();
    const [
      customerRow,
      membershipRow,
      renewalCount,
      paymentRow,
      financialRow,
      attendanceRow,
      financeChart,
      membershipChart,
      attendanceChart,
    ] = await Promise.all([
      this.getCustomerMetrics(monthStart, today),
      this.getMembershipMetrics(today),
      this.getRenewalCount(monthStart, today),
      this.getPaymentCounts(monthStart, today),
      this.getFinancialTotals(today, monthStart),
      this.getAttendanceMetrics(today, monthStart),
      this.getFinanceChart(viewColumns, monthStart, today),
      this.getMembershipChart(
        viewColumns,
        today,
        viewMetadata.definitions.get(VIEWS.membership.name),
      ),
      this.getAttendanceChart(viewColumns, monthStart, today),
    ]);

    const incomeMonth = decimalCents(financialRow.income_month);
    const expensesMonth = decimalCents(financialRow.expenses_month);
    const reversalsMonth = decimalCents(financialRow.reversals_month);

    const attendanceByHour = (attendanceChart || []).map((row) => ({
      hour: countValue(row.hour),
      total: countValue(row.total),
    })).filter((row) => row.hour >= 0 && row.hour <= 23);
    const peak = attendanceByHour.reduce(
      (highest, row) => row.total > (highest?.total ?? 0) ? row : highest,
      null,
    );

    return {
      period: { today, monthStart, expiringDays: 7 },
      customers: {
        total: countValue(customerRow.total),
        active: countValue(customerRow.active),
        inactive: countValue(customerRow.inactive),
        newThisMonth: countValue(customerRow.new_this_month),
      },
      memberships: {
        active: countValue(membershipRow.active),
        expired: countValue(membershipRow.expired),
        expiring: countValue(membershipRow.expiring),
        pending: countValue(membershipRow.pending),
        renewedThisMonth: countValue(renewalCount),
      },
      finances: {
        incomeToday: decimalText(decimalCents(financialRow.income_today)),
        incomeThisMonth: decimalText(incomeMonth),
        expensesThisMonth: decimalText(expensesMonth),
        netThisMonth: decimalText(incomeMonth - expensesMonth - reversalsMonth),
        validPayments: countValue(paymentRow.valid),
        cancelledPayments: countValue(paymentRow.cancelled),
      },
      attendance: {
        today: countValue(attendanceRow.today),
        thisMonth: countValue(attendanceRow.this_month),
        peakHour: peak
          ? { start: peak.hour, total: peak.total }
          : null,
      },
      charts: {
        finance: (financeChart || []).map((row) => ({
          date: String(row.date).slice(0, 10),
          income: numericValue(row.income),
          expenses: numericValue(row.expenses),
        })),
        memberships: (membershipChart || []).map((row) => ({
          status: String(row.status || '').toUpperCase(),
          total: countValue(row.total),
        })),
        attendance: attendanceByHour,
      },
    };
  }
}

module.exports = ErpDirectionService;
