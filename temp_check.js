const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const c = await p.omnirouteConfig.findFirst();
  console.log('Config:', JSON.stringify(c));
  const k = await p.omnirouteApiKey.findMany();
  console.log('Keys:', JSON.stringify(k.map(x => ({id: x.id, key: x.key.slice(0,10) + '...', primary: x.isPrimary}))));
  await p['$disconnect']();
})();
