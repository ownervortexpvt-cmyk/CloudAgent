#!/usr/bin/env bash
# Build the PUBLIC static export of Vortex Cloud Agent for Cloudflare Pages.
# Runs in a COPY of the source so the live dev server is never disturbed.
set -e
SRC=/home/z/my-project
DST=/home/z/my-project/.pages-build

rm -rf "$DST"
mkdir -p "$DST"

# source only — no node_modules (symlinked), no runtime data, no .next
rsync -a \
  --exclude node_modules --exclude .next --exclude .git \
  --exclude db --exclude projects --exclude upload --exclude download \
  --exclude db-rescue --exclude .env --exclude .ecosystem --exclude vortex-git \
  --exclude sdk --exclude runtime-store --exclude .zscripts --exclude .secrets \
  --exclude .wrangler --exclude "*.log" --exclude .snapshots --exclude .dev-watchdog.lock \
  "$SRC/" "$DST/"

# node_modules as hard links — same fs, near-instant, turbopack-safe
rm -rf "$DST/node_modules"
cp -al "$SRC/node_modules" "$DST/node_modules"

# export build: strip server-only surfaces
rm -rf "$DST/src/app/api" "$DST/src/app/admin" "$DST/src/app/dashboard" \
       "$DST/src/app/sites" "$DST/src/app/preview" "$DST/src/app/gate" \
       "$DST/src/app/maintenance" "$DST/src/app/sitemap.xml" \
       "$DST/src/middleware.ts" "$DST/src/instrumentation.ts" \
       "$DST/vortex-platform" "$DST/mini-services" "$DST/scripts" "$DST/examples" \
       "$DST/local-ai" "$DST/js" "$DST/skills" "$DST/dev-watchdog.log" "$DST/dev.log" \
       "$DST/sdk-doctor.log" "$DST/MARKER2.txt" "$DST/db-rescue" 2>/dev/null || true

# index → marketing landing (the app itself cannot run on static hosting)
cat > "$DST/src/app/page.tsx" <<'EOF'
import { redirect } from 'next/navigation'
export default function Home() { redirect('/landing') }
EOF

# /register awaits searchParams (plan deep-link) → force-static for the export
# copy so the page prerenders with no params (the live app keeps its version)
sed -i '1s|^|export const dynamic = "force-static"\n\n|' "$DST/src/app/register/page.tsx"

# type-only stub: a client component imports a TYPE from an API route that is
# stripped in the export build — satisfy the import with a declaration-only file
mkdir -p "$DST/src/app/api/providers/health-record"
cat > "$DST/src/app/api/providers/health-record/route.ts" <<'EOF'
export interface KeyHealthVerdict {
  id: string
  name: string
  kind: string
  endpoint: string | null
  model?: string
  ok: boolean
  status?: number
  error?: string
  via: string
  at: number
}
EOF

# static sitemap (the dynamic one was a route handler)
cat > "$DST/public/sitemap.xml" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>/</loc></url>
  <url><loc>/landing</loc></url>
  <url><loc>/pricing</loc></url>
  <url><loc>/privacy</loc></url>
  <url><loc>/terms</loc></url>
  <url><loc>/refund</loc></url>
  <url><loc>/contact</loc></url>
  <url><loc>/register</loc></url>
</urlset>
EOF

# minimal export config (replaces the dev/prod config entirely)
cat > "$DST/next.config.ts" <<'EOF'
import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  turbopack: { root: process.cwd() },
};
export default nextConfig;
EOF

cd "$DST"
bun run next build 2>&1 | tail -25
