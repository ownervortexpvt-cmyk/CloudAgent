/* Inspect the main app DB: users, sessions, razorpay keys, payments. */
const { Database } = require('bun:sqlite')
const db = new Database('/home/z/my-project/db/custom.db', { readonly: true })
const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()
console.log('TABLES:', tables.map((t) => t.name).join(', '))
try {
  const users = db
    .query('SELECT id, email, name, role, plan, planKind, planExpiresAt, status FROM AuthUser')
    .all()
  console.log('USERS(' + users.length + '):', JSON.stringify(users, null, 1))
} catch (e) {
  console.log('USERS_ERR:', e.message)
}
try {
  console.log('SESSIONS:', JSON.stringify(db.query('SELECT COUNT(*) c FROM AuthSession').get()))
} catch (e) {
  console.log('SESSIONS_ERR:', e.message)
}
try {
  console.log('RZP_KEYS:', JSON.stringify(db.query("SELECT key FROM UserSetting WHERE key LIKE 'razorpay%'").all()))
  console.log('SECRET:', JSON.stringify(db.query("SELECT key FROM UserSetting WHERE key='session_secret'").get()))
} catch (e) {
  console.log('SETTING_ERR:', e.message)
}
try {
  console.log('PAYMENTS:', JSON.stringify(db.query('SELECT COUNT(*) c FROM Payment').get()))
} catch (e) {
  console.log('PAY_ERR:', e.message)
}
