// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SkillsPage } from '../../src/pages/SkillsPage'
import type { SkillDocument, SkillRecord } from '../../src/types/api'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function skill(overrides: Partial<SkillRecord> & Pick<SkillRecord, 'id' | 'name'>): SkillRecord {
  return { description: '', kind: 'skill', location: 'user', enabled: true, ...overrides }
}

function changeInput(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('SkillsPage', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  const render = (props: Partial<Parameters<typeof SkillsPage>[0]> = {}) => act(async () => {
    root.render(<SkillsPage
      harness="omp"
      skills={props.skills ?? []}
      warnings={props.warnings ?? []}
      loading={props.loading ?? false}
      onRefresh={props.onRefresh ?? (async () => undefined)}
      onReveal={props.onReveal ?? (() => undefined)}
      onReadDocument={props.onReadDocument ?? (async () => ({ frontmatter: {}, body: '', truncated: false, baseDir: '', files: [] }))}
    />)
  })

  it('groups skills by location and hides non-skill capabilities', async () => {
    await render({
      skills: [
        skill({ id: 'a', name: 'reviewer', description: 'Reviews code', location: 'project' }),
        skill({ id: 'b', name: 'writer', description: 'Writes docs', location: 'user' }),
        skill({ id: 'c', name: 'notes', kind: 'prompt', location: 'bundled' }),
        skill({ id: 'd', name: 'some-mcp', kind: 'mcp', location: 'user' }),
        skill({ id: 'omp-work-browser', name: 'Browser', kind: 'skill', location: 'system' }),
      ],
    })

    const headings = [...container.querySelectorAll('.skill-group__heading h2')].map((node) => node.textContent)
    expect(headings).toEqual(['Project', 'Personal', 'Bundled'])
    expect(container.textContent).toContain('reviewer')
    expect(container.textContent).toContain('writer')
    expect(container.textContent).toContain('notes')
    expect(container.textContent).not.toContain('some-mcp')
    expect(container.textContent).not.toContain('Browser')
  })

  it('filters by search text and by location', async () => {
    await render({
      skills: [
        skill({ id: 'a', name: 'reviewer', description: 'Reviews code', location: 'project' }),
        skill({ id: 'b', name: 'writer', description: 'Writes docs', location: 'user' }),
      ],
    })

    const search = container.querySelector<HTMLInputElement>('.page-search input')!
    await act(async () => changeInput(search, 'writer'))
    expect(container.textContent).toContain('writer')
    expect(container.textContent).not.toContain('reviewer')

    await act(async () => changeInput(search, ''))
    const select = container.querySelector<HTMLSelectElement>('select[aria-label="Skill source"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, 'project')
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(container.textContent).toContain('reviewer')
    expect(container.textContent).not.toContain('writer')
  })

  it('flags skills that share a name across different files', async () => {
    await render({
      skills: [
        skill({ id: 'a', name: 'reviewer', location: 'project' }),
        skill({ id: 'b', name: 'reviewer', location: 'user' }),
      ],
    })

    expect([...container.querySelectorAll('.skill-row__duplicate')]).toHaveLength(2)
  })

  it('shows an empty state when there are no skills', async () => {
    await render({ skills: [] })
    expect(container.textContent).toContain('No skills found')
  })

  it('opens a skill detail with frontmatter, body, nested-skill warning, and reveal action', async () => {
    const skillDocument: SkillDocument = {
      frontmatter: { description: 'Reviews pull requests', globs: '*.ts', alwaysApply: 'false', disableModelInvocation: 'true' },
      body: 'Full instructions here.',
      truncated: false,
      baseDir: '/home/user/.omp/skills/reviewer',
      files: [
        { name: 'checklist.md', isDirectory: false, hasNestedSkill: false },
        { name: 'inner', isDirectory: true, hasNestedSkill: true },
      ],
    }
    const onReadDocument = vi.fn(async () => skillDocument)
    const onReveal = vi.fn()
    await render({
      skills: [skill({ id: 'a', name: 'reviewer', location: 'project', path: '/home/user/.omp/skills/reviewer/SKILL.md' })],
      onReadDocument,
      onReveal,
    })

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.skill-row')!.click()
    })

    expect(onReadDocument).toHaveBeenCalledWith('/home/user/.omp/skills/reviewer/SKILL.md')
    expect(document.body.textContent).toContain('Reviews pull requests')
    expect(document.body.textContent).toContain('*.ts')
    expect(document.body.textContent).toContain('Full instructions here.')
    expect(document.body.textContent).toContain('checklist.md')
    expect(document.body.textContent).toContain('nested SKILL.md')

    const revealButton = [...document.body.querySelectorAll('button')].find((button) => button.textContent?.includes('Reveal in file manager'))!
    await act(async () => revealButton.click())
    expect(onReveal).toHaveBeenCalledWith('/home/user/.omp/skills/reviewer/SKILL.md')
  })

  it('shows a read error instead of a blank detail when the document cannot be loaded', async () => {
    const onReadDocument = vi.fn(async () => { throw new Error('permission denied') })
    await render({
      skills: [skill({ id: 'a', name: 'reviewer', location: 'project', path: '/home/user/.omp/skills/reviewer/SKILL.md' })],
      onReadDocument,
    })

    await act(async () => { container.querySelector<HTMLButtonElement>('.skill-row')!.click() })

    expect(document.body.textContent).toContain('permission denied')
  })
})
