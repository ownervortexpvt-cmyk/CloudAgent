import { NextResponse } from "next/server";
import { ensureSeeded } from "@/lib/vortex/seed";
import { ok, fail } from "@/lib/vortex/api";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/vortex/audit";
import { getClientIp, rateLimit } from "@/lib/vortex/ratelimit";
import {
  platformFromRequest,
  scopeOk,
  vsPutObject,
  vsGetObject,
  issueSignedDownload,
  type PlatformId,
  type VsActor,
} from "@/lib/vortex/vserver";
import { getSessionUser } from "@/lib/vortex/auth";

/**
 * /api/v1/vortex-website/[...op] — VORTEX WEBSITE namespace.
 * Real backing: WebsiteProject/WebsiteDeployment rows + objects in the
 * vortex-websites bucket + per-deploy manifests. Custom domain claims are
 * recorded; SSL issuance joins the existing SslCert engine in Phase 8.
 */

export const dynamic = "force-dynamic";

type Auth = { via: string; platform: PlatformId | "shared"; subject: string; scopes: string[]; isOwner: boolean };

async function authenticate(req: Request): Promise<Auth | { response: NextResponse }> {
  const pk = await platformFromRequest(req);
  if (pk.ok) {
    return { via: `pk:${pk.keyId}`, platform: pk.platform === "vortex-server" ? "vortex-server" : pk.platform, subject: pk.keyId, scopes: pk.scopes, isOwner: pk.kind === "master" };
  }
  const user = await getSessionUser(req);
  if (user) {
    return { via: `owner:${user.email}`, platform: "vortex-website", subject: user.id, scopes: ["sites.read", "sites.write", "deploy.write", "storage.read", "storage.write"], isOwner: true };
  }
  return { response: fail("Unauthorized — platform key or VORTEX ID session required", 401) };
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "site";
}

export async function GET(req: Request, ctx: { params: Promise<{ op: string[] }> }) {
  await ensureSeeded();
  const auth = await authenticate(req);
  if ("response" in auth) return auth.response;
  if (!scopeOk({ ok: true, keyId: auth.via, platform: auth.platform as PlatformId, kind: "platform", scopes: auth.scopes }, "sites.read")) {
    return fail("Token lacks scope: sites.read", 403);
  }
  const { op } = await ctx.params;
  const [seg, a] = op;

  if (seg === "sites" && !a) {
    const sites = await db.websiteProject.findMany({ orderBy: { updatedAt: "desc" }, take: 100 });
    return ok({
      sites: sites.map((s) => ({
        siteId: s.siteId, name: s.name, subdomain: s.subdomain, customDomain: s.customDomain,
        status: s.status, activeVersion: s.activeVersion, deployCount: s.deployCount,
        sizeBytes: s.sizeBytes, fileCount: s.fileCount, lastDeployAt: s.lastDeployAt,
        url: `https://${s.customDomain || `${s.subdomain}.vortex.site`}`,
      })),
    });
  }

  if (seg === "sites" && a && op[2] === "download") {
    const s = await db.websiteProject.findUnique({ where: { siteId: a } });
    if (!s) return fail("Site not found", 404);
    if (s.status !== "DEPLOYED") return fail("Site has no active deployment");
    const signed = await issueSignedDownload(s.bucket, `${s.prefix}/v${s.activeVersion}/index.html`, { platform: auth.platform as PlatformId, subject: auth.subject, via: auth.via }, 3600);
    if ("error" in signed) return fail(signed.error, 404);
    return ok({ siteId: s.siteId, version: s.activeVersion, ...signed });
  }

  if (seg === "sites" && a) {
    const s = await db.websiteProject.findUnique({ where: { siteId: a }, include: { deployments: { orderBy: { createdAt: "desc" }, take: 10 } } });
    if (!s) return fail("Site not found", 404);
    return ok({
      site: {
        siteId: s.siteId, name: s.name, subdomain: s.subdomain, customDomain: s.customDomain,
        status: s.status, bucket: s.bucket, prefix: s.prefix, activeVersion: s.activeVersion,
        sizeBytes: s.sizeBytes, fileCount: s.fileCount, lastDeployAt: s.lastDeployAt,
      },
      deployments: s.deployments.map((d) => ({
        depId: d.depId, version: d.version, status: d.status, filesCount: d.filesCount,
        sizeBytes: d.sizeBytes, log: d.log.slice(0, 300), deployedAt: d.deployedAt,
      })),
    });
  }

  return fail("Unknown vortex-website endpoint", 404);
}

