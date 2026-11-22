import { db } from "@/lib/db";
import { ok, fail, requireSession } from "@/lib/vortex/api";
import { writeAudit } from "@/lib/vortex/audit";
import { ensureSeeded } from "@/lib/vortex/seed";
import { SCHEDULES, nextRunFor, createSnapshot, pruneRetention } from "@/lib/vortex/backup";
import { shortId } from "@/lib/vortex/crypto";

export async function GET(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;

  const policies = await db.backupPolicy.findMany({ orderBy: { createdAt: "desc" } });
  return ok({ policies });
}

/** Create a backup policy for an existing DATABASE or SERVER target. */
export async function POST(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  let body: {
    name?: string;
    targetType?: string;
    targetId?: string;
    schedule?: string;
    retentionCount?: number;
  };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body");
  }

  const name = (body.name || "").trim();
  if (name.length < 3 || name.length > 60) return fail("Policy name must be 3-60 chars");

  const targetType = body.targetType === "SERVER" ? "SERVER" : "DATABASE";
  const schedule = body.schedule || "DAILY";
  if (!SCHEDULES[schedule]) return fail(`Invalid schedule. Allowed: ${Object.keys(SCHEDULES).join(", ")}`);
  const retentionCount = Math.round(body.retentionCount || 7);
  if (retentionCount < 1 || retentionCount > 100) return fail("retentionCount must be 1-100");
  if (!body.targetId) return fail("targetId is required");

  let label = "";
  if (targetType === "DATABASE") {
    const inst = await db.databaseInstance.findUnique({ where: { dbId: body.targetId } });
    if (!inst || inst.status === "DESTROYED") return fail("Target database not found", 404);
    label = inst.name;
  } else {
    const node = await db.serverNode.findUnique({ where: { nodeId: body.targetId } });
    if (!node || node.status === "DESTROYED") return fail("Target node not found", 404);
    label = node.name;
  }

  const dup = await db.backupPolicy.findFirst({
    where: { targetType, targetId: body.targetId, schedule, enabled: true },
  });
  if (dup) return fail(`An enabled ${schedule} policy already covers ${label}`, 409);

  const policy = await db.backupPolicy.create({
    data: {
      policyId: shortId("pol", 8),
      name,
      targetType,
      targetId: body.targetId,
      targetLabel: label,
      schedule,
      retentionCount,
      enabled: true,
      nextRunAt: nextRunFor(schedule),
    },
  });

  await writeAudit({
    actor: user.email,
    action: "BACKUP_POLICY_CREATED",
    resource: `policy:${policy.policyId}`,
    detail: `${name}: ${schedule}, keep ${retentionCount}, target ${targetType} ${label}`,
    userId: user.id,
  });

  return ok({ policy }, 201);
}

/** Update policy / run it now. */
export async function PATCH(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  let body: {
    id?: string;
    action?: string; // RUN
    enabled?: boolean;
    schedule?: string;
    retentionCount?: number;
  };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body");
  }
  if (!body.id) return fail("id is required");

  const policy = await db.backupPolicy.findUnique({ where: { policyId: body.id } });
  if (!policy) return fail("Policy not found", 404);

  if (body.action === "RUN") {
    const snap = await createSnapshot({
      policyId: policy.policyId,
      trigger: "POLICY",
      targetType: policy.targetType as "DATABASE" | "SERVER",
      targetId: policy.targetId,
      targetLabel: policy.targetLabel,
    });
    const now = new Date();
    const updated = await db.backupPolicy.update({
      where: { id: policy.id },
      data: { lastRunAt: now, nextRunAt: nextRunFor(policy.schedule, now), runCount: { increment: 1 } },
    });
    await pruneRetention(policy.policyId, policy.retentionCount);
    await writeAudit({
      actor: user.email,
      action: "BACKUP_POLICY_RUN",
      resource: `policy:${policy.policyId}`,
      detail: `Manual run — snapshot ${snap.backupId}`,
      userId: user.id,
    });
    return ok({ policy: updated, snapshot: snap });
  }

  const data: Record<string, unknown> = {};
  if (typeof body.enabled === "boolean") data.enabled = body.enabled;
  if (body.schedule && SCHEDULES[body.schedule]) {
    data.schedule = body.schedule;
    data.nextRunAt = nextRunFor(body.schedule);
  }
  if (body.retentionCount !== undefined) {
    const r = Math.round(body.retentionCount);
    if (r < 1 || r > 100) return fail("retentionCount must be 1-100");
    data.retentionCount = r;
  }
  if (Object.keys(data).length === 0) return fail("Nothing to update");

  const updated = await db.backupPolicy.update({ where: { id: policy.id }, data });
  await writeAudit({
    actor: user.email,
    action: "BACKUP_POLICY_UPDATED",
    resource: `policy:${policy.policyId}`,
    detail: JSON.stringify(data),
    userId: user.id,
  });
  return ok({ policy: updated });
}

export async function DELETE(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return fail("id query param is required");
  const policy = await db.backupPolicy.findUnique({ where: { policyId: id } });
  if (!policy) return fail("Policy not found", 404);

  await db.backupPolicy.delete({ where: { id: policy.id } });
  await writeAudit({
    actor: user.email,
    action: "BACKUP_POLICY_DELETED",
    resource: `policy:${policy.policyId}`,
    detail: `${policy.name} deleted (existing snapshots are kept)`,
    userId: user.id,
  });
  return ok({ deleted: true });
}
