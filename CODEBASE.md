# IUOSS Hub — điểm vào

> Đọc file này trước. Chi tiết ở `docs/` và ở `dashboard_iuoss/docs/` (nhiều tính năng viết chung một doc cho cả hai app).

Cổng thông tin **sinh viên** HCMIU: đăng nhập LDAP hoặc Microsoft/Entra ID. Production `hub.iuoss.com` (+ trang công
khai `graduation.iuoss.com`). **Monorepo:** `backend/` (Django 5.2 + DRF, Gunicorn `:8002`) + `frontend/` (Next.js 14
App Router + Tailwind, PM2 `:3000`). MySQL **dùng chung với `dashboard_iuoss`**, hai app không gọi API nhau — trừ xem
trước giấy tờ (`core/document_preview.py` → Dashboard `/documents/internal/preview/`).

## 5 quy tắc cứng

1. **Không có `django.contrib.auth`** — không `request.user`/`@login_required`. Danh tính từ **JWT** (SimpleJWT, claim
   `ldap_uid` = MSSV hiện tại) — `core/api/views.py::issue_session()`.
2. **Không `makemigrations` cho `core` và `students`** (`MIGRATION_MODULES`). Đổi schema → SQL → người dùng chạy tay
   **trước khi deploy** → cập nhật `docs/schema.sql` → model `managed=False`.
3. **`students/` read-only.** Hub chỉ ghi `hub_*` và bảng của luồng SV tự nộp/khai (địa chỉ, thông tin cá nhân,
   `student_images`, khám sức khỏe, bằng THPT, lễ tốt nghiệp, ticket…). Quyền sở hữu bảng: `dashboard_iuoss/docs/ECOSYSTEM.md`.
4. **`next.config.mjs` cố ý KHÔNG rewrite `/api/`** (Next strip trailing slash → 301 → loop với POST). Định tuyến ở Nginx.
5. **Không tạo `.env.local` trên server** — `NEXT_PUBLIC_*` đông cứng vào bundle lúc build; `deploy.sh` có guard.

## Cấu trúc backend (`backend/core/`)

| Nhóm | File |
|---|---|
| Đăng nhập | `auth.py` (LDAP bind 2 bước) · `microsoft_auth.py` · `login_policy.py` · `api/{authentication,tokens,throttling}.py` |
| Giấy tờ | `documents.py` (prefill + payload từng loại) · `request_edit.py` · `request_quota.py` · `request_code.py` ⇄ · `document_preview.py` · `cccd_rules.py` ⇄ |
| Nạp giấy trực tiếp | `direct_submissions.py` · `submission_models.py` · `submission_code.py` ⇄ · `api/submission_views.py` |
| Địa chỉ & cá nhân | `offcampus.py` (`mode` ngoại trú / địa chỉ) · `profile_changes.py` ⇄ · `personal_info.py` · `address_service.py` / `address_validators.py` ⇄ · `cccd.py` (đọc QR) |
| BHYT | `insurance_contract.py` ⇄ (giống hệt) · `insurance_workflow.py` · `insurance_history*.py` ⇄ · `insurance_submission.py` · `insurance_files.py` (MIME/HEIC) · `insurance_editing.py` · `external_insurance_models.py` · `hospital_change_models.py` |
| Khám sức khỏe | `health_check.py` · `health_check_models.py` · `health_check_result.py` (SCHEMA ⇄ `result_fields.py`) · `health_check_slots.py` ⇄ |
| Bằng THPT | `diploma.py` · `diploma_models.py` |
| Lễ tốt nghiệp | `graduation.py` · `graduation_models.py` · `api/graduation_views.py` · `api/graduation_auth.py` (phiên riêng) |
| Hỏi đáp | `tickets.py` · `ticket_models.py` · `richtext.py` ⇄ · `templates/emails/ticket_staff.html` |
| Kho ảnh SV | `student_images.py` · `student_image_models.py` — luồng mới lấy/lưu ảnh ở đây |
| `students/` | `models.py` (read-only) · `timeline.py` ⇄ (3 luật tính mốc) |

⇄ = có bản song sinh ở Dashboard, sửa cả hai (bảng đối chiếu ở `dashboard_iuoss/docs/ECOSYSTEM.md`).
Lệnh quản trị: `backfill_insurance_workflow`, `backfill_student_images` (mặc định chỉ xem trước).

**API** — `core/api/urls.py` (~70 route), nhóm: `health/` · `features/` · `auth/…` · `dashboard/` · `health-insurance/…`
(registrations, external, hospital-change) · `requests/…` (+ `availability/`, `preview/`, `<id>/comments|soft-copy/`,
`<loại>/form/` ×6) · `submissions/…` · `personal-info/` · `offcampus/…` · `address-declaration/…` · `graduation/…` ·
`health-check/…` · `diploma/…` · `tickets/…` · `student-images/…` · `locations/…` · `hospitals/`.

## Frontend

