#!/usr/bin/env node
/**
 * v150 one-off remediation: remove accumulated e2e artifacts from the shared
 * `nexa@vortex.local` developer. Repeated fb-parity / parity-v2 runs each
 * provisioned a project under the admin's developer and filled
 * vaas.max_projects_per_dev (10) → "Developer project quota reached (10)".
 * Keeps seed rows (NEXA Showcase). Children are deleted per-table first
 * (the product has no project-delete API — this is DB-level remediation).
 */
const { Database } = require("bun:sqlite");
const DB = "/home/z/my-project/vortex-platform/server/VORTEX_SERVER/db/custom.db";
const db = new Database(DB);
db.exec("PRAGMA busy_timeout = 8000");

const dev = db.query("SELECT id FROM Developer WHERE email = ?1").get("nexa@vortex.local");
if (!dev) { console.error("nexa developer not found"); process.exit(1); }

const victims = db.query(
  "SELECT id, projectId, name FROM VxProject WHERE developerId = ?1 AND name IN ('Firebase-Kill-Demo','Beyond-Firebase v147')"
).all(dev.id);
console.log(`e2e artifacts to remove: ${victims.length}`);
for (const v of victims) console.log("  -", v.projectId, v.name);
if (victims.length === 0) { console.log("nothing to clean"); process.exit(0); }

const ids = victims.map(v => v.id);
const ph = ids.map(() => "?").join(",");
const CHILD_TABLES = [
  "VxKey", "VxUser", "VxSession", "VxCollection", "VxDocument", "VxFile",
  "VxRealtimeEvent", "VxFunction", "VxFunctionRun", "VxUsage",
  "VxRemoteConfig", "VxPushToken", "VxAnalyticsEvent", "VxCrashReport",
];
db.exec("BEGIN");
try {
  for (const t of CHILD_TABLES) {
    const cols = db.query(`PRAGMA table_info(${t})`).all().map(c => c.name);
    if (!cols.includes("projectId")) continue;
    const del = db.prepare(`DELETE FROM ${t} WHERE projectId IN (${ph})`).run(...ids);
    if (del.changes) console.log(`  ${t}: -${del.changes}`);
  }
  const delP = db.prepare(`DELETE FROM VxProject WHERE id IN (${ph})`).run(...ids);
  console.log(`  VxProject: -${delP.changes}`);
  db.exec("COMMIT");
} catch (e) {
  db.exec("ROLLBACK");
  console.error("FAILED, rolled back:", e.message);
  process.exit(1);
}
const left = db.query("SELECT COUNT(*) c FROM VxProject WHERE developerId = ?1").get(dev.id);
console.log(`nexa developer now has ${left.c} project(s)`);
db.close();
