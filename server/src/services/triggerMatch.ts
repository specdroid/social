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

  if (mode === 'beginning') {
    return new RegExp(`^${escapeRegex(t)}(\\s|$)`).test(lower)
  }

  return new RegExp(`(?:^|\\s)${escapeRegex(t)}(?:\\s|$)`).test(lower)
}

export function matchAnyTrigger(
  text: string,
  triggers: string[],
  mode: string
): boolean {
  return triggers.some(t => matchesTrigger(text, t, mode))
}
