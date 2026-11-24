# IUOSS Hub — tính năng & cờ

Nghiệp vụ chi tiết từng tính năng nằm ở `dashboard_iuoss/docs/` (một doc cho cả hai app). File này giữ phần **riêng
của Hub**: cờ tính năng, trang chủ/BHYT xem thẻ, log, UI dùng chung.

## 0. Cờ tính năng

Cờ tắt **không ẩn mục khỏi menu**: mục hiện kèm chấm nhỏ, bấm vào ra `<ComingSoon />`. **Nguồn sự thật là backend**
(`config/settings.py`): view tắt **404 ngay ở `initial()`** và không truy vấn dữ liệu. Frontend đọc `GET /api/features/`
qua `lib/features.ts::useFeatures()` (cache `sessionStorage`; chưa biết ⇒ coi như TẮT). Chặn ở **một chỗ**:
`(dashboard)/layout.tsx` tra `featureForRoute(pathname)`.

| Cờ | Mặc định | Chi phối |
|---|---|---|
| `FEATURE_DOCUMENT_REQUESTS` | `not IS_PRODUCTION` | `/dashboard/requests/*`, `/api/requests/*`, khối yêu cầu gần đây ở trang chủ |
| `FEATURE_CIVIC_ACTIVITIES` | `not IS_PRODUCTION` | `/dashboard/sinh-hoat-cong-dan`, khối SHCD trang chủ |
| `FEATURE_HEALTH_CHECK` | **bật** mọi môi trường | `/dashboard/kham-suc-khoe`, `/api/health-check/*` |
| `FEATURE_SUPPORT_TICKETS` | `not IS_PRODUCTION` (Dashboard có cờ cùng tên) | `/dashboard/hoi-dap/*`, `/api/tickets/*` |
| `FEATURE_PERSONAL_INFO` | `not IS_PRODUCTION` | `/dashboard/thong-tin-ca-nhan`, `/api/personal-info/` |
| `FEATURE_DIPLOMA` | `not IS_PRODUCTION` | `/dashboard/bang-tot-nghiep`, `/api/diploma/*` |
| `FEATURE_TUITION_WAIVER` (nhánh sandbox) | `not IS_PRODUCTION` | `/dashboard/mien-giam-hoc-phi/*`, `/api/tuition-exemption/*` |
| `FEATURE_DIRECT_SUBMISSIONS` | `not IS_PRODUCTION` | `/dashboard/nap-giay-to/*`, `/api/submissions/*` |
| `FEATURE_VOLUNTEER_EVENTS` | `not IS_PRODUCTION` | `/dashboard/su-kien/*`, `/api/volunteer-events/*` |
| `FEATURE_OFFCAMPUS` | **tắt** | `/api/offcampus/*`; trang `/dashboard/khai-bao-ngoai-tru` tự đọc cờ (không qua `FEATURE_ROUTES`), tắt thì hiện thông báo + nút sang Khai báo địa chỉ, không có trong menu. Khám sức khỏe vẫn dùng form, không phụ thuộc cờ |

Giá trị thật trên prod/sandbox nằm ở `backend/.env` của từng môi trường — kiểm ở đó, đừng suy từ bảng này.
Trang quản lý bên Dashboard không bị cờ Hub chặn (tạo đợt trước rồi mới bật).

- **Thêm cờ**: `FEATURE_X = env_bool(...)` ở `settings.py` + khoá trong `core/api/views.py::feature_flags()` →
  `FeatureFlags` (`lib/types.ts`) + `FEATURE_META` / `FEATURE_ROUTES` (`lib/features.ts`).
- **Bật trên prod**: thêm vào `backend/.env` → `sudo systemctl restart iuoss_hub`. Không cần build lại frontend; SV đang mở
  tab thấy sau khi mở tab mới (cache `sessionStorage`).
- Xem trang chờ ở local: chạy backend với biến tạm `FEATURE_X=False`.

## 1. Đăng nhập

LDAP bind 2 bước hoặc Microsoft — chi tiết `docs/AUTH_FLOW.md`. JWT access 8 giờ / refresh 7 ngày (refresh **xét lại
quyền vào cổng**). "Quên mật khẩu" trỏ `https://ldap.hcmiu.edu.vn/iupwd/?action=sendtoken`.

