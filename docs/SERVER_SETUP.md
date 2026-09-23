# IUOSS Hub — Triển khai production (appctsv)

> **Tổng quan hạ tầng dùng chung — sơ đồ traffic 4 hostname, bảng đường dẫn cả hai
> app, port map, cảnh báo MySQL/Next.js đang lắng nghe mọi interface — nằm ở
> `dashboard_iuoss/docs/DEPLOY.md`.** File này chỉ có phần riêng của Hub: cài lần đầu,
> deploy, log, sự cố hay gặp. Sandbox: `dashboard_iuoss/docs/SANDBOX.md`.

Tóm tắt phần Hub: Nginx phân biệt bằng `server_name`; `hub.iuoss.com/api/` →
Gunicorn `:8002` (systemd `iuoss_hub`, 6 worker), `/static/` → `backend/staticfiles/`,
`/` → Next.js `:3000` (PM2 `iuoss_hub_front`). Code ở `/var/www/apps/hub_iuoss/`, venv
`backend/venv/`, `.env` `backend/.env`, log `/var/log/apps/hub_iuoss/` +
`backend/logs/{auth,app}.log`, unit `/etc/systemd/system/iuoss_hub.service`, nginx
`/etc/nginx/sites-enabled/iuoss_hub`, PM2 config `frontend/ecosystem.config.js`
(**của production** — sandbox dùng file ngoài repo).

---

## Cài đặt lần đầu

### Bước 1 — Cài Node.js 20 LTS trở lên (nếu chưa có)

Server appctsv hiện đang chạy Node.js v24. Phiên bản v20 LTS trở lên đều được.

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # phải >= 20.x
sudo npm install -g pm2
```

### Bước 2 — Clone repo và setup backend

```bash
cd /var/www/apps
git clone https://github.com/Mluvislp/hub_iuoss.git hub_iuoss
cd hub_iuoss/backend

python3.12 -m venv venv
venv/bin/pip install --upgrade pip
venv/bin/pip install -r requirements.txt
```

### Bước 3 — Cấu hình backend `.env`

```bash
cp .env.example .env
nano .env
```

Nội dung production:

```env
DJANGO_ENV=production
SECRET_KEY=<RANDOM_SECRET_KEY>
ALLOWED_HOSTS=hub.iuoss.com,10.8.20.33,127.0.0.1

# Origin frontend — dùng cho CORS + CSRF (cùng domain qua Nginx)
FRONTEND_ORIGINS=https://hub.iuoss.com

DB_NAME=iuoss_student_data
DB_USER=iuoss_app
DB_PASSWORD=<DB_PASSWORD>
DB_HOST=127.0.0.1
DB_PORT=3306
DB_CONN_MAX_AGE=60

TIME_ZONE=Asia/Ho_Chi_Minh

LDAP_SERVER_URI=ldap://ldap.hcmiu.edu.vn:389
LDAP_BIND_DN=cn=ctsv,dc=hcmiu,dc=edu,dc=vn
LDAP_BIND_PASSWORD=<PLAIN_TEXT_LDAP_PASSWORD>
LDAP_SEARCH_BASE=dc=hcmiu,dc=edu,dc=vn
LDAP_USER_ATTR=uid

# HSTS — bật sau khi xác nhận toàn site HTTPS ổn định (tùy chọn):
# SECURE_HSTS_SECONDS=31536000
# SECURE_HSTS_INCLUDE_SUBDOMAINS=True
# SECURE_HSTS_PRELOAD=True
```

> `DJANGO_ENV=production` tự đặt `DEBUG=False`. Không cần khai báo `DEBUG` riêng.

> **Frontend build (footgun):** KHÔNG tạo `frontend/.env.local` trên server production.
> `NEXT_PUBLIC_*` bị đông cứng vào bundle lúc `npm run build`. Để trống → API gọi
> `/api` (relative) → Nginx định tuyến. `deploy.sh` sẽ chặn build nếu phát hiện
> `.env.local` còn `NEXT_PUBLIC_API_URL`.

Tạo `SECRET_KEY`:
```bash
venv/bin/python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"
```

### Bước 4 — Tạo bảng DB

```bash
# Tạo bảng hub_* (chỉ lần đầu)
mysql -u iuoss_app -p iuoss_student_data < ../docs/schema.sql

# Tạo bảng django_session
venv/bin/python manage.py migrate

