"""
Axe Spare Parts — Django settings.

Every deploy-time value comes from the environment (see .env.example).
Business settings that change over time (markup, low-stock threshold, …)
live in the database and are edited from the admin portal, not here.
"""

import os
import sys
from datetime import timedelta  # noqa: F401  (handy for future token/expiry settings)
from pathlib import Path

import dj_database_url
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def env_bool(name: str, default: bool = False) -> bool:
    return os.getenv(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}


def env_list(name: str, default: str = "") -> list[str]:
    return [item.strip() for item in os.getenv(name, default).split(",") if item.strip()]


DEBUG = env_bool("DEBUG", False)
SECRET_KEY = os.getenv("SECRET_KEY") or ("dev-insecure-key-change-me" if DEBUG else "")
if not SECRET_KEY:
    raise RuntimeError("SECRET_KEY must be set when DEBUG is off.")

ALLOWED_HOSTS = env_list("ALLOWED_HOSTS", "localhost,127.0.0.1")
RENDER_EXTERNAL_HOSTNAME = os.getenv("RENDER_EXTERNAL_HOSTNAME")
if RENDER_EXTERNAL_HOSTNAME:
    ALLOWED_HOSTS.append(RENDER_EXTERNAL_HOSTNAME)

# The public URL of the React app. On Render the static site rewrites /api/*
# to this backend, so the browser sees one origin and session cookies work.
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # third party
    "rest_framework",
    "django_filters",
    "corsheaders",
    "drf_spectacular",
    # project modules
    "apps.core",
    "apps.accounts",
    "apps.suppliers",
    "apps.catalogue",
    "apps.inventory",
    "apps.notifications",
    "apps.customers",
    "apps.orders",
    "apps.payments",
    "apps.deliveries",
    "apps.support",
    "apps.reports",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

DATABASES = {
    "default": dj_database_url.config(
        default=os.getenv("DATABASE_URL", "postgres:///axespareparts"),
        # Reuse connections in production. The threaded dev server would hold one per request thread
        # and run Postgres out of slots, so close them after each request locally.
        conn_max_age=0 if DEBUG else 600,
        conn_health_checks=True,
    )
}

AUTH_USER_MODEL = "accounts.User"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 8}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "Africa/Nairobi"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}

# Local fallback for uploads when Cloudinary isn't configured (development only).
MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"
PRIVATE_MEDIA_ROOT = BASE_DIR / "private_media"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --- Cloudinary ---------------------------------------------------------------
# Format: cloudinary://<api_key>:<api_secret>@<cloud_name>
CLOUDINARY_URL = os.getenv("CLOUDINARY_URL", "")
CLOUDINARY_FOLDER = os.getenv("CLOUDINARY_FOLDER", "axespareparts")
if CLOUDINARY_URL:
    import cloudinary

    cloudinary.config(cloudinary_url=CLOUDINARY_URL, secure=True)
elif not DEBUG:
    raise RuntimeError("CLOUDINARY_URL must be set when DEBUG is off.")

MAX_IMAGE_UPLOAD_MB = 5
MAX_IMAGE_PIXELS = 40_000_000  # ~40 MP; bigger images are rejected (decompression bombs)
MAX_IMAGE_SIDE = 2400  # longest side after upload; larger photos are scaled down
MAX_PRODUCT_IMAGES = 8
# Product photos: cut the part out of its background (rembg, runs on the CPU). See apps/core/background.py.
BACKGROUND_REMOVAL = env_bool("BACKGROUND_REMOVAL", "test" not in sys.argv[1:2])
BACKGROUND_MODEL = os.getenv("BACKGROUND_MODEL", "isnet-general-use")
BACKGROUND_MODEL_DIR = Path(os.getenv("BACKGROUND_MODEL_DIR", BASE_DIR / ".models"))
# In production the model is downloaded at build time; never fetch 170 MB in the middle of a request.
BACKGROUND_MODEL_AUTO_DOWNLOAD = env_bool("BACKGROUND_MODEL_AUTO_DOWNLOAD", DEBUG)
BACKGROUND_THREADS = int(os.getenv("BACKGROUND_THREADS", "2"))
MAX_DOCUMENT_UPLOAD_MB = 10
DATA_UPLOAD_MAX_MEMORY_SIZE = 12 * 1024 * 1024
FILE_UPLOAD_MAX_MEMORY_SIZE = 12 * 1024 * 1024

