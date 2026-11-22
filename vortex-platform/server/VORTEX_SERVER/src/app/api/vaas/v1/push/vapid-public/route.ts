/**
 * v147 — Public VAPID applicationServerKey for a VaaS project.
 *
 * UNAUTHENTICATED by design: the applicationServerKey is a PUBLIC value (it
 * is embedded in every browser subscription, same as Firebase's own public
 * config). This lets apps subscribe to push with zero secret material:
 *
 *   const { publicKey } = await (await fetch('/api/vaas/v1/push/vapid-public?projectId=' + PID)).json()
 */
import { ensureSeeded } from "@/lib/vortex/seed";
import { db } from "@/lib/db";
import { vapidKeysFor } from "@/lib/vortex/vaas";

export async function GET(req: Request) {
  await ensureSeeded();
  const url = new URL(req.url);
  const pid = (url.searchParams.get("projectId") || "").trim();
  if (!pid) {
    return Response.json({ ok: false, error: "projectId query param required" }, { status: 400 });
  }
  const project = await db.vxProject.findFirst({
    where: { OR: [{ projectId: pid }, { id: pid }] },
  });
  if (!project) {
    return Response.json({ ok: false, error: "project not found" }, { status: 404 });
  }
  const keys = await vapidKeysFor(project.id);
  return Response.json({
    ok: true,
    projectId: project.projectId,
    publicKey: keys.publicKey,
    note: "applicationServerKey for pushManager.subscribe — VAPID public component",
  });
}