# Thu thập static files
venv/bin/python manage.py collectstatic --noinput
```

### Bước 5 — Tạo thư mục log

```bash
sudo mkdir -p /var/log/apps/hub_iuoss
sudo chown hhdang:hhdang /var/log/apps/hub_iuoss
```

### Bước 6 — Systemd service (Django API)

```bash
sudo nano /etc/systemd/system/iuoss_hub.service
```

```ini
[Unit]
Description=IUOSS Hub API (Gunicorn)
After=network.target mysql.service
Requires=mysql.service

[Service]
Type=simple
User=hhdang
WorkingDirectory=/var/www/apps/hub_iuoss/backend
ExecStart=/var/www/apps/hub_iuoss/backend/venv/bin/gunicorn \
    config.wsgi:application \
    --bind 127.0.0.1:8002 \
    --workers 6 \
    --timeout 60 \
    --access-logfile /var/log/apps/hub_iuoss/access.log \
    --error-logfile /var/log/apps/hub_iuoss/error.log
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable iuoss_hub
sudo systemctl start iuoss_hub
sudo systemctl status iuoss_hub
```

### Bước 7 — PM2 (Next.js frontend)

```bash
cd /var/www/apps/hub_iuoss/frontend
npm install
npm run build

# Khởi động
pm2 start ecosystem.config.js

# Đăng ký autostart khi server reboot
pm2 save
pm2 startup   # chạy lệnh mà nó in ra (có dạng: sudo env PATH=... pm2 startup ...)
```

### Bước 8 — Nginx config

```bash
sudo nano /etc/nginx/sites-available/iuoss_hub
```

> ⚠️ **QUAN TRỌNG — X-Forwarded-Proto:** Cloudflare Tunnel forward tới `localhost:80`
> bằng **HTTP**, nên `$scheme` = `http`. Nếu truyền thẳng `$scheme`, Django (có
> `SECURE_PROXY_SSL_HEADER`) tưởng request không bảo mật → secure-cookie hỏng / redirect
> loop. Dùng `map` bên dưới: ưu tiên proto gốc từ cloudflared, mặc định `https`.

```nginx
# Ưu tiên X-Forwarded-Proto cloudflared gửi; nếu rỗng → https (site luôn HTTPS ra ngoài).
map $http_x_forwarded_proto $hub_forwarded_proto {
    default $http_x_forwarded_proto;
    ""      https;
}

