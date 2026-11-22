#!/bin/bash
# v72: Build share-ready full source zip of the Cloud Agent app.
# Whitelist approach — only app code goes in. NEVER: owner DB, provider
# vault keys, .env, uploads/screenshots, built projects, node_modules,
# .next, .git, skills, snapshots, platform internals.
set -euo pipefail
ROOT=/home/z/my-project
OUT="$ROOT/download/cloud-agent-v71-full-source.zip"
VERIFY="$ROOT/scripts/.zipverify-v72"

rm -f "$OUT"
rm -rf "$VERIFY"
cd "$ROOT"

zip -r -q "$OUT" \
  src \
  prisma \
  public \
  scripts \
  tests \
  examples \
  mini-services/agent-service/index.ts \
  mini-services/agent-service/package.json \
  mini-services/agent-service/bun.lock \
  package.json \
  bun.lock \
  tsconfig.json \
  next.config.ts \
  tailwind.config.ts \
  postcss.config.mjs \
  components.json \
  eslint.config.mjs \
  Caddyfile \
  REBUILD_SPEC.md \
  worklog.md \
  .gitignore \
  .env.example

echo "=== ZIP CREATED ==="
du -h "$OUT"

echo "=== INTEGRITY TEST ==="
unzip -t -qq "$OUT" && echo "OK: zip integrity valid"

echo "=== FILE COUNT ==="
ZIPCOUNT=$(unzip -l "$OUT" | tail -1 | awk '{print $2}')
echo "files in zip: $ZIPCOUNT"

echo "=== SAFETY: forbidden patterns must be ABSENT (expect only 0/none) ==="
unzip -l "$OUT" | grep -E "custom\.db|provider-vault|(^| )\.env$|upload/|download/|projects/|node_modules|\.next/|\.git/|skills/" || echo "CLEAN: no forbidden files inside"

echo "=== EXTRACT ROUND-TRIP CHECK ==="
mkdir -p "$VERIFY"
unzip -q "$OUT" -d "$VERIFY"
LOCALCOUNT=$(cd "$VERIFY" && echo **/* **/.* 2>/dev/null | tr ' ' '\n' | wc -l)
ls "$VERIFY"
echo "--- key sanity files ---"
for f in package.json src/app/page.tsx prisma/schema.prisma src/lib/zai-models.ts scripts/e2e-v71-final-check.mjs REBUILD_SPEC.md .env.example; do
  [ -f "$VERIFY/$f" ] && echo "OK  $f" || echo "MISSING  $f"
done
rm -rf "$VERIFY"
echo "=== DONE ==="
