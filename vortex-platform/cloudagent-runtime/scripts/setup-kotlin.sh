#!/usr/bin/env bash
# v78 — Kotlin compiler (kotlinc) installer → /home/z/my-project/sdk/kotlin
# Why: owner listed Kotlin explicitly. Also lets Kotlin-only projects run
# (`kotlinc main.kt -include-runtime -d app.jar && java -jar app.jar`).
# Needs JDK (JAVA_HOME) at runtime — runs scripts/setup-jdk.sh first.
# Resumable: skips when already present.
set -u
DEST="/home/z/my-project/sdk/kotlin"
WORK="/home/z/my-project/.flutter-setup"
VER="2.1.0"
URL="https://github.com/JetBrains/kotlin/releases/download/v${VER}/kotlin-compiler-${VER}.zip"
mkdir -p "$WORK"

if [ -x "$DEST/bin/kotlinc" ]; then
  echo "[setup-kotlin] already present"
  exit 0
fi
echo "[setup-kotlin] downloading Kotlin compiler ${VER} (resumable)…"
for i in $(seq 1 20); do
  curl -sL -C - --retry 3 --retry-delay 2 -o "$WORK/kotlin.zip" "$URL" && break
  echo "[setup-kotlin] attempt $i failed — retrying…"; sleep 2
done
[ -s "$WORK/kotlin.zip" ] || { echo "[setup-kotlin] FATAL: download failed"; exit 1; }
echo "[setup-kotlin] extracting…"
rm -rf "$WORK/kotlin-x" "$DEST"
unzip -q -o "$WORK/kotlin.zip" -d "$WORK/kotlin-x" || { echo "[setup-kotlin] FATAL: unzip failed"; exit 1; }
mv "$WORK/kotlin-x/kotlinc" "$DEST"
rm -rf "$WORK/kotlin-x" "$WORK/kotlin.zip"
chmod +x "$DEST/bin/"*
export PATH="$DEST/bin:$PATH"
echo "[setup-kotlin] version: $(kotlinc -version 2>&1 | head -1)"
echo "[setup-kotlin] DONE — $(du -sh "$DEST" | cut -f1) on disk"
