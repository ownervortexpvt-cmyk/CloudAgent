#!/bin/bash
# Full regression runner — v68. Runs every suite, prints one line each,
# and a final tally. Per-suite exit codes are counted.
cd /home/z/my-project
total=0; failed=0
SUITES=(
  e2e-v68-gemini-heal.mjs
  e2e-v67-slow-502-batch.mjs
  e2e-v63-every-button-real.mjs
  e2e-v62-full-batch.mjs
  e2e-v61-provider-15.mjs
  e2e-v60-final-round.mjs
  e2e-v59-more-features.mjs
  e2e-v58-final-final.mjs
  e2e-v57-agent-board.mjs
  e2e-v56-final-batch.mjs
  e2e-v55-unbreakable.mjs
  e2e-v53-provider-vault.mjs
  e2e-v251-lock-embed.mjs
  e2e-v501-owner-recovery.mjs
)
for s in "${SUITES[@]}"; do
  total=$((total+1))
  out=$(node "scripts/$s" 2>&1)
  code=$?
  line=$(echo "$out" | rg "=== RESULT" | tail -1)
  if [ $code -eq 0 ]; then
    echo "OK   $s — $line"
  else
    failed=$((failed+1))
    echo "FAIL $s — $line (exit $code)"
    echo "$out" | rg "FAIL" | head -5
  fi
done
echo "=============================="
echo "REGRESSION: $((total-failed))/$total suites passed"
exit $failed
