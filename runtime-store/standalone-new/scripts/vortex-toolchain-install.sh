#!/usr/bin/env bash
# ============================================================
# Vortex Cloud Agent — FULL TOOLCHAIN INSTALLER (one time, permanent)
# Target: any fresh Ubuntu 22.04/24.04 or Debian 12 host (Oracle Cloud
# Always Free ARM/AMD VM is the recommended "ekdom free, 100GB+" box).
#
# Everything installs DIRECTLY and SYSTEM-WIDE — nothing archived,
# nothing ephemeral. Survives reboots forever (apt/binary installs).
#
# Usage:  sudo bash vortex-toolchain-install.sh
# ============================================================
set -euo pipefail

if [[ $EUID -ne 0 ]]; then echo "run with sudo"; exit 1; fi

echo "── [1/7] base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git ca-certificates gnupg jq unzip zip build-essential \
  python3 python3-pip python3-venv ffmpeg nginx ufw sqlite3 libsqlite3-dev \
  openjdk-17-jdk-headless

echo "── [2/7] Node.js 20 LTS (system-wide)"
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -c2- | cut -d. -f1)" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "── [3/7] bun (system-wide /usr/local/bin)"
if ! command -v bun >/dev/null 2>&1; then
  curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash
  ln -sf /usr/local/bin/bun/bun /usr/local/bin/bun 2>/dev/null || true
fi
bun -v || true

echo "── [4/7] global npm toolchain (next/prisma helpers, typescript)"
npm install -g typescript tsx prisma@6 pm2 --no-fund --no-audit || true

echo "── [5/7] 4G swap (builds never OOM)"
if ! swapon --show | grep -q '/swapfile'; then
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "── [6/7] firewall (ssh + http + https only)"
ufw allow OpenSSH >/dev/null 2>&1 || true
ufw allow 80/tcp  >/dev/null 2>&1 || true
ufw allow 443/tcp >/dev/null 2>&1 || true
yes | ufw enable >/dev/null 2>&1 || true

echo "── [7/7] verify"
for t in node bun git python3 java ffmpeg nginx sqlite3; do
  printf '%-10s %s\n' "$t" "$(command -v $t >/dev/null 2>&1 && $t --version 2>&1 | head -1 || echo MISSING)"
done

echo
echo "TOOLCHAIN READY — installed system-wide, permanent, survives reboots."
echo "Next: sudo bash vortex-ecosystem-install.sh <git-url> <vxtok_...>"
