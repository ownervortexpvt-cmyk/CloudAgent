// v166 sanity: glm-5.3 model name + thinking passthrough + lane recursion guard
import ZAI from 'z-ai-web-dev-sdk'

async function main() {
  const zai = await ZAI.create()
  const t0 = Date.now()
  const res = await zai.chat.completions.create({
    messages: [{ role: 'user', content: 'Reply with exactly: LANE-OK-5.3' }],
    model: 'glm-5.3',
    temperature: 0.7,
    thinking: { type: 'enabled' },
  } as any)
  const content = (res as any)?.choices?.[0]?.message?.content || ''
  console.log('model=glm-5.3 thinking=enabled ->', JSON.stringify(content.slice(0, 60)), `(${Date.now() - t0}ms)`)
}
main().catch((e) => { console.error('FAIL:', e?.message || e); process.exit(1) })
