import { db } from "@/lib/db";
import { createHash, createHmac } from "crypto";
import { writeAudit } from "./audit";
import { shortId, sha256, generateToken } from "./crypto";
import { writeObject, readObject, objectExists, sanitizeObjectPath, mimeFromPath } from "./storage";

/**
 * VORTEX SERVER — Central Cloud Infrastructure core (Phase VS).
 *
 * Tenancy: five platforms (vortex-server, cloud-agent, vortex-website,
 * appverse, vi) share ONE backend, ONE database and ONE 100 GB storage pool.
 * Isolation is enforced in code: bucket ownership + object key prefixes +
 * platform keys with narrow scopes. Nothing is shown ACTIVE unless a real
 * code path executes.
 */

// ------------------------------------------------------------
// platform registry
// ------------------------------------------------------------

export const PLATFORM_SPECS = [
  { platformId: "vortex-server", name: "VORTEX SERVER", kind: "infra", namespace: "/api/v1/admin", sortOrder: 1, description: "Central infrastructure and admin control plane" },
  { platformId: "cloud-agent", name: "CLOUD AGENT", kind: "builder", namespace: "/api/v1/cloud-agent", sortOrder: 2, description: "AI app builder - projects, builds, source code" },
  { platformId: "vortex-website", name: "VORTEX WEBSITE", kind: "hosting", namespace: "/api/v1/vortex-website", sortOrder: 3, description: "Website creation, hosting, domains and SSL" },
  { platformId: "appverse", name: "APPVERSE", kind: "distribution", namespace: "/api/v1/appverse", sortOrder: 4, description: "App publishing - APK/AAB, review, downloads" },
  { platformId: "vi", name: "VI - VORTEX INTELLIGENT", kind: "ai", namespace: "/api/v1/vi", sortOrder: 5, description: "Central AI agent - assistance, monitoring, coordination" },
] as const;

export type PlatformId = (typeof PLATFORM_SPECS)[number]["platformId"];

/** Seed the five platforms idempotently. */
export async function ensurePlatforms() {
  for (const spec of PLATFORM_SPECS) {
    await db.platform.upsert({
      where: { platformId: spec.platformId },
      update: { name: spec.name, kind: spec.kind, namespace: spec.namespace, description: spec.description, sortOrder: spec.sortOrder },
      create: { ...spec },
    });
  }
}

// ------------------------------------------------------------
// bucket registry — the ten ecosystem buckets
// ------------------------------------------------------------

export type BucketSpec = {
  name: string;
  platform: PlatformId | "shared";
  purpose: string;
  access: "private" | "signed-only" | "origin";
  versioning: boolean;
  versionDays: number;
  quotaMb: number;
};

export const BUCKET_SPECS: BucketSpec[] = [
  { name: "cloud-agent-projects", platform: "cloud-agent", purpose: "CLOUD AGENT project archives and build artifacts", access: "private", versioning: true, versionDays: 30, quotaMb: 20480 },
  { name: "developer-source-code", platform: "cloud-agent", purpose: "Per-developer source code storage", access: "private", versioning: true, versionDays: 30, quotaMb: 20480 },
  { name: "appverse-apk", platform: "appverse", purpose: "Published APK binaries - signed download only", access: "signed-only", versioning: true, versionDays: 30, quotaMb: 15360 },
  { name: "appverse-aab", platform: "appverse", purpose: "AAB bundles - store internal, never public", access: "private", versioning: true, versionDays: 30, quotaMb: 10240 },
  { name: "vortex-websites", platform: "vortex-website", purpose: "Website deployments - private origin, public via manifest", access: "origin", versioning: true, versionDays: 30, quotaMb: 10240 },
  { name: "nexa-ai-data", platform: "cloud-agent", purpose: "NEXA AI builder tenant data", access: "private", versioning: true, versionDays: 30, quotaMb: 8192 },
  { name: "nexseva-documents", platform: "vi", purpose: "VI and document corpus (approval-gated reads)", access: "private", versioning: true, versionDays: 30, quotaMb: 6144 },
  { name: "user-uploads", platform: "shared", purpose: "Cross-platform user uploads under platform:userId prefixes", access: "private", versioning: false, versionDays: 0, quotaMb: 6144 },
  { name: "database-backups", platform: "vortex-server", purpose: "Database backups - DR only, never a live database", access: "private", versioning: false, versionDays: 0, quotaMb: 8192 },
  { name: "infrastructure-backups", platform: "vortex-server", purpose: "Config, manifest and vault snapshots", access: "private", versioning: false, versionDays: 0, quotaMb: 4096 },
];

