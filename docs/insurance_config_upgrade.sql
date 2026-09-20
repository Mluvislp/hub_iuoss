-- Chạy thủ công trên database dùng chung TRƯỚC KHI deploy code Hub/Dashboard.
-- Script chuyển config cũ thành slot MAIN và tạo đủ bốn slot tái sử dụng.

ALTER TABLE `hub_insurance_configs`
  ADD COLUMN `registration_period` VARCHAR(32) NULL AFTER `id`,
  ADD COLUMN `registration_year` INT NULL AFTER `registration_period`,
  ADD COLUMN `registration_opens_at` DATETIME(6) NULL AFTER `registration_year`,
  ADD COLUMN `registration_closes_at` DATETIME(6) NULL AFTER `registration_opens_at`,
  ADD COLUMN `is_active` TINYINT(1) NOT NULL DEFAULT 0 AFTER `registration_closes_at`;

-- Chỉ giữ dòng config mới nhất làm mẫu vì schema cũ cũng chỉ đọc dòng mới nhất.
DELETE FROM `hub_insurance_configs`
WHERE `id` <> (SELECT `keep_id` FROM (
  SELECT MAX(`id`) AS `keep_id` FROM `hub_insurance_configs`
) AS `latest`);

UPDATE `hub_insurance_configs`
SET `registration_period` = 'MAIN',
    `registration_year` = YEAR(CURRENT_DATE) + 1,
    `registration_opens_at` = TIMESTAMP(CONCAT(YEAR(CURRENT_DATE), '-09-20 00:00:00')),
    `registration_closes_at` = TIMESTAMP(CONCAT(YEAR(CURRENT_DATE), '-11-30 23:59:59')),
    `is_active` = 0;

-- Nếu bảng cũ đang trống, tạo slot MAIN mẫu trước.
INSERT INTO `hub_insurance_configs`
  (`registration_period`, `registration_year`, `registration_opens_at`,
   `registration_closes_at`, `is_active`, `description`, `bank_name`, `bank_bin`,
   `bank_account_number`, `bank_account_name`, `insurance_fee`, `created_at`, `updated_at`)
SELECT 'MAIN', YEAR(CURRENT_DATE) + 1,
       TIMESTAMP(CONCAT(YEAR(CURRENT_DATE), '-09-20 00:00:00')),
       TIMESTAMP(CONCAT(YEAR(CURRENT_DATE), '-11-30 23:59:59')),
       0, '', '', NULL, '', '', 0, NOW(6), NOW(6)
WHERE NOT EXISTS (SELECT 1 FROM `hub_insurance_configs`);

INSERT INTO `hub_insurance_configs`
  (`registration_period`, `registration_year`, `registration_opens_at`,
   `registration_closes_at`, `is_active`, `description`, `bank_name`, `bank_bin`,
   `bank_account_number`, `bank_account_name`, `insurance_fee`, `created_at`, `updated_at`)
SELECT p.period_code, YEAR(CURRENT_DATE),
       TIMESTAMP(CONCAT(YEAR(CURRENT_DATE), p.opens_suffix)),
       TIMESTAMP(CONCAT(YEAR(CURRENT_DATE), p.closes_suffix)),
       0, base.description, base.bank_name, base.bank_bin,
       base.bank_account_number, base.bank_account_name, base.insurance_fee, NOW(6), NOW(6)
FROM (
  SELECT 'Q2' AS period_code, '-02-15 00:00:00' AS opens_suffix, '-02-28 23:59:59' AS closes_suffix
  UNION ALL SELECT 'Q3', '-05-15 00:00:00', '-05-31 23:59:59'
  UNION ALL SELECT 'Q4', '-08-15 00:00:00', '-09-11 16:00:00'
) AS p
CROSS JOIN (SELECT * FROM `hub_insurance_configs` WHERE `registration_period` = 'MAIN' LIMIT 1) AS base;

ALTER TABLE `hub_insurance_configs`
  MODIFY COLUMN `registration_period` VARCHAR(32) NOT NULL,
  MODIFY COLUMN `registration_year` INT NOT NULL,
  MODIFY COLUMN `registration_opens_at` DATETIME(6) NOT NULL,
  MODIFY COLUMN `registration_closes_at` DATETIME(6) NOT NULL,
  ADD UNIQUE KEY `uq_hic_period` (`registration_period`),
  ADD CONSTRAINT `chk_hic_period`
    CHECK (`registration_period` IN ('MAIN','Q2','Q3','Q4'));

ALTER TABLE `hub_insurance_registrations`
  ADD COLUMN `config_snapshot` JSON NULL AFTER `change_log`;
