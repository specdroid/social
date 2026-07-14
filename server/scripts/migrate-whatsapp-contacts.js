const { PrismaClient } = require('@prisma/client')
const path = require('path')
const fs = require('fs')

const prisma = new PrismaClient()

async function main() {
  console.log('=== Migrating WhatsApp contacts from JSON to DB ===\n')

  const user = await prisma.user.findFirst()
  if (!user) {
    console.log('No user found. Skipping migration.')
    return
  }
  const userId = user.id
  console.log(`Using user: ${userId} (${user.email})`)

  // Migrate contacts.json
  const contactsPath = path.resolve(__dirname, '../auth_info_baileys/contacts.json')
  if (fs.existsSync(contactsPath)) {
    try {
      const contacts = JSON.parse(fs.readFileSync(contactsPath, 'utf-8'))
      console.log(`Found ${contacts.length} contacts in contacts.json`)
      let migrated = 0
      for (const c of contacts) {
        try {
          await prisma.whatsAppContact.upsert({
            where: { userId_waJid: { userId, waJid: c.id } },
            update: {},
            create: {
              userId,
              waJid: c.id,
              lid: c.lid || null,
              name: c.name || null,
              notify: c.notify || null,
              verifiedName: c.verifiedName || null,
              phoneNumber: c.phoneNumber || null,
            },
          })
          migrated++
        } catch { /* skip duplicates */ }
      }
      console.log(`  Migrated ${migrated} contacts`)
    } catch (err) {
      console.log(`  Failed to migrate contacts: ${err.message}`)
    }
  } else {
    console.log('No contacts.json found, skipping')
  }

  // Migrate imported_contacts.json
  const importedPath = path.resolve(__dirname, '../auth_info_baileys/imported_contacts.json')
  if (fs.existsSync(importedPath)) {
    try {
      const imported = JSON.parse(fs.readFileSync(importedPath, 'utf-8'))
      console.log(`Found ${imported.length} imported contacts`)
      let migrated = 0
      for (const c of imported) {
        try {
          const digits = (c.phoneNumber || c.id?.replace('@s.whatsapp.net', '') || '').replace(/\D/g, '')
          await prisma.whatsAppImportedContact.upsert({
            where: { userId_phoneNumber: { userId, phoneNumber: digits } },
            update: {},
            create: {
              userId,
              waJid: c.id || `${digits}@s.whatsapp.net`,
              name: c.name || null,
              phoneNumber: digits || null,
            },
          })
          migrated++
        } catch { /* skip */ }
      }
      console.log(`  Migrated ${migrated} imported contacts`)
    } catch (err) {
      console.log(`  Failed to migrate imported contacts: ${err.message}`)
    }
  } else {
    console.log('No imported_contacts.json found, skipping')
  }

  // Migrate contact_groups.json
  const groupsPath = path.resolve(__dirname, '../auth_info_baileys/contact_groups.json')
  if (fs.existsSync(groupsPath)) {
    try {
      const groups = JSON.parse(fs.readFileSync(groupsPath, 'utf-8'))
      console.log(`Found ${groups.length} contact groups`)
      let migrated = 0
      for (const g of groups) {
        try {
          await prisma.whatsAppContactGroup.upsert({
            where: { userId_name: { userId, name: g.name } },
            update: { memberJids: JSON.stringify(g.memberJids || []) },
            create: {
              userId,
              name: g.name,
              memberJids: JSON.stringify(g.memberJids || []),
            },
          })
          migrated++
        } catch { /* skip */ }
      }
      console.log(`  Migrated ${migrated} contact groups`)
    } catch (err) {
      console.log(`  Failed to migrate contact groups: ${err.message}`)
    }
  } else {
    console.log('No contact_groups.json found, skipping')
  }

  console.log('\n=== Done ===')
}

main().catch(console.error).finally(() => prisma.$disconnect())
