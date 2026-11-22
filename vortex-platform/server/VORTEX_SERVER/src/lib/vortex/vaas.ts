import { db } from "@/lib/db";
import { writeAudit } from "./audit";
import { sendMail } from "./mail";
import { hashPassword, verifyPassword, sha256, generateToken, generateOtpCode, shortId } from "./crypto";
import { rateLimit, getClientIp } from "./ratelimit";
import { ensureBucketDir, writeObject, readObject, removeObject, mimeFromPath, objectExists, sha256Of } from "./storage";
import { periodKey } from "./billing";
import { rtEmit, presenceSweep } from "./rt-hub";

/**
 * VORTEX AS A SERVICE (Phase 8) — the public face. The "Firebase's father" layer.
 *
 * The owner's recorded decision: `future.firebase_mode` flips LOCKED → OPEN and
 * the platform becomes a multi-tenant Backend-as-a-Service for everyone, wired
 * into the NEXA AI app builder. Every Firebase capability maps onto REAL
 * Phase 1-7 machinery — nothing is mocked:
 *
 *   Firebase Auth       → VxUser + VxOtp + VxSession      (scrypt, OTP via MAIL)
 *   Firestore           → VxCollection + VxDocument       (server-side rules engine)
 *   Cloud Storage       → real STORAGE buckets (3x replicas, checksummed bytes)
 *   Realtime streams    → VxRealtimeEvent + socket.io fan-out (mini service)
 *   Cloud Functions     → VxFunction runtime (HTTP / EVENT_DOC / EVENT_AUTH / SCHEDULE)
 *   Projects & keys     → VxProject + VxKey (CLIENT config key / ADMIN secret key)
 *   Console accounts    → Developer (public signup while vaas.public_signup = true)
 *
 * Every SDK call is metered (VxUsage) and priced against the EXTERNAL plans
 * that were locked in Phase 7 — the reserve became an offering with zero rewrites.
 */

// ------------------------------------------------------------
// config helpers
// ------------------------------------------------------------

export async function vaasCfg(key: string, fallback: string): Promise<string> {
  const row = await db.appConfig.findUnique({ where: { key } });
  return row?.value || fallback;
}

export function vaasIntCfg(key: string, fallback: number): Promise<number> {
  return vaasCfg(key, String(fallback)).then((v) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  });
}

export async function firebaseGate(): Promise<{ mode: string; updatedAt: Date | null; updatedBy: string | null }> {
  const row = await db.appConfig.findUnique({ where: { key: "future.firebase_mode" } });
  return { mode: row?.value || "LOCKED", updatedAt: row?.updatedAt ?? null, updatedBy: row?.updatedBy ?? null };
}

export async function gateOpen(): Promise<boolean> {
  return (await firebaseGate()).mode !== "LOCKED";
}

/** The owner's flip: LOCKED → OPEN (or back). Always audited. */
export async function flipGate(next: "OPEN" | "LOCKED", actor: string, userId: string) {
  const current = await firebaseGate();
  if (current.mode === next) return { mode: next, changed: false };
  await db.appConfig.upsert({
    where: { key: "future.firebase_mode" },
    update: { value: next, updatedBy: actor, description: `Phase 8 gate: ${next === "OPEN" ? "VAAS is live — public multi-tenant BaaS, NEXA-wired (owner decision)" : "re-locked by owner decision"}` },
    create: { key: "future.firebase_mode", value: next, category: "platform", description: `Phase 8 gate: ${next === "OPEN" ? "VAAS live" : "re-locked"}`, updatedBy: actor },
  });
  await db.appConfig.upsert({
    where: { key: "portal.public_publish" },
    update: { value: next === "OPEN" ? "OPEN" : "LOCKED", updatedBy: actor },
    create: { key: "portal.public_publish", value: next === "OPEN" ? "OPEN" : "LOCKED", category: "portal", description: "Public docs publishing — follows future.firebase_mode", updatedBy: actor },
  });
  await writeAudit({
    actor,
    action: next === "OPEN" ? "FIREBASE_GATE_OPENED" : "FIREBASE_GATE_LOCKED",
    resource: "config:future.firebase_mode",
    detail: `VaaS gate → ${next}: ${next === "OPEN" ? "public multi-tenant BaaS is live (Phase 8)" : "external offering re-locked"}`,
    userId,
  });
  return { mode: next, changed: true };
}

// ------------------------------------------------------------
// VAAS rate card — priced display of project usage (BDT)
// ------------------------------------------------------------

export const VAAS_RATE_CARD = [
  { metric: "VAAS_API", label: "SDK API calls", unit: "10k calls", rateBdt: 1.5, per: 10000 },
  { metric: "VAAS_AUTH", label: "Auth operations", unit: "1k ops", rateBdt: 2, per: 1000 },
  { metric: "VAAS_DOCS", label: "Document writes", unit: "10k writes", rateBdt: 1, per: 10000 },
  { metric: "VAAS_STORAGE_MB", label: "Project storage", unit: "GB-month", rateBdt: 3, per: 1024 },
  { metric: "VAAS_REALTIME", label: "Realtime messages", unit: "10k msgs", rateBdt: 1, per: 10000 },
  { metric: "VAAS_FN", label: "Function invocations", unit: "10k invokes", rateBdt: 4, per: 10000 },
] as const;

// ------------------------------------------------------------
// metering — every SDK operation lands in VxUsage
// ------------------------------------------------------------

export async function meter(projectId: string, metric: string, quantity: number) {
  if (quantity <= 0 || !projectId) return;
  const period = periodKey();
  await db.vxUsage.upsert({
    where: { projectId_metric_period: { projectId, metric, period } },
    update: { quantity: { increment: quantity } },
    create: { projectId, metric, quantity, period },
  });
}

/** Price a VaaS project's usage against an EXTERNAL plan (VAAS rate card). */
export function priceVaasUsage(plan: { monthlyBaseBdt: number; inclApiCalls: number; inclStorageMb: number }, usage: Record<string, number>) {
  const includedMap: Record<string, number> = {
    VAAS_API: plan.inclApiCalls,
    VAAS_STORAGE_MB: plan.inclStorageMb,
  };
  let subtotal = plan.monthlyBaseBdt;
  const lines = VAAS_RATE_CARD.map((r) => {
    const quantity = usage[r.metric] || 0;
    const included = includedMap[r.metric] || 0;
    const billable = Math.max(0, quantity - included);
    const costBdt = Math.ceil((billable / r.per) * r.rateBdt);
    subtotal += costBdt;
    return { metric: r.metric, label: r.label, quantity, unit: r.unit, included, billable, rateBdt: r.rateBdt, per: r.per, costBdt };
  });
  const taxBdt = Math.ceil(subtotal * 0.15); // VAT 15% (Bangladesh)
  return { lines, subtotalBdt: subtotal, taxBdt, totalBdt: subtotal + taxBdt };
}

// ------------------------------------------------------------
// keys — CLIENT (publishable config) / ADMIN (secret, hashed)
// ------------------------------------------------------------

export type CreatedKey = { keyId: string; kind: string; prefix: string; secret?: string };

export async function createVxKey(projectId: string, kind: "CLIENT" | "ADMIN"): Promise<CreatedKey> {
  const keyId = shortId("vxk", 12);
  if (kind === "CLIENT") {
    // Publishable by design (identifies the project, like firebase apiKey).
    // Rules + quotas are enforced server-side, so a leaked client key is safe.
    const secret = `vxk_${generateToken(16)}`;
    const row = await db.vxKey.create({
      data: { keyId, kind, secretHash: secret, prefix: secret.slice(0, 12), projectId },
    });
    return { keyId: row.keyId, kind, prefix: row.prefix, secret };
  }
  const secret = `vxa_${generateToken(24)}`;
  const row = await db.vxKey.create({
    data: { keyId, kind, secretHash: sha256(secret), prefix: secret.slice(0, 12), projectId },
  });
  return { keyId: row.keyId, kind, prefix: row.prefix, secret };
}

export async function resolveProjectKey(keyValue: string | null) {
  if (!keyValue || keyValue.length < 12) return null;
  const row = await db.vxKey.findFirst({
    where: { OR: [{ secretHash: keyValue }, { secretHash: sha256(keyValue) }], status: "ACTIVE" },
    include: { project: true },
  });
  if (!row || row.project.status !== "ACTIVE") return null;
  await db.vxKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
  return row;
}

// ------------------------------------------------------------
// end-user auth (Firebase Auth counterpart)
// ------------------------------------------------------------

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function issueUserSession(userId: string, projectId: string, ip: string, ua: string | null) {
  const token = `vxt_${generateToken(24)}`;
  await db.vxSession.create({
    data: { tokenHash: sha256(token), projectId, userId, ip, userAgent: ua ?? "", expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
  });
  return { token, expiresAt: new Date(Date.now() + SESSION_TTL_MS) };
}

export type VxCaller = {
  project: { id: string; projectId: string; name: string; slug: string };
  key: { keyId: string; kind: string };
  user: { uid: string; email: string; displayName: string; claims: Record<string, unknown> } | null;
};

/** Resolve the SDK caller: project via x-vx-key, end-user via Bearer idToken. */
export async function resolveCaller(req: Request): Promise<VxCaller | null> {
  const keyRow = await resolveProjectKey(req.headers.get("x-vx-key"));
  if (!keyRow) return null;
  const p = keyRow.project;
  const caller: VxCaller = {
    project: { id: p.id, projectId: p.projectId, name: p.name, slug: p.slug },
    key: { keyId: keyRow.keyId, kind: keyRow.kind },
    user: null,
  };
  const authHeader = req.headers.get("authorization") || "";
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token.startsWith("vxt_") && token.length > 20) {
      const sess = await db.vxSession.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
      if (sess && !sess.revoked && sess.expiresAt.getTime() > Date.now() && sess.projectId === p.id && sess.user.status === "ACTIVE") {
        caller.user = {
          uid: sess.user.uid,
          email: sess.user.email,
          displayName: sess.user.displayName,
          claims: safeJson(sess.user.claimsJson, {}),
        };
      }
    }
  }
  return caller;
}

function safeJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Rules engine — server-side, never client-side. */
type Rule = "public" | "auth" | "owner" | "admin";
function ruleAllows(rule: string, caller: VxCaller, ownerUid: string | null, action: "read" | "write"): boolean {
  const r = (["public", "auth", "owner", "admin"].includes(rule) ? rule : "auth") as Rule;
  if (r === "public") return true;
  if (!caller.user) {
    // An ADMIN secret key may bypass user-scoped rules (server jobs, NEXA tooling)
    return caller.key.kind === "ADMIN" && action === "write";
  }
  if (r === "auth") return true;
  if (r === "owner") return action === "read" || caller.user.uid === ownerUid;
  if (r === "admin") return caller.user.claims["role"] === "admin";
  return false;
}

export async function sdkSignup(opts: { caller: VxCaller; email: string; password: string; displayName?: string; ip: string; ua: string | null }) {
  const { caller } = opts;
  if (!caller.project) return { error: "project not resolved" };
  if (!(await gateOpen())) return { error: "VaaS is closed — future.firebase_mode is LOCKED" };
  const authEnabled = caller.project && (await db.vxProject.findUnique({ where: { id: caller.project.id } }))?.authEnabled;
  if (authEnabled === false) return { error: "Auth is disabled for this project" };
  const email = opts.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { error: "Invalid email address" };
  if (opts.password.length < 6) return { error: "Password must be at least 6 characters" };
  const quota = await vaasIntCfg("vaas.doc_quota_per_project", 5000); // user cap mirrors doc quota scale
  const users = await db.vxUser.count({ where: { projectId: caller.project.id } });
  if (users >= quota) return { error: "Project user quota reached — upgrade the plan" };

  const exists = await db.vxUser.findUnique({ where: { projectId_email: { projectId: caller.project.id, email } } });
  if (exists) return { error: "Email already in use for this project" };

  const user = await db.vxUser.create({
    data: {
      uid: shortId("vxu", 10),
      projectId: caller.project.id,
      email,
      passwordHash: hashPassword(opts.password),
      displayName: (opts.displayName || email.split("@")[0]).slice(0, 60),
      provider: "PASSWORD",
      emailVerified: false,
    },
  });
  const { token, expiresAt } = await issueUserSession(user.id, caller.project.id, opts.ip, opts.ua);
  await meter(caller.project.id, "VAAS_AUTH", 1);
  await fireAuthTriggers(caller.project.id, "signup", { uid: user.uid, email: user.email });
  await writeAudit({ actor: `vaas:${caller.project.projectId}`, action: "VAAS_USER_SIGNUP", resource: `vxu:${user.uid}`, detail: email });
  return { uid: user.uid, email: user.email, displayName: user.displayName, idToken: token, expiresAt };
}

