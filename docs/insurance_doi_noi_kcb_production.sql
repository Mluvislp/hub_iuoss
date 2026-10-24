-- ═══════════════════════════════════════════════════════════════════════════
-- PRODUCTION — nâng cấp nhánh feature/doi-noi-kcb (Đổi nơi KCB ban đầu + link
-- tra cứu bệnh viện). Gộp theo đúng thứ tự từ:
--   1. insurance_hospital_change_upgrade.sql          (3 bảng đổi nơi KCB, bản cuối)
--   2. insurance_hospital_lookup_url_upgrade.sql      (cột hospital_lookup_url)
--   3. insurance_hospital_change_status_upgrade.sql   (an toàn: no-op trên DB mới)
--   4. insurance_hospital_change_card_source_upgrade.sql (an toàn: no-op trên DB mới)
-- Chạy THỦ CÔNG trên database dùng chung, TRƯỚC KHI deploy Hub + Dashboard.
-- Chạy lại được nhiều lần. Không đụng dữ liệu đơn/thẻ hiện có.
-- Chạy bằng mysql client (có DELIMITER), ví dụ:
--   mysql -u <user> -p <database> < insurance_doi_noi_kcb_production.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Bảng đổi nơi KCB ban đầu ─────────────────────────────────────────────
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
-- lúc gửi; sinh viên chỉ đổi được hospital_code. Không có đơn thì registration_id NULL,
-- card_id = thẻ diện ĐHQT còn hạn làm nguồn (thông tin chép từ hồ sơ sinh viên).
CREATE TABLE IF NOT EXISTS hub_insurance_hospital_change_requests (
    id BIGINT NOT NULL AUTO_INCREMENT,
    student_id BIGINT NOT NULL,
    registration_id BIGINT NULL,
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
    status VARCHAR(16) NOT NULL DEFAULT 'iu_processing',
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

-- ── 2. Link tra cứu bệnh viện (hub_insurance_configs) ───────────────────────
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

-- ── 3 + 4. Đồng bộ dữ liệu/kiểu cột với bản cũ (DB mới: không đổi gì) ─────
UPDATE hub_insurance_hospital_change_requests SET status = 'iu_processing' WHERE status = 'pending';
UPDATE hub_insurance_hospital_change_requests SET status = 'issued' WHERE status = 'confirmed';
ALTER TABLE hub_insurance_hospital_change_requests ALTER COLUMN status SET DEFAULT 'iu_processing';
ALTER TABLE hub_insurance_hospital_change_requests MODIFY registration_id BIGINT NULL;
