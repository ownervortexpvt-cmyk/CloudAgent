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
 * /api/v1/cloud-agent/[...op] — CLOUD AGENT namespace.
 * Auth: platform key (pk_live_...) or VORTEX ID owner session.
 * Real backing: CaProject/CaBuild rows + object storage puts/gets.
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
    return { via: `owner:${user.email}`, platform: "cloud-agent", subject: user.id, scopes: ["projects.read", "projects.write", "builds.write", "storage.read", "storage.write"], isOwner: true };
  }
  return { response: fail("Unauthorized — platform key or VORTEX ID session required", 401) };
}

const PROJECT_TYPES = ["android", "ios", "web", "desktop", "flutter", "react", "java", "kotlin", "swift", "dart", "csharp", "cpp", "go", "rust", "php", "html"];

export async function GET(req: Request, ctx: { params: Promise<{ op: string[] }> }) {
  await ensureSeeded();
  const auth = await authenticate(req);
  if ("response" in auth) return auth.response;
  if (!scopeOk({ ok: true, keyId: auth.via, platform: auth.platform as PlatformId, kind: "platform", scopes: auth.scopes }, "projects.read")) {
    return fail("Token lacks scope: projects.read", 403);
  }
  const { op } = await ctx.params;
  const [seg, a] = op;

  if (seg === "projects" && !a) {
    const projects = await db.caProject.findMany({ orderBy: { updatedAt: "desc" }, take: 100, include: { builds: { orderBy: { createdAt: "desc" }, take: 3 } } });
    return ok({
      projects: projects.map((p) => ({
        projectId: p.projectId, name: p.name, type: p.type, language: p.language, status: p.status,
        sizeBytes: p.sizeBytes, fileCount: p.fileCount, buildCount: p.buildCount, lastBuildAt: p.lastBuildAt,
        ownerEmail: p.ownerEmail, updatedAt: p.updatedAt,
        lastBuild: p.builds[0] ? { buildId: p.builds[0].buildId, status: p.builds[0].status, checksum: p.builds[0].checksum } : null,
      })),
    });
  }

  if (seg === "projects" && a && op[2] === "export") {
    const p = await db.caProject.findUnique({ where: { projectId: a } });
    if (!p) return fail("Project not found", 404);
    const what = new URL(req.url).searchParams.get("what") || "source";
    const key = what === "artifact"
      ? (await db.caBuild.findFirst({ where: { projectId: p.id, status: "SUCCESS" }, orderBy: { createdAt: "desc" } }))?.artifactKey
      : `${p.prefix}/manifest.json`;
    if (!key) return fail(`No ${what} available to export`, 404);
    const signed = await issueSignedDownload(p.bucket, key, { platform: auth.platform as PlatformId, subject: auth.subject, via: auth.via }, 24 * 3600);
    if ("error" in signed) return fail(signed.error, 400);
    return ok({ projectId: p.projectId, what, ...signed });
  }

  if (seg === "projects" && a) {
    const p = await db.caProject.findUnique({ where: { projectId: a }, include: { builds: { orderBy: { createdAt: "desc" }, take: 10 } } });
    if (!p) return fail("Project not found", 404);
    return ok({
      project: {
        projectId: p.projectId, name: p.name, type: p.type, language: p.language, status: p.status,
        bucket: p.bucket, prefix: p.prefix, sizeBytes: p.sizeBytes, fileCount: p.fileCount,
        buildCount: p.buildCount, lastBuildAt: p.lastBuildAt, meta: JSON.parse(p.metaJson || "{}"),
        createdAt: p.createdAt, updatedAt: p.updatedAt,
      },
      builds: p.builds.map((b) => ({
        buildId: b.buildId, status: b.status, trigger: b.trigger, sizeBytes: b.sizeBytes,
        checksum: b.checksum, artifactKey: b.artifactKey, log: b.log.slice(0, 400),
        startedAt: b.startedAt, finishedAt: b.finishedAt, createdAt: b.createdAt,
      })),
    });
  }

  return fail("Unknown cloud-agent endpoint", 404);
}

