#!/bin/bash
# Sentinel: logs existence of node_modules/next every 2s; on vanish, dumps
# processes + recent bun/prisma activity to catch the deleter red-handed.
LOG=/tmp/nm-sentinel.log
BASE=/home/z/my-project
echo "[$(date '+%H:%M:%S')] sentinel started" > "$LOG"
was=1
while true; do
  now=1
  [ -f "$BASE/node_modules/next/package.json" ] || now=0
  if [ "$was" = "1" ] && [ "$now" = "0" ]; then
    {
      echo "[$(date '+%H:%M:%S')] === node_modules/next VANISHED ==="
      ps aux --sort=-%mem | head -14
      echo "--- mount/fs info ---"
      df -h / | tail -1
    } >> "$LOG" 2>&1
  elif [ "$was" = "0" ] && [ "$now" = "1" ]; then
    echo "[$(date '+%H:%M:%S')] node_modules/next REAPPEARED" >> "$LOG"
  fi
  was=$now
  sleep 2
done
