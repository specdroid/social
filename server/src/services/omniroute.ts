import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

let keyIndex = 0

export async function getConfig(userId: string) {
  let config = await prisma.omnirouteConfig.findFirst({ where: { userId } })
  if (!config) {
    config = await prisma.omnirouteConfig.create({ data: { userId } })
  }
  return config
}

export async function updateConfig(userId: string, data: { baseUrl?: string; apiKey?: string; model?: string; systemPrompt?: string }) {
  const current = await getConfig(userId)
  return prisma.omnirouteConfig.update({
    where: { userId },
    data: {
      ...(data.baseUrl !== undefined && { baseUrl: data.baseUrl }),
      ...(data.apiKey !== undefined && { apiKey: data.apiKey }),
      ...(data.model !== undefined && { model: data.model }),
      ...(data.systemPrompt !== undefined && { systemPrompt: data.systemPrompt }),
    },
  })
}

export async function getApiKeys(userId: string) {
  return prisma.omnirouteApiKey.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } })
}

export async function addApiKey(userId: string, key: string, label?: string) {
  return prisma.omnirouteApiKey.create({ data: { userId, key, label: label || '' } })
}

export async function deleteApiKey(id: string, userId: string) {
  return prisma.omnirouteApiKey.deleteMany({ where: { id, userId } })
}

function getNextKey(keys: string[]): string {
  if (keys.length === 0) throw new Error('No API keys configured')
  const key = keys[keyIndex % keys.length]
  keyIndex++
  return key
}

export async function chatCompletion(messages: { role: string; content: string }[], userId?: string) {
  const config = userId ? await getConfig(userId) : await prisma.omnirouteConfig.findFirst()
  if (!config) throw new Error('Omniroute not configured')

  let apiKey = config.apiKey

  const extraKeys = userId
    ? (await prisma.omnirouteApiKey.findMany({ where: { userId } })).map(k => k.key)
    : []

  const allKeys = [apiKey, ...extraKeys].filter(k => k && k.trim())

  if (allKeys.length === 0) throw new Error('No API keys configured')

  const key = getNextKey(allKeys)

  const body: any = {
    model: config.model || 'research',
    stream: false,
    messages: [],
  }

  if (config.systemPrompt) {
    body.messages.push({ role: 'system', content: config.systemPrompt })
  }

  body.messages.push(...messages)

  const response = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const resText = await response.text()
  if (!response.ok) {
    throw new Error(`Omniroute API error ${response.status}: ${resText.slice(0, 200)}`)
  }

  if (resText.startsWith('data: ') || resText.includes('\ndata: ')) {
    const lines = resText.split('\n').filter(l => l.startsWith('data: ') && l !== 'data: [DONE]')
    let fullContent = ''
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line.slice(6))
        fullContent += parsed.choices?.[0]?.delta?.content || parsed.choices?.[0]?.message?.content || ''
      } catch { }
    }
    return fullContent
  }

  const data = JSON.parse(resText) as any
  return data.choices?.[0]?.message?.content || ''
}
