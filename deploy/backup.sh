#!/usr/bin/env bash
# Dump the database to backups/, keep 14 days, and copy off the server if BACKUP_REMOTE is set.
# Runs nightly from cron (installed by setup-server.sh); safe to run by hand too.
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p backups
file="backups/axe-$(date +%Y-%m-%d-%H%M).dump"
docker compose exec -T db pg_dump -U axe -d axespareparts -Fc --no-owner > "$file.tmp"
mv "$file.tmp" "$file"
echo "$(date -Is) saved $file ($(du -h "$file" | cut -f1))"

find backups -name 'axe-*.dump' -mtime +14 -delete

remote="$(grep -E '^BACKUP_REMOTE=' .env 2>/dev/null | cut -d= -f2- || true)"
if [ -n "$remote" ] && command -v rclone >/dev/null; then
  rclone copy "$file" "$remote" && echo "$(date -Is) copied to $remote"
fi
