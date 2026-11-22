#!/usr/bin/env bash
# ECOSYSTEM GIT SETUP (v152) — self-hosted git for the whole Vortex ecosystem.
#
# Creates/repairs the bare repo that backs the Code Hub + installs the
# post-receive hook that queues a deploy on every push. Idempotent: safe to
# run on every boot (boot-guard calls it), skips work that already exists.
#
#   bare repo   /home/z/my-project/vortex-git/vortex-ecosystem.git
#   live tree   /home/z/my-project        (the running ecosystem itself)
#   deploy      scripts/ecosystem-deploy.cjs (checkout → deps → build → restart)
#
# The repo is served by the platform itself over
#   /api/ecosystem-git/vortex-ecosystem.git  (token-gated smart HTTP)
# — no GitHub, no Cloudflare, no external service anywhere.
set -u
BASE=/home/z/my-project
BARE="$BASE/vortex-git/vortex-ecosystem.git"

mkdir -p "$BASE/vortex-git" "$BASE/.ecosystem"

# ── 1. bare repo ──
if [ ! -d "$BARE" ]; then
  git init --bare -b main "$BARE" >/dev/null 2>&1 || git init --bare "$BARE" >/dev/null 2>&1
  echo "[ecosystem-git] bare repo created at $BARE"
fi
# http-backend requirements: export-all + receive-pack allowed for our token-authed users
git --git-dir="$BARE" config http.receivepack true
git --git-dir="$BARE" config http.uploadpack true
git --git-dir="$BARE" config core.logAllRefUpdates true
git --git-dir="$BARE" config HEAD.main.ref refs/heads/main 2>/dev/null || true

# ── 1b. auto-seed — if the bare repo has no commits, seed it from the live
# tree with ONE clean baseline commit (the platform root repo is a shallow
# sandbox clone, so seeding goes through a fresh temp repo).
if [ -z "$(git --git-dir="$BARE" rev-parse --verify HEAD 2>/dev/null || true)" ]; then
  SEED="$BASE/.ecosystem/seed-repo"
  rm -rf "$SEED"
  git init -q -b main "$SEED"
  git -C "$SEED" config user.name "Vortex Ecosystem"
  git -C "$SEED" config user.email "ecosystem@vortex.local"
  git --git-dir="$SEED/.git" --work-tree="$BASE" add -A
  git --git-dir="$SEED/.git" --work-tree="$BASE" commit -q -m "Vortex Ecosystem — Code Hub baseline (v152: CloudAgent + VORTEX_SERVER + scripts)" --allow-empty
  git -C "$SEED" push -q "$BARE" main 2>/dev/null || git --git-dir="$SEED/.git" push "$BARE" main
  rm -rf "$SEED"
  echo "[ecosystem-git] bare repo seeded from live tree"
fi

# ── 2. post-receive hook — queue a deploy, reply instantly ──
HOOK="$BARE/hooks/post-receive"
mkdir -p "$BARE/hooks"
cat > "$HOOK" <<'HOOK_EOF'
#!/usr/bin/env bash
# ECOSYSTEM post-receive (v152): a push just landed → queue a detached deploy.
# The git client gets an instant reply; the build/restart runs in background.
set -u
BASE=/home/z/my-project
STATE_DIR="$BASE/.ecosystem"
mkdir -p "$STATE_DIR"
newrev=""
oldrev=""
while read -r o n r; do
  oldrev="$o"; newrev="$n"
done
case "$newrev" in
  0000000000000000000000000000000000000000)
    echo "VORTEX ECOSYSTEM: branch deleted — nothing to deploy."
    exit 0 ;;
esac
printf '%s' "{\"old\":\"$oldrev\",\"new\":\"$newrev\",\"trigger\":\"push\",\"queuedAt\":$(date +%s000)}" > "$STATE_DIR/pending-deploy.json"
nohup setsid node "$BASE/scripts/ecosystem-deploy.cjs" --trigger push --commit "$newrev" --old "$oldrev" --actor git-push </dev/null >> "$STATE_DIR/deploy.log" 2>&1 &
echo "VORTEX ECOSYSTEM: push received (${newrev:0:8})"
echo "  → deploy queued: checkout → deps → vortex build → restart :3200 (data never touched)"
echo "  → live in ~2-4 min. Track it in Admin → Code Hub → Deploy."
HOOK_EOF
chmod +x "$HOOK"
echo "[ecosystem-git] post-receive hook installed"

echo "[ecosystem-git] setup complete"
