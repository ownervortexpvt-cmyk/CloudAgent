#!/usr/bin/env bash
# v77 — Go toolchain → /home/z/my-project/sdk/go-sdk (+ persistent GOPATH/GOCACHE)
# Why: languages.ts claims Go but `go` binary was MISSING from the server.
set -u
DEST="/home/z/my-project/sdk/go-sdk"
WORK="/home/z/my-project/.flutter-setup"
mkdir -p "$WORK"
if [ -x "$DEST/bin/go" ]; then echo "[setup-go] present: $("$DEST/bin/go" version 2>&1)"; exit 0; fi
FNAME=$(curl -s "https://go.dev/dl/?mode=json" | grep -o 'go[0-9.]*\.linux-amd64\.tar\.gz' | head -1)
[ -n "$FNAME" ] || FNAME="go1.25.0.linux-amd64.tar.gz"
URL="https://go.dev/dl/$FNAME"
echo "[setup-go] downloading $FNAME (resumable)…"
for i in $(seq 1 20); do
  curl -sL -C - --retry 3 --retry-delay 2 -o "$WORK/go.tar.gz" "$URL" && break
  echo "[setup-go] attempt $i failed — retrying…"; sleep 2
done
[ -s "$WORK/go.tar.gz" ] || { echo "[setup-go] FATAL: download failed"; exit 1; }
echo "[setup-go] extracting…"
rm -rf "$DEST"
tar -xzf "$WORK/go.tar.gz" -C /home/z/my-project/sdk/ || echo "[setup-go] tar exited $? — verifying…"
[ -x /home/z/my-project/sdk/go/bin/go ] || { echo "[setup-go] FATAL: extraction failed"; exit 1; }
mv /home/z/my-project/sdk/go "$DEST"
rm -f "$WORK/go.tar.gz"
mkdir -p /home/z/my-project/sdk/go-home/build   # persistent GOPATH + GOCACHE
"$DEST/bin/go" version && echo "[setup-go] DONE — $(du -sh "$DEST" | cut -f1)"
