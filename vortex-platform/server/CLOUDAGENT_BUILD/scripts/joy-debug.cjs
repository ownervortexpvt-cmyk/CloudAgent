/**
 * joy-debug.cjs — isolate the SigV4 mismatch: try HEAD bucket (no query) and
 * ListObjectsV2 using the EXACT canonicalization of the proven joy-public-put
 * signer (UNSIGNED-PAYLOAD, region default).
 */
const { createHmac, createHash } = require('crypto')

const src = require('fs').readFileSync('/home/z/my-project/scripts/joy-put.cjs', 'utf8')
const ACCESS = /const ACCESS = '([^']+)'/.exec(src)[1]
const SECRET = /const SECRET = '([^']+)'/.exec(src)[1]
const ENDPOINT = /const ENDPOINT = '([^']+)'/.exec(src)[1]
const REGION = 'default'

function hmac(k, d) { return createHmac('sha256', k).update(d).digest() }
function hex(b) { return createHash('sha256').update(b).digest('hex') }

function sig(method, pathForUri, queryStr, useRealHash = false) {
  const url = new URL(ENDPOINT)
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = amzDate.slice(0, 8)
  const payload = useRealHash ? hex('') : 'UNSIGNED-PAYLOAD'
  const headers = { host: url.host, 'x-amz-content-sha256': payload, 'x-amz-date': amzDate }
  const sorted = Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()]).sort(([a], [b]) => (a < b ? -1 : 1))
  const ch = sorted.map(([k, v]) => `${k}:${v}\n`).join('')
  const sh = sorted.map(([k]) => k).join(';')
  const cr = [method, pathForUri, queryStr, ch, sh, payload].join('\n')
  const scope = `${dateStamp}/${REGION}/s3/aws4_request`
  const sts = ['AWS4-HMAC-SHA256', amzDate, scope, hex(cr)].join('\n')
  const kD = hmac(`AWS4${SECRET}`, dateStamp), kR = hmac(kD, REGION), kS = hmac(kR, 's3'), kSig = hmac(kS, 'aws4_request')
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${ACCESS}/${scope}, SignedHeaders=${sh}, Signature=${createHmac('sha256', kSig).update(sts).digest('hex')}`
  return headers
}

async function tryReq(label, method, pathForUri, queryStr, useRealHash = false) {
  const h = sig(method, pathForUri, queryStr, useRealHash)
  const res = await fetch(`${ENDPOINT}${pathForUri}${queryStr ? `?${queryStr}` : ''}`, { method, headers: h, signal: AbortSignal.timeout(15000) })
  const t = await res.text().catch(() => '')
  console.log(label, '→', res.status, t.replace(/<\?xml[^>]*\?>/, '').slice(0, 140).replace(/\n/g, ' '))
  return res.status
}

async function main() {
  const s1 = await tryReq('HEAD bucket (no query)', 'HEAD', '/vortex-websites', '')
  const s2 = await tryReq('LIST v2 (sorted query)', 'GET', '/vortex-websites', 'list-type=2&max-keys=1')
  const s3 = await tryReq('LIST v2 (max-keys first)', 'GET', '/vortex-websites', 'max-keys=1&list-type=2')
  // app-style: real empty-body hash instead of UNSIGNED-PAYLOAD
  const s4 = await tryReq('GET (real empty-hash)', 'GET', '/vortex-websites', 'list-type=2&max-keys=1', true)
  console.log('summary: HEAD=' + s1 + ' LIST=' + s2 + ' LISTswapped=' + s3 + ' realhash=' + s4)
}
main().catch(e => { console.error('ERR', e.message); process.exit(1) })
