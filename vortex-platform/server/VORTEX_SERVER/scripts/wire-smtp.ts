/**
 * Wire the CURRENT database onto real SMTP (Phase 8 owner decision).
 * Idempotent: same upserts the seed applies on fresh installs.
 * Run: bun scripts/wire-smtp.ts
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const WIRED = [
  { key: "mail.provider", value: "postal", description: "simulated | smtp | postal — WIRED (Phase 8): OTP + system mail go over REAL SMTP" },
  { key: "mail.smtp_host", value: "127.0.0.1", description: "Postal relay host — sandbox runs the local SMTP sink; production points at the Postal cluster" },
  { key: "mail.smtp_port", value: "8025", description: "Postal relay port (SMTP sink 8025 in sandbox, 25 in production)" },
  { key: "mail.smtp_from", value: "VORTEX <no-reply@vortex.internal>", description: "Envelope-from for real SMTP delivery" },
];

async function main() {
  for (const w of WIRED) {
    const existing = await db.appConfig.findUnique({ where: { key: w.key } });
    if (existing) {
      await db.appConfig.update({ where: { key: w.key }, data: { value: w.value, description: w.description, updatedBy: "owner (smtp wiring)" } });
    } else {
      await db.appConfig.create({ data: { key: w.key, value: w.value, category: "mail", description: w.description, updatedBy: "owner (smtp wiring)" } });
    }
    console.log(`wired ${w.key} = ${w.value}`);
  }
  const check = await db.appConfig.findMany({ where: { key: { startsWith: "mail." } }, orderBy: { key: "asc" } });
  console.log("\ncurrent mail.* config:");
  for (const c of check) console.log(`  ${c.key} = ${c.key.includes("pass") ? "***" : c.value}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
