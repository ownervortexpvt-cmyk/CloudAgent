#!/bin/bash
# ============================================================================
# v127-db-checkpoint.sh — commit the live DB into git so it SURVIVES the
# recurring sandbox recycles (gitignored db/*.db is wiped on every recycle;
# the 7th wipe happened 2026-10-20 21:46 and took the owner's Razorpay setup
# era data with it).
#
# db/state/custom-latest.db is force-tracked in git. .zscripts/dev.sh restores
# it at boot when the live DB is missing (before db:push/boot-heal).
#
# Usage: bash scripts/v127-db-checkpoint.sh [message]
# Never fails the caller: git errors are printed but exit 0.
# ============================================================================
set -u
BASE=/home/z/my-project
cd "$BASE" || exit 0

MSG="${1:-db checkpoint (v127): users + keys + github + settings}"

# stop the running platform first? NO — use sqlite's safe backup API instead:
# a plain cp of a WAL-mode db can tear. The Python sqlite3 backup API produces
# a consistent snapshot even while the server runs.
python3 - << 'PY' || exit 0
import sqlite3
src = sqlite3.connect('/home/z/my-project/db/custom.db')
dst = sqlite3.connect('/home/z/my-project/db/state/custom-latest.db')
src.backup(dst)
dst.close(); src.close()
print('checkpoint snapshot written')
PY

git add -f db/state/custom-latest.db db/state/README.md 2>/dev/null
if git diff --cached --quiet 2>/dev/null; then
  echo "checkpoint unchanged — nothing to commit"
  exit 0
fi
git commit -q -m "$MSG" || { echo "git commit failed (printed above)"; exit 0; }
git push origin main 2>&1 | tail -1 || { echo "git push failed — checkpoint committed locally only"; exit 0; }
echo "checkpoint committed + pushed (survives recycles now)"
