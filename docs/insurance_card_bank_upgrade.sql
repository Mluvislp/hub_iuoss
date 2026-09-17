-- Chạy thủ công trên database dùng chung TRƯỚC KHI deploy Hub/Dashboard.
-- Không chạy qua Django migration vì các model liên quan đều managed=False.

CREATE TABLE `hub_insurance_bank_accounts` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `bank_name` VARCHAR(255) NOT NULL,
  `bank_bin` VARCHAR(6) NOT NULL,
  `account_number` VARCHAR(64) NOT NULL,
  `account_name` VARCHAR(255) NOT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_hiba_account` (`bank_bin`, `account_number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Chỉ nhập lại cấu hình cũ nếu đủ thông tin. Tài khoản mới do IT INSERT trực tiếp.
INSERT IGNORE INTO `hub_insurance_bank_accounts`
  (`bank_name`, `bank_bin`, `account_number`, `account_name`)
SELECT DISTINCT `bank_name`, `bank_bin`, `bank_account_number`, `bank_account_name`
FROM `hub_insurance_configs`
WHERE COALESCE(`bank_name`, '') <> ''
  AND COALESCE(`bank_bin`, '') <> ''
  AND COALESCE(`bank_account_number`, '') <> ''
  AND COALESCE(`bank_account_name`, '') <> '';

ALTER TABLE `hub_insurance_configs`
  ADD COLUMN `bank_account_id` BIGINT NULL AFTER `is_active`,
  ADD KEY `idx_hic_bank_account` (`bank_account_id`),
  ADD CONSTRAINT `fk_hic_bank_account`
    FOREIGN KEY (`bank_account_id`) REFERENCES `hub_insurance_bank_accounts` (`id`)
    ON UPDATE CASCADE ON DELETE RESTRICT;

UPDATE `hub_insurance_configs` AS c
JOIN `hub_insurance_bank_accounts` AS b
  ON b.`bank_name` = c.`bank_name`
 AND b.`bank_bin` = c.`bank_bin`
 AND b.`account_number` = c.`bank_account_number`
 AND b.`account_name` = c.`bank_account_name`
SET c.`bank_account_id` = b.`id`;

ALTER TABLE `student_health_insurance_cards`
  ADD COLUMN `registration_year` INT NULL AFTER `valid_until`,
  ADD COLUMN `source_registration_id` BIGINT NULL AFTER `registration_year`,
  ADD KEY `idx_shic_registration_year` (`registration_year`),
  ADD UNIQUE KEY `uq_shic_source_registration` (`source_registration_id`),
  ADD CONSTRAINT `fk_shic_source_registration`
    FOREIGN KEY (`source_registration_id`) REFERENCES `hub_insurance_registrations` (`id`)
    ON UPDATE CASCADE ON DELETE SET NULL;

-- Mẫu để IT thêm tài khoản nhận phí mới (thay các giá trị trước khi chạy):
-- INSERT INTO `hub_insurance_bank_accounts`
--   (`bank_name`, `bank_bin`, `account_number`, `account_name`)
-- VALUES ('Tên ngân hàng', '970000', 'Số tài khoản', 'Tên chủ tài khoản');
