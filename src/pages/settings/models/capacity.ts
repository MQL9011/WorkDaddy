/** Read 256K / 1M / a raw token count. NaN means unreadable. */
export function parseCapacity(text: string): number | undefined {
  const trimmed = text.trim()
  if (!trimmed) return undefined
  const match = trimmed.match(/^(\d+(?:\.\d+)?)([kKmM])?$/)
  if (!match) return Number.NaN
  const amount = Number(match[1])
  const factor = match[2] ? (match[2].toLowerCase() === 'm' ? 1_000_000 : 1_000) : 1
  const value = amount * factor
  if (!Number.isInteger(value) || value <= 0) return Number.NaN
  return value
}

export function formatCapacity(value: number): string {
  if (value >= 1_000_000 && value % 1_000_000 === 0) return `${value / 1_000_000}M`
  if (value >= 1_000 && value % 1_000 === 0) return `${value / 1_000}K`
  return String(value)
}
