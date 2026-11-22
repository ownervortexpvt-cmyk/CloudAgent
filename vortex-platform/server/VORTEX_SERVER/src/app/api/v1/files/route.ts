import { db } from "@/lib/db";
import { ok, fail, requireSession } from "@/lib/vortex/api";
import { writeAudit } from "@/lib/vortex/audit";
import { ensureSeeded } from "@/lib/vortex/seed";
import { shortId } from "@/lib/vortex/crypto";
import {
  sanitizeObjectPath,
  mimeFromPath,
  writeObject,
  removeObject,
  objectExists,
} from "@/lib/vortex/storage";

const MB = 1_000_000;

/** Bucket usage is always recomputed from the FileObject rows — no drift. */
async function recalcBucket(bucketId: string) {
  const agg = await db.fileObject.aggregate({
    where: { bucketId, status: { in: ["ACTIVE", "ARCHIVED"] } },
    _count: true,
    _sum: { sizeBytes: true },
  });
  await db.storageBucket.update({
    where: { id: bucketId },
    data: {
      objectCount: agg._count,
      usedMb: Math.max(0, Math.ceil((agg._sum.sizeBytes || 0) / MB)),
    },
  });
}

export async function GET(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;

  const url = new URL(req.url);
  const bucketId = url.searchParams.get("bucketId");
  const [buckets, files] = await Promise.all([
    db.storageBucket.findMany({
      orderBy: { createdAt: "asc" },
      include: { app: { select: { name: true, appId: true } } },
    }),
    db.fileObject.findMany({
      where: bucketId ? { bucketId } : undefined,
      orderBy: { updatedAt: "desc" },
      take: 500,
      include: { bucket: { select: { name: true, bucketId: true } } },
    }),
  ]);

  const active = files.filter((f) => f.status !== "DELETED");
  return ok({
    buckets,
    files,
    stats: {
      files: files.length,
      activeBytes: active.reduce((a, f) => a + f.sizeBytes, 0),
      trashed: files.filter((f) => f.status === "DELETED").length,
    },
  });
}

/**
 * Upload an object (base64 body from the dashboard file picker).
 * Real bytes hit the volume; checksum + size are computed from the actual
 * buffer; overwrites bump the version counter; quota is enforced.
 */
export async function POST(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  let body: { bucketId?: string; path?: string; contentBase64?: string };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body");
  }
  if (!body.bucketId || !body.contentBase64) return fail("bucketId and contentBase64 are required");

  const bucket = await db.storageBucket.findUnique({ where: { id: body.bucketId }, include: { volume: true } });
  if (!bucket) return fail("Bucket not found", 404);
  if (bucket.status !== "ACTIVE") return fail(`Bucket is ${bucket.status.toLowerCase()} — set it ACTIVE before uploading`, 409);
  if (!bucket.volume || bucket.volume.status !== "READ_WRITE") {
    return fail("Host volume is not READ_WRITE — uploads refused", 503);
  }

  const objectPath = sanitizeObjectPath(body.path || "");
  if (!objectPath) return fail("Invalid object path (no '..', empty segments only, max 400 chars)");

  const buf = Buffer.from(body.contentBase64, "base64");
  if (buf.length === 0) return fail("Empty upload — 0 bytes");

  const maxCfg = await db.appConfig.findUnique({ where: { key: "files.max_upload_mb" } });
  const maxMb = parseInt(maxCfg?.value || "5", 10) || 5;
  if (buf.length > maxMb * MB) return fail(`Upload exceeds the ${maxMb} MB control-plane limit`, 413);

  const incMb = Math.ceil(buf.length / MB);
  if (bucket.usedMb + incMb > bucket.quotaMb) {
    return fail(`Bucket quota exceeded: ${bucket.usedMb} + ${incMb} MB > ${bucket.quotaMb} MB quota`, 413);
  }

  const stored = writeObject(bucket.volume.name, bucket.name, objectPath, buf);
  const mime = mimeFromPath(objectPath);
  const name = objectPath.split("/").pop() || objectPath;

  const existing = await db.fileObject.findUnique({
    where: { bucketId_path: { bucketId: bucket.id, path: objectPath } },
  });

  const file = await db.fileObject.upsert({
    where: { bucketId_path: { bucketId: bucket.id, path: objectPath } },
    update: {
      sizeBytes: stored.sizeBytes,
      checksum: stored.checksum,
      mime,
      version: { increment: 1 },
      status: "ACTIVE",
      uploadedBy: user.email,
    },
    create: {
      fileId: shortId("fil", 8),
      bucketId: bucket.id,
      appId: bucket.appId,
      path: objectPath,
      name,
      mime,
      sizeBytes: stored.sizeBytes,
      checksum: stored.checksum,
      version: existing ? existing.version + 1 : 1,
      status: "ACTIVE",
      uploadedBy: user.email,
    },
  });

  await recalcBucket(bucket.id);

  await writeAudit({
    actor: user.email,
    action: existing ? "FILE_OVERWRITTEN" : "FILE_UPLOADED",
    resource: `file:${file.fileId}`,
    detail: `${bucket.name}/${objectPath} — ${(stored.sizeBytes / 1024).toFixed(1)} KB · v${file.version} · sha256:${stored.checksum.slice(0, 12)}…`,
    userId: user.id,
  });

  return ok({ file, overwritten: !!existing }, 201);
}

