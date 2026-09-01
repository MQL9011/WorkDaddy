// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Sidebar } from '../../src/components/Sidebar'
import { useAgentEvents } from '../../src/hooks/useAgentEvents'
import { useBootstrap } from '../../src/hooks/useBootstrap'
import { useProviderCatalog } from '../../src/hooks/useProviderCatalog'
import { DEFAULT_SETTINGS } from '../../src/lib/data'
import { AgentSettings } from '../../src/pages/settings/AgentSettings'
import { ProviderSettings } from '../../src/pages/settings/ProviderSettings'
import { SettingsPage } from '../../src/pages/SettingsPage'
import type { AppMeta, AppSettings, HarnessId, PrimeModelCatalog, PrimeWorkApi, ProjectRecord, RuntimeInfo, SessionRecord } from '../../src/types/api'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

const ompProject: ProjectRecord = {
  id: 'omp-project', harness: 'omp', name: 'OMP project', path: '/omp', folders: ['/omp'], primaryFolder: '/omp', pinned: false,
  createdAt: '2026-01-01T00:00:00.000Z', lastOpenedAt: '2026-01-01T00:00:00.000Z', sessionCount: 1,
}
const ompSession: SessionRecord = {
  id: 'omp-session', harness: 'omp', projectPath: '/omp', filePath: '/omp-sessions/current.jsonl', title: 'OMP session',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', status: 'idle', depth: 0,
}
const backgroundRuntime: RuntimeInfo = { runtimeId: 'background-runtime', harness: 'omp', cwd: '/omp', sessionFile: '/omp-sessions/background.jsonl', isStreaming: false }
const ompRuntime: RuntimeInfo = { runtimeId: 'omp-runtime', harness: 'omp', cwd: '/omp', sessionFile: ompSession.filePath, isStreaming: false }

