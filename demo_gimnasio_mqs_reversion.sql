-- Gimnasio MQS - reversion controlada de datos de demostracion.
-- NO ejecutar en produccion. Este archivo NO se ha ejecutado.
--
-- Revisar primero los conteos de vista previa. La eliminacion esta desactivada:
-- cambiar @demo_confirm_delete y @demo_confirm_nonproduction a 1 solo despues
-- de confirmar el respaldo, el host local/de pruebas y que cada conjunto
-- pertenece al marcador indicado.
-- Ejecutar en conexion nueva y sin otra carga/reversion simultanea.
-- No usa TRUNCATE, DROP, cascadas ni desactiva claves foraneas.

SET @demo_marker := 'DEMO_MQS_DIRECCION_2026_V1';
SET @demo_confirm_delete := 0;
SET @demo_confirm_nonproduction := 0;

SELECT DATABASE() AS selected_database, @@hostname AS mysql_host,
       @demo_confirm_delete AS delete_confirmed,
       @demo_confirm_nonproduction AS nonproduction_confirmed;

-- Vista previa de lo que se considera demostracion.
SELECT 'customers' AS entity, COUNT(*) AS rows_to_delete
FROM customers c WHERE LOCATE(@demo_marker, c.notes) > 0
UNION ALL
SELECT 'memberships', COUNT(*)
FROM memberships m JOIN customers c ON c.id_customer = m.id_customer
WHERE LOCATE(@demo_marker, c.notes) > 0
UNION ALL
SELECT 'payments', COUNT(*)
FROM payments p WHERE LEFT(p.notes, LENGTH(CONCAT(@demo_marker, '|PAYMENT|'))) =
  CONCAT(@demo_marker, '|PAYMENT|')
UNION ALL
SELECT 'payment_cancellations', COUNT(*)
FROM erp_payment_cancellations pc
JOIN payments p ON p.id_payment = pc.id_payment
WHERE LEFT(p.notes, LENGTH(CONCAT(@demo_marker, '|PAYMENT|'))) =
  CONCAT(@demo_marker, '|PAYMENT|')
UNION ALL
SELECT 'cash_movements', COUNT(*)
FROM erp_cash_movements cm
LEFT JOIN payments p ON p.id_payment = cm.id_payment
LEFT JOIN erp_financial_entries fe ON fe.id_financial_entry = cm.id_financial_entry
WHERE LOCATE(@demo_marker, cm.notes) > 0
   OR LEFT(p.notes, LENGTH(CONCAT(@demo_marker, '|PAYMENT|'))) = CONCAT(@demo_marker, '|PAYMENT|')
   OR LEFT(fe.notes, LENGTH(CONCAT(@demo_marker, '|FINANCE|'))) = CONCAT(@demo_marker, '|FINANCE|')
UNION ALL
SELECT 'financial_entries', COUNT(*)
FROM erp_financial_entries fe
WHERE LEFT(fe.notes, LENGTH(CONCAT(@demo_marker, '|FINANCE|'))) =
  CONCAT(@demo_marker, '|FINANCE|')
UNION ALL
SELECT 'attendances', COUNT(*)
FROM customer_attendances a
JOIN memberships m ON m.id_membership = a.id_membership
JOIN customers c ON c.id_customer = m.id_customer
WHERE LOCATE(@demo_marker, c.notes) > 0
UNION ALL
SELECT 'promotion_applications', COUNT(*)
FROM erp_promotion_applications app
JOIN memberships m ON m.id_membership = app.id_membership
JOIN customers c ON c.id_customer = m.id_customer
WHERE LOCATE(@demo_marker, c.notes) > 0
UNION ALL
SELECT 'renewal_requests', COUNT(*)
FROM erp_renewal_requests r
WHERE LEFT(r.notes, LENGTH(CONCAT(@demo_marker, '|RENEWAL|'))) =
  CONCAT(@demo_marker, '|RENEWAL|')
UNION ALL
SELECT 'alerts', COUNT(*)
FROM erp_membership_alerts al
JOIN memberships m ON m.id_membership = al.id_membership
JOIN customers c ON c.id_customer = m.id_customer
WHERE LOCATE(@demo_marker, c.notes) > 0
UNION ALL
SELECT 'followups', COUNT(*)
FROM erp_commercial_followups f
WHERE LEFT(f.notes, LENGTH(CONCAT(@demo_marker, '|FOLLOWUP|'))) =
  CONCAT(@demo_marker, '|FOLLOWUP|')
UNION ALL
SELECT 'promotions', COUNT(*)
FROM erp_promotions promo
WHERE LOCATE(@demo_marker, promo.description) > 0
UNION ALL
SELECT 'cash_closures', COUNT(*)
FROM erp_cash_closures cl
WHERE LOCATE(@demo_marker, cl.notes) > 0;

-- Previsualizar aplicaciones demo enlazadas accidentalmente a membresias no demo.
-- Si devuelve filas, detenerse y revisarlas: no son eliminadas por este archivo.
SELECT app.id_application, app.id_promotion, app.id_membership,
       c.id_customer, c.first_name, c.last_name
FROM erp_promotion_applications app
JOIN erp_promotions promo ON promo.id_promotion = app.id_promotion
JOIN memberships m ON m.id_membership = app.id_membership
JOIN customers c ON c.id_customer = m.id_customer
WHERE LOCATE(@demo_marker, promo.description) > 0
  AND LOCATE(@demo_marker, c.notes) = 0;

