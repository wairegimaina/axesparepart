# Django API image (used by docker-compose.yml for the api and worker services).
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    BACKGROUND_MODEL_DIR=/models

RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

# Product photo background-removal model (~170 MB). Its own layer, before the code is copied,
# so code changes don't download it again. rembg saves it under $U2NET_HOME/models/<name>/.
RUN U2NET_HOME=/models python -c "from rembg import new_session; new_session('isnet-general-use')" \
    && test -f /models/models/isnet-general-use/isnet-general-use.onnx \
    && chmod -R a+rX /models

COPY . .
RUN DEBUG=true python manage.py collectstatic --noinput \
    && useradd --system --uid 1000 --home /app app \
    && chown -R app /app

USER app
EXPOSE 8000
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "2", "--threads", "4", "--timeout", "120"]
