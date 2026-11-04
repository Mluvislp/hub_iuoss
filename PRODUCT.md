# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Web responsive (Next.js 14 + Tailwind). Đa số sinh viên mở bằng **điện thoại** — mobile web
vẫn là `web`, không phải app native.

## Users

**Sinh viên Trường Đại học Quốc tế – ĐHQG TP.HCM (HCMIU).** Họ đăng nhập bằng tài khoản mạng
trường (LDAP, MSSV) hoặc Microsoft/Entra ID.

Tình huống dùng điển hình: **có đợt mở thì vào, xong việc thì đóng.** Phòng gửi thông báo
một đợt (đăng ký BHYT, khai báo ngoại trú, khám sức khỏe, miễn giảm học phí) qua email,
Zalo hoặc fanpage → sinh viên mở link **trên điện thoại** → làm xong một việc cụ thể (khai,
nộp, chụp và tải ảnh giấy tờ, xem trạng thái) → thoát. Ít khi có ai ngồi lâu trong Hub.

Phía bên kia là chuyên viên Phòng Công tác Sinh viên (OSS). Họ làm việc ở một app khác
(`dashboard_iuoss`), không dùng Hub. Người dùng của Hub chỉ có sinh viên.

## Product Purpose

Gom mọi thủ tục hành chính sinh viên phải làm với phòng CTSV về **một cổng duy nhất**, chạy
trên chính dữ liệu phòng đang giữ. Sinh viên có thể:

- xem hồ sơ cá nhân, tự sửa CCCD/email/SĐT;
- đăng ký BHYT theo đợt, khai đã tham gia BHYT ở nơi khác, xem thẻ và lịch sử thẻ;
- khai báo địa chỉ ngoại trú;
- khám sức khỏe định kỳ (nộp minh chứng hoặc đăng ký khám tại trường);
- nộp và theo dõi hồ sơ miễn giảm học phí;
- tra kết quả sinh hoạt công dân;
- gửi yêu cầu giấy tờ (5 loại) và trao đổi hai chiều với chuyên viên ngay trên yêu cầu.

Thành công nghĩa là: sinh viên làm xong thủ tục trên điện thoại mà không phải đến phòng,
không phải khai lại thông tin phòng đã có, và luôn biết hồ sơ của mình đang ở bước nào.

## Positioning

Khác Google Form, nộp giấy tại phòng hay portal chung của trường ở bốn điểm. Tất cả đều
phải giữ:

1. **Một chỗ, dữ liệu có sẵn.** Hub đọc thẳng database của phòng nên hồ sơ đã được điền
   sẵn. Sinh viên chỉ xác nhận hoặc sửa, không khai lại từ đầu.
2. **Theo dõi trạng thái.** Mỗi đơn có trạng thái, timeline và lý do bị trả về. Sinh viên
   bổ sung ngay trên web.
3. **Trao đổi trực tiếp với chuyên viên** trên từng yêu cầu, thay cho email hay đến phòng.
4. **Ít phải đến trường.** Mọi bước, kể cả nộp ảnh giấy tờ, đều làm được trực tuyến.

## Operating Context

- **Theo đợt.** BHYT, MGHP và khám sức khỏe đều chạy theo đợt (mở/đóng, hạn chót). Phòng
  cấu hình đợt bên Dashboard, Hub chỉ hiển thị. Lưu lượng tăng vọt quanh thông báo và
  hạn chót.
- **Giấy tờ thật.** Sinh viên chụp CCCD (có đọc QR căn cước), thẻ BHYT, giấy khám, giấy
  xác nhận diện chính sách… bằng camera điện thoại. Có ảnh HEIC, và hệ thống xác minh
  MIME.
- **Quy trình duyệt hai phía.** Hub nộp, chuyên viên duyệt bên Dashboard. Các trạng thái
  (chờ duyệt, cần bổ sung, bị từ chối, đã duyệt) và lý do do contract dùng chung giữa
  hai app quy định. Email thông báo được gửi tự động.
- **Cờ tính năng.** Tính năng chưa mở vẫn hiện trên menu và dẫn tới trang "đang phát
  triển" (`<ComingSoon />`), không bị ẩn.
