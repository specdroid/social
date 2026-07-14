import { PrismaClient } from '@prisma/client'
import { replyToComment, sendMessengerDM, sendInstagramDM } from './metaGraph'
import { log } from '../utils/logger'

const prisma = new PrismaClient()

interface WebhookChange {
  field: string
  value: {
    post_id?: string
    comment_id?: string
    from?: { id: string; name: string }
    message?: string
    verb?: string
  }
}

interface WebhookMessaging {
  sender: { id: string }
  message?: { text?: string }
  postback?: { payload?: string }
}

interface WebhookEntry {
  id: string
  changes?: WebhookChange[]
  messaging?: WebhookMessaging[]
}

export async function processMetaWebhookEntry(entry: WebhookEntry): Promise<void> {
  if (entry.changes) {
    for (const change of entry.changes) {
      if (change.field === 'feed' || change.field === 'mention') {
        await handleFeedChange(change.value, entry.id)
      }
    }
  }

  if (entry.messaging) {
    for (const event of entry.messaging) {
      await handleMessagingEvent(event, entry.id)
    }
  }
}

async function handleFeedChange(
  value: WebhookChange['value'],
  pageId: string
): Promise<void> {
  const message = value.message?.toLowerCase() || ''

  const fbPage = await prisma.facebookPage.findUnique({ where: { pageId } })
  const userId = fbPage?.userId

  const rules = await prisma.automationRule.findMany({
    where: {
      isActive: true,
      triggerType: 'keyword_comment',
      ...(userId ? { userId } : {}),
    },
  })

  for (const rule of rules) {
    const triggers = rule.triggerValue.split(/[,،]/).map(t => t.trim().toLowerCase()).filter(Boolean)
    if (!triggers.some(t => message.includes(t))) continue

    const user = await prisma.user.findUnique({
      where: { id: rule.userId },
      include: { facebookPages: true, instagramAccounts: true },
    })

    if (!user) continue

    if (rule.platform === 'facebook' || rule.platform === 'both') {
      const matchedFbPage = user.facebookPages.find((p) => p.pageId === pageId)
      if (matchedFbPage?.accessToken && value.comment_id) {
        try {
          const payload = parseActionPayload(rule.actionPayload)

          if (payload.replyText) {
            await replyToComment(value.comment_id, payload.replyText, matchedFbPage.accessToken)
          }

          if (payload.dmText && value.from?.id) {
            await sendMessengerDM(value.from.id, payload.dmText, matchedFbPage.accessToken)
          }

          log('info', 'meta_api', 'Comment trigger fired', {
            ruleId: rule.id,
            commentId: value.comment_id,
          })
        } catch (err) {
          log('error', 'meta_api', 'Failed to process comment trigger', {
            ruleId: rule.id,
            error: (err as Error).message,
          })
        }
      }
    }
  }
}

async function handleMessagingEvent(
  event: WebhookMessaging,
  pageId: string
): Promise<void> {
  const messageText = event.message?.text?.toLowerCase() || event.postback?.payload?.toLowerCase() || ''

  const fbPage = await prisma.facebookPage.findUnique({ where: { pageId } })
  const userId = fbPage?.userId

  const rules = await prisma.automationRule.findMany({
    where: {
      isActive: true,
      triggerType: 'keyword_comment',
      ...(userId ? { userId } : {}),
    },
  })

  for (const rule of rules) {
    const triggers = rule.triggerValue.split(/[,،]/).map(t => t.trim().toLowerCase()).filter(Boolean)
    if (!triggers.some(t => messageText.includes(t))) continue

    const user = await prisma.user.findUnique({
      where: { id: rule.userId },
      include: { facebookPages: true },
    })

    if (!user) continue

    const fbPage = user.facebookPages[0]
    if (!fbPage?.accessToken) continue

    try {
      const payload = parseActionPayload(rule.actionPayload)

      if (payload.dmText) {
        await sendMessengerDM(event.sender.id, payload.dmText, fbPage.accessToken)
      }

      log('info', 'meta_api', 'Messenger trigger fired', {
        ruleId: rule.id,
        senderId: event.sender.id,
      })
    } catch (err) {
      log('error', 'meta_api', 'Failed to process messenger trigger', {
        ruleId: rule.id,
        error: (err as Error).message,
      })
    }
  }
}

function parseActionPayload(payload: string): { replyText?: string; dmText?: string } {
  try {
    return JSON.parse(payload)
  } catch {
    return { replyText: payload }
  }
}
