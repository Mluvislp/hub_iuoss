-- READ ONLY. Save results with the database name/date before reviewing the upgrade.
SELECT DATABASE(), VERSION(), @@version_comment, @@sql_mode;
SELECT TABLE_NAME, ENGINE, TABLE_ROWS, DATA_LENGTH, INDEX_LENGTH
FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()
AND TABLE_NAME IN ('hub_insurance_registrations','student_health_insurance_cards',
 'student_health_insurance_registration_types','hub_insurance_configs','hub_insurance_bank_accounts');
SHOW CREATE TABLE hub_insurance_registrations;
SHOW CREATE TABLE student_health_insurance_cards;
SHOW CREATE TABLE student_health_insurance_registration_types;
SELECT status, COUNT(*) AS registrations FROM hub_insurance_registrations GROUP BY status;
SELECT r.id, r.student_id, r.registration_year, r.registration_period
FROM hub_insurance_registrations r LEFT JOIN student_health_insurance_cards c ON c.source_registration_id=r.id
WHERE r.status='done' AND c.id IS NULL;
SELECT student_id, registration_year, registration_period, COUNT(*) AS duplicates
FROM hub_insurance_registrations GROUP BY student_id, registration_year, registration_period HAVING COUNT(*)>1;
SELECT id, status, registration_year, registration_period FROM hub_insurance_registrations
WHERE status NOT IN ('pending','processing','done','rejected','iu_processing','waiting_bhxh','issued')
OR registration_period NOT IN ('MAIN','Q2','Q3','Q4') OR registration_year NOT BETWEEN 2000 AND 2200;
SELECT id FROM hub_insurance_registrations WHERE config_snapshot IS NULL;
SELECT id FROM hub_insurance_registrations WHERE COALESCE(payment_receipt_image,'')='';
SELECT r.id FROM hub_insurance_registrations r LEFT JOIN students s ON s.id=r.student_id WHERE s.id IS NULL;
SELECT c.id FROM student_health_insurance_cards c LEFT JOIN hub_insurance_registrations r ON r.id=c.source_registration_id
WHERE c.source_registration_id IS NOT NULL AND r.id IS NULL;
SELECT student_id, COUNT(*) FROM student_health_insurance_cards WHERE is_current=1 GROUP BY student_id HAVING COUNT(*)>1;
SELECT id, code, name, is_active FROM student_health_insurance_registration_types ORDER BY sort_order, code;
SELECT CONSTRAINT_NAME, TABLE_NAME, REFERENCED_TABLE_NAME, DELETE_RULE
FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE();
-- File existence and MIME cannot be established by SQL. Run backfill in dry-run mode on the Hub media host.
