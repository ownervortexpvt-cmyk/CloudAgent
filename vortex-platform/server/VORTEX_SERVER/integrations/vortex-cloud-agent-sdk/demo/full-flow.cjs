// CLOUD AGENT ⇄ VORTEX SERVER — full pipeline demo via the SDK.
// 1) spins the SMTP sink, 2) owner OTP login, 3) issues the CLOUD AGENT
// platform key exactly like the dashboard does, 4) runs the SDK through
// project → source → build → signed export → byte-verified download.
//
// Run: node demo/full-flow.cjs   (dev server must be on 127.0.0.1:3000)

const { spawn, execSync } = require("child_process");
const net = require("net");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { pathToFileURL } = require("url");

// dynamic-import the ESM SDK from this CommonJS demo
const sdkUrl = pathToFileURL(path.join(__dirname, "..", "vortex-client.mjs")).href;

const BASE = "http://127.0.0.1:3000";
const OWNER_EMAIL = "admin@vortex.local";
const OWNER_PASSWORD = "Vortex@2026";

async function loadSdk() {
  return import(sdkUrl);
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
  const { VortexCloudAgent } = await loadSdk();
  const stamp = Date.now().toString(36);
  let pass = 0;
  const ok = (n, x) => { pass += 1; console.log(`  + ${n}${x ? ` — ${x}` : ""}`); };

  // --- 1. issue the platform key exactly like the dashboard "Issue key" button ---
  const LOG = "/tmp/smtp-sink.log";
  const out = fs.openSync(LOG, "a");
  try { execSync("pkill -f smtp-sink.cjs || true", { stdio: "ignore" }); } catch {}
  fs.rmSync("/tmp/smtp-sink", { recursive: true, force: true });
  fs.mkdirSync("/tmp/smtp-sink", { recursive: true });
  const sinkPath = "/home/z/my-project/scripts/smtp-sink.cjs";
  const sink = spawn(process.execPath, [sinkPath], { stdio: ["ignore", out, out] });
  let platformKey;
  try {
    await waitPort(8025, "127.0.0.1", 8000);
    const cookie = await ownerCookie();
    const res = await fetch(`${BASE}/api/v1/admin/platforms/cloud-agent/keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ name: `sdk demo ${stamp}` }),
    });
    const j = await res.json();
    if (!j?.ok || !j?.data?.raw) throw new Error("key issuance failed: " + JSON.stringify(j).slice(0, 120));
    platformKey = j.data.raw;
    ok("CLOUD AGENT platform key issued", `${j.data.keyId} — raw shown ONCE (this is what the dashboard gives you)`);
    console.log(`    key preview: ${platformKey.slice(0, 18)}…`);
  } finally {
    try { sink.kill("SIGTERM"); } catch {}
  }

  // --- 2. everything below uses ONLY the SDK + the platform key ---
  const ca = new VortexCloudAgent({ baseUrl: BASE, platformKey });

  ok("client constructed", `${ca.baseUrl} / pk_live_…`);

  const project = await ca.createProject({
    name: `SDK Demo App ${stamp}`,
    type: "flutter",
    ownerEmail: `user_${stamp}@cloudagent.example`,
    meta: { source: "sdk-demo" },
  });
  ok("createProject", `${project.projectId} status=${project.status}`);

  const src = await ca.uploadSource(project.projectId, [
    { path: "lib/main.dart", content: "import 'package:flutter/material.dart';\nvoid main() => runApp(const VortexApp());\n" },
    { path: "pubspec.yaml", content: "name: vortex_sdk_demo\nenvironment:\n  sdk: '>=3.0.0 <4.0.0'\n" },
    { path: "README.md", content: "# Built by CLOUD AGENT via VORTEX SERVER SDK\n" },
  ], { entry: "lib/main.dart" });
  ok("uploadSource", `${src.files} files, ${src.sizeBytes} bytes, status=${src.status}`);

  const build = await ca.build(project.projectId, { trigger: "agent" });
  ok("build", `${build.buildId} status=${build.status} checksum=${build.checksum.slice(0, 12)}…`);

  const links = await ca.exportLinks(project.projectId);
  ok("exportLinks", `source=${links.source ? "yes" : "no"} artifact=${links.artifact ? "yes" : "no"}`);

  const artifact = await ca.exportSigned(project.projectId, "artifact");
  const bytes = await ca.download(artifact.url);
  const sha = crypto.createHash("sha256").update(bytes).digest("hex");
  if (sha !== build.checksum) throw new Error(`checksum mismatch: expected ${build.checksum}, got ${sha}`);
  ok("signed download + checksum verify", `${bytes.length} bytes, sha256 match`);

  const detail = await ca.getProject(project.projectId);
  ok("getProject", `builds=${detail.builds.length} latest=${detail.builds[0].status}`);

  console.log(`\n  ${pass}/8 SDK steps passed — CLOUD AGENT is wired to VORTEX SERVER.`);
}

main().catch((e) => { console.error("DEMO FAILED:", e.message); process.exit(1); });
