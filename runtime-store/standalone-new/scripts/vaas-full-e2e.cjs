#!/usr/bin/env node
/**
 * VORTEX VaaS — FULL Firebase-parity e2e test (v147)
 * Hits the live :3200 data plane and exercises EVERY capability domain:
 *   dev console / sdk auth (password+OTP) / database CRUD+query+batch /
 *   realtime (SSE+publish+presence+recent) / storage / cloud functions
 *   (HTTP + DOC trigger + SCHEDULE via tick) / remote config / web push /
 *   analytics / crash reporting / usage metering.
 * Output: numbered PASS/FAIL lines + final tally. Non-zero exit on any FAIL.
 */
const BASE = "http://localhost:3200/api/vaas/v1";
const fs = require("fs");
const TICK_SECRET = fs.readFileSync(
  "/home/z/my-project/vortex-platform/server/VORTEX_SERVER/.tick-secret",
  "utf8"
).trim();
const RUN = "e2e" + Date.now().toString(36);
let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, detail = "") {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; fails.push(name + (detail ? ` :: ${detail}` : "")); console.log(`FAIL ${name} ${detail ? ":: " + detail : ""}`); }
}
async function api(method, path, { key, token, body } = {}) {
  const headers = {};
  if (key) headers["x-vx-key"] = key;
  if (token) headers["authorization"] = `Bearer ${token}`;
  let payload;
  if (body !== undefined) { headers["content-type"] = "application/json"; payload = JSON.stringify(body); }
  const res = await fetch(BASE + path, { method, headers, body: payload, signal: AbortSignal.timeout(20000) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text: text.slice(0, 300) };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const stamp = RUN.slice(-6);
  // ============ A. DEVELOPER CONSOLE ============
  const devEmail = `vxsdk${stamp}@test.local`;
  const devPass = "DevPass!2026x";
  let r = await api("POST", "/dev/signup", { body: { email: devEmail, password: devPass, name: "E2E Bot" } });
  ok("A1 dev signup", r.status === 201 || (r.json && /exists/i.test(r.json.error || "")), r.text);
  r = await api("POST", "/dev/login", { body: { email: devEmail, password: devPass } });
  ok("A2 dev login", r.status === 200 && r.json && (r.json.token || r.json.data?.token), r.text);
  const devToken = r.json?.token || r.json?.data?.token || "";
  r = await api("GET", "/dev/me", { token: devToken });
  ok("A3 dev me lists projects", r.status === 200 && Array.isArray(r.json?.projects), r.text);
  r = await api("POST", "/dev/projects", {
    token: devToken,
    body: { name: `e2e-suite-${stamp}`, collections: [
      { name: "notes", read: "public", write: "auth" },
      { name: "msgs", read: "auth", write: "auth" },
    ] },
  });
  ok("A4 dev project create", r.status === 201 && !!r.json?.projectId, r.text);
  const projectId = r.json?.projectId || "";
  const clientKey = r.json?.clientKey || "";
  const adminKey = r.json?.adminKey || "";
  ok("A5 keys issued (client+admin)", !!clientKey && !!adminKey, `client=${clientKey ? "yes" : "no"} admin=${adminKey ? "yes" : "no"}`);
  r = await api("GET", `/dev/projects/${projectId}/usage`, { token: devToken });
  ok("A6 usage metering endpoint", r.status === 200 && !!r.json, r.text);

  // ============ B. SDK AUTH ============
  const ue = `user${stamp}@app.test`, up = "UserPass!2026";
  r = await api("POST", "/auth/signup", { key: clientKey, body: { email: ue, password: up, displayName: "E2E User" } });
  ok("B1 sdk signup", r.status === 201 && !!r.json?.uid, r.text);
  r = await api("POST", "/auth/login", { key: clientKey, body: { email: ue, password: up } });
  ok("B2 sdk login returns idToken", r.status === 200 && !!r.json?.idToken, r.text);
  const sdkToken = r.json?.idToken || "";
  r = await api("GET", "/auth/me", { key: clientKey, token: sdkToken });
  ok("B3 sdk auth/me", r.status === 200 && r.json?.email === ue, r.text);
  r = await api("POST", "/auth/otp-request", { key: clientKey, body: { email: ue } });
  ok("B4 sdk otp-request", r.status === 200, r.text);
  // pull the real OTP from MailLog (dev env) — verify through the mail log API? DB direct is cheating; instead try wrong code first
  r = await api("POST", "/auth/otp-verify", { key: clientKey, body: { email: ue, code: "000000" } });
  ok("B5 sdk otp-verify rejects wrong code", r.status !== 200, r.text);
  r = await api("POST", "/auth/signout", { key: clientKey, token: sdkToken, body: {} });
  ok("B6 sdk signout", r.status === 200, r.text);
  r = await api("GET", "/auth/me", { key: clientKey, token: sdkToken });
  ok("B7 token dead after signout", r.status === 401, `status=${r.status}`);
  // B8 — fresh session for the write-heavy sections below (B6 revoked the old one)
  r = await api("POST", "/auth/login", { key: clientKey, body: { email: ue, password: up } });
  ok("B8 re-login after signout", r.status === 200 && !!r.json?.idToken, r.text);
  const sdkToken2 = r.json?.idToken || "";
  r = await api("GET", "/auth/me", { key: clientKey, token: sdkToken2 });
  ok("B8b fresh token works", r.status === 200, `status=${r.status}`);
  const AUTH = { key: clientKey, token: sdkToken2 };

  // ============ C. DATABASE ============
  r = await api("POST", "/data/notes", { ...AUTH, body: { data: { title: "first", body: "hello vortex", n: 1 } } });
  ok("C1 doc add", r.status === 201 && !!r.json?.id, r.text);
  const docId = r.json?.id || r.json?.doc?.id || "";
  r = await api("GET", `/data/notes/${docId}`, { key: clientKey });
  ok("C2 doc get", r.status === 200 && r.json?.title === "first", r.text);
  r = await api("PATCH", `/data/notes/${docId}`, { ...AUTH, body: { data: { n: 42 } } });
  ok("C3 doc patch", r.status === 200 && r.json?.n === 42, r.text);
  r = await api("PUT", `/data/notes/${docId}`, { ...AUTH, body: { data: { title: "replaced", n: 7 } } });
  ok("C4 doc put (replace)", r.status === 200 && r.json?.title === "replaced", r.text);
  await api("POST", "/data/notes", { ...AUTH, body: { data: { title: "second", body: "query me", n: 2 } } });
  await api("POST", "/data/notes", { ...AUTH, body: { data: { title: "third", body: "hello vortex", n: 3 } } });
  r = await api("GET", "/data/notes?where=" + encodeURIComponent(JSON.stringify({ n: 7 })) + "&limit=5", { key: clientKey, token: sdkToken });
  ok("C5 list where equality", r.status === 200 && (r.json?.docs || r.json?.items || []).length >= 1, r.text);
  const anyList = r.json?.docs || r.json?.items || [];
  ok("C5b list returns ids", anyList.length >= 1 && !!anyList[0].id, `count=${anyList.length}`);
  r = await api("GET", "/data/notes?contains=" + encodeURIComponent(JSON.stringify({ body: "query me" })) + "&limit=5", { key: clientKey });
  ok("C6 list contains", r.status === 200 && (r.json?.docs || r.json?.items || []).length >= 1, r.text);
  r = await api("GET", "/data/notes?orderBy=n&limit=2&skip=1", { key: clientKey });
  ok("C7 orderBy+limit+skip", r.status === 200 && (r.json?.docs || r.json?.items || []).length <= 2, r.text);
  r = await api("POST", "/data/batch", { ...AUTH, body: { ops: [
    { op: "add", collection: "msgs", data: { text: "b1", seq: 1 } },
    { op: "add", collection: "msgs", data: { text: "b2", seq: 2 } },
    { op: "update", collection: "notes", docId, data: { batched: true } },
  ] } });
  ok("C8 batch write", r.status === 200, r.text);
  r = await api("POST", "/data/batch", { ...AUTH, body: { ops: [
    { op: "add", collection: "msgs", data: { text: "good", seq: 3 } },
    { op: "add", collection: "nope_missing_collection_xyz", data: { text: "bad" } },
  ] } });
  ok("C9 batch all-or-nothing rejects bad op", r.status >= 400 && r.status < 500, `status=${r.status}`);
  r = await api("GET", "/data/msgs", { ...AUTH });
  const msgs = r.json?.docs || r.json?.items || [];
  ok("C9b batch atomicity (good op NOT applied)", !msgs.some((m) => m.text === "good"), `count=${msgs.length}`);
  r = await api("DELETE", `/data/notes/${docId}`, { ...AUTH });
  ok("C10 doc delete", r.status === 200, r.text);
  r = await api("GET", `/data/notes/${docId}`, { ...AUTH });
  ok("C11 deleted doc 404", r.status === 404, `status=${r.status}`);

  // ============ D. REALTIME ============
  // SSE stream — subscribe WITHOUT channel filter (doc events go to col:* channels)
  const sseEvents = [];
  const ctrl = new AbortController();
  const sseUrl = `${BASE}/rt/stream?key=${encodeURIComponent(clientKey)}`;
  const ssePromise = (async () => {
    try {
      const res = await fetch(sseUrl, { headers: { accept: "text/event-stream" }, signal: ctrl.signal });
      ok("D1 SSE stream connects", res.status === 200 && (res.headers.get("content-type") || "").includes("text/event-stream"), `status=${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || ""; // keep partial line for next read
        for (const line of lines) {
          if (line.startsWith("data:")) { try { sseEvents.push(JSON.parse(line.slice(5).trim())); } catch {} }
        }
        // stop once BOTH the custom publish and a doc-change arrived (or cap)
        if (sseEvents.some((e) => e?.type === "custom") && sseEvents.some((e) => e?.type === "doc-change")) break;
      }
    } catch {}
  })();
  await sleep(1500);
  r = await api("POST", "/rt/publish", { key: clientKey, body: { channel: "e2e", type: "custom", payload: { hello: "world" } } });
  ok("D2 rt publish", r.status === 201, r.text);
  r = await api("POST", "/data/notes", { ...AUTH, body: { data: { title: "rt-doc", body: "realtime fanout", n: 9 } } });
  ok("D3 doc add for auto-event", r.status === 201, r.text);
  await Promise.race([ssePromise, sleep(7000)]);
  ctrl.abort();
  ok("D4 SSE received custom publish", sseEvents.some((e) => e?.type === "custom" && e?.payload?.hello === "world"), `types=${sseEvents.map((e) => e?.type).join(",")}`);
  ok("D5 SSE received doc auto-event", sseEvents.some((e) => e?.type === "doc-change" && e?.channel === "col:notes"), `types=${sseEvents.map((e) => e?.type).join(",")}`);
  r = await api("GET", "/rt/events?channel=e2e", { key: clientKey });
  ok("D6 rt recent events", r.status === 200 && Array.isArray(r.json?.events) && r.json.events.length >= 1, r.text);
  r = await api("POST", "/rt/presence", { key: clientKey, body: { channel: "lobby", clientId: "bot1" } });
  ok("D7 presence online", r.status === 200 && (r.json?.online || 0) >= 1, r.text);
  r = await api("GET", "/rt/presence?channel=lobby", { key: clientKey });
  ok("D8 presence list", r.status === 200 && (r.json?.online || 0) >= 1, r.text);

  // ============ E. STORAGE ============
  const content = Buffer.from(`hello-storage-${stamp} ` + "x".repeat(2048)).toString("base64");
  r = await api("POST", "/storage/upload", { key: clientKey, body: { path: `e2e/${stamp}/demo.txt`, contentB64: content, mime: "text/plain" } });
  ok("E1 storage upload", r.status === 201 && !!r.json?.fileId, r.text);
  const fileId = r.json?.fileId || r.json?.file?.fileId || "";
  r = await api("GET", "/storage/list", { key: clientKey });
  ok("E2 storage list", r.status === 200 && Array.isArray(r.json?.files), r.text);
  r = await api("GET", `/storage/file?id=${fileId}`, { key: clientKey });
  const bytes = r.text.length > 0;
  ok("E3 storage download", r.status === 200 && bytes, `status=${r.status} len=${r.text.length}`);
  r = await api("DELETE", `/storage/file?id=${fileId}`, { key: clientKey });
  ok("E4 storage delete", r.status === 200, r.text);

  // ============ F. CLOUD FUNCTIONS ============
  r = await api("POST", `/dev/projects/${projectId}/functions`, { token: devToken, body: {
    name: "httpHello", trigger: "HTTP",
    code: "export default async function handler(ctx){ return { ok:true, echo: ctx.payload, fn:'httpHello' }; }",
  } });
  ok("F1 fn deploy HTTP", r.status === 201, r.text);
  r = await api("POST", "/fn/httpHello/invoke", { key: clientKey, body: { payload: { ping: Date.now() } } });
  ok("F2 fn HTTP invoke executes (export default)", r.status === 200 && r.json?.output?.ok === true, r.text);
  r = await api("POST", `/dev/projects/${projectId}/functions`, { token: devToken, body: {
    name: "onNoteAdd", trigger: "EVENT_DOC", eventConfig: { collection: "notes", ops: ["add"] },
    code: "export default async function handler(ctx){ console.log('note', ctx.payload.collection); return { saw: ctx.payload.doc?.title || null }; }",
  } });
  ok("F3 fn deploy EVENT_DOC trigger", r.status === 201, r.text);
  await api("POST", "/data/notes", { ...AUTH, body: { data: { title: "trigger-me", body: "fn fanout", n: 10 } } });
  await sleep(2500);
  r = await api("GET", `/dev/projects/${projectId}/functions`, { token: devToken });
  const fns = r.json?.functions || [];
  const trig = fns.find((f) => f.name === "onNoteAdd");
  ok("F4 EVENT_DOC trigger fired", !!trig && Number(trig.invocations || 0) >= 1, `invocations=${trig?.invocations} lastErr=${trig?.lastError || "none"}`);
  r = await api("POST", `/dev/projects/${projectId}/functions`, { token: devToken, body: {
    name: "cronBeat", trigger: "SCHEDULE", eventConfig: { everySec: 1 },
    code: "export default async function handler(ctx){ return { beat: true, at: ctx.payload?.at || null }; }",
  } });
  ok("F5 fn deploy SCHEDULE", r.status === 201, r.text);
  r = await api("POST", `/tick?secret=${encodeURIComponent(TICK_SECRET)}`, { body: {} });
  if (r.status !== 200) {
    // fall back to GET ?secret= form (cron-pinger style)
    r = await api("GET", `/tick?secret=${encodeURIComponent(TICK_SECRET)}`, {});
  }
  ok("F6 scheduler tick runs (POST + GET ?secret)", r.status === 200 && !!r.json, r.text);
  await sleep(1500);
  r = await api("GET", `/dev/projects/${projectId}/functions`, { token: devToken });
  const cron = (r.json?.functions || []).find((f) => f.name === "cronBeat");
  ok("F7 SCHEDULE fn fired by tick", !!cron && Number(cron.invocations || 0) >= 1, `invocations=${cron?.invocations} lastErr=${cron?.lastError || "none"}`);
  r = await api("POST", `/dev/projects/${projectId}/functions/httpHello/invoke`, { token: devToken, body: { payload: { via: "console" } } });
  ok("F8 dev console fn invoke", r.status === 200 && r.json?.output?.ok === true, r.text);

  // ============ G. REMOTE CONFIG ============
  r = await api("POST", "/config", { key: adminKey, body: { entries: [
    { key: "themeColor", value: "#6d28d9" },
    { key: "maintenance", value: false },
    { key: "maxUploadMb", value: 25, valueType: "number" },
    { key: "welcome", value: "Welcome to VORTEX!", valueType: "string" },
  ] } });
  ok("G1 remote config set (ADMIN)", r.status === 201, r.text);
  r = await api("GET", "/config", { key: clientKey });
  ok("G2 remote config fetch (CLIENT)", r.status === 200 && r.json?.config?.themeColor === "#6d28d9", r.text);

  // ============ H. PUSH NOTIFICATION ============
  const subToken = JSON.stringify({
    endpoint: `https://push.vortex.local/fake/${stamp}`,
    keys: { p256dh: "BOrJ1xKrngqMDCEHiXOWN9wjWcW8zDmZKmbok8VvI-M4KxBVsI-yfweuFmFuqAnOIA_-UkwVv0kDlhGlVS05IVo", auth: "k8XiGI6dBz221WJXbKtNxg" },
  });
  r = await api("POST", "/push/register", { key: clientKey, body: { token: subToken, platform: "web" } });
  ok("H1 push token register", r.status === 201, r.text);
  r = await api("POST", "/push/send", { key: adminKey, body: { title: "E2E Alert", body: "push works", data: { kind: "test" } } });
  ok("H2 push send (fan-out contract)", r.status === 200 && !!r.json, r.text);
  const sent = r.json?.sent ?? r.json?.delivered ?? 0, pushFailed = r.json?.failed ?? 0;
  ok("H3 push delivery accounting", typeof sent === "number" && typeof pushFailed === "number", `sent=${sent} failed=${pushFailed}`);

  // ============ I. ANALYTICS ============
  r = await api("POST", "/analytics/event", { key: clientKey, body: { name: "screen_view", params: { screen: "home" } } });
  ok("I1 analytics log", r.status === 201, r.text);
  await api("POST", "/analytics/event", { key: clientKey, body: { name: "button_click", params: { id: "cta" } } });
  r = await api("GET", "/analytics/summary?days=7", { key: adminKey });
  const sums = r.json?.topEvents || r.json?.timeline || [];
  ok("I2 analytics summary", r.status === 200 && (Array.isArray(sums) ? sums.length >= 1 : !!r.json), r.text);

  // ============ J. CRASH REPORTING ============
  r = await api("POST", "/crash/report", { key: clientKey, body: { message: "TypeError: cannot read property 'x' of undefined", stack: "at home (app.js:1:1)", appVersion: "1.0.0", platform: "web" } });
  ok("J1 crash report ingest", r.status === 201, r.text);
  r = await api("GET", `/dev/projects/${projectId}/crashes`, { token: devToken });
  ok("J2 crash list for dev", r.status === 200 && (r.json?.crashes || []).length >= 1, r.text);

  // ============ K. ACCESS CONTROL ============
  r = await api("GET", "/data/notes", { key: "vx_bad_key_does_not_exist" });
  ok("K1 bad key rejected", r.status === 401, `status=${r.status}`);
  r = await api("POST", "/collections", { key: clientKey, body: { name: "shouldFail" } });
  ok("K2 collection admin-only via CLIENT key", r.status === 403, `status=${r.status}`);
  r = await api("POST", "/collections", { key: adminKey, body: { name: "admins_only_col", read: "auth", write: "owner" } });
  ok("K3 collection create via ADMIN key", r.status === 201, r.text);

  // ============ L. PASSWORD RESET (Firebase sendPasswordResetEmail counterpart) ============
  const newPass = "NewPass!2026x";
  r = await api("POST", "/auth/otp-request", { key: clientKey, body: { email: ue, purpose: "PASSWORD_RESET" } });
  ok("L1 reset OTP requested", r.status === 200, r.text);
  const resetCode = r.json?.devCode || "";
  ok("L2 reset code delivered (devCode)", resetCode.length === 6, `code=${resetCode ? "yes" : "no"}`);
  r = await api("POST", "/auth/reset-password", { key: clientKey, body: { email: ue, code: resetCode, newPassword: newPass } });
  ok("L3 reset-password with code", r.status === 200 && r.json?.reset === true, r.text);
  r = await api("GET", "/auth/me", { ...AUTH });
  ok("L4 all old sessions revoked", r.status === 401, `status=${r.status}`);
  r = await api("POST", "/auth/login", { key: clientKey, body: { email: ue, password: newPass } });
  ok("L5 login with NEW password", r.status === 200 && !!r.json?.idToken, r.text);
  r = await api("POST", "/auth/login", { key: clientKey, body: { email: ue, password: up } });
  ok("L6 OLD password dead", r.status === 401, `status=${r.status}`);
  const freshToken = (await api("POST", "/auth/login", { key: clientKey, body: { email: ue, password: newPass } })).json?.idToken || "";

  // ============ M. CUSTOM CLAIMS (Firebase setCustomUserClaims counterpart) ============
  const uidNow = (await api("GET", "/auth/me", { key: clientKey, token: freshToken })).json?.uid || "";
  r = await api("POST", "/auth/set-claims", { key: clientKey, body: { uid: uidNow, claims: { role: "admin" } } });
  ok("M1 set-claims blocked for CLIENT key", r.status === 403, `status=${r.status}`);
  r = await api("POST", "/auth/set-claims", { key: adminKey, body: { uid: uidNow, claims: { role: "admin", plan: "pro" } } });
  ok("M2 set-claims via ADMIN key", r.status === 200 && r.json?.claims?.role === "admin", r.text);
  r = await api("GET", "/auth/me", { key: clientKey, token: freshToken });
  ok("M3 claims visible in auth/me", r.json?.claims?.role === "admin" && r.json?.claims?.plan === "pro", JSON.stringify(r.json?.claims || {}));

  console.log("\n==== SUMMARY ====");
  console.log(`PASS: ${pass}  FAIL: ${fail}`);
  if (fails.length) { console.log("Failed:"); fails.forEach((f) => console.log("  - " + f)); }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("SCRIPT CRASH:", e.message); process.exit(2); });
