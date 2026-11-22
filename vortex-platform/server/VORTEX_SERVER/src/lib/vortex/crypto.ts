import { randomBytes, scryptSync, timingSafeEqual, createHash } from "crypto";

/**
 * VORTEX CORE — crypto helpers
 * Zero external dependencies: Node built-in crypto only.
 */

const SCRYPT_KEYLEN = 64;
const SCRYPT_COST = 16384; // N — fine for a private control plane

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, salt, hash] = stored.split("$");
    if (scheme !== "scrypt" || !salt || !hash) return false;
    const candidate = scryptSync(password, salt, SCRYPT_KEYLEN);
    const expected = Buffer.from(hash, "hex");
    if (candidate.length !== expected.length) return false;
    return timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Raw session / API token — shown once, only its sha256 is stored. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

/** 6-digit numeric OTP. */
export function generateOtpCode(): string {
  return String(randomBytes(4).readUInt32BE(0) % 1000000).padStart(6, "0");
}

/** Random id like "key_a1b2c3d4". */
export function shortId(prefix: string, len = 8): string {
  return `${prefix}_${randomBytes(len).toString("hex").slice(0, len)}`;
}

export { SCRYPT_COST };
// test append
