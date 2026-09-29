-- IUOSS Hub — schema SQL
-- Chạy trên database iuoss_student_data (cùng DB với dashboard)
-- Tất cả bảng hub_ để tránh xung đột với schema hiện có

-- Bảng lưu thông tin đăng nhập student hub
CREATE TABLE IF NOT EXISTS `hub_students` (
  `id`             BIGINT       NOT NULL AUTO_INCREMENT,
  `ldap_uid`       VARCHAR(64)  NOT NULL,
  `student_id`     BIGINT       NULL,          -- soft ref → students.id
  `last_login_at`  DATETIME(6)  NULL,          -- lần đăng nhập gần nhất, bất kể lối nào
  `last_login_ldap_at` DATETIME(6) NULL,       -- riêng lối LDAP
  `last_login_ms_at`   DATETIME(6) NULL,       -- riêng lối Microsoft/Entra ID
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
  `payload`      JSON          NULL,           -- dữ liệu riêng theo từng loại giấy
  `status`       VARCHAR(16)   NOT NULL DEFAULT 'pending',
  `staff_note`   TEXT          NULL,
  `created_at`   DATETIME(6)   NOT NULL,
  `updated_at`   DATETIME(6)   NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_hcr_student_id` (`student_id`),
  KEY `idx_hcr_ldap_uid` (`ldap_uid`),
  KEY `idx_hcr_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Sinh viên xin sửa CCCD / email / SĐT; nhân viên OSS duyệt bên Dashboard.
-- `target` cho biết sửa trường nào (registry CHANGE_TARGETS bên dashboard),
-- `group_key` gom nhiều dòng thuộc cùng một lần gửi.
-- Đây là bảng hub_* DUY NHẤT có khoá ngoại thật; 4 bảng còn lại chỉ soft ref.
CREATE TABLE IF NOT EXISTS `hub_profile_change_requests` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `student_id`     BIGINT        NOT NULL,
  `target`         VARCHAR(64)   NOT NULL,
  `target_id`      BIGINT        NULL,
  `old_value`      TEXT          NULL,
  `new_value`      TEXT          NOT NULL,
  `source`         VARCHAR(32)   NOT NULL,
  `group_key`      CHAR(32)      NULL,
  `status`         VARCHAR(16)   NOT NULL DEFAULT 'pending',
  `review_note`    VARCHAR(255)  NULL,
  `reviewed_by_id` INT           NULL,
  `reviewed_at`    DATETIME      NULL,
  `created_at`     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_hpcr_user` (`reviewed_by_id`),
  KEY `idx_hpcr_queue` (`status`, `created_at`),
  KEY `idx_hpcr_student` (`student_id`, `target`, `status`),
  KEY `idx_hpcr_group` (`group_key`),
  CONSTRAINT `fk_hpcr_student` FOREIGN KEY (`student_id`)
    REFERENCES `students` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_hpcr_user` FOREIGN KEY (`reviewed_by_id`)
    REFERENCES `auth_user` (`id`) ON DELETE SET NULL
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
  `config_snapshot` JSON NULL COMMENT 'Cấu hình phí/ngân hàng tại thời điểm nộp',
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

-- Danh sách tài khoản nhận phí do IT quản lý; staff chỉ được chọn trên Dashboard.
CREATE TABLE IF NOT EXISTS `hub_insurance_bank_accounts` (
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

-- Bốn slot MAIN/Q2/Q3/Q4 được staff cập nhật và tái sử dụng qua từng năm.
CREATE TABLE IF NOT EXISTS `hub_insurance_configs` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `registration_period` VARCHAR(32) NOT NULL,
  `registration_year` INT NOT NULL,
  `registration_opens_at` DATETIME(6) NOT NULL,
  `registration_closes_at` DATETIME(6) NOT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 0,
  `bank_account_id` BIGINT NULL,
  `description` TEXT NULL,
  `bank_name` VARCHAR(255) NOT NULL,
  `bank_bin` VARCHAR(6) NULL COMMENT 'Mã BIN 6 số của Napas, dùng dựng VietQR',
  `bank_account_number` VARCHAR(64) NOT NULL,
  `bank_account_name` VARCHAR(255) NOT NULL,
  `insurance_fee` INT NOT NULL COMMENT 'Đơn vị: VNĐ',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_hic_period` (`registration_period`),
  KEY `idx_hic_bank_account` (`bank_account_id`),
  CONSTRAINT `fk_hic_bank_account` FOREIGN KEY (`bank_account_id`)
    REFERENCES `hub_insurance_bank_accounts` (`id`) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `chk_hic_period` CHECK (`registration_period` IN ('MAIN','Q2','Q3','Q4'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bảng session cho hub (tách biệt với dashboard sessions)
-- Django tự tạo bảng này khi chạy: python manage.py migrate
-- (django.contrib.sessions dùng migration riêng, không bị tắt bởi MIGRATION_MODULES)

-- BHYT workflow v2: after this base schema and the card/bank upgrade, run
-- docs/insurance_workflow_upgrade.sql (idempotent expand; no data deletion).

-- ── Khám sức khỏe định kỳ (26/09/2026) — nguồn: dashboard_iuoss/docs/sql/20260926_health_check.sql
-- Mỗi năm học MỘT đợt. Hub chỉ nhận phản hồi khi opens_at <= now <= closes_at;
-- hết hạn là form tự khóa, năm sau tạo đợt mới trên Dashboard (không sửa code).
-- Nội dung gói khám lưu theo đợt vì đổi theo năm (thông tư, thời gian, địa điểm).
CREATE TABLE `health_check_rounds` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `academic_year` varchar(9) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'VD 2026-2027',
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `opens_at` datetime(6) NOT NULL,
  `closes_at` datetime(6) NOT NULL COMMENT 'Hạn chót; sau mốc này Hub khóa form',
  `package_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `package_content` text COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Mỗi dòng một ý; dòng mở đầu bằng "+" là gạch đầu dòng',
  `schedule_note` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Thời gian và địa điểm dự kiến',
  `created_by_id` int DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_hcr_academic_year` (`academic_year`),
  KEY `idx_hcr_window` (`opens_at`, `closes_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Mỗi SV một dòng mỗi đợt. `choice` là câu trả lời, `status` là tiến trình xử lý;
-- giá trị status KHÔNG trùng giữa hai nhánh nên đọc một cột là biết đủ:
--   choice='examined' (đã khám, nộp minh chứng): pending → approved | rejected
--                                                 rejected → pending (SV nộp lại)
--   choice='register' (chưa khám, đăng ký khám tại trường): registered → attended | absent
CREATE TABLE `health_check_responses` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `round_id` bigint NOT NULL,
  `student_id` bigint NOT NULL,
  `choice` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `evidence` json DEFAULT NULL COMMENT '[{storage_key, mime_type, size, sha256, original_filename}]',
  `residence` json DEFAULT NULL COMMENT 'Ảnh chụp địa chỉ lúc đăng ký: căn cứ thuộc diện TP.HCM',
  `consent_at` datetime(6) DEFAULT NULL COMMENT 'Lúc SV tích đồng ý tham gia khám tập trung',
  `submit_count` smallint unsigned NOT NULL DEFAULT '1' COMMENT 'Số lần nộp (nộp lại minh chứng sau khi bị từ chối)',
  `submitted_at` datetime(6) NOT NULL,
  `review_note` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reviewed_by_id` int DEFAULT NULL,
  `reviewed_at` datetime(6) DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_hcresp_round_student` (`round_id`, `student_id`),
  KEY `idx_hcresp_round_state` (`round_id`, `choice`, `status`),
  KEY `idx_hcresp_student` (`student_id`),
  CONSTRAINT `fk_hcresp_round` FOREIGN KEY (`round_id`) REFERENCES `health_check_rounds` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_hcresp_student` FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ════════════════ Hỏi đáp sinh viên (ticket) — 29/09/2026 ════════════════
-- Nguồn: dashboard_iuoss/docs/sql/20260929_support_tickets.sql (kèm INSERT 5 mảng ban đầu).
-- Ticket hỏi đáp sinh viên ↔ Phòng CTSV — 4 bảng mới, chạy TRƯỚC khi deploy code Dashboard + Hub.
-- Không đụng bảng cũ nào. Chi tiết nghiệp vụ: docs/SUPPORT_TICKETS.md.
--
-- Mô hình tham khảo: osTicket (help topic → thread → entry → attachment) và Zendesk
-- (ticket · comment public/private · attachment). Rút gọn cho quy mô một phòng:
--   support_ticket_topics       mảng công việc + email người phụ trách
--   support_tickets             một câu hỏi (số ticket = id, bắt đầu từ 10001)
--   support_ticket_messages     dòng trao đổi phẳng: sinh viên / chuyên viên / hệ thống
--   support_ticket_attachments  file đính kèm theo từng lượt (tối đa 2, PDF hoặc ảnh)

-- Mảng công việc. `notify_emails` nhận nhiều địa chỉ, phân cách bằng dấu phẩy hoặc
-- xuống dòng; ticket mới + sinh viên trả lời đều gửi tới toàn bộ danh sách này.
-- Đổi người phụ trách = sửa dòng này trên Dashboard, không sửa code.
CREATE TABLE `support_ticket_topics` (
  `id` int NOT NULL AUTO_INCREMENT,
  `code` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Gợi ý hiện cho sinh viên khi chọn mảng',
  `notify_emails` text COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Email người phụ trách, phân cách bằng dấu phẩy/xuống dòng',
  `sort_order` smallint NOT NULL DEFAULT '0',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_stt_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Một câu hỏi. Trạng thái nói "đang chờ ai":
--   open      chờ Phòng CTSV trả lời (vừa tạo, hoặc sinh viên vừa nhắn thêm)
--   answered  Phòng CTSV đã trả lời, chờ sinh viên
--   closed    đã đóng — sinh viên không nhắn thêm được, cần hỏi tiếp thì tạo ticket mới
-- Hai mốc last_*_message_at cùng với *_read_at cho biết "có tin mới chưa đọc" ở cả hai
-- phía mà không cần bảng riêng. Không có cột người phụ trách: người xử lý chính là người
-- phản hồi, đã lưu ở từng lượt (support_ticket_messages.author_user_id).
CREATE TABLE `support_tickets` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `topic_id` int NOT NULL,
  `student_id` bigint NOT NULL,
  `student_code` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'MSSV lúc tạo ticket (đi vào tiêu đề email)',
  `subject` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `last_student_message_at` datetime(6) DEFAULT NULL,
  `last_staff_message_at` datetime(6) DEFAULT NULL,
  `student_read_at` datetime(6) DEFAULT NULL,
  `staff_read_at` datetime(6) DEFAULT NULL,
  `first_response_at` datetime(6) DEFAULT NULL COMMENT 'Lần trả lời công khai đầu tiên của Phòng CTSV',
  `closed_at` datetime(6) DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT 'Mốc hoạt động cuối — code tự ghi; CỐ Ý không ON UPDATE để việc ghi *_read_at không đẩy ticket lên đầu danh sách',
  PRIMARY KEY (`id`),
  KEY `idx_st_status` (`status`, `updated_at`),
  KEY `idx_st_student` (`student_id`, `updated_at`),
  KEY `idx_st_topic` (`topic_id`, `status`),
  CONSTRAINT `fk_st_topic` FOREIGN KEY (`topic_id`) REFERENCES `support_ticket_topics` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_st_student` FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci AUTO_INCREMENT=10001;

-- Dòng trao đổi phẳng theo thời gian (không phân cấp).
--   author_role: student | staff | system (đóng/mở lại — để dòng thời gian không thủng)
--   author_user_id + author_name: chuyên viên nào phản hồi lượt nào
CREATE TABLE `support_ticket_messages` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `ticket_id` bigint NOT NULL,
  `author_role` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `author_user_id` int DEFAULT NULL COMMENT 'auth_user.id khi là chuyên viên',
  `author_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Chụp tên lúc gửi',
  `body` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_stm_ticket` (`ticket_id`, `id`),
  CONSTRAINT `fk_stm_ticket` FOREIGN KEY (`ticket_id`) REFERENCES `support_tickets` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- File đính kèm. File nằm dưới MEDIA_ROOT của Hub (`support_tickets/<ticket>/<uuid>.<ext>`);
-- Dashboard đọc qua HUB_MEDIA_ROOT như ảnh BHYT. `ticket_id` lặp lại để kiểm quyền tải
-- file bằng một điều kiện, không phải JOIN qua bảng trao đổi.
CREATE TABLE `support_ticket_attachments` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `ticket_id` bigint NOT NULL,
  `message_id` bigint NOT NULL,
  `storage_key` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `original_filename` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `mime_type` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `file_size_bytes` int unsigned NOT NULL,
  `sha256` char(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_sta_message` (`message_id`),
  KEY `idx_sta_ticket` (`ticket_id`),
  CONSTRAINT `fk_sta_message` FOREIGN KEY (`message_id`) REFERENCES `support_ticket_messages` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
