# Backend Database — restore guide / ব্যাকএন্ড ডাটাবেস

This folder carries the complete Vortex Cloud Agent backend database so any
new environment (OpenHand, fresh sandbox, another machine) can boot with the
same schema — and, on private access, the same data.

এই ফোল্ডারে পুরো backend database আছে — নতুন পরিবেশে (OpenHand, fresh sandbox)
একই schema দিয়ে কাজ শুরু করা যাবে; private access থাকলে ডাটাও সহ।

## Files

| File | What | Where |
|---|---|---|
| `schema.sql` | Full CREATE schema (39 tables) — no user data | all branches (public-safe) |
| `data.sql` | Full dump: schema + rows (users/providers/settings) | `private-data` branch only |
| `custom.db` | Ready-to-run SQLite file (checkpointed) | `private-data` branch only |

## Restore / পুনরুদ্ধার

```bash
# Option 1 — raw file (fastest)
cp custom.db /your/project/db/custom.db

# Option 2 — from SQL
sqlite3 custom.db < data.sql        # full (private-data branch)
sqlite3 fresh.db < schema.sql       # schema only (public branch)
```

Node (no sqlite3 CLI): `node -e "const {DatabaseSync}=require('node:sqlite'); new DatabaseSync('custom.db').exec(require('fs').readFileSync('data.sql','utf8'))"`

Prisma users: after restore run `npx prisma generate` (schema already matches `prisma/schema.prisma` in the repo root).

## Branches

- `main` — code + `schema.sql` + this README (public repos get this)
- `private-data` — main + `data.sql` + `custom.db` (CodeHub + private GitHub repos only;
  contains user password hashes — never push to a public repo)

## CodeHub clone (from anywhere the platform URL is reachable)

```bash
git clone http://<platform-host>/api/ecosystem-git/vortex-ecosystem.git vortex-code
cd vortex-code && git checkout private-data   # for data.sql + custom.db
# Username: anything (e.g. vortex)
# Password: an ecosystem token — create in Admin > Code Hub > Git access tokens
```

Re-export a fresh copy any time: `node scripts/export-backend-db.mjs`
