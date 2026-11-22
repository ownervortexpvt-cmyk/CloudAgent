import { db } from "@/lib/db";
import { ok, fail, requireSession } from "@/lib/vortex/api";
import { writeAudit } from "@/lib/vortex/audit";
import { ensureSeeded } from "@/lib/vortex/seed";
import { getPolicy, recordEvent, blockIp, unblockIp, edgeSecurityCheck } from "@/lib/vortex/security";

/**
 * SECURITY MODULE (Phase 5) — state + policy + manual actions.
 * GET  — policy, WAF rules, IP blocks, recent events, 24h stats.
 * PATCH — update the singleton policy (WAF / blocklist / DDoS / mode).
 * POST — { op: "probe" } runs a live self-test through the real WAF.
 */
export async function GET(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;

  const since24h = new Date(Date.now() - 24 * 3600_000);
  const [policy, rules, blocks, events, events24h, wafBlocked24h, activeBlocks] = await Promise.all([
    getPolicy(),
    db.wafRule.findMany({ orderBy: [{ isSystem: "desc" }, { createdAt: "asc" }] }),
    db.ipBlock.findMany({ orderBy: { createdAt: "desc" } }),
    db.securityEvent.findMany({ orderBy: { createdAt: "desc" }, take: 40 }),
    db.securityEvent.count({ where: { createdAt: { gte: since24h } } }),
    db.securityEvent.count({ where: { type: "WAF_BLOCK", createdAt: { gte: since24h } } }),
    db.ipBlock.count(),
  ]);

  return ok({
    policy,
    rules,
    blocks,
    events,
    stats: { events24h, wafBlocked24h, activeBlocks },
  });
}

export async function PATCH(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  let body: {
    wafEnabled?: boolean;
    ipBlockEnabled?: boolean;
    ddosEnabled?: boolean;
    ddosThreshold?: number;
    blockMode?: string;
  };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body");
  }

  const data: Record<string, unknown> = { updatedBy: user.email };
  if (typeof body.wafEnabled === "boolean") data.wafEnabled = body.wafEnabled;
  if (typeof body.ipBlockEnabled === "boolean") data.ipBlockEnabled = body.ipBlockEnabled;
  if (typeof body.ddosEnabled === "boolean") data.ddosEnabled = body.ddosEnabled;
  if (typeof body.ddosThreshold === "number") {
    if (body.ddosThreshold < 5 || body.ddosThreshold > 1000) return fail("ddosThreshold must be 5-1000");
    data.ddosThreshold = Math.round(body.ddosThreshold);
  }
  if (body.blockMode) {
    if (!["BLOCK", "LOG_ONLY"].includes(body.blockMode)) return fail("blockMode must be BLOCK | LOG_ONLY");
    data.blockMode = body.blockMode;
  }

  await getPolicy(); // ensure singleton exists
  const policy = await db.securityPolicy.update({ where: { singleton: "global" }, data });

  await recordEvent({
    type: "POLICY_UPDATED",
    severity: "INFO",
    action: "policy updated",
    detail: `waf=${policy.wafEnabled} blocklist=${policy.ipBlockEnabled} ddos=${policy.ddosEnabled} mode=${policy.blockMode}`,
  });
  await writeAudit({
    actor: user.email,
    action: "SECURITY_POLICY_UPDATED",
    resource: "security:policy",
    detail: `waf=${policy.wafEnabled} blocklist=${policy.ipBlockEnabled} ddos=${policy.ddosEnabled} mode=${policy.blockMode}`,
    userId: user.id,
  });

  return ok({ policy });
}

/** Live self-test: fire a malicious probe through the REAL WAF pipeline. */
export async function POST(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  let body: { op?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  if (body.op !== "probe") return fail("op must be \"probe\"");

  const probeIp = `172.16.99.${1 + Math.floor(Math.random() * 250)}`;
  const result = await edgeSecurityCheck({
    path: "/../../etc/passwd",
    query: "id=1%20OR%201=1",
    userAgent: "sqlmap/1.8 (self-test)",
    sourceIp: probeIp,
    routeKey: "self-test",
  });

  await writeAudit({
    actor: user.email,
    action: "SECURITY_SELF_TEST",
    resource: "security:probe",
    detail: `probe from ${probeIp}: blocked=${result.blocked} reason=${result.reason || "none"}`,
    userId: user.id,
  });

  return ok({
    probe: { sourceIp: probeIp, blocked: result.blocked, reason: result.reason, matchedRule: result.wafRuleName },
    hint: result.blocked ? null : "No enabled BLOCK rule matched — check the WAF rules tab",
  });
}
