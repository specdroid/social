const bcrypt = require('bcryptjs')
const { PrismaClient } = require('@prisma/client')

async function main() {
  const prisma = new PrismaClient()

  console.log('=== Current users in database ===')
  const users = await prisma.user.findMany()
  for (const u of users) {
    console.log(`  ID: ${u.id}`)
    console.log(`  Email: ${u.email}`)
    console.log(`  Name: ${u.name}`)
    console.log(`  Tier: ${u.tier}`)
    console.log(`  Password hash: ${u.passwordHash.substring(0, 20)}...`)
    console.log(`  Expires: ${u.expiresAt}`)
    console.log('')
  }

  if (users.length === 0) {
    console.log('No users found. Creating new user...')
    const hash = bcrypt.hashSync('Ahmad@2025', 10)
    const created = await prisma.user.create({
      data: {
        email: 'ahmad.zeineddine@hotmail.com',
        name: 'Ahmad',
        passwordHash: hash,
        tier: 'premium',
        role: 'master',
      },
    })
    console.log(`Created: ${created.email} / Ahmad@2025 (id: ${created.id}, tier: ${created.tier}, role: ${created.role})`)
  } else {
    // Update the first user
    const hash = bcrypt.hashSync('Ahmad@2025', 10)
    const updated = await prisma.user.update({
      where: { id: users[0].id },
      data: {
        email: 'ahmad.zeineddine@hotmail.com',
        passwordHash: hash,
        tier: 'premium',
        role: 'master',
      },
    })
    console.log(`Updated: ${updated.email} / Ahmad@2025 (id: ${updated.id}, tier: ${updated.tier}, role: ${updated.role})`)
  }

  // Verify the update
  console.log('\n=== Verifying login credentials ===')
  const user = await prisma.user.findUnique({ where: { email: 'ahmad.zeineddine@hotmail.com' } })
  if (!user) {
    console.log('ERROR: User not found with email ahmad.zeineddine@hotmail.com')
  } else {
    const valid = bcrypt.compareSync('Ahmad@2025', user.passwordHash)
    console.log(`Email: ${user.email}`)
    console.log(`Password valid: ${valid}`)
    console.log(`Tier: ${user.tier}`)
    console.log(`Role: ${user.role}`)
    if (!valid) {
      console.log('ERROR: Password hash does not match!')
    }
  }

  await prisma.$disconnect()
}

main().catch(console.error)
