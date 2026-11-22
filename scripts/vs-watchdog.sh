#!/usr/bin/env bash
# VORTEX SERVER watchdog — keeps the standalone production server alive on :3200.
# Runs forever; restarts on death (sandbox OOM protection). Logs to vs-watchdog.log.
APP=/home/z/my-project/vortex-platform/server/VORTEX_SERVER
LOG=$APP/vs-watchdog.log
cd $APP
while true; do
  if ! curl -s -o /dev/null --max-time 5 http://127.0.0.1:3200/ 2>/dev/null; then
    # health check failed — try restart
    if ! pgrep -f "standalone/server.js" > /dev/null; then
      echo "$(date '+%F %T') restarting vortex server (port 3200)" >> $LOG
      setsid env PORT=3200 HOSTNAME=127.0.0.1 NODE_ENV=production NODE_OPTIONS="--max-old-space-size=512" \
        node $APP/.next/standalone/server.js >> $APP/vs-prod.log 2>&1 &
      sleep 8
    fi
  fi
  sleep 20
done
