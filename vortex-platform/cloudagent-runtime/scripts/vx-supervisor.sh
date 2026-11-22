#!/usr/bin/env bash
# Self-contained :3200 supervisor — the node process ALWAYS has a live parent
# (this loop), so sandbox orphan-reaping never hits the server. Correct env
# per dev-watchdog start_vortex contract (v140.1/v140.2 absolute paths).
BASE=/home/z/my-project
VORTEX_DIR="$BASE/vortex-platform/server/VORTEX_SERVER"
VX_TICK=$(tr -d '\n' < "$VORTEX_DIR/.tick-secret" 2>/dev/null || echo vxtick_fallback_2026)
cd "$VORTEX_DIR"
while true; do
  if curl -s -o /dev/null --max-time 5 http://127.0.0.1:3200/ 2>/dev/null; then
    sleep 15
    continue
  fi
  for vpid in $(ss -tlnp 2>/dev/null | grep ':3200 ' | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u); do
    kill "$vpid" 2>/dev/null
  done
  sleep 1
  if [ ! -f "$VORTEX_DIR/.next/standalone/server.js" ]; then
    echo "$(date '+%F %T') standalone missing — waiting for rebuild" >> "$VORTEX_DIR/vs-prod.log"
    sleep 30
    continue
  fi
  echo "$(date '+%F %T') supervisor starting vortex (:3200)" >> "$VORTEX_DIR/vs-prod.log"
  env PORT=3200 HOSTNAME=127.0.0.1 NODE_ENV=production NODE_OPTIONS="--max-old-space-size=512" \
    DATABASE_URL="file:$VORTEX_DIR/db/custom.db" \
    VORTEX_STORAGE_ROOT="$VORTEX_DIR/storage-pool" \
    VX_TICK_SECRET="$VX_TICK" \
    node "$VORTEX_DIR/.next/standalone/server.js" >> "$VORTEX_DIR/vs-prod.log" 2>&1 &
  NP=$!
  wait $NP
  echo "$(date '+%F %T') vortex exited code=$? — respawn in 3s" >> "$VORTEX_DIR/vs-prod.log"
  sleep 3
done
