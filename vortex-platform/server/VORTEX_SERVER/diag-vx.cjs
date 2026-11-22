/** Diagnostic: read VxFunctionRun + VxDocument ground truth from the VORTEX DB. */
const { PrismaClient } = require('./src/generated/prisma');
(async () => {
  const db = new PrismaClient();
  const runs = await db.vxFunctionRun.findMany({ take: 6, orderBy: { createdAt: 'desc' } });
  console.log('--- FUNCTION RUNS ---');
  for (const r of runs) console.log(JSON.stringify({ runId: r.runId, trigger: r.trigger, status: r.status, latency: r.latencyMs, error: (r.error || '').slice(0, 160), output: (r.outputJson || '').slice(0, 100) }));
  const docs = await db.vxDocument.findMany({ take: 8, orderBy: { createdAt: 'desc' } });
  console.log('--- DOCS ---');
  for (const d of docs) console.log(JSON.stringify({ docId: d.docId, data: (d.dataJson || '').slice(0, 80) }));
  const keys = await db.vxKey.findMany({ take: 4, orderBy: { createdAt: 'desc' } });
  console.log('--- KEYS(prefix) ---');
  for (const k of keys) console.log(JSON.stringify({ keyId: k.keyId, kind: k.kind, prefix: k.prefix, status: k.status }));
  const fns = await db.vxFunction.findMany({ take: 5, orderBy: { createdAt: 'desc' } });
  console.log('--- FUNCTIONS ---');
  for (const f of fns) console.log(JSON.stringify({ fnId: f.fnId, name: f.name, trigger: f.trigger, status: f.status, invocations: f.invocations, fails: f.fails, lastError: (f.lastError || '').slice(0, 120) }));
  await db.$disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
