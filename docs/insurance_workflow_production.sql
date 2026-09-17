-- =============================================================================
-- IUOSS BHYT workflow v2 - production schema update
-- MySQL 8.0+/InnoDB. Run manually on the shared Hub/Dashboard database.
--
-- This consolidated script supersedes insurance_workflow_upgrade.sql when the
-- three workflow-history tables have not yet accumulated data worth retaining.
-- It deliberately DOES NOT drop/recreate existing live tables:
--   hub_insurance_registrations, student_health_insurance_cards,
--   hub_insurance_configs, hub_insurance_bank_accounts.
--
-- Before running:
--   1. Run insurance_workflow_preflight.sql and save its output.
--   2. Back up the database and Hub media directory; verify a restore.
--   3. Stop/disable all BHYT writers in both applications.
--   4. Confirm the selected database below is the intended production DB.
--
-- DROP statements below affect ONLY the three new workflow-history tables.
-- =============================================================================

SELECT DATABASE() AS selected_database, VERSION() AS mysql_version;

-- Expand the live registration table without deleting existing registrations.
-- Metadata checks make the column/index portion safe to rerun after partial DDL.
DELIMITER $$
DROP PROCEDURE IF EXISTS insurance_workflow_v2_expand$$
CREATE PROCEDURE insurance_workflow_v2_expand()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'hub_insurance_registrations'
      AND COLUMN_NAME = 'workflow_version'
  ) THEN
    ALTER TABLE hub_insurance_registrations
      ADD COLUMN workflow_version SMALLINT UNSIGNED NOT NULL DEFAULT 1
      AFTER rejection_reason;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'hub_insurance_registrations'
      AND COLUMN_NAME = 'row_version'
  ) THEN
    ALTER TABLE hub_insurance_registrations
      ADD COLUMN row_version INT UNSIGNED NOT NULL DEFAULT 0
      AFTER workflow_version;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'hub_insurance_registrations'
      AND COLUMN_NAME = 'fee_amount_vnd'
  ) THEN
    ALTER TABLE hub_insurance_registrations
      ADD COLUMN fee_amount_vnd BIGINT NULL
      AFTER row_version;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'hub_insurance_registrations'
      AND COLUMN_NAME = 'rejection_reason_code'
  ) THEN
    ALTER TABLE hub_insurance_registrations
      ADD COLUMN rejection_reason_code VARCHAR(32) NULL
      AFTER fee_amount_vnd;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'hub_insurance_registrations'
      AND INDEX_NAME = 'idx_hir_workflow'
  ) THEN
    ALTER TABLE hub_insurance_registrations
      ADD INDEX idx_hir_workflow
        (registration_year, registration_period, status, id);
  END IF;
END$$
CALL insurance_workflow_v2_expand()$$
DROP PROCEDURE insurance_workflow_v2_expand$$
DELIMITER ;

-- These tables belong only to workflow v2. Dropping them also removes any test
-- or incomplete rollout history already stored in them. Child tables go first.
DROP TABLE IF EXISTS hub_insurance_payment_evidences;
DROP TABLE IF EXISTS hub_insurance_payment_assessments;
DROP TABLE IF EXISTS hub_insurance_registration_events;

