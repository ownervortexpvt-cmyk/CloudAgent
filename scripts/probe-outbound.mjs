// Task 31 diagnosis: can the sandbox reach external AI providers at all?
const targets = [
  ['gemini-models', 'https://generativelanguage.googleapis.com/v1beta/models?key=test'],
  ['modelscope-models', 'https://api-inference.modelscope.cn/v1/models'],
  ['vercel-gw-models', 'https://ai-gateway.vercel.sh/v1/models'],
  ['deepseek-models', 'https://api.deepseek.com/models'],
  ['openai-models', 'https://api.openai.com/v1/models'],
  ['zai-registry', 'https://api.z.ai/api/paas/v4/models'],
]
for (const [name, url] of targets) {
  const t = Date.now()
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) })
    const text = await res.text()
    console.log(`${name}: HTTP ${res.status} in ${Date.now() - t}ms — ${text.slice(0, 120).replace(/\n/g, ' ')}`)
  } catch (e) {
    console.log(`${name}: FAIL in ${Date.now() - t}ms — ${e?.name || 'Error'}: ${e?.message?.slice(0, 140)}`)
  }
}
