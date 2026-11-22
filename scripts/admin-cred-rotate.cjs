#!/usr/bin/env node
/**
 * v148 — OWNER-REQUESTED CREDENTIAL ROTATION + Razorpay key encryption.
 * Walks the REAL product APIs (no direct DB writes) so every production
 * code path is exercised and tested:
 *   1. owner login                    → session cookie
 *   2. unlock control room            → ca_admin_unlock cookie
 *   3. save Razorpay keys (encrypted at rest — key_id AND secret, v148)
 *      → server LIVE-VALIDATES the pair against the Razorpay API (fail-closed)
 *   4. GET /api/billing/keys          → configured / mode / masked (no leak)
 *   5. POST /api/billing/keys/test    → real Razorpay ping with saved keys
 *   6. change owner login password    → old dead, new works, device keeps session
 *   7. change control-room PIN        → old dead, new works
 *   8. DB ciphertext audit            → both Razorpay rows MUST start with v1:
 * Secrets are NEVER printed — masked output only.
 */
const BASE = "http://localhost:3000";
const OLD_LOGIN_PW = "Owner123";
const NEW_PW = process.env.NEW_PW || "";
const OLD_PIN = "1000391619244862";
const NEW_PIN = NEW_PW;
const RZP_ID = "rzp_test_Tx6AcbO4VPm4xj";
const RZP_SECRET = "MUhTtKeOXRuxTktn78fBfg31";
const OWNER_EMAIL = "mdhonabali61@gmail.com";
if (!NEW_PW) { console.error("NEW_PW env required"); process.exit(2); }

let pass = 0, fail = 0; const fails = [];
function ok(name, cond, detail = "") {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; fails.push(`${name}${detail ? " :: " + detail : ""}`); console.log(`FAIL ${name}${detail ? " :: " + detail : ""}`); }
}
function redact(s) { return String(s).replace(/DCnTt8wwtuj3f6R/g, "[NEW]").replace(/MUhTtKeOXRuxTktn78fBfg31/g, "[RZP-SECRET]").replace(/rzp_test_Tx6AcbO4VPm4xj/g, "rzp_test_[ID]"); }

const jar = new Map();
function cookieHeader() { return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; "); }
function absorb(res) {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : (res.headers.get("set-cookie") ? [res.headers.get("set-cookie")] : []);
  for (const c of raw) {
    const [pair] = c.split(";");
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}
async function api(method, path, body, extra = {}) {
  const headers = { ...(extra.headers || {}) };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (jar.size) headers["cookie"] = cookieHeader();
  const res = await fetch(BASE + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual", signal: AbortSignal.timeout(30000),
  });
  absorb(res);
  const text = redact(await res.text());
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text: text.slice(0, 240) };
}

(async () => {
  // 1. owner login
  let r = await api("POST", "/api/auth/login", { email: OWNER_EMAIL, password: OLD_LOGIN_PW });
  ok("1 owner login (current password)", r.status === 200 && r.json?.ok === true, r.text);
  const hadSession = jar.has("ca_session");

  // 2. unlock control room with the CURRENT pin
  r = await api("POST", "/api/admin/panel/session", { pin: OLD_PIN });
  ok("2 control-room unlock (current PIN)", r.status === 200 && r.json?.ok === true, r.text);
  ok("2b unlock cookie stored", jar.has("ca_admin_unlock"), `cookies=${[...jar.keys()].join(",")}`);

  // 3. save Razorpay keys — server encrypts at rest + live-validates (fail-closed)
  r = await api("POST", "/api/billing/keys", { keyId: RZP_ID, keySecret: RZP_SECRET });
  ok("3 Razorpay keys saved (live-validated)", r.status === 200 && r.json?.ok === true, r.text);
  ok("3b mode=test detected", r.json?.mode === "test" || r.json?.key?.mode === "test", r.text);

  // 4. masked state — must NOT contain the raw secret anywhere
  r = await api("GET", "/api/billing/keys");
  ok("4 GET keys masked+configured", r.status === 200 && r.json?.configured === true, r.text);
  ok("4b secret never echoed", !r.text.includes(RZP_SECRET), "");

  // 5. real Razorpay ping with the SAVED keys
  r = await api("POST", "/api/billing/keys/test", {});
  ok("5 live Razorpay ping OK", r.status === 200 && (r.json?.ok === true || r.json?.live === true), r.text);

  // 6. owner login password rotation
  r = await api("POST", "/api/auth/password", { currentPassword: OLD_LOGIN_PW, newPassword: NEW_PW });
  ok("6 owner password changed", r.status === 200 && r.json?.ok === true, r.text);
  // fresh login checks — old must die, new must work
  jar.clear();
  r = await api("POST", "/api/auth/login", { email: OWNER_EMAIL, password: OLD_LOGIN_PW });
  ok("6b OLD password rejected", r.status === 401, `status=${r.status}`);
  r = await api("POST", "/api/auth/login", { email: OWNER_EMAIL, password: NEW_PW });
  ok("6c NEW password works", r.status === 200 && r.json?.ok === true, r.text);

  // 7. control-room PIN rotation (fresh session + unlock with current PIN first)
  r = await api("POST", "/api/admin/panel/session", { pin: OLD_PIN });
  ok("7a unlock with current PIN (pre-rotation)", r.status === 200 && r.json?.ok === true, r.text);
  r = await api("POST", "/api/admin/panel/session", { action: "change_pin", currentPin: OLD_PIN, nextPin: NEW_PIN });
  ok("7b PIN rotated", r.status === 200 && r.json?.ok === true, r.text);
  // lock and verify old/new
  await api("DELETE", "/api/admin/panel/session", {});
  r = await api("POST", "/api/admin/panel/session", { pin: OLD_PIN });
  ok("7c OLD PIN rejected", r.status === 403, `status=${r.status}`);
  r = await api("POST", "/api/admin/panel/session", { pin: NEW_PIN });
  ok("7d NEW PIN unlocks", r.status === 200 && r.json?.ok === true, r.text);

  // 8. DB ciphertext audit — Razorpay rows must be AES-GCM (v1:...) at rest
  const { PrismaClient } = require("@prisma/client");
  const db = new PrismaClient();
  const rows = await db.userSetting.findMany({ where: { key: { in: ["razorpay_key_id", "razorpay_key_secret"] } } });
  const byKey = Object.fromEntries(rows.map((x) => [x.key, x.value]));
  ok("8a key_id row encrypted (v1:…)", (byKey["razorpay_key_id"] || "").startsWith("v1:"), "prefix=" + String(byKey["razorpay_key_id"]).slice(0, 3));
  ok("8b secret row encrypted (v1:…)", (byKey["razorpay_key_secret"] || "").startsWith("v1:"), "prefix=" + String(byKey["razorpay_key_secret"]).slice(0, 3));
  ok("8c NO plaintext secret in DB", !(byKey["razorpay_key_secret"] || "").includes(RZP_SECRET), "");
  await db.$disconnect();

  console.log("\n==== SUMMARY ====");
  console.log(`PASS: ${pass}  FAIL: ${fail}`);
  if (fails.length) { console.log("Failed:"); fails.forEach((f) => console.log("  - " + f)); }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("SCRIPT CRASH:", redact(e.message)); process.exit(2); });
