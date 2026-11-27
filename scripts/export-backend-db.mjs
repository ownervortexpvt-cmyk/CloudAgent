#!/usr/bin/env node
// v167.2 backend-database export — dump custom.db (schema + data) using
// node:sqlite (no sqlite3 CLI in sandbox). Produces:
//   backend-database/schema.sql   — CREATE statements only (safe, public)
//   backend-database/data.sql     — full INSERT dump (PRIVATE repos only)
//   backend-database/custom.db    — checkpointed raw SQLite file (PRIVATE)
import { DatabaseSync } from 'node:sqlite'
import fs from 'fs'

const BASE = '/home/z/my-project'
const DB = `${BASE}/db/custom.db`
const OUT = `${BASE}/backend-database`
fs.mkdirSync(OUT, { recursive: true })

const db = new DatabaseSync(`file:${DB}?mode=ro`, { readOnly: true })

const objects = db.prepare(
  "SELECT type, name, sql FROM sqlite_master WHERE sql NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 1 WHEN 'index' THEN 2 WHEN 'trigger' THEN 3 WHEN 'view' THEN 4 END, name"
).all()

const q = (v) => {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number' || typeof v === 'bigint') return String(v)
  if (v instanceof Uint8Array) return `X'${Buffer.from(v).toString('hex')}'`
  return `'${String(v).replace(/'/g, "''")}'`
}

// schema.sql — structure only (public-safe)
let schema = `-- Vortex Cloud Agent backend schema (generated ${new Date().toISOString()})\n-- Restore: sqlite3 new.db < schema.sql\nPRAGMA journal_mode=WAL;\nBEGIN;\n`
for (const o of objects) schema += `${o.sql};\n`
schema += 'COMMIT;\n'
fs.writeFileSync(`${OUT}/schema.sql`, schema)

// data.sql — schema + all rows (private: contains user records)
let data = `-- Vortex Cloud Agent backend FULL dump (generated ${new Date().toISOString()})\n-- Restore: sqlite3 custom.db < data.sql\nPRAGMA journal_mode=WAL;\nPRAGMA foreign_keys=OFF;\nBEGIN;\n`
for (const o of objects) if (o.type === 'table') data += `${o.sql};\n`
for (const o of objects) {
  if (o.type !== 'table') continue
  let rows
  try { rows = db.prepare(`SELECT * FROM "${o.name}"`).all() } catch { continue }
  for (const r of rows) {
    const cols = Object.keys(r).map((c) => `"${c}"`).join(',')
    const vals = Object.values(r).map(q).join(',')
    data += `INSERT INTO "${o.name}" (${cols}) VALUES (${vals});\n`
  }
}
data += 'COMMIT;\n'
fs.writeFileSync(`${OUT}/data.sql`, data)

// raw file copy (WAL is empty right now — plain copy is consistent)
fs.copyFileSync(DB, `${OUT}/custom.db`)

const stats = objects.reduce((acc, o) => {
  if (o.type !== 'table') return acc
  try { acc[o.name] = db.prepare(`SELECT COUNT(*) AS n FROM "${o.name}"`).get().n } catch {}
  return acc
}, {})
console.log('tables:', JSON.stringify(stats))
console.log('sizes:', JSON.stringify({
  schema: fs.statSync(`${OUT}/schema.sql`).size,
  data: fs.statSync(`${OUT}/data.sql`).size,
  db: fs.statSync(`${OUT}/custom.db`).size,
}))
