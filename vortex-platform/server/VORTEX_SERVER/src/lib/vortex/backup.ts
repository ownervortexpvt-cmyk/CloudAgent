import { db } from "@/lib/db";
import { randomBytes } from "crypto";
import { sha256, shortId } from "./crypto";
import { sendSystemMail } from "./notify";

/**
 * VORTEX BACKUP — snapshot engine.
 * 3-tier permanent storage design (locked): disk → cluster → offsite.
 * Every snapshot is encrypted at rest (age-x25519), restic-style.
 */

export const SCHEDULES: Record<string, { sec: number }> = {
  HOURLY: { sec: 3600 },
  DAILY: { sec: 86400 },
  WEEKLY: { sec: 604800 },
};

export function nextRunFor(schedule: string, from: Date = new Date()): Date {
  const sec = SCHEDULES[schedule]?.sec || 86400;
  return new Date(from.getTime() + sec * 1000);
}

export type SnapshotInput = {
  policyId?: string | null;
  trigger: "POLICY" | "MANUAL";
  targetType: "DATABASE" | "SERVER";
  targetId: string;
  targetLabel: string;
};

/** Create a COMPLETED encrypted snapshot (simulated data-plane copy). */
export async function createSnapshot(input: SnapshotInput) {
  // Estimate archive size from the live target (compressed ~35-55%)
  let sizeMb = 256;
  if (input.targetType === "DATABASE") {
    const inst = await db.databaseInstance.findUnique({ where: { dbId: input.targetId } });
    sizeMb = Math.max(16, Math.round((inst?.sizeMb || 1024) * (0.35 + Math.random() * 0.2)));
  } else {
    const node = await db.serverNode.findUnique({ where: { nodeId: input.targetId } });
    sizeMb = Math.max(64, Math.round((node?.diskGb || 20) * 1024 * (0.15 + Math.random() * 0.1)));
  }

  // Offsite tier syncs async — ~1 in 10 snapshots still pending tier 3
  const offsiteSynced = Math.random() > 0.12;

  const snap = await db.backupSnapshot.create({
    data: {
      backupId: shortId("bkp", 8),
      policyId: input.policyId ?? null,
      trigger: input.trigger,
      targetType: input.targetType,
      targetId: input.targetId,
      targetLabel: input.targetLabel,
      sizeMb,
      checksum: sha256(randomBytes(32).toString("hex")).slice(0, 32),
      cipher: "age-x25519",
      tierDisk: true,
      tierCluster: true,
      tierOffsite: offsiteSynced,
      status: "COMPLETED",
    },
  });

  await db.auditLog.create({
    data: {
      actor: "system",
      action: input.trigger === "POLICY" ? "BACKUP_POLICY_RUN" : "BACKUP_SNAPSHOT_CREATED",
      resource: `backup:${snap.backupId}`,
      detail: `${input.targetType} ${input.targetLabel} — ${(sizeMb / 1024).toFixed(2)} GB encrypted, tiers: disk✓ cluster✓ offsite${offsiteSynced ? "✓" : "…pending"}`,
    },
  });

  return snap;
}

/** Keep only the latest N COMPLETED policy snapshots; older → EXPIRED. */
export async function pruneRetention(policyId: string, retentionCount: number): Promise<number> {
  const snaps = await db.backupSnapshot.findMany({
    where: { policyId, status: "COMPLETED" },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  const expired = snaps.slice(Math.max(1, retentionCount));
  if (expired.length === 0) return 0;
  const res = await db.backupSnapshot.updateMany({
    where: { id: { in: expired.map((s) => s.id) } },
    data: { status: "EXPIRED" },
  });
  return res.count;
}

/** Run every enabled policy whose nextRunAt is due. Called on dashboard GET. */
export async function runDuePolicies(): Promise<{ ran: number; failed: number }> {
  const now = new Date();
  const due = await db.backupPolicy.findMany({
    where: { enabled: true, nextRunAt: { lte: now } },
  });

  let ran = 0;
  let failed = 0;

  for (const p of due) {
    // target still alive?
    let alive = false;
    if (p.targetType === "DATABASE") {
      const inst = await db.databaseInstance.findUnique({ where: { dbId: p.targetId } });
      alive = !!inst && inst.status === "RUNNING";
    } else {
      const node = await db.serverNode.findUnique({ where: { nodeId: p.targetId } });
      alive = !!node && node.status === "RUNNING";
    }

    if (!alive) {
      failed += 1;
      const msg = `Backup policy "${p.name}" failed — target ${p.targetType} ${p.targetLabel} is not RUNNING`;
      await db.alertEvent.create({
        data: {
          source: "BACKUP",
          type: "BACKUP_FAILED",
          severity: "CRITICAL",
          message: msg,
          status: "OPEN",
        },
      });
      await sendSystemMail({
        subject: "VORTEX BACKUP — policy run FAILED",
        body: `${msg}\n\nThe policy stays enabled; it will retry on its next schedule slot.`,
      });
      await db.auditLog.create({
        data: { actor: "system", action: "BACKUP_POLICY_FAILED", resource: `policy:${p.policyId}`, detail: msg },
      });
    } else {
      // targetType is validated at policy creation; only DATABASE | SERVER exist
      await createSnapshot({
        policyId: p.policyId,
        trigger: "POLICY",
        targetType: p.targetType === "SERVER" ? "SERVER" : "DATABASE",
        targetId: p.targetId,
        targetLabel: p.targetLabel,
      });
      ran += 1;
    }

    await db.backupPolicy.update({
      where: { id: p.id },
      data: {
        lastRunAt: now,
        nextRunAt: nextRunFor(p.schedule, now),
        runCount: { increment: 1 },
      },
    });
    await pruneRetention(p.policyId, p.retentionCount);
  }

  return { ran, failed };
}
