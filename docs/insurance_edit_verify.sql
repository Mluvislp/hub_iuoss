-- Counts must match preflight. Run with both apps still paused.
SELECT COUNT(*), MIN(id), MAX(id) FROM hub_insurance_registrations;
SELECT COUNT(*), MIN(id), MAX(id) FROM student_external_health_insurance_declarations;
SELECT id, student_id, created_at FROM student_external_health_insurance_declarations
 WHERE intake_year IS NULL OR intake_period IS NULL;
SELECT student_id, intake_year, intake_period, COUNT(*) n FROM student_external_health_insurance_declarations
 WHERE intake_year IS NOT NULL GROUP BY student_id, intake_year, intake_period HAVING COUNT(*) > 1;
SHOW INDEX FROM hub_insurance_registrations;
SHOW INDEX FROM student_external_health_insurance_declarations;
SHOW CREATE TABLE hub_external_insurance_events;