/** Seed the bucket registry into StorageBucket rows (idempotent). */
export async function ensureBucketRegistry() {
  const volume = await db.storageVolume.findFirst({ orderBy: { createdAt: "asc" } });
  for (const spec of BUCKET_SPECS) {
    const exists = await db.storageBucket.findUnique({ where: { name: spec.name } });
    if (exists) {
      if (!exists.platformId || exists.provider !== bucketProviderDefault()) {
        await db.storageBucket.update({
          where: { id: exists.id },
          data: { platformId: spec.platform === "shared" ? null : spec.platform, purpose: spec.purpose, versioning: spec.versioning, versionDays: spec.versionDays, provider: bucketProviderDefault() },
        });
      }
      continue;
    }
    await db.storageBucket.create({
      data: {
        bucketId: shortId("bkt", 8),
        name: spec.name,
        volumeId: volume?.id,
        storageClass: "HOT",
        replicationFactor: 3,
        quotaMb: spec.quotaMb,
        platformId: spec.platform === "shared" ? null : spec.platform,
        purpose: spec.purpose,
        provider: bucketProviderDefault(),
        versioning: spec.versioning,
        versionDays: spec.versionDays,
        status: "ACTIVE",
        createdBy: "system:vortex-server",
      },
    });
  }
}

// ------------------------------------------------------------
// storage provider resolution — local engine | JOY SERVICES
// ------------------------------------------------------------

export type ProviderInfo = {
  provider: "local" | "joy";
  configured: boolean;
  endpoint: string;
  region: string;
  poolGb: number;
  missing: string[];
};

async function cfg(key: string, fallback: string): Promise<string> {
  const row = await db.appConfig.findUnique({ where: { key } });
  return row?.value || fallback;
}

async function joyCreds() {
  const token = await cfg("joy.api_token", process.env.JOY_API_TOKEN || "");
  const accessKey = await cfg("joy.access_key", process.env.JOY_ACCESS_KEY || "");
  const secretKey = await cfg("joy.secret_key", process.env.JOY_SECRET_KEY || "");
  const endpoint = await cfg("joy.endpoint", "https://s3.joy.services");
  const region = await cfg("joy.region", "default");
  return { token, accessKey, secretKey, endpoint, region };
}

/** Resolve the active storage provider. joy is used ONLY when keys exist. */
export async function resolveProvider(): Promise<ProviderInfo> {
  const wanted = await cfg("storage.provider", "local");
  const poolGb = parseInt(await cfg("storage.pool_gb", "100"), 10);
  if (wanted === "joy") {
    const c = await joyCreds();
    const missing: string[] = [];
    if (!c.token) missing.push("joy.api_token");
    if (!c.accessKey) missing.push("joy.access_key");
    if (!c.secretKey) missing.push("joy.secret_key");
    if (missing.length === 0) {
      return { provider: "joy", configured: true, endpoint: c.endpoint, region: c.region, poolGb, missing: [] };
    }
    return { provider: "local", configured: false, endpoint: c.endpoint, region: c.region, poolGb, missing };
  }
  return { provider: "local", configured: true, endpoint: "local://vortex-storage", region: "dhaka-1", poolGb, missing: [] };
}

function bucketProviderDefault(): string {
  // new registry rows follow the configured default; resolveProvider() is
  // the runtime truth and re-seeding updates these rows when keys arrive
  return process.env.VORTEX_STORAGE_PROVIDER === "joy" ? "joy" : "local";
}

