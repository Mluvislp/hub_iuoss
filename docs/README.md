# Setup môi trường dev local

Tổng quan repo, quy tắc cứng và cấu trúc file: [`CODEBASE.md`](../CODEBASE.md).

| | Backend | Frontend |
|---|---|---|
| Thư mục | `backend/` | `frontend/` |
| Stack | Django 5.2 + DRF + MySQL | Next.js 14 + TypeScript + Tailwind |
| Cổng dev | **`:8002`** | `:3000` |
| Cần | Python **3.12** (khớp prod), MySQL | Node.js 20+ |

> Cổng `:8000` **không dùng cho Hub** — trên máy dev nó do dự án `idcard_iuoss` giữ, và
> cũng trả 307 về `/login` nên rất dễ nhầm. Dashboard chạy `:8001`.

## Backend

Cần quyền đọc DB `iuoss_student_data` (`127.0.0.1:3306`) và kết nối được LDAP
`ldap.hcmiu.edu.vn` (trong mạng trường hoặc VPN).

```bash
# venv của bản local nằm ở GỐC repo (hub_iuoss/.venv), không phải trong backend/
python -m venv .venv
cd backend
PYTHONUTF8=1 ../.venv/Scripts/python -m pip install -r requirements.txt   # Windows
# Linux/macOS: PYTHONUTF8=1 ../.venv/bin/python -m pip install -r requirements.txt

cp .env.example .env        # điền DB_*, LDAP_*, SECRET_KEY, ALLOWED_HOSTS
mysql -u iuoss_app -p iuoss_student_data < ../docs/schema.sql   # lần đầu
../.venv/Scripts/python manage.py migrate                        # chỉ tạo django_session

PYTHONIOENCODING=utf-8 PYTHONUTF8=1 ../.venv/Scripts/python manage.py runserver 127.0.0.1:8002
```

- **`PYTHONUTF8=1` là bắt buộc khi `pip install`** — `requirements.txt` có chú thích
  tiếng Việt, pip đọc bằng cp1252 sẽ ném `UnicodeDecodeError` và không cài gì cả.
- Server production dùng venv ở **`backend/venv/`** (xem `SERVER_SETUP.md`); chỉ bản
  local đặt ở gốc repo.
- Backend **chỉ phục vụ `/api/`**. Mở `http://127.0.0.1:8002/` sẽ ra 404 — đúng như
  thiết kế, không phải lỗi. Kiểm tra bằng `/api/health/`.
- Ảnh BHYT nộp qua Hub lưu ở `media/insurance_private/…` (ảnh cũ: `insurance_data/%Y/%m/`).
  Dashboard đọc lại qua biến `HUB_MEDIA_ROOT` của nó.

## Frontend

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev                 # :3000
```

`.env.local` khi dev:

```env
NEXT_PUBLIC_API_URL=http://127.0.0.1:8002/api
```

- Biến đúng là **`NEXT_PUBLIC_API_URL`**; `DJANGO_API_URL` là tên cũ gắn với cơ chế
  rewrite đã gỡ, **không code nào đọc**. Chỉ biến có tiền tố `NEXT_PUBLIC_` mới tới được
  trình duyệt, mà `lib/api.ts` chạy phía client.
- **Next.js cố ý KHÔNG proxy `/api/*`** (rewrite gây redirect loop với POST). Thiếu
  `NEXT_PUBLIC_API_URL` thì frontend gọi `/api` tương đối và không có gì phục vụ. CORS
  đã mở sẵn cho `localhost:3000`.
- **KHÔNG chạy `next build` khi `npm run dev` đang chạy** — chung thư mục `.next/`,
  build ghi đè chunk manifest của dev server, trang đang mở ném
  `TypeError: __webpack_modules__[moduleId] is not a function`. Typecheck thì dùng
  `npx tsc --noEmit`. Lỡ dính: kill process giữ cổng 3000 → xóa `.next` → `npm run dev`
  → hard-reload trình duyệt.
- **Đừng tạo `.env.local` trên server production** — `NEXT_PUBLIC_*` đông cứng vào
  bundle lúc build; `deploy.sh` có guard chặn.

## Chạy cả hệ sinh thái

Ba tiến trình, ba cổng: Dashboard `8001` · Hub backend `8002` · Hub frontend `3000`.
**Kiểm xem đã có server đang chạy trước khi bật thêm** — hai instance tranh cổng 8002
thì instance CŨ giữ socket, request thật vẫn chạy code cũ trong khi `/api/health/` vẫn
trả 200 và test qua `manage.py shell` vẫn đúng. Kiểm bằng thời điểm khởi động của
process, không chỉ bằng "có ai nghe cổng không".

## Deploy

Production: [`SERVER_SETUP.md`](SERVER_SETUP.md). Sandbox:
`dashboard_iuoss/docs/SANDBOX.md`. Mọi SQL nâng cấp schema phải chạy tay **trước khi
deploy code** — danh sách file ở [`INSURANCE.md §5`](INSURANCE.md).
