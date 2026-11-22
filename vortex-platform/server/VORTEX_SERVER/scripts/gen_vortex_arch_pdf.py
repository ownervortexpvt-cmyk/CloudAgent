#!/usr/bin/env python3
"""
VORTEX SERVER - Central Cloud Infrastructure Technical Architecture (English PDF).
Body: ReportLab (TocDocTemplate + multiBuild). Cover: HTML/Playwright merged later.
"""
import os, sys, hashlib
sys.path.insert(0, "/home/z/my-project/skills/pdf/scripts")
from pdf import install_font_fallback

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, PageBreak,
                                Table, TableStyle, KeepTogether, CondPageBreak)
from reportlab.platypus.tableofcontents import TableOfContents
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.pdfmetrics import registerFontFamily

FONT_DIR = "/usr/share/fonts"
pdfmetrics.registerFont(TTFont("NotoSerifSC", f"{FONT_DIR}/truetype/noto-serif-sc/NotoSerifSC-Regular.ttf"))
pdfmetrics.registerFont(TTFont("NotoSerifSC-Bold", f"{FONT_DIR}/truetype/noto-serif-sc/NotoSerifSC-Bold.ttf"))
pdfmetrics.registerFont(TTFont("FreeSerif", f"{FONT_DIR}/truetype/freefont/FreeSerif.ttf"))
pdfmetrics.registerFont(TTFont("FreeSerif-Bold", f"{FONT_DIR}/truetype/freefont/FreeSerifBold.ttf"))
pdfmetrics.registerFont(TTFont("FreeSerif-Italic", f"{FONT_DIR}/truetype/freefont/FreeSerifItalic.ttf"))
pdfmetrics.registerFont(TTFont("FreeSerif-BoldItalic", f"{FONT_DIR}/truetype/freefont/FreeSerifBoldItalic.ttf"))
pdfmetrics.registerFont(TTFont("DejaVuSans", f"{FONT_DIR}/truetype/dejavu/DejaVuSansMono.ttf"))
registerFontFamily("NotoSerifSC", normal="NotoSerifSC", bold="NotoSerifSC-Bold")
registerFontFamily("FreeSerif", normal="FreeSerif", bold="FreeSerif-Bold",
                   italic="FreeSerif-Italic", boldItalic="FreeSerif-BoldItalic")
install_font_fallback()

# ---- Cascade palette (auto-generated, seed 42) ----
PAGE_BG       = colors.HexColor('#f4f5f5')
SECTION_BG    = colors.HexColor('#f0f1f2')
CARD_BG       = colors.HexColor('#e8eaeb')
TABLE_STRIPE  = colors.HexColor('#ebeded')
HEADER_FILL   = colors.HexColor('#32454e')
COVER_BLOCK   = colors.HexColor('#566a74')
BORDER        = colors.HexColor('#acbdc5')
ICON          = colors.HexColor('#4b86a4')
ACCENT        = colors.HexColor('#1f6c92')
ACCENT_2      = colors.HexColor('#c23a50')
TEXT_PRIMARY  = colors.HexColor('#131515')
TEXT_MUTED    = colors.HexColor('#747b7e')
SEM_SUCCESS   = colors.HexColor('#529067')
SEM_WARNING   = colors.HexColor('#8c7443')

MARGIN = 1.0 * inch
PAGE_W, PAGE_H = A4
AVAIL_W = PAGE_W - 2 * MARGIN
OUT = "/home/z/my-project/download/VORTEX_SERVER_Architecture_body.pdf"

# ---- Styles ----
h1 = ParagraphStyle("H1", fontName="FreeSerif", fontSize=19, leading=25,
                    textColor=HEADER_FILL, spaceBefore=18, spaceAfter=10)
h2 = ParagraphStyle("H2", fontName="FreeSerif", fontSize=14, leading=20,
                    textColor=HEADER_FILL, spaceBefore=14, spaceAfter=6)
body = ParagraphStyle("Body", fontName="FreeSerif", fontSize=10.5, leading=16.5,
                      textColor=TEXT_PRIMARY, alignment=TA_JUSTIFY, spaceAfter=8)
bullet = ParagraphStyle("Bullet", fontName="FreeSerif", fontSize=10.5, leading=16,
                        textColor=TEXT_PRIMARY, leftIndent=16, spaceAfter=5)
cap = ParagraphStyle("Cap", fontName="FreeSerif-Italic", fontSize=8.5, leading=12,
                     textColor=TEXT_MUTED, alignment=TA_CENTER, spaceBefore=3, spaceAfter=6)
th = ParagraphStyle("TH", fontName="FreeSerif", fontSize=9.5, leading=12.5,
                    textColor=colors.white, alignment=TA_LEFT)
