import { db } from "@/lib/db";
import { ok, fail, requireSession } from "@/lib/vortex/api";
import { ensureSeeded } from "@/lib/vortex/seed";
import { vaasState, flipGate, provisionProject, nexaProvision, sdkSnippet, priceVaasUsage } from "@/lib/vortex/vaas";
import { hashPassword } from "@/lib/vortex/crypto";

/**
 * VAAS control plane — dashboard API (VORTEX ID session required).
 * The owner provisions projects/developers, flips the Firebase gate,
 * and inspects per-project usage. The public SDK surface lives at
 * /api/vaas/v1/* — that one needs NO dashboard session.
 */

export async function GET(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const state = await vaasState();
  return ok(state);
}

export async function POST(req: Request) {
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return fail("Invalid JSON body");
  }
  const op = String(body.op || "");

  switch (op) {
    case "flip_gate": {
      const next = String(body.mode || "");
      if (!["OPEN", "LOCKED"].includes(next)) return fail("mode must be OPEN or LOCKED");
      const res = await flipGate(next as "OPEN" | "LOCKED", user.email, user.id);
      return ok(res);
    }

    case "create_developer": {
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const name = String(body.name || "").trim();
      if (!email.includes("@")) return fail("Valid email required");
      if (password.length < 8) return fail("Password must be at least 8 characters");
      const { shortId } = await import("@/lib/vortex/crypto");
      try {
        const dev = await db.developer.create({
          data: { devId: shortId("dev", 10), email, passwordHash: hashPassword(password), name: name || email.split("@")[0], emailVerified: true },
        });
        return ok({ devId: dev.devId, email: dev.email, name: dev.name }, 201);
      } catch {
        return fail("Email already registered", 409);
      }
    }

    case "provision_project": {
      const name = String(body.name || "").trim();
      const devId = String(body.devId || "");
      const dev = devId ? await db.developer.findUnique({ where: { devId } }) : null;
      if (!dev) return fail("Developer not found (devId required)");
      const rawCols = Array.isArray(body.collections) ? (body.collections as unknown[]) : [];
      const collections = rawCols
        .map((c) => (typeof c === "string" ? { name: c } : (c as { name?: string; read?: string; write?: string })))
        .filter((c) => typeof c?.name === "string" && c.name.trim().length > 0)
        .map((c) => ({ name: String(c.name).trim(), read: c.read, write: c.write }));
      const res = await provisionProject({ name, developerId: dev.id, collections, actor: user.email });
      if ("error" in res) return fail(res.error, 409);
      const snippet = sdkSnippet({ appName: name, projectId: res.projectId, clientKey: res.clientKey || "" });
      return ok({ ...res, snippet }, 201);
    }

    case "nexa_provision": {
      const appName = String(body.appName || "").trim();
      if (!appName) return fail("appName is required — the AI builder names the backend after the app");
      const rawCols = Array.isArray(body.collections) ? (body.collections as unknown[]) : [];
      const collections = rawCols
        .map((c) => (typeof c === "string" ? { name: c } : (c as { name?: string; read?: string; write?: string })))
        .filter((c) => typeof c?.name === "string" && c.name.trim().length > 0)
        .map((c) => ({ name: String(c.name).trim(), read: c.read, write: c.write }));
      const res = await nexaProvision({ appName, collections, withWelcomeFn: body.withWelcomeFn !== false, actor: `${user.email} (NEXA)` });
      if ("error" in res) return fail(res.error, 423);
      return ok(res, 201);
    }

    case "revoke_key": {
      const keyId = String(body.keyId || "");
      const key = await db.vxKey.findUnique({ where: { keyId } });
      if (!key) return fail("Key not found", 404);
      await db.vxKey.update({ where: { id: key.id }, data: { status: "REVOKED" } });
      return ok({ revoked: keyId });
    }

    case "rotate_keys": {
      const projectId = String(body.projectId || "");
      const project = await db.vxProject.findUnique({ where: { projectId } });
      if (!project) return fail("Project not found", 404);
      const { createVxKey } = await import("@/lib/vortex/vaas");
      const client = await createVxKey(project.id, "CLIENT");
      const admin = await createVxKey(project.id, "ADMIN");
      return ok({ client, admin });
    }

    case "set_project_status": {
      const projectId = String(body.projectId || "");
      const status = String(body.status || "");
      if (!["ACTIVE", "PAUSED", "ARCHIVED"].includes(status)) return fail("Invalid status");
      const project = await db.vxProject.findUnique({ where: { projectId } });
      if (!project) return fail("Project not found", 404);
      await db.vxProject.update({ where: { id: project.id }, data: { status } });
      return ok({ projectId, status });
    }

    case "set_dev_status": {
      const devId = String(body.devId || "");
      const status = String(body.status || "");
      if (!["ACTIVE", "SUSPENDED"].includes(status)) return fail("Invalid status");
      const dev = await db.developer.findUnique({ where: { devId } });
      if (!dev) return fail("Developer not found", 404);
      if (dev.email === "nexa@vortex.local") return fail("The NEXA builder identity cannot be suspended");
      await db.developer.update({ where: { id: dev.id }, data: { status } });
      return ok({ devId, status });
    }

    case "project_usage": {
      const projectId = String(body.projectId || "");
      const project = await db.vxProject.findUnique({ where: { projectId } });
      if (!project) return fail("Project not found", 404);
      const { periodKey } = await import("@/lib/vortex/billing");
      const usage = await db.vxUsage.findMany({ where: { projectId: project.id, period: periodKey() } });
      const map = Object.fromEntries(usage.map((u) => [u.metric, u.quantity]));
      const dev = await db.developer.findUnique({ where: { id: project.developerId } });
      const plans = await db.billingPlan.findMany({ where: { audience: "EXTERNAL" } });
      const plan = plans.find((p) => p.code === "VAAS_PRO" && dev?.plan === "VAAS_PRO") || plans.find((p) => p.isDefault) || plans[0];
      const priced = plan ? priceVaasUsage(plan, map) : null;
      return ok({ projectId, period: periodKey(), plan: plan?.code || null, usage: map, priced });
    }

    default:
      return fail(`Unknown op "${op}"`);
  }
}
