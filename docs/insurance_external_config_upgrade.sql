-- Tách đợt khai BHYT nơi khác khỏi đợt đăng ký BHYT tại trường.
-- Trước đây khai nơi khác dùng chung hub_insurance_configs nên hết đợt đăng ký là sinh viên
-- không khai được nữa. Giờ có 4 slot riêng (MAIN/Q2/Q3/Q4), Staff quản lý trên Dashboard
-- ("Quản lý đợt khai BHYT nơi khác"). Chỉ một slot được bật tại một thời điểm.
-- Chạy THỦ CÔNG trên database dùng chung, TRƯỚC khi deploy code Hub + Dashboard.
-- Chạy lại được: bảng tạo bằng IF NOT EXISTS, slot chèn bằng INSERT IGNORE.
-- Không đụng tới bản khai hiện có (intake_year/intake_period giữ nguyên).

CREATE TABLE IF NOT EXISTS hub_insurance_external_configs (
    id BIGINT NOT NULL AUTO_INCREMENT,
    external_period VARCHAR(32) COLLATE utf8mb4_unicode_ci NOT NULL,
    external_year INT NOT NULL,
    opens_at DATETIME(6) NOT NULL,
    closes_at DATETIME(6) NOT NULL,
    graduate_closes_at DATETIME(6) NULL,
    is_active BOOLEAN NOT NULL DEFAULT 0,
    description TEXT NULL,
    hospital_lookup_url VARCHAR(500) NULL,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_external_config_period (external_period)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Giữ nguyên hành vi lúc deploy: chép lịch/cờ bật/link tra cứu từ đợt đăng ký BHYT hiện có
-- (trước đó khai nơi khác bám theo đúng các giá trị này). Staff chỉnh riêng sau đó.
INSERT IGNORE INTO hub_insurance_external_configs
    (external_period, external_year, opens_at, closes_at, graduate_closes_at, is_active,
     description, hospital_lookup_url, created_at, updated_at)
SELECT registration_period, registration_year, registration_opens_at, registration_closes_at,
       graduate_closes_at, is_active, NULL, hospital_lookup_url, NOW(6), NOW(6)
FROM hub_insurance_configs
WHERE registration_period IN ('MAIN', 'Q2', 'Q3', 'Q4');

-- Slot còn thiếu (môi trường chưa có đợt đăng ký tương ứng): tạo ở trạng thái tắt.
INSERT IGNORE INTO hub_insurance_external_configs
    (external_period, external_year, opens_at, closes_at, is_active, created_at, updated_at)
VALUES
    ('MAIN', YEAR(CURDATE()), NOW(6), NOW(6), 0, NOW(6), NOW(6)),
    ('Q2',   YEAR(CURDATE()), NOW(6), NOW(6), 0, NOW(6), NOW(6)),
    ('Q3',   YEAR(CURDATE()), NOW(6), NOW(6), 0, NOW(6), NOW(6)),
    ('Q4',   YEAR(CURDATE()), NOW(6), NOW(6), 0, NOW(6), NOW(6));

-- Hoàn tác (chỉ sau khi đã gỡ code Hub + Dashboard đọc bảng này):
-- DROP TABLE hub_insurance_external_configs;