td = ParagraphStyle("TD", fontName="FreeSerif", fontSize=9, leading=12.5,
                    textColor=TEXT_PRIMARY, alignment=TA_LEFT)
tdc = ParagraphStyle("TDC", parent=td, alignment=TA_CENTER)
toc_h = ParagraphStyle("TOCTitle", fontName="FreeSerif", fontSize=17, leading=22,
                       textColor=HEADER_FILL, spaceAfter=12)
stat_style = ParagraphStyle("StatBig", fontName="FreeSerif", fontSize=20, leading=24,
                            textColor=ACCENT, alignment=TA_CENTER)
label_style = ParagraphStyle("StatLabel", fontName="FreeSerif", fontSize=8.5, leading=11,
                             textColor=TEXT_MUTED, alignment=TA_CENTER)

# ---- Helpers ----
def heading(text, style, level=0):
    key = "h_" + hashlib.md5(text.encode()).hexdigest()[:8]
    p = Paragraph(f'<a name="{key}"/><b>{text}</b>', style)
    p.bookmark_name = key
    p.bookmark_level = level
    p.bookmark_text = text
    p.bookmark_key = key
    return p

H1_ORPHAN = (PAGE_H - 2 * MARGIN) * 0.22

def major(text):
    return [CondPageBreak(H1_ORPHAN), heading(text, h1, 0)]

def para(t):
    return Paragraph(t, body)

def bullets(items):
    return [Paragraph(f'•  {i}', bullet) for i in items]

def make_table(headers, rows, ratios, caption=None, center_cols=()):
    widths = [r * AVAIL_W * 0.98 for r in ratios]
    data = [[Paragraph(f"<b>{h}</b>", th) for h in headers]]
    for row in rows:
        cells = []
        for ci, cell in enumerate(row):
            st = tdc if ci in center_cols else td
            cells.append(Paragraph(str(cell), st))
        data.append(cells)
    t = Table(data, colWidths=widths, hAlign="CENTER", repeatRows=1)
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), HEADER_FILL),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.5, BORDER),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]
    for ri in range(1, len(data)):
        style.append(("BACKGROUND", (0, ri), (-1, ri),
                      TABLE_STRIPE if ri % 2 == 1 else colors.white))
    t.setStyle(TableStyle(style))
    flow = [Spacer(1, 12), t]
    if caption:
        flow += [Spacer(1, 4), Paragraph(caption, cap)]
    flow.append(Spacer(1, 10))
    return flow

def callout_row(stats):
    """stats: list of (big, label). Renders evenly spaced callout boxes."""
    n = len(stats)
    w = (AVAIL_W - 12 * (n - 1)) / n
    boxes = []
    for big, label in stats:
        b = Table([[Paragraph(f"<b>{big}</b>", stat_style)],
                   [Paragraph(label, label_style)]], colWidths=[w - 8])
        b.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), SECTION_BG),
            ("BOX", (0, 0), (-1, -1), 1, ACCENT),
            ("TOPPADDING", (0, 0), (-1, 0), 8),
            ("BOTTOMPADDING", (0, 1), (-1, 1), 8),
            ("TOPPADDING", (0, 1), (-1, 1), 2),
            ("BOTTOMPADDING", (0, 0), (-1, 0), 2),
        ]))
        boxes.append(b)
    wrap = Table([boxes], colWidths=[w] * n, hAlign="CENTER")
    wrap.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    return [Spacer(1, 10), KeepTogether(wrap), Spacer(1, 12)]

def callout_note(text):
    t = Table([[Paragraph(text, ParagraphStyle("Note", parent=body, fontSize=9.5,
                                               leading=14.5, alignment=TA_LEFT,
                                               spaceAfter=0))]],
              colWidths=[AVAIL_W * 0.98])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), SECTION_BG),
        ("LINEBEFORE", (0, 0), (0, -1), 3, ACCENT),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    return [Spacer(1, 8), KeepTogether(t), Spacer(1, 10)]

# ---- Doc template with TOC ----
class TocDocTemplate(SimpleDocTemplate):
    def afterFlowable(self, flowable):
        if hasattr(flowable, "bookmark_name"):
            level = getattr(flowable, "bookmark_level", 0)
            text = getattr(flowable, "bookmark_text", "")
            key = getattr(flowable, "bookmark_key", "")
            self.notify("TOCEntry", (level, text, self.page, key))

