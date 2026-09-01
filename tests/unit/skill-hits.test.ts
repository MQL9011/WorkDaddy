import { describe, expect, it } from 'vitest'
import { detectSkillHits } from '../../src/lib/skill-hits'
import type { MessagePart, SkillRecord } from '../../src/types/api'

function skill(overrides: Partial<SkillRecord> & Pick<SkillRecord, 'id' | 'name' | 'path'>): SkillRecord {
  return { description: '', kind: 'skill', location: 'user', enabled: true, ...overrides }
}

describe('detectSkillHits', () => {
  const reviewer = skill({ id: 'a', name: 'reviewer', path: '/home/user/.omp/skills/reviewer/SKILL.md' })
  const writer = skill({ id: 'b', name: 'writer', path: '/home/user/.omp/skills/writer/SKILL.md' })

  it('matches a tool call argument that is exactly the skill file', () => {
    const parts: MessagePart[] = [{ type: 'toolCall', name: 'read', args: { path: reviewer.path } }]
    expect(detectSkillHits(parts, [reviewer, writer])).toEqual([reviewer])
  })

  it('matches a tool call argument for a file inside the skill directory', () => {
    const parts: MessagePart[] = [{ type: 'toolCall', name: 'read', args: { path: '/home/user/.omp/skills/reviewer/checklist.md' } }]
    expect(detectSkillHits(parts, [reviewer, writer])).toEqual([reviewer])
  })

  it('does not match an unrelated path, even one that shares a prefix', () => {
    const parts: MessagePart[] = [{ type: 'toolCall', name: 'read', args: { path: '/home/user/.omp/skills/reviewer-notes/SKILL.md' } }]
    expect(detectSkillHits(parts, [reviewer])).toEqual([])
  })

  it('searches nested argument shapes and arrays', () => {
    const parts: MessagePart[] = [{ type: 'toolCall', name: 'grep', args: { patterns: ['foo'], targets: [{ path: writer.path }] } }]
    expect(detectSkillHits(parts, [reviewer, writer])).toEqual([writer])
  })

  it('deduplicates repeated hits across multiple tool calls', () => {
    const parts: MessagePart[] = [
      { type: 'toolCall', name: 'read', args: { path: reviewer.path } },
      { type: 'toolCall', name: 'read', args: { path: reviewer.path } },
    ]
    expect(detectSkillHits(parts, [reviewer])).toEqual([reviewer])
  })

  it('ignores non-toolCall parts and skills without a path', () => {
    const noPath: SkillRecord = { id: 'c', name: 'no-path', description: '', kind: 'skill', location: 'user', enabled: true }
    const parts: MessagePart[] = [
      { type: 'text', text: reviewer.path! },
      { type: 'toolResult', name: 'read', text: reviewer.path! },
    ]
    expect(detectSkillHits(parts, [reviewer, noPath])).toEqual([])
  })

  it('ignores mcp and package records even when their path matches', () => {
    const mcpRecord = skill({ id: 'd', name: 'mcp-thing', kind: 'mcp', path: '/home/user/.omp/mcp/thing' })
    const parts: MessagePart[] = [{ type: 'toolCall', name: 'read', args: { path: mcpRecord.path } }]
    expect(detectSkillHits(parts, [mcpRecord])).toEqual([])
  })

  it('returns nothing when there are no candidate skills', () => {
    expect(detectSkillHits([{ type: 'toolCall', name: 'read', args: { path: reviewer.path } }], [])).toEqual([])
  })
})
