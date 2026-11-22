#!/bin/bash
# Resumable dotnet SDK 8 installer for Cloud Agent (C# runtime support)
# v75: install INSIDE the persistent workspace (/home/z/opt was wiped by a
# sandbox restart — SDKs must live under /home/z/my-project to survive).
set -e
DEST="${DOTNET_SDK_DIR:-/home/z/my-project/sdk/dotnet-sdk}"
if [ -x "$DEST/dotnet" ]; then echo "dotnet already installed"; $DEST/dotnet --version; exit 0; fi
mkdir -p "$DEST"
mkdir -p /home/z/my-project/.flutter-setup
cd /home/z/my-project/.flutter-setup
[ -f dotnet-install.sh ] || curl -fsSL https://dot.net/v1/dotnet-install.sh -o dotnet-install.sh
chmod +x dotnet-install.sh
./dotnet-install.sh --channel 8.0 --install-dir "$DEST" --no-path
echo "DONE"; "$DEST/dotnet" --version
