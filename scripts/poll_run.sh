#!/bin/bash
# Poll agent run until done; then verify files written + preview works
BASE=http://localhost:3000
J=/tmp/ca_cookies.txt
PID=$(cat /tmp/ca_pid.txt)
RUN=$(curl -s -b $J $BASE/api/runs | python3 -c "import json,sys;d=json.load(sys.stdin);rs=d.get('runs',[]);print(rs[0]['id'] if rs else '')")
echo "RUN=$RUN PID=$PID"
for i in $(seq 1 40); do
  curl -s -b $J "$BASE/api/runs" > /tmp/ca_runs.json
  S=$(python3 -c "
import json
d=json.load(open('/tmp/ca_runs.json'))
rs=[r for r in d.get('runs',[]) if r['id']=='$RUN']
r=rs[0] if rs else {}
print(r.get('status','?'))
")
  echo "[$i] status=$S"
  if [ "$S" != "running" ] && [ "$S" != "?" ]; then break; fi
  sleep 10
done
echo "=== final run detail ==="
python3 -c "
import json
d=json.load(open('/tmp/ca_runs.json'))
rs=[r for r in d.get('runs',[]) if r['id']=='$RUN']
print(json.dumps(rs[0] if rs else {}, indent=1)[:1500])
"
echo "=== files in project ==="
curl -s -b $J "$BASE/api/files?projectId=$PID&path=/" | head -c 800; echo
