#!/usr/bin/env python3
"""v134 e2e — email system + UPI payment verify flow (runs against localhost:3000)."""
import requests, json, sys

B = 'http://localhost:3000'
G = {'x-ca-gate': 'CA-X-MONA-9173'}
ok = lambda c, m: print(('✅' if c else '❌') + ' ' + m) or (c or sys.exit(1))

import time
ts = str(int(time.time()))
email = f'user{ts}@test.local'

# 1) register → welcome email should land in outbox
s = requests.Session(); s.headers.update(G)
r = s.post(f'{B}/api/auth/register', json={'name': 'E2E User', 'email': email, 'password': 'Test1234!'}).json()
ok(r.get('ok'), f'register ok ({email})')

# 2) submit UPI payment proof
utr = ('E2E' + ts)[-12:]
r = s.post(f'{B}/api/billing/upi/submit', json={'planId': 'pro', 'utr': utr}).json()
ok(r.get('ok'), f'UPI proof submitted (UTR {utr}, AI: {r.get("ai") and (str(r["ai"]["score"]) + "/100 " + r["ai"]["verdict"])})')
pid = r['paymentId']

# 3) admin login + unlock
a = requests.Session(); a.headers.update(G)
r = a.post(f'{B}/api/auth/login', json={'email': 'mdhonabali61@gmail.com', 'password': 'Owner123'}).json()
ok(r.get('ok') and r.get('isAdmin'), 'admin login')
r = a.post(f'{B}/api/admin/panel/session', json={'pin': '1000391619244862'}).json()
ok(r.get('ok'), 'control room unlocked')

# 4) queue shows the payment
r = a.get(f'{B}/api/admin/panel/upi').json()
row = next((x for x in r['rows'] if x['id'] == pid), None)
ok(row is not None, f'UPI queue shows the payment (status={row and row["status"]}, verdict={row and row["aiVerdict"]})')

# 5) EMAIL API — outbox should have welcome + payment_submitted for our user
r = a.get(f'{B}/api/admin/panel/email').json()
ok(r.get('ok'), 'email API reachable')
kinds = sorted(set(x['kind'] for x in r['rows'] if x['to'] == email))
ok('welcome' in kinds and 'payment_submitted' in kinds, f'outbox has welcome + payment_submitted for test user (kinds={kinds})')
ok(r['stats']['queued'] >= 2, f"queued stats: {r['stats']}")

# 6) smtp status should be None (not configured) → rows stay queued
ok(r['smtp'] is None, 'SMTP unconfigured → emails queued (expected)')

# 7) approve the payment → plan activates + approval email queued
r = a.post(f'{B}/api/admin/panel/upi', json={'id': pid, 'action': 'approve'}).json()
ok(r.get('ok'), f'admin approve: {r.get("message")}')

r = a.get(f'{B}/api/billing/me').json()
plan = (r.get('subscription') or r).get('plan', '?')
# billing/me returns for admin; check the test user's plan instead
r2 = s.get(f'{B}/api/auth/me').json()
u = r2.get('user') or r2
ok(u.get('plan') == 'pro', f'user plan activated → {u.get("plan")} (expires {str(u.get("planExpiresAt"))[:10]})')

# 8) outbox now has payment_approved
r = a.get(f'{B}/api/admin/panel/email').json()
kinds = sorted(set(x['kind'] for x in r['rows'] if x['to'] == email))
ok('payment_approved' in kinds, f'approval email in outbox (kinds={kinds})')

# 9) reject flow on a second submission
utr2 = ('RJ' + ts + '000')[-12:]
r = s.post(f'{B}/api/billing/upi/submit', json={'planId': 'pro_plus', 'utr': utr2}).json()
ok(r.get('ok'), f'second submission ok ({utr2})')
r = a.post(f'{B}/api/admin/panel/upi', json={'id': r['paymentId'], 'action': 'reject', 'note': 'e2e reject test'}).json()
ok(r.get('ok'), 'reject works')
r = a.get(f'{B}/api/admin/panel/email').json()
kinds = sorted(set(x['kind'] for x in r['rows'] if x['to'] == email))
ok('payment_rejected' in kinds, f'rejection email in outbox (kinds={kinds})')

# 10) broadcast to all
r = a.post(f'{B}/api/admin/panel/email', json={'action': 'send', 'all': True, 'subject': 'v134 test broadcast', 'body': 'Email system live test.'}).json()
ok(r.get('ok'), f'broadcast: {r.get("message")}')

print('\n🎉 ALL E2E PASSED — email system + UPI verify fully wired')
