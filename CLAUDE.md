# CLAUDE.md — Context nhanh cho Claude Code (Monorepo)

> Đọc file này trước. Sau đó đọc `CODEBASE.md` để hiểu sâu hơn.

---

## Đây là dự án gì

`iuoss_hub` là **monorepo** cho student portal tại `hub.iuoss.com` — nơi sinh viên HCMIU đăng nhập bằng tài khoản mạng trường (LDAP) để xem hồ sơ và theo dõi yêu cầu với Phòng CTSV.

```
hub_iuoss/               ← monorepo root (Claude Code mở ở đây)
├── backend/             ← Django REST API  (Python 3.12 + Django 5.2)
├── frontend/            ← Next.js 14       (TypeScript + Tailwind)
├── docs/                ← tài liệu chung
├── deploy.sh            ← script deploy lên appctsv
├── CLAUDE.md            ← file này
└── CODEBASE.md          ← kiến trúc chi tiết
```

**Repo này là 1 trong 2 Django projects của hệ thống IUOSS:**

| Repo | Domain | Người dùng | Stack |
|---|---|---|---|
| `iuoss_hub` ← repo này | `hub.iuoss.com` | Sinh viên | Django API + Next.js |
| `dashboard_iuoss` | `dashboard.iuoss.com` | Nhân viên OSS | Django (monolith) |

Cả hai dùng chung **MySQL database** `iuoss_student_data`. Không có API giữa 2 app — đọc/ghi trực tiếp vào DB.

---

## Trạng thái hiện tại

### Backend (`backend/`) — Django REST API

- [x] LDAP authentication hoàn toàn tùy chỉnh — không dùng `django.contrib.auth`
- [x] Session management: `core/session.py`, cookie `hub_sessionid`
- [x] Decorator `@hub_login_required`
- [x] Logging phân tầng: `backend/logs/auth.log` + `backend/logs/app.log`
- [x] Sidebar layout Django templates còn dùng tạm trong giai đoạn chuyển đổi
- [x] Dashboard: 4 stat cards + BHYT + sinh hoạt công dân + yêu cầu giấy tờ
- [x] Models read-only: `Student`, `Department`, `DegreeLevel`, `StudentStatus`, `HealthInsuranceCard`, `CivicActivity`
- [x] Bảng `hub_confirmation_requests` — form tạo, danh sách theo dõi
- [ ] **REST API endpoints** — chưa có (roadmap gần nhất)

### Frontend (`frontend/`) — Next.js 14

- [x] Cấu trúc App Router: `app/(auth)/login`, `app/(dashboard)/`
- [x] Middleware bảo vệ route (kiểm tra `hub_token` cookie)
- [x] Login page đẹp — split-screen, gradient branding
- [x] Dashboard layout với sidebar + topbar responsive
- [x] Dashboard home: stat cards, BHYT, sinh hoạt công dân, confirmation requests
- [x] Form tạo yêu cầu giấy xác nhận — suggestions, success state
- [x] TypeScript types đầy đủ (`lib/types.ts`)
- [x] API client cấu trúc sẵn (`lib/api.ts`) — chờ backend endpoints
- [ ] Kết nối thật với Django API — chờ DRF endpoints

---

## Những điều QUAN TRỌNG cần nhớ

### 1. Backend: Không dùng `django.contrib.auth`

`django.contrib.auth` **không có** trong `INSTALLED_APPS`.

```python
# Thay thế:
from core.session import current_student
from core.decorators import hub_login_required

student_session = current_student(request)
# → {"ldap_uid", "student_id", "student_code", "full_name"}
```

### 2. Backend: Không chạy `makemigrations`

```python
# backend/config/settings.py
MIGRATION_MODULES = {"core": None, "students": None}
```
Thay đổi schema → viết SQL → chạy thủ công → cập nhật `docs/schema.sql`.

### 3. Backend: `students/` app là read-only

Chỉ đọc từ shared DB. **Không ghi** vào `students`, `departments`, hay bất kỳ bảng nào Dashboard sở hữu. Hub chỉ ghi vào bảng `hub_*`.

### 4. Frontend: API chưa có — dùng mock data khi dev

`lib/api.ts` cấu trúc sẵn nhưng endpoints Django chưa tồn tại. Khi dev frontend, dùng mock data tạm hoặc hardcode trực tiếp trong component.

### 5. Frontend: Auth dùng cookie `hub_token`

