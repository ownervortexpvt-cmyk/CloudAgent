import { NextResponse } from "next/server";
import { ensureSeeded } from "@/lib/vortex/seed";
import { db } from "@/lib/db";
import { vsGetObject, type VsActor } from "@/lib/vortex/vserver";

/**
 * Public site serving — GET /sites/:subdomain/:path*
 *
 * Serves the ACTIVE version of a deployed VORTEX WEBSITE site straight from
 * the vortex-websites bucket. This is the missing half of the publish
 * pipeline: without it, deploys land in storage but nothing serves them
 * (v141 gap found during the ecosystem integration).
 *
 * URL contract:
 *   /sites/<subdomain>/                    → index.html
 *   /sites/<subdomain>/<file>              → that file
 *   /sites/<subdomain>/<dir>/              → <dir>/index.html
 * The subdomain is the stored `subdomain` field minus the ".vortex.site"
 * suffix (e.g. "rakib-portfolio.2qw0" for rakib-portfolio.2qw0.vortex.site).
 * Custom domains resolve through the same lookup when DNS is wired in prod.
 */
export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "application/javascript; charset=utf-8",
  mjs: "application/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  md: "text/plain; charset=utf-8",
  xml: "application/xml",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  pdf: "application/pdf",
  wasm: "application/wasm",
};

function contentTypeOf(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  return MIME[ext] || "application/octet-stream";
}

export async function GET(req: Request, ctx: { params: Promise<{ slug?: string[] }> }) {
  await ensureSeeded();
  const { slug } = await ctx.params;
  const subdomain = slug?.[0];
  const path = slug?.slice(1) || [];
  if (!subdomain) return new NextResponse("Site not found", { status: 404 });

  const sub = decodeURIComponent(subdomain).toLowerCase().replace(/\.vortex\.site$/, "");
  const s = await db.websiteProject.findFirst({
    where: {
      OR: [
        { subdomain: sub },
        { subdomain: `${sub}.vortex.site` },
        // slug without the random suffix: "vortex-hub" matches "vortex-hub.jmjx"
        { subdomain: { startsWith: `${sub}.` } },
        { customDomain: `${sub}.vortex.site` },
      ],
    },
    orderBy: { createdAt: "asc" },
  });
  if (!s || s.status !== "DEPLOYED" || s.activeVersion < 1) {
    return new NextResponse("Site not found or not deployed yet", { status: 404 });
  }

  const rel = (path || []).map((p) => decodeURIComponent(p)).join("/");
  // path safety: no traversal, no absolute escapes
  if (rel.includes("..") || rel.startsWith("/")) return new NextResponse("Bad path", { status: 400 });

  const actor: VsActor = { platform: "vortex-website", subject: `public:${s.siteId}`, via: "public-site-server" };

  const candidates = rel
    ? [rel, `${rel}/index.html`, `${rel}.html`]
    : ["index.html"];
  for (const candidate of candidates) {
    const obj = await vsGetObject(s.bucket, `${s.prefix}/v${s.activeVersion}/${candidate}`, actor);
    if (obj instanceof Buffer) {
      return new NextResponse(new Uint8Array(obj), {
        status: 200,
        headers: {
          "Content-Type": contentTypeOf(candidate),
          "Cache-Control": "public, max-age=60",
          "X-Vx-Site": s.siteId,
          "X-Vx-Version": String(s.activeVersion),
        },
      });
    }
  }
  return new NextResponse("File not found", { status: 404 });
}
