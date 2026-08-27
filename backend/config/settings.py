import os
from datetime import timedelta
from pathlib import Path
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def env_bool(name, default=False):
    v = os.getenv(name)
    return default if v is None else v.strip().lower() in {"1", "true", "yes"}


def env_list(name, default=""):
    return [x.strip() for x in os.getenv(name, default).split(",") if x.strip()]


# ── Môi trường ────────────────────────────────────────────────────────────────
# DJANGO_ENV là nguồn sự thật duy nhất: local | staging | production.
# DEBUG suy ra từ đây (local → True), nhưng vẫn cho phép .env override tường minh.
DJANGO_ENV = os.getenv("DJANGO_ENV", "local").strip().lower()
IS_PRODUCTION = DJANGO_ENV == "production"
IS_STAGING = DJANGO_ENV == "staging"

SECRET_KEY = os.getenv("SECRET_KEY", "django-insecure-hub-dev-only")
DEBUG = env_bool("DEBUG", default=(DJANGO_ENV == "local"))
ALLOWED_HOSTS = env_list("ALLOWED_HOSTS", "127.0.0.1,localhost")

# ── Feature flags (tạm ẩn tính năng trên môi trường live) ─────────────────────
# Mặc định: TẮT trên production, BẬT ở local/staging. Muốn bật lại trên prod thì
# set biến env tương ứng = True rồi restart backend — KHÔNG cần sửa code.
# Backend là nguồn sự thật duy nhất; frontend đọc qua GET /api/features/.
FEATURE_DOCUMENT_REQUESTS = env_bool("FEATURE_DOCUMENT_REQUESTS", default=not IS_PRODUCTION)
FEATURE_CIVIC_ACTIVITIES = env_bool("FEATURE_CIVIC_ACTIVITIES", default=not IS_PRODUCTION)

# Origin của frontend — dùng chung cho CORS và CSRF (khai báo 1 nơi, tránh lệch).
FRONTEND_ORIGINS = env_list(
    "FRONTEND_ORIGINS",
    "http://localhost:3000,http://127.0.0.1:3000",
)

