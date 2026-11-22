import { db } from "@/lib/db";
import { ok, fail, requireSession } from "@/lib/vortex/api";
import { writeAudit } from "@/lib/vortex/audit";
import { ensureSeeded } from "@/lib/vortex/seed";
import { refreshCerts, issueCert, SSL_ISSUERS } from "@/lib/vortex/devops";

/**
 * SSL CERTIFICATES — issue / auto-renew / renew now.
 * POST   { domain, issuer?, targetLabel? }
 * PATCH  { id, autoRenew? , renew? }
 * DELETE ?id=  (revoke)
 */
export async function GET(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;

  await refreshCerts();
  const certs = await db.sslCert.findMany({ orderBy: { domain: "asc" } });
  const now = Date.now();
  return ok({
    certs: certs.map((c) => ({
      ...c,
      daysLeft: Math.max(0, Math.round((c.expiresAt.getTime() - now) / (24 * 3600_000))),
    })),
    issuers: SSL_ISSUERS,
  });
}

export async function POST(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  let body: { domain?: string; issuer?: string; targetLabel?: string };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body");
  }
  if (!body.domain) return fail("domain is required");

  try {
    const cert = await issueCert({
      domain: body.domain,
      issuer: body.issuer,
      targetLabel: body.targetLabel,
      actor: user.email,
    });
    return ok({ cert }, 201);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Could not issue certificate");
  }
}

export async function PATCH(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  let body: { id?: string; autoRenew?: boolean; renew?: boolean };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body");
  }
  if (!body.id) return fail("id is required");
  const cert = await db.sslCert.findUnique({ where: { id: body.id } });
  if (!cert) return fail("Certificate not found", 404);

  if (body.renew) {
    const issuedAt = new Date();
    const expiresAt = new Date(Date.now() + 90 * 24 * 3600_000);
    const updated = await db.sslCert.update({
      where: { id: cert.id },
      data: { issuedAt, expiresAt, status: "ACTIVE" },
    });
    await writeAudit({
      actor: user.email,
      action: "SSL_CERT_RENEWED",
      resource: `ssl:${cert.certId}`,
      detail: `${cert.domain} renewed manually`,
      userId: user.id,
    });
    return ok({ cert: updated });
  }

  if (typeof body.autoRenew === "boolean") {
    const updated = await db.sslCert.update({ where: { id: cert.id }, data: { autoRenew: body.autoRenew } });
    await writeAudit({
      actor: user.email,
      action: body.autoRenew ? "SSL_AUTORENEW_ON" : "SSL_AUTORENEW_OFF",
      resource: `ssl:${cert.certId}`,
      detail: cert.domain,
      userId: user.id,
    });
    return ok({ cert: updated });
  }
  return fail("Nothing to update — send autoRenew or renew");
}

export async function DELETE(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return fail("id query param is required");
  const cert = await db.sslCert.findUnique({ where: { id } });
  if (!cert) return fail("Certificate not found", 404);

  await db.sslCert.update({ where: { id }, data: { status: "REVOKED", autoRenew: false } });
  await writeAudit({
    actor: user.email,
    action: "SSL_CERT_REVOKED",
    resource: `ssl:${cert.certId}`,
    detail: cert.domain,
    userId: user.id,
  });
  return ok({ revoked: true });
}
