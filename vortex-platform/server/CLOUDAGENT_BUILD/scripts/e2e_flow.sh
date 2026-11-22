#!/bin/bash
# CloudAgent core E2E: create project → AI agent build → check files/preview
BASE=http://localhost:3000
J=/tmp/ca_cookies.txt
R=/tmp/ca_e2e.json

echo "=== 1. Create project ==="
curl -s -b $J -X POST $BASE/api/projects -H 'Content-Type: application/json' \
  -d '{"name":"E2E Todo App","description":"A simple todo list web app","language":"html"}' > $R
cat $R | head -c 500; echo
PID=$(python3 -c "import json;d=json.load(open('$R'));print(d.get('project',{}).get('id') or d.get('id',''))")
echo "PROJECT_ID=$PID"
echo "$PID" > /tmp/ca_pid.txt

echo "=== 2. Kick AI agent build (may take 1-3 min) ==="
curl -s -b $J -X POST $BASE/api/agent -H 'Content-Type: application/json' \
  -d "{\"projectId\":\"$PID\",\"prompt\":\"Build a simple todo list app: add item, mark done, delete. Single index.html with localStorage.\",\"runId\":\"e2e-test-run\"}" > /tmp/ca_agent_start.json
cat /tmp/ca_agent_start.json | head -c 600; echo
