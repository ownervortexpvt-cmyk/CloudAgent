/**
 * VORTEX VaaS in-process background worker (v145).
 *
 * register() runs once when the standalone server boots. The scheduler used to
 * depend on the dashboard being open (vaasState) — now scheduled cloud
 * functions + presence sweeping run EVERY 60s inside the server process
 * itself, zero external dependencies (stronger than Firebase, which needs
 * Cloud Scheduler + pub/sub wiring for the same job).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const g = globalThis as typeof globalThis & { __vxSchedulerStarted?: boolean };
  if (g.__vxSchedulerStarted) return;
  g.__vxSchedulerStarted = true;

  const { vaasTick } = await import("@/lib/vortex/vaas");

  setInterval(() => {
    vaasTick().catch(() => undefined);
  }, 60_000);

  // first tick shortly after boot (staggered to avoid competing with startup)
  setTimeout(() => {
    vaasTick().catch(() => undefined);
  }, 15_000);
}
