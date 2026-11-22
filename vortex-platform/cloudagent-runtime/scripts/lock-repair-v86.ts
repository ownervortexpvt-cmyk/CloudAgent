import { PrismaClient } from '@prisma/client'
import { hashPin, verifyPin, sha256Hex } from '../src/lib/lock'
const db = new PrismaClient()
async function main() {
  const stored = (await db.userSetting.findUnique({ where: { key: 'lock_hash' } }))?.value
  const pin = '299843'
  const ok = stored ? verifyPin(pin, stored) : false
  console.log('PIN 299843 valid:', ok)
  if (!ok) {
    // repair: set PIN 299843
    await db.userSetting.upsert({ where: { key: 'lock_hash' }, update: { value: hashPin(pin) }, create: { key: 'lock_hash', value: hashPin(pin) } })
    console.log('lock_hash REPAIRED to PIN 299843')
  }
  // recovery_hash self-heal (always)
  const envKey = (process.env.CA_OWNER_RECOVERY_KEY || '').trim()
  const rk = envKey || 'tipCSdRyIn7CEHGTcSjV9J7Ay9BNt1xd'
  const recHash = sha256Hex(rk)
  await db.userSetting.upsert({ where: { key: 'recovery_hash' }, update: { value: recHash }, create: { key: 'recovery_hash', value: recHash } })
  console.log('recovery_hash MIRRORED (sha256 of recovery key)')
  const verify = await db.userSetting.findUnique({ where: { key: 'recovery_hash' } })
  console.log('PROOF recovery_hash:', verify?.value.slice(0, 12) + '...')
  await db.$disconnect()
}
main().catch((e) => { console.error('ERR:', e.message); process.exit(1) })
