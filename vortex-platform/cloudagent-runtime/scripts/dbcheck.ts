import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
const rows = await db.project.findMany({ where: { name: { startsWith: 'tpl-test' } }, select: { name: true, language: true, framework: true, runtime: true } });
for (const r of rows) console.log(`${r.name} | lang: ${r.language} | fw: ${r.framework} | rt: ${r.runtime}`);
await db.$disconnect();
