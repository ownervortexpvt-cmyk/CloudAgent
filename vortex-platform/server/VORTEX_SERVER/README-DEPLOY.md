# VORTEX SERVER — Full Source Package

Central cloud infrastructure for the VORTEX ecosystem. One backend, one database,
one storage pool serving five platforms: **VORTEX SERVER**, **CLOUD AGENT**,
**VORTEX WEBSITE**, **APPVERSE**, **VI (VORTEX INTELLIGENT)** — plus the VaaS
multi-tenant BaaS layer.

## Stack
- Next.js 16 (App Router) + TypeScript + Tailwind + shadcn/ui
- Prisma ORM — PostgreSQL-targeted schema (dev runs on SQLite via `db/custom.db`)
- Object storage: local 3x-replica engine (default) or JOY SERVICES S3 SigV4
- Auth: VORTEX ID (password + OTP) + scoped platform keys (`pk_live_…`, SHA-256 at rest)

## Quickstart (Bun recommended)

```bash
bun install                 # or: npm install / pnpm install
bunx prisma generate        # regenerate the prisma client (src/generated excluded)
bun run db:push             # create db/custom.db from prisma/schema.prisma
bun run dev                 # http://localhost:3000
```

### First login
- Email `admin@vortex.local`, password `Vortex@2026`.
- OTP: with no SMTP configured the code appears in the login **dev hint**.
  For real mail capture run `node scripts/smtp-sink.cjs` (writes OTP mails to
  `/tmp/smtp-sink/*.eml`) and set `SMTP_HOST=127.0.0.1`, `SMTP_PORT=8025`.
- Change the owner password immediately in a real deployment.

## API namespaces
| Namespace | Purpose |
| --- | --- |
| `/api/v1/admin` | owner: overview, platforms+keys, storage truth-check, security, billing, signed-object redemption |
| `/api/v1/cloud-agent` | AI app builder: project → source → build → signed export |
| `/api/v1/vortex-website` | site → files → deploy (versioned) → domain claim |
| `/api/v1/appverse` | app store: APK/AAB upload → review gate → signed download |
| `/api/v1/vi` | VI tasks: monitor, assist (LLM), gated deploy/publish |

Auth: `Authorization: Bearer pk_live_…` (platform key) or owner session cookie.

## Platform keys
Dashboard → **SERVER — Central Infrastructure** → **APIs** → pick a platform →
**Issue key**. The raw key is shown ONCE (only its SHA-256 hash is stored).

## Storage / JOY SERVICES
- Default: local replicated engine — everything works offline.
- JOY: Dashboard → **Storage** → JOY form (Access key / Secret key / API token).
  Provider switches to `joy` only after a live verification passes (honesty rule);
  S3 data plane needs access+secret keys, the REST v1 control plane needs the
  `joy_…` token. Secrets are stored as isSecret rows and never echoed.

## Verification
```bash
node scripts/vs-smoke.cjs          # 30-step E2E (needs dev server running)
cd integrations/vortex-cloud-agent-sdk && node demo/full-flow.cjs   # SDK E2E
```

## Layout
```
prisma/schema.prisma       12-module database schema (+10 VORTEX SERVER models)
src/app/api/v1/            5 namespaces + auth/mail/storage/… endpoints
src/lib/vortex/            vserver.ts (platforms, buckets, providers, keys), auth, mail, …
src/components/vortex/     dashboard + views (server.tsx = central infra UI)
scripts/                   smoke tests, SMTP sink, doc generators
docs/                      architecture PDF + development plan
integrations/              drop-in SDK kits for platform codebases
```
