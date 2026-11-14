'use strict';

// Gimnasio MQS - ERP / Marketing y Ventas - Promociones.
// Usa las tablas existentes erp_promotions y erp_promotion_applications.
// Instanciar con el pool mysql2/promise desde el controlador/rutas.
// El ID del usuario SIEMPRE debe provenir de req.auth.id_user (JWT validado).
// No registra pagos: Finanzas cobra el applied_price congelado de membreships.

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
  constructor(message) { super(409, message); }
}

const MAX_ID = 2147483647;
const MAX_AMOUNT_CENTS = 999999999999n; // DECIMAL(12,2)
const MAX_MEMBERSHIP_CENTS = 9999999999n; // DECIMAL(10,2)
const DISCOUNT_TYPES = new Set(['PERCENTAGE', 'FIXED_AMOUNT', 'NON_MONETARY']);
const PROMO_STATUSES = new Set(['ACTIVE', 'INACTIVE']);
const FIELD_KEYS = ['id_plan', 'name', 'description', 'discount_type',
  'discount_value', 'start_date', 'end_date', 'status'];
const OWN = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

function payloadObject(value, label = 'Los datos') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException(`${label} deben ser un objeto JSON`);
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new BadRequestException(`${label} tienen un formato inválido`);
  }
  return value;
}
function onlyFields(object, fields) {
  for (const key of Object.keys(object)) {
    if (!fields.includes(key)) {
      throw new BadRequestException(`Campo no permitido: ${key}`);
    }
  }
}
function id(value, label = 'ID') {
  const raw = typeof value === 'number' && Number.isSafeInteger(value)
    ? String(value) : typeof value === 'string' ? value : '';
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new BadRequestException(`${label} debe ser un entero positivo`);
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed > MAX_ID) {
    throw new BadRequestException(`${label} está fuera de rango`);
  }
  return parsed;
}
function decimalCents(value, label, { zero = false, max = MAX_AMOUNT_CENTS } = {}) {
  if (!['string', 'number'].includes(typeof value) ||
      (typeof value === 'number' && !Number.isFinite(value))) {
    throw new BadRequestException(`${label} debe ser un número decimal válido`);
  }
  const raw = String(value);
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(raw)) {
    throw new BadRequestException(`${label} admite como máximo dos decimales`);
  }
  const [integer, fraction = ''] = raw.split('.');
  const cents = BigInt(integer) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (cents > max || (cents === 0n && !zero)) {
    throw new BadRequestException(`${label} debe estar dentro del rango permitido`);
  }
  return cents;
}
function moneyString(cents) {
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}
function line(value, label, min, max, { optional = false } = {}) {
  if (optional && (value === null || value === undefined || value === '')) return null;
  if (typeof value !== 'string') throw new BadRequestException(`${label} debe ser texto`);
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new BadRequestException(`${label} contiene caracteres no permitidos`);
  }
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length < min || text.length > max) {
    throw new BadRequestException(`${label} debe tener entre ${min} y ${max} caracteres`);
  }
  return text;
}
function enumValue(value, label, options) {
  if (typeof value !== 'string' || !options.has(value)) {
    throw new BadRequestException(`${label} no es válido`);
  }
  return value;
}
function isoDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException(`${label} debe tener formato AAAA-MM-DD`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException(`${label} no es una fecha válida`);
  }
  return value;
}
function pageSize(filters) {
  const page = filters.page == null ? 1 : id(filters.page, 'page');
  const limit = filters.limit == null ? 20 : id(filters.limit, 'limit');
  if (page > 100000 || limit > 100) {
    throw new BadRequestException('page debe ser <= 100000 y limit <= 100');
  }
  return { page, limit, offset: (page - 1) * limit };
}
function hasValidRolePermission(rows) {
  return Array.isArray(rows) && rows.length > 0;
}
function validateDiscount(type, value, description) {
  const discountType = enumValue(type, 'discount_type', DISCOUNT_TYPES);
  const amount = decimalCents(value, 'discount_value', { zero: true });
  if (discountType === 'PERCENTAGE') {
    // 100% no es cobrable: el módulo de Pagos no admite cobros de importe cero.
    if (amount === 0n || amount >= 10000n) {
      throw new BadRequestException('El descuento porcentual debe ser mayor a 0 y menor a 100');
    }
  } else if (discountType === 'FIXED_AMOUNT') {
    if (amount === 0n) throw new BadRequestException('El descuento fijo debe ser mayor a cero');
  } else {
    if (amount !== 0n) {
      throw new BadRequestException('Un beneficio no monetario debe tener discount_value = 0');
    }
    if (!description) {
      throw new BadRequestException('Describe el beneficio no monetario');
    }
  }
  return { discountType, valueCents: amount, discountValue: moneyString(amount) };
}
function computeDiscount(priceCents, type, valueCents) {
  let discount = 0n;
  if (type === 'FIXED_AMOUNT') discount = valueCents;
  if (type === 'PERCENTAGE') {
    // Redondeo exacto HALF-UP al centavo, sin errores de punto flotante.
    // valueCents = puntos básicos: 12.50 % => 1250 / 10000.
    discount = (priceCents * valueCents + 5000n) / 10000n;
  }
  if (discount >= priceCents) {
    throw new ConflictException('El descuento deja el precio en cero o negativo; Pagos exige un importe positivo');
  }
  return {
    base_price: moneyString(priceCents),
    discount_amount: moneyString(discount),
    final_price: moneyString(priceCents - discount),
  };
}
function currentPromotion(record, businessDate) {
  if (record.status !== 'ACTIVE') throw new ConflictException('La promoción está inactiva');
  if (record.start_date > businessDate || record.end_date < businessDate) {
    throw new ConflictException('La promoción no está vigente en la fecha de hoy');
  }
}
function promotionRowSql(forUpdate = false) {
  return `
    SELECT id_promotion, id_plan, name, description, discount_type,
           discount_value, DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date,
           DATE_FORMAT(end_date, '%Y-%m-%d') AS end_date,
           status, created_by, created_at, updated_at
    FROM erp_promotions WHERE id_promotion = ? LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}
  `;
}

