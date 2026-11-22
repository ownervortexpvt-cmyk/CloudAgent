/**
 * v147 SELF-HOSTED WEB PUSH — the FCM replacement that needs NO Google.
 *
 * WHY: pushSend used to only publish on an in-process SSE channel — a device
 * with no open stream (browser closed, app killed) never got anything. That
 * is the single biggest functional gap vs Firebase Cloud Messaging. This
 * module implements the REAL Web Push protocol so delivery works at the OS
 * level on every modern browser — but SELF-HOSTED and STANDARD, unlike FCM
 * which is locked to Google's servers:
 *
 *   RFC 8290 — VAPID: ES256 JWT (`vapid t=<jwt>, k=<p256key>` auth header)
 *   RFC 8291 — aes128gcm payload encryption (ECDH prime256v1 + HKDF-SHA256)
 *   RFC 8188 — binary record framing (salt|rs|idlen|keyid|ct+tag)
 *
 * Zero new dependencies: everything comes from node:crypto
 * (generateKeyPairSync, createECDH, hkdfSync, sign with ieee-p1363).
 * The `web-push` npm package was deliberately avoided — a new dep would
 * invalidate bun's frozen lockfile and break the watchdog's frozen installs.
 *
 * Protocol correctness is proven by scripts/vx-push-e2e.cjs: it plays the
 * BROWSER — generates a client subscription keypair, receives the real
 * encrypted POST on a local receiver, decrypts the payload with the client
 * private key and asserts the title/body survived. If decryption works, a
 * real browser will accept this push.
 */
import crypto from "crypto";

const b64u = (buf: Buffer) =>
  buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64u = (s: string) =>
  Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

function hkdf(ikm: Buffer, salt: Buffer, info: Buffer, length: number): Buffer {
  return Buffer.from(crypto.hkdfSync("sha256", ikm, salt, info, length) as ArrayBuffer);
}

export interface VapidKeys {
  /** b64url of the RAW uncompressed P-256 point (65 bytes) — applicationServerKey */
  publicKey: string;
  /** JWK (kty EC, crv P-256, x, y, d) — SECRET, never leaves the server */
  privateKey: { kty: "EC"; crv: "P-256"; x: string; y: string; d: string };
}

export function generateVapidKeys(): VapidKeys {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const pub = publicKey.export({ format: "jwk" }) as Record<string, string>;
  const priv = privateKey.export({ format: "jwk" }) as Record<string, string>;
  const point = Buffer.concat([Buffer.from([0x04]), fromB64u(pub.x!), fromB64u(pub.y!)]);
  return {
    publicKey: b64u(point),
    privateKey: { kty: "EC", crv: "P-256", x: pub.x!, y: pub.y!, d: priv.d! },
  };
}

/** RFC 8290 VAPID Authorization header for an endpoint. */
export function vapidAuthorization(endpoint: string, keys: VapidKeys, subject = "mailto:push@vortex.local"): string {
  const aud = new URL(endpoint).origin;
  const header = b64u(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(
    Buffer.from(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject }))
  );
  const unsigned = `${header}.${claims}`;
  const privKey = crypto.createPrivateKey({ key: keys.privateKey as unknown as crypto.JsonWebKey, format: "jwk" });
  const sig = crypto.sign("sha256", Buffer.from(unsigned), { key: privKey, dsaEncoding: "ieee-p1363" });
  return `vapid t=${unsigned}.${b64u(sig)}, k=${keys.publicKey}`;
}

interface PushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/**
 * RFC 8291 aes128gcm encryption + binary framing. Returns the exact bytes a
 * push service expects as the request body.
 */
