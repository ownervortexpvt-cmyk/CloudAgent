#!/usr/bin/env bash
# v153 — INSTALL-ALL TOOLCHAINS (direct, permanent, never reset)
#
# Owner directive: "shob toolchain install kore okhane bore din — archive
# korar proyojon nei, shorashori install kore rakho, kokhonoi reset hobena".
#
# HOW: all 13 managed toolchains install DIRECTLY into /home/sync/toolchains
# (the object-storage home — effectively unlimited, survives every sandbox
# recycle/janitor wipe). /home/z/my-project/sdk is a symlink to it, so every
# existing probe path (sdk/flutter-sdk/…, sdk/jdk-17/…) keeps working with
# zero code changes. No archive → extract cycle ever again.
#
# Two parallel lanes keep wall time down; the big four (jdk → flutter →
# android → ndk) take the long lane in dependency order. Every setup script
# is idempotent + resumable: rerunning never redoes finished work.
set -u
BASE=/home/z/my-project
LOG=$BASE/toolchain-install.log
WORK=$BASE/.flutter-setup

mkdir -p /home/sync/toolchains "$WORK"
[ -e "$BASE/sdk" ] || ln -sfn /home/sync/toolchains "$BASE/sdk"

mark() { touch "/home/sync/toolchains/.installed-$1"; }

# post-success cleanup: the downloaded tarballs live on the SMALL rootfs
# (1.7GB free) — remove each one as soon as its toolchain landed on ossfs,
# or the janitor/ENOSPC eats the box mid-install.
cleanup_work() {
  case "$1" in
    jdk)     rm -f "$WORK/jdk17.tar.gz" ;;
    flutter) rm -f "$WORK"/flutter*.tar.* "$WORK"/flutter.tar* ;;
    android) rm -f "$WORK"/android*.zip "$WORK"/commandlinetools*.zip ;;
    ndk)     rm -f "$WORK"/ndk*.zip ;;
    dotnet)  rm -f "$WORK"/dotnet*.tar.gz ;;
    go)      rm -f "$WORK"/go*.tar.gz ;;
    rust)    rm -f "$WORK"/rustup*.tar.gz ;;
    *) : ;;
  esac
}

install_one() {
  local name="$1"
  echo "[$(date +%H:%M:%S)] START $name" >> "$LOG"
  if bash "$BASE/scripts/setup-$name.sh" >> "$LOG" 2>&1; then
    mark "$name"
    cleanup_work "$name"
    echo "[$(date +%H:%M:%S)] OK    $name" >> "$LOG"
  else
    echo "[$(date +%H:%M:%S)] FAIL  $name (rerun the installer — scripts are resumable)" >> "$LOG"
  fi
}

lane_big() {
  install_one jdk
  install_one flutter
  install_one android
  install_one gradle
  install_one ndk
}

lane_small() {
  install_one kotlin
  install_one cmake
  install_one ninja
  install_one go
  install_one php
  install_one maven
  install_one dotnet
  install_one rust
}

echo "=== install-all START $(date) (home: /home/sync/toolchains, SEQUENTIAL) ===" >> "$LOG"
# v153.1 — SEQUENTIAL ONLY: the parallel lanes filled the 9.9GB rootfs
# (concurrent download archives + ossfs multipart staging + /tmp) → ENOSPC
# killed flutter/android/ndk/dotnet/rust mid-flight. One at a time, cleanup
# after each, resumable: reruns only install what is still missing.
for name in flutter android gradle ndk dotnet rust kotlin cmake ninja go php maven jdk; do
  if [ -e "/home/sync/toolchains/.installed-$name" ]; then
    echo "[$(date +%H:%M:%S)] SKIP  $name (already installed)" >> "$LOG"
  else
    install_one "$name"
  fi
done
echo "=== install-all DONE $(date) — installed: $(ls /home/sync/toolchains/.installed-* 2>/dev/null | wc -l)/13 ===" >> "$LOG"
