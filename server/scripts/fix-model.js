const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.omnirouteConfig.updateMany({ where: { model: 'auto/research' }, data: { model: 'research' } })
  .then(r => { console.log('Updated:', r.count); process.exit(); });
