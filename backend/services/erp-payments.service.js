'use strict';

// Gimnasio MQS - ERP / Finanzas
// Compatible con el pool de mysql2/promise usado en backend/server.js.
// NO acepta id_user desde el cliente: el actor debe provenir de una sesión
// verificada por middleware de autenticación (aún por integrar en el proyecto).

const {
  HttpError,
  BadRequestException,
  NotFoundException,
} = require('../middlewares/errors');

class ForbiddenException extends HttpError {
  constructor(message = 'No tienes permiso para realizar esta operación') {
    super(403, message);
  }
}
class ConflictException extends HttpError {
  constructor(message) { super(409, message); }
}

const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

function objectBody(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('El cuerpo debe ser un objeto JSON');
  }
  return value;
}

function allowedFields(body, fields) {
  for (const key of Object.keys(body)) {
    if (!fields.includes(key)) {
      throw new BadRequestException(`Campo no permitido: ${key}`);
    }
  }
}

function positiveId(value, name) {
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new BadRequestException(`${name} debe ser un identificador válido`);
  }
  const raw = String(value);
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new BadRequestException(`${name} debe ser un entero positivo`);
  }
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id > 2147483647) {
    throw new BadRequestException(`${name} está fuera de rango`);
  }
  return id;
}

function money(value, name = 'El importe') {
  if ((typeof value !== 'number' && typeof value !== 'string') ||
      (typeof value === 'number' && !Number.isFinite(value))) {
    throw new BadRequestException(`${name} debe ser un importe válido`);
  }
  const raw = String(value);
  if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(raw)) {
    throw new BadRequestException(`${name} debe tener como máximo dos decimales`);
  }
  const [whole, decimal = ''] = raw.split('.');
  const cents = BigInt(whole) * 100n + BigInt(decimal.padEnd(2, '0'));
  if (cents <= 0n || cents > 9999999999n) {
    throw new BadRequestException(`${name} debe ser mayor a cero y estar dentro del rango permitido`);
  }
  return {
    cents,
    decimal: `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`,
  };
}

function optionalText(value, name, maxLength) {
  if (value == null) return null;
  if (typeof value !== 'string') {
    throw new BadRequestException(`${name} debe ser texto`);
  }
  const text = value.trim();
  if (text.length > maxLength) {
    throw new BadRequestException(`${name} no puede superar ${maxLength} caracteres`);
  }
  return text || null;
}

function requiredReason(value) {
  const text = optionalText(value, 'El motivo', 500);
  if (!text || text.length < 10) {
    throw new BadRequestException('El motivo de anulación debe tener al menos 10 caracteres');
  }
  return text;
}

function dateISO(value, fieldName) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException(`${fieldName} debe tener formato AAAA-MM-DD`);
  }
  const check = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(check.getTime()) || check.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException(`${fieldName} no es una fecha válida`);
  }
  return value;
}

function asBoolCash(name) {
  // El método real se consulta de BD; nunca se acepta is_cash desde el cliente.
  return String(name).trim().toLocaleLowerCase('es') === 'efectivo' ? 1 : 0;
}

function amountFromDatabase(value, name) {
  // mysql2 tiene decimalNumbers:false en el proyecto: DECIMAL llega como texto.
  return money(value, name);
}

function assertPage(value, label, defaultValue, max) {
  const id = value === undefined ? defaultValue : positiveId(value, label);
  if (id > max) throw new BadRequestException(`${label} no puede superar ${max}`);
  return id;
}

class ErpPaymentsService {
  constructor(db) {
    if (!db || typeof db.getConnection !== 'function' || typeof db.query !== 'function') {
      throw new TypeError('Se requiere el pool mysql2 en modo promise (pool.promise())');
    }
    this.db = db;
  }