export async function sdkLogin(opts: { caller: VxCaller; email: string; password: string; ip: string; ua: string | null }) {
  const email = opts.email.trim().toLowerCase();
  const user = await db.vxUser.findUnique({ where: { projectId_email: { projectId: opts.caller.project.id, email } } });
  if (!user || !user.passwordHash || user.status !== "ACTIVE") return { error: "Invalid email or password" };
  if (!verifyPassword(opts.password, user.passwordHash)) return { error: "Invalid email or password" };
  const { token, expiresAt } = await issueUserSession(user.id, opts.caller.project.id, opts.ip, opts.ua);
  await db.vxUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await meter(opts.caller.project.id, "VAAS_AUTH", 1);
  await fireAuthTriggers(opts.caller.project.id, "login", { uid: user.uid, email: user.email });
  return { uid: user.uid, email: user.email, displayName: user.displayName, idToken: token, expiresAt };
}

/** End-user OTP sign-in: request a 6-digit code delivered through MAIL. */
export async function sdkOtpRequest(opts: { caller: VxCaller; email: string; purpose?: "USER_LOGIN" | "PASSWORD_RESET" }) {
  const email = opts.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { error: "Invalid email address" };
  const purpose = opts.purpose === "PASSWORD_RESET" ? "PASSWORD_RESET" : "USER_LOGIN";
  const code = generateOtpCode();
  await db.vxOtp.create({
    data: {
      email,
      codeHash: sha256(code),
      purpose,
      projectId: opts.caller.project.id,
      expiresAt: new Date(Date.now() + 5 * 60_000),
    },
  });
  const isReset = purpose === "PASSWORD_RESET";
  const res = await sendMail({
    toEmail: email,
    subject: `${opts.caller.project.name} — ${isReset ? "password reset" : "sign-in"} code`,
    body: `Your ${opts.caller.project.name} ${isReset ? "password reset" : "sign-in"} code is ${code}\nIt expires in 5 minutes.\n\nPowered by VORTEX VaaS (dhaka-1).`,
    category: "otp",
    actor: `vaas:${opts.caller.project.projectId}`,
  });
  await meter(opts.caller.project.id, "VAAS_AUTH", 1);
  const devHint = (await vaasCfg("dev.show_otp_in_response", "true")) === "true";
  return { sent: true, delivery: res.status, ...(devHint ? { devCode: code } : {}) };
}

