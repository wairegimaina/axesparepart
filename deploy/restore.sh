#!/usr/bin/env bash
# Replace the server's database with a backup. Used when moving to a new server
# or recovering from a mistake. Run on the server, in /opt/axespareparts:
#   ./deploy/restore.sh backups/axe-2026-11-26-0300.dump
# Works with nightly backups (backup.sh) and Supabase dumps (import-supabase.sh).
set -euo pipefail
cd "$(dirname "$0")/.."
file="${1:?usage: deploy/restore.sh <backup.dump>}"
[ -f "$file" ] || { echo "No such file: $file" >&2; exit 1; }

echo "== Safety copy of the current database first"
docker compose up -d db
until docker compose exec -T db pg_isready -U axe -d axespareparts >/dev/null 2>&1; do sleep 2; done
if docker compose exec -T db psql -U axe -d axespareparts -tAc "select to_regclass('public.django_migrations')" | grep -q django; then
  ./deploy/backup.sh
fi

echo "== Recreating the database from $file"
docker compose stop api worker || true
docker compose exec -T db psql -U axe -d postgres -v ON_ERROR_STOP=1 \
  -c 'DROP DATABASE IF EXISTS axespareparts WITH (FORCE);' \
  -c 'CREATE DATABASE axespareparts OWNER axe;'
# --clean --if-exists: recreates the public schema when the dump carries it, and is a no-op otherwise.
docker compose exec -T db pg_restore -U axe -d axespareparts --no-owner --no-acl --clean --if-exists \
  --exit-on-error < "$file"

docker compose run --rm -T api python manage.py migrate --noinput </dev/null
docker compose up -d
echo "Restored $file"
