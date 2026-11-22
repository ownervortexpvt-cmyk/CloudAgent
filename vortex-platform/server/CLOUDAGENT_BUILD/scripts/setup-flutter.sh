#!/usr/bin/env bash
# v75 — Install the real Flutter SDK into the sandbox at
# /home/z/my-project/sdk/flutter-sdk (the path runtime.ts adds to PATH).
# Root cause of "Process exited with code 127 / flutter: command not found".
#
# v75 PATH CHANGE: /home/z/opt is OUTSIDE the persistent workspace and got
# WIPED by the sandbox restart → owner saw "Flutter SDK is not installed"
# again. The SDK now lives INSIDE /home/z/my-project so it survives restarts.
#
# Resumable: re-run this script any time — the download continues from where
# it stopped (curl -C -). Skips straight to setup if the SDK already exists.

set -u
SDK_DIR="${FLUTTER_SDK_DIR:-/home/z/my-project/sdk/flutter-sdk}"
WORK="/home/z/my-project/.flutter-setup"
URL="https://storage.googleapis.com/flutter_infra_release/releases/stable/linux/flutter_linux_3.47.2-stable.tar.xz"
mkdir -p "$WORK"

# v77 HEALTH CHECK — "bin/flutter exists" was NOT enough: a partial tar
# extraction (overlayfs "Directory renamed" quirk) can leave bin/flutter with
# NO bin/internal/ or packages/ — that SDK runs nothing and every build dies
# with "shared.sh: No such file or directory" while the UI said toolchains OK.
sdk_healthy() {
  [ -x "$SDK_DIR/bin/flutter" ] &&
  [ -s "$SDK_DIR/bin/internal/shared.sh" ] &&
  [ -s "$SDK_DIR/packages/flutter_tools/pubspec.yaml" ]
}

if sdk_healthy; then
  echo "[setup-flutter] healthy SDK already present at $SDK_DIR"
else
  if [ -x "$SDK_DIR/bin/flutter" ]; then
    echo "[setup-flutter] SDK present but INCOMPLETE (missing bin/internal or packages/) — reinstalling…"
  fi
  # tarball present + full size (~700MB) → skip download (resumable support)
  if [ -s "$WORK/flutter.tar.xz" ] && [ "$(stat -c%s "$WORK/flutter.tar.xz" 2>/dev/null || echo 0)" -gt 600000000 ]; then
    echo "[setup-flutter] tarball already fully downloaded — skipping download"
  else
    echo "[setup-flutter] downloading (resumable)…"
    for i in $(seq 1 40); do
      curl -sL -C - --retry 3 --retry-delay 2 -o "$WORK/flutter.tar.xz" "$URL" && break
      echo "[setup-flutter] attempt $i failed — retrying in 3s…"
      sleep 3
    done
  fi
  if [ ! -s "$WORK/flutter.tar.xz" ]; then
    echo "[setup-flutter] FATAL: download failed"; exit 1
  fi
  echo "[setup-flutter] extracting…"
  mkdir -p "$(dirname "$SDK_DIR")"
  rm -rf "$SDK_DIR"
  # NOTE overlayfs quirk: tar may exit non-zero in the attribute-restore phase
  # ("Directory renamed before its status could be extracted") while the BODY
  # is complete — judge success by HEALTH (bin/flutter + internal + packages),
  # not tar's exit code.
  tar -xJf "$WORK/flutter.tar.xz" -C "$(dirname "$SDK_DIR")" 2>"$WORK/tar-err.log" || \
    echo "[setup-flutter] tar exited $?. $(tail -1 "$WORK/tar-err.log" 2>/dev/null) — verifying body…"
  if [ ! -x "$(dirname "$SDK_DIR")/flutter/bin/flutter" ] || \
     [ ! -s "$(dirname "$SDK_DIR")/flutter/bin/internal/shared.sh" ] || \
     [ ! -s "$(dirname "$SDK_DIR")/flutter/packages/flutter_tools/pubspec.yaml" ]; then
    echo "[setup-flutter] FATAL: extraction incomplete (bin/internal or packages/ missing) — tarball kept for retry"
    exit 1
  fi
  mv "$(dirname "$SDK_DIR")/flutter" "$SDK_DIR"
  rm -f "$WORK/flutter.tar.xz" "$WORK/tar-err.log"
fi

export PATH="$SDK_DIR/bin:$PATH"
echo "[setup-flutter] git safe.directory…"
git config --global --add safe.directory "$SDK_DIR" 2>/dev/null || true
echo "[setup-flutter] disabling analytics…"
flutter config --no-analytics >/dev/null 2>&1 || true
echo "[setup-flutter] enabling web…"
flutter config --enable-web >/dev/null 2>&1 || true
echo "[setup-flutter] precaching web artifacts (only — saves ~2GB disk)…"
flutter precache --web --force 2>&1 | tail -2
echo "[setup-flutter] version:"
flutter --version 2>&1 | head -3
echo "[setup-flutter] DONE — $(du -sh "$SDK_DIR" | cut -f1) on disk"
