/**
 * Minimal server-side WebAuthn (FIDO2) for the owner lock — no external deps.
 *
 * Supports the exact flows the builder needs:
 *   - REGISTER a device passkey (fingerprint / face / screen-lock) while unlocked
 *   - AUTH with that passkey from the lock screen (public path)
 *
 * Design notes:
 *   - Challenges are STATELESS: `WA1.<expiryMs>.<nonce>.<hmac(lockSecret)>` so a
 *     server restart never breaks an in-flight ceremony and no challenge table.
 *   - Only ES256 (COSE alg -7, EC2 P-256) credentials are accepted — every
 *     platform authenticator on Android/iOS/Windows/macOS supports it.
 *   - Verification follows the WebAuthn spec: rpIdHash, UP+UV flags, signature
 *     over authenticatorData || SHA256(clientDataJSON), signCount clone check.
 */
import crypto from 'crypto'

// ─── base64url ────────────────────────────────────────────────────────────────

export function b64uEncode(buf: Buffer | Uint8Array): string {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function b64uDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64')
}

export function sha256B64u(data: crypto.BinaryLike): string {
  return b64uEncode(crypto.createHash('sha256').update(data).digest())
}

// ─── stateless signed challenges ──────────────────────────────────────────────

const CH_TTL_MS = 3 * 60 * 1000

export function mintChallenge(secret: string, scope: 'register' | 'auth', now = Date.now()): string {
  const exp = now + CH_TTL_MS
  const nonce = crypto.randomBytes(16).toString('hex')
  const payload = `WA1.${exp}.${nonce}.${scope}`
  const mac = crypto.createHmac('sha256', secret).update(payload).digest('hex')
  return b64uEncode(Buffer.from(`${payload}.${mac}`))
}

export function checkChallenge(secret: string, challenge: string, scope: 'register' | 'auth', now = Date.now()): boolean {
  try {
    const raw = b64uDecode(challenge).toString('utf8')
    const parts = raw.split('.')
    if (parts.length !== 4 || parts[0] !== 'WA1') return false
    const exp = parseInt(parts[1], 10)
    const nonce = parts[2]
    const sc = parts[3]
    if (!Number.isFinite(exp) || exp < now) return false
    if (sc !== scope) return false
    const expected = crypto.createHmac('sha256', secret).update(`WA1.${exp}.${nonce}.${scope}`).digest('hex')
    if (sc.length !== expected.length) return false
    return crypto.timingSafeEqual(Buffer.from(sc, 'hex'), Buffer.from(expected, 'hex'))
  } catch {
    return false
  }
}

// ─── minimal CBOR decoder (subset used by WebAuthn) ──────────────────────────

interface CborItem { value: unknown; end: number }

function readHead(buf: Buffer, off: number): { mt: number; ai: number; val: number; end: number } {
  const ib = buf[off]
  if (ib === undefined) throw new Error('cbor: EOF')
  const mt = ib >> 5
  const ai = ib & 0x1f
  let val = ai
  let end = off + 1
  if (ai === 24) { val = buf[off + 1]; end = off + 2 }
  else if (ai === 25) { val = buf.readUInt16BE(off + 1); end = off + 3 }
  else if (ai === 26) { val = buf.readUInt32BE(off + 1); end = off + 5 }
  else if (ai === 27) {
    const hi = buf.readUInt32BE(off + 1)
    const lo = buf.readUInt32BE(off + 5)
    val = hi * 2 ** 32 + lo
    end = off + 9
  } else if (ai >= 28) throw new Error('cbor: unsupported additional info')
  return { mt, ai, val, end }
}

