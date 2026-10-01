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
  `is_active` TINYINT(1) NOT NULL DEFAULT 0,
  `bank_account_id` BIGINT NULL,
  `description` TEXT NULL,
  `freshman_warning` TEXT NULL COMMENT 'Cảnh báo khi academic_entry_year trùng registration_year',
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


-- ── Miễn giảm học phí (30/09/2026) — nguồn: dashboard_iuoss/docs/sql/20260930_mghp_schema.sql
-- + 20260930_mghp_add_guardian.sql (3 cột guardian_* trên bảng đơn). Chỉ chép 4 bảng
-- hub_* ở đây; 6 bảng Dashboard sở hữu mà Hub đọc (tuition_exemption_categories,
-- _category_rates, _rounds, student_tuition_fees, tuition_fee_import_batches,
-- tuition_exemption_results) xem ở file nguồn. Cột ghi [DASH] = Dashboard được ghi.

CREATE TABLE `hub_tuition_exemption_applications` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `student_id` bigint NOT NULL,
  `round_id` bigint NOT NULL,
  -- Thông tin cá nhân (ảnh chụp)
  `student_code` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'MSSV lúc nộp',
  `full_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `date_of_birth` date DEFAULT NULL,
  `citizen_id` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Số CCCD',
  `citizen_id_issued_on` date DEFAULT NULL,
  `class_code` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `department_code` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `department_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `phone_number` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  -- Tài khoản nhận hoàn tiền (ảnh chụp — phương án A)
  `bank_account_number` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `bank_account_holder` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `bank_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  -- Cha mẹ
  `father_full_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `father_phone` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `mother_full_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `mother_phone` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  -- Địa chỉ thường trú
  `permanent_address` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Địa chỉ đầy đủ dạng chữ',
  `permanent_ward_code` char(5) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'vn_wards.code, không FK',
  -- Phân loại nộp lần đầu / đã được xét
  `submission_kind` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'first_time | previously_reviewed',
  `previous_review_note` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Đã xét ở kỳ nào (SV tự khai)',
  `category_details` json DEFAULT NULL COMMENT 'Thông tin riêng theo đối tượng (TSKK, KHAC…) — 20261001_mghp_official_categories.sql',
  -- Workflow
  `status` varchar(24) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'submitted'                 COMMENT '[DASH] giá trị ở tuition_exemption_contract.py',
  `rejection_reason_code` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL                  COMMENT '[DASH]',
  `review_note` text COLLATE utf8mb4_unicode_ci                                               COMMENT '[DASH] phản hồi hiện cho SV',
  `supplement_deadline` datetime(6) DEFAULT NULL                                              COMMENT '[DASH] hạn bổ sung',
  `reviewed_by_id` int DEFAULT NULL                                                           COMMENT '[DASH]',
  `reviewed_at` datetime(6) DEFAULT NULL                                                      COMMENT '[DASH]',
  `bank_synced_at` datetime(6) DEFAULT NULL                                                   COMMENT '[DASH] lúc chép TK vào student_bank_accounts',
  `bank_synced_by_id` int DEFAULT NULL                                                        COMMENT '[DASH]',
  `workflow_version` smallint unsigned NOT NULL DEFAULT '1',
  `row_version` int unsigned NOT NULL DEFAULT '0' COMMENT 'Khóa lạc quan — cả hai app tăng khi ghi; [DASH] được ghi',
  `submitted_at` datetime(6) NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '[DASH]',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_htea_student_round` (`student_id`, `round_id`),
  KEY `idx_htea_round_status` (`round_id`, `status`),
  KEY `idx_htea_status_updated` (`status`, `updated_at`),
  KEY `idx_htea_student_code` (`student_code`),
  CONSTRAINT `fk_htea_student` FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_htea_round` FOREIGN KEY (`round_id`) REFERENCES `tuition_exemption_rounds` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_htea_kind` CHECK (`submission_kind` IN ('first_time','previously_reviewed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `hub_tuition_exemption_application_categories` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `application_id` bigint NOT NULL,
  `category_id` bigint NOT NULL,
  `review_status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending' COMMENT '[DASH] pending | approved | rejected | need_supplement',
  `review_note` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL             COMMENT '[DASH]',
  `reviewed_by_id` int DEFAULT NULL                                               COMMENT '[DASH]',
  `reviewed_at` datetime(6) DEFAULT NULL                                          COMMENT '[DASH]',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_hteac_app_category` (`application_id`, `category_id`),
  KEY `idx_hteac_category_status` (`category_id`, `review_status`),
  CONSTRAINT `fk_hteac_application` FOREIGN KEY (`application_id`) REFERENCES `hub_tuition_exemption_applications` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_hteac_category` FOREIGN KEY (`category_id`) REFERENCES `tuition_exemption_categories` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `hub_tuition_exemption_events` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `application_id` bigint NOT NULL,
  `event_no` int unsigned NOT NULL,
  `event_type` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `from_status` varchar(24) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `to_status` varchar(24) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reason_code` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reason_text` text COLLATE utf8mb4_unicode_ci,
  `actor_type` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'student | staff | system',
  `actor_id` bigint DEFAULT NULL,
  `source_app` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Hub | Dashboard | Migration',
  `request_key` varchar(96) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `batch_id` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `payload` json DEFAULT NULL,
  `created_at` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_htee_number` (`application_id`, `event_no`),
  UNIQUE KEY `uq_htee_request` (`application_id`, `request_key`),
  KEY `idx_htee_timeline` (`application_id`, `created_at`, `id`),
  KEY `idx_htee_batch` (`batch_id`),
  CONSTRAINT `fk_htee_application` FOREIGN KEY (`application_id`) REFERENCES `hub_tuition_exemption_applications` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `hub_tuition_exemption_documents` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `application_id` bigint NOT NULL,
  `application_category_id` bigint DEFAULT NULL COMMENT 'Giấy này chứng minh đối tượng nào; NULL = giấy chung',
  `event_id` bigint NOT NULL,
  `doc_type` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Khớp required_documents[].doc_type',
  `storage_key` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `original_filename` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `mime_type` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `file_size_bytes` bigint NOT NULL,
  `sha256` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `issued_on` date DEFAULT NULL COMMENT 'Ngày cấp giấy (SV khai, tùy chọn)',
  `expires_at` date DEFAULT NULL COMMENT '[DASH] Ngày hết hiệu lực; SV khai, cán bộ xác nhận/sửa',
  `is_superseded` tinyint(1) NOT NULL DEFAULT '0' COMMENT 'Hub đặt 1 khi SV thay file',
  `verified_status` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '[DASH] valid | invalid | NULL = chưa xem',
  `verified_note` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL  COMMENT '[DASH]',
  `verified_by_id` int DEFAULT NULL                                      COMMENT '[DASH]',
  `verified_at` datetime(6) DEFAULT NULL                                 COMMENT '[DASH]',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_hted_application` (`application_id`, `is_superseded`, `id`),
  KEY `idx_hted_event` (`event_id`),
  KEY `idx_hted_expiry` (`expires_at`),
  CONSTRAINT `fk_hted_application` FOREIGN KEY (`application_id`) REFERENCES `hub_tuition_exemption_applications` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_hted_app_category` FOREIGN KEY (`application_category_id`) REFERENCES `hub_tuition_exemption_application_categories` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_hted_event` FOREIGN KEY (`event_id`) REFERENCES `hub_tuition_exemption_events` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_hted_size` CHECK (`file_size_bytes` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
