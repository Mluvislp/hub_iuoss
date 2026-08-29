# IUOSS Hub — Tính năng đã implement

> Tài liệu này mô tả chi tiết các tính năng đã có trong hệ thống, cách hoạt động và cách mở rộng.

---

## 0. Cờ tính năng — "đang phát triển"

Cơ chế dùng chung cho mọi tính năng **chưa mở cho sinh viên**. Cờ tắt **không
ẩn mục khỏi menu**: mục vẫn hiện (kèm một chấm nhỏ), bấm vào ra **trang chờ**
`<ComingSoon />` với thông báo "Chức năng đang phát triển và sẽ sớm hoàn thiện…".

Mặc định: **production → tắt (hiện trang chờ)**, **local/staging → bật (chạy đầy đủ)**.

| Cờ | Chi phối |
|---|---|
| `FEATURE_DOCUMENT_REQUESTS` | Route `/dashboard/requests/*`, nút CTA ở hero + bảng "Yêu cầu giấy tờ gần đây" ở trang chủ, và toàn bộ `/api/requests/*` (404 khi tắt) |
| `FEATURE_CIVIC_ACTIVITIES` | Route `/dashboard/sinh-hoat-cong-dan`, khối "Sinh hoạt công dân" ở trang chủ (BHYT chiếm trọn hàng); `civic_activities` trả mảng rỗng |

**Nguồn sự thật là backend** — `config/settings.py`, mặc định `not IS_PRODUCTION`
(suy từ `DJANGO_ENV`). Không phải flag phía frontend, nên sửa `sessionStorage`
hay gọi thẳng API đều không lách được: view đã tắt **404 ngay ở `initial()`**, và
dữ liệu chưa mở thì **không truy vấn**, không chỉ giấu ở giao diện.

Frontend đọc qua `GET /api/features/` (không cần auth, chỉ trả true/false):
- **Next.js** — hook `lib/features.ts::useFeatures()`, cache ở `sessionStorage`.
  Chưa biết cờ thì coi như **TẮT** (hiện spinner rồi ra trang chờ), để prod không
  chớp hiện tính năng chưa mở. Việc chặn nằm ở **một chỗ duy nhất**:
  `(dashboard)/layout.tsx` tra `featureForRoute(pathname)` rồi thay nội dung bằng
  `<ComingSoon />` — từng page KHÔNG tự kiểm tra.

### Thêm một tính năng đang chờ phát triển

1. Backend: thêm `FEATURE_X = env_bool("FEATURE_X", default=not IS_PRODUCTION)` vào
   `settings.py`, thêm khoá vào `core/api/views.py::feature_flags()`.
2. Frontend: thêm khoá vào `FeatureFlags` (`lib/types.ts`), rồi 1 dòng vào
   `FEATURE_META` + `FEATURE_ROUTES` trong `lib/features.ts`.
3. Xong — menu, chấm báo, trang chờ, tiêu đề topbar tự có. Không sửa gì thêm.

### Bật một tính năng trên prod

Thêm vào `backend/.env` rồi `sudo systemctl restart iuoss_hub`:

```bash
FEATURE_DOCUMENT_REQUESTS=True
FEATURE_CIVIC_ACTIVITIES=True
```

**Không cần build lại frontend** — cờ đọc lúc chạy qua API chứ không nhúng vào
bundle. Lưu ý: `useFeatures()` cache trong `sessionStorage`, nên SV đang mở sẵn
tab chỉ thấy thay đổi sau khi đóng tab, đăng xuất, hoặc mở tab mới.

### Xem thử trang chờ ở local

Local mặc định bật hết nên không thấy trang chờ. Muốn xem thì chạy backend với
biến môi trường tạm (không sửa `.env`):

```bash
cd backend
FEATURE_DOCUMENT_REQUESTS=False FEATURE_CIVIC_ACTIVITIES=False \
  ../.venv/Scripts/python.exe manage.py runserver 127.0.0.1:8002 --noreload
```

---

## 1. Authentication (LDAP)

**URL:** `POST /api/auth/login/`, `POST /api/auth/microsoft/*`  
**Files:** `core/auth.py`, `core/login_policy.py`, `core/api/views.py`

Sinh viên đăng nhập bằng tài khoản mạng nội bộ trường (MSSV + mật khẩu IU).  
Chi tiết luồng xác thực xem tại `docs/AUTH_FLOW.md`.

