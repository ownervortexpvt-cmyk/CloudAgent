#!/usr/bin/env python3
"""
e2e-v127-razorpay-ultra.py — proves the v127 Razorpay Ultra round.

  1. keys GET mode field ('none' → 'test' after fake-key save)  [admin UI badge data]
  2. NEW /api/billing/keys/test — real-time connection health (honest 401 detail
     for a fake pair, 503 when unconfigured)
  3. webhook secret now AES-256-GCM encrypted at rest ('v1:…' in SQLite)
  4. LEGACY plaintext webhook secret still verifies (fallback path)
  5. seeded checkout verify → activated → /api/billing/me exposes planExpiresAt
     (the data the new PlanExpiryBanner renders)
  6. admin stats recentPayments shows the payment (overview ledger proof)
  7. cleanup: fake keys + test user + payments removed

Run: python3 scripts/e2e-v127-razorpay-ultra.py
"""
import hashlib, hmac, json, os, sqlite3, sys, time
import urllib.request, urllib.error

BASE = 'http://localhost:3000'
GATE = 'CA-X-MONA-9173'
DB = '/home/z/my-project/db/custom.db'
ADMIN = {'email': 'qa-admin115@qa.local', 'password': 'qatester115'}
PIN = 'DCnTt8wwtuj3f6R'
STAMP = str(int(time.time()))
CUST = {'name': 'Rzp Ultra Test', 'email': f'rzpu-{STAMP}@cloudagent.test', 'password': 'rzp-ultra-pass-1'}
FAKE_KEY = 'rzp_test_e2ev127FAKEKEYID'
FAKE_SECRET = 'fake_secret_e2e_v127_0123456789abcdef'
WH_SECRET = 'whsec_e2e_v127_abcdefghijklmnop'
LEGACY_WS = 'legacy_plaintext_webhook_secret_v110'
PASS, FAIL = [], []

def check(name, cond, extra=''):
    (PASS if cond else FAIL).append(name)
    print(f"{'PASS' if cond else 'FAIL'} {name}" + (f' — {extra}' if extra and not cond else ''))
    return cond

def S():
    s = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    s.addheaders = [('Content-Type', 'application/json'), ('x-ca-gate', GATE)]
    return s

def req(op, method, path, body=None, timeout=60):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method)
    try:
        with op.open(r, timeout=timeout) as resp:
            try: return resp.status, json.loads(resp.read())
            except Exception: return resp.status, {'_raw': resp.read().decode('utf-8', 'replace')[:200]}
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read())
        except Exception: return e.code, {}
    except Exception as e:
        return 0, {'error': str(e)}

def sig_of(secret, body):
    body = body.encode() if isinstance(body, str) else body
    return hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()

def preclean():
    """idempotency: a previous crashed run may have left keys/users behind."""
    con = sqlite3.connect(DB)
    con.execute("DELETE FROM UserSetting WHERE key IN ('razorpay_key_id','razorpay_key_secret','razorpay_webhook_secret')")
    for (uid,) in con.execute("SELECT id FROM AuthUser WHERE email LIKE 'rzpu-%'").fetchall():
        con.execute("DELETE FROM Payment WHERE userId=?", (uid,))
        con.execute("DELETE FROM AuthSession WHERE userId=?", (uid,))
        con.execute("DELETE FROM AuthUser WHERE id=?", (uid,))
    con.commit(); con.close()