  async transaction(handler) {
    const connection = await this.db.getConnection();
    let started = false;
    try {
      await connection.beginTransaction();
      started = true;
      const output = await handler(connection);
      await connection.commit();
      started = false;
      return output;
    } catch (error) {
      if (started) {
        try { await connection.rollback(); } catch (rollbackError) {
          console.error('Error al revertir transacción ERP:', rollbackError.code || rollbackError.message);
        }
      }
      if (error.code === 'ER_LOCK_DEADLOCK' || error.code === 'ER_LOCK_WAIT_TIMEOUT') {
        throw new ConflictException('La operación está siendo procesada. Actualiza y vuelve a intentar');
      }
      if (error.code === 'ER_DUP_ENTRY') {
        throw new ConflictException('La operación ya fue registrada');
      }
      throw error;
    } finally {
      connection.release();
    }
  }

  async authorize(executor, actorUserId, permission) {
    const actorId = positiveId(actorUserId, 'Usuario autenticado');
    const [rows] = await executor.query(`
      SELECT u.id_user
      FROM users u
      JOIN roles r ON r.id_role = u.id_role
      JOIN erp_role_permissions rp ON rp.id_role = r.id_role
      WHERE u.id_user = ? AND u.status = 'ACTIVE'
        AND r.status = 'ACTIVE' AND rp.permission_code = ?
      LIMIT 1
    `, [actorId, permission]);
    if (!rows.length) throw new ForbiddenException();
    return actorId;
  }

  async businessClock(executor) {
    // Bolivia = UTC-04:00. Aiven almacena DATETIME en UTC en este proyecto.
    // UTC_TIMESTAMP evita que el día de caja dependa de la zona horaria del PC.
    const [rows] = await executor.query(`
      SELECT DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s') AS utc_now,
             DATE_FORMAT(UTC_TIMESTAMP() - INTERVAL 4 HOUR, '%Y-%m-%d') AS business_date
    `);
    return rows[0];
  }

  async ensureCashOpen(executor, businessDate) {
    // Debe usarse la misma disciplina de bloqueo al implementar el cierre de caja.
    const [rows] = await executor.query(`
      SELECT id_cash_closure FROM erp_cash_closures
      WHERE business_date = ? LIMIT 1 FOR UPDATE
    `, [businessDate]);
    if (rows.length) {
      throw new ConflictException(`La caja del ${businessDate} ya está cerrada`);
    }
  }

