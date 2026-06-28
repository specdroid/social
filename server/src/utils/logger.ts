import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export type LogLevel = 'info' | 'warn' | 'error'
export type LogSource = 'meta_api' | 'whatsapp' | 'stripe' | 'system'

export async function log(
  level: LogLevel,
  source: LogSource,
  message: string,
  details?: unknown
): Promise<void> {
  const detailsStr = details ? JSON.stringify(details) : null

  try {
    await prisma.systemLog.create({
      data: {
        level,
        source,
        message,
        details: detailsStr,
      },
    })
  } catch (err) {
    console.error('Failed to write to system_logs:', err)
  }

  const prefix = `[${level.toUpperCase()}][${source}]`
  if (level === 'error') {
    console.error(prefix, message, detailsStr || '')
  } else if (level === 'warn') {
    console.warn(prefix, message, detailsStr || '')
  } else {
    console.log(prefix, message, detailsStr || '')
  }
}
