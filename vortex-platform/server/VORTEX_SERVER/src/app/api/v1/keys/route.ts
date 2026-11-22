import { db } from "@/lib/db";
import { ok, fail, requireSession } from "@/lib/vortex/api";
import { sha256, generateToken, shortId } from "@/lib/vortex/crypto";
import { writeAudit } from "@/lib/vortex/audit";
import { ensureSeeded } from "@/lib/vortex/seed";

const VALID_SCOPES = ["read", "write", "admin"];

export async function GET(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;

  const keys = await db.apiKey.findMany({
    orderBy: { createdAt: "desc" },
    include: { app: { select: { name: true, appId: true } } },
  });
  return ok({
    keys: keys.map((k) => ({
      id: k.id,
      keyId: k.keyId,
      prefix: k.prefix,
      name: k.name,
      scopes: k.scopes.split(","),
      status: k.status,
      app: k.app ? { name: k.app.name, appId: k.app.appId } : null,
      lastUsedAt: k.lastUsedAt,
      createdAt: k.createdAt,
    })),
  });
}

/**
 * Create an SDK-style key: vx_live_<32 hex>. Plaintext shown ONCE.
 */
export async function POST(req: Request) {
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  let body: { name?: string; appId?: string; scopes?: string[] };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body");
  }

  const name = (body.name || "").trim();
  if (!name) return fail("Key name is required");

  const scopes = (body.scopes || ["read"]).filter((s) => VALID_SCOPES.includes(s));
  if (scopes.length === 0) return fail("At least one valid scope required (read, write, admin)");

  let appId: string | null = null;
  if (body.appId) {
    const app = await db.app.findUnique({ where: { id: body.appId } });
    if (!app) return fail("App not found", 404);
    appId = app.id;
  }

  const raw = `vx_live_${generateToken(16)}`;
  const key = await db.apiKey.create({
    data: {
      keyId: shortId("key"),
      keyHash: sha256(raw),
      prefix: `${raw.slice(0, 12)}…`,
      name,
      scopes: scopes.join(","),
      appId,
      userId: user.id,
    },
  });

  await writeAudit({
    actor: user.email,
    action: "KEY_CREATED",
    resource: `apikey:${key.keyId}`,
    detail: `${name} scopes=${scopes.join(",")}`,
    userId: user.id,
  });

  return ok({ key: { id: key.id, keyId: key.keyId, name, scopes, appId }, plaintext: raw }, 201);
}