**Tính năng:**
- 2-bước LDAP bind (service account → user bind)
- Session tự hết hạn sau 8 giờ, cookie `hub_sessionid`
- Chống session fixation: `cycle_key()` sau login
- Nút "Quên mật khẩu" trỏ đến `https://ldap.hcmiu.edu.vn/iupwd/?action=sendtoken`

---

## 2. Dashboard (Trang chủ)

**URL:** `/dashboard` (Next.js) ← `GET /api/me/`  
**Files:** `core/api/views.py`, `frontend/app/(dashboard)/dashboard/page.tsx`

### Thông tin sinh viên

Lấy từ bảng `students` (shared DB, read-only) theo `student_id` lưu trong session.  
Hiển thị dạng stat cards: MSSV, Khoa, Bậc đào tạo, Trạng thái học vụ.

### Bảo hiểm y tế

**Model:** `students.HealthInsuranceCard` → bảng `student_health_insurance_cards`  
Chỉ lấy bản ghi `is_current=True` của sinh viên (đây là **thẻ đang dùng**, không phải "thẻ còn hạn").  
Hiển thị: Mã BHYT, Nơi đăng ký KCB, Hạn thẻ (`valid_until`).

**Quy tắc "còn hiệu lực":** trạng thái còn hiệu lực hay đã hết hạn **được tính ở phía Hub dựa trên `valid_until` so với ngày hiện tại** — KHÔNG suy ra từ `is_current`:

- `valid_until` là NULL → không xác định được hạn → coi là "Chưa có thông tin hạn" (không khẳng định còn hiệu lực).
- `valid_until >= hôm nay` → **Còn hiệu lực**.
- `valid_until < hôm nay` → **Hết hạn**.

> Lý do: `is_current` chỉ đánh dấu đâu là thẻ hiện hành đang dùng, không phản ánh việc thẻ đó còn hạn. Xem thêm quy ước cột `is_current` ở `dashboard_iuoss/docs/ARCHITECTURE.md`.

**Triển khai:** `components/health-insurance.tsx` — `validityState()` / `daysLeft()` /
`<HealthValidityBadge>`, dùng CHUNG cho trang chủ và trang BHYT. Badge: neutral
"Chưa có thông tin hạn" / success "Còn hiệu lực" / danger "Hết hạn". So sánh chuỗi
`YYYY-MM-DD` (lexicographic = chronological) nên không lệch múi giờ.

### Trang Bảo hiểm y tế (chi tiết)

**URL:** `/dashboard/bao-hiem-y-te` · **API:** `GET /api/health-insurance/` →
`{ current, history[] }` (`core/api/views.py::HealthInsuranceView`).
Không bị cờ tính năng chi phối — luôn bật, kể cả production.

Bố cục: panel "Thẻ bảo hiểm y tế" (badge hiệu lực ở header) → khối tint nổi bật
**Mã thẻ BHYT** + khoảng "Giá trị sử dụng" → dòng nhắc khi còn ≤60 ngày → 3 dòng
Mã số BHXH / Nơi đăng ký KCB / Diện đăng ký. Dưới là panel "Các thẻ trước đây"
(chỉ hiện khi có thẻ `is_current=0`). Trang chủ có link "Xem chi tiết" trỏ sang.

**Cột/bảng DB mà trang này ĐỌC** — `social_insurance_code`, `registration_type_id`,
`valid_from` (ngoài các cột cũ), cộng 2 bảng danh mục
`student_health_insurance_registration_types` và `hospitals`. Model `managed=False`
nên các cột này vào MỌI câu SELECT thẻ BHYT: **thiếu một cột/bảng trên prod là
hỏng cả trang chủ Hub**, không riêng trang BHYT. Kiểm tra trước khi deploy:

