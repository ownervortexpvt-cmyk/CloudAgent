import { redirect } from 'next/navigation'

/** /register → the combined auth screen with the Create-account tab open.
 *  v110: query params (plan, kind, next) survive the redirect so the pricing
 *  flow lands the fresh account back on the right checkout. */
export default async function RegisterPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === 'string' && v) qs.set(k, v)
  }
  const extra = qs.toString()
  redirect('/login?mode=signup' + (extra ? `&${extra}` : ''))
}
