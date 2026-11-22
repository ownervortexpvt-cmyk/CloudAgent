#!/usr/bin/env python3
"""Repair key-detect.ts: collapse duplicated inserted blocks, apply filter + sort edits."""
import re

PATH = '/home/z/my-project/src/lib/ai/key-detect.ts'
src = open(PATH).read()

# 1) Remove ALL copies of the accidentally triple-inserted block
block_start = '/**\n * Non-chat model families'
block_end = "export function sortModelsDefaultFirst<T extends { id: string }>(models: T[]): T[] {\n  return [...models].sort((a, b) => scoreModelDefault(b.id) - scoreModelDefault(a.id))\n}\n"
pattern = re.compile(re.escape(block_start) + r'.*?' + re.escape(block_end), re.DOTALL)
src, n = pattern.subn('', src)
print(f'removed {n} duplicated blocks')

# 2) Insert ONE clean canonical block before ProbeResult interface
canonical = '''/**
 * Non-chat model families that must NEVER be the default pick (and sink to the
 * bottom of the list): video (veo), image (imagen), live/realtime streams,
 * robotics, translation, streaming-only previews, embeddings, audio…
 */
const NON_CHAT_MODEL_RE = /embed|whisper|tts|audio|image|video|veo|imagen|moderation|dall-|babbage|ada|curie|transcribe|text-embedding|realtime|rerank|robotics|translat|live-|-live|streaming|aqa|computer-use|nano-banana|guard|shield/

/**
 * Score a model id for DEFAULT selection — higher = better default for agent
 * work. The BEST model floats to the top of the Quick Setup list and is
 * auto-selected after Get, so the user never lands on a veo/live/preview junk
 * model again.
 */
export function scoreModelDefault(id: string): number {
  const s = (id || '').toLowerCase()
  let score = 50
  // fast + cheap models are ideal for swarm agents
  if (/flash|mini|instant|haiku|small|turbo|lite|fast|-8b\\b/.test(s)) score += 22
  if (/70b|72b|405b|\\bpro\\b|max|large|plus/.test(s)) score += 10
  if (/latest/.test(s)) score += 6
  if (/:free$|\\bfree\\b/.test(s)) score += 14
  if (/preview|exp\\b|alpha|experimental/.test(s)) score -= 38
  const knownHits: Array<[RegExp, number]> = [
    [/^gemini-2\\.\\d-flash/, 45], [/gemini.*flash/, 40],
    [/^gemini-2\\.\\d-pro/, 30], [/gemini.*pro/, 22],
    [/^llama-3\\.3-70b/, 42], [/^llama-3\\.1-8b-instant/, 38], [/llama/, 18],
    [/^gpt-4o-mini/, 45], [/^gpt-4o/, 36], [/^gpt-4\\.1/, 32], [/^o[34]-mini/, 25],
    [/claude-(sonnet|3\\.5-sonnet|3-5-sonnet|3-7)/, 42], [/claude-(haiku|3-5-haiku|3\\.5-haiku)/, 38], [/claude-opus/, 28],
    [/^deepseek-chat|^deepseek-v3|^deepseek-reasoner/, 44], [/deepseek-r\\d/, 30],
    [/:free$/, 28], [/^meta-llama\\/llama-3\\.3-70b/, 40],
    [/^qwen.*\\d+b/, 24], [/^grok/, 26], [/^command-r/, 24], [/^glm-4/, 30],
    [/^mistral-(large|small|codestral)/, 28], [/^kimi-|^moonshot/, 26],
  ]
  for (const [re, bonus] of knownHits) { if (re.test(s)) { score += bonus; break } }
  // junk that slipped through the filter sinks hard
  if (NON_CHAT_MODEL_RE.test(s)) score -= 100
  return score
}

/** Sort models BEST-DEFAULT-FIRST for the Quick Setup list + auto-select. */
export function sortModelsDefaultFirst<T extends { id: string }>(models: T[]): T[] {
  return [...models].sort((a, b) => scoreModelDefault(b.id) - scoreModelDefault(a.id))
}

'''
anchor = 'export interface ProbeResult {'
assert src.count(anchor) == 1, f'anchor count = {src.count(anchor)}'
src = src.replace(anchor, canonical + anchor)

# 3) probeModels: use NON_CHAT_MODEL_RE
old_filter = "        if (/embed|whisper|tts|audio|image|moderation|dall-|babbage|ada|curie|transcribe|text-embedding|realtime|rerank/.test(id)) return false"
new_filter = "        if (NON_CHAT_MODEL_RE.test(id)) return false"
if old_filter in src:
    src = src.replace(old_filter, new_filter)
    print('probeModels filter updated')
else:
    print('WARN: probeModels old filter not found:', src.count('embed|whisper'))

# 4) detectKey winner: sort models best-default-first
old_models = "      endpoint: endpointOf(winner.def),\n      models: winner.models,"
new_models = "      endpoint: endpointOf(winner.def),\n      models: sortModelsDefaultFirst(winner.models),"
if old_models in src:
    src = src.replace(old_models, new_models)
    print('detectKey winner models sorted')
else:
    print('WARN: winner models line not found')

open(PATH, 'w').write(src)
print('saved. NON_CHAT_MODEL_RE count:', src.count('const NON_CHAT_MODEL_RE'))
print('scoreModelDefault count:', src.count('export function scoreModelDefault'))
