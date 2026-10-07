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
  `note` TEXT NULL,
  `supplement_pending` BOOLEAN NOT NULL DEFAULT 0,
  `supplemented_at` DATETIME(6) NULL,
  `supplement_reviewed_at` DATETIME(6) NULL,
  `created_at` DATETIME(6) NOT NULL,
  `updated_at` DATETIME(6) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_hir_student_id` (`student_id`),
  KEY `idx_hir_period_year` (`registration_year`, `registration_period`),
  KEY `idx_hir_status` (`status`),
  KEY `ix_supplement_queue` (`supplement_pending`, `supplemented_at`, `id`)
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
  `graduate_closes_at` DATETIME(6) NULL COMMENT 'Hạn đóng riêng cho học viên cao học; NULL = dùng registration_closes_at',
  `is_active` TINYINT(1) NOT NULL DEFAULT 0,
  `bank_account_id` BIGINT NULL,
  `description` TEXT NULL,
  `freshman_warning` TEXT NULL COMMENT 'Cảnh báo khi academic_entry_year trùng registration_year',
  `hospital_lookup_url` VARCHAR(500) NULL COMMENT 'Link danh sách bệnh viện cho SV tra cứu; NULL/rỗng = ẩn',
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

-- Fresh-schema definitions. Existing databases: use insurance_edit_preflight.sql,
-- insurance_edit_upgrade.sql, insurance_edit_verify.sql; do not recreate records.
-- Chạy một lần trên database chung trước khi triển khai Hub và Dashboard.
-- Các model managed=False: migrate không tạo bảng này.
-- Không thay đổi hay xóa dữ liệu thẻ/đơn hiện có.
CREATE TABLE IF NOT EXISTS student_external_health_insurance_declarations (
    id BIGINT NOT NULL AUTO_INCREMENT,
    student_id BIGINT NOT NULL,
    card_id BIGINT NULL,
    full_name VARCHAR(255) NOT NULL,
    student_code VARCHAR(64) NOT NULL,
    social_insurance_code VARCHAR(15) NOT NULL,
    medical_insurance_code VARCHAR(64) NOT NULL,
    hospital_code VARCHAR(16) NOT NULL,
    registration_type_id BIGINT NULL,
    valid_from DATE NOT NULL,
    valid_until DATE NOT NULL,
    registration_year INT NOT NULL,
    intake_year INT NULL,
    intake_period VARCHAR(32) COLLATE utf8mb4_unicode_ci NULL,
    intake_snapshot JSON NULL,
    row_version INT UNSIGNED NOT NULL DEFAULT 0,
    supplement_pending BOOLEAN NOT NULL DEFAULT 0,
    supplemented_at DATETIME(6) NULL,
    supplement_reviewed_at DATETIME(6) NULL,
    snapshot JSON NOT NULL,
    images JSON NOT NULL,
    request_key VARCHAR(80) NOT NULL,
    request_digest VARCHAR(64) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    review_note TEXT NULL,
    reviewed_by_id BIGINT NULL,
    reviewed_at DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_external_student_request (student_id, request_key),
    KEY idx_external_student_created (student_id, created_at),
    KEY idx_external_card (card_id),
    KEY idx_external_student_code (student_code),
    KEY idx_external_status_created (status, created_at),
    KEY ix_supplement_queue (supplement_pending, supplemented_at, id),
    KEY ix_external_intake (student_id, intake_year, intake_period)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS hub_external_insurance_events (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 declaration_id BIGINT NOT NULL,
 event_type VARCHAR(40) NOT NULL,
 actor_id BIGINT NULL,
 source_app VARCHAR(16) NOT NULL,
 request_key VARCHAR(96) NULL,
 payload JSON NULL,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 UNIQUE KEY uq_external_event_request (declaration_id, request_key),
 KEY ix_external_event_timeline (declaration_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Đổi nơi KCB ban đầu (07/10/2026) — nguồn: docs/insurance_hospital_change_upgrade.sql

-- 4 slot đợt nhận yêu cầu (MAIN/Q2/Q3/Q4), tách riêng với hub_insurance_configs.
-- Staff tái sử dụng qua từng năm trên Dashboard; chỉ một slot được bật tại một thời điểm.
CREATE TABLE IF NOT EXISTS hub_insurance_hospital_change_configs (
    id BIGINT NOT NULL AUTO_INCREMENT,
    change_period VARCHAR(32) COLLATE utf8mb4_unicode_ci NOT NULL,
    change_year INT NOT NULL,
    opens_at DATETIME(6) NOT NULL,
    closes_at DATETIME(6) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT 0,
    description TEXT NULL,
    hospital_lookup_url VARCHAR(500) NULL,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_hospital_change_period (change_period)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO hub_insurance_hospital_change_configs
    (change_period, change_year, opens_at, closes_at, is_active, description, hospital_lookup_url, created_at, updated_at)
VALUES
    ('MAIN', YEAR(CURDATE()), NOW(6), NOW(6), 0, NULL, 'https://drive.google.com/file/d/1S1oznRw_hKKeYmA6H5qVqDz0w3KxsqaM/view?usp=sharing', NOW(6), NOW(6)),
    ('Q2',   YEAR(CURDATE()), NOW(6), NOW(6), 0, NULL, 'https://drive.google.com/file/d/1S1oznRw_hKKeYmA6H5qVqDz0w3KxsqaM/view?usp=sharing', NOW(6), NOW(6)),
    ('Q3',   YEAR(CURDATE()), NOW(6), NOW(6), 0, NULL, 'https://drive.google.com/file/d/1S1oznRw_hKKeYmA6H5qVqDz0w3KxsqaM/view?usp=sharing', NOW(6), NOW(6)),
    ('Q4',   YEAR(CURDATE()), NOW(6), NOW(6), 0, NULL, 'https://drive.google.com/file/d/1S1oznRw_hKKeYmA6H5qVqDz0w3KxsqaM/view?usp=sharing', NOW(6), NOW(6));

-- Mỗi yêu cầu chụp lại toàn bộ đơn đăng ký tại trường làm nguồn (snapshot + ảnh)
-- lúc gửi; sinh viên chỉ đổi được hospital_code.
CREATE TABLE IF NOT EXISTS hub_insurance_hospital_change_requests (
    id BIGINT NOT NULL AUTO_INCREMENT,
    student_id BIGINT NOT NULL,
    registration_id BIGINT NOT NULL,
    card_id BIGINT NULL,
    full_name VARCHAR(255) NOT NULL,
    student_code VARCHAR(64) NOT NULL,
    social_insurance_code VARCHAR(20) NOT NULL DEFAULT '',
    old_hospital_code VARCHAR(16) NOT NULL DEFAULT '',
    hospital_code VARCHAR(16) NOT NULL,
    intake_year INT NOT NULL,
    intake_period VARCHAR(32) COLLATE utf8mb4_unicode_ci NOT NULL,
    intake_snapshot JSON NULL,
    row_version INT UNSIGNED NOT NULL DEFAULT 0,
    supplement_pending BOOLEAN NOT NULL DEFAULT 0,
    supplemented_at DATETIME(6) NULL,
    supplement_reviewed_at DATETIME(6) NULL,
    snapshot JSON NOT NULL,
    images JSON NOT NULL,
    request_key VARCHAR(80) NOT NULL,
    request_digest VARCHAR(64) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    review_note TEXT NULL,
    reviewed_by_id BIGINT NULL,
    reviewed_at DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_hospital_change_student_request (student_id, request_key),
    KEY ix_hospital_change_student_created (student_id, created_at),
    KEY ix_hospital_change_registration (registration_id),
    KEY ix_hospital_change_student_code (student_code),
    KEY ix_hospital_change_status_created (status, created_at),
    KEY ix_hospital_change_supplement (supplement_pending, supplemented_at, id),
    KEY ix_hospital_change_intake (student_id, intake_year, intake_period)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Timeline append-only của yêu cầu, cùng khuôn hub_external_insurance_events.
CREATE TABLE IF NOT EXISTS hub_insurance_hospital_change_events (
    id BIGINT NOT NULL AUTO_INCREMENT,
    change_request_id BIGINT NOT NULL,
    event_type VARCHAR(40) NOT NULL,
    actor_id BIGINT NULL,
    source_app VARCHAR(16) NOT NULL,
    request_key VARCHAR(96) NULL,
    payload JSON NULL,
    created_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_hospital_change_event_key (change_request_id, request_key),
    KEY ix_hospital_change_event_request (change_request_id, id),
    CONSTRAINT fk_hospital_change_event_request FOREIGN KEY (change_request_id)
        REFERENCES hub_insurance_hospital_change_requests (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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

-- Mảng công việc, tối đa HAI cấp: mảng (parent_id NULL) → mục con (parent_id = mảng).
-- `notify_emails` nhận nhiều địa chỉ, phân cách bằng dấu phẩy hoặc xuống dòng; ticket
-- mới + sinh viên nhắn thêm gửi tới toàn bộ danh sách. Mục con để trống = dùng email
-- của mảng cha. Mảng có mục con thì sinh viên BẮT BUỘC chọn một mục con.
-- Đổi người phụ trách = sửa trên Dashboard (Hỏi đáp sinh viên → Mảng công việc).
CREATE TABLE `support_ticket_topics` (
  `id` int NOT NULL AUTO_INCREMENT,
  `parent_id` int DEFAULT NULL COMMENT 'NULL = mảng cấp 1; có giá trị = mục con của mảng đó',
  `code` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Gợi ý hiện cho sinh viên khi chọn mảng',
  `notify_emails` text COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Email người phụ trách, phân cách bằng dấu phẩy/xuống dòng; mục con để rỗng = dùng email mảng cha',
  `cc_emails` text COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Email CC, phân cách bằng dấu phẩy; mục con để trống = dùng CC mảng cha',
  `sort_order` smallint NOT NULL DEFAULT '0',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_stt_code` (`code`),
  KEY `idx_stt_parent` (`parent_id`, `sort_order`),
  CONSTRAINT `fk_stt_parent` FOREIGN KEY (`parent_id`) REFERENCES `support_ticket_topics` (`id`) ON DELETE RESTRICT
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

