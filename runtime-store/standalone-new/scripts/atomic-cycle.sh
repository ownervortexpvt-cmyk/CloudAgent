#!/bin/bash
# ATOMIC test cycle: install deps → boot server → run the whole battery
# in the first window before the sandbox platform wipes node_modules again.
set -u
cd /home/z/my-project
echo "===== CYCLE START $(date '+%H:%M:%S') ====="

# 0. stop strays
pkill -f "next dev" 2>/dev/null
sleep 1

# 1. deps (restores whatever the platform wiped)
bun install 2>&1 | tail -1
[ -f node_modules/next/package.json ] || { echo "FATAL: install failed"; exit 1; }

# 2. boot
(setsid nohup bash .zscripts/dev.sh >> .zscripts/dev.log 2>&1 < /dev/null &)
for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w "%{http_code}" -m 8 http://localhost:3000/ 2>/dev/null)
  [ "$code" = "200" ] && break
  sleep 3
done
echo "boot: $code"
[ "$code" != "200" ] && { echo "FATAL: boot failed"; exit 1; }

# 3. login
curl -s -m 15 -c /tmp/cj.txt -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"mdhonabali61@gmail.com","password":"Owner123"}' -o /dev/null -w "login:%{http_code}\n"

P=cmwbavvan000gpovwjp1nxw0s
API=http://localhost:3000

# 4. APK build trigger (the big one)
curl -s -b /tmp/cj.txt -X POST $API/projects/$P/export -H 'Content-Type: application/json' \
  -d '{"target":"apk"}' -o /tmp/apk.json -w "apk-post:%{http_code}\n"
head -c 200 /tmp/apk.json; echo

# 5. file-ops suite
bash scripts/test-file-ops.sh 2>/dev/null | grep -E "RESULT"

# 6. build status poll x2
sleep 20
curl -s -b /tmp/cj.txt "$API/projects/$P/export?kind=status" -o /tmp/st1.json -w "status1:%{http_code}\n"
python3 - <<'EOF' 2>/dev/null || echo "(status parse failed)"
import json
d=json.load(open('/tmp/st1.json'))
apk=d['targets']['apk']
print('apk state:', apk.get('state'), '| step:', apk.get('step'), '| msg:', str(apk.get('message'))[:80])
EOF
echo "===== CYCLE DONE $(date '+%H:%M:%S') ====="
