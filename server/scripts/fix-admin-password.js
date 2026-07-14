const bcrypt = require('bcryptjs')
const { PrismaClient } = require('@prisma/client')

async function main() {
  const prisma = new PrismaClient()
  
  const user = await prisma.user.findFirst()
  if (!user) {
    console.log('No user found. Creating admin user...')
    const hash = bcrypt.hashSync('admin123', 10)
    const created = await prisma.user.create({
      data: {
        email: 'admin@social.local',
        name: 'Admin',
        passwordHash: hash,
        tier: 'premium',
      },
    })
    console.log(`Created user: ${created.email} / admin123 (id: ${created.id})`)
  } else {
    const hash = bcrypt.hashSync('admin123', 10)
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: hash },
    })
    console.log(`Updated password for ${user.email} → admin123`)
  }

  await prisma.$disconnect()
}

main().catch(console.error)
