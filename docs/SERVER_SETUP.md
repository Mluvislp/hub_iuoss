# IUOSS Hub — Triển khai production (appctsv)

> Server production chung với `dashboard.iuoss.com`. Đọc `SERVER_INFRASTRUCTURE.md` trong repo `iuoss_dashboard` để hiểu tổng quan hạ tầng.

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
  ├─ hub.iuoss.com  →  proxy_pass http://127.0.0.1:8002  (hub)
  ├─ dashboard.iuoss.com → proxy_pass http://127.0.0.1:8001  (dashboard)
  └─ /static/*  →  /var/www/apps/iuoss_hub/staticfiles/
       │
       ▼
  Gunicorn :8002  (3 workers)
       │
       ▼
  Django 5.2 (config.wsgi:application)
       │
       ▼
  MySQL 127.0.0.1:3306  (iuoss_student_data — shared với dashboard)
```

---

## File paths trên server

| Mục | Path |
|---|---|
| App code | `/var/www/apps/iuoss_hub/` |
| Python venv | `/var/www/apps/iuoss_hub/venv/` |
| File .env | `/var/www/apps/iuoss_hub/.env` |
| Static files | `/var/www/apps/iuoss_hub/staticfiles/` |
| Systemd service | `/etc/systemd/system/iuoss_hub.service` |
| Nginx config | `/etc/nginx/sites-enabled/iuoss_hub` |
| App logs | `/var/log/apps/iuoss_hub/` |

---

## Cài đặt lần đầu

### Bước 1 — Clone và setup venv

```bash
cd /var/www/apps
git clone https://github.com/Mluvislp/hub_iuoss.git iuoss_hub
cd iuoss_hub
python3.12 -m venv venv
venv/bin/pip install --upgrade pip
venv/bin/pip install -r requirements.txt
```

### Bước 2 — Cấu hình `.env`

```bash
cp .env.example .env
nano .env
```

Nội dung production:

```env
DEBUG=False
SECRET_KEY=<RANDOM_SECRET_KEY>
ALLOWED_HOSTS=hub.iuoss.com,10.8.20.33,127.0.0.1

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
```

Tạo `SECRET_KEY` ngẫu nhiên:
```bash
venv/bin/python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"
```

### Bước 3 — Tạo bảng DB

Chạy schema hub (chỉ cần làm 1 lần):
```bash
mysql -u iuoss_app -p iuoss_student_data < docs/schema.sql
```

Tạo bảng `django_session`:
```bash
venv/bin/python manage.py migrate
```

### Bước 4 — Thu thập static files

```bash
venv/bin/python manage.py collectstatic --noinput
```

### Bước 5 — Tạo thư mục log

```bash
sudo mkdir -p /var/log/apps/iuoss_hub
sudo chown hhdang:hhdang /var/log/apps/iuoss_hub
```

### Bước 6 — Systemd service

```bash
sudo nano /etc/systemd/system/iuoss_hub.service
```

Nội dung:

```ini
[Unit]
Description=IUOSS Hub (Gunicorn)
After=network.target mysql.service
Requires=mysql.service

[Service]
Type=simple
User=hhdang
WorkingDirectory=/var/www/apps/iuoss_hub
ExecStart=/var/www/apps/iuoss_hub/venv/bin/gunicorn \
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

### Bước 7 — Nginx config

```bash
sudo nano /etc/nginx/sites-available/iuoss_hub
```

Nội dung:

```nginx
server {
    listen 80;
    server_name hub.iuoss.com;

    location /static/ {
        alias /var/www/apps/iuoss_hub/staticfiles/;
        expires 7d;
        add_header Cache-Control "public";
    }

    location / {
        proxy_pass http://127.0.0.1:8002;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/iuoss_hub /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### Bước 8 — Cloudflare Tunnel: thêm route cho hub.iuoss.com

```bash
cloudflared tunnel route dns <TUNNEL_ID> hub.iuoss.com
```

Cập nhật `/etc/cloudflared/config.yml` thêm ingress rule:

```yaml
ingress:
  - hostname: hub.iuoss.com
    service: http://localhost:80
  - hostname: dashboard.iuoss.com
    service: http://localhost:80
  - service: http_status:404
```

```bash
sudo systemctl restart cloudflared
```

---

## Deploy khi có code mới

```bash
cd /var/www/apps/iuoss_hub
git pull origin main
venv/bin/pip install -r requirements.txt
venv/bin/python manage.py migrate
venv/bin/python manage.py collectstatic --noinput --clear
sudo systemctl restart iuoss_hub
```

---

## Vận hành hàng ngày

### Xem log

```bash
sudo journalctl -u iuoss_hub -f
# Hoặc
tail -f /var/log/apps/iuoss_hub/error.log
```

### Kiểm tra service

```bash
systemctl is-active iuoss_hub
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8002
```

### Dọn dẹp session cũ (nên chạy định kỳ)

```bash
venv/bin/python manage.py clearsessions
```

---

## Troubleshooting

| Triệu chứng | Nguyên nhân | Fix |
|---|---|---|
| 502 Bad Gateway | Gunicorn chết | `sudo systemctl restart iuoss_hub` |
| Login lỗi "Tài khoản không đúng" dù đúng mật khẩu | Không kết nối được LDAP | Kiểm tra kết nối: `ldapsearch -H ldap://ldap.hcmiu.edu.vn -x -b dc=hcmiu,dc=edu,dc=vn` |
| 400 Bad Request | `hub.iuoss.com` chưa có trong `ALLOWED_HOSTS` | Thêm vào `.env` rồi `systemctl restart iuoss_hub` |
| Static files không load | Chưa collectstatic | `python manage.py collectstatic --noinput --clear` |
| Login thành công nhưng `student_id = NULL` | uid LDAP không khớp `current_student_code` | Kiểm tra format uid trong LDAP vs MSSV trong DB |

---

## Khác biệt với dashboard khi deploy

| | dashboard | hub |
|---|---|---|
| Gunicorn port | 8001 | 8002 |
| Systemd service | `iuoss_app` | `iuoss_hub` |
| App path | `/var/www/apps/iuoss_app/` | `/var/www/apps/iuoss_hub/` |
| Venv path | `iuoss_app/venv/` | `iuoss_hub/venv/` |
| DB user | `iuoss_app` (read+write) | `iuoss_app` (read+write hub tables, read-only students) |
