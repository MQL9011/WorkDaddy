// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OnboardingWizard, type OnboardingWizardProps } from '../../src/components/onboarding/OnboardingWizard'
import type { AppMeta, AppSettings, InstalledOmp, OmpInstallPhase, ProjectRecord } from '../../src/types/api'
import { DEFAULT_SETTINGS } from '../../src/lib/data'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function meta(overrides: Partial<AppMeta['harnesses']['omp']> = {}): AppMeta {
  return {
    version: '0.1.0',
    platform: 'darwin',
    homeDir: '/home/user',
    harnesses: { omp: { path: null, version: null, ...overrides } },
  }
}

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return { ...DEFAULT_SETTINGS, ...overrides }
}

describe('OnboardingWizard', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  const render = (props: Partial<OnboardingWizardProps> = {}) => act(async () => {
    root.render(<OnboardingWizard
      meta={props.meta ?? meta()}
      settings={props.settings ?? settings()}
      hasProject={props.hasProject ?? false}
      onUpdateSettings={props.onUpdateSettings ?? (async () => undefined)}
      onRefreshHarnesses={props.onRefreshHarnesses ?? (async () => undefined)}
      onInstallOmp={props.onInstallOmp ?? (async () => ({ path: '/managed/bin/omp', version: 'v17.3.5' }))}
      onSubscribeInstallProgress={props.onSubscribeInstallProgress ?? (() => () => undefined)}
      onAddProject={props.onAddProject ?? (async () => null)}
      onOpenTerminal={props.onOpenTerminal ?? (() => undefined)}
      onOpenHarnessSettings={props.onOpenHarnessSettings ?? (() => undefined)}
      onFinish={props.onFinish ?? (() => undefined)}
    />)
  })

  function findButton(text: string): HTMLButtonElement {
    const button = [...document.body.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes(text))
    if (!button) throw new Error(`button "${text}" not found`)
    return button
  }

  it('walks welcome -> omp (already installed) -> workspace (existing project) -> approval -> login', async () => {
    const onUpdateSettings = vi.fn(async () => undefined)
    const onOpenTerminal = vi.fn()
    const onFinish = vi.fn()
    await render({ meta: meta({ path: '/usr/local/bin/omp', version: '17.3.5' }), hasProject: true, onUpdateSettings, onOpenTerminal, onFinish })

    expect(document.body.textContent).toContain('Welcome to WorkDaddy')
    await act(async () => findButton('Get started').click())

    expect(document.body.textContent).toContain('omp is installed')
    expect(document.body.textContent).toContain('/usr/local/bin/omp')
    await act(async () => findButton('Continue').click())

    expect(document.body.textContent).toContain('Choose a folder to work in')
    expect(document.body.textContent).toContain('You already have a project set up.')
    await act(async () => findButton('Continue').click())

    expect(document.body.textContent).toContain('How much should omp do on its own?')
    await act(async () => findButton('Continue').click())
    expect(onUpdateSettings).toHaveBeenCalledWith({ ompApprovalMode: 'always-ask' })

    expect(document.body.textContent).toContain('Sign in to omp')
    await act(async () => findButton('Open terminal and finish').click())
    expect(onOpenTerminal).toHaveBeenCalledOnce()
    expect(onFinish).toHaveBeenCalledOnce()
  })

  it('downloads omp, reports progress phases, and refreshes discovery on success', async () => {
    let progressCallback: ((phase: OmpInstallPhase) => void) | null = null
    const onInstallOmp = vi.fn(async () => {
      progressCallback?.('checking')
      progressCallback?.('downloading')
      progressCallback?.('verifying')
      progressCallback?.('installing')
      return { path: '/managed/bin/omp', version: 'v17.3.5' }
    })
    const onRefreshHarnesses = vi.fn(async () => undefined)
    await render({
      onInstallOmp,
      onRefreshHarnesses,
      onSubscribeInstallProgress: (callback) => { progressCallback = callback; return () => { progressCallback = null } },
    })

    await act(async () => findButton('Get started').click())
    expect(document.body.textContent).toContain('Install omp')
    await act(async () => findButton('Download and install').click())

    expect(onInstallOmp).toHaveBeenCalledOnce()
    expect(onRefreshHarnesses).toHaveBeenCalledOnce()
    expect(document.body.textContent).toContain('omp is installed.')
  })

  it('shows a manual-install fallback and lets the user retry after a failed download', async () => {
    const onInstallOmp = vi.fn(async (): Promise<InstalledOmp> => { throw new Error('Download failed: 503 Service Unavailable') })
    await render({ onInstallOmp })

    await act(async () => findButton('Get started').click())
    await act(async () => findButton('Download and install').click())

    expect(document.body.textContent).toContain('Download failed: 503 Service Unavailable')
    expect(document.body.textContent).toContain('curl -fsSL https://omp.sh/install')
    expect(document.body.querySelector('button')).not.toBeNull()

    onInstallOmp.mockImplementationOnce(async () => ({ path: '/managed/bin/omp', version: 'v17.3.5' }))
    await act(async () => findButton('Try again').click())
    expect(document.body.textContent).toContain('omp is installed.')
  })

  it('lets the user open harness settings instead of downloading', async () => {
    const onOpenHarnessSettings = vi.fn()
    await render({ onOpenHarnessSettings })
    await act(async () => findButton('Get started').click())
    await act(async () => findButton('I already have omp').click())
    expect(onOpenHarnessSettings).toHaveBeenCalledOnce()
  })

  it('advances past the workspace step only when a folder was actually chosen', async () => {
    const onAddProject = vi.fn(async (): Promise<ProjectRecord | null> => null)
    await render({ meta: meta({ path: '/usr/local/bin/omp' }), onAddProject })
    await act(async () => findButton('Get started').click())
    await act(async () => findButton('Continue').click())

    expect(document.body.textContent).toContain('Choose a folder to work in')
    await act(async () => findButton('Choose a folder').click())
    expect(onAddProject).toHaveBeenCalledOnce()
    expect(document.body.textContent).toContain('Choose a folder to work in')

    onAddProject.mockResolvedValueOnce({ id: 'p1', name: 'demo', path: '/demo', folders: ['/demo'], primaryFolder: '/demo', sessionCount: 0, createdAt: '2026-01-01T00:00:00.000Z', lastOpenedAt: '2026-01-01T00:00:00.000Z', harness: 'omp', pinned: false, inferred: false })
    await act(async () => findButton('Choose a folder').click())
    expect(document.body.textContent).toContain('How much should omp do on its own?')
  })

  it('finishes without opening the terminal when the user defers login', async () => {
    const onOpenTerminal = vi.fn()
    const onFinish = vi.fn()
    await render({ meta: meta({ path: '/usr/local/bin/omp' }), hasProject: true, onOpenTerminal, onFinish })
    await act(async () => findButton('Get started').click())
    await act(async () => findButton('Continue').click())
    await act(async () => findButton('Continue').click())
    await act(async () => findButton('Continue').click())

    await act(async () => findButton("I'll do this later").click())
    expect(onOpenTerminal).not.toHaveBeenCalled()
    expect(onFinish).toHaveBeenCalledOnce()
  })

  it('finishes immediately from any step via Skip setup', async () => {
    const onFinish = vi.fn()
    await render({ onFinish })
    await act(async () => findButton('Skip setup').click())
    expect(onFinish).toHaveBeenCalledOnce()
  })
})
