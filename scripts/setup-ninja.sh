#!/usr/bin/env bash
# v79 — Ninja build tool installer → /home/z/my-project/sdk/ninja
# Why: Ninja is the last missing core item on the owner's SDK checklist —
# CMake-generated projects (and Flutter's linux-desktop engine) default to
# the Ninja backend; CMake without Ninja falls back to slow Makefiles.
# Single static binary from GitHub releases (no root needed). Resumable.
set -u
BASE=/home/z/my-project
DEST="$BASE/sdk/ninja"
WORK="$BASE/.flutter-setup"
URL="https://github.com/ninja-build/ninja/releases/download/v1.12.1/ninja-linux.zip"
mkdir -p "$WORK" "$DEST/bin"

if [ -x "$DEST/bin/ninja" ]; then
  echo "[setup-ninja] already present: $("$DEST/bin/ninja" --version 2>&1)"
  exit 0
fi

echo "[setup-ninja] downloading ninja-linux v1.12.1 (resumable)…"
for i in $(seq 1 10); do
  curl -sL -C - --retry 3 --retry-delay 2 -o "$WORK/ninja-linux.zip" "$URL" && break
  echo "[setup-ninja] attempt $i failed — retrying…"; sleep 2
done
[ -s "$WORK/ninja-linux.zip" ] || { echo "[setup-ninja] FATAL: download failed"; exit 1; }

echo "[setup-ninja] extracting…"
rm -f "$DEST/bin/ninja"
unzip -o -q "$WORK/ninja-linux.zip" -d "$DEST/bin" || { echo "[setup-ninja] FATAL: unzip failed"; exit 1; }
chmod +x "$DEST/bin/ninja" 2>/dev/null
rm -f "$WORK/ninja-linux.zip"

# body verification (binary must actually run — overlayfs has eaten files before)
V=$("$DEST/bin/ninja" --version 2>&1) || { echo "[setup-ninja] FATAL: binary not runnable: $V"; exit 1; }
echo "[setup-ninja] DONE — ninja $V at $DEST/bin/ninja"
