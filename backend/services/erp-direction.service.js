'use strict';

const {
  HttpError,
  BadRequestException,
  NotFoundException,
} = require('../middlewares/errors');

const BUSINESS_DATE_SQL = 'DATE(UTC_TIMESTAMP() - INTERVAL 4 HOUR)';
const MAX_ID = 2147483647;
const RENEWAL_STATUSES = new Set(['REQUESTED', 'COMPLETED', 'REJECTED', 'CANCELLED']);
const PAYMENT_STATUSES = new Set(['REGISTERED', 'CANCELLED']);
const MOVEMENT_TYPES = new Set(['PAYMENT_IN', 'PAYMENT_REVERSAL', 'OTHER_IN', 'EXPENSE_OUT']);
const COMMERCIAL_PROMOTION_STATES = new Set(['ACTIVE', 'INACTIVE', 'UPCOMING', 'EXPIRED']);
const COMMERCIAL_ALERT_TYPES = new Set(['EXPIRING', 'EXPIRED', 'LOW_ATTENDANCE']);
const COMMERCIAL_ALERT_STATES = new Set(['PENDING', 'CONTACTED', 'DISMISSED']);
const COMMERCIAL_FOLLOWUP_REASONS = new Set(['EXPIRING', 'EXPIRED', 'LOW_ATTENDANCE', 'OTHER']);
const COMMERCIAL_FOLLOWUP_RESULTS = new Set([
  'PENDING', 'CONTACTED', 'RENEWAL_ACCEPTED', 'DECLINED', 'NO_RESPONSE',
]);
const MAX_FINANCE_RANGE_DAYS = 366;
const MAX_ATTENDANCE_RANGE_DAYS = 366;
const INACTIVITY_DAY_OPTIONS = new Set([7, 15, 30]);

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

function isoDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException(`${label} debe tener formato AAAA-MM-DD`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException(`${label} no es una fecha válida`);
  }
  return value;
}

function financeDateRange(query, defaults) {
  const from = query.from === undefined || query.from === ''
    ? defaults.from : isoDate(query.from, 'from');
  const to = query.to === undefined || query.to === ''
    ? defaults.to : isoDate(query.to, 'to');
  if (from > to) throw new BadRequestException('La fecha inicial no puede superar la final');
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000;
  if (days >= MAX_FINANCE_RANGE_DAYS) {
    throw new BadRequestException(`El período máximo es de ${MAX_FINANCE_RANGE_DAYS} días`);
  }
  return { from, to };
}

function optionalDateRange(query, maxDays) {
  const from = query.from === undefined || query.from === ''
    ? null : isoDate(query.from, 'from');
  const to = query.to === undefined || query.to === ''
    ? null : isoDate(query.to, 'to');
  if (from && to && from > to) {
    throw new BadRequestException('La fecha inicial no puede superar la final');
  }
  if (from && to) {
    const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000;
    if (days >= maxDays) {
      throw new BadRequestException(`El período máximo es de ${maxDays} días`);
    }
  }
  return { from, to };
}

function optionalFinanceDateRange(query) {
  return optionalDateRange(query, MAX_FINANCE_RANGE_DAYS);
}

function optionalAttendanceDateRange(query) {
  return optionalDateRange(query, MAX_ATTENDANCE_RANGE_DAYS);
}

function dateRange(query, defaults) {
  const from = query.from === undefined || query.from === ''
    ? defaults.from : isoDate(query.from, 'from');
  const to = query.to === undefined || query.to === ''
    ? defaults.to : isoDate(query.to, 'to');
  if (from > to) throw new BadRequestException('La fecha inicial no puede superar la final');
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000;
  if (days >= MAX_ATTENDANCE_RANGE_DAYS) {
    throw new BadRequestException(`El período máximo es de ${MAX_ATTENDANCE_RANGE_DAYS} días`);
  }
  return { from, to };
}

function addCalendarDays(value, days) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function mondayOf(value) {
  const date = new Date(`${value}T00:00:00.000Z`);
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  return addCalendarDays(value, -daysSinceMonday);
}

