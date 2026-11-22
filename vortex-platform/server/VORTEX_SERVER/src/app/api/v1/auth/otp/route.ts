import { db } from "@/lib/db";
import { ok, fail } from "@/lib/vortex/api";
import { rateLimit, getClientIp } from "@/lib/vortex/ratelimit";
import { verifyOtp } from "@/lib/vortex/otp";
import { createSession, SESSION_COOKIE, cookieOptions } from "@/lib/vortex/auth";
import { writeAudit } from "@/lib/vortex/audit";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const ip = getClientIp(req);

  const rl = rateLimit(`otp-verify:${ip}`, 10, 60_000);
  if (!rl.allowed) {
    return fail(`Too many attempts. Retry in ${rl.retryAfterSec}s.`, 429);
  }

  let body: { email?: string; code?: string };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body");
  }

  const email = (body.email || "").trim().toLowerCase();
  const code = (body.code || "").trim();
  if (!email || !code) return fail("Email and code are required");

  const result = await verifyOtp({ email, purpose: "LOGIN", code });
  if (!result.ok) {
    await writeAudit({ actor: email, action: "OTP_VERIFY_FAIL", resource: "vortex-id", ip });
    return fail(result.error, result.status);
  }

  const user = await db.adminUser.findUnique({ where: { email } });
  if (!user || user.status !== "ACTIVE") return fail("Account not found or suspended", 403);

  const { token, expiresAt } = await createSession(user.id, ip, req.headers.get("user-agent"));

  await db.adminUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await writeAudit({
    actor: user.email,
    action: "AUTH_LOGIN_OK",
    resource: "vortex-id",
    detail: "Password + OTP verified, session created",
    ip,
    userId: user.id,
  });

  const res = NextResponse.json({
    ok: true,
    data: {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        emailVerified: user.emailVerified,
      },
    },
  });
  res.cookies.set(SESSION_COOKIE, token, { ...cookieOptions(), expires: expiresAt });
  return res;
}
