-- IUOSS Hub — schema SQL
-- Chạy trên database iuoss_student_data (cùng DB với dashboard)
-- Tất cả bảng hub_ để tránh xung đột với schema hiện có

-- Bảng lưu thông tin đăng nhập student hub
CREATE TABLE IF NOT EXISTS `hub_students` (
  `id`             BIGINT       NOT NULL AUTO_INCREMENT,
  `ldap_uid`       VARCHAR(64)  NOT NULL,
  `student_id`     BIGINT       NULL,          -- soft ref → students.id
  `last_login_at`  DATETIME(6)  NULL,
  `login_count`    INT          NOT NULL DEFAULT 0,
  `created_at`     DATETIME(6)  NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_hub_students_uid` (`ldap_uid`),
  KEY `idx_hub_student_id` (`student_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bảng yêu cầu giấy xác nhận từ sinh viên
CREATE TABLE IF NOT EXISTS `hub_confirmation_requests` (
  `id`           BIGINT        NOT NULL AUTO_INCREMENT,
  `student_id`   BIGINT        NOT NULL,
  `ldap_uid`     VARCHAR(64)   NOT NULL,
  `request_type` VARCHAR(64)   NOT NULL,
  `purpose`      VARCHAR(255)  NOT NULL,
  `note`         TEXT          NULL,
  `status`       VARCHAR(16)   NOT NULL DEFAULT 'pending',
  `staff_note`   TEXT          NULL,
  `created_at`   DATETIME(6)   NOT NULL,
  `updated_at`   DATETIME(6)   NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_hcr_student_id` (`student_id`),
  KEY `idx_hcr_ldap_uid` (`ldap_uid`),
  KEY `idx_hcr_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bảng đăng ký BHYT từ sinh viên.
-- 11 cột từ `full_name` tới `permanent_street` chụp lại NGUYÊN TRẠNG thứ sinh
-- viên khai trên form; hồ sơ gốc trong `students` KHÔNG bị đơn này sửa (chênh
-- lệch nằm ở `change_log`). Tỉnh/phường lưu MÃ, tra tên khi hiển thị.
CREATE TABLE IF NOT EXISTS `hub_insurance_registrations` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `student_id` BIGINT NOT NULL,
  `registration_year` INT NOT NULL,
  `registration_period` VARCHAR(32) NOT NULL,
  `full_name` VARCHAR(255) NULL,
  `student_code` VARCHAR(64) NULL,
  `gender` VARCHAR(10) NULL,
  `dob` DATE NULL,
  `ethnicity` VARCHAR(64) NULL,
  `phone_number` VARCHAR(20) NULL,
  `citizen_id` VARCHAR(20) NULL,
  `social_insurance_number` VARCHAR(20) NULL,
  `permanent_province` VARCHAR(32) NULL,
  `permanent_ward` VARCHAR(32) NULL,
  `permanent_street` VARCHAR(255) NULL,
  `hospital_code` VARCHAR(16) NOT NULL,
  `cccd_image` VARCHAR(500) NULL COMMENT 'Ảnh CCCD mặt trước',
  `cccd_image_back` VARCHAR(500) NULL COMMENT 'Ảnh CCCD mặt sau',
  `bhyt_image` VARCHAR(500) NULL,
  `payment_receipt_image` VARCHAR(500) NOT NULL,
  `change_log` JSON NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'pending',
  `rejection_reason` TEXT NULL,
  `created_at` DATETIME(6) NOT NULL,
  `updated_at` DATETIME(6) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_hir_student_id` (`student_id`),
  KEY `idx_hir_period_year` (`registration_year`, `registration_period`),
  KEY `idx_hir_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Dữ liệu đọc từ mã QR trên thẻ CCCD. Bảng DÙNG CHUNG cho mọi luồng có thu
-- thập CCCD; `source` cho biết thu ở đâu, `source_ref_id` trỏ về bản ghi gốc.
-- Ghi thêm dòng mỗi lần quét, không sửa đè.
CREATE TABLE IF NOT EXISTS `hub_cccd_scans` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `student_id` BIGINT NOT NULL,
  `source` VARCHAR(32) NOT NULL COMMENT 'bhyt_registration, offcampus, ...',
  `source_ref_id` BIGINT NULL COMMENT 'Id bản ghi ở luồng thu thập',
  `citizen_id` VARCHAR(12) NOT NULL,
  `old_id_number` VARCHAR(12) NULL COMMENT 'CMND 9 số in trên thẻ, có thể rỗng',
  `full_name` VARCHAR(255) NOT NULL,
  `date_of_birth` DATE NULL,
  `gender` VARCHAR(10) NULL,
  `residence_address` VARCHAR(255) NULL COMMENT 'Nguyên văn trên thẻ, cơ cấu hành chính TRƯỚC 2025',
  `issue_date` DATE NULL,
  `raw_payload` VARCHAR(512) NULL COMMENT 'Chuỗi QR gốc, để dựng lại nếu bộ đọc sai',
  `scanned_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_cccd_student` (`student_id`),
  KEY `idx_cccd_citizen` (`citizen_id`),
  KEY `idx_cccd_source` (`source`, `source_ref_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Nội dung hiển thị trên form đăng ký BHYT: mô tả, tài khoản nhận tiền, mức phí.
-- Một dòng đang dùng; đọc dòng có id lớn nhất.
CREATE TABLE IF NOT EXISTS `hub_insurance_configs` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `description` TEXT NULL,
  `bank_name` VARCHAR(255) NOT NULL,
  `bank_bin` VARCHAR(6) NULL COMMENT 'Mã BIN 6 số của Napas, dùng dựng VietQR',
  `bank_account_number` VARCHAR(64) NOT NULL,
  `bank_account_name` VARCHAR(255) NOT NULL,
  `insurance_fee` INT NOT NULL COMMENT 'Đơn vị: VNĐ',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bảng session cho hub (tách biệt với dashboard sessions)
-- Django tự tạo bảng này khi chạy: python manage.py migrate
-- (django.contrib.sessions dùng migration riêng, không bị tắt bởi MIGRATION_MODULES)
