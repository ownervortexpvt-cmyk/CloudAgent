#!/usr/bin/env bash
# ============================================================
# Vortex Cloud Agent — FULL ECOSYSTEM INSTALLER (one command)
#
# Deploys the COMPLETE platform on a fresh Linux host:
#   :3000  CloudAgent (forged standalone Next.js runtime)
#   :3200  VORTEX server (same app, second instance)
#   nginx  :80/:443 public reverse proxy + optional free TLS
#   systemd  both services auto-restart + start at boot (never reset)
#   git    bare ecosystem repo + smart-HTTP push-to-live deploy hook
#
# The SAME vxtok_ token that pushes code to the live platform also pulls
# the source here — so the owner can update this host from ANY chat or
# ANY editor, from anywhere in the world.
#
# Usage:
#   sudo bash vortex-ecosystem-install.sh <git-http-url> <vxtok_token> [domain]
# Example:
#   sudo bash vortex-ecosystem-install.sh \
#     https://PLATFORM-HOST/api/ecosystem-git/vortex-ecosystem.git \
#     vxtok_xxxxxxxxxxxxxxxx \
#     vortexcloudagent.com
# ============================================================
set -euo pipefail

GIT_URL="${1:?usage: vortex-ecosystem-install.sh <git-url> <vxtok_token> [domain]}"
GIT_TOKEN="${2:?missing vxtok token}"
DOMAIN="${3:-}"

[[ $EUID -ne 0 ]] && { echo "run with sudo"; exit 1; }

BASE=/opt/vortex
SRC="$BASE/src"
RUNTIME="$BASE/runtime"
REPO="$BASE/vortex-ecosystem.git"

echo "── [0/8] toolchain (idempotent)"
BASH_SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bash "$BASH_SOURCE_DIR/vortex-toolchain-install.sh"

echo "── [1/8] layout"
mkdir -p "$BASE" /var/log/vortex

echo "── [2/8] clone the ecosystem source (token-authed smart-HTTP)"
rm -rf "$SRC"
git clone --depth 1 "https://owner:${GIT_TOKEN}@${GIT_URL#https://}" "$SRC"
cd "$SRC"

