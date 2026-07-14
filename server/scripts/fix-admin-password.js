const bcrypt = require('bcryptjs')
const { PrismaClient } = require('@prisma/client')

async function main() {
  const prisma = new PrismaClient()
  
  const user = await prisma.user.findFirst()
  if (!user) {
    console.log('No user found. Creating admin user...')
    const hash = bcrypt.hashSync('Ahmad@2025', 10)
    const created = await prisma.user.create({
      data: {
email: 'ahmad.zeineddine@hotmail.com',
        name: 'Ahmad',
        passwordHash: hash,
        tier: 'premium',
      },
    })
    console.log(`Created user: ${created.email} / Ahmad@2025 (id: ${created.id})`)
  } else {
    const hash = bcrypt.hashSync('Ahmad@2025', 10)
    await prisma.user.update({
      where: { id: user.id },
      data: { email: 'ahmad.zeineddine@hotmail.com', passwordHash: hash, tier: 'premium' },
    })
    console.log(`Updated user: ahmad.zeineddine@hotmail.com / Ahmad@2025 (tier: premium)`)
  }

  await prisma.$disconnect()
}

main().catch(console.error)
