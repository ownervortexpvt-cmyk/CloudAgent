#!/usr/bin/env python3
"""v129 e2e — UPI-direct payment + AI verification + admin approval flow.

 1. register a fresh customer
 2. customer submits a UPI-direct payment (UTR + no screenshot)
 3. AI verdict is attached (ledger-signal engine)
 4. duplicate-UTR rejection works
 5. admin unlock -> queue shows the row -> approve
 6. customer's plan is now 'pro' with a future expiry
"""
import json
import sys
import time
import urllib.request
import urllib.error

BASE = 'http://localhost:3000'
GATE = {'x-ca-gate': 'CA-X-MONA-9173'}
ADMIN = {'email': 'qa-admin115@qa.local', 'password': 'qatester115'}
PIN = '1000391619244862'
STAMP = str(int(time.time()))
CUST = {'name': 'UPI Test', 'email': f'upi-{STAMP}@cloudagent.test', 'password': 'upi-pass-1'}


def req(sess, method, path, body=None, extra=None):
    headers = {'Content-Type': 'application/json'}
    headers.update(GATE)
    if extra:
        headers.update(extra)
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method, headers=headers)
    for c in sess.get('cookies', []):
        pass
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(sess['jar']))
    try:
        with opener.open(r, timeout=90) as resp:
            return resp.status, json.loads(resp.read().decode() or '{}')
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or '{}')
        except Exception:
            return e.code, {}


def check(name, ok, detail=''):
    print(('  PASS ' if ok else '  FAIL ') + name + (f' — {detail}' if detail else ''))
    return ok


def main():
    import http.cookiejar
    cust = {'jar': http.cookiejar.CookieJar()}
    admin = {'jar': http.cookiejar.CookieJar()}
    ok = True

    s, d = req(cust, 'POST', '/api/auth/register', CUST)
    ok &= check('customer register', s in (200, 201) and d.get('ok'), f's={s} {str(d)[:120]}')

    utr = '11' + STAMP[-10:]
    s, d = req(cust, 'POST', '/api/billing/upi/submit', {'planId': 'pro', 'utr': utr})
    ok &= check('upi submit (12-char UTR)', s == 200 and d.get('ok'), f's={s} {str(d)[:200]}')
    ai = d.get('ai') or {}
    ok &= check('AI verdict attached', isinstance(ai.get('score'), int), f'score={ai.get("score")} verdict={ai.get("verdict")}')
    print(f'        AI reasons: {(ai.get("reasons") or [])[:3]}')
    payment_id = d.get('paymentId', '')

    s, d = req(cust, 'POST', '/api/billing/upi/submit', {'planId': 'pro', 'utr': utr})
    ok &= check('duplicate UTR rejected', s == 409, f's={s}')

    s, d = req(cust, 'POST', '/api/billing/upi/submit', {'planId': 'pro', 'utr': 'short123'})
    ok &= check('bad UTR format rejected', s == 400, f's={s}')

    s, d = req(admin, 'POST', '/api/auth/login', ADMIN)
    ok &= check('admin login', s == 200 and d.get('ok'), f's={s}')
    s, d = req(admin, 'POST', '/api/admin/panel/session', {'pin': PIN})
    token = (d.get('token') or d.get('unlockToken') or '')
    ok &= check('admin unlock', s == 200 and d.get('ok'), f's={s} keys={list(d)[:6]}')

    hdr = {'x-ca-admin': token} if token else {}
    s, d = req(admin, 'GET', '/api/admin/panel/upi', extra=hdr)
    rows = d.get('rows') or []
    ok &= check('queue lists submission', s == 200 and any(r.get('id') == payment_id for r in rows), f's={s} rows={len(rows)}')
    ok &= check('queue stats present', isinstance((d.get('stats') or {}).get('pending'), int), str(d.get('stats'))[:100])

    s, d = req(admin, 'POST', '/api/admin/panel/upi', {'id': payment_id, 'action': 'approve'}, extra=hdr)
    ok &= check('admin approve', s == 200 and d.get('ok'), f's={s} {str(d)[:160]}')

    s, d = req(cust, 'GET', '/api/auth/me')
    u = (d.get('user') or {})
    ok &= check('customer plan is now pro', u.get('plan') == 'pro', f"plan={u.get('plan')} expires={u.get('planExpiresAt')}")

    print('\nRESULT:', 'ALL GREEN ✅' if ok else 'FAILURES ❌')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
