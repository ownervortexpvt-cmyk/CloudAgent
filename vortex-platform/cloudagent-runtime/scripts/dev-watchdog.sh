#!/usr/bin/env bash
# v79 dev-watchdog — the sandbox has 4GB RAM and no swap. When the owner runs
# several builds (flutter/gradle/dotnet/vite) the next-server heap can balloon
# (seen: 2.1GB RSS) and the kernel OOM-kills it → every request 502s until a
# manual restart. This watchdog:
#   1. checks :3000 every 30s (2 consecutive failures = down)
#   2. kills orphaned project-run processes (cwd inside projects/) first —
#      they hold RAM + ports after their parent died
#   3. cold-restarts next dev with a hard heap cap (NODE_OPTIONS max-old-space)
#   4. waits 60s before probing again (cold compile needs time)
# Single-instance (own lock, stale takeover after 30 min). Run detached:
#   nohup setsid bash scripts/dev-watchdog.sh </dev/null >/dev/null 2>&1 &
set -u
BASE=/home/z/my-project
LOG=$BASE/dev-watchdog.log
LOCK=$BASE/.dev-watchdog.lock
STALE=$((2 * 60))           # seconds — the live loop touches the lock every cycle, so a lock older than 2 min = dead watchdog
PROBE_TIMEOUT=20            # cold compiles can be slow — don't false-positive
HEAP_CAP=1280               # MB — next-server JS heap ceiling (host guard)

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"; }

if [ -d "$LOCK" ]; then
  AGE=$(( $(date +%s) - $(stat -c %Y "$LOCK" 2>/dev/null || echo 0) ))
  if [ "$AGE" -gt "$STALE" ]; then
    log "stale lock (${AGE}s) — taking over"
    rm -rf "$LOCK"
  else
    exit 0   # another watchdog already running
  fi
fi
mkdir -p "$LOCK"
trap 'rm -rf "$LOCK"' EXIT

# v152.3 — ECOSYSTEM GIT BOOT-GUARD: sandbox recycles re-materialize the
# project WITHOUT gitignored dirs, which wipes vortex-git/ (the Code Hub bare
# repo) and .ecosystem/ (deploy state). The setup script is fully idempotent:
# it rebuilds the bare repo, re-seeds it from the live tree when HEAD is gone,
# and reinstalls the post-receive hook. Restoring .gitignore first guards the
# seed from swallowing runtime dirs if the sandbox reverted the file.
if [ ! -s "$BASE/.gitignore" ] || ! grep -q "vortex-git" "$BASE/.gitignore" 2>/dev/null; then
  log ".gitignore reverted by sandbox — restoring v152 version"
  cat > "$BASE/.gitignore" << 'GITEOF'
node_modules/
.next/
out/
build/
sdk/
download/
.secrets/
audit/
bin/
logs/
.wrangler/
*.log
*.db
*.sqlite*
db/
nohup.out
.env
.env.*
!.env.example
scripts/megafix.sh

# v152 — Ecosystem Code Hub (self-hosted git + push-to-deploy)
vortex-git/
.ecosystem/
vortex-platform/server/VORTEX_SERVER/src/generated/
vortex-platform/server/VORTEX_SERVER/storage-pool/
vortex-platform/server/VORTEX_SERVER/db/
*.pid
*.tsbuildinfo
sdk-archive.flag
.vortex-build-marker
.vortex-env-guard-ts
tool-results/
.dev-watchdog.lock
projects/
upload/
.selfupdate-running
GITEOF
fi
( bash "$BASE/scripts/ecosystem-git-setup.sh" >> "$BASE/.ecosystem-setup.log" 2>&1 ) &
log "ecosystem git boot-guard fired (vortex-git self-heal)"

# v158 — SERVING RUNTIME LIVES ON /home/sync (LIVE_RT): the checkpoint janitor
# now ALSO guts $BASE/vortex-platform/cloudagent-runtime (node_modules/.next
# deleted within seconds of every restore — incident 2026-11-18 03:0x: infinite
# restore loop, pages 500 from a ghost process). /home/sync is the owner's
# durable storage (toolchains already live there, janitor-proof) so the
# SERVING copy of the forged runtime is /home/sync/runtime-live/cloudagent-runtime.
# vortex-platform/cloudagent-runtime remains the forge output + git seed.
LIVE_RT=/home/sync/runtime-live/cloudagent-runtime

# v153.3 — DURABLE SEEDS: /home/sync reverts too (checkpoint re-sync). The
# only guaranteed-durable store is the GIT-COMMITTED file tree. Restore
# order: ossfs tarball (fast) → repo tarball (durable) → Joy S3 (owner's own
# object storage, v158 — survives every local revert) → forge (last resort).
JOY_SEED_KEY="vortex-platform-seeds/runtime-v158.tar.gz"

seed_tar_valid() {
  tar tzf "$1" 2>/dev/null | grep -q 'cloudagent-runtime/node_modules/next/package.json' \
    && tar tzf "$1" 2>/dev/null | grep -q 'cloudagent-runtime/.next/BUILD_ID'
}