class ErpPromotionsService {
  constructor(db) {
    if (!db || typeof db.query !== 'function' || typeof db.getConnection !== 'function') {
      throw new TypeError('Se requiere el pool mysql2/promise con query() y getConnection()');
    }
    this.db = db;
  }

  async transaction(handler) {
    const conn = await this.db.getConnection();
    let started = false;
    try {
      await conn.beginTransaction();
      started = true;
      const result = await handler(conn);
      await conn.commit();
      started = false;
      return result;
    } catch (error) {
      if (started) {
        try { await conn.rollback(); } catch (rollbackError) {
          console.error('No se pudo revertir la transacción de promociones:',
            rollbackError.code || rollbackError.message);
        }
      }
      if (['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(error.code)) {
        throw new ConflictException('Registro ocupado por otra operación. Actualiza y vuelve a intentar');
      }
      if (error.code === 'ER_DUP_ENTRY') {
        throw new ConflictException('Ya existe un registro con estos datos o la promoción ya se aplicó');
      }
      throw error;
    } finally {
      conn.release();
    }
  }

  async authorize(executor, actorUserId, permissions) {
    const actorId = id(actorUserId, 'Usuario autenticado');
    if (!Array.isArray(permissions) || permissions.length === 0) {
      throw new TypeError('No se configuraron permisos para la operación');
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
    if (!hasValidRolePermission(rows)) throw new ForbiddenException();
    return actorId;
  }

  async businessDate(executor) {
    // Bolivia UTC-04:00, independientemente de la zona del PC o del servidor.
    const [rows] = await executor.query(`
      SELECT DATE_FORMAT(UTC_TIMESTAMP() - INTERVAL 4 HOUR, '%Y-%m-%d') AS business_date
    `);
    const date = rows[0]?.business_date;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error('No se pudo determinar la fecha de negocio');
    }
    return date;
  }

  async findPromotion(executor, promotionId, { lock = false } = {}) {
    const [rows] = await executor.query(promotionRowSql(lock), [promotionId]);
    if (!rows.length) throw new NotFoundException('Promoción no encontrada');
    return rows[0];
  }

  async plan(executor, planId, { lock = false } = {}) {
    const [rows] = await executor.query(`
      SELECT id_plan, plan_name, price, status
      FROM membership_plans WHERE id_plan = ? LIMIT 1${lock ? ' FOR UPDATE' : ''}
    `, [planId]);
    if (!rows.length) throw new NotFoundException('Plan de membresía no encontrado');
    return rows[0];
  }

  async audit(conn, actorId, action, promotionId, description) {
    await conn.query(`
      INSERT INTO audit_logs
        (id_user, module, action, table_name, record_id, creationDate, description)
      VALUES (?, 'MARKETING', ?, 'erp_promotions', ?, UTC_TIMESTAMP(), ?)
    `, [actorId, action, promotionId, description]);
  }

  validateNewData(body) {
    const input = payloadObject(body);
    onlyFields(input, FIELD_KEYS);
    const idPlan = id(input.id_plan, 'id_plan');
    const name = line(input.name, 'El nombre de la promoción', 3, 100);
    const description = line(input.description, 'La descripción', 1, 255, { optional: true });
    const data = validateDiscount(input.discount_type, input.discount_value, description);
    const startDate = isoDate(input.start_date, 'start_date');
    const endDate = isoDate(input.end_date, 'end_date');
    if (endDate < startDate) {
      throw new BadRequestException('end_date no puede ser anterior a start_date');
    }
    const status = input.status == null ? 'ACTIVE' : enumValue(input.status, 'status', PROMO_STATUSES);
    return { idPlan, name, description, ...data, startDate, endDate, status };
  }

  async listPromotions(filters = {}, actorUserId) {
    const query = payloadObject(filters, 'Los filtros');
    onlyFields(query, ['page', 'limit', 'id_plan', 'status', 'search', 'valid_today']);
    await this.authorize(this.db, actorUserId, ['MV_VIEW', 'MV_PROMOTIONS_MANAGE']);
    const { page, limit, offset } = pageSize(query);
    const conditions = [];
    const params = [];
    if (query.id_plan != null && query.id_plan !== '') {
      conditions.push('p.id_plan = ?');
      params.push(id(query.id_plan, 'id_plan'));
    }
    if (query.status != null && query.status !== '') {
      conditions.push('p.status = ?');
      params.push(enumValue(query.status, 'status', PROMO_STATUSES));
    }
    if (query.search != null && query.search !== '') {
      const search = line(query.search, 'search', 1, 100);
      conditions.push('(p.name LIKE ? OR p.description LIKE ? OR pl.plan_name LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (query.valid_today != null) {
      if (query.valid_today !== 'true' && query.valid_today !== 'false' &&
          query.valid_today !== true && query.valid_today !== false) {
        throw new BadRequestException('valid_today debe ser true o false');
      }
      const valid = query.valid_today === 'true' || query.valid_today === true;
      const validSql = "(p.status = 'ACTIVE' AND p.start_date <= DATE(UTC_TIMESTAMP() - INTERVAL 4 HOUR) AND p.end_date >= DATE(UTC_TIMESTAMP() - INTERVAL 4 HOUR))";
      conditions.push(valid ? validSql : `NOT ${validSql}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [countRows] = await this.db.query(`
      SELECT COUNT(*) AS total FROM erp_promotions p
      JOIN membership_plans pl ON pl.id_plan = p.id_plan ${where}
    `, params);
    const [rows] = await this.db.query(`
      SELECT p.id_promotion, p.id_plan, pl.plan_name, pl.price AS current_plan_price,
             p.name, p.description, p.discount_type, p.discount_value,
             DATE_FORMAT(p.start_date, '%Y-%m-%d') AS start_date,
             DATE_FORMAT(p.end_date, '%Y-%m-%d') AS end_date,
             p.status, p.created_by, p.created_at, p.updated_at,
             CASE WHEN p.status = 'ACTIVE' AND
               DATE(UTC_TIMESTAMP() - INTERVAL 4 HOUR) BETWEEN p.start_date AND p.end_date THEN 1 ELSE 0 END AS is_current
      FROM erp_promotions p
      JOIN membership_plans pl ON pl.id_plan = p.id_plan ${where}
      ORDER BY p.id_promotion DESC LIMIT ? OFFSET ?
    `, [...params, limit, offset]);
    return { items: rows, total: Number(countRows[0]?.total || 0), page, limit };
  }

  async getPromotionById(promotionId, actorUserId) {
    await this.authorize(this.db, actorUserId, ['MV_VIEW', 'MV_PROMOTIONS_MANAGE']);
    const idPromotion = id(promotionId, 'id_promotion');
    const promo = await this.findPromotion(this.db, idPromotion);
    const [rows] = await this.db.query(`
      SELECT pl.plan_name, pl.price AS current_plan_price,
             COUNT(a.id_application) AS total_applications,
             COALESCE(SUM(a.discount_amount), 0) AS total_discount
      FROM membership_plans pl
      LEFT JOIN erp_promotion_applications a ON a.id_promotion = ?
      WHERE pl.id_plan = ?
      GROUP BY pl.id_plan, pl.plan_name, pl.price
    `, [idPromotion, promo.id_plan]);
    return { ...promo, ...rows[0] };
  }

  async createPromotion(payload, actorUserId) {
    const p = this.validateNewData(payload);
    return this.transaction(async (conn) => {
      const actorId = await this.authorize(conn, actorUserId, ['MV_PROMOTIONS_MANAGE']);
      const plan = await this.plan(conn, p.idPlan, { lock: true });
      if (plan.status !== 'ACTIVE' && p.status === 'ACTIVE') {
        throw new ConflictException('No se puede activar una promoción de un plan inactivo');
      }
      if (p.discountType === 'FIXED_AMOUNT' &&
          p.valueCents >= decimalCents(plan.price, 'Precio del plan', { max: MAX_MEMBERSHIP_CENTS })) {
        throw new ConflictException('El descuento fijo debe ser menor al precio actual del plan');
      }
      const [result] = await conn.query(`
        INSERT INTO erp_promotions
          (id_plan, name, description, discount_type, discount_value,
           start_date, end_date, status, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [p.idPlan, p.name, p.description, p.discountType, p.discountValue,
        p.startDate, p.endDate, p.status, actorId]);
      await this.audit(conn, actorId, 'PROMOTION_CREATE', result.insertId,
        `Creó la promoción ${p.name} para el plan #${p.idPlan}`);
      return { id_promotion: result.insertId, ...{
        id_plan: p.idPlan, name: p.name, description: p.description,
        discount_type: p.discountType, discount_value: p.discountValue,
        start_date: p.startDate, end_date: p.endDate, status: p.status,
      } };
    });
  }

  async updatePromotion(promotionId, payload, actorUserId) {
    const idPromotion = id(promotionId, 'id_promotion');
    const body = payloadObject(payload);
    onlyFields(body, FIELD_KEYS.filter((key) => key !== 'status'));
    if (!Object.keys(body).length) throw new BadRequestException('Indica al menos un campo para actualizar');
    return this.transaction(async (conn) => {
      const actorId = await this.authorize(conn, actorUserId, ['MV_PROMOTIONS_MANAGE']);
      const old = await this.findPromotion(conn, idPromotion, { lock: true });
      const [uses] = await conn.query(`
        SELECT id_application FROM erp_promotion_applications
        WHERE id_promotion = ? LIMIT 1
      `, [idPromotion]);
      if (uses.length) {
        throw new ConflictException('Una promoción aplicada no puede editarse; solo puede desactivarse');
      }
      // No cambiar status aquí: usar changePromotionStatus() con auditoría propia.
      const merged = {
        id_plan: OWN(body, 'id_plan') ? body.id_plan : old.id_plan,
        name: OWN(body, 'name') ? body.name : old.name,
        description: OWN(body, 'description') ? body.description : old.description,
        discount_type: OWN(body, 'discount_type') ? body.discount_type : old.discount_type,
        discount_value: OWN(body, 'discount_value') ? body.discount_value : old.discount_value,
        start_date: OWN(body, 'start_date') ? body.start_date : old.start_date,
        end_date: OWN(body, 'end_date') ? body.end_date : old.end_date,
        status: old.status,
      };
      const p = this.validateNewData(merged);
      const plan = await this.plan(conn, p.idPlan);
      if (plan.status !== 'ACTIVE' && p.status === 'ACTIVE') {
        throw new ConflictException('No se puede activar una promoción de un plan inactivo');
      }
      if (p.discountType === 'FIXED_AMOUNT' &&
          p.valueCents >= decimalCents(plan.price, 'Precio del plan', { max: MAX_MEMBERSHIP_CENTS })) {
        throw new ConflictException('El descuento fijo debe ser menor al precio actual del plan');
      }
      await conn.query(`
        UPDATE erp_promotions
        SET id_plan = ?, name = ?, description = ?, discount_type = ?, discount_value = ?,
            start_date = ?, end_date = ?
        WHERE id_promotion = ?
      `, [p.idPlan, p.name, p.description, p.discountType, p.discountValue,
        p.startDate, p.endDate, idPromotion]);
      await this.audit(conn, actorId, 'PROMOTION_UPDATE', idPromotion,
        `Actualizó la promoción #${idPromotion}`);
      return { id_promotion: idPromotion, id_plan: p.idPlan, name: p.name,
        description: p.description, discount_type: p.discountType,
        discount_value: p.discountValue, start_date: p.startDate,
        end_date: p.endDate, status: p.status };
    });
  }

  async changePromotionStatus(promotionId, payload, actorUserId) {
    const idPromotion = id(promotionId, 'id_promotion');
    const body = payloadObject(payload);
    onlyFields(body, ['status']);
    const status = enumValue(body.status, 'status', PROMO_STATUSES);
    return this.transaction(async (conn) => {
      const actorId = await this.authorize(conn, actorUserId, ['MV_PROMOTIONS_MANAGE']);
      const promo = await this.findPromotion(conn, idPromotion, { lock: true });
      if (status === 'ACTIVE') {
        const plan = await this.plan(conn, promo.id_plan);
        if (plan.status !== 'ACTIVE') {
          throw new ConflictException('No se puede activar una promoción de un plan inactivo');
        }
      }
      if (promo.status !== status) {
        await conn.query('UPDATE erp_promotions SET status = ? WHERE id_promotion = ?',
          [status, idPromotion]);
        await this.audit(conn, actorId, 'PROMOTION_STATUS', idPromotion,
          `Cambió el estado de la promoción #${idPromotion} de ${promo.status} a ${status}`);
      }
      return { id_promotion: idPromotion, status };
    });
  }

  async membershipForPromotion(executor, membershipId, { lock = false } = {}) {
    const [rows] = await executor.query(`
      SELECT id_membership, id_customer, id_plan, applied_price, status
      FROM memberships WHERE id_membership = ? LIMIT 1${lock ? ' FOR UPDATE' : ''}
    `, [membershipId]);
    if (!rows.length) throw new NotFoundException('Membresía no encontrada');
    if (rows[0].status !== 'PENDING') {
      throw new ConflictException('Solo se aplican promociones a membresías pendientes de pago');
    }
    return rows[0];
  }

  async calculateMembership(executor, membershipId, promotionId, { lock = false } = {}) {
    const membership = await this.membershipForPromotion(executor, membershipId, { lock });
    const promotion = await this.findPromotion(executor, promotionId, { lock });
    if (Number(promotion.id_plan) !== Number(membership.id_plan)) {
      throw new ConflictException('La promoción no corresponde al plan de esta membresía');
    }
    const today = await this.businessDate(executor);
    currentPromotion(promotion, today);
    const plan = await this.plan(executor, membership.id_plan);
    if (plan.status !== 'ACTIVE') {
      throw new ConflictException('El plan de la membresía está inactivo');
    }
    const [customerRows] = await executor.query(`
      SELECT status FROM customers WHERE id_customer = ? LIMIT 1
    `, [membership.id_customer]);
    if (!customerRows.length || customerRows[0].status !== 'ACTIVE') {
      throw new ConflictException('El cliente debe estar activo');
    }
    const [prior] = await executor.query(`
      SELECT id_application FROM erp_promotion_applications
      WHERE id_membership = ? LIMIT 1${lock ? ' FOR UPDATE' : ''}
    `, [membershipId]);
    if (prior.length) throw new ConflictException('Esta membresía ya tiene una promoción aplicada');
    const [payments] = await executor.query(`
      SELECT id_payment FROM payments WHERE id_membership = ? LIMIT 1${lock ? ' FOR UPDATE' : ''}
    `, [membershipId]);
    if (payments.length) {
      throw new ConflictException('Esta membresía ya tiene historial de pago; no puede cambiarse su precio');
    }
    const basePrice = decimalCents(membership.applied_price, 'El precio de la membresía',
      { max: MAX_MEMBERSHIP_CENTS });
    const valueCents = decimalCents(promotion.discount_value, 'El valor del descuento', { zero: true });
    const amounts = computeDiscount(basePrice, promotion.discount_type, valueCents);
    return {
      id_membership: membershipId, id_promotion: promotionId,
      id_plan: membership.id_plan, promotion_name: promotion.name,
      discount_type: promotion.discount_type, discount_value: moneyString(valueCents),
      business_date: today, ...amounts,
    };
  }

  async quoteMembershipDiscount(payload, actorUserId) {
    const body = payloadObject(payload);
    onlyFields(body, ['id_membership', 'id_promotion']);
    const idMembership = id(body.id_membership, 'id_membership');
    const idPromotion = id(body.id_promotion, 'id_promotion');
    await this.authorize(this.db, actorUserId, ['MV_VIEW', 'MV_FOLLOWUPS_WRITE', 'MV_PROMOTIONS_MANAGE']);
    // Solo cotización: no reserva ni actualiza el precio. Se recalcula al aplicar.
    return this.calculateMembership(this.db, idMembership, idPromotion);
  }

  async applyPromotion(payload, actorUserId) {
    const body = payloadObject(payload);
    onlyFields(body, ['id_membership', 'id_promotion']);
    const idMembership = id(body.id_membership, 'id_membership');
    const idPromotion = id(body.id_promotion, 'id_promotion');
    return this.transaction(async (conn) => {
      const actorId = await this.authorize(conn, actorUserId,
        ['MV_FOLLOWUPS_WRITE', 'MV_PROMOTIONS_MANAGE']);
      // Misma fila FOR UPDATE que bloquea Finanzas antes del cobro: evita carreras.
      const amounts = await this.calculateMembership(conn, idMembership, idPromotion, { lock: true });
      const [inserted] = await conn.query(`
        INSERT INTO erp_promotion_applications
          (id_membership, id_promotion, base_price, discount_amount, final_price, applied_by)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [idMembership, idPromotion, amounts.base_price, amounts.discount_amount,
        amounts.final_price, actorId]);
      const [updated] = await conn.query(`
        UPDATE memberships SET applied_price = ?
        WHERE id_membership = ? AND status = 'PENDING'
      `, [amounts.final_price, idMembership]);
      if (updated.affectedRows !== 1) {
        throw new ConflictException('La membresía cambió mientras se aplicaba la promoción');
      }
      await this.audit(conn, actorId, 'PROMOTION_APPLY', idPromotion,
        `Aplicó la promoción #${idPromotion} a membresía #${idMembership}: ${amounts.base_price} - ${amounts.discount_amount} = ${amounts.final_price} Bs`);
      return { id_application: inserted.insertId, ...amounts };
    });
  }

  async listPromotionApplications(filters = {}, actorUserId) {
    const query = payloadObject(filters, 'Los filtros');
    onlyFields(query, ['id_promotion', 'id_membership', 'page', 'limit']);
    await this.authorize(this.db, actorUserId, ['MV_REPORTS_READ', 'MV_PROMOTIONS_MANAGE']);
    const { page, limit, offset } = pageSize(query);
    const conditions = [];
    const args = [];
    if (query.id_promotion != null && query.id_promotion !== '') {
      conditions.push('a.id_promotion = ?');
      args.push(id(query.id_promotion, 'id_promotion'));
    }
    if (query.id_membership != null && query.id_membership !== '') {
      conditions.push('a.id_membership = ?');
      args.push(id(query.id_membership, 'id_membership'));
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [countRows] = await this.db.query(`
      SELECT COUNT(*) AS total FROM erp_promotion_applications a ${where}
    `, args);
    const [rows] = await this.db.query(`
      SELECT a.id_application, a.id_membership, a.id_promotion,
             p.name AS promotion_name, p.discount_type, a.base_price,
             a.discount_amount, a.final_price, a.applied_by, a.applied_at,
             m.id_customer, m.id_plan, m.status AS membership_status
      FROM erp_promotion_applications a
      JOIN erp_promotions p ON p.id_promotion = a.id_promotion
      JOIN memberships m ON m.id_membership = a.id_membership
      ${where} ORDER BY a.id_application DESC LIMIT ? OFFSET ?
    `, [...args, limit, offset]);
    return { items: rows, total: Number(countRows[0]?.total || 0), page, limit };
  }
}

module.exports = ErpPromotionsService;
