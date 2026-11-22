#!/usr/bin/env bash
# Diagnose VORTEX SERVER silent death: run in same shell session, capture exit code/signal.
cd /home/z/my-project/vortex-platform/server/VORTEX_SERVER
env PORT=3200 HOSTNAME=127.0.0.1 NODE_ENV=production NODE_OPTIONS="--max-old-space-size=512" node .next/standalone/server.js > vs-diag.log 2>&1 &
PID=$!
sleep 5
echo "--- server up (pid $PID), triggering seed via login ---"
curl -s --max-time 120 -X POST http://127.0.0.1:3200/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@vortex.local","password":"Vortex@2026"}' -o /tmp/login-resp.json -w "loginHTTP:%{http_code}\n" &
CURL_PID=$!
# monitor memory while seeding
for i in $(seq 1 30); do
  sleep 3
  RSS=$(ps -o rss= -p $PID 2>/dev/null | awk '{print int($1/1024)"MB"}')
  ALIVE=$(ps -p $PID > /dev/null 2>&1 && echo yes || echo no)
  AVAIL=$(free -m | awk '/Mem:/{print $7}')
  echo "t=$((i*3))s rss=${RSS:-dead} alive=$ALIVE avail=${AVAIL}MB"
  if [ "$ALIVE" = "no" ]; then break; fi
done
wait $CURL_PID
CURL_CODE=$?
echo "curl exit=$CURL_CODE resp=$(head -c 150 /tmp/login-resp.json 2>/dev/null)"
wait $PID
EXIT=$?
echo "SERVER EXIT CODE: $EXIT  (137=SIGKILL/OOM, 139=segfault, 0=clean)"
