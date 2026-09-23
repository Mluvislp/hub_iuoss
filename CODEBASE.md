# IUOSS Hub — điểm vào

> Đọc file này trước. Chi tiết từng phần nằm ở `docs/`.

Cổng thông tin **sinh viên** Đại học Quốc tế (HCMIU): đăng nhập bằng tài khoản mạng
trường (LDAP) hoặc Microsoft/Entra ID để xem hồ sơ, đăng ký BHYT, khai báo ngoại trú và
gửi yêu cầu giấy tờ. Production: `hub.iuoss.com`.

**Monorepo:** `backend/` (Django 5.2 + DRF, Gunicorn `:8002`) + `frontend/` (Next.js 14
App Router + Tailwind, PM2 `:3000`). MySQL 8.4 **dùng chung với `dashboard_iuoss`** —
hai app **không gọi API của nhau**, mọi thứ trao đổi qua DB.

| Repo | Domain | Người dùng |
|---|---|---|
| `hub_iuoss` ← đây | `hub.iuoss.com` | Sinh viên |
| `dashboard_iuoss` | `dashboard.iuoss.com` | Nhân viên OSS |

---

## 5 quy tắc cứng

1. **Không có `django.contrib.auth`.** Không `request.user`, không `@login_required`,
   không `auth.login()`. Danh tính lấy từ **JWT** (SimpleJWT, claim `ldap_uid` = MSSV
   hiện tại) — xem `core/api/views.py::issue_session()`.
2. **Không `makemigrations` cho `core` và `students`** (`MIGRATION_MODULES = {"core":
   None, "students": None}`). Đổi schema → viết SQL → người dùng chạy tay → cập nhật
   `docs/schema.sql`. `django.contrib.sessions` vẫn migrate bình thường.
3. **`students/` là read-only.** Hub không ghi vào bảng Dashboard sở hữu; Hub chỉ ghi
   `hub_*` và các bảng được giao (khai báo địa chỉ, sửa hồ sơ cá nhân).
4. **`next.config.mjs` cố ý KHÔNG rewrite `/api/`.** Next.js strip trailing slash trước
   khi rewrite chạy → Django nhận URL sai → 301 → redirect loop với POST. Định tuyến
   nằm ở Nginx, đúng một tầng.
5. **Đừng tạo `.env.local` trên server production** — `NEXT_PUBLIC_*` bị đông cứng vào
   bundle lúc build. `deploy.sh` có guard chặn.

---

## Cấu trúc

```
backend/
  config/settings.py        ← DB, LDAP, Entra ID, JWT, CORS, cờ tính năng, cờ BHYT v2
  config/urls.py            ← chỉ mount core.api.urls dưới /api/
  config/insurance_test_settings.py · insurance_mysql_test_settings.py
  config/insurance_test_runner.py          ← bộ settings chạy test cụm BHYT

  core/auth.py              ← verify_ldap() — bind 2 bước
  core/microsoft_auth.py    ← luồng Entra ID (authorization code, state tự chứa)
  core/login_policy.py      ← check_login() — ai được vào cổng
  core/models.py            ← HubStudent, ConfirmationRequest, ConfirmationRequestComment…
  core/documents.py         ← dựng payload 5 loại yêu cầu giấy tờ
  core/offcampus.py         ← khai báo ngoại trú (form + submit)
  core/profile_changes.py   ← SV sửa CCCD / email / SĐT
  core/address_service.py · address_validators.py   ← BẢN SAO của Dashboard, sửa cả hai
  core/cccd.py              ← đọc QR căn cước

  core/insurance_contract.py        ← trạng thái/event/lý do BHYT — GIỐNG HỆT bản Dashboard
  core/insurance_workflow.py        ← nộp đơn, bổ sung, gửi lại
  core/insurance_history.py · insurance_history_models.py   ← timeline + 3 bảng phụ
  core/insurance_submission.py · insurance_files.py         ← nhận ảnh, xác minh MIME/HEIC
  core/external_insurance_models.py ← khai BHYT tại nơi khác
  core/management/commands/backfill_insurance_workflow.py   ← dựng timeline cho đơn cũ

  core/api/urls.py          ← 27 endpoint
  core/api/views.py         ← phần lớn view (1.480 dòng)
  core/api/insurance_views.py · external_insurance_views.py
  core/api/serializers.py · authentication.py · throttling.py · tokens.py
  students/models.py        ← read-only từ shared DB
  students/timeline.py      ← 3 luật tính mốc đào tạo (bản đối ứng ở Dashboard)
  logs/auth.log · logs/app.log

frontend/
  app/(auth)/login                         ← split-screen, có nút Microsoft
  app/auth/microsoft/callback              ← đổi code lấy JWT
  app/(dashboard)/dashboard/               ← 9 trang (xem bảng dưới)
  components/                              ← health-insurance · insurance-registration-form
                                             insurance-status · insurance-supplement
                                             civic-activities · editable-field · form-busy
                                             request-consent · searchable-select
                                             support-widget · coming-soon · layout/ · ui/
  lib/api.ts · auth.ts · types.ts · ui.ts · utils.ts
  lib/insurance-periods.ts · vietqr.ts · cccd-qr.ts · features.ts · form-validators.ts
  middleware.ts             ← chặn /dashboard/* khi thiếu cookie hub_token
  ecosystem.config.js       ← PM2 **của production** (sandbox dùng file ngoài repo)
```

### 9 trang sinh viên thấy

