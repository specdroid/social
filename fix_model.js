const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const result = await p.omnirouteConfig.updateMany({ data: { model: 'auto' } });
  console.log('Updated', result.count, 'config(s) to model: auto');
  const c = await p.omnirouteConfig.findFirst();
  console.log('Current config:', JSON.stringify(c));
  await p['$disconnect']();
})();
