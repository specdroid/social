import { PrismaClient } from '@prisma/client'
import Database from 'better-sqlite3'
import path from 'path'

const prisma = new PrismaClient()
const BACKUP_PATH = path.resolve(__dirname, '../prisma/dev.db.bak')

async function main() {
  console.log('=== Data Migration: Adding userId scoping ===\n')

  let defaultUser = await prisma.user.findFirst()
  if (!defaultUser) {
    defaultUser = await prisma.user.create({
      data: { email: 'admin@social.local', name: 'Admin', passwordHash: 'migrated', tier: 'premium' },
    })
    console.log(`Created default user: ${defaultUser.id}`)
  } else {
    console.log(`Using existing user: ${defaultUser.id} (${defaultUser.email})`)
  }
  const userId = defaultUser.id

  const backup = new Database(BACKUP_PATH, { readonly: true })
  const tableExists = (name: string) => !!backup.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name)
  const safeAll = (table: string) => tableExists(table) ? backup.prepare(`SELECT * FROM "${table}"`).all() as any[] : []

  let rows: any[]

  rows = safeAll('OmnirouteConfig')
  for (const r of rows) {
    await prisma.omnirouteConfig.upsert({
      where: { userId },
      update: { baseUrl: r.baseUrl, apiKey: r.apiKey, model: r.model, systemPrompt: r.systemPrompt },
      create: { userId, baseUrl: r.baseUrl, apiKey: r.apiKey, model: r.model, systemPrompt: r.systemPrompt },
    })
  }
  if (rows.length) console.log(`  Migrated ${rows.length} OmnirouteConfig(s)`)

  rows = safeAll('TelegramSession')
  for (const r of rows) {
    await prisma.telegramSession.upsert({
      where: { userId },
      update: { session: r.session, phone: r.phone, isLoggedIn: !!r.isLoggedIn },
      create: { userId, session: r.session, phone: r.phone, isLoggedIn: !!r.isLoggedIn },
    })
  }
  if (rows.length) console.log(`  Migrated ${rows.length} TelegramSession(s)`)

  rows = safeAll('SavedGroupList')
  for (const r of rows) {
    await prisma.savedGroupList.create({ data: { userId, name: r.name, groups: r.groups } })
  }
  if (rows.length) console.log(`  Migrated ${rows.length} SavedGroupList(s)`)

  rows = safeAll('AllowedNumber')
  for (const r of rows) {
    await prisma.allowedNumber.create({ data: { userId, phone: r.phone } })
  }
  if (rows.length) console.log(`  Migrated ${rows.length} AllowedNumber(s)`)

  rows = safeAll('AllowedGroup')
  for (const r of rows) {
    await prisma.allowedGroup.create({ data: { userId, name: r.name } })
  }
  if (rows.length) console.log(`  Migrated ${rows.length} AllowedGroup(s)`)

  rows = safeAll('TelegramContact')
  for (const r of rows) {
    await prisma.telegramContact.create({
      data: { userId, tgId: r.tgId, name: r.name, phone: r.phone, username: r.username },
    })
  }
  if (rows.length) console.log(`  Migrated ${rows.length} TelegramContact(s)`)

  rows = safeAll('TelegramConversation')
  for (const r of rows) {
    await prisma.telegramConversation.create({
      data: {
        userId, tgId: r.tgId, name: r.name, type: r.type,
        unreadCount: r.unreadCount || 0, lastMessage: r.lastMessage,
        lastMessageAt: r.lastMessageAt ? new Date(r.lastMessageAt) : null,
      },
    })
  }
  if (rows.length) console.log(`  Migrated ${rows.length} TelegramConversation(s)`)

  rows = safeAll('WhatsAppSession')
  if (rows.length > 0) {
    const r = rows[0]
    await prisma.whatsAppSession.create({
      data: { userId, phone: r.phone, isConnected: !!r.isConnected },
    })
    console.log(`  Migrated 1 WhatsAppSession (of ${rows.length})`)
  }

  rows = safeAll('FacebookPage')
  for (const r of rows) {
    await prisma.facebookPage.create({
      data: { userId, pageId: r.pageId, pageName: r.pageName, accessToken: r.accessToken, pageToken: r.pageToken, webhookActive: !!r.webhookActive },
    })
  }
  if (rows.length) console.log(`  Migrated ${rows.length} FacebookPage(s)`)

  rows = safeAll('FacebookAccount')
  for (const r of rows) {
    await prisma.facebookAccount.create({
      data: { userId, fbId: r.fbId, fbName: r.fbName, accessToken: r.accessToken },
    })
  }
  if (rows.length) console.log(`  Migrated ${rows.length} FacebookAccount(s)`)

  rows = safeAll('InstagramAccount')
  for (const r of rows) {
    await prisma.instagramAccount.create({
      data: { userId, igBusinessId: r.igBusinessId, accountName: r.accountName, accessToken: r.accessToken, webhookActive: !!r.webhookActive },
    })
  }
  if (rows.length) console.log(`  Migrated ${rows.length} InstagramAccount(s)`)

  rows = safeAll('AutomationRule')
  for (const r of rows) {
    await prisma.automationRule.create({
      data: {
        userId, name: r.name, platform: r.platform, triggerType: r.triggerType,
        triggerValue: r.triggerValue, actionType: r.actionType, actionPayload: r.actionPayload,
        isActive: !!r.isActive,
      },
    })
  }
  if (rows.length) console.log(`  Migrated ${rows.length} AutomationRule(s)`)

  rows = safeAll('ScheduledPost')
  for (const r of rows) {
    await prisma.scheduledPost.create({
      data: {
        userId, platform: r.platform, content: r.content, mediaUrls: r.mediaUrls,
        scheduledAt: new Date(r.scheduledAt), publishedAt: r.publishedAt ? new Date(r.publishedAt) : null,
        status: r.status, errorMessage: r.errorMessage,
      },
    })
  }
  if (rows.length) console.log(`  Migrated ${rows.length} ScheduledPost(s)`)

  rows = safeAll('FacebookPostLog')
  for (const r of rows) {
    await prisma.facebookPostLog.create({
      data: { userId, pageId: r.pageId, content: r.content, mediaUrls: r.mediaUrls, status: r.status, error: r.error, ruleId: r.ruleId },
    })
  }
  if (rows.length) console.log(`  Migrated ${rows.length} FacebookPostLog(s)`)

  backup.close()
  console.log(`\n=== Done. Default user: ${userId} ===`)
}

main().catch(console.error).finally(() => prisma.$disconnect())
