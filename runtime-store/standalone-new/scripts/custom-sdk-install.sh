#!/usr/bin/env bash
# v79 — custom SDK binary installer (operator-facing, driven by /api/sdks POST).
# Downloads a tarball/zip/raw binary from an operator-supplied URL and installs
# it into sdk/custom/<name>/ so runtime.ts auto-discovers it on the next Run.
#
# v86 — LOCAL SOURCE SUPPORT: the "source" arg may also be a file inside the
# platform's added storage (/home/z/my-project/upload — the only storage that
# survives snapshot wipes). The owner stored SDK archives there and could
# never use them; now they install directly (cp instead of curl).
#
# Usage: custom-sdk-install.sh <name> <url-or-upload-file> <format: tar.gz|tgz|tar.bz2|tar.xz|zip|binary>
# State files (inside the target dir):
#   .install-log    — live log (API tails this for progress)
#   .install-status — "ok" | "failed: <reason>" (written ONLY at the end)
#   .sdk-meta.json  — operator metadata (name/source/installedAt)
set -u
NAME="$1"; SOURCE="$2"; FORMAT="$3"
BASE=/home/z/my-project
UPLOAD_ROOT="$BASE/upload"
DEST="$BASE/sdk/custom/$NAME"
WORK="$BASE/.flutter-setup"
LOG="$DEST/.install-log"
STATUS="$DEST/.install-status"

mkdir -p "$DEST" "$WORK"
: > "$LOG"
rm -f "$STATUS"

log() { echo "[$(date '+%H:%M:%S')] $*" >> "$LOG"; }

fail() { log "FATAL: $1"; echo "failed: $1" > "$STATUS"; exit 1; }

log "installing custom SDK '$NAME' from $SOURCE (format: $FORMAT)"

# ---- disk budget guard: refuse to install when the sandbox is nearly full
FREE_KB=$(df -k "$BASE" | awk 'NR==2 {print $4}')
if [ "$FREE_KB" -lt 524288 ]; then
  fail "only $((FREE_KB/1024))MB free on the 9.9G sandbox — need ≥512MB. Free disk first (see Storage panel)."
fi
log "disk check passed ($((FREE_KB/1024))MB free)"

# ---- fetch (URL download OR direct copy from added storage)
ARCHIVE="$WORK/custom-$NAME.download"
case "$SOURCE" in
  http://*|https://*)
    ok=0
    for i in $(seq 1 20); do
      curl -sL -C - --retry 3 --retry-delay 2 --max-time 900 -o "$ARCHIVE" "$SOURCE" && { ok=1; break; }
      log "download attempt $i failed — retrying…"; sleep 2
    done
    [ "$ok" = 1 ] && [ -s "$ARCHIVE" ] || fail "download failed after 20 attempts"
    log "downloaded $(du -h "$ARCHIVE" | cut -f1)"
    ;;
  *)
    # v86: local file — must live inside the upload mount (belt and braces;
    # the API already validated containment).
    SRC=$(readlink -f "$SOURCE" 2>/dev/null || echo "")
    case "$SRC" in
      "$UPLOAD_ROOT"/*) ;;
      *) fail "local source must be inside $UPLOAD_ROOT (added storage)" ;;
    esac
    [ -f "$SRC" ] || fail "source file not found: $SRC"
    cp -f "$SRC" "$ARCHIVE" || fail "copy from added storage failed"
    [ -s "$ARCHIVE" ] || fail "copied file is empty"
    log "copied $(du -h "$ARCHIVE" | cut -f1) from added storage"
    ;;
esac

# ---- extract per format
case "$FORMAT" in
  tar.gz|tgz)
    tar -xzf "$ARCHIVE" -C "$DEST" 2>>"$LOG" || fail "tar extraction failed"
    ;;
  tar.bz2)
    tar -xjf "$ARCHIVE" -C "$DEST" 2>>"$LOG" || fail "tar.bz2 extraction failed"
    ;;
  tar.xz)
    tar -xJf "$ARCHIVE" -C "$DEST" 2>>"$LOG" || fail "tar.xz extraction failed"
    ;;
  zip)
    unzip -o -q "$ARCHIVE" -d "$DEST" 2>>"$LOG" || fail "unzip failed"
    ;;
  binary)
    mv "$ARCHIVE" "$DEST/$NAME" && chmod +x "$DEST/$NAME" || fail "binary placement failed"
    ;;
  *)
    fail "unknown format '$FORMAT'"
    ;;
esac
rm -f "$ARCHIVE"

# ---- overlayfs body verification: at least one real entry must exist
# (tar exit codes have lied on this filesystem before — verify by content)
COUNT=$(ls -A "$DEST" 2>/dev/null | grep -v '^\.' | wc -l)
[ "$COUNT" -gt 0 ] || fail "extraction produced an empty directory (overlayfs quirk?)"

# ---- chmod +x every top-level executable-looking file so runtime PATH works
find "$DEST" -maxdepth 2 -type f \( -name '*.sh' -o -perm -u+x \) -exec chmod +x {} \; 2>/dev/null

cat > "$DEST/.sdk-meta.json" <<EOF
{"name":"$NAME","source":"$SOURCE","format":"$FORMAT","installedAt":"$(date -Iseconds)"}
EOF
echo "ok" > "$STATUS"
log "DONE — $COUNT entries installed. Available on the next Run (auto-discovered on PATH) and in the Terminal."
