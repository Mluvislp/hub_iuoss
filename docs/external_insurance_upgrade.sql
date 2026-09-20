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
    KEY idx_external_status_created (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
