# IUOSS Hub — Hướng dẫn đọc codebase (Monorepo)

> File này dành cho AI assistant và developer mới. Đọc trước khi làm bất kỳ việc gì với project.

---

## Dự án là gì

Student portal cho sinh viên Đại học Quốc tế (HCMIU) — đăng nhập bằng tài khoản mạng nội bộ trường (LDAP) để theo dõi yêu cầu, xem hồ sơ và tương tác với Phòng CTSV.

**Production:** `https://hub.iuoss.com`

**Kiến trúc mới (monorepo):**

```
hub_iuoss/
├── backend/    ← Django 5.2 REST API  (Python)
├── frontend/   ← Next.js 14 SPA       (TypeScript + Tailwind)
├── docs/       ← tài liệu chung
└── deploy.sh   ← script deploy
```

**Stack:**

| Tầng | Technology |
|---|---|
| Backend API | Django 5.2 + Django REST Framework (roadmap) |
| LDAP auth | ldap3 2.x |
| WSGI server | Gunicorn :8002 |
| Frontend | Next.js 14 (App Router) + TypeScript |
| CSS | Tailwind CSS 3.x |
| Node server | PM2 :3000 |
| Database | MySQL 8.4 (shared với dashboard_iuoss) |
| Reverse proxy | Nginx (Cloudflare Tunnel → Nginx → Gunicorn/Next.js) |

---

## Cấu trúc thư mục đầy đủ

```
hub_iuoss/
│
├── backend/                     ← Django project
│   ├── config/
│   │   ├── settings.py          ← tất cả cấu hình (DB, LDAP, SESSION, LOGGING)
│   │   ├── urls.py              ← URL root
│   │   └── wsgi.py
│   ├── core/                    ← app chính: auth, models hub, API
│   │   ├── auth.py              ← verify_ldap() — 2-bước bind
│   │   ├── login_policy.py      ← check_login() — ai được vào cổng
│   │   ├── models.py            ← HubStudent, ConfirmationRequest
│   │   └── api/                 ← toàn bộ endpoint DRF (mount dưới /api/)
│   ├── students/
│   │   └── models.py            ← read-only: Student, Dept, Degree, Status, BHYT, CivicActivity
│   ├── logs/
│   │   ├── auth.log             ← login/logout/LDAP events (rotate 5MB×5)
│   │   └── app.log              ← Django errors
│   ├── manage.py
│   ├── requirements.txt
│   └── .env.example
│
├── frontend/                    ← Next.js project
│   ├── app/
│   │   ├── layout.tsx           ← root layout (Inter font, globals.css)
│   │   ├── page.tsx             ← redirect → /dashboard
│   │   ├── globals.css          ← Tailwind directives + custom CSS
│   │   ├── (auth)/
│   │   │   └── login/
│   │   │       └── page.tsx     ← login page split-screen
│   │   └── (dashboard)/
│   │       ├── layout.tsx       ← sidebar + topbar layout (client)
│   │       ├── page.tsx         ← dashboard chính
│   │       └── requests/
│   │           └── new/
│   │               └── page.tsx ← form tạo yêu cầu giấy tờ
│   ├── components/
│   │   └── layout/
│   │       ├── sidebar.tsx      ← sidebar responsive (client component)
│   │       └── topbar.tsx       ← topbar sticky
│   ├── lib/
│   │   ├── api.ts               ← API client (fetch wrapper + JWT bearer)
│   │   ├── auth.ts              ← quản lý hub_token cookie
│   │   ├── types.ts             ← TypeScript interfaces đầy đủ
│   │   └── utils.ts             ← cn(), formatDate(), getInitials()
│   ├── middleware.ts             ← route protection (kiểm tra hub_token cookie)
│   ├── next.config.mjs          ← KHÔNG rewrite /api/ — Nginx lo (xem §7)
│   ├── tailwind.config.ts       ← theme (sidebar colors, font)
│   ├── tsconfig.json            ← TypeScript config (@/* alias)
│   ├── package.json
│   ├── ecosystem.config.js      ← PM2 config (production)
│   └── .env.example
│
├── docs/
│   ├── ECOSYSTEM.md             ← mối liên hệ với dashboard + WordPress
│   ├── FEATURES.md              ← tính năng đã implement
│   ├── AUTH_FLOW.md             ← luồng LDAP auth chi tiết
│   ├── SERVER_SETUP.md          ← triển khai production (appctsv)
│   ├── README.md                ← setup local dev
│   └── schema.sql               ← SQL tạo bảng hub_*
│
├── deploy.sh                    ← deploy backend / frontend / all
├── .gitignore                   ← ignore cho cả Python và Node
├── CLAUDE.md                    ← context nhanh cho AI
└── CODEBASE.md                  ← file này
```

---

## Điểm đặc biệt — Đọc kỹ trước khi sửa code

### 1. Backend: Không dùng `django.contrib.auth`

Đây là điểm **quan trọng nhất**. Authentication hoàn toàn tự xây:

| Component | File | Vai trò |
|---|---|---|
| Xác thực LDAP | `backend/core/auth.py` | 2-bước bind: service account → user bind |
| Chính sách vào cổng | `backend/core/login_policy.py` | `check_login()` — trạng thái SV, mã cũ |
| Phát token | `backend/core/api/views.py` | `issue_session()` → JWT claim `ldap_uid` |
| Lưu login history | `backend/core/models.py` | `HubStudent` → bảng `hub_students` |

