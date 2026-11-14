'use strict';

// Gimnasio MQS - ERP / Marketing y Ventas.
// Alertas, inactividad, seguimiento, solicitudes de renovación y reportes.
// Reutiliza las tablas MySQL ERP existentes. NO crea membresías, NO cobra,
// NO cambia precios, NO activa membresías ni envía mensajes automáticamente.
// Instanciar con el pool mysql2/promise y pasar SIEMPRE req.auth.id_user
// desde un controlador protegido por createErpAuthMiddleware(db).

const {
  HttpError,
  BadRequestException,
  NotFoundException,
} = require('../middlewares/errors');

class ForbiddenException extends HttpError {
  constructor(message = 'No tienes permiso para esta operación') {
    super(403, message);
  }
}
class ConflictException extends HttpError {
  constructor(message) {
    super(409, message);
  }
}

const MAX_ID = 2147483647;
const BUSINESS_TODAY = 'DATE(UTC_TIMESTAMP() - INTERVAL 4 HOUR)';
const ALERT_TYPES = new Set(['EXPIRING', 'EXPIRED', 'LOW_ATTENDANCE']);
const ALERT_STATUSES = new Set(['PENDING', 'CONTACTED', 'DISMISSED']);
const FOLLOWUP_REASONS = new Set(['EXPIRING', 'EXPIRED', 'LOW_ATTENDANCE', 'OTHER']);
const CONTACT_METHODS = new Set(['PHONE', 'WHATSAPP', 'EMAIL', 'IN_PERSON', 'OTHER']);
const FOLLOWUP_RESULTS = new Set(['PENDING', 'CONTACTED', 'RENEWAL_ACCEPTED', 'DECLINED', 'NO_RESPONSE']);
const RENEWAL_STATUSES = new Set(['REQUESTED', 'COMPLETED', 'REJECTED', 'CANCELLED']);
const own = (o, key) => Object.prototype.hasOwnProperty.call(o, key);

function object(value, label = 'Los datos') {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new BadRequestException(`${label} deben ser un objeto JSON`);
  }
  return value;
}
function allowFields(value, keys) {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new BadRequestException(`Campo no permitido: ${key}`);
  }
}
function positiveId(value, label = 'ID') {
  const raw = typeof value === 'number' && Number.isSafeInteger(value)
    ? String(value) : typeof value === 'string' ? value : '';
  if (!/^[1-9]\d*$/.test(raw)) throw new BadRequestException(`${label} debe ser un entero positivo`);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed > MAX_ID) {
    throw new BadRequestException(`${label} está fuera de rango`);
  }
  return parsed;
}
function enumValue(value, label, values) {
  if (typeof value !== 'string' || !values.has(value)) {
    throw new BadRequestException(`${label} no es válido`);
  }
  return value;
}
function text(value, label, max, { required = false } = {}) {
  if (!required && (value == null || value === '')) return null;
  if (typeof value !== 'string' || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    throw new BadRequestException(`${label} debe ser texto válido`);
  }
  const result = value.replace(/[\t\r\n ]+/g, ' ').trim();
  if ((required && !result) || result.length > max) {
    throw new BadRequestException(`${label} debe tener entre ${required ? 1 : 0} y ${max} caracteres`);
  }
  return result || null;
}
function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.getUTCFullYear() >= 1000 &&
    date.toISOString().slice(0, 10) === value;
}
function dateOnly(value, label) {
  if (!isDate(value)) throw new BadRequestException(`${label} debe ser una fecha AAAA-MM-DD válida`);
  return value;
}
function utcDateTime(value, label, { optional = false } = {}) {
  if (optional && (value == null || value === '')) return null;
  // Zona obligatoria: nunca interpretar una fecha ambigua con la zona del servidor.
  if (typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new BadRequestException(`${label} debe ser una fecha ISO 8601 con zona horaria`);
  }
  const parsed = new Date(value);
  if (!isDate(value.slice(0, 10)) || !Number.isFinite(parsed.getTime()) || parsed.getUTCFullYear() < 1000 ||
      parsed.getUTCFullYear() > 9999) {
    throw new BadRequestException(`${label} no es una fecha válida`);
  }
  return parsed.toISOString().slice(0, 19).replace('T', ' '); // DATETIME UTC en MySQL.
}
function pageInfo(filters) {
  const page = filters.page == null ? 1 : positiveId(filters.page, 'page');
  const limit = filters.limit == null ? 20 : positiveId(filters.limit, 'limit');
  if (page > 100000 || limit > 100) {
    throw new BadRequestException('page debe ser <= 100000 y limit <= 100');
  }
  return { page, limit, offset: (page - 1) * limit };
}
function filterObject(filters, allowed) {
  const value = object(filters, 'Los filtros');
  allowFields(value, allowed);
  return value;
}
function daysFromSetting(rows, key, fallback, max) {
  const raw = rows.find((row) => row.setting_key === key)?.setting_value;
  const days = Number(raw);
  return Number.isSafeInteger(days) && days >= 1 && days <= max ? days : fallback;
}