## 2. Trang chủ & xem thẻ BHYT

- Trang chủ (`GET /api/dashboard/`): stat card từ `students` (read-only), thẻ BHYT, SHCD, yêu cầu gần đây.
- `/dashboard/bao-hiem-y-te` (`GET /api/health-insurance/` → `{current, history[]}`), luôn bật. Đăng ký theo đợt, workflow,
  khai nơi khác, đổi nơi KCB: [`INSURANCE.md`](INSURANCE.md).
- **"Còn hiệu lực" tính theo `valid_until`**, không theo `is_current` (= thẻ đang dùng): NULL ⇒ "Chưa có thông tin hạn" ·
  ≥ hôm nay ⇒ Còn hiệu lực · < hôm nay ⇒ Hết hạn. Code: `components/health-insurance.tsx` (`validityState()`,
  `<HealthValidityBadge>`), dùng chung trang chủ + trang BHYT; so chuỗi `YYYY-MM-DD`.
- Lịch đợt đọc từ `hub_insurance_configs` (4 slot); `lib/insurance-periods.ts` chỉ là type + hàm hiển thị. Trang hiện đợt
  đang mở + kế tiếp (không có đợt mở ⇒ đợt vừa hết + kế tiếp).
- Nơi KCB hiển thị **tên** tra từ `hospitals` (gom `{code: name}` một truy vấn, không FK); không khớp ⇒ hiện mã thô,
  **không bao giờ thêm dòng vào `hospitals`**.
- ⚠️ Model `managed=False` đưa mọi cột thẻ (`social_insurance_code`, `registration_type_id`, `valid_from`…) vào mọi SELECT ⇒
  thiếu cột trên prod là hỏng **cả trang chủ**. Dữ liệu thẻ nhiều ô trống — giao diện phải chịu được.

## 3. Tính năng khác — tra ở Dashboard docs

| Tính năng | Hub | Doc |
|---|---|---|
| Yêu cầu giấy tờ (6 loại, trao đổi, sửa lúc Chờ bổ sung, xem trước, hạn mức, mã `GT-`) | `core/documents.py`, `request_*.py` | `DOCUMENT_REQUESTS.md` |
| Nạp giấy tờ trực tiếp (mã `NG-`) | `core/direct_submissions.py` | `DIRECT_SUBMISSIONS.md` |
| Khai báo địa chỉ / ngoại trú · Thông tin cá nhân | `core/offcampus.py`, `core/personal_info.py` | `OFFCAMPUS.md` |
| Khám sức khỏe | `core/health_check*.py` | `HEALTH_CHECK.md` |
| Bằng THPT | `core/diploma.py` | `DIPLOMA.md` |
| Lễ tốt nghiệp | `core/graduation.py` | `GRADUATION.md` |
| Hỏi đáp | `core/tickets.py` | `SUPPORT_TICKETS.md` |
| Sự kiện cộng tác viên | `core/volunteer_events.py` | `VOLUNTEER_EVENTS.md` |

Luật "SV trao đổi được ở trạng thái nào" viết ở **hai nơi**: `ConfirmationRequest.STUDENT_CAN_COMMENT_STATUSES` (Hub) ↔
`DocumentRequest.STUDENT_CAN_COMMENT_STATUSES` (Dashboard).

## 4. Log

`logs/auth.log` (đăng nhập: `LOGIN_ATTEMPT/SUCCESS/FAIL`, `LOGOUT`, `LDAP_*`, `CONFIRMATION_REQUEST`) và `logs/app.log`
(lỗi Django). Tự xoay 5 MB × 5 bản.

## 5. UI dùng chung

- **Ô hỗ trợ kỹ thuật** `components/support-widget.tsx` (mount ở `app/layout.tsx`, mọi trang kể cả login): sửa liên hệ ở
  hằng `SUPPORT` (`phone` + `phoneRaw`). Cố ý: không tự bật, `z-30` (dưới overlay/sidebar), SĐT chỉ render sau khi bấm.
- Khung trang: `app/(dashboard)/layout.tsx`. Quy ước trình bày + design token: `frontend/DESIGN.md`.
- Django **chỉ phục vụ `/api/`**; mọi URL giao diện do Next.js.
