#!/usr/bin/env bash
# v78 — Standalone Gradle installer → /home/z/my-project/sdk/gradle
# Why: flutter android builds ship a gradle WRAPPER, but wrapper needs to
# download its distribution into GRADLE_USER_HOME on first build (~130M each
# project). A standalone gradle on PATH gives non-wrapper builds, direct
# `gradle` tasks, and a fallback when wrapper download is slow.
# Gradle 8.12 supports AGP 8.7 (what Flutter 3.47 templates use).
# Resumable: skips when already present.
set -u
DEST="/home/z/my-project/sdk/gradle"
WORK="/home/z/my-project/.flutter-setup"
VER="8.12"
URL="https://services.gradle.org/distributions/gradle-${VER}-bin.zip"
mkdir -p "$WORK"

if [ -x "$DEST/bin/gradle" ]; then
  echo "[setup-gradle] already present: $("$DEST/bin/gradle" --version 2>/dev/null | grep Gradle | head -1)"
  exit 0
fi
echo "[setup-gradle] downloading Gradle ${VER} (resumable)…"
for i in $(seq 1 20); do
  curl -sL -C - --retry 3 --retry-delay 2 --speed-time 20 --speed-limit 50000 -o "$WORK/gradle.zip" "$URL" && break
  echo "[setup-gradle] attempt $i failed — retrying…"; sleep 2
done
[ -s "$WORK/gradle.zip" ] || { echo "[setup-gradle] FATAL: download failed"; exit 1; }
echo "[setup-gradle] extracting…"
rm -rf "$WORK/gradle-x" "$DEST"
unzip -q -o "$WORK/gradle.zip" -d "$WORK/gradle-x" || { echo "[setup-gradle] FATAL: unzip failed"; exit 1; }
mv "$WORK/gradle-x/gradle-${VER}" "$DEST"
rm -rf "$WORK/gradle-x" "$WORK/gradle.zip"
export PATH="$DEST/bin:$PATH"
echo "[setup-gradle] version: $(gradle --version 2>/dev/null | grep Gradle | head -1)"
echo "[setup-gradle] DONE — $(du -sh "$DEST" | cut -f1) on disk"
