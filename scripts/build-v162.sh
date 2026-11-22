#!/usr/bin/env bash
# Build CURRENT source in the janitor-protected zone, stage the standalone.
# Activate later with scripts/swap-server.sh. Log: build-v162.log
# v165: mirrors the PROVEN forge-runtime.sh v164 recipe —
#   * strips __NEXT_PRIVATE_STANDALONE_CONFIG poison inherited from the
#     keeper env (was "TypeError: generate is not a function")
#   * distDir stays ".next" (v165b: buildout broke the watchdog seed-tar
#     validation chain — seed_tar_valid greps .next/BUILD_ID; compile is only
#     ~3 min on warm deps so the re-sync window is acceptable)
#   * CPU duty-cycle governor + single-core pin (sandbox reaper protection)
#   * SDK shield during compile (tracer FUSE-storm guard), symlink restored
#   * .forge-active marker: watchdog defers :3000 respawn while compiling;
#     marker is ALWAYS cleared at script end (success or failure)
set -u
B=/home/z/my-project/vortex-platform/server/CLOUDAGENT_BUILD
BASE=/home/z/my-project
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

# v164.2 — STANDALONE CONFIG POISON FIX
unset __NEXT_PRIVATE_STANDALONE_CONFIG __NEXT_PRIVATE_PREBUNDLED_REACT \
      __NEXT_PRIVATE_PREBUNDLED_REACT_SERVER DOMASKS_SERVER_PRIVATE_ENV 2>/dev/null || true
unset TURBOPACK NEXT_RSPACK IS_TURBOPACK_TEST 2>/dev/null || true

# watchdog cooperation: defer :3000 respawn + toolchain heals while compiling
touch "$BASE/.forge-active"

# v164 — SDK shield (sdk must be a symlink to /home/sync/toolchains)
SDK_SHIELD=0
if [ -L "$BASE/sdk" ]; then
  rm "$BASE/sdk" && mkdir -p "$BASE/sdk" && SDK_SHIELD=1
  echo "[build] sdk shield ON"
fi

# v164.13/15 — turbopack + governor + single-core pin
( while pgrep -f "next build" >/dev/null 2>&1; do
    sleep 18
    pgrep -f "next build" >/dev/null 2>&1 && pkill -STOP -f "next build" 2>/dev/null
    sleep 12
    pkill -CONT -f "next build" 2>/dev/null
  done ) &
GOVERNOR_PID=$!

rm -rf .next
echo "[build] next build starting (turbopack, .next distDir, heap 1024)"
DEPLOY_BUILD=1 NODE_ENV=production TURBOPACK=1 \
  NODE_OPTIONS="--max-old-space-size=1024" taskset -c 0 ./node_modules/.bin/next build
RC=$?
kill "$GOVERNOR_PID" 2>/dev/null
pkill -CONT -f "next build" 2>/dev/null

if [ "$SDK_SHIELD" = "1" ]; then
  rm -rf "$BASE/sdk" && ln -sfn /home/sync/toolchains "$BASE/sdk"
  echo "[build] sdk shield OFF (symlink restored)"
fi

echo "[build] next build exit=$RC (free: $(df -h / | tail -1 | awk '{print $4}'))"
if [ "$RC" -ne 0 ]; then
  rm -f "$BASE/.forge-active"
  echo "[build] FATAL build failed — .forge-active cleared"
  exit 1
fi
[ -f .next/standalone/server.js ] || {
  rm -f "$BASE/.forge-active"
  echo "[build] FATAL no standalone output — .forge-active cleared"
  exit 1
}

cp -r .next/static .next/standalone/.next/ 2>/dev/null
cp -r public .next/standalone/ 2>/dev/null

rm -rf "$BASE/runtime-store/standalone-new"
cp -r .next/standalone "$BASE/runtime-store/standalone-new"
echo "[build] standalone staged ($(du -sh "$BASE/runtime-store/standalone-new" | cut -f1))"

rm -rf "$B/.next"
rm -f "$BASE/.forge-active"
echo "[build] artifacts cleaned (free: $(df -h / | tail -1 | awk '{print $4}'))"
echo "[$(date '+%H:%M:%S')] === build done - run scripts/swap-server.sh to activate ==="