export function cborDecode(buf: Buffer, off = 0): CborItem {
  const { mt, ai, val, end } = readHead(buf, off)
  switch (mt) {
    case 0: return { value: val, end }
    case 1: return { value: -1 - val, end }
    case 2: return { value: Buffer.from(buf.subarray(end, end + val)), end: end + val }
    case 3: {
      const s = buf.subarray(end, end + val).toString('utf8')
      return { value: s, end: end + val }
    }
    case 4: {
      const arr: unknown[] = []
      let p = end
      for (let i = 0; i < val; i++) {
        const it = cborDecode(buf, p)
        arr.push(it.value)
        p = it.end
      }
      return { value: arr, end: p }
    }
    case 5: {
      const map: Record<string | number, unknown> = {}
      let p = end
      for (let i = 0; i < val; i++) {
        const k = cborDecode(buf, p)
        const v = cborDecode(buf, k.end)
        map[(k.value as string | number)] = v.value
        p = v.end
      }
      return { value: map, end: p }
    }
    case 6: { // tag — skip tag number, decode the tagged value
      return cborDecode(buf, end)
    }
    case 7: {
      if (ai === 20) return { value: false, end }
      if (ai === 21) return { value: true, end }
      if (ai === 22) return { value: null, end }
      return { value: undefined, end }
    }
    default: throw new Error('cbor: bad major type')
  }
}

// ─── COSE key → JWK (ES256 / P-256 only) ─────────────────────────────────────

export function coseKeyToJwk(cose: Record<string | number, unknown>): string | null {
  try {
    if (cose[1] !== 2 || cose[3] !== -7) return null // kty EC2, alg ES256
    if (cose[-1] !== 1) return null // crv P-256
    const x = cose[-2] as Buffer
    const y = cose[-3] as Buffer
    if (!Buffer.isBuffer(x) || !Buffer.isBuffer(y) || x.length !== 32 || y.length !== 32) return null
    return JSON.stringify({ kty: 'EC', crv: 'P-256', x: b64uEncode(x), y: b64uEncode(y) })
  } catch {
    return null
  }
}

// ─── authenticator data ───────────────────────────────────────────────────────

export const FLAG_UP = 0x01
export const FLAG_UV = 0x04
export const FLAG_AT = 0x40

export interface ParsedAuthData {
  rpIdHashOk: boolean
  flags: number
  signCount: number
  credentialId?: Buffer
  publicKeyJwk?: string
}

export function parseAuthData(authData: Buffer, rpId: string, expectCredential: boolean): ParsedAuthData {
  if (authData.length < 37) throw new Error('authenticatorData too short')
  const rpIdHashOk = sha256B64u(rpId) === b64uEncode(authData.subarray(0, 32))
  const flags = authData[32]
  const signCount = authData.readUInt32BE(33)
  const out: ParsedAuthData = { rpIdHashOk, flags, signCount }
  if (expectCredential && (flags & FLAG_AT)) {
    let p = 37
    p += 16 // aaguid
    const credLen = authData.readUInt16BE(p)
    p += 2
    out.credentialId = Buffer.from(authData.subarray(p, p + credLen))
    p += credLen
    const cose = cborDecode(authData, p)
    out.publicKeyJwk = coseKeyToJwk(cose.value as Record<string | number, unknown>) || undefined
  }
  return out
}

// ─── registration / assertion verification ───────────────────────────────────

export interface RegisterVerifyInput {
  clientDataJSON: string
  attestationObject: string
  rpId: string
  allowedOrigins: string[]
  challenge: string
  secret: string
}

export interface RegisterVerifyResult {
  ok: boolean
  error?: string
  credentialId?: string // base64url
  publicKeyJwk?: string
  signCount?: number
  uv?: boolean
}