def main():
    preclean()
    A, U = S(), S()

    print('── 1. unconfigured state ──')
    s, d = req(A, 'POST', '/api/auth/login', ADMIN)
    if not check('admin login', s == 200 and d.get('ok'), f's={s}'): sys.exit(1)
    A.addheaders += [('x-ca-lock', d.get('token') or d.get('sessionToken') or '')]
    s, d = req(A, 'POST', '/api/admin/panel/session', {'pin': PIN})
    check('control room unlock', s == 200 and d.get('unlocked'), f's={s}')
    A.addheaders += [('x-ca-admin', d.get('token', ''))]

    s, d = req(A, 'GET', '/api/billing/keys')
    check('keys GET mode=none before config (v127 field)', s == 200 and d.get('mode') == 'none', f's={s} {json.dumps(d)[:120]}')
    s, d = req(A, 'POST', '/api/billing/keys/test')
    check('keys/test unconfigured → honest 503', s == 503 and d.get('mode') == 'none', f's={s} {json.dumps(d)[:120]}')

    print('── 2. fake (test-mode) keys saved ──')
    s, d = req(A, 'POST', '/api/billing/keys', {'keyId': FAKE_KEY, 'keySecret': FAKE_SECRET, 'webhookSecret': WH_SECRET, 'allowUnverified': True})
    check('admin saves fake test keys', s == 200 and d.get('ok'), f's={s} {json.dumps(d)[:150]}')
    check('save response carries mode=test (v127)', d.get('mode') == 'test', json.dumps(d)[:120])
    s, d = req(A, 'GET', '/api/billing/keys')
    check('keys GET mode=test + webhookConfigured', d.get('mode') == 'test' and d.get('webhookConfigured') is True, json.dumps(d)[:150])
    check('secret never echoed', FAKE_SECRET not in json.dumps(d))

    print('── 3. NEW real-time connection test ──')
    s, d = req(A, 'POST', '/api/billing/keys/test', timeout=90)
    check('keys/test fake pair → ok=false (honest)', s == 200 and d.get('ok') is False, f's={s} {json.dumps(d)[:200]}')
    check('keys/test reports mode=test', d.get('mode') == 'test', json.dumps(d)[:150])
    check('keys/test detail mentions rejection/401', '401' in str(d.get('detail', '')) or 'REJECTED' in str(d.get('detail', '')), json.dumps(d)[:200])

    print('── 4. webhook secret encryption at rest (v127 fix) ──')
    con = sqlite3.connect(DB)
    row = con.execute("SELECT value FROM UserSetting WHERE key='razorpay_webhook_secret'").fetchone()
    check('webhook secret stored ENCRYPTED (v1:…)', row and str(row[0]).startswith('v1:'), f'got {str(row)[:40] if row else None}')
    row2 = con.execute("SELECT value FROM UserSetting WHERE key='razorpay_key_secret'").fetchone()
    check('key secret still encrypted', row2 and str(row2[0]).startswith('v1:'), f'got {str(row2)[:40] if row2 else None}')

    print('── 5. legacy plaintext webhook secret STILL verifies ──')
    con.execute("UPDATE UserSetting SET value=? WHERE key='razorpay_webhook_secret'", (LEGACY_WS,))
    con.commit()
    s, d = req(A, 'GET', '/api/billing/keys')
    check('GET still configured with legacy plaintext row', d.get('webhookConfigured') is True, json.dumps(d)[:120])

    print('── 6. seeded payment + webhook activation (legacy secret HMAC) ──')
    s, d = req(U, 'POST', '/api/auth/register', CUST)
    check('customer registers', s == 200 and d.get('ok'), f's={s} {json.dumps(d)[:120]}')
    s, d = req(U, 'POST', '/api/auth/login', {'email': CUST['email'], 'password': CUST['password']})
    tok = d.get('token') or d.get('sessionToken')
    check('customer logs in', s == 200 and tok, f's={s}')
    U.addheaders += [('x-ca-lock', tok or '')]

    WO1, WP1 = f'order_v127_web_{STAMP}', f'pay_v127_web_{STAMP}'
    uid = con.execute("SELECT id FROM AuthUser WHERE email=?", (CUST['email'],)).fetchone()[0]
    con.execute("INSERT OR REPLACE INTO Payment (id,userId,plan,kind,amount,currency,status,razorpayOrderId,createdAt) VALUES (?,?,?,?,?,?,?,?,datetime('now'))",
                ('payrow_' + WP1, uid, 'ultra', 'monthly', 399900, 'INR', 'created', WO1))
    con.commit()
    event = {'event': 'payment.captured', 'payload': {'payment': {'entity': {'id': WP1, 'order_id': WO1, 'method': 'upi'}}, 'order': {'entity': {'id': WO1, 'notes': {'userId': uid, 'plan': 'ultra', 'kind': 'monthly'}}}}}
    body = json.dumps(event).encode()
    sig = sig_of(LEGACY_WS, body)
    r = urllib.request.Request(BASE + '/api/billing/webhook', data=body, method='POST',
                               headers={'Content-Type': 'application/json', 'x-ca-gate': GATE, 'x-razorpay-signature': sig})
    try:
        with urllib.request.urlopen(r, timeout=30) as resp: ws = resp.status
    except urllib.error.HTTPError as e: ws = e.code
    check('webhook (legacy plaintext secret HMAC) → 200', ws == 200, f'got {ws}')
    row3 = con.execute("SELECT plan, planKind FROM AuthUser WHERE id=?", (uid,)).fetchone()
    check('webhook activated ultra via legacy fallback', row3 == ('ultra', 'monthly'), f'got {row3}')

    print('── 7. checkout verify + billing/me expiry (banner data) ──')
    WO2, WP2 = f'order_v127_chk_{STAMP}', f'pay_v127_chk_{STAMP}'
    con.execute("INSERT OR REPLACE INTO Payment (id,userId,plan,kind,amount,currency,status,razorpayOrderId,createdAt) VALUES (?,?,?,?,?,?,?,?,datetime('now'))",
                ('payrow_' + WP2, uid, 'pro', 'monthly', 199900, 'INR', 'created', WO2))
    con.commit()
    good = sig_of(FAKE_SECRET, f'{WO2}|{WP2}')
    s, d = req(U, 'POST', '/api/billing/verify', {'razorpay_order_id': WO2, 'razorpay_payment_id': WP2, 'razorpay_signature': good}, timeout=90)
    check('verify correct HMAC → activated', s == 200 and d.get('activated') is True, f's={s} {json.dumps(d)[:150]}')
    s, d = req(U, 'GET', '/api/billing/me')
    check('billing/me has planExpiresAt (banner data proof)', s == 200 and d.get('planExpiresAt'), f's={s} {json.dumps(d)[:200]}')
    check('billing/me has payment history', s == 200 and len(d.get('payments', [])) >= 1, json.dumps(d)[:150])

    print('── 8. admin overview ledger ──')
    s, d = req(A, 'GET', '/api/admin/panel/stats')
    emails = [p.get('email') for p in d.get('recentPayments', [])]
    check('stats recentPayments shows the payment', s == 200 and CUST['email'] in emails, f's={s} emails={emails[:4]}')
    check('stats revenue present', s == 200 and 'revenue' in d, f's={s}')

    print('── 9. cleanup ──')
    con.execute("DELETE FROM UserSetting WHERE key IN ('razorpay_key_id','razorpay_key_secret','razorpay_webhook_secret')")
    con.execute("DELETE FROM Payment WHERE userId=?", (uid,))
    con.execute("DELETE FROM AuthSession WHERE userId=?", (uid,))
    con.execute("DELETE FROM AuthUser WHERE email=?", (CUST['email'],))
    con.commit(); con.close()
    s, d = req(A, 'GET', '/api/billing/keys')
    check('cleanup: keys back to mode=none', s == 200 and d.get('mode') == 'none', f's={s} {json.dumps(d)[:120]}')
    check('cleanup: test user gone', sqlite3.connect(DB).execute("SELECT COUNT(*) FROM AuthUser WHERE email=?", (CUST['email'],)).fetchone()[0] == 0)

    print(f"\n=== v127 razorpay-ultra: {len(PASS)} PASS / {len(FAIL)} FAIL ===")
    if FAIL:
        print('FAILED:', FAIL); sys.exit(1)

if __name__ == '__main__':
    main()
