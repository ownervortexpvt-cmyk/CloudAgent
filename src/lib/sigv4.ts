/**
 * v95 — AWS Signature Version 4 signer (pure, zero deps, zero imports).
 *
 * Used by the Cloudflare R2 vault (lib/r2store.ts) — R2 accepts SigV4 with
 * region "auto" and service "s3". Exported as a PURE function so the E2E
 * suite can verify it byte-for-byte against the official AWS documentation
 * test vectors (no network, no DB).
 */
import crypto from 'crypto'

export interface Sigv4Creds { accessKeyId: string; secretAccessKey: string }

export const hmac = (key: crypto.BinaryLike | Buffer, data: string) =>
  crypto.createHmac('sha256', key).update(data, 'utf8').digest()

export const sha256hex = (data: crypto.BinaryLike) =>
  crypto.createHash('sha256').update(data).digest('hex')

/**
 * Compute the SigV4 Authorization header.
 *
 * @param method          HTTP verb (GET/PUT/DELETE/HEAD)
 * @param canonicalUri    URI-encoded path, starts with "/" ("/" alone for list)
 * @param canonicalQuery  canonical query string ("list-type=2&max-keys=1") — ''
 *                        when none. Caller must pre-sort per canonical rules;
 *                        r2store sorts via URLSearchParams (alphabetical).
 * @param host            Host header value
 * @param body            payload (or null) — hashed into x-amz-content-sha256
 * @param creds           Access Key ID + Secret Access Key
 * @param amzDate         ISO-basic timestamp "20130524T000000Z"
 * @param region          "auto" for R2
 * @param service         "s3" for R2
 * @param extraHeaders    optional additional signed headers (e.g. range) —
 *                        names lowercased, values trimmed; merged into the
 *                        canonical header block before host/amz headers.
 */
export function sigv4Sign(
  method: string,
  canonicalUri: string,
  canonicalQuery: string,
  host: string,
  body: Buffer | string | null,
  creds: Sigv4Creds,
  amzDate: string,
  region = 'auto',
  service = 's3',
  extraHeaders: Record<string, string> = {},
): { authorization: string; amzDate: string; payloadHash: string } {
  const payloadHash = sha256hex(body ?? '')
  const dateStamp = amzDate.slice(0, 8)

  // canonical headers MUST be sorted alphabetically by lowercase name
  const headers: Record<string, string> = {
    ...extraHeaders,
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  }
  const signedHeaderNames = Object.keys(headers)
    .map(n => n.toLowerCase())
    .sort()
  const canonicalHeaders = signedHeaderNames.map(h => `${h}:${String(headers[h]).trim()}\n`).join('')
  const signedHeaders = signedHeaderNames.join(';')

  const canonicalRequest = [
    method.toUpperCase(),
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const scope = `${dateStamp}/${region}/${service}/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256hex(canonicalRequest),
  ].join('\n')

  const kDate = hmac(`AWS4${creds.secretAccessKey}`, dateStamp)
  const kRegion = hmac(kDate, region)
  const kService = hmac(kRegion, service)
  const kSigning = hmac(kService, 'aws4_request')
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex')

  // No spaces after commas — byte-identical to the AWS documentation examples
  // (both forms are accepted by S3/R2, but byte-exact keeps tests honest).
  const authorization = `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${scope},SignedHeaders=${signedHeaders},Signature=${signature}`
  return { authorization, amzDate, payloadHash }
}
