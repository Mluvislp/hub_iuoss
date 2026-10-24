-- Link tra cứu bệnh viện ("Link tra cứu bệnh viện: Xem tại đây" trên form BHYT của Hub).
-- Staff sửa ở trang Quản lý đợt đăng ký (và Quản lý đợt đổi nơi KCB) trên Dashboard,
-- không phải sửa code. Rỗng = Hub ẩn dòng link.
-- Chạy trên database dùng chung TRƯỚC KHI deploy Hub và Dashboard. Chạy lại không sao;
-- không phụ thuộc thứ tự với insurance_hospital_change_upgrade.sql.
DROP PROCEDURE IF EXISTS iuoss_hospital_lookup_url_expand;
DELIMITER $$
CREATE PROCEDURE iuoss_hospital_lookup_url_expand()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'hub_insurance_configs'
      AND column_name = 'hospital_lookup_url'
  ) THEN
    ALTER TABLE `hub_insurance_configs`
      ADD COLUMN `hospital_lookup_url` VARCHAR(500) NULL
      COMMENT 'Link danh sách bệnh viện cho SV tra cứu; NULL/rỗng = ẩn'
      AFTER `freshman_warning`;
    -- Giữ nguyên link đang gắn cứng trong code Hub để không mất dòng link sau deploy.
    UPDATE `hub_insurance_configs`
      SET `hospital_lookup_url` = 'https://drive.google.com/file/d/1S1oznRw_hKKeYmA6H5qVqDz0w3KxsqaM/view?usp=sharing';
  END IF;

  -- Bảng đợt đổi nơi KCB: chỉ thêm khi bảng đã được tạo trước đó mà chưa có cột
  -- (bản mới của insurance_hospital_change_upgrade.sql đã có sẵn cột này).
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name = 'hub_insurance_hospital_change_configs'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'hub_insurance_hospital_change_configs'
      AND column_name = 'hospital_lookup_url'
  ) THEN
    ALTER TABLE `hub_insurance_hospital_change_configs`
      ADD COLUMN `hospital_lookup_url` VARCHAR(500) NULL
      COMMENT 'Link danh sách bệnh viện cho SV tra cứu; NULL/rỗng = ẩn'
      AFTER `description`;
    UPDATE `hub_insurance_hospital_change_configs`
      SET `hospital_lookup_url` = 'https://drive.google.com/file/d/1S1oznRw_hKKeYmA6H5qVqDz0w3KxsqaM/view?usp=sharing';
  END IF;
END$$
DELIMITER ;
CALL iuoss_hospital_lookup_url_expand();
DROP PROCEDURE iuoss_hospital_lookup_url_expand;

-- Hoàn tác (chỉ sau khi đã gỡ code Hub + Dashboard đọc cột này):
-- ALTER TABLE `hub_insurance_configs` DROP COLUMN `hospital_lookup_url`;
-- ALTER TABLE `hub_insurance_hospital_change_configs` DROP COLUMN `hospital_lookup_url`;
