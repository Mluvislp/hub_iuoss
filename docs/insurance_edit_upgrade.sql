-- Expand only. Run after preflight, with BOTH applications in maintenance mode.
-- MySQL DDL commits implicitly; take a database backup first. Never run old config upgrade SQL.
DROP PROCEDURE IF EXISTS iuoss_insurance_edit_expand;
DELIMITER $$
CREATE PROCEDURE iuoss_insurance_edit_expand()
BEGIN
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='hub_insurance_registrations' AND column_name='note') THEN
  ALTER TABLE hub_insurance_registrations ADD COLUMN note TEXT NULL;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='hub_insurance_registrations' AND column_name='supplement_pending') THEN
  ALTER TABLE hub_insurance_registrations ADD COLUMN supplement_pending BOOLEAN NOT NULL DEFAULT 0;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='hub_insurance_registrations' AND column_name='supplemented_at') THEN
  ALTER TABLE hub_insurance_registrations ADD COLUMN supplemented_at DATETIME(6) NULL;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='hub_insurance_registrations' AND column_name='supplement_reviewed_at') THEN
  ALTER TABLE hub_insurance_registrations ADD COLUMN supplement_reviewed_at DATETIME(6) NULL;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='student_external_health_insurance_declarations' AND column_name='intake_year') THEN
  ALTER TABLE student_external_health_insurance_declarations ADD COLUMN intake_year INT NULL;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='student_external_health_insurance_declarations' AND column_name='intake_period') THEN
  ALTER TABLE student_external_health_insurance_declarations ADD COLUMN intake_period VARCHAR(32) COLLATE utf8mb4_unicode_ci NULL;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='student_external_health_insurance_declarations' AND column_name='intake_snapshot') THEN
  ALTER TABLE student_external_health_insurance_declarations ADD COLUMN intake_snapshot JSON NULL;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='student_external_health_insurance_declarations' AND column_name='row_version') THEN
  ALTER TABLE student_external_health_insurance_declarations ADD COLUMN row_version INT UNSIGNED NOT NULL DEFAULT 0;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='student_external_health_insurance_declarations' AND column_name='supplement_pending') THEN
  ALTER TABLE student_external_health_insurance_declarations ADD COLUMN supplement_pending BOOLEAN NOT NULL DEFAULT 0;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='student_external_health_insurance_declarations' AND column_name='supplemented_at') THEN
  ALTER TABLE student_external_health_insurance_declarations ADD COLUMN supplemented_at DATETIME(6) NULL;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='student_external_health_insurance_declarations' AND column_name='supplement_reviewed_at') THEN
  ALTER TABLE student_external_health_insurance_declarations ADD COLUMN supplement_reviewed_at DATETIME(6) NULL;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='hub_insurance_registrations' AND index_name='ix_supplement_queue') THEN
 ALTER TABLE hub_insurance_registrations ADD INDEX ix_supplement_queue (supplement_pending, supplemented_at, id);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='student_external_health_insurance_declarations' AND index_name='ix_supplement_queue') THEN
 ALTER TABLE student_external_health_insurance_declarations ADD INDEX ix_supplement_queue (supplement_pending, supplemented_at, id);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='student_external_health_insurance_declarations' AND index_name='ix_external_intake') THEN
 ALTER TABLE student_external_health_insurance_declarations ADD INDEX ix_external_intake (student_id, intake_year, intake_period);
 END IF;
END$$
DELIMITER ;
CALL iuoss_insurance_edit_expand();
DROP PROCEDURE iuoss_insurance_edit_expand;

CREATE TABLE IF NOT EXISTS hub_external_insurance_events (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 declaration_id BIGINT NOT NULL,
 event_type VARCHAR(40) NOT NULL,
 actor_id BIGINT NULL,
 source_app VARCHAR(16) NOT NULL,
 request_key VARCHAR(96) NULL,
 payload JSON NULL,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 UNIQUE KEY uq_external_event_request (declaration_id, request_key),
 KEY ix_external_event_timeline (declaration_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- No inference from validity dates. Map only a single unambiguous time interval.
-- This keeps legacy registration_year (card year), ID, created_at, status and all images intact.
UPDATE student_external_health_insurance_declarations d
JOIN (
 SELECT d0.id, MIN(c.id) config_id
 FROM student_external_health_insurance_declarations d0
 JOIN hub_insurance_configs c ON d0.created_at BETWEEN c.registration_opens_at AND c.registration_closes_at
 WHERE d0.intake_year IS NULL AND d0.intake_period IS NULL
 GROUP BY d0.id HAVING COUNT(*)=1
) matches ON matches.id=d.id
JOIN hub_insurance_configs c ON c.id=matches.config_id
SET d.intake_year=c.registration_year, d.intake_period=c.registration_period,
 d.intake_snapshot=JSON_OBJECT('registration_year',c.registration_year,'registration_period',c.registration_period,
   'start_date',DATE_FORMAT(c.registration_opens_at,'%Y-%m-%dT%H:%i:%sZ'),
   'end_date',DATE_FORMAT(c.registration_closes_at,'%Y-%m-%dT%H:%i:%sZ'));

-- Seed the queue only for legacy resubmissions that have no later staff action.
UPDATE hub_insurance_registrations r JOIN (
 SELECT registration_id, MAX(event_no) event_no, MAX(created_at) submitted_at
 FROM hub_insurance_registration_events WHERE event_type='RESUBMITTED' AND source_app='Hub'
 GROUP BY registration_id
) e ON e.registration_id=r.id
SET r.supplement_pending=1, r.supplemented_at=e.submitted_at
WHERE r.supplemented_at IS NULL AND NOT EXISTS (
 SELECT 1 FROM hub_insurance_registration_events staff
 WHERE staff.registration_id=r.id AND staff.source_app='Dashboard' AND staff.event_no > e.event_no
);
