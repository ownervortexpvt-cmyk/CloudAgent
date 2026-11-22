#!/bin/bash
# SHOB TEST — master battery. Every suite, sequential, one log each.
# Bengali ✅/❌ tally at the end. Never prints secrets.
cd /home/z/my-project
LOG=/tmp/shobtest
mkdir -p "$LOG"
NAMES=()
RC=()
EXTRA_FAIL=()

run_suite() {
  local name="$1"; shift
  echo "[$(date '+%H:%M:%S')] ▶ SUITE $name starting…" | tee -a "$LOG/master.log"
  timeout 1500 "$@" > "$LOG/$name.log" 2>&1
  local rc=$?
  # vortex-baas-e2e does not set exit code on test-fail — parse the log.
  if [ "$name" = "baas-e2e" ]; then
    if grep -q "FAILED:\|FATAL" "$LOG/$name.log"; then rc=1; fi
  fi
  NAMES+=("$name"); RC+=("$rc")
  echo "[$(date '+%H:%M:%S')] ◀ $name exit=$rc" | tee -a "$LOG/master.log"
}

# 0. health
h3000=$(curl -s -o /dev/null -w "%{http_code}" -m 8 http://localhost:3000/api/version)
h3200=$(curl -s -o /dev/null -w "%{http_code}" -m 8 http://localhost:3200/api/gw/status)
echo "health: :3000=$h3000 :3200=$h3200" | tee -a "$LOG/master.log"
NAMES+=("health"); RC+=("$([ "$h3000" = "200" ] && [ "$h3200" = "200" ] && echo 0 || echo 1)")

run_suite vaas-full    node scripts/vaas-full-e2e.cjs
run_suite fb-parity    node scripts/vx-firebase-parity-test.cjs
run_suite parity-v2    node scripts/vx-parity-v2-test.cjs
run_suite baas-e2e     node scripts/vortex-baas-e2e.cjs
run_suite joy-storage  node scripts/joy-e2e-test.cjs
run_suite ca-publish   node scripts/cloudagent-vortex-publish-test.cjs
run_suite razorpay     python3 scripts/e2e-v127-razorpay-ultra.py
run_suite admin-panel  python3 scripts/e2e-admin-panel.py
# v149 LAST — it self-updates the build and restarts the VORTEX server.
run_suite v149-full    python3 scripts/e2e-v149.py

echo "" > "$LOG/final.txt"
tp=0; tf=0
for i in "${!NAMES[@]}"; do
  n="${NAMES[$i]}"; r="${RC[$i]}"
  if [ "$r" = "0" ]; then symb="✅"; tp=$((tp+1)); else symb="❌"; tf=$((tf+1)); fi
  echo "$symb $n (exit=$r)" >> "$LOG/final.txt"
done
{
echo "════════ SHOB TEST FINAL TALLY ════════"
cat "$LOG/final.txt"
echo "SUITE PASS: $tp  SUITE FAIL: $tf"
echo "── per-suite pass lines ──"
for f in "$LOG"/*.log; do
  base=$(basename "$f" .log)
  [ "$base" = "master" ] && continue
  line=$(grep -E "RESULT:|SUMMARY|PASS:|passed|FINAL|ফলাফল" "$f" | tail -2 | tr '\n' ' ')
  echo "  $base → $line"
done
} | tee -a "$LOG/master.log"
echo "DONE_AT=$(date '+%H:%M:%S')" | tee -a "$LOG/master.log"
