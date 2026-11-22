/**
 * v129 — AI-assisted UPI payment verification.
 *
 * Combines deterministic ledger signals (UTR shape, duplicate detection,
 * amount-vs-plan match, submission velocity, account age) with a best-effort
 * AI vision pass over the user's payment screenshot. Always returns a verdict
 * — the AI is a decision SUPPORT for the admin, never an auto-approver.
 */
import { db } from '@/lib/db'
import { getPlan } from '@/lib/plans'
import { UPI_ID } from '@/lib/upi'

export type UpiAiVerdict = {
  score: number
  verdict: 'likely-valid' | 'needs-review' | 'likely-fraud'
  reasons: string[]
}

export async function verifyUpiSubmission(opts: {
  utr: string
  amountINR: number
  planId: string
  userId: string
  userCreatedAt?: Date | null
  screenshot?: string | null
  excludePaymentId?: string
}): Promise<UpiAiVerdict> {
  const reasons: string[] = []
  let score = 55

  // 1) UTR shape — real UPI reference ids are 12-char alphanumeric
  if (/^[a-zA-Z0-9]{12}$/.test(opts.utr)) {
    score += 12
    reasons.push('UTR format matches a genuine 12-char UPI reference')
  } else {
    score -= 25
    reasons.push('UTR format is unusual for UPI (expected 12 letters/digits)')
  }

  // 2) duplicate UTR anywhere in the ledger
  const dup = await db.payment.findFirst({
    where: {
      utr: opts.utr,
      status: { in: ['created', 'paid'] },
      ...(opts.excludePaymentId ? { id: { not: opts.excludePaymentId } } : {}),
    },
    select: { id: true, userId: true },
  })
  if (dup) {
    score -= 55
    reasons.push(
      dup.userId === opts.userId
        ? 'This UTR was already submitted by this account'
        : 'This UTR was already submitted by ANOTHER account — likely reuse/forgery'
    )
  } else {
    score += 8
    reasons.push('UTR not seen before in the payment ledger')
  }

  // 3) plan price sanity
  const plan = getPlan(opts.planId)
  if (plan && plan.priceINR > 0 && plan.priceINR === opts.amountINR) {
    score += 10
    reasons.push(`Amount ₹${opts.amountINR} matches the ${plan.name} price`)
  } else {
    score -= 20
    reasons.push('Amount does not match the selected plan price')
  }

  // 4) submission velocity in the last 24h
  const since = new Date(Date.now() - 24 * 3600 * 1000)
  const recent = await db.payment.count({
    where: { userId: opts.userId, method: 'upi_direct', createdAt: { gte: since } },
  })
  if (recent >= 3) {
    score -= 25
    reasons.push(`${recent} submissions in 24h from this account — unusually high`)
  } else {
    score += 5
    reasons.push('Submission rate looks normal')
  }

  // 5) account age
  if (opts.userCreatedAt) {
    const ageH = (Date.now() - new Date(opts.userCreatedAt).getTime()) / 3600000
    if (ageH < 1) {
      score -= 15
      reasons.push('Brand-new account (under 1 hour old)')
    } else {
      score += 5
      reasons.push(`Account age ${ageH < 48 ? `${Math.round(ageH)}h` : `${Math.round(ageH / 24)}d`} — okay`)
    }
  }

  // 6) AI vision pass over the screenshot (best-effort, never fatal)
  if (opts.screenshot) {
    try {
      const mod: any = await import('z-ai-web-dev-sdk')
      const ZAI = mod?.default || mod
      const prompt =
        `This is a screenshot of a UPI payment. The user claims: plan "${plan?.name || opts.planId}", ` +
        `amount ₹${opts.amountINR}, UTR ${opts.utr}, paid to UPI id ${UPI_ID}. ` +
        `Read the screenshot and answer with STRICT JSON only: ` +
        `{"amountSeen": number|null, "utrSeen": string|null, "paidToSeen": string|null, "status": "success"|"pending"|"failed"|"unknown"}`
      const res = await ZAI.chat.completions.create({
        model: 'glm-4.6',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: opts.screenshot } },
            ],
          },
        ],
      } as any)
      const raw = String(res?.choices?.[0]?.message?.content || '')
      const jsonText = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)
      const v = JSON.parse(jsonText)
      if (typeof v.amountSeen === 'number' && v.amountSeen === opts.amountINR) {
        score += 15
        reasons.push(`AI read the screenshot amount ₹${v.amountSeen} — matches`)
      } else if (typeof v.amountSeen === 'number') {
        score -= 30
        reasons.push(`AI read the screenshot amount ₹${v.amountSeen} — does NOT match the claimed ₹${opts.amountINR}`)
      } else {
        reasons.push('AI could not read an amount on the screenshot')
      }
      if (v.utrSeen && String(v.utrSeen).toUpperCase() === opts.utr.toUpperCase()) {
        score += 15
        reasons.push('AI read the screenshot UTR — matches the submitted one')
      } else if (v.utrSeen) {
        score -= 25
        reasons.push(`AI read a different UTR on the screenshot (${String(v.utrSeen).slice(0, 4)}…)`)
      }
      if (v.status === 'success') {
        score += 10
        reasons.push('Screenshot shows a successful payment')
      } else if (v.status === 'failed' || v.status === 'pending') {
        score -= 30
        reasons.push(`Screenshot shows payment status: ${v.status}`)
      }
      if (typeof v.paidToSeen === 'string' && v.paidToSeen.toLowerCase().includes(UPI_ID.split('@')[0])) {
        score += 8
        reasons.push('Screenshot payee matches the owner UPI id')
      }
    } catch {
      reasons.push('AI could not analyse the screenshot — use manual eyes')
      score -= 5
    }
  } else {
    reasons.push('No screenshot attached — ledger signals only')
  }

  score = Math.max(0, Math.min(100, Math.round(score)))
  const verdict: UpiAiVerdict['verdict'] =
    score >= 75 ? 'likely-valid' : score >= 40 ? 'needs-review' : 'likely-fraud'
  return { score, verdict, reasons }
}