```sql
SHOW COLUMNS FROM student_health_insurance_cards
  LIKE 'social_insurance_code';           -- phải có 1 dòng
SHOW COLUMNS FROM student_health_insurance_cards
  LIKE 'registration_type_id';            -- phải có 1 dòng
SHOW COLUMNS FROM student_health_insurance_cards LIKE 'valid_from';
SELECT COUNT(*) FROM student_health_insurance_registration_types;  -- phải > 0
SELECT COUNT(*) FROM hospitals;                                    -- phải > 0
-- Bao nhiêu thẻ tra được TÊN cơ sở KCB (local: 12.120 khớp / 0 lệch):
SELECT SUM(h.code IS NOT NULL) khop, SUM(c.hospital_code<>'' AND h.code IS NULL) lech
FROM student_health_insurance_cards c
LEFT JOIN hospitals h ON h.code = c.hospital_code
WHERE c.hospital_code IS NOT NULL AND c.hospital_code <> '';
```

**Nơi đăng ký KCB hiển thị TÊN cơ sở, mã xuống dòng phụ.** Tên tra từ danh mục
`hospitals` — **không có FK**, nối ở tầng hiển thị: view gom `{code: name}` bằng
MỘT truy vấn rồi truyền qua serializer context (`hospital_names`), tránh N+1.
Mã không có trong danh mục → `hospital_name = null` → frontend hiển thị **mã
thô**, tuyệt đối không bịa tên. **Không bao giờ thêm dòng vào `hospitals`** để
"cứu" mã lệch — đó là dữ liệu tham chiếu từ nguồn ngoài, xem `dashboard_iuoss/docs/CATALOGS.md`.

**Độ phủ dữ liệu (đo trên local 2026-08-09, 21.428 thẻ)** — trang phải chịu được
nhiều ô trống: thiếu mã số BHXH 74,7% · thiếu diện đăng ký 67,6% · thiếu
`valid_from` 73,8% · thiếu nơi KCB 43,4% · thiếu `valid_until` 41,3%. Mã thẻ chỉ
thiếu 2,3% nên khối tint phía trên gần như luôn có nội dung. Trong 56,6% thẻ CÓ
mã nơi KCB thì **100% tra được tên** (12.120 khớp / 0 lệch) — nên nhánh "chỉ hiện
mã thô" hiện chưa xảy ra ở local, vẫn giữ để phòng dữ liệu prod khác. Hiện **0
thẻ `is_current=0`** → panel lịch sử chưa bao giờ hiện, nhưng import BHYT của
Dashboard có sinh dòng đó nên vẫn giữ.

### Sinh hoạt công dân

**Model:** `students.CivicActivity` → bảng `student_civic_activities`  
Hiển thị tất cả hoạt động của sinh viên theo `activity_code` + `attempt_no`.  
Kết quả: `YES` (Đạt) / `NO` (Không đạt) / `UNKNOWN` (Chưa có kết quả).

> ⚠️ **Trên production đang hiện trang "đang phát triển"** — xem §0
> (`FEATURE_CIVIC_ACTIVITIES`). Trang riêng: `/dashboard/sinh-hoat-cong-dan`.

---

## 3. Yêu cầu giấy xác nhận

> ⚠️ **Trên production đang hiện trang "đang phát triển"** — xem §0. Toàn bộ mục
> này chỉ chạy khi `FEATURE_DOCUMENT_REQUESTS` bật (local/staging bật, prod tắt).

**Kênh chuẩn (Next.js + DRF API):**
- `GET /api/requests/other/form/` → `core/api/views.py::OtherRequestFormView` (prefill + purpose choices)
- `POST /api/requests/` (`request_type="other"`) → `RequestsView._create_other` (dựng `payload` snapshot)
- Frontend: `app/(dashboard)/dashboard/requests/other/page.tsx`, `lib/api.ts` (`otherForm`/`createOther`)
- Registry loại giấy: `core/documents.py`; prefill niên khóa/đào tạo: `students/timeline.py`

**Model:** `core.ConfirmationRequest` → bảng `hub_confirmation_requests` (có cột `payload` JSON).

### Loại giấy hỗ trợ

| Giá trị | Nhãn hiển thị | Form động (payload) |
|---|---|---|
| `enrollment` | Xác nhận đang học | (legacy) |
| `graduation` | Xác nhận tốt nghiệp | (legacy) |
| `deferment` | Hoãn nghĩa vụ quân sự | (legacy) |
| `other` | Xác nhận (lý do khác) | ✅ đã có (10 mục đích cố định) |

> Loại `other` prefill từ hồ sơ (view-only) + cho sửa DOB/CCCD (staff duyệt). Chi
> tiết contract `payload` + phía Dashboard: xem `dashboard_iuoss/docs/DOCUMENT_REQUESTS.md`.