def on_page(canvas, doc):
    canvas.saveState()
    canvas.setFont("FreeSerif", 7.5)
    canvas.setFillColor(TEXT_MUTED)
    canvas.drawString(MARGIN, PAGE_H - 0.55 * inch,
                      "VORTEX SERVER - Central Cloud Infrastructure Technical Architecture")
    canvas.setStrokeColor(ACCENT)
    canvas.setLineWidth(1.2)
    canvas.line(MARGIN, PAGE_H - 0.62 * inch, PAGE_W - MARGIN, PAGE_H - 0.62 * inch)
    canvas.setStrokeColor(BORDER)
    canvas.setLineWidth(0.4)
    canvas.line(MARGIN, 0.62 * inch, PAGE_W - MARGIN, 0.62 * inch)
    canvas.drawString(MARGIN, 0.45 * inch, "VORTEX - ONE CENTRAL INFRASTRUCTURE")
    canvas.drawRightString(PAGE_W - MARGIN, 0.45 * inch, f"Page {doc.page}")
    canvas.restoreState()

doc = TocDocTemplate(OUT, pagesize=A4, leftMargin=MARGIN, rightMargin=MARGIN,
                     topMargin=MARGIN, bottomMargin=MARGIN,
                     title="VORTEX SERVER - Central Cloud Infrastructure Technical Architecture",
                     author="Z.ai", creator="Z.ai",
                     subject="Technical architecture, database schema, API specification and infrastructure requirements")

story = []

# ---- TOC ----
story.append(Paragraph("<b>Table of Contents</b>", toc_h))
toc = TableOfContents()
toc.levelStyles = [
    ParagraphStyle("TOC0", fontName="FreeSerif", fontSize=11, leading=17, leftIndent=6),
    ParagraphStyle("TOC1", fontName="FreeSerif", fontSize=9.5, leading=14, leftIndent=24,
                   textColor=TEXT_MUTED),
]
story.append(toc)
story.append(PageBreak())

# ================= Chapter 1 =================
story += major("1. Executive Summary and Ecosystem Model")
story.append(para(
    "VORTEX SERVER is the single central infrastructure that powers the entire VORTEX ecosystem. "
    "It is not a demo and not a file-upload site: it is a production-grade control plane that "
    "provides compute, storage, database, identity, API management, deployment and monitoring "
    "services to every other product the company operates. The governing tagline is ONE CENTRAL "
    "INFRASTRUCTURE: five platforms, one backend, one database layer, one storage layer, one "
    "security perimeter. This document is the technical architecture, database schema, API "
    "specification and infrastructure requirements for that system, and it is written from the "
    "results of a live infrastructure audit rather than from wishful design."
))
story.append(para(
    "The ecosystem is organised as five platforms. Each platform is a first-class tenant of "
    "VORTEX SERVER with its own API namespace, its own storage buckets, its own API credentials "
    "and its own user-facing surface. Platforms cooperate only through documented, authenticated "
    "APIs - never through shared database writes or shared file paths. This gives the independence "
    "the ecosystem needs while keeping one operational brain in the middle."
))
story += make_table(
    ["Platform", "Platform ID", "Role", "API Namespace", "Primary Buckets"],
    [
        ["VORTEX SERVER", "vortex-server", "Central infrastructure and admin control plane",
         "/api/v1/admin", "database-backups, infrastructure-backups, user-uploads"],
        ["CLOUD AGENT", "cloud-agent", "AI app builder - projects, builds, source code",
         "/api/v1/cloud-agent", "cloud-agent-projects, developer-source-code, nexa-ai-data"],
        ["VORTEX WEBSITE", "vortex-website", "Website creation, hosting, domains and SSL",
         "/api/v1/vortex-website", "vortex-websites"],
        ["APPVERSE", "appverse", "App publishing - APK/AAB, review, downloads",
         "/api/v1/appverse", "appverse-apk, appverse-aab"],
        ["VI (VORTEX INTELLIGENT)", "vi", "Central AI agent - assistance, monitoring, coordination",
         "/api/v1/vi", "nexseva-documents"],
    ],
    [0.20, 0.15, 0.27, 0.18, 0.20],
    caption="Table 1-1: Platform registry - five tenants of one infrastructure",
)
story.append(para(
    "Isolation is enforced at three keys that appear in every database row and every object key: "
    "platform_id, user_id and project_id. No platform can read another platform's buckets, and no "
    "user can read another user's objects without an explicitly issued permission. The platform "
    "registry, its keys and the namespace APIs are implemented in this build so that the isolation "
    "rules are enforced by code, not by convention."
))
story += callout_row([
    ("5", "PLATFORMS, ONE SERVER"),
    ("10", "DEDICATED STORAGE BUCKETS"),
    ("100 GB", "SHARED JOY SERVICES POOL"),
    ("12", "PHASED DELIVERY ROADMAP"),
])
story += callout_note(
    "<b>Honesty policy.</b> The founder's rule for this project: no feature may appear ACTIVE in "
    "the UI unless a real API, database row or storage operation backs it. Where a capability is "
    "not yet implemented or a provider limit applies, this document and the dashboard say so "
    "explicitly with PLANNED or NOT CONFIGURED markers.")