restore_runtime() {
  local SRC=""
  [ -s /home/sync/runtime-store/runtime.tar.gz ] && seed_tar_valid /home/sync/runtime-store/runtime.tar.gz && SRC=/home/sync/runtime-store/runtime.tar.gz
  [ -z "$SRC" ] && [ -s "$BASE/runtime-store/runtime.tar.gz" ] && seed_tar_valid "$BASE/runtime-store/runtime.tar.gz" && SRC="$BASE/runtime-store/runtime.tar.gz"
  # v158 — Joy S3 fallback: the 04:13 incident reverted BOTH local tarballs to
  # a 5-entry gutted capture. The owner's own Joy bucket is outside every
  # sandbox lifecycle — download it when no valid local seed survives.
  if [ -z "$SRC" ]; then
    log "no valid local seed — downloading runtime seed from Joy S3"
    mkdir -p /home/sync/runtime-store "$BASE/runtime-store"
    node "$BASE/scripts/joy-put.cjs" get vortex-websites "$JOY_SEED_KEY" /home/sync/runtime-store/runtime.tar.gz >> "$LOG" 2>&1 \
      && seed_tar_valid /home/sync/runtime-store/runtime.tar.gz && SRC=/home/sync/runtime-store/runtime.tar.gz \
      && log "Joy S3 seed downloaded OK"
  fi
  [ -z "$SRC" ] && return 1
  # v158.1 — IN-PLACE RESTORE (no rm -rf): tar overwrites the existing tree.
  # The old rm -rf + extract deleted GOOD files first, so every restore opened
  # a hole in the serving tree (and two watchdogs restoring concurrently
  # destroyed each other's output). In-place extract only adds back whatever
  # the janitor reverted — LIVE_RT never gets worse during a restore.
  # Full clean re-extract only when server.js itself is gone (dead tree).
  if [ ! -f "$LIVE_RT/server.js" ]; then
    rm -rf "$LIVE_RT"
  fi
  mkdir -p /home/sync/runtime-live
  tar xzf "$SRC" -C /home/sync/runtime-live \
    && log "runtime restored from tarball → LIVE_RT" || log "runtime restore FAILED"
  # also seed the git-tracked forge-output path so a fresh repo commit finds it
  if [ ! -f "$BASE/vortex-platform/cloudagent-runtime/server.js" ]; then
    rm -rf "$BASE/vortex-platform/cloudagent-runtime"
    tar xzf "$SRC" -C "$BASE/vortex-platform" 2>/dev/null
  fi
}

# boot-guard call
if [ ! -f "$LIVE_RT/server.js" ] || [ ! -d "$LIVE_RT/node_modules/next" ]; then
  restore_runtime
fi

# v153 — TOOLCHAIN HOME GUARD: all 13 managed toolchains live DIRECTLY on
# /home/sync/toolchains (permanent, janitor-proof, the owner's "100 GB"
# storage) and /home/z/my-project/sdk symlinks to it. The janitor deletes the
# rootfs symlink — recreate it on every boot. sdk/ is gitignored.
if [ -d /home/sync/toolchains ] && [ ! -e "$BASE/sdk" ]; then
  ln -sfn /home/sync/toolchains "$BASE/sdk" && log "sdk symlink restored → /home/sync/toolchains"
fi

# v156.1 — STATUS-AWARE PROBES: curl without -f treats HTTP 500 as success —
# a gutted runtime (every API 500, pages still served by the ghost process)
# was counted healthy FOREVER (incident 2026-11-17: owner publish test failed
# 0/4 while the watchdog slept). Healthy = an HTTP status BELOW 500 and not
# 000 (no answer). 401/403/redirects are all "server alive" answers.
probe() {
  local c; c=$(curl -s -o /dev/null -w '%{http_code}' --max-time "$PROBE_TIMEOUT" "http://localhost:3000/api/lock" 2>/dev/null || echo 000)
  [ "$c" != "000" ] && [ "$c" -lt 500 ]
}
probe_socket() {
  local c; c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "http://localhost:3001/" 2>/dev/null || echo 000)
  [ "$c" != "000" ] && [ "$c" -lt 500 ]
}
# v140 — VORTEX SERVER guard (central infra of the VORTEX ecosystem, :3200).
# Production standalone build under vortex-platform/server/VORTEX_SERVER. The
# sandbox reaps processes spawned by ad-hoc tool calls, so the vortex server
# must be a child of THIS watchdog (boot tree) to survive.
VORTEX_DIR="$BASE/vortex-platform/server/VORTEX_SERVER"
# v145 — VAAS scheduler tick secret: shared between the :3200 server process
# (VX_TICK_SECRET env) and the boot-tree ticker loop (x-vx-tick header).
if [ ! -s "$VORTEX_DIR/.tick-secret" ]; then
  ( umask 077; printf 'vxtick_%s\n' "$(head -c 12 /dev/urandom | base64 | tr -d '=+/\n')" > "$VORTEX_DIR/.tick-secret" ) 2>/dev/null
  touch "$VORTEX_DIR/.tick-secret"
