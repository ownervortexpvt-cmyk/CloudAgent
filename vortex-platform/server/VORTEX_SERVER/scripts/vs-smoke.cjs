/**
 * VORTEX SERVER namespace E2E smoke — real HTTP against 127.0.0.1:3000.
 * Owner OTP session via the managed SMTP sink (in-process, gateway-safe).
 * Covers: admin overview/platforms/storage, platform key issuance, cloud-agent
 * project+source+build+export (signed URL redemption), website site+deploy,
 * appverse app+version+review+download, VI monitor task, isolation denials.
 */
const { spawn, execSync } = require("child_process");
const net = require("net");
const path = require("path");
const fs = require("fs");

const BASE = process.env.VS_BASE || "http://127.0.0.1:3200";
const OWNER_EMAIL = "admin@vortex.local";
const OWNER_PASSWORD = "Vortex@2026";

let pass = 0;
let fail = 0;
const ok = (n, x) => { pass += 1; console.log(`  + ${n}${x ? ` - ${x}` : ""}`); };
const bad = (n, x) => { fail += 1; console.log(`  x ${n}${x ? ` - ${x}` : ""}`); };

async function call(p, { method = "GET", body, cookie, token } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (token) headers.Authorization = `Bearer ${token}`;
  const init = { method, headers };
  if (body !== undefined) { headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
  const res = await fetch(BASE + p, init);
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json, headers: res.headers };
}

function waitPort(port, host, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const s = net.connect({ port, host }, () => { s.destroy(); resolve(); });
      s.on("error", () => { s.destroy(); if (Date.now() > deadline) reject(new Error("sink never opened")); else setTimeout(tryOnce, 150); });
    };
    tryOnce();
  });
}

function latestOtp(email) {
  const dir = "/tmp/smtp-sink";
  return new Promise((resolve) => {
    let n = 0;
    const tick = setInterval(() => {
      n += 1;
      try {
        const files = fs.readdirSync(dir).filter((f) => f.endsWith(".eml")).sort((a, b) => Number(b.split(".")[0]) - Number(a.split(".")[0]));
        for (const f of files) {
          const content = fs.readFileSync(`${dir}/${f}`, "utf8");
          if (content.includes(`To: ${email}`) && content.includes("verification code")) {
            const m = content.match(/\b(\d{6})\b/);
            if (m) { clearInterval(tick); resolve(m[1]); return; }
          }
        }
      } catch {}
      if (n > 120) { clearInterval(tick); resolve(null); }
    }, 250);
  });
}

