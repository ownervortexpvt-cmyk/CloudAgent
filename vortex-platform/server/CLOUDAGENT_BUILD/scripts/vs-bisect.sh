#!/usr/bin/env bash
# Bisect which request kills the vortex server. Each step: request + alive check.
cd /home/z/my-project/vortex-platform/server/VORTEX_SERVER
PIDFILE=/tmp/vs-bisect.pid

start_server() {
  setsid env PORT=3200 HOSTNAME=127.0.0.1 NODE_ENV=production NODE_OPTIONS="--max-old-space-size=512" node .next/standalone/server.js > vs-bisect.log 2>&1 &
  echo $! > $PIDFILE
  sleep 5
}

alive() {
  ps -p $(cat $PIDFILE) > /dev/null 2>&1 && echo ALIVE || echo DEAD
}

start_server
echo "start: $(alive)"

echo -n "step1 GET /            -> "
curl -s -o /dev/null -w "%{http_code}" --max-time 30 http://127.0.0.1:3200/ ; echo " | $(alive)"

echo -n "step2 GET overview(401)-> "
curl -s -o /dev/null -w "%{http_code}" --max-time 30 http://127.0.0.1:3200/api/v1/overview ; echo " | $(alive)"

echo -n "step3 GET vaas health  -> "
curl -s -o /dev/null -w "%{http_code}" --max-time 30 "http://127.0.0.1:3200/api/vaas/v1/health" ; echo " | $(alive)"

echo -n "step4 login            -> "
curl -s --max-time 60 -X POST http://127.0.0.1:3200/api/v1/auth/login -H "Content-Type: application/json" \
  -d '{"email":"admin@vortex.local","password":"Vortex@2026"}' -o /tmp/bs-login.json -w "%{http_code}" ; echo " | $(alive)"
DEV=$(python3 -c "import json;print(json.load(open('/tmp/bs-login.json'))['data']['devCode'])" 2>/dev/null)
echo "   devCode=$DEV"

echo -n "step5 otp verify       -> "
curl -s --max-time 60 -X POST http://127.0.0.1:3200/api/v1/auth/otp -H "Content-Type: application/json" \
  -d "{\"email\":\"admin@vortex.local\",\"code\":\"$DEV\"}" -o /tmp/bs-otp.json -w "%{http_code}" -D /tmp/bs-otp-headers.txt ; echo " | $(alive)"
grep -i "set-cookie" /tmp/bs-otp-headers.txt | cut -c1-60
echo "   body: $(head -c 120 /tmp/bs-otp.json)"
kill $(cat $PIDFILE) 2>/dev/null
