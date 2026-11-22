import { db } from "@/lib/db";
import { ok, fail, requireSession } from "@/lib/vortex/api";
import { writeAudit } from "@/lib/vortex/audit";
import { ensureSeeded } from "@/lib/vortex/seed";
import { bucketNameValid, ensureBucketDir, removeBucketDir } from "@/lib/vortex/storage";
import { shortId } from "@/lib/vortex/crypto";

const STORAGE_CLASSES = ["HOT", "WARM", "COLD"];

/** Sum of bucket usage per volume + platform-wide stats for the dashboard. */
export async function GET(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;

  const [buckets, volumes, fileAgg] = await Promise.all([
    db.storageBucket.findMany({
      orderBy: { createdAt: "asc" },
      include: {
        app: { select: { name: true, appId: true } },
        volume: { select: { name: true, volumeId: true, status: true } },
      },
    }),
    db.storageVolume.findMany({ orderBy: { name: "asc" }, include: { node: { select: { name: true } } } }),
    db.fileObject.aggregate({ where: { status: { in: ["ACTIVE", "ARCHIVED"] } }, _count: true, _sum: { sizeBytes: true } }),
  ]);

  const usedByVolume = new Map<string, number>();
  for (const b of buckets) {
    if (!b.volumeId) continue;
    usedByVolume.set(b.volumeId, (usedByVolume.get(b.volumeId) || 0) + b.usedMb);
  }

  const volumesOut = volumes.map((v) => ({
    ...v,
    usedMb: usedByVolume.get(v.id) || 0,
    bucketCount: buckets.filter((b) => b.volumeId === v.id).length,
  }));

  return ok({
    buckets,
    volumes: volumesOut,
    stats: {
      buckets: buckets.length,
      objects: fileAgg._count,
      usedMb: buckets.reduce((a, b) => a + b.usedMb, 0),
      quotaMb: buckets.reduce((a, b) => a + b.quotaMb, 0),
      replication: 3,
    },
  });
}

/** Create a bucket. Data gravity: appId is REQUIRED. */
export async function POST(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  let body: { name?: string; appId?: string; quotaMb?: number; storageClass?: string };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body");
  }

  const name = (body.name || "").trim().toLowerCase();
  if (!bucketNameValid(name)) return fail("Bucket name must be 3-31 chars: lowercase letters, digits, dashes");
  const exists = await db.storageBucket.findUnique({ where: { name } });
  if (exists) return fail("A bucket with this name already exists", 409);

  if (!body.appId) return fail("appId is required — every VORTEX bucket belongs to an app (data gravity)");
  const app = await db.app.findUnique({ where: { id: body.appId } });
  if (!app) return fail("App not found", 404);

  const quotaMb = Math.min(51_200, Math.max(64, Math.round(body.quotaMb || 1024)));
  const storageClass = STORAGE_CLASSES.includes(body.storageClass || "HOT") ? body.storageClass! : "HOT";

  // Land the bucket on the READ_WRITE volume with the most free headroom
  const volumes = await db.storageVolume.findMany({ where: { status: "READ_WRITE" }, include: { buckets: { select: { usedMb: true } } } });
  if (volumes.length === 0) return fail("No READ_WRITE volume available — check the STORAGE volumes", 503);
  volumes.sort((a, b) => a.buckets.reduce((x, y) => x + y.usedMb, 0) - b.buckets.reduce((x, y) => x + y.usedMb, 0));
  const volume = volumes[0];

  const bucket = await db.storageBucket.create({
    data: {
      bucketId: shortId("bkt", 8),
      name,
      appId: app.id,
      volumeId: volume.id,
      storageClass,
      replicationFactor: 3,
      quotaMb,
      status: "ACTIVE",
      createdBy: user.email,
    },
  });
  ensureBucketDir(volume.name, name);

  await writeAudit({
    actor: user.email,
    action: "STORAGE_BUCKET_CREATED",
    resource: `bucket:${bucket.bucketId}`,
    detail: `${name} → ${volume.name} · ${quotaMb} MB quota · ${storageClass} · 3x replication · app=${app.appId}`,
    userId: user.id,
  });

  return ok({ bucket }, 201);
}

