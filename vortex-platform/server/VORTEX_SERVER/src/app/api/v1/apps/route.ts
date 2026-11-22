import { db } from "@/lib/db";
import { ok, fail, requireSession } from "@/lib/vortex/api";
import { writeAudit } from "@/lib/vortex/audit";
import { ensureSeeded } from "@/lib/vortex/seed";
import { nexaProvision } from "@/lib/vortex/vaas";

/**
 * APPLICATIONS + AI BUILDER WIRE (Phase 8) — registering an app now also
 * provisions its production backend: one call = app + VaaS project with
 * collections, keys and a welcome Cloud Function (the NEXA integration).
 */

export async function GET(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;

  const apps = await db.app.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      apiKeys: { where: { status: "ACTIVE" } },
      vxProject: { select: { projectId: true, slug: true, status: true, region: true, viaNexa: true } },
    },
  });
  return ok({
    apps: apps.map((a) => ({
      id: a.id,
      appId: a.appId,
      name: a.name,
      slug: a.slug,
      description: a.description,
      status: a.status,
      activeKeys: a.apiKeys.length,
      backend: a.vxProject && a.vxClientKey
        ? {
            projectId: a.vxProject.projectId,
            slug: a.vxProject.slug,
            backendStatus: a.vxProject.status,
            region: a.vxProject.region,
            viaNexa: a.vxProject.viaNexa,
            clientKey: a.vxClientKey,
            linkedAt: a.vaasLinkedAt,
          }
        : null,
      createdAt: a.createdAt,
    })),
  });
}

export async function POST(req: Request) {
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  let body: { name?: string; slug?: string; description?: string };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body");
  }

  const name = (body.name || "").trim();
  const slug = (body.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, "-")).replace(/^-+|-+$/g, "");
  if (!name) return fail("App name is required");
  if (!slug) return fail("Could not derive a valid slug");

  const exists = await db.app.findFirst({ where: { OR: [{ slug }, { name }] } });
  if (exists) return fail("An app with this name or slug already exists", 409);

  const appId = `app_${slug.replace(/-/g, "_").slice(0, 24)}_${Math.random().toString(36).slice(2, 6)}`;
  const app = await db.app.create({
    data: { appId, name, slug, description: (body.description || "").trim() },
  });

  // THE NEXA WIRE — the AI builder never ships an app without a backend.
  // One provision call = project + collections + CLIENT/ADMIN keys + welcome fn.
  let backend: Record<string, unknown> | null = null;
  let backendError: string | null = null;
  const provisioned = await nexaProvision({
    appName: name,
    collections: [
      { name: "posts", read: "public", write: "auth" },
      { name: "profile", read: "auth", write: "owner" },
    ],
    withWelcomeFn: true,
    actor: `${user.email} (NEXA auto-provision for ${appId})`,
  });
  if ("error" in provisioned) {
    backendError = provisioned.error;
  } else {
    await db.app.update({
      where: { id: app.id },
      data: { vxProjectId: provisioned.id, vxClientKey: provisioned.clientKey, vaasLinkedAt: new Date() },
    });
    backend = {
      projectId: provisioned.projectId,
      slug: provisioned.slug,
      clientKey: provisioned.clientKey,
      adminKey: provisioned.adminKey, // shown ONCE — stored hashed, never again
      collections: provisioned.collections,
      snippet: provisioned.snippet,
    };
  }

  await writeAudit({
    actor: user.email,
    action: "APP_REGISTERED",
    resource: `app:${app.appId}`,
    detail: backend
      ? `${name} + VaaS backend vxproj:${backend.projectId} (auto-provisioned)`
      : `${name} (backend provisioning deferred: ${backendError || "unknown"})`,
    userId: user.id,
  });

  return ok({ app: { ...app, vxProjectId: backend?.projectId ?? null }, backend, backendError }, 201);
}

export async function PATCH(req: Request) {
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  let body: { id?: string; status?: string };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body");
  }

  if (!body.id || !body.status) return fail("id and status are required");
  if (!["ACTIVE", "PAUSED", "ARCHIVED"].includes(body.status)) return fail("Invalid status");

  const app = await db.app.findUnique({ where: { id: body.id } });
  if (!app) return fail("App not found", 404);

  const updated = await db.app.update({ where: { id: app.id }, data: { status: body.status } });
  await writeAudit({
    actor: user.email,
    action: "APP_UPDATED",
    resource: `app:${app.appId}`,
    detail: `status=${body.status}`,
    userId: user.id,
  });

  return ok({ app: updated });
}