export async function sdkOtpVerify(opts: { caller: VxCaller; email: string; code: string; ip: string; ua: string | null }) {
  const email = opts.email.trim().toLowerCase();
  const otp = await db.vxOtp.findFirst({
    where: { email, purpose: "USER_LOGIN", projectId: opts.caller.project.id, consumed: false, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!otp) return { error: "No valid code — request a new one" };
  if (otp.attempts >= 5) return { error: "Too many attempts — request a new code" };
  if (otp.codeHash !== sha256(opts.code)) {
    await db.vxOtp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    return { error: "Wrong code" };
  }
  await db.vxOtp.update({ where: { id: otp.id }, data: { consumed: true } });

  let user = await db.vxUser.findUnique({ where: { projectId_email: { projectId: opts.caller.project.id, email } } });
  if (!user) {
    if (!(await db.vxProject.findUnique({ where: { id: opts.caller.project.id } }))?.authEnabled) {
      return { error: "Auth is disabled for this project" };
    }
    user = await db.vxUser.create({
      data: {
        uid: shortId("vxu", 10),
        projectId: opts.caller.project.id,
        email,
        displayName: email.split("@")[0].slice(0, 60),
        provider: "OTP",
        emailVerified: true,
      },
    });
    await fireAuthTriggers(opts.caller.project.id, "signup", { uid: user.uid, email: user.email });
  }
  if (user.status !== "ACTIVE") return { error: "This account is disabled" };
  const { token, expiresAt } = await issueUserSession(user.id, opts.caller.project.id, opts.ip, opts.ua);
  await db.vxUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await meter(opts.caller.project.id, "VAAS_AUTH", 1);
  return { uid: user.uid, email: user.email, displayName: user.displayName, idToken: token, expiresAt };
}

export async function sdkMe(caller: VxCaller) {
  if (!caller.user) return { error: "Not signed in" };
  return { uid: caller.user.uid, email: caller.user.email, displayName: caller.user.displayName, claims: caller.user.claims, project: caller.project.projectId };
}

/** v147 — Firebase sendPasswordResetEmail counterpart: verify PASSWORD_RESET
 *  OTP, set the new hash, and revoke EVERY session of that user (security). */
export async function sdkResetPassword(opts: { caller: VxCaller; email: string; code: string; newPassword: string; ip: string; ua: string | null }) {
  const email = opts.email.trim().toLowerCase();
  if (opts.newPassword.length < 6) return { error: "Password must be at least 6 characters" };
  const otp = await db.vxOtp.findFirst({
    where: { email, purpose: "PASSWORD_RESET", projectId: opts.caller.project.id, consumed: false, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!otp) return { error: "No valid reset code — request a new one" };
  if (otp.attempts >= 5) return { error: "Too many attempts — request a new code" };
  if (otp.codeHash !== sha256(opts.code)) {
    await db.vxOtp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    return { error: "Wrong code" };
  }
  await db.vxOtp.update({ where: { id: otp.id }, data: { consumed: true } });
  const user = await db.vxUser.findUnique({ where: { projectId_email: { projectId: opts.caller.project.id, email } } });
  if (!user || user.status !== "ACTIVE") return { error: "Account not found or disabled" };
  await db.vxUser.update({ where: { id: user.id }, data: { passwordHash: hashPassword(opts.newPassword), provider: user.provider === "OTP" ? "PASSWORD" : user.provider } });
  await db.vxSession.updateMany({ where: { userId: user.id, revoked: false }, data: { revoked: true } });
  await meter(opts.caller.project.id, "VAAS_AUTH", 1);
  await fireAuthTriggers(opts.caller.project.id, "password_reset", { uid: user.uid, email: user.email });
  return { reset: true, sessionsRevoked: true, uid: user.uid };
}

/** v147 — Firebase setCustomUserClaims counterpart: ADMIN key sets arbitrary
 *  claims on a project user; the rules engine reads claims for `admin` rules. */
export async function sdkSetClaims(opts: { caller: VxCaller; uid: string; claims: Record<string, unknown> }) {
  if (opts.caller.key.kind !== "ADMIN") return { error: "ADMIN secret key required (vxa_…)", code: 403 };
  const user = await db.vxUser.findFirst({ where: { projectId: opts.caller.project.id, uid: opts.uid } });
  if (!user) return { error: "User not found", code: 404 };
  if (opts.claims && typeof opts.claims === "object" && !Array.isArray(opts.claims)) {
    const merged = { ...safeJson<Record<string, unknown>>(user.claimsJson, {}), ...opts.claims };
    for (const k of Object.keys(opts.claims)) if (opts.claims[k] === null) delete merged[k];
    await db.vxUser.update({ where: { id: user.id }, data: { claimsJson: JSON.stringify(merged) } });
    await writeAudit({ actor: `vaas:${opts.caller.project.projectId}`, action: "VAAS_CLAIMS_SET", resource: `vxu:${opts.uid}`, detail: JSON.stringify(opts.claims).slice(0, 160) });
    return { uid: opts.uid, claims: merged };
  }
  return { error: "claims must be an object" };
}

export async function sdkSignOut(caller: VxCaller, token: string | null) {
  if (!token) return { error: "No token" };
  const res = await db.vxSession.updateMany({ where: { tokenHash: sha256(token) }, data: { revoked: true } });
  return { revoked: res.count > 0 };
}

// ------------------------------------------------------------
// documents — Firestore counterpart with server-side rules
// ------------------------------------------------------------

const COL_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_-]{1,57}$/;

export async function ensureCollection(projectId: string, name: string, rules?: { read?: string; write?: string }) {
  const col = await db.vxCollection.upsert({
    where: { projectId_name: { projectId, name } },
    update: rules?.read || rules?.write ? { readRule: rules?.read ?? undefined, writeRule: rules?.write ?? undefined } : {},
    create: { projectId, name, readRule: rules?.read || "public", writeRule: rules?.write || "auth" },
  });
  return col;
}

type QuerySpec = {
  where?: Record<string, unknown>;
  contains?: Record<string, string>;
  orderBy?: string;
  limit?: number;
  skip?: number;
};

/**
 * v147 FIRESTORE-GRADE QUERY OPERATORS — where values can now be plain
 * values (exact match, backward compatible) OR operator objects:
 *   { gte, lte, gt, lt, ne, eq, in, nin, exists }
 *   ?where={"priority":{"gte":2},"done":{"ne":true},"tag":{"in":["a","b"]}}
 * Comparable ops are numeric for numbers, lexicographic for strings,
 * 0/1 for booleans; anything else (or a missing field) never matches —
 * same semantics Firestore applies to typed comparisons.
 */
function cmpValues(a: unknown, b: unknown): number | null {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === "boolean" && typeof b === "boolean") return (a ? 1 : 0) - (b ? 1 : 0);
  return null;
}

const WHERE_OPS = ["eq", "ne", "gt", "gte", "lt", "lte", "in", "nin", "exists"] as const;

function fieldMatches(value: unknown, cond: unknown): boolean {
  if (cond === null || typeof cond !== "object" || Array.isArray(cond)) return value === cond;
  const c = cond as Record<string, unknown>;
  const hasOp = WHERE_OPS.some((op) => op in c);
  if (!hasOp) return value === cond; // plain object — strict equality
  if ("exists" in c) {
    const want = Boolean(c.exists);
    const has = value !== undefined;
    if (has !== want) return false;
  }
  if ("eq" in c && value !== c.eq) return false;
  if ("ne" in c && value === c.ne) return false;
  if ("in" in c && !(Array.isArray(c.in) && (c.in as unknown[]).some((v) => v === value))) return false;
  if ("nin" in c && (Array.isArray(c.nin) && (c.nin as unknown[]).some((v) => v === value))) return false;
  for (const op of ["gt", "gte", "lt", "lte"] as const) {
    if (op in c) {
      const cRes = cmpValues(value, c[op]);
      if (cRes === null) return false;
      if (op === "gt" && !(cRes > 0)) return false;
      if (op === "gte" && !(cRes >= 0)) return false;
      if (op === "lt" && !(cRes < 0)) return false;
      if (op === "lte" && !(cRes <= 0)) return false;
    }
  }
  return true;
}

function docMatches(doc: Record<string, unknown>, q: QuerySpec): boolean {
  if (q.where) {
    for (const [k, v] of Object.entries(q.where)) if (!fieldMatches(doc[k], v)) return false;
  }
  if (q.contains) {
    for (const [k, v] of Object.entries(q.contains)) {
      const hay = typeof doc[k] === "string" ? (doc[k] as string) : JSON.stringify(doc[k] ?? "");
      if (!hay.toLowerCase().includes(String(v).toLowerCase())) return false;
    }
  }
  return true;
}

export async function docList(opts: { caller: VxCaller; collection: string; query: QuerySpec }) {
  const col = await db.vxCollection.findUnique({ where: { projectId_name: { projectId: opts.caller.project.id, name: opts.collection } } });
  if (!col || col.status !== "ACTIVE") return { error: `Collection "${opts.collection}" not found` };
  if (!ruleAllows(col.readRule, opts.caller, null, "read")) return { error: "Permission denied by collection rules", code: 403 };
  const rows = await db.vxDocument.findMany({ where: { collectionId: col.id }, orderBy: { updatedAt: "desc" } });
  let items = rows.map((r) => ({ id: r.docId, ...safeJson<Record<string, unknown>>(r.dataJson, {}), _createdAt: r.createdAt, _updatedAt: r.updatedAt, _ownerUid: r.ownerUid }));
  items = items.filter((d) => docMatches(d, opts.query));
  if (opts.query.orderBy) {
    const field = opts.query.orderBy.replace(/^-/, "");
    const desc = opts.query.orderBy.startsWith("-");
    items.sort((a, b) => {
      const av = a[field], bv = b[field];
      const c = typeof av === "number" && typeof bv === "number" ? av - bv : String(av ?? "").localeCompare(String(bv ?? ""));
      return desc ? -c : c;
    });
  }
  const skip = Math.max(0, opts.query.skip || 0);
  const limit = Math.min(Math.max(1, opts.query.limit || 50), 200);
  return { items: items.slice(skip, skip + limit).map(({ _ownerUid, ...rest }) => rest), total: items.length };
}

export async function docGet(opts: { caller: VxCaller; collection: string; docId: string }) {
  const col = await db.vxCollection.findUnique({ where: { projectId_name: { projectId: opts.caller.project.id, name: opts.collection } } });
  if (!col) return { error: `Collection "${opts.collection}" not found` };
  const row = await db.vxDocument.findFirst({ where: { collectionId: col.id, docId: opts.docId } });
  if (!row) return { error: "Document not found", code: 404 };
  if (!ruleAllows(col.readRule, opts.caller, row.ownerUid, "read")) return { error: "Permission denied by collection rules", code: 403 };
  return { id: row.docId, ...safeJson<Record<string, unknown>>(row.dataJson, {}), _createdAt: row.createdAt, _updatedAt: row.updatedAt };
}

export async function docAdd(opts: { caller: VxCaller; collection: string; data: Record<string, unknown>; ip: string }) {
  const col = await db.vxCollection.findUnique({ where: { projectId_name: { projectId: opts.caller.project.id, name: opts.collection } } });
  if (!col || col.status !== "ACTIVE") return { error: `Collection "${opts.collection}" not found` };
  if (!ruleAllows(col.writeRule, opts.caller, null, "write")) return { error: "Permission denied by collection rules", code: 403 };
  const quota = await vaasIntCfg("vaas.doc_quota_per_project", 5000);
  if (col.docCount >= quota) return { error: "Project document quota reached — upgrade the plan" };
  const size = JSON.stringify(opts.data).length;
  if (size > 100_000) return { error: "Document too large (100 KB max)" };
  const row = await db.vxDocument.create({
    data: {
      docId: shortId("vxd", 10),
      collectionId: col.id,
      projectId: opts.caller.project.id,
      ownerUid: opts.caller.user?.uid ?? null,
      dataJson: JSON.stringify(opts.data),
    },
  });
  await db.vxCollection.update({ where: { id: col.id }, data: { docCount: { increment: 1 }, sizeBytes: { increment: size } } });
  await meter(opts.caller.project.id, "VAAS_DOCS", 1);
  const doc = { id: row.docId, ...opts.data };
  await fireDocTriggers(opts.caller.project.id, opts.collection, "create", doc);
  await rtPublishInternal({ projectId: opts.caller.project.projectId, channel: `col:${opts.collection}`, type: "doc-change", payload: { op: "create", doc }, emittedBy: "system" });
  return doc;
}

export async function docUpdate(opts: { caller: VxCaller; collection: string; docId: string; data: Record<string, unknown>; patch: boolean; ip: string }) {
  const col = await db.vxCollection.findUnique({ where: { projectId_name: { projectId: opts.caller.project.id, name: opts.collection } } });
  if (!col) return { error: `Collection "${opts.collection}" not found` };
  const row = await db.vxDocument.findFirst({ where: { collectionId: col.id, docId: opts.docId } });
  if (!row) return { error: "Document not found", code: 404 };
  if (!ruleAllows(col.writeRule, opts.caller, row.ownerUid, "write")) return { error: "Permission denied by collection rules", code: 403 };
  const current = safeJson<Record<string, unknown>>(row.dataJson, {});
  const next = opts.patch ? { ...current, ...opts.data } : opts.data;
  const size = JSON.stringify(next).length;
  if (size > 100_000) return { error: "Document too large (100 KB max)" };
  const updated = await db.vxDocument.update({
    where: { id: row.id },
    data: { dataJson: JSON.stringify(next), version: { increment: 1 } },
  });
  // v-fix: `current` is a parsed object — `.length` is undefined → increment NaN
  // → PrismaClientValidationError (500 after a SUCCESSFUL write). Measure the
  // previous JSON string length instead, clamped at 0.
  await db.vxCollection.update({ where: { id: col.id }, data: { sizeBytes: { increment: Math.max(0, size - JSON.stringify(current).length) } } });
  await meter(opts.caller.project.id, "VAAS_DOCS", 1);
  const doc = { id: updated.docId, ...next };
  await fireDocTriggers(opts.caller.project.id, opts.collection, "update", doc);
  await rtPublishInternal({ projectId: opts.caller.project.projectId, channel: `col:${opts.collection}`, type: "doc-change", payload: { op: "update", doc }, emittedBy: "system" });
  return doc;
}

export async function docDelete(opts: { caller: VxCaller; collection: string; docId: string; ip: string }) {
  const col = await db.vxCollection.findUnique({ where: { projectId_name: { projectId: opts.caller.project.id, name: opts.collection } } });
  if (!col) return { error: `Collection "${opts.collection}" not found` };
  const row = await db.vxDocument.findFirst({ where: { collectionId: col.id, docId: opts.docId } });
  if (!row) return { error: "Document not found", code: 404 };
  if (!ruleAllows(col.writeRule, opts.caller, row.ownerUid, "write")) return { error: "Permission denied by collection rules", code: 403 };
  await db.vxDocument.delete({ where: { id: row.id } });
  await db.vxCollection.update({ where: { id: col.id }, data: { docCount: { decrement: 1 }, sizeBytes: { decrement: row.dataJson.length } } });
  await meter(opts.caller.project.id, "VAAS_DOCS", 1);
  const doc = { id: row.docId, ...safeJson<Record<string, unknown>>(row.dataJson, {}) };
  await fireDocTriggers(opts.caller.project.id, opts.collection, "delete", doc);
  await rtPublishInternal({ projectId: opts.caller.project.projectId, channel: `col:${opts.collection}`, type: "doc-change", payload: { op: "delete", doc }, emittedBy: "system" });
  return { deleted: row.docId };
}

// ------------------------------------------------------------
// storage — rides the REAL Phase 4 engine (3x replicas, checksums)
// ------------------------------------------------------------

export async function projectBucket(projectId: string) {
  let bucket = await db.storageBucket.findFirst({ where: { projectId } });
  if (bucket) return bucket;
  const project = await db.vxProject.findUnique({ where: { id: projectId } });
  if (!project) return null;
  const volume = (await db.storageVolume.findMany({ where: { status: "READ_WRITE" }, orderBy: { name: "asc" } }))[0];
  if (!volume) return null;
  const name = `vx-${project.slug}`.slice(0, 30);
  bucket = await db.storageBucket.create({
    data: {
      bucketId: shortId("bkt", 10),
      name,
      projectId,
      volumeId: volume.id,
      storageClass: "HOT",
      replicationFactor: 3,
      quotaMb: await vaasIntCfg("vaas.storage_quota_mb_per_project", 2048),
      status: "ACTIVE",
      createdBy: "vaas",
    },
  });
  ensureBucketDir(volume.name, bucket.name);
  return bucket;
}

export async function vaasUpload(opts: { caller: VxCaller; path: string; contentB64: string; mime?: string; ownerUid?: string | null }) {
  const bucket = await projectBucket(opts.caller.project.id);
  if (!bucket || bucket.status !== "ACTIVE") return { error: "Project bucket unavailable" };
  const cleanPath = opts.path.replace(/\\/g, "/").split("/").map((s) => s.trim()).filter(Boolean).join("/");
  if (!cleanPath || cleanPath.includes("..")) return { error: "Invalid object path" };
  const maxMb = await vaasIntCfg("vaas.max_upload_mb", 5);
  const buf = Buffer.from(opts.contentB64 || "", "base64");
  if (buf.length === 0) return { error: "Empty upload" };
  if (buf.length > maxMb * 1_000_000) return { error: `Upload exceeds ${maxMb} MB limit` };
  const used = bucket.usedMb + Math.ceil(buf.length / 1_000_000);
  if (used > bucket.quotaMb) return { error: "Project storage quota exceeded — upgrade the plan" };
  const volume = await db.storageVolume.findUnique({ where: { id: bucket.volumeId || "" } });
  if (!volume) return { error: "Storage volume offline" };
  const stored = writeObject(volume.name, bucket.name, cleanPath, buf);
  const existing = await db.vxFile.findUnique({ where: { bucketId_path: { bucketId: bucket.id, path: cleanPath } } });
  const file = existing
    ? await db.vxFile.update({ where: { id: existing.id }, data: { sizeBytes: stored.sizeBytes, checksum: stored.checksum, mime: opts.mime || mimeFromPath(cleanPath), ownerUid: opts.ownerUid ?? existing.ownerUid } })
    : await db.vxFile.create({
        data: {
          fileId: shortId("vxfile", 10),
          projectId: opts.caller.project.id,
          bucketId: bucket.id,
          path: cleanPath,
          mime: opts.mime || mimeFromPath(cleanPath),
          sizeBytes: stored.sizeBytes,
          checksum: stored.checksum,
          ownerUid: opts.ownerUid ?? null,
        },
      });
  if (!existing) {
    await db.storageBucket.update({ where: { id: bucket.id }, data: { objectCount: { increment: 1 } } });
  }
  await db.storageBucket.update({ where: { id: bucket.id }, data: { usedMb: used } });
  await meter(opts.caller.project.id, "VAAS_STORAGE_MB", Math.max(1, Math.ceil(buf.length / 1_000_000)));
  return { fileId: file.fileId, path: file.path, sizeBytes: file.sizeBytes, mime: file.mime, checksum: file.checksum, bucket: bucket.name };
}

export async function vaasDownload(opts: { caller: VxCaller; fileId?: string; path?: string }) {
  const bucket = await projectBucket(opts.caller.project.id);
  if (!bucket) return { error: "Project bucket unavailable" };
  const volume = await db.storageVolume.findUnique({ where: { id: bucket.volumeId || "" } });
  if (!volume) return { error: "Storage volume offline" };
  const file = opts.fileId
    ? await db.vxFile.findFirst({ where: { fileId: opts.fileId, projectId: opts.caller.project.id } })
    : opts.path
      ? await db.vxFile.findUnique({ where: { bucketId_path: { bucketId: bucket.id, path: opts.path } } })
      : null;
  if (!file) return { error: "File not found", code: 404 };
  if (!objectExists(volume.name, bucket.name, file.path)) return { error: "Object bytes missing on volume", code: 410 };
  const bytes = readObject(volume.name, bucket.name, file.path);
  if (sha256Of(bytes) !== file.checksum) return { error: "Checksum mismatch — object corrupted (detected, not silent)", code: 409 };
  return { file, bytes };
}

export async function vaasListFiles(caller: VxCaller) {
  const bucket = await projectBucket(caller.project.id);
  if (!bucket) return { error: "Project bucket unavailable" };
  const files = await db.vxFile.findMany({ where: { projectId: caller.project.id }, orderBy: { updatedAt: "desc" } });
  return { bucket: { name: bucket.name, quotaMb: bucket.quotaMb, usedMb: bucket.usedMb }, files };
}

export async function vaasDeleteFile(opts: { caller: VxCaller; fileId: string }) {
  const bucket = await projectBucket(opts.caller.project.id);
  if (!bucket) return { error: "Project bucket unavailable" };
  const volume = await db.storageVolume.findUnique({ where: { id: bucket.volumeId || "" } });
  const file = await db.vxFile.findFirst({ where: { fileId: opts.fileId, projectId: opts.caller.project.id } });
  if (!file) return { error: "File not found", code: 404 };
  if (volume) removeObject(volume.name, bucket.name, file.path);
  await db.vxFile.delete({ where: { id: file.id } });
  await db.storageBucket.update({ where: { id: bucket.id }, data: { objectCount: { decrement: 1 } } });
  return { deleted: file.fileId };
}

// ------------------------------------------------------------
// realtime — persisted events + socket.io fan-out
// ------------------------------------------------------------

const RT_PORT = process.env.VX_REALTIME_HTTP_PORT || "3006"; // raw /emit door of the realtime mini service

type RtPublish = { projectId: string; channel: string; type: string; payload?: Record<string, unknown>; emittedBy?: string };

export async function rtPublishInternal(opts: RtPublish) {
  const project = await db.vxProject.findUnique({ where: { projectId: opts.projectId } });
  if (!project || project.status !== "ACTIVE" || !project.rtEnabled) return { error: "Realtime disabled for this project" };
  const channel = opts.channel.trim().slice(0, 80);
  if (!channel) return { error: "Channel required" };
  const event = await db.vxRealtimeEvent.create({
    data: {
      eventId: shortId("rte", 10),
      projectId: project.id,
      channel,
      type: opts.type.slice(0, 40),
      payloadJson: JSON.stringify(opts.payload || {}),
      emittedBy: opts.emittedBy || "sdk",
    },
  });
  await meter(project.id, "VAAS_REALTIME", 1);
  // v145 TRUE push — in-process fan-out to every open SSE stream (sub-ms).
  // The /emit door below stays as the cross-process fallback.
  try {
    rtEmit({
      projectId: project.projectId,
      projectDbId: project.id,
      channel,
      type: event.type,
      payload: opts.payload || {},
      eventId: event.eventId,
      at: event.createdAt.toISOString(),
      emittedBy: opts.emittedBy || "sdk",
    });
  } catch {
    // hub is best-effort — events remain pollable from the DB
  }
  // prune history (keep the tail)
  const hist = await vaasIntCfg("vaas.rt_history_per_project", 200);
  const count = await db.vxRealtimeEvent.count({ where: { projectId: project.id } });
  if (count > hist) {
    const old = await db.vxRealtimeEvent.findMany({ where: { projectId: project.id }, orderBy: { createdAt: "asc" }, take: count - hist });
    await db.vxRealtimeEvent.deleteMany({ where: { id: { in: old.map((e) => e.id) } } });
  }
  // best-effort live fan-out to the socket.io mini service
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 700);
    await fetch(`http://127.0.0.1:${RT_PORT}/emit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: project.projectId, channel, type: event.type, payload: opts.payload || {}, eventId: event.eventId, at: event.createdAt }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
  } catch {
    // mini service may not be running — events remain pollable from the DB
  }
  return { eventId: event.eventId, channel, type: event.type };
}

export async function rtRecent(projectDbId: string, channel?: string, take = 30) {
  return db.vxRealtimeEvent.findMany({
    where: { projectId: projectDbId, ...(channel ? { channel } : {}) },
    orderBy: { createdAt: "desc" },
    take: Math.min(take, 100),
  });
}

// ------------------------------------------------------------
// functions — Cloud Functions counterpart (sandboxed, timed)
// ------------------------------------------------------------

const FN_BAN = /\b(process|globalThis|require|import|eval|Function|constructor|__proto__|fs|child_process|net|http\.request)\b/;

export async function fnCreate(opts: { projectId: string; name: string; trigger: string; eventConfig?: Record<string, unknown>; code: string }) {
  if (!/^[a-zA-Z][a-zA-Z0-9_]{1,48}$/.test(opts.name)) return { error: "Function name must be [a-zA-Z0-9_], 2-49 chars" };
  if (!["HTTP", "EVENT_DOC", "EVENT_AUTH", "SCHEDULE"].includes(opts.trigger)) return { error: "Invalid trigger" };
  if (FN_BAN.test(opts.code)) return { error: "Code contains a banned token (process/require/eval/Function/…)" };
  const max = await vaasIntCfg("vaas.fn_max_per_project", 10);
  const count = await db.vxFunction.count({ where: { projectId: opts.projectId } });
  if (count >= max) return { error: `Project function quota reached (${max})` };
  const exists = await db.vxFunction.findUnique({ where: { projectId_name: { projectId: opts.projectId, name: opts.name } } });
  if (exists) return { error: `Function "${opts.name}" already exists` };
  const fn = await db.vxFunction.create({
    data: {
      fnId: shortId("vxfn", 10),
      projectId: opts.projectId,
      name: opts.name,
      trigger: opts.trigger,
      eventConfig: JSON.stringify(opts.eventConfig || {}),
      code: opts.code,
    },
  });
  await writeAudit({ actor: "vaas", action: "VAAS_FN_CREATED", resource: `vxfn:${fn.fnId}`, detail: `${opts.name} (${opts.trigger})` });
  return { fnId: fn.fnId, name: fn.name };
}

type FnCtx = {
  payload: unknown;
  user: unknown;
  project: { projectId: string; name: string };
  log: (...args: unknown[]) => void;
  db: {
    add: (collection: string, data: Record<string, unknown>) => Promise<unknown>;
    list: (collection: string, query?: QuerySpec) => Promise<unknown>;
    update: (collection: string, docId: string, data: Record<string, unknown>) => Promise<unknown>;
    remove: (collection: string, docId: string) => Promise<unknown>;
  };
  realtime: { publish: (channel: string, type: string, payload?: Record<string, unknown>) => Promise<unknown> };
  now: number;
};

/** Run a function with a ctx that speaks the same API as the SDK. */
export async function invokeFunction(opts: {
  fn: { id: string; name: string; code: string; projectId: string; trigger: string };
  trigger: "HTTP" | "EVENT" | "SCHEDULE";
  payload?: unknown;
  user?: unknown;
}) {
  const started = Date.now();
  const logs: string[] = [];
  const project = await db.vxProject.findUnique({ where: { id: opts.fn.projectId } });
  const ctx: FnCtx = {
    payload: opts.payload ?? {},
    user: opts.user ?? null,
    project: { projectId: project?.projectId || "", name: project?.name || "" },
    log: (...args: unknown[]) => {
      if (logs.length < 40) logs.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ").slice(0, 200));
    },
    db: {
      add: (c, d) => docAdd({ caller: adminCallerSync, collection: c, data: d, ip: "fn" }),
      list: (c, q) => docList({ caller: adminCallerSync, collection: c, query: q || {} }),
      update: (c, id, d) => docUpdate({ caller: adminCallerSync, collection: c, docId: id, data: d, patch: true, ip: "fn" }),
      remove: (c, id) => docDelete({ caller: adminCallerSync, collection: c, docId: id, ip: "fn" }),
    },
    realtime: {
      publish: (ch, t, p) => rtPublishInternal({ projectId: project?.projectId || "", channel: ch, type: t, payload: p, emittedBy: "fn" }),
    },
    now: Date.now(),
  };
  const timeoutMs = await vaasIntCfg("vaas.fn_timeout_ms", 3000);
  /** Internal caller for the fn runtime: ADMIN semantics on THIS project (db access from ctx). */
  const adminCallerSync: VxCaller = {
    project: { id: opts.fn.projectId, projectId: project?.projectId || "", name: project?.name || "", slug: project?.slug || "" },
    key: { keyId: "fn-runtime", kind: "ADMIN" },
    user: null,
  };
  let status = "OK";
  let output: unknown;
  let error: string | null = null;
  try {
    // v147 ROOT-FIX — dual-mode fn compiler.
    // The old wrapper treated EVERY deploy as bare statements inside an async
    // IIFE, so the documented Firebase-style `export default async function
    // handler(ctx)` (and CJS `module.exports`) deployments crashed at compile
    // time with "Unexpected token 'export'". Now the code STYLE decides the
    // mode: explicit handler exports (ES/CJS/named) run in MODULE mode;
    // bare-statement code (welcome fn and all pre-v147 deploys) keeps the
    // legacy IIFE mode — each mode executes user code exactly ONCE.
    const MODULE_STYLE = /export\s+default|module\.exports|exports\.handler|function\s+handler\s*\(|(const|let|var)\s+handler\s*=/.test(opts.fn.code);
    const timeoutP = new Promise((_, rej) => setTimeout(() => rej(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs));
    const normalized = opts.fn.code
      .replace(/^\s*export\s+default\s+/m, "const __vx_default = ")
      .replace(/^\s*export\s+(async\s+function|function)\s+/m, "const __vx_default = $1")
      .replace(/^\s*export\s+(const|let|var|class)\s+/gm, "$1");
    const exec = (async () => {
      if (MODULE_STYLE) {
        // MODULE mode — resolve callable, never re-run bare statements.
        const factory = new Function("ctx", `"use strict";
          const module = { exports: {} };
          const exports = module.exports;
          ${normalized}
          const __cands = [
            typeof __vx_default !== "undefined" ? __vx_default : undefined,
            typeof handler === "function" ? handler : undefined,
            module.exports, module.exports && module.exports.handler,
          ];
          const __fn = __cands.find((c) => typeof c === "function");
          if (!__fn) throw new Error("NO_HANDLER");
          return Promise.resolve(__fn(ctx));
        `);
        return await Promise.race([factory(ctx), timeoutP]);
      }
      // IIFE mode (legacy bare statements: `return { ok: true };` style)
      const factory = new Function("ctx", `"use strict";return (async () => {${opts.fn.code}\n})();`);
      return await Promise.race([factory(ctx), timeoutP]);
    })();
    // v147 — a late user-code failure AFTER the timeout already won must never
    // surface as an unhandled promise rejection (Node would kill the server).
    Promise.resolve(exec).catch(() => undefined);
    output = await Promise.race([exec, timeoutP]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    error = msg.slice(0, 500);
    status = msg.startsWith("Timeout") ? "TIMEOUT" : "ERROR";
  }
  const latencyMs = Date.now() - started;
  await db.vxFunctionRun.create({
    data: {
      runId: shortId("fxr", 10),
      fnId: opts.fn.id,
      trigger: opts.trigger,
      status,
      latencyMs,
      inputJson: JSON.stringify(opts.payload ?? {}).slice(0, 2000),
      outputJson: output === undefined ? null : JSON.stringify(output).slice(0, 4000),
      error,
    },
  });
  await db.vxFunction.update({
    where: { id: opts.fn.id },
    data: { invocations: { increment: 1 }, lastRunAt: new Date(), ...(status !== "OK" ? { fails: { increment: 1 }, lastError: error, status: "ERROR" } : { status: "ACTIVE", lastError: null }) },
  });
  await meter(project?.id || "", "VAAS_FN", 1);
  if (status !== "OK" && error) {
    await writeAudit({ actor: "vaas", action: "VAAS_FN_ERROR", resource: `vxfn:${opts.fn.name}`, detail: error.slice(0, 160) });
  }
  return { status, latencyMs, output, error, logs };
}

async function fireDocTriggers(projectDbId: string, collection: string, op: string, doc: unknown) {
  if (!(await db.vxProject.findUnique({ where: { id: projectDbId } }))?.fnEnabled) return;
  const fns = await db.vxFunction.findMany({ where: { projectId: projectDbId, trigger: "EVENT_DOC", status: "ACTIVE" } });
  for (const fn of fns) {
    const cfg = safeJson<{ collection?: string; op?: string }>(fn.eventConfig, {});
    if (cfg.collection && cfg.collection !== collection) continue;
    if (cfg.op && cfg.op !== op) continue;
    await invokeFunction({ fn, trigger: "EVENT", payload: { op, collection, doc } });
  }
}

async function fireAuthTriggers(projectDbId: string, event: string, user: Record<string, string>) {
  const project = await db.vxProject.findUnique({ where: { id: projectDbId } });
  if (!project?.fnEnabled) return;
  const fns = await db.vxFunction.findMany({ where: { projectId: projectDbId, trigger: "EVENT_AUTH", status: "ACTIVE" } });
  for (const fn of fns) {
    await invokeFunction({ fn, trigger: "EVENT", payload: { event, user } });
  }
}

/** SCHEDULE tick — called from vaasState() like BACKUP's runDuePolicies. */
export async function runDueScheduledFns() {
  const fns = await db.vxFunction.findMany({ where: { trigger: "SCHEDULE", status: { in: ["ACTIVE", "ERROR"] } } });
  let ran = 0;
  for (const fn of fns) {
    const cfg = safeJson<{ intervalSec?: number }>(fn.eventConfig, {});
    const intervalSec = Math.max(60, cfg.intervalSec || 300);
    const dueAt = fn.lastRunAt ? fn.lastRunAt.getTime() + intervalSec * 1000 : 0;
    if (Date.now() < dueAt) continue;
    const project = await db.vxProject.findUnique({ where: { id: fn.projectId } });
    if (!project || project.status !== "ACTIVE" || !project.fnEnabled) continue;
    await invokeFunction({ fn, trigger: "SCHEDULE", payload: { at: new Date().toISOString() } });
    ran += 1;
  }
  return { ran };
}

// ------------------------------------------------------------
// provisioning — projects, and the NEXA AI builder one-call backend
// ------------------------------------------------------------

const SLUG_RE = /^[a-z0-9][a-z0-9-]{2,38}$/;

export async function provisionProject(opts: {
  name: string;
  developerId: string;
  collections?: { name: string; read?: string; write?: string }[];
  region?: string;
  viaNexa?: boolean;
  actor: string;
}) {
  const name = opts.name.trim();
  if (name.length < 2) return { error: "Project name is too short" };
  let slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 38);
  if (!SLUG_RE.test(slug)) slug = `p-${shortId("x", 6).replace("x_", "")}`;
  if (await db.vxProject.findUnique({ where: { slug } })) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;

  const maxProjects = await vaasIntCfg("vaas.max_projects_per_dev", 10);
  const count = await db.vxProject.count({ where: { developerId: opts.developerId } });
  if (count >= maxProjects) return { error: `Developer project quota reached (${maxProjects})` };

  const project = await db.vxProject.create({
    data: {
      projectId: shortId("vxproj", 10),
      name,
      slug,
      developerId: opts.developerId,
      region: opts.region || "dhaka-1",
      viaNexa: opts.viaNexa ?? false,
    },
  });

  for (const c of opts.collections || []) {
    if (COL_NAME_RE.test(c.name)) await ensureCollection(project.id, c.name, { read: c.read, write: c.write });
  }
  await projectBucket(project.id);
  const client = await createVxKey(project.id, "CLIENT");
  const admin = await createVxKey(project.id, "ADMIN");

  await writeAudit({
    actor: opts.actor,
    action: opts.viaNexa ? "VAAS_NEXA_PROVISION" : "VAAS_PROJECT_CREATED",
    resource: `vxproj:${project.projectId}`,
    detail: `${name} (${slug}) · ${opts.collections?.length || 0} collections · CLIENT+ADMIN keys issued`,
  });
  return {
    projectId: project.projectId,
    id: project.id,
    name,
    slug,
    clientKey: client.secret,
    adminKey: admin.secret,
    collections: (opts.collections || []).map((c) => c.name),
  };
}

export type NexaProvision = Awaited<ReturnType<typeof provisionProject>>;

/** ONE call from the AI app builder = a complete production backend. */
export async function nexaProvision(opts: { appName: string; collections?: { name: string; read?: string; write?: string }[]; withWelcomeFn?: boolean; actor: string }) {
  if (!(await gateOpen())) return { error: "VaaS is closed — future.firebase_mode is LOCKED" } as const;
  const nexaDev = await db.developer.findUnique({ where: { email: "nexa@vortex.local" } });
  if (!nexaDev) return { error: "NEXA builder identity missing — seed first" } as const;

  const collections = opts.collections?.length
    ? opts.collections
    : [{ name: "posts", read: "public", write: "auth" }, { name: "profile", read: "auth", write: "owner" }];
  const provisioned = await provisionProject({ name: opts.appName, developerId: nexaDev.id, collections, viaNexa: true, actor: opts.actor });
  if ("error" in provisioned) return provisioned as { error: string };

  if (opts.withWelcomeFn !== false) {
    await fnCreate({
      projectId: provisioned.id,
      name: "onUserWelcome",
      trigger: "EVENT_AUTH",
      code: [
        "// EVENT_AUTH trigger — fires on signup + login (VORTEX VaaS fn runtime)",
        "if (ctx.payload.event === 'signup') {",
        "  await ctx.db.add('posts', {",
        "    kind: 'welcome',",
        "    forUid: ctx.payload.user.uid,",
        "    message: 'Welcome to ' + ctx.project.name + '!',",
        "    createdAt: ctx.now",
        "  });",
        "  await ctx.realtime.publish('presence', 'welcome', { uid: ctx.payload.user.uid });",
        "}",
        "return { ok: true };",
      ].join("\n"),
    });
  }

  const snippet = sdkSnippet({ appName: opts.appName, projectId: provisioned.projectId, clientKey: provisioned.clientKey || "" });
  return { ...provisioned, snippet };
}

export function sdkSnippet(o: { appName: string; projectId: string; clientKey: string }): string {
  return [
    `<script src="/vortex-sdk.js"></script>`,
    `<script>`,
    `  // ${o.appName} — powered by VORTEX VaaS (dhaka-1)`,
    `  const vx = Vortex.initializeApp({`,
    `    projectId: "${o.projectId}",`,
    `    clientKey: "${o.clientKey}",`,
    `    apiUrl: "/api/vaas/v1"`,
    `  });`,
    ``,
    `  // Auth`,
    `  await vx.auth().signUp("user@example.com", "secret123", "Rahim");`,
    `  await vx.auth().signIn("user@example.com", "secret123");`,
    ``,
    `  // Data (Firestore-style, server-side rules)`,
    `  await vx.data().collection("posts").add({ title: "Hello VORTEX", likes: 0 });`,
    `  const posts = await vx.data().collection("posts").where("likes", ">=", 1).orderBy("-createdAt").get();`,
    ``,
    `  // Storage (real bytes, 3x replicas)`,
    `  await vx.storage().uploadText("notes/day1.txt", "hello world");`,
    ``,
    `  // Realtime (socket.io fan-out)`,
    `  vx.realtime().channel("chat-room-1").on("message", (m) => console.log(m));`,
    `  await vx.realtime().channel("chat-room-1").publish("message", { text: "hi" });`,
    ``,
    `  // Web Push — SELF-HOSTED, standard protocol (RFC 8290/8291). No FCM, no Google.`,
    `  const swReg = await navigator.serviceWorker.register("/api/vaas/v1/push/sw.js");`,
    `  const { publicKey } = await (await fetch("/api/vaas/v1/push/vapid-public?projectId=${o.projectId}")).json();`,
    `  const sub = await swReg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey });`,
    `  await vx.push().register(JSON.stringify(sub.toJSON()));`,
    `  // → server: pushSend({ title, body }) — OS-level delivery even app-closed`,
    ``,
    `  // Cloud Functions`,
    `  await vx.functions().invoke("onUserWelcome");`,
    `</script>`,
  ].join("\n");
}

// ------------------------------------------------------------
// developer console accounts (public signup while enabled)
// ------------------------------------------------------------

export async function developerSignup(opts: { email: string; password: string; name: string; ip: string }) {
  if ((await vaasCfg("vaas.public_signup", "true")) !== "true") return { error: "Developer signup is disabled" };
  if (!(await gateOpen())) return { error: "VaaS is closed — future.firebase_mode is LOCKED" };
  const email = opts.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { error: "Invalid email address" };
  if (opts.password.length < 8) return { error: "Password must be at least 8 characters" };
  if ((await db.developer.findUnique({ where: { email } }))) return { error: "Email already registered" };
  const dev = await db.developer.create({
    data: { devId: shortId("dev", 10), email, passwordHash: hashPassword(opts.password), name: opts.name.trim().slice(0, 60) || email.split("@")[0] },
  });
  const verifyToken = generateToken(24);
  await db.developer.update({ where: { id: dev.id }, data: { verifyTokenHash: sha256(verifyToken) } });
  const mail = await sendMail({
    toEmail: email,
    subject: "VORTEX VaaS — verify your developer account",
    body: `Welcome to VORTEX VaaS.\n\nVerify your developer account: /api/vaas/v1/dev/verify?token=${verifyToken}\n\nIf you did not sign up, ignore this mail.`,
    category: "system",
    actor: `dev:${dev.devId}`,
  });
  const token = `vdt_${generateToken(24)}`;
  await db.vxDevSession.create({ data: { tokenHash: sha256(token), devId: dev.id, ip: opts.ip, expiresAt: new Date(Date.now() + SESSION_TTL_MS) } });
  await writeAudit({ actor: `dev:${dev.devId}`, action: "VAAS_DEV_SIGNUP", resource: `dev:${dev.devId}`, detail: `${email} (${mail.status})` });
  return { devId: dev.devId, email: dev.email, name: dev.name, token, verifyToken };
}

export async function developerLogin(opts: { email: string; password: string; ip: string; ua: string | null }) {
  const email = opts.email.trim().toLowerCase();
  const dev = await db.developer.findUnique({ where: { email } });
  if (!dev || dev.status !== "ACTIVE" || !verifyPassword(opts.password, dev.passwordHash)) return { error: "Invalid email or password" };
  const token = `vdt_${generateToken(24)}`;
  await db.vxDevSession.create({ data: { tokenHash: sha256(token), devId: dev.id, ip: opts.ip, userAgent: opts.ua ?? "", expiresAt: new Date(Date.now() + SESSION_TTL_MS) } });
  await db.developer.update({ where: { id: dev.id }, data: { lastLoginAt: new Date() } });
  await writeAudit({ actor: `dev:${dev.devId}`, action: "VAAS_DEV_LOGIN", resource: `dev:${dev.devId}`, detail: email });
  return { devId: dev.devId, email: dev.email, name: dev.name, token };
}

export async function developerFromToken(req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  const token = auth.slice(7).trim();
  if (!token.startsWith("vdt_") || token.length < 20) return null;
  const sess = await db.vxDevSession.findUnique({ where: { tokenHash: sha256(token) }, include: { dev: true } });
  if (!sess || sess.revoked || sess.expiresAt.getTime() < Date.now() || sess.dev.status !== "ACTIVE") return null;
  return sess.dev;
}

// ------------------------------------------------------------
// developer console — self-serve project management (dev-token authed)
// "Shobai use korte parbe": every developer manages their own backends.
// ------------------------------------------------------------

/** Shared shape for one developer-owned project in the console. */
async function devProjectRow(devId: string, p: Awaited<ReturnType<typeof db.vxProject.findMany>>[number]) {
  const [colAgg, docAgg, fileAgg, userCount, usage, clientKeyRow] = await Promise.all([
    db.vxCollection.findMany({ where: { projectId: p.id }, select: { name: true, readRule: true, writeRule: true, docCount: true } }),
    db.vxDocument.count({ where: { projectId: p.id } }),
    db.vxFile.aggregate({ _count: true, _sum: { sizeBytes: true } }),
    db.vxUser.count({ where: { projectId: p.id, status: "ACTIVE" } }),
    db.vxUsage.findMany({ where: { projectId: p.id, period: periodKey() } }),
    // CLIENT key is publishable config (like firebase apiKey) — safe to surface anytime
    db.vxKey.findFirst({ where: { projectId: p.id, kind: "CLIENT", status: "ACTIVE" }, orderBy: { createdAt: "desc" } }),
  ]);
  const dev = await db.developer.findUnique({ where: { id: devId } });
  const plans = await db.billingPlan.findMany({ where: { audience: "EXTERNAL" }, orderBy: { monthlyBaseBdt: "asc" } });
  const plan = plans.find((pl) => pl.code === "VAAS_PRO" && dev?.plan === "VAAS_PRO") || plans.find((pl) => pl.isDefault) || plans[0];
  const priced = plan ? priceVaasUsage(plan, Object.fromEntries(usage.map((u) => [u.metric, u.quantity]))) : null;
  const clientKey = clientKeyRow?.secretHash || null;
  return {
    projectId: p.projectId,
    name: p.name,
    slug: p.slug,
    region: p.region,
    status: p.status,
    viaNexa: p.viaNexa,
    authEnabled: p.authEnabled,
    rtEnabled: p.rtEnabled,
    fnEnabled: p.fnEnabled,
    createdAt: p.createdAt,
    collections: colAgg.map((c) => ({ name: c.name, readRule: c.readRule, writeRule: c.writeRule, docs: c.docCount })),
    docs: docAgg,
    files: fileAgg._count,
    storageKb: Math.round((fileAgg._sum.sizeBytes || 0) / 1024),
    endUsers: userCount,
    usage: Object.fromEntries(usage.map((u) => [u.metric, u.quantity])),
    usageBdt: priced?.subtotalBdt ?? 0,
    plan: plan?.code || null,
    clientKey,
    snippet: clientKey ? sdkSnippet({ appName: p.name, projectId: p.projectId, clientKey }) : null,
  };
}

export async function devProjectList(dev: { id: string }) {
  const projects = await db.vxProject.findMany({ where: { developerId: dev.id }, orderBy: { createdAt: "asc" } });
  const rows = [];
  for (const p of projects) rows.push(await devProjectRow(dev.id, p));
  return { projects: rows };
}

export async function devProjectCreate(dev: { id: string; devId: string; email: string }, opts: { name: string; collections?: { name: string; read?: string; write?: string }[] }) {
  if (!(await gateOpen())) return { error: "VaaS is closed — future.firebase_mode is LOCKED" } as const;
  const res = await provisionProject({ name: opts.name, developerId: dev.id, collections: opts.collections, actor: `dev:${dev.devId}` });
  if ("error" in res) return { error: res.error } as const;
  const snippet = sdkSnippet({ appName: opts.name, projectId: res.projectId, clientKey: res.clientKey || "" });
  await writeAudit({ actor: `dev:${dev.devId}`, action: "VAAS_DEV_PROJECT_CREATED", resource: `vxproj:${res.projectId}`, detail: `${opts.name} by ${dev.email}` });
  return { ...res, snippet };
}

/** Rotate both keys of an OWNED project — old keys keep working until revoked; here they die now. */
export async function devRotateKeys(dev: { id: string; devId: string }, projectId: string) {
  const project = await db.vxProject.findUnique({ where: { projectId } });
  if (!project || project.developerId !== dev.id) return { error: "Project not found among your projects" } as const;
  await db.vxKey.updateMany({ where: { projectId: project.id, status: "ACTIVE" }, data: { status: "REVOKED" } });
  const client = await createVxKey(project.id, "CLIENT");
  const admin = await createVxKey(project.id, "ADMIN");
  const snippet = sdkSnippet({ appName: project.name, projectId: project.projectId, clientKey: client.secret });
  await writeAudit({ actor: `dev:${dev.devId}`, action: "VAAS_DEV_KEYS_ROTATED", resource: `vxproj:${project.projectId}`, detail: "CLIENT+ADMIN re-issued, previous keys revoked" });
  return { projectId: project.projectId, clientKey: client.secret, adminKey: admin.secret, snippet };
}

export async function devProjectUsage(dev: { id: string; devId: string }, projectId: string) {
  const project = await db.vxProject.findUnique({ where: { projectId } });
  if (!project || project.developerId !== dev.id) return { error: "Project not found among your projects" } as const;
  const period = periodKey();
  const usage = await db.vxUsage.findMany({ where: { projectId: project.id, period } });
  const map = Object.fromEntries(usage.map((u) => [u.metric, u.quantity]));
  const dev2 = await db.developer.findUnique({ where: { id: dev.id } });
  const plans = await db.billingPlan.findMany({ where: { audience: "EXTERNAL" }, orderBy: { monthlyBaseBdt: "asc" } });
  const plan = plans.find((pl) => pl.code === "VAAS_PRO" && dev2?.plan === "VAAS_PRO") || plans.find((pl) => pl.isDefault) || plans[0];
  const priced = plan ? priceVaasUsage(plan, map) : null;
  return { projectId, period, plan: plan?.code || null, usage: map, priced, rateCard: VAAS_RATE_CARD };
}

// ------------------------------------------------------------
// SDK surface rate guard
// ------------------------------------------------------------

export function sdkRateOk(req: Request, bucket: string): { ok: true } | { ok: false; retryAfterSec: number } {
  const res = rateLimit(`vaas:${bucket}:${getClientIp(req)}`, 90, 60_000);
  return res.allowed ? { ok: true } : { ok: false, retryAfterSec: res.retryAfterSec };
}

// ------------------------------------------------------------
// state — the dashboard aggregate
// ------------------------------------------------------------

export async function vaasState() {
  await runDueScheduledFns();
  const [gate, developers, projects, users, collections, docsAgg, filesAgg, rt24h, fnRuns24h, api24h, fnQuota, nexaDev] = await Promise.all([
    firebaseGate(),
    db.developer.findMany({ orderBy: { createdAt: "asc" } }),
    db.vxProject.findMany({ orderBy: { createdAt: "asc" } }),
    db.vxUser.findMany({ select: { projectId: true, status: true, provider: true } }),
    db.vxCollection.findMany({ orderBy: { name: "asc" } }),
    db.vxDocument.aggregate({ _count: true }),
    db.vxFile.aggregate({ _count: true, _sum: { sizeBytes: true } }),
    db.vxRealtimeEvent.count({ where: { createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } } }),
    db.vxFunctionRun.count({ where: { createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } } }),
    db.vxUsage.findMany({ where: { metric: "VAAS_API", period: periodKey() }, select: { projectId: true, quantity: true } }),
    db.vxFunction.findMany({ orderBy: { invocations: "desc" }, take: 12 }),
    db.developer.findUnique({ where: { email: "nexa@vortex.local" } }),
  ]);

  const period = periodKey();
  const usage = await db.vxUsage.findMany({ where: { period } });
  const plans = await db.billingPlan.findMany({ where: { audience: "EXTERNAL" }, orderBy: { monthlyBaseBdt: "asc" } });

  const projectRows = projects.map((p) => {
    const dev = developers.find((d) => d.id === p.developerId);
    const pUsage = usage.filter((u) => u.projectId === p.id);
    const plan = plans.find((pl) => pl.code === "VAAS_PRO" && dev?.plan === "VAAS_PRO") || plans.find((pl) => pl.isDefault) || plans[0];
    const priced = plan ? priceVaasUsage(plan, Object.fromEntries(pUsage.map((u) => [u.metric, u.quantity]))) : null;
    return {
      id: p.id,
      projectId: p.projectId,
      name: p.name,
      slug: p.slug,
      region: p.region,
      status: p.status,
      viaNexa: p.viaNexa,
      authEnabled: p.authEnabled,
      rtEnabled: p.rtEnabled,
      fnEnabled: p.fnEnabled,
      developer: dev ? { devId: dev.devId, email: dev.email, name: dev.name } : null,
      users: users.filter((u) => u.projectId === p.id && u.status === "ACTIVE").length,
      collections: collections.filter((c) => c.projectId === p.id).length,
      docs: collections.filter((c) => c.projectId === p.id).reduce((a, c) => a + c.docCount, 0),
      usageBdt: priced?.subtotalBdt ?? 0,
      createdAt: p.createdAt,
    };
  });

  const recentEvents = await rtRecent(projects[0]?.id || "", undefined, 15);
  const configRows = await db.appConfig.findMany({ where: { key: { startsWith: "vaas." } }, orderBy: { key: "asc" } });

  // playground bootstrap: seeded demo project + publishable CLIENT key
  const demoKeyCfg = configRows.find((c) => c.key === "vaas.demo_client_key");
  const demoProject = projects.find((p) => p.projectId === "vxproj_demo0001") || null;
  const demo = demoKeyCfg && demoProject
    ? {
        projectId: demoProject.projectId,
        projectName: demoProject.name,
        clientKey: demoKeyCfg.value,
        email: configRows.find((c) => c.key === "vaas.demo_enduser_email")?.value || "",
        password: configRows.find((c) => c.key === "vaas.demo_enduser_password")?.value || "",
      }
    : null;

  return {
    gate,
    mode: gate.mode,
    demo,
    config: configRows.map((c) => ({ key: c.key, value: c.value, description: c.description })),
    plans: plans.map((p) => ({ planId: p.planId, code: p.code, name: p.name, audience: p.audience, monthlyBaseBdt: p.monthlyBaseBdt, isDefault: p.isDefault, note: p.note })),
    developers: developers.map((d) => ({
      devId: d.devId,
      email: d.email,
      name: d.name,
      plan: d.plan,
      status: d.status,
      emailVerified: d.emailVerified,
      isNexa: d.email === "nexa@vortex.local",
      projects: projects.filter((p) => p.developerId === d.id).length,
      lastLoginAt: d.lastLoginAt,
      createdAt: d.createdAt,
    })),
    projects: projectRows,
    collections: collections.map((c) => ({ id: c.id, projectId: c.projectId, name: c.name, docCount: c.docCount, readRule: c.readRule, writeRule: c.writeRule, status: c.status })),
    functions: fnQuota.map((f) => ({ fnId: f.fnId, projectId: f.projectId, name: f.name, trigger: f.trigger, status: f.status, invocations: f.invocations, fails: f.fails, lastRunAt: f.lastRunAt, lastError: f.lastError })),
    recentEvents: recentEvents.map((e) => ({ eventId: e.eventId, channel: e.channel, type: e.type, payloadJson: e.payloadJson, emittedBy: e.emittedBy, createdAt: e.createdAt })),
    usageTop: (Object.entries(
      usage.reduce<Record<string, number>>((acc, u) => {
        acc[u.metric] = (acc[u.metric] || 0) + u.quantity;
        return acc;
      }, {})
    ).map(([metric, quantity]) => ({ metric, quantity })).sort((a, b) => b.quantity - a.quantity)),
    stats: {
      developers: developers.length,
      projects: projects.length,
      endUsers: users.filter((u) => u.status === "ACTIVE").length,
      collections: collections.length,
      docs: docsAgg._count,
      files: filesAgg._count,
      storageMb: Math.round((filesAgg._sum.sizeBytes || 0) / 1_000_000),
      rt24h,
      fnRuns24h,
      apiCalls: api24h.reduce((a, u) => a + u.quantity, 0),
      nexaProjects: projects.filter((p) => p.viaNexa).length,
      nexaDevId: nexaDev?.devId || null,
    },
  };
}

// ============================================================
// v145 — BEYOND-FIREBASE PRODUCTS
// Atomic batch · Remote Config · VORTEX Push · Analytics ·
// Crashlytics · Presence · dev-console function management · ticker
// ============================================================

// ------------------------------------------------------------
// batch — atomic multi-op writes (Firestore WriteBatch counterpart)
// ------------------------------------------------------------

export type BatchOp =
  | { op: "add"; collection: string; data: Record<string, unknown> }
  | { op: "set"; collection: string; docId: string; data: Record<string, unknown> }
  | { op: "update"; collection: string; docId: string; data: Record<string, unknown> }
  | { op: "delete"; collection: string; docId: string };

/** ALL-or-NOTHING batch write: pre-validate every op, apply in ONE prisma transaction, then fan out triggers + realtime events post-commit. */
export async function docBatch(opts: { caller: VxCaller; ops: BatchOp[]; ip: string }) {
  const ops = Array.isArray(opts.ops) ? opts.ops : [];
  if (ops.length === 0) return { error: "Batch needs at least one op" };
  const maxOps = await vaasIntCfg("vaas.batch_max_ops", 20);
  if (ops.length > maxOps) return { error: `Batch limited to ${maxOps} ops per transaction` };

  // Pre-validate — collections, rules, sizes (fail FAST before touching data)
  const cols = new Map<string, NonNullable<Awaited<ReturnType<typeof db.vxCollection.findUnique>>>>();
  const colCache = new Map<string, NonNullable<Awaited<ReturnType<typeof db.vxDocument.findFirst>>>>();
  for (const o of ops) {
    if (!o?.collection) return { error: "Every op needs a collection" };
    let col = cols.get(o.collection);
    if (col === undefined) {
      const c = await db.vxCollection.findUnique({ where: { projectId_name: { projectId: opts.caller.project.id, name: o.collection } } });
      if (!c || c.status !== "ACTIVE") return { error: `Collection "${o.collection}" not found` };
      if (!ruleAllows(c.writeRule, opts.caller, null, "write")) return { error: `Permission denied by rules on "${o.collection}"`, code: 403 };
      col = c;
      cols.set(o.collection, c);
    }
    if (o.op === "add") {
      if (typeof o.data !== "object" || o.data === null) return { error: "add op needs a data object" };
      const size = JSON.stringify(o.data).length;
      if (size > 100_000) return { error: "Document too large (100 KB max)" };
      const quota = await vaasIntCfg("vaas.doc_quota_per_project", 5000);
      if (col.docCount >= quota) return { error: "Project document quota reached" };
    }
    if (o.op === "set" || o.op === "update" || o.op === "delete") {
      if (!o.docId) return { error: `${o.op} op needs a docId` };
      const row = await db.vxDocument.findFirst({ where: { collectionId: col.id, docId: o.docId } });
      if (!row) return { error: `Document "${o.docId}" not found in "${o.collection}"`, code: 404 };
      if (!ruleAllows(col.writeRule, opts.caller, row.ownerUid, "write")) return { error: `Permission denied by rules on "${o.collection}"`, code: 403 };
      if (o.op === "set" || o.op === "update") {
        const data = o.op === "update" ? { ...(safeJson<Record<string, unknown>>(row.dataJson, {})), ...o.data } : o.data;
        if (JSON.stringify(data).length > 100_000) return { error: "Document too large (100 KB max)" };
        colCache.set(`${o.collection}:${o.docId}`, row);
      } else {
        colCache.set(`${o.collection}:${o.docId}`, row);
      }
    }
  }

  // Atomic core — ONE transaction, all-or-nothing
  const created: { ref: string; docId: string }[] = [];
  const deltas = new Map<string, { n: number; bytes: number }>(); // collection → docCount/sizeBytes delta
  await db.$transaction(async (tx) => {
    for (const o of ops) {
      const col = cols.get(o.collection)!;
      const bump = deltas.get(o.collection) || { n: 0, bytes: 0 };
      if (o.op === "add") {
        const size = JSON.stringify(o.data).length;
        const row = await tx.vxDocument.create({
          data: { docId: shortId("vxd", 10), collectionId: col.id, projectId: opts.caller.project.id, ownerUid: opts.caller.user?.uid ?? null, dataJson: JSON.stringify(o.data) },
        });
        created.push({ ref: o.collection, docId: row.docId });
        bump.n += 1;
        bump.bytes += size;
      } else if (o.op === "set" || o.op === "update") {
        const row = colCache.get(`${o.collection}:${o.docId}`)!;
        const next = o.op === "update" ? { ...(safeJson<Record<string, unknown>>(row.dataJson, {})), ...o.data } : o.data;
        const size = JSON.stringify(next).length;
        await tx.vxDocument.update({ where: { id: row.id }, data: { dataJson: JSON.stringify(next), version: { increment: 1 } } });
        bump.bytes += size - row.dataJson.length;
      } else if (o.op === "delete") {
        const row = colCache.get(`${o.collection}:${o.docId}`)!;
        await tx.vxDocument.delete({ where: { id: row.id } });
        bump.n -= 1;
        bump.bytes -= row.dataJson.length;
      }
      deltas.set(o.collection, bump);
    }
    for (const [name, d] of deltas) {
      const col = cols.get(name)!;
      await tx.vxCollection.update({ where: { id: col.id }, data: { docCount: { increment: d.n }, sizeBytes: { increment: d.bytes } } });
    }
  });

  // Post-commit fan-out — triggers + realtime (async effects, like Firestore).
  // Adds get their new id from `created` (insertion order matches ops order).
  let addIdx = 0;
  for (const o of ops) {
    if (o.op === "add") {
      const id = created[addIdx++]?.docId || "";
      const doc = { id, ...o.data };
      await fireDocTriggers(opts.caller.project.id, o.collection, "create", doc);
      await rtPublishInternal({ projectId: opts.caller.project.projectId, channel: `col:${o.collection}`, type: "doc-change", payload: { op: "create", doc, batch: true }, emittedBy: "system" });
    } else if (o.op === "set" || o.op === "update") {
      const row = colCache.get(`${o.collection}:${o.docId}`)!;
      const next = o.op === "update" ? { ...(safeJson<Record<string, unknown>>(row.dataJson, {})), ...o.data } : o.data;
      const doc = { id: row.docId, ...next };
      await fireDocTriggers(opts.caller.project.id, o.collection, "update", doc);
      await rtPublishInternal({ projectId: opts.caller.project.projectId, channel: `col:${o.collection}`, type: "doc-change", payload: { op: "update", doc, batch: true }, emittedBy: "system" });
    } else if (o.op === "delete") {
      const row = colCache.get(`${o.collection}:${o.docId}`)!;
      const doc = { id: row.docId, ...safeJson<Record<string, unknown>>(row.dataJson, {}) };
      await fireDocTriggers(opts.caller.project.id, o.collection, "delete", doc);
      await rtPublishInternal({ projectId: opts.caller.project.projectId, channel: `col:${o.collection}`, type: "doc-change", payload: { op: "delete", doc, batch: true }, emittedBy: "system" });
    }
  }
  await meter(opts.caller.project.id, "VAAS_DOCS", ops.length);
  return { applied: ops.length, transactional: true, createdIds: created.map((c) => c.docId) };
}

// ------------------------------------------------------------
// Remote Config — per-project key/value (Firebase Remote Config counterpart)
// ------------------------------------------------------------

export async function cfgFetch(caller: VxCaller) {
  const rows = await db.vxRemoteConfig.findMany({ where: { projectId: caller.project.id }, orderBy: { key: "asc" } });
  const config: Record<string, unknown> = {};
  let version = 0;
  for (const r of rows) {
    version = Math.max(version, r.version);
    if (r.valueType === "number") config[r.key] = Number(r.value);
    else if (r.valueType === "boolean") config[r.key] = r.value === "true";
    else if (r.valueType === "json") config[r.key] = safeJson<unknown>(r.value, null);
    else config[r.key] = r.value;
  }
  return { config, version };
}

export async function cfgSet(opts: { caller: VxCaller; entries: { key: string; value: unknown; valueType?: string; description?: string }[] }) {
  if (opts.caller.key.kind !== "ADMIN") return { error: "ADMIN secret key required (vxa_…)", code: 403 };
  const entries = Array.isArray(opts.entries) ? opts.entries : [opts.entries];
  if (entries.length === 0 || entries.length > 100) return { error: "1-100 entries per call" };
  const out: { key: string; version: number }[] = [];
  for (const e of entries) {
    const key = String(e.key || "").trim();
    if (!/^[a-zA-Z][a-zA-Z0-9_.]{1,63}$/.test(key)) return { error: `Invalid config key "${key}"` };
    const vt = ["string", "number", "boolean", "json"].includes(String(e.valueType)) ? String(e.valueType) : "string";
    let value: string;
    if (vt === "json") value = JSON.stringify(e.value ?? null);
    else if (vt === "number") value = String(Number(e.value));
    else if (vt === "boolean") value = e.value === true || e.value === "true" ? "true" : "false";
    else value = String(e.value ?? "");
    if (value.length > 10_000) return { error: `Value too large for "${key}" (10 KB max)` };
    const prev = await db.vxRemoteConfig.findUnique({ where: { projectId_key: { projectId: opts.caller.project.id, key } } });
    const row = await db.vxRemoteConfig.upsert({
      where: { projectId_key: { projectId: opts.caller.project.id, key } },
      update: { value, valueType: vt, description: e.description?.slice(0, 200) ?? prev?.description ?? "", version: { increment: 1 }, updatedBy: "admin-key" },
      create: { projectId: opts.caller.project.id, key, value, valueType: vt, description: e.description?.slice(0, 200) ?? "", updatedBy: "admin-key" },
    });
    out.push({ key: row.key, version: row.version });
    // live config change notification over realtime
    await rtPublishInternal({ projectId: opts.caller.project.projectId, channel: "config", type: "config-change", payload: { key, value: row.value, version: row.version }, emittedBy: "system" });
  }
  await writeAudit({ actor: "vaas", action: "VAAS_CONFIG_SET", resource: `vxproj:${opts.caller.project.projectId}`, detail: `keys: ${out.map((o) => o.key).join(", ")}` });
  return { updated: out };
}

// ------------------------------------------------------------
// VORTEX Push — device registry + send (FCM counterpart, zero external deps)
// v147 REAL WEB PUSH: web subscriptions (JSON with endpoint+keys) are
// delivered through the STANDARD Web Push protocol (VAPID ES256 + aes128gcm,
// see ./webpush.ts) — OS-level delivery even when the app is closed, with
// NO Google dependency. Other platforms / legacy tokens keep the SSE-hub
// fallback. Dead subscriptions (404/410) are pruned automatically.
// ------------------------------------------------------------

import { generateVapidKeys, sendWebPush, parseSubscriptionToken, type VapidKeys } from "./webpush";

/** Per-project VAPID keypair, generated on first use and persisted in AppConfig. */
export async function vapidKeysFor(projectId: string): Promise<VapidKeys> {
  const pubKey = `vaas.vapid.pub.${projectId}`;
  const privKey = `vaas.vapid.priv.${projectId}`;
  const privRow = await db.appConfig.findUnique({ where: { key: privKey } });
  const pubRow = await db.appConfig.findUnique({ where: { key: pubKey } });
  if (privRow?.value && pubRow?.value) {
    try {
      return { publicKey: pubRow.value, privateKey: JSON.parse(privRow.value) };
    } catch {}
  }
  const fresh = generateVapidKeys();
  await db.appConfig.upsert({
    where: { key: privKey },
    update: { value: JSON.stringify(fresh.privateKey), updatedAt: new Date() },
    create: { key: privKey, value: JSON.stringify(fresh.privateKey), category: "vaas", description: "VAPID private key (SECRET)", isSecret: true },
  });
  await db.appConfig.upsert({
    where: { key: pubKey },
    update: { value: fresh.publicKey, updatedAt: new Date() },
    create: { key: pubKey, value: fresh.publicKey, category: "vaas", description: "VAPID public key (applicationServerKey)" },
  });
  return fresh;
}

export async function pushRegister(opts: { caller: VxCaller; token: string; platform?: string; uid?: string | null }) {
  const token = String(opts.token || "").trim();
  // v147 — a Web Push subscription (JSON with endpoint + p256dh/auth keys) is
  // a valid device token and is stored verbatim; length cap raised for it.
  const isWebPushSub = parseSubscriptionToken(token) !== null;
  const maxLen = isWebPushSub ? 1400 : 200;
  if (token.length < 8 || token.length > maxLen) return { error: `token must be 8-${maxLen} chars${isWebPushSub ? "" : " (or a Web Push subscription JSON)"}` };
  const platform = isWebPushSub ? "web-push" : ["web", "android", "ios"].includes(String(opts.platform)) ? String(opts.platform) : "web";
  const uid = opts.uid ?? opts.caller.user?.uid ?? null;
  const channels = uid ? JSON.stringify([`user:${uid}`]) : "[]";
  const prev = await db.vxPushToken.findUnique({ where: { projectId_token: { projectId: opts.caller.project.id, token } } });
  const row = prev
    ? await db.vxPushToken.update({ where: { id: prev.id }, data: { uid, platform, lastSeenAt: new Date(), channels } })
    : await db.vxPushToken.create({ data: { tokenId: shortId("vxpt", 10), projectId: opts.caller.project.id, token, uid, platform, channels } });
  return { tokenId: row.tokenId, registered: true, uid: row.uid, platform: row.platform };
}

export async function pushSend(opts: {
  caller: VxCaller;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  uid?: string;
  channel?: string;
}) {
  if (opts.caller.key.kind !== "ADMIN") return { error: "ADMIN secret key required (vxa_…)", code: 403 };
  const title = String(opts.title || "").slice(0, 120);
  const body = String(opts.body || "").slice(0, 500);
  if (!title && !body) return { error: "title or body required" };
  const where = opts.uid ? { projectId: opts.caller.project.id, uid: opts.uid } : { projectId: opts.caller.project.id };
  let tokens = await db.vxPushToken.findMany({ where, orderBy: { lastSeenAt: "desc" }, take: 500 });
  if (opts.channel) {
    tokens = tokens.filter((t) => {
      try {
        return (JSON.parse(t.channels) as string[]).includes(opts.channel!);
      } catch {
        return false;
      }
    });
  }
  if (tokens.length === 0) return { delivered: 0, note: opts.uid ? "No devices registered for this user" : "No devices registered yet" };

  // v147 — REAL delivery. Web Push subscriptions go over the standard
  // protocol (encrypted, OS-level, works app-closed); anything else falls
  // back to the in-process SSE hub as before. Expired subscriptions
  // (404/410) are pruned so the registry stays clean forever.
  const payload = { title, body, data: opts.data || {} };
  let delivered = 0;
  let pruned = 0;
  let sse = 0;
  const webSubs = tokens.filter((t) => t.platform === "web-push" && parseSubscriptionToken(t.token));
  const vapid = webSubs.length > 0 ? await vapidKeysFor(opts.caller.project.id) : null;
  for (const t of tokens.slice(0, 200)) {
    const sub = t.platform === "web-push" ? parseSubscriptionToken(t.token) : null;
    if (sub && vapid) {
      const r = await sendWebPush(sub, payload, vapid);
      if (r.ok) delivered += 1;
      else if (r.expired) {
        await db.vxPushToken.delete({ where: { id: t.id } }).catch(() => {});
        pruned += 1;
        continue;
      }
      await db.vxPushToken.update({ where: { id: t.id }, data: { lastSeenAt: new Date() } });
    } else {
      const res = await rtPublishInternal({
        projectId: opts.caller.project.projectId,
        channel: `device:${t.token}`,
        type: "push",
        payload,
        emittedBy: "push",
      });
      if (!("error" in res)) { sse += 1; delivered += 1; }
      await db.vxPushToken.update({ where: { id: t.id }, data: { lastSeenAt: new Date() } });
    }
  }
  // history trail on a well-known channel
  await rtPublishInternal({ projectId: opts.caller.project.projectId, channel: "push", type: "push-sent", payload: { title, body, delivered, pruned, sse, uid: opts.uid || null, channel: opts.channel || null }, emittedBy: "push" });
  await meter(opts.caller.project.id, "VAAS_PUSH", delivered);
  return { delivered, pruned: pruned || undefined, sse: sse || undefined, tokens: tokens.length, title, body, transport: delivered > 0 && sse === 0 ? "web-push (RFC 8290/8291)" : delivered > 0 ? "web-push + sse" : "sse" };
}

// ------------------------------------------------------------
// Analytics — event log + aggregates (Firebase Analytics counterpart)
// ------------------------------------------------------------

export async function analyticsLog(opts: { caller: VxCaller; name: string; params?: Record<string, unknown> }) {
  const name = String(opts.name || "").trim().slice(0, 60);
  if (!/^[a-zA-Z][a-zA-Z0-9_]{1,59}$/.test(name)) return { error: "Event name must be [a-zA-Z0-9_], 2-60 chars" };
  const day = new Date().toISOString().slice(0, 10);
  const maxPerDay = await vaasIntCfg("vaas.analytics_max_per_day", 20000);
  const count = await db.vxAnalyticsEvent.count({ where: { projectId: opts.caller.project.id, day } });
  if (count >= maxPerDay) return { error: "Daily analytics quota reached", code: 429 };
  const ev = await db.vxAnalyticsEvent.create({
    data: {
      projectId: opts.caller.project.id,
      name,
      uid: opts.caller.user?.uid ?? null,
      paramsJson: JSON.stringify(opts.params && typeof opts.params === "object" ? opts.params : {}).slice(0, 2000),
      day,
    },
  });
  await meter(opts.caller.project.id, "VAAS_ANALYTICS", 1);
  return { logged: true, name: ev.name, day };
}

export async function analyticsSummary(opts: { projectId: string; days?: number }) {
  const days = Math.min(Math.max(opts.days || 7, 1), 90);
  const sinceDay = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const rows = await db.vxAnalyticsEvent.groupBy({
    by: ["day", "name"],
    where: { projectId: opts.projectId, day: { gte: sinceDay } },
    _count: true,
    orderBy: [{ day: "desc" }, { _count: { name: "desc" } }],
  });
  const byDay = new Map<string, { name: string; count: number }[]>();
  const totals = new Map<string, number>();
  for (const r of rows) {
    const list = byDay.get(r.day) || [];
    list.push({ name: r.name, count: r._count });
    byDay.set(r.day, list);
    totals.set(r.name, (totals.get(r.name) || 0) + r._count);
  }
  return {
    days,
    timeline: [...byDay.entries()].map(([day, events]) => ({ day, events, total: events.reduce((a, e) => a + e.count, 0) })),
    topEvents: [...totals.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 20),
  };
}

// ------------------------------------------------------------
// Crashlytics — crash report ingest + list (Firebase Crashlytics counterpart)
// ------------------------------------------------------------

export async function crashReport(opts: {
  caller: VxCaller;
  message: string;
  stack?: string;
  appVersion?: string;
  platform?: string;
}) {
  const message = String(opts.message || "").trim().slice(0, 500);
  if (!message) return { error: "message required" };
  const maxOpen = await vaasIntCfg("vaas.crash_max_open", 500);
  const open = await db.vxCrashReport.count({ where: { projectId: opts.caller.project.id, resolved: false } });
  if (open >= maxOpen) return { error: "Too many unresolved crash reports — resolve some first", code: 429 };
  const crash = await db.vxCrashReport.create({
    data: {
      crashId: shortId("vxcr", 10),
      projectId: opts.caller.project.id,
      uid: opts.caller.user?.uid ?? null,
      message,
      stack: String(opts.stack || "").slice(0, 8000),
      appVersion: String(opts.appVersion || "").slice(0, 40),
      platform: ["web", "android", "ios"].includes(String(opts.platform)) ? String(opts.platform) : "web",
    },
  });
  await meter(opts.caller.project.id, "VAAS_ANALYTICS", 1);
  // live crash alert over realtime — devs see crashes the moment they happen
  await rtPublishInternal({ projectId: opts.caller.project.projectId, channel: "crash", type: "crash", payload: { crashId: crash.crashId, message, appVersion: crash.appVersion, platform: crash.platform, uid: crash.uid }, emittedBy: "system" });
  return { crashId: crash.crashId, reported: true };
}

export async function crashList(dev: { id: string; devId: string }, projectId: string, opts: { resolved?: boolean; take?: number }) {
  const project = await db.vxProject.findUnique({ where: { projectId } });
  if (!project || project.developerId !== dev.id) return { error: "Project not found among your projects" } as const;
  const crashes = await db.vxCrashReport.findMany({
    where: { projectId: project.id, ...(typeof opts.resolved === "boolean" ? { resolved: opts.resolved } : {}) },
    orderBy: { createdAt: "desc" },
    take: Math.min(opts.take || 50, 200),
  });
  return { crashes: crashes.map((c) => ({ crashId: c.crashId, message: c.message, stack: c.stack, appVersion: c.appVersion, platform: c.platform, uid: c.uid, resolved: c.resolved, createdAt: c.createdAt })) };
}

// ------------------------------------------------------------
// dev-console function management — deploy/list/delete/invoke (was missing)
// ------------------------------------------------------------

async function devOwnProject(dev: { id: string; devId: string }, projectId: string) {
  const project = await db.vxProject.findUnique({ where: { projectId } });
  if (!project || project.developerId !== dev.id) return null;
  return project;
}

export async function devFnDeploy(dev: { id: string; devId: string; email: string }, projectId: string, opts: { name: string; trigger: string; eventConfig?: Record<string, unknown>; code: string }) {
  const project = await devOwnProject(dev, projectId);
  if (!project) return { error: "Project not found among your projects" } as const;
  // existing function? allow REDEPLOY (update code/config) — Firebase does this too
  const exists = await db.vxFunction.findUnique({ where: { projectId_name: { projectId: project.id, name: String(opts.name || "") } } });
  if (exists) {
    if (!["HTTP", "EVENT_DOC", "EVENT_AUTH", "SCHEDULE"].includes(String(opts.trigger))) return { error: "Invalid trigger" } as const;
    if (FN_BAN.test(String(opts.code || ""))) return { error: "Code contains a banned token (process/require/eval/Function/…)" } as const;
    const fn = await db.vxFunction.update({
      where: { id: exists.id },
      data: { code: String(opts.code || ""), trigger: String(opts.trigger), eventConfig: JSON.stringify(opts.eventConfig || {}), status: "ACTIVE", lastError: null },
    });
    await writeAudit({ actor: `dev:${dev.devId}`, action: "VAAS_FN_REDEPLOYED", resource: `vxfn:${fn.fnId}`, detail: `${fn.name} (${fn.trigger}) by ${dev.email}` });
    return { fnId: fn.fnId, name: fn.name, redeployed: true };
  }
  const created = await fnCreate({ projectId: project.id, name: String(opts.name || ""), trigger: String(opts.trigger || "HTTP"), eventConfig: opts.eventConfig, code: String(opts.code || "") });
  if ("error" in created) return created as { error: string };
  await writeAudit({ actor: `dev:${dev.devId}`, action: "VAAS_FN_DEPLOYED", resource: `vxfn:${created.fnId}`, detail: `${created.name} by ${dev.email}` });
  return created;
}

export async function devFnList(dev: { id: string; devId: string }, projectId: string) {
  const project = await devOwnProject(dev, projectId);
  if (!project) return { error: "Project not found among your projects" } as const;
  const fns = await db.vxFunction.findMany({ where: { projectId: project.id }, orderBy: { createdAt: "asc" } });
  const out = [];
  for (const fn of fns) {
    const runs = await db.vxFunctionRun.findMany({ where: { fnId: fn.id }, orderBy: { createdAt: "desc" }, take: 5 });
    out.push({
      fnId: fn.fnId,
      name: fn.name,
      trigger: fn.trigger,
      eventConfig: safeJson<Record<string, unknown>>(fn.eventConfig, {}),
      status: fn.status,
      invocations: fn.invocations,
      fails: fn.fails,
      lastRunAt: fn.lastRunAt,
      lastError: fn.lastError,
      recentRuns: runs.map((r) => ({ runId: r.runId, trigger: r.trigger, status: r.status, latencyMs: r.latencyMs, error: r.error, createdAt: r.createdAt })),
    });
  }
  return { functions: out };
}

export async function devFnDelete(dev: { id: string; devId: string }, projectId: string, name: string) {
  const project = await devOwnProject(dev, projectId);
  if (!project) return { error: "Project not found among your projects" } as const;
  const fn = await db.vxFunction.findUnique({ where: { projectId_name: { projectId: project.id, name } } });
  if (!fn) return { error: `Function "${name}" not found`, code: 404 } as const;
  await db.vxFunction.delete({ where: { id: fn.id } });
  await writeAudit({ actor: `dev:${dev.devId}`, action: "VAAS_FN_DELETED", resource: `vxfn:${fn.fnId}`, detail: name });
  return { deleted: name };
}

export async function devFnInvoke(dev: { id: string; devId: string }, projectId: string, name: string, payload: unknown) {
  const project = await devOwnProject(dev, projectId);
  if (!project) return { error: "Project not found among your projects" } as const;
  const fn = await db.vxFunction.findUnique({ where: { projectId_name: { projectId: project.id, name } } });
  if (!fn) return { error: `Function "${name}" not found`, code: 404 } as const;
  return invokeFunction({ fn, trigger: "HTTP", payload });
}

// ------------------------------------------------------------
// ticker — scheduled functions + presence sweep run WITHOUT the dashboard
// (localhost-only route calls this every minute from dev.sh boot-tree)
// ------------------------------------------------------------

export async function vaasTick() {
  presenceSweep();
  const fns = await runDueScheduledFns();
  return { tickedAt: new Date().toISOString(), scheduledRan: fns.ran };
}
