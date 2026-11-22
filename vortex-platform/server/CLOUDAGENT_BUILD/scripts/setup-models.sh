#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# CloudAgent v111 — LOCAL OPEN-SOURCE AI SETUP (run once on your server)
#
# Installs the Ollama runtime + pulls the 6-model open-source catalog so
# CloudAgent users can build complete apps WITHOUT adding any AI API key.
#
#   bash scripts/setup-models.sh              # install everything
#   ONLY=gemma2:2b bash scripts/setup-models.sh   # pull one extra model
#   bash scripts/setup-models.sh --status     # just show current state
#
# The running CloudAgent app auto-detects the models (boot sync + 30s
# watchdog) and provisions them as zero-key providers — no restart needed.
# ═══════════════════════════════════════════════════════════════════════════
set -u

MODELS=(
  "qwen2.5-coder:7b|4.7 GB|best open coding model — the app-building workhorse"
  "deepseek-coder:6.7b|3.8 GB|code specialist — strong full-file generation"
  "llama3.2:3b|2.0 GB|fast general model — planning, UI copy, small edits"
  "gemma2:2b|1.6 GB|Google compact — snappy on low-end hosts"
  "phi3.5:3.8b|2.2 GB|Microsoft — strong reasoning per parameter"
  "mistral:7b|4.1 GB|versatile instruct — good all-rounder"
  "glm4:9b|5.6 GB|Z.ai open weights — strong bilingual coding & reasoning (needs ~8GB RAM)"
  "gpt-oss:20b|13 GB|OpenAI open-source — flagship reasoning (needs 16GB+ RAM host)"
  "gpt-oss:120b|61 GB|OpenAI flagship open model — dedicated server only (~130GB RAM)"
)

say()  { printf '\033[1;32m[setup-models]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[setup-models]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[setup-models]\033[0m %s\n' "$*"; exit 1; }

command -v curl >/dev/null 2>&1 || die "curl is required (apt install curl)"

# ── --status mode ────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--status" ]]; then
  if curl -sf --max-time 3 http://127.0.0.1:11434/api/version >/dev/null 2>&1; then
    say "Ollama is up: $(curl -s --max-time 3 http://127.0.0.1:11434/api/version)"
  elif curl -sf --max-time 3 http://127.0.0.1:11434/v1/models >/dev/null 2>&1; then
    say "local model runtime (llama.cpp/vLLM-compatible) is up on :11434"
  else
    warn "no local model server on :11434"
  fi
  curl -s --max-time 3 http://127.0.0.1:11434/v1/models 2>/dev/null | grep -oE '"id":"[^"]+"' | sed 's/"id":/  · /'
  exit 0
fi

# ── 1. install Ollama (official installer; skips GPU bundling when absent) ──
if command -v ollama >/dev/null 2>&1; then
  say "Ollama already installed: $(ollama --version 2>/dev/null | head -1)"
else
  say "installing Ollama (official installer)…"
  curl -fsSL https://ollama.com/install.sh | sh || die "Ollama install failed — install manually from https://ollama.com"
fi

# ── 2. make sure the server is running (systemd if available, else nohup) ──
if curl -sf --max-time 3 http://127.0.0.1:11434/api/version >/dev/null 2>&1; then
  say "Ollama server already running on :11434"
else
  if command -v systemctl >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
    sudo systemctl enable --now ollama 2>/dev/null || true
  fi
  if ! curl -sf --max-time 3 http://127.0.0.1:11434/api/version >/dev/null 2>&1; then
    say "starting ollama serve in the background…"
    nohup ollama serve >/home/z/my-project/local-ai.log 2>&1 &
    sleep 3
    curl -sf --max-time 5 http://127.0.0.1:11434/api/version >/dev/null 2>&1 || die "ollama serve did not come up — check local-ai.log"
  fi
fi

# ── 3. tune for concurrent agent swarms (kept alive by the app watchdog) ────
export OLLAMA_NUM_PARALLEL=${OLLAMA_NUM_PARALLEL:-2}
export OLLAMA_KEEP_ALIVE=${OLLAMA_KEEP_ALIVE:-30m}
export OLLAMA_FLASH_ATTENTION=${OLLAMA_FLASH_ATTENTION:-1}

# ── 4. pull the catalog ─────────────────────────────────────────────────────
TOTAL_GB=0
for entry in "${MODELS[@]}"; do
  IFS='|' read -r tag size desc <<< "$entry"
  TOTAL_GB=$(awk -v a="$TOTAL_GB" -v b="$size" 'BEGIN{print a+b}')
done
say "pulling ${#MODELS[@]} models (~${TOTAL_GB} GB disk, needs ~10 GB RAM total for all at once; models load on demand)"
warn "disk free: $(df -h / | awk 'NR==2{print $4}') — each pull is resumable, re-run this script anytime"

for entry in "${MODELS[@]}"; do
  IFS='|' read -r tag size desc <<< "$entry"
  if ollama list 2>/dev/null | grep -q "^${tag%%:*}"; then
    say "✓ $tag already installed"
  else
    say "pulling $tag ($size) — $desc"
    ollama pull "$tag" || warn "pull failed for $tag — re-run this script to resume"
  fi
done

# one-off extra model via ONLY=model:tag
if [[ -n "${ONLY:-}" ]]; then
  say "pulling extra model $ONLY"
  ollama pull "$ONLY" || warn "pull failed for $ONLY"
fi

# ── 5. verify + hand over to the app ────────────────────────────────────────
say "installed:"
ollama list 2>/dev/null | sed 's/^/  /'
say "done. CloudAgent auto-detects these models within ~30 seconds"
say "(boot sync + watchdog) and provisions them as ZERO-API-KEY providers."
say "Users can now pick them in the model picker and build apps — no key, no bill."
