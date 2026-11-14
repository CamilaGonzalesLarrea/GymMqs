'use strict';

// Gimnasio MQS - ERP / Finanzas - Caja y movimientos.
// Pool: mysql2/promise. Fechas de movimientos: día de Bolivia (UTC-04:00).
// Todos los ID de usuario se reciben SOLO desde el middleware autenticado.
// No ejecutar este archivo directamente; se instancia desde el controlador.

const {
  HttpError,
  BadRequestException,
  NotFoundException,
} = require('../middlewares/errors');

class ForbiddenException extends HttpError {
  constructor() { super(403, 'No tienes permiso para realizar esta operación'); }
}
class ConflictException extends HttpError {
  constructor(message) { super(409, message); }
}

const MAX_ID = 2147483647;
const MAX_MONEY_CENTS = 999999999999n; // DECIMAL(12,2)
const ALLOWED_ENTRY_TYPES = ['EXPENSE', 'OTHER_INCOME'];
const MOVEMENT_TYPES = ['PAYMENT_IN', 'PAYMENT_REVERSAL', 'OTHER_IN', 'EXPENSE_OUT'];
const OWN = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

function record(value, label = 'Los datos') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException(`${label} deben ser un objeto JSON`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new BadRequestException(`${label} tienen un formato inválido`);
  }
  return value;
}

function exactKeys(value, keys) {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new BadRequestException(`Campo no permitido: ${key}`);
  }
}

function id(value, field = 'ID') {
  const text = typeof value === 'number' && Number.isSafeInteger(value)
    ? String(value) : typeof value === 'string' ? value : '';
  if (!/^[1-9]\d*$/.test(text)) {
    throw new BadRequestException(`${field} debe ser un entero positivo`);
  }
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed > MAX_ID) {
    throw new BadRequestException(`${field} está fuera de rango`);
  }
  return parsed;
}

function cents(value, field = 'El importe', { allowZero = false } = {}) {
  if ((typeof value !== 'string' && typeof value !== 'number') ||
      (typeof value === 'number' && !Number.isFinite(value))) {
    throw new BadRequestException(`${field} debe ser un importe decimal válido`);
  }
  const text = String(value);
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(text)) {
    throw new BadRequestException(`${field} debe tener máximo dos decimales`);
  }
  const [whole, fraction = ''] = text.split('.');
  const amount = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (amount > MAX_MONEY_CENTS || (!allowZero && amount === 0n)) {
    throw new BadRequestException(`${field} está fuera del rango permitido`);
  }
  return amount;
}

