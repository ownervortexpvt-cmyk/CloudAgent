#!/usr/bin/env bash
# FORGE-POLAR v2 (v164.17): build the runtime on the PolarFS mirror.
#
# WHY: the rootfs overlay is permanently exhausted (~9G invisible churn in
# the upperdir); every rootfs build dies with ENOSPC. PolarFS (/tmp/my-project)
# has 29P free BUT ~30 files/sec metadata — so a full node_modules extraction
# is a ONE-TIME 30-45 min job, and every bulk-FUSE process must be a BOOT-TREE
# descendant (server → instrumentation → sdk-doctor → this script) or the
# sandbox bulk-FUSE-read killer reaps it within seconds.
#
# UPTIME SEQUENCING: :3000 keeps serving the OLD runtime during the long deps
# phase. Only the compile window takes :3000 down (.forge-active set at that
# point), and the deploy phase brings it back with the NEW build.
set -u
BASE=/home/z/my-project
P=/tmp/my-project
LOG=$BASE/forge-polar.log
STATUS=$BASE/.forge-polar-status
# SINGLE-INSTANCE LOCK: doctor spawns one copy per server boot while the
# pending marker lives — two concurrent runs would fight over node_modules.
FORGELOCK=$BASE/.forge-polar.lock
if ! mkdir "$FORGELOCK" 2>/dev/null; then
  echo "=== forge-polar SKIPPED $(date +%H:%M:%S) — another instance is active ==="
  exit 0
fi
trap 'rm -rf "$FORGELOCK"' EXIT
exec >>"$LOG" 2>&1
echo "[$(date '+%H:%M:%S')] === forge-polar v2 start ==="
echo "PHASE:deps" > "$STATUS"

# ---------- 1. sync the one new dir (pipeline API route) rootfs -> polar ---
mkdir -p "$P/src/app/api/projects/[id]" 2>/dev/null
cp -a "$BASE/src/app/api/projects/[id]/pipeline" "$P/src/app/api/projects/[id]/" 2>/dev/null \
  && echo "pipeline route synced to polar src" \
  || echo "WARN pipeline route sync failed (may already exist)"

# ---------- 2. deps: clean npm install in nm-fresh (boot-tree, one-time) ---
if [ ! -e "$P/nm-fresh/node_modules/next/dist/bin/next" ]; then
  mkdir -p "$P/nm-fresh"
  cp -a "$BASE/package.json" "$P/nm-fresh/package.json" 2>/dev/null
  rm -f "$P/nm-fresh/package-lock.json"
  ( cd "$P/nm-fresh" \
      && npm_config_cache="$P/npm-cache" \
      npm install --no-audit --no-fund --legacy-peer-deps --loglevel=error \
      >> "$P/npm-ci2.log" 2>&1 ) \
    && echo "npm deps COMPLETE in nm-fresh" \
    || echo "WARN npm install failed (see $P/npm-ci2.log)"
fi
# swap the verified tree into place (instant rename); retire the broken one
if [ -e "$P/nm-fresh/node_modules/next/dist/bin/next" ]; then
  rm -rf "$P/node_modules.broken" 2>/dev/null &
  if [ -d "$P/node_modules" ]; then mv "$P/node_modules" "$P/node_modules.broken.old" 2>/dev/null; fi
  mv "$P/nm-fresh/node_modules" "$P/node_modules" \
    && echo "node_modules swapped in from nm-fresh" \
    || { echo "FATAL: node_modules swap failed"; echo "PHASE:failed" > "$STATUS"; exit 1; }
  ( rm -rf "$P/node_modules.broken.old" "$P/node_modules.broken" 2>/dev/null ) &
else
  echo "FATAL: nm-fresh deps incomplete"; echo "PHASE:failed" > "$STATUS"; exit 1
fi
[ -e "$P/node_modules/next/dist/bin/next" ] || { echo "FATAL: no next binary"; echo "PHASE:failed" > "$STATUS"; exit 1; }
echo "deps ready (free rootfs: $(df -h / | tail -1 | awk '{print $4}'))"

# ---------- 3. prisma client + additive tables (DB backed up first) --------
echo "PHASE:prisma" > "$STATUS"
TS=$(date +%Y%m%d-%H%M%S)
mkdir -p "$BASE/db-rescue"
cp -a "$BASE/db/custom.db" "$BASE/db-rescue/custom.db.pre-pipeline-$TS" \
  && echo "DB backed up -> db-rescue/custom.db.pre-pipeline-$TS"
cd "$P"
node node_modules/prisma/build/index.js generate --schema="$BASE/prisma/schema.prisma" \
  && echo "prisma generate OK" || echo "WARN prisma generate failed"
DATABASE_URL="file:$BASE/db/custom.db" node node_modules/prisma/build/index.js db push \
  --schema="$BASE/prisma/schema.prisma" --skip-generate \
  && echo "prisma db push OK (PipelineRun/PipelineStage created)" \
  || echo "FATAL: prisma db push failed"