CREATE TABLE hub_insurance_registration_events (
  id BIGINT NOT NULL AUTO_INCREMENT,
  registration_id BIGINT NOT NULL,
  event_no INT UNSIGNED NOT NULL,
  event_type VARCHAR(40) NOT NULL,
  from_status VARCHAR(16) NULL,
  to_status VARCHAR(16) NULL,
  reason_code VARCHAR(32) NULL,
  reason_text TEXT NULL,
  actor_type VARCHAR(16) NOT NULL,
  actor_id BIGINT NULL,
  source_app VARCHAR(16) NOT NULL,
  request_key VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NULL,
  batch_id VARCHAR(36) NULL,
  payload JSON NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_hire_number (registration_id, event_no),
  UNIQUE KEY uq_hire_request (registration_id, request_key),
  KEY idx_hire_timeline (registration_id, created_at, id),
  KEY idx_hire_batch (batch_id),
  CONSTRAINT fk_hire_registration
    FOREIGN KEY (registration_id)
    REFERENCES hub_insurance_registrations (id)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE hub_insurance_payment_assessments (
  id BIGINT NOT NULL AUTO_INCREMENT,
  registration_id BIGINT NOT NULL,
  event_id BIGINT NOT NULL,
  assessment_no INT UNSIGNED NOT NULL,
  required_amount_vnd BIGINT NOT NULL,
  confirmed_paid_total_vnd BIGINT NOT NULL,
  missing_amount_vnd BIGINT NOT NULL,
  note TEXT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_hipa_event (event_id),
  UNIQUE KEY uq_hipa_number (registration_id, assessment_no),
  KEY idx_hipa_registration (registration_id),
  CONSTRAINT fk_hipa_registration
    FOREIGN KEY (registration_id)
    REFERENCES hub_insurance_registrations (id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_hipa_event
    FOREIGN KEY (event_id)
    REFERENCES hub_insurance_registration_events (id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT chk_hipa_amounts CHECK (
    required_amount_vnd >= 0
    AND confirmed_paid_total_vnd >= 0
    AND missing_amount_vnd = GREATEST(
      required_amount_vnd - confirmed_paid_total_vnd,
      0
    )
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE hub_insurance_payment_evidences (
  id BIGINT NOT NULL AUTO_INCREMENT,
  registration_id BIGINT NOT NULL,
  event_id BIGINT NOT NULL,
  storage_key VARCHAR(500) NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  mime_type VARCHAR(64) NOT NULL,
  file_size_bytes BIGINT NOT NULL,
  sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  declared_amount_vnd BIGINT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY idx_hipe_registration (registration_id, id),
  KEY idx_hipe_event (event_id),
  CONSTRAINT fk_hipe_registration
    FOREIGN KEY (registration_id)
    REFERENCES hub_insurance_registrations (id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_hipe_event
    FOREIGN KEY (event_id)
    REFERENCES hub_insurance_registration_events (id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT chk_hipe_file_size CHECK (file_size_bytes > 0),
  CONSTRAINT chk_hipe_declared_amount CHECK (
    declared_amount_vnd IS NULL OR declared_amount_vnd >= 0
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Record the actually observed legacy status before mapping it. Do not invent
-- intermediate workflow steps that the old data cannot prove.
INSERT INTO hub_insurance_registration_events (
  registration_id,
  event_no,
  event_type,
  from_status,
  to_status,
  actor_type,
  actor_id,
  source_app,
  request_key,
  payload,
  created_at
)
SELECT
  id,
  1,
  'LEGACY_IMPORTED',
  status,
  CASE status
    WHEN 'pending' THEN 'iu_processing'
    WHEN 'processing' THEN 'iu_processing'
    WHEN 'done' THEN 'issued'
    ELSE status
  END,
  'system',
  NULL,
  'Migration',
  'legacy-import-v2',
  JSON_OBJECT('observed_status', status),
  NOW(6)
FROM hub_insurance_registrations
WHERE workflow_version < 2
  AND id > 0
  AND status IN ('pending', 'processing', 'done', 'rejected');

-- Preserve legacy registrations and only map their stable status codes.
-- fee_amount_vnd remains NULL for old registrations because the fee cannot be
-- inferred safely. Legacy receipt evidence still needs the filesystem-aware
-- backfill_insurance_workflow management command after deployment.
UPDATE hub_insurance_registrations
SET status = CASE status
    WHEN 'pending' THEN 'iu_processing'
    WHEN 'processing' THEN 'iu_processing'
    WHEN 'done' THEN 'issued'
    ELSE status
  END,
  workflow_version = 2,
  row_version = row_version + 1
WHERE id > 0
  AND workflow_version < 2
  AND status IN ('pending', 'processing', 'done', 'rejected');

-- Result summary. Continue with insurance_workflow_verify.sql and the
-- filesystem-aware backfill before enabling INSURANCE_WORKFLOW_V2 in both apps.
SELECT status, workflow_version, COUNT(*) AS registrations
FROM hub_insurance_registrations
GROUP BY status, workflow_version
ORDER BY workflow_version, status;

SHOW CREATE TABLE hub_insurance_registration_events;
SHOW CREATE TABLE hub_insurance_payment_assessments;
SHOW CREATE TABLE hub_insurance_payment_evidences;
