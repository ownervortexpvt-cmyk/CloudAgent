/**
 * v129 — UPI-DIRECT payments (owner request: "email system shoriye din,
 * admin panel e AI add koro user der payment verify korar jonno, amar UPI id ...").
 *
 * Users pay the owner's UPI ID directly (QR / deep link), submit the UTR +
 * optional screenshot on the pricing page, and the admin control-room gets an
 * AI-assisted verification queue. Approving activates the plan through the
 * SAME activatePurchase() path Razorpay uses — one source of truth.
 */

export const UPI_ID = '9101951141@axl'
export const UPI_PAYEE = 'CloudAgent'

/** Maximum screenshot size we accept (base64 chars ≈ bytes * 4/3). */
export const UPI_SCREENSHOT_MAX_CHARS = 1_600_000 // ≈ 1.2 MB binary

/** Build a UPI deep link (works as QR payload AND as an <a href> on mobile). */
export function upiDeepLink(amountINR: number, note: string): string {
  const p = new URLSearchParams({
    pa: UPI_ID,
    pn: UPI_PAYEE,
    am: String(amountINR),
    cu: 'INR',
    tn: note.slice(0, 40),
  })
  return `upi://pay?${p.toString()}`
}

/** UTRs on real UPI rails are 12-char alphanumeric reference numbers. */
export function looksLikeUtr(utr: string): boolean {
  return /^[a-zA-Z0-9]{12}$/.test(utr)
}

/** Synthetic order id for UPI-direct rows (razorpayOrderId column is @unique). */
export function upiOrderId(): string {
  return `upi-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
