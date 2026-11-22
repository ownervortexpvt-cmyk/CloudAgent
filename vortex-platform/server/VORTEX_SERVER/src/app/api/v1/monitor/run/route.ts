import { ok, requireSession } from "@/lib/vortex/api";
import { ensureSeeded } from "@/lib/vortex/seed";
import { executeChecks } from "@/lib/vortex/monitor";

/** POST /monitor/run — force a full check sweep across all enabled targets. */
export async function POST(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;

  const origin = new URL(req.url).origin;
  const summary = await executeChecks(origin, { force: true });
  return ok({ summary });
}
