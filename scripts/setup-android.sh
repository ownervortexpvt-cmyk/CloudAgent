#!/usr/bin/env bash
# v77 — Android SDK installer → /home/z/my-project/sdk/android-sdk
# Why: owner asked "Flutter er shob kisui install koro (Android/iPhone/desktop)".
# Installs cmdline-tools + platform-tools + android-36 platform + build-tools 36,
# accepts licenses. Needs JDK 17 (run scripts/setup-jdk.sh first).
# NOTE: does NOT install NDK (2.5G+ — disk-fatal on this 9.9G sandbox) and does
# NOT pre-cache gradle modules-2 (740M) — APK assembly is disk-bound (see worklog v76).
set -u
DEST="/home/z/my-project/sdk/android-sdk"
JDK="/home/z/my-project/sdk/jdk-17"
WORK="/home/z/my-project/.flutter-setup"
URL="https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"
mkdir -p "$WORK"

[ -x "$JDK/bin/java" ] || { echo "[setup-android] FATAL: run scripts/setup-jdk.sh first"; exit 1; }
export JAVA_HOME="$JDK" PATH="$JDK/bin:$PATH"

if [ -x "$DEST/cmdline-tools/latest/bin/sdkmanager" ]; then
  echo "[setup-android] cmdline-tools already present"
else
  echo "[setup-android] downloading cmdline-tools (resumable)…"
  for i in $(seq 1 20); do
    curl -sL -C - --retry 3 --retry-delay 2 --speed-time 20 --speed-limit 50000 -o "$WORK/cmdline-tools.zip" "$URL" && break
    echo "[setup-android] attempt $i failed — retrying…"; sleep 2
  done
  [ -s "$WORK/cmdline-tools.zip" ] || { echo "[setup-android] FATAL: download failed"; exit 1; }
  echo "[setup-android] extracting…"
  rm -rf "$DEST"
  mkdir -p "$DEST/cmdline-tools"
  unzip -q -o "$WORK/cmdline-tools.zip" -d "$WORK/clt-x" || { echo "[setup-android] FATAL: unzip failed"; exit 1; }
  mv "$WORK/clt-x/cmdline-tools" "$DEST/cmdline-tools/latest"
  rm -rf "$WORK/clt-x" "$WORK/cmdline-tools.zip"
fi
SDKM="$DEST/cmdline-tools/latest/bin/sdkmanager"
[ -x "$SDKM" ] || { echo "[setup-android] FATAL: sdkmanager missing"; exit 1; }

echo "[setup-android] accepting licenses…"
yes | "$SDKM" --licenses >/dev/null 2>&1 || true
echo "[setup-android] installing platform-tools + android-36 + build-tools 36 (this takes a few minutes)…"
yes | "$SDKM" "platform-tools" "platforms;android-36" "build-tools;36.0.0" 2>&1 | tail -3
rm -rf "$DEST/.temp" 2>/dev/null || true
echo "[setup-android] installed:"; ls "$DEST"
echo "[setup-android] DONE — $(du -sh "$DEST" | cut -f1)"
