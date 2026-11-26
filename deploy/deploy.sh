#!/usr/bin/env bash
# Deploy the current working copy from this laptop to the server:
#   ./deploy/deploy.sh            (uses the "axe" host from ~/.ssh/config)
#   SERVER=ubuntu@1.2.3.4 ./deploy/deploy.sh
#
# The new images are built while the old site keeps running; if the build or the
# migrations fail, nothing is switched over.
set -euo pipefail
cd "$(dirname "$0")/.."

SERVER="${SERVER:-axe}"
DIR=/opt/axespareparts

echo "== Uploading code to $SERVER"
rsync -az --delete \
  --exclude .git --exclude .env --exclude backups \
  --exclude 'frontend/node_modules' --exclude 'frontend/dist' \
  --exclude 'backend/.venv' --exclude 'backend/.env*' --exclude 'backend/.models' \
  --exclude 'backend/media' --exclude 'backend/private_media' --exclude 'backend/staticfiles' \
  --exclude '__pycache__' --exclude '.dev-*' \
  ./ "$SERVER:$DIR/"

echo "== Building, migrating and restarting"
ssh "$SERVER" bash -se <<EOF
set -euo pipefail
cd $DIR
docker compose build api caddy
docker compose up -d db redis
docker compose run --rm -T api python manage.py migrate --noinput </dev/null
docker compose run --rm -T api python manage.py seed </dev/null
docker compose up -d --remove-orphans
docker image prune -f >/dev/null
EOF

host="$(ssh "$SERVER" "grep -E '^SITE_ADDRESS=' $DIR/.env | cut -d= -f2-")"
echo "== Checking https://$host/healthz"
for i in $(seq 1 20); do
  if curl -fsS "https://$host/healthz" >/dev/null 2>&1; then
    echo "Live: https://$host"
    exit 0
  fi
  sleep 3
done
echo "!! Site did not answer. Check logs: ssh $SERVER 'cd $DIR && docker compose logs --tail 100 api caddy'"
exit 1