# ================= Chapter 2 =================
story += major("2. Infrastructure Audit - Existing Foundation")
story.append(para(
    "VORTEX SERVER does not start from zero. The live VORTEX control plane already ships a "
    "63-model data schema and eight delivered phases of infrastructure software, all running as "
    "real code paths rather than mock screens. An audit was performed before writing this "
    "architecture; the table below maps the founder's requirements to the modules that already "
    "exist and the gaps that the twelve-phase roadmap closes. Reusing these modules keeps the "
    "ecosystem on one codebase and one security model."
))
story += make_table(
    ["Spec Requirement", "Existing Module (status)", "Coverage"],
    [
        ["Central backend API, auth, RBAC", "Owner control plane + VORTEX ID sessions, OTP, scrypt password hashing (LIVE)", "Full"],
        ["Object storage with replicas and metadata", "StorageVolume / StorageBucket / FileObject engine with 3x replication and SHA-256 checksums (LIVE)", "Full"],
        ["Firebase-style BaaS for builders", "VaaS Vx* stack - projects, collections, documents, users, keys, functions, realtime, usage (LIVE, 21/21 E2E)", "Full"],
        ["API key management", "ApiKey model + hash-at-rest + revocation; PlatformKey added this phase (LIVE)", "Full"],
        ["Security: WAF, IP blocks, audit", "SecurityPolicy, WafRule, IpBlock, SecurityEvent, AuditLog (LIVE)", "Full"],
        ["Monitoring and alerts", "MonitorTarget / MonitorCheck / AlertEvent + notification channels (LIVE)", "Full"],
        ["Billing and subscriptions", "BillingPlan / BillingSubscription / UsageRecord / Invoice (LIVE, BDT plans; INR plans added this phase)", "Full"],
        ["Deployments and SSL", "Deployment, Pipeline, PipelineRun, SslCert (LIVE engine)", "Full"],
        ["Developer management", "Developer model + VaaS dev console with signup, projects, keys (LIVE)", "Full"],
        ["CLOUD AGENT project lifecycle", "App registry exists; dedicated CaProject/CaBuild build pipeline (NEW this phase)", "Partial"],
        ["VORTEX WEBSITE hosting", "Deployment engine exists; WebsiteProject model + site workflow (NEW this phase)", "Partial"],
        ["APPVERSE publishing", "No APK/AAB distribution module existed (NEW this phase)", "Gap"],
        ["VI central AI agent", "AiModel / AiJob exist; ViTask coordination layer (NEW this phase)", "Partial"],
    ],
    [0.30, 0.55, 0.15],
    caption="Table 2-1: Requirement-to-module audit of the live VORTEX control plane",
)
story.append(para(
    "The verdict of the audit: the foundation is strong and mostly reusable. Identity, storage, "
    "security, monitoring, billing, deployments and the BaaS layer are production code with test "
    "coverage. The five platform integrations (CLOUD AGENT lifecycle, VORTEX WEBSITE hosting "
    "workflow, APPVERSE distribution, VI coordination and the per-platform admin surfaces) are "
    "the real remaining work, and they are scoped in chapters 4 to 6 of this document."
))

