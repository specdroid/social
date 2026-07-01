import cron from 'node-cron'
import { PrismaClient } from '@prisma/client'
import { publishPost, publishUserFeed } from './metaGraph'
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
              facebookUser: true,
              instagramAccounts: true,
            },
          },
        },
      })

      for (const post of posts) {
        try {
          const mediaUrls = post.mediaUrls ? JSON.parse(post.mediaUrls) : null

          if (post.platform === 'facebook' || post.platform === 'both') {
            if (post.target === 'user') {
              const fbUser = post.user.facebookUser
              if (fbUser?.accessToken) {
                await publishUserFeed(fbUser.fbUserId, post.content, mediaUrls, fbUser.accessToken)
              }
            } else {
              const fbPage = post.user.facebookPages[0]
              if (fbPage?.accessToken) {
                await publishPost(fbPage.pageId, post.content, mediaUrls, fbPage.accessToken)
              }
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