async function ownerCookie() {
  const step1 = await fetch(`${BASE}/api/v1/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASSWORD }) });
  const j1 = await step1.json();
  if (!j1?.ok || !j1?.data?.otpRequired) throw new Error("owner password step failed");
  const pre = (step1.headers.getSetCookie ? step1.headers.getSetCookie() : []).map((c) => c.split(";")[0]).join("; ");
  const code = await latestOtp(OWNER_EMAIL);
  if (!code) throw new Error("OTP never arrived");
  const step2 = await fetch(`${BASE}/api/v1/auth/otp`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: pre }, body: JSON.stringify({ email: OWNER_EMAIL, code }) });
  const set = step2.headers.getSetCookie ? step2.headers.getSetCookie() : [];
  const c = set.find((x) => x.startsWith("vortex_session="));
  if (!c) throw new Error("no session cookie");
  return c.split(";")[0];
}

async function main() {
  const LOG = "/tmp/smtp-sink.log";
  const out = fs.openSync(LOG, "a");
  try { execSync("pkill -f smtp-sink.cjs || true", { stdio: "ignore" }); } catch {}
  fs.rmSync("/tmp/smtp-sink", { recursive: true, force: true });
  fs.mkdirSync("/tmp/smtp-sink", { recursive: true });
  const sink = spawn(process.execPath, [path.join(__dirname, "smtp-sink.cjs")], { stdio: ["ignore", out, out] });
  try {
    await waitPort(8025, "127.0.0.1", 8000);
    const cookie = await ownerCookie();
    console.log("== 1. ADMIN NAMESPACE (owner session) ==");
    const ov = await call("/api/v1/admin/overview", { cookie });
    ov.json?.ok && ov.json?.data?.totals ? ok("admin overview", `CA projects=${ov.json.data.totals.cloudAgentProjects}, pool=${ov.json.data.storagePool.pct}%`) : bad("admin overview", JSON.stringify(ov.json).slice(0, 120));
    const plat = await call("/api/v1/admin/platforms", { cookie });
    plat.json?.ok && plat.json?.data?.platforms?.length === 5 ? ok("platform registry", plat.json.data.platforms.map((p) => p.platformId).join(",")) : bad("platform registry", JSON.stringify(plat.json).slice(0, 120));
    const bucketCount = plat.json?.data?.bucketRegistry?.length;
    bucketCount === 10 ? ok("bucket registry seeded", `${bucketCount} buckets`) : bad("bucket registry", `count=${bucketCount}`);
    const sto = await call("/api/v1/admin/storage", { cookie });
    sto.json?.ok && sto.json?.data?.provider ? ok("storage truth-check", `provider=${sto.json.data.provider.active} buckets=${sto.json.data.buckets.length}`) : bad("storage", JSON.stringify(sto.json).slice(0, 120));

    console.log("== 2. PLATFORM KEYS ==");
    const keyRes = await call("/api/v1/admin/platforms/cloud-agent/keys", { method: "POST", cookie, body: { name: "smoke ca key" } });
    const caKey = keyRes.json?.data?.raw;
    caKey ? ok("cloud-agent key issued", `${keyRes.json.data.keyId} scopes=${keyRes.json.data.scopes.join("|")}`) : bad("key issuance", JSON.stringify(keyRes.json).slice(0, 120));
    const webRes = await call("/api/v1/admin/platforms/vortex-website/keys", { method: "POST", cookie, body: { name: "smoke web key" } });
    const webKey = webRes.json?.data?.raw;
    webKey ? ok("vortex-website key issued", webRes.json.data.keyId) : bad("web key", JSON.stringify(webRes.json).slice(0, 120));
    const avRes = await call("/api/v1/admin/platforms/appverse/keys", { method: "POST", cookie, body: { name: "smoke av key" } });
    const avKey = avRes.json?.data?.raw;
    avKey ? ok("appverse key issued", avRes.json.data.keyId) : bad("av key", "");
    const viRes = await call("/api/v1/admin/platforms/vi/keys", { method: "POST", cookie, body: { name: "smoke vi key" } });
    const viKey = viRes.json?.data?.raw;
    viKey ? ok("vi key issued", viRes.json.data.keyId) : bad("vi key", "");

    const denied = await call("/api/v1/admin/overview", { token: caKey });
    denied.status === 403 ? ok("platform key rejected on admin namespace", "403") : bad("admin isolation", `status=${denied.status}`);

    console.log("== 3. CLOUD AGENT — project / source / build / export ==");
    const stamp = Date.now().toString(36);
    const proj = await call("/api/v1/cloud-agent/projects", { method: "POST", token: caKey, body: { name: `Smoke App ${stamp}`, type: "flutter", ownerEmail: `dev_${stamp}@example.com` } });
    const caId = proj.json?.data?.projectId;
    proj.status === 201 && caId ? ok("project created", `${caId} (${proj.json.data.type})`) : bad("project create", JSON.stringify(proj.json).slice(0, 150));
    const src = await call(`/api/v1/cloud-agent/projects/${caId}/source`, { method: "POST", token: caKey, body: {
      entry: "lib/main.dart",
      files: [
        { path: "lib/main.dart", contentB64: Buffer.from("void main() => print('hello vortex');").toString("base64") },
        { path: "pubspec.yaml", contentB64: Buffer.from("name: smoke_app\nversion: 1.0.0").toString("base64") },
      ],
    } });
    src.json?.ok && src.json?.data?.status === "READY" ? ok("source registered (real bytes)", `${src.json.data.files} files, ${src.json.data.sizeBytes}B`) : bad("source", JSON.stringify(src.json).slice(0, 150));
    const build = await call(`/api/v1/cloud-agent/projects/${caId}/build`, { method: "POST", token: caKey, body: { trigger: "smoke" } });
    build.json?.ok && build.json?.data?.status === "SUCCESS" ? ok("build pipeline SUCCESS", `${build.json.data.buildId} artifact ${build.json.data.sizeBytes}B sha=${(build.json.data.checksum || "").slice(0, 10)}`) : bad("build", JSON.stringify(build.json).slice(0, 150));
    const exp = await call(`/api/v1/cloud-agent/projects/${caId}/export`, { token: caKey });
    const srcUrl = exp.json?.data?.url;
    srcUrl ? ok("export links issued", `what=${exp.json.data.what} expires=${exp.json.data.expiresAt}`) : bad("export", JSON.stringify(exp.json).slice(0, 150));
    if (srcUrl && srcUrl.startsWith("/")) {
      const redeem = await fetch(BASE + srcUrl);
      const bytes = await redeem.text();
      redeem.status === 200 && bytes.includes("files") && bytes.length > 100 ? ok("signed URL redeemed", `${bytes.length}B manifest downloaded`) : bad("signed redeem", `status=${redeem.status} len=${bytes.length}`);
    }

    console.log("== 4. VORTEX WEBSITE — site / files / deploy ==");
    const site = await call("/api/v1/vortex-website/sites", { method: "POST", token: webKey, body: { name: `Smoke Site ${stamp}`, ownerEmail: `dev_${stamp}@example.com` } });
    const wsId = site.json?.data?.siteId;
    site.status === 201 && wsId ? ok("site created", site.json.data.subdomain) : bad("site create", JSON.stringify(site.json).slice(0, 150));
    const wf = await call(`/api/v1/vortex-website/sites/${wsId}/files`, { method: "POST", token: webKey, body: { files: [
      { path: "index.html", contentB64: Buffer.from("<!doctype html><html><body><h1>VORTEX SITE</h1></body></html>").toString("base64") },
      { path: "style.css", contentB64: Buffer.from("body{margin:0;font-family:sans-serif}").toString("base64") },
    ] } });
    wf.json?.ok ? ok("site files uploaded", `${wf.json.data.accepted} files`) : bad("site files", JSON.stringify(wf.json).slice(0, 150));
    const dep = await call(`/api/v1/vortex-website/sites/${wsId}/deploy`, { method: "POST", token: webKey, body: {} });
    dep.json?.ok && dep.json?.data?.status === "SUCCESS" ? ok("deploy SUCCESS", `v${dep.json.data.version} ${dep.json.data.files} files -> ${dep.json.data.url}`) : bad("deploy", JSON.stringify(dep.json).slice(0, 150));
    if (!(dep.json?.ok && dep.json?.data?.status === "SUCCESS")) {
      const detail = await call(`/api/v1/vortex-website/sites/${wsId}`, { token: webKey });
      console.log(`    deploy log: ${JSON.stringify(detail.json?.data?.deployments?.[0]?.log || "n/a")}`);
    }
    const wdl = await call(`/api/v1/vortex-website/sites/${wsId}/download`, { token: webKey });
    wdl.json?.ok ? ok("site signed download", `v${wdl.json.data.version}`) : bad("site download", JSON.stringify(wdl.json).slice(0, 120));

    console.log("== 5. APPVERSE — app / version / review / download ==");
    const app = await call("/api/v1/appverse/apps", { method: "POST", token: avKey, body: { name: `Smoke App ${stamp}`, packageName: `com.vortex.smoke${stamp}`, category: "tools" } });
    const avId = app.json?.data?.appId;
    app.status === 201 && avId ? ok("app registered", app.json.data.packageName) : bad("app create", JSON.stringify(app.json).slice(0, 150));
    const fakeApk = Buffer.alloc(2048, 7);
    const ver = await call(`/api/v1/appverse/apps/${avId}/versions`, { method: "POST", token: avKey, body: { version: "1.0.0", kind: "APK", contentB64: fakeApk.toString("base64"), changelog: "first smoke release" } });
    const vvId = ver.json?.data?.versionId;
    ver.json?.ok ? ok("APK version uploaded (sha256 integrity)", `sha=${ver.json.data.sha256.slice(0, 10)} status=${ver.json.data.status}`) : bad("version", JSON.stringify(ver.json).slice(0, 150));
    const deniedDl = await call(`/api/v1/appverse/apps/${avId}/download`, { token: avKey });
    deniedDl.status === 403 ? ok("unpublished download blocked", "403") : bad("download gate", `status=${deniedDl.status}`);
    const apr = await call(`/api/v1/appverse/versions/${vvId}/approve`, { method: "POST", token: avKey, body: { decision: "approve" } });
    apr.json?.ok && apr.json?.data?.published ? ok("review gate -> PUBLISHED", `v${ver.json.data.version}`) : bad("review", JSON.stringify(apr.json).slice(0, 150));
    const dl = await call(`/api/v1/appverse/apps/${avId}/download`, { token: avKey });
    dl.json?.ok && dl.json?.data?.url ? ok("published signed download", `expires=${dl.json.data.expiresAt}`) : bad("download", JSON.stringify(dl.json).slice(0, 150));
    if (dl.json?.data?.url?.startsWith("/")) {
      const redeem = await fetch(BASE + dl.json.data.url);
      const buf = Buffer.from(await redeem.arrayBuffer());
      redeem.status === 200 && buf.length === fakeApk.length && buf.equals(fakeApk) ? ok("APK bytes round-trip + integrity", `${buf.length}B exact match`) : bad("apk redeem", `status=${redeem.status} len=${buf.length}`);
    }

    console.log("== 6. VI — monitor task (real stats) + gated task ==");
    const mon = await call("/api/v1/vi/tasks", { method: "POST", token: viKey, body: { kind: "monitor", title: "ecosystem snapshot" } });
    mon.json?.ok && mon.json?.data?.result?.snapshot ? ok("VI monitor task DONE", `projects=${mon.json.data.result.snapshot.cloudAgentProjects} apps=${mon.json.data.result.snapshot.apps} storage=${mon.json.data.result.snapshot.storage.pct}%`) : bad("vi monitor", JSON.stringify(mon.json).slice(0, 150));
    const gated = await call("/api/v1/vi/tasks", { method: "POST", token: viKey, body: { kind: "deploy", title: "deploy smoke site", payload: { siteId: wsId } } });
    gated.json?.ok && gated.json?.data?.status === "NEEDS_APPROVAL" ? ok("VI deploy gated (needs owner)", gated.json.data.taskId) : bad("vi gate", JSON.stringify(gated.json).slice(0, 150));
    const approve = await call(`/api/v1/vi/tasks/${gated.json?.data?.taskId}/approve`, { method: "POST", cookie, body: {} });
    approve.json?.ok && approve.json?.data?.status === "DONE" ? ok("owner approval completes task", approve.json.data.taskId) : bad("vi approve", JSON.stringify(approve.json).slice(0, 150));
    const assist = await call("/api/v1/vi/tasks", { method: "POST", cookie, body: { kind: "assist", title: "explain", payload: { prompt: "Say OK if you can hear me." } } });
    assist.json?.ok && assist.json?.data?.status === "DONE" && assist.json?.data?.result?.reply ? ok("VI assist via real LLM", `${String(assist.json.data.result.reply).slice(0, 60)}...`) : bad("vi assist", JSON.stringify(assist.json).slice(0, 150));

    console.log("== 7. BILLING + SECURITY (real rows) ==");
    const bill = await call("/api/v1/admin/billing", { cookie });
    bill.json?.ok && bill.json?.data?.cloudAgentPlans?.length === 5 ? ok("INR plans seeded", bill.json.data.cloudAgentPlans.map((p) => p.priceInr).join("/")) : bad("billing", JSON.stringify(bill.json).slice(0, 120));
    const sec = await call("/api/v1/admin/security", { cookie });
    sec.json?.ok && Array.isArray(sec.json?.data?.recentAudits) ? ok("security + audit feed", `${sec.json.data.recentAudits.length} recent rows`) : bad("security", "");

    console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
    process.exitCode = fail ? 1 : 0;
  } catch (e) {
    console.error("SMOKE CRASH:", e.message);
    process.exitCode = 1;
  } finally {
    try { sink.kill("SIGTERM"); } catch {}
  }
}

main();
