#!/usr/bin/env node
/**
 * joy-public-put.cjs — put an object to Joy S3 with x-amz-acl: public-read
 * then verify it is fetchable WITHOUT auth (path-style + virtual-host style).
 * Usage: node scripts/joy-public-put.cjs <local-file> <bucket> <key> [contentType]
 * Credentials are read from scripts/joy-put.cjs (single source, never printed).
 */
const { createHmac, createHash } = require('crypto');
const fs = require('fs');

const src = fs.readFileSync(__dirname + '/joy-put.cjs', 'utf8');
const ACCESS = /const ACCESS = '([^']+)'/.exec(src)[1];
const SECRET = /const SECRET = '([^']+)'/.exec(src)[1];
const ENDPOINT = /const ENDPOINT = '([^']+)'/.exec(src)[1];
const REGION = 'default';

function sig(method, urlStr, extra = {}) {
  const url = new URL(urlStr);
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const headers = { host: url.host, 'x-amz-content-sha256': 'UNSIGNED-PAYLOAD', 'x-amz-date': amzDate, ...extra };
  const sorted = Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()]).sort(([a], [b]) => (a < b ? -1 : 1));
  const ch = sorted.map(([k, v]) => `${k}:${v}\n`).join('');
  const sh = sorted.map(([k]) => k).join(';');
  const cr = [method, url.pathname, '', ch, sh, 'UNSIGNED-PAYLOAD'].join('\n');
  const scope = `${dateStamp}/${REGION}/s3/aws4_request`;
  const sts = ['AWS4-HMAC-SHA256', amzDate, scope, createHash('sha256').update(cr).digest('hex')].join('\n');
  const kD = hmac(`AWS4${SECRET}`, dateStamp), kR = hmac(kD, REGION), kS = hmac(kR, 's3'), kSig = hmac(kS, 'aws4_request');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${ACCESS}/${scope}, SignedHeaders=${sh}, Signature=${createHmac('sha256', kSig).update(sts).digest('hex')}`;
  return headers;
}
function hmac(k, d) { return createHmac('sha256', k).update(d).digest(); }

async function main() {
  const [, , file, bucket, key, contentType] = process.argv;
  if (!file || !bucket || !key) { console.error('usage: joy-public-put.cjs <file> <bucket> <key> [contentType]'); process.exit(1); }
  const body = fs.readFileSync(file);
  const url = `${ENDPOINT}/${bucket}/${key}`;
  const headers = sig('PUT', url, {
    'x-amz-acl': 'public-read',
    ...(contentType ? { 'content-type': contentType } : {}),
    ...(body.length ? { 'content-length': String(body.length) } : {}),
  });
  const res = await fetch(url, { method: 'PUT', headers, body });
  console.log('put status', res.status);
  if (res.status >= 300) { console.log(await res.text()); process.exit(1); }

  // anonymous fetch — path style
  const pub1 = url;
  const r1 = await fetch(pub1);
  console.log('anon path-style  :', r1.status, pub1);
  // anonymous fetch — virtual-host style
  const host = new URL(ENDPOINT).host;          // nz.in.s3.joy.services
  const sub = host.replace('.s3.joy.services', '');
  const pub2 = `https://${bucket}.${sub}.s3.joy.services/${key}`;
  const r2 = await fetch(pub2).catch(e => ({ status: 'ERR ' + e.message }));
  console.log('anon vhost-style :', r2.status, pub2);
  const head = (r1.status === 200) ? await r1.text() : '';
  console.log('first bytes      :', head.slice(0, 60).replace(/\n/g, ' '));
}
main();
