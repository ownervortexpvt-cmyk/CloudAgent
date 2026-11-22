#!/bin/bash
# Cross-tenant audit: free user token against qa-admin's project
B=http://localhost:3000
QPID=$(cat /tmp/ca_pid.txt)
T=$(curl -s -X POST $B/api/auth/login -H 'Content-Type: application/json' -d '{"email":"e2e-tester@example.com","password":"Test12345"}' | python3 -c "import json,sys;print(json.load(sys.stdin)['token'])")
H="x-ca-lock: $T"

probe() { # probe <label> <method> <url> [json]
  local label=$1 m=$2 url=$3 data=$4 out code
  if [ "$m" = POST ] && [ -n "$data" ]; then
    out=$(curl -s -X $m "$B$url" -H "$H" -H 'Content-Type: application/json' -d "$data" -w $'\n%{http_code}')
  else
    out=$(curl -s -X $m "$B$url" -H "$H" -w $'\n%{http_code}')
  fi
  code=$(echo "$out" | tail -1)
  body=$(echo "$out" | head -1 | tr -d '\n' | head -c 110)
  # classify
  case "$code" in
    200|201) verdict="⚠️  ACCESS";;
    400) echo "$body" | grep -qi "belongs to\|no access\|owner\|admin" && verdict="✅ blocked" || verdict="⚠️  400-passthrough";;
    401|403|404) verdict="✅ blocked";;
    *) verdict="? $code";;
  esac
  printf "%-24s %-4s %s  %s | %s\n" "$label" "$m" "$code" "$verdict" "$body"
}

echo "ENDPOINT                   METHOD CODE VERDICT        RESPONSE"
probe "files read"          GET  "/api/files?projectId=$QPID&path=index.html"
probe "files write"         POST "/api/files" "{\"projectId\":\"$QPID\",\"path\":\"pwn2.txt\",\"content\":\"x\"}"
probe "files delete"        POST "/api/files/delete" "{\"projectId\":\"$QPID\",\"path\":\"index.html\"}"
probe "versions list"       GET  "/api/versions?projectId=$QPID"
probe "versions restore"    POST "/api/versions" "{\"projectId\":\"$QPID\",\"action\":\"restore\"}"
probe "builds list"         GET  "/api/builds?projectId=$QPID"
probe "runs list"           GET  "/api/runs?projectId=$QPID"
probe "settings get"        GET  "/api/settings?projectId=$QPID"
probe "settings set"        POST "/api/settings" "{\"projectId\":\"$QPID\",\"key\":\"x\",\"value\":\"y\"}"
probe "search code"         GET  "/api/search?projectId=$QPID&q=a"
probe "analytics get"       GET  "/api/analytics?projectId=$QPID"
probe "source-export"       POST "/api/source-export" "{\"projectId\":\"$QPID\"}"
probe "zip download"        GET  "/api/zip?projectId=$QPID"
probe "publish web"         POST "/api/publish" "{\"projectId\":\"$QPID\",\"target\":\"web\"}"
probe "runtime start"       POST "/api/runtime" "{\"projectId\":\"$QPID\",\"action\":\"start\"}"
probe "runtime exec"        POST "/api/runtime" "{\"projectId\":\"$QPID\",\"action\":\"exec\",\"command\":\"id\"}"
probe "internal tool"       POST "/api/internal/tool" "{\"projectId\":\"$QPID\",\"tool\":\"write_file\",\"args\":{\"path\":\"pwn3.txt\",\"content\":\"x\"}}"
probe "agent run"           POST "/api/agent" "{\"projectId\":\"$QPID\",\"prompt\":\"hi\"}"
probe "abort run"           POST "/api/agent/abort" "{\"projectId\":\"$QPID\",\"runId\":\"x\"}"
probe "git status"          POST "/api/git" "{\"projectId\":\"$QPID\",\"action\":\"status\"}"
probe "github panel"        POST "/api/github" "{\"projectId\":\"$QPID\",\"action\":\"list\"}"
probe "project GET"         GET  "/api/projects/$QPID"
probe "project DELETE"      DELETE "/api/projects/$QPID"
probe "project export"      POST "/api/projects/$QPID/export" "{\"target\":\"apk\"}"
probe "project icon"        POST "/api/projects/$QPID/icon" "{}"
probe "project restore"     POST "/api/projects/$QPID/restore" "{}"
probe "project collab GET"  GET  "/api/projects/$QPID/collab"
probe "project collab POST" POST "/api/projects/$QPID/collab" "{\"action\":\"invite\",\"email\":\"x@x.com\"}"
probe "collab sync"         POST "/api/projects/$QPID/collab/sync" "{\"since\":0}"
probe "clone project"       POST "/api/projects/clone" "{\"projectId\":\"$QPID\",\"name\":\"stolen\"}"
probe "custom-domain add"   POST "/api/custom-domains" "{\"projectId\":\"$QPID\",\"domain\":\"evil.com\"}"
probe "schedules create"    POST "/api/schedules" "{\"projectId\":\"$QPID\",\"name\":\"x\",\"cron\":\"0 2 * * *\",\"prompt\":\"x\"}"
probe "terminal start"      POST "/api/terminal" "{\"action\":\"start\",\"projectId\":\"$QPID\"}"
probe "backup full"         GET  "/api/backup"
probe "backup-download"     GET  "/api/backup-download"
probe "play status"         GET  "/api/play"
probe "play save"           POST "/api/play" "{\"action\":\"save\",\"json\":\"{}\"}"
probe "pwa-setup"           POST "/api/pwa-setup" "{\"projectId\":\"$QPID\"}"
probe "growth-tools"        POST "/api/growth-tools" "{\"projectId\":\"$QPID\"}"
probe "aso-listing"         POST "/api/aso-listing" "{\"projectId\":\"$QPID\"}"
probe "firebase backup"     POST "/api/firebase" "{\"projectId\":\"$QPID\",\"action\":\"backup\"}"
probe "r2vault backup"      POST "/api/r2vault" "{\"projectId\":\"$QPID\",\"action\":\"backup\"}"
probe "speed-pass on"       POST "/api/speed-pass" "{\"projectId\":\"$QPID\",\"on\":true}"
probe "usage budget"        POST "/api/usage/budget" "{\"projectId\":\"$QPID\",\"budgetUSD\":1}"
probe "settings reveal"     POST "/api/settings/reveal" "{\"projectId\":\"$QPID\",\"key\":\"theme\"}"
