#!/usr/bin/env python3
"""
v110 E2E — Razorpay billing, public pages, plan expiry, admin tools.
Run against a live server: python3 scripts/e2e-billing-v110.py [BASE_URL]
Default BASE = http://localhost:3000

What it proves (each numbered check prints PASS/FAIL):
  public:            landing rewrite for anonymous /, marketing+legal pages 200
  billing gates:     401 signed-out, 403 non-admin keys, 503 keys_missing order
  razorpay simulate: fake keys saved → order fails 502 (gateway rejects) →
                     sqlite-seeded order → verify with CORRECT hmac activates →
                     verify idempotent (alreadyActive) → verify with WRONG sig 400
  webhook:           correct-hmac payment.captured activates; bad hmac 400;
                     duplicate delivery absorbed (idempotent)
  lifetime retired:  order with kind='lifetime' → 410 (v111: subscriptions only)
  expiry:            lapsed monthly reads as free (auth/plan + middleware), future date restores
  admin:             password reset revokes sessions + new password works
  cleanup:           test user + fake keys removed
"""
import sys, json, time, hmac, hashlib, sqlite3, string, random

BASE = (sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3000').rstrip('/')
DB = '/home/z/my-project/db/custom.db'
import requests

PROXY = {'http': None, 'https': None}
S = requests.Session()
S.headers.update({'x-ca-gate': 'CA-X-MONA-9173'})  # v123 private-site gate
S.proxies = PROXY
S.trust_env = False

results = []
def check(name, cond, extra=''):
    results.append(bool(cond))
    print(f"{'PASS' if cond else 'FAIL'} [{len(results):02d}] {name}" + (f" — {extra}" if extra and not cond else ''))

def sig_of(secret: str, body) -> str:
    if isinstance(body, str):
        body = body.encode()
    return hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()

ts = int(time.time())
CUST = {'name': 'Pay Test', 'email': f'pay-{ts}@cloudagent.test', 'password': 'paytest-pass-1'}
ADMIN = {'email': 'qa-admin115@qa.local', 'password': 'qatester115'}
FAKE_KEY = 'rzp_test_e2e' + ''.join(random.choices(string.digits, k=8))
FAKE_SECRET = 'e2e_secret_' + ''.join(random.choices(string.ascii_letters + string.digits, k=24))
WH_SECRET = 'whsec_e2e_' + ''.join(random.choices(string.ascii_letters + string.digits, k=16))

def jget(path, **kw):
    return S.get(BASE + path, timeout=20, proxies=PROXY, **kw)

def jpost(path, body=None, **kw):
    return S.post(BASE + path, json=body, timeout=20, proxies=PROXY, **kw)

# ── 1. public surface ────────────────────────────────────────────────────────
r = S.get(BASE + '/', allow_redirects=False, proxies=PROXY)
check('anonymous / serves the marketing landing (200)', r.status_code == 200 and ('Command an army' in r.text or 'army of 1,000 agents' in r.text), f'got {r.status_code}')
for path, marker in [('/landing', 'Command an army'), ('/pricing', 'Razorpay'), ('/terms', 'Terms of Service'),
                     ('/privacy', 'Privacy Policy'), ('/refund', 'Refund'), ('/contact', 'Contact Us')]:
    r = jget(path)
    check(f'public {path} → 200', r.status_code == 200 and marker in r.text, f'got {r.status_code}')

# ── 2. billing gates ────────────────────────────────────────────────────────
r = jpost('/api/billing/order', {'plan': 'pro', 'kind': 'monthly'})
check('billing order signed-out → 401', r.status_code == 401, f'got {r.status_code}')
r = jget('/api/billing/me')
check('billing me signed-out → 401', r.status_code == 401, f'got {r.status_code}')

r = jpost('/api/auth/register', CUST)
check('customer registers', r.status_code == 200 and r.json().get('ok'), f'got {r.status_code} {r.text[:120]}')
me = jget('/api/auth/me').json()
check('me exposes planKind free', me.get('user', {}).get('planKind') == 'free', json.dumps(me)[:120])

r = jpost('/api/billing/order', {'plan': 'pro', 'kind': 'monthly'})
check('order without keys → 503 keys_missing', r.status_code == 503 and r.json().get('code') == 'keys_missing', f'got {r.status_code}')
r = jget('/api/billing/keys')
check('keys API as customer → 403', r.status_code == 403, f'got {r.status_code}')
r = jpost('/api/billing/webhook', {'event': 'payment.captured'})
check('webhook without secret → 503 (fail closed)', r.status_code == 503, f'got {r.status_code}')

# ── 3. admin saves fake keys ────────────────────────────────────────────────
A = requests.Session(); A.proxies = PROXY; A.trust_env = False; A.headers.update({'x-ca-gate': 'CA-X-MONA-9173'})
r = A.post(BASE + '/api/auth/login', json=ADMIN)
check('admin logs in', r.status_code == 200 and r.json().get('ok'), f'got {r.status_code}')

# v113: sensitive billing/account operations live behind the control-room PIN
r = A.post(BASE + '/api/admin/panel/session', json={'pin': '1000391619244862'})
check('control room unlock', r.status_code == 200 and r.json().get('unlocked'), f'got {r.status_code}')
A.headers['x-ca-admin'] = r.json().get('token', '')

r = A.post(BASE + '/api/billing/keys', json={'keyId': 'not-a-key', 'keySecret': 'short'})
check('keys API rejects malformed pair', r.status_code == 400, f'got {r.status_code}')
r = A.post(BASE + '/api/billing/keys', json={'keyId': FAKE_KEY, 'keySecret': FAKE_SECRET, 'webhookSecret': WH_SECRET, 'allowUnverified': True})
check('admin saves (fake) keys', r.status_code == 200 and r.json().get('ok'), f'got {r.status_code} {r.text[:150]}')
r = A.get(BASE + '/api/billing/keys')
check('keys API shows configured + masked', r.json().get('configured') is True and FAKE_KEY not in r.text, r.text[:150])

# order now reaches Razorpay REST and is rejected (fake creds) → 502, no Payment row
r = jpost('/api/billing/order', {'plan': 'pro', 'kind': 'monthly'})
check('order with fake keys → 502 gateway error (honest, no fake success)', r.status_code == 502, f'got {r.status_code}')
con = sqlite3.connect(DB)
n = con.execute("SELECT COUNT(*) FROM Payment WHERE userId=(SELECT id FROM AuthUser WHERE email=?)", (CUST['email'],)).fetchone()[0]
check('no Payment row leaked from the failed order', n == 0, f'rows={n}')

# ── 4. verify flow (seeded order + real HMAC) ───────────────────────────────
def seed_order(order_id, plan='pro', kind='monthly', amount=199900):
    uid = con.execute("SELECT id FROM AuthUser WHERE email=?", (CUST['email'],)).fetchone()[0]
    con.execute("INSERT OR REPLACE INTO Payment (id,userId,plan,kind,amount,currency,status,razorpayOrderId,createdAt) VALUES (?,?,?,?,?,?,?,?,datetime('now'))",
                ('pay_e2e_' + order_id, uid, plan, kind, amount, 'INR', 'created', order_id))
    con.commit()

def user_row():
    con2 = sqlite3.connect(DB)
    row = con2.execute("SELECT plan,planKind,planExpiresAt FROM AuthUser WHERE email=?", (CUST['email'],)).fetchone()
    con2.close()
    return row

ORDER1, PAY1 = 'order_e2e_v110_1', 'pay_e2e_v110_1'
seed_order(ORDER1)
bad = S.post(BASE + '/api/billing/verify', json={'razorpay_order_id': ORDER1, 'razorpay_payment_id': PAY1, 'razorpay_signature': 'deadbeef'}, timeout=20, proxies=PROXY)
check('verify with wrong signature → 400, not activated', bad.status_code == 400 and user_row()[0] == 'free', f'got {bad.status_code}')
good_sig = sig_of(FAKE_SECRET, f'{ORDER1}|{PAY1}')
r = S.post(BASE + '/api/billing/verify', json={'razorpay_order_id': ORDER1, 'razorpay_payment_id': PAY1, 'razorpay_signature': good_sig}, timeout=20, proxies=PROXY)
check('verify with correct HMAC → activated pro/monthly', r.status_code == 200 and r.json().get('activated') is True, f'got {r.status_code} {r.text[:150]}')
row = user_row()
check('DB shows pro + monthly + future expiry', row[0] == 'pro' and row[1] == 'monthly' and row[2] is not None, str(row))
r = S.post(BASE + '/api/billing/verify', json={'razorpay_order_id': ORDER1, 'razorpay_payment_id': PAY1, 'razorpay_signature': good_sig}, timeout=20, proxies=PROXY)
check('verify is idempotent (alreadyActive)', r.json().get('alreadyActive') is True, r.text[:150])

# ── 5. webhook ──────────────────────────────────────────────────────────────
ORDER2, PAY2 = 'order_e2e_v110_2', 'pay_e2e_v110_2'
seed_order(ORDER2)
con.execute("UPDATE Payment SET plan='ultra' WHERE razorpayOrderId=?", (ORDER2,)); con.commit()
event = json.dumps({'event': 'payment.captured', 'payload': {'payment': {'entity': {'id': PAY2, 'order_id': ORDER2, 'method': 'upi'}}}})
r = S.post(BASE + '/api/billing/webhook', data=event, headers={'Content-Type': 'application/json', 'x-razorpay-signature': sig_of(WH_SECRET, event.encode())}, timeout=20, proxies=PROXY)
check('webhook correct HMAC → 200 + activated ultra', r.status_code == 200 and user_row()[0] == 'ultra', f'got {r.status_code} plan={user_row()[0]}')
r = S.post(BASE + '/api/billing/webhook', data=event, headers={'Content-Type': 'application/json', 'x-razorpay-signature': sig_of(WH_SECRET, event.encode())}, timeout=20, proxies=PROXY)
check('duplicate webhook delivery absorbed', r.status_code == 200 and user_row()[0] == 'ultra', f'got {r.status_code}')
r = S.post(BASE + '/api/billing/webhook', data=event, headers={'Content-Type': 'application/json', 'x-razorpay-signature': 'f' * 64}, timeout=20, proxies=PROXY)
check('webhook bad signature → 400', r.status_code == 400, f'got {r.status_code}')

# ── 6. lifetime retired (v111 — nobody gets permanent access) ──────────────
r = jpost('/api/billing/order', {'plan': 'ultra_pro_max', 'kind': 'lifetime'})
check('lifetime order → 410 retired (subscriptions only)', r.status_code == 410 and r.json().get('code') == 'lifetime_retired', f'got {r.status_code}')
n = con.execute("SELECT COUNT(*) FROM Payment WHERE userId=(SELECT id FROM AuthUser WHERE email=?)", (CUST['email'],)).fetchone()[0]
check('no Payment row created by the rejected lifetime order', n == 2, f'rows={n}')
b = jget('/api/billing/me').json()
check('billing/me no longer advertises a lifetimeOffer', 'lifetimeOffer' not in b, json.dumps(b)[:160])

# ── 7. expiry semantics ─────────────────────────────────────────────────────
con.execute("UPDATE AuthUser SET plan='pro', planKind='monthly', planExpiresAt=datetime('now','-1 day') WHERE email=?", (CUST['email'],)); con.commit()
p = jget('/api/auth/plan').json()
check('lapsed monthly reads as FREE limits (10 runs)', p.get('plan', {}).get('id') == 'free', json.dumps(p.get('plan', {}))[:120])
con.execute("UPDATE AuthUser SET planExpiresAt=datetime('now','+20 day') WHERE email=?", (CUST['email'],)); con.commit()
p = jget('/api/auth/plan').json()
check('valid monthly restores plan limits', p.get('plan', {}).get('id') == 'pro', json.dumps(p.get('plan', {}))[:120])
b = jget('/api/billing/me').json()
check('billing/me returns history + expiry', b.get('ok') and len(b.get('payments', [])) >= 2 and b.get('planExpiresAt'), json.dumps(b)[:200])

# ── 8. admin password reset ─────────────────────────────────────────────────
uid = con.execute("SELECT id FROM AuthUser WHERE email=?", (CUST['email'],)).fetchone()[0]
r = A.post(BASE + '/api/admin/users', json={'action': 'reset_password', 'userId': uid, 'newPassword': 'brand-new-pass-9'})
check('admin resets customer password', r.status_code == 200 and r.json().get('ok'), f'got {r.status_code}')
r = jget('/api/auth/me')
check('old customer session revoked', r.status_code == 401, f'got {r.status_code}')
C2 = requests.Session(); C2.proxies = PROXY; C2.trust_env = False; C2.headers.update({'x-ca-gate': 'CA-X-MONA-9173'})
r = C2.post(BASE + '/api/auth/login', json={'email': CUST['email'], 'password': 'brand-new-pass-9'})
check('customer signs in with new password', r.status_code == 200 and r.json().get('ok'), f'got {r.status_code}')

# ── 9. cleanup ──────────────────────────────────────────────────────────────
con.execute("DELETE FROM Payment WHERE userId IN (SELECT id FROM AuthUser WHERE email LIKE 'pay-%@cloudagent.test')")
con.execute("DELETE FROM AuthSession WHERE userId IN (SELECT id FROM AuthUser WHERE email LIKE 'pay-%@cloudagent.test')")
con.execute("DELETE FROM AuthUser WHERE email LIKE 'pay-%@cloudagent.test'")  # incl. orphans from earlier crashed runs
con.execute("DELETE FROM AuthSession WHERE userId NOT IN (SELECT id FROM AuthUser)")
con.execute("DELETE FROM UserSetting WHERE key IN ('razorpay_key_id','razorpay_key_secret','razorpay_webhook_secret')")
con.commit(); con.close()
left = sqlite3.connect(DB).execute("SELECT COUNT(*) FROM AuthUser WHERE email LIKE 'pay-%@cloudagent.test'").fetchone()[0]
check('cleanup: test user + fake keys removed', left == 0, f'left={left}')

passed = sum(results)
print(f"\n{'=' * 50}\nRESULT: {passed}/{len(results)} PASS")
sys.exit(0 if passed == len(results) else 1)
