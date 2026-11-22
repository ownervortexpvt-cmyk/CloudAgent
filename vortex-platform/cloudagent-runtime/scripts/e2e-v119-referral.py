#!/usr/bin/env python3
"""v119 — REFER & EARN full verification:
invite code minting → public lookup → dual reward (referee Pro 7d + referrer
extension) → code normalization (CA- prefix / lowercase) → bad-code safety →
stats. Source checks + live API checks, cleanup via direct DB."""
import json, time, urllib.request, urllib.error, sys, os, re

BASE = 'http://127.0.0.1:3000'
PASS, FAIL = [], []
ROOT = '/home/z/my-project'

GATE = 'CA-X-MONA-9173'  # v123 private-site key — every suite presents it
def req(method, path, body=None, cookie=None, headers=None, timeout=60):
    data = json.dumps(body).encode() if body is not None else None
    h = {'Content-Type': 'application/json'}
    h['x-ca-gate'] = 'CA-X-MONA-9173'  # v123 private-site gate
    if cookie: h['Cookie'] = cookie
    if headers: h.update(headers)
    r = urllib.request.Request(BASE + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            raw = resp.read()
            ct = resp.headers.get('content-type', '')
            setc = resp.headers.get('set-cookie', '')
            try: out = json.loads(raw) if 'json' in ct else {'_raw': raw[:200].decode('utf-8', 'replace')}
            except Exception: out = {'_raw': raw[:200].decode('utf-8', 'replace')}
            return resp.status, out, setc, ct
    except urllib.error.HTTPError as e:
        raw = e.read().decode('utf-8', 'replace')
        try: out = json.loads(raw)
        except Exception: out = {'_raw': raw[:300]}
        return e.code, out, e.headers.get('set-cookie', ''), e.headers.get('content-type', '')

def check(name, cond, extra=''):
    (PASS if cond else FAIL).append(name)
    print(('✅' if cond else '❌'), name, ('' if cond else f'  [{extra}]'))

def register(payload):
    """POST /api/auth/register with 429-aware retry (the 8/min/ip guard is
    REAL and the suite may rerun within its window — wait it out honestly)."""
    for attempt in range(4):
        sc, body, setc, _ = req('POST', '/api/auth/register', payload)
        if sc != 429:
            return sc, body, setc
        wait = 25 * (attempt + 1)
        print(f'   ⏳ rate-limited (8/min/ip) — waiting {wait}s…')
        time.sleep(wait)
    return sc, body, setc

def days_until(iso):
    return (int(time.mktime(time.strptime(iso[:19], '%Y-%m-%dT%H:%M:%S'))) - time.time()) / 86400 if iso else None

# ─── 1. SOURCE CHECKS ────────────────────────────────────────────────────────
def src(path):
    with open(os.path.join(ROOT, path), encoding='utf-8') as f: return f.read()

schema = src('prisma/schema.prisma')
reg_r = src('src/app/api/auth/register/route.ts')
mw = src('src/middleware.ts')
refl = src('src/lib/referral.ts')
sd = src('src/components/cloud-agent/dialogs/SettingsDialog.tsx')
login = src('src/app/login/page.tsx')
um = src('src/components/cloud-agent/UserMenu.tsx')

check('schema: referralCode unique column', 'referralCode  String?   @unique' in schema)
check('schema: referredById + index', 'referredById  String?' in schema and '@@index([referredById])' in schema)
check('register: applies referral from body.ref', 'applyReferral' in reg_r and 'body?.ref' in reg_r and 'ensureReferralCode' in reg_r)
check('middleware: referral lookup public', "'/api/referral/lookup'" in mw)
check('lib/referral: 7-day Pro reward constants', 'REWARD_DAYS = 7' in refl and "REWARD_PLAN = 'pro'" in refl)
check('lib/referral: code normalization strips CA- and dashes', "replace(/[\\s-]/g, '')" in refl)
check('settings: Refer & Earn tab wired', "tab === 'refer'" in sd and 'ReferSettings' in sd and 'settingsTabRequest' in sd)
check('settings: WhatsApp share + stats', 'wa.me' in sd and 'totalReferred' in sd)
check('login: reads ?ref= + remembers 7d + posts ref', "params.get('ref')" in login and 'ca_ref' in login and 'ref: refCode' in login)
check('login: invite banner shows referrer name', 'invited you to CloudAgent' in login)
check('usermenu: refer entry deep-links via store request', "setSettingsTabRequest('refer')" in um and 'useAppStore' in um)

# ─── 2. LIVE API CHECKS ──────────────────────────────────────────────────────
ts = int(time.time())

# referrer A
sc, body, setc = register({'email': f'refa{ts}@qa.local', 'password': 'test119pw', 'name': 'Ref Tester'})
ckA = setc.split(';')[0] if setc else ''
codeA = (body.get('referral') or {}).get('myCode', '')
check('register A → myCode minted (8 chars)', sc == 200 and bool(re.fullmatch(r'[A-Z0-9]{8}', codeA)), f'{sc} {str(body)[:120]}')
check('register A → no referral applied (no ref given)', (body.get('referral') or {}).get('applied') is False, str(body.get('referral'))[:80])

sc, body, _, _ = req('GET', '/api/referral/me', cookie=ckA)
prof = body if body.get('ok') else {}
check('referral/me: code + link + shareText', sc == 200 and prof.get('code') == codeA and f'/register?ref={codeA}' in prof.get('link', '') and codeA in prof.get('shareText', ''), f'{sc} {str(body)[:140]}')
check('referral/me: starts at 0 referrals + reward meta', prof.get('totalReferred') == 0 and prof.get('rewardDays') == 7 and (prof.get('rewardPlan') or {}).get('id') == 'pro', str(prof)[:120])

# public lookup — anonymous, no cookie
sc, body, _, _ = req('GET', f'/api/referral/lookup?ref={codeA}')
check('lookup: anonymous 200 + masked first name + 7d', sc == 200 and body.get('referrerName') == 'Ref' and body.get('rewardDays') == 7, f'{sc} {str(body)[:100]}')
sc, body, _, _ = req('GET', '/api/referral/lookup?ref=ZZZZ9999')
check('lookup: unknown code → honest 404', sc == 404, f'{sc} {str(body)[:80]}')
sc, body, _, _ = req('GET', '/api/referral/lookup')
check('lookup: missing code → 400', sc == 400, str(sc))
sc, body, _, _ = req('GET', '/api/referral/me')
check('referral/me: no session → 401', sc == 401, str(sc))

# referee B — uses A's code
sc, body, setc = register({'email': f'refb{ts}@qa.local', 'password': 'test119pw', 'name': 'Bony Referee', 'ref': codeA})
ckB = setc.split(';')[0] if setc else ''
check('register B with ref → applied + referrer name', sc == 200 and (body.get('referral') or {}).get('applied') is True and (body.get('referral') or {}).get('referrerName') == 'Ref', f'{sc} {str(body.get("referral"))[:100]}')

sc, body, _, _ = req('GET', '/api/auth/me', cookie=ckB)
uB = body.get('user') or {}
expB1 = uB.get('planExpiresAt')
check('B reward: pro monthly ~7 days', uB.get('plan') == 'pro' and uB.get('planKind') == 'monthly' and expB1 and 6.8 < (days_until(expB1) or 0) < 7.2, f'{str(body)[:140]}')

sc, body, _, _ = req('GET', '/api/auth/me', cookie=ckA)
uA = body.get('user') or {}
expA1 = uA.get('planExpiresAt')
check('A reward: free referrer → pro monthly ~7 days', uA.get('plan') == 'pro' and uA.get('planKind') == 'monthly' and expA1 and 6.8 < (days_until(expA1) or 0) < 7.2, f'{str(body)[:140]}')

sc, body, _, _ = req('GET', '/api/referral/me', cookie=ckA)
friends = body.get('friends') or []
check('A stats: 1 friend, masked name + plan', body.get('totalReferred') == 1 and friends and friends[0].get('name') == 'Bony' and friends[0].get('plan') == 'pro', f'{str(body)[:160]}')

# C — bad code never breaks signup
sc, body, setc = register({'email': f'refc{ts}@qa.local', 'password': 'test119pw', 'name': 'Bad Code', 'ref': 'ZZZZ9999'})
ckC = setc.split(';')[0] if setc else ''
check('register C bad code → signup OK, applied false', sc == 200 and (body.get('referral') or {}).get('applied') is False, f'{sc} {str(body.get("referral"))[:80]}')
sc, body, _, _ = req('GET', '/api/auth/me', cookie=ckC)
check('C stays free (no reward from bad code)', (body.get('user') or {}).get('plan') == 'free', f'{str(body)[:100]}')

# D — normalization: "CA-" prefix + lowercase survives
sc, body, _, _ = req('GET', '/api/referral/me', cookie=ckB)
codeB = body.get('code', '')
sc, body, setc = register({'email': f'refd{ts}@qa.local', 'password': 'test119pw', 'name': 'Deep User', 'ref': f'ca-{codeB.lower()}'})
ckD = setc.split(';')[0] if setc else ''
check('register D: CA- prefix + lowercase normalized → applied', sc == 200 and (body.get('referral') or {}).get('applied') is True and (body.get('referral') or {}).get('referrerName') == 'Bony', f'{sc} {str(body.get("referral"))[:100]}')
sc, body, _, _ = req('GET', '/api/auth/me', cookie=ckD)
uD = body.get('user') or {}
check('D reward: pro monthly ~7 days', uD.get('plan') == 'pro' and uD.get('planKind') == 'monthly', f'{str(body)[:100]}')

# B was active pro monthly → D's signup EXTENDS B by 7d (no lost days)
sc, body, _, _ = req('GET', '/api/auth/me', cookie=ckB)
uB2 = body.get('user') or {}
expB2 = uB2.get('planExpiresAt')
d1, d2 = days_until(expB1) or 0, days_until(expB2) or 0
check('B extension: +7 days on same tier (no lost days)', expB2 and 6.8 < (d2 - d1) < 7.2, f'before={d1:.2f}d after={d2:.2f}d')

sc, body, _, _ = req('GET', '/api/referral/me', cookie=ckB)
check('B stats: 1 friend (D) counted', body.get('totalReferred') == 1 and (body.get('friends') or [{}])[0].get('name') == 'Deep', str(body)[:120])

# E — lowercase code, referrer A again → A extends (A is active pro monthly now)
sc, body, setc = register({'email': f'refe{ts}@qa.local', 'password': 'test119pw', 'name': 'Eve User', 'ref': codeA.lower()})
check('register E: lowercase code applied', sc == 200 and (body.get('referral') or {}).get('applied') is True, f'{sc} {str(body.get("referral"))[:80]}')

sc, body, _, _ = req('GET', '/api/auth/me', cookie=ckA)
uA2 = body.get('user') or {}
expA2 = uA2.get('planExpiresAt')
d1, d2 = days_until(expA1) or 0, days_until(expA2) or 0
check('A extension: +7 more days (2 referrals total)', expA2 and 6.8 < (d2 - d1) < 7.2, f'before={d1:.2f}d after={d2:.2f}d')
sc, body, _, _ = req('GET', '/api/referral/me', cookie=ckA)
check('A stats: 2 friends, 14 days earned', body.get('totalReferred') == 2, str(body.get('totalReferred')))

# billing/me consistency for B
sc, body, _, _ = req('GET', '/api/billing/me', cookie=ckB)
check('billing/me consistency: B sees pro + expiry', sc == 200 and (body.get('plan') or {}).get('id') == 'pro' and body.get('planExpiresAt'), str(body)[:120])

# ─── 3. CLEANUP (direct DB — test users only) ────────────────────────────────
import subprocess
emails = [f'refa{ts}@qa.local', f'refb{ts}@qa.local', f'refc{ts}@qa.local', f'refd{ts}@qa.local', f'refe{ts}@qa.local']
node_clean = '''
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  const emails = ''' + json.dumps(emails) + ''';
  const users = await p.authUser.findMany({ where: { email: { in: emails } }, select: { id: true } });
  for (const u of users) {
    await p.authSession.deleteMany({ where: { userId: u.id } });
    await p.authUser.delete({ where: { id: u.id } });
  }
  console.log("cleaned:", users.length);
  await p.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
'''
r = subprocess.run(['node', '-e', node_clean], capture_output=True, text=True, cwd=ROOT, timeout=60)
check('cleanup: all 5 test users removed', 'cleaned: 5' in r.stdout, f'{r.stdout.strip()} {r.stderr.strip()[:120]}')

print(f'\n===== v119 REFER & EARN: {len(PASS)} PASS / {len(FAIL)} FAIL =====')
sys.exit(1 if FAIL else 0)
