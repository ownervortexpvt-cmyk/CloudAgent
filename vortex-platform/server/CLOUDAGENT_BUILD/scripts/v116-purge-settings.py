#!/usr/bin/env python3
"""v116 — purge admin remnants from SettingsDialog.
Deletes BackupSettings, AdminUsers, RazorpayKeys + fixes copy references.
Idempotent: re-running after a successful run is a no-op."""
import re, sys

P = '/home/z/my-project/src/components/cloud-agent/dialogs/SettingsDialog.tsx'
src = open(P, encoding='utf-8').read()
orig_len = len(src)

def delete_block(s, start_marker, end_marker, label):
    """Delete from start_marker up to (not including) end_marker."""
    i = s.find(start_marker)
    if i == -1:
        print(f'  SKIP {label}: start marker not found (already deleted?)')
        return s
    j = s.find(end_marker, i)
    if j == -1:
        print(f'  ERROR {label}: end marker not found'); sys.exit(1)
    print(f'  DELETED {label}: {j - i} chars')
    return s[:i] + s[j:]

# 1. BackupSettings (comment block + function) → up to AutoLockSettings comment
src = delete_block(
    src,
    '/**\n * v58 — 💾 Full backup & restore of the whole army base',
    '/** v25 — auto-lock after idle (per device, stored locally). */',
    'BackupSettings')

# 2. AdminUsers + RazorpayKeys (end-of-file block) → delete through EOF
i = src.find('/** BUSINESS v2 — admin user manager')
if i != -1:
    print(f'  DELETED AdminUsers+RazorpayKeys: {len(src) - i} chars')
    src = src[:i].rstrip() + '\n'
else:
    print('  SKIP AdminUsers+RazorpayKeys (already deleted)')

# 3. Fix stale copy in PlanSettings
src = src.replace(
    'Facing an issue? See Settings → Payments (admin) or the Contact page.',
    'Facing an issue? Use the Contact page — the owner responds personally.')

open(P, 'w', encoding='utf-8').write(src)
print(f'Done: {orig_len} → {len(src)} chars ({orig_len - len(src)} removed)')