# ================= Chapter 3 =================
story += major("3. JOY SERVICES Storage - Provider Capability Audit")
story.append(para(
    "JOY SERVICES (joy.services) is the selected object storage provider. Before integrating, its "
    "official API documentation was audited endpoint by endpoint. The provider is genuine "
    "S3-compatible storage with an AWS Signature Version 4 authentication surface, hosted in "
    "Noida, India with additional zones in Mumbai, Chennai, Singapore and US West. The audit "
    "confirms that every storage capability the ecosystem needs is supported, with a small set "
    "of hard limits that the architecture must respect rather than hide."
))
story += make_table(
    ["Capability", "JOY SERVICES Fact (verified from official docs)", "VORTEX Usage"],
    [
        ["Protocol and auth", "Amazon S3 API, AWS Signature V4, path-style addressing", "Standard S3 adapter, SigV4 signing"],
        ["Endpoint", "https://s3.joy.services, region \"default\"", "storage.provider=joy configuration"],
        ["Signed upload URLs", "Presigned upload links issued via REST API - bytes go straight from client to storage", "Browser and builder uploads"],
        ["Signed download URLs", "Presigned download links; maximum validity 7 days", "Expiring app/site/file links"],
        ["Multipart upload", "Supported for large objects; recommended above 16 MiB", "APK/AAB and source archives"],
        ["Bucket management", "REST API create/delete/settings; maximum 100 buckets per account", "The 10-bucket registry fits well inside"],
        ["Access keys", "Access key pairs via /storage/keys; maximum 5 keys per account; secret shown once", "One server-side key pair, rotated carefully"],
        ["Versioning and lifecycle", "Per-bucket versioning, object lock, lifecycle rules (noncurrent expiry, abort incomplete uploads)", "Version policies on source and APK buckets"],
        ["CORS and website hosting", "Per-bucket CORS configuration and static website hosting sections", "vortex-websites bucket serving"],
        ["Quota and usage", "GET /storage returns plan, quota_bytes, usage; GET /storage/usage gives monthly and daily series", "Quota monitor + 80 percent alert"],
        ["Control-plane API", "REST v1 with joy_ bearer tokens, scopes (read, storage), 600 requests/minute", "Bucket provisioning and usage sync"],
    ],
    [0.22, 0.48, 0.30],
    caption="Table 3-1: Verified capability matrix from the joy.services API documentation",
)
story += make_table(
    ["Provider Limit", "Value", "Architecture Response"],
    [
        ["Buckets per account", "100", "Only 10 named ecosystem buckets; no dynamic per-user buckets"],
        ["Access keys per account", "5", "Single server-side key pair; keys never reach the frontend"],
        ["Share/download link validity", "7 days maximum", "SignedAccess tokens capped at 7-day expiry, most at 24 hours"],
        ["Maximum object size", "5 TB (multipart)", "No ecosystem object approaches this; enforced client-side cap of 5 GB"],
        ["Share links", "Expiry based", "Private by default; public links are signed and audited"],
    ],
    [0.30, 0.20, 0.50],
    caption="Table 3-2: Hard provider limits and how the design respects them",
)
story += callout_note(
    "<b>Integration verdict.</b> JOY SERVICES fully covers the ecosystem's storage requirements "
    "through two surfaces: the S3 SigV4 data plane (object put/get/list, presigned URLs, "
    "multipart) and the REST v1 control plane (account, quota, buckets, settings). The adapter "
    "implements both. Until the founder's endpoint, access key and secret key are configured in "
    "the control plane, the dashboard shows JOY SERVICES: NOT CONFIGURED and traffic stays on the "
    "local replicated engine - never a fake success.")

# ================= Chapter 4 =================
story += major("4. Storage Architecture - Ten Buckets and Isolation")
story.append(para(
    "All object storage is organised as exactly ten named buckets inside one JOY SERVICES "
    "account (100 GB, shared by all platforms). Bucket ownership is declared in the bucket "
    "registry, which is seeded into the database and enforced by the storage service: every "
    "read, write, listing or signed-URL issuance checks the caller's platform against the "
    "bucket's owner, and every object key must carry the caller's platform_id and user_id "
    "prefix. A platform that asks for another platform's bucket receives a permission error, "
    "and the attempt is written to the audit log."
))
story += make_table(
    ["Bucket", "Owner Platform", "Access Rules", "Versioning / Backup"],
    [
        ["cloud-agent-projects", "CLOUD AGENT", "Private; project-scoped signed URLs; owner + build system only", "Versioned; nightly backup"],
        ["developer-source-code", "CLOUD AGENT", "Private; developer-scoped prefix; export via signed download", "Versioned; nightly backup"],
        ["nexa-ai-data", "CLOUD AGENT (NEXA builder)", "Private; builder-tenant prefix", "Versioned; nightly backup"],
        ["nexseva-documents", "VI + CLOUD AGENT", "Private; VI reads with approval for admin docs", "Versioned; nightly backup"],
        ["appverse-apk", "APPVERSE", "Private; signed download URLs only after approval", "Versioned; integrity SHA-256"],
        ["appverse-aab", "APPVERSE", "Private; store-internal, never public", "Versioned; integrity SHA-256"],
        ["vortex-websites", "VORTEX WEBSITE", "Private origin; public read only via deployment manifest or CDN", "Versioned per deploy; daily backup"],
        ["user-uploads", "ALL (user-scoped)", "Private; platform:userId:projectId prefix mandatory", "Lifecycle; weekly backup"],
        ["database-backups", "VORTEX SERVER", "Infra-only; restore jobs only; never used as a live database", "Daily rotation; quarterly archive"],
        ["infrastructure-backups", "VORTEX SERVER", "Infra-only; configs, manifests, secrets vault snapshots", "Daily rotation"],
    ],
    [0.22, 0.20, 0.34, 0.24],
    caption="Table 4-1: The ten-bucket registry - ownership, permissions and durability policy",
)
story.append(para(
    "A provider abstraction sits under the registry. The local engine (the existing replicated "
    "object store with three replicas per object and checksum verification) is the default while "
    "JOY SERVICES credentials are not yet configured. The JoyProvider implements the S3 SigV4 "
    "data plane and the REST v1 control plane; switching providers is a configuration change "
    "(storage.provider), and the registry records which provider currently holds each bucket so "
    "the dashboard can state the truth per bucket."
))
story += bullets([
    "<b>Signed URLs.</b> Local engine signs HMAC tokens redeemed at /api/v1/storage/sign; JOY "
    "SERVICES uses presigned upload/download URLs (24-hour default, 7-day hard maximum).",
    "<b>Quota management.</b> Per-platform byte budgets over the shared 100 GB pool are tracked "
    "from FileObject aggregates and synced from GET /storage/usage; writes that would exceed a "
    "platform budget are rejected before upload.",
    "<b>80 percent alert.</b> A monitor check compares used bytes against the pool quota on every "
    "usage sync; at 80 percent an AlertEvent plus notification is raised to the admin channels.",
    "<b>File versions.</b> Versioned buckets keep noncurrent versions for 30 days via lifecycle "
    "rules; metadata (owner, platform, checksum, size, purpose) travels with every object.",
    "<b>Automatic backups.</b> database-backups and infrastructure-backups rotate daily; the "
    "backup copies are for disaster recovery only and are never mounted as a live database.",
])

