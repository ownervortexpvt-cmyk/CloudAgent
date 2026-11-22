import { db } from "@/lib/db";
import { writeAudit } from "./audit";

/**
 * VORTEX SECURITY — central threat detection (Phase 5).
 *
 * The layer that sits in front of the gateway edge (the one door):
 *   1. IP blocklist — any active block rejects the request instantly.
 *   2. WAF rules — case-insensitive regex over PATH / QUERY / BODY /
 *      USER_AGENT / a named HEADER. BLOCK rejects, LOG records only.
 *   3. DDoS auto-block — repeated rate-limit hits (429) within a short
 *      window auto-block the source IP.
 *
 * blockMode = LOG_ONLY turns 1+2 into an observe mode: hits are
 * recorded but never rejected. Every action lands in SecurityEvent.
 */

export type SecurityCheckInput = {
  path: string; // sub-path after the route segment
  query?: string; // raw query string
  body?: unknown; // parsed JSON body (stringified for matching)
  userAgent?: string | null;
  headers?: Record<string, string>; // lowercase names
  sourceIp: string;
  routeKey?: string;
  appId?: string | null;
};

export type SecurityCheckResult = {
  blocked: boolean;
  reason: string | null;
  wafRuleId?: string | null;
  wafRuleName?: string | null;
  /** event types to record (already persisted by this call) */
};

const BLOCKABLE_STATES = ["MANUAL", "AUTO_WAF", "AUTO_RATE"];

/** Create the singleton policy row if missing. */
export async function getPolicy() {
  const existing = await db.securityPolicy.findUnique({ where: { singleton: "global" } });
  if (existing) return existing;
  return db.securityPolicy.create({ data: { singleton: "global" } });
}

/** Is this IP actively blocked right now? (expired blocks are cleaned lazily) */
export async function findActiveBlock(ip: string) {
  const block = await db.ipBlock.findUnique({ where: { ip } });
  if (!block) return null;
  if (block.expiresAt && block.expiresAt.getTime() < Date.now()) {
    await db.ipBlock.delete({ where: { id: block.id } }).catch(() => {});
    return null;
  }
  return block;
}

export async function recordEvent(data: {
  type: string;
  severity?: string;
  sourceIp?: string | null;
  appId?: string | null;
  routeKey?: string | null;
  action: string;
  detail?: string | null;
}) {
  await db.securityEvent.create({
    data: {
      type: data.type,
      severity: data.severity || "WARNING",
      sourceIp: data.sourceIp ?? null,
      appId: data.appId ?? null,
      routeKey: data.routeKey ?? null,
      action: data.action,
      detail: data.detail ?? null,
    },
  });
}

/** URL-decode a facet before matching (encoding must never hide a payload). */
function tryDecode(value: string): string {
  let out = value;
  for (let i = 0; i < 2; i++) {
    try {
      const next = decodeURIComponent(out);
      if (next === out) break;
      out = next;
    } catch {
      break;
    }
  }
  return out;
}

/** Test one WAF rule against the request facets it watches. */
function ruleMatches(
  rule: { pattern: string; matchIn: string; headerName: string | null },
  input: SecurityCheckInput
): string | null {
  let re: RegExp;
  try {
    re = new RegExp(rule.pattern, "i");
  } catch {
    return null; // a broken rule never blocks
  }
  let haystack: string | null = null;
  switch (rule.matchIn) {
    case "PATH":
      haystack = tryDecode(input.path || "/");
      break;
    case "QUERY":
      haystack = tryDecode(input.query || "");
      break;
    case "BODY":
      haystack = input.body === undefined || input.body === null ? "" : typeof input.body === "string" ? input.body : JSON.stringify(input.body);
      break;
    case "USER_AGENT":
      haystack = input.userAgent || "";
      break;
    case "HEADER":
      haystack = (rule.headerName && input.headers?.[rule.headerName.toLowerCase()]) || "";
      break;
  }
  if (!haystack) return null;
  return re.test(haystack) ? rule.matchIn : null;
}

/**
 * Full edge check: blocklist → WAF. Runs BEFORE gateway auth.
 * Returns blocked=true when the request must be rejected (respecting blockMode).
 */