fi
VX_TICK=$(tr -d '\n' < "$VORTEX_DIR/.tick-secret" 2>/dev/null || echo vxtick_fallback_2026)
probe_vortex() {
  local c; c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "http://127.0.0.1:3200/" 2>/dev/null || echo 000)
  [ "$c" != "000" ] && [ "$c" -lt 500 ]
}
# v145 — VAAS ticker: scheduled cloud functions + presence sweep run EVERY
# MINUTE without any dashboard being open (previously runDueScheduledFns only
# fired when someone loaded the portal page). Singleton via pidfile; runs as a
# boot-tree child so sandbox reapers cannot touch it.
start_vaas_ticker() {
  TPID="$VORTEX_DIR/.ticker.pid"
  if [ -f "$TPID" ] && kill -0 "$(cat "$TPID" 2>/dev/null)" 2>/dev/null; then return 0; fi
  ( while true; do
      sleep 60
      curl -s --max-time 12 "http://127.0.0.1:3200/api/vaas/v1/tick" -H "x-vx-tick: $(tr -d '\n' < "$VORTEX_DIR/.tick-secret" 2>/dev/null)" >> "$VORTEX_DIR/vs-tick.log" 2>&1
      echo "" >> "$VORTEX_DIR/vs-tick.log"
    done ) </dev/null >/dev/null 2>&1 &
  echo $! > "$TPID"
  log "vaas ticker started (pid $(cat "$TPID")) — scheduled fns run every 60s"
}
start_vortex() {
  # Next 16 standalone renames its process title to "next-server (v16.1.3)",
  # so pkill -f "standalone/server.js" matches nothing — kill by PORT instead.
  for vpid in $(ss -tlnp 2>/dev/null | grep ':3200 ' | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u); do
    kill "$vpid" 2>/dev/null && log "killed vortex server pid $vpid (port-based)"
  done
  sleep 1
  # v141 SELF-HEAL — a sandbox recycle wipes .next and node_modules together.
  # Instead of skipping forever, reinstall deps and rebuild the standalone.
  # Rate-limited to one build attempt per 30 min (marker mtime) so a failing
  # build cannot storm the CPU every 40s probe cycle.
  if [ ! -f "$VORTEX_DIR/.next/standalone/server.js" ]; then
    if [ ! -d "$VORTEX_DIR/node_modules/next" ]; then
      log "vortex deps missing — bun install"
      (cd "$VORTEX_DIR" && bun install --frozen-lockfile >> "$VORTEX_DIR/vs-build.log" 2>&1) || log "vortex bun install FAILED"
    fi
    VMARK="$BASE/.vortex-build-marker"
    VNOW=$(date +%s); VLAST=$(stat -c %Y "$VMARK" 2>/dev/null || echo 0)
    # v141.2 — a fast-FAILING build must not brick the heal loop: retries are
    # allowed every 3 min; only after a failure the marker is rolled back so
    # the next cycle can try again (30-min lockout removed).
    if [ $((VNOW - VLAST)) -gt 180 ]; then
      touch "$VMARK"
      log "vortex standalone missing — auto-building (min 3 min between attempts)"
      # v146.2 — build via `bun run build` (NOT bare `bunx next build`): the
      # package.json build script also copies .next/static + public INTO the
      # standalone dir; a bare build leaves a standalone that serves HTML but
      # 404s every static asset.
      if (cd "$VORTEX_DIR" && bun install --frozen-lockfile >> "$VORTEX_DIR/vs-build.log" 2>&1 \
            && bun run build >> "$VORTEX_DIR/vs-build.log" 2>&1); then
        log "vortex auto-build SUCCEEDED"
      else
        log "vortex build FAILED — retry eligible in ~3 min"
        touch -d '27 minutes ago' "$VMARK"
      fi
    else
      log "vortex build skipped — last attempt < 3 min ago"
    fi
    if [ ! -f "$VORTEX_DIR/.next/standalone/server.js" ]; then
      log "vortex standalone still missing after heal attempt — skipping this cycle"
      return 1
    fi
  fi
  # v146.1 DB SELF-HEAL — a snapshot rollback can delete the whole db/ dir
  # (incident 2026-11-14 06:38: server up but every API 500, db/ gone).
  # Recreate the schema from prisma/schema.prisma before starting.
  if [ ! -f "$VORTEX_DIR/db/custom.db" ]; then
    mkdir -p "$VORTEX_DIR/db"
    log "vortex DB missing — prisma db push (self-heal)"
    (cd "$VORTEX_DIR" && DATABASE_URL="file:$VORTEX_DIR/db/custom.db" bunx prisma db push --skip-generate >> "$VORTEX_DIR/vs-prod.log" 2>&1) \
      || log "vortex prisma db push FAILED (see vs-prod.log)"
  fi
  log "starting vortex server (:3200, own DB)"
  # v140.1 ABSOLUTE DATABASE_URL — the vortex server MUST use its own SQLite
  # file. A relative file:./db/custom.db resolves against the caller's cwd and
  # once pointed at CloudAgent's db/custom.db, a prisma db push there can drop
  # CloudAgent's tables (incident 2026-11-13: CA data loss, recovered from disk).
  # v140.2 ABSOLUTE VORTEX_STORAGE_ROOT — next standalone chdir's into
  # .next/standalone at runtime, so the default cwd-based storage pool lives
  # INSIDE .next and every `next build` wipes all deployed site bytes.
  setsid nohup bash -c "cd '$VORTEX_DIR' && exec env PORT=3200 HOSTNAME=127.0.0.1 NODE_ENV=production NODE_OPTIONS='--max-old-space-size=512' DATABASE_URL='file:$VORTEX_DIR/db/custom.db' VORTEX_STORAGE_ROOT='$VORTEX_DIR/storage-pool' VX_TICK_SECRET='$VX_TICK' node .next/standalone/server.js >> '$VORTEX_DIR/vs-prod.log' 2>&1" </dev/null >/dev/null 2>&1 &
  start_vaas_ticker
}

