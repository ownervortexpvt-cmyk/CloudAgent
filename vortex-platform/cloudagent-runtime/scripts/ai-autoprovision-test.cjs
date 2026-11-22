#!/usr/bin/env node
/**
 * AI AUTO-PROVISION test: chat "build me an app with login" → the agent should
 * call vortex_backend_provision → vortex.config.js + VORTEX_BACKEND.md land in
 * the project + provision stored in project settings. Uses the chat SSE API.
 */
const BASE = 'http://localhost:3000';

async function api(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(600_000),
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
  return { status: res.status, json, setCookie: res.headers.get('set-cookie') || '', text };
}

(async () => {
  const R = [];
  const step = (n, ok, d = '') => { R.push({ ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`); };

  const login = await api('/api/auth/login', { method: 'POST', body: { email: 'mdhonabali61@gmail.com', password: 'Owner123' } });
  const cookie = (login.setCookie.match(/ca_session=[^;]+/) || [''])[0];
  step('login', Boolean(cookie));

  // 1. create a fresh project
  const proj = await api('/api/projects', { method: 'POST', cookie, body: { name: `Vortex Auto Backend ${Date.now().toString(36)}`, description: 'AI auto-provision test' } });
  const projectId = proj.json?.project?.id || proj.json?.id || proj.json?.data?.id;
  step('project-create', Boolean(projectId), `id=${projectId || JSON.stringify(proj.json).slice(0, 120)}`);
  if (!projectId) process.exit(1);

  // 2. send the chat prompt that requires a backend
  const chat = await api('/api/agent', { method: 'POST', cookie, body: { projectId, prompt: 'Build me a tiny Recipe Box app — users sign in with email OTP and save their recipes.' } });
  const chatText = chat.text || '';
  const toolCalled = chatText.includes('vortex_backend_provision');
  step('chat-completed', chat.status === 200, `HTTP ${chat.status}, ${chatText.length}B response`);
  console.log('  tool call seen in stream:', toolCalled);

  // 3. verify provision artifacts on disk
  const cfg = await api(`/api/files?projectId=${projectId}&path=vortex.config.js`, { cookie });
  step('vortex-config-written', cfg.status === 200 && String(cfg.json?.content || '').includes('VORTEX_CONFIG'), `HTTP ${cfg.status}`);

  const guide = await api(`/api/files?projectId=${projectId}&path=VORTEX_BACKEND.md`, { cookie });
  step('vortex-guide-written', guide.status === 200, `HTTP ${guide.status}`);

  // 4. verify provision stored in project settings
  const st = await api(`/api/projects/${projectId}/vaas`, { cookie });
  step('vaas-provision-stored', st.json?.provisioned === true && Boolean(st.json?.vaasProjectId), `vaasProjectId=${st.json?.vaasProjectId || '-'} collections=${JSON.stringify(st.json?.collections || [])}`);

  const fails = R.filter(r => !r.ok).length;
  console.log(`\nRESULT: ${R.length - fails}/${R.length} passed ${fails ? '' : 'ALL GREEN'}`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
