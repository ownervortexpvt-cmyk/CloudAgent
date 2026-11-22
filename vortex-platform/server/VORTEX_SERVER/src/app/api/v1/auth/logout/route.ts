import { ok } from "@/lib/vortex/api";
import { revokeSession, SESSION_COOKIE } from "@/lib/vortex/auth";
import { writeAudit } from "@/lib/vortex/audit";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const revoked = await revokeSession(req);
  if (revoked) {
    await writeAudit({ actor: "session", action: "AUTH_LOGOUT", resource: "vortex-id" });
  }
  const res = NextResponse.json({ ok: true, data: { loggedOut: true } });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
