import { ok, fail, requireSession } from "@/lib/vortex/api";
import { ensureSeeded } from "@/lib/vortex/seed";
import { portalState, saveDoc, deleteDoc, toggleDocVisibility } from "@/lib/vortex/portal";

/**
 * PORTAL MODULE (Phase 7) — internal developer portal + docs engine.
 * GET  — docs, full API reference catalog, per-app integration status.
 * POST — { op: "save_doc" | "delete_doc" | "toggle_public" }
 *
 * The public-publish gate is enforced server-side: nothing leaves the
 * ecosystem while future.firebase_mode = LOCKED.
 */
export async function GET(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  return ok(await portalState());
}

export async function POST(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  let body: {
    op?: string;
    docId?: string;
    slug?: string;
    title?: string;
    category?: string;
    body?: string;
    order?: number;
  };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body");
  }

  switch (body.op) {
    case "save_doc": {
      if (!body.slug || !body.title || !body.body) return fail("slug, title and body are required");
      const res = await saveDoc({
        docId: body.docId,
        slug: body.slug,
        title: body.title,
        category: body.category,
        body: body.body,
        order: body.order,
        actor: user.email,
      });
      if ("error" in res) return fail(res.error);
      return ok(res);
    }
    case "delete_doc": {
      if (!body.docId) return fail("docId is required");
      const res = await deleteDoc({ docId: body.docId, actor: user.email });
      if ("error" in res) return fail(res.error);
      return ok(res);
    }
    case "toggle_public": {
      if (!body.docId) return fail("docId is required");
      const res = await toggleDocVisibility({ docId: body.docId, actor: user.email });
      if ("error" in res) return fail(res.error, 423); // 423 Locked — the Firebase Mode gate
      return ok(res);
    }
    default:
      return fail(`Unknown op "${body.op}" — use save_doc | delete_doc | toggle_public`);
  }
}
