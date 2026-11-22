#!/usr/bin/env bash
# v78 (rewritten from v77 standalone) — Rust via rustup MINIMAL profile.
# Why rewrite: the standalone dist tarball extracts ~1.2G before install
# (peak ~1.5G with the tarball) — disk-fatal on this sandbox. rustup minimal
# (rustc + cargo + rust-std only, no docs/clippy/rustfmt) is ~500M final and
# ~300M peak. Clippy/rustfmt are still installed on top — they are small and
# keep the toolchain practical.
# Layout (everything under the persistent sdk/):
#   RUSTUP_HOME=/home/z/my-project/sdk/rust        (toolchains live here)
#   CARGO_HOME =/home/z/my-project/sdk/cargo-home  (bin shims + registry cache)
#   → shims: sdk/cargo-home/bin/{cargo,rustc,rustup} (runtime.ts PATH + RUSTUP_HOME)
# Resumable: skips when already present.
set -u
BASE="/home/z/my-project"
RUSTUP_HOME="$BASE/sdk/rust"
CARGO_HOME="$BASE/sdk/cargo-home"
WORK="$BASE/.flutter-setup"
export RUSTUP_HOME CARGO_HOME
mkdir -p "$CARGO_HOME" "$WORK"

if [ -x "$CARGO_HOME/bin/cargo" ] && [ -x "$CARGO_HOME/bin/rustc" ] \
   && "$CARGO_HOME/bin/rustc" --version >/dev/null 2>&1; then
  echo "[setup-rust] present: $("$CARGO_HOME/bin/rustc" --version 2>&1) / $("$CARGO_HOME/bin/cargo" --version 2>&1)"
  exit 0
fi

echo "[setup-rust] downloading rustup-init…"
for i in $(seq 1 20); do
  curl -sSfL --retry 3 --retry-delay 2 -o "$WORK/rustup-init" https://sh.rustup.rs && break
  echo "[setup-rust] attempt $i failed — retrying…"; sleep 2
done
[ -s "$WORK/rustup-init" ] || { echo "[setup-rust] FATAL: rustup-init download failed"; exit 1; }
chmod +x "$WORK/rustup-init"

echo "[setup-rust] installing minimal profile (rustc/cargo/rust-std)…"
"$WORK/rustup-init" -y --profile minimal --no-modify-path >> "$WORK/rustup.log" 2>&1 \
  || { echo "[setup-rust] FATAL: rustup install failed (see $WORK/rustup.log)"; tail -5 "$WORK/rustup.log"; exit 1; }
rm -f "$WORK/rustup-init"

# small quality-of-life components on top of minimal
"$CARGO_HOME/bin/rustup" component add clippy rustfmt >> "$WORK/rustup.log" 2>&1 || true

export PATH="$CARGO_HOME/bin:$PATH"
"$CARGO_HOME/bin/rustc" --version && "$CARGO_HOME/bin/cargo" --version
echo "[setup-rust] DONE — $(du -sh "$RUSTUP_HOME" | cut -f1) toolchain + $(du -sh "$CARGO_HOME" | cut -f1) cargo home"
