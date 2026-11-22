/**
 * One-shot E2E runner — manages the SMTP sink INSIDE this process tree.
 *
 * Why: starting daemons via shell backgrounding (nohup … &) corrupts the
 * sandbox gateway session, so the sink must never outlive this command.
 *
 * Flow:
 *   1. kill any stale sink still bound to 8025 (best effort)
 *   2. spawn scripts/smtp-sink.cjs as a tracked child
 *   3. wait until 127.0.0.1:8025 accepts (node net.connect, not /dev/tcp)
 *   4. run scripts/e2e-phase8.cjs as a child, inherit stdio
 *   5. kill the sink, exit with the smoke's exit code — clean session end
 */
const { spawn, execSync } = require("child_process");
const net = require("net");
const path = require("path");
const fs = require("fs");

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
      const s = net.connect({ port, host }, () => {
        s.destroy();
        resolve();
      });
      s.on("error", () => {
        s.destroy();
        if (Date.now() > deadline) reject(new Error("sink never opened 127.0.0.1:8025"));
        else setTimeout(tryOnce, 150);
      });
    };
    tryOnce();
  });
}

(async () => {
  try {
    await waitPort(8025, "127.0.0.1", 8000);
    console.log("— sink up on 127.0.0.1:8025 —");
    const code = await new Promise((resolve) => {
      const t = spawn(process.execPath, [path.join(__dirname, "e2e-phase8.cjs")], { stdio: "inherit" });
      t.on("exit", resolve);
    });
    sink.kill("SIGTERM");
    process.exit(code);
  } catch (e) {
    console.error("runner failed:", e.message);
    try {
      sink.kill("SIGTERM");
    } catch {}
    process.exit(1);
  }
})();