export function encryptFor(subscription: PushSubscription, payload: Buffer): Buffer | { error: string } {
  let clientPubRaw: Buffer, authSecret: Buffer;
  try {
    clientPubRaw = fromB64u(subscription.keys.p256dh);
    authSecret = fromB64u(subscription.keys.auth);
  } catch {
    return { error: "invalid subscription keys (must be base64url)" };
  }
  if (clientPubRaw.length !== 65 || clientPubRaw[0] !== 0x04) return { error: "p256dh is not a valid uncompressed P-256 point" };
  if (authSecret.length < 16) return { error: "auth secret too short" };

  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  const serverPubRaw = ecdh.getPublicKey(); // 65 bytes uncompressed
  let shared: Buffer;
  try {
    shared = Buffer.from(ecdh.computeSecret(clientPubRaw));
  } catch {
    return { error: "ECDH with the subscription public key failed" };
  }

  // PRK_key = HKDF(ikm=shared, salt=auth secret, info="WebPush: info"+NUL+uaPub+asPub, 32)
  const info = Buffer.concat([Buffer.from("WebPush: info\u0000", "utf8"), clientPubRaw, serverPubRaw]);
  const prkKey = hkdf(shared, authSecret, info, 32);

  const salt = crypto.randomBytes(16);
  const cek = hkdf(prkKey, salt, Buffer.from("Content-Encoding: aes128gcm\u0000"), 16);
  const nonce = hkdf(prkKey, salt, Buffer.from("Content-Encoding: nonce\u0000"), 12);

  // Single record: payload bytes + final-record delimiter 0x02 (RFC 8188 §2)
  const plaintext = Buffer.concat([payload, Buffer.from([0x02])]);
  const RS = 4096;
  if (plaintext.length + 16 > RS) return { error: "payload too large for one record" };
  const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Header: salt(16) | rs(4 BE) | idlen(1) | keyid — keyid = b64url of the
  // SENDER's ephemeral public key (RFC 8291 §3.3: the receiver derives the
  // shared secret from it). Browsers read exactly this field.
  const keyid = Buffer.from(b64u(serverPubRaw), "utf8");
  const header = Buffer.concat([salt, Buffer.from([0, 0, (RS >> 8) & 0xff, RS & 0xff]), Buffer.from([keyid.length]), keyid]);
  return Buffer.concat([header, body, tag]);
}

export interface WebPushResult {
  ok: boolean;
  status: number;
  /** true when the endpoint answered 404/410 — the subscription is dead and must be pruned */
  expired?: boolean;
  error?: string;
}

/** POST one encrypted push to a subscription endpoint with VAPID auth. */
export async function sendWebPush(
  subscription: PushSubscription,
  payload: Record<string, unknown>,
  vapid: VapidKeys,
  timeoutMs = 10_000
): Promise<WebPushResult> {
  if (!subscription?.endpoint || !/^https?:\/\//.test(subscription.endpoint)) {
    return { ok: false, status: 0, error: "invalid endpoint" };
  }
  const encrypted = encryptFor(subscription, Buffer.from(JSON.stringify(payload), "utf8"));
  if (Buffer.isBuffer(encrypted) === false) return { ok: false, status: 0, error: (encrypted as { error: string }).error };
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(subscription.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Encoding": "aes128gcm",
        TTL: "2419200",
        Urgency: "normal",
        Authorization: vapidAuthorization(subscription.endpoint, vapid),
      },
      body: new Uint8Array(encrypted as Buffer),
      signal: ctl.signal,
    });
    // 2xx = accepted by the push service; 404/410 = subscription gone
    const ok = res.status >= 200 && res.status < 300;
    const expired = res.status === 404 || res.status === 410;
    return { ok, status: res.status, ...(expired ? { expired: true } : {}), ...(ok ? {} : { error: `push service HTTP ${res.status}` }) };
  } catch (e: unknown) {
    return { ok: false, status: 0, error: `push service unreachable (${(e as Error)?.message || e})` };
  } finally {
    clearTimeout(t);
  }
}

export function parseSubscriptionToken(token: string): PushSubscription | null {
  try {
    const j = JSON.parse(token);
    if (j?.endpoint && j?.keys?.p256dh && j?.keys?.auth) {
      return { endpoint: String(j.endpoint), keys: { p256dh: String(j.keys.p256dh), auth: String(j.keys.auth) } };
    }
  } catch {}
  return null;
}