# v101: guard the :3001 socket service too. The .zscripts/dev.sh supervisor
# normally owns this, but when it dies (sandbox reapers kill orphaned
# supervisors) the watchdog is the only survivor — a dead socket means the
# realtime agent features die silently. Same respawn logic as dev.sh's
# start_socket, kept in sync.
start_socket() {
  pkill -f "bun --hot index.ts" 2>/dev/null
  if [ ! -d "$BASE/mini-services/agent-service/node_modules/socket.io" ]; then
    log "agent-service deps missing — installing"
    (cd "$BASE/mini-services/agent-service" && bun install >> "$BASE/socket-service.log" 2>&1)
  fi
  log "starting socket service (:3001)"
  setsid nohup bash -c "cd '$BASE/mini-services/agent-service' && exec bun --hot index.ts >> '$BASE/socket-service.log' 2>&1" </dev/null >/dev/null 2>&1 &
}

# v86: is the canonical .zscripts/dev.sh supervisor alive? When it is, it
# OWNS :3000 recovery — two restarters cold-rm .next and respawn next dev
# against each other (port fights, double restarts). The watchdog then stays
# monitor-only and leaves recovery to the supervisor.
supervisor_alive() {
  for pid in $(ls /proc 2>/dev/null | grep -E '^[0-9]+$'); do
    [ "$pid" = "$$" ] && continue
    # v141: /proc entries can vanish between listing and read (race noise)
    [ -r "/proc/$pid/cmdline" ] || continue
    cmd=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null)
    case "$cmd" in *".zscripts/dev.sh"*) return 0 ;; esac
  done
  return 1
}

# v86 FIX (owner: "Run problem"): `pkill -f "next dev"` also killed GENERATED
# apps running `next dev -p 4xxx` inside projects/. Platform recovery must
# only kill the PLATFORM's own next processes — cwd == $BASE exactly (a
# generated app's cwd lives under $BASE/projects/<id>).
kill_platform_next() {
  local killed=0
  for pid in $(ls /proc 2>/dev/null | grep -E '^[0-9]+$'); do
    [ "$pid" = "$$" ] && continue
    cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null) || continue
    case "$cwd" in
      "$BASE"|"$BASE/vortex-platform/cloudagent-runtime"|"$LIVE_RT") ;;
      *) continue ;;
    esac
    [ -r "/proc/$pid/cmdline" ] || continue   # v141: /proc race guard
    cmd=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null)
    case "$cmd" in
      *"next dev"*|*next-server*)
        log "killing platform next process $pid ($cmd)"
        kill -9 "$pid" 2>/dev/null && killed=$((killed+1))
        ;;
    esac
  done
  [ "$killed" -gt 0 ] && log "killed $killed platform next process(es)"
}

# v156.1 — PORT-BASED KILL: kill_platform_next matches cwd == $BASE only, but
# the respawned production runtime's cwd is vortex-platform/cloudagent-runtime
# — a GHOST server holding :3000 was never killed and every respawn died with
# EADDRINUSE. Kill by port, same contract as start_vortex() uses for :3200.
kill_port_3000() {
  for vpid in $(ss -tlnp 2>/dev/null | grep ':3000 ' | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u); do
    kill -9 "$vpid" 2>/dev/null && log "killed :3000 holder pid $vpid (port-based)"
  done
}

