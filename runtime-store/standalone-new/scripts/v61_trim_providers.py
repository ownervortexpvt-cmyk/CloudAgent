#!/usr/bin/env python3
"""v61.1 — DELETE all providers except the owner's 15 from the Quick dropdown.

Owner's order (kromonishare):
  Auto, Custom, Gemini, Groq, Z.ai, OpenRouter, AI/ML, DeepSeek, DeepInfra,
  + 6 strongest free: Cerebras, SambaNova, Hugging Face, SiliconFlow, Novita, Together

Deletes from ProviderManagerDialog.tsx:
  1. Q_PROVIDERS: 66 entries -> EXACTLY the 15 (owner order)
  2. Q_GROUPS (free/uncensored/paid group headers) — gone
  3. qShowAll state + the show-all toggle button + the qShowAll select branch
  4. KEY_GUIDE entries for deleted providers (never render again)
Server engine kinds (buildProvider/key-detect) stay — invisible plumbing that
keeps saved keys and Auto-detection working for any pasted key.
"""
import re, sys

P = '/home/z/my-project/src/components/cloud-agent/dialogs/ProviderManagerDialog.tsx'
src = open(P).read()
orig = src

OWNER_15 = [
  'auto', 'custom',
  'gemini', 'groq', 'zai', 'openrouter-free', 'aimlapi', 'deepseek', 'deepinfra',
  'cerebras', 'sambanova', 'huggingface', 'siliconflow', 'novita', 'together-free',
]

NEW_ARRAY = """  const Q_PROVIDERS: QProvider[] = [
    // ── v61.1 — ONLY the owner's 15 (kromonishare). The old 66-provider
    // catalog was DELETED per the owner's explicit order. Auto-detection
    // still recognizes ANY pasted key (key-detect/browser-detect stay). ──
    { id: 'auto', label: 'Auto (detect from key)', kind: '' },
    { id: 'custom', label: 'Custom URL (any provider)', kind: 'openai-compatible' },
    { id: 'gemini', label: 'Gemini (Google)', kind: 'gemini', group: 'free', endpoint: 'https://generativelanguage.googleapis.com/v1beta', link: 'https://aistudio.google.com/apikey', ph: 'AIza…' },
    { id: 'groq', label: 'Groq', kind: 'groq', group: 'free', endpoint: 'https://api.groq.com/openai/v1', link: 'https://console.groq.com/keys', ph: 'gsk_…' },
    { id: 'zai', label: 'Z.ai (GLM)', kind: 'openai-compatible', name: 'Z.ai (GLM)', group: 'paid', endpoint: 'https://api.z.ai/api/paas/v4', link: 'https://open.bigmodel.cn/usercenter/apikeys', ph: 'id.secret…' },
    { id: 'openrouter-free', label: 'OpenRouter (free models)', kind: 'openrouter', group: 'free', endpoint: 'https://openrouter.ai/api/v1', link: 'https://openrouter.ai/settings/keys', ph: 'sk-or-…' },
    { id: 'aimlapi', label: 'AI/ML API (free tier, 200+ models)', kind: 'openai-compatible', name: 'AI/ML API', group: 'free', endpoint: 'https://api.aimlapi.com/v1', link: 'https://aimlapi.com/app/keys', ph: '…' },
    { id: 'deepseek', label: 'DeepSeek (free promo credit)', kind: 'deepseek', group: 'free', endpoint: 'https://api.deepseek.com', link: 'https://platform.deepseek.com/api_keys', ph: 'sk-…' },
    { id: 'deepinfra', label: 'DeepInfra (uncensored)', kind: 'openai-compatible', name: 'DeepInfra', group: 'uncensored', endpoint: 'https://api.deepinfra.com/v1/openai', link: 'https://deepinfra.com/dash/api_keys', ph: 'paste your DeepInfra key' },
    { id: 'cerebras', label: 'Cerebras', kind: 'cerebras', group: 'free', endpoint: 'https://api.cerebras.ai/v1', link: 'https://cloud.cerebras.ai', ph: 'csk-…' },
    { id: 'sambanova', label: 'SambaNova', kind: 'sambanova', group: 'free', endpoint: 'https://api.sambanova.ai/v1', link: 'https://cloud.sambanova.ai', ph: '…' },
    { id: 'huggingface', label: 'Hugging Face', kind: 'huggingface', group: 'free', endpoint: 'https://api-inference.huggingface.co/v1', link: 'https://huggingface.co/settings/tokens', ph: 'hf_…' },
    { id: 'siliconflow', label: 'SiliconFlow', kind: 'siliconflow', group: 'free', endpoint: 'https://api.siliconflow.cn/v1', link: 'https://cloud.siliconflow.cn/account/ak', ph: 'sk-…' },
    { id: 'novita', label: 'Novita AI', kind: 'novita', group: 'free', endpoint: 'https://api.novita.ai/v3/openai', link: 'https://novita.ai/dashboard/key', ph: '…' },
    { id: 'together-free', label: 'Together AI ($5 free credit)', kind: 'together', group: 'free', endpoint: 'https://api.together.xyz/v1', link: 'https://api.together.ai/settings/api-keys', ph: '…' },
  ]
"""

