-- Gimnasio MQS - verificaciones de datos de demostracion.
-- SOLO SELECT: no crea ni modifica datos, tablas, indices o vistas.
-- Ejecutar unicamente contra una base local/de pruebas.
--
-- Marcador reservado para la futura carga:
--   DEMO_MQS_DIRECCION_2026_V1
-- Requisito para que las consultas filtren los ejemplos:
--   customers.notes incluye el marcador;
--   notas/descripcion de las tablas auxiliares lo incluyen cuando existe ese campo.
--
-- Respaldo recomendado antes de una futura carga (PowerShell; pedir la contrasena
-- de forma interactiva, no escribirla en el comando):
--   mysqldump --single-transaction --routines --triggers --events --databases gym_mqs `
--     --result-file="C:\backups\gym_mqs_before_demo.sql" -u <usuario> -p
-- Confirmar antes que el respaldo se completo y que el destino no es produccion.
--
-- Los archivos de carga y reversa usan el mismo marcador. Esta consulta es de
-- solo lectura y no necesita que existan todavia filas de demostracion.

-- 1. Clientes demo por estado.
SELECT c.status, COUNT(*) AS customers
FROM customers c
WHERE LOCATE('DEMO_MQS_DIRECCION_2026_V1', c.notes) > 0
GROUP BY c.status
ORDER BY c.status;

-- 2. Membresias demo por estado efectivo para el Dashboard.
SELECT CASE
         WHEN m.status = 'CANCELLED' THEN 'CANCELLED'
         WHEN m.status = 'PENDING' THEN 'PENDING'
         WHEN m.status = 'EXPIRED' OR (m.status = 'ACTIVE' AND m.end_date < CURDATE()) THEN 'EXPIRED'
         WHEN m.status = 'ACTIVE' AND m.start_date > CURDATE() THEN 'SCHEDULED'
         ELSE 'ACTIVE'
       END AS effective_status,
       COUNT(*) AS memberships
FROM memberships m
JOIN customers c ON c.id_customer = m.id_customer
WHERE LOCATE('DEMO_MQS_DIRECCION_2026_V1', c.notes) > 0
GROUP BY effective_status
ORDER BY effective_status;

-- 3. Membresias vigentes que vencen hoy o dentro de los siguientes siete dias.
SELECT c.id_customer, c.first_name, c.last_name, m.id_membership,
       p.plan_name, m.end_date,
       DATEDIFF(m.end_date, DATE(UTC_TIMESTAMP() - INTERVAL 4 HOUR)) AS days_to_expire
FROM memberships m
JOIN customers c ON c.id_customer = m.id_customer
JOIN membership_plans p ON p.id_plan = m.id_plan
WHERE LOCATE('DEMO_MQS_DIRECCION_2026_V1', c.notes) > 0
  AND m.status = 'ACTIVE'
  AND m.start_date <= DATE(UTC_TIMESTAMP() - INTERVAL 4 HOUR)
  AND m.end_date BETWEEN DATE(UTC_TIMESTAMP() - INTERVAL 4 HOUR)
                      AND DATE_ADD(DATE(UTC_TIMESTAMP() - INTERVAL 4 HOUR), INTERVAL 7 DAY)
ORDER BY m.end_date, c.last_name, c.first_name;

-- 4. Solicitudes de renovacion; separar REQUESTED de COMPLETED.
SELECT r.status, COUNT(*) AS renewal_requests
FROM erp_renewal_requests r
JOIN customers c ON c.id_customer = r.id_customer
WHERE LOCATE('DEMO_MQS_DIRECCION_2026_V1', c.notes) > 0
GROUP BY r.status
ORDER BY r.status;

SELECT r.id_renewal_request, r.status, r.id_previous_membership,
       r.id_new_membership, r.requested_at, r.completed_at, r.notes
FROM erp_renewal_requests r
JOIN customers c ON c.id_customer = r.id_customer
WHERE LOCATE('DEMO_MQS_DIRECCION_2026_V1', c.notes) > 0
ORDER BY r.requested_at DESC, r.id_renewal_request DESC;

-- 5. Pagos registrados y anulados, vinculados a membresias demo.
SELECT p.status, COUNT(*) AS payments, COALESCE(SUM(p.amount), 0) AS amount
FROM payments p
JOIN memberships m ON m.id_membership = p.id_membership
JOIN customers c ON c.id_customer = m.id_customer
WHERE LOCATE('DEMO_MQS_DIRECCION_2026_V1', c.notes) > 0
GROUP BY p.status
ORDER BY p.status;

SELECT p.id_payment, p.payment_date, p.status, p.amount,
       c.id_customer, c.first_name, c.last_name, m.id_membership
FROM payments p
JOIN memberships m ON m.id_membership = p.id_membership
JOIN customers c ON c.id_customer = m.id_customer
WHERE LOCATE('DEMO_MQS_DIRECCION_2026_V1', c.notes) > 0
ORDER BY p.payment_date DESC, p.id_payment DESC;

-- 6. Ingresos, gastos, reversiones y neto de movimientos demo por fecha.
-- Los movimientos de pagos se identifican por la FK a pagos demo; los demas,
-- por la nota de marcador. El neto descuenta gastos y reversiones.
SELECT cm.business_date,
       SUM(CASE WHEN cm.movement_kind IN ('PAYMENT_IN', 'OTHER_IN') THEN cm.amount ELSE 0 END) AS income,
       SUM(CASE WHEN cm.movement_kind = 'EXPENSE_OUT' THEN cm.amount ELSE 0 END) AS expenses,
       SUM(CASE WHEN cm.movement_kind = 'PAYMENT_REVERSAL' THEN cm.amount ELSE 0 END) AS reversals,
       SUM(CASE WHEN cm.movement_kind IN ('PAYMENT_IN', 'OTHER_IN') THEN cm.amount
                WHEN cm.movement_kind IN ('EXPENSE_OUT', 'PAYMENT_REVERSAL') THEN -cm.amount
                ELSE 0 END) AS net
FROM erp_cash_movements cm
LEFT JOIN payments pay ON pay.id_payment = cm.id_payment
LEFT JOIN memberships m ON m.id_membership = pay.id_membership
LEFT JOIN customers c ON c.id_customer = m.id_customer
LEFT JOIN erp_financial_entries fe ON fe.id_financial_entry = cm.id_financial_entry
WHERE LOCATE('DEMO_MQS_DIRECCION_2026_V1', c.notes) > 0
   OR LOCATE('DEMO_MQS_DIRECCION_2026_V1', cm.notes) > 0
   OR LOCATE('DEMO_MQS_DIRECCION_2026_V1', fe.notes) > 0
GROUP BY cm.business_date
ORDER BY cm.business_date;

-- 7. Asistencias por dia y hora para la vista horaria de Direccion.
SELECT a.attendance_date, HOUR(a.entry_time) AS hour_of_day,
       COUNT(*) AS attendance_count
FROM customer_attendances a
JOIN customers c ON c.id_customer = a.id_customer
WHERE LOCATE('DEMO_MQS_DIRECCION_2026_V1', c.notes) > 0
GROUP BY a.attendance_date, HOUR(a.entry_time)
ORDER BY a.attendance_date, hour_of_day;

-- 8. Inactividad con los umbrales de Fase 5 (7, 15 y 30 dias).
-- Replica su criterio: cliente ACTIVE, membresia ACTIVE vigente mas reciente,
-- ultima asistencia del cliente hasta hoy y DATEDIFF(today, GREATEST(ultima, inicio)).
SELECT thresholds.days AS inactivity_days,
       c.id_customer, c.first_name, c.last_name, m.id_membership,
       m.start_date AS membership_start_date, m.end_date AS membership_end_date,
       latest.last_attendance_date,
       DATEDIFF(today.business_date,
         GREATEST(COALESCE(latest.last_attendance_date, m.start_date), m.start_date)
       ) AS days_since_activity
FROM customers c
JOIN memberships m ON m.id_membership = (
  SELECT current_m.id_membership
  FROM memberships current_m
  WHERE current_m.id_customer = c.id_customer
    AND current_m.status = 'ACTIVE'
    AND current_m.start_date <= DATE(UTC_TIMESTAMP() - INTERVAL 4 HOUR)
    AND current_m.end_date >= DATE(UTC_TIMESTAMP() - INTERVAL 4 HOUR)
  ORDER BY current_m.start_date DESC, current_m.id_membership DESC
  LIMIT 1
)
LEFT JOIN (
  SELECT id_customer, MAX(attendance_date) AS last_attendance_date
  FROM customer_attendances
  WHERE attendance_date <= DATE(UTC_TIMESTAMP() - INTERVAL 4 HOUR)
  GROUP BY id_customer
) latest ON latest.id_customer = c.id_customer
CROSS JOIN (
  SELECT 7 AS days UNION ALL SELECT 15 UNION ALL SELECT 30
) thresholds
CROSS JOIN (
  SELECT DATE(UTC_TIMESTAMP() - INTERVAL 4 HOUR) AS business_date
) today
WHERE LOCATE('DEMO_MQS_DIRECCION_2026_V1', c.notes) > 0
  AND c.status = 'ACTIVE'
  AND DATEDIFF(today.business_date,
    GREATEST(COALESCE(latest.last_attendance_date, m.start_date), m.start_date)
  ) >= thresholds.days
ORDER BY thresholds.days, days_since_activity DESC, c.id_customer;

-- 9. Ventas por plan. ROW_NUMBER garantiza una sola venta por membresia si hay
-- datos historicos inconsistentes con pagos duplicados.
WITH registered_payment_once AS (
  SELECT p.id_membership, p.amount,
         ROW_NUMBER() OVER (
           PARTITION BY p.id_membership ORDER BY p.id_payment
         ) AS payment_rank
  FROM payments p
  WHERE p.status = 'REGISTERED'
)
SELECT pl.id_plan, pl.plan_name,
       COUNT(*) AS registered_sales,
       COALESCE(SUM(rpo.amount), 0) AS gross_revenue
FROM registered_payment_once rpo
JOIN memberships m ON m.id_membership = rpo.id_membership
JOIN customers c ON c.id_customer = m.id_customer
JOIN membership_plans pl ON pl.id_plan = m.id_plan
WHERE LOCATE('DEMO_MQS_DIRECCION_2026_V1', c.notes) > 0
  AND rpo.payment_rank = 1
GROUP BY pl.id_plan, pl.plan_name
ORDER BY registered_sales DESC, pl.plan_name;

-- Detecta aparte cualquier membresia con mas de un pago REGISTERED; no la
-- contabiliza varias veces en la consulta de ventas anterior.
SELECT p.id_membership, COUNT(*) AS registered_payment_rows
FROM payments p
JOIN memberships m ON m.id_membership = p.id_membership
JOIN customers c ON c.id_customer = m.id_customer
WHERE LOCATE('DEMO_MQS_DIRECCION_2026_V1', c.notes) > 0
  AND p.status = 'REGISTERED'
GROUP BY p.id_membership
HAVING COUNT(*) > 1;

-- 10. Solo agrega aplicaciones cuyo destino tambien es un cliente demo.
-- Una promocion demo aplicada por error a un cliente real no se incluye.
SELECT promo.id_promotion, promo.name, promo.status,
       COALESCE(app_stats.applications, 0) AS applications,
       COALESCE(app_stats.total_discount, 0) AS total_discount,
       COALESCE(app_stats.final_value, 0) AS final_value
FROM erp_promotions promo
LEFT JOIN (
  SELECT a.id_promotion,
         COUNT(DISTINCT a.id_application) AS applications,
         SUM(a.discount_amount) AS total_discount,
         SUM(a.final_price) AS final_value
  FROM erp_promotion_applications a
  JOIN memberships m ON m.id_membership = a.id_membership
  JOIN customers c ON c.id_customer = m.id_customer
  WHERE LOCATE('DEMO_MQS_DIRECCION_2026_V1', c.notes) > 0
  GROUP BY a.id_promotion
) app_stats ON app_stats.id_promotion = promo.id_promotion
WHERE LOCATE('DEMO_MQS_DIRECCION_2026_V1', promo.description) > 0
GROUP BY promo.id_promotion, promo.name, promo.status,
         app_stats.applications, app_stats.total_discount, app_stats.final_value
ORDER BY promo.id_promotion;

-- 11. Alertas demo por tipo y estado.
SELECT al.alert_type, al.status, COUNT(*) AS alerts
FROM erp_membership_alerts al
JOIN memberships m ON m.id_membership = al.id_membership
JOIN customers c ON c.id_customer = m.id_customer
WHERE LOCATE('DEMO_MQS_DIRECCION_2026_V1', c.notes) > 0
GROUP BY al.alert_type, al.status
ORDER BY al.alert_type, al.status;

-- 12. Seguimientos comerciales demo por motivo, canal y resultado.
SELECT f.reason, f.contact_method, f.result, COUNT(*) AS followups
FROM erp_commercial_followups f
JOIN customers c ON c.id_customer = f.id_customer
WHERE LOCATE('DEMO_MQS_DIRECCION_2026_V1', c.notes) > 0
GROUP BY f.reason, f.contact_method, f.result
ORDER BY f.reason, f.contact_method, f.result;

SELECT f.id_followup, c.id_customer, c.first_name, c.last_name,
       f.reason, f.contact_method, f.contact_date, f.result,
       f.next_action_at, f.notes
FROM erp_commercial_followups f
JOIN customers c ON c.id_customer = f.id_customer
WHERE LOCATE('DEMO_MQS_DIRECCION_2026_V1', c.notes) > 0
ORDER BY f.contact_date DESC, f.id_followup DESC;

-- 13. Cierres demo, diferencia y totales registrados.
SELECT cl.id_cash_closure, cl.business_date, cl.opening_cash,
       cl.total_income, cl.total_expenses, cl.total_reversals,
       cl.expected_cash, cl.counted_cash, cl.difference_cash,
       cl.closed_at, cl.notes
FROM erp_cash_closures cl
WHERE LOCATE('DEMO_MQS_DIRECCION_2026_V1', cl.notes) > 0
ORDER BY cl.business_date, cl.id_cash_closure;