  async registerPayment(payload, actorUserId) {
    const body = objectBody(payload);
    allowedFields(body, [
      'id_membership', 'id_payment_method', 'amount', 'notes', 'id_renewal_request',
    ]);
    const idMembership = positiveId(body.id_membership, 'id_membership');
    const idPaymentMethod = positiveId(body.id_payment_method, 'id_payment_method');
    const paid = money(body.amount);
    const notes = optionalText(body.notes, 'Las observaciones', 1000);
    const idRenewal = body.id_renewal_request == null ? null :
      positiveId(body.id_renewal_request, 'id_renewal_request');

    return this.transaction(async (conn) => {
      const actorId = await this.authorize(conn, actorUserId, 'FI_PAYMENT_REGISTER');
      const clock = await this.businessClock(conn);

      // Bloquear la membresía evita dos cobros simultáneos de la misma compra.
      const [memberships] = await conn.query(`
        SELECT id_membership, id_customer, id_plan, start_date, end_date,
               applied_price, status
        FROM memberships WHERE id_membership = ? LIMIT 1 FOR UPDATE
      `, [idMembership]);
      if (!memberships.length) throw new NotFoundException('Membresía no encontrada');
      const m = memberships[0];
      if (m.status !== 'PENDING') {
        throw new ConflictException('Solo se puede cobrar una membresía pendiente');
      }
      if (m.end_date < clock.business_date || m.start_date > m.end_date) {
        throw new ConflictException('La membresía tiene un período vencido o incorrecto');
      }

      const [customerRows] = await conn.query(`
        SELECT status FROM customers WHERE id_customer = ? LIMIT 1 FOR UPDATE
      `, [m.id_customer]);
      if (!customerRows.length || customerRows[0].status !== 'ACTIVE') {
        throw new ConflictException('El cliente debe encontrarse activo');
      }
      const [planRows] = await conn.query(`
        SELECT status FROM membership_plans WHERE id_plan = ? LIMIT 1
      `, [m.id_plan]);
      if (!planRows.length || planRows[0].status !== 'ACTIVE') {
        throw new ConflictException('El plan de la membresía está inactivo');
      }

      const [existing] = await conn.query(`
        SELECT id_payment FROM payments WHERE id_membership = ? LIMIT 1 FOR UPDATE
      `, [idMembership]);
      if (existing.length) {
        throw new ConflictException('Esta membresía ya tiene un pago registrado, incluso si fue anulado');
      }

      const [overlaps] = await conn.query(`
        SELECT id_membership FROM memberships
        WHERE id_customer = ? AND id_membership <> ?
          AND status IN ('PENDING','ACTIVE')
          AND start_date <= ? AND end_date >= ?
        LIMIT 1 FOR UPDATE
      `, [m.id_customer, idMembership, m.end_date, m.start_date]);
      if (overlaps.length) {
        throw new ConflictException(`La membresía se superpone con otra (#${overlaps[0].id_membership})`);
      }

      const expected = amountFromDatabase(m.applied_price, 'El precio de la membresía');
      if (expected.cents !== paid.cents) {
        throw new ConflictException(`El importe no coincide con el precio aplicado (${expected.decimal} Bs)`);
      }

      // Verificar que la promoción, si fue aplicada previamente, concuerde
      // con el precio congelado de la membresía. No recalcular promociones aquí.
      const [promotions] = await conn.query(`
        SELECT a.final_price, p.id_plan
        FROM erp_promotion_applications a
        JOIN erp_promotions p ON p.id_promotion = a.id_promotion
        WHERE a.id_membership = ? LIMIT 1
      `, [idMembership]);
      if (promotions.length) {
        const promotion = promotions[0];
        if (promotion.id_plan !== m.id_plan ||
            amountFromDatabase(promotion.final_price, 'El precio promocional').cents !== paid.cents) {
          throw new ConflictException('El precio de la promoción no coincide con la membresía');
        }
      }

      const [methodRows] = await conn.query(`
        SELECT name, status FROM payment_methods
        WHERE id_payment_method = ? LIMIT 1
      `, [idPaymentMethod]);
      if (!methodRows.length || methodRows[0].status !== 'ACTIVE') {
        throw new BadRequestException('El método de pago no existe o está inactivo');
      }
      const isCash = asBoolCash(methodRows[0].name);

      let renewal = null;
      if (idRenewal != null) {
        const [requests] = await conn.query(`
          SELECT id_renewal_request, id_customer, id_previous_membership,
                 id_new_membership, status
          FROM erp_renewal_requests
          WHERE id_renewal_request = ? LIMIT 1 FOR UPDATE
        `, [idRenewal]);
        if (!requests.length) throw new NotFoundException('Solicitud de renovación no encontrada');
        renewal = requests[0];
        if (renewal.status !== 'REQUESTED' || renewal.id_customer !== m.id_customer ||
            renewal.id_previous_membership === idMembership ||
            (renewal.id_new_membership != null && renewal.id_new_membership !== idMembership)) {
          throw new ConflictException('La solicitud de renovación no corresponde a esta membresía');
        }
        const [previous] = await conn.query(`
          SELECT id_customer, end_date FROM memberships
          WHERE id_membership = ? LIMIT 1
        `, [renewal.id_previous_membership]);
        if (!previous.length || previous[0].id_customer !== m.id_customer ||
            m.start_date <= previous[0].end_date) {
          throw new ConflictException('La renovación debe comenzar después de la membresía anterior');
        }
      } else {
        const [linked] = await conn.query(`
          SELECT id_renewal_request, status FROM erp_renewal_requests
          WHERE id_new_membership = ? LIMIT 1 FOR UPDATE
        `, [idMembership]);
        if (linked.length) {
          if (linked[0].status !== 'REQUESTED') {
            throw new ConflictException('La solicitud vinculada ya no admite el cobro');
          }
          renewal = linked[0];
        }
      }

      await this.ensureCashOpen(conn, clock.business_date);

      const [inserted] = await conn.query(`
        INSERT INTO payments
          (id_membership, id_user, id_payment_method, amount,
           payment_date, status, notes, createdBy)
        VALUES (?, ?, ?, ?, ?, 'REGISTERED', ?, ?)
      `, [idMembership, actorId, idPaymentMethod, paid.decimal,
        clock.utc_now, notes, actorId]);
      const idPayment = inserted.insertId;

      await conn.query(`
        INSERT INTO erp_cash_movements
          (business_date, movement_kind, amount, id_payment,
           id_payment_method, is_cash, registered_by, registered_at)
        VALUES (?, 'PAYMENT_IN', ?, ?, ?, ?, ?, ?)
      `, [clock.business_date, paid.decimal, idPayment, idPaymentMethod,
        isCash, actorId, clock.utc_now]);

      // El estado ACTIVE indica membresía pagada; si empieza en el futuro,
      // el inicio efectivo se controla por start_date (vista SCHEDULED).
      await conn.query(`
        UPDATE memberships SET status = 'ACTIVE'
        WHERE id_membership = ? AND status = 'PENDING'
      `, [idMembership]);

      if (renewal) {
        await conn.query(`
          UPDATE erp_renewal_requests
          SET id_new_membership = ?, status = 'COMPLETED', completed_at = ?
          WHERE id_renewal_request = ? AND status = 'REQUESTED'
        `, [idMembership, clock.utc_now, renewal.id_renewal_request]);
      }

      await conn.query(`
        INSERT INTO audit_logs
          (id_user, module, action, table_name, record_id, creationDate, description)
        VALUES (?, 'FINANCE', 'PAYMENT_REGISTER', 'payments', ?, ?, ?)
      `, [actorId, idPayment, clock.utc_now,
        `Cobro de membresía #${idMembership} por ${paid.decimal} Bs`]);

      return {
        id_payment: idPayment,
        id_membership: idMembership,
        id_customer: m.id_customer,
        id_payment_method: idPaymentMethod,
        amount: paid.decimal,
        payment_date: clock.utc_now,
        business_date: clock.business_date,
        status: 'REGISTERED',
        membership_status: 'ACTIVE',
        effective_status: m.start_date > clock.business_date ? 'SCHEDULED' : 'ACTIVE',
        id_renewal_request: renewal ? renewal.id_renewal_request : null,
      };
    });
  }

