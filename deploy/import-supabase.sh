#!/usr/bin/env bash
# One-time: copy the data from Supabase into the server's Postgres. Run on the server:
#   SUPABASE_URL='postgresql://...:5432/postgres?sslmode=require' ./deploy/import-supabase.sh
# Replaces whatever is in the local database's public schema.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${SUPABASE_URL:?set SUPABASE_URL to the Supabase session-pooler connection string}"

mkdir -p backups
dump="backups/supabase-$(date +%Y-%m-%d-%H%M).dump"
echo "== Dumping Supabase (public schema)"
docker run --rm -e SUPABASE_URL postgres:17-alpine \
  sh -c 'pg_dump "$SUPABASE_URL" -Fc --no-owner --no-acl --schema=public' > "$dump"
ls -lh "$dump"

echo "== Restoring into the local database"
docker compose stop api worker || true
docker compose up -d db
docker compose exec -T db psql -U axe -d axespareparts -v ON_ERROR_STOP=1 \
  -c 'DROP SCHEMA IF EXISTS public CASCADE;'   # the dump recreates it
docker compose exec -T db pg_restore -U axe -d axespareparts --no-owner --no-acl < "$dump"

docker compose run --rm -T api python manage.py migrate --noinput
docker compose up -d
echo "Done. Supabase dump kept at $dump"
