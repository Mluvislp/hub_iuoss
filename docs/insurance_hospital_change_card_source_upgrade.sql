-- Yêu cầu đổi nơi KCB ban đầu: nguồn có thể là thẻ diện ĐHQT còn hạn không có đơn đăng ký.
-- Khi đó registration_id = NULL và card_id = thẻ làm nguồn (thông tin chép từ hồ sơ sinh viên).
-- Chỉ cần chạy nếu đã chạy insurance_hospital_change_upgrade.sql bản cũ (registration_id NOT NULL).
-- Chạy trên database dùng chung TRƯỚC KHI deploy Hub và Dashboard. Chạy lại không sao.
ALTER TABLE hub_insurance_hospital_change_requests MODIFY registration_id BIGINT NULL;
