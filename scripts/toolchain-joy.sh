#!/usr/bin/env bash
# toolchain-joy.sh — Joy Service (owner's 100GB S3) as the PERMANENT home for
# toolchain masters. Why: the sandbox rootfs is 10GB andossfs (/home/sync)
# can lose lazy-flushed data on a hard kill; Joy S3 is the owner's paid,
# durable store. This script keeps ONE master tarball per toolchain on Joy
# and can restore any toolchain from it in one command.
#
# Layout on Joy (bucket vortex-websites):
#   vortex-platform-seeds/toolchains/<name>.tar.gz
#
# Usage:
#   bash scripts/toolchain-joy.sh status            # HEAD each master on Joy
#   bash scripts/toolchain-joy.sh masters           # upload missing masters (uses markers)
#   bash scripts/toolchain-joy.sh masters force     # re-upload ALL masters
#   bash scripts/toolchain-joy.sh restore <name>    # restore one toolchain from Joy
#
# Temp tarballs are written to /tmp/my-project (PolarFS — huge, not the
# 10GB rootfs) and deleted after upload.
set -u
BASE=/home/z/my-project
TC=/home/sync/toolchains
WORK=/tmp/my-project/tcwork
JOY=scripts/joy-put.cjs
BUCKET=vortex-websites
KEYROOT=vortex-platform-seeds/toolchains
LOG=$BASE/toolchain-joy.log

mkdir -p "$WORK"
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"; }

NAMES="jdk flutter android gradle ndk dotnet kotlin cmake ninja go php maven rust"

# dir-name on $TC for each logical toolchain (markers use logical name)
dir_of() {
  case "$1" in
    jdk) echo jdk-17 ;;
    flutter) echo flutter-sdk ;;
    android|ndk) echo android-sdk ;;
    dotnet) echo dotnet-sdk ;;
    go) echo go-sdk ;;
    rust) echo cargo-home ;;
    maven) echo maven ;;
    *) echo "$1" ;;
  esac
}

status() {
  for n in $NAMES; do
    out=$(node "$BASE/$JOY" head "$BUCKET" "$KEYROOT/$n.tar.gz" 2>&1 | head -1)
    printf "%-8s %s\n" "$n" "$out"
  done
}

masters() {
  FORCE=${1:-}
  for n in $NAMES; do
    d=$(dir_of "$n")
    if [ ! -d "$TC/$d" ] || [ ! -e "$TC/.installed-$n" ]; then
      log "SKIP $n (not installed yet: $TC/$d)"
      continue
    fi
    if [ "$FORCE" != "force" ]; then
      code=$(node "$BASE/$JOY" head "$BUCKET" "$KEYROOT/$n.tar.gz" 2>/dev/null | awk '{print $2}')
      if [ "$code" = "200" ]; then log "SKIP $n (master already on Joy)"; continue
      fi
    fi
    log "TAR $n ($d) → PolarFS temp"
    tar czf "$WORK/$n.tar.gz" -C "$TC" "$d" 2>>"$LOG" || { log "FAIL tar $n"; rm -f "$WORK/$n.tar.gz"; continue; }
    sz=$(du -m "$WORK/$n.tar.gz" | cut -f1)
    log "PUT $n (${sz}MB) → $BUCKET/$KEYROOT/$n.tar.gz"
    if node "$BASE/$JOY" put "$WORK/$n.tar.gz" "$BUCKET" "$KEYROOT/$n.tar.gz" >> "$LOG" 2>&1; then
      log "OK   $n master on Joy"
    else
      log "FAIL put $n"
    fi
    rm -f "$WORK/$n.tar.gz"
  done
}

restore() {
  n=${1:-}
  case " $NAMES " in *" $n "*) ;; *) echo "unknown toolchain: $n"; exit 2 ;; esac
  d=$(dir_of "$n")
  log "RESTORE $n from Joy"
  if ! node "$BASE/$JOY" get "$BUCKET" "$KEYROOT/$n.tar.gz" "$WORK/$n.tar.gz" >> "$LOG" 2>&1; then
    log "FAIL get $n"; echo "download failed — see $LOG"; exit 1
  fi
  tar xzf "$WORK/$n.tar.gz" -C "$TC" && touch "$TC/.installed-$n" && log "OK   $n restored ($d)"
  rm -f "$WORK/$n.tar.gz"
}

case "${1:-}" in
  status)  status ;;
  masters) shift; masters "${1:-}" ;;
  restore) shift; restore "$@" ;;
  *) echo "usage: toolchain-joy.sh status|masters[force]|restore <name>"; exit 2 ;;
esac
