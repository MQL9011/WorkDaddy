import type { MessagePart, SkillRecord } from '@/types/api'

const MAX_STRINGS = 200
const MAX_DEPTH = 4

function collectStrings(value: unknown, depth: number, out: string[]): void {
  if (depth > MAX_DEPTH || out.length >= MAX_STRINGS) return
  if (typeof value === 'string') { out.push(value); return }
  if (Array.isArray(value)) { for (const item of value) collectStrings(item, depth + 1, out); return }
  if (value && typeof value === 'object') { for (const item of Object.values(value)) collectStrings(item, depth + 1, out) }
}

function directoryPrefix(path: string): string {
  const separator = path.includes('/') ? '/' : '\\'
  const index = path.lastIndexOf(separator)
  return index === -1 ? path : path.slice(0, index + 1)
}

/**
 * Best-effort detection only: omp's skill discovery is invisible to the
 * desktop app (no `skill://` read event or `/skill:<name>` command reaches
 * this layer), so this heuristically matches file-path-shaped tool call
 * arguments against known skill file locations. A path being touched does
 * not prove the model actually followed the skill's instructions — treat
 * this as "may have consulted", not a guarantee.
 */
export function detectSkillHits(parts: readonly MessagePart[], skills: readonly SkillRecord[]): SkillRecord[] {
  const candidates = skills.filter((skill) => skill.path && (skill.kind === 'skill' || skill.kind === 'prompt'))
  if (!candidates.length) return []
  const hits = new Map<string, SkillRecord>()
  const strings: string[] = []
  for (const part of parts) {
    if (part.type !== 'toolCall') continue
    collectStrings(part.args, 0, strings)
  }
  for (const value of strings) {
    for (const skill of candidates) {
      if (hits.has(skill.id)) continue
      const path = skill.path!
      if (value === path || value.startsWith(directoryPrefix(path))) hits.set(skill.id, skill)
    }
  }
  return [...hits.values()]
}