`app/(auth)/login` · `app/auth/microsoft/callback` · `app/le-tot-nghiep/` · `middleware.ts` (chặn `/dashboard/*` thiếu
cookie `hub_token`; suy cặp tên miền `graduation` ↔ `hub`) · `lib/{api,types,features,form-validators,
insurance-periods,vietqr,graduation,…}.ts` · `ecosystem.config.js` = PM2 **của production**.

| Trang `/dashboard/…` | Việc |
|---|---|
| (gốc) | trang chủ |
| `bao-hiem-y-te` · `/dang-ky` · `/khai-noi-khac` · `/doi-noi-kcb` | thẻ BHYT · đăng ký · khai nơi khác · đổi nơi KCB |
| `khai-bao-dia-chi` | khai báo địa chỉ toàn trường (form `khai-bao-ngoai-tru/DeclarationForm.tsx`, variant `address`) |
| `khai-bao-ngoai-tru` | **tạm đóng** (`FEATURE_OFFCAMPUS`) |
| `thong-tin-ca-nhan` | thông tin cá nhân — 7 cụm gửi duyệt (`FEATURE_PERSONAL_INFO`) |
| `kham-suc-khoe` | khám sức khỏe định kỳ |
| `bang-tot-nghiep` | nộp bằng THPT (`FEATURE_DIPLOMA`) |
| `hoi-dap` · `/new` · `/[id]` | hỏi đáp (`FEATURE_SUPPORT_TICKETS`) |
| `sinh-hoat-cong-dan` | kết quả SHCD (`FEATURE_CIVIC_ACTIVITIES`) |
| `requests` · `/new` · `/[id]` · `/{other,deferment,thuong-binh,bank-loan,english,conduct-score}` | yêu cầu giấy tờ (`FEATURE_DOCUMENT_REQUESTS`) |
| `nap-giay-to` · `/new` · `/[id]` | nạp giấy tờ trực tiếp (`FEATURE_DIRECT_SUBMISSIONS`) |

## Tra tài liệu

| Muốn biết | Đọc |
|---|---|
| Cờ tính năng, trạng thái từng tính năng | `docs/FEATURES.md` |
| Đăng nhập LDAP + Microsoft, chính sách vào cổng | `docs/AUTH_FLOW.md` |
| BHYT phía Hub (API, ảnh, SQL rollout) | `docs/INSURANCE.md` (nghiệp vụ: `dashboard_iuoss/docs/HEALTH_INSURANCE.md`) |
| Giấy tờ · nạp giấy · địa chỉ & cá nhân · khám sức khỏe · bằng THPT · lễ tốt nghiệp · hỏi đáp | `dashboard_iuoss/docs/{DOCUMENT_REQUESTS,DIRECT_SUBMISSIONS,OFFCAMPUS,HEALTH_CHECK,DIPLOMA,GRADUATION,SUPPORT_TICKETS}.md` |
| Quy ước chung (`is_current`, email, phân quyền) · hệ sinh thái · sandbox | `dashboard_iuoss/docs/{ARCHITECTURE,ECOSYSTEM,SANDBOX}.md` |
| Setup local · cài server | `docs/README.md` · `docs/SERVER_SETUP.md` |
| Schema `hub_*` | `docs/schema.sql` |

## Chạy local

```bash
cd backend && PYTHONUTF8=1 ../.venv/Scripts/python -m pip install -r requirements.txt   # PYTHONUTF8 bắt buộc
PYTHONIOENCODING=utf-8 PYTHONUTF8=1 ../.venv/Scripts/python manage.py runserver 127.0.0.1:8002
cd frontend && npm run dev                                 # :3000; .env.local: NEXT_PUBLIC_API_URL=http://127.0.0.1:8002/api
```

Cổng: Dashboard 8001 · Hub 8002 · frontend 3000 (8000 là `idcard_iuoss`). **Không `next build` khi `npm run dev` đang
chạy** (chung `.next/`) — typecheck bằng `npx tsc --noEmit`. Kiểm đã có server chạy trước khi bật thêm (instance cũ giữ cổng).

**Biến môi trường chính** (đủ ở `backend/.env.example`): `DJANGO_ENV` (local/staging/production — quyết `DEBUG` + cookie)
· `SECRET_KEY` · `ALLOWED_HOSTS` · `FRONTEND_ORIGINS` (CORS + CSRF) · `DB_*` · `LDAP_*` · `MS_TENANT_ID/CLIENT_ID/
CLIENT_SECRET` (+ `MS_EXTRA_REDIRECT_URIS`) · `FEATURE_*` · `DASHBOARD_PUBLIC_URL` · `DASHBOARD_INTERNAL_URL` +
`DOCUMENT_PREVIEW_TOKEN` · `INSURANCE_WORKFLOW_V2` · `INSURANCE_PRIORITY_TYPE_CODE`.

## Thêm tính năng

- Trang: `frontend/app/(dashboard)/dashboard/<x>/` → mục `components/layout/sidebar.tsx` → `PAGE_TITLES`
  (`app/(dashboard)/layout.tsx`).
- API: serializer + view + URL ở `core/api/` → `lib/types.ts` → `lib/api.ts`.
- Bảng: SQL → `docs/schema.sql` → chạy tay trước deploy → model `managed=False`.
