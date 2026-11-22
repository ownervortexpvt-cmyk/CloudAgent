#!/usr/bin/env python3
"""v61.2 — Trim PROVIDER_KINDS (the List-tab edit form's kind dropdown, 50
entries) down to the kinds behind the owner's 15 providers (+ the custom
kinds those picks actually save with). Same owner order as the Quick tab.

Kept kinds: zai (built-in card rows), gemini, groq, openrouter (what the
OpenRouter quick pick saves), deepseek, deepinfra, cerebras, sambanova,
huggingface, siliconflow, novita, together (what Together quick pick saves),
openai-compatible (Custom URL / Z.ai GLM / AI/ML / DeepInfra), custom.
"""
import re

P = '/home/z/my-project/src/components/cloud-agent/dialogs/ProviderManagerDialog.tsx'
src = open(P).read()

KEEP = ['zai', 'gemini', 'groq', 'openrouter', 'deepseek', 'deepinfra',
        'cerebras', 'sambanova', 'huggingface', 'siliconflow', 'novita',
        'together', 'openai-compatible', 'custom']

m = re.search(r'const PROVIDER_KINDS = \[[\s\S]*?\n\]\n', src)
assert m, 'PROVIDER_KINDS not found'
block = m.group(0)

entries = {}
for em in re.finditer(r"^  \{ value: '([^']+)',.*$", block, re.M):
    entries[em.group(1)] = em.group(0)
print('parsed entries:', len(entries))

missing = [v for v in KEEP if v not in entries]
assert not missing, f'missing kept values: {missing}'

new_block = """const PROVIDER_KINDS = [
  // ── v61.2 — ONLY the kinds behind the owner's 15 providers (same order as
  // the Quick tab). The old 50-kind catalog was DELETED per the owner.
  // openai-compatible covers the Custom URL / Z.ai GLM / AI/ML / DeepInfra
  // picks; 'zai' is the built-in no-key card's kind; 'openrouter' and
  // 'together' are the kinds those quick picks actually save with. ──
""" + '\n'.join(entries[v] for v in KEEP) + '\n]\n'

src = src[:m.start()] + new_block + src[m.end():]
open(P, 'w').write(src)

kept = re.findall(r"\{ value: '([^']+)'", new_block)
print('PROVIDER_KINDS now:', len(kept), '→', kept)
assert kept == KEEP
print('OK')
