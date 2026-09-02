export type ApiKeyFailureKey = 'keyBlank' | 'keyIllegalCharacters'

const PRINTABLE = /^[\x21-\x7E]+$/
const ENV_LINE = /^[A-Za-z_][A-Za-z0-9_]*=/

function wrappedInQuotes(value: string): boolean {
  const quote = value[0]
  return (quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote)
}

/** Empty field means keep the stored key. Whitespace-only and env-line pastes fail. */
export function apiKeyFailure(draft: string, required: boolean): ApiKeyFailureKey | undefined {
  if (draft.length === 0) return required ? 'keyBlank' : undefined
  if (!draft.trim()) return 'keyBlank'
  const trimmed = draft.trim()
  if (!PRINTABLE.test(trimmed) || ENV_LINE.test(trimmed) || wrappedInQuotes(trimmed)) return 'keyIllegalCharacters'
  return undefined
}
