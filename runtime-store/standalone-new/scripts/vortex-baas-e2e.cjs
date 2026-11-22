#!/usr/bin/env node
/**
 * VORTEX VaaS — BEYOND-FIREBASE e2e test suite (v145)
 * Tests every Firebase-parity + beyond product on the live :3200 server.
 * Prints a ✅/❌ matrix used for the final Bengali report.
 */
const BASE = "http://127.0.0.1:3200/api/vaas/v1";
const DB = "/home/z/my-project/vortex-platform/server/VORTEX_SERVER/db/custom.db";
const TICK_SECRET_FILE = "/home/z/my-project/vortex-platform/server/VORTEX_SERVER/.tick-secret";
const fs = require("fs");
const { execSync } = require("child_process");

const results = [];
function mark(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} | ${name}${detail ? " | " + detail : ""}`);
}
async function req(method, path, { key, idToken, adminKey, body } = {}) {
  const headers = {};
  if (key) headers["x-vx-key"] = key;
  if (adminKey) headers["x-vx-key"] = adminKey;
  if (idToken) headers["Authorization"] = "Bearer " + idToken;
  const init = { method, headers };
  if (body !== undefined) { headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
  const res = await fetch(BASE + path, init);
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("json")) { const j = await res.json(); return { status: res.status, json: j }; }
  return { status: res.status, buf: await res.arrayBuffer() };
}
function sqlite(query) {
  return execSync(`python3 -c "import sqlite3,json;con=sqlite3.connect('${DB}');print(json.dumps([list(map(str,r)) for r in con.execute('''${query}''')]) )"`).toString();
}

(async () => {
  const stamp = Date.now().toString(36);
  // ---------- 1. developer signup/login/project ----------
  let r = await req("POST", "/dev/signup", { body: { email: `test-${stamp}@vortex.test`, password: "Test@2026x", name: "E2E Tester" } });
  if (!r.json.ok && !/already/.test(r.json.error || "")) { mark("dev.signup", false, JSON.stringify(r.json)); }
  r = await req("POST", "/dev/login", { body: { email: `test-${stamp}@vortex.test`, password: "Test@2026x" } });
  mark("dev.login", r.json.ok === true && !!r.json.token, r.json.token ? "token ok" : JSON.stringify(r.json));
  const devToken = r.json.token;

  async function devReq(method, path, body) {
    const res = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", Authorization: "Bearer " + devToken }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json() };
  }
  r = await devReq("POST", "/dev/projects", { name: `E2E Super ${stamp}`, collections: [{ name: "posts", read: "public", write: "auth" }, { name: "audit", read: "public", write: "public" }] });
  mark("dev.project.create", r.json.ok === true && !!r.json.clientKey, `projectId=${r.json.projectId || "?"}`);
  const projectId = r.json.projectId;
  const clientKey = r.json.clientKey;
  const adminKey = r.json.adminKey;

  // ---------- 2. auth ----------
  const email = `user-${stamp}@vortex.test`;
  r = await req("POST", "/auth/signup", { key: clientKey, body: { email, password: "User@2026x", displayName: "E2E User" } });
  const uid = r.json.uid;
  mark("auth.signup(+claims)", r.json.ok === true && !!uid, `uid=${uid || "?"}`);
  r = await req("POST", "/auth/login", { key: clientKey, body: { email, password: "User@2026x" } });
  const idToken = r.json.idToken;
  mark("auth.login", r.json.ok === true && !!idToken, "idToken issued");
  r = await req("GET", "/auth/me", { key: clientKey, idToken });
  mark("auth.me", r.json.ok === true && r.json.email === email && !!r.json.uid, JSON.stringify(r.json).slice(0, 100));

  // OTP flow — request, pull code from MailLog, verify
  r = await req("POST", "/auth/otp-request", { key: clientKey, body: { email } });
  const otpOkReq = r.json.ok === true;
  let otpVerified = false;
  if (otpOkReq) {
    try {
      const rows = JSON.parse(sqlite(`SELECT body FROM MailLog ORDER BY id DESC LIMIT 3`));
      const joined = rows.map(x => x.join(" ")).join(" ");
      const m = joined.match(/\b(\d{6})\b/);
      if (m) {
        const v = await req("POST", "/auth/otp-verify", { key: clientKey, body: { email, code: m[1] } });
        otpVerified = v.json.ok === true;
      }
    } catch (e) { /* mail table shape differs */ }
  }
  mark("auth.otp.request+verify", otpOkReq && otpVerified, otpOkReq ? (otpVerified ? "code matched from mail log" : "code not found in mail") : "request failed");

  // ---------- 3. data CRUD + query ----------
  r = await req("POST", "/data/posts", { key: clientKey, idToken, body: { data: { title: "Hello VORTEX", likes: 5, tag: "intro" } } });
  const docId = r.json.doc && r.json.doc.id;
  mark("data.add", r.json.ok === true && !!docId, `doc=${docId || "?"}`);
  r = await req("GET", `/data/posts/${docId}`, { key: clientKey });
  mark("data.get", r.json.ok === true && r.json.id === docId && r.json.title === "Hello VORTEX", JSON.stringify(r.json).slice(0, 100));
  await req("POST", "/data/posts", { key: clientKey, idToken, body: { data: { title: "Second post", likes: 9, tag: "intro" } } });
  r = await req("GET", "/data/posts?orderBy=-likes&limit=2", { key: clientKey });
  mark("data.query(orderBy+limit)", r.json.ok === true && Array.isArray(r.json.items) && r.json.items.length === 2 && r.json.items[0].likes === 9, "");
  r = await req("PATCH", `/data/posts/${docId}`, { key: clientKey, idToken, body: { data: { likes: 42 } } });
  mark("data.patch", r.json.ok === true && r.json.likes === 42, JSON.stringify(r.json).slice(0, 100));
  r = await req("PUT", `/data/posts/${docId}`, { key: clientKey, idToken, body: { data: { title: "Replaced", likes: 1 } } });
  mark("data.put(replace)", r.json.ok === true && r.json.title === "Replaced", JSON.stringify(r.json).slice(0, 100));

  // ---------- 4. batch (atomic) ----------
  r = await req("POST", "/data/batch", { key: clientKey, idToken, body: { ops: [
    { op: "add", collection: "posts", data: { title: "batch-1", likes: 0 } },
    { op: "add", collection: "posts", data: { title: "batch-2", likes: 0 } },
    { op: "update", collection: "posts", docId, data: { batched: true } },
  ] } });
  const batchApplied = r.json.ok === true && r.json.applied === 3;
  mark("data.batch.atomic", batchApplied, JSON.stringify(r.json).slice(0, 120));
  // negative: one invalid op → NOTHING applied
  const before = JSON.parse(sqlite(`SELECT COUNT(*) FROM VxDocument`))[0][0];
  r = await req("POST", "/data/batch", { key: clientKey, body: { ops: [
    { op: "add", collection: "posts", data: { title: "never" } },
    { op: "delete", collection: "posts", docId: "vxd_nonexistent" },
  ] } });
  const after = JSON.parse(sqlite(`SELECT COUNT(*) FROM VxDocument`))[0][0];
  mark("data.batch.rollback", r.json.ok === false && before === after, `count ${before}→${after} (all-or-nothing)`);

  // ---------- 5. storage ----------
  const content = btoa("VORTEX storage bytes " + stamp);
  r = await req("POST", "/storage/upload", { key: clientKey, idToken, body: { path: `e2e/${stamp}.txt`, contentB64: content, mime: "text/plain" } });
  const fileId = r.json.fileId;
  mark("storage.upload(+checksum)", r.json.ok === true && !!fileId && !!r.json.checksum, `${r.json.sizeBytes || "?"} bytes`);
  r = await req("GET", `/storage/file?id=${fileId}`, { key: clientKey });
  mark("storage.download", r.status === 200 && r.buf && Buffer.from(r.buf).toString() === `VORTEX storage bytes ${stamp}`, "");
  r = await req("GET", "/storage/list", { key: clientKey });
  mark("storage.list", r.json.ok === true && r.json.files.some(f => f.fileId === fileId), "");

  // ---------- 6. realtime SSE + presence ----------
  const ssePromise = new Promise(async (resolve) => {
    const ctrl = new AbortController();
    const got = { ready: false, event: false, presenceOffline: false };
    try {
      const res = await fetch(`${BASE}/rt/stream?channel=chat&key=${encodeURIComponent(clientKey)}&since=${Date.now() - 5000}`, { signal: ctrl.signal, headers: { Accept: "text/event-stream" } });
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      const timer = setTimeout(() => ctrl.abort(), 9000);
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        if (buf.includes("event: ready")) got.ready = true;
        if (buf.includes("RT-MAGIC-" + stamp)) got.event = true;
        if (buf.includes('"online":false')) got.presenceOffline = true;
        if (got.event) break;
      }
      clearTimeout(timer);
      ctrl.abort();
      resolve(got);
    } catch (e) { resolve(got); }
  });
  // give the stream a moment to attach, then publish through a SECOND call
  await new Promise(r => setTimeout(r, 1200));
  const pub = await req("POST", "/rt/publish", { key: clientKey, body: { channel: "chat", type: "message", payload: { text: "RT-MAGIC-" + stamp } } });
  const got = await ssePromise;
  mark("rt.publish", pub.json.ok === true, `eventId=${pub.json.eventId || "?"}`);
  mark("rt.stream.sse.truePush", got.ready && got.event, `ready=${got.ready} liveEvent=${got.event}`);
  r = await req("GET", "/rt/presence?channel=chat", { key: clientKey });
  mark("rt.presence.list", r.json.ok === true && typeof r.json.online === "number", `online=${r.json.online}`);

  // ---------- 7. functions ----------
  r = await devReq("POST", `/dev/projects/${projectId}/functions`, {
    name: "onPostCreate", trigger: "EVENT_DOC", eventConfig: { collection: "posts", op: "create" },
    code: "await ctx.db.add('audit', { kind: 'post-created', title: ctx.payload.doc.title, at: ctx.now });\nawait ctx.realtime.publish('audit', 'fn-ran', { name: 'onPostCreate' });\nreturn { ok: true, saw: ctx.payload.doc.title };",
  });
  mark("functions.deploy(EVENT_DOC)", r.json.ok === true, `fnId=${r.json.fnId || "?"}`);
  r = await devReq("POST", `/dev/projects/${projectId}/functions`, {
    name: "httpPing", trigger: "HTTP",
    code: "return { pong: ctx.payload.ping || 'pong', at: ctx.now };",
  });
  r = await devReq("POST", `/dev/projects/${projectId}/functions/httpPing/invoke`, { payload: { ping: "e2e-" + stamp } });
  mark("functions.invoke(HTTP)", r.json.ok === true && r.json.status === "OK" && String(r.json.output && r.json.output.pong).includes("e2e"), JSON.stringify(r.json).slice(0, 140));
  // trigger the EVENT_DOC fn
  await req("POST", "/data/posts", { key: clientKey, idToken, body: { data: { title: "TRIGGER-ME-" + stamp, likes: 0 } } });
  await new Promise(r2 => setTimeout(r2, 1500));
  r = await req("GET", "/data/audit?orderBy=-createdAt&limit=5", { key: clientKey });
  const auditHit = r.json.ok === true && JSON.stringify(r.json.items || []).includes("TRIGGER-ME-" + stamp);
  mark("functions.trigger.EVENT_DOC", auditHit, auditHit ? "audit doc written by trigger" : JSON.stringify(r.json).slice(0, 100));
  // schedule fn + tick
  r = await devReq("POST", `/dev/projects/${projectId}/functions`, { name: "everyMin", trigger: "SCHEDULE", eventConfig: { intervalSec: 60 }, code: "await ctx.db.add('audit', { kind: 'tick', at: ctx.now }); return { ticked: true };" });
  const tickSecret = fs.readFileSync(TICK_SECRET_FILE, "utf8").trim();
  const tickRes = await fetch(`${BASE}/tick`, { headers: { "x-vx-tick": tickSecret } });
  const tickJson = await tickRes.json();
  mark("scheduler.tick(localhost+secret)", tickJson.ok === true && typeof tickJson.scheduledRan === "number", JSON.stringify(tickJson));
  r = await devReq("GET", `/dev/projects/${projectId}/functions`);
  mark("functions.list(dev-console)", r.json.ok === true && r.json.functions.length >= 3, `${(r.json.functions || []).length} functions`);

  // ---------- 8. push ----------
  const deviceToken = "devtok-e2e-" + stamp;
  r = await req("POST", "/push/register", { key: clientKey, idToken, body: { token: deviceToken, platform: "android" } });
  mark("push.register(device)", r.json.ok === true && !!r.json.tokenId, `tokenId=${r.json.tokenId || "?"}`);
  r = await req("POST", "/push/send", { key: adminKey, body: { title: "VORTEX Push", body: "Hello from beyond-Firebase land", uid, data: { deep: "link/e2e" } } });
  mark("push.send(to-user-devices)", r.json.ok === true && r.json.delivered >= 1, `delivered=${r.json.delivered}`);
  r = await req("POST", "/push/send", { key: clientKey, body: { title: "nope" } });
  mark("push.send.CLIENT-denied", r.json.ok === false && r.status === 403, "admin key required");

  // ---------- 9. remote config ----------
  r = await req("POST", "/config", { key: adminKey, body: { entries: [
    { key: "theme_color", value: "#0af", valueType: "string" },
    { key: "max_upload_mb", value: 25, valueType: "number" },
    { key: "maintenance", value: false, valueType: "boolean" },
    { key: "flags", value: { beta: true, tiers: ["free", "pro"] }, valueType: "json" },
  ] } });
  const cfgSetOk = r.json.ok === true && r.json.updated && r.json.updated.length === 4;
  r = await req("GET", "/config", { key: clientKey });
  const c = r.json.config || {};
  mark("config.set(ADMIN)", cfgSetOk, "");
  mark("config.fetch(parsed-types)", r.json.ok === true && c.theme_color === "#0af" && c.max_upload_mb === 25 && c.maintenance === false && c.flags && c.flags.beta === true, `version=${r.json.version}`);

  // ---------- 10. analytics ----------
  await req("POST", "/analytics/event", { key: clientKey, idToken, body: { name: "screen_view", params: { screen: "home" } } });
  await req("POST", "/analytics/event", { key: clientKey, idToken, body: { name: "screen_view", params: { screen: "settings" } } });
  r = await req("POST", "/analytics/event", { key: clientKey, idToken, body: { name: "purchase", params: { amount: 990, currency: "BDT" } } });
  mark("analytics.log", r.json.ok === true, "");
  r = await req("GET", "/analytics/summary?days=7", { key: adminKey });
  const top = (r.json.topEvents || []).map(t => t.name);
  mark("analytics.summary(aggregate)", r.json.ok === true && top.includes("screen_view") && top.includes("purchase"), JSON.stringify(r.json.topEvents || []).slice(0, 80));

  // ---------- 11. crashlytics ----------
  r = await req("POST", "/crash/report", { key: clientKey, idToken, body: { message: "TypeError: cannot read property 'x' of undefined", stack: "at e2e.js:1:1", appVersion: "1.0.0", platform: "android" } });
  const crashId = r.json.crashId;
  mark("crash.report", r.json.ok === true && !!crashId, `crashId=${crashId || "?"}`);
  r = await devReq("GET", `/dev/projects/${projectId}/crashes`);
  mark("crash.list(dev-console)", r.json.ok === true && r.json.crashes.some(cr => cr.crashId === crashId), "");

  // ---------- 12. functions delete + sdk.js + gate ----------
  r = await devReq("DELETE", `/dev/projects/${projectId}/functions/everyMin`);
  mark("functions.delete(dev-console)", r.json.ok === true && r.json.deleted === "everyMin", "");
  const sdkRes = await fetch("http://127.0.0.1:3200/vortex-sdk.js");
  const sdkBody = await sdkRes.text();
  mark("sdk.served(/vortex-sdk.js)", sdkRes.status === 200 && sdkBody.includes("initializeApp") && sdkBody.includes("EventSource") && sdkBody.includes("1.0.0"), `v=${sdkRes.status}`);

  // ---------- summary ----------
  const pass = results.filter(x => x.ok).length;
  console.log("\n===== SUMMARY =====");
  console.log(`${pass}/${results.length} PASSED`);
  results.filter(x => !x.ok).forEach(x => console.log(`FAILED: ${x.name} — ${x.detail}`));
})().catch(e => { console.error("FATAL", e); process.exit(1); });