Middleware đọc cookie `hub_token`. Login page set cookie này sau khi API trả về JWT. `lib/auth.ts` quản lý việc đọc/ghi/xóa cookie.

---

## Cấu trúc file quan trọng

### Backend

```
backend/
  config/settings.py         ← LDAP config, SESSION config, LOGGING, MIGRATION_MODULES
  config/urls.py             ← URL root (mount core.urls)
  core/auth.py               ← verify_ldap() — LDAP 2-bước bind
  core/session.py            ← set/get/clear student session
  core/decorators.py         ← @hub_login_required
  core/models.py             ← HubStudent, ConfirmationRequest
  core/views.py              ← login_view, logout_view, home_view, confirmation_request_create_view
  core/urls.py               ← routes: /, /login/, /logout/, /requests/new/
  core/templates/core/       ← Django templates (tạm dùng, sẽ thay bằng Next.js)
  students/models.py         ← read-only models từ shared DB
  logs/auth.log              ← log login/logout/LDAP
  logs/app.log               ← log Django warnings/errors
```

### Frontend

```
frontend/
  app/(auth)/login/page.tsx        ← trang đăng nhập split-screen
  app/(dashboard)/layout.tsx       ← layout sidebar + topbar
  app/(dashboard)/page.tsx         ← dashboard chính
  app/(dashboard)/requests/new/page.tsx  ← form yêu cầu giấy xác nhận
  components/layout/sidebar.tsx    ← sidebar responsive (client component)
  components/layout/topbar.tsx     ← topbar sticky
  lib/api.ts                       ← API client (fetch wrapper + JWT)
  lib/auth.ts                      ← quản lý token cookie
  lib/types.ts                     ← TypeScript types đầy đủ
  lib/utils.ts                     ← cn(), formatDate(), ...
  middleware.ts                    ← bảo vệ route dashboard, redirect nếu chưa login
  next.config.ts                   ← rewrite /api/* → Django :8002
  tailwind.config.ts               ← Tailwind theme
  ecosystem.config.js              ← PM2 config cho production
```

---

## Biến môi trường

### Backend (`backend/.env`)

```env
DJANGO_ENV=production          # local | staging | production — quyết định DEBUG + security
SECRET_KEY=<random>
ALLOWED_HOSTS=hub.iuoss.com,127.0.0.1
FRONTEND_ORIGINS=https://hub.iuoss.com   # dùng cho CORS + CSRF (khai báo 1 nơi)

DB_NAME=iuoss_student_data
DB_USER=iuoss_app
DB_PASSWORD=<password>
DB_HOST=127.0.0.1
DB_PORT=3306

LDAP_SERVER_URI=ldap://ldap.hcmiu.edu.vn:389
LDAP_BIND_DN=cn=ctsv,dc=hcmiu,dc=edu,dc=vn
LDAP_BIND_PASSWORD=<plain text>
LDAP_SEARCH_BASE=dc=hcmiu,dc=edu,dc=vn
LDAP_USER_ATTR=uid
```

> `DJANGO_ENV` là nguồn sự thật: `local` → DEBUG=True; `staging`/`production` → DEBUG=False
> + bật secure cookie, `SECURE_PROXY_SSL_HEADER`, `CSRF_TRUSTED_ORIGINS` (từ `FRONTEND_ORIGINS`).
> Xem đầy đủ ở `backend/.env.example`.

### Frontend (`frontend/.env.local`)

```env
# CHỈ dùng khi DEV. Browser gọi thẳng Django (CORS đã cấu hình cho localhost:3000).
# KHÔNG tạo file này trên server production — NEXT_PUBLIC_* bị đông cứng vào bundle
# lúc build. Để trống → API_BASE='/api' → Nginx định tuyến /api/ → Gunicorn :8002.
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000/api
```

---

## Tài liệu đầy đủ

| Muốn biết | Đọc |
|---|---|
| Kiến trúc tổng thể | `CODEBASE.md` |
| Tính năng đã implement | `docs/FEATURES.md` |
| Quan hệ với dashboard + WordPress | `docs/ECOSYSTEM.md` |
| LDAP flow chi tiết | `docs/AUTH_FLOW.md` |
| **Cài trên server appctsv (runbook cho AI thực thi)** | **`docs/DEPLOY_APPCTSV.md`** |
| Deploy lên server (tham khảo cấu hình) | `docs/SERVER_SETUP.md` |
| Schema bảng hub_* | `docs/schema.sql` |
| Setup local | `docs/README.md` |