// ------------------------------------------------------------
// JOY SERVICES S3 SigV4 data plane (path-style) + REST v1 control plane
// ------------------------------------------------------------

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function sigv4Headers(creds: { accessKey: string; secretKey: string; region: string }, method: string, url: URL, payload: Buffer, extraHeaders: Record<string, string> = {}) {
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = createHash("sha256").update(payload).digest("hex");
  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...extraHeaders,
  };
  const sortedEntries = Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v.trim()] as const).sort(([a], [b]) => (a < b ? -1 : 1));
  const canonicalHeaders = sortedEntries.map(([k, v]) => `${k}:${v}\n`).join("");
  const signedHeaders = sortedEntries.map(([k]) => k).join(";");
  const canonicalUri = url.pathname;
  const canonicalQuery = [...url.searchParams.entries()].map(([k, v]) => [k, encodeURIComponent(v).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)] as const).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("&");
  const canonicalRequest = [method.toUpperCase(), canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${dateStamp}/${creds.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, createHash("sha256").update(canonicalRequest).digest("hex")].join("\n");
  const kDate = hmac(`AWS4${creds.secretKey}`, dateStamp);
  const kRegion = hmac(kDate, creds.region);
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${creds.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return headers;
}

async function joyS3Fetch(creds: Awaited<ReturnType<typeof joyCreds>>, method: string, bucket: string, key: string, body: Buffer = Buffer.alloc(0), query: Record<string, string> = {}) {
  const url = new URL(`${creds.endpoint}/${bucket}${key ? `/${key.split("/").map(encodeURIComponent).join("/")}` : ""}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const headers = sigv4Headers(creds, method, url, body);
  const res = await fetch(url, { method, headers, body: method === "GET" || method === "HEAD" || method === "DELETE" ? undefined : body });
  return res;
}

/** JoyProvider — real S3 SigV4 data plane ops. */
export const joyData = {
  async put(bucket: string, key: string, body: Buffer) {
    const c = await joyCreds();
    let res = await joyS3Fetch(c, "PUT", bucket, key, body);
    // Joy account buckets are created on demand: NoSuchBucket -> PUT the
    // bucket (SigV4, empty key) and retry the object PUT once. Keeps site
    // deploys, appverse uploads and vault archives working with no manual
    // bucket setup on the Joy console.
    if (res.status === 404) {
      const mk = await joyS3Fetch(c, "PUT", bucket, "");
      if (!mk.ok && mk.status !== 409) throw new Error(`JOY S3 bucket create failed: ${mk.status} ${await mk.text().catch(() => "")}`.slice(0, 300));
      res = await joyS3Fetch(c, "PUT", bucket, key, body);
    }
    if (!res.ok) throw new Error(`JOY S3 PUT failed: ${res.status} ${await res.text().catch(() => "")}`.slice(0, 300));
    return { sizeBytes: body.length, checksum: createHash("sha256").update(body).digest("hex") };
  },
  async get(bucket: string, key: string): Promise<Buffer> {
    const c = await joyCreds();
    const res = await joyS3Fetch(c, "GET", bucket, key);
    if (!res.ok) throw new Error(`JOY S3 GET failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  },
  async remove(bucket: string, key: string) {
    const c = await joyCreds();
    const res = await joyS3Fetch(c, "DELETE", bucket, key);
    if (!res.ok && res.status !== 404) throw new Error(`JOY S3 DELETE failed: ${res.status}`);
  },
  async exists(bucket: string, key: string): Promise<boolean> {
    const c = await joyCreds();
    const res = await joyS3Fetch(c, "HEAD", bucket, key);
    return res.ok;
  },
  /** Presigned GET via SigV4 query string (7-day hard cap is enforced by callers). */
  async presignDownload(bucket: string, key: string, expiresSeconds: number): Promise<string> {
    const c = await joyCreds();
    const capped = Math.min(expiresSeconds, 7 * 24 * 3600);
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);
    const scope = `${dateStamp}/${c.region}/s3/aws4_request`;
    const url = new URL(`${c.endpoint}/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`);
    url.searchParams.set("X-Amz-Algorithm", "AWS4-HMAC-SHA256");
    url.searchParams.set("X-Amz-Credential", `${c.accessKey}/${scope}`);
    url.searchParams.set("X-Amz-Date", amzDate);
    url.searchParams.set("X-Amz-Expires", String(capped));
    url.searchParams.set("X-Amz-SignedHeaders", "host");
    const canonicalRequest = ["GET", url.pathname, [...url.searchParams.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${encodeURIComponent(v).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)}`).join("&"), `host:${url.host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, createHash("sha256").update(canonicalRequest).digest("hex")].join("\n");
    const kDate = hmac(`AWS4${c.secretKey}`, dateStamp);
    const signature = createHmac("sha256", hmac(hmac(hmac(kDate, c.region), "s3"), "aws4_request")).update(stringToSign).digest("hex");
    url.searchParams.set("X-Amz-Signature", signature);
    return url.toString();
  },
};

/** Joy REST v1 control plane (joy_ bearer token, scopes read/storage). */
export const joyControl = {
  base: "https://joy.services/api/v1",
  async request(method: string, path: string, body?: Record<string, unknown>) {
    const c = await joyCreds();
    if (!c.token) return { ok: false as const, error: "JOY REST token not configured (joy.api_token)" };
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok && (json as { ok?: boolean }).ok !== false, status: res.status, json };
  },
  account() {
    return this.request("GET", "/storage");
  },
  usage() {
    return this.request("GET", "/storage/usage");
  },
  async createBucket(name: string) {
    return this.request("POST", "/storage/buckets", { name });
  },
  async bucketSettings(bucket: string) {
    return this.request("GET", `/storage/buckets/${bucket}/settings`);
  },
  async putVersioning(bucket: string, enabled: boolean) {
    return this.request("PUT", `/storage/buckets/${bucket}/settings/versioning`, { enabled });
  },
};

