#!/bin/bash
# CloudAgent full API sweep — tests every GET endpoint + auth flow
BASE=http://localhost:3000
J=/tmp/ca_cookies.txt
rm -f $J

echo "=== 1. AUTH: login (QA admin) ==="
curl -s -c $J -X POST $BASE/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"qa-admin115@qa.local","password":"qatester115"}' | head -c 400
echo; echo "--- cookie jar ---"
grep -v '^#' $J | awk '{print $6"="substr($7,1,20)"..."}'
echo

echo "=== 2. AUTH: /api/auth/me ==="
curl -s -b $J $BASE/api/auth/me | head -c 300
echo

echo "=== 3. GET endpoints sweep ==="
GETS=(
  /api/version /api/auth/me /api/auth/plan /api/billing/me /api/billing/keys
  /api/projects /api/projects/storage /api/templates /api/prompts /api/languages
  /api/providers /api/providers/models /api/providers/health /api/benchmarks
  /api/marketplace /api/multi-agent /api/runs /api/builds /api/versions
  /api/files /api/usage /api/usage/budget /api/referral/me /api/schedules
  /api/sdks /api/secrets /api/settings /api/analytics /api/gate
  /api/github /api/custom-domains /api/r2vault /api/devmode /api/runtime
  /api/backup /api/speed-pass /api/growth-tools /api/aso-listing /api/firebase
  /api/pwa-setup /api/terminal /api/play /api/search /api/source-export
  /api/zip /api/deploy /api/publish /api/agent
)
for p in "${GETS[@]}"; do
  code=$(curl -s -b $J -o /tmp/ca_resp.json -w "%{http_code}" "$BASE$p")
  size=$(stat -c%s /tmp/ca_resp.json 2>/dev/null || echo 0)
  # detect JSON error bodies
  err=$(head -c 120 /tmp/ca_resp.json | tr -d '\n')
  printf "%-28s %s  %6sB  %s\n" "$p" "$code" "$size" "$err"
done
