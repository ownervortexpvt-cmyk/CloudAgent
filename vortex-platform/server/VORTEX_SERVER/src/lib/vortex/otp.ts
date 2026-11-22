import { db } from "@/lib/db";
import { generateOtpCode, sha256 } from "./crypto";
import { writeAudit } from "./audit";
import { sendMail, type MailStatus } from "./mail";

/**
 * VORTEX OTP — issue + verify.
 * Codes are stored hashed, TTL 5 min (configurable), max 5 verify attempts.
 * Delivery goes through the MAIL center: real SMTP when wired (Postal or any
 * provider), honest SIMULATED outbox otherwise. The dev hint only shows the
 * code when it was NOT actually delivered — real sends never echo the code
 * back into an HTTP response.
 */

export const OTP_TTL_MIN = 5;
export const OTP_MAX_ATTEMPTS = 5;

export async function issueOtp(opts: {
  email: string;
  purpose: string;
  userId?: string | null;
  ip?: string | null;
}): Promise<{ delivery: MailStatus; devCode?: string }> {
  const ttlCfg = await db.appConfig.findUnique({ where: { key: "security.otp_ttl_minutes" } });
  const ttlMin = Math.max(1, Math.min(15, parseInt(ttlCfg?.value || String(OTP_TTL_MIN), 10) || OTP_TTL_MIN));

  const code = generateOtpCode();
  const expiresAt = new Date(Date.now() + ttlMin * 60 * 1000);

  // invalidate previous unconsumed codes for this email+purpose
  await db.otpCode.updateMany({
    where: { email: opts.email, purpose: opts.purpose, consumed: false },
    data: { consumed: true },
  });

  await db.otpCode.create({
    data: {
      email: opts.email,
      codeHash: sha256(code),
      purpose: opts.purpose,
      userId: opts.userId ?? null,
      expiresAt,
    },
  });

  const delivery = await sendMail({
    toEmail: opts.email,
    subject: "VORTEX ID — your login code",
    body: `Your VORTEX ID verification code is: ${code}\n\nIt expires in ${ttlMin} minutes.\nIf you did not request this, ignore this mail.`,
    category: "otp",
    actor: opts.email,
  });

  await writeAudit({
    actor: opts.email,
    action: "OTP_ISSUED",
    resource: `otp:${opts.purpose}`,
    ip: opts.ip ?? null,
    userId: opts.userId ?? null,
    detail: `delivery=${delivery.status}`,
  });

  // Dev hint only when the code did NOT actually reach an inbox.
  const devCfg = await db.appConfig.findUnique({ where: { key: "dev.show_otp_in_response" } });
  const showDev = devCfg?.value === "true" && delivery.status !== "SENT";
  return {
    delivery: delivery.status,
    ...(showDev ? { devCode: code } : {}),
  };
}

export type OtpVerifyResult =
  | { ok: true; userId: string }
  | { ok: false; error: string; status: number };

export async function verifyOtp(opts: {
  email: string;
  purpose: string;
  code: string;
}): Promise<OtpVerifyResult> {
  const record = await db.otpCode.findFirst({
    where: { email: opts.email, purpose: opts.purpose, consumed: false },
    orderBy: { createdAt: "desc" },
  });

  if (!record) {
    return { ok: false, error: "No active OTP. Request a new code.", status: 400 };
  }
  if (record.expiresAt.getTime() < Date.now()) {
    return { ok: false, error: "OTP expired. Request a new code.", status: 400 };
  }
  if (record.attempts >= OTP_MAX_ATTEMPTS) {
    return { ok: false, error: "Too many wrong attempts. Request a new code.", status: 429 };
  }

  await db.otpCode.update({ where: { id: record.id }, data: { attempts: { increment: 1 } } });

  if (record.codeHash !== sha256(opts.code.trim())) {
    return { ok: false, error: "Incorrect code.", status: 400 };
  }

  await db.otpCode.update({ where: { id: record.id }, data: { consumed: true } });
  return { ok: true, userId: record.userId || "" };
}
