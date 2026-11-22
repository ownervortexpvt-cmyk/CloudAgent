// Test 1: does the built-in Z.ai SDK serve glm-4.5-flash (free flash model)?
// Test 2: which GLM / GPT-OSS model names does it accept?
async function main() {
  const ZAI = (await import('z-ai-web-dev-sdk')).default || (await import('z-ai-web-dev-sdk'))
  const zai = await ZAI.create()
  for (const model of ['glm-4.5-flash', 'glm-4.6', 'glm-4-flash']) {
    try {
      const t0 = Date.now()
      const res = await zai.chat.completions.create({
        messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
        model,
      })
      const txt = res?.choices?.[0]?.delta?.content || res?.choices?.[0]?.message?.content || ''
      console.log(`MODEL ${model} → OK (${Date.now() - t0}ms): "${String(txt).slice(0, 60).trim()}"`)
    } catch (e) {
      console.log(`MODEL ${model} → FAIL: ${String(e?.message || e).slice(0, 160)}`)
    }
  }
}
main().catch(e => { console.error('fatal:', e.message); process.exit(1) })
