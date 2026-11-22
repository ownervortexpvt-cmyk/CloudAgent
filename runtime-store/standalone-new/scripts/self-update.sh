#!/usr/bin/env bash
# v149 — CLOUDAGENT SELF-UPDATE ("এই ক্লাউড এজেন্ট এর নিজের বিল্ডটাকে আপডেট
# করব" — the owner updates the agent's own build from the Control Room).
#
# Pipeline (webpack path — Turbopack OOMs this 4GB box, documented since v135):
#   1. install     bun install --frozen-lockfile (repair guard)
#   2. stop-dev    dev.sh supervisor + platform next dev die (they share .next
#                  with the prod build — building while dev runs corrupts it)
#   3. build       next build --webpack (heap-capped 1200MB)
#   4. verify      .next/BUILD_ID exists and is not the old value
#   5. swap        touch .prodmode → `next start -p 3000` (heap-capped,
#                  detached — the watchdog's prodmode recovery path owns it
#                  from now on)
#   6. verify-live GET /api/version must return the NEW build id (≤120s)
#   7. fallback    ANY failure → dev server respawned immediately, state=failed
#
# State for the UI poller: db/selfupdate-state.json (atomic writes).
# Log: db/selfupdate.log
set -u
BASE=/home/z/my-project
STATE=$BASE/db/selfupdate-state.json
LOG=$BASE/db/selfupdate.log
LOCK=$BASE/db/selfupdate.lock

mkdir -p "$BASE/db"
exec >> "$LOG" 2>&1

now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }
set_state() {
  # $1 phase, $2 error ("" when none), $3 note
  _P="$1"; _E="$2"; _N="$3"
  _B=""; [ -f "$BASE/.next/BUILD_ID" ] && _B=$(cat "$BASE/.next/BUILD_ID" 2>/dev/null)
  _OLD=""; [ -f "$STATE.old" ] && _OLD=$(cat "$STATE.old" 2>/dev/null)
  TMP="$STATE.tmp"
  printf '{"phase":"%s","error":"%s","note":"%s","buildId":"%s","oldBuildId":"%s","updatedAt":"%s"}\n' \
    "$_P" "$_E" "$_N" "$_B" "$_OLD" "$(now_iso)" > "$TMP"
  mv "$TMP" "$STATE"
}

# ── single-instance lock ──
if [ -f "$LOCK" ] && kill -0 "$(cat "$LOCK" 2>/dev/null)" 2>/dev/null; then
  echo "[self-update] another job already running (pid $(cat "$LOCK")) — abort"
  exit 3
fi
echo $$ > "$LOCK"
trap 'rm -f "$LOCK"; rm -f "$BASE/.selfupdate-running"' EXIT
touch "$BASE/.selfupdate-running"   # v149: watchdog stands down while .next is rebuilt

OLD_BID=""; curl -s --max-time 8 http://localhost:3000/api/version | grep -oE '"buildId":"[^"]+"' | head -1 | cut -d'"' -f4 > "$STATE.old" || true
OLD_BID=$(cat "$STATE.old" 2>/dev/null || echo dev)
set_state starting "" "self-update started (old build: ${OLD_BID:-unknown})"
echo "── $(date) self-update START (old build: ${OLD_BID:-unknown}) ──"

fallback_dev() {
  rm -f "$BASE/.selfupdate-running"   # watchdog may probe again once dev is back
  echo "[self-update] FALLBACK → restarting server"
  set_state failed "${1:-build failed}" "fallback respawned — the agent stays online on the old code"
  rm -f "$BASE/.prodmode"
  for pid in $(ss -tlnp 2>/dev/null | grep ':3000 ' | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u); do
    kill -9 "$pid" 2>/dev/null || true
  done
  sleep 1
  # v152.8 — prefer the last-known-good self-contained runtime over `next
  # dev`: the checkpoint janitor deletes node_modules/.next under a dev
  # server within minutes, while the runtime needs neither.
  if [ -f "/home/sync/runtime-live/cloudagent-runtime/server.js" ]; then
    NODE_OPTIONS="--max-old-space-size=1280" setsid nohup \
      bash -c "cd '/home/sync/runtime-live/cloudagent-runtime' && set -a && . '$BASE/.env' 2>/dev/null; set +a; exec env PORT=3000 HOSTNAME=127.0.0.1 NODE_ENV=production NODE_OPTIONS='--max-old-space-size=1280' DATABASE_URL='file:$BASE/db/custom.db' node server.js >> '$BASE/ca-runtime.log' 2>&1" </dev/null >/dev/null 2>&1 &
    echo "[self-update] fallback: runtime respawned (LIVE_RT, last-known-good build)"
    return 0
  fi
  cd "$BASE" || return
  NODE_OPTIONS="--max-old-space-size=1280" setsid nohup \
    bash -c "cd '$BASE' && PATH='$BASE/node_modules/.bin:$PATH' next dev -p 3000 2>&1 | tee -a dev.log" </dev/null >/dev/null 2>&1 &
}

