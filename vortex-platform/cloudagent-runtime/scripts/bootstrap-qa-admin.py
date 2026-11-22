#!/usr/bin/env python3
"""Bootstrap a QA admin account (scrypt hash matching src/lib/auth.ts) + restore
the 3 built-in Z.ai provider rows after a DB recycle. Never touches the owner."""
import sqlite3, hashlib, os, sys, uuid

DB = os.path.join(os.path.dirname(__file__), '..', 'db', 'custom.db')
SALT = 'qasalt1234567890'
PW = 'qatester115'

def hash_password(pw: str) -> str:
    h = hashlib.scrypt(pw.encode(), salt=SALT.encode(), n=2**14, r=8, p=1, dklen=64).hex()
    return f'{SALT}:{h}'

c = sqlite3.connect(DB)
cur = c.cursor()

# find hash format from auth.ts: salt:hash with scrypt 64-byte
email = 'qa-admin115@qa.local'
row = cur.execute('SELECT id FROM AuthUser WHERE email=?', (email,)).fetchone()
uid = row[0] if row else 'qa' + uuid.uuid4().hex[:20]
if not row:
    # discover column names first
    cols = [r[1] for r in cur.execute('PRAGMA table_info(AuthUser)').fetchall()]
    print('AuthUser cols:', cols)
    base = {'id': uid, 'email': email, 'name': 'QA Admin 115', 'role': 'admin',
            'plan': 'ultra_pro_max', 'status': 'active'}
    vals = {k: v for k, v in base.items() if k in cols}
    vals['passwordHash'] = hash_password(PW)
    if 'planExpiresAt' in cols: vals['planExpiresAt'] = None
    keys = ','.join(vals); q = ','.join('?' * len(vals))
    cur.execute(f'INSERT INTO AuthUser ({keys}) VALUES ({q})', list(vals.values()))
    print('created QA admin', email)
else:
    cur.execute('UPDATE AuthUser SET role=?, plan=?, status=? WHERE id=?', ('admin', 'ultra_pro_max', 'active', uid))
    print('QA admin already exists')

# built-in Z.ai provider rows (global rows userId=null per schema — check cols)
pcols = [r[1] for r in cur.execute('PRAGMA table_info(AIProvider)').fetchall()]
print('AIProvider cols:', pcols)
has_user = 'userId' in pcols
rows = [
    ('GLM 5.3 Flash', 'zai', 'glm-5.3-flash', 1),
    ('GLM 5.3', 'zai', 'glm-5.3', 0),
    ('GLM 4.6', 'zai', 'glm-4.6', 0),
]
for name, kind, model, isdef in rows:
    if has_user:
        ex = cur.execute('SELECT id FROM AIProvider WHERE userId IS NULL AND name=?', (name,)).fetchone()
    else:
        ex = cur.execute('SELECT id FROM AIProvider WHERE name=?', (name,)).fetchone()
    if ex: continue
    pid = 'prv' + uuid.uuid4().hex[:20]
    fields = {'id': pid, 'name': name, 'kind': kind, 'model': model, 'category': 'free',
              'isDefault': isdef, 'role': 'work', 'createdAt': '2026-10-11 00:00:00',
              'updatedAt': '2026-10-11 00:00:00'}
    fields = {k: v for k, v in fields.items() if k in pcols}
    keys = ','.join(fields); q = ','.join('?' * len(fields))
    cur.execute(f'INSERT INTO AIProvider ({keys}) VALUES ({q})', list(fields.values()))
    print('provider row added:', name)

c.commit()
print('DONE — login with', email, '/', PW)
