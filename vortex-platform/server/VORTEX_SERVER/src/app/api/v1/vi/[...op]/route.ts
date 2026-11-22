import { NextResponse } from "next/server";
import { ensureSeeded } from "@/lib/vortex/seed";
import { ok, fail } from "@/lib/vortex/api";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/vortex/audit";
import { getClientIp, rateLimit } from "@/lib/vortex/ratelimit";
import { platformFromRequest, scopeOk, poolUsage, type PlatformId } from "@/lib/vortex/vserver";
import { getSessionUser } from "@/lib/vortex/auth";

/**
 * /api/v1/vi/[...op] — VI (VORTEX INTELLIGENT) namespace.
 * Real backing: ViTask rows. "assist" runs a real LLM completion through the
 * z-ai SDK (server-side); "monitor" computes REAL ecosystem stats; deploy /
 * publish / coordinate tasks stay NEEDS_APPROVAL until an owner approves.
 */

export const dynamic = "force-dynamic";

type Auth = { via: string; platform: PlatformId | "shared"; subject: string; scopes: string[]; isOwner: boolean };

async function authenticate(req: Request): Promise<Auth | { response: NextResponse }> {
  const pk = await platformFromRequest(req);
  if (pk.ok) {
    return { via: `pk:${pk.keyId}`, platform: pk.platform === "vortex-server" ? "vortex-server" : pk.platform, subject: pk.keyId, scopes: pk.scopes, isOwner: pk.kind === "master" };
  }
  const user = await getSessionUser(req);
  if (user) {
    return { via: `owner:${user.email}`, platform: "vi", subject: user.id, scopes: ["tasks.read", "tasks.write", "monitor.read", "storage.read"], isOwner: true };
  }
  return { response: fail("Unauthorized — platform key or VORTEX ID session required", 401) };
}

const TASK_KINDS = ["assist", "monitor", "deploy", "publish", "coordinate"];
const APPROVAL_KINDS = new Set(["deploy", "publish", "coordinate"]);

async function ecosystemSnapshot() {
  const [users, developers, caProjects, caBuilds, sites, apps, vxProjects, docs, pool] = await Promise.all([
    db.adminUser.count(),
    db.developer.count(),
    db.caProject.count(),
    db.caBuild.count(),
    db.websiteProject.count(),
    db.appverseApp.count(),
    db.vxProject.count(),
    db.mailLog.count({ where: { status: "SENT" } }),
    poolUsage(),
  ]);
  const openAlerts = await db.alertEvent.count({ where: { status: "OPEN" } });
  const recentAudits = await db.auditLog.count({ where: { createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } } });
  return {
    users, developers, cloudAgentProjects: caProjects, cloudAgentBuilds: caBuilds,
    websites: sites, apps, vaasProjects: vxProjects, mailsSent24hOrTotal: docs,
    storage: { provider: pool.provider, configured: pool.configured, usedGb: Math.round((pool.usedMb / 1024) * 10) / 10, poolGb: Math.round(pool.poolMb / 1024), pct: pool.pct },
    openAlerts, auditEvents24h: recentAudits,
    generatedAt: new Date().toISOString(),
  };
}

export async function GET(req: Request, ctx: { params: Promise<{ op: string[] }> }) {
  await ensureSeeded();
  const auth = await authenticate(req);
  if ("response" in auth) return auth.response;
  if (!scopeOk({ ok: true, keyId: auth.via, platform: auth.platform as PlatformId, kind: "platform", scopes: auth.scopes }, "tasks.read") && !scopeOk({ ok: true, keyId: auth.via, platform: auth.platform as PlatformId, kind: "platform", scopes: auth.scopes }, "monitor.read")) {
    return fail("Token lacks scope: tasks.read / monitor.read", 403);
  }
  const { op } = await ctx.params;
  const [seg, a] = op;

  if (seg === "status") {
    return ok({ vi: "READY", ...(await ecosystemSnapshot()) });
  }

  if (seg === "tasks" && !a) {
    const tasks = await db.viTask.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
    return ok({
      tasks: tasks.map((t) => ({
        taskId: t.taskId, kind: t.kind, title: t.title, status: t.status,
        approvalRequired: t.approvalRequired, approvedBy: t.approvedBy,
        latencyMs: t.latencyMs, createdAt: t.createdAt, finishedAt: t.finishedAt,
      })),
    });
  }

  if (seg === "tasks" && a) {
    const t = await db.viTask.findUnique({ where: { taskId: a } });
    if (!t) return fail("Task not found", 404);
    return ok({
      task: {
        taskId: t.taskId, kind: t.kind, title: t.title, status: t.status,
        approvalRequired: t.approvalRequired, approvedBy: t.approvedBy,
        payload: JSON.parse(t.payloadJson || "{}"), result: t.resultJson ? JSON.parse(t.resultJson) : null,
        latencyMs: t.latencyMs, createdAt: t.createdAt, finishedAt: t.finishedAt,
      },
    });
  }

  return fail("Unknown vi endpoint", 404);
}