# --- REST framework -----------------------------------------------------------
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.SessionAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.AllowAny"],
    "DEFAULT_FILTER_BACKENDS": [
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ],
    "DEFAULT_PAGINATION_CLASS": "apps.core.pagination.StandardPagination",
    "PAGE_SIZE": 24,
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_THROTTLE_CLASSES": ["rest_framework.throttling.ScopedRateThrottle"],
    "DEFAULT_THROTTLE_RATES": {"auth": "20/min"},
}

SPECTACULAR_SETTINGS = {
    "TITLE": "Axe Spare Parts API",
    "VERSION": "0.1.0",
    "SERVE_INCLUDE_SCHEMA": False,
}

# --- Sessions, CSRF, CORS -----------------------------------------------------
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_AGE = 60 * 60 * 24 * 14
CSRF_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_HTTPONLY = False  # the SPA reads it to send X-CSRFToken
CSRF_TRUSTED_ORIGINS = env_list("CSRF_TRUSTED_ORIGINS", FRONTEND_URL)
CORS_ALLOWED_ORIGINS = env_list("CORS_ALLOWED_ORIGINS", FRONTEND_URL)
CORS_ALLOW_CREDENTIALS = True
# Google sign-in opens a popup that must be able to talk back to this page.
SECURE_CROSS_ORIGIN_OPENER_POLICY = "same-origin-allow-popups"

if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SECURE_SSL_REDIRECT = env_bool("SECURE_SSL_REDIRECT", True)
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = 60 * 60 * 24 * 30
    SECURE_CONTENT_TYPE_NOSNIFF = True

# --- Celery -------------------------------------------------------------------
# Without REDIS_URL, tasks run inline so the app works with no worker attached.
REDIS_URL = os.getenv("REDIS_URL", "")
CELERY_BROKER_URL = REDIS_URL or "memory://"
CELERY_RESULT_BACKEND = None
CELERY_TASK_ALWAYS_EAGER = not REDIS_URL
CELERY_TASK_EAGER_PROPAGATES = False
CELERY_TIMEZONE = TIME_ZONE

if REDIS_URL:
    CACHES = {"default": {"BACKEND": "django.core.cache.backends.redis.RedisCache", "LOCATION": REDIS_URL}}

# --- Email (Brevo SMTP in production; console in development) ----------------
EMAIL_BACKEND = os.getenv("EMAIL_BACKEND", "django.core.mail.backends.console.EmailBackend")
EMAIL_HOST = os.getenv("EMAIL_HOST", "smtp-relay.brevo.com")
EMAIL_PORT = int(os.getenv("EMAIL_PORT", "587"))
# Give up on an unreachable mail server quickly instead of holding the request (and worker) open.
EMAIL_TIMEOUT = int(os.getenv("EMAIL_TIMEOUT", "15"))
# Used by apps.notifications.brevo.BrevoEmailBackend (HTTPS API, for hosts that block SMTP).
BREVO_API_KEY = os.getenv("BREVO_API_KEY", "")
EMAIL_HOST_USER = os.getenv("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.getenv("EMAIL_HOST_PASSWORD", "")
EMAIL_USE_TLS = True
DEFAULT_FROM_EMAIL = os.getenv("DEFAULT_FROM_EMAIL", "Axe Spare Parts <no-reply@axespareparts.local>")

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": os.getenv("LOG_LEVEL", "INFO")},
}