-- ════════ Phản hồi chung (mẫu trả lời soạn sẵn) — thêm 30/09/2026 ════════
-- Mỗi mảng/mục con có danh sách mẫu riêng. Ticket thuộc mục con thấy mẫu của mục con + của
-- mảng cha. `body` là HTML ĐÃ LÀM SẠCH (support/richtext.py) do CKEditor soạn.
-- Chuyên viên thêm/sửa/xoá ngay trong ngăn "Phản hồi chung" ở trang chi tiết ticket.
CREATE TABLE `support_canned_responses` (
  `id` int NOT NULL AUTO_INCREMENT,
  `topic_id` int NOT NULL,
  `title` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Tên ngắn để chuyên viên tìm/chọn',
  `body` text COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'HTML đã làm sạch',
  `sort_order` smallint NOT NULL DEFAULT '0',
  `created_by_id` int DEFAULT NULL,
  `updated_by_id` int DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_scr_topic` (`topic_id`, `sort_order`),
  CONSTRAINT `fk_scr_topic` FOREIGN KEY (`topic_id`) REFERENCES `support_ticket_topics` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Chỉ định mảng hỏi đáp cho tài khoản Dashboard (Hub không đọc bảng này).
CREATE TABLE `support_topic_assignees` (
  `id` int NOT NULL AUTO_INCREMENT,
  `topic_id` int NOT NULL,
  `user_id` int NOT NULL COMMENT 'auth_user.id',
  `created_by_id` int DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_sta_topic_user` (`topic_id`, `user_id`),
  KEY `idx_sta_user` (`user_id`),
  CONSTRAINT `fk_stassign_topic` FOREIGN KEY (`topic_id`) REFERENCES `support_ticket_topics` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_stassign_user` FOREIGN KEY (`user_id`) REFERENCES `auth_user` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ════════ Ảnh cố định của sinh viên — 04/10/2026 ════════
-- Nguồn (kèm quy ước đầy đủ): dashboard_iuoss/docs/sql/20261004_student_images.sql
-- Dòng bất biến; thay ảnh = dòng mới + hạ is_current dòng cũ về 0. Hub ghi.
CREATE TABLE `student_images` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `student_id` bigint NOT NULL,
  `kind` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL
    COMMENT 'cccd_front | cccd_back | bhyt_card | portrait | avatar — registry ở Hub core/student_images.py',
  `subject` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'SELF'
    COMMENT 'Ảnh của ai: SELF | FATHER | MOTHER | GUARDIAN (khớp student_family_members.relationship)',
  `storage_key` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Đường dẫn tương đối dưới MEDIA_ROOT của Hub',
  `original_filename` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `mime_type` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `file_size_bytes` bigint NOT NULL,
  `sha256` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `source` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL
    COMMENT 'Luồng tải lên: bhyt_registration | external_insurance | mghp | backfill',
  `is_current` tinyint(1) NOT NULL DEFAULT '1' COMMENT '1 = ảnh đang dùng của ô (student_id, kind, subject); 0 = đã bị ảnh mới thay',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_si_slot` (`student_id`, `kind`, `subject`, `is_current`),
  CONSTRAINT `fk_si_student` FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_si_subject` CHECK (`subject` IN ('SELF','FATHER','MOTHER','GUARDIAN')),
  CONSTRAINT `chk_si_size` CHECK (`file_size_bytes` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