### Trạng thái yêu cầu

| Giá trị | Nhãn | Badge |
|---|---|---|
| `pending` | Chờ xử lý | warning (vàng) |
| `processing` | Đang xử lý | info (xanh dương) |
| `done` | Hoàn thành | success (xanh lá) |
| `rejected` | Từ chối | danger (đỏ) |

### Luồng xử lý

```
Sinh viên tạo yêu cầu (Hub)
    │  POST /api/requests/  (payload snapshot cho loại 'other')
    │  Ghi vào hub_confirmation_requests (status = 'pending')
    ▼
Nhân viên CTSV (Dashboard — app `documents`)
    │  Xem/duyệt yêu cầu, duyệt sửa DOB/CCCD (ghi đè hồ sơ gốc)
    │  Cập nhật status + staff_note, sinh DOCX/PDF
    ▼
Sinh viên theo dõi trạng thái trên Dashboard (Hub)
```

**Đã tích hợp:** Dashboard app `documents` đọc + duyệt + sinh giấy từ bảng này (loại `other`). Các loại còn lại theo khung registry.

### Schema bảng

```sql
CREATE TABLE hub_confirmation_requests (
  id           BIGINT        NOT NULL AUTO_INCREMENT,
  student_id   BIGINT        NOT NULL,   -- soft ref → students.id
  ldap_uid     VARCHAR(64)   NOT NULL,
  request_type VARCHAR(64)   NOT NULL,
  purpose      VARCHAR(255)  NOT NULL,
  note         TEXT          NULL,
  payload      JSON          NULL,       -- dữ liệu theo từng loại giấy (snapshot + field SV sửa)
  status       VARCHAR(16)   NOT NULL DEFAULT 'pending',
  staff_note   TEXT          NULL,       -- phản hồi từ nhân viên CTSV
  created_at   DATETIME(6)   NOT NULL,
  updated_at   DATETIME(6)   NOT NULL,
  PRIMARY KEY (id),
  KEY idx_hcr_student_id (student_id),
  KEY idx_hcr_ldap_uid (ldap_uid),
  KEY idx_hcr_status (status)
);
```

---

## 3b. Khai báo thông tin ngoại trú

`/dashboard/khai-bao-ngoai-tru` — SV tự khai địa chỉ **thường trú + tạm trú** theo
danh mục hành chính 2025 (2 cấp: Tỉnh → Phường/Xã, **bỏ cấp quận/huyện**), đồng
thời đề xuất sửa CCCD / email cá nhân / SĐT.

| Thành phần | File |
|---|---|
| API `GET/POST /api/offcampus/` | `core/api/views.py::OffCampusDeclarationView` |
| Nghiệp vụ | `core/offcampus.py` |
| Ghi địa chỉ | `core/address_service.py` + `core/address_validators.py` |
| Đề xuất sửa hồ sơ | `core/profile_changes.py` → bảng `hub_profile_change_requests` |
| Giao diện | `frontend/app/(dashboard)/dashboard/khai-bao-ngoai-tru/` |

Điểm cần nhớ:

- **Tất cả ghi thẳng, không cần duyệt** — địa chỉ lẫn CCCD/email/SĐT. Mỗi lần sửa
  ghi một dòng nhật ký `cũ → mới` vào `hub_profile_change_requests` (Hub không ghi
  AuditLog nên đó là dấu vết duy nhất).
- **CCCD gồm 3 phần** (số thẻ + nơi cấp + ngày cấp) đi cùng nhau; đổi CCCD ghi
  **dòng mới** trong `student_identity_documents`, dòng cũ hạ `is_current=0`.
- **Mỗi SV chỉ khai một lần.** Khai xong form khóa; màn hình xem lại có nút
  *"Yêu cầu chỉnh sửa lại"* (`POST /api/offcampus/request-reopen/`) để xin phòng
  CTSV mở lại. Nhân viên mở lại từng người hoặc cho toàn bộ trên Dashboard.
- Nhánh "tạm trú tại TP.HCM" → **server tự ép `province_code='79'`**, không tin
  giá trị client gửi lên.
- `address_service.py` và `address_validators.py` **có bản sao ở Dashboard**
  (`dashboard_iuoss/students/`). Sửa một bên phải sửa bên kia — chúng lệch đúng
  một dòng lọc `VnWard` vì hai repo khai model khác nhau.
