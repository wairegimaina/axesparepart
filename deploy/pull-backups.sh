#!/usr/bin/env bash
# Copy the server's database backups to this laptop (~/axespareparts-backups).
set -euo pipefail
SERVER="${SERVER:-axe}"
mkdir -p ~/axespareparts-backups
rsync -av "$SERVER:/opt/axespareparts/backups/"'*.dump' ~/axespareparts-backups/
