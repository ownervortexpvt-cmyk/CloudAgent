import { NextResponse } from "next/server";
import { ensureSeeded } from "@/lib/vortex/seed";
import { ok, fail } from "@/lib/vortex/api";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/vortex/audit";
import { getClientIp, rateLimit } from "@/lib/vortex/ratelimit";
import {
  platformFromRequest,
  issuePlatformKey,
  resolveProvider,
  poolUsage,
  checkStorageAlert,
  verifySignedDownload,
  vsGetObject,
  BUCKET_SPECS,
  type PlatformId,
} from "@/lib/vortex/vserver";
import { getSessionUser } from "@/lib/vortex/auth";

/**
 * /api/v1/admin/[...op] — VORTEX SERVER admin namespace (owner control).
 * Auth: VORTEX ID owner session normally; a MASTER platform key is accepted
 * for server-to-server admin automation. Per-platform keys are rejected.
 */

export const dynamic = "force-dynamic";

async function authenticate(req: Request): Promise<{ via: string; isMaster: boolean } | { response: NextResponse }> {
  const pk = await platformFromRequest(req);
  if (pk.ok) {
    if (pk.kind !== "master") return { response: fail("Admin namespace requires the owner session or the master key — per-platform keys are rejected", 403) };
    return { via: `master:${pk.keyId}`, isMaster: true };
  }
  const user = await getSessionUser(req);
  if (user) return { via: `owner:${user.email}`, isMaster: false };
  return { response: fail("Unauthorized — VORTEX ID owner session required", 401) };
}

