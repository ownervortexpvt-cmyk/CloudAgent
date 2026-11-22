import { db } from "@/lib/db";
import { ok, fail } from "@/lib/vortex/api";
import { rateLimit, getClientIp } from "@/lib/vortex/ratelimit";
import { issueOtp } from "@/lib/vortex/otp";

export async function POST(req: Request) {
  const ip = getClientIp(req);

  const rl = rateLimit(`otp-resend:${ip}`, 3, 60_000);
  if (!rl.allowed) {
    return fail(`Too many resends. Retry in ${rl.retryAfterSec}s.`, 429);
  }

  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body");
  }

  const email = (body.email || "").trim().toLowerCase();
  if (!email) return fail("Email is required");

  const user = await db.adminUser.findUnique({ where: { email } });
  if (!user || user.status !== "ACTIVE") return fail("Account not found", 404);

  const { devCode } = await issueOtp({ email: user.email, purpose: "LOGIN", userId: user.id, ip });
  return ok({ resent: true, ...(devCode ? { devCode } : {}) });
}
