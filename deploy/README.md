# Deploying to a VPS

One Ubuntu server runs everything with Docker Compose (`docker-compose.yml` in the repo root):

| Service | What it does |
|---|---|
| `caddy` | Serves the React build, proxies `/api`, `/django-admin`, `/static`, `/healthz` to Django, gets HTTPS certificates |
| `api` | Django + Gunicorn (`GUNICORN_WORKERS` x 4 threads), includes the background-removal model |
| `worker` | Celery (emails) |
| `db` | Postgres 17, data in the `pgdata` volume |
| `redis` | Celery broker and cache |

## First time

1. On the laptop, add to `~/.ssh/config`:
   ```
   Host axe
     HostName <server-ip>
     User ubuntu
     IdentityFile ~/.ssh/ovh_axe
   ```
   and install the key: `ssh-copy-id -i ~/.ssh/ovh_axe.pub ubuntu@<server-ip>`.
2. Copy the code and set up the server:
   ```
   ssh axe 'sudo mkdir -p /opt/axespareparts/deploy && sudo chown -R ubuntu: /opt/axespareparts'
   rsync -az deploy/ axe:/opt/axespareparts/deploy/
   ssh axe 'sudo bash /opt/axespareparts/deploy/setup-server.sh'
   ```
3. Create `/opt/axespareparts/.env` from `deploy/env.example`.
   No domain yet? Use `SITE_ADDRESS=<ip-with-dashes>.sslip.io`.
4. `./deploy/deploy.sh`
5. Optional, moving off Supabase: on the server,
   `SUPABASE_URL='postgresql://…' ./deploy/import-supabase.sh`.

## Every update

```
./deploy/deploy.sh
```
Uploads the working copy, builds, migrates, restarts, then checks `https://<site>/healthz`.
If the build or migrations fail, the old version keeps running.

## Backups

- Nightly at 03:00: `deploy/backup.sh` writes `backups/axe-<date>.dump` (kept 14 days).
- Off the server: set `BACKUP_REMOTE` in `.env` to an rclone remote (e.g. Cloudflare R2), or
  run `./deploy/pull-backups.sh` on the laptop to copy them to `~/axespareparts-backups`.
- Restore one (also how to move to a new server): copy the `.dump` into `backups/` on the server, then
  `./deploy/restore.sh backups/<file>.dump`. It saves a safety copy of the current database first.
- Copy the server's backups to the laptop (`~/axespareparts-backups`): `./deploy/pull-backups.sh`.
  To do it daily at 13:00, add to `crontab -e`:
  `0 13 * * * /home/cirqen/Desktop/axespareparts/deploy/pull-backups.sh >> $HOME/axespareparts-backups/pull.log 2>&1`
- The provider's disk snapshots (Google: 7 daily) are a separate, extra layer.

## Useful commands (on the server, in /opt/axespareparts)

```
docker compose ps                     # what's running
docker compose logs -f --tail 100 api # Django logs
docker compose exec api python manage.py createsuperuser
docker compose exec db psql -U axe axespareparts
```
