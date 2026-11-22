import { db } from "@/lib/db";
import { ok, fail, requireSession } from "@/lib/vortex/api";
import { writeAudit } from "@/lib/vortex/audit";
import { ensureSeeded } from "@/lib/vortex/seed";
import { createSnapshot, runDuePolicies } from "@/lib/vortex/backup";
import { sendSystemMail } from "@/lib/vortex/notify";

export async function GET(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;

  // Scheduled runs: any due policy fires while the dashboard is open
  await runDuePolicies();

  const [snapshots, completed, policyCount] = await Promise.all([
    db.backupSnapshot.findMany({ orderBy: { createdAt: "desc" }, take: 200 }),
    db.backupSnapshot.findMany({ where: { status: "COMPLETED" }, select: { sizeMb: true, createdAt: true } }),
    db.backupPolicy.count(),
  ]);

  const last = completed.reduce<Date | null>(
    (acc, s) => (!acc || s.createdAt > acc ? s.createdAt : acc),
    null
  );

  return ok({
    snapshots,
    stats: {
      total: snapshots.length,
      completed: completed.length,
      sizeMb: completed.reduce((a, s) => a + s.sizeMb, 0),
      lastBackupAt: last,
      policyCount,
    },
  });
}

/** Manual snapshot of a DATABASE (by dbId) or SERVER (by nodeId). */
export async function POST(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  let body: { targetType?: string; targetId?: string };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body");
  }
  const targetType = body.targetType === "SERVER" ? "SERVER" : "DATABASE";
  if (!body.targetId) return fail("targetId is required");

  let label = "";
  let alive = false;
  if (targetType === "DATABASE") {
    const inst = await db.databaseInstance.findUnique({ where: { dbId: body.targetId } });
    if (!inst) return fail("Database not found", 404);
    if (inst.status === "DESTROYED") return fail("Cannot back up a destroyed database");
    label = inst.name;
    alive = inst.status === "RUNNING";
  } else {
    const node = await db.serverNode.findUnique({ where: { nodeId: body.targetId } });
    if (!node) return fail("Node not found", 404);
    if (node.status === "DESTROYED") return fail("Cannot back up a destroyed node");
    label = node.name;
    alive = node.status === "RUNNING";
  }
  if (!alive) return fail(`Target is not RUNNING — snapshot refused (got a dead target: ${label})`);

  const snap = await createSnapshot({
    policyId: null,
    trigger: "MANUAL",
    targetType,
    targetId: body.targetId,
    targetLabel: label,
  });

  await writeAudit({
    actor: user.email,
    action: "BACKUP_SNAPSHOT_CREATED",
    resource: `backup:${snap.backupId}`,
    detail: `Manual snapshot of ${targetType} ${label} — ${(snap.sizeMb / 1024).toFixed(2)} GB`,
    userId: user.id,
  });

  return ok({ snapshot: snap }, 201);
}

/** One-click restore (simulated: control plane never touches app data directly). */
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
  if (!body.id) return fail("id is required");

  const snap = await db.backupSnapshot.findUnique({ where: { backupId: body.id } });
  if (!snap) return fail("Snapshot not found", 404);
  if (snap.status !== "COMPLETED") return fail(`Only COMPLETED snapshots can be restored (this one is ${snap.status})`);

  const updated = await db.backupSnapshot.update({
    where: { id: snap.id },
    data: { restoredAt: new Date() },
  });

  await writeAudit({
    actor: user.email,
    action: "BACKUP_RESTORED",
    resource: `backup:${snap.backupId}`,
    detail: `Restore of ${snap.targetType} ${snap.targetLabel} from ${snap.backupId} (${(snap.sizeMb / 1024).toFixed(2)} GB, ${snap.cipher})`,
    userId: user.id,
  });

  await sendSystemMail({
    subject: "VORTEX BACKUP — restore completed",
    body: `Snapshot ${snap.backupId} of ${snap.targetType} ${snap.targetLabel} was restored successfully.\nEncrypted archive: ${(snap.sizeMb / 1024).toFixed(2)} GB (${snap.cipher}).\nTriggered by: ${user.email}`,
    category: "system",
  });

  return ok({ snapshot: updated });
}

/** Delete an EXPIRED (or FAILED) snapshot from the vault. */
export async function DELETE(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return fail("id query param is required");
  const snap = await db.backupSnapshot.findUnique({ where: { backupId: id } });
  if (!snap) return fail("Snapshot not found", 404);
  if (!["EXPIRED", "FAILED"].includes(snap.status)) {
    return fail(`Only EXPIRED/FAILED snapshots can be deleted (this one is ${snap.status})`);
  }

  await db.backupSnapshot.delete({ where: { id: snap.id } });
  await writeAudit({
    actor: user.email,
    action: "BACKUP_SNAPSHOT_DELETED",
    resource: `backup:${snap.backupId}`,
    detail: `${snap.backupId} (${snap.status}) removed from vault`,
    userId: user.id,
  });
  return ok({ deleted: true });
}
