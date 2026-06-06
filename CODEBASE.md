# IUOSS Hub — Hướng dẫn đọc codebase

> File này dành cho AI assistant và developer mới. Đọc trước khi làm bất kỳ việc gì với project.

---

## Dự án là gì

Student portal cho sinh viên Đại học Quốc tế (HCMIU) — nơi sinh viên đăng nhập bằng tài khoản mạng nội bộ trường (LDAP) để theo dõi yêu cầu, xem thông báo và tương tác với Phòng Công tác Sinh viên (CTSV).

**Production:** `https://hub.iuoss.com`

**Quan hệ với hệ thống khác:**
- **`iuoss.com`** — WordPress site, nơi sinh viên có thể gửi ticket, dùng cùng LDAP server
- **`dashboard.iuoss.com`** — Django app nội bộ dành cho nhân viên OSS (repo riêng: `iuoss_dashboard`)
- **Cùng MySQL database** `iuoss_student_data` với dashboard — không có API trung gian

**Stack:** Django 5.2 · MySQL 8.4 · LDAP (ldap3) · Gunicorn · Bootstrap 5

---

## Cấu trúc thư mục

```
iuoss_hub/
│
├── CODEBASE.md               ← file này
├── docs/
│   ├── README.md             ← tổng quan + hướng dẫn dev local
│   ├── AUTH_FLOW.md          ← luồng xác thực LDAP chi tiết
│   └── SERVER_SETUP.md       ← triển khai production trên appctsv
│
├── config/                   ← Django project config
│   ├── settings.py           ← toàn bộ cấu hình (đọc từ .env)
│   ├── urls.py               ← URL root (mount core.urls)
│   └── wsgi.py
│
├── core/                     ← app chính: auth, session, views
│   ├── auth.py               ← verify_ldap() — kết nối LDAP trường
│   ├── session.py            ← đọc/ghi student session (không dùng Django auth)
│   ├── decorators.py         ← @hub_login_required
│   ├── models.py             ← HubStudent (bảng hub_students)
│   ├── views.py              ← login_view, logout_view, home_view
│   ├── urls.py               ← routes: /, /login/, /logout/
│   └── templates/core/
│       ├── login.html
│       └── home.html
│
├── students/                 ← read-only mirror từ shared DB
│   └── models.py             ← Student, Department, DegreeLevel, StudentStatus (managed=False)
│
├── docs/schema.sql           ← SQL tạo bảng hub_students
├── .env.example
└── requirements.txt
```

---

## Điểm đặc biệt — Đọc kỹ trước khi sửa code

### 1. Không dùng `django.contrib.auth` cho student login

Đây là điểm **quan trọng nhất** của project. Authentication hoàn toàn tự xây:

| Component | File | Vai trò |
|---|---|---|
| Xác thực LDAP | `core/auth.py` | Gọi LDAP server trường, 2-bước bind |
| Quản lý session | `core/session.py` | Đọc/ghi `request.session["hub_student"]` |
| Bảo vệ views | `core/decorators.py` | `@hub_login_required` |
| Lưu login history | `core/models.py` | `HubStudent` model → bảng `hub_students` |

`django.contrib.auth` **không có** trong `INSTALLED_APPS`. Không dùng `request.user`, không dùng `@login_required`, không dùng `django.contrib.auth.login()`.

**Thay thế:**
```python
# Kiểm tra đã login chưa
from core.session import current_student
student_session = current_student(request)  # None nếu chưa login

# Bảo vệ view
from core.decorators import hub_login_required
@hub_login_required
def my_view(request): ...

# Dữ liệu trong session
student_session = current_student(request)
# → {"ldap_uid": "BABAWE21603", "student_id": 12345,
#    "student_code": "BABAWE21603", "full_name": "Nguyễn Văn A"}
```

### 2. Quản lý schema DB — thủ công

Tất cả custom app models đều `managed=False`. Migrations bị tắt:

```python
# config/settings.py
MIGRATION_MODULES = {
    "core": None,
    "students": None,
}
```

**Ngoại lệ:** `django.contrib.sessions` vẫn dùng migration bình thường — bảng `django_session` được tạo qua `manage.py migrate`.

**Quy tắc:**
- Không chạy `makemigrations` cho `core` và `students`
- Thay đổi schema hub → viết SQL → chạy thủ công → cập nhật `docs/schema.sql`
- SQL tạo bảng hub xem tại `docs/schema.sql`

### 3. `students` app — read-only

App `students/` chỉ khai báo models để đọc dữ liệu từ shared DB. **Không ghi** vào các bảng này từ hub.

Các bảng đang dùng: `students`, `departments`, `degree_levels`, `student_statuses`.

Nếu cần thêm trường từ shared DB:
1. Thêm field vào model trong `students/models.py`
2. Field phải tồn tại trong DB (kiểm tra với dashboard team)
3. Không cần migration

### 4. Session cookie tách biệt với dashboard

Cookie của hub đặt tên `hub_sessionid` (không phải `sessionid` mặc định của Django) để tránh xung đột nếu cả hai domain cùng parent `.iuoss.com`.

### 5. LDAP — 2-bước bind

`verify_ldap()` trong `core/auth.py` thực hiện 2 bước:
1. Bind bằng **service account** (`cn=ctsv`) để tìm DN của user
2. Bind lại bằng **DN của user + password** để xác minh

Không bao giờ gửi password qua search filter. `_ldap_escape()` escape ký tự đặc biệt tránh LDAP injection.

---

## Luồng nghiệp vụ tóm tắt

```
Sinh viên nhập uid + password
    │
    ▼ core/auth.py → verify_ldap()
LDAP Server (ldap.hcmiu.edu.vn)
    │  OK → trả uid, mail, display_name
    │  FAIL → báo lỗi
    ▼
core/views.py → login_view()
    │  Tìm Student trong shared DB theo uid = current_student_code
    │  Tạo/cập nhật HubStudent (hub_students table)
    │  Set session: hub_student = {ldap_uid, student_id, student_code, full_name}
    ▼
Redirect → home_view() (và các views tiếp theo)
```

---

## Biến môi trường quan trọng

| Biến | Mô tả |
|---|---|
| `SECRET_KEY` | Django secret key — phải đổi trong production |
| `DEBUG` | `False` trong production |
| `ALLOWED_HOSTS` | Bao gồm `hub.iuoss.com` và IP LAN |
| `DB_*` | Kết nối MySQL — **cùng DB với dashboard** |
| `LDAP_SERVER_URI` | `ldap://ldap.hcmiu.edu.vn:389` |
| `LDAP_BIND_DN` | `cn=ctsv,dc=hcmiu,dc=edu,dc=vn` |
| `LDAP_BIND_PASSWORD` | Password plain text của service account CTSV |

---

## Đọc tài liệu theo mục đích

| Muốn hiểu về... | Đọc file |
|---|---|
| Setup môi trường dev local | `docs/README.md` |
| Luồng LDAP auth chi tiết | `docs/AUTH_FLOW.md` |
| Triển khai production (appctsv) | `docs/SERVER_SETUP.md` |
| Schema các bảng hub | `docs/schema.sql` |
| Cấu hình Django | `config/settings.py` |
| Logic xác thực LDAP | `core/auth.py` |
| Quản lý session | `core/session.py` + `core/decorators.py` |
| Views và URL routing | `core/views.py` + `core/urls.py` |
| Models shared DB | `students/models.py` |
