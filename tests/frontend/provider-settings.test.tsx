// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useProviderCatalog } from '../../src/hooks/useProviderCatalog'
import { ProviderSettings } from '../../src/pages/settings/ProviderSettings'
import type { CreateOmpProviderDraft, DiscoveredModel, DiscoverOmpModelsInput, HarnessId, OmpModelsSnapshot, PrimeModelCatalog, PrimeWorkApi, RuntimeInfo, SaveOmpProviderDraft } from '../../src/types/api'

vi.mock('../../src/components/ui', () => ({
  Modal: ({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) => <div role="dialog" aria-label={title}>{children}{footer}</div>,
}))

const model = {
  key: 'openai-codex/gpt-5.6', provider: 'openai-codex', id: 'gpt-5.6', name: 'GPT-5.6', reasoning: true,
  input: ['text'] as const, contextWindow: 400_000, maxTokens: 128_000,
  availableThinkingLevels: ['low', 'medium', 'high'] as const, fastModeSupported: true, available: true,
}
const catalog: PrimeModelCatalog = {
  primeVersion: '0.7.0',
  refreshedAt: '2026-08-06T00:00:00.000Z',
  models: [
    { ...model, key: 'anthropic/claude-sonnet', provider: 'anthropic', id: 'claude-sonnet', name: 'Claude Sonnet', input: [...model.input], availableThinkingLevels: ['low', 'high'], enabled: false },
    { ...model, key: 'openai-codex/gpt-5.5', id: 'gpt-5.5', name: 'GPT-5.5', input: [...model.input], availableThinkingLevels: ['low', 'high'], enabled: false },
    { ...model, input: [...model.input], availableThinkingLevels: [...model.availableThinkingLevels], enabled: true },
  ],
  providers: [
    { id: 'anthropic', name: 'Anthropic', authMethod: 'external', configured: false, modelCount: 14, availableModelCount: 0, enabled: false },
    { id: 'openai-codex', name: 'OpenAI Codex', authMethod: 'external', configured: true, authSource: 'stored', modelCount: 8, availableModelCount: 8, enabled: true },
  ],
}
const runtime: RuntimeInfo = {
  runtimeId: 'runtime-1', harness: 'omp', cwd: '/tmp/project', isStreaming: false,
  model: { provider: model.provider, id: model.id, name: model.name },
  thinkingLevel: 'medium', serviceTier: 'default',
}
const noop = async () => undefined
const emptySnapshot = (): OmpModelsSnapshot => ({
  rows: [],
  availableCatalog: [
    { id: 'deepseek', displayName: 'DeepSeek', defaultModel: 'deepseek/deepseek-chat' },
    { id: 'anthropic', displayName: 'Anthropic', defaultModel: 'anthropic/claude-sonnet-4-5' },
  ],
})
const configuredSnapshot = (): OmpModelsSnapshot => ({
  rows: [
    { id: 'deepseek', displayName: 'DeepSeek', kind: 'catalog', configured: true, keylessAuth: false, removable: true, baseUrl: 'https://api.deepseek.com', modelsOverridden: false, models: [] },
  ],
  availableCatalog: [
    { id: 'anthropic', displayName: 'Anthropic', defaultModel: 'anthropic/claude-sonnet-4-5' },
  ],
})

function settingsProps(overrides: Partial<{
  catalog: PrimeModelCatalog | null
  onRefresh(): Promise<void>
  onList(): Promise<OmpModelsSnapshot>
  onSave(draft: SaveOmpProviderDraft): Promise<OmpModelsSnapshot>
  onCreate(draft: CreateOmpProviderDraft): Promise<OmpModelsSnapshot>
  onDelete(id: string): Promise<OmpModelsSnapshot>
  onDiscover(input: DiscoverOmpModelsInput): Promise<readonly DiscoveredModel[]>
}> = {}) {
  const snapshot = configuredSnapshot()
  return {
    catalog,
    onRefresh: overrides.onRefresh ?? noop,
    onSetEnabled: noop,
    onSetAllEnabled: noop,
    onSetAllDisabled: noop,
    onSetModelEnabled: noop,
    onListModelProviders: overrides.onList ?? (async () => snapshot),
    onSaveProvider: overrides.onSave ?? (async () => snapshot),
    onCreateCustomProvider: overrides.onCreate ?? (async () => snapshot),
    onDeleteCustomProvider: overrides.onDelete ?? (async () => snapshot),
    onDiscoverModels: overrides.onDiscover ?? (async () => []),
    onOpenDocs: () => undefined,
  }
}
let root: Root
let container: HTMLDivElement

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

async function render(node: ReactNode) {
  await act(async () => { root.render(node) })
  await act(async () => { await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
}

function button(label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll('button')].find((item) => item.textContent?.includes(label))
  if (!match) throw new Error(`Button not found: ${label}`)
  return match as HTMLButtonElement
}

async function click(element: HTMLElement) {
  await act(async () => { element.click() })
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => { resolve = nextResolve; reject = nextReject })
  return { promise, resolve, reject }
}

describe('provider settings behavior and accessibility', () => {
  it('shows an empty state and add-provider actions when nothing is configured', async () => {
    await render(<ProviderSettings {...settingsProps({ onList: async () => emptySnapshot() })} />)
    expect(container.querySelector('input[type="password"]')).toBeNull()
    expect(container.textContent).toContain('No providers yet')
    expect(container.textContent).toContain('Add provider')
    expect(container.textContent).toContain('Add custom provider')
    expect(container.querySelector('.settings-group__heading')).not.toBeNull()
    expect(button('Add provider').className).toContain('button--compact')
    expect(button('Add custom provider').className).toContain('button--compact')
    expect(button('Add provider').className).not.toContain('button--primary')
  })

  it('lists catalog vendors as rows instead of stacked action buttons', async () => {
    await render(<ProviderSettings {...settingsProps({ onList: async () => emptySnapshot() })} />)
    await click(button('Add provider'))
    expect(container.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Add a provider')
    const items = [...container.querySelectorAll('.models-catalog-pick__item')] as HTMLButtonElement[]
    expect(items.map((item) => item.getAttribute('aria-label'))).toEqual(['DeepSeek', 'Anthropic'])
    expect(items.every((item) => !item.classList.contains('button'))).toBe(true)
    await click(items[1])
    expect(container.querySelector('.models-card')).not.toBeNull()
    expect(container.querySelector('input[type="password"]')).not.toBeNull()
    expect(container.textContent).not.toContain('Add custom provider')
  })

  it('lists catalog rows with status dots and only one editor at a time', async () => {
    await render(<ProviderSettings {...settingsProps()} />)
    expect(container.querySelectorAll('.models-row')).toHaveLength(1)
    expect(container.textContent).toContain('DeepSeek')
    expect(container.textContent).toContain('Add custom provider')
    await click(button('Edit'))
    expect(container.querySelectorAll('.models-card')).toHaveLength(1)
    expect(container.querySelector('input[type="password"]')).not.toBeNull()
    expect(container.textContent).not.toContain('Add custom provider')
  })

  it('saves a key onto the edited catalog row without sending it to discover until asked', async () => {
    const onSave = vi.fn(async (draft: SaveOmpProviderDraft) => {
      expect(draft).toMatchObject({ providerId: 'deepseek', apiKey: 'sk-settings-test' })
      return configuredSnapshot()
    })
    const onDiscover = vi.fn(async () => [])
    const onRefresh = vi.fn(async () => undefined)
    await render(<ProviderSettings {...settingsProps({ onSave, onDiscover, onRefresh, onList: async () => configuredSnapshot() })} />)
    await click(button('Edit'))
    const input = container.querySelector('input[type="password"]') as HTMLInputElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, 'sk-settings-test')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(button('Save'))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'deepseek', apiKey: 'sk-settings-test' }))
    expect(onDiscover).not.toHaveBeenCalled()
    expect(onRefresh).toHaveBeenCalled()
  })

  it('opens the custom provider card and validates a taken id', async () => {
    await render(<ProviderSettings {...settingsProps()} />)
    await click(button('Add custom provider'))
    expect(container.textContent).toContain('Custom provider')
    const idInput = [...container.querySelectorAll('input')].find((item) => item.getAttribute('type') !== 'password') as HTMLInputElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(idInput, 'deepseek')
      idInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(button('Create provider'))
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/already uses this ID/i)
  })

  it('saves an empty key as keep-stored and does not fetch until asked', async () => {
    const onSave = vi.fn(async (draft: SaveOmpProviderDraft) => {
      expect(draft.apiKey).toBeUndefined()
      return configuredSnapshot()
    })
    const onDiscover = vi.fn(async () => [{ id: 'deepseek-v4-flash', name: 'Flash' }])
    await render(<ProviderSettings {...settingsProps({ onSave, onDiscover })} />)
    await click(button('Edit'))
    await click(button('Save'))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'deepseek' }))
    expect(onDiscover).not.toHaveBeenCalled()

    await click(button('Edit'))
    await click(button('Custom settings'))
    await click(button('Fetch available models'))
    expect(onDiscover).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'deepseek' }))
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('names the provider in the delete confirmation', async () => {
    const customSnapshot = (): OmpModelsSnapshot => ({
      rows: [
        ...configuredSnapshot().rows,
        { id: 'my-gateway', displayName: 'Acme', kind: 'custom', configured: true, keylessAuth: false, removable: true, baseUrl: 'https://gateway.example/v1', modelsOverridden: true, models: [{ id: 'acme-think' }] },
      ],
      availableCatalog: configuredSnapshot().availableCatalog,
    })
    const onDelete = vi.fn(async (id: string) => {
      expect(id).toBe('my-gateway')
      return configuredSnapshot()
    })
    await render(<ProviderSettings {...settingsProps({ onList: async () => customSnapshot(), onDelete })} />)
    const removeButtons = [...container.querySelectorAll('button')].filter((item) => item.textContent?.includes('Remove'))
    expect(removeButtons).toHaveLength(2)
    await click(removeButtons[1] as HTMLButtonElement)
    expect(container.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Remove Acme?')
    expect(container.textContent).toContain('Removing Acme drops its configuration and stored API key.')
    await click(button('Remove Acme'))
    expect(onDelete).toHaveBeenCalledWith('my-gateway')
  })
})

