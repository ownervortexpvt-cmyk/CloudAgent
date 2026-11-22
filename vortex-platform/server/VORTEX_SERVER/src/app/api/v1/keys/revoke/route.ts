import { db } from "@/lib/db";
import { ok, fail, requireSession } from "@/lib/vortex/api";
import { writeAudit } from "@/lib/vortex/audit";

export async function POST(req: Request) {
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  let body: { id?: string };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body");
  }
  if (!body.id) return fail("Key id is required");

  const key = await db.apiKey.findUnique({ where: { id: body.id } });
  if (!key) return fail("Key not found", 404);
  if (key.status === "REVOKED") return fail("Key already revoked");

  await db.apiKey.update({ where: { id: key.id }, data: { status: "REVOKED" } });
  await writeAudit({
    actor: user.email,
    action: "KEY_REVOKED",
    resource: `apikey:${key.keyId}`,
    detail: key.name,
    userId: user.id,
  });

  return ok({ revoked: true, keyId: key.keyId });
}
