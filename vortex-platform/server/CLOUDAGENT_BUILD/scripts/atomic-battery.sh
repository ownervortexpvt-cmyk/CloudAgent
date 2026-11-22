#!/bin/bash
# FINAL comprehensive atomic battery: everything that fits in one window.
set -u
cd /home/z/my-project
pass=0; fail=0
chk() { if [ "$1" = "$2" ]; then pass=$((pass+1)); echo "PASS: $3"; else fail=$((fail+1)); echo "FAIL: $3 (exp=$2 got=$1)"; fi }
B="-b /tmp/cj.txt -H x-ca-gate:CA-X-MONA-9173"; H='-H Content-Type:application/json'; API=http://localhost:3000/api

echo "===== ATOMIC BATTERY $(date '+%H:%M:%S') ====="
# Reuse a healthy server (warm path ~15s fits any window); only boot if dead.
code=$(curl -s -o /dev/null -w "%{http_code}" -m 8 http://localhost:3000/ 2>/dev/null)
if [ "$code" != "200" ]; then
  pkill -f "next dev" 2>/dev/null; sleep 1
  bun install 2>&1 | tail -1
  (setsid nohup bash .zscripts/dev.sh >> .zscripts/dev.log 2>&1 < /dev/null &)
  code=000
  for i in $(seq 1 30); do code=$(curl -s -o /dev/null -w "%{http_code}" -m 8 http://localhost:3000/ 2>/dev/null); [ "$code" = "200" ] && break; sleep 3; done
fi
chk "$code" "200" "server up (warm=$([ "$code" = "200" ] && echo yes || echo no))"
# warm + login (first compile of the route can exceed 15s on a cold box).
# NOTE: the private gate guards EVERYTHING — set the gate cookie first, keep
# it in the jar (-b AND -c), and pass the raw key header on every call.
lg=000
for i in 1 2 3; do
  curl -s -m 30 -c /tmp/cj.txt -X POST $API/gate -H 'Content-Type: application/json' -d '{"key":"CA-X-MONA-9173"}' -o /dev/null
  lg=$(curl -s -m 60 -b /tmp/cj.txt -c /tmp/cj.txt -H "x-ca-gate: CA-X-MONA-9173" -X POST $API/auth/login -H 'Content-Type: application/json' -d '{"email":"mdhonabali61@gmail.com","password":"Owner123"}' -o /tmp/login.json -w "%{http_code}")
  okl=$(python3 -c 'import json;print(json.load(open("/tmp/login.json")).get("ok"))' 2>/dev/null)
  [ "$okl" = "True" ] && break
  sleep 5
done
echo "login: $lg ok=$okl"
chk "$okl" "True" "login accepted"
chk "$(curl -s $B $API/auth/me | python3 -c 'import json,sys;print(json.load(sys.stdin).get("ok"))' 2>/dev/null)" "True" "session works"

# --- PROJECT LIFECYCLE (create → rename → list → delete) ---
PID=$(curl -s $B $H -X POST $API/projects -d '{"name":"Lifecycle Test","templateId":"static"}' | python3 -c 'import json,sys;print(json.load(sys.stdin).get("project",{}).get("id",""))' 2>/dev/null)
[ -n "$PID" ] && { pass=$((pass+1)); echo "PASS: create project ($PID)"; } || { fail=$((fail+1)); echo "FAIL: create project"; }

# rename
r=$(curl -s $B $H -X PATCH $API/projects/$PID -d '{"name":"Lifecycle Renamed"}' 2>/dev/null)
nm=$(echo "$r" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d.get("project",d).get("name",""))' 2>/dev/null)
chk "$nm" "Lifecycle Renamed" "rename project"

# list contains it
found=$(curl -s $B "$API/projects" | python3 -c "
import json,sys
d=json.load(sys.stdin)
items=d.get('projects',d.get('items',[]))
print('yes' if any(p.get('id')=='$PID' for p in items) else 'no')" 2>/dev/null)
chk "$found" "yes" "project listed after rename"

# delete (soft)
r=$(curl -s $B -X DELETE $API/projects/$PID 2>/dev/null)
ok=$(echo "$r" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("ok"))' 2>/dev/null)
chk "$ok" "True" "delete project"
gone=$(curl -s $B "$API/projects" | python3 -c "
import json,sys
d=json.load(sys.stdin)
items=d.get('projects',d.get('items',[]))
print('gone' if not any(p.get('id')=='$PID' for p in items) else 'visible')" 2>/dev/null)
chk "$gone" "gone" "deleted project hidden from list"

# --- NOTIFICATIONS (real implementation: UpdateNotifier polls /api/version) ---
okv=$(curl -s -o /dev/null -w "%{http_code}" "$API/version" 2>/dev/null)
chk "$okv" "200" "update-notifier version probe (public)"

# --- PRIVATE GATE (feature test: strangers MUST be blocked) ---
stranger=$(curl -s -o /dev/null -w "%{http_code}" "$API/projects" 2>/dev/null)
chk "$stranger" "401" "gate blocks unauthenticated API access"
strangerpage=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/dashboard 2>/dev/null)
echo "unauth /dashboard → $strangerpage (307=redirected to gate/login, correct)"

# --- ADMIN LOCK STATUS (with session) ---
okl=$(curl -s $B -o /dev/null -w "%{http_code}" "$API/admin/panel/session" 2>/dev/null)
chk "$okl" "200" "admin lock status endpoint (authed)"

# --- SEARCH (correct contract: projectId + q) ---
FP=cmwbavvan000gpovwjp1nxw0s
oksr=$(curl -s $B -o /dev/null -w "%{http_code}" "$API/search?projectId=$FP&q=main" 2>/dev/null)
chk "$oksr" "200" "search endpoint (projectId+q)"
sr=$(curl -s $B "$API/search?projectId=$FP&q=MyApp" 2>/dev/null | python3 -c 'import json,sys;print(len(json.load(sys.stdin).get("results",[])))' 2>/dev/null)
echo "search hits for MyApp: $sr"

# --- SETTINGS (correct contract: projectId) ---
okst=$(curl -s $B -o /dev/null -w "%{http_code}" "$API/settings?projectId=$FP" 2>/dev/null)
chk "$okst" "200" "settings env-vars (projectId)"

# --- BILLING ME ---
okb=$(curl -s $B -o /dev/null -w "%{http_code}" "$API/billing/me" 2>/dev/null)
chk "$okb" "200" "billing/me endpoint"

# --- ADMIN LOCK (control-room PIN unlock — separate second lock) ---
okpin=$(curl -s $B $H -c /tmp/cj.txt -X POST "$API/admin/panel/session" -d '{"pin":"1000391619244862"}' -o /tmp/pin.json -w "%{http_code}" 2>/dev/null)
pinok=$(python3 -c 'import json;print(json.load(open("/tmp/pin.json")).get("ok"))' 2>/dev/null)
chk "$pinok" "True" "admin control-room PIN unlock (got HTTP $okpin)"
okstats=$(curl -s $B -o /dev/null -w "%{http_code}" "$API/admin/panel/stats" 2>/dev/null)
chk "$okstats" "200" "admin panel stats (after unlock)"

# --- SDK MANAGER ---
r=$(curl -s $B "$API/sdks" | python3 -c '
import json,sys
d=json.load(sys.stdin)
ok=sum(1 for t in d.get("toolchains",[]) if t.get("present"))
print(f"{ok}/{len(d.get(\"toolchains\",[]))}")' 2>/dev/null)
echo "toolchains present: $r"

# --- FILE OPS (core set on main test project) ---
FP=cmwbavvan000gpovwjp1nxw0s
r=$(curl -s $B $H -X POST $API/files -d "{\"projectId\":\"$FP\",\"path\":\"atomic.txt\",\"content\":\"v1\",\"op\":\"write\"}" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("ok"))' 2>/dev/null)
chk "$r" "True" "file write"
r=$(curl -s $B "$API/files?projectId=$FP&path=atomic.txt" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("content"))' 2>/dev/null)
chk "$r" "v1" "file read"
r=$(curl -s $B $H -X POST $API/files -d "{\"projectId\":\"$FP\",\"path\":\"atomic.txt\",\"to\":\"atomic2.txt\",\"op\":\"move\"}" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("ok"))' 2>/dev/null)
chk "$r" "True" "file rename"
r=$(curl -s $B $H -X POST $API/files -d "{\"projectId\":\"$FP\",\"path\":\"atomic2.txt\",\"op\":\"delete\"}" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("ok"))' 2>/dev/null)
chk "$r" "True" "file delete"

# --- EXPORT STATUS (fixed contract) ---
r=$(curl -s $B "$API/projects/$FP/export?kind=status" | python3 -c '
import json,sys
d=json.load(sys.stdin)
t=d["targets"]
print("ok" if all(k in t and "capable" in t[k] for k in ("apk","exe","ipa")) else "bad")' 2>/dev/null)
chk "$r" "ok" "export status full contract"

echo "===== RESULT: $pass passed, $fail failed ====="
echo "===== BATTERY DONE $(date '+%H:%M:%S') ====="