describe('provider runtime mutations', () => {
  function mountCatalogHook(options: {
    command: PrimeWorkApi['agent']['command']
    syncRuntime?: (runtimeId: string) => Promise<void>
    setEnabled?: PrimeWorkApi['providers']['setEnabled']
    setDisabled?: PrimeWorkApi['providers']['setDisabled']
    harness?: HarnessId
    reportError?: (error: unknown) => void
  }) {
    let value: ReturnType<typeof useProviderCatalog> | undefined
    const catalogMock = vi.fn().mockResolvedValue(catalog)
    const bridge = {
      agent: { command: options.command },
      providers: {
        catalog: catalogMock,
        setEnabled: options.setEnabled ?? vi.fn().mockResolvedValue(catalog),
        setDisabled: options.setDisabled ?? vi.fn().mockResolvedValue(catalog),
      },
    } as unknown as PrimeWorkApi
    const syncRuntime = options.syncRuntime ?? vi.fn().mockResolvedValue(undefined)
    const reportError = options.reportError ?? vi.fn()
    function Harness() {
      value = useProviderCatalog({ bridge, harness: options.harness, runtime, syncRuntime, reportError, t: (key) => key })
      return null
    }
    return render(<Harness />).then(() => ({ get value() { return value! }, catalogMock, syncRuntime, setDisabled: bridge.providers.setDisabled, reportError }))
  }

  it('serializes rapid reasoning changes and rolls back/synchronizes the latest rejection', async () => {
    const first = deferred<Record<string, unknown>>()
    const second = deferred<Record<string, unknown>>()
    const command = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const hook = await mountCatalogHook({ command })

    act(() => { hook.value.changeEffort('low'); hook.value.changeEffort('high') })
    await act(async () => { await Promise.resolve() })
    expect(command).toHaveBeenCalledTimes(1)
    expect(hook.value.effort).toBe('high')

    await act(async () => { first.resolve({}); await first.promise; await Promise.resolve() })
    expect(command).toHaveBeenCalledTimes(2)
    expect(hook.syncRuntime).not.toHaveBeenCalled()

    await act(async () => { second.reject(new Error('thinking rejected')); try { await second.promise } catch { /* expected */ }; await Promise.resolve() })
    expect(hook.value.effort).toBe('low')
    expect(hook.syncRuntime).toHaveBeenCalledWith('runtime-1')
    expect(hook.reportError).toHaveBeenCalledWith(expect.objectContaining({ message: 'thinking rejected' }))
  })

  it('rolls model state back and synchronizes after a rejected model command', async () => {
    const rejected = deferred<Record<string, unknown>>()
    const command = vi.fn().mockReturnValueOnce(rejected.promise)
    const hook = await mountCatalogHook({ command })

    act(() => hook.value.changeModel('openai-codex/gpt-5.5'))
    expect(hook.value.model).toBe('openai-codex/gpt-5.5')
    await act(async () => { rejected.reject(new Error('model rejected')); try { await rejected.promise } catch { /* expected */ }; await Promise.resolve() })

    expect(hook.value.model).toBe('openai-codex/gpt-5.6')
    expect(hook.value.effort).toBe('medium')
    expect(hook.syncRuntime).toHaveBeenCalledWith('runtime-1')
    expect(command).toHaveBeenCalledTimes(1)
  })

  it('accepts main-owned provider enable persistence without writing settings again', async () => {
    const next = { ...catalog, providers: catalog.providers.map((provider) => provider.id === 'anthropic' ? { ...provider, enabled: true } : provider) }
    const setEnabled = vi.fn().mockResolvedValue(next)
    const hook = await mountCatalogHook({ command: vi.fn(), setEnabled })

    await act(async () => { await hook.value.setEnabled('anthropic', true) })
    expect(setEnabled).toHaveBeenCalledWith('anthropic', true, 'omp')
    expect(hook.value.catalog?.providers.find((provider) => provider.id === 'anthropic')?.enabled).toBe(true)
  })

  it('enables every provider with one atomic main-process mutation', async () => {
    const hook = await mountCatalogHook({ command: vi.fn() })

    await act(async () => { await hook.value.setAllEnabled() })
    expect(hook.setDisabled).toHaveBeenCalledWith([], 'omp')
  })

  it('keeps an optimistic fast-mode toggle across a catalog refresh', async () => {
    const hook = await mountCatalogHook({ command: vi.fn().mockResolvedValue({}) })
    await act(async () => { await Promise.resolve() })

    act(() => hook.value.changeFast(true))
    expect(hook.value.fast).toBe(true)

    // A refresh returns a new catalog object; the runtime's stale serviceTier must not revert the toggle.
    hook.catalogMock.mockResolvedValue({ ...catalog })
    await act(async () => { await hook.value.refresh(true) })

    expect(hook.value.fast).toBe(true)
  })

  it('disables every provider and clears an explicitly selected model in one atomic mutation', async () => {
    const hook = await mountCatalogHook({ command: vi.fn() })
    await act(async () => { await Promise.resolve() })

    await act(async () => { await hook.value.setAllDisabled() })
    expect(hook.setDisabled).toHaveBeenCalledWith(['anthropic', 'openai-codex'], 'omp')
    expect(hook.value.model).toBe('auto')
    expect(hook.value.fast).toBe(false)
  })
})
