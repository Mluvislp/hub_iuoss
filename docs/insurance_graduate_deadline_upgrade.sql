-- Hạn đóng đăng ký BHYT riêng cho học viên cao học (thạc sĩ / tiến sĩ), theo từng đợt.
-- NULL = học viên dùng chung `registration_closes_at` với sinh viên đại học.
-- Chạy trên database dùng chung TRƯỚC KHI deploy Hub và Dashboard. Chạy lại không sao.
DROP PROCEDURE IF EXISTS iuoss_graduate_deadline_expand;
DELIMITER $$
CREATE PROCEDURE iuoss_graduate_deadline_expand()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'hub_insurance_configs'
      AND column_name = 'graduate_closes_at'
  ) THEN
    ALTER TABLE `hub_insurance_configs`
      ADD COLUMN `graduate_closes_at` DATETIME(6) NULL
      COMMENT 'Hạn đóng riêng cho học viên cao học; NULL = dùng registration_closes_at'
      AFTER `registration_closes_at`;
  END IF;
END$$
DELIMITER ;
CALL iuoss_graduate_deadline_expand();
DROP PROCEDURE iuoss_graduate_deadline_expand;

-- Hoàn tác (chỉ sau khi đã gỡ code Hub + Dashboard đọc cột này):
-- ALTER TABLE `hub_insurance_configs` DROP COLUMN `graduate_closes_at`;
