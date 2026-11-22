#!/usr/bin/env bash
# Swap in the freshly built standalone and restart the CloudAgent server.
# Keeper-safe: kill by PID only, detached spawn. Log: build-v162.log
set -u
exec >>/home/z/my-project/build-v162.log 2>&1
STAGE=/home/z/my-project/runtime-store/standalone-new
S=/home/z/my-project/vortex-platform/server/CLOUDAGENT_SERVER/.next/standalone

[ -f "$STAGE/server.js" ] || { echo "[swap] FATAL staged standalone missing"; exit 1; }

PID=$(ss -ltnp 2>/dev/null | awk '/:3000 /' | rg -o 'pid=([0-9]+)' -r '$1' | head -1)
if [ -n "${PID:-}" ]; then
  echo "[swap] stopping server pid $PID"
  kill "$PID" 2>/dev/null
  sleep 3
  kill -0 "$PID" 2>/dev/null && { kill -9 "$PID" 2>/dev/null; sleep 1; }
fi

rm -rf "$S.old"
mv "$S" "$S.old" 2>/dev/null
mv "$STAGE" "$S" || { echo "[swap] FATAL swap failed - rolling back"; mv "$S.old" "$S" 2>/dev/null; exit 1; }
rm -rf "$S.old"
echo "[swap] standalone swapped in"

node -e "const fs=require('fs');const{spawn}=require('child_process');const out=fs.openSync('/home/z/my-project/ca-server.log','a');const c=spawn('node',['server.js'],{cwd:'$S',detached:true,stdio:['ignore',out,out],env:{...process.env,PORT:'3000',HOSTNAME:'127.0.0.1',NODE_ENV:'production',DATABASE_URL:'file:/home/z/my-project/db/custom.db',NODE_OPTIONS:'--max-old-space-size=1280'}});c.unref()"
echo "[swap] server spawned - waiting for :3000"

for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24; do
  sleep 5
  CODE=$(curl -s --max-time 6 -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/ 2>/dev/null)
  echo "[swap] t+$((i*5))s :3000 -> $CODE"
  if [ "$CODE" = "200" ]; then echo "[swap] APP UP OK"; exit 0; fi
done
echo "[swap] app did not come up in 120s"
exit 1
