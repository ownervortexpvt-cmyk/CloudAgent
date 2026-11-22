#!/usr/bin/env bash
# toolchain-masters-loop.sh — background daemon: whenever a toolchain finishes
# installing on /home/sync/toolchains (.installed-<name> marker appears) and
# has no master on Joy yet, upload its master tarball to the owner's Joy S3
# (100GB). Single-instance via lock. Logs to toolchain-joy.log.
set -u
BASE=/home/z/my-project
LOCK=$BASE/.toolchain-masters.lock
LOG=$BASE/toolchain-joy.log

exec 9>"$LOCK"
if ! flock -n 9; then exit 0; fi

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [masters-loop] $*" >> "$LOG"; }

log "loop started"
while true; do
  # any marker without a Joy master yet?
  pending=""
  for m in /home/sync/toolchains/.installed-*; do
    [ -e "$m" ] || continue
    n=$(basename "$m" | sed 's/^\.installed-//')
    code=$(node "$BASE/scripts/joy-put.cjs" head vortex-websites "vortex-platform-seeds/toolchains/$n.tar.gz" 2>/dev/null | awk '{print $2}')
    [ "$code" = "200" ] || pending="$pending $n"
  done
  if [ -n "$pending" ]; then
    log "uploading masters for:$pending"
    bash "$BASE/scripts/toolchain-joy.sh" masters >> "$LOG" 2>&1
  fi
  sleep 300
done