INSTALLED_APPS = [
    # django.contrib.auth — bắt buộc phải có để djangorestframework-simplejwt
    # import được. KHÔNG dùng để xác thực sinh viên (toàn bộ auth là LDAP custom).
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "widget_tweaks",
    "rest_framework",
    "corsheaders",
    "core",
    "students",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

DATABASES = {
    "default": {
        "ENGINE": os.getenv("DB_ENGINE", "django.db.backends.mysql"),
        "NAME": os.getenv("DB_NAME", "iuoss_student_data"),
        "USER": os.getenv("DB_USER", "iuoss_app"),
        "PASSWORD": os.getenv("DB_PASSWORD", ""),
        "HOST": os.getenv("DB_HOST", "127.0.0.1"),
        "PORT": os.getenv("DB_PORT", "3306"),
        "CONN_MAX_AGE": int(os.getenv("DB_CONN_MAX_AGE", "60")),
        "OPTIONS": {
            "charset": "utf8mb4",
            "init_command": "SET sql_mode='STRICT_TRANS_TABLES'",
        },
    }
}

# Sessions — dùng DB, tách biệt hoàn toàn với dashboard
SESSION_ENGINE = "django.contrib.sessions.backends.db"
SESSION_COOKIE_NAME = "hub_sessionid"
SESSION_COOKIE_AGE = 60 * 60 * 8   # 8 giờ
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"

LANGUAGE_CODE = "vi"
TIME_ZONE = os.getenv("TIME_ZONE", "Asia/Ho_Chi_Minh")
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STATICFILES_DIRS = [BASE_DIR / "static"] if (BASE_DIR / "static").exists() else []

MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# LDAP
LDAP_SERVER_URI = os.getenv("LDAP_SERVER_URI", "ldap://ldap.hcmiu.edu.vn:389")
LDAP_BIND_DN = os.getenv("LDAP_BIND_DN", "cn=ctsv,dc=hcmiu,dc=edu,dc=vn")
LDAP_BIND_PASSWORD = os.getenv("LDAP_BIND_PASSWORD", "")
LDAP_SEARCH_BASE = os.getenv("LDAP_SEARCH_BASE", "dc=hcmiu,dc=edu,dc=vn")
LDAP_USER_ATTR = os.getenv("LDAP_USER_ATTR", "uid")

# ── Đăng nhập bằng tài khoản Microsoft (Entra ID) ────────────────────────────
# App registration của trường, kiểu "Web" + single tenant. Client secret nằm ở
# server, KHÔNG bao giờ gửi xuống trình duyệt. Thiếu client id/secret thì tính
# năng tự tắt (cờ MS_LOGIN_ENABLED) và frontend ẩn nút — LDAP vẫn chạy bình thường.
MS_TENANT_ID = os.getenv("MS_TENANT_ID", "")
MS_CLIENT_ID = os.getenv("MS_CLIENT_ID", "")
MS_CLIENT_SECRET = os.getenv("MS_CLIENT_SECRET", "")
MS_REDIRECT_URI = os.getenv(
    "MS_REDIRECT_URI", "http://localhost:3000/auth/microsoft/callback"
)
# Chỉ chấp nhận email sinh viên. Tên miền nhân viên (hcmiu.edu.vn) nằm CÙNG một
# tenant nên kiểm `tid` không phân biệt được — bắt buộc lọc theo hậu tố này.
MS_ALLOWED_EMAIL_DOMAIN = os.getenv("MS_ALLOWED_EMAIL_DOMAIN", "student.hcmiu.edu.vn")
MS_LOGIN_ENABLED = bool(MS_TENANT_ID and MS_CLIENT_ID and MS_CLIENT_SECRET)

# ── Bảo mật & Reverse proxy ──────────────────────────────────────────────────
# Django chạy sau Nginx + Cloudflare Tunnel: SSL kết thúc ở tầng trên, Gunicorn
# nhận HTTP. Header này cho Django biết request gốc là HTTPS → request.is_secure()
# trả đúng, secure-cookie hoạt động, không bị redirect loop.
# An toàn vì Gunicorn chỉ bind 127.0.0.1 — duy nhất Nginx (nơi đặt header) tới được.
# LƯU Ý: Nginx phải set "X-Forwarded-Proto https" (xem docs/SERVER_SETUP.md) —
# vì Cloudflare Tunnel → localhost:80 là HTTP nên $scheme sẽ là "http".
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
USE_X_FORWARDED_HOST = True

# CSRF cho legacy Django template views (login.html…). API dùng JWT nên không cần,
# nhưng Django 4+ bắt buộc khai báo scheme + host đầy đủ cho mọi form POST.
CSRF_TRUSTED_ORIGINS = env_list("CSRF_TRUSTED_ORIGINS", ",".join(FRONTEND_ORIGINS))

if not DEBUG:
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_CONTENT_TYPE_NOSNIFF = True
    SECURE_BROWSER_XSS_FILTER = True
    X_FRAME_OPTIONS = "DENY"
    # HSTS — bật khi chắc chắn toàn site chạy HTTPS (Cloudflare đã ép HTTPS).
    # Để 0 mặc định cho an toàn; set SECURE_HSTS_SECONDS=31536000 khi sẵn sàng.
    SECURE_HSTS_SECONDS = int(os.getenv("SECURE_HSTS_SECONDS", "0"))
    SECURE_HSTS_INCLUDE_SUBDOMAINS = env_bool("SECURE_HSTS_INCLUDE_SUBDOMAINS", False)
    SECURE_HSTS_PRELOAD = env_bool("SECURE_HSTS_PRELOAD", False)
    # Redirect HTTP→HTTPS để Cloudflare/Nginx lo (tránh double-redirect). Bật nếu cần.
    SECURE_SSL_REDIRECT = env_bool("SECURE_SSL_REDIRECT", False)

# ── Django REST Framework ────────────────────────────────────────────────────
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "core.api.authentication.HubJWTAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "core.api.authentication.IsHubAuthenticated",
    ],
    "DEFAULT_RENDERER_CLASSES": [
        "rest_framework.renderers.JSONRenderer",
    ],
    # Chống brute-force/spam. HubScopedRateThrottle kế thừa ScopedRateThrottle,
    # dùng ldap_uid thay vì user.pk (StudentPrincipal không có .pk).
    # Chỉ kích hoạt ở view có khai báo `throttle_scope` → các view khác không bị ảnh hưởng.
    "DEFAULT_THROTTLE_CLASSES": [
        "core.api.throttling.HubScopedRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        # Nới rộng để tránh chặn nhầm khi nhiều SV dùng chung IP (NAT ký túc xá/wifi trường)
        "login": os.getenv("THROTTLE_LOGIN", "30/min"),
        "create_request": os.getenv("THROTTLE_CREATE_REQUEST", "60/hour"),
    },
}