export async function POST(req: Request, ctx: { params: Promise<{ op: string[] }> }) {
  await ensureSeeded();
  const ip = getClientIp(req);
  const rl = rateLimit(`cloud-agent:${ip}`, 120, 60_000);
  if (!rl.allowed) return fail("Rate limit exceeded", 429, { retryAfter: Math.ceil((rl.retryAfterMs || 0) / 1000) });
  const auth = await authenticate(req);
  if ("response" in auth) return auth.response;
  const { op } = await ctx.params;
  const [seg, a] = op;
  const body = await req.json().catch(() => ({}));
  const actor: VsActor = { platform: auth.platform as PlatformId, subject: auth.subject, via: auth.via };

  if (seg === "projects" && !a) {
    if (!scopeOk({ ok: true, keyId: auth.via, platform: auth.platform as PlatformId, kind: "platform", scopes: auth.scopes }, "projects.write")) {
      return fail("Token lacks scope: projects.write", 403);
    }
    const name = String(body.name || "").trim().slice(0, 80);
    if (!name) return fail("name is required");
    const type = String(body.type || "web").toLowerCase();
    if (!PROJECT_TYPES.includes(type)) return fail(`Unsupported project type — supported: ${PROJECT_TYPES.join(", ")}`);
    const ownerEmail = String(body.ownerEmail || "anon").toLowerCase().slice(0, 120);
    const projectId = `ca_${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
    const p = await db.caProject.create({
      data: {
        projectId,
        name, type,
        language: String(body.language || type).slice(0, 24),
        ownerEmail,
        status: "DRAFT",
        bucket: "cloud-agent-projects",
        prefix: `cloud-agent:${ownerEmail}:${projectId}`,
        metaJson: JSON.stringify(body.meta || {}),
      },
    });
    await writeAudit({ actor: auth.via, action: "CA_PROJECT_CREATED", resource: projectId, detail: `${name} type=${type} owner=${ownerEmail}`, ip });
    return ok({ projectId: p.projectId, name: p.name, type: p.type, status: p.status, prefix: p.prefix }, 201);
  }

  if (seg === "projects" && a && op[2] === "source") {
    if (!scopeOk({ ok: true, keyId: auth.via, platform: auth.platform as PlatformId, kind: "platform", scopes: auth.scopes }, "storage.write")) {
      return fail("Token lacks scope: storage.write", 403);
    }
    const p = await db.caProject.findUnique({ where: { projectId: a } });
    if (!p) return fail("Project not found", 404);
    const files = Array.isArray(body.files) ? body.files.slice(0, 200) : [];
    if (files.length === 0) return fail("files: [{ path, contentB64 }] required");
    let total = 0;
    const stored: { path: string; sizeBytes: number; checksum: string }[] = [];
    for (const f of files) {
      const rel = String(f.path || "").trim();
      const buf = Buffer.from(String(f.contentB64 || ""), "base64");
      if (!rel || buf.length === 0) continue;
      const res = await vsPutObject(p.bucket, `${p.prefix}/src/${rel}`, buf, actor);
      if ("error" in res) return fail(res.error, 400);
      total += res.sizeBytes;
      stored.push({ path: rel, sizeBytes: res.sizeBytes, checksum: res.checksum });
    }
    const manifest = { projectId: p.projectId, name: p.name, type: p.type, entry: String(body.entry || ""), files: stored, generatedAt: new Date().toISOString() };
    const manBuf = Buffer.from(JSON.stringify(manifest, null, 2));
    const manRes = await vsPutObject(p.bucket, `${p.prefix}/manifest.json`, manBuf, actor, { mime: "application/json" });
    if ("error" in manRes) return fail(manRes.error, 400);
    const upd = await db.caProject.update({
      where: { id: p.id },
      data: { sizeBytes: total + manRes.sizeBytes, fileCount: stored.length + 1, status: "READY" },
    });
    await writeAudit({ actor: auth.via, action: "CA_SOURCE_REGISTERED", resource: p.projectId, detail: `${stored.length} files, ${total} bytes`, ip });
    return ok({ projectId: upd.projectId, status: upd.status, files: stored.length, sizeBytes: upd.sizeBytes }, 201);
  }

  if (seg === "projects" && a && op[2] === "build") {
    if (!scopeOk({ ok: true, keyId: auth.via, platform: auth.platform as PlatformId, kind: "platform", scopes: auth.scopes }, "builds.write")) {
      return fail("Token lacks scope: builds.write", 403);
    }
    const p = await db.caProject.findUnique({ where: { projectId: a } });
    if (!p) return fail("Project not found", 404);
    if (p.status === "DRAFT") return fail("Register source first (POST /projects/:id/source) before building");
    const started = new Date();
    const build = await db.caBuild.create({
      data: { buildId: `ca_bld_${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`, projectId: p.id, status: "RUNNING", trigger: String(body.trigger || "manual"), startedAt: started },
    });
    // package pipeline: read manifest + sources, write artifact bundle object.
    // Compiler toolchains attach to this same record in later phases.
    try {
      const manifestBuf = await vsGetObject(p.bucket, `${p.prefix}/manifest.json`, actor);
      if (manifestBuf instanceof Buffer) {
        const manifest = JSON.parse(manifestBuf.toString());
        const artifact = {
          kind: "vortex-package",
          projectId: p.projectId, name: p.name, type: p.type, language: p.language,
          files: manifest.files || [], entry: manifest.entry || "",
          packagedAt: new Date().toISOString(),
        };
        const artBuf = Buffer.from(JSON.stringify(artifact, null, 2));
        const artKey = `${p.prefix}/builds/${build.buildId}/bundle.json`;
        const artRes = await vsPutObject(p.bucket, artKey, artBuf, actor, { mime: "application/json" });
        if ("error" in artRes) throw new Error(artRes.error);
        const finished = new Date();
        await db.caBuild.update({
          where: { id: build.id },
          data: { status: "SUCCESS", artifactBucket: p.bucket, artifactKey: artKey, sizeBytes: artRes.sizeBytes, checksum: artRes.checksum, log: `packaged ${manifest.files?.length || 0} source files in ${finished.getTime() - started.getTime()}ms`, finishedAt: finished },
        });
        await db.caProject.update({ where: { id: p.id }, data: { buildCount: { increment: 1 }, lastBuildAt: finished, status: "READY" } });
      } else {
        throw new Error(typeof manifestBuf === "object" && manifestBuf && "error" in manifestBuf ? manifestBuf.error : "manifest missing");
      }
    } catch (e) {
      const finished = new Date();
      await db.caBuild.update({
        where: { id: build.id },
        data: { status: "FAILED", log: String(e instanceof Error ? e.message : e).slice(0, 400), finishedAt: finished },
      });
      await db.caProject.update({ where: { id: p.id }, data: { buildCount: { increment: 1 }, lastBuildAt: finished, status: "FAILED" } });
      return fail("Build failed — see build log", 500, { buildId: build.buildId });
    }
    await writeAudit({ actor: auth.via, action: "CA_BUILD_COMPLETED", resource: p.projectId, detail: build.buildId, ip });
    const done = await db.caBuild.findUnique({ where: { id: build.id } });
    return ok({
      buildId: build.buildId, status: done?.status, sizeBytes: done?.sizeBytes,
      checksum: done?.checksum, artifactKey: done?.artifactKey, log: done?.log,
    }, 201);
  }

  if (seg === "export" && a) {
    // full export: manifest + artifact links in one payload
    const p = await db.caProject.findUnique({ where: { projectId: a }, include: { builds: { where: { status: "SUCCESS" }, orderBy: { createdAt: "desc" }, take: 1 } } });
    if (!p) return fail("Project not found", 404);
    const src = await issueSignedDownload(p.bucket, `${p.prefix}/manifest.json`, actor, 3600);
    const b = p.builds[0];
    const art = b ? await issueSignedDownload(p.bucket, b.artifactKey || "", actor, 3600) : { error: "no successful build yet" };
    await writeAudit({ actor: auth.via, action: "CA_PROJECT_EXPORTED", resource: p.projectId, detail: "source+artifact links issued", ip });
    return ok({
      projectId: p.projectId,
      source: "error" in src ? null : { url: src.url, expiresAt: src.expiresAt },
      artifact: "error" in art ? null : { url: art.url, expiresAt: art.expiresAt },
      note: "Compiler-based builds (apk/jar/bin) attach to the same pipeline in later phases",
    });
  }

  return fail("Unknown cloud-agent endpoint", 404);
}