# ================= Chapter 5 =================
story += major("5. Database Architecture - Twelve Modules")
story.append(para(
    "The database is designed against PostgreSQL and runs on SQLite during sandbox development; "
    "the Prisma schema is portable between the two, and the production migration path is a "
    "schema push against a managed PostgreSQL host followed by a data import - no application "
    "code changes. Data isolation rests on the platform_id / user_id / project_id key trio that "
    "every tenant-owned row carries. One hard rule from the founder is honoured in the design: "
    "database backups may be stored as objects in the database-backups bucket, but those objects "
    "are never used as a live database."
))
story += make_table(
    ["Database Module", "Schema Tables", "Status"],
    [
        ["1. Users", "AdminUser, Session, OtpCode, User-linked Developer rows", "LIVE"],
        ["2. Developers", "Developer (+ profile, storage usage, permissions)", "LIVE"],
        ["3. Projects (CLOUD AGENT)", "CaProject, CaBuild (NEW); App registry (LIVE)", "NEW + LIVE"],
        ["4. Applications (APPVERSE)", "AppverseApp, AppverseVersion (NEW)", "NEW"],
        ["5. Websites", "WebsiteProject, WebsiteDeployment (NEW)", "NEW"],
        ["6. API Keys", "ApiKey (app keys, LIVE); PlatformKey per-platform credentials (NEW)", "LIVE + NEW"],
        ["7. Storage metadata", "StorageBucket (extended: platform owner, quota, provider), FileObject, SignedAccess (NEW)", "LIVE + NEW"],
        ["8. Subscriptions", "BillingPlan, BillingSubscription (INR Cloud Agent plans seeded)", "LIVE"],
        ["9. Usage", "UsageRecord + VxUsage (metering)", "LIVE"],
        ["10. Admin activity", "AuditLog (every mutation, actor, IP)", "LIVE"],
        ["11. Deployments", "Deployment, Pipeline, PipelineRun, SslCert; WebsiteDeployment joins sites", "LIVE"],
        ["12. Security logs", "SecurityEvent, SecurityPolicy, WafRule, IpBlock", "LIVE"],
    ],
    [0.26, 0.55, 0.19],
    caption="Table 5-1: The twelve database modules mapped to concrete schema tables",
)
story.append(para(
    "The tables added in this phase follow the existing conventions: opaque prefixed IDs "
    "(ca_, ws_, av_, avv_, vi_), hash-at-rest for every credential, status enums stored as "
    "strings, JSON columns for payloads and manifests, and createdAt/updatedAt on every row. "
    "In PostgreSQL production the same models map to typed columns with indexes on the "
    "isolation keys and on every foreign key; JSON manifests can be promoted to JSONB columns "
    "for queryable manifests when traffic justifies it."
))
story += bullets([
    "<b>CaProject</b> - CLOUD AGENT project: owner, project type (Android, iOS, Web, Desktop, "
    "Flutter, React, Java, Kotlin, Swift, Dart, C#, C++, Go, Rust, PHP, HTML/CSS), language, "
    "status, source bucket/prefix, size, build counters, metadata JSON.",
    "<b>CaBuild</b> - build record per project: status (QUEUED, RUNNING, SUCCESS, FAILED), "
    "artifact bucket/key, size, checksum, logs, timestamps. Builds package real source bytes "
    "into real artifacts in this phase; language compilers attach to the same record later.",
    "<b>WebsiteProject / WebsiteDeployment</b> - site, subdomain, custom domain, active version, "
    "per-deploy manifest and status; joins the existing SslCert and Deployment engines.",
    "<b>AppverseApp / AppverseVersion</b> - package name, category, icon, APK/AAB objects with "
    "SHA-256 integrity, review status, changelog, download counter.",
    "<b>ViTask</b> - VI coordination tasks with approval gate: kind, payload, result, approver, "
    "latency; destructive or admin-level actions stay NEEDS_APPROVAL until an owner approves.",
    "<b>Platform / PlatformKey / SignedAccess</b> - the tenancy roots: platform registry, "
    "scoped credentials, and signed URL issuance audit.",
])