// ------------------------------------------------------------
// unified object ops — isolation-checked, provider-routed, audited
// ------------------------------------------------------------

export type VsActor = { platform: PlatformId | "shared"; subject: string; via: string };

export type PutResult = { fileId: string; bucket: string; objectKey: string; sizeBytes: number; checksum: string; mime: string; provider: string };

async function checkBucketAccess(bucketName: string, actor: VsActor, op: "read" | "write") {
  const bucket = await db.storageBucket.findUnique({ where: { name: bucketName } });
  if (!bucket || bucket.status !== "ACTIVE") return { error: `Bucket "${bucketName}" is not available` };
  if (bucket.platformId && bucket.platformId !== actor.platform) {
    await writeAudit({ actor: actor.via, action: "VS_STORAGE_DENIED", resource: `bucket:${bucketName}`, detail: `platform ${actor.platform} denied ${op} (owner ${bucket.platformId})` });
    return { error: `Bucket "${bucketName}" belongs to platform ${bucket.platformId} — access denied for ${actor.platform}` };
  }
  return { bucket };
}

export async function vsPutObject(bucketName: string, objectKey: string, data: Buffer, actor: VsActor, opts?: { mime?: string }): Promise<PutResult | { error: string }> {
  const access = await checkBucketAccess(bucketName, actor, "write");
  if ("error" in access) return access;
  const clean = sanitizeObjectPath(objectKey);
  if (!clean) return { error: "Invalid object key" };
  const provider = await resolveProvider();
  let sizeBytes: number, checksum: string;
  if (provider.provider === "joy") {
    try {
      const put = await joyData.put(bucketName, clean, data);
      sizeBytes = put.sizeBytes;
      checksum = put.checksum;
    } catch (e) {
      return { error: e instanceof Error ? e.message : "JOY upload failed" };
    }
  } else {
    const volume = await db.storageVolume.findFirst({ orderBy: { createdAt: "asc" } });
    if (!volume) return { error: "No storage volume — run VORTEX seed" };
    const stored = writeObject(volume.name, bucketName, clean, data);
    sizeBytes = stored.sizeBytes;
    checksum = stored.checksum;
  }
  const prev = await db.fileObject.findFirst({ where: { bucket: { name: bucketName }, path: clean } });
  const file = await db.fileObject.upsert({
    where: { fileId: prev?.fileId || shortId("fil", 8) },
    update: { sizeBytes, checksum, mime: opts?.mime || mimeFromPath(clean), status: "ACTIVE" },
    create: {
      fileId: shortId("fil", 8),
      bucketId: access.bucket.id,
      path: clean,
      name: clean.split("/").pop() || clean,
      mime: opts?.mime || mimeFromPath(clean),
      sizeBytes,
      checksum,
      version: (prev?.version || 0) + 1,
      status: "ACTIVE",
      uploadedBy: actor.via,
    },
  });
  await db.storageBucket.update({ where: { id: access.bucket.id }, data: { objectCount: { increment: prev ? 0 : 1 }, usedMb: { increment: Math.ceil(sizeBytes / 1024 / 1024) } } });
  await writeAudit({ actor: actor.via, action: "VS_OBJECT_PUT", resource: `${bucketName}/${clean}`, detail: `${sizeBytes}B sha256=${checksum.slice(0, 12)} provider=${provider.provider}` });
  return { fileId: file.fileId, bucket: bucketName, objectKey: clean, sizeBytes, checksum, mime: file.mime, provider: provider.provider };
}

export async function vsGetObject(bucketName: string, objectKey: string, actor: VsActor): Promise<Buffer | { error: string }> {
  const access = await checkBucketAccess(bucketName, actor, "read");
  if ("error" in access) return access;
  const provider = await resolveProvider();
  if (provider.provider === "joy") {
    try {
      return await joyData.get(bucketName, objectKey);
    } catch (e) {
      return { error: e instanceof Error ? e.message : "JOY download failed" };
    }
  }
  const volume = await db.storageVolume.findFirst({ orderBy: { createdAt: "asc" } });
  if (!volume) return { error: "No storage volume" };
  if (!objectExists(volume.name, bucketName, objectKey)) return { error: "Object not found" };
  return readObject(volume.name, bucketName, objectKey);
}