/** ARCHIVE / RESTORE (soft ops only — bytes stay on the volume). */
export async function PATCH(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  let body: { id?: string; action?: string };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body");
  }
  if (!body.id || !body.action) return fail("id and action are required");

  const file = await db.fileObject.findUnique({ where: { id: body.id } });
  if (!file) return fail("File not found", 404);

  if (body.action === "ARCHIVE" && file.status === "ACTIVE") {
    const updated = await db.fileObject.update({ where: { id: file.id }, data: { status: "ARCHIVED" } });
    await recalcBucket(file.bucketId);
    await writeAudit({ actor: user.email, action: "FILE_ARCHIVED", resource: `file:${file.fileId}`, detail: `${file.path} archived`, userId: user.id });
    return ok({ file: updated });
  }
  if (body.action === "RESTORE" && ["ARCHIVED", "DELETED"].includes(file.status)) {
    const updated = await db.fileObject.update({ where: { id: file.id }, data: { status: "ACTIVE" } });
    await recalcBucket(file.bucketId);
    await writeAudit({ actor: user.email, action: "FILE_RESTORED", resource: `file:${file.fileId}`, detail: `${file.path} back to ACTIVE`, userId: user.id });
    return ok({ file: updated });
  }
  return fail(`Cannot ${body.action?.toLowerCase()} a ${file.status} object`);
}

/** Trash (soft) or purge (hard, frees the volume). */
export async function DELETE(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const purge = url.searchParams.get("purge") === "true";
  if (!id) return fail("id query param is required");

  const file = await db.fileObject.findUnique({ where: { id }, include: { bucket: { include: { volume: true } } } });
  if (!file) return fail("File not found", 404);

  if (!purge) {
    if (file.status === "DELETED") return fail("Already in the trash");
    await db.fileObject.update({ where: { id: file.id }, data: { status: "DELETED" } });
    await recalcBucket(file.bucketId);
    await writeAudit({
      actor: user.email,
      action: "FILE_TRASHED",
      resource: `file:${file.fileId}`,
      detail: `${file.bucket.name}/${file.path} moved to trash (bytes kept until purge)`,
      userId: user.id,
    });
    return ok({ trashed: true });
  }

  if (file.status !== "DELETED") return fail("Only trashed objects can be purged");
  if (file.bucket.volume && objectExists(file.bucket.volume.name, file.bucket.name, file.path)) {
    removeObject(file.bucket.volume.name, file.bucket.name, file.path);
  }
  await db.fileObject.delete({ where: { id: file.id } });
  await recalcBucket(file.bucketId);
  await writeAudit({
    actor: user.email,
    action: "FILE_PURGED",
    resource: `file:${file.fileId}`,
    detail: `${file.bucket.name}/${file.path} purged — bytes removed from ${file.bucket.volume?.name || "volume"}`,
    userId: user.id,
  });
  return ok({ purged: true });
}
