#!/usr/bin/env bash
# WARM-RUNTIME (v163) — force-load EVERY route into the running next-server's
# memory right after boot. Next standalone lazy-loads per-route files on first
# request; the sandbox janitor deletes the runtime tree within minutes of any
# restore, so any route whose files got eaten BEFORE its first visitor 500s
# forever. Warming every page + API at boot makes the RUNNING server fully
# self-contained in RAM — janitor gutting becomes harmless (v159 lesson:
# "files only needed at require-time").
# Any status except 000/500 counts as warm (401/403/405/404 all prove the
# route module loaded and executed).
set -u
BASE=/home/z/my-project
ROUTES="$BASE/runtime-store/warm-routes.txt"
LOG="$BASE/warm-runtime.log"
PORT=3000
[ -s "$ROUTES" ] || { echo "no routes file" >> "$LOG"; exit 0; }

echo "[$(date '+%F %T')] warm-up started ($(wc -l < "$ROUTES") routes)" >> "$LOG"
# two passes — some nested routes only resolve after their parents are warm
for pass in 1 2; do
  cold=0
  while IFS= read -r r; do
    [ -n "$r" ] || continue
    c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 "http://127.0.0.1:${PORT}${r}" 2>/dev/null)
    if [ "$c" = "000" ] || [ "$c" = "500" ] || [ "$c" = "502" ]; then
      cold=$((cold+1))
      echo "[$(date '+%F %T')] pass$pass COLD $c $r" >> "$LOG"
    fi
  done < "$ROUTES"
  echo "[$(date '+%F %T')] pass$pass done — cold=$cold" >> "$LOG"
  [ "$cold" -eq 0 ] && break
  sleep 3
done
echo "[$(date '+%F %T')] warm-up finished" >> "$LOG"
