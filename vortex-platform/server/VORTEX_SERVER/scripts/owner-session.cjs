/**
 * Owner session fetcher — prints the vortex_session cookie for browser checks.
 * Manages the SMTP sink inside this process tree (no shell backgrounding):
 *   spawn sink → owner password step → OTP parsed from sink .eml → OTP verify
 *   → print cookie → kill sink → clean exit.
 */
const { spawn, execSync } = require("child_process");
const net = require("net");
const path = require("path");
const fs = require("fs");

const BASE = "http://127.0.0.1:3000";
const OWNER_EMAIL = "admin@vortex.local";
const OWNER_PASSWORD = "Vortex@2026";
const LOG = "/tmp/smtp-sink.log";
const out = fs.openSync(LOG, "a");

try {
  execSync("pkill -f smtp-sink.cjs || true", { stdio: "ignore" });
} catch {}

// stale .eml files from previous runs carry dead OTP codes — wipe the sink dir
fs.rmSync("/tmp/smtp-sink", { recursive: true, force: true });
fs.mkdirSync("/tmp/smtp-sink", { recursive: true });

const sink = spawn(process.execPath, [path.join(__dirname, "smtp-sink.cjs")], {
  stdio: ["ignore", out, out],
});

function waitPort(port, host, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const s = net.connect({ port, host }, () => { s.destroy(); resolve(); });
      s.on("error", () => {
        s.destroy();
        if (Date.now() > deadline) reject(new Error("sink never opened"));
        else setTimeout(tryOnce, 150);
      });
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

(async () => {
  try {
    await waitPort(8025, "127.0.0.1", 8000);
    const step1 = await fetch(`${BASE}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASSWORD }),
    });
    const j1 = await step1.json();
    if (!j1?.ok || !j1?.data?.otpRequired) throw new Error("password step failed: " + JSON.stringify(j1).slice(0, 200));
    const preCookie = (step1.headers.getSetCookie ? step1.headers.getSetCookie() : []).map((c) => c.split(";")[0]).join("; ");

    const code = await latestOtp(OWNER_EMAIL);
    if (!code) throw new Error("OTP never arrived at sink");
    const step2 = await fetch(`${BASE}/api/v1/auth/otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: preCookie },
      body: JSON.stringify({ email: OWNER_EMAIL, code }),
    });
    const j2 = await step2.json();
    if (!j2?.ok) throw new Error("otp verify failed: " + JSON.stringify(j2).slice(0, 200));
    const set = step2.headers.getSetCookie ? step2.headers.getSetCookie() : [];
    const session = set.find((c) => c.startsWith("vortex_session="));
    if (!session) throw new Error("no vortex_session cookie returned");
    console.log(session.split(";")[0]);
    sink.kill("SIGTERM");
    process.exit(0);
  } catch (e) {
    console.error("owner-session failed:", e.message);
    try { sink.kill("SIGTERM"); } catch {}
    process.exit(1);
  }
})();
