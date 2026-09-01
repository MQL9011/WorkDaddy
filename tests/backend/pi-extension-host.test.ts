import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OmpExtensionApi as BrowserExtensionApi } from '../../assets/extensions/omp-work-browser'
import type { OmpExtensionApi as AskUserExtensionApi } from '../../assets/extensions/omp-work-ask-user'
import type { OmpExtensionApi as VaultExtensionApi } from '../../assets/extensions/omp-work-vault'

/**
 * Base pi host simulation: unlike OMP, pi injects no `pi.typebox` shim.
 * Extensions must fall back to resolving schema builders from the host's
 * `typebox` package (pi's loader aliases that specifier to its bundled copy;
 * under vitest it resolves from node_modules) and register the same tool
 * surface. Pi awaits the factory, so these tests await the returned promise.
 */

interface RegisteredTool {
  name: string
  label: string
  description: string
  parameters: unknown
}

interface TestSchema {
  type?: string
  enum?: unknown[]
  required?: string[]
  properties: Record<string, TestSchema>
  items: TestSchema
}

function piHost() {
  const tools: RegisteredTool[] = []
  return {
    tools,
    pi: { registerTool: (tool: RegisteredTool) => { tools.push(tool) } },
  }
}

function schemaOf(tool: RegisteredTool): TestSchema {
  return tool.parameters as TestSchema
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

async function loadBrowserExtension() {
  vi.resetModules()
  vi.stubEnv('PRIME_WORK_BROWSER_URL', 'http://127.0.0.1:1/')
  vi.stubEnv('PRIME_WORK_BROWSER_TOKEN', 'token')
  return (await import('../../assets/extensions/omp-work-browser')).default
}

describe('extensions on a base pi host (no injected pi.typebox)', () => {
  it('browser extension registers the full tool surface with host-resolved schemas', async () => {
    const factory = await loadBrowserExtension()
    const { tools, pi } = piHost()
    await factory(pi as unknown as BrowserExtensionApi)
    expect(tools.map((tool) => tool.name)).toEqual([
      'terminal_read',
      'browser_tabs',
      'browser_navigate',
      'browser_screenshot',
      'browser_read_page',
      'browser_click',
      'browser_type',
      'browser_press_key',
      'browser_scroll',
      'browser_evaluate',
    ])
    const tabs = schemaOf(tools.find((tool) => tool.name === 'browser_tabs')!)
    expect(tabs.type).toBe('object')
    expect(tabs.required).toEqual(['action'])
    expect(tabs.properties.action.enum).toEqual(['list', 'open', 'close', 'select'])
    expect(tabs.properties.action.type).toBe('string')
    const click = schemaOf(tools.find((tool) => tool.name === 'browser_click')!)
    expect(click.required ?? []).toEqual([])
    expect(click.properties.ref.type).toBe('number')
    expect(click.properties.double.type).toBe('boolean')
    const type = schemaOf(tools.find((tool) => tool.name === 'browser_type')!)
    expect(type.required).toEqual(['text'])
    const pressKey = schemaOf(tools.find((tool) => tool.name === 'browser_press_key')!)
    expect(pressKey.properties.modifiers.type).toBe('array')
    expect(pressKey.properties.modifiers.items.enum).toEqual(['shift', 'control', 'alt', 'meta'])
  })

  it('browser extension still registers nothing without the broker environment', async () => {
    vi.resetModules()
    vi.stubEnv('PRIME_WORK_BROWSER_URL', undefined as unknown as string)
    vi.stubEnv('PRIME_WORK_BROWSER_TOKEN', undefined as unknown as string)
    const factory = (await import('../../assets/extensions/omp-work-browser')).default
    const { tools, pi } = piHost()
    await factory(pi as unknown as BrowserExtensionApi)
    expect(tools).toHaveLength(0)
  })

  it('ask-user extension registers ask_user with host-resolved schemas', async () => {
    vi.resetModules()
    const factory = (await import('../../assets/extensions/omp-work-ask-user')).default
    const { tools, pi } = piHost()
    await factory(pi as unknown as AskUserExtensionApi)
    expect(tools).toHaveLength(1)
    expect(tools[0].name).toBe('ask_user')
    const schema = schemaOf(tools[0])
    expect(schema.type).toBe('object')
    expect(schema.required).toEqual(['questions'])
    expect(schema.properties.questions.type).toBe('array')
    expect(schema.properties.questions.items.required).toEqual(['question', 'options'])
  })

  it('vault extension registers vault_read with host-resolved schemas', async () => {
    vi.resetModules()
    vi.stubEnv('ANCODER_VAULT_KEY', 'ab'.repeat(32))
    vi.stubEnv('ANCODER_VAULT_ROOT', '/tmp/ancoder-vault-host-fallback-fixture')
    const factory = (await import('../../assets/extensions/omp-work-vault')).default
    const { tools, pi } = piHost()
    await factory(pi as unknown as VaultExtensionApi)
    expect(tools).toHaveLength(1)
    expect(tools[0].name).toBe('vault_read')
    const schema = schemaOf(tools[0])
    expect(schema.type).toBe('object')
    expect(schema.required).toEqual(['file'])
    expect(schema.properties.file.type).toBe('string')
  })

})
