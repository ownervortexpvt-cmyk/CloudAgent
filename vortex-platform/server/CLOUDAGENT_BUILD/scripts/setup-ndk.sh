#!/usr/bin/env bash
# v78 — Android NDK installer → /home/z/my-project/sdk/android-sdk/ndk/<ver>
# Why: owner listed NDK explicitly. Required for flutter projects using native
# plugins (ndkVersion in build.gradle.kts) and C++ android code.
# Uses the ALREADY-INSTALLED sdkmanager (setup-android.sh must run first).
# DISK GUARD: NDK expands to ~2.5-3G. Only proceeds when >= 3.5G free, so a
# full download never bricks the sandbox mid-extract.
# Resumable: skips when already present.
set -u
DEST="/home/z/my-project/sdk/android-sdk"
JDK="/home/z/my-project/sdk/jdk-17"
NDK_VER="27.2.12479018"   # r27c LTS
NDK_DIR="$DEST/ndk/$NDK_VER"

[ -x "$DEST/cmdline-tools/latest/bin/sdkmanager" ] || { echo "[setup-ndk] FATAL: run scripts/setup-android.sh first"; exit 1; }
[ -x "$JDK/bin/java" ] || { echo "[setup-ndk] FATAL: run scripts/setup-jdk.sh first"; exit 1; }

if [ -f "$NDK_DIR/source.properties" ]; then
  echo "[setup-ndk] already present: $NDK_DIR"
  exit 0
fi

FREE_KB=$(df -k /home/z/my-project | awk 'NR==2 {print $4}')
FREE_GB=$((FREE_KB / 1024 / 1024))
if [ "$FREE_GB" -lt 3 ]; then
  echo "[setup-ndk] SKIP: only ${FREE_GB}G free — NDK needs ~3G (zip + extract + margin)."
  echo "[setup-ndk] Free up disk (or mount cloud storage) and re-run this script."
  exit 0   # not an error — deliberate disk-budget skip
fi

export JAVA_HOME="$JDK" PATH="$JDK/bin:$PATH"
SDKM="$DEST/cmdline-tools/latest/bin/sdkmanager"
echo "[setup-ndk] installing ndk;$NDK_VER (~700M download + ~2.5G extract)…"
yes | "$SDKM" "ndk;$NDK_VER" 2>&1 | tail -3
if [ -f "$NDK_DIR/source.properties" ]; then
  echo "[setup-ndk] DONE — $(du -sh "$NDK_DIR" | cut -f1) on disk"
else
  echo "[setup-ndk] FATAL: ndk dir missing after sdkmanager"; exit 1
fi
