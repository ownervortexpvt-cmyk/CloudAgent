#!/usr/bin/env bash
# one-shot disk recovery: free space → restore node_modules → app comes back
# (keeper respawns next dev automatically once ./bin/next exists)
set -u
BASE=/home/z/my-project
LOG=$BASE/recovery.log
log() { echo "[$(date '+%H:%M:%S')] $*" >> "$LOG"; }

log "start — free: $(df -PM / | awk 'NR==2 {print $4}')KB"

# 1. finish tmp cleanup (earlier rm timed out)
rm -rf /tmp/my-project 2>/dev/null &
RMTMP=$!

# 2. free rootfs: temporarily remove rust + dotnet SDKs (sdk-doctor reinstalls
#    them on a future boot when disk allows — marker .sdk-autoheal is set)
rm -rf "$BASE/sdk/rust" "$BASE/sdk/dotnet-sdk" "$BASE/sdk/cargo-home" 2>/dev/null &
RMSDK=$!

wait $RMTMP $RMSDK 2>/dev/null
sleep 2
log "cleanup done — free: $(df -h / | awk 'NR==2 {print $4}')"

# 3. restore node_modules
if [ ! -e "$BASE/node_modules/.bin/next" ]; then
  log "bun install starting"
  (cd "$BASE" && bun install --frozen-lockfile >> "$BASE/deps-install.log" 2>&1)
  if [ -e "$BASE/node_modules/.bin/next" ]; then
    log "bun install OK — next binary restored"
  else
    log "bun install FAILED — see deps-install.log"
    exit 1
  fi
fi

log "free after install: $(df -h / | awk 'NR==2 {print $4}')"
log "done — tunnel-keeper watchdog will bring :3000 up within ~2 min"