export async function edgeSecurityCheck(input: SecurityCheckInput): Promise<SecurityCheckResult> {
  const policy = await getPolicy();

  // 1 — IP blocklist
  if (policy.ipBlockEnabled) {
    const block = await findActiveBlock(input.sourceIp);
    if (block) {
      if (policy.blockMode === "BLOCK") {
        await recordEvent({
          type: "IP_BLOCKED",
          severity: "CRITICAL",
          sourceIp: input.sourceIp,
          appId: input.appId ?? null,
          routeKey: input.routeKey ?? null,
          action: "blocked",
          detail: `Active block (${block.source}): ${block.reason}`,
        });
        return { blocked: true, reason: "Source IP is blocked by SECURITY" };
      }
      await recordEvent({
        type: "IP_BLOCKED",
        severity: "INFO",
        sourceIp: input.sourceIp,
        appId: input.appId ?? null,
        routeKey: input.routeKey ?? null,
        action: "logged (LOG_ONLY)",
        detail: `Would block (${block.source}): ${block.reason}`,
      });
    }
  }

  // 2 — WAF rules
  if (policy.wafEnabled) {
    const rules = await db.wafRule.findMany({ where: { enabled: true } });
    for (const rule of rules) {
      const where = ruleMatches(rule, input);
      if (!where) continue;
      await db.wafRule.update({ where: { id: rule.id }, data: { hitCount: { increment: 1 } } });
      const blocking = rule.action === "BLOCK" && policy.blockMode === "BLOCK";
      await recordEvent({
        type: "WAF_BLOCK",
        severity: rule.severity,
        sourceIp: input.sourceIp,
        appId: input.appId ?? null,
        routeKey: input.routeKey ?? null,
        action: blocking ? "blocked" : "logged",
        detail: `Rule "${rule.name}" matched in ${where}${blocking ? "" : " (observe mode)"}`,
      });
      if (blocking) {
        return { blocked: true, reason: `Blocked by WAF rule "${rule.name}"`, wafRuleId: rule.ruleId, wafRuleName: rule.name };
      }
      return { blocked: false, reason: null, wafRuleId: rule.ruleId, wafRuleName: rule.name };
    }
  }

  return { blocked: false, reason: null };
}

/**
 * DDoS shield: called by the gateway when a 429 (rate limit) fires.
 * Counts recent 429s from this IP; past the threshold the IP is
 * auto-blocked and the event is raised to CRITICAL.
 */
export async function noteRateAbuse(sourceIp: string, routeKey: string): Promise<{ autoBlocked: boolean }> {
  const policy = await getPolicy();
  if (!policy.ddosEnabled) return { autoBlocked: false };

  const windowStart = new Date(Date.now() - 5 * 60_000);
  const [recent429, alreadyBlocked] = await Promise.all([
    db.gatewayRequest.count({
      where: { sourceIp, status: 429, createdAt: { gte: windowStart } },
    }),
    findActiveBlock(sourceIp),
  ]);
  if (alreadyBlocked) return { autoBlocked: false };

  await recordEvent({
    type: "RATE_ABUSE",
    severity: recent429 >= policy.ddosThreshold ? "CRITICAL" : "WARNING",
    sourceIp,
    routeKey,
    action: "counting",
    detail: `${recent429}/${policy.ddosThreshold} rate-limit hits in 5 min`,
  });

  if (recent429 >= policy.ddosThreshold) {
    await blockIp({
      ip: sourceIp,
      reason: `Auto-blocked: ${recent429} rate-limit violations in 5 minutes (DDoS shield)`,
      source: "AUTO_RATE",
      createdBy: "security",
      hours: 1, // auto blocks expire; the shield re-blocks if abuse continues
    });
    return { autoBlocked: true };
  }
  return { autoBlocked: false };
}

/** Block an IP (manual or auto). Records the event + audit trail. */
export async function blockIp(data: {
  ip: string;
  reason: string;
  source?: string;
  createdBy?: string;
  hours?: number | null; // null = permanent
}) {
  const ip = data.ip.trim();
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip) && !ip.includes(":")) {
    throw new Error("Invalid IP address");
  }
  const expiresAt =
    data.hours === null || data.hours === undefined
      ? null
      : new Date(Date.now() + data.hours * 3600_000);

  const block = await db.ipBlock.upsert({
    where: { ip },
    update: { reason: data.reason, source: data.source || "MANUAL", expiresAt, createdBy: data.createdBy || null },
    create: { ip, reason: data.reason, source: data.source || "MANUAL", expiresAt, createdBy: data.createdBy || null },
  });

  await recordEvent({
    type: "IP_BLOCKED",
    severity: data.source === "MANUAL" ? "WARNING" : "CRITICAL",
    sourceIp: ip,
    action: expiresAt ? `blocked for ${data.hours}h` : "blocked permanently",
    detail: data.reason,
  });

  if (data.createdBy && data.createdBy !== "security") {
    await writeAudit({
      actor: data.createdBy,
      action: "SECURITY_IP_BLOCKED",
      resource: `security:${ip}`,
      detail: data.reason,
    });
  }
  return block;
}

/** Lift a block. */
export async function unblockIp(ip: string, actor?: string) {
  const block = await db.ipBlock.findUnique({ where: { ip } });
  if (!block) return null;
  await db.ipBlock.delete({ where: { ip } });
  await recordEvent({
    type: "IP_UNBLOCKED",
    severity: "INFO",
    sourceIp: ip,
    action: "unblocked",
    detail: `Previous reason: ${block.reason}`,
  });
  if (actor) {
    await writeAudit({
      actor,
      action: "SECURITY_IP_UNBLOCKED",
      resource: `security:${ip}`,
      detail: "Block lifted",
    });
  }
  return true;
}
