/**
 * JOY SERVICES credential probe — tests which role the two supplied strings
 * play. Never prints the keys themselves; prints only endpoint, status and
 * response body (bodies contain account info, not secrets).
 *
 * Mapping A: str1 = S3 access key, str2 = S3 secret key  (S3 unreachable — skip live)
 * Mapping B: str1 = REST v1 api_token (Bearer)
 * Mapping C: str2 = REST v1 api_token (Bearer)
 * Mapping D: Basic auth str1:str2 on REST v1
 */
const str1 = process.env.JOY_STR1 || "";
const str2 = process.env.JOY_STR2 || "";
const REST = "https://joy.services/api/v1";

async function probe(name, url, headers) {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
    const body = (await res.text()).slice(0, 400);
    console.log(`${name}: HTTP ${res.status} — ${body || "(empty body)"}`);
    return res.status;
  } catch (e) {
    console.log(`${name}: ERROR ${e.message}`);
    return 0;
  }
}

async function main() {
  await probe("B str1-as-bearer GET /storage", `${REST}/storage`, { Authorization: `Bearer ${str1}` });
  await probe("C str2-as-bearer GET /storage", `${REST}/storage`, { Authorization: `Bearer ${str2}` });
  await probe("D basic GET /storage", `${REST}/storage`, { Authorization: `Basic ${Buffer.from(`${str1}:${str2}`).toString("base64")}` });
  await probe("B usage", `${REST}/storage/usage`, { Authorization: `Bearer ${str1}` });
  await probe("B buckets", `${REST}/storage/buckets`, { Authorization: `Bearer ${str1}` });
}

main();
