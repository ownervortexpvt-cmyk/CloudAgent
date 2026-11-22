/** Raw-shape probe for /rt config + /auth/me envelopes. */
const BASE = 'http://127.0.0.1:3200';
async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  const t = await res.text();
  let j = null; try { j = JSON.parse(t); } catch { j = { raw: t.slice(0, 300) }; }
  return { status: res.status, json: j, headers: res.headers };
}
(async () => {
  const login = await api('/api/v1/auth/login', { method: 'POST', body: { email: 'admin@vortex.local', password: 'Vortex@2026' } });
  const otp = await api('/api/v1/auth/otp', { method: 'POST', body: { email: 'admin@vortex.local', code: login.json.data.devCode } });
  const cookie = (otp.headers.get('set-cookie') || '').match(/vortex_session=[^;]+/)?.[0] || '';
  const prov = await api('/api/v1/vaas', { method: 'POST', headers: { Cookie: cookie }, body: { op: 'nexa_provision', appName: 'ShapeProbe', collections: [{ name: 'todos', read: 'public', write: 'public' }] } });
  const d = prov.json.data || prov.json;
  const adminKey = d.adminKey || d.keys?.admin || '';
  const H = { 'x-vx-key': adminKey };
  const su = await api('/api/vaas/v1/auth/signup', { method: 'POST', headers: H, body: { email: `probe.${Date.now()}@vortex.test`, password: 'Probe@2026x' } });
  const token = su.json?.idToken || su.json?.data?.idToken || '';
  console.log('token:', token.slice(0, 10) + '…');
  const rt = await api('/api/vaas/v1/rt', { headers: H });
  console.log('GET /rt status=', rt.status, 'body=', JSON.stringify(rt.json).slice(0, 260));
  const me1 = await api('/api/vaas/v1/auth/me', { headers: { ...H, Authorization: `Bearer ${token}` } });
  console.log('me(key+bearer) status=', me1.status, 'body=', JSON.stringify(me1.json).slice(0, 200));
  const me2 = await api('/api/vaas/v1/auth/me', { headers: { Authorization: `Bearer ${token}` } });
  console.log('me(bearer-only) status=', me2.status, 'body=', JSON.stringify(me2.json).slice(0, 200));
})().catch(e => console.error('ERR', e.message));
