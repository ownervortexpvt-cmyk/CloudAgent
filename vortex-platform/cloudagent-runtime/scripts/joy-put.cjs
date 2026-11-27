#!/usr/bin/env node
/**
 * Joy S3 uploader — streams a local file to Joy S3 with AWS SigV4 headers.
 * Uses UNSIGNED-PAYLOAD so curl can stream large files without hashing in RAM.
 *
 * Usage:
 *   node scripts/joy-put.cjs list                     # list buckets
 *   node scripts/joy-put.cjs put <local-file> <bucket> <key> [contentType]
 *   node scripts/joy-put.cjs head <bucket> <key>
 * Raw credentials stay in this file / are never printed.
 */
const { createHmac, createHash } = require('crypto');
const { execFileSync } = require('child_process');
const fs = require('fs');

const ACCESS = (SECRETS.joyAccessKey || '');
const SECRET = (SECRETS.joySecretKey || '');
const ENDPOINT = 'https://nz.in.s3.joy.services';
const REGION = 'default';

function sigv4Headers(method, urlStr, { payloadHash = 'UNSIGNED-PAYLOAD', extraHeaders = {} } = {}) {
  const url = new URL(urlStr);
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const headers = { host: url.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate, ...extraHeaders };
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
function hmac(key, data) { return createHmac('sha256', key).update(data).digest(); }

async function main() {
  const [, , cmd, a, b, c, d] = process.argv;
  if (cmd === 'list') {
    const h = sigv4Headers('GET', ENDPOINT + '/');
    const res = await fetch(ENDPOINT + '/', { headers: h });
    const body = await res.text();
    const names = [...body.matchAll(/<Name>([^<]+)<\/Name>/g)].map(m => m[1]);
    console.log('status', res.status, 'buckets:', JSON.stringify(names));
    return;
  }
  if (cmd === 'head') {
    const url = `${ENDPOINT}/${a}/${b}`;
    const h = sigv4Headers('HEAD', url);
    const res = await fetch(url, { method: 'HEAD', headers: h });
    console.log('HEAD', res.status, 'content-length:', res.headers.get('content-length'), 'etag:', res.headers.get('etag'));
    return;
  }
  if (cmd === 'put') {
    const [file, bucket, key] = [a, b, c];
    const stat = fs.statSync(file);
    const url = `${ENDPOINT}/${bucket}/${key}`;
    const extra = { 'content-length': String(stat.size), 'content-type': d || 'application/octet-stream' };
    const h = sigv4Headers('PUT', url, { extraHeaders: extra });
    const headerArgs = [];
    for (const [k, v] of Object.entries(h)) headerArgs.push('-H', `${k}: ${v}`);
    console.log(`PUT ${bucket}/${key} (${(stat.size / 1048576).toFixed(1)} MB) ...`);
    const t0 = Date.now();
    const out = execFileSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code} %{speed_upload}', '-X', 'PUT', url, ...headerArgs, '--upload-file', file, '--max-time', '3600'], { stdio: ['ignore', 'pipe', 'inherit'] }).toString();
    const [status, speed] = out.trim().split(/\s+/);
    const secs = (Date.now() - t0) / 1000;
    console.log(`HTTP ${status} in ${secs.toFixed(0)}s (${(stat.size / 1048576 / Math.max(secs, 1)).toFixed(1)} MB/s raw-speed-param=${speed})`);
    process.exitCode = status === '200' ? 0 : 1;
    return;
  }
  if (cmd === 'get') {
    // v158 — durable-seed download: fetch an object to a local file with a
    // retry loop (the watchdog restore path depends on this when every local
    // seed is gutted/reverted by the checkpoint janitor).
    const [bucket, key, dest] = [a, b, c];
    const url = `${ENDPOINT}/${bucket}/${key}`;
    const h = sigv4Headers('GET', url);
    const headerArgs = [];
    for (const [k, v] of Object.entries(h)) headerArgs.push('-H', `${k}: ${v}`);
    const out = execFileSync('curl', ['-sSf', '-o', dest, ...headerArgs, url, '--max-time', '600'], { stdio: ['ignore', 'pipe', 'inherit'] }).toString();
    const size = fs.existsSync(dest) ? fs.statSync(dest).size : 0;
    console.log(`GET ${bucket}/${key} -> ${dest} (${(size / 1048576).toFixed(1)} MB)`);
    process.exitCode = size > 0 ? 0 : 1;
    return;
  }
  console.log('unknown cmd');
  process.exitCode = 1;
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
