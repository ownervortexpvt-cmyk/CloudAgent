#!/bin/bash
# VaaS end-to-end smoke test against the seeded demo project
KEY=$(sqlite3 db/custom.db "SELECT value FROM AppConfig WHERE key='vaas.demo_client_key';" 2>/dev/null)
if [ -z "$KEY" ]; then
  KEY=$(bun -e "import {PrismaClient} from '@prisma/client'; const db=new PrismaClient(); db.appConfig.findUnique({where:{key:'vaas.demo_client_key'}}).then(c=>{console.log(c.value);process.exit(0)})" 2>/dev/null | tail -1)
fi
H="-H x-vx-key:$KEY -H Content-Type:application/json"
B=http://localhost:3000/api/vaas/v1
echo "== health =="
curl -s $B/health -H "x-vx-key: $KEY" | head -c 400; echo
echo "== login demo user =="
LOGIN=$(curl -s -X POST $B/auth/login $H -d '{"email":"demo@store.local","password":"Demo@2026"}')
echo "$LOGIN" | head -c 220; echo
TOKEN=$(echo "$LOGIN" | sed -n 's/.*"idToken":"\([^"]*\)".*/\1/p')
echo "== query posts (public read) =="
curl -s "$B/data/posts?orderBy=-likes&limit=2" -H "x-vx-key: $KEY" | head -c 300; echo
echo "== add doc (auth write) without token -> should 403 =="
curl -s -o /dev/null -w "%{http_code}\n" -X POST $B/data/posts $H -d '{"data":{"title":"no auth"}}'
echo "== add doc WITH token =="
curl -s -X POST $B/data/posts $H -H "Authorization: Bearer $TOKEN" -d '{"data":{"title":"Smoke test post","likes":1}}' | head -c 220; echo
echo "== otp request =="
curl -s -X POST $B/auth/otp-request $H -d '{"email":"otpflow@store.local"}' | head -c 160; echo
echo "== storage upload =="
B64=$(echo "vaas smoke $(date)" | base64)
curl -s -X POST $B/storage/upload $H -H "Authorization: Bearer $TOKEN" -d "{\"path\":\"notes/smoke.txt\",\"contentB64\":\"$B64\",\"mime\":\"text/plain\"}" | head -c 260; echo
echo "== storage download =="
curl -s "$B/storage/file?path=notes/smoke.txt" -H "x-vx-key: $KEY"; echo
echo "== rt publish =="
curl -s -X POST $B/rt/publish $H -d '{"channel":"chat-room-1","type":"message","payload":{"text":"smoke hello"}}' | head -c 160; echo
echo "== rt events poll =="
curl -s "$B/rt/events?channel=chat-room-1" -H "x-vx-key: $KEY" | head -c 260; echo
echo "== fn invoke ping (HTTP trigger, publishes realtime) =="
curl -s -X POST $B/fn/ping/invoke $H -d '{"payload":{"from":"smoke"}}' | head -c 260; echo
echo "== rules: profile write owner (unauth) -> 403 =="
curl -s -o /dev/null -w "%{http_code}\n" -X POST $B/data/profile $H -d '{"data":{"x":1}}'