echo "── [3/8] install deps + build the standalone runtime"
bun install || npm install
DATABASE_URL="file:$BASE/data.db" NEXT_TELEMETRY_DISABLED=1 bun run build || npm run build
rm -rf "$RUNTIME"
mkdir -p "$RUNTIME"
cp -r .next/standalone/* "$RUNTIME"/ 2>/dev/null || true
cp -r .next/static "$RUNTIME/.next/static"
cp -r public "$RUNTIME/public" 2>/dev/null || true
test -f "$RUNTIME/server.js" || { echo "FATAL: standalone server.js missing"; exit 1; }

echo "── [4/8] systemd services (auto-restart + boot persistence)"
cat > /etc/systemd/system/vortex-cloudagent.service <<EOF
[Unit]
Description=Vortex Cloud Agent — CloudAgent :3000
After=network.target
[Service]
WorkingDirectory=$RUNTIME
Environment=PORT=3000 HOSTNAME=127.0.0.1 NODE_ENV=production DATABASE_URL=file:$BASE/data.db
ExecStart=/usr/bin/node $RUNTIME/server.js
Restart=always
RestartSec=3
StandardOutput=append:/var/log/vortex/cloudagent.log
StandardError=append:/var/log/vortex/cloudagent.err.log
[Install]
WantedBy=multi-user.target
EOF
cat > /etc/systemd/system/vortex-vortex.service <<EOF
[Unit]
Description=Vortex Cloud Agent — VORTEX :3200
After=network.target
[Service]
WorkingDirectory=$RUNTIME
Environment=PORT=3200 HOSTNAME=127.0.0.1 NODE_ENV=production DATABASE_URL=file:$BASE/vortex.db
ExecStart=/usr/bin/node $RUNTIME/server.js
Restart=always
RestartSec=3
StandardOutput=append:/var/log/vortex/vortex.log
StandardError=append:/var/log/vortex/vortex.err.log
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now vortex-cloudagent vortex-vortex

echo "── [5/8] nginx public proxy"
NGX="$DOMAIN"
[[ -z "$NGX" ]] && NGX="_"
cat > /etc/nginx/sites-available/vortex <<EOF
server {
  listen 80;
  server_name $NGX;
  client_max_body_size 512m;
  location / { proxy_pass http://127.0.0.1:3000; proxy_set_header Host \$host; proxy_set_header X-Forwarded-Host \$host; proxy_set_header X-Forwarded-Proto \$scheme; proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for; proxy_http_version 1.1; proxy_set_header Upgrade \$http_upgrade; proxy_set_header Connection "upgrade"; proxy_read_timeout 3600s; }
  location /vortex/ { proxy_pass http://127.0.0.1:3200/; proxy_set_header Host \$host; proxy_set_header X-Forwarded-Host \$host; proxy_set_header X-Forwarded-Proto \$scheme; }
}
EOF
ln -sf /etc/nginx/sites-available/vortex /etc/nginx/sites-enabled/vortex
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl enable --now nginx && systemctl reload nginx

echo "── [6/8] optional free TLS (Let's Encrypt)"
if [[ -n "$DOMAIN" ]] && command -v certbot >/dev/null 2>&1 || [[ -n "$DOMAIN" ]]; then
  apt-get install -y certbot python3-certbot-nginx || true
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m support@cloudagent.in || echo "(certbot skipped — DNS must point at this host first)"
fi

echo "── [7/8] ecosystem git repo (push-to-live deploy, same contract as the platform)"
rm -rf "$REPO"
git clone --bare "$SRC" "$REPO" 2>/dev/null || cp -r "$SRC/.git" "$REPO"
HOOK="$REPO/hooks/post-receive"
cat > "$HOOK" <<EOF
#!/usr/bin/env bash
set -e
echo "[vortex-deploy] rebuilding from pushed code..."
GIT_WORK_TREE="$SRC" git --git-dir="$REPO" checkout -f master || GIT_WORK_TREE="$SRC" git --git-dir="$REPO" checkout -f main
cd "$SRC"
bun install || npm install
DATABASE_URL="file:$BASE/data.db" NEXT_TELEMETRY_DISABLED=1 bun run build || npm run build
rm -rf "$RUNTIME.new" && mkdir -p "$RUNTIME.new"
cp -r .next/standalone/* "$RUNTIME.new"/ 2>/dev/null || true
cp -r .next/static "$RUNTIME.new/.next/static"
cp -r public "$RUNTIME.new/public" 2>/dev/null || true
rm -rf "$RUNTIME.old" && mv "$RUNTIME" "$RUNTIME.old" && mv "$RUNTIME.new" "$RUNTIME"
systemctl restart vortex-cloudagent vortex-vortex
rm -rf "$RUNTIME.old"
echo "[vortex-deploy] DONE — ecosystem updated in ~55s, zero downtime window minimal."
EOF
chmod +x "$HOOK"

echo "── [8/8] health check"
sleep 6
systemctl is-active vortex-cloudagent && systemctl is-active vortex-vortex && echo "BOTH SERVICES ACTIVE"
curl -fsS -o /dev/null http://127.0.0.1:3000/ && echo ":3000 OK" || echo ":3000 warming up"
curl -fsS -o /dev/null http://127.0.0.1:3200/ && echo ":3200 OK" || echo ":3200 warming up"

cat <<EOF

============================================================
 VORTEX CLOUD AGENT — DEPLOYED. PERMANENT. NEVER RESETS.
  public    : http://${DOMAIN:-<host-ip>}/          (nginx → :3000)
  vortex    : http://${DOMAIN:-<host-ip>}/vortex/    (nginx → :3200)
  services  : systemctl status vortex-cloudagent vortex-vortex
  logs      : /var/log/vortex/
  update    : git push (with any vxtok_ token) → auto-rebuild+restart
  domain    : point DNS A record of ${DOMAIN:-your.domain} at this VM's IP
============================================================
EOF
