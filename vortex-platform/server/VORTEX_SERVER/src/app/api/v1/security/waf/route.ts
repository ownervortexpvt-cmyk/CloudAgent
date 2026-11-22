import { db } from "@/lib/db";
import { ok, fail, requireSession } from "@/lib/vortex/api";
import { writeAudit } from "@/lib/vortex/audit";
import { ensureSeeded } from "@/lib/vortex/seed";
import { recordEvent } from "@/lib/vortex/security";
import { shortId } from "@/lib/vortex/crypto";

/**
 * WAF RULES — create / toggle / delete custom rules.
 * System (seeded baseline) rules can only be enabled/disabled, never deleted.
 * Patterns are case-insensitive regex; invalid regex is rejected at creation.
 */

const MATCH_IN = ["PATH", "QUERY", "BODY", "USER_AGENT", "HEADER"];

export async function POST(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  let body: {
    name?: string;
    pattern?: string;
    matchIn?: string;
    headerName?: string;
    action?: string;
    severity?: string;
  };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body");
  }

  const name = (body.name || "").trim();
  if (name.length < 3 || name.length > 60) return fail("name must be 3-60 chars");

  const pattern = (body.pattern || "").trim();
  if (!pattern) return fail("pattern is required");
  try {
    new RegExp(pattern, "i");
  } catch (e) {
    return fail(`Invalid regex: ${e instanceof Error ? e.message : "unparseable"}`);
  }
  if (pattern.length > 300) return fail("pattern too long (max 300 chars)");

  const matchIn = (body.matchIn || "QUERY").toUpperCase();
  if (!MATCH_IN.includes(matchIn)) return fail(`matchIn must be one of ${MATCH_IN.join(", ")}`);
  const headerName = matchIn === "HEADER" ? (body.headerName || "").trim().toLowerCase() : null;
  if (matchIn === "HEADER" && !headerName) return fail("headerName is required when matchIn=HEADER");

  const action = body.action || "BLOCK";
  if (!["BLOCK", "LOG"].includes(action)) return fail("action must be BLOCK | LOG");
  const severity = body.severity || "WARNING";
  if (!["CRITICAL", "WARNING", "INFO"].includes(severity)) return fail("severity must be CRITICAL | WARNING | INFO");

  const rule = await db.wafRule.create({
    data: {
      ruleId: shortId("waf", 8),
      name,
      pattern,
      matchIn,
      headerName,
      action,
      severity,
      isSystem: false,
      enabled: true,
    },
  });

  await recordEvent({
    type: "RULE_ADDED",
    severity: "INFO",
    action: `rule added (${action})`,
    detail: `${name} — /${pattern}/i in ${matchIn}`,
  });
  await writeAudit({
    actor: user.email,
    action: "SECURITY_WAF_RULE_ADDED",
    resource: `security:${rule.ruleId}`,
    detail: `${name} /${pattern}/i ${matchIn} ${action}`,
    userId: user.id,
  });

  return ok({ rule }, 201);
}

export async function PATCH(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  let body: { id?: string; enabled?: boolean };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body");
  }
  if (!body.id || typeof body.enabled !== "boolean") return fail("id and enabled are required");

  const rule = await db.wafRule.findUnique({ where: { id: body.id } });
  if (!rule) return fail("Rule not found", 404);

  const updated = await db.wafRule.update({ where: { id: rule.id }, data: { enabled: body.enabled } });
  await writeAudit({
    actor: user.email,
    action: body.enabled ? "SECURITY_WAF_RULE_ENABLED" : "SECURITY_WAF_RULE_DISABLED",
    resource: `security:${rule.ruleId}`,
    detail: rule.name,
    userId: user.id,
  });
  return ok({ rule: updated });
}

export async function DELETE(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return fail("id query param is required");
  const rule = await db.wafRule.findUnique({ where: { id } });
  if (!rule) return fail("Rule not found", 404);
  if (rule.isSystem) return fail("System rules are part of the protected baseline — disable instead of deleting", 403);

  await db.wafRule.delete({ where: { id } });
  await recordEvent({ type: "RULE_REMOVED", severity: "INFO", action: "rule removed", detail: rule.name });
  await writeAudit({
    actor: user.email,
    action: "SECURITY_WAF_RULE_REMOVED",
    resource: `security:${rule.ruleId}`,
    detail: rule.name,
    userId: user.id,
  });
  return ok({ removed: true });
}