**Không** có `django.contrib.auth` trong `INSTALLED_APPS`. Không dùng `request.user`,
`@login_required`, `auth.login()`. Danh tính lấy từ **JWT**, không phải session cookie.

### 2. Backend: Quản lý schema DB thủ công

```python
# backend/config/settings.py
MIGRATION_MODULES = {"core": None, "students": None}
```

**Quy tắc:**
- **Không** chạy `makemigrations` cho `core` và `students`
- Thay đổi schema hub_* → viết SQL → chạy thủ công → cập nhật `docs/schema.sql`
- `django.contrib.sessions` vẫn dùng migration bình thường (tạo `django_session`)

### 3. Backend: `students/` app — read-only

Chỉ khai báo models để đọc từ shared DB. Không ghi vào:
`students`, `departments`, `degree_levels`, `student_statuses`, `student_health_insurance_cards`, `student_civic_activities`.

Thêm field: phải tồn tại trong DB trước (hỏi dashboard team), không cần migration.

### 4. Backend: Session cookie tách biệt

Cookie `hub_sessionid` (khác `sessionid` mặc định Django) để tránh xung đột với dashboard trên cùng parent domain `.iuoss.com`.

### 5. Frontend: Auth dùng cookie `hub_token` (JWT)

Middleware `frontend/middleware.ts` đọc cookie `hub_token`. Nếu thiếu → redirect về `/login`.

`lib/auth.ts` quản lý cookie lifecycle. `lib/api.ts` tự động thêm `Authorization: Bearer <token>` header.

### 6. Frontend đã nối API thật

`core/api/urls.py` expose **22 endpoint**; `lib/api.ts` gọi thẳng vào đó và tự gắn
`Authorization: Bearer <token>`. Không còn mock data.

### 7. Frontend: KHÔNG dùng rewrite proxy — Nginx lo định tuyến

`next.config.mjs` (không phải `.ts`) **cố ý bỏ rewrite `/api/*`**. Comment trong
file giải thích: Next.js strip trailing slash trước khi rewrite chạy, khiến Django
nhận URL sai → 301 → redirect loop với request POST.

`lib/api.ts` đặt `API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api'`:

| | `NEXT_PUBLIC_API_URL` | Kết quả |
|---|---|---|
| Dev | `http://127.0.0.1:8000/api` | Trình duyệt gọi thẳng Django (CORS mở cho `localhost:3000`) |
| Production | **không set** | `API_BASE = '/api'` → Nginx định tuyến `/api/` → Gunicorn `:8002` |

Chỉ **một** tầng định tuyến, nằm ở Nginx. Đừng tạo `.env.local` trên server
production — `NEXT_PUBLIC_*` bị đông cứng vào bundle lúc build; `deploy.sh` có guard
chặn build nếu phát hiện.

---

## Luồng auth tổng thể

### Frontend → Backend (JWT — đường duy nhất)

```
Sinh viên nhập uid + password
  → POST /api/auth/login/  (Next.js → Django API)
  → Django: verify_ldap() → trả { access, refresh, student_session }
  → Next.js: set cookie hub_token = access
  → middleware.ts kiểm tra cookie trước mọi /dashboard/* request
  → lib/api.ts gửi Authorization: Bearer <token>
```

---

## Server trên appctsv (production)

```
Internet :443
  ↓ Cloudflare Tunnel
cloudflared
  ↓
Nginx :80
  ├─ hub.iuoss.com/api/   → proxy :8002  (Django Gunicorn)
  ├─ hub.iuoss.com/static/ → backend/staticfiles/
  └─ hub.iuoss.com/        → proxy :3000  (Next.js PM2)

Gunicorn :8002  (systemd: iuoss_hub)       ← backend/
PM2      :3000  (iuoss_hub_front)          ← frontend/
MySQL    :3306  (iuoss_student_data)
```

---

## Workflow phát triển tính năng mới

### Tính năng chỉ ở frontend (UI-only)

1. Tạo page trong `frontend/app/(dashboard)/`
2. Thêm nav item vào `frontend/components/layout/sidebar.tsx`
3. Thêm title vào `PAGE_TITLES` trong `frontend/app/(dashboard)/layout.tsx`

### Tính năng cần API mới

1. **Backend:** Thêm model (nếu cần bảng mới), thêm DRF serializer + view + URL
2. **Frontend:** Thêm type trong `lib/types.ts`, thêm hàm trong `lib/api.ts`, tạo page/component

### Tính năng cần bảng DB mới

1. Viết SQL → thêm vào `docs/schema.sql`
2. Chạy SQL thủ công trên server
3. Thêm model `managed=False` trong `backend/core/models.py`
4. **Không** chạy `makemigrations`

---

## Đọc tài liệu theo mục đích

| Muốn hiểu về... | Đọc file |
|---|---|
| Tính năng đã implement | `docs/FEATURES.md` |
| Quan hệ với dashboard và WordPress | `docs/ECOSYSTEM.md` |
| LDAP auth chi tiết | `docs/AUTH_FLOW.md` |
| Setup dev local | `docs/README.md` |
| Deploy production | `docs/SERVER_SETUP.md` |
| Schema bảng hub | `docs/schema.sql` |
| Config Django | `backend/config/settings.py` |
| LDAP logic | `backend/core/auth.py` |
| Chính sách đăng nhập | `backend/core/login_policy.py` |
| API client (frontend) | `frontend/lib/api.ts` |
| TypeScript types | `frontend/lib/types.ts` |
| Route protection | `frontend/middleware.ts` |