# ================= Chapter 6 =================
story += major("6. API Specification - Five Namespaces")
story.append(para(
    "Every platform talks to VORTEX SERVER through its own namespace under /api/v1. Two "
    "credential kinds are accepted: a PlatformKey (Bearer pk_live_...) with a scope list, used "
    "for service-to-service calls from the platforms themselves, and the owner session (VORTEX "
    "ID cookie), used by the admin dashboard. The Master Admin Key exists only as a server-side "
    "environment credential; it is never exposed to any frontend. All responses share the "
    "envelope { ok: true|false, error?, ... } with JSON bodies, and every mutating call writes "
    "an audit entry with actor, action and IP."
))
story += make_table(
    ["Namespace", "Representative Endpoints", "Auth"],
    [
        ["/api/v1/cloud-agent",
         "POST /projects - create project, reserve prefix, record metadata; GET /projects and "
         "GET /projects/:id - dashboard data; POST /projects/:id/source - register source archive "
         "(bucket upload, checksum); POST /projects/:id/build - run build pipeline; "
         "GET /projects/:id/export - signed download of source or artifact; POST /export - full project export",
         "Platform key (cloud-agent scopes) or owner session"],
        ["/api/v1/vortex-website",
         "POST /sites; GET /sites/:id; POST /sites/:id/deploy - collect files from bucket, "
         "write manifest, set active version, create WebsiteDeployment; POST /sites/:id/domain - "
         "custom domain claim + SSL cert via existing engine; GET /sites/:id/logs",
         "Platform key (website scopes) or owner session"],
        ["/api/v1/appverse",
         "POST /apps; POST /apps/:id/versions - register APK/AAB object with sha256; "
         "POST /versions/:id/approve - admin review gate; GET /apps/:id/download - signed, "
         "counted download link for published versions only",
         "Platform key (appverse scopes) + admin approval"],
        ["/api/v1/vi",
         "POST /tasks - create assist/monitor/deploy/publish/coordinate task; "
         "GET /tasks/:id - result polling; POST /tasks/:id/approve - owner approval for "
         "privileged actions; GET /status - ecosystem monitoring snapshot",
         "Platform key (vi scopes) + approval gates"],
        ["/api/v1/admin",
         "GET /overview - users, developers, projects, apps, websites, storage, health; "
         "GET /platforms; POST /platforms/:id/keys - issue platform credentials; "
         "GET /security - events, policies, alerts; GET /billing - INR plan status; "
         "GET /storage - bucket registry + provider status + quota",
         "Owner session only (Master key server-side)"],
    ],
    [0.20, 0.62, 0.18],
    caption="Table 6-1: Namespace API specification - representative endpoints and auth model",
)
story.append(para(
    "Rate limiting reuses the existing gateway limiter: a default of 600 requests per minute "
    "per key aligns with the JOY SERVICES control-plane budget so a burst on our side cannot "
    "exhaust the provider quota. Uploads larger than 16 MiB are handed to clients as presigned "
    "multipart upload sessions, keeping large bytes off the API process entirely - the same "
    "property JOY SERVICES advertises: the platform never proxies the object stream."
))