# kill processes whose cwd lives inside projects/ (orphaned vite/dotnet/flutter/
# gradle runs from a dead next-server — they keep eating RAM and holding ports).
# v86 guards: only TRUE orphans (ppid == 1) OLDER than 3 minutes — the old
# version killed LIVE user apps and MID-FLIGHT npm installs whenever the
# platform had a bad 60s window (false :3000 DOWN), which corrupted
# node_modules and looked exactly like the owner's "Run problem".
kill_project_children() {
  local killed=0
  for pid in $(ls /proc 2>/dev/null | grep -E '^[0-9]+$'); do
    [ "$pid" = "$$" ] && continue
    ppid=$(awk '{print $4}' "/proc/$pid/stat" 2>/dev/null) || continue
    [ "$ppid" = "1" ] || continue
    # age in seconds: (uptime - starttime/100)
    read -r UPTIME REST < /proc/uptime 2>/dev/null || continue
    START=$(awk '{print $22}' "/proc/$pid/stat" 2>/dev/null) || continue
    AGE=$(awk -v u="$UPTIME" -v s="$START" 'BEGIN { printf "%d", u - s/100 }')
    [ "$AGE" -gt 180 ] || continue
    cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null) || continue
    case "$cwd" in
      "$BASE/projects/"*)
        [ -r "/proc/$pid/cmdline" ] || continue   # v141: /proc race guard
        cmd=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | head -c 80)
        log "killing orphan $pid (age=${AGE}s, cwd=$cwd) $cmd"
        kill -9 "$pid" 2>/dev/null && killed=$((killed+1))
        ;;
    esac
  done
  [ "$killed" -gt 0 ] && log "killed $killed orphan(s)"
}

# v102.2 ZOMBIE SWEEP (same rule as .zscripts/dev.sh boot): a container
# recycle resurrects untracked base-image files (the v91/v100-removed Drive
# system). Every watchdog start re-deletes them — the routes can never serve.
for z in src/app/api/gdrive src/app/api/sdks/drive src/lib/gdrive.ts scripts/e2e-v80-publish-gdrive.js; do
  [ -e "$BASE/$z" ] && { rm -rf "$BASE/$z"; log "zombie sweep: removed $z (recycle resurrected it)"; }
done

log "watchdog started (pid $$, heap cap ${HEAP_CAP}MB)"

FAILS=0
SOCKET_FAILS=0
VORTEX_FAILS=0
# v138 COLD-BOOT GRACE: instrumentation (boot-guard) spawns this watchdog the
# moment a NEW next-server boots — exactly when its FIRST turbopack compile is
# running. A cold first compile can keep even /api/lock busy for minutes on a
# 4GB box, so the old 30s+2x20s probe window false-positived "DOWN" and the
# recovery path did `rm -rf .next` UNDER THE LIVE SERVER: turbopack's task DB
# referenced unlinked .sst files → "Failed to restore task data" panics → 500s
# and hung pages → kill/respawn loop forever. During the grace window probe
# failures are logged but NEVER counted toward recovery.
GRACE_UNTIL=$(( $(date +%s) + 180 ))   # 3 min after watchdog start
in_grace() { [ "$(date +%s)" -lt "$GRACE_UNTIL" ]; }

# v139 LIVE-SERVER GUARD — the fixed 3-min grace only covered boots that
# happened right after the watchdog started. A server started LATER (owner
# ran dev.sh, or a manual respawn) was still killed: its first /api/lock
# compile can exceed probe timeout × 2 (30s+30s probes, 20s each), the
# watchdog counted 2 fails, killed a HEALTHY next-server and respawned —
# an infinite kill loop that looked like "the server dies every minute".
# The correct semantic: grace belongs to THE SERVER's boot, not the
# watchdog's start. A live next-server younger than 240s is still
# compiling — never killed, never counted.
live_next_age() {
  local youngest=-1 pid cmd cmdcwd age UPTIME START cwd
  for pid in $(ls /proc 2>/dev/null | grep -E '^[0-9]+$'); do
    cmd=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null) || continue
    case "$cmd" in
      *next-server*|*"next dev"*) ;;
      *) continue ;;
    esac
    # v153.2 — only THIS platform's next processes count (cwd == $BASE). The
    # :3200 vortex standalone also renames itself next-server; its age must
    # never satisfy the platform's grace window (it masked real :3000 outages
    # and froze recovery in "cold-boot grace" forever).
    cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null) || continue
    case "$cwd" in
      "$BASE"|"$BASE/vortex-platform/cloudagent-runtime"|"$LIVE_RT") ;;
      *) continue ;;
    esac
    read -r UPTIME _ < /proc/uptime 2>/dev/null || continue
    START=$(awk '{print $22}' "/proc/$pid/stat" 2>/dev/null) || continue
    age=$(awk -v u="$UPTIME" -v s="$START" 'BEGIN { printf "%d", u - s/100 }')
    if [ "$youngest" -lt 0 ] || [ "$age" -lt "$youngest" ]; then youngest=$age; fi
  done
  echo "$youngest"
}

