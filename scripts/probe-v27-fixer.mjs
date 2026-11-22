// Probe: what does the model ACTUALLY return for the QA Fixer prompt shape?
import ZAI from 'z-ai-web-dev-sdk'

const context = [
  `----- broken.js -----\nfunction go( {\n  return 1\n}`,
  `----- config.json -----\n{ "name": "x",, }`,
  `----- index.html -----\n<!DOCTYPE html>\n<html>\n<head><title>Broken</title></head>\n<body>\n  <img src="missing-logo.png" alt="logo">\n  <!-- TODO: finish checkout -->\n</body>\n</html>`,
].join('\n\n')

const prompt =
  `You are the QA Fixer. The QA squad found these issues in the app:\n` +
  `1. [broken.js] Syntax error (node --check): ...\n` +
  `2. [config.json] Invalid JSON: ...\n` +
  `3. [index.html] references missing file "missing-logo.png"\n` +
  `\nFix them by rewriting the affected files. Rules: keep every existing feature working, do not delete features, keep the same UI design.\n` +
  `Reply ONLY with patches in EXACTLY this format, repeated per file (max 5 files, only paths from the context, each file COMPLETE):\n` +
  `###FILE: <exact path>\n\`\`\`<lang>\n<complete new file content>\n\`\`\`\n###ENDFILE\n` +
  `If nothing should change reply exactly NO_PATCHES.\n\n${context}`

const zai = await ZAI.create()
const res = await zai.chat.completions.create({ model: 'glm-4.6', temperature: 0.2, messages: [{ role: 'user', content: prompt }] })
const raw = res?.choices?.[0]?.message?.content || ''
console.log('===== RAW MODEL OUTPUT =====')
console.log(raw)
console.log('===== END =====')
