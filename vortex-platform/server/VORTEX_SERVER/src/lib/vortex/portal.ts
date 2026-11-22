import { db } from "@/lib/db";
import { writeAudit } from "./audit";
import { API_REF } from "./apiref";

/**
 * VORTEX PORTAL (Phase 7) — internal developer portal + docs engine.
 *
 * The portal serves the OWNER'S OWN developers across the 46+ apps: the
 * real API catalog (API_REF, generated from the live route surface),
 * quickstart guides stored in the control plane, and per-app integration
 * status (keys, databases, buckets, workloads, deployments).
 *
 * PUBLIC visibility is the only thing that stays gated: a doc may only
 * leave INTERNAL when `future.firebase_mode` leaves LOCKED — and the
 * gate is enforced HERE, server-side, not in the UI.
 */

export async function firebaseMode(): Promise<string> {
  const cfg = await db.appConfig.findUnique({ where: { key: "future.firebase_mode" } });
  return cfg?.value || "LOCKED";
}

export async function portalState() {
  const [docs, apps, keys, dbs, buckets, workloads, deploys, routes, mode] = await Promise.all([
    db.docPage.findMany({ orderBy: [{ category: "asc" }, { order: "asc" }] }),
    db.app.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, name: true, appId: true, slug: true, status: true, createdAt: true } }),
    db.apiKey.findMany({ where: { status: "ACTIVE" }, select: { appId: true } }),
    db.databaseInstance.findMany({ where: { status: { not: "DESTROYED" } }, select: { appId: true, engine: true } }),
    db.storageBucket.findMany({ select: { appId: true, usedMb: true, objectCount: true } }),
    db.workload.findMany({ where: { status: { not: "DESTROYED" } }, select: { appId: true, status: true } }),
    db.deployment.findMany({ where: { status: "RUNNING" }, select: { appId: true } }),
    db.gatewayRoute.findMany({ where: { status: "ACTIVE" }, select: { appId: true, hitCount: true } }),
    firebaseMode(),
  ]);

  const integrations = apps.map((a) => {
    const hits = routes.filter((r) => r.appId === a.id).reduce((x, r) => x + r.hitCount, 0);
    return {
      appId: a.appId,
      name: a.name,
      slug: a.slug,
      status: a.status,
      activeKeys: keys.filter((k) => k.appId === a.id).length,
      databases: dbs.filter((d) => d.appId === a.id).map((d) => d.engine),
      buckets: buckets.filter((b) => b.appId === a.id).length,
      objects: buckets.filter((b) => b.appId === a.id).reduce((x, b) => x + b.objectCount, 0),
      workloads: workloads.filter((w) => w.appId === a.id).length,
      liveDeploys: deploys.filter((d) => d.appId === a.id).length,
      gatewayHits: hits,
    };
  });

  return {
    mode,
    docs,
    apiRef: API_REF,
    integrations,
    stats: {
      docsTotal: docs.length,
      docsInternal: docs.filter((d) => d.visibility === "INTERNAL").length,
      docsPublic: docs.filter((d) => d.visibility === "PUBLIC").length,
      endpoints: API_REF.reduce((a, g) => a + g.entries.length, 0),
      endpointGroups: API_REF.length,
    },
  };
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,48}$/;

export async function saveDoc(opts: {
  docId?: string;
  slug: string;
  title: string;
  category?: string;
  body: string;
  order?: number;
  actor: string;
}) {
  const slug = opts.slug.trim().toLowerCase();
  if (!SLUG_RE.test(slug)) return { error: "Slug must be 2-49 chars: lowercase letters, digits, dashes" };
  const title = opts.title.trim();
  if (title.length < 3) return { error: "Title is too short" };
  const body = opts.body.trim();
  if (body.length < 20) return { error: "Body is too short — a doc needs at least a real paragraph (20+ chars)" };
  const category = ["GET_STARTED", "API_REFERENCE", "GUIDES", "POLICY"].includes(opts.category || "") ? opts.category! : "GUIDES";
  const order = Math.min(Math.max(opts.order ?? 100, 1), 999);

  const existingById = opts.docId ? await db.docPage.findUnique({ where: { docId: opts.docId } }) : null;
  const clash = await db.docPage.findUnique({ where: { slug } });
  if (clash && clash.docId !== existingById?.docId) return { error: `Slug "${slug}" is already taken` };

  const docId = existingById?.docId || `doc_${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
  const doc = existingById
    ? await db.docPage.update({
        where: { docId: existingById.docId },
        data: { slug, title, category, body, order, updatedBy: opts.actor, isSystem: false },
      })
    : await db.docPage.create({
        data: { docId, slug, title, category, body, order, visibility: "INTERNAL", updatedBy: opts.actor },
      });

  await writeAudit({
    actor: opts.actor,
    action: existingById ? "PORTAL_DOC_UPDATED" : "PORTAL_DOC_CREATED",
    resource: `doc:${doc.docId}`,
    detail: `${title} (${slug}) · ${category}`,
  });
  return { docId: doc.docId, slug };
}

export async function deleteDoc(opts: { docId: string; actor: string }) {
  const doc = await db.docPage.findUnique({ where: { docId: opts.docId } });
  if (!doc) return { error: "Doc not found" };
  if (doc.isSystem) return { error: "System docs (seeded baseline) can be edited but not deleted" };
  await db.docPage.delete({ where: { docId: doc.docId } });
  await writeAudit({
    actor: opts.actor,
    action: "PORTAL_DOC_DELETED",
    resource: `doc:${doc.docId}`,
    detail: `${doc.title} (${doc.slug})`,
  });
  return { deleted: doc.docId };
}

/**
 * Publish a doc publicly. THE GATE: enforced on the server, exactly the
 * forward-compatibility promise of Phase 7 — the switch exists, the docs
 * engine is real, but nothing leaves the ecosystem while the owner's
 * `future.firebase_mode = LOCKED` decision stands.
 */
export async function toggleDocVisibility(opts: { docId: string; actor: string }) {
  const doc = await db.docPage.findUnique({ where: { docId: opts.docId } });
  if (!doc) return { error: "Doc not found" };
  const mode = await firebaseMode();
  if (mode === "LOCKED") {
    await writeAudit({
      actor: opts.actor,
      action: "PORTAL_PUBLISH_BLOCKED",
      resource: `doc:${doc.docId}`,
      detail: `Publish of "${doc.title}" blocked — firebase_mode is LOCKED (owner decision)`,
    });
    return { error: "Locked: publishing outside the ecosystem needs Firebase Mode — `future.firebase_mode` is LOCKED by owner decision" };
  }
  const next = doc.visibility === "PUBLIC" ? "INTERNAL" : "PUBLIC";
  await db.docPage.update({ where: { docId: doc.docId }, data: { visibility: next, updatedBy: opts.actor } });
  await writeAudit({
    actor: opts.actor,
    action: "PORTAL_DOC_VISIBILITY",
    resource: `doc:${doc.docId}`,
    detail: `${doc.title} → ${next} (firebase_mode=${mode})`,
  });
  return { docId: doc.docId, visibility: next };
}