START TRANSACTION;

DELETE FROM erp_cash_closures
WHERE @demo_confirm_delete = 1 AND @demo_confirm_nonproduction = 1
  AND LOCATE(@demo_marker, notes) > 0;

DELETE al
FROM erp_membership_alerts al
JOIN memberships m ON m.id_membership = al.id_membership
JOIN customers c ON c.id_customer = m.id_customer
WHERE @demo_confirm_delete = 1 AND @demo_confirm_nonproduction = 1
  AND LOCATE(@demo_marker, c.notes) > 0;

DELETE f
FROM erp_commercial_followups f
WHERE @demo_confirm_delete = 1 AND @demo_confirm_nonproduction = 1
  AND LEFT(f.notes, LENGTH(CONCAT(@demo_marker, '|FOLLOWUP|'))) =
      CONCAT(@demo_marker, '|FOLLOWUP|');

DELETE r
FROM erp_renewal_requests r
WHERE @demo_confirm_delete = 1 AND @demo_confirm_nonproduction = 1
  AND LEFT(r.notes, LENGTH(CONCAT(@demo_marker, '|RENEWAL|'))) =
      CONCAT(@demo_marker, '|RENEWAL|');

DELETE app
FROM erp_promotion_applications app
JOIN memberships m ON m.id_membership = app.id_membership
JOIN customers c ON c.id_customer = m.id_customer
WHERE @demo_confirm_delete = 1 AND @demo_confirm_nonproduction = 1
  AND LOCATE(@demo_marker, c.notes) > 0;

DELETE pc
FROM erp_payment_cancellations pc
JOIN payments p ON p.id_payment = pc.id_payment
WHERE @demo_confirm_delete = 1 AND @demo_confirm_nonproduction = 1
  AND LEFT(p.notes, LENGTH(CONCAT(@demo_marker, '|PAYMENT|'))) =
      CONCAT(@demo_marker, '|PAYMENT|');

DELETE cm
FROM erp_cash_movements cm
LEFT JOIN payments p ON p.id_payment = cm.id_payment
LEFT JOIN erp_financial_entries fe ON fe.id_financial_entry = cm.id_financial_entry
WHERE @demo_confirm_delete = 1 AND @demo_confirm_nonproduction = 1
  AND (
    LOCATE(@demo_marker, cm.notes) > 0
    OR LEFT(p.notes, LENGTH(CONCAT(@demo_marker, '|PAYMENT|'))) = CONCAT(@demo_marker, '|PAYMENT|')
    OR LEFT(fe.notes, LENGTH(CONCAT(@demo_marker, '|FINANCE|'))) = CONCAT(@demo_marker, '|FINANCE|')
  );

DELETE p
FROM payments p
WHERE @demo_confirm_delete = 1 AND @demo_confirm_nonproduction = 1
  AND LEFT(p.notes, LENGTH(CONCAT(@demo_marker, '|PAYMENT|'))) =
      CONCAT(@demo_marker, '|PAYMENT|');

DELETE a
FROM customer_attendances a
JOIN memberships m ON m.id_membership = a.id_membership
JOIN customers c ON c.id_customer = m.id_customer
WHERE @demo_confirm_delete = 1 AND @demo_confirm_nonproduction = 1
  AND LOCATE(@demo_marker, c.notes) > 0;

DELETE fe
FROM erp_financial_entries fe
WHERE @demo_confirm_delete = 1 AND @demo_confirm_nonproduction = 1
  AND LEFT(fe.notes, LENGTH(CONCAT(@demo_marker, '|FINANCE|'))) =
      CONCAT(@demo_marker, '|FINANCE|');

DELETE m
FROM memberships m
JOIN customers c ON c.id_customer = m.id_customer
WHERE @demo_confirm_delete = 1 AND @demo_confirm_nonproduction = 1
  AND LOCATE(@demo_marker, c.notes) > 0;

-- No se eliminan promociones con aplicaciones asociadas a clientes reales.
DELETE promo
FROM erp_promotions promo
WHERE @demo_confirm_delete = 1 AND @demo_confirm_nonproduction = 1
  AND LOCATE(@demo_marker, promo.description) > 0
  AND NOT EXISTS (
    SELECT 1
    FROM erp_promotion_applications app
    WHERE app.id_promotion = promo.id_promotion
  );

DELETE c
FROM customers c
WHERE @demo_confirm_delete = 1 AND @demo_confirm_nonproduction = 1
  AND LOCATE(@demo_marker, c.notes) > 0;

COMMIT;

-- Confirmacion de remanentes (debe devolver ceros al completar la reversion).
SELECT
  (SELECT COUNT(*) FROM customers
   WHERE LOCATE(@demo_marker, notes) > 0) AS demo_customers_remaining,
  (SELECT COUNT(*) FROM erp_promotions
   WHERE LOCATE(@demo_marker, description) > 0) AS demo_promotions_remaining,
  (SELECT COUNT(*) FROM erp_financial_entries
   WHERE LEFT(notes, LENGTH(CONCAT(@demo_marker, '|FINANCE|'))) =
     CONCAT(@demo_marker, '|FINANCE|')) AS demo_financial_entries_remaining,
  (SELECT COUNT(*) FROM erp_cash_closures
   WHERE LOCATE(@demo_marker, notes) > 0) AS demo_closures_remaining;
