#!/usr/bin/env bash
# v78 — CMake installer → /home/z/my-project/sdk/cmake
# Why: owner listed CMake explicitly. Needed by NDK native builds and any
# C/C++ project template. Kitware ships official linux x86_64 binaries —
# no root needed.
# Resumable: skips when already present.
set -u
DEST="/home/z/my-project/sdk/cmake"
WORK="/home/z/my-project/.flutter-setup"
VER="3.31.2"
URL="https://github.com/Kitware/CMake/releases/download/v${VER}/cmake-${VER}-linux-x86_64.tar.gz"
mkdir -p "$WORK"

if [ -x "$DEST/bin/cmake" ]; then
  echo "[setup-cmake] already present: $("$DEST/bin/cmake" --version | head -1)"
  exit 0
fi
echo "[setup-cmake] downloading CMake ${VER} (resumable)…"
for i in $(seq 1 20); do
  curl -sL -C - --retry 3 --retry-delay 2 -o "$WORK/cmake.tar.gz" "$URL" && break
  echo "[setup-cmake] attempt $i failed — retrying…"; sleep 2
done
[ -s "$WORK/cmake.tar.gz" ] || { echo "[setup-cmake] FATAL: download failed"; exit 1; }
echo "[setup-cmake] extracting…"
rm -rf "$WORK/cmake-x" "$DEST"
mkdir -p "$WORK/cmake-x"   # tar -C requires the target dir to PRE-EXIST
# overlayfs-safe: judge by extracted body, not tar's exit code
tar -xzf "$WORK/cmake.tar.gz" -C "$WORK/cmake-x" 2>"$WORK/cmake-tar-err.log" || \
  echo "[setup-cmake] tar exited $?. $(tail -1 "$WORK/cmake-tar-err.log" 2>/dev/null) — verifying body…"
[ -d "$WORK/cmake-x/cmake-${VER}-linux-x86_64/bin" ] || { echo "[setup-cmake] FATAL: extraction body incomplete"; exit 1; }
rm -f "$WORK/cmake-tar-err.log"
mv "$WORK/cmake-x/cmake-${VER}-linux-x86_64" "$DEST"
rm -rf "$WORK/cmake-x" "$WORK/cmake.tar.gz"
export PATH="$DEST/bin:$PATH"
echo "[setup-cmake] version: $(cmake --version | head -1)"
echo "[setup-cmake] DONE — $(du -sh "$DEST" | cut -f1) on disk"