  async cancelPayment(paymentId, payload, actorUserId) {
    const idPayment = positiveId(paymentId, 'id_payment');
    const body = objectBody(payload);
    allowedFields(body, ['reason', 'refund_confirmed', 'refund_reference']);
    const reason = requiredReason(body.reason);
    if (body.refund_confirmed !== true) {
      throw new BadRequestException('Debes confirmar que el reembolso ya fue realizado');
    }
    const refundReference = optionalText(body.refund_reference, 'La referencia de reembolso', 120);

    return this.transaction(async (conn) => {
      const actorId = await this.authorize(conn, actorUserId, 'FI_PAYMENT_CANCEL');
      const clock = await this.businessClock(conn);
      // Primero bloquear membresía y luego pago: mismo orden que el registro.
      const [references] = await conn.query(`
        SELECT id_membership FROM payments WHERE id_payment = ? LIMIT 1
      `, [idPayment]);
      if (!references.length) throw new NotFoundException('Pago no encontrado');
      const idMembership = references[0].id_membership;

      const [membershipRows] = await conn.query(`
        SELECT id_customer, status FROM memberships
        WHERE id_membership = ? LIMIT 1 FOR UPDATE
      `, [idMembership]);
      if (!membershipRows.length) throw new NotFoundException('Membresía no encontrada');

      const [payments] = await conn.query(`
        SELECT id_payment, id_membership, amount, status, id_payment_method
        FROM payments WHERE id_payment = ? LIMIT 1 FOR UPDATE
      `, [idPayment]);
      const payment = payments[0];
      if (!payment || payment.status !== 'REGISTERED') {
        throw new ConflictException('El pago ya fue anulado o no está disponible');
      }
      if (membershipRows[0].status === 'CANCELLED') {
        throw new ConflictException('La membresía ya se encuentra cancelada');
      }

      const [attendance] = await conn.query(`
        SELECT id_attendance FROM customer_attendances
        WHERE id_membership = ? LIMIT 1
      `, [idMembership]);
      if (attendance.length) {
        throw new ConflictException('La membresía ya fue utilizada. Requiere un proceso de devolución especial');
      }
      const [successors] = await conn.query(`
        SELECT id_renewal_request FROM erp_renewal_requests
        WHERE id_previous_membership = ? AND status = 'COMPLETED'
        LIMIT 1
      `, [idMembership]);
      if (successors.length) {
        throw new ConflictException('Existe una renovación posterior; no se puede anular este pago');
      }

      const [original] = await conn.query(`
        SELECT id_cash_movement, is_cash, business_date
        FROM erp_cash_movements
        WHERE id_payment = ? AND movement_kind = 'PAYMENT_IN'
        LIMIT 1 FOR UPDATE
      `, [idPayment]);
      if (!original.length) {
        throw new ConflictException('El pago no tiene ingreso de caja asociado; se requiere revisión administrativa');
      }
      const [previousCancel] = await conn.query(`
        SELECT id_cancellation FROM erp_payment_cancellations
        WHERE id_payment = ? LIMIT 1 FOR UPDATE
      `, [idPayment]);
      if (previousCancel.length) {
        throw new ConflictException('El pago ya cuenta con una anulación registrada');
      }

      // Una devolución por QR/transferencia requiere comprobante externo.
      if (!original[0].is_cash && !refundReference) {
        throw new BadRequestException('Indica la referencia de devolución de QR o transferencia');
      }
      await this.ensureCashOpen(conn, clock.business_date);
      const amount = amountFromDatabase(payment.amount, 'El importe original');

      await conn.query(`
        UPDATE payments SET status = 'CANCELLED' WHERE id_payment = ?
      `, [idPayment]);
      const [cancellation] = await conn.query(`
        INSERT INTO erp_payment_cancellations
          (id_payment, reason, cancelled_by, cancelled_at)
        VALUES (?, ?, ?, ?)
      `, [idPayment, reason, actorId, clock.utc_now]);

      await conn.query(`
        INSERT INTO erp_cash_movements
          (business_date, movement_kind, amount, id_payment,
           id_payment_method, is_cash, registered_by, registered_at, notes)
        VALUES (?, 'PAYMENT_REVERSAL', ?, ?, ?, ?, ?, ?, ?)
      `, [clock.business_date, amount.decimal, idPayment,
        payment.id_payment_method, original[0].is_cash, actorId, clock.utc_now,
        refundReference ? `Reembolso confirmado. Referencia: ${refundReference}` :
          'Reembolso en efectivo confirmado']);

      await conn.query(`
        UPDATE memberships SET status = 'CANCELLED' WHERE id_membership = ?
      `, [idMembership]);
      await conn.query(`
        UPDATE erp_renewal_requests SET status = 'CANCELLED'
        WHERE id_new_membership = ? AND status = 'COMPLETED'
      `, [idMembership]);

      await conn.query(`
        INSERT INTO audit_logs
          (id_user, module, action, table_name, record_id, creationDate, description)
        VALUES (?, 'FINANCE', 'PAYMENT_CANCEL', 'payments', ?, ?, ?)
      `, [actorId, idPayment, clock.utc_now,
        `Anulación y reembolso de pago #${idPayment}. Motivo: ${reason}`]);

      return {
        id_payment: idPayment,
        id_cancellation: cancellation.insertId,
        id_membership: idMembership,
        status: 'CANCELLED',
        membership_status: 'CANCELLED',
        reversal_amount: amount.decimal,
        reversal_business_date: clock.business_date,
      };
    });
  }

