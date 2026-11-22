import { NextResponse } from "next/server";
import { getSessionUser, type SessionUser } from "./auth";

/**
 * VORTEX API helpers — every /api/v1 response follows one envelope.
 */

export function ok<T>(data: T, init?: number) {
  return NextResponse.json({ ok: true, data }, { status: init ?? 200 });
}

export function fail(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

/** Gate for dashboard APIs: requires a valid VORTEX ID session. */
export async function requireSession(
  req: Request
): Promise<{ user: SessionUser } | { response: NextResponse }> {
  const user = await getSessionUser(req);
  if (!user) {
    return { response: fail("Unauthorized — VORTEX ID session required", 401) };
  }
  return { user };
}
