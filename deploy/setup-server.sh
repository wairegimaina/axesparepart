#!/usr/bin/env bash
# One-time server setup for a fresh Ubuntu VPS. Run on the server as the default user:
#   sudo bash /opt/axespareparts/deploy/setup-server.sh
# Safe to re-run.
set -euo pipefail

APP_USER="${SUDO_USER:-ubuntu}"
APP_DIR=/opt/axespareparts

echo "== Packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get upgrade -yq
apt-get install -yq ca-certificates curl rsync ufw fail2ban unattended-upgrades rclone

echo "== Docker"
if ! command -v docker >/dev/null; then
  apt-get install -yq docker.io docker-compose-v2 || curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker
usermod -aG docker "$APP_USER"

echo "== Swap (2 GB safety net)"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
sysctl -q -w vm.swappiness=10
echo 'vm.swappiness=10' > /etc/sysctl.d/99-axe.conf

echo "== Firewall"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

echo "== SSH: keys only, no root login"
if [ -s "/home/$APP_USER/.ssh/authorized_keys" ]; then
  cat > /etc/ssh/sshd_config.d/99-axe.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
EOF
  systemctl reload ssh || systemctl reload sshd
else
  echo "!! No SSH key in /home/$APP_USER/.ssh/authorized_keys; leaving password login ON."
fi

echo "== Automatic security updates"
dpkg-reconfigure -f noninteractive unattended-upgrades
systemctl enable --now fail2ban

echo "== App directory and nightly backup"
mkdir -p "$APP_DIR/backups"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
cat > /etc/cron.d/axespareparts-backup <<EOF
# Nightly database backup at 03:00 server time.
0 3 * * * $APP_USER $APP_DIR/deploy/backup.sh >> $APP_DIR/backups/backup.log 2>&1
EOF

echo "Done. Log out and back in once so '$APP_USER' can use docker without sudo."
