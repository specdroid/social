function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function matchesTrigger(
  text: string,
  trigger: string,
  mode: string
): boolean {
  const lower = text.toLowerCase()
  const t = trigger.toLowerCase().trim()
  if (!t) return false

  const escaped = escapeRegex(t)

  if (mode === 'beginning') {
    return new RegExp(`^${escaped}(?:\\s|$)`).test(lower)
  }

  return new RegExp(`\\b${escaped}\\b`).test(lower)
}

export function matchAnyTrigger(
  text: string,
  triggers: string[],
  mode: string
): boolean {
  return triggers.some(t => matchesTrigger(text, t, mode))
}
