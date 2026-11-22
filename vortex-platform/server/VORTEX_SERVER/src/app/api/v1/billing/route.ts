import { ok, fail, requireSession } from "@/lib/vortex/api";
import { ensureSeeded } from "@/lib/vortex/seed";
import {
  billingState,
  subscribe,
  changePlan,
  setBudget,
  generateInvoice,
  issueInvoice,
  invoiceAction,
} from "@/lib/vortex/billing";

/**
 * BILLING MODULE (Phase 7) — showback for the owner's own apps.
 * GET  — plans, subscriptions, live metering, invoices, projections, stats.
 * POST — { op: "subscribe" | "change_plan" | "set_budget" |
 *          "generate_invoice" | "issue_invoice" | "invoice_action" }
 *
 * VORTEX stays PRIVATE: external plans refuse to activate while
 * future.firebase_mode = LOCKED, and every invoice is mode=SHOWBACK.
 */
export async function GET(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  return ok(await billingState());
}

export async function POST(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  let body: {
    op?: string;
    appId?: string;
    planId?: string;
    subId?: string;
    invoiceId?: string;
    period?: string;
    budgetMonthlyBdt?: number | null;
    action?: "paid" | "void";
  };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body");
  }

  switch (body.op) {
    case "subscribe": {
      if (!body.appId || !body.planId) return fail("appId and planId are required");
      const res = await subscribe({
        appId: body.appId,
        planId: body.planId,
        budgetMonthlyBdt: body.budgetMonthlyBdt ?? null,
        actor: user.email,
      });
      if ("error" in res) return fail(res.error);
      return ok(res);
    }
    case "change_plan": {
      if (!body.subId || !body.planId) return fail("subId and planId are required");
      const res = await changePlan({ subId: body.subId, planId: body.planId, actor: user.email });
      if ("error" in res) return fail(res.error);
      return ok(res);
    }
    case "set_budget": {
      if (!body.subId) return fail("subId is required");
      const res = await setBudget({
        subId: body.subId,
        budgetMonthlyBdt: body.budgetMonthlyBdt ?? null,
        actor: user.email,
      });
      if ("error" in res) return fail(res.error);
      return ok(res);
    }
    case "generate_invoice": {
      if (!body.appId || !body.period) return fail("appId and period (e.g. 2026-11) are required");
      const res = await generateInvoice({ appId: body.appId, period: body.period, actor: user.email });
      if ("error" in res) return fail(res.error);
      return ok(res);
    }
    case "issue_invoice": {
      if (!body.invoiceId) return fail("invoiceId is required");
      const res = await issueInvoice({ invoiceId: body.invoiceId, actor: user.email });
      if ("error" in res) return fail(res.error);
      return ok(res);
    }
    case "invoice_action": {
      if (!body.invoiceId || !body.action) return fail("invoiceId and action (paid | void) are required");
      const res = await invoiceAction({ invoiceId: body.invoiceId, action: body.action, actor: user.email });
      if ("error" in res) return fail(res.error);
      return ok(res);
    }
    default:
      return fail(`Unknown op "${body.op}" — use subscribe | change_plan | set_budget | generate_invoice | issue_invoice | invoice_action`);
  }
}
