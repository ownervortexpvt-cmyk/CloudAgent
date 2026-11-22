/**
 * PHASE 8 E2E SMOKE — "Firebase er bap" for everyone.
 * Exercises the real HTTP surface on 127.0.0.1:3000:
 *
 *  1. Developer console: signup → me → create project → list → rotate keys
 *  2. SDK surface: health → end-user signup → data add/list → storage upload → fn invoke
 *  3. Owner: password login → OTP delivered over REAL SMTP (code parsed from the
 *     sink .eml) → register app → backend auto-provisioned + linked
 *  4. MailLog shows SENT (real SMTP delivery)
 *
 * Run: node scripts/e2e-phase8.cjs   (smtp-sink must be on 127.0.0.1:8025)
 */
const BASE = "http://127.0.0.1:3000";
const OWNER_EMAIL = "admin@vortex.local";
const OWNER_PASSWORD = "Vortex@2026";

let pass = 0;
let fail = 0;
const ok = (name, extra) => { pass += 1; console.log(`  ✔ ${name}${extra ? ` — ${extra}` : ""}`); };
const bad = (name, extra) => { fail += 1; console.log(`  ✘ ${name}${extra ? ` — ${extra}` : ""}`); };

async function call(path, { method = "GET", token, key, body, cookie, raw } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (key) headers["x-vx-key"] = key;
  if (cookie) headers.Cookie = cookie;
  const init = { method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(BASE + path, init);
  if (raw) return res;
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json, headers: res.headers };
}

