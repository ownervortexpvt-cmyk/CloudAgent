const fs = require('fs')
let SECRETS = {}
try { SECRETS = JSON.parse(fs.readFileSync('/home/z/my-project/.secrets/vortex-secrets.json', 'utf8')) } catch {}
#!/usr/bin/env node
/** Standalone Joy S3 SigV4 auth check: signed ListBuckets vs anonymous. */
const { createHmac, createHash } = require('crypto');

const ACCESS = (SECRETS.joyAccessKey || '');
const SECRET = (SECRETS.joySecretKey || '');
const ENDPOINT = 'https://nz.in.s3.joy.services';
const REGION = 'default';

function hmac(key, data) { return createHmac('sha256', key).update(data).digest(); }
function sigv4Headers(method, urlStr, payload) {
  const url = new URL(urlStr);
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = createHash('sha256').update(payload || '').digest('hex');
  const headers = { host: url.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const sorted = Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()]).sort(([a], [b]) => (a < b ? -1 : 1));
  const canonicalHeaders = sorted.map(([k, v]) => `${k}:${v}\n`).join('');
  const signedHeaders = sorted.map(([k]) => k).join(';');
  const canonicalRequest = [method, url.pathname, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${REGION}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');
  const kDate = hmac(`AWS4${SECRET}`, dateStamp);
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, 's3');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${ACCESS}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return headers;
}

(async () => {
  const url = ENDPOINT + '/';
  const signed = await fetch(url, { headers: sigv4Headers('GET', url, '') });
  const sBody = await signed.text();
  console.log('SIGNED   GET / ->', signed.status, sBody.slice(0, 220));
  const anon = await fetch(url);
  console.log('ANONYMOUS GET / ->', anon.status, (await anon.text()).slice(0, 160));
  // OwnerID presence in signed response = authenticated listing
  console.log('AUTH-OK:', signed.status === 200 && /<Owner><ID>[^<]{4,}/.test(sBody));
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