# ── 1. install ──
# v152.8 — best-effort only: the checkpoint janitor can delete packages
# mid-install, and forge-runtime.sh re-installs with retries of its own.
set_state installing "" "bun install (frozen lockfile, best-effort — forge retries)"
echo "[self-update] bun install (best-effort)"
(cd "$BASE" && bun install --frozen-lockfile >> "$LOG" 2>&1) || echo "[self-update] bun install soft-failed — forge will retry"

# ── 2. stop dev (supervisor first, then port holder, then any platform dev) ──
set_state stopping-dev "" "stopping dev server (frees .next for the prod build)"
for pid in $(ls /proc 2>/dev/null | grep -E '^[0-9]+$'); do
  [ -r "/proc/$pid/cmdline" ] || continue
  cmd=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null)
  case "$cmd" in
    *".zscripts/dev.sh"*) kill "$pid" 2>/dev/null && echo "[self-update] stopped supervisor $pid" ;;
  esac
done
sleep 2
for pid in $(ls /proc 2>/dev/null | grep -E '^[0-9]+$'); do
  cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null) || continue
  [ "$cwd" = "$BASE" ] || continue
  [ -r "/proc/$pid/cmdline" ] || continue
  cmd=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null)
  case "$cmd" in
    *"next dev"*|*"next-server"*|*next*dev*) kill -9 "$pid" 2>/dev/null && echo "[self-update] stopped platform next $pid" ;;
  esac
done
for pid in $(ss -tlnp 2>/dev/null | grep ':3000 ' | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u); do
  kill -9 "$pid" 2>/dev/null || true
done
sleep 1

# ── 3. build + forge (v152.8) ──
# The sandbox checkpoint re-sync deletes node_modules/.next every few minutes,
# so `next build` in the source tree + `next start` from it can NEVER survive
# here (bun install "failed to install 5 packages" and instant
# "generate is not a function" bootstrap errors were both the janitor racing
# the build). The only durable prod path is the SELF-CONTAINED RUNTIME:
# forge-runtime.sh (install → standalone build → copy to
# vortex-platform/cloudagent-runtime/, a path the sync never touches) — the
# same contract :3200 already runs on. Delegate the whole build there.
set_state building "" "forging self-contained runtime (install → standalone build → copy)"
echo "[self-update] delegating build to forge-runtime.sh"
if ! bash "$BASE/scripts/forge-runtime.sh"; then
  echo "[self-update] FORGE FAILED"
  fallback_dev "runtime forge failed — see forge-runtime.log"
  exit 1
fi

# ── 4. verify ──
if [ ! -f "/home/sync/runtime-live/cloudagent-runtime/server.js" ]; then
  echo "[self-update] runtime server.js missing after forge"
  fallback_dev "forge produced no runtime server.js"
  exit 1
fi
NEW_BID=$(node -e "try{console.log(require('/home/sync/runtime-live/cloudagent-runtime/.next/BUILD_ID'))}catch(e){console.log('unknown')}" 2>/dev/null || echo unknown)
echo "[self-update] forge OK — BUILD_ID $NEW_BID (was ${OLD_BID:-none})"

# ── 5. swap: restart :3000 from the forged runtime ──
set_state swapping "" "restarting :3000 from the forged self-contained runtime"
rm -f "$BASE/.prodmode"
for pid in $(ss -tlnp 2>/dev/null | grep ':3000 ' | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u); do
  kill -9 "$pid" 2>/dev/null || true
done
sleep 1
NODE_OPTIONS="--max-old-space-size=1280" setsid nohup \
  bash -c "cd '/home/sync/runtime-live/cloudagent-runtime' && set -a && . '$BASE/.env' 2>/dev/null; set +a; exec env PORT=3000 HOSTNAME=127.0.0.1 NODE_ENV=production NODE_OPTIONS='--max-old-space-size=1280' DATABASE_URL='file:$BASE/db/custom.db' node server.js >> '$BASE/ca-runtime.log' 2>&1" </dev/null >/dev/null 2>&1 &

# ── 6. verify live ──
set_state verifying "" "waiting for :3000 to serve the new build"
OK=0
for i in $(seq 1 24); do
  sleep 5
  GOT=$(curl -s --max-time 8 http://localhost:3000/api/version | grep -oE '"buildId":"[^"]+"' | head -1 | cut -d'"' -f4)
  if [ -n "$GOT" ] && [ "$GOT" != "dev" ]; then
    OK=1
    break
  fi
done
if [ "$OK" != "1" ]; then
  echo "[self-update] new prod server never came up — falling back to dev"
  fallback_dev "prod server failed to come up within 120s"
  exit 1
fi
set_state done "" "self-update complete — BUILD_ID ${GOT} live on :3000"
echo "── $(date) self-update DONE: ${GOT} live ──"
