# CLOUD AGENT ⇄ VORTEX SERVER — Integration Guide

Add your **CLOUD AGENT** (AI app builder) to the VORTEX SERVER central infrastructure in
3 steps. The SDK is zero-dependency and works on Node 18+, Bun, Deno, and edge runtimes
(anything with `fetch`).

```
CLOUD AGENT (your codebase)                    VORTEX SERVER (central infra)
┌─────────────────────────────┐   pk_live_…   ┌────────────────────────────────┐
│  AI builds app source       │ ────────────► │ /api/v1/cloud-agent/*          │
│  calls VortexCloudAgent     │               │ cloud-agent-projects bucket    │
│  gets signed download URLs  │ ◄──────────── │ CaProject / CaBuild rows       │
└─────────────────────────────┘  signed URLs  └────────────────────────────────┘
```

---

## Step 1 — Get the platform key (one time)

1. Open the **VORTEX SERVER dashboard** → sign in with your VORTEX ID (email + password + OTP).
2. Go to **SERVER — Central Infrastructure** → **APIs** (sidebar item).
3. On the **CLOUD AGENT** card click **Issue key**.
4. The raw key (`pk_live_…`) is shown **once** in a dialog — copy it immediately.
   Only its SHA-256 hash is stored server-side; it cannot be retrieved again.

The key auto-carries the CLOUD AGENT scope set:
`projects.read · projects.write · builds.write · storage.read · storage.write`
(it is rejected on `/api/v1/admin/*` — namespaces are isolated by design).

## Step 2 — Configure your Cloud Agent codebase

Copy the SDK + env into your project:

```bash
cp vortex-client.mjs  /path/to/cloud-agent/lib/vortex/vortex-client.mjs
cp .env.example       /path/to/cloud-agent/.env   # then paste your pk_live_ key
```

`.env`:

```env
VORTEX_SERVER_URL=https://your-vortex-server-host   # or http://127.0.0.1:3000 in dev
VORTEX_PLATFORM_KEY=pk_live_xxxxxxxxxxxxxxxxxxxx
```

Next.js example (`app/api/build/route.ts` or any server-side module — **never expose
the key to the browser**):

```ts
import { VortexCloudAgent } from "@/lib/vortex/vortex-client.mjs";

const ca = new VortexCloudAgent({
  baseUrl: process.env.VORTEX_SERVER_URL!,
  platformKey: process.env.VORTEX_PLATFORM_KEY!,
});

export async function POST(req: Request) {
  const { userId, appName, files } = await req.json();   // files: { path, content }[]
  const project = await ca.createProject({ name: appName, type: "flutter", ownerEmail: userId });
  await ca.uploadSource(project.projectId, files, { entry: "lib/main.dart" });
  const build = await ca.build(project.projectId, { trigger: "agent" });
  const links = await ca.exportLinks(project.projectId);
  return Response.json({ projectId: project.projectId, buildId: build.buildId, links });
}
```

## Step 3 — Or run the whole pipeline in one call

```js
const { project, source, build, links } = await ca.ship({
  name: "Todo App",
  type: "flutter",
  ownerEmail: "enduser@example.com",     // per-user isolation prefix in the bucket
  entry: "lib/main.dart",
  files: [{ path: "lib/main.dart", content: "void main() {}" }],
});
const bundle = await ca.download(links.artifact.url);   // Buffer, sha256 == build.checksum
```

---

## API surface (what each call does on the server)

| SDK call | Server endpoint | Effect |
| --- | --- | --- |
| `createProject()` | `POST /api/v1/cloud-agent/projects` | `CaProject` row (DRAFT) + bucket prefix `cloud-agent:<ownerEmail>:<projectId>` |
| `uploadSource()` | `POST .../projects/:id/source` | files → `cloud-agent-projects` bucket (3x replicas, sha256) + `manifest.json`; status → READY |
| `build()` | `POST .../projects/:id/build` | `CaBuild` row + artifact bundle object; returns checksum |
| `listProjects()` / `getProject()` | `GET .../projects[/:id]` | project detail + last 10 builds |
| `exportSigned(id, "source"\|"artifact")` | `GET .../projects/:id/export` | ONE HMAC signed URL (platform-bound, ≤ 7 days; SDK asks 24 h) |
| `exportLinks(id)` | `POST /api/v1/cloud-agent/export/:id` | source + artifact links together |
| `download(url)` | `GET /api/v1/admin/storage/object?…sig=…` | bytes — the signed URL itself is the credential |

## Safety model (already enforced server-side)

- **Platform key = SHA-256 hashed at rest**, `pk_live_` raw shown once at issuance.
- **Isolation**: every object and row is bound to `platform_id + user_id + project_id`.
- **Signed URLs are platform-bound**: a URL minted by the CLOUD AGENT key cannot be used to
  touch VORTEX WEBSITE / APPVERSE / VI buckets (the issuing platform is baked into the HMAC).
- **Rate limit**: 120 requests / minute / IP on POSTs.
- Scope denials return `403` with the missing scope named.

## Verify your wiring

```bash
node demo/full-flow.cjs   # live E2E against the dev server — should end with 8/8 passed
```

Last verified: 8/8 steps passed (key issue → create → upload → build → signed export →
sha256-verified download → project detail).