export async function vsObjectExists(bucketName: string, objectKey: string, actor: VsActor): Promise<boolean | { error: string }> {
  const access = await checkBucketAccess(bucketName, actor, "read");
  if ("error" in access) return access;
  const provider = await resolveProvider();
  if (provider.provider === "joy") return joyData.exists(bucketName, objectKey);
  const volume = await db.storageVolume.findFirst({ orderBy: { createdAt: "asc" } });
  if (!volume) return { error: "No storage volume" };
  return objectExists(volume.name, bucketName, objectKey);
}

// ------------------------------------------------------------
// signed URLs — HMAC (local) / SigV4 presign (joy); audited in SignedAccess
// ------------------------------------------------------------

function signSecret(): string {
  return process.env.VORTEX_SIGN_SECRET || "vortex-sign-secret-do-not-use-in-prod";
}

export async function issueSignedDownload(bucketName: string, objectKey: string, actor: VsActor, ttlSeconds = 24 * 3600) {
  const check = await vsObjectExists(bucketName, objectKey, actor);
  if (check === false) return { error: "Object not found" };
  if (typeof check === "object" && check && "error" in check) return check as { error: string };
  const ttl = Math.min(Math.max(ttlSeconds, 60), 7 * 24 * 3600); // hard cap 7 days (JOY limit)
  const exp = Date.now() + ttl * 1000;
  // the issuing platform is bound into the HMAC so redemption reads through
  // the issuer's isolation context — the signature alone cannot cross buckets
  const token = createHmac("sha256", signSecret()).update(`${bucketName}/${objectKey}/${exp}/${actor.platform}`).digest("hex");
  const url = `/api/v1/admin/storage/object?bucket=${encodeURIComponent(bucketName)}&key=${encodeURIComponent(objectKey)}&exp=${exp}&platform=${encodeURIComponent(actor.platform)}&sig=${token}`;
  await db.signedAccess.create({ data: { tokenId: shortId("sat", 8), kind: "download", bucket: bucketName, objectKey, platformRef: actor.platform, subjectRef: actor.subject, expiresAt: new Date(exp) } });
  const provider = await resolveProvider();
  if (provider.provider === "joy") {
    try {
      const presigned = await joyData.presignDownload(bucketName, objectKey, ttl);
      return { url: presigned, expiresAt: new Date(exp).toISOString(), provider: "joy", direct: true };
    } catch {
      // fall back to proxied signed URL
    }
  }
  return { url, expiresAt: new Date(exp).toISOString(), provider: provider.provider, direct: false };
}

export function verifySignedDownload(bucket: string, key: string, exp: number, sig: string, platform: string): boolean {
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  if (!platform || !/^[a-z-]+$/.test(platform)) return false;
  const expected = createHmac("sha256", signSecret()).update(`${bucket}/${key}/${exp}/${platform}`).digest("hex");
  return sig === expected;
}

// ------------------------------------------------------------
// quota monitor — 100 GB shared pool, 80% alert
// ------------------------------------------------------------

export async function poolUsage() {
  const provider = await resolveProvider();
  const agg = await db.storageBucket.aggregate({ _sum: { usedMb: true, quotaMb: true } });
  const usedMb = agg._sum.usedMb || 0;
  const poolMb = provider.poolGb * 1024;
  const pct = Math.min(100, Math.round((usedMb / Math.max(poolMb, 1)) * 1000) / 10);
  return { provider: provider.provider, configured: provider.configured, missing: provider.missing, endpoint: provider.endpoint, usedMb, poolMb, pct };
}

/** Raises an AlertEvent once per crossing of the 80% threshold. */
export async function checkStorageAlert() {
  const u = await poolUsage();
  if (u.pct >= 80) {
    const recent = await db.alertEvent.findFirst({
      where: { source: "SYSTEM", type: "SYSTEM", message: { contains: "storage pool at" }, createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } },
    });
    if (!recent) {
      await db.alertEvent.create({
        data: {
          source: "SYSTEM",
          type: "SYSTEM",
          severity: "WARNING",
          message: `VORTEX storage pool at ${u.pct}% of ${Math.round(u.poolMb / 1024)} GB - plan capacity or clean up buckets`,
        },
      });
      await writeAudit({ actor: "system:monitor", action: "VS_STORAGE_80PCT_ALERT", resource: "storage-pool", detail: `${u.pct}% used` });
    }
  }
  return u;
}

