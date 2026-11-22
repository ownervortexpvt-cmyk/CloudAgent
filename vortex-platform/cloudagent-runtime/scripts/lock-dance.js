/**
 * Live verification dance for the v72 Gemini fix:
 *   1. backup lock rows → 2. wipe to SETUP → 3. temp PIN → unlock cookie
 *   4. caller runs live tests (this script only sets up / restores)
 * Usage: bun scripts/lock-dance.ts backup|restore
 */
const { PrismaClient } = require('@prisma/client')
const fs = require('fs')
const p = new PrismaClient()
const BACKUP = '/home/z/my-project/scripts/.lock-backup.json'
const KEYS = ['lock_hash', 'lock_secret', 'recovery_hash']

async function main() {
  const mode = process.argv[2]
  if (mode === 'backup') {
    const rows = await p.userSetting.findMany({ where: { key: { in: KEYS } } })
    fs.writeFileSync(BACKUP, JSON.stringify(rows, null, 1))
    await p.userSetting.deleteMany({ where: { key: { in: KEYS } } })
    console.log('backed up + wiped lock rows:', rows.map(r => r.key).join(', ') || '(none)')
  } else if (mode === 'restore') {
    const rows = JSON.parse(fs.readFileSync(BACKUP, 'utf8'))
    for (const r of rows) {
      await p.userSetting.upsert({ where: { key: r.key }, update: { value: r.value }, create: { key: r.key, value: r.value } })
    }
    fs.unlinkSync(BACKUP)
    console.log('restored lock rows:', rows.map(r => r.key).join(', ') || '(none — stays SETUP)')
  } else {
    throw new Error('usage: backup|restore')
  }
}
main().catch(e => { console.error(e); process.exit(1) }).finally(() => p.$disconnect())