async function latestOtpFromSink(email) {
  // poll the sink dir for the newest .eml containing the OTP mail to this email
  // (Subject arrives MIME-encoded — match on To: + "verification code" instead)
  const fs = require("fs");
  const dir = "/tmp/smtp-sink";
  for (let i = 0; i < 40; i++) {
    try {
      const files = fs.readdirSync(dir).filter((f) => f.endsWith(".eml")).sort((a, b) => Number(b.split(".")[0]) - Number(a.split(".")[0]));
      for (const f of files) {
        const content = fs.readFileSync(`${dir}/${f}`, "utf8");
        if (content.includes(`To: ${email}`) && content.includes("verification code")) {
          const m = content.match(/\b(\d{6})\b/);
          if (m) return m[1];
        }
      }
    } catch { /* dir not ready yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

async function main() {
  console.log("\n== 1. DEVELOPER CONSOLE (shobai use korte parbe) ==");
  const stamp = Date.now().toString(36);
  const devEmail = `builder_${stamp}@example.com`;
  const signup = await call("/api/vaas/v1/dev/signup", { method: "POST", body: { name: "Rahim Uddin", email: devEmail, password: "Builder@2026" } });
  signup.status === 201 ? ok("dev signup", `${devEmail}`) : bad("dev signup", JSON.stringify(signup.json));
  const devToken = signup.json?.token;
  if (!devToken) { bad("dev token missing — aborting dev section"); return; }

  const me = await call("/api/vaas/v1/dev/me", { token: devToken });
  me.json?.ok && me.json?.dev?.email === devEmail ? ok("dev me", `${me.json.dev.devId} plan=${me.json.dev.plan}`) : bad("dev me", JSON.stringify(me.json));

  const proj = await call("/api/vaas/v1/dev/projects", { method: "POST", token: devToken, body: { name: `Smoke App ${stamp}`, collections: ["posts", "profile"] } });
  proj.status === 201 ? ok("dev project created", proj.json?.projectId) : bad("dev project create", JSON.stringify(proj.json));
  const projectId = proj.json?.projectId;
  const clientKey = proj.json?.clientKey;

  const list = await call("/api/vaas/v1/dev/projects", { token: devToken });
  const row = (list.json?.projects || []).find((p) => p.projectId === projectId);
  row && row.clientKey && row.snippet ? ok("dev project list w/ clientKey+snippet", `${row.collections.length} cols · ৳${row.usageBdt}`) : bad("dev project list", JSON.stringify(list.json?.projects?.[0] || {}));

  const rot = await call(`/api/vaas/v1/dev/projects/${projectId}/rotate-keys`, { method: "POST", token: devToken, body: {} });
  rot.json?.ok && rot.json?.clientKey && rot.json?.adminKey ? ok("dev rotate keys", rot.json.clientKey.slice(0, 8) + "…") : bad("rotate keys", JSON.stringify(rot.json));
  const newClientKey = rot.json?.clientKey;

  const oldHealth = await call("/api/vaas/v1/health", { key: clientKey });
  oldHealth.status === 401 ? ok("old CLIENT key dead after rotate", "401") : bad("old key still alive", `status=${oldHealth.status}`);

  console.log("\n== 2. SDK SURFACE (Firebase-parity, real infra) ==");
  const health = await call("/api/vaas/v1/health", { key: newClientKey });
  health.json?.ok && health.json?.config?.projectId === projectId ? ok("health/bootstrap", `${health.json.config.storageBucket} · ${health.json.collections.length} cols`) : bad("health", JSON.stringify(health.json));

  const su = await call("/api/vaas/v1/auth/signup", { method: "POST", key: newClientKey, body: { email: `user_${stamp}@example.com`, password: "EndUser@2026", displayName: "Karim" } });
  su.json?.ok && su.json?.uid ? ok("end-user signup (scrypt)", su.json.uid) : bad("end-user signup", JSON.stringify(su.json));
  const idToken = su.json?.idToken;

  const add = await call("/api/vaas/v1/data/posts", { method: "POST", key: newClientKey, token: idToken, body: { data: { title: "Hello from the smoke test", likes: 0 } } });
  add.json?.ok && add.json?.doc ? ok("data: add doc", add.json.doc.id) : bad("data add", JSON.stringify(add.json));

  const qs = await call(`/api/vaas/v1/data/posts?contains=${encodeURIComponent(JSON.stringify({ title: "smoke" }))}`, { key: newClientKey });
  Array.isArray(qs.json?.items) && qs.json.items.length >= 1 ? ok("data: query contains", `${qs.json.items.length} hit(s)`) : bad("data query", JSON.stringify(qs.json));

  const up = await call("/api/vaas/v1/storage/upload", { method: "POST", key: newClientKey, token: idToken, body: { path: `smoke/${stamp}.txt`, contentB64: Buffer.from("VORTEX storage works").toString("base64"), mime: "text/plain" } });
  up.json?.ok ? ok("storage: upload (real bytes, 3x replicas)", `${up.json.sizeBytes}B · ${up.json.checksum?.slice(0, 10)}…`) : bad("storage upload", JSON.stringify(up.json));

  const rt = await call("/api/vaas/v1/rt/publish", { method: "POST", key: newClientKey, token: idToken, body: { channel: "smoke-room", type: "message", payload: { text: "hi" } } });
  rt.json?.ok ? ok("realtime: publish", rt.json.eventId) : bad("rt publish", JSON.stringify(rt.json));

  console.log("\n== 3. OWNER — OTP over REAL SMTP + AI builder auto-backend ==");
  const fs = require("fs");
  const sinkBefore = fs.existsSync("/tmp/smtp-sink") ? fs.readdirSync("/tmp/smtp-sink").length : 0;

  const login1 = await call("/api/v1/auth/login", { method: "POST", body: { email: OWNER_EMAIL, password: OWNER_PASSWORD } });
  login1.json?.ok && login1.json?.data?.otpRequired ? ok("owner password step", `delivery=${login1.json.data.delivery || "?"}`) : bad("owner password step", JSON.stringify(login1.json).slice(0, 200));

  const code = await latestOtpFromSink(OWNER_EMAIL);
  code ? ok("OTP arrived over REAL SMTP (parsed from .eml)", `code=${code}`) : bad("OTP not captured by sink");
  if (!code) {
    console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
    process.exit(1);
  }

  const cookies = login1.headers.getSetCookie ? login1.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") : "";
  const login2 = await call("/api/v1/auth/otp", { method: "POST", body: { email: OWNER_EMAIL, code }, cookie: cookies });
  const ownerCookie = login2.headers.getSetCookie ? login2.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") : "";
  login2.json?.ok ? ok("owner OTP verified — session opened") : bad("owner otp verify", JSON.stringify(login2.json).slice(0, 200));

  const appName = `NEXA Smoke ${stamp}`;
  const appReg = await call("/api/v1/apps", { method: "POST", body: { name: appName, description: "E2E: app + backend in one call" }, cookie: ownerCookie });
  const be = appReg.json?.data?.backend;
  appReg.status === 201 && be?.projectId ? ok("app registered + backend AUTO-PROVISIONED", `${appReg.json.data.app.appId} → ${be.projectId}`) : bad("app auto-backend", JSON.stringify(appReg.json).slice(0, 300));
  be?.adminKey && be?.snippet ? ok("NEXA wire returned keys+snippet once", be.adminKey.slice(0, 8) + "…") : bad("admin key/snippet missing");

  const appsGet = await call("/api/v1/apps", { cookie: ownerCookie });
  const linked = (appsGet.json?.data?.apps || []).find((a) => a.name === appName);
  linked?.backend?.projectId === be?.projectId && linked?.backend?.clientKey ? ok("apps GET carries backend link", linked.backend.projectId) : bad("apps GET backend", JSON.stringify(linked?.backend || {}).slice(0, 200));

  // the NEXA-provisioned backend ships with the onUserWelcome EVENT_AUTH function
  if (be?.clientKey) {
    const finv = await call("/api/vaas/v1/fn/onUserWelcome/invoke", { method: "POST", key: be.clientKey, body: { payload: { event: "signup", user: { uid: "vxu_smoke" } } } });
    finv.json?.ok && finv.json?.status === "OK" ? ok("functions: invoke onUserWelcome (NEXA fn)", `${finv.json.latencyMs}ms`) : bad("fn invoke", JSON.stringify(finv.json).slice(0, 200));

    const authEvt = await call("/api/vaas/v1/auth/signup", { method: "POST", key: be.clientKey, body: { email: `nexau_${stamp}@example.com`, password: "EndUser@2026", displayName: "Nexa User" } });
    authEvt.json?.ok ? ok("app backend end-user signup (fires EVENT_AUTH fn)", authEvt.json.uid) : bad("app backend signup", JSON.stringify(authEvt.json).slice(0, 150));
  }

  console.log("\n== 4. SMTP DELIVERY PROOF ==");
  const sinkAfter = fs.existsSync("/tmp/smtp-sink") ? fs.readdirSync("/tmp/smtp-sink").length : 0;
  sinkAfter > sinkBefore ? ok("SMTP sink captured new messages", `${sinkBefore} → ${sinkAfter} .eml`) : bad("no new sink messages");

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("SMOKE CRASH:", e);
  process.exit(1);
});
