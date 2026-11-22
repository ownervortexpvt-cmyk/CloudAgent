// Phase 7 end-to-end API verification: login (2-step OTP) -> billing -> portal -> overview
const BASE = "http://localhost:3000";
const EMAIL = "admin@vortex.local";
const PASSWORD = "Vortex@2026";

function getCookie(res, name) {
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of set) {
    const [pair] = c.split(";");
    const eq = pair.indexOf("=");
    if (pair.slice(0, eq).trim() === name) return pair.slice(eq + 1);
  }
  return null;
}

(async () => {
  // Step 1: password
  let res = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const login = await res.json();
  if (!login.ok) throw new Error("login failed: " + JSON.stringify(login));
  console.log("STEP1 password:", login.data.otpRequired ? "otp required" : "unexpected");
  const devCode = login.data.devCode;
  if (!devCode) throw new Error("no devCode returned (dev OTP off?)");

  // Step 2: OTP -> session cookie
  res = await fetch(`${BASE}/api/v1/auth/otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, code: devCode }),
  });
  const otpRes = await res.json();
  if (!otpRes.ok) throw new Error("otp failed: " + JSON.stringify(otpRes));
  const session = getCookie(res, "vortex_session");
  if (!session) throw new Error("no session cookie set");
  console.log("STEP2 otp: session established");

  const H = { Cookie: `vortex_session=${session}` };

  // Step 3: billing state
  res = await fetch(`${BASE}/api/v1/billing`, { headers: H });
  const billing = await res.json();
  if (!billing.ok) throw new Error("billing failed: " + JSON.stringify(billing));
  const b = billing.data;
  console.log("BILLING:", JSON.stringify({
    mode: b.mode, period: b.period, plans: b.plans.length, plansLocked: b.plans.filter(p => p.locked).length,
    subs: b.subscriptions.length, invoices: b.invoices.length,
    showbackThisMonthBdt: b.stats.showbackMonthBdt, subsActive: b.stats.subsActive,
    overBudget: b.stats.overBudget, usageRecords: b.stats.usageRecords,
  }));

  // Step 4: portal state
  res = await fetch(`${BASE}/api/v1/portal`, { headers: H });
  const portal = await res.json();
  if (!portal.ok) throw new Error("portal failed: " + JSON.stringify(portal));
  const p = portal.data;
  console.log("PORTAL:", JSON.stringify({
    docs: p.docs.length, endpoints: (p.endpoints || p.reference || []).length,
    gate: p.gate || p.mode,
  }));

  // Step 5: overview now carries Phase 7 stats
  res = await fetch(`${BASE}/api/v1/overview`, { headers: H });
  const ov = await res.json();
  if (!ov.ok) throw new Error("overview failed: " + JSON.stringify(ov));
  const s = ov.data.stats;
  console.log("OVERVIEW P7:", JSON.stringify({
    version: ov.data.version,
    billingShowbackMonthBdt: s.billingShowbackMonthBdt,
    billingInvoices: s.billingInvoices, billingSubsActive: s.billingSubsActive,
    billingOverBudget: s.billingOverBudget, firebaseMode: s.firebaseMode,
    phase7: ov.data.phases.find(x => x.phase === 7),
  }));

  console.log("ALL PHASE 7 ENDPOINTS OK");
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