while true; do
  sleep 30
  touch "$LOCK"   # heartbeat — proves this watchdog is alive

  # v101 — :3001 socket guard (independent of the web loop; monitor-only
  # while the .zscripts/dev.sh supervisor is alive, same rule as the web)
  if probe_socket; then
    SOCKET_FAILS=0
  else
    SOCKET_FAILS=$((SOCKET_FAILS+1))
    log "socket probe failed ($SOCKET_FAILS/2)"
    if [ "$SOCKET_FAILS" -ge 2 ] && ! supervisor_alive; then
      SOCKET_FAILS=0
      start_socket
    fi
  fi

  # v140 — :3200 vortex guard (same pattern as the :3001 socket guard)
  if probe_vortex; then
    VORTEX_FAILS=0
    start_vaas_ticker   # v145 — ticker may have been reaped; ensure it is alive
  else
    VORTEX_FAILS=$((VORTEX_FAILS+1))
    log "vortex probe failed ($VORTEX_FAILS/2)"
    if [ "$VORTEX_FAILS" -ge 2 ]; then
      start_vortex && VORTEX_FAILS=0
      sleep 10
    fi
  fi

  # v146 VORTEX ENV GUARD — snapshot rollbacks keep truncating .env back to a
  # DATABASE_URL-only stub (incident 2026-11-14: VORTEX_PLATFORM_KEY etc.
  # vanished; every vortex/appverse publish then fails with "VORTEX key
  # missing"). Self-heal: when the keys are gone, re-run vortex-setup.cjs
  # (login → joy-configure → re-issue keys → write .env), rate-limited to one
  # attempt per 30 minutes so a failing setup can never loop hot.
  if [ ! -s "$BASE/.env" ] || ! grep -q '^VORTEX_PLATFORM_KEY=.' "$BASE/.env" 2>/dev/null; then
    # v146.3 — only attempt when :3200 actually answers; setup against a dead
    # server just burns the 30-min slot (incident 06:37).
    if curl -sf -o /dev/null --max-time 5 http://127.0.0.1:3200/ 2>/dev/null; then
      NOW=$(date +%s)
      LAST=0
      [ -f "$BASE/.vortex-env-guard-ts" ] && LAST=$(cat "$BASE/.vortex-env-guard-ts" 2>/dev/null || echo 0)
      if [ $((NOW - LAST)) -ge 1800 ]; then
        echo "$NOW" > "$BASE/.vortex-env-guard-ts"
        log ".env lost VORTEX keys (rollback?) — re-running vortex-setup.cjs"
        (cd "$BASE" && node scripts/vortex-setup.cjs >> "$BASE/vortex-env-guard.log" 2>&1) \
          && log "vortex-setup healed .env (keys re-issued; see vortex-env-guard.log)" \
          || log "vortex-setup FAILED (see vortex-env-guard.log; retry in 30m)"
      fi
    fi
  fi

  if probe; then
    FAILS=0
    # v156.1 — RUNTIME INTEGRITY GUARD (healthy path): the checkpoint re-sync
    # can gut the runtime's node_modules while a ghost process still answers
    # pages from open file handles. Restore the files immediately; the next
    # 5xx probe (now status-aware) then heals fully via the recovery path.
    if [ ! -d "$LIVE_RT/node_modules/next" ] || [ ! -f "$LIVE_RT/.next/BUILD_ID" ]; then
      restore_runtime
    fi
    # v159 — :3200 HARD HEAL: independent direct check on the healthy :3000
    # path. The guard probe above was observed flapping while :3200 was down
    # (v159 incident: no probe-failure logs, server dead). This second check
    # cannot lie — it runs start_vortex (kill-by-port + full v140 env) only
    # when :3200 really does not answer.
    if ! curl -sf -o /dev/null --max-time 5 http://127.0.0.1:3200/ 2>/dev/null; then
      log ":3200 hard-heal (direct check failed)"
      start_vortex || true
    fi
    # v159 — rootfs runtime copy integrity (10-min rate-limited): the janitor
    # guts vortex-platform/cloudagent-runtime/node_modules within seconds;
    # the RUNNING server needs no files after require-time, but the NEXT
    # respawn does. Re-extract from the verified tarball.
    ROOT_RT="$BASE/vortex-platform/cloudagent-runtime"
    if { [ ! -f "$ROOT_RT/server.js" ] || [ ! -d "$ROOT_RT/node_modules/next" ]; } && [ -s /home/sync/runtime-store/runtime.tar.gz ]; then
      RMARK="$BASE/.rootrt-heal-ts"
      RNOW=$(date +%s); RLAST=$(cat "$RMARK" 2>/dev/null || echo 0)
      if [ $((RNOW - RLAST)) -ge 600 ]; then
        echo "$RNOW" > "$RMARK"
        log "rootfs runtime copy gutted — re-extracting (10-min rate limit)"
        (rm -rf "$ROOT_RT" && mkdir -p "$ROOT_RT" && tar xzf /home/sync/runtime-store/runtime.tar.gz -C "$ROOT_RT" --strip-components=1 2>/dev/null) \
          && log "rootfs runtime copy restored" || log "rootfs runtime restore FAILED"
      fi
    fi
    # v152.4 — keep the ossfs node_modules tarball fresh (durable restore
    # source for recycle/janitor wipes). Refresh at most every 6 hours; the
    # tar runs detached so a slow ossfs upload never blocks the monitor loop.
    if [ -e "$BASE/node_modules/.bin/next" ]; then
      NMTAR=/home/sync/nm-store/nm.tar
      NMTAR_AGE=$(( $(date +%s) - $(stat -c %Y "$NMTAR" 2>/dev/null || echo 0) ))
      if [ "$NMTAR_AGE" -gt 21600 ]; then
        log "refreshing ossfs node_modules tarball (age ${NMTAR_AGE}s)"
        ( tar cf "$NMTAR.new" -C "$BASE" node_modules 2>/dev/null \
            && mv "$NMTAR.new" /home/sync/nm-store/nm.tar \
            && log "ossfs tarball refreshed" ) >/dev/null 2>&1 &
      fi
    fi
    continue
  fi
  # v138: cold-boot grace — a server that is mid-first-compile is ALIVE, not
  # DOWN. Log and reset the counter instead of killing it.
  if in_grace; then
    log "probe failed during cold-boot grace window — waiting (no recovery)"
    FAILS=0
    continue
  fi
  # v139: live-server grace — same rule as v138 but keyed to the SERVER's
  # actual age, so a server started later is protected through its own
  # first compile too.
  SERVER_AGE=$(live_next_age)
  if [ "$SERVER_AGE" -ge 0 ] && [ "$SERVER_AGE" -lt 240 ]; then
    log "probe failed but next-server is alive (age=${SERVER_AGE}s) — cold boot, waiting (no recovery)"
    FAILS=0
    continue
  fi
  # v149 SELF-UPDATE GUARD - while the self-update job is building the new
  # production bundle it owns .next; a watchdog recovery here would `rm -rf
  # .next` UNDER THE RUNNING BUILD (same class of bug as v138 cold-boot race).
  # The job either swaps to the fresh prod server or falls back to dev on its
  # own - the watchdog just stands down until the marker clears.
  if [ -f "$BASE/.selfupdate-running" ]; then
    log "probe failed during self-update build - standing down (no recovery)"
    FAILS=0
    continue
  fi
  FAILS=$((FAILS+1))
  log "probe failed ($FAILS/2)"
  [ "$FAILS" -lt 2 ] && continue

  # ---- server is DOWN: recover ----
  # v86: when the canonical supervisor runs, leave recovery to it — the old
  # double-recovery (watchdog + supervisor both cold-rm .next and respawn
  # next dev) raced itself into repeated DOWN cycles and killed user apps.
  if supervisor_alive; then
    log ":3000 DOWN — .zscripts/dev.sh supervisor is alive, leaving recovery to it (monitor-only)"
    FAILS=0
    continue
  fi
  log ":3000 DOWN — recovering (no supervisor alive)"
  # v153.3 — runtime self-heal INSIDE the recovery path: restore from the
  # durable seeds (ossfs tarball → repo tarball) BEFORE respawning.
  if [ ! -f "$LIVE_RT/server.js" ] || [ ! -d "$LIVE_RT/node_modules/next" ]; then
    restore_runtime
  fi
  # v153.3 — TOOLCHAIN AUTO-HEAL: the owner's standing order — toolchains are
  # ALWAYS installed ("kokhonoi reset hobena"). When the re-sync wipes them,
  # reinstall directly (resumable, downloads ~10-20 min) at most every 30 min.
  if [ ! -e "$BASE/sdk/flutter-sdk/bin/flutter" ] || [ ! -e "$BASE/sdk/jdk-17/bin/javac" ]; then
    TMARK=/home/sync/.tc-heal-ts
    TNOW=$(date +%s); TLAST=$(cat "$TMARK" 2>/dev/null || echo 0)
    if [ $((TNOW - TLAST)) -ge 1800 ]; then
      echo "$TNOW" > "$TMARK"
      log "toolchains missing — auto-install started (resumable, direct to permanent home)"
      ( bash "$BASE/scripts/install-all-toolchains.sh" >> "$BASE/toolchain-install.log" 2>&1 \
          && log "toolchain auto-install sweep DONE" ) >/dev/null 2>&1 &
    fi
  fi
  kill_project_children
  kill_platform_next
  kill_port_3000
  sleep 2
  # v141 DEPS GUARD — recycle/hydration can leave node_modules incomplete
  # (incident 2026-11-14: .bin/next vanished → "next: command not found"
  # respawn loop; :3000 stayed down through every watchdog retry). Never
  # respawn against a broken node_modules — repair it first.
  if [ ! -e "$BASE/node_modules/.bin/next" ]; then
    log "node_modules incomplete — bun install (frozen lockfile)"
    (cd "$BASE" && bun install --frozen-lockfile >> "$BASE/deps-install.log" 2>&1) || log "bun install FAILED (see deps-install.log)"
    # v152.4 — ossfs tarball fallback: when the sandbox disk janitor keeps
    # evicting node_modules (rootfs pressure) or the bun cache is corrupted,
    # restore from the durable store on /home/sync (object storage, outside
    # the rootfs quota). Tarball rebuilt automatically after every healthy boot.
    if [ ! -e "$BASE/node_modules/.bin/next" ] && [ -s /home/sync/nm-store/nm.tar ]; then
      log "bun install still broken — restoring node_modules from /home/sync/nm-store/nm.tar"
      rm -rf "$BASE/node_modules"
      (tar xf /home/sync/nm-store/nm.tar -C "$BASE" >> "$BASE/deps-install.log" 2>&1) \
        && log "node_modules restored from ossfs tarball" \
        || log "ossfs tarball restore FAILED"
    fi
  fi
  # v152.7/v159 — SELF-CONTAINED RUNTIME FIRST, but from the ROOTFS COPY:
  # detached spawns whose require-burst reads /home/sync (FUSE) are killed
  # instantly by the sandbox (v159 incident: bulk-FUSE-read killer). The
  # rootfs copy vortex-platform/cloudagent-runtime is the spawn source; the
  # janitor guts its node_modules within seconds — harmless for the RUNNING
  # server (files only needed at require-time) and the healthy-path guard
  # re-extracts it (10-min rate limit). LIVE_RT remains the durable seed.
  ROOT_RT="$BASE/vortex-platform/cloudagent-runtime"
  if [ ! -f "$ROOT_RT/server.js" ] || [ ! -d "$ROOT_RT/node_modules/next" ]; then
    log "rootfs runtime gutted — restoring from verified tarball before respawn"
    rm -rf "$ROOT_RT"; mkdir -p "$ROOT_RT"
    if [ -s /home/sync/runtime-store/runtime.tar.gz ]; then
      (tar xzf /home/sync/runtime-store/runtime.tar.gz -C "$ROOT_RT" --strip-components=1 2>/dev/null) \
        && log "rootfs runtime restored from tarball" \
        || log "tarball restore FAILED — falling back to LIVE_RT"
    fi
    if [ ! -d "$ROOT_RT/node_modules/next" ] && [ -d "$LIVE_RT/node_modules/next" ]; then
      (cp -a "$LIVE_RT/." "$ROOT_RT/" 2>/dev/null) && log "rootfs runtime restored from LIVE_RT"
    fi
  fi
  if [ -f "$ROOT_RT/server.js" ]; then
    cd "$ROOT_RT" || exit 1
    setsid nohup bash -c "cd '$ROOT_RT' && set -a && . '$BASE/.env' 2>/dev/null; set +a; exec env PORT=3000 HOSTNAME=127.0.0.1 NODE_ENV=production NODE_OPTIONS='--max-old-space-size=${HEAP_CAP}' DATABASE_URL='file:$BASE/db/custom.db' node server.js >> '$BASE/ca-runtime.log' 2>&1" </dev/null >/dev/null 2>&1 &
    log "cloudagent runtime respawned (self-contained @ rootfs copy, port 3000)"
    FAILS=0
    GRACE_UNTIL=$(( $(date +%s) + 180 ))
    sleep 30
    continue
  fi
  # v101 SPEED MODE: with the .prodmode marker + a production build present,
  # recovery starts `next start` (prod) instead of `next dev` — same RAM/
  # latency benefits as the supervisor's prod branch. Cold .next clear only
  # happens in the dev path (a prod build must never be wiped).
  if [ -f "$BASE/.prodmode" ] && [ -f "$BASE/.next/BUILD_ID" ]; then
    cd "$BASE" || exit 1
    NODE_OPTIONS="--max-old-space-size=${HEAP_CAP}" setsid nohup \
      bash -c "cd '$BASE' && PATH='$BASE/node_modules/.bin:$PATH' next start -p 3000 2>&1 | tee -a dev.log" </dev/null >/dev/null 2>&1 &
    log "next start respawned (production build, heap capped at ${HEAP_CAP}MB)"
    FAILS=0
    GRACE_UNTIL=$(( $(date +%s) + 180 ))   # v138: fresh server → fresh grace
    sleep 60
    continue
  fi
  # cold start: stale Turbopack cache caused the TerminalPane ChunkLoadError
  # before; a fresh .next on every recovery keeps chunks consistent
  rm -rf "$BASE/.next"
  cd "$BASE" || exit 1
  NODE_OPTIONS="--max-old-space-size=${HEAP_CAP}" setsid nohup \
    bash -c "cd '$BASE' && PATH='$BASE/node_modules/.bin:$PATH' next dev -p 3000 2>&1 | tee -a dev.log" </dev/null >/dev/null 2>&1 &
  log "next dev respawned (detached, heap capped at ${HEAP_CAP}MB)"
  FAILS=0
  GRACE_UNTIL=$(( $(date +%s) + 180 ))   # v138: fresh server → fresh grace
  sleep 60   # boot + first compile window before probing again
done