# ================= Chapter 7 =================
story += major("7. Security Architecture")
story.append(para(
    "Security is layered so that no single failure exposes tenant data. Transport is HTTPS at "
    "the gateway. Identity uses scrypt password hashing with per-user salts, OTP-verified "
    "sessions and httpOnly cookies; platform credentials are random 32-byte values stored only "
    "as SHA-256 hashes with a visible prefix for identification. Authorisation is RBAC over "
    "the platform scope system plus the three-key isolation check on every storage and data "
    "operation. Secrets - the JOY SERVICES keys, the Master Admin Key, SMTP credentials - live "
    "in the encrypted AppConfig store or server environment only."
))
story += bullets([
    "<b>Multi-tenant isolation.</b> Bucket ownership + object key prefixes + row-level "
    "platform_id/user_id/project_id checks; cross-tenant attempts are audited.",
    "<b>Least privilege keys.</b> Each platform key carries a narrow scope list; keys can be "
    "revoked instantly and expire on policy; the Master key never leaves the server.",
    "<b>Signed URL hygiene.</b> Every signed URL is short-lived (default 24 h, hard cap 7 days "
    "per provider limits), bound to one object and one operation, and logged in SignedAccess.",
    "<b>Upload safety.</b> Size and MIME validation before admission; APK/AAB integrity "
    "recorded as SHA-256; malware scanning runs as a queued inspection job (Phase 11 target) "
    "and flagged objects are quarantined before any signed link is issued.",
    "<b>Build isolation.</b> Developer code is never executed inside the control plane; builds "
    "run as packaged jobs in an isolated worker context with no database credentials, per the "
    "founder's rule. Compiler toolchains join in later phases inside containers.",
    "<b>Web hardening.</b> Parameterised Prisma queries against SQL injection, React escaping "
    "against XSS, SameSite cookies against CSRF, the WAF rule engine in front of the API.",
    "<b>Accountability.</b> AuditLog rows for every mutation; SecurityEvent rows for auth "
    "anomalies; login history visible in the admin Security view.",
])

# ================= Chapter 8 =================
story += major("8. Monitoring, Billing and the Twelve-Phase Roadmap")
story.append(para(
    "Monitoring is central in the existing engine: MonitorTargets sample CPU, memory, storage "
    "and database health, API response times and failure counts land in GatewayRequest and "
    "MonitorCheck, and AlertEvent carries alerts to notification channels. The storage-pool "
    "check added this phase raises the founder's 80 percent alert: at 80 of 100 GB used, the "
    "admin receives an alert and the dashboard shows the pool in warning state."
))
story += make_table(
    ["Cloud Agent Subscription", "Price (INR/month)", "Notes"],
    [
        ["Starter", "1,999", "Entry builder tier"],
        ["Builder", "2,999", "Standard projects and builds"],
        ["Studio", "3,999", "Higher build and storage budgets"],
        ["Pro", "4,999", "Priority builds, larger artifacts"],
        ["Max", "6,999", "Full ecosystem tier"],
    ],
    [0.40, 0.25, 0.35],
    caption="Table 8-1: Cloud Agent subscription plans (seeded as INR BillingPlans)",
    center_cols=(1,),
)
story += make_table(
    ["Phase", "Scope", "Status"],
    [
        ["Phase 1", "Core backend and authentication (control plane, sessions, OTP, RBAC)", "LIVE"],
        ["Phase 2", "JOY SERVICES integration - S3 SigV4 + REST adapter, bucket registry, provider switch (keys pending founder credentials)", "BUILDING"],
        ["Phase 3", "PostgreSQL-targeted schema of the twelve modules (dev on SQLite, migration path documented)", "BUILDING"],
        ["Phase 4", "Developer and user management", "LIVE"],
        ["Phase 5", "Admin dashboard (existing control plane + new VORTEX SERVER shell)", "LIVE + BUILDING"],
        ["Phase 6", "API key management (app keys + platform keys)", "LIVE"],
        ["Phase 7", "CLOUD AGENT integration - project lifecycle, source storage, build pipeline, export", "BUILDING"],
        ["Phase 8", "VORTEX WEBSITE integration - sites, deploy workflow, domains, SSL", "PLANNED"],
        ["Phase 9", "APPVERSE integration - APK/AAB distribution, review, downloads", "BUILDING"],
        ["Phase 10", "VI integration - tasks, monitoring, approval-gated coordination", "BUILDING"],
        ["Phase 11", "Security audit and load testing (malware scan queue, WAF tuning)", "PLANNED"],
        ["Phase 12", "Production deployment (PostgreSQL host, JOY SERVICES live cutover)", "PLANNED"],
    ],
    [0.13, 0.72, 0.15],
    caption="Table 8-2: Twelve-phase roadmap with honest per-phase status",
    center_cols=(2,),
)
story += callout_row([
    ("21/21", "VaaS E2E GREEN"),
    ("63", "SCHEMA MODELS TODAY"),
    ("10+7", "NEW MODELS THIS PHASE"),
    ("80%", "STORAGE ALERT THRESHOLD"),
])
story.append(para(
    "The immediate next steps are unchanged and concrete: paste the JOY SERVICES endpoint, "
    "access key and secret key to flip storage.provider to joy and run the live connectivity "
    "check; the ten buckets then provision through the real REST API and the dashboard's "
    "Storage view switches from NOT CONFIGURED to LIVE with real quota numbers."
))

doc.multiBuild(story, onFirstPage=on_page, onLaterPages=on_page)
print("BODY OK:", OUT)
