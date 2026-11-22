#!/bin/bash
# CloudAgent POST-endpoint feature tests (as QA admin session)
BASE=http://localhost:3000
J=/tmp/ca_cookies.txt
PID=$(cat /tmp/ca_pid.txt)
t() { # t <name> <method> <url> [json]
  local name=$1 m=$2 url=$3 data=$4
  if [ "$m" = "POST" ] && [ -n "$data" ]; then
    out=$(curl -s -b $J -X POST "$BASE$url" -H 'Content-Type: application/json' -d "$data" -w "\n%{http_code}")
  else
    out=$(curl -s -b $J -X "$m" "$BASE$url" -w "\n%{http_code}")
  fi
  code=$(echo "$out" | tail -1); body=$(echo "$out" | head -1 | head -c 160)
  printf "%-26s POST %s  %s\n" "$name" "$code" "$body"
}

echo "=== secrets: set + list ==="
curl -s -b $J -X POST $BASE/api/secrets -H 'Content-Type: application/json' -d '{"key":"TEST_KEY","value":"abc123"}' | head -c 120; echo
curl -s -b $J $BASE/api/secrets | head -c 150; echo

echo "=== settings: set devmode ==="
curl -s -b $J -X POST $BASE/api/settings -H 'Content-Type: application/json' -d "{\"projectId\":\"$PID\",\"key\":\"theme\",\"value\":\"dark\"}" | head -c 150; echo

echo "=== terminal: create session ==="
curl -s -b $J -X POST $BASE/api/terminal -H 'Content-Type: application/json' -d "{\"projectId\":\"$PID\",\"action\":\"create\"}" | head -c 200; echo

echo "=== schedules: create ==="
curl -s -b $J -X POST $BASE/api/schedules -H 'Content-Type: application/json' -d "{\"projectId\":\"$PID\",\"name\":\"nightly\",\"cron\":\"0 2 * * *\",\"prompt\":\"run tests\"}" | head -c 200; echo

echo "=== marketplace: list+install ==="
curl -s -b $J -X POST $BASE/api/marketplace/install -H 'Content-Type: application/json' -d '{"listingId":"nonexistent"}' | head -c 150; echo

echo "=== providers: quick-setup ==="
curl -s -b $J -X POST $BASE/api/providers/quick-setup -H 'Content-Type: application/json' -d '{}' | head -c 150; echo

echo "=== multi-agent: relay ==="
curl -s -b $J -X POST $BASE/api/multi-agent/relay -H 'Content-Type: application/json' -d '{}' | head -c 150; echo

echo "=== github: connect (no token) ==="
curl -s -b $J -X POST $BASE/api/github -H 'Content-Type: application/json' -d '{"action":"connect"}' | head -c 150; echo

echo "=== git api ==="
curl -s -b $J -X POST $BASE/api/git -H 'Content-Type: application/json' -d "{\"projectId\":\"$PID\",\"action\":\"status\"}" | head -c 200; echo

echo "=== search code ==="
curl -s -b $J "$BASE/api/search?projectId=$PID&q=todo" | head -c 200; echo

echo "=== analytics hit ==="
curl -s -b $J -X POST $BASE/api/analytics/hit -H 'Content-Type: application/json' -d '{"path":"/","event":"pageview"}' | head -c 120; echo

echo "=== admin stats ==="
curl -s -b $J $BASE/api/admin/panel/stats | head -c 250; echo
