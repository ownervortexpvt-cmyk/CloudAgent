#!/usr/bin/env bash
# v165 ACTIVATE: stage the freshly built standalone into the runtime
# architecture (ROOT_RT first + FAST restart, then durable copies in the
# background — v166.4: the ossfs LIVE_RT/tarball/Joy steps used to BLOCK the
# restart for minutes on FUSE; the owner-facing restart must never wait on
# them). Log: build-v162.log
set -u
BASE=/home/z/my-project
STAGE=$BASE/runtime-store/standalone-new
ROOT_RT=$BASE/vortex-platform/cloudagent-runtime
LIVE_RT=/home/sync/runtime-live/cloudagent-runtime
LOG=$BASE/build-v162.log
exec >>"$LOG" 2>&1
echo "[$(date '+%H:%M:%S')] === activate start ==="

[ -f "$STAGE/server.js" ] || { echo "[activate] FATAL staged standalone missing"; exit 1; }
[ -f "$STAGE/.next/BUILD_ID" ] || { echo "[activate] FATAL staged BUILD_ID missing"; exit 1; }
NEW_BID=$(cat "$STAGE/.next/BUILD_ID")
echo "[activate] staged BUILD_ID=$NEW_BID"

# 1) ROOT_RT (rootfs spawn source — watchdog respawns from here)
rm -rf "$ROOT_RT"
mkdir -p "$ROOT_RT"
cp -a "$STAGE/." "$ROOT_RT/" || { echo "[activate] FATAL ROOT_RT copy failed"; exit 1; }
echo "[activate] ROOT_RT updated ($(du -sh "$ROOT_RT" | cut -f1))"

# 2) restart :3000 from the NEW ROOT_RT — exact watchdog respawn command
for vpid in $(ss -tlnp 2>/dev/null | grep ':3000 ' | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u); do
  kill "$vpid" 2>/dev/null
  echo "[activate] stopped old :3000 holder $vpid"
done
sleep 3
for vpid in $(ss -tlnp 2>/dev/null | grep ':3000 ' | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u); do
  kill -9 "$vpid" 2>/dev/null
done
setsid nohup bash -c "cd '$ROOT_RT' && set -a && . '$BASE/.env' 2>/dev/null; set +a; exec env PORT=3000 HOSTNAME=127.0.0.1 NODE_ENV=production NODE_OPTIONS='--max-old-space-size=1280' DATABASE_URL='file:$BASE/db/custom.db' node server.js >> '$BASE/ca-runtime.log' 2>&1" </dev/null >/dev/null 2>&1 &
echo "[activate] new server spawned from ROOT_RT"

# 3) wait for health
ok=0
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24; do
  sleep 5
  CODE=$(curl -s --max-time 6 -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/ 2>/dev/null)
  if [ "$CODE" != "000" ] && [ "$CODE" -lt 500 ] 2>/dev/null; then
    echo "[activate] :3000 healthy (HTTP $CODE) after ~$((i*5))s"
    ok=1
    break
  fi
done
[ "$ok" -eq 1 ] || { echo "[activate] WARN :3000 not up in 120s — watchdog will retry"; }

# 4) warm routes into RAM (janitor protection)
( sleep 5; bash "$BASE/scripts/warm-runtime.sh" ) </dev/null >/dev/null 2>&1 &
echo "[$(date '+%H:%M:%S')] === activate done (durable copies continue in background) ==="

# 5) DURABLE COPIES — background, never block the restart
(
  # LIVE_RT (durable serving copy on ossfs)
  rm -rf "$LIVE_RT.tmp"
  mkdir -p /home/sync/runtime-live "$LIVE_RT.tmp"
  if tar cf - -C "$ROOT_RT" . 2>/dev/null | tar xf - -C "$LIVE_RT.tmp" 2>/dev/null \
     && [ "$(cat "$LIVE_RT.tmp/.next/BUILD_ID" 2>/dev/null)" = "$NEW_BID" ]; then
    rm -rf "$LIVE_RT.old"
    mv "$LIVE_RT" "$LIVE_RT.old" 2>/dev/null
    mv "$LIVE_RT.tmp" "$LIVE_RT" && rm -rf "$LIVE_RT.old"
    echo "[activate] LIVE_RT synced (BUILD_ID $NEW_BID)"
  else
    rm -rf "$LIVE_RT.tmp"
    echo "[activate] LIVE_RT_SYNC_FAILED — watchdog will restore from tarball"
  fi
  # verified seed tarballs, both places
  tarball_saved=0
  for TGT in /home/sync/runtime-store "$BASE/runtime-store"; do
    mkdir -p "$TGT"
    if tar czf "$TGT/runtime.tar.new" -C "$BASE/vortex-platform" cloudagent-runtime 2>/dev/null \
       && mv "$TGT/runtime.tar.new" "$TGT/runtime.tar.gz" 2>/dev/null \
       && tar tzf "$TGT/runtime.tar.gz" 2>/dev/null | grep -q 'cloudagent-runtime/node_modules/next/package.json' \
       && tar tzf "$TGT/runtime.tar.gz" 2>/dev/null | grep -q 'cloudagent-runtime/.next/BUILD_ID'; then
      echo "[activate] RUNTIME_TARBALL_SAVED -> $TGT (verified)"
      tarball_saved=1
    else
      echo "[activate] RUNTIME_TARBALL_REJECT $TGT"
      rm -f "$TGT/runtime.tar.new"
    fi
  done
  [ "$tarball_saved" -eq 0 ] && echo "[activate] RUNTIME_TARBALL_ALL_REJECTED"
  # Joy S3 durable backup (owner's own storage)
  if [ -s /home/sync/runtime-store/runtime.tar.gz ]; then
    node "$BASE/scripts/joy-put.cjs" put /home/sync/runtime-store/runtime.tar.gz \
      vortex-websites vortex-platform-seeds/runtime-v158.tar.gz application/gzip >> "$LOG" 2>&1 \
      && echo "[activate] JOY_SEED_UPLOADED" \
      || echo "[activate] JOY_SEED_UPLOAD_FAILED"
  fi
  echo "[activate] durable-copies finished $(date '+%H:%M:%S')"
) </dev/null >>"$LOG" 2>&1 &
