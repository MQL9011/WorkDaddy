// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Composer } from '../../src/components/Composer'
import type { PrimeModelDescriptor, PrimeProviderDescriptor, PrimeThinkingLevel } from '../../src/types/api'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const providers: PrimeProviderDescriptor[] = [
  { id: 'anthropic', name: 'Anthropic', authMethod: 'api_key', configured: true, modelCount: 2, availableModelCount: 2, enabled: true },
  { id: 'openai', name: 'OpenAI', authMethod: 'api_key', configured: false, modelCount: 1, availableModelCount: 0, enabled: true },
]

function model(overrides: Partial<PrimeModelDescriptor>): PrimeModelDescriptor {
  return {
    key: 'anthropic:sonnet',
    provider: 'anthropic',
    id: 'sonnet',
    name: 'Sonnet 5',
    reasoning: true,
    input: ['text'],
    contextWindow: 200000,
    maxTokens: 8192,
    availableThinkingLevels: ['off', 'medium', 'high'],
    fastModeSupported: true,
    available: true,
    ...overrides,
  }
}

const modelsByProvider = new Map([
  ['anthropic', [
    model({ key: 'anthropic:sonnet', name: 'Sonnet 5' }),
    model({ key: 'anthropic:opus', id: 'opus', name: 'Opus 5' }),
  ]],
  ['openai', [
    model({ key: 'openai:gpt5', provider: 'openai', id: 'gpt5', name: 'GPT-5', available: false }),
  ]],
])

function props(overrides: Record<string, unknown> = {}) {
  return {
    busy: false,
    model: 'anthropic:sonnet',
    effort: 'medium' as const,
    modelsByProvider,
    providers,
    reasoningLevels: ['off', 'medium', 'high'] as PrimeThinkingLevel[],
    fast: false,
    fastSupported: false,
    fastAvailable: false,
    imageInputSupported: true,
    skills: [],
    onModelChange: vi.fn(),
    onEffortChange: vi.fn(),
    onFastChange: vi.fn(),
    onSend: vi.fn(),
    onStop: vi.fn(),
    ...overrides,
  }
}

describe('composer model / reasoning effort menus', () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('shows the current model name on the trigger and opens a grouped menu', () => {
    act(() => root.render(<Composer {...props()} />))

    const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Model"]')
    expect(trigger?.textContent).toContain('Sonnet 5')

    act(() => trigger?.click())
    expect(trigger?.getAttribute('aria-expanded')).toBe('true')

    const menu = container.querySelector('[role="menu"][aria-label="Model"]')
    expect(menu?.textContent).toContain('Anthropic')
    expect(menu?.textContent).toContain('OpenAI · not connected')

    const options = menu?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')
    expect(options).toHaveLength(4) // auto + 2 anthropic + 1 openai
    const selected = [...(options ?? [])].find((option) => option.getAttribute('aria-checked') === 'true')
    expect(selected?.textContent).toContain('Sonnet 5')

    const disabledOption = [...(options ?? [])].find((option) => option.textContent?.includes('GPT-5'))
    expect(disabledOption?.disabled).toBe(true)
    expect(disabledOption?.textContent).toContain('connect provider')
  })

  it('selects a model and closes the menu', () => {
    const onModelChange = vi.fn()
    act(() => root.render(<Composer {...props({ onModelChange })} />))

    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Model"]')?.click())
    const opus = [...container.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find((option) => option.textContent?.includes('Opus 5'))
    act(() => opus?.click())

    expect(onModelChange).toHaveBeenCalledWith('anthropic:opus')
    expect(container.querySelector('[role="menu"][aria-label="Model"]')).toBeNull()
  })

  it('shows the current reasoning effort and switches it', () => {
    const onEffortChange = vi.fn()
    act(() => root.render(<Composer {...props({ onEffortChange })} />))

    const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Reasoning effort"]')
    expect(trigger?.textContent).toContain('Standard')

    act(() => trigger?.click())
    const options = container.querySelectorAll<HTMLButtonElement>('[role="menu"][aria-label="Reasoning effort"] [role="menuitemradio"]')
    expect(options).toHaveLength(3)
    const high = [...options].find((option) => option.textContent?.includes('High'))
    act(() => high?.click())

    expect(onEffortChange).toHaveBeenCalledWith('high')
    expect(container.querySelector('[role="menu"][aria-label="Reasoning effort"]')).toBeNull()
  })

  it('closes the model menu on outside click without changing the selection', () => {
    const onModelChange = vi.fn()
    act(() => root.render(<Composer {...props({ onModelChange })} />))

    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Model"]')?.click())
    expect(container.querySelector('[role="menu"][aria-label="Model"]')).not.toBeNull()

    act(() => { document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })) })
    expect(container.querySelector('[role="menu"][aria-label="Model"]')).toBeNull()
    expect(onModelChange).not.toHaveBeenCalled()
  })
})
