#!/usr/bin/env bash
# v77 — JDK 17 (Temurin) installer → /home/z/my-project/sdk/jdk-17
# Why: gradle (flutter build apk / android builds) needs a full JDK (javac);
# the system java is only a JRE. Lives under sdk/ to survive sandbox restarts.
# Resumable: skips when already present.
set -u
DEST="/home/z/my-project/sdk/jdk-17"
WORK="/home/z/my-project/.flutter-setup"
URL="https://api.adoptium.net/v3/binary/latest/17/ga/linux/x64/jdk/hotspot/normal/eclipse?project=jdk"
mkdir -p "$WORK"

if [ -x "$DEST/bin/javac" ]; then
  echo "[setup-jdk] already present: $("$DEST/bin/javac" -version 2>&1)"
  exit 0
fi
echo "[setup-jdk] downloading Temurin 17 (resumable)…"
for i in $(seq 1 20); do
  curl -sL -C - --retry 3 --retry-delay 2 --speed-time 20 --speed-limit 50000 -o "$WORK/jdk17.tar.gz" "$URL" && break
  echo "[setup-jdk] attempt $i failed — retrying…"; sleep 2
done
[ -s "$WORK/jdk17.tar.gz" ] || { echo "[setup-jdk] FATAL: download failed"; exit 1; }
echo "[setup-jdk] extracting…"
rm -rf "$DEST" /home/z/my-project/sdk/jdk-17.*
tar -xzf "$WORK/jdk17.tar.gz" -C /home/z/my-project/sdk/ || echo "[setup-jdk] tar exited $? — verifying…"
SRC=$(ls -d /home/z/my-project/sdk/jdk-17.* 2>/dev/null | head -1)
[ -n "$SRC" ] || { echo "[setup-jdk] FATAL: extraction failed"; exit 1; }
mv "$SRC" "$DEST"
rm -f "$WORK/jdk17.tar.gz"
"$DEST/bin/javac" -version && echo "[setup-jdk] DONE — $(du -sh "$DEST" | cut -f1)"
