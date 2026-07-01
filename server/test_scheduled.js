const { PrismaClient } = require('@prisma/client')
const p = new PrismaClient()
async function test() {
  try { const r = await p.scheduledPost.findMany(); console.log('ok:', r.length) }
  catch(e) { console.log('err:', e.message.substring(0,200)) }
  finally { p.$disconnect() }
}
test()
