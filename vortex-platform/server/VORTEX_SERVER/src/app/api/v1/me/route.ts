import { ok } from "@/lib/vortex/api";
import { requireSession } from "@/lib/vortex/api";

export async function GET(req: Request) {
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;

  return ok({ user: gate.user });
}
