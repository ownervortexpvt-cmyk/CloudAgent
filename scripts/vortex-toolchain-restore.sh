#!/usr/bin/env bash
# ============================================================
# Vortex Cloud Agent — TOOLCHAIN RESTORE (this environment)
# Runs in seconds after any recycle: re-links bun from the
# persistent snapshot, verifies every toolchain, restarts both
# servers from the forged runtime if they are not up.
#   bash /home/z/my-project/scripts/vortex-toolchain-restore.sh
# ============================================================
set -uo pipefail
BASE=/home/z/my-project
ok=0; miss=0

# 1. bun — restore from the persistent snapshot if the live binary vanished
if ! command -v bun >/dev/null 2>&1; then
  if [[ -x "$BASE/toolchain/bin/bun" ]]; then
    mkdir -p "$HOME/.bun/bin"
    cp -f "$BASE/toolchain/bin/bun" "$HOME/.bun/bin/bun"
    ln -sf "$HOME/.bun/bin/bun" "$HOME/.bun/bin/bunx" 2>/dev/null || true
    export PATH="$HOME/.bun/bin:$PATH"
    echo "RESTORED bun from toolchain/bin/bun ($(bun --version 2>/dev/null))"
  else
    echo "bun MISSING and no snapshot"; miss=$((miss+1))
  fi
else
  echo "ok bun $(bun --version 2>/dev/null)"
fi

# 2. verify the rest
for t in node git java python3 ffmpeg jq; do
  if command -v "$t" >/dev/null 2>&1; then echo "ok $t"; else echo "MISSING $t"; miss=$((miss+1)); fi
done

# 3. SDK toolchains (kept installed directly — no archiving, per owner order)
for d in flutter-sdk android-sdk dotnet-sdk gradle; do
  if [[ -d "$BASE/sdk/$d" ]]; then echo "ok sdk/$d"; else echo "MISSING sdk/$d"; miss=$((miss+1)); fi
done

# 4. forged runtime + servers
if [[ -f "$BASE/vortex-platform/cloudagent-runtime/server.js" && -f "$BASE/vortex-platform/cloudagent-runtime/.next/BUILD_ID" ]]; then
  echo "ok forged runtime (BUILD_ID $(cat "$BASE/vortex-platform/cloudagent-runtime/.next/BUILD_ID" 2>/dev/null))"
  for port in 3000 3200; do
    if ! ss -tln 2>/dev/null | grep -q ":$port "; then
      echo ":$port down — restart from runtime"
      (cd "$BASE/vortex-platform/cloudagent-runtime" && \
        PORT=$port HOSTNAME=127.0.0.1 NODE_ENV=production \
        DATABASE_URL="file:$BASE/db/custom.db" nohup node server.js >> "$BASE/ca-runtime.log" 2>&1 &)
    else
      echo "ok :$port listening"
    fi
  done
else
  echo "runtime incomplete — run: bash $BASE/scripts/forge-runtime.sh"
fi

echo "----"
if [[ $miss -eq 0 ]]; then echo "TOOLCHAIN COMPLETE — everything installed, nothing archived."; else echo "$miss item(s) missing — see above."; fi
