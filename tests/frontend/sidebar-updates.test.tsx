// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Sidebar } from '../../src/components/Sidebar'
import type { AppUpdateState, ProjectRecord, SessionRecord } from '../../src/types/api'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const project: ProjectRecord = {
  id: 'project', harness: 'omp', name: 'Project', path: '/project', folders: ['/project'], primaryFolder: '/project',
  pinned: false, createdAt: '2026-01-01T00:00:00.000Z', lastOpenedAt: '2026-01-01T00:00:00.000Z', sessionCount: 1, authorized: true }
const session: SessionRecord = {
  id: 'session', harness: 'omp', filePath: '/sessions/session.jsonl', projectPath: '/project', title: 'Session',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', status: 'idle', depth: 0,
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

const noop = () => undefined

async function press(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

async function renderSidebar(updateState: AppUpdateState, onUpdateAction: () => void) {
  await act(async () => {
    root.render(
      <Sidebar
        projects={[project]} sessions={[session]} activeView="session" updateState={updateState} onUpdateAction={onUpdateAction}
        onSelectProject={noop} onSelectSession={noop} onNavigate={noop} onNewSession={noop} onAddProject={noop} onRemoveProject={noop}
        onClose={noop} onOpenPalette={noop} onRenameSession={async () => undefined} onDeleteSession={async () => undefined}
      />,
    )
  })
}

describe('sidebar update control', () => {
  it('asks only about restarting when the update is already downloaded', async () => {
    const onUpdateAction = vi.fn()
    await renderSidebar({ phase: 'downloaded', version: '0.2.0' }, onUpdateAction)

    await press(container.querySelector('.sidebar-update')!)
    const dialog = document.body.querySelector('[role="dialog"]')
    expect(dialog?.textContent).toContain('Restart WorkDaddy to install the update?')
    expect(dialog?.textContent).toContain('close and restart')
    expect(dialog?.textContent).not.toContain('download the update')

    const yes = [...document.body.querySelectorAll<HTMLButtonElement>('.modal__footer button')].find((button) => button.textContent === 'Yes')
    await press(yes!)
    expect(onUpdateAction).toHaveBeenCalledOnce()
  })

  it('keeps a retry affordance and the version after a failed download', async () => {
    const onUpdateAction = vi.fn()
    await renderSidebar({ phase: 'error', version: '0.2.0', message: 'network went away' }, onUpdateAction)

    const update = container.querySelector<HTMLButtonElement>('.sidebar-update')
    expect(update).not.toBeNull()
    expect(update?.classList.contains('sidebar-update--error')).toBe(true)
    expect(update?.getAttribute('title')).toBe('network went away')
    expect(update?.disabled).toBe(false)

    // Retrying re-checks straight away instead of asking to download and restart.
    await press(update!)
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    expect(onUpdateAction).toHaveBeenCalledOnce()
  })

  it('shows a busy state instead of a stuck 0% until progress is known', async () => {
    const onUpdateAction = vi.fn()
    await renderSidebar({ phase: 'downloading', version: '0.2.0' }, onUpdateAction)

    const update = container.querySelector('.sidebar-update')
    expect(update?.classList.contains('sidebar-update--indeterminate')).toBe(true)
    const icon = update?.querySelector<HTMLElement>('.sidebar-update__icon')
    expect(icon?.style.getPropertyValue('--update-progress')).toBe('0%')

    await renderSidebar({ phase: 'downloading', version: '0.2.0', percent: 12 }, onUpdateAction)
    const progressing = container.querySelector('.sidebar-update')
    expect(progressing?.classList.contains('sidebar-update--indeterminate')).toBe(false)
    const progressingIcon = progressing?.querySelector<HTMLElement>('.sidebar-update__icon')
    expect(progressingIcon?.style.getPropertyValue('--update-progress')).toBe('12%')
  })

  it('announces phase changes from a dedicated status element without the percentage', async () => {
    const onUpdateAction = vi.fn()
    await renderSidebar({ phase: 'downloading', version: '0.2.0', percent: 42 }, onUpdateAction)

    const update = container.querySelector('.sidebar-update')
    expect(update?.getAttribute('aria-live')).toBeNull()
    const status = container.querySelector('.sidebar__footer [role="status"]')
    expect(status?.getAttribute('aria-live')).toBe('polite')
    expect(status?.textContent).toBe('Downloading WorkDaddy update 0.2.0')
  })

  it('stays hidden next to Settings until there is a concrete update to act on', async () => {
    const onUpdateAction = vi.fn()
    for (const state of [{ phase: 'idle' }, { phase: 'checking' }, { phase: 'not-available' }, { phase: 'unsupported' }, { phase: 'error', message: 'network went away' }] as const) {
      await renderSidebar(state, onUpdateAction)
      const row = container.querySelector('.sidebar__footer-row')
      const settings = row?.querySelector('button[title="Settings"]')
      expect(settings, `settings should render for phase ${state.phase}`).not.toBeNull()
      expect(row?.querySelector('.sidebar-update'), `update control should be hidden for phase ${state.phase}`).toBeNull()
    }
    expect(onUpdateAction).not.toHaveBeenCalled()
  })
})