server {
    listen 80;
    server_name hub.iuoss.com;

    # Django static files
    location /static/ {
        alias /var/www/apps/hub_iuoss/backend/staticfiles/;
        expires 7d;
        add_header Cache-Control "public";
    }

    # Django REST API
    location /api/ {
        proxy_pass         http://127.0.0.1:8002;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $hub_forwarded_proto;
        proxy_read_timeout 60;
    }

    # Next.js frontend — tất cả request còn lại
    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $hub_forwarded_proto;
        proxy_set_header   Upgrade           $http_upgrade;
        proxy_set_header   Connection        "upgrade";
        proxy_http_version 1.1;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/iuoss_hub /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### Bước 9 — Cloudflare Tunnel (giữ nguyên)

```bash
cloudflared tunnel route dns <TUNNEL_ID> hub.iuoss.com
```

Cập nhật `/etc/cloudflared/config.yml`:

Trạng thái hiện tại của `/etc/cloudflared/config.yml` — 4 hostname, 1 tunnel:

```yaml
ingress:
  # --- PRODUCTION ---
  - hostname: dashboard.iuoss.com
    service: http://127.0.0.1:80
  - hostname: hub.iuoss.com
    service: http://127.0.0.1:80
  # --- SANDBOX ---
  - hostname: dashboard-sandbox.iuoss.com
    service: http://127.0.0.1:80
  - hostname: hub-sandbox.iuoss.com
    service: http://127.0.0.1:80
  - service: http_status:404           # PHẢI là rule cuối cùng
```

```bash
sudo systemctl restart cloudflared
```

> ⚠️ Còn một file thừa `~/.cloudflared/config.yml` là bản cũ chỉ có 1 hostname.
> systemd dùng bản ở `/etc/cloudflared/`, nhưng ai chạy tay `cloudflared tunnel run`
> bằng user `hhdang` sẽ bốc nhầm bản cũ và 3 hostname còn lại thành 404.

---

## Deploy khi có code mới

### Deploy tất cả (khuyến nghị)

```bash
cd /var/www/apps/hub_iuoss
bash deploy.sh
```

> ⚠️ **`deploy.sh` hardcode `APP_ROOT="/var/www/apps/hub_iuoss"` và `cd` vào đó ngay
> đầu script.** Đứng ở thư mục sandbox gõ `bash deploy.sh` **vẫn deploy PRODUCTION**,
> không báo lỗi gì. Bản clone sandbox có cùng file này nên bẫy càng dễ dính.
> Deploy sandbox phải dùng `deploy-sandbox.sh` — xem §Sandbox.

### Deploy từng phần

```bash
bash deploy.sh backend   # chỉ Django
bash deploy.sh frontend  # chỉ Next.js
```

### Deploy thủ công (nếu cần)

```bash
# Backend
cd /var/www/apps/hub_iuoss
git pull origin main
cd backend
venv/bin/pip install -r requirements.txt -q
venv/bin/python manage.py migrate
venv/bin/python manage.py collectstatic --noinput --clear
sudo systemctl restart iuoss_hub

# Frontend
cd /var/www/apps/hub_iuoss/frontend
npm install
npm run build
pm2 restart iuoss_hub_front
```

---

## Vận hành hàng ngày

### Xem log

```bash
# Gunicorn logs
sudo journalctl -u iuoss_hub -f
tail -f /var/log/apps/hub_iuoss/error.log

# App logs (auth + errors)
tail -f /var/www/apps/hub_iuoss/backend/logs/auth.log
tail -f /var/www/apps/hub_iuoss/backend/logs/app.log

# PM2 logs (Next.js)
pm2 logs iuoss_hub_front
```

### Kiểm tra services

```bash
systemctl is-active iuoss_hub
pm2 status iuoss_hub_front

# Health check backend — trả {"status":"ok","environment":"production","database":true}
curl -s http://127.0.0.1:8002/api/health/

# Frontend
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/login
```

### Monitor PM2

```bash
pm2 monit
```

### Dọn dẹp session cũ

```bash
cd /var/www/apps/hub_iuoss/backend
venv/bin/python manage.py clearsessions
```

---

## Troubleshooting

| Triệu chứng | Nguyên nhân | Fix |
|---|---|---|
| `502 Bad Gateway` trên tất cả | Gunicorn chết | `sudo systemctl restart iuoss_hub` |
| `502` chỉ ở `/` (không phải `/api/`) | PM2 Next.js chết | `pm2 restart iuoss_hub_front` |
| Login lỗi "Tài khoản không đúng" | Không kết nối LDAP | `ldapsearch -H ldap://ldap.hcmiu.edu.vn -x -b dc=hcmiu,dc=edu,dc=vn` |
| `400 Bad Request` | `hub.iuoss.com` chưa trong `ALLOWED_HOSTS` | Thêm vào `backend/.env` → restart |
| Login OK nhưng bị đá ra liên tục / `ERR_TOO_MANY_REDIRECTS` | Django tưởng request là HTTP (thiếu/sai `X-Forwarded-Proto`) | Kiểm tra Nginx dùng `map $hub_forwarded_proto` (xem Bước 8); xác nhận `curl -s http://127.0.0.1:8002/api/health/` trả 200 |
| Mở `:8002/` hoặc `:8002/login/` ra **404** | Đúng như thiết kế — Django chỉ phục vụ `/api/`, giao diện ở Next.js `:3000` | Mở `:3000/login` (local) hoặc `hub.iuoss.com` (prod) |
| Frontend gọi API ra IP `127.0.0.1:8002` (hoặc `:8000`) | Build dính `NEXT_PUBLIC_API_URL` dev | Xoá `frontend/.env.local` → `npm run build` lại |
| Static files không load | Chưa collectstatic | `python manage.py collectstatic --noinput --clear` |
| Next.js build fail | node_modules cũ | `cd frontend && rm -rf node_modules .next && npm install && npm run build` |
| PM2 không autostart sau reboot | Chưa `pm2 save` + `pm2 startup` | Chạy lại `pm2 save` và lệnh `pm2 startup` in ra |

---
## Sandbox

Môi trường sandbox của **cả hai app** dựng 29/08/2026 trên chính server này (nhánh
`sandbox`, DB riêng `iuoss_student_data_sandbox`, Hub ở API `:8004` + UI `:3001`).
Mô tả đầy đủ — 4 chốt chặn của `deploy-sandbox.sh`, chính sách dữ liệu, khác biệt
cấu hình, hai bẫy đã vấp — ở **`dashboard_iuoss/docs/SANDBOX.md`**. Đừng chép lại ở đây.
