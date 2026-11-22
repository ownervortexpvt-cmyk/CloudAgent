import { db } from "@/lib/db";
import { sha256, generateToken } from "./crypto";

/**
 * VORTEX AUTH — session management.
 * Raw token lives ONLY in an httpOnly cookie; DB stores sha256(token).
 */

export const SESSION_COOKIE = "vortex_session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: false, // sandbox preview runs over http; flip to true behind TLS
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  };
}

export async function createSession(
  userId: string,
  ip: string,
  userAgent: string | null
) {
  const token = generateToken(32);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.session.create({
    data: {
      tokenHash: sha256(token),
      userId,
      ip,
      userAgent: userAgent ?? "",
      expiresAt,
    },
  });
  return { token, expiresAt };
}

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  emailVerified: boolean;
  lastLoginAt: Date | null;
};

export async function getSessionUser(req: Request): Promise<SessionUser | null> {
  const cookieHeader = req.headers.get("cookie") || "";
  const match = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  if (!match) return null;
  const token = decodeURIComponent(match.slice(SESSION_COOKIE.length + 1));
  if (!token || token.length < 32) return null;

  const session = await db.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: true },
  });
  if (!session || session.revoked) return null;
  if (session.expiresAt.getTime() < Date.now()) return null;
  if (session.user.status !== "ACTIVE") return null;

  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role,
    emailVerified: session.user.emailVerified,
    lastLoginAt: session.user.lastLoginAt,
  };
}

export async function revokeSession(req: Request): Promise<boolean> {
  const cookieHeader = req.headers.get("cookie") || "";
  const match = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  if (!match) return false;
  const token = decodeURIComponent(match.slice(SESSION_COOKIE.length + 1));
  const res = await db.session.updateMany({
    where: { tokenHash: sha256(token) },
    data: { revoked: true },
  });
  return res.count > 0;
}
