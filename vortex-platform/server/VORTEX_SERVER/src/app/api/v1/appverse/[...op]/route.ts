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
  issueSignedDownload,
  type PlatformId,
  type VsActor,
} from "@/lib/vortex/vserver";
import { getSessionUser } from "@/lib/vortex/auth";

/**
 * /api/v1/appverse/[...op] — APPVERSE namespace.
 * Real backing: AppverseApp/AppverseVersion rows + APK/AAB bytes in private
 * buckets with SHA-256 integrity + review gate + signed counted downloads.
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
    return { via: `owner:${user.email}`, platform: "appverse", subject: user.id, scopes: ["apps.read", "apps.write", "review.write", "storage.read", "storage.write"], isOwner: true };
  }
  return { response: fail("Unauthorized — platform key or VORTEX ID session required", 401) };
}

export async function GET(req: Request, ctx: { params: Promise<{ op: string[] }> }) {
  await ensureSeeded();
  const auth = await authenticate(req);
  if ("response" in auth) return auth.response;
  if (!scopeOk({ ok: true, keyId: auth.via, platform: auth.platform as PlatformId, kind: "platform", scopes: auth.scopes }, "apps.read")) {
    return fail("Token lacks scope: apps.read", 403);
  }
  const { op } = await ctx.params;
  const [seg, a, action] = op;

  if (seg === "apps" && !a) {
    const apps = await db.appverseApp.findMany({ orderBy: { updatedAt: "desc" }, take: 100, include: { versions: { orderBy: { createdAt: "desc" }, take: 1 } } });
    return ok({
      apps: apps.map((av) => ({
        appId: av.appId, name: av.name, packageName: av.packageName, category: av.category,
        status: av.status, latestVersion: av.latestVersion, downloadCount: av.downloadCount,
        versions: av.versions.map((v) => ({ versionId: v.versionId, version: v.version, kind: v.kind, status: v.status, sizeBytes: v.sizeBytes, sha256: v.sha256 })),
        updatedAt: av.updatedAt,
      })),
    });
  }

  if (seg === "apps" && a && action === "download") {
    const av = await db.appverseApp.findUnique({ where: { appId: a }, include: { versions: { where: { status: "APPROVED" }, orderBy: { createdAt: "desc" }, take: 1 } } });
    if (!av) return fail("App not found", 404);
    if (av.status !== "PUBLISHED" || av.versions.length === 0) return fail("No published version available for download", 403);
    const v = av.versions[0];
    const signed = await issueSignedDownload(v.bucket, v.objectKey, { platform: auth.platform as PlatformId, subject: auth.subject, via: auth.via }, 3600);
    if ("error" in signed) return fail(signed.error, 404);
    await db.appverseVersion.update({ where: { id: v.id }, data: { downloads: { increment: 1 } } });
    await db.appverseApp.update({ where: { id: av.id }, data: { downloadCount: { increment: 1 } } });
    await writeAudit({ actor: auth.via, action: "AV_DOWNLOAD", resource: `${av.appId}@${v.version}`, detail: `signed link issued (${v.kind}, sha256 verified at upload)` });
    return ok({ appId: av.appId, version: v.version, kind: v.kind, sizeBytes: v.sizeBytes, sha256: v.sha256, ...signed });
  }

  if (seg === "apps" && a) {
    const av = await db.appverseApp.findUnique({ where: { appId: a }, include: { versions: { orderBy: { createdAt: "desc" } } } });
    if (!av) return fail("App not found", 404);
    return ok({
      app: {
        appId: av.appId, name: av.name, packageName: av.packageName, category: av.category,
        description: av.description, status: av.status, latestVersion: av.latestVersion,
        downloadCount: av.downloadCount, createdAt: av.createdAt,
      },
      versions: av.versions.map((v) => ({
        versionId: v.versionId, version: v.version, kind: v.kind, status: v.status,
        sizeBytes: v.sizeBytes, sha256: v.sha256, changelog: v.changelog,
        downloads: v.downloads, publishedAt: v.publishedAt, createdAt: v.createdAt,
      })),
    });
  }

  return fail("Unknown appverse endpoint", 404);
}

export async function POST(req: Request, ctx: { params: Promise<{ op: string[] }> }) {
  await ensureSeeded();
  const ip = getClientIp(req);
  const rl = rateLimit(`appverse:${ip}`, 120, 60_000);
  if (!rl.allowed) return fail("Rate limit exceeded", 429, { retryAfter: Math.ceil((rl.retryAfterMs || 0) / 1000) });
  const auth = await authenticate(req);
  if ("response" in auth) return auth.response;
  const { op } = await ctx.params;
  const [seg, a, action] = op;
  const body = await req.json().catch(() => ({}));
  const actor: VsActor = { platform: auth.platform as PlatformId, subject: auth.subject, via: auth.via };

  if (seg === "apps" && !a) {
    if (!scopeOk({ ok: true, keyId: auth.via, platform: auth.platform as PlatformId, kind: "platform", scopes: auth.scopes }, "apps.write")) {
      return fail("Token lacks scope: apps.write", 403);
    }
    const name = String(body.name || "").trim().slice(0, 80);
    const packageName = String(body.packageName || "").trim().toLowerCase();
    if (!name) return fail("name is required");
    if (!/^[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,4}$/.test(packageName)) return fail("packageName must look like com.example.app");
    const clash = await db.appverseApp.findUnique({ where: { packageName } });
    if (clash) return fail("packageName already registered", 409);
    const appId = `av_${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
    const av = await db.appverseApp.create({
      data: {
        appId, name, packageName,
        category: String(body.category || "general").slice(0, 24),
        description: String(body.description || "").slice(0, 2000),
        developerId: body.developerId ? String(body.developerId) : null,
        status: "DRAFT",
      },
    });
    await writeAudit({ actor: auth.via, action: "AV_APP_CREATED", resource: appId, detail: `${name} (${packageName})`, ip });
    return ok({ appId: av.appId, name: av.name, packageName: av.packageName, status: av.status }, 201);
  }

  if (seg === "apps" && a && action === "versions") {
    if (!scopeOk({ ok: true, keyId: auth.via, platform: auth.platform as PlatformId, kind: "platform", scopes: auth.scopes }, "apps.write")) {
      return fail("Token lacks scope: apps.write", 403);
    }
    const av = await db.appverseApp.findUnique({ where: { appId: a } });
    if (!av) return fail("App not found", 404);
    const version = String(body.version || "").trim();
    const kind = String(body.kind || "APK").toUpperCase() === "AAB" ? "AAB" : "APK";
    const buf = Buffer.from(String(body.contentB64 || ""), "base64");
    if (!/^\d+\.\d+/.test(version)) return fail("version must be semver-like (1.0.0)");
    if (buf.length === 0) return fail("contentB64 (the APK/AAB bytes) is required");
    if (buf.length > 512 * 1024 * 1024) return fail("Binary exceeds the 512 MB admission cap");
    // integrity: real sha256 over the exact bytes; extension sanity check
    const bucket = kind === "AAB" ? "appverse-aab" : "appverse-apk";
    const objectKey = `${av.packageName}/${version}/${av.packageName}-${version}.${kind.toLowerCase()}`;
    const put = await vsPutObject(bucket, objectKey, buf, actor, { mime: kind === "AAB" ? "application/octet-stream" : "application/vnd.android.package-archive" });
    if ("error" in put) return fail(put.error, 400);
    const versionId = `avv_${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
    const rec = await db.appverseVersion.create({
      data: {
        versionId, appId: av.id, version, kind, bucket, objectKey,
        sizeBytes: put.sizeBytes, sha256: put.checksum,
        changelog: String(body.changelog || "").slice(0, 1000),
        status: "PENDING",
      },
    });
    await db.appverseApp.update({ where: { id: av.id }, data: { status: "PENDING_REVIEW" } });
    await writeAudit({ actor: auth.via, action: "AV_VERSION_UPLOADED", resource: `${av.appId}@${version}`, detail: `${kind} ${put.sizeBytes}B sha256=${put.checksum.slice(0, 12)} PENDING review`, ip });
    return ok({ versionId: rec.versionId, version, kind, status: rec.status, sizeBytes: put.sizeBytes, sha256: put.checksum }, 201);
  }

  if (seg === "versions" && a && action === "approve") {
    if (!scopeOk({ ok: true, keyId: auth.via, platform: auth.platform as PlatformId, kind: "platform", scopes: auth.scopes }, "review.write")) {
      return fail("Token lacks scope: review.write", 403);
    }
    const v = await db.appverseVersion.findUnique({ where: { versionId: a }, include: { app: true } });
    if (!v) return fail("Version not found", 404);
    const decision = String(body.decision || "approve").toLowerCase();
    if (!["approve", "reject"].includes(decision)) return fail("decision must be approve or reject");
    const now = new Date();
    await db.appverseVersion.update({
      where: { id: v.id },
      data: { status: decision === "approve" ? "APPROVED" : "REJECTED", publishedAt: decision === "approve" ? now : null },
    });
    await db.appverseApp.update({
      where: { id: v.appId },
      data: {
        status: decision === "approve" ? "PUBLISHED" : "REJECTED",
        latestVersion: decision === "approve" ? v.version : v.app.latestVersion,
      },
    });
    await writeAudit({ actor: auth.via, action: "AV_REVIEW", resource: `${v.app.appId}@${v.version}`, detail: `${decision} by ${auth.via}`, ip });
    return ok({ versionId: v.versionId, status: decision === "approve" ? "APPROVED" : "REJECTED", published: decision === "approve" });
  }

  return fail("Unknown appverse endpoint", 404);
}
