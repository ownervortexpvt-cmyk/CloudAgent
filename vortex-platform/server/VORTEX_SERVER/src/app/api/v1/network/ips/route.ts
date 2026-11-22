import { db } from "@/lib/db";
import { ok, fail, requireSession } from "@/lib/vortex/api";
import { writeAudit } from "@/lib/vortex/audit";
import { ensureSeeded } from "@/lib/vortex/seed";
import { isValidIpv4 } from "@/lib/vortex/network";

export async function GET(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;

  const ips = await db.ipAddress.findMany({
    orderBy: { address: "asc" },
    include: { zone: { select: { name: true, cidr: true } } },
  });
  return ok({ ips });
}

/** Add an address to the pool. */
export async function POST(req: Request) {
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  let body: { address?: string; ipType?: string; note?: string; zoneId?: string };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body");
  }

  const address = (body.address || "").trim();
  if (!isValidIpv4(address)) return fail("Invalid IPv4 address");
  const exists = await db.ipAddress.findUnique({ where: { address } });
  if (exists) return fail("Address already in pool", 409);

  let zoneId: string | null = null;
  if (body.zoneId) {
    const zone = await db.netZone.findUnique({ where: { id: body.zoneId } });
    if (!zone) return fail("Zone not found", 404);
    zoneId = zone.id;
  }

  const ip = await db.ipAddress.create({
    data: {
      address,
      ipType: body.ipType === "PUBLIC" ? "PUBLIC" : "PRIVATE",
      status: "FREE",
      note: (body.note || "").trim(),
      zoneId,
    },
  });

  await writeAudit({
    actor: user.email,
    action: "IP_ADDED",
    resource: `ip:${address}`,
    detail: `pool +1 (${ip.ipType})`,
    userId: user.id,
  });
  return ok({ ip }, 201);
}

/** Assign / release / reserve. */
export async function PATCH(req: Request) {
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  let body: { id?: string; action?: "ASSIGN" | "RELEASE" | "RESERVE"; target?: string };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body");
  }
  if (!body.id || !body.action) return fail("id and action are required");

  const ip = await db.ipAddress.findUnique({ where: { id: body.id } });
  if (!ip) return fail("IP not found", 404);

  if (body.action === "ASSIGN") {
    const target = (body.target || "").trim();
    if (!target) return fail("Assign target (node name / label) is required");
    if (ip.status === "ASSIGNED") return fail("IP already assigned — release it first");
    const updated = await db.ipAddress.update({
      where: { id: ip.id },
      data: { status: "ASSIGNED", assignedTo: target },
    });
    await writeAudit({ actor: user.email, action: "IP_ASSIGNED", resource: `ip:${ip.address}`, detail: `→ ${target}`, userId: user.id });
    return ok({ ip: updated });
  }

  if (body.action === "RESERVE") {
    const updated = await db.ipAddress.update({
      where: { id: ip.id },
      data: { status: "RESERVED", assignedTo: null },
    });
    await writeAudit({ actor: user.email, action: "IP_RESERVED", resource: `ip:${ip.address}`, userId: user.id });
    return ok({ ip: updated });
  }

  // RELEASE
  const updated = await db.ipAddress.update({
    where: { id: ip.id },
    data: { status: "FREE", assignedTo: null },
  });
  await writeAudit({ actor: user.email, action: "IP_RELEASED", resource: `ip:${ip.address}`, userId: user.id });
  return ok({ ip: updated });
}

/** Remove an address from the pool (only when FREE). */
export async function DELETE(req: Request) {
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return fail("id query param is required");

  const ip = await db.ipAddress.findUnique({ where: { id } });
  if (!ip) return fail("IP not found", 404);
  if (ip.status !== "FREE") return fail("Only FREE addresses can be removed from the pool");

  await db.ipAddress.delete({ where: { id } });
  await writeAudit({ actor: user.email, action: "IP_REMOVED", resource: `ip:${ip.address}`, userId: user.id });
  return ok({ removed: true });
}