// ------------------------------------------------------------
// platform keys — issue / authenticate / scope-check
// ------------------------------------------------------------

export const SCOPE_CATALOG: Record<string, string[]> = {
  "vortex-server": ["admin.read", "admin.write", "storage.read", "storage.write", "platforms.manage"],
  "cloud-agent": ["projects.read", "projects.write", "builds.write", "storage.read", "storage.write"],
  "vortex-website": ["sites.read", "sites.write", "deploy.write", "storage.read", "storage.write"],
  appverse: ["apps.read", "apps.write", "review.write", "storage.read", "storage.write"],
  vi: ["tasks.read", "tasks.write", "monitor.read", "storage.read"],
};

export type IssuedKey = { keyId: string; raw: string; platform: string; scopes: string[] };

export async function issuePlatformKey(platformId: string, name: string, actor: string, kind: "master" | "platform" = "platform"): Promise<IssuedKey | { error: string }> {
  if (kind === "master" && platformId !== "vortex-server") return { error: "Master key belongs to vortex-server only" };
  const platform = await db.platform.findUnique({ where: { platformId } });
  if (!platform) return { error: `Unknown platform "${platformId}"` };
  const raw = `pk_live_${generateToken(24)}`;
  const scopes = kind === "master" ? ["*"] : SCOPE_CATALOG[platformId] || [];
  const key = await db.platformKey.create({
    data: { keyId: shortId("pk", 8), keyHash: sha256(raw), platformDb: platformId, name, kind, scopes: scopes.join(","), status: "ACTIVE" },
  });
  await writeAudit({ actor, action: kind === "master" ? "VS_MASTER_KEY_ISSUED" : "VS_PLATFORM_KEY_ISSUED", resource: key.keyId, detail: `${platformId} scopes=${scopes.join("|")}` });
  return { keyId: key.keyId, raw, platform: platformId, scopes };
}

export type PlatformAuth = { ok: true; keyId: string; platform: PlatformId | "vortex-server"; kind: string; scopes: string[] } | { ok: false; error: string };

export async function platformFromRequest(req: Request): Promise<PlatformAuth> {
  const header = req.headers.get("authorization") || "";
  const raw = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!raw) return { ok: false, error: "Authorization: Bearer pk_live_... required" };
  const key = await db.platformKey.findUnique({ where: { keyHash: sha256(raw) } });
  if (!key || key.status !== "ACTIVE") return { ok: false, error: "Invalid or revoked platform key" };
  if (key.expiresAt && key.expiresAt.getTime() < Date.now()) return { ok: false, error: "Platform key expired" };
  await db.platformKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
  return { ok: true, keyId: key.keyId, platform: (key.platformDb || "vortex-server") as PlatformId, kind: key.kind, scopes: key.scopes.split(",").filter(Boolean) };
}

export function scopeOk(auth: Extract<PlatformAuth, { ok: true }>, needed: string): boolean {
  if (auth.scopes.includes("*")) return true;
  return auth.scopes.includes(needed);
}

// ------------------------------------------------------------
// INR subscription plans for CLOUD AGENT
// ------------------------------------------------------------

export const CLOUD_AGENT_PLANS = [
  { code: "CA_STARTER", name: "Cloud Agent Starter", priceInr: 1999 },
  { code: "CA_BUILDER", name: "Cloud Agent Builder", priceInr: 2999 },
  { code: "CA_STUDIO", name: "Cloud Agent Studio", priceInr: 3999 },
  { code: "CA_PRO", name: "Cloud Agent Pro", priceInr: 4999 },
  { code: "CA_MAX", name: "Cloud Agent Max", priceInr: 6999 },
];

export async function ensureCloudAgentPlans() {
  for (const p of CLOUD_AGENT_PLANS) {
    await db.billingPlan.upsert({
      where: { code: p.code },
      update: { name: p.name, monthlyBaseBdt: p.priceInr, currency: "INR", isActive: true },
      create: {
        planId: shortId("plan", 8),
        code: p.code,
        name: p.name,
        audience: "EXTERNAL_RESERVED",
        monthlyBaseBdt: p.priceInr,
        currency: "INR",
        isActive: true,
        isSystem: true,
        note: `CLOUD AGENT subscription - INR ${p.priceInr}/month`,
      },
    });
  }
}
