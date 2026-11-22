import { db } from "@/lib/db";

/**
 * VORTEX COMPLIANCE (slim) — append-only audit trail.
 * Every privileged action goes through here.
 */
export async function writeAudit(entry: {
  actor: string;
  action: string;
  resource: string;
  detail?: string | null;
  ip?: string | null;
  userId?: string | null;
}) {
  try {
    await db.auditLog.create({
      data: {
        actor: entry.actor,
        action: entry.action,
        resource: entry.resource,
        detail: entry.detail ?? null,
        ip: entry.ip ?? null,
        userId: entry.userId ?? null,
      },
    });
  } catch {
    // auditing must never break the request path
  }
}