export async function POST(req: Request, ctx: { params: Promise<{ op: string[] }> }) {
  await ensureSeeded();
  const ip = getClientIp(req);
  const rl = rateLimit(`vortex-website:${ip}`, 120, 60_000);
  if (!rl.allowed) return fail("Rate limit exceeded", 429, { retryAfter: Math.ceil((rl.retryAfterMs || 0) / 1000) });
  const auth = await authenticate(req);
  if ("response" in auth) return auth.response;
  const { op } = await ctx.params;
  const [seg, a, action] = op;
  const body = await req.json().catch(() => ({}));
  const actor: VsActor = { platform: auth.platform as PlatformId, subject: auth.subject, via: auth.via };

  if (seg === "sites" && !a) {
    if (!scopeOk({ ok: true, keyId: auth.via, platform: auth.platform as PlatformId, kind: "platform", scopes: auth.scopes }, "sites.write")) {
      return fail("Token lacks scope: sites.write", 403);
    }
    const name = String(body.name || "").trim().slice(0, 80);
    if (!name) return fail("name is required");
    const subdomain = `${slugify(body.subdomain || name)}.${Date.now().toString(36).slice(-4)}`;
    const ownerEmail = String(body.ownerEmail || "anon").toLowerCase().slice(0, 120);
    const siteId = `ws_${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
    const s = await db.websiteProject.create({
      data: {
        siteId, name, subdomain, ownerEmail,
        status: "DRAFT",
        bucket: "vortex-websites",
        prefix: `vortex-website:${ownerEmail}:${siteId}`,
        metaJson: JSON.stringify(body.meta || {}),
      },
    });
    await writeAudit({ actor: auth.via, action: "WS_SITE_CREATED", resource: siteId, detail: `${name} -> ${s.subdomain}.vortex.site`, ip });
    return ok({ siteId: s.siteId, name: s.name, subdomain: `${s.subdomain}.vortex.site`, status: s.status }, 201);
  }

  if (seg === "sites" && a && action === "files") {
    if (!scopeOk({ ok: true, keyId: auth.via, platform: auth.platform as PlatformId, kind: "platform", scopes: auth.scopes }, "storage.write")) {
      return fail("Token lacks scope: storage.write", 403);
    }
    const s = await db.websiteProject.findUnique({ where: { siteId: a } });
    if (!s) return fail("Site not found", 404);
    const files = Array.isArray(body.files) ? body.files.slice(0, 300) : [];
    if (files.length === 0) return fail("files: [{ path, contentB64 }] required");
    let total = 0;
    for (const f of files) {
      const rel = String(f.path || "").trim().replace(/^\/+/, "");
      const buf = Buffer.from(String(f.contentB64 || ""), "base64");
      if (!rel || buf.length === 0) continue;
      const res = await vsPutObject(s.bucket, `${s.prefix}/draft/${rel}`, buf, actor);
      if ("error" in res) return fail(res.error, 400);
      total += res.sizeBytes;
    }
    await db.websiteProject.update({ where: { id: s.id }, data: { sizeBytes: { increment: total }, fileCount: { increment: files.length } } });
    await writeAudit({ actor: auth.via, action: "WS_FILES_UPLOADED", resource: s.siteId, detail: `${files.length} files, ${total} bytes`, ip });
    return ok({ siteId: s.siteId, accepted: files.length, bytes: total }, 201);
  }

  if (seg === "sites" && a && action === "deploy") {
    if (!scopeOk({ ok: true, keyId: auth.via, platform: auth.platform as PlatformId, kind: "platform", scopes: auth.scopes }, "deploy.write")) {
      return fail("Token lacks scope: deploy.write", 403);
    }
    const s = await db.websiteProject.findUnique({ where: { siteId: a } });
    if (!s) return fail("Site not found", 404);
    const draftFiles = await db.fileObject.findMany({
      where: { bucket: { name: s.bucket }, path: { startsWith: `${s.prefix}/draft/` }, status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
      take: 300,
    });
    if (draftFiles.length === 0) return fail("Nothing to deploy — upload files first (POST /sites/:id/files)");
    const version = s.activeVersion + 1;
    const started = new Date();
    const dep = await db.websiteDeployment.create({
      data: { depId: `ws_dep_${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`, siteId: s.id, version, status: "QUEUED" },
    });
    try {
      // promote draft objects to versioned keys + write the deployment manifest
      const manifest: { path: string; sizeBytes: number; checksum: string }[] = [];
      let total = 0;
      for (const f of draftFiles) {
        const rel = f.path.replace(`${s.prefix}/draft/`, "");
        const src = await vsGetObject(s.bucket, f.path, actor);
        if (!(src instanceof Buffer)) throw new Error(typeof src === "object" && src && "error" in src ? src.error : "read failed");
        const dst = await vsPutObject(s.bucket, `${s.prefix}/v${version}/${rel}`, src, actor);
        if ("error" in dst) throw new Error(dst.error);
        manifest.push({ path: rel, sizeBytes: dst.sizeBytes, checksum: dst.checksum });
        total += dst.sizeBytes;
      }
      const manBuf = Buffer.from(JSON.stringify({ siteId: s.siteId, version, files: manifest, deployedAt: new Date().toISOString() }, null, 2));
      const manRes = await vsPutObject(s.bucket, `${s.prefix}/v${version}/manifest.json`, manBuf, actor, { mime: "application/json" });
      if ("error" in manRes) throw new Error(manRes.error);
      const hasIndex = manifest.some((m) => m.path === "index.html");
      if (!hasIndex) throw new Error("index.html missing — a deployable site needs one");
      const finished = new Date();
      await db.websiteDeployment.update({
        where: { id: dep.id },
        data: { status: "SUCCESS", filesCount: manifest.length, sizeBytes: total + manRes.sizeBytes, manifestJson: JSON.stringify(manifest), log: `deployed v${version}: ${manifest.length} files, ${total} bytes in ${finished.getTime() - started.getTime()}ms`, deployedAt: finished },
      });
      await db.websiteProject.update({ where: { id: s.id }, data: { status: "DEPLOYED", activeVersion: version, deployCount: { increment: 1 }, lastDeployAt: finished } });
      await writeAudit({ actor: auth.via, action: "WS_SITE_DEPLOYED", resource: s.siteId, detail: `v${version} ${manifest.length} files`, ip });
      return ok({ depId: dep.depId, siteId: s.siteId, version, status: "SUCCESS", files: manifest.length, sizeBytes: total, url: `https://${s.customDomain || `${s.subdomain}.vortex.site`}` }, 201);
    } catch (e) {
      await db.websiteDeployment.update({
        where: { id: dep.id },
        data: { status: "FAILED", log: String(e instanceof Error ? e.message : e).slice(0, 400), deployedAt: new Date() },
      });
      return fail("Deployment failed — see deployment log", 500, { depId: dep.depId });
    }
  }

  if (seg === "sites" && a && action === "domain") {
    if (!scopeOk({ ok: true, keyId: auth.via, platform: auth.platform as PlatformId, kind: "platform", scopes: auth.scopes }, "sites.write")) {
      return fail("Token lacks scope: sites.write", 403);
    }
    const s = await db.websiteProject.findUnique({ where: { siteId: a } });
    if (!s) return fail("Site not found", 404);
    const domain = String(body.domain || "").trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9.-]{3,253}$/.test(domain)) return fail("Invalid domain");
    if (s.status !== "DEPLOYED") return fail("Deploy the site before claiming a custom domain");
    const clash = await db.websiteProject.findFirst({ where: { customDomain: domain, id: { not: s.id } } });
    if (clash) return fail("Domain already claimed by another site", 409);
    await db.websiteProject.update({ where: { id: s.id }, data: { customDomain: domain } });
    await writeAudit({ actor: auth.via, action: "WS_DOMAIN_CLAIMED", resource: s.siteId, detail: `${domain} (SSL joins SslCert engine in Phase 8)`, ip });
    return ok({ siteId: s.siteId, domain, ssl: "PENDING — issued through the existing SslCert engine in Phase 8" }, 200);
  }

  return fail("Unknown vortex-website endpoint", 404);
}