export async function GET(req: Request, ctx: { params: Promise<{ op: string[] }> }) {
  await ensureSeeded();
  const { op } = await ctx.params;
  const [seg, a] = op;

  // Signed URL redemption: the HMAC signature IS the auth — no session needed.
  // This branch MUST run before the owner-session gate.
  if (seg === "storage" && a === "object") {
    const url = new URL(req.url);
    const bucket = url.searchParams.get("bucket") || "";
    const key = url.searchParams.get("key") || "";
    const exp = parseInt(url.searchParams.get("exp") || "0", 10);
    const platform = url.searchParams.get("platform") || "";
    const sig = url.searchParams.get("sig") || "";
    if (!verifySignedDownload(bucket, key, exp, sig, platform)) return fail("Signed URL invalid or expired", 403);
    const data = await vsGetObject(bucket, key, { platform: platform as PlatformId, subject: "signed-url", via: "signed-url" });
    if (data instanceof Buffer) {
      await db.signedAccess.updateMany({ where: { bucket, objectKey: key, usedAt: null }, data: { usedAt: new Date() } });
      return new NextResponse(new Uint8Array(data), {
        headers: { "Content-Type": "application/octet-stream", "Content-Length": String(data.length), "X-Vortex-Object": `${bucket}/${key}` },
      });
    }
    return fail(typeof data === "object" && data && "error" in data ? data.error : "Object read failed", 404);
  }

  const auth = await authenticate(req);
  if ("response" in auth) return auth.response;

  if (seg === "overview") {
    const [users, developers, caProjects, caBuilds, sites, deployed, apps, published, vxProjects, keys, deployments, openAlerts] = await Promise.all([
      db.adminUser.count(),
      db.developer.count(),
      db.caProject.count(),
      db.caBuild.count(),
      db.websiteProject.count(),
      db.websiteProject.count({ where: { status: "DEPLOYED" } }),
      db.appverseApp.count(),
      db.appverseApp.count({ where: { status: "PUBLISHED" } }),
      db.vxProject.count(),
      db.platformKey.count({ where: { status: "ACTIVE" } }),
      db.websiteDeployment.count({ where: { status: "SUCCESS" } }),
      db.alertEvent.count({ where: { status: "OPEN" } }),
    ]);
    const pool = await poolUsage();
    return ok({
      totals: {
        users, developers,
        cloudAgentProjects: caProjects, cloudAgentBuilds: caBuilds,
        websites: sites, websitesDeployed: deployed,
        apps, appsPublished: published,
        vaasProjects: vxProjects, activePlatformKeys: keys,
        successfulDeployments: deployments, openAlerts,
      },
      storagePool: { provider: pool.provider, configured: pool.configured, missing: pool.missing, usedGb: Math.round((pool.usedMb / 1024) * 10) / 10, poolGb: Math.round(pool.poolMb / 1024), pct: pool.pct, endpoint: pool.endpoint },
      server: { version: "VORTEX SERVER 1.0", tagline: "ONE CENTRAL INFRASTRUCTURE", time: new Date().toISOString() },
    });
  }

  if (seg === "platforms") {
    const platforms = await db.platform.findMany({ orderBy: { sortOrder: "asc" }, include: { keys: { orderBy: { createdAt: "desc" } } } });
    return ok({
      platforms: platforms.map((p) => ({
        platformId: p.platformId, name: p.name, kind: p.kind, namespace: p.namespace,
        description: p.description, status: p.status,
        keys: p.keys.map((k) => ({
          keyId: k.keyId, name: k.name, kind: k.kind, status: k.status, scopes: k.scopes.split(",").filter(Boolean),
          lastUsedAt: k.lastUsedAt, expiresAt: k.expiresAt, createdAt: k.createdAt,
        })),
      })),
      bucketRegistry: BUCKET_SPECS,
    });
  }

  if (seg === "storage") {
    const provider = await resolveProvider();
    const buckets = await db.storageBucket.findMany({ orderBy: { name: "asc" } });
    const pool = await checkStorageAlert();
    return ok({
      provider: { active: provider.provider, configured: provider.configured, missing: provider.missing, endpoint: provider.endpoint, region: provider.region, note: provider.provider === "local" ? "Local replicated engine serving objects (3x replicas, sha256). JOY SERVICES goes live the moment the endpoint + keys are configured." : "JOY SERVICES S3 SigV4 is live." },
      pool: { usedGb: Math.round((pool.usedMb / 1024) * 10) / 10, poolGb: Math.round(pool.poolMb / 1024), pct: pool.pct, alertThresholdPct: 80 },
      buckets: buckets.map((b) => ({
        bucketId: b.bucketId, name: b.name, platform: b.platformId || "shared", purpose: b.purpose,
        provider: b.provider, status: b.status, quotaMb: b.quotaMb, usedMb: b.usedMb,
        objectCount: b.objectCount, versioning: b.versioning, versionDays: b.versionDays,
      })),
    });
  }

  if (seg === "security") {
    const [events, blocks, policy] = await Promise.all([
      db.securityEvent.findMany({ orderBy: { createdAt: "desc" }, take: 25 }),
      db.ipBlock.count({ where: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } }),
      db.securityPolicy.findFirst(),
    ]);
    const audits = await db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 25 });
    return ok({
      securityEvents: events.map((e) => ({ type: e.type, severity: e.severity, sourceIp: e.sourceIp, action: e.action, detail: (e.detail || "").slice(0, 160), createdAt: e.createdAt })),
      activeIpBlocks: blocks,
      policy: policy ? { wafEnabled: policy.wafEnabled, ipBlockEnabled: policy.ipBlockEnabled, ddosEnabled: policy.ddosEnabled, blockMode: policy.blockMode } : null,
      recentAudits: audits.map((x) => ({ id: x.id, actor: x.actor, action: x.action, resource: x.resource, detail: (x.detail || "").slice(0, 160), createdAt: x.createdAt })),
    });
  }

  if (seg === "billing") {
    const plans = await db.billingPlan.findMany({ where: { code: { startsWith: "CA_" } }, orderBy: { monthlyBaseBdt: "asc" } });
    const subs = await db.billingSubscription.count();
    return ok({
      cloudAgentPlans: plans.map((p) => ({
        code: p.code, name: p.name, priceInr: p.monthlyBaseBdt, currency: p.currency,
        audience: p.audience, active: p.isActive,
      })),
      activeSubscriptions: subs,
      note: "Payment gateway integration is Phase 12 — plans and status are real rows today",
    });
  }

  return fail("Unknown admin endpoint", 404);
}