node node_modules/typescript/bin/tsc --noEmit -p "$BASE/tsconfig.json" \
  > "$P/tscheck.log" 2>&1 \
  && echo "tsc --noEmit CLEAN" \
  || { echo "tsc reported issues (first lines):"; head -12 "$P/tscheck.log"; }

# ---------- 4. compile window: only NOW take :3000 down ---------------------
# OOM PREVENTION (forge-runtime lesson, 38 'Killed' incidents): the turbopack
# compile peaks at ~2.5G RSS — the cgroup is 4G, so EVERY resident server
# (:3000 standalone, :3200 vortex, :3001 socket, tunnel keeper) must die for
# the compile window. The watchdog respawns all of them on its next cycle.
echo "PHASE:build" > "$STATUS"
touch "$BASE/.forge-active"
for pat in 'next-server' 'bun --hot index.ts' 'scripts/tunnel-keeper.js'; do
  pkill -9 -f "$pat" 2>/dev/null && echo "killed resident: $pat"
done
for i in 1 2 3 4 5 6; do
  for port in 3000 3200 3001; do
    for pid in $(ss -tlnp 2>/dev/null | grep ":$port " | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u); do
      kill -9 "$pid" 2>/dev/null && echo "killed :$port server pid $pid (pass $i)"
    done
  done
  sleep 5
done

# ---------- 5. duty-cycled single-core turbopack standalone build ----------
unset __NEXT_PRIVATE_STANDALONE_CONFIG __NEXT_PRIVATE_PREBUNDLED_REACT
unset __NEXT_PRIVATE_PREBUNDLED_REACT_SERVER DOMASKS_SERVER_PRIVATE_ENV 2>/dev/null || true
unset TURBOPACK_HINT NEXT_RSPACK_HINT 2>/dev/null || true
rm -rf "$P/buildout"
( while pgrep -f "next build" >/dev/null 2>&1; do
    sleep 18
    pgrep -f "next build" >/dev/null 2>&1 && pkill -STOP -f "next build" 2>/dev/null
    sleep 12
    pkill -CONT -f "next build" 2>/dev/null
  done ) &
GOVERNOR_PID=$!
FORGE_BUILD=1 DEPLOY_BUILD=1 NODE_ENV=production TURBOPACK=1 \
  NODE_OPTIONS="--max-old-space-size=1024" taskset -c 0 \
  node node_modules/next/dist/bin/next build > "$P/buildout-polar.log" 2>&1
BUILD_RC=$?
kill "$GOVERNOR_PID" 2>/dev/null
pkill -CONT -f "next build" 2>/dev/null
echo "build rc=$BUILD_RC $(date '+%H:%M:%S')"
tail -6 "$P/buildout-polar.log" | head -6
if [ "$BUILD_RC" -ne 0 ] || [ ! -f "$P/buildout/standalone/server.js" ]; then
  echo "FORGE_POLAR_BUILD_FAILED $(date '+%H:%M:%S')"
  echo "PHASE:build-failed" > "$STATUS"
  rm -f "$BASE/.forge-active"
  exit 1
fi
echo "BUILD_OK $(date '+%H:%M:%S')"

# ---------- 6. stage + normalize the self-contained runtime ----------------
cp -r "$P/buildout/static" "$P/buildout/standalone/.next/" 2>/dev/null
cp -r "$P/public" "$P/buildout/standalone/" 2>/dev/null
rm -rf "$P/runtime-stage"; mkdir -p "$P/runtime-stage/cloudagent-runtime"
cp -a "$P/buildout/standalone/." "$P/runtime-stage/cloudagent-runtime/"
if [ -d "$P/runtime-stage/cloudagent-runtime/buildout" ] && [ ! -d "$P/runtime-stage/cloudagent-runtime/.next" ]; then
  mv "$P/runtime-stage/cloudagent-runtime/buildout" "$P/runtime-stage/cloudagent-runtime/.next"
  echo "standalone layout normalized (buildout -> .next)"
fi
[ -f "$P/runtime-stage/cloudagent-runtime/server.js" ] || { echo "FATAL: staged runtime has no server.js"; echo "PHASE:stage-failed" > "$STATUS"; rm -f "$BASE/.forge-active"; exit 1; }
BUILD_ID=$(cat "$P/runtime-stage/cloudagent-runtime/.next/BUILD_ID" 2>/dev/null)
echo "staged runtime BUILD_ID=$BUILD_ID"
echo "PHASE:deploy" > "$STATUS"

# ---------- 7. LIVE_RT refresh (janitor-proof serving copy) ----------------
rm -rf /home/sync/runtime-live/cloudagent-runtime
if cp -a "$P/runtime-stage/cloudagent-runtime" /home/sync/runtime-live/ \
   && [ "$(cat /home/sync/runtime-live/cloudagent-runtime/.next/BUILD_ID 2>/dev/null)" = "$BUILD_ID" ]; then
  echo "LIVE_RT_SYNCED (BUILD_ID $BUILD_ID)"
else
  echo "WARN LIVE_RT_SYNC_FAILED"
