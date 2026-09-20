-- BHYT workflow v2 status hotfix - MySQL 8.0+
-- Safe to rerun. This does not drop tables or registrations.
-- Stop BHYT writers in Hub/Dashboard before running, then deploy both apps.

SELECT DATABASE() AS selected_database, VERSION() AS mysql_version;

-- Safe-update compatible because the WHERE clause uses the primary key `id`.
UPDATE hub_insurance_registrations
SET
  status = CASE status
    WHEN 'pending' THEN 'iu_processing'
    WHEN 'processing' THEN 'iu_processing'
    WHEN 'done' THEN 'issued'
    ELSE status
  END,
  workflow_version = 2,
  row_version = row_version + 1
WHERE id > 0
  AND (
    workflow_version < 2
    OR status IN ('pending', 'processing', 'done')
  )
  AND status IN (
    'pending', 'processing', 'done',
    'iu_processing', 'waiting_bhxh', 'issued', 'rejected'
  );

-- Abort before the constraint if this query returns rows. Those values need a
-- reviewed business mapping instead of being guessed by this script.
SELECT id, status, workflow_version
FROM hub_insurance_registrations
WHERE status NOT IN ('iu_processing', 'waiting_bhxh', 'issued', 'rejected')
ORDER BY id;

DELIMITER $$
DROP PROCEDURE IF EXISTS insurance_status_v2_constraints$$
CREATE PROCEDURE insurance_status_v2_constraints()
BEGIN
  IF EXISTS (
    SELECT 1
    FROM hub_insurance_registrations
    WHERE status NOT IN ('iu_processing', 'waiting_bhxh', 'issued', 'rejected')
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'BHYT còn status chưa biết; xem SELECT phía trên và map thủ công trước khi chạy lại.';
  END IF;

  ALTER TABLE hub_insurance_registrations
    MODIFY COLUMN status VARCHAR(16) NOT NULL DEFAULT 'iu_processing',
    MODIFY COLUMN workflow_version SMALLINT UNSIGNED NOT NULL DEFAULT 2;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME = 'hub_insurance_registrations'
      AND CONSTRAINT_NAME = 'chk_hir_status_v2'
      AND CONSTRAINT_TYPE = 'CHECK'
  ) THEN
    ALTER TABLE hub_insurance_registrations
      ADD CONSTRAINT chk_hir_status_v2
      CHECK (status IN ('iu_processing', 'waiting_bhxh', 'issued', 'rejected'));
  END IF;
END$$
CALL insurance_status_v2_constraints()$$
DROP PROCEDURE insurance_status_v2_constraints$$
DELIMITER ;

SELECT status, workflow_version, COUNT(*) AS registrations
FROM hub_insurance_registrations
GROUP BY status, workflow_version
ORDER BY status, workflow_version;