export async function POST(req: Request, ctx: { params: Promise<{ op: string[] }> }) {
  await ensureSeeded();
  const ip = getClientIp(req);
  const rl = rateLimit(`admin:${ip}`, 60, 60_000);
  if (!rl.allowed) return fail("Rate limit exceeded", 429, { retryAfter: Math.ceil((rl.retryAfterMs || 0) / 1000) });
  const auth = await authenticate(req);
  if ("response" in auth) return auth.response;
  const { op } = await ctx.params;
  const [seg, a, action] = op;
  const body = await req.json().catch(() => ({}));

  if (seg === "platforms" && a && action === "keys") {
    const platformId = a;
    const name = String(body.name || `${platformId} key`).slice(0, 60);
    const kind = body.master === true ? "master" : "platform";
    const issued = await issuePlatformKey(platformId, name, auth.via, kind);
    if ("error" in issued) return fail(issued.error, 400);
    await writeAudit({ actor: auth.via, action: kind === "master" ? "VS_MASTER_KEY_ISSUED_UI" : "VS_PLATFORM_KEY_ISSUED_UI", resource: issued.keyId, detail: `${platformId} raw shown once to the owner`, ip });
    return ok({
      keyId: issued.keyId, platform: issued.platform, scopes: issued.scopes,
      raw: issued.raw, warning: "The raw key is shown ONCE — store it in the platform's server-side secret store now",
    }, 201);
  }

  if (seg === "storage" && a === "joy" && action === "configure") {
    // Wire JOY SERVICES credentials (isSecret rows) — owner-supplied, never echoed back
    const entries: { key: string; value: string; secret: boolean; note: string }[] = [];
    if (typeof body.apiToken === "string" && body.apiToken.trim()) entries.push({ key: "joy.api_token", value: body.apiToken.trim(), secret: true, note: "JOY REST v1 bearer token (joy_...)" });
    if (typeof body.accessKey === "string" && body.accessKey.trim()) entries.push({ key: "joy.access_key", value: body.accessKey.trim(), secret: true, note: "JOY S3 access key" });
    if (typeof body.secretKey === "string" && body.secretKey.trim()) entries.push({ key: "joy.secret_key", value: body.secretKey.trim(), secret: true, note: "JOY S3 secret key" });
    if (typeof body.endpoint === "string" && body.endpoint.trim()) entries.push({ key: "joy.endpoint", value: body.endpoint.trim(), secret: false, note: "JOY S3 endpoint (path-style)" });
    if (entries.length === 0) return fail("Provide apiToken / accessKey / secretKey (endpoint optional)");
    for (const e of entries) {
      await db.appConfig.upsert({
        where: { key: e.key },
        update: { value: e.value, isSecret: e.secret, category: "storage", description: e.note, updatedBy: auth.via },
        create: { key: e.key, value: e.value, isSecret: e.secret, category: "storage", description: e.note, updatedBy: auth.via },
      });
    }
    await db.appConfig.upsert({
      where: { key: "storage.provider" },
      update: { value: "joy", category: "storage", updatedBy: auth.via },
      create: { key: "storage.provider", value: "joy", category: "storage", description: "Active object storage provider (local | joy)", updatedBy: auth.via },
    });
    await writeAudit({ actor: auth.via, action: "VS_JOY_CONFIGURED", resource: "storage.provider", detail: `${entries.length} credential rows written (values never logged)`, ip });
    return ok({ configured: true, provider: "joy", note: "Run GET /api/v1/admin/storage for the live connectivity truth-check" }, 201);
  }

  return fail("Unknown admin endpoint", 404);
}
