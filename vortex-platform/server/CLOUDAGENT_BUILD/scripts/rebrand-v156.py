#!/usr/bin/env python3
"""
v156 — remove every user-visible "Z.ai" brand string from src/, strip the
z.ai preview URL from scripts/ghpages, and neutralize the test fixture.
Functional plumbing stays: kind:'zai' identifiers, api.z.ai GLM endpoints,
the z-ai-web-dev-sdk import, and legacy pricing keys for old DB rows.
"""
import re, pathlib, sys

ROOT = pathlib.Path('/home/z/my-project')
changed = []

def sub_file(path, rules, must_count=None):
    p = ROOT / path
    if not p.exists():
        print(f'SKIP missing: {path}'); return
    src = p.read_text(encoding='utf-8')
    out = src
    for old, new in rules:
        out = out.replace(old, new)
    if out != src:
        p.write_text(out, encoding='utf-8')
        changed.append(str(path))
        print(f'OK  {path}')
    else:
        print(f'no-op {path}')

# ── 1. UI strings across src ──────────────────────────────────────────────
UI_RULES = [
    # provider display names (contract: new rows get the new name)
    ("name: existing?.name || 'Built-in Z.ai'", "name: existing?.name || 'Built-in Vortex Engine'"),
    ("'Z.ai (built-in)'", "'Vortex Engine (built-in)'"),
    ("'Z.ai (GLM)'", "'GLM (Zhipu)'"),
    ("displayName = 'GLM (Z.ai)'", "displayName = 'GLM (built-in)'"),
    # toasts / labels / copy
    ('the built-in Z.ai provider', 'the built-in Vortex Engine provider'),
    ('the built-in Z.ai fallback', 'the built-in Vortex Engine fallback'),
    ('the built-in Z.ai card above', 'the Built-in Vortex Engine card above'),
    ('built-in Z.ai (cheap, 1 call)', 'built-in Vortex Engine (cheap, 1 call)'),
    ('Built-in Z.ai — no API key needed', 'Built-in Vortex Engine — no API key needed'),
    ('Built-in Z.ai saved', 'Built-in Vortex Engine saved'),
    ('Built-in Z.ai — save WITHOUT', 'Built-in Vortex Engine — save WITHOUT'),
    ('built-in Z.ai needs none', 'built-in Vortex Engine needs none'),
    ('Z.ai / Zhipu GLM key', 'GLM (Zhipu) key'),
    ('Open open.bigmodel.cn (Z.ai / Zhipu)', 'Open open.bigmodel.cn (GLM / Zhipu)'),
    ('Z.ai works with no key at all', 'The built-in Vortex Engine works with no key at all'),
    ('Use Z.ai (built-in, free) for simple tasks', 'Use the Vortex Engine (built-in, free) for simple tasks'),
    ('Z.ai open weights', 'GLM open weights'),
    ('will use Z.ai fallback', 'will use the GLM fallback'),
    ('Z.ai API key (optional', 'GLM API key (optional'),
    ("docsUrl: 'https://z.ai/'", "docsUrl: 'https://open.bigmodel.cn/usercenter/apikeys'"),
    # comments
    ('the built-in Z.ai provider rows', 'the built-in Vortex Engine provider rows'),
    ('built-in Z.ai provider rows when', 'built-in Vortex Engine provider rows when'),
    ('built-in Z.ai provider rows (global', 'built-in Vortex Engine provider rows (global'),
    ('built-in Z.ai provider row(s)', 'built-in Vortex Engine provider row(s)'),
    ('Shared Z.ai model lineup', 'Shared GLM model lineup'),
    ('user-facing Z.ai model list', 'user-facing GLM model list'),
    ('Custom URL / Z.ai GLM / AI/ML', 'Custom URL / GLM / AI/ML'),
    ('Groq → Z.ai → OpenRouter', 'Groq → GLM → OpenRouter'),
    ('🆓 Built-in Z.ai card (no API key', '🆓 Built-in Vortex Engine card (no API key'),
    ('🆓 Built-in Z.ai — NO API key needed', '🆓 Built-in Vortex Engine — NO API key needed'),
    ('Pre-warmed Z.ai provider', 'Pre-warmed built-in Vortex Engine provider'),
    ('built-in Z.ai pinned (forceBuiltIn)', 'built-in Vortex Engine pinned (forceBuiltIn)'),
    ('built-in Z.ai provider (E2E', 'built-in Vortex Engine provider (E2E'),
    ('SINGLE-AGENT PATH — built-in Z.ai pinned', 'SINGLE-AGENT PATH — built-in Vortex Engine pinned'),
    ('Z.ai / Zhipu GLM keys look like', 'GLM (Zhipu) keys look like'),
    ('Moonshot, Qwen, Z.ai, MiniMax', 'Moonshot, Qwen, GLM, MiniMax'),
    ('the built-in Z.ai SDK only exists', 'the built-in GLM SDK only exists'),
    ('If no providers, use Z.ai built-in', 'If no providers, use the built-in Vortex Engine'),
    ('providers (the Z.ai SDK) ignore', 'providers (the GLM SDK) ignore'),
    ('every Z.ai provider row', 'every built-in Vortex Engine provider row'),
    ('the Z.ai SDK accepts stream:true', 'the GLM SDK accepts stream:true'),
    ('GLM family (Z.ai open weights)', 'GLM family (open weights)'),
    ("strength: 'Z.ai open weights", "strength: 'GLM open weights"),
    ('with the built-in Z.ai as the silent', 'with the built-in Vortex Engine as the silent'),
    ('// Z.ai — strict mode empties', '// GLM — strict mode empties'),
    ('silent built-in Z.ai last resort', 'silent built-in Vortex Engine last resort'),
    ('then fallbacks, then Z.ai', 'then fallbacks, then the built-in Vortex Engine'),
    ('Ensure Z.ai is always available', 'Ensure the built-in Vortex Engine is always available'),
    ('the 3 built-in Z.ai providers all', 'the 3 built-in Vortex Engine providers all'),
    ('// Z.ai is always included', '// The built-in Vortex Engine is always included'),
    ('include Z.ai + OpenAI + GitHub', 'include the built-in engine + OpenAI + GitHub'),
    ('we pin the built-in Z.ai provider', 'we pin the built-in Vortex Engine provider'),
    ('built-in providers like Z.ai', 'built-in providers like the Vortex Engine'),
    ('// Z.ai (no public /models', '// GLM (no public /models'),
    ('— Z.ai has no public /models', '— GLM has no public /models'),
    ('z.ai account changes / snapshot', 'platform account changes / snapshot'),
]

