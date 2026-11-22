#!/usr/bin/env bash
# Build CURRENT source in the janitor-protected zone, stage the standalone.
# Activate later with scripts/swap-server.sh. Log: build-v162.log
set -u
B=/home/z/my-project/vortex-platform/server/CLOUDAGENT_BUILD
LOG=/home/z/my-project/build-v162.log
exec >>"$LOG" 2>&1
echo "[$(date '+%H:%M:%S')] === build start (free: $(df -h / | tail -1 | awk '{print $4}')) ==="
cd "$B" || { echo "cd failed"; exit 1; }

if [ ! -e node_modules/.bin/next ]; then
  echo "[build] bun install"
  bun install --frozen-lockfile || { echo "[build] FATAL bun install failed"; exit 1; }
fi
[ -e node_modules/.bin/next ] || { echo "[build] FATAL no next binary"; exit 1; }
echo "[build] deps OK (free: $(df -h / | tail -1 | awk '{print $4}'))"

echo "[build] prisma generate"
node_modules/.bin/prisma generate || echo "[build] WARN prisma generate failed"

echo "[build] next build starting"
node_modules/.bin/next build
RC=$?
echo "[build] next build exit=$RC (free: $(df -h / | tail -1 | awk '{print $4}'))"
[ "$RC" -eq 0 ] || { echo "[build] FATAL build failed"; exit 1; }
[ -f .next/standalone/server.js ] || { echo "[build] FATAL no standalone output"; exit 1; }

cp -r .next/static .next/standalone/.next/ 2>/dev/null
cp -r public .next/standalone/ 2>/dev/null

rm -rf /home/z/my-project/runtime-store/standalone-new
cp -r .next/standalone /home/z/my-project/runtime-store/standalone-new
echo "[build] standalone staged ($(du -sh /home/z/my-project/runtime-store/standalone-new | cut -f1))"

rm -rf "$B/node_modules" "$B/.next"
echo "[build] artifacts cleaned (free: $(df -h / | tail -1 | awk '{print $4}'))"
echo "[$(date '+%H:%M:%S')] === build done - run scripts/swap-server.sh to activate ==="
