-- Gimnasio MQS - carga demostrativa para base local/de pruebas.
-- NO ejecutar en produccion. Este archivo NO se ha ejecutado.
--
-- Respaldo previo (PowerShell; la contrasena se solicita interactivamente):
-- mysqldump --single-transaction --routines --triggers --events --databases gym_mqs `
--   --result-file="C:\backups\gym_mqs_before_demo.sql" -u <usuario> -p
-- Verificar el respaldo y restaurarlo en una base local/de pruebas antes de cargar.
--
-- EJECUCION EXPLICITAMENTE DESACTIVADA:
-- Cambiar @demo_apply y @demo_confirm_nonproduction a 1 solo despues de revisar
-- el respaldo, confirmar manualmente el host local/de pruebas y revisar la salida
-- @demo_preflight_ok. Ejecutar el archivo en una conexion nueva, en serie, y no
-- ejecutar dos copias simultaneamente. Cada re-ejecucion detecta el marcador y
-- no vuelve a insertar. No usa IDs fijos, no cambia datos existentes, no cambia
-- FOREIGN_KEY_CHECKS y no crea objetos permanentes. Las tablas tmp_demo_* son
-- temporales de esta conexion y desaparecen al cerrarla.
--
-- Los DATETIME de pagos/movimientos se expresan a las 14:00 UTC para representar
-- 10:00 en Bolivia (UTC-04). Las fechas operativas se calculan con el reloj de
-- negocio de Bolivia que utilizan los servicios ERP.

SET @demo_marker := 'DEMO_MQS_DIRECCION_2026_V1';
SET @demo_today := DATE(UTC_TIMESTAMP() - INTERVAL 4 HOUR);
SET @demo_apply := 0;
SET @demo_confirm_nonproduction := 0;
SET @demo_actor := (
  SELECT u.id_user
  FROM users u
  JOIN roles r ON r.id_role = u.id_role
  WHERE u.status = 'ACTIVE' AND r.status = 'ACTIVE'
    AND r.name = 'Administrador'
  ORDER BY u.id_user
  LIMIT 1
);

CREATE TEMPORARY TABLE tmp_demo_customer_seed (
  slot TINYINT PRIMARY KEY,
  first_name VARCHAR(50) NOT NULL,
  last_name VARCHAR(50) NOT NULL,
  phone VARCHAR(20) NOT NULL UNIQUE,
  email VARCHAR(100) NOT NULL,
  customer_status VARCHAR(8) NOT NULL
);
INSERT INTO tmp_demo_customer_seed VALUES
  (1,'Alicia','Demo Uno','7009000001','demo01@example.invalid','ACTIVE'),
  (2,'Bruno','Demo Dos','7009000002','demo02@example.invalid','ACTIVE'),
  (3,'Carla','Demo Tres','7009000003','demo03@example.invalid','ACTIVE'),
  (4,'Dario','Demo Cuatro','7009000004','demo04@example.invalid','ACTIVE'),
  (5,'Elena','Demo Cinco','7009000005','demo05@example.invalid','ACTIVE'),
  (6,'Fabian','Demo Seis','7009000006','demo06@example.invalid','ACTIVE'),
  (7,'Gabriela','Demo Siete','7009000007','demo07@example.invalid','ACTIVE'),
  (8,'Hugo','Demo Ocho','7009000008','demo08@example.invalid','ACTIVE'),
  (9,'Ines','Demo Nueve','7009000009','demo09@example.invalid','ACTIVE'),
  (10,'Javier','Demo Diez','7009000010','demo10@example.invalid','ACTIVE'),
  (11,'Karen','Demo Once','7009000011','demo11@example.invalid','ACTIVE'),
  (12,'Leo','Demo Doce','7009000012','demo12@example.invalid','ACTIVE'),
  (13,'Mara','Demo Trece','7009000013','demo13@example.invalid','ACTIVE'),
  (14,'Nicolas','Demo Catorce','7009000014','demo14@example.invalid','ACTIVE'),
  (15,'Olivia','Demo Quince','7009000015','demo15@example.invalid','INACTIVE'),
  (16,'Pablo','Demo Dieciseis','7009000016','demo16@example.invalid','INACTIVE'),
  (17,'Quiana','Demo Diecisiete','7009000017','demo17@example.invalid','INACTIVE'),
  (18,'Rafael','Demo Dieciocho','7009000018','demo18@example.invalid','ACTIVE'),
  (19,'Sofia','Demo Diecinueve','7009000019','demo19@example.invalid','ACTIVE'),
  (20,'Tomas','Demo Veinte','7009000020','demo20@example.invalid','ACTIVE');

CREATE TEMPORARY TABLE tmp_demo_membership_seed (
  slot TINYINT PRIMARY KEY,
  customer_slot TINYINT NOT NULL,
  duration_days SMALLINT NOT NULL,
  start_offset SMALLINT NOT NULL,
  state VARCHAR(10) NOT NULL,
  discount_pct DECIMAL(5,2) NOT NULL DEFAULT 0,
  payment_offset SMALLINT NULL,
  payment_method VARCHAR(50) NULL
);
INSERT INTO tmp_demo_membership_seed
  (slot, customer_slot, duration_days, start_offset, state, discount_pct, payment_offset, payment_method)
VALUES
  (1,1,30,-29,'ACTIVE',0,-29,'Transferencia'),
  (2,2,30,-20,'ACTIVE',0,-20,'Transferencia'),
  (3,3,30,-10,'ACTIVE',0,-10,'QR'),
  (4,4,30,-28,'ACTIVE',10,-14,'Efectivo'),
  (5,5,30,-26,'ACTIVE',15,-7,'Transferencia'),
  (6,6,30,-24,'ACTIVE',0,-5,'QR'),
  (7,7,30,-22,'ACTIVE',0,-3,'Efectivo'),
  (8,8,90,-59,'ACTIVE',20,-1,'Transferencia'),
  (9,1,30,-59,'EXPIRED',0,-58,'QR'),
  (10,2,30,-50,'EXPIRED',0,-49,'Transferencia'),
  (11,3,30,-40,'EXPIRED',0,-39,'Transferencia'),
  (12,9,30,-36,'EXPIRED',0,-35,'QR'),
  (13,10,30,-44,'EXPIRED',0,-43,'Transferencia'),
  (14,11,30,-49,'EXPIRED',0,-48,'Transferencia'),
  (15,15,30,-5,'CANCELLED',0,-5,'QR'),
  (16,16,30,-10,'CANCELLED',0,-10,'Transferencia'),
  (17,17,30,-20,'CANCELLED',0,-20,'Transferencia'),
  (18,18,90,-30,'CANCELLED',0,-30,'QR'),
  (19,19,90,-40,'CANCELLED',0,-40,'Transferencia'),
  (20,20,90,-50,'CANCELLED',0,-50,'Transferencia'),
  (21,1,30,1,'PENDING',0,NULL,NULL),
  (22,2,30,10,'PENDING',0,NULL,NULL),
  (23,3,90,20,'PENDING',0,NULL,NULL),
  (24,4,30,2,'PENDING',0,NULL,NULL),
  (25,5,90,4,'PENDING',0,NULL,NULL);

CREATE TEMPORARY TABLE tmp_demo_finance_seed (
  slot TINYINT PRIMARY KEY,
  entry_type VARCHAR(12) NOT NULL,
  category VARCHAR(80) NOT NULL,
  concept VARCHAR(255) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  day_offset SMALLINT NOT NULL,
  payment_method VARCHAR(50) NOT NULL
);
INSERT INTO tmp_demo_finance_seed VALUES
  (1,'EXPENSE','Limpieza','Demo insumos de limpieza',85.00,-60,'Transferencia'),
  (2,'EXPENSE','Servicios','Demo servicio de agua',120.00,-30,'Transferencia'),
  (3,'EXPENSE','Mantenimiento','Demo mantenimiento de equipos',95.00,-14,'Efectivo'),
  (4,'EXPENSE','Servicios','Demo servicio de internet',60.00,-7,'QR'),
  (5,'OTHER_INCOME','Otros ingresos','Demo venta de articulos',45.00,-7,'Transferencia'),
  (6,'OTHER_INCOME','Otros ingresos','Demo ingreso complementario',30.00,0,'Transferencia');

-- Guardas. Cualquier colision, cierre previo, falta de catalogo o segunda
-- ejecucion deshabilita TODA la carga persistente.
SET @demo_preflight_ok := (
  @demo_apply = 1
  AND @demo_confirm_nonproduction = 1
  AND DATABASE() = 'gym_mqs'
  AND @demo_actor IS NOT NULL
  AND (SELECT COUNT(*) FROM membership_plans
       WHERE status = 'ACTIVE' AND duration_days = 30) = 1
  AND (SELECT COUNT(*) FROM membership_plans
       WHERE status = 'ACTIVE' AND duration_days = 90) = 1
  AND (SELECT COUNT(*) FROM payment_methods
       WHERE status = 'ACTIVE' AND name IN ('Efectivo','Transferencia','QR')) = 3
  AND NOT EXISTS (SELECT 1 FROM customers
                  WHERE LOCATE(@demo_marker, notes) > 0)
  AND NOT EXISTS (SELECT 1 FROM tmp_demo_customer_seed s
                  JOIN customers c ON c.phone = s.phone)
  AND NOT EXISTS (SELECT 1 FROM erp_promotions
                  WHERE LOCATE(@demo_marker, description) > 0)
  AND NOT EXISTS (SELECT 1 FROM erp_financial_entries
                  WHERE LOCATE(@demo_marker, notes) > 0)
  AND NOT EXISTS (SELECT 1 FROM erp_cash_movements
                  WHERE LOCATE(@demo_marker, notes) > 0)
  AND NOT EXISTS (SELECT 1 FROM erp_cash_closures)
);
SELECT DATABASE() AS selected_database, @@hostname AS mysql_host,
       @demo_apply AS apply_requested,
       @demo_confirm_nonproduction AS nonproduction_confirmed,
       @demo_preflight_ok AS preflight_passed,
       @demo_today AS business_today,
       @demo_actor AS referenced_active_admin_user;

START TRANSACTION;

INSERT INTO customers
  (first_name, last_name, phone, email, birth_date, registration_date, status, notes, createdBy)
SELECT s.first_name, s.last_name, s.phone, s.email, NULL,
       UTC_TIMESTAMP(), 'ACTIVE',
       CONCAT(@demo_marker, '|CUSTOMER|', LPAD(s.slot,2,'0')),
       @demo_actor
FROM tmp_demo_customer_seed s
WHERE @demo_preflight_ok = 1;

-- Esta tabla temporal se materializa despues de insertar los clientes.
CREATE TEMPORARY TABLE tmp_demo_customer_map_after AS
SELECT s.slot, c.id_customer
FROM tmp_demo_customer_seed s
JOIN customers c ON c.phone = s.phone
WHERE LOCATE(@demo_marker, c.notes) > 0;

INSERT INTO erp_promotions
  (id_plan, name, description, discount_type, discount_value,
   start_date, end_date, status, created_by)
SELECT p.id_plan,
       CONCAT(@demo_marker, ' ', promo.promo_name),
       CONCAT(@demo_marker, '|PROMOTION|', promo.promo_name),
       'PERCENTAGE', promo.discount_pct,
       DATE_SUB(@demo_today, INTERVAL 30 DAY),
       DATE_ADD(@demo_today, INTERVAL 30 DAY),
       'ACTIVE', @demo_actor
FROM (
  SELECT 'MENSUAL_10' AS promo_name, 30 AS duration_days, 10.00 AS discount_pct
  UNION ALL SELECT 'MENSUAL_15', 30, 15.00
  UNION ALL SELECT 'TRIMESTRAL_20', 90, 20.00
) promo
JOIN membership_plans p
  ON p.duration_days = promo.duration_days AND p.status = 'ACTIVE'
WHERE @demo_preflight_ok = 1;

INSERT INTO memberships
  (id_customer, id_plan, start_date, end_date, applied_price, status, createdBy)
SELECT cm.id_customer, p.id_plan,
       DATE_ADD(@demo_today, INTERVAL s.start_offset DAY),
       DATE_ADD(@demo_today, INTERVAL (s.start_offset + s.duration_days - 1) DAY),
       p.price, 'PENDING', @demo_actor
FROM tmp_demo_membership_seed s
JOIN tmp_demo_customer_map_after cm ON cm.slot = s.customer_slot
JOIN membership_plans p
  ON p.duration_days = s.duration_days AND p.status = 'ACTIVE'
WHERE @demo_preflight_ok = 1;

CREATE TEMPORARY TABLE tmp_demo_membership_map AS
SELECT s.slot, s.customer_slot, s.duration_days, s.start_offset,
       s.state, s.discount_pct, s.payment_offset, s.payment_method,
       m.id_membership, m.id_customer, m.id_plan, m.applied_price,
       m.start_date, m.end_date
FROM tmp_demo_membership_seed s
JOIN tmp_demo_customer_map_after cm ON cm.slot = s.customer_slot
JOIN membership_plans p
  ON p.duration_days = s.duration_days AND p.status = 'ACTIVE'
JOIN memberships m
  ON m.id_customer = cm.id_customer
 AND m.id_plan = p.id_plan
 AND m.start_date = DATE_ADD(@demo_today, INTERVAL s.start_offset DAY)
 AND m.end_date = DATE_ADD(@demo_today, INTERVAL (s.start_offset + s.duration_days - 1) DAY)
 AND m.status = 'PENDING'
WHERE @demo_preflight_ok = 1;

INSERT INTO erp_promotion_applications
  (id_membership, id_promotion, base_price, discount_amount, final_price, applied_by)
SELECT mm.id_membership, promo.id_promotion, p.price,
       ROUND(p.price * mm.discount_pct / 100, 2),
       ROUND(p.price - ROUND(p.price * mm.discount_pct / 100, 2), 2),
       @demo_actor
FROM tmp_demo_membership_map mm
JOIN membership_plans p ON p.id_plan = mm.id_plan
JOIN erp_promotions promo
  ON promo.id_plan = mm.id_plan
 AND LOCATE(@demo_marker, promo.description) > 0
 AND promo.discount_value = mm.discount_pct
WHERE @demo_preflight_ok = 1
  AND mm.slot IN (4,5,8);

-- La aplicacion real requiere membresia PENDING, registra el detalle del
-- descuento y actualiza el precio congelado antes de cobrar.
UPDATE memberships m
JOIN tmp_demo_membership_map mm ON mm.id_membership = m.id_membership
JOIN membership_plans p ON p.id_plan = m.id_plan
SET m.applied_price =
  ROUND(p.price - ROUND(p.price * mm.discount_pct / 100, 2), 2)
WHERE @demo_preflight_ok = 1 AND mm.slot IN (4,5,8);

INSERT INTO payments
  (id_membership, id_user, id_payment_method, amount,
   payment_date, status, notes, createdBy)
SELECT mm.id_membership, @demo_actor, pm.id_payment_method, m.applied_price,
       DATE_ADD(DATE_ADD(@demo_today, INTERVAL mm.payment_offset DAY), INTERVAL 14 HOUR),
       'REGISTERED',
       CONCAT(@demo_marker, '|PAYMENT|', LPAD(mm.slot,2,'0')),
       @demo_actor
FROM tmp_demo_membership_map mm
JOIN memberships m ON m.id_membership = mm.id_membership
JOIN payment_methods pm ON pm.name = mm.payment_method AND pm.status = 'ACTIVE'
WHERE @demo_preflight_ok = 1
  AND mm.slot BETWEEN 1 AND 20;

-- Cada pago tiene exactamente un PAYMENT_IN, incluso si luego se anula.
INSERT INTO erp_cash_movements
  (business_date, movement_kind, amount, id_payment, id_payment_method,
   is_cash, registered_by, registered_at, notes)
SELECT DATE(DATE_SUB(pay.payment_date, INTERVAL 4 HOUR)),
       'PAYMENT_IN', pay.amount, pay.id_payment, pay.id_payment_method,
       (LOWER(pm.name) = 'efectivo'), @demo_actor, pay.payment_date,
       CONCAT(@demo_marker, '|PAYMENT_IN')
FROM payments pay
JOIN tmp_demo_membership_map mm ON mm.id_membership = pay.id_membership
JOIN payment_methods pm ON pm.id_payment_method = pay.id_payment_method
WHERE @demo_preflight_ok = 1
  AND LEFT(pay.notes, LENGTH(CONCAT(@demo_marker, '|PAYMENT|'))) =
      CONCAT(@demo_marker, '|PAYMENT|');

-- El alta de pago del ERP activa la membresia. Las vencidas se marcan EXPIRED
-- y las anuladas pasan a CANCELLED despues de insertar su reversion.
UPDATE memberships m
JOIN tmp_demo_membership_map mm ON mm.id_membership = m.id_membership
SET m.status = 'ACTIVE'
WHERE @demo_preflight_ok = 1 AND mm.slot BETWEEN 1 AND 20;

INSERT INTO erp_payment_cancellations (id_payment, reason, cancelled_by, cancelled_at)
SELECT pay.id_payment,
       CONCAT(@demo_marker, ' reembolso ficticio confirmado para demostracion'),
       @demo_actor, UTC_TIMESTAMP()
FROM payments pay
JOIN tmp_demo_membership_map mm ON mm.id_membership = pay.id_membership
WHERE @demo_preflight_ok = 1 AND mm.state = 'CANCELLED';

-- La anulacion se refleja una sola vez como PAYMENT_REVERSAL en la fecha actual.
INSERT INTO erp_cash_movements
  (business_date, movement_kind, amount, id_payment, id_payment_method,
   is_cash, registered_by, registered_at, notes)
SELECT @demo_today, 'PAYMENT_REVERSAL', pay.amount, pay.id_payment,
       pay.id_payment_method, (LOWER(pm.name) = 'efectivo'),
       @demo_actor, UTC_TIMESTAMP(),
       CASE WHEN LOWER(pm.name) = 'efectivo'
            THEN CONCAT(@demo_marker, '|Reembolso en efectivo confirmado')
            ELSE CONCAT(@demo_marker, '|Reembolso confirmado. Referencia DEMO-REF-',
                        LPAD(mm.slot,2,'0')) END
FROM payments pay
JOIN tmp_demo_membership_map mm ON mm.id_membership = pay.id_membership
JOIN payment_methods pm ON pm.id_payment_method = pay.id_payment_method
WHERE @demo_preflight_ok = 1 AND mm.state = 'CANCELLED';

UPDATE payments pay
JOIN tmp_demo_membership_map mm ON mm.id_membership = pay.id_membership
SET pay.status = 'CANCELLED'
WHERE @demo_preflight_ok = 1 AND mm.state = 'CANCELLED';

UPDATE memberships m
JOIN tmp_demo_membership_map mm ON mm.id_membership = m.id_membership
SET m.status = 'CANCELLED'
WHERE @demo_preflight_ok = 1 AND mm.state = 'CANCELLED';

UPDATE memberships m
JOIN tmp_demo_membership_map mm ON mm.id_membership = m.id_membership
SET m.status = 'EXPIRED'
WHERE @demo_preflight_ok = 1 AND mm.state = 'EXPIRED';

UPDATE customers c
JOIN tmp_demo_customer_seed s ON s.phone = c.phone
SET c.status = s.customer_status
WHERE @demo_preflight_ok = 1
  AND s.customer_status = 'INACTIVE'
  AND LEFT(c.notes, LENGTH(CONCAT(@demo_marker, '|CUSTOMER|'))) =
      CONCAT(@demo_marker, '|CUSTOMER|');

INSERT INTO erp_financial_entries
  (entry_type, category, concept, amount, entry_date, id_payment_method, created_by, notes)
SELECT fs.entry_type, fs.category,
       CONCAT(@demo_marker, ' ', fs.concept), fs.amount,
       DATE_ADD(DATE_ADD(@demo_today, INTERVAL fs.day_offset DAY), INTERVAL 14 HOUR),
       pm.id_payment_method, @demo_actor,
       CONCAT(@demo_marker, '|FINANCE|', LPAD(fs.slot,2,'0'))
FROM tmp_demo_finance_seed fs
JOIN payment_methods pm ON pm.name = fs.payment_method AND pm.status = 'ACTIVE'
WHERE @demo_preflight_ok = 1;

INSERT INTO erp_cash_movements
  (business_date, movement_kind, amount, id_financial_entry,
   id_payment_method, is_cash, registered_by, registered_at, notes)
SELECT DATE(DATE_SUB(fe.entry_date, INTERVAL 4 HOUR)),
       CASE WHEN fe.entry_type = 'EXPENSE' THEN 'EXPENSE_OUT' ELSE 'OTHER_IN' END,
       fe.amount, fe.id_financial_entry, fe.id_payment_method,
       (LOWER(pm.name) = 'efectivo'), @demo_actor, fe.entry_date,
       CONCAT(@demo_marker, '|FINANCE_MOVEMENT')
FROM erp_financial_entries fe
JOIN payment_methods pm ON pm.id_payment_method = fe.id_payment_method
WHERE @demo_preflight_ok = 1
  AND LEFT(fe.notes, LENGTH(CONCAT(@demo_marker, '|FINANCE|'))) =
      CONCAT(@demo_marker, '|FINANCE|');

-- Asistencias por cliente/membresia; 60 fechas dentro de la vigencia, sin horas
-- futuras. Los ultimos accesos de los slots 6, 7 y 8 permiten ver umbrales
-- distintos de inactividad en Dirección (7, 15 y 30 dias).
INSERT INTO customer_attendances
  (id_customer, id_membership, attendance_date, entry_time, uploadedBy)
SELECT mm.id_customer, mm.id_membership,
       DATE_ADD(mm.start_date, INTERVAL (
         CASE
           WHEN seq.n BETWEEN 1 AND 15 THEN FLOOR((seq.n - 1) * 29 / 14)
           WHEN seq.n BETWEEN 16 AND 29 THEN FLOOR((seq.n - 16) * 20 / 13)
           WHEN seq.n BETWEEN 30 AND 40 THEN seq.n - 30
           WHEN seq.n BETWEEN 41 AND 49 THEN FLOOR((seq.n - 41) * 28 / 8)
           WHEN seq.n BETWEEN 50 AND 55 THEN FLOOR((seq.n - 50) * 26 / 5)
           WHEN seq.n BETWEEN 56 AND 58 THEN FLOOR((seq.n - 56) * 14 / 2)
           WHEN seq.n = 59 THEN 2
           ELSE 5
         END
       ) DAY),
       MAKETIME(6 + MOD(seq.n * 7, 15), MOD(seq.n * 13, 60), 0),
       NULL
FROM (
  SELECT ones.n + tens.n * 10 + 1 AS n
  FROM (SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3
        UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7
        UNION ALL SELECT 8 UNION ALL SELECT 9) ones
  CROSS JOIN
       (SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3
        UNION ALL SELECT 4 UNION ALL SELECT 5) tens
) seq
JOIN tmp_demo_membership_map mm
  ON mm.slot = CASE
    WHEN seq.n BETWEEN 1 AND 15 THEN 1
    WHEN seq.n BETWEEN 16 AND 29 THEN 2
    WHEN seq.n BETWEEN 30 AND 40 THEN 3
    WHEN seq.n BETWEEN 41 AND 49 THEN 4
    WHEN seq.n BETWEEN 50 AND 55 THEN 5
    WHEN seq.n BETWEEN 56 AND 58 THEN 6
    WHEN seq.n = 59 THEN 7
    ELSE 8
  END
WHERE @demo_preflight_ok = 1 AND seq.n <= 60;

INSERT INTO erp_renewal_requests
  (id_customer, id_previous_membership, id_new_membership, status,
   requested_by, requested_at, completed_at, notes)
SELECT oldm.id_customer, oldm.id_membership, newm.id_membership,
       'COMPLETED', @demo_actor,
       DATE_ADD(DATE_ADD(@demo_today, INTERVAL newm.start_offset DAY), INTERVAL 13 HOUR),
       DATE_ADD(DATE_ADD(@demo_today, INTERVAL newm.payment_offset DAY), INTERVAL 14 HOUR),
       CONCAT(@demo_marker, '|RENEWAL|COMPLETED|', oldm.slot, '->', newm.slot)
FROM tmp_demo_membership_map oldm
JOIN tmp_demo_membership_map newm
  ON newm.customer_slot = oldm.customer_slot
WHERE @demo_preflight_ok = 1
  AND oldm.slot BETWEEN 9 AND 11
  AND newm.slot = oldm.slot - 8;

INSERT INTO erp_renewal_requests
  (id_customer, id_previous_membership, id_new_membership, status,
   requested_by, requested_at, completed_at, notes)
SELECT oldm.id_customer, oldm.id_membership, NULL, 'REQUESTED',
       @demo_actor, UTC_TIMESTAMP(), NULL,
       CONCAT(@demo_marker, '|RENEWAL|REQUESTED|', oldm.slot)
FROM tmp_demo_membership_map oldm
WHERE @demo_preflight_ok = 1 AND oldm.slot BETWEEN 12 AND 14;

-- Cuatro vencimientos proximos y una alerta de baja actividad.
INSERT INTO erp_membership_alerts (id_membership, alert_type, reference_date, status)
SELECT mm.id_membership, 'EXPIRING', mm.end_date, 'PENDING'
FROM tmp_demo_membership_map mm
WHERE @demo_preflight_ok = 1 AND mm.slot BETWEEN 4 AND 7;

INSERT INTO erp_membership_alerts (id_membership, alert_type, reference_date, status)
SELECT mm.id_membership, 'LOW_ATTENDANCE',
       DATE_ADD(mm.start_date, INTERVAL 5 DAY), 'PENDING'
FROM tmp_demo_membership_map mm
WHERE @demo_preflight_ok = 1 AND mm.slot = 8;

CREATE TEMPORARY TABLE tmp_demo_followup_seed (
  slot TINYINT PRIMARY KEY,
  customer_slot TINYINT NOT NULL,
  membership_slot TINYINT NOT NULL,
  reason VARCHAR(20) NOT NULL,
  contact_method VARCHAR(20) NOT NULL,
  result VARCHAR(20) NOT NULL
);
INSERT INTO tmp_demo_followup_seed VALUES
  (1,1,1,'EXPIRING','PHONE','CONTACTED'),
  (2,2,2,'EXPIRING','WHATSAPP','PENDING'),
  (3,3,3,'EXPIRING','EMAIL','RENEWAL_ACCEPTED'),
  (4,4,4,'EXPIRING','IN_PERSON','PENDING'),
  (5,8,8,'LOW_ATTENDANCE','PHONE','NO_RESPONSE'),
  (6,9,12,'EXPIRED','WHATSAPP','DECLINED'),
  (7,10,13,'EXPIRED','EMAIL','CONTACTED'),
  (8,11,14,'EXPIRED','OTHER','PENDING');

INSERT INTO erp_commercial_followups
  (id_customer, id_membership, id_renewal_request, reason, contact_method,
   contact_date, result, notes, next_action_at, responsible_user)
SELECT cm.id_customer, mm.id_membership, NULL, fs.reason, fs.contact_method,
       DATE_SUB(UTC_TIMESTAMP(), INTERVAL fs.slot DAY), fs.result,
       CONCAT(@demo_marker, '|FOLLOWUP|', LPAD(fs.slot,2,'0')),
       CASE WHEN fs.result = 'PENDING'
            THEN DATE_ADD(UTC_TIMESTAMP(), INTERVAL 3 DAY) ELSE NULL END,
       @demo_actor
FROM tmp_demo_followup_seed fs
JOIN tmp_demo_customer_map_after cm ON cm.slot = fs.customer_slot
JOIN tmp_demo_membership_map mm ON mm.slot = fs.membership_slot
WHERE @demo_preflight_ok = 1;

-- Totales por dia para cierres: incluyen los movimientos preexistentes del dia,
-- si los hubiera. El preflight exige que no exista ningun cierre previo.
SET @demo_day_1 := DATE_SUB(@demo_today, INTERVAL 14 DAY);
SET @demo_day_2 := DATE_SUB(@demo_today, INTERVAL 3 DAY);
SET @demo_day_3 := @demo_today;

CREATE TEMPORARY TABLE tmp_demo_closure_totals AS
SELECT days.business_date,
       COALESCE(SUM(CASE WHEN cm.movement_kind IN ('PAYMENT_IN','OTHER_IN')
                         THEN cm.amount ELSE 0 END),0) AS total_income,
       COALESCE(SUM(CASE WHEN cm.movement_kind = 'EXPENSE_OUT'
                         THEN cm.amount ELSE 0 END),0) AS total_expenses,
       COALESCE(SUM(CASE WHEN cm.movement_kind = 'PAYMENT_REVERSAL'
                         THEN cm.amount ELSE 0 END),0) AS total_reversals,
       COALESCE(SUM(CASE WHEN cm.is_cash = 1 AND cm.movement_kind IN ('PAYMENT_IN','OTHER_IN')
                         THEN cm.amount ELSE 0 END),0) AS cash_income,
       COALESCE(SUM(CASE WHEN cm.is_cash = 1 AND cm.movement_kind = 'EXPENSE_OUT'
                         THEN cm.amount ELSE 0 END),0) AS cash_expenses,
       COALESCE(SUM(CASE WHEN cm.is_cash = 1 AND cm.movement_kind = 'PAYMENT_REVERSAL'
                         THEN cm.amount ELSE 0 END),0) AS cash_reversals
FROM (
  SELECT @demo_day_1 AS business_date
  UNION ALL SELECT @demo_day_2
  UNION ALL SELECT @demo_day_3
) days
LEFT JOIN erp_cash_movements cm ON cm.business_date = days.business_date
GROUP BY days.business_date;

INSERT INTO erp_cash_closures
  (business_date, opening_cash, total_income, total_expenses, total_reversals,
   expected_cash, counted_cash, difference_cash, closed_by, closed_at, notes)
SELECT t.business_date, 0, t.total_income, t.total_expenses, t.total_reversals,
       t.cash_income - t.cash_expenses - t.cash_reversals,
       t.cash_income - t.cash_expenses - t.cash_reversals,
       0, @demo_actor, UTC_TIMESTAMP(),
       CONCAT(@demo_marker, '|CLOSURE|01|sin diferencia')
FROM tmp_demo_closure_totals t
WHERE @demo_preflight_ok = 1 AND t.business_date = @demo_day_1;

INSERT INTO erp_cash_closures
  (business_date, opening_cash, total_income, total_expenses, total_reversals,
   expected_cash, counted_cash, difference_cash, closed_by, closed_at, notes)
SELECT t.business_date, prev.counted_cash, t.total_income, t.total_expenses, t.total_reversals,
       prev.counted_cash + t.cash_income - t.cash_expenses - t.cash_reversals,
       prev.counted_cash + t.cash_income - t.cash_expenses - t.cash_reversals,
       0, @demo_actor, UTC_TIMESTAMP(),
       CONCAT(@demo_marker, '|CLOSURE|02|sin diferencia')
FROM tmp_demo_closure_totals t
JOIN erp_cash_closures prev
  ON prev.business_date = @demo_day_1
 AND LOCATE(@demo_marker, prev.notes) > 0
WHERE @demo_preflight_ok = 1 AND t.business_date = @demo_day_2;

INSERT INTO erp_cash_closures
  (business_date, opening_cash, total_income, total_expenses, total_reversals,
   expected_cash, counted_cash, difference_cash, closed_by, closed_at, notes)
SELECT t.business_date, prev.counted_cash, t.total_income, t.total_expenses, t.total_reversals,
       prev.counted_cash + t.cash_income - t.cash_expenses - t.cash_reversals,
       prev.counted_cash + t.cash_income - t.cash_expenses - t.cash_reversals + 25.00,
       25.00, @demo_actor, UTC_TIMESTAMP(),
       CONCAT(@demo_marker, '|CLOSURE|03|diferencia ficticia de Bs 25 explicada')
FROM tmp_demo_closure_totals t
JOIN erp_cash_closures prev
  ON prev.business_date = @demo_day_2
 AND LOCATE(@demo_marker, prev.notes) > 0
WHERE @demo_preflight_ok = 1 AND t.business_date = @demo_day_3;

COMMIT;

SELECT @demo_preflight_ok AS load_was_enabled,
       (SELECT COUNT(*) FROM customers
        WHERE LOCATE(@demo_marker, notes) > 0) AS demo_customers,
       (SELECT COUNT(*) FROM memberships m JOIN customers c ON c.id_customer = m.id_customer
        WHERE LOCATE(@demo_marker, c.notes) > 0) AS demo_memberships,
       (SELECT COUNT(*) FROM payments p JOIN memberships m ON m.id_membership = p.id_membership
        JOIN customers c ON c.id_customer = m.id_customer
        WHERE LOCATE(@demo_marker, c.notes) > 0) AS demo_payments;