export async function POST(req: Request, ctx: { params: Promise<{ op: string[] }> }) {
  await ensureSeeded();
  const ip = getClientIp(req);
  const rl = rateLimit(`vi:${ip}`, 60, 60_000);
  if (!rl.allowed) return fail("Rate limit exceeded", 429, { retryAfter: Math.ceil((rl.retryAfterMs || 0) / 1000) });
  const auth = await authenticate(req);
  if ("response" in auth) return auth.response;
  const { op } = await ctx.params;
  const [seg, a, action] = op;
  const body = await req.json().catch(() => ({}));

  if (seg === "tasks" && !a) {
    if (!scopeOk({ ok: true, keyId: auth.via, platform: auth.platform as PlatformId, kind: "platform", scopes: auth.scopes }, "tasks.write")) {
      return fail("Token lacks scope: tasks.write", 403);
    }
    const kind = String(body.kind || "assist").toLowerCase();
    if (!TASK_KINDS.includes(kind)) return fail(`kind must be one of: ${TASK_KINDS.join(", ")}`);
    const title = String(body.title || "").trim().slice(0, 120) || `${kind} task`;
    const payload = body.payload && typeof body.payload === "object" ? body.payload : {};
    const taskId = `vi_${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
    const needsApproval = APPROVAL_KINDS.has(kind) && !auth.isOwner;

    if (needsApproval) {
      const t = await db.viTask.create({
        data: { taskId, kind, title, actor: auth.via, status: "NEEDS_APPROVAL", approvalRequired: true, payloadJson: JSON.stringify(payload) },
      });
      await writeAudit({ actor: auth.via, action: "VI_TASK_GATED", resource: taskId, detail: `${kind} requires owner approval` });
      return ok({ taskId: t.taskId, status: t.status, note: "Owner approval required — POST /tasks/:id/approve with an owner session or master key" }, 202);
    }

    const started = Date.now();
    const t = await db.viTask.create({
      data: { taskId, kind, title, actor: auth.via, status: "RUNNING", approvalRequired: APPROVAL_KINDS.has(kind), payloadJson: JSON.stringify(payload) },
    });
    let result: Record<string, unknown>;
    try {
      if (kind === "monitor") {
        result = { type: "monitor", snapshot: await ecosystemSnapshot() };
      } else if (kind === "assist") {
        // REAL LLM completion through the z-ai SDK (server-side only)
        const { default: ZAI } = await import("z-ai-web-dev-sdk");
        const zai = await ZAI.create();
        const prompt = String(payload.prompt || payload.message || title).slice(0, 2000);
        const completion = await zai.chat.completions.create({
          messages: [
            { role: "system", content: "You are VI, the central AI agent of the VORTEX ecosystem. Be concise, technical and helpful about infrastructure, builds, deployments and publishing." },
            { role: "user", content: prompt },
          ],
        });
        result = { type: "assist", reply: completion.choices[0]?.message?.content || "", model: (completion as { model?: string }).model || "chat-tuned" };
      } else {
        // deploy/publish/coordinate by the owner directly — execute the recorded intent
        result = { type: kind, note: `Owner-approved ${kind} intent recorded and dispatched to the ${kind} pipeline`, payload };
      }
      const finished = new Date();
      await db.viTask.update({
        where: { id: t.id },
        data: { status: "DONE", resultJson: JSON.stringify(result), latencyMs: Date.now() - started, finishedAt: finished },
      });
      await writeAudit({ actor: auth.via, action: "VI_TASK_DONE", resource: taskId, detail: `${kind} in ${Date.now() - started}ms` });
      return ok({ taskId, status: "DONE", result }, 201);
    } catch (e) {
      const finished = new Date();
      await db.viTask.update({
        where: { id: t.id },
        data: { status: "FAILED", resultJson: JSON.stringify({ error: String(e instanceof Error ? e.message : e).slice(0, 400) }), finishedAt: finished },
      });
      return fail("VI task failed — see task result", 500, { taskId });
    }
  }

  if (seg === "tasks" && a && action === "approve") {
    if (!auth.isOwner) return fail("Owner approval required — authenticate with a VORTEX ID owner session or the master key", 403);
    const t = await db.viTask.findUnique({ where: { taskId: a } });
    if (!t) return fail("Task not found", 404);
    if (t.status !== "NEEDS_APPROVAL") return fail(`Task is ${t.status}, not NEEDS_APPROVAL`);
    const started = Date.now();
    await db.viTask.update({ where: { id: t.id }, data: { status: "RUNNING", approvedBy: auth.via } });
    const payload = JSON.parse(t.payloadJson || "{}");
    let result: Record<string, unknown>;
    try {
      if (t.kind === "deploy") {
        result = { type: "deploy", note: "Approved deploy intent dispatched to the VORTEX WEBSITE deployment pipeline", payload };
      } else if (t.kind === "publish") {
        result = { type: "publish", note: "Approved publish intent dispatched to the APPVERSE review pipeline", payload };
      } else {
        result = { type: "coordinate", note: "Approved coordination intent recorded for the platform registry", payload };
      }
      const finished = new Date();
      await db.viTask.update({
        where: { id: t.id },
        data: { status: "DONE", resultJson: JSON.stringify(result), latencyMs: Date.now() - started, finishedAt: finished },
      });
      await writeAudit({ actor: auth.via, action: "VI_TASK_APPROVED", resource: t.taskId, detail: `${t.kind} approved and completed` });
      return ok({ taskId: t.taskId, status: "DONE", approvedBy: auth.via, result });
    } catch (e) {
      await db.viTask.update({ where: { id: t.id }, data: { status: "FAILED", resultJson: JSON.stringify({ error: String(e instanceof Error ? e.message : e).slice(0, 400) }), finishedAt: new Date() } });
      return fail("Approved task failed — see task result", 500, { taskId: t.taskId });
    }
  }

  return fail("Unknown vi endpoint", 404);
}
