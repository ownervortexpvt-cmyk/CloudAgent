import { db } from "@/lib/db";
import { shortId } from "./crypto";

/**
 * VORTEX NETWORK — shared helpers (IP allocation for SERVER provisioning).
 */

export function isValidIpv4(s: string): boolean {
  const m = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  return m.slice(1).every((oct) => {
    const n = parseInt(oct, 10);
    return n >= 0 && n <= 255;
  });
}

/** Allocate the first FREE private IP; marks it ASSIGNED to the given node. */
export async function allocatePrivateIp(nodeId: string): Promise<string | null> {
  const free = await db.ipAddress.findFirst({
    where: { status: "FREE", ipType: "PRIVATE" },
    orderBy: { address: "asc" },
  });
  if (!free) return null;
  await db.ipAddress.update({
    where: { id: free.id },
    data: { status: "ASSIGNED", assignedTo: nodeId },
  });
  return free.address;
}

/** Release any IPs currently assigned to a node back to the FREE pool. */
export async function releaseIpsForNode(nodeId: string): Promise<number> {
  const res = await db.ipAddress.updateMany({
    where: { assignedTo: nodeId, status: "ASSIGNED" },
    data: { status: "FREE", assignedTo: null },
  });
  return res.count;
}

export function newServerNodeId(): string {
  return shortId("srv", 8);
}