const meta: AppMeta = {
  version: '1', platform: 'darwin', homeDir: '/Users/you',
  harnesses: { omp: { path: '/usr/local/bin/omp', version: '17.2.11' } },
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

function Probe({ children }: { children?: ReactNode }) { return <>{children}</> }

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

describe('bootstrap startup', () => {
  function makeBridge() {
    const projectsList = vi.fn(async (_harness?: HarnessId) => [ompProject])
    const sessionsList = vi.fn(async (_projectPath?: string, _includeArchived?: boolean, _harness?: HarnessId) => [ompSession])
    const agentList = vi.fn(async () => [ompRuntime])
    const bridge = {
      projects: { list: projectsList },
      sessions: { list: sessionsList, onChanged: () => () => undefined },
      agent: { list: agentList },
      app: { getMeta: async () => meta },
    } as unknown as PrimeWorkApi
    return { bridge, projectsList, sessionsList, agentList }
  }

  function makeWorkspace() {
    const workspaceRef = { current: { generation: 0 } as { generation: number; project?: ProjectRecord; session?: SessionRecord; cwd?: string; sessionFile?: string } }
    const activated: Array<{ project?: ProjectRecord; session?: SessionRecord }> = []
    const attached: RuntimeInfo[] = []
    const activateWorkspace = (project?: ProjectRecord, session?: SessionRecord) => {
      const generation = workspaceRef.current.generation + 1
      workspaceRef.current = { generation, project, session, cwd: project?.primaryFolder, sessionFile: session?.filePath }
      activated.push({ project, session })
      return generation
    }
    const attachRuntime = (runtime?: RuntimeInfo) => { if (runtime) attached.push(runtime) }
    return { workspaceRef, activated, attached, activateWorkspace, attachRuntime }
  }

  it('waits for persisted settings before querying', async () => {
    const { bridge, projectsList, sessionsList, agentList } = makeBridge()
    const workspace = makeWorkspace()
    const props = {
      setProjects: vi.fn(),
      setSessions: vi.fn(),
      runtimeSessionsRef: { current: new Map<string, string>() },
      workspaceRef: workspace.workspaceRef,
      activateWorkspace: workspace.activateWorkspace,
      attachRuntime: workspace.attachRuntime,
      reportError: vi.fn(),
    }
    function BootstrapProbe({ ready }: { ready: boolean }) {
      useBootstrap({ bridge, ready, harness: 'omp', ...props })
      return <Probe />
    }

    await act(async () => { root.render(<BootstrapProbe ready={false} />); await Promise.resolve() })
    expect(projectsList).not.toHaveBeenCalled()
    expect(sessionsList).not.toHaveBeenCalled()
    expect(agentList).not.toHaveBeenCalled()

    await act(async () => { root.render(<BootstrapProbe ready />); await Promise.resolve(); await Promise.resolve() })
    expect(projectsList).toHaveBeenCalledWith('omp')
    expect(sessionsList).toHaveBeenCalledWith(undefined, true, 'omp')
    expect(agentList).toHaveBeenCalledTimes(1)
  })

  it('activates the startup workspace and attaches its runtime', async () => {
    const { bridge, projectsList, sessionsList } = makeBridge()
    const workspace = makeWorkspace()
    const setProjects = vi.fn()
    const setSessions = vi.fn()
    const reportError = vi.fn()
    const runtimeSessionsRef = { current: new Map<string, string>() }
    function BootstrapProbe() {
      useBootstrap({
        bridge, harness: 'omp',
        setProjects, setSessions,
        runtimeSessionsRef, workspaceRef: workspace.workspaceRef,
        activateWorkspace: workspace.activateWorkspace, attachRuntime: workspace.attachRuntime,
        reportError,
      })
      return <Probe />
    }
    await act(async () => { root.render(<BootstrapProbe />); await Promise.resolve(); await Promise.resolve() })
    expect(projectsList).toHaveBeenLastCalledWith('omp')
    expect(sessionsList).toHaveBeenLastCalledWith(undefined, true, 'omp')
    expect(workspace.activated).toEqual([{ project: ompProject, session: ompSession }])
    await act(async () => { await Promise.resolve() })
    expect(workspace.attached).toEqual([ompRuntime])
  })

  it('skips the startup activation when the user changes the workspace mid-fetch', async () => {
    const projects = deferred<ProjectRecord[]>()
    const bridge = {
      projects: { list: vi.fn(() => projects.promise) },
      sessions: { list: async () => [ompSession], onChanged: () => () => undefined },
      agent: { list: async () => [] },
      app: { getMeta: async () => meta },
    } as unknown as PrimeWorkApi
    const workspace = makeWorkspace()
    const setProjects = vi.fn()
    const setSessions = vi.fn()
    const reportError = vi.fn()
    const runtimeSessionsRef = { current: new Map<string, string>() }
    function BootstrapProbe() {
      useBootstrap({
        bridge, harness: 'omp',
        setProjects, setSessions,
        runtimeSessionsRef, workspaceRef: workspace.workspaceRef,
        activateWorkspace: workspace.activateWorkspace, attachRuntime: workspace.attachRuntime,
        reportError,
      })
      return <Probe />
    }
    await act(async () => { root.render(<BootstrapProbe />) })
    const activationsBeforeResolve = workspace.activated.length
    // The user activates something else while the startup catalog is in flight.
    act(() => { workspace.activateWorkspace(ompProject) })
    await act(async () => { projects.resolve([ompProject]); await projects.promise; await Promise.resolve(); await Promise.resolve() })
    expect(workspace.activated.length).toBe(activationsBeforeResolve + 1)
  })

  it('only refreshes the session catalog for matching sessions:changed events', async () => {
    let onChangedCallback: ((event: { filePath?: string; harness?: HarnessId }) => void) | undefined
    const sessionsList = vi.fn(async (_p?: string, _a?: boolean, _harness?: HarnessId) => [ompSession])
    const bridge = {
      projects: { list: async () => [ompProject] },
      sessions: {
        list: sessionsList,
        onChanged: (callback: typeof onChangedCallback) => { onChangedCallback = callback; return () => undefined },
      },
      agent: { list: async () => [] },
      app: { getMeta: async () => meta },
    } as unknown as PrimeWorkApi
    const workspace = makeWorkspace()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const setProjects = vi.fn()
      const setSessions = vi.fn()
      const reportError = vi.fn()
      const runtimeSessionsRef = { current: new Map<string, string>() }
      function BootstrapProbe() {
        useBootstrap({
          bridge, harness: 'omp',
          setProjects, setSessions,
          runtimeSessionsRef, workspaceRef: workspace.workspaceRef,
          activateWorkspace: workspace.activateWorkspace, attachRuntime: workspace.attachRuntime,
          reportError,
        })
        return <Probe />
      }
      await act(async () => { root.render(<BootstrapProbe />); await Promise.resolve(); await Promise.resolve() })
      const listCalls = sessionsList.mock.calls.length
      // Events predating harness scoping still resolve to the active (omp) harness.
      act(() => { onChangedCallback?.({ filePath: ompSession.filePath, harness: 'omp' }) })
      await act(async () => { vi.advanceTimersByTime(200); await Promise.resolve() })
      expect(sessionsList.mock.calls.length).toBe(listCalls + 1)
      expect(sessionsList).toHaveBeenLastCalledWith(undefined, true, 'omp')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('inactive runtime event isolation', () => {
  it('keeps events from a background runtime away from visible state', async () => {
    let handler!: (payload: { runtimeId: string; event: Record<string, unknown> }) => void
    const bridge = {
      agent: { onEvent: (callback: typeof handler) => { handler = callback; return () => undefined } },
    } as unknown as PrimeWorkApi
    const setSessions = vi.fn()
    const setRuntime = vi.fn()
    const queueAgentEvent = vi.fn()
    const reconcileTranscriptForEvent = vi.fn()
    // The workspace shows one session; another runtime keeps streaming in
    // the background with its own session file still registered.
    const runtimeSessionsRef = { current: new Map([[backgroundRuntime.runtimeId, '/omp-sessions/background.jsonl']]) }
    function AgentEventsProbe() {
      useAgentEvents({
        bridge,
        runtimeIdRef: { current: ompRuntime.runtimeId },
        runtimeSessionsRef,
        runtimeOwnerRef: { current: { runtimeId: ompRuntime.runtimeId, generation: 1 } },
        workspaceRef: { current: { generation: 1, sessionFile: ompSession.filePath, cwd: '/omp' } },
        setSessions,
        setRuntime,
        queueAgentEvent,
        reconcileTranscriptForEvent,
        showExtensionUi: vi.fn(),
        clearExtensionUi: vi.fn(),
        refreshGit: vi.fn(async () => undefined),
        refreshGitOnTerminalEvent: true,
        activeSessionVisible: true,
      })
      return <Probe />
    }
    await act(async () => { root.render(<AgentEventsProbe />) })
    act(() => {
      handler({ runtimeId: backgroundRuntime.runtimeId, event: { type: 'agent_start' } })
      handler({ runtimeId: backgroundRuntime.runtimeId, event: { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'x' } } })
      handler({ runtimeId: backgroundRuntime.runtimeId, event: { type: 'agent_end' } })
    })
    // Lifecycle updates only touch records whose filePath matches; the visible
    // catalog has none, so the session list is unchanged.
    for (const [updater] of setSessions.mock.calls) {
      expect((updater as (sessions: SessionRecord[]) => SessionRecord[])([ompSession])).toEqual([ompSession])
    }
    expect(setRuntime).not.toHaveBeenCalled()
    expect(queueAgentEvent).not.toHaveBeenCalled()
    expect(reconcileTranscriptForEvent).not.toHaveBeenCalled()

    // The visible runtime's own events still update state.
    act(() => { handler({ runtimeId: ompRuntime.runtimeId, event: { type: 'agent_start' } }) })
    expect(setRuntime).toHaveBeenCalled()
    expect(queueAgentEvent).toHaveBeenCalledTimes(1)
  })
})

describe('sidebar brand', () => {
  const noop = () => undefined
  function renderSidebar() {
    return act(async () => {
      root.render(
        <Sidebar
          projects={[ompProject]}
          sessions={[ompSession]}
          activeView="session"
          activeHarness="omp"
          onSelectProject={noop}
          onSelectSession={noop}
          onNavigate={noop}
          onNewSession={noop}
          onAddProject={noop}
          onRemoveProject={noop}
          onClose={noop}
          onOpenPalette={noop}
          onRenameSession={async () => undefined}
          onArchiveSession={async () => undefined}
        />,
      )
    })
  }

  it('shows the active harness as a static, non-interactive label', async () => {
    await renderSidebar()

    expect(container.textContent).toContain('Capabilities')
    expect(container.querySelector('.brand-switcher__trigger')).toBeNull()
    const brand = container.querySelector('.sidebar__brand')
    expect(brand).not.toBeNull()
    expect(brand!.tagName).toBe('DIV')
    expect(brand!.textContent).toContain('OMP')
    expect(brand!.querySelector('button')).toBeNull()
  })
})

describe('provider catalog', () => {
  const ompCatalog: PrimeModelCatalog = {
    primeVersion: '17.2.11', refreshedAt: '2026-08-06T00:00:00.000Z',
    models: [{ key: 'openai-codex/gpt-5.6-luna', provider: 'openai-codex', id: 'gpt-5.6-luna', name: 'Luna GPT-5.6', reasoning: true, input: ['text', 'image'], contextWindow: 400_000, maxTokens: 128_000, availableThinkingLevels: ['low', 'medium', 'high'], fastModeSupported: false, available: true }],
    providers: [{ id: 'openai-codex', name: 'OpenAI Codex', authMethod: 'external', configured: true, authLabel: 'Credentials managed by the omp CLI', modelCount: 1, availableModelCount: 1, enabled: true }],
  }

  it('waits for persisted settings before loading a provider catalog', async () => {
    const catalog = vi.fn(async () => ompCatalog)
    const bridge = {
      providers: { catalog },
    } as unknown as PrimeWorkApi
    const reportError = vi.fn()
    function CatalogProbe({ ready }: { ready: boolean }) {
      useProviderCatalog({ bridge, ready, harness: 'omp', runtime: null, syncRuntime: async () => undefined, reportError, t: (key) => key })
      return <Probe />
    }

    await act(async () => { root.render(<CatalogProbe ready={false} />); await Promise.resolve() })
    expect(catalog).not.toHaveBeenCalled()
    await act(async () => { root.render(<CatalogProbe ready />); await Promise.resolve() })
    expect(catalog).toHaveBeenCalledWith(false, 'omp')
  })

  it('loads the catalog and updates the model selection', async () => {
    const catalogMock = vi.fn().mockResolvedValueOnce(ompCatalog)
    const bridge = {
      providers: { catalog: catalogMock },
    } as unknown as PrimeWorkApi
    let state!: ReturnType<typeof useProviderCatalog>
    const syncRuntime = async () => undefined
    const reportError = vi.fn()
    function CatalogProbe() {
      state = useProviderCatalog({ bridge, harness: 'omp', runtime: null, syncRuntime, reportError, t: (key) => key })
      return <Probe />
    }
    await act(async () => { root.render(<CatalogProbe />); await Promise.resolve() })
    expect(catalogMock).toHaveBeenCalledWith(false, 'omp')
    expect(state.catalog).toBe(ompCatalog)

    act(() => state.changeModel('openai-codex/gpt-5.6-luna'))
    expect(state.model).toBe('openai-codex/gpt-5.6-luna')
  })
})

describe('harness settings surfaces', () => {
  it('follows a changed initial section while the settings page stays mounted', async () => {
    const noop = () => undefined
    const noopAsync = async () => undefined
    const renderSettings = (initialSection: 'general' | 'agent', initialSectionRequestId = 0) => (
      <SettingsPage
        settings={DEFAULT_SETTINGS}
        meta={meta}
        providerCatalog={null}
        initialSection={initialSection}
        initialSectionRequestId={initialSectionRequestId}
        onUpdate={noop}
        onResetBrowser={noop}
        onOpenDocs={noop}
        onRefreshProviders={noopAsync}
        onRefreshHarnesses={noopAsync}
        onSetProviderEnabled={noopAsync}
        onSetAllProvidersEnabled={noopAsync}
        onSetAllProvidersDisabled={noopAsync}
        onSetModelEnabled={noopAsync}
      />
    )

    await act(async () => { root.render(renderSettings('general')) })
    expect(container.querySelector('h1')?.textContent).toBe('General')
    await act(async () => { root.render(renderSettings('agent')); await Promise.resolve() })
    expect(container.querySelector('h1')?.textContent).toBe('Harness')
    expect(container.querySelector('.settings-nav .is-active')?.textContent).toContain('Harness')

    await click([...container.querySelectorAll<HTMLButtonElement>('.settings-nav button')].find((button) => button.textContent?.includes('General'))!)
    expect(container.querySelector('h1')?.textContent).toBe('General')
    await act(async () => { root.render(renderSettings('agent', 1)); await Promise.resolve() })
    expect(container.querySelector('h1')?.textContent).toBe('Harness')
  })

  it('shows the single omp harness and its approval mode', async () => {
    const onUpdate = vi.fn()
    const onRefreshHarnesses = vi.fn(async () => undefined)
    const settings: AppSettings = { ...DEFAULT_SETTINGS, activeHarness: 'omp' }
    await act(async () => { root.render(<AgentSettings settings={settings} meta={meta} onUpdate={onUpdate} onRefreshHarnesses={onRefreshHarnesses} />) })
    expect(container.textContent).toContain('Default harness')
    expect(container.textContent).toContain('OMP approval mode')
    expect(container.textContent).toContain('OMP is ready')
    expect([...container.querySelectorAll<HTMLSelectElement>('select')[0].options].map((option) => option.textContent)).toEqual(['OMP Work'])

    const refresh = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes('Refresh harnesses'))!
    await click(refresh)
    expect(onRefreshHarnesses).toHaveBeenCalledTimes(1)

    const selects = [...container.querySelectorAll<HTMLSelectElement>('select')]
    expect(selects).toHaveLength(2)
    const approvalSelect = selects[1]
    expect([...approvalSelect.options].map((option) => option.textContent)).toEqual([
      'Inherit omp config',
      'Always ask',
      'Prompt for exec only (write)',
      'YOLO (never prompt)',
    ])
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(approvalSelect, 'write')
      approvalSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(onUpdate).toHaveBeenCalledWith({ ompApprovalMode: 'write' })
  })

  it('renders OMP provider toggles while keeping credentials CLI-owned', async () => {
    const catalog: PrimeModelCatalog = {
      primeVersion: '17.2.11', refreshedAt: '2026-08-06T00:00:00.000Z',
      models: [{ key: 'openai-codex/gpt-5.6-luna', provider: 'openai-codex', id: 'gpt-5.6-luna', name: 'Luna GPT-5.6', reasoning: true, input: ['text'], contextWindow: 400_000, maxTokens: 128_000, availableThinkingLevels: ['low', 'high'], fastModeSupported: false, available: true }],
      providers: [
        { id: 'openai-codex', name: 'OpenAI Codex', authMethod: 'external', configured: true, authLabel: 'Credentials managed by the omp CLI', modelCount: 1, availableModelCount: 1, enabled: true },
        { id: 'anthropic', name: 'Anthropic', authMethod: 'external', configured: true, modelCount: 0, availableModelCount: 0, enabled: true },
      ],
    }
    const noopAsync = async () => undefined
    await act(async () => {
      root.render(<ProviderSettings harness="omp" catalog={catalog} onRefresh={noopAsync} onSetEnabled={noopAsync} onSetAllEnabled={noopAsync} onSetAllDisabled={noopAsync} onSetModelEnabled={noopAsync} onOpenDocs={() => undefined} />)
    })

    expect(container.textContent).toContain('OMP catalogue')
    expect(container.textContent).toContain('Credentials managed by the omp CLI')
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(2)
    const buttonLabels = [...container.querySelectorAll('button')].map((button) => button.textContent ?? '')
    expect(buttonLabels.some((text) => text.includes('Hide all'))).toBe(true)
    expect(buttonLabels.some((text) => text.includes('Credential setup'))).toBe(true)
    for (const label of ['Connect', 'Reconnect', 'Add key', 'Replace key']) {
      expect(buttonLabels.some((text) => text.includes(label))).toBe(false)
    }
  })
})
