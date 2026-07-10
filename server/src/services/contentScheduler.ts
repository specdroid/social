import cron from 'node-cron'
import { PrismaClient } from '@prisma/client'
import { publishToFeed } from './metaGraph'
import { log } from '../utils/logger'

const prisma = new PrismaClient()

export function startContentScheduler(): void {
  cron.schedule('* * * * *', async () => {
    try {
      const now = new Date()

      const posts = await prisma.scheduledPost.findMany({
        where: {
          status: 'pending',
          scheduledAt: { lte: now },
        },
        include: {
          user: {
            include: {
              facebookPages: true,
              facebookAccounts: true,
              instagramAccounts: true,
            },
          },
        },
      })

      for (const post of posts) {
        try {
          const mediaUrls = post.mediaUrls ? JSON.parse(post.mediaUrls) : null

          if (post.platform === 'facebook' || post.platform === 'both') {
            const fbAccount = post.user.facebookAccounts[0]
            if (fbAccount?.accessToken) {
              await publishToFeed(post.content, mediaUrls, fbAccount.accessToken)
            }
          }

          await prisma.scheduledPost.update({
            where: { id: post.id },
            data: {
              status: 'published',
              publishedAt: now,
            },
          })

          log('info', 'meta_api', 'Scheduled post published', { postId: post.id })
        } catch (err) {
          await prisma.scheduledPost.update({
            where: { id: post.id },
            data: {
              status: 'failed',
              errorMessage: (err as Error).message,
            },
          })

          log('error', 'meta_api', 'Scheduled post failed', {
            postId: post.id,
            error: (err as Error).message,
          })
        }
      }
    } catch (err) {
      log('error', 'system', 'Content scheduler error', {
        error: (err as Error).message,
      })
    }
  })

  log('info', 'system', 'Content scheduler started (every minute)')
}