class ErpMarketingService {
  constructor(db) {
    if (!db || typeof db.query !== 'function' || typeof db.getConnection !== 'function') {
      throw new TypeError('Marketing necesita el pool mysql2/promise con query() y getConnection()');
    }
    this.db = db;
  }

  async authorize(executor, actorUserId, permissions) {
    const actorId = positiveId(actorUserId, 'Usuario autenticado');
    if (!Array.isArray(permissions) || permissions.length === 0) {
      throw new TypeError('Se requieren permisos para la operación');
    }
    const placeholders = permissions.map(() => '?').join(', ');
    const [rows] = await executor.query(`
      SELECT u.id_user
      FROM users u
      JOIN roles r ON r.id_role = u.id_role
      JOIN erp_role_permissions rp ON rp.id_role = r.id_role
      WHERE u.id_user = ? AND u.status = 'ACTIVE' AND r.status = 'ACTIVE'
        AND rp.permission_code IN (${placeholders})
      LIMIT 1
    `, [actorId, ...permissions]);
    if (!rows.length) throw new ForbiddenException();
    return actorId;
  }

  async transaction(handler) {
    const connection = await this.db.getConnection();
    let active = false;
    try {
      await connection.beginTransaction();
      active = true;
      const result = await handler(connection);
      await connection.commit();
      active = false;
      return result;
    } catch (error) {
      if (active) {
        try { await connection.rollback(); } catch (rollbackError) {
          console.error('No se pudo revertir la transacción de Marketing:',
            rollbackError.code || rollbackError.message);
        }
      }
      if (['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(error.code)) {
        throw new ConflictException('El registro está ocupado. Intenta nuevamente');
      }
      if (error.code === 'ER_DUP_ENTRY') {
        throw new ConflictException('El registro ya existe o se procesó anteriormente');
      }
      throw error;
    } finally {
      connection.release();
    }
  }

  async audit(executor, userId, action, table, recordId, description) {
    await executor.query(`
      INSERT INTO audit_logs (id_user, module, action, table_name, record_id, creationDate, description)
      VALUES (?, 'MARKETING', ?, ?, ?, UTC_TIMESTAMP(), ?)
    `, [userId, action, table, recordId, description]);
  }

  async settings(executor = this.db) {
    const [rows] = await executor.query(`
      SELECT setting_key, setting_value FROM erp_settings
      WHERE setting_key IN ('membership_expiry_alert_days', 'customer_inactivity_days')
    `);
    return {
      expiry_alert_days: daysFromSetting(rows, 'membership_expiry_alert_days', 7, 90),
      inactivity_days: daysFromSetting(rows, 'customer_inactivity_days', 14, 365),
    };
  }

  // Se ejecuta bajo demanda (p. ej. al abrir Marketing). No exige cron.
  // Cada alerta usa una fecha de referencia ESTABLE, por lo que ejecutar este
  // método repetidamente no duplica avisos (índice único en MySQL).
  async generateAlerts(actorUserId) {
    return this.transaction(async (conn) => {
      const userId = await this.authorize(conn, actorUserId, ['MV_FOLLOWUPS_WRITE']);
      const config = await this.settings(conn);
      // EXPIRING/EXPIRED: identificar una membresía realmente pagada/activa.
      // Ignorar clientes inactivos y quienes ya cuentan con una nueva membresía
      // pagada que sigue vigente (o está programada para comenzar).
      const common = `
        FROM memberships m
        JOIN customers c ON c.id_customer = m.id_customer
        WHERE c.status = 'ACTIVE' AND m.status IN ('ACTIVE', 'EXPIRED')
          AND NOT EXISTS (
            SELECT 1 FROM memberships newer
            WHERE newer.id_customer = m.id_customer
              AND newer.id_membership <> m.id_membership
              AND newer.status = 'ACTIVE'
              AND newer.start_date > m.end_date
              AND newer.end_date >= ${BUSINESS_TODAY}
          )
      `;
      const [expiring] = await conn.query(`
        INSERT INTO erp_membership_alerts
          (id_membership, alert_type, reference_date, status)
        SELECT m.id_membership, 'EXPIRING', m.end_date, 'PENDING'
        ${common}
          AND m.start_date <= ${BUSINESS_TODAY}
          AND m.end_date BETWEEN ${BUSINESS_TODAY}
            AND DATE_ADD(${BUSINESS_TODAY}, INTERVAL ? DAY)
        ON DUPLICATE KEY UPDATE id_alert = id_alert
      `, [config.expiry_alert_days]);
      // No recorrer toda la historia del gimnasio: hasta 30 días vencidas.
      const [expired] = await conn.query(`
        INSERT INTO erp_membership_alerts
          (id_membership, alert_type, reference_date, status)
        SELECT m.id_membership, 'EXPIRED', m.end_date, 'PENDING'
        ${common}
          AND m.end_date < ${BUSINESS_TODAY}
          AND m.end_date >= DATE_SUB(${BUSINESS_TODAY}, INTERVAL 30 DAY)
        ON DUPLICATE KEY UPDATE id_alert = id_alert
      `);
      // Bajo nivel de asistencia: la fecha de última asistencia (o inicio)
      // es una referencia estable. Solo membresías efectivamente vigentes.
      const [inactive] = await conn.query(`
        INSERT INTO erp_membership_alerts
          (id_membership, alert_type, reference_date, status)
        SELECT m.id_membership, 'LOW_ATTENDANCE',
               COALESCE(MAX(a.attendance_date), m.start_date), 'PENDING'
        FROM memberships m
        JOIN customers c ON c.id_customer = m.id_customer
        LEFT JOIN customer_attendances a
          ON a.id_membership = m.id_membership
         AND a.attendance_date BETWEEN m.start_date AND ${BUSINESS_TODAY}
        WHERE c.status = 'ACTIVE' AND m.status = 'ACTIVE'
          AND m.start_date <= ${BUSINESS_TODAY}
          AND m.end_date >= ${BUSINESS_TODAY}
        GROUP BY m.id_membership, m.start_date
        HAVING DATEDIFF(${BUSINESS_TODAY},
          COALESCE(MAX(a.attendance_date), m.start_date)) >= ?
        ON DUPLICATE KEY UPDATE id_alert = id_alert
      `, [config.inactivity_days]);
      const created = {
        expiring: expiring.affectedRows || 0,
        expired: expired.affectedRows || 0,
        low_attendance: inactive.affectedRows || 0,
      };
      const total = Object.values(created).reduce((a, b) => a + b, 0);
      // No generar miles de entradas de auditoría por alerta individual.
      await this.audit(conn, userId, 'ALERTS_GENERATE', 'erp_membership_alerts', null,
        `Actualización de alertas; nuevas: ${total}`);
      return { created, total_created: total, settings: config,
        message: 'Alertas actualizadas. Las alertas ya existentes no se duplicaron' };
    });
  }

  async listAlerts(filters = {}, actorUserId) {
    const f = filterObject(filters, ['page', 'limit', 'status', 'alert_type', 'id_customer', 'id_plan']);
    await this.authorize(this.db, actorUserId, ['MV_VIEW', 'MV_FOLLOWUPS_WRITE', 'MV_REPORTS_READ']);
    const { page, limit, offset } = pageInfo(f);
    const conditions = [];
    const params = [];
    if (f.status != null && f.status !== '') {
      conditions.push('al.status = ?');
      params.push(enumValue(f.status, 'status', ALERT_STATUSES));
    }
    if (f.alert_type != null && f.alert_type !== '') {
      conditions.push('al.alert_type = ?');
      params.push(enumValue(f.alert_type, 'alert_type', ALERT_TYPES));
    }
    if (f.id_customer != null && f.id_customer !== '') {
      conditions.push('m.id_customer = ?'); params.push(positiveId(f.id_customer, 'id_customer'));
    }
    if (f.id_plan != null && f.id_plan !== '') {
      conditions.push('m.id_plan = ?'); params.push(positiveId(f.id_plan, 'id_plan'));
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const from = `FROM erp_membership_alerts al
      JOIN memberships m ON m.id_membership = al.id_membership
      JOIN customers c ON c.id_customer = m.id_customer
      JOIN membership_plans pl ON pl.id_plan = m.id_plan`;
    const [countRows] = await this.db.query(`SELECT COUNT(*) AS total ${from} ${where}`, params);
    const [rows] = await this.db.query(`
      SELECT al.id_alert, al.alert_type,
        DATE_FORMAT(al.reference_date, '%Y-%m-%d') AS reference_date,
        al.status, al.created_at, al.resolved_at, al.resolved_by,
        m.id_membership, m.id_customer, m.id_plan, m.status AS membership_status,
        DATE_FORMAT(m.end_date, '%Y-%m-%d') AS membership_end_date,
        c.first_name, c.last_name, c.phone, c.email,
        pl.plan_name, DATEDIFF(m.end_date, ${BUSINESS_TODAY}) AS days_to_expire
      ${from} ${where}
      ORDER BY al.status = 'PENDING' DESC, al.created_at DESC, al.id_alert DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);
    return { items: rows, total: Number(countRows[0]?.total || 0), page, limit };
  }

  async resolveAlert(alertId, payload, actorUserId) {
    const alert = positiveId(alertId, 'id_alert');
    const body = object(payload);
    allowFields(body, ['status']);
    const status = enumValue(body.status, 'status', new Set(['CONTACTED', 'DISMISSED']));
    return this.transaction(async (conn) => {
      const userId = await this.authorize(conn, actorUserId, ['MV_FOLLOWUPS_WRITE']);
      const [rows] = await conn.query(`
        SELECT id_alert, status FROM erp_membership_alerts
        WHERE id_alert = ? LIMIT 1 FOR UPDATE
      `, [alert]);
      if (!rows.length) throw new NotFoundException('Alerta no encontrada');
      if (rows[0].status !== 'PENDING') {
        throw new ConflictException('La alerta ya fue atendida. No se puede cambiar su historial');
      }
      await conn.query(`
        UPDATE erp_membership_alerts
        SET status = ?, resolved_at = UTC_TIMESTAMP(), resolved_by = ?
        WHERE id_alert = ? AND status = 'PENDING'
      `, [status, userId, alert]);
      await this.audit(conn, userId, 'ALERT_RESOLVE', 'erp_membership_alerts', alert,
        `Cambió alerta #${alert} a ${status}`);
      return { id_alert: alert, status, resolved_by: userId };
    });
  }

  // Fuente de datos para la pantalla de «clientes que dejaron de asistir».
  // Siempre comprueba fechas contra el reloj de Bolivia y usa asistencias reales.
  async listInactiveCustomers(filters = {}, actorUserId) {
    const f = filterObject(filters, ['page', 'limit', 'id_plan', 'min_days']);
    await this.authorize(this.db, actorUserId, ['MV_VIEW', 'MV_FOLLOWUPS_WRITE', 'MV_REPORTS_READ']);
    const { page, limit, offset } = pageInfo(f);
    const { inactivity_days } = await this.settings();
    const days = f.min_days == null || f.min_days === '' ? inactivity_days : positiveId(f.min_days, 'min_days');
    if (days > 365) throw new BadRequestException('min_days no puede superar 365');
    const params = [];
    const planClause = f.id_plan != null && f.id_plan !== '' ? 'AND m.id_plan = ?' : '';
    if (planClause) params.push(positiveId(f.id_plan, 'id_plan'));
    // Seleccionar una sola membresía por cliente: la vigente más reciente.
    const base = `
      FROM memberships m
      JOIN customers c ON c.id_customer = m.id_customer
      JOIN membership_plans pl ON pl.id_plan = m.id_plan
      LEFT JOIN (
        SELECT id_membership, MAX(attendance_date) AS last_attendance_date
        FROM customer_attendances GROUP BY id_membership
      ) att ON att.id_membership = m.id_membership
      WHERE c.status = 'ACTIVE' AND m.status = 'ACTIVE'
        AND m.start_date <= ${BUSINESS_TODAY} AND m.end_date >= ${BUSINESS_TODAY}
        ${planClause}
        AND NOT EXISTS (
          SELECT 1 FROM memberships m2
          WHERE m2.id_customer = m.id_customer
            AND m2.id_membership <> m.id_membership
            AND m2.status = 'ACTIVE'
            AND m2.start_date <= ${BUSINESS_TODAY}
            AND m2.end_date >= ${BUSINESS_TODAY}
            AND (m2.start_date > m.start_date OR
              (m2.start_date = m.start_date AND m2.id_membership > m.id_membership))
        )
        AND DATEDIFF(${BUSINESS_TODAY},
          GREATEST(COALESCE(att.last_attendance_date, m.start_date), m.start_date)) >= ?
    `;
    params.push(days);
    const [countRows] = await this.db.query(`SELECT COUNT(*) AS total ${base}`, params);
    const [rows] = await this.db.query(`
      SELECT c.id_customer, c.first_name, c.last_name, c.phone, c.email,
        m.id_membership, m.id_plan, pl.plan_name,
        DATE_FORMAT(m.end_date, '%Y-%m-%d') AS end_date,
        DATE_FORMAT(att.last_attendance_date, '%Y-%m-%d') AS last_attendance_date,
        DATEDIFF(${BUSINESS_TODAY},
          GREATEST(COALESCE(att.last_attendance_date, m.start_date), m.start_date)) AS days_inactive
      ${base}
      ORDER BY days_inactive DESC, c.id_customer DESC LIMIT ? OFFSET ?
    `, [...params, limit, offset]);
    return { items: rows, total: Number(countRows[0]?.total || 0), page, limit,
      inactivity_threshold_days: days };
  }

  async findCustomer(conn, customerId, { lock = false } = {}) {
    const [rows] = await conn.query(`
      SELECT id_customer, status FROM customers WHERE id_customer = ? LIMIT 1
      ${lock ? ' FOR UPDATE' : ''}
    `, [customerId]);
    if (!rows.length) throw new NotFoundException('Cliente no encontrado');
    if (rows[0].status !== 'ACTIVE') throw new ConflictException('El cliente está inactivo');
    return rows[0];
  }

  async findMembership(conn, membershipId, customerId, { lock = false } = {}) {
    const [rows] = await conn.query(`
      SELECT id_membership, id_customer, status, id_plan,
        DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date,
        DATE_FORMAT(end_date, '%Y-%m-%d') AS end_date
      FROM memberships WHERE id_membership = ? LIMIT 1 ${lock ? ' FOR UPDATE' : ''}
    `, [membershipId]);
    if (!rows.length) throw new NotFoundException('Membresía no encontrada');
    if (Number(rows[0].id_customer) !== customerId) {
      throw new ConflictException('La membresía no corresponde al cliente');
    }
    return rows[0];
  }

  async findRenewal(conn, renewalId, customerId, { lock = false } = {}) {
    const [rows] = await conn.query(`
      SELECT id_renewal_request, id_customer, id_previous_membership,
        id_new_membership, status FROM erp_renewal_requests
      WHERE id_renewal_request = ? LIMIT 1 ${lock ? ' FOR UPDATE' : ''}
    `, [renewalId]);
    if (!rows.length) throw new NotFoundException('Solicitud de renovación no encontrada');
    if (Number(rows[0].id_customer) !== customerId) {
      throw new ConflictException('La solicitud no corresponde al cliente');
    }
    return rows[0];
  }

  async listFollowups(filters = {}, actorUserId) {
    const f = filterObject(filters, ['page', 'limit', 'id_customer', 'reason', 'result', 'responsible_user', 'due_only']);
    await this.authorize(this.db, actorUserId, ['MV_VIEW', 'MV_FOLLOWUPS_WRITE', 'MV_REPORTS_READ']);
    const { page, limit, offset } = pageInfo(f);
    const conditions = [];
    const params = [];
    if (f.id_customer != null && f.id_customer !== '') {
      conditions.push('f.id_customer = ?'); params.push(positiveId(f.id_customer, 'id_customer'));
    }
    if (f.reason != null && f.reason !== '') {
      conditions.push('f.reason = ?'); params.push(enumValue(f.reason, 'reason', FOLLOWUP_REASONS));
    }
    if (f.result != null && f.result !== '') {
      conditions.push('f.result = ?'); params.push(enumValue(f.result, 'result', FOLLOWUP_RESULTS));
    }
    if (f.responsible_user != null && f.responsible_user !== '') {
      conditions.push('f.responsible_user = ?'); params.push(positiveId(f.responsible_user, 'responsible_user'));
    }
    if (f.due_only != null && f.due_only !== '') {
      if (!['true', 'false', true, false].includes(f.due_only)) {
        throw new BadRequestException('due_only debe ser true o false');
      }
      if (f.due_only === 'true' || f.due_only === true) {
        conditions.push('f.next_action_at IS NOT NULL AND f.next_action_at <= UTC_TIMESTAMP()');
        conditions.push("f.result IN ('PENDING', 'CONTACTED', 'NO_RESPONSE')");
      }
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const from = `FROM erp_commercial_followups f
      JOIN customers c ON c.id_customer = f.id_customer
      JOIN users u ON u.id_user = f.responsible_user`;
    const [countRows] = await this.db.query(`SELECT COUNT(*) AS total ${from} ${where}`, params);
    const [rows] = await this.db.query(`
      SELECT f.id_followup, f.id_customer, c.first_name, c.last_name,
        c.phone, c.email, f.id_membership, f.id_renewal_request,
        f.reason, f.contact_method, f.contact_date, f.result, f.notes,
        f.next_action_at, f.responsible_user, u.username AS responsible_username
      ${from} ${where}
      ORDER BY f.contact_date DESC, f.id_followup DESC LIMIT ? OFFSET ?
    `, [...params, limit, offset]);
    return { items: rows, total: Number(countRows[0]?.total || 0), page, limit };
  }

  async getFollowupById(followupId, actorUserId) {
    await this.authorize(this.db, actorUserId, ['MV_VIEW', 'MV_FOLLOWUPS_WRITE', 'MV_REPORTS_READ']);
    const followup = positiveId(followupId, 'id_followup');
    const [rows] = await this.db.query(`
      SELECT f.id_followup, f.id_customer, f.id_membership, f.id_renewal_request,
        f.reason, f.contact_method, f.contact_date, f.result, f.notes,
        f.next_action_at, f.responsible_user
      FROM erp_commercial_followups f WHERE f.id_followup = ? LIMIT 1
    `, [followup]);
    if (!rows.length) throw new NotFoundException('Seguimiento no encontrado');
    return rows[0];
  }

  async createFollowup(payload, actorUserId) {
    const b = object(payload);
    allowFields(b, ['id_customer', 'id_membership', 'id_renewal_request',
      'reason', 'contact_method', 'result', 'notes', 'next_action_at']);
    const customer = positiveId(b.id_customer, 'id_customer');
    const membership = b.id_membership == null ? null : positiveId(b.id_membership, 'id_membership');
    const renewal = b.id_renewal_request == null ? null : positiveId(b.id_renewal_request, 'id_renewal_request');
    const reason = enumValue(b.reason, 'reason', FOLLOWUP_REASONS);
    const method = enumValue(b.contact_method, 'contact_method', CONTACT_METHODS);
    const result = b.result == null ? 'PENDING' : enumValue(b.result, 'result', FOLLOWUP_RESULTS);
    const notes = text(b.notes, 'Las notas', 2000);
    const nextAction = utcDateTime(b.next_action_at, 'next_action_at', { optional: true });
    if (nextAction && nextAction <= new Date().toISOString().slice(0, 19).replace('T', ' ')) {
      throw new BadRequestException('La próxima acción debe tener una fecha futura');
    }
    if (['RENEWAL_ACCEPTED', 'DECLINED'].includes(result) && nextAction) {
      throw new BadRequestException('Un seguimiento cerrado no puede tener próxima acción');
    }
    return this.transaction(async (conn) => {
      const actorId = await this.authorize(conn, actorUserId, ['MV_FOLLOWUPS_WRITE']);
      await this.findCustomer(conn, customer);
      if (membership != null) await this.findMembership(conn, membership, customer);
      if (renewal != null) {
        const r = await this.findRenewal(conn, renewal, customer);
        if (membership != null && membership !== Number(r.id_previous_membership) &&
            membership !== Number(r.id_new_membership)) {
          throw new ConflictException('La membresía no corresponde a la solicitud vinculada');
        }
      }
      const [inserted] = await conn.query(`
        INSERT INTO erp_commercial_followups
          (id_customer, id_membership, id_renewal_request, reason,
           contact_method, contact_date, result, notes, next_action_at, responsible_user)
        VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(), ?, ?, ?, ?)
      `, [customer, membership, renewal, reason, method, result, notes, nextAction, actorId]);
      await this.audit(conn, actorId, 'FOLLOWUP_CREATE', 'erp_commercial_followups', inserted.insertId,
        `Registró contacto de cliente #${customer}: ${reason}/${method}/${result}`);
      return { id_followup: inserted.insertId, id_customer: customer,
        id_membership: membership, id_renewal_request: renewal, reason,
        contact_method: method, result, notes, next_action_at: nextAction,
        responsible_user: actorId };
    });
  }

  async updateFollowup(followupId, payload, actorUserId) {
    const followup = positiveId(followupId, 'id_followup');
    const b = object(payload);
    allowFields(b, ['result', 'notes', 'next_action_at']);
    if (!Object.keys(b).length) throw new BadRequestException('Indica al menos un campo para actualizar');
    const result = own(b, 'result') ? enumValue(b.result, 'result', FOLLOWUP_RESULTS) : undefined;
    const notes = own(b, 'notes') ? text(b.notes, 'Las notas', 2000) : undefined;
    const nextAction = own(b, 'next_action_at') ?
      utcDateTime(b.next_action_at, 'next_action_at', { optional: true }) : undefined;
    if (nextAction && nextAction <= new Date().toISOString().slice(0, 19).replace('T', ' ')) {
      throw new BadRequestException('La próxima acción debe tener una fecha futura');
    }
    return this.transaction(async (conn) => {
      const actorId = await this.authorize(conn, actorUserId, ['MV_FOLLOWUPS_WRITE']);
      const [rows] = await conn.query(`
        SELECT id_followup, id_customer, result, notes, next_action_at, responsible_user
        FROM erp_commercial_followups WHERE id_followup = ? LIMIT 1 FOR UPDATE
      `, [followup]);
      if (!rows.length) throw new NotFoundException('Seguimiento no encontrado');
      // No permitir modificar registros de otro responsable salvo permiso de gestión.
      if (Number(rows[0].responsible_user) !== actorId) {
        await this.authorize(conn, actorId, ['MV_PROMOTIONS_MANAGE']);
      }
      const mergedResult = result === undefined ? rows[0].result : result;
      const mergedNotes = notes === undefined ? rows[0].notes : notes;
      const mergedNext = nextAction === undefined ? rows[0].next_action_at : nextAction;
      if (mergedResult === 'RENEWAL_ACCEPTED' || mergedResult === 'DECLINED') {
        if (mergedNext != null) throw new BadRequestException('Un seguimiento cerrado no puede tener próxima acción');
      }
      await conn.query(`
        UPDATE erp_commercial_followups
        SET result = ?, notes = ?, next_action_at = ? WHERE id_followup = ?
      `, [mergedResult, mergedNotes, mergedNext, followup]);
      await this.audit(conn, actorId, 'FOLLOWUP_UPDATE', 'erp_commercial_followups', followup,
        `Actualizó el seguimiento #${followup} a ${mergedResult}`);
      return { id_followup: followup, result: mergedResult, notes: mergedNotes,
        next_action_at: mergedNext };
    });
  }

  // Solicitud comercial. La creación REAL de una nueva membresía se hace en
  // POST /memberships/:id/renew y el cobro en /api/erp/payments. No duplicar.
  async createRenewalRequest(payload, actorUserId) {
    const b = object(payload);
    allowFields(b, ['id_previous_membership', 'id_new_membership', 'notes']);
    const previousId = positiveId(b.id_previous_membership, 'id_previous_membership');
    const nextId = b.id_new_membership == null ? null : positiveId(b.id_new_membership, 'id_new_membership');
    if (nextId === previousId) throw new BadRequestException('La nueva membresía debe ser distinta de la anterior');
    const notes = text(b.notes, 'Las notas', 2000);
    return this.transaction(async (conn) => {
      const userId = await this.authorize(conn, actorUserId, ['MV_FOLLOWUPS_WRITE']);
      const [previousRows] = await conn.query(`
        SELECT id_membership, id_customer, status,
          DATE_FORMAT(end_date, '%Y-%m-%d') AS end_date
        FROM memberships WHERE id_membership = ? LIMIT 1 FOR UPDATE
      `, [previousId]);
      if (!previousRows.length) throw new NotFoundException('Membresía anterior no encontrada');
      const previous = previousRows[0];
      if (!['ACTIVE', 'EXPIRED'].includes(previous.status)) {
        throw new ConflictException('Solo se pueden solicitar renovaciones de membresías activas o vencidas');
      }
      await this.findCustomer(conn, Number(previous.id_customer));
      const [oldRequests] = await conn.query(`
        SELECT id_renewal_request, status FROM erp_renewal_requests
        WHERE id_previous_membership = ? AND status IN ('REQUESTED','COMPLETED')
        LIMIT 1 FOR UPDATE
      `, [previousId]);
      if (oldRequests.length) {
        throw new ConflictException('Esta membresía ya tiene una solicitud pendiente o completada');
      }
      if (nextId != null) {
        const next = await this.findMembership(conn, nextId, Number(previous.id_customer), { lock: true });
        if (next.status !== 'PENDING' || next.start_date <= previous.end_date) {
          throw new ConflictException('La membresía nueva debe estar pendiente y comenzar después de la anterior');
        }
        const [linked] = await conn.query(`
          SELECT id_renewal_request FROM erp_renewal_requests
          WHERE id_new_membership = ? LIMIT 1 FOR UPDATE
        `, [nextId]);
        if (linked.length) throw new ConflictException('La nueva membresía ya está vinculada a otra solicitud');
        const [paid] = await conn.query(`
          SELECT id_payment FROM payments WHERE id_membership = ? LIMIT 1 FOR UPDATE
        `, [nextId]);
        if (paid.length) throw new ConflictException('La membresía nueva ya tiene historial de pago');
      }
      const [inserted] = await conn.query(`
        INSERT INTO erp_renewal_requests
          (id_customer, id_previous_membership, id_new_membership, status, requested_by, notes)
        VALUES (?, ?, ?, 'REQUESTED', ?, ?)
      `, [previous.id_customer, previousId, nextId, userId, notes]);
      await this.audit(conn, userId, 'RENEWAL_REQUEST', 'erp_renewal_requests', inserted.insertId,
        `Solicitud de renovación de membresía #${previousId}${nextId ? ` a #${nextId}` : ''}`);
      return { id_renewal_request: inserted.insertId, id_customer: previous.id_customer,
        id_previous_membership: previousId, id_new_membership: nextId,
        status: 'REQUESTED', notes };
    });
  }

  async listRenewalRequests(filters = {}, actorUserId) {
    const f = filterObject(filters, ['page', 'limit', 'status', 'id_customer']);
    await this.authorize(this.db, actorUserId, ['MV_VIEW', 'MV_FOLLOWUPS_WRITE', 'MV_REPORTS_READ']);
    const { page, limit, offset } = pageInfo(f);
    const conditions = [];
    const params = [];
    if (f.status != null && f.status !== '') {
      conditions.push('r.status = ?'); params.push(enumValue(f.status, 'status', RENEWAL_STATUSES));
    }
    if (f.id_customer != null && f.id_customer !== '') {
      conditions.push('r.id_customer = ?'); params.push(positiveId(f.id_customer, 'id_customer'));
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const from = `FROM erp_renewal_requests r
      JOIN customers c ON c.id_customer = r.id_customer
      JOIN memberships prior ON prior.id_membership = r.id_previous_membership`;
    const [countRows] = await this.db.query(`SELECT COUNT(*) AS total ${from} ${where}`, params);
    const [rows] = await this.db.query(`
      SELECT r.id_renewal_request, r.id_customer, c.first_name, c.last_name,
        r.id_previous_membership, r.id_new_membership, r.status,
        r.requested_by, r.requested_at, r.completed_at, r.notes,
        DATE_FORMAT(prior.end_date, '%Y-%m-%d') AS previous_end_date
      ${from} ${where}
      ORDER BY r.id_renewal_request DESC LIMIT ? OFFSET ?
    `, [...params, limit, offset]);
    return { items: rows, total: Number(countRows[0]?.total || 0), page, limit };
  }

  async rejectRenewalRequest(renewalId, payload, actorUserId) {
    const requestId = positiveId(renewalId, 'id_renewal_request');
    const b = object(payload);
    allowFields(b, ['status', 'notes']);
    const status = enumValue(b.status, 'status', new Set(['REJECTED', 'CANCELLED']));
    const notes = text(b.notes, 'Las notas', 2000, { required: true });
    return this.transaction(async (conn) => {
      const userId = await this.authorize(conn, actorUserId, ['MV_FOLLOWUPS_WRITE']);
      const [rows] = await conn.query(`
        SELECT id_renewal_request, status, id_new_membership
        FROM erp_renewal_requests WHERE id_renewal_request = ? LIMIT 1 FOR UPDATE
      `, [requestId]);
      if (!rows.length) throw new NotFoundException('Solicitud de renovación no encontrada');
      if (rows[0].status !== 'REQUESTED') {
        throw new ConflictException('Solo se pueden cerrar solicitudes todavía pendientes');
      }
      if (rows[0].id_new_membership != null) {
        throw new ConflictException('La solicitud tiene una membresía vinculada. Revísala desde Operaciones y Finanzas');
      }
      await conn.query(`
        UPDATE erp_renewal_requests SET status = ?, notes = ?
        WHERE id_renewal_request = ? AND status = 'REQUESTED'
      `, [status, notes, requestId]);
      await this.audit(conn, userId, 'RENEWAL_CLOSE', 'erp_renewal_requests', requestId,
        `Cerró solicitud #${requestId}: ${status}. ${notes}`);
      return { id_renewal_request: requestId, status, notes };
    });
  }

  async getCommercialReport(filters = {}, actorUserId) {
    const f = filterObject(filters, ['from', 'to']);
    await this.authorize(this.db, actorUserId, ['MV_REPORTS_READ']);
    const now = await this.db.query(`SELECT DATE_FORMAT(${BUSINESS_TODAY}, '%Y-%m-%d') AS today`);
    const today = now[0][0].today;
    const to = f.to == null || f.to === '' ? today : dateOnly(f.to, 'to');
    const fromDefault = new Date(`${to}T00:00:00.000Z`);
    fromDefault.setUTCDate(fromDefault.getUTCDate() - 29);
    const from = f.from == null || f.from === '' ? fromDefault.toISOString().slice(0, 10) : dateOnly(f.from, 'from');
    const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000;
    if (days < 0 || days > 366) {
      throw new BadRequestException('El rango debe estar ordenado y no superar 367 días inclusivos');
    }
    const salesFrom = `FROM payments p
      JOIN memberships m ON m.id_membership = p.id_membership
      JOIN membership_plans pl ON pl.id_plan = m.id_plan
      LEFT JOIN erp_promotion_applications a ON a.id_membership = m.id_membership
      LEFT JOIN erp_renewal_requests r
        ON r.id_new_membership = m.id_membership AND r.status = 'COMPLETED'
      WHERE p.status = 'REGISTERED'
        AND DATE(p.payment_date - INTERVAL 4 HOUR) BETWEEN ? AND ?`;
    const [salesRows] = await this.db.query(`
      SELECT COUNT(DISTINCT p.id_payment) AS sales_count,
        COALESCE(SUM(p.amount),0) AS revenue,
        COALESCE(SUM(a.discount_amount),0) AS total_discounts,
        COUNT(DISTINCT r.id_renewal_request) AS completed_renewals,
        COUNT(DISTINCT CASE WHEN a.id_application IS NOT NULL THEN p.id_payment END) AS promoted_sales
      ${salesFrom}
    `, [from, to]);
    const [plans] = await this.db.query(`
      SELECT m.id_plan, pl.plan_name,
        COUNT(DISTINCT p.id_payment) AS sales_count,
        COALESCE(SUM(p.amount),0) AS revenue,
        COUNT(DISTINCT r.id_renewal_request) AS renewals,
        COUNT(DISTINCT CASE WHEN a.id_application IS NOT NULL THEN p.id_payment END) AS promoted_sales
      ${salesFrom}
      GROUP BY m.id_plan, pl.plan_name ORDER BY sales_count DESC, revenue DESC
    `, [from, to]);
    const [promotions] = await this.db.query(`
      SELECT a.id_promotion, promo.name AS promotion_name,
        COUNT(DISTINCT p.id_payment) AS uses,
        COALESCE(SUM(a.discount_amount), 0) AS total_discount,
        COALESCE(SUM(p.amount), 0) AS revenue
      FROM erp_promotion_applications a
      JOIN erp_promotions promo ON promo.id_promotion = a.id_promotion
      JOIN payments p ON p.id_membership = a.id_membership AND p.status = 'REGISTERED'
      WHERE DATE(p.payment_date - INTERVAL 4 HOUR) BETWEEN ? AND ?
      GROUP BY a.id_promotion, promo.name ORDER BY uses DESC
    `, [from, to]);
    const [contacts] = await this.db.query(`
      SELECT result, COUNT(*) AS total FROM erp_commercial_followups
      WHERE DATE(contact_date - INTERVAL 4 HOUR) BETWEEN ? AND ?
      GROUP BY result
    `, [from, to]);
    const [requests] = await this.db.query(`
      SELECT status, COUNT(*) AS total FROM erp_renewal_requests
      WHERE DATE(requested_at - INTERVAL 4 HOUR) BETWEEN ? AND ?
      GROUP BY status
    `, [from, to]);
    return { from, to, summary: salesRows[0], sales_by_plan: plans,
      promotions, followups_by_result: contacts, renewal_requests_by_status: requests };
  }
}

module.exports = ErpMarketingService;
