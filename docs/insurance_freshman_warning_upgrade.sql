-- Thêm nội dung cảnh báo tân sinh viên theo từng đợt đăng ký BHYT.
-- Chạy trên database dùng chung TRƯỚC KHI deploy Hub và Dashboard.
DROP PROCEDURE IF EXISTS iuoss_freshman_warning_expand;
DELIMITER $$
CREATE PROCEDURE iuoss_freshman_warning_expand()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'hub_insurance_configs'
      AND column_name = 'freshman_warning'
  ) THEN
    ALTER TABLE `hub_insurance_configs`
      ADD COLUMN `freshman_warning` TEXT NULL
      COMMENT 'Cảnh báo khi academic_entry_year trùng registration_year'
      AFTER `description`;
  END IF;
END$$
DELIMITER ;
CALL iuoss_freshman_warning_expand();
DROP PROCEDURE iuoss_freshman_warning_expand;

-- Có thể sửa riêng nội dung từng đợt trên Dashboard sau khi deploy.
UPDATE `hub_insurance_configs`
SET `freshman_warning` = 'Tân sinh viên đã đăng ký mua BHYT trước đó. Vui lòng kiểm tra kỹ trước khi tiếp tục đăng ký.'
WHERE `id` > 0
  AND `freshman_warning` IS NULL;