# Số lớp proxy tin cậy phía trước (Nginx=1, có thêm Cloudflare=2). Để DRF throttle
# lấy đúng IP client thật từ X-Forwarded-For thay vì IP của proxy (nếu không mọi
# người sẽ chung một "xô" đếm → chặn nhầm hàng loạt). Local không proxy → vẫn đúng
# vì không có X-Forwarded-For thì DRF dùng REMOTE_ADDR.
NUM_PROXIES = int(os.getenv("NUM_PROXIES", "1"))

# ── SimpleJWT ────────────────────────────────────────────────────────────────
SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(hours=8),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "ROTATE_REFRESH_TOKENS": True,
    "ALGORITHM": "HS256",
    "SIGNING_KEY": SECRET_KEY,
    "AUTH_HEADER_TYPES": ("Bearer",),
    "USER_ID_CLAIM": "ldap_uid",
}

# ── CORS ─────────────────────────────────────────────────────────────────────
# Dev: browser (localhost:3000) gọi thẳng Django → cần CORS.
# Prod: cùng domain qua Nginx (/api) → về lý thuyết không cần CORS, nhưng vẫn khai
# báo theo FRONTEND_ORIGINS để an toàn nếu sau này tách domain frontend.
CORS_ALLOWED_ORIGINS = FRONTEND_ORIGINS
CORS_ALLOW_CREDENTIALS = True
CORS_URLS_REGEX = r"^/api/.*$"

# ── Tắt migrations cho tất cả custom apps — schema quản lý thủ công ──────────
MIGRATION_MODULES = {
    "core": None,
    "students": None,
}

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "auth": {
            "format": "{asctime} | {levelname:<5} | {message}",
            "style": "{",
            "datefmt": "%Y-%m-%d %H:%M:%S",
        },
        "app": {
            "format": "{asctime} | {levelname:<5} | {name} | {message}",
            "style": "{",
            "datefmt": "%Y-%m-%d %H:%M:%S",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "auth",
        },
        "auth_file": {
            "class": "logging.handlers.RotatingFileHandler",
            "filename": BASE_DIR / "logs" / "auth.log",
            "maxBytes": 5 * 1024 * 1024,  # 5MB
            "backupCount": 5,
            "encoding": "utf-8",
            "formatter": "auth",
        },
        "app_file": {
            "class": "logging.handlers.RotatingFileHandler",
            "filename": BASE_DIR / "logs" / "app.log",
            "maxBytes": 5 * 1024 * 1024,
            "backupCount": 5,
            "encoding": "utf-8",
            "formatter": "app",
        },
    },
    "loggers": {
        # Auth actions: login, logout, LDAP steps
        "core.auth": {
            "handlers": ["auth_file", "console"],
            "level": "DEBUG",
            "propagate": False,
        },
        "core.api.views": {
            "handlers": ["auth_file", "console"],
            "level": "INFO",
            "propagate": False,
        },
        # Django errors
        "django": {
            "handlers": ["app_file", "console"],
            "level": "WARNING",
            "propagate": False,
        },
    },
}
