# Khai thông tin tham gia BHYT tại nơi khác

Chạy `external_insurance_upgrade.sql` trên database dùng chung trước khi deploy cả Hub và Dashboard. Không cần chạy lại các SQL nâng cấp BHYT trước đây nếu chúng đã được áp dụng.

Nếu bảng này đã được tạo bằng phiên bản trước của chức năng, chạy `external_insurance_review_upgrade.sql` thay cho file tạo bảng. Script giữ các dòng đã có thẻ ở trạng thái `confirmed` và không đổi thẻ ưu tiên hiện tại.

- Hub: `/dashboard/bao-hiem-y-te/khai-noi-khac`; API GET/POST `/api/health-insurance/external/`.
- Dashboard: mục BHYT tại nơi khác; dùng quyền xem BHYT hiện có.
- Mọi sinh viên đã đăng nhập và có hồ sơ đều có thể khai, không phụ thuộc đợt đăng ký, trạng thái học hoặc hạn thẻ.
- Mỗi lần gửi tạo một snapshot `pending` trong `student_external_health_insurance_declarations`; chưa tạo thẻ và không thay đổi thẻ ưu tiên hiện tại.
- Khi cán bộ xác nhận, Dashboard tạo một dòng trong `student_health_insurance_cards` với `is_current=0`. Cán bộ dùng nút “Ưu tiên hiển thị” trên danh sách thẻ để chọn đúng dòng `is_current=1` cho Hub.
- Diện `NGOAI_TRUONG` được tạo nếu chưa có. Năm tham gia lấy từ ngày bắt đầu hiệu lực do sinh viên khai.
- Snapshot lưu thông tin cá nhân, mã thẻ, BHXH, bệnh viện, thời hạn, trạng thái duyệt và liên kết thẻ. Hub hiển thị lịch sử mọi lần khai.
- Ảnh CCCD trước/sau và BHYT được kiểm tra nội dung, lưu dưới `insurance_private/external`. Dashboard đọc qua `HUB_MEDIA_ROOT` như ảnh đăng ký hiện có; không phục vụ thư mục private qua static/media công khai.
- Request key chống tạo trùng khi gửi lại cùng nội dung; lỗi lưu DB sẽ hoàn tác cả thẻ, snapshot và các file mới.

Thay đổi phát hành KTX chỉ áp dụng cho lần phát hành sau triển khai: bệnh viện để NULL; mã thẻ, BHXH và thời hạn giữ logic cũ. Không tự sửa thẻ đã phát hành.
