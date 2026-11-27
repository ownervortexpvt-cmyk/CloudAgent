# Code Hub Access — সম্পূর্ণ গাইড

Vortex Cloud Agent-এর **নিজস্ব git server** (self-hosted, no third party).
পুরো ecosystem code + endpoints + scripts + backend database — সব এখান থেকে
token দিয়ে যেকোনো জায়গায় (OpenHand, নতুন sandbox, editor) clone করা যায়।

## 1) Clone / কোড নামানো

```bash
git clone http://<platform-host>/api/ecosystem-git/vortex-ecosystem.git vortex-code
# Username: যেকোনো কিছু (যেমন vortex)
# Password: ecosystem git token (নিচে দেখুন)
cd vortex-code
git checkout private-data   # backend database (data.sql + custom.db) দরকার হলে
```

`<platform-host>` = tunnel URL (sandbox-এ) বা `localhost:3000` (platform machine-এ)।

## 2) Token তৈরি / Create token

1. Platform-এ Admin হিসেবে login করুন
2. **Admin Panel → Code Hub → Git access tokens → Create token**
3. Token একবারই দেখাবে — সেটাই git password

API দিয়েও সম্ভব: `POST /api/admin/panel/code-hub` (admin session দরকার)।

## 3) Push = auto deploy

CodeHub-এ `git push` করলে স্বয়ংক্রিয়ভাবে চলে:
`checkout → deps (manifest বদলালে) → VORTEX build (code বদলালে) → :3200 restart`
CloudAgent (:3000) এডিট dev/HMR-এ তাৎক্ষণিক লাইভ।

## 4) কী কী আছে এই repo-তে

| জিনিস | পথ |
|---|---|
| Platform source (Next.js) | `src/` |
| API endpoints (101টা, method সহ) | `ENDPOINTS.md` |
| 8 permanent AI lanes (v166) | `src/lib/ai/lanes.ts` |
| VORTEX_SERVER + CLOUDAGENT_BUILD | `vortex-platform/server/` |
| Watchdog / keeper / build scripts | `scripts/` |
| Backend database | `backend-database/` (`private-data` branch) |
| Mini-services (agent-service ইত্যাদি) | `mini-services/` |

## 5) ডাটা সেফটি নিয়ম

`db/`, `projects/`, `upload/`, `download/`, `.env`, `.secrets/`, `db-rescue/` —
এগুলো কোনো push/deploy-তে যায় না। Runtime ডাটা সবসময় নিরাপদ।
Backend database-এর স্ন্যাপশট শুধু `backend-database/`-এ থাকে এবং
`private-data` ব্রাঞ্চ ছাড়া অন্য কোথাও যায় না।