function calendarDayDifference(from, to) {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000;
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

const PAYMENT_FROM = `
  FROM payments p
  JOIN memberships m ON m.id_membership = p.id_membership
  JOIN customers c ON c.id_customer = m.id_customer
  JOIN membership_plans pl ON pl.id_plan = m.id_plan
  JOIN payment_methods pm ON pm.id_payment_method = p.id_payment_method
`;

const MOVEMENT_FROM = `
  FROM erp_cash_movements m
  JOIN payment_methods pm ON pm.id_payment_method = m.id_payment_method
  JOIN users registered_user ON registered_user.id_user = m.registered_by
  LEFT JOIN erp_financial_entries e ON e.id_financial_entry = m.id_financial_entry
  LEFT JOIN payments p ON p.id_payment = m.id_payment
  LEFT JOIN memberships ms ON ms.id_membership = p.id_membership
  LEFT JOIN customers c ON c.id_customer = ms.id_customer
  LEFT JOIN membership_plans pl ON pl.id_plan = ms.id_plan
`;

function movementSelect(where, limitParameter = true) {
  return `
    SELECT m.id_cash_movement, m.business_date, m.movement_kind, m.amount,
      m.id_payment, m.id_financial_entry, m.id_payment_method,
      pm.name AS payment_method, m.is_cash, m.registered_by,
      registered_user.username AS registered_by_name, m.registered_at, m.notes,
      e.entry_type, e.category, e.concept,
      p.status AS payment_status, p.id_membership, ms.id_customer,
      CONCAT(c.first_name, ' ', c.last_name) AS customer_name, pl.plan_name,
      CASE
        WHEN e.id_financial_entry IS NOT NULL THEN e.concept
        WHEN p.id_payment IS NOT NULL THEN CONCAT('Membresía: ', pl.plan_name)
        ELSE NULL
      END AS description
    ${MOVEMENT_FROM}
    ${where}
    ORDER BY m.business_date DESC, m.id_cash_movement DESC
    ${limitParameter ? 'LIMIT ? OFFSET ?' : ''}
  `;
}

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

  async getFinancialSummary(query = {}) {
    validateQuery(query, ['from', 'to']);
    const today = await this.getToday();
    const range = financeDateRange(query, {
      from: today.month_start,
      to: today.business_date,
    });
    const [
      financialRow,
      paymentRow,
      movementRows,
      closureRows,
    ] = await Promise.all([
      this.getFinancialTotals(range.to, range.from),
      this.getPaymentCounts(range.from, range.to),
      this.db.query(`
        SELECT COUNT(*) AS total
        FROM erp_cash_movements
        WHERE business_date BETWEEN ? AND ?
      `, [range.from, range.to]),
      this.db.query(`
        SELECT COUNT(*) AS total
        FROM erp_cash_closures
        WHERE business_date BETWEEN ? AND ?
      `, [range.from, range.to]),
    ]);

    const income = decimalCents(financialRow.income_month);
    const expenses = decimalCents(financialRow.expenses_month);
    const reversals = decimalCents(financialRow.reversals_month);
    return {
      ...range,
      totals: {
        income: decimalText(income),
        expenses: decimalText(expenses),
        reversals: decimalText(reversals),
        net: decimalText(income - expenses - reversals),
        validPayments: countValue(paymentRow.valid),
        cancelledPayments: countValue(paymentRow.cancelled),
        movements: countValue(movementRows[0]?.[0]?.total),
        closures: countValue(closureRows[0]?.[0]?.total),
      },
    };
  }

  async listDirectionPayments(query = {}) {
    validateQuery(query, ['page', 'limit', 'search', 'status', 'from', 'to']);
    const { page, limit, offset } = pagination(query);
    const search = searchValue(query.search);
    const conditions = [];
    const params = [];
    if (query.status !== undefined && query.status !== '') {
      if (!PAYMENT_STATUSES.has(query.status)) {
        throw new BadRequestException('Estado de pago inválido');
      }
      conditions.push('p.status = ?');
      params.push(query.status);
    }
    if (query.from !== undefined && query.from !== '') {
      conditions.push("p.payment_date >= DATE_ADD(CONCAT(?, ' 00:00:00'), INTERVAL 4 HOUR)");
      params.push(isoDate(query.from, 'from'));
    }
    if (query.to !== undefined && query.to !== '') {
      conditions.push("p.payment_date < DATE_ADD(CONCAT(?, ' 00:00:00'), INTERVAL 28 HOUR)");
      params.push(isoDate(query.to, 'to'));
    }
    if (query.from && query.to && query.from > query.to) {
      throw new BadRequestException('La fecha inicial no puede superar la final');
    }
    if (search) {
      conditions.push(`(
        CAST(p.id_payment AS CHAR) LIKE ?
        OR CAST(m.id_customer AS CHAR) LIKE ?
        OR CAST(p.id_membership AS CHAR) LIKE ?
        OR CONCAT(c.first_name, ' ', c.last_name) LIKE ?
      )`);
      params.push(...Array(4).fill(`%${search}%`));
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [countRows] = await this.db.query(`
      SELECT COUNT(*) AS total ${PAYMENT_FROM} ${where}
    `, params);
    const [rows] = await this.db.query(`
      SELECT p.id_payment, p.id_membership, m.id_customer,
        CONCAT(c.first_name, ' ', c.last_name) AS customer_name,
        pl.plan_name, p.amount,
        DATE_FORMAT(p.payment_date - INTERVAL 4 HOUR, '%Y-%m-%d %H:%i:%s') AS payment_date,
        p.status, pm.name AS payment_method
      ${PAYMENT_FROM}
      ${where}
      ORDER BY p.payment_date DESC, p.id_payment DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);
    const total = countValue(countRows[0]?.total);
    return { data: rows || [], total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getDirectionPayment(paymentId) {
    const id = positiveInteger(paymentId, 'id_payment');
    const [rows] = await this.db.query(`
      SELECT p.id_payment, p.id_membership, m.id_customer,
        CONCAT(c.first_name, ' ', c.last_name) AS customer_name,
        pl.plan_name, p.id_user, u.username AS registered_by,
        p.id_payment_method, pm.name AS payment_method, p.amount,
        DATE_FORMAT(p.payment_date - INTERVAL 4 HOUR, '%Y-%m-%d %H:%i:%s') AS payment_date,
        p.status, p.notes, cancellation.reason AS cancellation_reason,
        DATE_FORMAT(cancellation.cancelled_at - INTERVAL 4 HOUR, '%Y-%m-%d %H:%i:%s') AS cancelled_at,
        cancellation_user.username AS cancelled_by
      ${PAYMENT_FROM}
      JOIN users u ON u.id_user = p.id_user
      LEFT JOIN erp_payment_cancellations cancellation
        ON cancellation.id_payment = p.id_payment
      LEFT JOIN users cancellation_user
        ON cancellation_user.id_user = cancellation.cancelled_by
      WHERE p.id_payment = ?
      LIMIT 1
    `, [id]);
    if (!rows?.length) throw new NotFoundException('Pago no encontrado');
    return rows[0];
  }

  async listPaymentCancellations(query = {}) {
    validateQuery(query, ['page', 'limit', 'search', 'from', 'to']);
    const { page, limit, offset } = pagination(query);
    const search = searchValue(query.search);
    const conditions = [];
    const params = [];
    if (query.from !== undefined && query.from !== '') {
      conditions.push("cancellation.cancelled_at >= DATE_ADD(CONCAT(?, ' 00:00:00'), INTERVAL 4 HOUR)");
      params.push(isoDate(query.from, 'from'));
    }
    if (query.to !== undefined && query.to !== '') {
      conditions.push("cancellation.cancelled_at < DATE_ADD(CONCAT(?, ' 00:00:00'), INTERVAL 28 HOUR)");
      params.push(isoDate(query.to, 'to'));
    }
    if (query.from && query.to && query.from > query.to) {
      throw new BadRequestException('La fecha inicial no puede superar la final');
    }
    if (search) {
      conditions.push(`(
        CAST(p.id_payment AS CHAR) LIKE ?
        OR CAST(m.id_customer AS CHAR) LIKE ?
        OR CONCAT(c.first_name, ' ', c.last_name) LIKE ?
      )`);
      params.push(...Array(3).fill(`%${search}%`));
    }
    conditions.push("p.status = 'CANCELLED'");
    const where = `WHERE ${conditions.join(' AND ')}`;
    const from = `
      FROM erp_payment_cancellations cancellation
      JOIN payments p ON p.id_payment = cancellation.id_payment
      JOIN memberships m ON m.id_membership = p.id_membership
      JOIN customers c ON c.id_customer = m.id_customer
      JOIN payment_methods pm ON pm.id_payment_method = p.id_payment_method
      JOIN users cancelled_user ON cancelled_user.id_user = cancellation.cancelled_by
      ${where}
    `;
    const [countRows] = await this.db.query(`SELECT COUNT(*) AS total ${from}`, params);
    const [rows] = await this.db.query(`
      SELECT p.id_payment, c.id_customer,
        CONCAT(c.first_name, ' ', c.last_name) AS customer_name,
        p.amount AS original_amount,
        DATE_FORMAT(p.payment_date - INTERVAL 4 HOUR, '%Y-%m-%d %H:%i:%s') AS payment_date,
        DATE_FORMAT(cancellation.cancelled_at - INTERVAL 4 HOUR, '%Y-%m-%d %H:%i:%s') AS cancelled_at,
        cancellation.reason, cancelled_user.username AS cancelled_by,
        pm.name AS payment_method, p.status
      ${from}
      ORDER BY cancellation.cancelled_at DESC, cancellation.id_cancellation DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);
    const total = countValue(countRows[0]?.total);
    return { data: rows || [], total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async listFinancialEntries(query = {}) {
    validateQuery(query, ['page', 'limit', 'search', 'group', 'from', 'to', 'id_payment_method']);
    const { page, limit, offset } = pagination(query);
    const search = searchValue(query.search);
    const group = query.group === undefined || query.group === '' ? 'all' : query.group;
    if (!['all', 'income', 'expense'].includes(group)) {
      throw new BadRequestException('Tipo de registro financiero inválido');
    }
    const conditions = [];
    const params = [];
    const range = optionalFinanceDateRange(query);
    if (range.from) { conditions.push('m.business_date >= ?'); params.push(range.from); }
    if (range.to) { conditions.push('m.business_date <= ?'); params.push(range.to); }
    if (group === 'income') conditions.push("m.movement_kind IN ('PAYMENT_IN', 'OTHER_IN')");
    if (group === 'expense') conditions.push("m.movement_kind = 'EXPENSE_OUT'");
    if (query.id_payment_method) {
      conditions.push('m.id_payment_method = ?');
      params.push(positiveInteger(query.id_payment_method, 'id_payment_method'));
    }
    if (search) {
      conditions.push(`(
        CAST(m.id_cash_movement AS CHAR) LIKE ?
        OR CAST(m.id_payment AS CHAR) LIKE ?
        OR CAST(m.id_financial_entry AS CHAR) LIKE ?
        OR CAST(c.id_customer AS CHAR) LIKE ?
        OR CONCAT(c.first_name, ' ', c.last_name) LIKE ?
        OR COALESCE(e.concept, '') LIKE ?
        OR COALESCE(e.category, '') LIKE ?
        OR COALESCE(m.notes, '') LIKE ?
      )`);
      params.push(...Array(8).fill(`%${search}%`));
    }
    return this.queryFinancialMovements(conditions, params, page, limit, offset);
  }

  async listFinancialMovements(query = {}) {
    validateQuery(query, [
      'page', 'limit', 'search', 'movement_kind', 'id_payment_method', 'from', 'to',
    ]);
    const { page, limit, offset } = pagination(query);
    const search = searchValue(query.search);
    const conditions = [];
    const params = [];
    const range = optionalFinanceDateRange(query);
    if (range.from) { conditions.push('m.business_date >= ?'); params.push(range.from); }
    if (range.to) { conditions.push('m.business_date <= ?'); params.push(range.to); }
    if (query.movement_kind) {
      if (!MOVEMENT_TYPES.has(query.movement_kind)) {
        throw new BadRequestException('Tipo de movimiento inválido');
      }
      conditions.push('m.movement_kind = ?');
      params.push(query.movement_kind);
    }
    if (query.id_payment_method) {
      conditions.push('m.id_payment_method = ?');
      params.push(positiveInteger(query.id_payment_method, 'id_payment_method'));
    }
    if (search) {
      conditions.push(`(
        CAST(m.id_cash_movement AS CHAR) LIKE ?
        OR CAST(m.id_payment AS CHAR) LIKE ?
        OR CAST(m.id_financial_entry AS CHAR) LIKE ?
        OR CAST(c.id_customer AS CHAR) LIKE ?
        OR CONCAT(c.first_name, ' ', c.last_name) LIKE ?
        OR COALESCE(e.concept, '') LIKE ?
        OR COALESCE(e.category, '') LIKE ?
        OR COALESCE(m.notes, '') LIKE ?
      )`);
      params.push(...Array(8).fill(`%${search}%`));
    }
    return this.queryFinancialMovements(conditions, params, page, limit, offset);
  }

  async queryFinancialMovements(conditions, params, page, limit, offset) {
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [countRows] = await this.db.query(`
      SELECT COUNT(DISTINCT m.id_cash_movement) AS total
      ${MOVEMENT_FROM}
      ${where}
    `, params);
    const [rows] = await this.db.query(
      movementSelect(where),
      [...params, limit, offset],
    );
    const total = countValue(countRows[0]?.total);
    return { data: rows || [], total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getFinancialMovement(movementId) {
    const id = positiveInteger(movementId, 'id_cash_movement');
    const [rows] = await this.db.query(
      movementSelect('WHERE m.id_cash_movement = ?', false),
      [id],
    );
    if (!rows?.length) throw new NotFoundException('Movimiento financiero no encontrado');
    return rows[0];
  }

  async getPaymentMethodSummary(query = {}) {
    validateQuery(query, ['from', 'to']);
    const today = await this.getToday();
    const range = financeDateRange(query, {
      from: today.month_start,
      to: today.business_date,
    });
    const [rows] = await this.db.query(`
      SELECT pm.id_payment_method, pm.name AS payment_method,
        COUNT(p.id_payment) AS payment_count,
        COALESCE(SUM(p.amount), 0) AS total_amount
      FROM payment_methods pm
      LEFT JOIN payments p
        ON p.id_payment_method = pm.id_payment_method
        AND p.status = 'REGISTERED'
        AND DATE(p.payment_date - INTERVAL 4 HOUR) BETWEEN ? AND ?
      GROUP BY pm.id_payment_method, pm.name
      ORDER BY pm.name, pm.id_payment_method
    `, [range.from, range.to]);
    return { ...range, data: rows || [] };
  }

  async listCashClosures(query = {}) {
    validateQuery(query, ['page', 'limit', 'from', 'to', 'difference']);
    const { page, limit, offset } = pagination(query);
    const conditions = [];
    const params = [];
    const range = optionalFinanceDateRange(query);
    if (range.from) { conditions.push('cl.business_date >= ?'); params.push(range.from); }
    if (range.to) { conditions.push('cl.business_date <= ?'); params.push(range.to); }
    const difference = query.difference || 'all';
    const differenceConditions = {
      all: '',
      with_difference: 'cl.difference_cash <> 0',
      without_difference: 'cl.difference_cash = 0',
      shortage: 'cl.difference_cash < 0',
      surplus: 'cl.difference_cash > 0',
      without_count: 'cl.difference_cash IS NULL',
    };
    if (!Object.prototype.hasOwnProperty.call(differenceConditions, difference)) {
      throw new BadRequestException('Filtro de diferencias inválido');
    }
    if (differenceConditions[difference]) conditions.push(differenceConditions[difference]);
    return this.queryCashClosures(conditions, params, page, limit, offset);
  }

  async queryCashClosures(conditions, params, page, limit, offset) {
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const from = `FROM erp_cash_closures cl JOIN users closed_user ON closed_user.id_user = cl.closed_by ${where}`;
    const [countRows] = await this.db.query(`SELECT COUNT(*) AS total ${from}`, params);
    const [rows] = await this.db.query(`
      SELECT cl.id_cash_closure, cl.business_date, cl.opening_cash,
        cl.total_income, cl.total_expenses, cl.total_reversals,
        cl.expected_cash, cl.counted_cash, cl.difference_cash,
        cl.closed_by, closed_user.username AS closed_by_name, cl.closed_at, cl.notes,
        CASE
          WHEN cl.difference_cash IS NULL THEN 'WITHOUT_COUNT'
          WHEN cl.difference_cash = 0 THEN 'BALANCED'
          WHEN cl.difference_cash < 0 THEN 'SHORTAGE'
          ELSE 'SURPLUS'
        END AS difference_status
      ${from}
      ORDER BY cl.business_date DESC, cl.id_cash_closure DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);
    const total = countValue(countRows[0]?.total);
    return { data: rows || [], total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getCashClosure(closureId) {
    const id = positiveInteger(closureId, 'id_cash_closure');
    const [rows] = await this.db.query(`
      SELECT cl.id_cash_closure, cl.business_date, cl.opening_cash,
        cl.total_income, cl.total_expenses, cl.total_reversals,
        cl.expected_cash, cl.counted_cash, cl.difference_cash,
        cl.closed_by, closed_user.username AS closed_by_name, cl.closed_at, cl.notes,
        CASE
          WHEN cl.difference_cash IS NULL THEN 'WITHOUT_COUNT'
          WHEN cl.difference_cash = 0 THEN 'BALANCED'
          WHEN cl.difference_cash < 0 THEN 'SHORTAGE'
          ELSE 'SURPLUS'
        END AS difference_status
      FROM erp_cash_closures cl
      JOIN users closed_user ON closed_user.id_user = cl.closed_by
      WHERE cl.id_cash_closure = ?
      LIMIT 1
    `, [id]);
    if (!rows?.length) throw new NotFoundException('Cierre de caja no encontrado');
    return rows[0];
  }

  async inspectAttendanceView() {
    const [views] = await this.db.query(`
      SELECT TABLE_NAME, VIEW_DEFINITION
      FROM INFORMATION_SCHEMA.VIEWS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
    `, [VIEWS.attendance.name]);
    const definition = views?.find((view) => view.TABLE_NAME === VIEWS.attendance.name)
      ?.VIEW_DEFINITION;
    assertViewDefinition(VIEWS.attendance, definition);

    const [columns] = await this.db.query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION
    `, [VIEWS.attendance.name]);
    if (!columns?.length) {
      throw new DashboardUnavailableError(
        `No se pudieron verificar las columnas de ${VIEWS.attendance.name}.`,
      );
    }
    return new Map([[VIEWS.attendance.name, columns]]);
  }

  async getAttendanceHourly(query = {}) {
    validateQuery(query, ['from', 'to']);
    optionalAttendanceDateRange(query);
    const today = await this.getToday();
    const range = dateRange(query, {
      from: today.month_start,
      to: today.business_date,
    });
    const columns = await this.inspectAttendanceView();
    const rows = await this.getAttendanceChart(columns, range.from, range.to);
    const data = (rows || []).map((row) => ({
      hour: countValue(row.hour),
      total: countValue(row.total),
    })).filter((row) => row.hour >= 0 && row.hour <= 23)
      .sort((left, right) => left.hour - right.hour);
    return { ...range, data };
  }

  async getAttendanceSummary(query = {}) {
    validateQuery(query, ['from', 'to']);
    optionalAttendanceDateRange(query);
    const today = await this.getToday();
    const range = dateRange(query, {
      from: today.month_start,
      to: today.business_date,
    });
    const weekStart = mondayOf(today.business_date);
    const weekEnd = addCalendarDays(weekStart, 6);
    const columns = await this.inspectAttendanceView();
    const [
      [metricRows],
      [periodRows],
      [dailyRows],
      hourlyRows,
    ] = await Promise.all([
      this.db.query(`
        SELECT
          COALESCE(SUM(attendance_date = ?), 0) AS today,
          COALESCE(SUM(attendance_date BETWEEN ? AND ?), 0) AS this_week,
          COALESCE(SUM(attendance_date BETWEEN ? AND ?), 0) AS this_month
        FROM customer_attendances
      `, [today.business_date, weekStart, weekEnd, today.month_start, today.business_date]),
      this.db.query(`
        SELECT COUNT(*) AS total, COUNT(DISTINCT id_customer) AS unique_customers
        FROM customer_attendances
        WHERE attendance_date BETWEEN ? AND ?
      `, [range.from, range.to]),
      this.db.query(`
        SELECT attendance_date AS date, COUNT(*) AS total
        FROM customer_attendances
        WHERE attendance_date BETWEEN ? AND ?
        GROUP BY attendance_date
        ORDER BY attendance_date
      `, [range.from, range.to]),
      this.getAttendanceChart(columns, range.from, range.to),
    ]);

    const period = periodRows?.[0] || {};
    const total = countValue(period.total);
    const calendarDays = calendarDayDifference(range.from, range.to) + 1;
    const hourly = (hourlyRows || []).map((row) => ({
      hour: countValue(row.hour),
      total: countValue(row.total),
    })).filter((row) => row.hour >= 0 && row.hour <= 23)
      .sort((left, right) => left.hour - right.hour);
    const peakHour = hourly.reduce(
      (highest, row) => row.total > (highest?.total ?? 0) ? row : highest,
      null,
    );

    return {
      today: countValue(metricRows?.[0]?.today),
      week: {
        from: weekStart,
        to: weekEnd,
        total: countValue(metricRows?.[0]?.this_week),
      },
      month: {
        from: today.month_start,
        to: today.business_date,
        total: countValue(metricRows?.[0]?.this_month),
      },
      period: {
        ...range,
        total,
        uniqueCustomers: countValue(period.unique_customers),
        calendarDays,
        averagePerCalendarDay: Number((total / calendarDays).toFixed(2)),
      },
      peakHour,
      daily: (dailyRows || []).map((row) => ({
        date: String(row.date).slice(0, 10),
        total: countValue(row.total),
      })),
      hourly,
    };
  }

  async getAttendanceRecords(query = {}) {
    validateQuery(query, ['from', 'to', 'page', 'limit', 'search', 'id_customer']);
    const { page, limit, offset } = pagination(query);
    const search = searchValue(query.search);
    const idCustomer = query.id_customer === undefined || query.id_customer === ''
      ? null : positiveInteger(query.id_customer, 'id_customer');
    optionalAttendanceDateRange(query);
    const today = await this.getToday();
    const range = dateRange(query, {
      from: today.month_start,
      to: today.business_date,
    });
    const conditions = ['a.attendance_date BETWEEN ? AND ?'];
    const params = [range.from, range.to];
    if (idCustomer !== null) {
      conditions.push('a.id_customer = ?');
      params.push(idCustomer);
    }
    if (search) {
      conditions.push(`(
        CAST(a.id_customer AS CHAR) LIKE ?
        OR CONCAT(c.first_name, ' ', c.last_name) LIKE ?
      )`);
      params.push(`%${search}%`, `%${search}%`);
    }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const [countRows] = await this.db.query(`
      SELECT COUNT(*) AS total
      FROM customer_attendances a
      INNER JOIN customers c ON c.id_customer = a.id_customer
      ${where}
    `, params);
    const [rows] = await this.db.query(`
      SELECT
        a.id_attendance,
        a.attendance_date,
        a.entry_time,
        a.id_customer,
        CONCAT(c.first_name, ' ', c.last_name) AS customer_name
      FROM customer_attendances a
      INNER JOIN customers c ON c.id_customer = a.id_customer
      ${where}
      ORDER BY a.attendance_date DESC, a.entry_time DESC, a.id_attendance DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);
    const total = countValue(countRows?.[0]?.total);
    return { data: rows || [], total, page, limit, totalPages: Math.ceil(total / limit), ...range };
  }

  async getAttendanceCustomers(query = {}) {
    validateQuery(query, ['search']);
    const search = searchValue(query.search);
    if (!search) return { data: [] };
    const pattern = `%${search}%`;
    const [rows] = await this.db.query(`
      SELECT
        id_customer,
        CONCAT(first_name, ' ', last_name) AS customer_name,
        status AS customer_status
      FROM customers
      WHERE CAST(id_customer AS CHAR) LIKE ?
        OR CONCAT(first_name, ' ', last_name) LIKE ?
      ORDER BY first_name, last_name, id_customer
      LIMIT 20
    `, [pattern, pattern]);
    return { data: rows || [] };
  }

  async getCustomerAttendance(customerId, query = {}) {
    validateQuery(query, ['from', 'to', 'page', 'limit']);
    const id = positiveInteger(customerId, 'id');
    const { page, limit, offset } = pagination(query);
    optionalAttendanceDateRange(query);
    const today = await this.getToday();
    const range = dateRange(query, {
      from: today.month_start,
      to: today.business_date,
    });
    const [customerRows] = await this.db.query(`
      SELECT
        id_customer,
        CONCAT(first_name, ' ', last_name) AS customer_name,
        status AS customer_status
      FROM customers
      WHERE id_customer = ?
      LIMIT 1
    `, [id]);
    if (!customerRows?.length) throw new NotFoundException('Cliente no encontrado');

    const [summaryRows] = await this.db.query(`
      SELECT COUNT(*) AS total, MAX(attendance_date) AS last_attendance_date
      FROM customer_attendances
      WHERE id_customer = ?
        AND attendance_date BETWEEN ? AND ?
    `, [id, range.from, range.to]);
    const [rows] = await this.db.query(`
      SELECT id_attendance, attendance_date, entry_time
      FROM customer_attendances
      WHERE id_customer = ?
        AND attendance_date BETWEEN ? AND ?
      ORDER BY attendance_date DESC, entry_time DESC, id_attendance DESC
      LIMIT ? OFFSET ?
    `, [id, range.from, range.to, limit, offset]);
    const total = countValue(summaryRows?.[0]?.total);
    return {
      customer: customerRows[0],
      ...range,
      summary: {
        total,
        lastAttendanceDate: summaryRows?.[0]?.last_attendance_date || null,
      },
      data: rows || [],
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getInactiveCustomers(query = {}) {
    validateQuery(query, ['days', 'page', 'limit', 'search']);
    const days = positiveInteger(query.days, 'days', 7, 30);
    if (!INACTIVITY_DAY_OPTIONS.has(days)) {
      throw new BadRequestException('El período de inactividad debe ser 7, 15 o 30 días');
    }
    const { page, limit, offset } = pagination(query);
    const search = searchValue(query.search);
    const { business_date: today } = await this.getToday();
    // The activity view uses a configurable threshold and mixes account and membership state.
    // This report applies the requested threshold only to active customers with a current membership.
    const searchCondition = search
      ? `AND (
          CAST(c.id_customer AS CHAR) LIKE ?
          OR CONCAT(c.first_name, ' ', c.last_name) LIKE ?
        )`
      : '';
    const baseSql = `
      FROM customers c
      INNER JOIN memberships m ON m.id_membership = (
        SELECT current_m.id_membership
        FROM memberships current_m
        WHERE current_m.id_customer = c.id_customer
          AND current_m.status = 'ACTIVE'
          AND current_m.start_date <= ?
          AND current_m.end_date >= ?
        ORDER BY current_m.start_date DESC, current_m.id_membership DESC
        LIMIT 1
      )
      INNER JOIN membership_plans p ON p.id_plan = m.id_plan
      LEFT JOIN (
        SELECT id_customer, MAX(attendance_date) AS last_attendance_date
        FROM customer_attendances
        WHERE attendance_date <= ?
        GROUP BY id_customer
      ) latest ON latest.id_customer = c.id_customer
      WHERE c.status = 'ACTIVE'
        AND DATEDIFF(
          ?,
          GREATEST(COALESCE(latest.last_attendance_date, m.start_date), m.start_date)
        ) >= ?
        ${searchCondition}
    `;
    const params = [today, today, today, today, days];
    if (search) params.push(`%${search}%`, `%${search}%`);
    const [countRows] = await this.db.query(`
      SELECT COUNT(*) AS total
      ${baseSql}
    `, params);
    const [rows] = await this.db.query(`
      SELECT
        c.id_customer,
        CONCAT(c.first_name, ' ', c.last_name) AS customer_name,
        p.plan_name,
        m.start_date AS membership_start_date,
        m.end_date AS membership_end_date,
        latest.last_attendance_date
      ${baseSql}
      ORDER BY latest.last_attendance_date IS NULL DESC,
        latest.last_attendance_date ASC, c.first_name, c.last_name, c.id_customer
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);
    const total = countValue(countRows?.[0]?.total);
    return {
      days,
      data: (rows || []).map((row) => ({
        ...row,
        daysSinceLastAttendance: row.last_attendance_date
          ? calendarDayDifference(String(row.last_attendance_date).slice(0, 10), today)
          : null,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      asOf: today,
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

  async getCommercialSummary(query = {}) {
    validateQuery(query, ['from', 'to']);
    const defaults = await this.getToday();
    const { from, to } = dateRange(query, {
      from: defaults.month_start,
      to: defaults.business_date,
    });
    const [membershipRows] = await this.db.query(`
      SELECT COUNT(*) AS membership_count,
        COALESCE(SUM(m.applied_price), 0) AS recorded_value
      FROM memberships m
      WHERE COALESCE(m.status, '') <> 'CANCELLED'
        AND DATE(m.creationDate - INTERVAL 4 HOUR) BETWEEN ? AND ?
    `, [from, to]);
    const [planRows] = await this.db.query(`
      SELECT m.id_plan, pl.plan_name, COUNT(*) AS membership_count,
        COALESCE(SUM(m.applied_price), 0) AS recorded_value
      FROM memberships m
      JOIN membership_plans pl ON pl.id_plan = m.id_plan
      WHERE COALESCE(m.status, '') <> 'CANCELLED'
        AND DATE(m.creationDate - INTERVAL 4 HOUR) BETWEEN ? AND ?
      GROUP BY m.id_plan, pl.plan_name
      ORDER BY membership_count DESC, recorded_value DESC, pl.plan_name
    `, [from, to]);
    const [paymentRows] = await this.db.query(`
      SELECT
        COALESCE(SUM(p.status = 'REGISTERED'), 0) AS valid_count,
        COALESCE(SUM(p.status = 'CANCELLED'), 0) AS cancelled_count,
        COALESCE(SUM(CASE WHEN p.status = 'REGISTERED' THEN p.amount ELSE 0 END), 0) AS collected
      FROM payments p
      WHERE DATE(p.payment_date - INTERVAL 4 HOUR) BETWEEN ? AND ?
    `, [from, to]);
    const [paymentChart] = await this.db.query(`
      SELECT DATE_FORMAT(DATE(p.payment_date - INTERVAL 4 HOUR), '%Y-%m-%d') AS date,
        COALESCE(SUM(CASE WHEN p.status = 'REGISTERED' THEN p.amount ELSE 0 END), 0) AS collected
      FROM payments p
      WHERE DATE(p.payment_date - INTERVAL 4 HOUR) BETWEEN ? AND ?
      GROUP BY DATE_FORMAT(DATE(p.payment_date - INTERVAL 4 HOUR), '%Y-%m-%d')
      ORDER BY date
    `, [from, to]);
    const [salesChart] = await this.db.query(`
      SELECT DATE_FORMAT(DATE(m.creationDate - INTERVAL 4 HOUR), '%Y-%m-%d') AS date,
        COALESCE(SUM(m.applied_price), 0) AS recorded_value
      FROM memberships m
      WHERE COALESCE(m.status, '') <> 'CANCELLED'
        AND DATE(m.creationDate - INTERVAL 4 HOUR) BETWEEN ? AND ?
      GROUP BY DATE_FORMAT(DATE(m.creationDate - INTERVAL 4 HOUR), '%Y-%m-%d')
      ORDER BY date
    `, [from, to]);
    const [promotionRows] = await this.db.query(`
      SELECT a.id_promotion, p.name AS promotion_name,
        COUNT(*) AS uses, COALESCE(SUM(a.discount_amount), 0) AS discounts
      FROM erp_promotion_applications a
      JOIN erp_promotions p ON p.id_promotion = a.id_promotion
      WHERE DATE(a.applied_at - INTERVAL 4 HOUR) BETWEEN ? AND ?
      GROUP BY a.id_promotion, p.name
      ORDER BY uses DESC, p.name
    `, [from, to]);
    const [renewalRows] = await this.db.query(`
      SELECT r.status, COUNT(*) AS total
      FROM erp_renewal_requests r
      WHERE DATE(r.requested_at - INTERVAL 4 HOUR) BETWEEN ? AND ?
      GROUP BY r.status
      ORDER BY r.status
    `, [from, to]);
    const [completedRows] = await this.db.query(`
      SELECT COUNT(*) AS total
      FROM erp_renewal_requests r
      WHERE r.status = 'COMPLETED'
        AND DATE(r.completed_at - INTERVAL 4 HOUR) BETWEEN ? AND ?
    `, [from, to]);
    const [alertRows] = await this.db.query(`
      SELECT al.alert_type, al.status, COUNT(*) AS total
      FROM erp_membership_alerts al
      WHERE DATE(al.created_at - INTERVAL 4 HOUR) BETWEEN ? AND ?
      GROUP BY al.alert_type, al.status
      ORDER BY al.alert_type, al.status
    `, [from, to]);
    const [followupRows] = await this.db.query(`
      SELECT f.result, COUNT(*) AS total
      FROM erp_commercial_followups f
      WHERE DATE(f.contact_date - INTERVAL 4 HOUR) BETWEEN ? AND ?
      GROUP BY f.result
      ORDER BY f.result
    `, [from, to]);

    const membership = membershipRows?.[0] || {};
    const payments = paymentRows?.[0] || {};
    return {
      from,
      to,
      sales: {
        memberships: countValue(membership.membership_count),
        recordedValue: decimalText(decimalCents(membership.recorded_value)),
        byPlan: (planRows || []).map((row) => ({
          idPlan: countValue(row.id_plan),
          planName: row.plan_name,
          memberships: countValue(row.membership_count),
          recordedValue: decimalText(decimalCents(row.recorded_value)),
        })),
      },
      payments: {
        valid: countValue(payments.valid_count),
        cancelled: countValue(payments.cancelled_count),
        collected: decimalText(decimalCents(payments.collected)),
      },
      charts: {
        salesAndCollections: [
          ...(salesChart || []).map((row) => ({
            date: String(row.date).slice(0, 10),
            type: 'sales',
            amount: numericValue(row.recorded_value),
          })),
          ...(paymentChart || []).map((row) => ({
            date: String(row.date).slice(0, 10),
            type: 'collected',
            amount: numericValue(row.collected),
          })),
        ].sort((a, b) => a.date.localeCompare(b.date) || a.type.localeCompare(b.type)),
      },
      promotionsUsed: (promotionRows || []).map((row) => ({
        idPromotion: countValue(row.id_promotion),
        name: row.promotion_name,
        uses: countValue(row.uses),
        discounts: decimalText(decimalCents(row.discounts)),
      })),
      renewals: {
        completed: countValue(completedRows?.[0]?.total),
        byStatus: (renewalRows || []).map((row) => ({
          status: String(row.status || '').toUpperCase(),
          total: countValue(row.total),
        })),
      },
      alerts: (alertRows || []).map((row) => ({
        type: String(row.alert_type || '').toUpperCase(),
        status: String(row.status || '').toUpperCase(),
        total: countValue(row.total),
      })),
      followups: (followupRows || []).map((row) => ({
        result: String(row.result || '').toUpperCase(),
        total: countValue(row.total),
      })),
    };
  }

  async getCommercialPromotions(query = {}) {
    validateQuery(query, ['from', 'to', 'status', 'page', 'limit']);
    const today = await this.getToday();
    const { from, to } = dateRange(query, {
      from: today.month_start,
      to: today.business_date,
    });
    const { page, limit, offset } = pagination(query);
    const conditions = [];
    const params = [from, to, today.business_date];
    if (query.status !== undefined && query.status !== '') {
      const state = String(query.status).toUpperCase();
      if (!COMMERCIAL_PROMOTION_STATES.has(state)) {
        throw new BadRequestException('Estado de promoción inválido');
      }
      conditions.push(`CASE
        WHEN p.status <> 'ACTIVE' THEN 'INACTIVE'
        WHEN p.start_date > ? THEN 'UPCOMING'
        WHEN p.end_date < ? THEN 'EXPIRED'
        ELSE 'ACTIVE'
      END = ?`);
      params.push(today.business_date, today.business_date, state);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [countRows] = await this.db.query(`
      SELECT COUNT(*) AS total FROM erp_promotions p ${where}
    `, params.slice(3));
    const [rows] = await this.db.query(`
      SELECT p.id_promotion, p.name, p.description, p.discount_type, p.discount_value,
        DATE_FORMAT(p.start_date, '%Y-%m-%d') AS start_date,
        DATE_FORMAT(p.end_date, '%Y-%m-%d') AS end_date,
        p.status AS stored_status, pl.plan_name,
        CASE
          WHEN p.status <> 'ACTIVE' THEN 'INACTIVE'
          WHEN p.start_date > ? THEN 'UPCOMING'
          WHEN p.end_date < ? THEN 'EXPIRED'
          ELSE 'ACTIVE'
        END AS effective_status,
        COALESCE(app.uses, 0) AS uses,
        COALESCE(app.discounts, 0) AS discounts
      FROM erp_promotions p
      JOIN membership_plans pl ON pl.id_plan = p.id_plan
      LEFT JOIN (
        SELECT a.id_promotion, COUNT(*) AS uses,
          SUM(a.discount_amount) AS discounts
        FROM erp_promotion_applications a
        WHERE DATE(a.applied_at - INTERVAL 4 HOUR) BETWEEN ? AND ?
        GROUP BY a.id_promotion
      ) app ON app.id_promotion = p.id_promotion
      ${where}
      ORDER BY effective_status, p.end_date, p.name
      LIMIT ? OFFSET ?
    `, [today.business_date, today.business_date, from, to, ...params.slice(3), limit, offset]);
    return {
      from,
      to,
      page,
      limit,
      total: countValue(countRows?.[0]?.total),
      items: (rows || []).map((row) => ({
        id: countValue(row.id_promotion),
        name: row.name,
        description: row.description,
        discountType: row.discount_type,
        discountValue: numericValue(row.discount_value),
        startDate: row.start_date,
        endDate: row.end_date,
        storedStatus: row.stored_status,
        status: row.effective_status,
        planName: row.plan_name,
        uses: countValue(row.uses),
        discounts: decimalText(decimalCents(row.discounts)),
      })),
    };
  }

  async getCommercialRenewals(query = {}) {
    validateQuery(query, ['from', 'to', 'status', 'page', 'limit']);
    const today = await this.getToday();
    const { from, to } = dateRange(query, {
      from: today.month_start,
      to: today.business_date,
    });
    const { page, limit, offset } = pagination(query);
    const conditions = ['DATE(r.requested_at - INTERVAL 4 HOUR) BETWEEN ? AND ?'];
    const params = [from, to];
    if (query.status !== undefined && query.status !== '') {
      const status = String(query.status).toUpperCase();
      if (!RENEWAL_STATUSES.has(status)) throw new BadRequestException('Estado de renovación inválido');
      conditions.push('r.status = ?');
      params.push(status);
    }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const source = `FROM erp_renewal_requests r
      JOIN customers c ON c.id_customer = r.id_customer
      JOIN memberships previous ON previous.id_membership = r.id_previous_membership
      JOIN membership_plans previous_plan ON previous_plan.id_plan = previous.id_plan
      LEFT JOIN memberships newer ON newer.id_membership = r.id_new_membership
      LEFT JOIN membership_plans next_plan ON next_plan.id_plan = newer.id_plan
      ${where}`;
    const [countRows] = await this.db.query(`SELECT COUNT(*) AS total ${source}`, params);
    const [rows] = await this.db.query(`
      SELECT r.id_renewal_request, c.id_customer,
        CONCAT(c.first_name, ' ', c.last_name) AS customer_name,
        r.status, previous_plan.plan_name AS previous_plan,
        next_plan.plan_name AS new_plan,
        DATE_FORMAT(r.requested_at - INTERVAL 4 HOUR, '%Y-%m-%d %H:%i') AS requested_at,
        DATE_FORMAT(r.completed_at - INTERVAL 4 HOUR, '%Y-%m-%d %H:%i') AS completed_at
      ${source}
      ORDER BY r.requested_at DESC, r.id_renewal_request DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);
    return {
      from, to, page, limit, total: countValue(countRows?.[0]?.total),
      items: rows || [],
    };
  }

  async getCommercialAlerts(query = {}) {
    validateQuery(query, ['from', 'to', 'status', 'alert_type', 'page', 'limit']);
    const { from, to } = optionalDateRange(query, MAX_ATTENDANCE_RANGE_DAYS);
    const { page, limit, offset } = pagination(query);
    const conditions = [];
    const params = [];
    if (from) {
      conditions.push('DATE(al.created_at - INTERVAL 4 HOUR) >= ?');
      params.push(from);
    }
    if (to) {
      conditions.push('DATE(al.created_at - INTERVAL 4 HOUR) <= ?');
      params.push(to);
    }
    if (query.status !== undefined && query.status !== '') {
      const status = String(query.status).toUpperCase();
      if (!COMMERCIAL_ALERT_STATES.has(status)) throw new BadRequestException('Estado de alerta inválido');
      conditions.push('al.status = ?');
      params.push(status);
    }
    if (query.alert_type !== undefined && query.alert_type !== '') {
      const type = String(query.alert_type).toUpperCase();
      if (!COMMERCIAL_ALERT_TYPES.has(type)) throw new BadRequestException('Tipo de alerta inválido');
      conditions.push('al.alert_type = ?');
      params.push(type);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const source = `FROM erp_membership_alerts al
      JOIN memberships m ON m.id_membership = al.id_membership
      JOIN customers c ON c.id_customer = m.id_customer
      JOIN membership_plans pl ON pl.id_plan = m.id_plan
      ${where}`;
    const [countRows] = await this.db.query(`SELECT COUNT(*) AS total ${source}`, params);
    const [rows] = await this.db.query(`
      SELECT al.id_alert, al.alert_type, al.status,
        DATE_FORMAT(al.reference_date, '%Y-%m-%d') AS reference_date,
        DATE_FORMAT(al.created_at - INTERVAL 4 HOUR, '%Y-%m-%d %H:%i') AS created_at,
        DATE_FORMAT(al.resolved_at - INTERVAL 4 HOUR, '%Y-%m-%d %H:%i') AS resolved_at,
        m.id_membership, c.id_customer,
        CONCAT(c.first_name, ' ', c.last_name) AS customer_name,
        pl.plan_name, DATE_FORMAT(m.end_date, '%Y-%m-%d') AS membership_end_date
      ${source}
      ORDER BY al.status = 'PENDING' DESC, al.reference_date, al.id_alert DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);
    return {
      from, to, page, limit, total: countValue(countRows?.[0]?.total),
      items: rows || [],
    };
  }

  async getCommercialFollowups(query = {}) {
    validateQuery(query, ['from', 'to', 'result', 'reason', 'page', 'limit']);
    const today = await this.getToday();
    const { from, to } = dateRange(query, {
      from: today.month_start,
      to: today.business_date,
    });
    const { page, limit, offset } = pagination(query);
    const conditions = ['DATE(f.contact_date - INTERVAL 4 HOUR) BETWEEN ? AND ?'];
    const params = [from, to];
    if (query.result !== undefined && query.result !== '') {
      const result = String(query.result).toUpperCase();
      if (!COMMERCIAL_FOLLOWUP_RESULTS.has(result)) {
        throw new BadRequestException('Resultado de seguimiento inválido');
      }
      conditions.push('f.result = ?');
      params.push(result);
    }
    if (query.reason !== undefined && query.reason !== '') {
      const reason = String(query.reason).toUpperCase();
      if (!COMMERCIAL_FOLLOWUP_REASONS.has(reason)) {
        throw new BadRequestException('Motivo de seguimiento inválido');
      }
      conditions.push('f.reason = ?');
      params.push(reason);
    }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const source = `FROM erp_commercial_followups f
      JOIN customers c ON c.id_customer = f.id_customer
      LEFT JOIN memberships m ON m.id_membership = f.id_membership
      LEFT JOIN membership_plans pl ON pl.id_plan = m.id_plan
      ${where}`;
    const [countRows] = await this.db.query(`SELECT COUNT(*) AS total ${source}`, params);
    const [rows] = await this.db.query(`
      SELECT f.id_followup, f.reason, f.contact_method, f.result,
        DATE_FORMAT(f.contact_date - INTERVAL 4 HOUR, '%Y-%m-%d %H:%i') AS contact_date,
        DATE_FORMAT(f.next_action_at - INTERVAL 4 HOUR, '%Y-%m-%d %H:%i') AS next_action_at,
        c.id_customer, CONCAT(c.first_name, ' ', c.last_name) AS customer_name,
        m.id_membership, pl.plan_name
      ${source}
      ORDER BY f.contact_date DESC, f.id_followup DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);
    return {
      from, to, page, limit, total: countValue(countRows?.[0]?.total),
      items: rows || [],
    };
  }
}

module.exports = ErpDirectionService;