- **Tân sinh viên** có cảnh báo riêng (popup) theo năm hiện tại.
- Có widget hỗ trợ kỹ thuật trên mọi trang, kể cả màn hình đăng nhập.

## Capabilities and Constraints

- **Ngôn ngữ:** giao diện tiếng Việt (`lang="vi"`). Chưa xác nhận có nhu cầu tiếng Anh cho
  sinh viên quốc tế. Đây là quyết định còn mở.
- **Thuật ngữ cố định:** BHYT (bảo hiểm y tế), MGHP (miễn giảm học phí), SHCD (sinh hoạt
  công dân), khai báo ngoại trú, MSSV, CCCD, đợt, hồ sơ, yêu cầu giấy tờ, bổ sung, chuyên
  viên, Phòng CTSV/OSS.
- **Kỹ thuật:** Next.js 14 App Router + Tailwind 3, `lucide-react`, `react-hook-form` +
  `zod`. Backend Django + DRF, dùng chung MySQL với Dashboard. Chi tiết và các quy tắc cứng
  nằm ở `CODEBASE.md`.
- **Dữ liệu là của phòng:** Hub không ghi vào bảng Dashboard sở hữu, trừ các ngoại lệ đã
  chốt. Giao diện không được hứa với sinh viên những việc backend không làm.
- **Đang dở:** form nộp MGHP mới là khung (backend trả 501). Thông báo chung từ phòng
  (`hub_announcements`) và SSO với WordPress chưa có.

## Brand Commitments

- Tên sản phẩm: **IUOSS Hub**, mô tả là "Cổng thông tin sinh viên". Domain: `hub.iuoss.com`.
- Chưa có chuẩn nhận diện chính thức nào bắt buộc. Định hướng là **đi theo nhận diện của
  HCMIU / Phòng CTSV (OSS)**. Logo và bảng màu chính thức sẽ do người dùng cung cấp, hiện
  **chưa có trong repo**. Đừng tự vẽ hay đoán logo, màu của trường.
- Màu xanh `#2563eb` và font Inter hiện tại chỉ là lựa chọn ban đầu, chưa phải cam kết
  thương hiệu.

## Evidence on Hand

- Dữ liệu thật của sinh viên lấy từ DB dùng chung. Đây là dữ liệu cá nhân nhạy cảm (CCCD,
  địa chỉ, BHYT): không dùng làm ảnh minh họa, không đưa lên dịch vụ bên ngoài.
- Tài liệu nghiệp vụ: `docs/FEATURES.md`, `docs/INSURANCE.md`, `docs/AUTH_FLOW.md`,
  `dashboard_iuoss/docs/TUITION_EXEMPTION.md`, `dashboard_iuoss/docs/HEALTH_CHECK.md`.
- **Chưa có:** logo/asset nhận diện chính thức, số liệu sử dụng, phản hồi sinh viên. Đừng
  bịa số liệu, lời chứng thực hay thống kê.

## Product Principles

1. **Xong việc trên điện thoại.** Mọi luồng phải làm trọn được bằng một tay trên màn hình
   nhỏ, kể cả chụp và tải giấy tờ. Desktop là phụ.
2. **Đừng bắt khai lại điều phòng đã biết.** Ưu tiên hiển thị dữ liệu có sẵn để sinh viên
   xác nhận hoặc sửa, thay vì ô trống.
3. **Trạng thái luôn rõ.** Ở bất kỳ màn hình nào, sinh viên cũng phải biết hồ sơ đang ở
   bước nào, cần làm gì tiếp, hạn chót là khi nào, và nếu bị trả về thì vì sao.
4. **Thay được một chuyến lên phòng.** Nếu phải hỏi chuyên viên thì hỏi ngay trong Hub.
   Không có bước nào buộc sinh viên đến trường mà không có lý do nghiệp vụ.
5. **Nói đúng sự thật của backend.** Tính năng chưa mở thì báo "đang phát triển". Giao
   diện không giả lập khả năng chưa có.

## Accessibility & Inclusion

Chưa có chuẩn WCAG bắt buộc. Thực tế sử dụng đòi hỏi: đọc tốt và bấm chính xác trên màn
hình điện thoại nhỏ, ngoài trời; hiển thị đúng dấu tiếng Việt. Nhu cầu tiếng Anh cho sinh
viên quốc tế chưa được xác nhận.
