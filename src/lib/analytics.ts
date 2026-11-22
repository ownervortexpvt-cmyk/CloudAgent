/**
 * Analytics for published sites.
 *
 * At PUBLISH time every root HTML file gets a tiny beacon script injected
 * before </body>. The beacon fires one POST per page view to
 * /api/analytics/hit with the projectId. When a visitor opens the site
 * through the platform gateway the request is same-origin with the builder,
 * so the beacon lands on the Next.js API directly. On direct-port local
 * access the beacon fails silently (caught) — honest behavior, no noise.
 */
import fs from 'fs'
import path from 'path'
import { projectRoot } from '@/lib/storage'

export function buildBeacon(projectId: string): string {
  return `\n<script>(function(){function s(){try{var d={p:${JSON.stringify(projectId)},path:location.pathname,r:document.referrer||'',t:Date.now()};var b=new Blob([JSON.stringify(d)],{type:'application/json'});if(navigator.sendBeacon)navigator.sendBeacon('/api/analytics/hit',b);else fetch('/api/analytics/hit',{method:'POST',body:b,keepalive:true});}catch(e){}}if(document.readyState==='complete')s();else addEventListener('load',s);})();</script>`
}

const BEACON_MARK = 'data-ca-analytics="1"'

/** Inject the beacon into a single HTML string (idempotent). */
export function injectBeacon(html: string, projectId: string): string {
  if (html.includes(BEACON_MARK)) return html
  const tag = `<script ${BEACON_MARK}>` + buildBeacon(projectId).replace(/^<script>|<\/script>$/g, '')
  if (html.includes('</body>')) return html.replace(/<\/body>/i, `${tag}</body>`)
  return html + tag
}

/** Inject the beacon into every root-level HTML file of the project. */
export function injectAnalyticsAll(projectId: string): { injected: string[] } {
  const root = projectRoot(projectId)
  const injected: string[] = []
  const candidates = ['index.html', 'src/index.html', 'public/index.html', 'build/web/index.html', 'dist/index.html']
  for (const rel of candidates) {
    const p = path.join(root, rel)
    if (fs.existsSync(p)) {
      const html = fs.readFileSync(p, 'utf8')
      const out = injectBeacon(html, projectId)
      if (out !== html) {
        fs.writeFileSync(p, out)
        injected.push(rel)
      }
    }
  }
  return { injected }
}
