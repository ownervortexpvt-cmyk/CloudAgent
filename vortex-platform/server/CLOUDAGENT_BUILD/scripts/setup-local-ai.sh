#!/usr/bin/env bash
# CloudAgent local-ai setup (v113) — deps + small GGUF models, RESUMABLE.
# Re-run any time; finished downloads are skipped. Git-tracked code means a
# wiped sandbox restores with exactly this one command.
#
#   bash scripts/setup-local-ai.sh              # defaults: 2 small models
#   ONLY="Qwen2.5-Coder-0.5B" bash scripts/setup-local-ai.sh   # one model
#   bash scripts/setup-local-ai.sh --status     # just report
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/local-ai"
mkdir -p "$DIR/models"

have() { command -v "$1" >/dev/null 2>&1; }

status() {
  echo "── local-ai status ──"
  echo "code:      $([ -f "$DIR/server.js" ] && echo present || echo MISSING)"
  echo "deps:      $([ -d "$DIR/node_modules/node-llama-cpp" ] && echo installed || echo missing)"
  if curl -s --max-time 2 http://127.0.0.1:11434/api/version >/dev/null 2>&1; then
    echo "runtime:   UP (:11434)"
  else
    echo "runtime:   down (app watchdog auto-starts it when .env sets LOCAL_AI_AUTOSTART_CMD)"
  fi
  ls -lh "$DIR/models"/*.gguf 2>/dev/null | awk '{print "model:    ", $9, "("$5")"}'
  [ -z "$(ls "$DIR/models"/*.gguf 2>/dev/null)" ] && echo "models:    none yet"
}

case "${1:-}" in
  --status) status; exit 0 ;;
esac

# 1. node dependency (prebuilt binaries — no compiler needed)
if [ ! -d "$DIR/node_modules/node-llama-cpp" ]; then
  echo "→ installing node-llama-cpp (prebuilt linux-x64)…"
  (cd "$DIR" && npm install --no-audit --no-fund 2>&1 | tail -2)
fi

# 2. small default models (~0.5-1GB each; big ones belong on a real server)
DEFAULT_URLS=(
  "https://huggingface.co/Qwen/Qwen2.5-Coder-0.5B-Instruct-GGUF/resolve/main/qwen2.5-coder-0.5b-instruct-q4_k_m.gguf|qwen2.5-coder-0.5b-instruct-q4_k_m.gguf|490"
  "https://huggingface.co/zai-org/glm-edge-1.5b-chat-gguf/resolve/main/ggml-model-Q4_K_M.gguf|glm-edge-1.5b-chat.Q4_K_M.gguf|980"
)
for entry in "${DEFAULT_URLS[@]}"; do
  url="${entry%%|*}"; rest="${entry#*|}"; fname="${rest%%|*}"; mb="${rest##*|}"
  if [ -n "${ONLY:-}" ] && [[ "$fname" != *"${ONLY}"* ]]; then continue; fi
  target="$DIR/models/$fname"
  if [ -f "$target" ] && [ "$(stat -c%s "$target" 2>/dev/null || echo 0)" -gt $((mb * 1024 * 1024 / 2)) ]; then
    echo "✓ $fname already on disk"
    continue
  fi
  echo "→ downloading $fname (~${mb}MB)…"
  if have curl; then
    curl -L --fail --retry 3 -C - -o "$target.part" "$url" && mv "$target.part" "$target"
  elif have wget; then
    wget -c -O "$target.part" "$url" && mv "$target.part" "$target"
  else
    echo "  need curl or wget — install one and re-run"; exit 1
  fi
done

# 3. boot hint (the app's watchdog owns the real lifecycle via .env)
echo
status
echo
echo "To boot now by hand:  (cd local-ai && node server.js >> /tmp/local-ai.log 2>&1 &)"
echo "The platform auto-starts it when .env has: LOCAL_AI_AUTOSTART_CMD='node $DIR/server.js'"