- **Tài liệu đầy đủ (mô hình địa chỉ, rule validate, bẫy):**
  `dashboard_iuoss/docs/OFFCAMPUS.md` — đọc file đó trước khi sửa.

---

## 4. Logging

**Files:** `config/settings.py` (LOGGING config), `core/auth.py`, `core/api/views.py`

Hai file log riêng biệt, tự rotate khi đạt 5MB (giữ 5 bản backup):

### `logs/auth.log` — Authentication actions

Format: `YYYY-MM-DD HH:MM:SS | LEVEL | ACTION | uid=... | ...`

| Action key | Mức | Ý nghĩa |
|---|---|---|
| `LOGIN_ATTEMPT` | INFO | Bắt đầu đăng nhập |
| `LOGIN_SUCCESS` | INFO | Đăng nhập thành công (kèm student_id, linked, ip) |
| `LOGIN_FAIL` | WARNING | Đăng nhập thất bại (sau LDAP trả về None) |
| `LOGOUT` | INFO | Đăng xuất (kèm ip) |
| `LDAP_START` | DEBUG | Bắt đầu gọi LDAP |
| `LDAP_SVC_BIND_OK` | DEBUG | Service account bind thành công |
| `LDAP_SVC_BIND_FAIL` | ERROR | Service account bind thất bại |
| `LDAP_USER_FOUND` | DEBUG | Tìm thấy DN của user |
| `LDAP_USER_NOTFOUND` | WARNING | Không tìm thấy uid trong LDAP |
| `LDAP_AUTH_OK` | INFO | User bind xác minh password thành công |
| `LDAP_WRONG_PASS` | WARNING | Sai mật khẩu |
| `LDAP_AUTH_FAIL` | ERROR | Lỗi LDAP không xác định |
| `CONFIRMATION_REQUEST` | INFO | Sinh viên tạo yêu cầu giấy xác nhận |

### `logs/app.log` — Django errors

Django warnings và errors (500, DB lỗi, template lỗi, v.v.).

---

## 5. Layout & UI

### Ô hỗ trợ kỹ thuật (nổi, mọi trang)

`frontend/components/support-widget.tsx`, mount ở `app/layout.tsx` → có mặt trên
**mọi trang, kể cả màn hình đăng nhập**. Nút tròn góc dưới-phải, bấm mới mở panel
chứa thông tin liên hệ chuyên viên (điện thoại/Zalo + email, có nút chép).

Sửa nội dung liên hệ: hằng `SUPPORT` ở đầu file đó (đổi số thì sửa cả `phone`
hiển thị lẫn `phoneRaw` dùng cho link `tel:`/`zalo.me`).

Ràng buộc UX cố ý — đừng "cải tiến" ngược lại: không tự bật, không đếm ngược,
không nhắc lại; `z-30` để nằm DƯỚI overlay (z-40) và sidebar (z-50) nên menu
mobile mở ra là nó bị che, không tranh chỗ. Số điện thoại chỉ render sau khi bấm
nên không nằm trong HTML tĩnh.

### Khung trang

Layout do Next.js dựng: `frontend/app/(dashboard)/layout.tsx` (sidebar + topbar +
chặn theo cờ tính năng). Quy ước trình bày và design token xem
[`frontend/DESIGN.md`](../frontend/DESIGN.md).

**Thêm trang mới:** tạo `app/(dashboard)/dashboard/<slug>/page.tsx`, thêm mục vào
sidebar trong `layout.tsx`, và khai cờ trong `featureForRoute()` nếu tính năng
chưa mở.

---

## 6. URL routing

| URL | View | Auth | Mô tả |
|---|---|---|---|
> Django **chỉ phục vụ `/api/`**. Mọi URL giao diện (`/`, `/login`, `/dashboard/…`)
> do Next.js đảm nhiệm; gọi thẳng vào Gunicorn `:8002` ở các đường đó sẽ trả **404**.

| `/api/features/` | `FeaturesView` | ❌ Public | Cờ tính năng cho frontend (xem §0) |
| `/api/health-insurance/` | `HealthInsuranceView` | ✅ Required | Thẻ BHYT hiện hành + lịch sử (§2) |
