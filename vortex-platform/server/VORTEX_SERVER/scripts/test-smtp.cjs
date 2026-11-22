// SMTP wiring E2E: regression (simulated) -> wire SMTP -> real send -> OTP suppresses devCode -> failure path -> cleanup
const { execSync } = require("child_process");
const fs = require("fs");
const BASE = "http://localhost:3000";
const EMAIL = "admin@vortex.local";
const PASSWORD = "Vortex@2026";

function getCookie(res, name) {
  // return the full "name=value" pair so callers can drop it straight into Cookie:
  for (const c of res.headers.getSetCookie ? res.headers.getSetCookie() : []) {
    const [pair] = c.split(";");
    const eq = pair.indexOf("=");
    if (pair.slice(0, eq).trim() === name) return pair;
  }
  return null;
}

async function login() {
  let res = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const l = await res.json();
  console.log("  [login] status:", res.status, "devCode?", !!l.data?.devCode);
  res = await fetch(`${BASE}/api/v1/auth/otp`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, code: l.data.devCode }),
  });
  const otpBody = await res.json();
  console.log("  [otp] status:", res.status, "ok:", otpBody.ok);
  if (!otpBody.ok) throw new Error("otp failed");
  const session = getCookie(res, "vortex_session");
  console.log("  [otp] session?", !!session, session ? session.slice(0, 8) : "");
  return session;
}

let passed = 0, failedCount = 0;
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`PASS  ${name}`); }
  else { failedCount += 1; console.log(`FAIL  ${name}${extra ? " :: " + JSON.stringify(extra).slice(0, 220) : ""}`); }
}

