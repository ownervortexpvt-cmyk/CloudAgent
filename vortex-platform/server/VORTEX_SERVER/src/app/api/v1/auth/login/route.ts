import { db } from "@/lib/db";
import { ok, fail } from "@/lib/vortex/api";
import { verifyPassword } from "@/lib/vortex/crypto";
import { rateLimit, getClientIp } from "@/lib/vortex/ratelimit";
import { ensureSeeded } from "@/lib/vortex/seed";
import { issueOtp } from "@/lib/vortex/otp";
import { writeAudit } from "@/lib/vortex/audit";

export async function POST(req: Request) {
  await ensureSeeded();
  const ip = getClientIp(req);

  const rl = rateLimit(`login:${ip}`, 10, 60_000);
  if (!rl.allowed) {
    return fail(`Too many attempts. Retry in ${rl.retryAfterSec}s.`, 429);
  }

  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body");
  }

  const email = (body.email || "").trim().toLowerCase();
  const password = body.password || "";
  if (!email || !password) return fail("Email and password are required");

  const user = await db.adminUser.findUnique({ where: { email } });
  if (!user || !verifyPassword(password, user.passwordHash)) {
    await writeAudit({ actor: email || "unknown", action: "AUTH_LOGIN_FAIL", resource: "vortex-id", ip });
    return fail("Invalid credentials", 401);
  }
  if (user.status !== "ACTIVE") return fail("Account suspended", 403);

  // Private platform: OTP required for every owner login
  const { devCode, delivery } = await issueOtp({ email: user.email, purpose: "LOGIN", userId: user.id, ip });

  return ok({
    otpRequired: true,
    email: user.email,
    delivery,
    ...(devCode ? { devCode } : {}),
  });
}
