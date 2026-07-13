import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export async function getConfig() {
  let config = await prisma.omnirouteConfig.findFirst()
  if (!config) {
    config = await prisma.omnirouteConfig.create({ data: {} })
  }
  return config
}

export async function updateConfig(data: { baseUrl?: string; apiKey?: string; model?: string; systemPrompt?: string }) {
  const current = await getConfig()
  return prisma.omnirouteConfig.update({
    where: { id: current.id },
    data: {
      ...(data.baseUrl !== undefined && { baseUrl: data.baseUrl }),
      ...(data.apiKey !== undefined && { apiKey: data.apiKey }),
      ...(data.model !== undefined && { model: data.model }),
      ...(data.systemPrompt !== undefined && { systemPrompt: data.systemPrompt }),
    },
  })
}

export async function chatCompletion(messages: { role: string; content: string }[]) {
  const config = await getConfig()
  if (!config.apiKey) throw new Error('Omniroute API key not configured')

  const body: any = {
    model: config.model || 'auto/coding:free',
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
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const resText = await response.text()
  if (!response.ok) {
    throw new Error(`Omniroute API error ${response.status}: ${resText.slice(0, 200)}`)
  }

  // Handle SSE streaming response (NDJSON lines)
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