(async () => {
  fs.rmSync("/tmp/smtp-sink", { recursive: true, force: true });
  fs.mkdirSync("/tmp/smtp-sink", { recursive: true });
  const runStart = Date.now() - 1000; // sink counter persists across runs; track this run's captures

  // ---- Pre-clean: any leftover SMTP wiring from a crashed run would suppress
  //      the dev OTP hint and block login — reset mail delivery directly in the DB ----
  execSync(
    `python3 -c "import sqlite3; con = sqlite3.connect('db/custom.db'); con.execute(\\"UPDATE AppConfig SET value='simulated' WHERE key='mail.provider'\\"); con.execute(\\"DELETE FROM AppConfig WHERE key LIKE 'mail.smtp_%'\\"); con.commit(); con.close()"`,
    { cwd: "/home/z/my-project" }
  );

  // ---- 0. Regression: simulated provider still shows dev OTP hint ----
  let cookie = await login();
  check("login with dev hint (simulated)", !!cookie);
  let res = await fetch(`${BASE}/api/v1/mail`, { headers: { Cookie: cookie } });
  let mailJson = await res.json();
  if (!mailJson.ok) {
    console.error("GET /mail status:", res.status, JSON.stringify(mailJson).slice(0, 200));
  }
  let mail = mailJson.data;
  check("GET /mail returns smtp status object", !!mail.smtp && typeof mail.smtp.configured === "boolean", mail.smtp);
  check("smtp simulated baseline", mail.smtp.configured === false && mail.smtp.transport === "simulated", mail.smtp);

  // ---- 1. Save SMTP settings via API (provider still simulated) ----
  res = await fetch(`${BASE}/api/v1/mail`, {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ op: "smtp.save", host: "127.0.0.1", port: 8025, user: "vortex", pass: "sink-secret", from: "vortex@vortex.internal", secure: false }),
  });
  const saved = await res.json();
  check("smtp.save accepts settings", saved.ok && saved.data.smtp.configured === false, saved); // provider=simulated => resolve returns null
  res = await fetch(`${BASE}/api/v1/mail`, {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ op: "provider", provider: "smtp" }),
  });
  check("provider switched to smtp", (await res.json()).ok);

  res = await fetch(`${BASE}/api/v1/mail`, { headers: { Cookie: cookie } });
  mail = (await res.json()).data;
  check("smtp now configured (db source)", mail.smtp.configured === true && mail.smtp.source === "db", mail.smtp);
  check("password never returned in status", !JSON.stringify(mail.smtp).includes("sink-secret"), mail.smtp);

  // ---- 2. smtp.test -> real SMTP delivery to the sink ----
  res = await fetch(`${BASE}/api/v1/mail`, {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ op: "smtp.test" }),
  });
  const test = await res.json();
  check("smtp.test returns SENT", test.ok && test.data.status === "SENT", test);

  // ---- 3. OTP issuance: real send, devCode suppressed ----
  res = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const loginResp = await res.json();
  check("OTP real send: devCode suppressed", loginResp.ok && loginResp.data.otpRequired === true && !loginResp.data.devCode, loginResp.data);
  check("OTP real send: delivery=SENT in response", loginResp.data?.delivery === "SENT", loginResp.data);

  res = await fetch(`${BASE}/api/v1/mail`, { headers: { Cookie: cookie } });
  mail = (await res.json()).data;
  const otpMail = mail.mails.find((m) => m.category === "otp");
  check("OTP mail row marked SENT", otpMail && otpMail.status === "SENT", otpMail);

  // ---- 4. Sink actually captured the messages (2: test + otp) ----
  const files = fs.readdirSync("/tmp/smtp-sink").filter((f) => fs.statSync(`/tmp/smtp-sink/${f}`).mtimeMs >= runStart);
  check("sink captured 2 messages this run", files.length >= 2, { count: files.length });
  // pick the newest capture of this run
  const newest = files
    .map((f) => ({ f, t: fs.statSync(`/tmp/smtp-sink/${f}`).mtimeMs }))
    .sort((a, b) => b.t - a.t)[0]?.f;
  const eml = fs.readFileSync(`/tmp/smtp-sink/${newest}`, "utf8");
  // nodemailer MIME-encodes non-ASCII subjects: =?UTF-8?Q?...your_login_code?= or plain fallback
  check(
    "last captured mail is the OTP mail",
    eml.includes("your_login_code") || eml.includes("your login code"),
    eml.slice(0, 140)
  );
  const codeMatch = eml.match(/code is:\s*(\d{6})/);
  check("OTP code present inside real SMTP payload", !!codeMatch, eml.slice(0, 200));
  if (codeMatch) {
    // prove the OTP from the SMTP payload is valid — full login with it
    const code = codeMatch[1];
    const r2 = await fetch(`${BASE}/api/v1/auth/otp`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: EMAIL, code }),
    });
    const ok2 = (await r2.json()).ok;
    check("OTP code captured from SMTP payload authenticates the owner", ok2 === true);
    cookie = getCookie(r2, "vortex_session") || cookie;
  }

  // ---- 5. Failure path: unreachable relay -> FAILED + honest status ----
  res = await fetch(`${BASE}/api/v1/mail`, {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ op: "smtp.save", host: "127.0.0.1", port: 8299 }),
  });
  check("smtp.save allows re-pointing", (await res.json()).ok);
  res = await fetch(`${BASE}/api/v1/mail`, {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ op: "send", to: EMAIL, subject: "failure path probe", body: "should fail", category: "system" }),
  });
  const probe = await res.json();
  check("unreachable relay -> FAILED status", probe.ok && probe.data.mail.status === "FAILED", probe);

  // ---- 6. Cleanup: clear SMTP, provider back to simulated ----
  res = await fetch(`${BASE}/api/v1/mail`, {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ op: "smtp.clear" }),
  });
  const cleared = await res.json();
  check("smtp.clear wipes settings", cleared.ok && cleared.data.smtp.configured === false, cleared);
  res = await fetch(`${BASE}/api/v1/mail`, {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ op: "provider", provider: "simulated" }),
  });
  check("provider restored to simulated", (await res.json()).ok);
  res = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const reg = await res.json();
  check("regression: dev hint returns once simulated", reg.ok && !!reg.data.devCode, reg.data);

  console.log(`\nRESULT: ${passed} passed, ${failedCount} failed`);
  if (failedCount > 0) process.exit(1);
})().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