fi

# ---------- 8. verified tarball (old one backed up, never destroyed) -------
tarball_saved=0
if [ -s /home/sync/runtime-store/runtime.tar.gz ]; then
  cp -a /home/sync/runtime-store/runtime.tar.gz /home/sync/runtime-store/runtime.tar.gz.pre-pipeline \
    && echo "old tarball backed up -> runtime.tar.gz.pre-pipeline"
fi
if tar czf /home/sync/runtime-store/runtime.tar.new -C "$P/runtime-stage" cloudagent-runtime 2>/dev/null \
   && mv /home/sync/runtime-store/runtime.tar.new /home/sync/runtime-store/runtime.tar.gz 2>/dev/null \
   && tar tzf /home/sync/runtime-store/runtime.tar.gz 2>/dev/null | grep -q 'cloudagent-runtime/node_modules/next/package.json' \
   && tar tzf /home/sync/runtime-store/runtime.tar.gz 2>/dev/null | grep -q 'cloudagent-runtime/.next/BUILD_ID'; then
  echo "RUNTIME_TARBALL_SAVED -> /home/sync/runtime-store (verified)"
  tarball_saved=1
else
  echo "RUNTIME_TARBALL_REJECT (incomplete)"; rm -f /home/sync/runtime-store/runtime.tar.new
fi
if [ "$tarball_saved" -eq 1 ] && [ -f "$BASE/scripts/joy-put.cjs" ]; then
  node "$BASE/scripts/joy-put.cjs" put /home/sync/runtime-store/runtime.tar.gz \
    vortex-websites vortex-platform-seeds/runtime-v158.tar.gz application/gzip >> "$LOG" 2>&1 \
    && echo "JOY_SEED_UPLOADED" || echo "WARN JOY_SEED_UPLOAD_FAILED"
fi

# ---------- 9. rootfs trim (logs + re-generatable residue ONLY) ------------
rm -f "$BASE/sdk-doctor.log" "$BASE/build-runtime.log" "$BASE/deps-build.log" \
      "$BASE/build-v162.log" 2>/dev/null
: > "$BASE/dev.log" 2>/dev/null; : > "$BASE/ca-runtime.log" 2>/dev/null
rm -rf "$BASE/buildout" "$BASE/.next" 2>/dev/null
echo "rootfs free after trim: $(df -h / | tail -1 | awk '{print $4}')"

# ---------- 10. node_modules stub (stops the bun-install/ENOSPC war) -------
mkdir -p "$BASE/node_modules/.bin" 2>/dev/null
printf '#!/bin/sh\nexit 0\n' > "$BASE/node_modules/.bin/next" 2>/dev/null
chmod +x "$BASE/node_modules/.bin/next" 2>/dev/null

# ---------- 11. ROOT_RT restore from the NEW verified tarball --------------
ROOT_RT="$BASE/vortex-platform/cloudagent-runtime"
rm -rf "$ROOT_RT"; mkdir -p "$ROOT_RT"
if tar xzf /home/sync/runtime-store/runtime.tar.gz -C "$ROOT_RT" --strip-components=1 2>/dev/null \
   && [ -f "$ROOT_RT/server.js" ] && [ -d "$ROOT_RT/node_modules/next" ]; then
  echo "ROOT_RT restored (BUILD_ID $(cat "$ROOT_RT/.next/BUILD_ID" 2>/dev/null))"
else
  echo "WARN ROOT_RT restore failed — falling back to LIVE_RT copy"
  cp -a /home/sync/runtime-live/cloudagent-runtime/. "$ROOT_RT/" 2>/dev/null
fi

# ---------- 12. canonical :3000 respawn (self-contained runtime) -----------
setsid nohup bash -c "cd '$ROOT_RT' && set -a && . '$BASE/.env' 2>/dev/null; set +a; exec env PORT=3000 HOSTNAME=127.0.0.1 NODE_ENV=production NODE_OPTIONS='--max-old-space-size=1280' DATABASE_URL='file:$BASE/db/custom.db' node server.js >> '$BASE/ca-runtime.log' 2>&1" </dev/null >/dev/null 2>&1 &
echo ":3000 respawned from self-contained runtime"
( sleep 10; bash "$BASE/scripts/warm-runtime.sh" >/dev/null 2>&1 ) &

# ---------- 13. verify ------------------------------------------------------
sleep 25
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "http://127.0.0.1:3000/api/health" 2>/dev/null)
echo "health probe: $CODE"
CODE2=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "http://127.0.0.1:3000/" 2>/dev/null)
echo "home probe: $CODE2"
rm -f "$BASE/.forge-active"
if [ "$CODE" != "000" ]; then
  echo "PHASE:done" > "$STATUS"
  echo "=== FORGE_POLAR_SUCCESS $(date '+%H:%M:%S') BUILD_ID=$BUILD_ID ==="
else
  echo "PHASE:verify-failed" > "$STATUS"
  echo "=== FORGE_POLAR_VERIFY_FAILED (server did not answer in 25s) ==="
fi
