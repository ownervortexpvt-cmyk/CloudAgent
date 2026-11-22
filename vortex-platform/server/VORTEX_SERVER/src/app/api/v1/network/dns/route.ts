import { db } from "@/lib/db";
import { ok, fail, requireSession } from "@/lib/vortex/api";
import { writeAudit } from "@/lib/vortex/audit";
import { ensureSeeded } from "@/lib/vortex/seed";
import { isValidIpv4 } from "@/lib/vortex/network";

const TYPES = ["A", "AAAA", "CNAME", "TXT", "MX"];

export async function GET(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;

  const records = await db.dnsRecord.findMany({ orderBy: [{ zone: "asc" }, { name: "asc" }] });
  return ok({ records });
}

export async function POST(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  let body: { zone?: string; name?: string; type?: string; value?: string; ttl?: number };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body");
  }

  const zone = (body.zone || "vortex.internal").trim();
  const name = (body.name || "").trim();
  const type = (body.type || "A").trim().toUpperCase();
  const value = (body.value || "").trim();

  if (!/^[a-z0-9*._-]{1,60}$/.test(name)) return fail("Invalid record name (a-z 0-9 * . _ -)");
  if (!TYPES.includes(type)) return fail(`Invalid type. Allowed: ${TYPES.join(", ")}`);
  if (!value) return fail("Record value is required");
  if (type === "A" && !isValidIpv4(value)) return fail("A record needs a valid IPv4 value");

  const dup = await db.dnsRecord.findUnique({ where: { zone_name_type: { zone, name, type } } });
  if (dup) return fail("Record already exists (zone+name+type must be unique)", 409);

  const record = await db.dnsRecord.create({
    data: { zone, name, type, value, ttl: Math.min(86400, Math.max(30, Math.round(body.ttl || 300))) },
  });

  await writeAudit({
    actor: user.email,
    action: "DNS_RECORD_CREATED",
    resource: `dns:${name}.${zone}`,
    detail: `${type} → ${value}`,
    userId: user.id,
  });
  return ok({ record }, 201);
}

export async function PATCH(req: Request) {
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  let body: { id?: string; status?: string; value?: string };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body");
  }
  if (!body.id) return fail("id is required");

  const record = await db.dnsRecord.findUnique({ where: { id: body.id } });
  if (!record) return fail("Record not found", 404);

  const updated = await db.dnsRecord.update({
    where: { id: record.id },
    data: {
      status: body.status === "ACTIVE" || body.status === "DISABLED" ? body.status : record.status,
      value: body.value !== undefined ? body.value.trim() : record.value,
    },
  });

  await writeAudit({
    actor: user.email,
    action: "DNS_RECORD_UPDATED",
    resource: `dns:${record.name}.${record.zone}`,
    detail: `${updated.type} → ${updated.value} (${updated.status})`,
    userId: user.id,
  });
  return ok({ record: updated });
}

export async function DELETE(req: Request) {
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return fail("id query param is required");

  const record = await db.dnsRecord.findUnique({ where: { id } });
  if (!record) return fail("Record not found", 404);

  await db.dnsRecord.delete({ where: { id } });
  await writeAudit({
    actor: user.email,
    action: "DNS_RECORD_DELETED",
    resource: `dns:${record.name}.${record.zone}`,
    userId: user.id,
  });
  return ok({ deleted: true });
}
