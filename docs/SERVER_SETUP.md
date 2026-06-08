# IUOSS Hub — Triển khai production (appctsv)

> Server production chung với `dashboard.iuoss.com`.
> Xem `SERVER_INFRASTRUCTURE.md` trong repo `dashboard_iuoss` để hiểu tổng quan hạ tầng.

---

## Kiến trúc trên appctsv

```
Internet (HTTPS :443)
  │
  ▼ Cloudflare Tunnel
cloudflared
  │ HTTP → 127.0.0.1:80
  ▼
Nginx :80
  ├─ dashboard.iuoss.com   →  :8001  Gunicorn  (dashboard — không đụng)
  │
  └─ hub.iuoss.com
       ├─ /api/            →  :8002  Gunicorn  (Django REST API)
       ├─ /static/         →  backend/staticfiles/
       └─ /                →  :3000  PM2        (Next.js)

Gunicorn :8002   (systemd: iuoss_hub)
PM2      :3000   (iuoss_hub_front)
MySQL    :3306   (iuoss_student_data — shared)
```

---

## File paths trên server

| Mục | Path |
|---|---|
| Monorepo root | `/var/www/apps/iuoss_hub/` |
| Backend (Django) | `/var/www/apps/iuoss_hub/backend/` |
| Frontend (Next.js) | `/var/www/apps/iuoss_hub/frontend/` |
| Python venv | `/var/www/apps/iuoss_hub/backend/venv/` |
| Backend .env | `/var/www/apps/iuoss_hub/backend/.env` |
| Django staticfiles | `/var/www/apps/iuoss_hub/backend/staticfiles/` |
| App logs | `/var/log/apps/iuoss_hub/` |
| Systemd service | `/etc/systemd/system/iuoss_hub.service` |
| Nginx config | `/etc/nginx/sites-enabled/iuoss_hub` |
| PM2 config | `/var/www/apps/iuoss_hub/frontend/ecosystem.config.js` |

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
git clone https://github.com/Mluvislp/hub_iuoss.git iuoss_hub
cd iuoss_hub/backend

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
sudo mkdir -p /var/log/apps/iuoss_hub
sudo chown hhdang:hhdang /var/log/apps/iuoss_hub
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
WorkingDirectory=/var/www/apps/iuoss_hub/backend
ExecStart=/var/www/apps/iuoss_hub/backend/venv/bin/gunicorn \
    config.wsgi:application \
    --bind 127.0.0.1:8002 \
    --workers 3 \
    --timeout 60 \
    --access-logfile /var/log/apps/iuoss_hub/access.log \
    --error-logfile /var/log/apps/iuoss_hub/error.log
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
cd /var/www/apps/iuoss_hub/frontend
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
        alias /var/www/apps/iuoss_hub/backend/staticfiles/;
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

```yaml
ingress:
  - hostname: dashboard.iuoss.com      # GIỮ NGUYÊN
    service: http://127.0.0.1:80
  - hostname: hub.iuoss.com            # THÊM DÒNG NÀY
    service: http://127.0.0.1:80
  - service: http_status:404           # PHẢI là rule cuối cùng
```

```bash
sudo systemctl restart cloudflared
```

---

## Deploy khi có code mới

### Deploy tất cả (khuyến nghị)

```bash
cd /var/www/apps/iuoss_hub
bash deploy.sh
```

### Deploy từng phần

```bash
bash deploy.sh backend   # chỉ Django
bash deploy.sh frontend  # chỉ Next.js
```

### Deploy thủ công (nếu cần)

```bash
# Backend
cd /var/www/apps/iuoss_hub
git pull origin main
cd backend
venv/bin/pip install -r requirements.txt -q
venv/bin/python manage.py migrate
venv/bin/python manage.py collectstatic --noinput --clear
sudo systemctl restart iuoss_hub

# Frontend
cd /var/www/apps/iuoss_hub/frontend
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
tail -f /var/log/apps/iuoss_hub/error.log

# App logs (auth + errors)
tail -f /var/www/apps/iuoss_hub/backend/logs/auth.log
tail -f /var/www/apps/iuoss_hub/backend/logs/app.log

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
cd /var/www/apps/iuoss_hub/backend
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
| Form login template Django `403 CSRF` | Domain chưa có trong `CSRF_TRUSTED_ORIGINS` | Set `FRONTEND_ORIGINS=https://hub.iuoss.com` → restart |
| Frontend gọi API ra IP `127.0.0.1:8000` | Build dính `NEXT_PUBLIC_API_URL` dev | Xoá `frontend/.env.local` → `npm run build` lại |
| Static files không load | Chưa collectstatic | `python manage.py collectstatic --noinput --clear` |
| Next.js build fail | node_modules cũ | `cd frontend && rm -rf node_modules .next && npm install && npm run build` |
| PM2 không autostart sau reboot | Chưa `pm2 save` + `pm2 startup` | Chạy lại `pm2 save` và lệnh `pm2 startup` in ra |

---

## So sánh với setup cũ (Django monolith)

| | Cũ | Mới |
|---|---|---|
| App path | `iuoss_hub/` (root) | `iuoss_hub/backend/` |
| Frontend | Django templates | Next.js :3000 (PM2) |
| Nginx `/` | → Gunicorn | → Next.js |
| Nginx `/api/` | không có | → Gunicorn |
| Node.js | không cần | v20 LTS |
| Dashboard | không đụng | không đụng |