for f in [
    'src/components/cloud-agent/multiagent/MultiAgentPanel.tsx',
    'src/components/cloud-agent/multiagent/ScheduleDialog.tsx',
    'src/components/cloud-agent/dialogs/ProviderManagerDialog.tsx',
    'src/components/cloud-agent/dialogs/HelpDialog.tsx',
    'src/lib/boot-heal.ts',
    'src/lib/zai-models.ts',
    'src/lib/pricing.ts',
    'src/lib/ai/key-detect.ts',
    'src/lib/ai/tools.ts',
    'src/lib/ai/browser-detect.ts',
    'src/lib/ai/providers.ts',
    'src/lib/ai/local.ts',
    'src/lib/ai/swarm.ts',
    'src/lib/ai/agent.ts',
    'src/lib/ai/auto-api-tools.ts',
    'src/lib/scheduler.ts',
    'src/lib/fbstore.ts',
    'src/app/api/agent/route.ts',
    'src/app/api/multi-agent/route.ts',
    'src/app/api/providers/route.ts',
    'src/app/api/providers/test-all/route.ts',
    'src/app/api/providers/models/route.ts',
    'src/app/api/providers/fix-model/route.ts',
]:
    sub_file(f, UI_RULES)

# pricing.ts — add rebranded keys next to the legacy one (old DB rows)
p = ROOT / 'src/lib/pricing.ts'
if p.exists():
    s = p.read_text(encoding='utf-8')
    if "'Vortex Engine (built-in)': 0" not in s:
        s = s.replace(
            "  'Z.ai (built-in)': 0,",
            "  // legacy row names from before the rebrand — kept so old DB rows price correctly\n"
            "  'Z.ai (built-in)': 0,\n"
            "  'Vortex Engine (built-in)': 0,\n"
            "  'Built-in Vortex Engine': 0,"
        )
        p.write_text(s, encoding='utf-8')
        print('OK  src/lib/pricing.ts (+rebrand keys)')

# ── 2. ghpages — strip the z.ai preview URL entirely ─────────────────────
g = ROOT / 'scripts/ghpages/login.html'
if g.exists():
    s = g.read_text(encoding='utf-8')
    s = s.replace(
        '   Example: const PLATFORM_URL = "https://OLD-PREVIEW-URL-REMOVED";\n',
        ''
    )
    s = s.replace(
        'const PLATFORM_URL = "https://OLD-PREVIEW-URL-REMOVED";',
        'const PLATFORM_URL = ""; // no baked URL — visitors use the ?u= workspace link'
    )
    g.write_text(s, encoding='utf-8')
    print('OK  scripts/ghpages/login.html (preview URL removed)')

t = ROOT / 'scripts/test-login-html.js'
if t.exists():
    s = t.read_text(encoding='utf-8')
    s = s.replace('preview-test-123.space-z.ai', 'preview-test-123.example.net')
    t.write_text(s, encoding='utf-8')
    print('OK  scripts/test-login-html.js (fixture neutralized)')

print(f'\n{len(changed)} files changed')
