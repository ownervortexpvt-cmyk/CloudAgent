#!/usr/bin/env python3
"""Scrub hardcoded credentials from vortex-platform mirror scripts (v2, generic).
Replaces quoted credential literals with the .secrets loader pattern.
Idempotent: safe to run multiple times.
"""
import json, os, re, shutil, subprocess, sys

BASE = '/home/z/my-project'
FILES = [
    'vortex-platform/cloudagent-runtime/scripts/tunnel-keeper.js',
    'vortex-platform/cloudagent-runtime/scripts/fix-all.mjs',
    'vortex-platform/cloudagent-runtime/scripts/joy-put.cjs',
    'vortex-platform/cloudagent-runtime/scripts/joy-sigv4-check.cjs',
    'vortex-platform/cloudagent-runtime/scripts/save-joy-storage.js',
    'vortex-platform/cloudagent-runtime/scripts/set-joy-service-keys.cjs',
    'vortex-platform/cloudagent-runtime/scripts/vortex-setup.cjs',
]

CJS_LOADER = (
    "let SECRETS = {}\n"
    "try { SECRETS = JSON.parse(require('fs')"
    ".readFileSync('/home/z/my-project/.secrets/vortex-secrets.json', 'utf8')) } catch {}\n"
)
ESM_LOADER = (
    "import { readFileSync as _vortexReadSecrets } from 'node:fs'\n"
    "let SECRETS = {}\n"
    "try { SECRETS = JSON.parse(_vortexReadSecrets('/home/z/my-project/.secrets/vortex-secrets.json', 'utf8')) } catch {}\n"
)


def is_esm(src, path):
    if path.endswith('.cjs'):
        return False
    if path.endswith('.mjs'):
        return True
    return bool(re.match(r'\s*import\s', src)) or re.search(r'^import\s', src, re.M) is not None


def scrub_file(path, literals):
    src = open(path).read()
    orig = src
    changed = []
    for val, expr in literals:
        # quoted literal (single quotes) -> loader expression
        pat = "'" + re.escape(val) + "'"
        if pat in src:
            src = src.replace(pat, expr)
            changed.append(expr.split('.')[1].split(' ')[0])
    if 'SECRETS' not in orig and 'SECRETS' not in src:
        loader = ESM_LOADER if is_esm(src, path) else CJS_LOADER
        src = loader + '\n' + src
        changed.append('loader')
    if src != orig:
        open(path, 'w').write(src)
        print(f"{path}: scrubbed {changed}")
    else:
        print(f"{path}: already clean")


def syntax_check(path):
    if path.endswith('.mjs'):
        subprocess.run(['node', '--check', path], check=True)
        return
    tmp = '/tmp/_syncheck-' + os.path.basename(path) + ('.mjs' if is_esm(open(path).read(), path) else '.cjs')
    shutil.copy(path, tmp)
    subprocess.run(['node', '--check', tmp], check=True)
    os.remove(tmp)


def main():
    sec = json.load(open(f'{BASE}/.secrets/vortex-secrets.json'))
    literals = [
        (sec['joyAccessKey'], "(SECRETS.joyAccessKey || '')"),
        (sec['joySecretKey'], "(SECRETS.joySecretKey || '')"),
        (sec['cfToken'], "(SECRETS.cfToken || process.env.CF_API_TOKEN || '')"),
        (sec['cfAccount'], "(SECRETS.cfAccount || '')"),
    ]
    for rel in FILES:
        p = os.path.join(BASE, rel)
        if not os.path.exists(p):
            print(f"skip (missing): {rel}")
            continue
        scrub_file(p, literals)
        syntax_check(p)
    # final verification across the 7 files
    bad = []
    for rel in FILES:
        p = os.path.join(BASE, rel)
        if os.path.exists(p):
            src = open(p).read()
            for val, _ in literals:
                if val in src:
                    bad.append(rel)
    if bad:
        print("STILL DIRTY:", bad)
        sys.exit(1)
    print("scrub complete: no credential literals remain in mirror scripts")


if __name__ == '__main__':
    main()