export async function PATCH(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  let body: { id?: string; kind?: string; value?: string | number };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body");
  }
  if (!body.id || !body.kind) return fail("id and kind are required");

  // Volume status toggle
  if (body.kind === "VOLUME_STATUS") {
    const volume = await db.storageVolume.findUnique({ where: { id: String(body.id) } });
    if (!volume) return fail("Volume not found", 404);
    const status = String(body.value);
    if (!["READ_WRITE", "READ_ONLY", "OFFLINE"].includes(status)) {
      return fail("Volume status must be READ_WRITE, READ_ONLY or OFFLINE");
    }
    if (status === "OFFLINE") {
      const count = await db.storageBucket.count({ where: { volumeId: volume.id } });
      if (count > 0) return fail(`Volume still hosts ${count} bucket(s) — move or empty them first`, 409);
    }
    const updated = await db.storageVolume.update({ where: { id: volume.id }, data: { status } });
    await writeAudit({
      actor: user.email,
      action: "STORAGE_VOLUME_STATUS",
      resource: `volume:${volume.volumeId}`,
      detail: `${volume.name} → ${status}`,
      userId: user.id,
    });
    return ok({ volume: updated });
  }

  // Bucket mutations
  const bucket = await db.storageBucket.findUnique({ where: { id: String(body.id) } });
  if (!bucket) return fail("Bucket not found", 404);

  const data: Record<string, unknown> = {};
  let action = "";
  switch (body.kind) {
    case "QUOTA": {
      const quotaMb = Math.min(51_200, Math.max(64, Math.round(Number(body.value) || 1024)));
      if (quotaMb < bucket.usedMb) return fail(`Quota ${quotaMb} MB is below current usage (${bucket.usedMb} MB)`);
      data.quotaMb = quotaMb;
      action = `quota → ${quotaMb} MB`;
      break;
    }
    case "CLASS": {
      if (!STORAGE_CLASSES.includes(String(body.value))) return fail(`storageClass must be ${STORAGE_CLASSES.join(", ")}`);
      data.storageClass = body.value;
      action = `class → ${body.value}`;
      break;
    }
    case "REPLICATION": {
      const rf = Math.min(5, Math.max(1, Math.round(Number(body.value) || 3)));
      data.replicationFactor = rf;
      action = `replication → ${rf}x`;
      break;
    }
    case "STATUS": {
      if (!["ACTIVE", "READ_ONLY", "DISABLED"].includes(String(body.value))) {
        return fail("Bucket status must be ACTIVE, READ_ONLY or DISABLED");
      }
      data.status = body.value;
      action = `status → ${body.value}`;
      break;
    }
    default:
      return fail("kind must be QUOTA, CLASS, REPLICATION, STATUS or VOLUME_STATUS");
  }

  const updated = await db.storageBucket.update({ where: { id: bucket.id }, data });
  await writeAudit({
    actor: user.email,
    action: "STORAGE_BUCKET_UPDATED",
    resource: `bucket:${bucket.bucketId}`,
    detail: `${bucket.name}: ${action}`,
    userId: user.id,
  });
  return ok({ bucket: updated });
}

/** Delete an EMPTY bucket (purge trashed objects first). */
export async function DELETE(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return fail("id query param is required");
  const bucket = await db.storageBucket.findUnique({ where: { id }, include: { volume: true } });
  if (!bucket) return fail("Bucket not found", 404);

  const rows = await db.fileObject.count({ where: { bucketId: bucket.id } });
  if (rows > 0) return fail(`Bucket still contains ${rows} object record(s) — empty the trash (purge) first`, 409);

  if (bucket.volume) removeBucketDir(bucket.volume.name, bucket.name);
  await db.storageBucket.delete({ where: { id: bucket.id } });

  await writeAudit({
    actor: user.email,
    action: "STORAGE_BUCKET_DELETED",
    resource: `bucket:${bucket.bucketId}`,
    detail: `${bucket.name} removed (was empty, ${bucket.quotaMb} MB quota released)`,
    userId: user.id,
  });
  return ok({ deleted: true });
}
