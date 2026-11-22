// Task 102: mint a 24h download token for the full-project ZIP and print the link path.
// Usage: node scripts/make-download-link.mjs [hours]
import { PrismaClient } from '@prisma/client'
import crypto from 'crypto'

const db = new PrismaClient()
const hours = Number(process.argv[2] || 24)
const token = crypto.randomBytes(24).toString('hex') // 48 hex chars — matches route regex
const exp = Date.now() + hours * 60 * 60 * 1000

await db.userSetting.upsert({
  where: { key: 'zip_download_token' },
  update: { value: JSON.stringify({ token, exp }) },
  create: { key: 'zip_download_token', value: JSON.stringify({ token, exp }) },
})
console.log(`token stored (expires ${new Date(exp).toISOString()})`)
console.log(`LINK_PATH=/api/backup-download?token=${token}`)
await db.$disconnect()
