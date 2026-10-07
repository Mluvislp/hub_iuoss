-- Ghi chú sai thông tin BHYT trên đơn đăng ký tại trường (không bắt buộc).
-- Sinh viên ghi lại thông tin trên thẻ BHYT/BHXH đang lệch hồ sơ (đổi CCCD, đổi khai sinh,
-- ngày sinh, họ tên…). Dashboard tô màu + gắn nhãn "Có ghi chú" cho đơn có nội dung.
-- Chạy trên database dùng chung TRƯỚC KHI deploy Hub và Dashboard. Chạy lại không sao.
DROP PROCEDURE IF EXISTS iuoss_info_correction_note_expand;
DELIMITER $$
CREATE PROCEDURE iuoss_info_correction_note_expand()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'hub_insurance_registrations'
      AND column_name = 'info_correction_note'
  ) THEN
    ALTER TABLE `hub_insurance_registrations`
      ADD COLUMN `info_correction_note` TEXT NULL
      COMMENT 'SV ghi chú thông tin BHYT bị sai (đổi CCCD, khai sinh, ngày sinh, tên…); NULL/rỗng = không có'
      AFTER `note`;
  END IF;
END$$
DELIMITER ;
CALL iuoss_info_correction_note_expand();
DROP PROCEDURE iuoss_info_correction_note_expand;

-- Hoàn tác (chỉ sau khi đã gỡ code Hub + Dashboard đọc cột này):
-- ALTER TABLE `hub_insurance_registrations` DROP COLUMN `info_correction_note`;
