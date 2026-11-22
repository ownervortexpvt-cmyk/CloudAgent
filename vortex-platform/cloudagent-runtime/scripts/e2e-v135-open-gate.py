#!/usr/bin/env python3
"""v135 e2e — anonymous users must NOT be asked for an access code (siteOpen)."""
import requests, sys, time

B = 'http://localhost:3000'
ok = lambda c, m: print(('✅' if c else '❌') + ' ' + m) or (c or sys.exit(1))
ts = str(int(time.time()))

# 1) anonymous page access — NO gate redirect (was: 307 → /gate)
#    (/register by design 307s to /login?mode=signup — fine, still no gate)
for path in ['/login', '/register', '/pricing', '/landing']:
    r = requests.get(f'{B}{path}', allow_redirects=False, timeout=15)
    loc = r.headers.get('Location', '')
    ok(r.status_code == 200 or ('/gate' not in loc), f'anon GET {path} → {r.status_code} {loc or "(open)"} — no access-code wall')

# 2) anonymous API access (non-public API still needs login, but NOT the gate error)
r = requests.get(f'{B}/api/version', timeout=15).json()
ok(r.get('ok') is True, f'/api/version open ({r.get("buildId")})')

# 3) full anonymous journey: register → me → dashboard reachable
s = requests.Session()
r = s.post(f'{B}/api/auth/register', json={'name': 'Open Gate Test', 'email': f'opengate{ts}@test.local', 'password': 'Test1234!'}).json()
ok(r.get('ok'), 'anon can register (no access code)')
r = s.get(f'{B}/api/auth/me', timeout=15)
ok(r.status_code == 200, 'session works without gate header/cookie')

# 4) dashboard page serves for the signed-in user (gate would have blocked before)
r = s.get(f'{B}/', allow_redirects=False, timeout=15)
ok(r.status_code == 200 and '/gate' not in r.headers.get('Location', ''), 'signed-in user opens the dashboard — no access code')

# 5) BBD override ON → free window active (control-room switch works)
a = requests.Session(); a.headers.update({'x-ca-gate': 'CA-X-MONA-9173'})
r = a.post(f'{B}/api/auth/login', json={'email': 'mdhonabali61@gmail.com', 'password': 'Owner123'}).json()
ok(r.get('ok'), 'admin login')
a.post(f'{B}/api/admin/panel/session', json={'pin': '1000391619244862'}, timeout=15)
r = a.post(f'{B}/api/admin/panel/control', json={'patch': {'bbdOverride': 'on'}}, timeout=15).json()
ok(r.get('ok') and r['flags'].get('siteOpen') is True, 'control API: siteOpen flag present & true')
r = a.get(f'{B}/api/admin/panel/control', timeout=15).json()
ok(r.get('bigBillionDay', {}).get('active') is True, 'BBD override ON → free window active')

# 6) relock test: flip siteOpen OFF → gate wall returns → flip back ON
r = a.post(f'{B}/api/admin/panel/control', json={'patch': {'siteOpen': False}}, timeout=15).json()
ok(r.get('ok') and r['flags']['siteOpen'] is False, 'switch OFF works')
time.sleep(1)
r = requests.get(f'{B}/login', allow_redirects=False, timeout=15)
ok(r.status_code in (302, 307) and '/gate' in r.headers.get('Location', ''), 'gate wall returns when OFF (redirect → /gate)')
r = a.post(f'{B}/api/admin/panel/control', json={'patch': {'siteOpen': True}}, timeout=15).json()
ok(r.get('ok') and r['flags']['siteOpen'] is True, 'switch back ON')
time.sleep(1)
r = requests.get(f'{B}/login', allow_redirects=False, timeout=15)
ok(r.status_code == 200, 'open again after re-enable')
# reset bbd override to clock control
a.post(f'{B}/api/admin/panel/control', json={'patch': {'bbdOverride': ''}}, timeout=15)

print('\n🎉 v135 GATE E2E PASSED — site is open for ordinary users')