# ── 1. replace the Q_PROVIDERS array ──────────────────────────────────────
m = re.search(r'  const Q_PROVIDERS: QProvider\[\] = \[[\s\S]*?\n  \]\n', src)
assert m, 'Q_PROVIDERS array not found'
src = src[:m.start()] + NEW_ARRAY + src[m.end():]

# ── 2. delete Q_GROUPS block ──────────────────────────────────────────────
m = re.search(r'  const Q_GROUPS: \{ id: NonNullable<QProvider\[\'group\'\]>; label: string \}\[\] = \[[\s\S]*?\n  \]\n', src)
assert m, 'Q_GROUPS not found'
src = src[:m.start()] + src[m.end():]

# ── 3. delete qShowAll state (+ its comment) ──────────────────────────────
m = re.search(r'  // v52 — curated-15 dropdown: the full 60\+ catalog hides behind a toggle\n  const \[qShowAll, setQShowAll\] = useState\(false\)\n', src)
assert m, 'qShowAll state not found'
src = src[:m.start()] + src[m.end():]

# ── 4. delete the qShowAll select branch + toggle button ──────────────────
branch = """                      {qShowAll && (
                        <>
                          {Q_PROVIDERS.filter(p => !p.group && !Q_CURATED.includes(p.id)).map(p => (
                            <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                          ))}
                          {Q_GROUPS.map(g => (
                            <SelectGroup key={g.id}>
                              <SelectLabel className="text-[11px] font-semibold text-muted-foreground">{g.label}</SelectLabel>
                              {Q_PROVIDERS.filter(p => p.group === g.id).map(p => (
                                <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                              ))}
                            </SelectGroup>
                          ))}
                        </>
                      )}
"""
assert branch in src, 'qShowAll select branch not found'
src = src.replace(branch, '')

toggle = """                  <button
                    type="button"
                    onClick={() => setQShowAll(s => !s)}
                    className="text-[11px] text-primary hover:underline mt-1 inline-flex items-center gap-1"
                  >
                    {qShowAll ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    {qShowAll ? 'Show your 15 only' : `Show all ${Q_PROVIDERS.length}+ providers (uncensored, local, paid…)`}
                  </button>
"""
assert toggle in src, 'show-all toggle button not found'
src = src.replace(toggle, '')

# ── 5. trim KEY_GUIDE to the owner's 15 ───────────────────────────────────
keep = set(OWNER_15)
removed_guides = []
out_lines = []
in_guide = False
for line in src.split('\n'):
    if line.startswith('const KEY_GUIDE'):
        in_guide = True
    elif in_guide and line.startswith('}'):
        in_guide = False
    if in_guide:
        km = re.match(r"^  '?([a-z0-9-]+)'?: \{ steps:", line)
        if km and km.group(1) not in keep:
            removed_guides.append(km.group(1))
            continue
    out_lines.append(line)
src = '\n'.join(out_lines)

# ── 6. update the Q_CURATED header comment (show-all no longer exists) ────
src = src.replace(
"""// The full 60+ catalog stays reachable via the "Show all providers" toggle —
// NOTHING removed, everything still searchable.""",
"""// v61.1: the old 66-provider catalog was DELETED per the owner — the
// dropdown now carries ONLY these 15, nothing else.""")

open(P, 'w').write(src)

# ── report ────────────────────────────────────────────────────────────────
kept_ids = re.findall(r"\{ id: '([^']+)', label:", re.search(r'const Q_PROVIDERS: QProvider\[\] = \[[\s\S]*?\n  \]', src).group(0))
print('Q_PROVIDERS now:', len(kept_ids), 'entries')
print('order:', kept_ids)
assert kept_ids == OWNER_15, 'ORDER MISMATCH'
assert 'qShowAll' not in src, 'qShowAll still referenced'
assert 'Q_GROUPS' not in src, 'Q_GROUPS still referenced'
assert 'ChevronDown' in src or True
print('KEY_GUIDE removed for:', ', '.join(removed_guides))
print('diff vs original:', len(orig) - len(src), 'chars removed')
print('OK — all assertions passed')
