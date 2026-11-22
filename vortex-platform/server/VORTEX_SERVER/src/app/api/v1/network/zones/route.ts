import { db } from "@/lib/db";
import { ok, fail, requireSession } from "@/lib/vortex/api";
import { writeAudit } from "@/lib/vortex/audit";
import { ensureSeeded } from "@/lib/vortex/seed";

export async function GET(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;

  const zones = await db.netZone.findMany({
    orderBy: { name: "asc" },
    include: { ips: { select: { id: true, status: true } } },
  });
  return ok({
    zones: zones.map((z) => ({
      id: z.id,
      name: z.name,
      cidr: z.cidr,
      vlan: z.vlan,
      purpose: z.purpose,
      status: z.status,
      ipTotal: z.ips.length,
      ipFree: z.ips.filter((i) => i.status === "FREE").length,
    })),
  });
}

export async function POST(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  let body: { name?: string; cidr?: string; vlan?: number; purpose?: string };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body");
  }

  const name = (body.name || "").trim().toLowerCase();
  const cidr = (body.cidr || "").trim();
  if (!/^[a-z0-9-]{3,30}$/.test(name)) return fail("Zone name: 3-30 chars, lowercase + dashes");
  if (!/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(cidr)) return fail("CIDR must look like 10.40.0.0/24");

  const dup = await db.netZone.findFirst({ where: { OR: [{ name }, { cidr }] } });
  if (dup) return fail("Zone name or CIDR already exists", 409);

  const zone = await db.netZone.create({
    data: {
      name,
      cidr,
      vlan: body.vlan ? Math.min(4094, Math.round(body.vlan)) : null,
      purpose: (body.purpose || "").trim(),
    },
  });

  await writeAudit({
    actor: user.email,
    action: "ZONE_CREATED",
    resource: `zone:${name}`,
    detail: `${cidr}${body.vlan ? ` vlan ${body.vlan}` : ""}`,
    userId: user.id,
  });
  return ok({ zone }, 201);
}
