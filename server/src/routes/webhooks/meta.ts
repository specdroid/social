import { Router, Request, Response } from 'express'
import { env } from '../../config/env'
import { log } from '../../utils/logger'
import { processMetaWebhookEntry } from '../../services/commentToDm'

const router = Router()

router.get('/', (req: Request, res: Response) => {
  const mode = req.query['hub.mode']
  const token = req.query['hub.verify_token']
  const challenge = req.query['hub.challenge']

  if (mode === 'subscribe' && token === env.META_VERIFY_TOKEN) {
    log('info', 'meta_api', 'Webhook verified')
    res.status(200).send(challenge)
  } else {
    res.status(403).send('Verification failed')
  }
})

router.post('/', async (req: Request, res: Response) => {
  const body = req.body
  log('info', 'meta_api', 'Webhook POST received', { object: body?.object, body: JSON.stringify(body).substring(0, 500) })

  if (body?.object === 'page') {
    for (const entry of body.entry || []) {
      try {
        await processMetaWebhookEntry(entry)
      } catch (err) {
        log('error', 'meta_api', 'Failed to process webhook entry', {
          entryId: entry.id,
          error: (err as Error).message,
        })
      }
    }

    res.status(200).send('EVENT_RECEIVED')
    return
  }

  res.status(200).send('OK')
})

export default router
