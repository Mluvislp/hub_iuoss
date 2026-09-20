-- Manual EXPAND ONLY, MySQL 8.4/InnoDB. Review preflight and backup first.
-- No status mapping and no destructive old-column changes. DDL implicitly commits.
-- Re-runnable by metadata checks. Verify existing objects with SHOW CREATE TABLE:
-- IF NOT EXISTS does not validate an existing table's shape.
DELIMITER $$
DROP PROCEDURE IF EXISTS insurance_expand_v2$$
CREATE PROCEDURE insurance_expand_v2()
BEGIN
 IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='hub_insurance_registrations' AND COLUMN_NAME='workflow_version') THEN
  ALTER TABLE hub_insurance_registrations ADD COLUMN workflow_version SMALLINT UNSIGNED NOT NULL DEFAULT 1;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='hub_insurance_registrations' AND COLUMN_NAME='row_version') THEN
  ALTER TABLE hub_insurance_registrations ADD COLUMN row_version INT UNSIGNED NOT NULL DEFAULT 0;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='hub_insurance_registrations' AND COLUMN_NAME='fee_amount_vnd') THEN
  ALTER TABLE hub_insurance_registrations ADD COLUMN fee_amount_vnd BIGINT NULL;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='hub_insurance_registrations' AND COLUMN_NAME='rejection_reason_code') THEN
  ALTER TABLE hub_insurance_registrations ADD COLUMN rejection_reason_code VARCHAR(32) NULL;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='hub_insurance_registrations' AND INDEX_NAME='idx_hir_workflow') THEN
  ALTER TABLE hub_insurance_registrations ADD INDEX idx_hir_workflow(registration_year, registration_period, status, id);
 END IF;
END$$
CALL insurance_expand_v2()$$
DROP PROCEDURE insurance_expand_v2$$
DELIMITER ;

CREATE TABLE IF NOT EXISTS hub_insurance_registration_events (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 registration_id BIGINT NOT NULL,
 event_no INT UNSIGNED NOT NULL,
 event_type VARCHAR(40) NOT NULL,
 from_status VARCHAR(16) NULL, to_status VARCHAR(16) NULL,
 reason_code VARCHAR(32) NULL, reason_text TEXT NULL,
 actor_type VARCHAR(16) NOT NULL, actor_id BIGINT NULL, source_app VARCHAR(16) NOT NULL,
 request_key VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NULL,
 batch_id VARCHAR(36) NULL, payload JSON NULL, created_at DATETIME(6) NOT NULL,
 UNIQUE KEY uq_hire_number (registration_id,event_no),
 UNIQUE KEY uq_hire_request (registration_id,request_key),
 KEY idx_hire_timeline (registration_id,created_at,id), KEY idx_hire_batch(batch_id),
 CONSTRAINT fk_hire_registration FOREIGN KEY(registration_id) REFERENCES hub_insurance_registrations(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS hub_insurance_payment_assessments (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 registration_id BIGINT NOT NULL, event_id BIGINT NOT NULL, assessment_no INT UNSIGNED NOT NULL,
 required_amount_vnd BIGINT NOT NULL, confirmed_paid_total_vnd BIGINT NOT NULL,
 missing_amount_vnd BIGINT NOT NULL, note TEXT NULL, created_at DATETIME(6) NOT NULL,
 UNIQUE KEY uq_hipa_event(event_id), UNIQUE KEY uq_hipa_number(registration_id,assessment_no),
 CONSTRAINT fk_hipa_registration FOREIGN KEY(registration_id) REFERENCES hub_insurance_registrations(id) ON DELETE RESTRICT,
 CONSTRAINT fk_hipa_event FOREIGN KEY(event_id) REFERENCES hub_insurance_registration_events(id) ON DELETE RESTRICT,
 CONSTRAINT chk_hipa_amount CHECK(required_amount_vnd>=0 AND confirmed_paid_total_vnd>=0
  AND missing_amount_vnd=GREATEST(required_amount_vnd-confirmed_paid_total_vnd,0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS hub_insurance_payment_evidences (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 registration_id BIGINT NOT NULL, event_id BIGINT NOT NULL,
 storage_key VARCHAR(500) NOT NULL, original_filename VARCHAR(255) NOT NULL,
 mime_type VARCHAR(64) NOT NULL, file_size_bytes BIGINT NOT NULL, sha256 CHAR(64) NOT NULL,
 declared_amount_vnd BIGINT NULL, created_at DATETIME(6) NOT NULL,
 KEY idx_hipe_registration(registration_id,id), KEY idx_hipe_event(event_id),
 CONSTRAINT fk_hipe_registration FOREIGN KEY(registration_id) REFERENCES hub_insurance_registrations(id) ON DELETE RESTRICT,
 CONSTRAINT fk_hipe_event FOREIGN KEY(event_id) REFERENCES hub_insurance_registration_events(id) ON DELETE RESTRICT,
 CONSTRAINT chk_hipe_amount CHECK(file_size_bytes>0 AND (declared_amount_vnd IS NULL OR declared_amount_vnd>=0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
