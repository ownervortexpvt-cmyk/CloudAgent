import { db } from "@/lib/db";
import { ok, fail, requireSession } from "@/lib/vortex/api";
import { writeAudit } from "@/lib/vortex/audit";

export async function GET(req: Request) {
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;

  const configs = await db.appConfig.findMany({ orderBy: [{ category: "asc" }, { key: "asc" }] });
  return ok({ configs });
}

export async function PUT(req: Request) {
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  let body: { key?: string; value?: string };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body");
  }

  const key = (body.key || "").trim();
  if (!key) return fail("Config key is required");
  if (key === "core.seeded") return fail("This is an internal flag and cannot be edited", 403);

  const cfg = await db.appConfig.findUnique({ where: { key } });
  if (!cfg) return fail("Unknown config key", 404);

  const updated = await db.appConfig.update({
    where: { key },
    data: { value: (body.value ?? "").trim(), updatedBy: user.email },
  });

  await writeAudit({
    actor: user.email,
    action: "CONFIG_UPDATED",
    resource: `config:${key}`,
    detail: `→ ${cfg.isSecret ? "*(redacted)*" : updated.value}`,
    userId: user.id,
  });

  return ok({ config: updated });
}
