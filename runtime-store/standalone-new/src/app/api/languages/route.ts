import { NextResponse } from 'next/server'
import { LANGUAGES } from '@/lib/languages'

/** Public list of the builder languages (for the New Project dialog + docs). */
export async function GET() {
  return NextResponse.json({
    languages: LANGUAGES.map(l => ({
      id: l.id,
      label: l.label,
      icon: l.icon,
      tagline: l.tagline,
      runs: l.runs,
      publish: l.publish,
      scaffold: l.templateId ? `template:${l.templateId}` : `inline:${l.files?.length || 0} files`,
    })),
  })
}