function moneyString(amount) {
  const sign = amount < 0n ? '-' : '';
  const abs = amount < 0n ? -amount : amount;
  return `${sign}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

function databaseMoney(value, label) {
  return cents(value == null ? '0.00' : value, label, { allowZero: true });
}

function singleLine(value, label, min, max) {
  if (typeof value !== 'string') throw new BadRequestException(`${label} debe ser texto`);
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (trimmed.length < min || trimmed.length > max || /[\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new BadRequestException(`${label} debe tener entre ${min} y ${max} caracteres`);
  }
  return trimmed;
}

function optionalNotes(value, max = 2000) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new BadRequestException('Las observaciones deben ser texto');
  const text = value.trim();
  if (text.length > max || /[\u0000\u007f]/.test(text)) {
    throw new BadRequestException(`Las observaciones no pueden superar ${max} caracteres`);
  }
  return text || null;
}

function isoDate(value, label = 'La fecha') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException(`${label} debe tener formato AAAA-MM-DD`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException(`${label} no es válida`);
  }
  return value;
}

function pageAndLimit(filters) {
  const page = filters.page == null ? 1 : id(filters.page, 'page');
  const limit = filters.limit == null ? 20 : id(filters.limit, 'limit');
  if (page > 100000 || limit > 100) {
    throw new BadRequestException('El máximo permitido es page=100000 y limit=100');
  }
  return { page, limit, offset: (page - 1) * limit };
}

function dateRange(filters, { required = false, maxDays = null } = {}) {
  const from = filters.from == null || filters.from === '' ? null : isoDate(filters.from, 'from');
  const to = filters.to == null || filters.to === '' ? null : isoDate(filters.to, 'to');
  if (required && (!from || !to)) throw new BadRequestException('Indica fechas from y to');
  if (from && to && from > to) throw new BadRequestException('from no puede ser posterior a to');
  if (maxDays && from && to) {
    const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000;
    if (days > maxDays) throw new BadRequestException(`El rango máximo es de ${maxDays + 1} días`);
  }
  return { from, to };
}

function addDays(date, days) {
  const timestamp = Date.parse(`${date}T00:00:00Z`) + days * 86400000;
  return new Date(timestamp).toISOString().slice(0, 10);
}

function cashFlag(paymentMethodName) {
  // El flag nunca procede del cliente: deriva del método activo de la BD.
  return String(paymentMethodName).trim().toLocaleLowerCase('es') === 'efectivo' ? 1 : 0;
}

function totalsFromRow(row = {}) {
  const fields = [
    'total_income', 'total_expenses', 'total_reversals',
    'cash_income', 'cash_expenses', 'cash_reversals',
  ];
  return Object.fromEntries(fields.map((field) => [field, databaseMoney(row[field], field)]));
}

function totalsForOutput(row) {
  const fields = totalsFromRow(row);
  const output = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, moneyString(value)]));
  output.net_income = moneyString(fields.total_income - fields.total_expenses - fields.total_reversals);
  output.net_cash_change = moneyString(fields.cash_income - fields.cash_expenses - fields.cash_reversals);
  output.movement_count = Number(row?.movement_count || 0);
  return output;
}

const DAILY_TOTALS_SQL = `
  SELECT
    COUNT(*) AS movement_count,
    COALESCE(SUM(CASE WHEN movement_kind IN ('PAYMENT_IN','OTHER_IN')
      THEN amount ELSE 0 END),0) AS total_income,
    COALESCE(SUM(CASE WHEN movement_kind = 'EXPENSE_OUT'
      THEN amount ELSE 0 END),0) AS total_expenses,
    COALESCE(SUM(CASE WHEN movement_kind = 'PAYMENT_REVERSAL'
      THEN amount ELSE 0 END),0) AS total_reversals,
    COALESCE(SUM(CASE WHEN is_cash = 1 AND movement_kind IN ('PAYMENT_IN','OTHER_IN')
      THEN amount ELSE 0 END),0) AS cash_income,
    COALESCE(SUM(CASE WHEN is_cash = 1 AND movement_kind = 'EXPENSE_OUT'
      THEN amount ELSE 0 END),0) AS cash_expenses,
    COALESCE(SUM(CASE WHEN is_cash = 1 AND movement_kind = 'PAYMENT_REVERSAL'
      THEN amount ELSE 0 END),0) AS cash_reversals
  FROM erp_cash_movements WHERE business_date = ?
`;

class ErpCashService {
  constructor(db) {
    if (!db || typeof db.query !== 'function' || typeof db.getConnection !== 'function') {
      throw new TypeError('Se requiere el pool mysql2/promise con query() y getConnection()');
    }
    this.db = db;
  }

  async transaction(fn) {
    const conn = await this.db.getConnection();
    if (!conn || !['beginTransaction', 'commit', 'rollback', 'release', 'query']
      .every((method) => typeof conn[method] === 'function')) {
      throw new TypeError('La conexión MySQL no permite transacciones');
    }
    let started = false;
    try {
      await conn.beginTransaction();
      started = true;
      const response = await fn(conn);
      await conn.commit();
      started = false;
      return response;
    } catch (error) {
      if (started) {
        try {
          await conn.rollback();
        } catch (rollbackError) {
          console.error('Falló rollback de caja:', rollbackError.code || rollbackError.name);
        }
      }
      if (['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(error?.code)) {
        throw new ConflictException('La caja está siendo actualizada. Consulta su estado e intenta de nuevo');
      }
      if (error?.code === 'ER_DUP_ENTRY') {
        throw new ConflictException('El registro ya existe; actualiza antes de repetir la operación');
      }
      throw error;
    } finally {
      conn.release();
    }
  }

  async authorize(executor, actorUserId, permission) {
    const userId = id(actorUserId, 'Usuario autenticado');
    const [rows] = await executor.query(`
      SELECT u.id_user FROM users u
      JOIN roles r ON r.id_role = u.id_role
      JOIN erp_role_permissions rp ON rp.id_role = r.id_role
      WHERE u.id_user = ? AND u.status = 'ACTIVE'
        AND r.status = 'ACTIVE' AND rp.permission_code = ?
      LIMIT 1
    `, [userId, permission]);
    if (!Array.isArray(rows) || !rows.length) throw new ForbiddenException();
    return userId;
  }

  async clock(executor) {
    // UTC para los DATETIME; fecha comercial fija para Bolivia, UTC-04.
    const [rows] = await executor.query(`
      SELECT DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s') AS utc_now,
             DATE_FORMAT(UTC_TIMESTAMP() - INTERVAL 4 HOUR, '%Y-%m-%d') AS business_date
    `);
    if (!rows?.[0]?.utc_now || !rows?.[0]?.business_date) {
      throw new Error('MySQL no devolvió una fecha de operación válida');
    }
    return rows[0];
  }

  async ensureOpen(conn, day) {
    // Coincide con ensureCashOpen del servicio de pagos.
    // Requiere transacciones InnoDB y aislamiento REPEATABLE READ (predeterminado en MySQL).
    const [rows] = await conn.query(`
      SELECT id_cash_closure FROM erp_cash_closures
      WHERE business_date = ? LIMIT 1 FOR UPDATE
    `, [day]);
    if (rows.length) throw new ConflictException(`La caja del ${day} ya está cerrada`);
  }

  async method(conn, methodId) {
    const [rows] = await conn.query(`
      SELECT id_payment_method, name, status FROM payment_methods
      WHERE id_payment_method = ? LIMIT 1 FOR UPDATE
    `, [methodId]);
    if (!rows.length || rows[0].status !== 'ACTIVE') {
      throw new ConflictException('El método de pago no existe o está inactivo');
    }
    return rows[0];
  }

  async audit(conn, actorId, action, tableName, recordId, utcNow, description) {
    await conn.query(`
      INSERT INTO audit_logs
        (id_user, module, action, table_name, record_id, creationDate, description)
      VALUES (?, 'FINANCE', ?, ?, ?, ?, ?)
    `, [actorId, action, tableName, recordId, utcNow, description]);
  }

  async createFinancialEntry(payload, actorUserId) {
    const body = record(payload, 'El movimiento');
    exactKeys(body, ['entry_type', 'category', 'concept', 'amount', 'id_payment_method', 'notes']);
    if (!ALLOWED_ENTRY_TYPES.includes(body.entry_type)) {
      throw new BadRequestException('entry_type debe ser EXPENSE u OTHER_INCOME');
    }
    const category = singleLine(body.category, 'La categoría', 2, 80);
    const concept = singleLine(body.concept, 'El concepto', 4, 255);
    const amount = cents(body.amount);
    const idMethod = id(body.id_payment_method, 'id_payment_method');
    const notes = optionalNotes(body.notes);

    return this.transaction(async (conn) => {
      const actor = await this.authorize(conn, actorUserId, 'FI_CASH_MANAGE');
      const time = await this.clock(conn);
      await this.ensureOpen(conn, time.business_date);
      const paymentMethod = await this.method(conn, idMethod);
      const movementKind = body.entry_type === 'EXPENSE' ? 'EXPENSE_OUT' : 'OTHER_IN';
      const isCash = cashFlag(paymentMethod.name);
      const decimal = moneyString(amount);

      const [entryResult] = await conn.query(`
        INSERT INTO erp_financial_entries
          (entry_type, category, concept, amount, entry_date,
           id_payment_method, created_by, created_at, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [body.entry_type, category, concept, decimal, time.utc_now,
        idMethod, actor, time.utc_now, notes]);
      const entryId = id(entryResult.insertId, 'id_financial_entry');

      const [movementResult] = await conn.query(`
        INSERT INTO erp_cash_movements
          (business_date, movement_kind, amount, id_financial_entry,
           id_payment_method, is_cash, registered_by, registered_at, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [time.business_date, movementKind, decimal, entryId,
        idMethod, isCash, actor, time.utc_now, notes]);
      const movementId = id(movementResult.insertId, 'id_cash_movement');

      await this.audit(conn, actor, 'CASH_ENTRY_CREATE', 'erp_financial_entries',
        entryId, time.utc_now, `${body.entry_type}: ${category} / ${concept} / ${decimal} Bs`);
      return {
        id_financial_entry: entryId,
        id_cash_movement: movementId,
        entry_type: body.entry_type,
        movement_kind: movementKind,
        category, concept, amount: decimal,
        id_payment_method: idMethod,
        payment_method: paymentMethod.name,
        is_cash: Boolean(isCash),
        entry_date: time.utc_now,
        business_date: time.business_date,
        created_by: actor,
        notes,
      };
    });
  }

  async getFinancialEntryById(entryId, actorUserId) {
    const entry = id(entryId, 'id_financial_entry');
    await this.authorize(this.db, actorUserId, 'FI_CASH_READ');
    const [rows] = await this.db.query(`
      SELECT e.id_financial_entry, e.entry_type, e.category, e.concept,
             e.amount, e.entry_date, e.id_payment_method, pm.name AS payment_method,
             e.created_by, u.username AS created_by_name, e.created_at, e.notes,
             m.id_cash_movement, m.business_date, m.movement_kind, m.is_cash
      FROM erp_financial_entries e
      JOIN payment_methods pm ON pm.id_payment_method = e.id_payment_method
      JOIN users u ON u.id_user = e.created_by
      LEFT JOIN erp_cash_movements m ON m.id_financial_entry = e.id_financial_entry
      WHERE e.id_financial_entry = ? LIMIT 1
    `, [entry]);
    if (!rows.length) throw new NotFoundException('Movimiento financiero no encontrado');
    return rows[0];
  }

  async listFinancialEntries(query = {}, actorUserId) {
    const q = record(query, 'Los filtros');
    exactKeys(q, ['page', 'limit', 'entry_type', 'category', 'id_payment_method', 'from', 'to']);
    const paging = pageAndLimit(q);
    const range = dateRange(q);
    const where = [];
    const args = [];
    if (q.entry_type != null && q.entry_type !== '') {
      if (!ALLOWED_ENTRY_TYPES.includes(q.entry_type)) {
        throw new BadRequestException('Tipo de registro financiero inválido');
      }
      where.push('e.entry_type = ?'); args.push(q.entry_type);
    }
    if (q.category != null && q.category !== '') {
      where.push('e.category = ?'); args.push(singleLine(q.category, 'La categoría', 2, 80));
    }
    if (q.id_payment_method != null && q.id_payment_method !== '') {
      where.push('e.id_payment_method = ?'); args.push(id(q.id_payment_method, 'id_payment_method'));
    }
    if (range.from) {
      where.push("e.entry_date >= DATE_ADD(CONCAT(?, ' 00:00:00'), INTERVAL 4 HOUR)");
      args.push(range.from);
    }
    if (range.to) {
      where.push("e.entry_date < DATE_ADD(CONCAT(?, ' 00:00:00'), INTERVAL 28 HOUR)");
      args.push(range.to);
    }
    const filterSQL = where.length ? `WHERE ${where.join(' AND ')}` : '';
    await this.authorize(this.db, actorUserId, 'FI_CASH_READ');
    const [[totalRow]] = await this.db.query(`
      SELECT COUNT(*) AS total FROM erp_financial_entries e ${filterSQL}
    `, args);
    const [data] = await this.db.query(`
      SELECT e.id_financial_entry, e.entry_type, e.category, e.concept,
             e.amount, e.entry_date, e.id_payment_method, pm.name AS payment_method,
             e.created_by, u.username AS created_by_name, e.notes,
             m.id_cash_movement, m.business_date, m.is_cash
      FROM erp_financial_entries e
      JOIN payment_methods pm ON pm.id_payment_method = e.id_payment_method
      JOIN users u ON u.id_user = e.created_by
      LEFT JOIN erp_cash_movements m ON m.id_financial_entry = e.id_financial_entry
      ${filterSQL}
      ORDER BY e.entry_date DESC, e.id_financial_entry DESC
      LIMIT ? OFFSET ?
    `, [...args, paging.limit, paging.offset]);
    return { data, total: Number(totalRow.total), page: paging.page, limit: paging.limit };
  }

  async getCashMovementById(movementId, actorUserId) {
    const idMovement = id(movementId, 'id_cash_movement');
    await this.authorize(this.db, actorUserId, 'FI_CASH_READ');
    const [rows] = await this.db.query(`
      SELECT m.*, pm.name AS payment_method,
             e.entry_type, e.category, e.concept,
             p.id_membership, mm.id_customer
      FROM erp_cash_movements m
      JOIN payment_methods pm ON pm.id_payment_method = m.id_payment_method
      LEFT JOIN erp_financial_entries e ON e.id_financial_entry = m.id_financial_entry
      LEFT JOIN payments p ON p.id_payment = m.id_payment
      LEFT JOIN memberships mm ON mm.id_membership = p.id_membership
      WHERE m.id_cash_movement = ? LIMIT 1
    `, [idMovement]);
    if (!rows.length) throw new NotFoundException('Movimiento de caja no encontrado');
    return rows[0];
  }

  async listCashMovements(query = {}, actorUserId) {
    const q = record(query, 'Los filtros');
    exactKeys(q, ['page', 'limit', 'from', 'to', 'business_date', 'movement_kind',
      'id_payment_method', 'is_cash']);
    const paging = pageAndLimit(q);
    const range = dateRange(q);
    const where = [];
    const args = [];
    if (range.from) { where.push('m.business_date >= ?'); args.push(range.from); }
    if (range.to) { where.push('m.business_date <= ?'); args.push(range.to); }
    if (q.business_date != null && q.business_date !== '') {
      where.push('m.business_date = ?'); args.push(isoDate(q.business_date, 'business_date'));
    }
    if (q.movement_kind != null && q.movement_kind !== '') {
      if (!MOVEMENT_TYPES.includes(q.movement_kind)) {
        throw new BadRequestException('Tipo de movimiento no permitido');
      }
      where.push('m.movement_kind = ?'); args.push(q.movement_kind);
    }
    if (q.id_payment_method != null && q.id_payment_method !== '') {
      where.push('m.id_payment_method = ?'); args.push(id(q.id_payment_method, 'id_payment_method'));
    }
    if (q.is_cash != null && q.is_cash !== '') {
      if (q.is_cash !== '0' && q.is_cash !== '1' && q.is_cash !== 0 && q.is_cash !== 1) {
        throw new BadRequestException('is_cash debe ser 0 o 1');
      }
      where.push('m.is_cash = ?'); args.push(Number(q.is_cash));
    }
    const filterSQL = where.length ? `WHERE ${where.join(' AND ')}` : '';
    await this.authorize(this.db, actorUserId, 'FI_CASH_READ');
    const [[totalRow]] = await this.db.query(`
      SELECT COUNT(*) AS total FROM erp_cash_movements m ${filterSQL}
    `, args);
    const [data] = await this.db.query(`
      SELECT m.id_cash_movement, m.business_date, m.movement_kind, m.amount,
             m.id_payment, m.id_financial_entry, m.id_payment_method,
             pm.name AS payment_method, m.is_cash, m.registered_by,
             u.username AS registered_by_name, m.registered_at, m.notes,
             e.category, e.concept, p.id_membership
      FROM erp_cash_movements m
      JOIN payment_methods pm ON pm.id_payment_method = m.id_payment_method
      JOIN users u ON u.id_user = m.registered_by
      LEFT JOIN erp_financial_entries e ON e.id_financial_entry = m.id_financial_entry
      LEFT JOIN payments p ON p.id_payment = m.id_payment
      ${filterSQL}
      ORDER BY m.business_date DESC, m.id_cash_movement DESC
      LIMIT ? OFFSET ?
    `, [...args, paging.limit, paging.offset]);
    return { data, total: Number(totalRow.total), page: paging.page, limit: paging.limit };
  }

  async getPreviousClosure(executor, day, forUpdate = false) {
    const [rows] = await executor.query(`
      SELECT business_date, counted_cash, expected_cash
      FROM erp_cash_closures WHERE business_date < ?
      ORDER BY business_date DESC LIMIT 1 ${forUpdate ? 'FOR UPDATE' : ''}
    `, [day]);
    return rows[0] || null;
  }

  async getClosureByDate(businessDate, actorUserId) {
    const day = isoDate(businessDate, 'business_date');
    await this.authorize(this.db, actorUserId, 'FI_CASH_READ');
    const [rows] = await this.db.query(`
      SELECT cl.*, u.username AS closed_by_name
      FROM erp_cash_closures cl
      JOIN users u ON u.id_user = cl.closed_by
      WHERE cl.business_date = ? LIMIT 1
    `, [day]);
    if (!rows.length) throw new NotFoundException('No hay cierre de caja para esta fecha');
    return rows[0];
  }

  async getDailySummary(businessDate, actorUserId) {
    await this.authorize(this.db, actorUserId, 'FI_CASH_READ');
    const day = businessDate == null || businessDate === ''
      ? (await this.clock(this.db)).business_date
      : isoDate(businessDate, 'business_date');
    const [[totals]] = await this.db.query(DAILY_TOTALS_SQL, [day]);
    const [closures] = await this.db.query(`
      SELECT cl.*, u.username AS closed_by_name FROM erp_cash_closures cl
      JOIN users u ON u.id_user = cl.closed_by
      WHERE cl.business_date = ? LIMIT 1
    `, [day]);
    const previous = await this.getPreviousClosure(this.db, day);
    const opening = closures.length ? databaseMoney(closures[0].opening_cash, 'opening_cash') :
      previous ? databaseMoney(previous.counted_cash ?? previous.expected_cash, 'opening_cash') : null;
    const t = totalsFromRow(totals);
    return {
      business_date: day,
      closed: closures.length > 0,
      closure: closures[0] || null,
      previous_closure_date: previous?.business_date || null,
      suggested_opening_cash: opening === null ? null : moneyString(opening),
      estimated_cash: opening === null ? null :
        moneyString(opening + t.cash_income - t.cash_expenses - t.cash_reversals),
      totals: totalsForOutput(totals),
    };
  }

  async closeCash(payload, actorUserId) {
    const body = record(payload, 'Los datos del cierre');
    exactKeys(body, ['business_date', 'opening_cash', 'counted_cash', 'notes']);
    const providedDay = body.business_date == null ? null : isoDate(body.business_date, 'business_date');
    const openingRequested = body.opening_cash == null ? null :
      cents(body.opening_cash, 'opening_cash', { allowZero: true });
    const counted = body.counted_cash == null ? null :
      cents(body.counted_cash, 'counted_cash', { allowZero: true });
    const notes = optionalNotes(body.notes, 2000);

    return this.transaction(async (conn) => {
      const actor = await this.authorize(conn, actorUserId, 'FI_CASH_MANAGE');
      const time = await this.clock(conn);
      const day = providedDay || time.business_date;
      if (day > time.business_date) throw new BadRequestException('No se permite cerrar una fecha futura');
      await this.ensureOpen(conn, day);

      // Evita cerrar una fecha anterior a otro cierre ya registrado.
      const [futureClosures] = await conn.query(`
        SELECT id_cash_closure FROM erp_cash_closures
        WHERE business_date > ? LIMIT 1 FOR UPDATE
      `, [day]);
      if (futureClosures.length) {
        throw new ConflictException('Ya existe un cierre posterior a esta fecha');
      }

      const previous = await this.getPreviousClosure(conn, day, true);
      const suggested = previous
        ? databaseMoney(previous.counted_cash ?? previous.expected_cash, 'Cierre anterior')
        : null;
      let opening;
      if (suggested === null) {
        if (openingRequested === null) {
          throw new BadRequestException('El primer cierre requiere opening_cash (efectivo inicial)');
        }
        opening = openingRequested;
      } else {
        if (openingRequested !== null && openingRequested !== suggested) {
          throw new ConflictException('El efectivo inicial debe coincidir con el cierre anterior');
        }
        opening = suggested;
      }

      // Bloquear todos los movimientos del día y su rango de índice para
      // calcular sobre un conjunto estable antes de insertar el cierre.
      await conn.query(`
        SELECT id_cash_movement FROM erp_cash_movements
        WHERE business_date = ? FOR UPDATE
      `, [day]);
      const [[totals]] = await conn.query(DAILY_TOTALS_SQL, [day]);
      const t = totalsFromRow(totals);
      const expected = opening + t.cash_income - t.cash_expenses - t.cash_reversals;
      if (expected < 0n) {
        throw new ConflictException('El efectivo esperado es negativo: revisa los movimientos antes de cerrar');
      }
      if (expected > MAX_MONEY_CENTS) {
        throw new ConflictException('El efectivo esperado excede el límite del sistema');
      }
      const difference = counted === null ? null : counted - expected;
      if (difference !== null && difference !== 0n && (!notes || notes.length < 10)) {
        throw new BadRequestException('Si hay diferencia de caja, registra una explicación de al menos 10 caracteres');
      }

      const [result] = await conn.query(`
        INSERT INTO erp_cash_closures
          (business_date, opening_cash, total_income, total_expenses, total_reversals,
           expected_cash, counted_cash, difference_cash, closed_by, closed_at, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [day, moneyString(opening), moneyString(t.total_income), moneyString(t.total_expenses),
        moneyString(t.total_reversals), moneyString(expected),
        counted === null ? null : moneyString(counted),
        difference === null ? null : moneyString(difference), actor, time.utc_now, notes]);
      const closureId = id(result.insertId, 'id_cash_closure');
      await this.audit(conn, actor, 'CASH_CLOSE', 'erp_cash_closures', closureId,
        time.utc_now, `Cierre ${day}; efectivo esperado ${moneyString(expected)} Bs; diferencia ${difference === null ? 'sin conteo' : moneyString(difference)} Bs`);
      return {
        id_cash_closure: closureId,
        business_date: day,
        opening_cash: moneyString(opening),
        expected_cash: moneyString(expected),
        counted_cash: counted === null ? null : moneyString(counted),
        difference_cash: difference === null ? null : moneyString(difference),
        total_income: moneyString(t.total_income),
        total_expenses: moneyString(t.total_expenses),
        total_reversals: moneyString(t.total_reversals),
        cash_income: moneyString(t.cash_income),
        cash_expenses: moneyString(t.cash_expenses),
        cash_reversals: moneyString(t.cash_reversals),
        movement_count: Number(totals.movement_count),
        closed_at: time.utc_now,
        closed_by: actor,
        notes,
      };
    });
  }

  async listCashClosures(query = {}, actorUserId) {
    const q = record(query, 'Los filtros');
    exactKeys(q, ['page', 'limit', 'from', 'to']);
    const paging = pageAndLimit(q);
    const range = dateRange(q);
    const conditions = [];
    const params = [];
    if (range.from) { conditions.push('business_date >= ?'); params.push(range.from); }
    if (range.to) { conditions.push('business_date <= ?'); params.push(range.to); }
    const filterSQL = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    await this.authorize(this.db, actorUserId, 'FI_CASH_READ');
    const [[totalRow]] = await this.db.query(`
      SELECT COUNT(*) AS total FROM erp_cash_closures ${filterSQL}
    `, params);
    const [data] = await this.db.query(`
      SELECT * FROM erp_cash_closures ${filterSQL}
      ORDER BY business_date DESC LIMIT ? OFFSET ?
    `, [...params, paging.limit, paging.offset]);
    return { data, total: Number(totalRow.total), page: paging.page, limit: paging.limit };
  }

  async getFinancialReport(query = {}, actorUserId) {
    const q = record(query, 'Los filtros');
    exactKeys(q, ['from', 'to']);
    const today = (await this.clock(this.db)).business_date;
    const range = dateRange({ from: q.from ?? addDays(today, -29), to: q.to ?? today },
      { required: true, maxDays: 365 });
    await this.authorize(this.db, actorUserId, 'FI_REPORTS_READ');
    const [summaryRows] = await this.db.query(`
      SELECT
        COUNT(*) AS movement_count,
        COALESCE(SUM(CASE WHEN movement_kind IN ('PAYMENT_IN','OTHER_IN') THEN amount ELSE 0 END),0) AS total_income,
        COALESCE(SUM(CASE WHEN movement_kind = 'EXPENSE_OUT' THEN amount ELSE 0 END),0) AS total_expenses,
        COALESCE(SUM(CASE WHEN movement_kind = 'PAYMENT_REVERSAL' THEN amount ELSE 0 END),0) AS total_reversals,
        COALESCE(SUM(CASE WHEN is_cash=1 AND movement_kind IN ('PAYMENT_IN','OTHER_IN') THEN amount ELSE 0 END),0) AS cash_income,
        COALESCE(SUM(CASE WHEN is_cash=1 AND movement_kind = 'EXPENSE_OUT' THEN amount ELSE 0 END),0) AS cash_expenses,
        COALESCE(SUM(CASE WHEN is_cash=1 AND movement_kind = 'PAYMENT_REVERSAL' THEN amount ELSE 0 END),0) AS cash_reversals
      FROM erp_cash_movements
      WHERE business_date BETWEEN ? AND ?
    `, [range.from, range.to]);
    const [methods] = await this.db.query(`
      SELECT pm.id_payment_method, pm.name AS payment_method,
        m.movement_kind, COUNT(*) AS operations, SUM(m.amount) AS total_amount
      FROM erp_cash_movements m
      JOIN payment_methods pm ON pm.id_payment_method = m.id_payment_method
      WHERE m.business_date BETWEEN ? AND ?
      GROUP BY pm.id_payment_method, pm.name, m.movement_kind
      ORDER BY pm.name, m.movement_kind
    `, [range.from, range.to]);
    const [categories] = await this.db.query(`
      SELECT e.entry_type, e.category,
        COUNT(*) AS operations, SUM(e.amount) AS total_amount
      FROM erp_financial_entries e
      JOIN erp_cash_movements m ON m.id_financial_entry = e.id_financial_entry
      WHERE m.business_date BETWEEN ? AND ?
      GROUP BY e.entry_type, e.category
      ORDER BY e.entry_type, e.category
    `, [range.from, range.to]);
    return {
      from: range.from, to: range.to,
      totals: totalsForOutput(summaryRows[0]),
      by_method: methods,
      by_category: categories,
    };
  }
}

module.exports = ErpCashService;