  async getPaymentById(paymentId, actorUserId) {
    const idPayment = positiveId(paymentId, 'id_payment');
    await this.authorize(this.db, actorUserId, 'FI_PAYMENTS_READ');
    const [rows] = await this.db.query(`
      SELECT p.id_payment, p.id_membership, m.id_customer,
             CONCAT(c.first_name, ' ', c.last_name) AS customer_name,
             pl.plan_name, p.id_user, p.id_payment_method,
             pm.name AS payment_method, p.amount, p.payment_date,
             p.status, p.notes, canc.reason AS cancellation_reason,
             canc.cancelled_at
      FROM payments p
      JOIN memberships m ON m.id_membership = p.id_membership
      JOIN customers c ON c.id_customer = m.id_customer
      JOIN membership_plans pl ON pl.id_plan = m.id_plan
      JOIN payment_methods pm ON pm.id_payment_method = p.id_payment_method
      LEFT JOIN erp_payment_cancellations canc ON canc.id_payment = p.id_payment
      WHERE p.id_payment = ? LIMIT 1
    `, [idPayment]);
    if (!rows.length) throw new NotFoundException('Pago no encontrado');
    return rows[0];
  }

  async listPayments(query = {}, actorUserId) {
    const q = objectBody(query);
    allowedFields(q, ['page', 'limit', 'id_customer', 'id_membership', 'status', 'from', 'to']);
    const page = assertPage(q.page, 'page', 1, 100000);
    const limit = assertPage(q.limit, 'limit', 20, 100);
    const offset = (page - 1) * limit;
    const conditions = [];
    const params = [];
    if (q.id_customer != null) {
      conditions.push('m.id_customer = ?');
      params.push(positiveId(q.id_customer, 'id_customer'));
    }
    if (q.id_membership != null) {
      conditions.push('p.id_membership = ?');
      params.push(positiveId(q.id_membership, 'id_membership'));
    }
    if (q.status != null) {
      if (!['REGISTERED', 'CANCELLED'].includes(q.status)) {
        throw new BadRequestException('Estado de pago inválido');
      }
      conditions.push('p.status = ?');
      params.push(q.status);
    }
    if (q.from != null) {
      dateISO(q.from, 'from');
      conditions.push("p.payment_date >= DATE_ADD(CONCAT(?, ' 00:00:00'), INTERVAL 4 HOUR)");
      params.push(q.from);
    }
    if (q.to != null) {
      dateISO(q.to, 'to');
      conditions.push("p.payment_date < DATE_ADD(CONCAT(?, ' 00:00:00'), INTERVAL 28 HOUR)");
      params.push(q.to);
    }
    if (q.from && q.to && q.from > q.to) {
      throw new BadRequestException('La fecha inicial no puede superar la final');
    }
    await this.authorize(this.db, actorUserId, 'FI_PAYMENTS_READ');
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [countRows] = await this.db.query(`
      SELECT COUNT(*) AS total FROM payments p
      JOIN memberships m ON m.id_membership = p.id_membership
      ${where}
    `, params);
    const [rows] = await this.db.query(`
      SELECT p.id_payment, p.id_membership, m.id_customer,
             CONCAT(c.first_name, ' ', c.last_name) AS customer_name,
             p.amount, p.payment_date, p.status, pm.name AS payment_method,
             pl.plan_name
      FROM payments p
      JOIN memberships m ON m.id_membership = p.id_membership
      JOIN customers c ON c.id_customer = m.id_customer
      JOIN membership_plans pl ON pl.id_plan = m.id_plan
      JOIN payment_methods pm ON pm.id_payment_method = p.id_payment_method
      ${where}
      ORDER BY p.payment_date DESC, p.id_payment DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);
    return { data: rows, total: Number(countRows[0].total), page, limit };
  }

  async listPaymentMethods(actorUserId) {
    const actorId = positiveId(actorUserId, 'Usuario autenticado');
    const [authorized] = await this.db.query(`
      SELECT 1 FROM users u JOIN roles r ON r.id_role = u.id_role
      JOIN erp_role_permissions rp ON rp.id_role = r.id_role
      WHERE u.id_user = ? AND u.status = 'ACTIVE' AND r.status = 'ACTIVE'
        AND rp.permission_code IN ('FI_PAYMENT_REGISTER', 'FI_PAYMENTS_READ')
      LIMIT 1
    `, [actorId]);
    if (!authorized.length) throw new ForbiddenException();
    const [rows] = await this.db.query(`
      SELECT id_payment_method, name FROM payment_methods
      WHERE status = 'ACTIVE' ORDER BY id_payment_method
    `);
    return rows;
  }
}

module.exports = ErpPaymentsService;
