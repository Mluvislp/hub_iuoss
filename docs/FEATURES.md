# IUOSS Hub — Tính năng đã implement

> Tài liệu này mô tả chi tiết các tính năng đã có trong hệ thống, cách hoạt động và cách mở rộng.

---

## 1. Authentication (LDAP)

**URL:** `/login/`, `/logout/`  
**Files:** `core/auth.py`, `core/views.py`, `core/session.py`, `core/decorators.py`

Sinh viên đăng nhập bằng tài khoản mạng nội bộ trường (MSSV + mật khẩu IU).  
Chi tiết luồng xác thực xem tại `docs/AUTH_FLOW.md`.

**Tính năng:**
- 2-bước LDAP bind (service account → user bind)
- Session tự hết hạn sau 8 giờ, cookie `hub_sessionid`
- Chống session fixation: `cycle_key()` sau login
- Nút "Quên mật khẩu" trỏ đến `https://ldap.hcmiu.edu.vn/iupwd/?action=sendtoken`

---

## 2. Dashboard (Trang chủ)

**URL:** `/`  
**Files:** `core/views.py` → `home_view()`, `core/templates/core/home.html`

### Thông tin sinh viên

Lấy từ bảng `students` (shared DB, read-only) theo `student_id` lưu trong session.  
Hiển thị dạng stat cards: MSSV, Khoa, Bậc đào tạo, Trạng thái học vụ.

### Bảo hiểm y tế

**Model:** `students.HealthInsuranceCard` → bảng `student_health_insurance_cards`  
Chỉ lấy bản ghi `is_current=True` của sinh viên.  
Hiển thị: Mã BHYT, Nơi đăng ký KCB, Hạn thẻ.

### Sinh hoạt công dân

**Model:** `students.CivicActivity` → bảng `student_civic_activities`  
Hiển thị tất cả hoạt động của sinh viên theo `activity_code` + `attempt_no`.  
Kết quả: `YES` (Đạt) / `NO` (Không đạt) / `UNKNOWN` (Chưa có kết quả).

---

## 3. Yêu cầu giấy xác nhận

**URL:** `/requests/new/`  
**Files:** `core/views.py` → `confirmation_request_create_view()`, `core/templates/core/confirmation_request_form.html`  
**Model:** `core.ConfirmationRequest` → bảng `hub_confirmation_requests`

### Loại giấy hỗ trợ

| Giá trị | Nhãn hiển thị |
|---|---|
| `enrollment` | Xác nhận đang học |
| `graduation` | Xác nhận tốt nghiệp |
| `deferment` | Hoãn nghĩa vụ quân sự |
| `other` | Khác |

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
    │  POST /requests/new/
    │  Ghi vào hub_confirmation_requests (status = 'pending')
    ▼
Nhân viên CTSV (Dashboard — tương lai)
    │  Xem danh sách hub_confirmation_requests
    │  Cập nhật status + staff_note
    ▼
Sinh viên theo dõi trạng thái trên Dashboard (Hub)
```

**Lưu ý:** Dashboard chưa tích hợp đọc bảng `hub_confirmation_requests`. Đây là bước roadmap tiếp theo.

### Schema bảng

```sql
CREATE TABLE hub_confirmation_requests (
  id           BIGINT        NOT NULL AUTO_INCREMENT,
  student_id   BIGINT        NOT NULL,   -- soft ref → students.id
  ldap_uid     VARCHAR(64)   NOT NULL,
  request_type VARCHAR(64)   NOT NULL,
  purpose      VARCHAR(255)  NOT NULL,
  note         TEXT          NULL,
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

## 4. Logging

**Files:** `config/settings.py` (LOGGING config), `core/auth.py`, `core/views.py`

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

**File:** `core/templates/core/base.html`

Tất cả trang (trừ login) extend từ `base.html`. Cấu trúc:

```
sidebar (fixed, 240px)        main-wrapper
  ├─ Brand logo                 ├─ topbar (sticky, 56px)
  ├─ Nav sections               │    breadcrumb title + MSSV badge
  │   ├─ Tổng quan              └─ content-area (padding 24px)
  │   ├─ Dịch vụ                     {% block content %}
  │   └─ Sắp ra mắt (disabled)
  └─ User info + Logout
```

**Thêm trang mới:**
1. Tạo template mới `core/templates/core/my_page.html`
2. Extend `base.html`, set `{% block nav_xxx %}active{% endblock %}`
3. Thêm nav item vào `base.html` sidebar
4. Thêm view + URL vào `core/views.py` + `core/urls.py`

**Thêm nav item vào sidebar** (trong `base.html`):
```html
<div class="nav-item">
  <a href="{% url 'core:my_url_name' %}"
     class="nav-link {% block nav_xxx %}{% endblock %}">
    <i class="bi bi-icon-name"></i> Tên chức năng
  </a>
</div>
```

---

## 6. URL routing

| URL | View | Auth | Mô tả |
|---|---|---|---|
| `/` | `home_view` | ✅ Required | Dashboard chính |
| `/login/` | `login_view` | ❌ Public | Trang đăng nhập |
| `/logout/` | `logout_view` | ❌ Public | Đăng xuất |
| `/requests/new/` | `confirmation_request_create_view` | ✅ Required | Tạo yêu cầu giấy xác nhận |