| URL | Việc |
|---|---|
| `/dashboard` | trang chủ — stat card, BHYT, SHCD, yêu cầu gần đây |
| `/dashboard/bao-hiem-y-te` | xem thẻ BHYT + lịch sử thẻ |
| `/dashboard/bao-hiem-y-te/dang-ky` | đăng ký BHYT theo đợt (trang nặng nhất) |
| `/dashboard/bao-hiem-y-te/khai-noi-khac` | khai đã tham gia BHYT ở nơi khác |
| `/dashboard/khai-bao-ngoai-tru` | khai địa chỉ + sửa CCCD/email/SĐT |
| `/dashboard/sinh-hoat-cong-dan` | tra kết quả SHCD |
| `/dashboard/requests` · `/requests/[id]` | danh sách + chi tiết & trao đổi |
| `/dashboard/requests/new` | chọn loại giấy |
| `/dashboard/requests/{other,deferment,thuong-binh,bank-loan,english}` | 5 biểu mẫu |

### 27 endpoint — `core/api/urls.py`

`health/` · `features/` (không cần auth) · `auth/{login,logout,token/refresh}` ·
`auth/microsoft/{start,callback}` · `dashboard/` · `health-insurance/` ·
`health-insurance/registrations/` + `<id>/` + `<id>/evidence/<id>/` ·
`health-insurance/external/` · `requests/` + `<id>/` + `<id>/comments/` +
5 endpoint `requests/<loại>/form/` · `offcampus/` + `offcampus/request-reopen/` ·
`locations/{provinces,wards,ethnicities}` · `hospitals/`

---

## Tra tài liệu

| Muốn biết | Đọc |
|---|---|
| Tính năng đã có, cờ "đang phát triển" | `docs/FEATURES.md` |
| Đăng nhập LDAP + Microsoft, chính sách vào cổng | `docs/AUTH_FLOW.md` |
| BHYT: workflow v2, khai ngoài trường, rollout | `docs/INSURANCE.md` |
| Quan hệ với Dashboard và WordPress | `docs/ECOSYSTEM.md` |
| Setup local | `docs/README.md` |
| Deploy production | `docs/SERVER_SETUP.md` |
| Môi trường sandbox | `dashboard_iuoss/docs/SANDBOX.md` |
| Schema bảng `hub_*` | `docs/schema.sql` |
| Quy ước dùng chung cả hệ thống (`is_current`, email, phân quyền) | `dashboard_iuoss/docs/ARCHITECTURE.md` |

---

## Chạy local

```bash
# Backend — venv nằm ở hub_iuoss/.venv, tức ../.venv tính từ backend/
cd backend
PYTHONUTF8=1 ../.venv/Scripts/python -m pip install -r requirements.txt
PYTHONIOENCODING=utf-8 PYTHONUTF8=1 ../.venv/Scripts/python manage.py runserver 127.0.0.1:8002

# Frontend
cd frontend && npm run dev          # :3000
```

`frontend/.env.local` (gitignore, chỉ dùng khi dev):

```env
NEXT_PUBLIC_API_URL=http://127.0.0.1:8002/api
```

**Cổng của cả hệ sinh thái khi chạy local:** Dashboard `8001` · Hub backend `8002` ·
Hub frontend `3000`. Cổng `8000` do dự án khác (`idcard_iuoss`) giữ.

- `PYTHONUTF8=1` là **bắt buộc** khi `pip install` — `requirements.txt` có chú thích
  tiếng Việt, pip đọc bằng cp1252 sẽ lỗi `UnicodeDecodeError`.
- **Không chạy `next build` khi `npm run dev` đang chạy** — hai lệnh dùng chung
  `.next/`, build ghi đè chunk manifest của dev server. Muốn typecheck thì
  `npx tsc --noEmit`.
- Kiểm tra đã có server chạy trước khi bật thêm; hai instance tranh cổng 8002 thì
  instance CŨ giữ socket và request thật chạy code cũ.

### Biến môi trường backend

```env
DJANGO_ENV=production        # local | staging | production — quyết định DEBUG + cookie bảo mật
SECRET_KEY · ALLOWED_HOSTS · FRONTEND_ORIGINS   # FRONTEND_ORIGINS lo cả CORS lẫn CSRF
DB_NAME=iuoss_student_data · DB_USER · DB_PASSWORD · DB_HOST · DB_PORT
LDAP_SERVER_URI · LDAP_BIND_DN · LDAP_BIND_PASSWORD · LDAP_SEARCH_BASE · LDAP_USER_ATTR
MS_TENANT_ID · MS_CLIENT_ID · MS_CLIENT_SECRET   # đủ cả ba thì MS_LOGIN_ENABLED bật
FEATURE_DOCUMENT_REQUESTS · FEATURE_CIVIC_ACTIVITIES   # mặc định TẮT ở production
INSURANCE_WORKFLOW_V2 · INSURANCE_PRIORITY_TYPE_CODE   # xem docs/INSURANCE.md
```

Bản đầy đủ ở `backend/.env.example`.

---

## Thêm tính năng

- **Chỉ frontend:** tạo page trong `frontend/app/(dashboard)/dashboard/` → thêm mục vào
  `components/layout/sidebar.tsx` → thêm tiêu đề vào `PAGE_TITLES`
  (`app/(dashboard)/layout.tsx`).
- **Cần API mới:** thêm serializer + view + URL ở `core/api/` → thêm type vào
  `lib/types.ts` → thêm hàm vào `lib/api.ts`.
- **Cần bảng mới:** viết SQL → cập nhật `docs/schema.sql` → người dùng chạy tay **trước
  khi deploy** → thêm model `managed=False`. Không `makemigrations`.
