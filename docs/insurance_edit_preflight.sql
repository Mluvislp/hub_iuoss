-- Read-only. Save these counts and review ambiguous / unmapped declarations.
SELECT DATABASE(), @@session.time_zone;
SELECT COUNT(*) registrations, MIN(id), MAX(id) FROM hub_insurance_registrations;
SELECT COUNT(*) declarations, MIN(id), MAX(id) FROM student_external_health_insurance_declarations;
SELECT id, registration_year, registration_period, registration_opens_at, registration_closes_at FROM hub_insurance_configs;
SELECT d.id, d.created_at, COUNT(c.id) candidates
FROM student_external_health_insurance_declarations d LEFT JOIN hub_insurance_configs c
 ON d.created_at BETWEEN c.registration_opens_at AND c.registration_closes_at
GROUP BY d.id, d.created_at HAVING COUNT(c.id) <> 1;