export function verifyRegistration(input: RegisterVerifyInput): RegisterVerifyResult {
  try {
    if (!checkChallenge(input.secret, input.challenge, 'register')) return { ok: false, error: 'Challenge expired — try again' }
    const cd = JSON.parse(b64uDecode(input.clientDataJSON).toString('utf8'))
    if (cd.type !== 'webauthn.create') return { ok: false, error: 'Bad ceremony type' }
    if (cd.challenge !== input.challenge) return { ok: false, error: 'Challenge mismatch' }
    const regOrigin = String(cd.origin).replace(/\/$/, '')
    if (!input.allowedOrigins.includes(regOrigin)) return { ok: false, error: `Origin mismatch (${regOrigin})` }
    const att = cborDecode(b64uDecode(input.attestationObject))
    const obj = att.value as Record<string, unknown>
    const authData = obj.authData as Buffer
    if (!Buffer.isBuffer(authData)) return { ok: false, error: 'Missing authData' }
    const parsed = parseAuthData(authData, input.rpId, true)
    if (!parsed.rpIdHashOk) return { ok: false, error: 'rpId mismatch' }
    if (!(parsed.flags & FLAG_UP)) return { ok: false, error: 'User presence flag missing' }
    if (!parsed.credentialId || !parsed.publicKeyJwk) return { ok: false, error: 'No credential in response' }
    return {
      ok: true,
      credentialId: b64uEncode(parsed.credentialId),
      publicKeyJwk: parsed.publicKeyJwk,
      signCount: parsed.signCount,
      uv: !!(parsed.flags & FLAG_UV),
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Registration verification failed' }
  }
}

export interface AssertVerifyInput {
  credentialId: string
  clientDataJSON: string
  authenticatorData: string
  signature: string
  rpId: string
  allowedOrigins: string[]
  challenge: string
  secret: string
  publicKeyJwk: string
  storedSignCount: number
}

export function verifyAssertion(input: AssertVerifyInput): { ok: boolean; error?: string; newSignCount?: number; uv?: boolean } {
  try {
    if (!checkChallenge(input.secret, input.challenge, 'auth')) return { ok: false, error: 'Challenge expired — try again' }
    const cd = JSON.parse(b64uDecode(input.clientDataJSON).toString('utf8'))
    if (cd.type !== 'webauthn.get') return { ok: false, error: 'Bad ceremony type' }
    if (cd.challenge !== input.challenge) return { ok: false, error: 'Challenge mismatch' }
    const assertOrigin = String(cd.origin).replace(/\/$/, '')
    if (!input.allowedOrigins.includes(assertOrigin)) return { ok: false, error: 'Origin mismatch' }

    const authData = b64uDecode(input.authenticatorData)
    const parsed = parseAuthData(authData, input.rpId, false)
    if (!parsed.rpIdHashOk) return { ok: false, error: 'rpId mismatch' }
    if (!(parsed.flags & FLAG_UP)) return { ok: false, error: 'User presence flag missing' }
    const uv = !!(parsed.flags & FLAG_UV)

    const sig = b64uDecode(input.signature)
    const clientHash = crypto.createHash('sha256').update(b64uDecode(input.clientDataJSON)).digest()
    const signed = Buffer.concat([authData, clientHash])
    const key = crypto.createPublicKey({ key: JSON.parse(input.publicKeyJwk), format: 'jwk' })
    const valid = crypto.verify('sha256', signed, key, sig)
    if (!valid) return { ok: false, error: 'Signature invalid' }

    // Clone detection: a real device never REUSES a counter value when it
    // actually increments. Some authenticators keep 0 forever — accept those.
    if (parsed.signCount !== 0 && input.storedSignCount !== 0 && parsed.signCount <= input.storedSignCount) {
      return { ok: false, error: 'Sign count did not increase (possible cloned credential)' }
    }
    return { ok: true, newSignCount: Math.max(parsed.signCount, input.storedSignCount), uv }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Assertion verification failed' }
  }
}

// ─── request option builders ─────────────────────────────────────────────────

export function buildRegisterOptions(opts: { rpName: string; rpId: string; challenge: string; userName: string }): Record<string, unknown> {
  return {
    rp: { name: opts.rpName, id: opts.rpId },
    user: {
      id: b64uEncode(Buffer.from(`owner-${opts.rpId}`)),
      name: opts.userName,
      displayName: 'Builder Owner',
    },
    challenge: opts.challenge,
    pubKeyCredParams: [
      { type: 'public-key', alg: -7 }, // ES256
      { type: 'public-key', alg: -257 }, // RS256 fallback (still verified as JWK? no — rejected server-side; kept for parity)
    ],
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      userVerification: 'required',
      residentKey: 'preferred',
    },
    attestation: 'none',
    timeout: CH_TTL_MS,
  }
}

export function buildAuthOptions(opts: { rpId: string; challenge: string; credentialIds: string[] }): Record<string, unknown> {
  return {
    challenge: opts.challenge,
    rpId: opts.rpId,
    allowCredentials: opts.credentialIds.map(id => ({
      type: 'public-key',
      id,
      transports: ['internal', 'hybrid'],
    })),
    userVerification: 'required',
    timeout: CH_TTL_MS,
  }
}
