
'use strict';

// Gimnasio MQS - Operaciones / Membresías.
// Las operaciones están protegidas con JWT y el rol verificado en MySQL.
// El pago y la activación corresponden exclusivamente a Finanzas / Pagos.

const express = require('express');
const controller = require('../controllers/memberships.controller');
const { validate, parseId } = require('../validators/operations');
const { BadRequestException, HttpError } = require('../middlewares/errors');

function requireJson(req, res, next) {
  if (!req.is('application/json')) {
    return res.status(415).json({
      message: 'Debes enviar Content-Type: application/json',
      statusCode: 415,
    });
  }
  return next();
}

function optionalJson(req, res, next) {
  // Renovar sin body era válido en el sistema existente: conservarlo.
  const hasPayload = (Number(req.headers['content-length']) > 0) ||
    Boolean(req.headers['transfer-encoding']);
  if (hasPayload && !req.is('application/json')) {
    return res.status(415).json({
      message: 'Debes enviar Content-Type: application/json',
      statusCode: 415,
    });
  }
  return next();
}

function requirePositiveRecordId(req, res, next) {
  if (!Number.isSafeInteger(req.recordId) || req.recordId < 1 || req.recordId > 2147483647) {
    return next(new BadRequestException('El identificador de la membresía no es válido'));
  }
  return next();
}

function paidMembershipActivation(req, res) {
  // Se deshabilita el endpoint antiguo para evitar activar sin pago.
  // Finanzas / Pagos ejecuta en una sola transacción:
  // pago -> movimiento de caja -> activación.
  return res.status(409).json({
    message: 'No puedes activar una membresía directamente. Registra el pago desde Finanzas / Pagos.',
    statusCode: 409,
    payment_path: '/api/erp/payments',
  });
}

async function cancelUnpaidPendingMembership(req, res, next, db) {
  let connection;
  let inTransaction = false;

  try {
    // El lock de la membresía evita carreras contra el cobro de Finanzas.
    // Finanzas también bloquea esta misma fila antes de cobrar.
    connection = await db.getConnection();
    await connection.beginTransaction();
    inTransaction = true;

    const [memberships] = await connection.query(`
      SELECT id_membership, status
      FROM memberships
      WHERE id_membership = ?
      LIMIT 1 FOR UPDATE
    `, [req.recordId]);

    if (!Array.isArray(memberships) || memberships.length === 0) {
      throw new HttpError(404, 'Membresía no encontrada');
    }

    if (memberships[0].status !== 'PENDING') {
      throw new HttpError(
        409,
        'Solo se puede cancelar aquí una membresía pendiente y sin pago. Para anular un cobro usa Finanzas / Pagos.',
      );
    }

    // Comprobar CUALQUIER pago, incluso uno anulado: nunca alterar la caja
    // ni el historial financiero desde Operaciones.
    const [payments] = await connection.query(`
      SELECT id_payment
      FROM payments
      WHERE id_membership = ?
      LIMIT 1 FOR UPDATE
    `, [req.recordId]);

    if (payments.length > 0) {
      throw new HttpError(
        409,
        'Esta membresía tiene historial de pago. Revisa el caso en Finanzas antes de cancelarla.',
      );
    }

    const [attendances] = await connection.query(`
      SELECT id_attendance
      FROM customer_attendances
      WHERE id_membership = ?
      LIMIT 1
    `, [req.recordId]);

    if (attendances.length > 0) {
      throw new HttpError(409, 'Esta membresía ya tiene asistencias registradas y requiere revisión administrativa.');
    }

    // Evitar cancelar una renovación ya completada, incluso ante datos
    // antiguos inconsistentes. Las solicitudes sin completar sí pueden cerrarse.
    const [renewalRequests] = await connection.query(`
      SELECT id_renewal_request, status
      FROM erp_renewal_requests
      WHERE id_new_membership = ?
      LIMIT 1 FOR UPDATE
    `, [req.recordId]);

    if (renewalRequests.some((renewal) => renewal.status === 'COMPLETED')) {
      throw new HttpError(409, 'La renovación ya fue completada y no se puede cancelar desde Operaciones.');
    }

    const [updated] = await connection.query(`
      UPDATE memberships
      SET status = 'CANCELLED'
      WHERE id_membership = ? AND status = 'PENDING'
    `, [req.recordId]);

    if (updated.affectedRows !== 1) {
      throw new HttpError(409, 'El estado de la membresía cambió. Actualiza la pantalla antes de continuar.');
    }

    await connection.query(`
      UPDATE erp_renewal_requests
      SET status = 'CANCELLED'
      WHERE id_new_membership = ? AND status = 'REQUESTED'
    `, [req.recordId]);

    await connection.query(`
      INSERT INTO audit_logs
        (id_user, module, action, table_name, record_id, creationDate, description)
      VALUES (?, 'OPERATIONS', 'MEMBERSHIP_PENDING_CANCEL', 'memberships', ?, UTC_TIMESTAMP(), ?)
    `, [req.auth.id_user, req.recordId, `Cancelación de membresía pendiente #${req.recordId} sin pago`]);

    await connection.commit();
    inTransaction = false;

    return res.status(200).json({
      id_membership: req.recordId,
      status: 'CANCELLED',
      message: 'Membresía pendiente cancelada correctamente',
    });
  } catch (error) {
    if (inTransaction && connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        // No ocultar el error original; el pool descartará conexiones dañadas.
        console.error('No se pudo revertir la cancelación de membresía:', rollbackError.code || rollbackError.message);
      }
    }
    return next(error);
  } finally {
    if (connection) connection.release();
  }
}

// IMPORTANTE: app.js debe llamar a esta fábrica con (service, db).
// Sin db se responde 503 de forma segura en vez de abrir rutas sin JWT.
module.exports = (service, db) => {
  const router = express.Router();
  const c = controller(service);

  router.use((req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    res.set('Pragma', 'no-cache');
    res.set('X-Content-Type-Options', 'nosniff');
    res.vary('Authorization');
    next();
  });

  // El flujo original no exige sesión ni JWT para consultar ni crear membresías.
  router.get('/', c.findAll);

  // Crear nuevas membresías PENDING, sin activar ni cobrar.
  router.post('/', requireJson, validate('memberships'), c.create);

  // Renovaciones: generan una membresía nueva en estado PENDING.
  router.post('/:id/renew', parseId, requirePositiveRecordId, optionalJson, validate('renew'), c.renew);

  // El endpoint antiguo se conserva, pero no permite evitar el pago.
  router.patch('/:id/activate', parseId, requirePositiveRecordId, paidMembershipActivation);

  // Solo se permite cancelar pendientes sin historial de pagos.
  // Activas, vencidas o pagadas deben tratarse desde Finanzas.
  router.patch('/:id/cancel', parseId, requirePositiveRecordId, (req, res, next) =>
    cancelUnpaidPendingMembership(req, res, next, db));

  return router;
};
