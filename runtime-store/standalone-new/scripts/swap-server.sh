#!/usr/bin/env bash
# Swap in the freshly built standalone and restart the CloudAgent server on :3000.
# Keeper-safe: kill by PID only, detached spawn, logs to ca-server.log.
set -u
LOG=/home/z/my-project/build-v162.log
STAGE=/home/z/my-project/runtime-store/standalone-new
S=/home/z/my-project/vortex-platform/server/CLOUDAGENT_SERVER/.next/standalone
log() { echo "[$(date '+%H:%M:%S')] $*" >> "$LOG"; }

[ -f "$STAGE/server.js" ] || { log "FATAL: staged standalone missing"; exit 1 }

# stop current :3000 server (PID from the socket — never pkill)
PID=$(ss -ltnp 2>/dev/null | awk '/:3000 /{print $NF}' | rg -o 'pid=([0-9]+)' -r '$1' | head -1)
if [ -n "$PID" ]; then
  log "stopping server pid $PID"
  kill "$PID" 2>/dev/null; sleep 3
  kill -0 "$PID" 2>/dev/null && { kill -9 "$PID" 2>/dev/null; sleep 1; }
fi

# swap directories
rm -rf "$S.old"; mv "$S" "$S.old" 2>/dev/null
mv "$STAGE" "$S" || { log "FATAL: swap failed — rolling back"; mv "$S.old" "$S" 2>/dev/null; exit 1 }
rm -rf "$S.old"
log "standalone swapped in"

# start
node -e "const fs=require('fs');const{spawn}=require('child_process');const out=fs.openSync('/home/z/my-project/ca-server.log','a');const c=spawn('node',['server.js'],{cwd:'$S',detached:true,stdio:['ignore',out,out],env:{...process.env,PORT:'3000',HOSTNAME:'127.0.0.1',NODE_ENV:'production',DATABASE_URL:'file:/home/z/my-project/db/custom.db',NODE_OPTIONS:'--max-old-space-size=1280'}});c.unref()"
log "server spawned — waiting for :3000"
for i in $(seq 1 24); do
  sleep 5
  CODE=$(curl -s --max-time 6 -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/ 2>/dev/null)
  log "t+$((i*5))s :3000 -> $CODE"
  [ "$CODE" = "200" ] && { log "APP UP ✔"; exit 0; }
done
log "app did not come up in 120s"
exit 1
