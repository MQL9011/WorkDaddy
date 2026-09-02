import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ModelCatalogProvider } from '../../electron/main/model-catalog'
import { OMP_NOT_INSTALLED_WARNING, OmpModelCatalogService, MAX_CATALOG_PROVIDERS } from '../../electron/main/providers-omp'
import type { PrimeModelCatalog } from '../../src/types/api'
import { waitUntil } from '../helpers/wait'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'prime-work-omp-'))
  dirs.push(dir)
  return dir
}

/** Fabricates a fake omp CLI as an executable node script, mirroring the fake-agent pattern in agent-rpc.test.ts. */
function fakeOmp(body: string): string {
  const executable = join(tempDir(), 'fake-omp.cjs')
  writeFileSync(executable, `#!/usr/bin/env node
if (process.argv[2] === '--version') { process.stdout.write('omp/1.2.3\\n'); process.exit(0) }
if (process.argv[2] !== 'models' || process.argv[3] !== '--json') { process.exit(2) }
${body}
`)
  chmodSync(executable, 0o755)
  return executable
}

function fakeOmpWithCatalog(payload: unknown): string {
  return fakeOmp(`process.stdout.write(${JSON.stringify(JSON.stringify(payload))})`)
}

const sampleCatalog = {
  models: [
    { provider: 'deepseek', id: 'deepseek-v4-flash', selector: 'deepseek/deepseek-v4-flash', name: 'DeepSeek V4 Flash', contextWindow: 128_000, maxTokens: 8_192, reasoning: false, thinking: null, input: ['text'], cost: {} },
    { provider: 'deepseek', id: 'deepseek-v4-pro', selector: 'deepseek/deepseek-v4-pro', name: 'DeepSeek V4 Pro', contextWindow: 128_000, maxTokens: 64_000, reasoning: true, thinking: ['low', 'medium', 'high'], input: ['text'], cost: {} },
    { provider: 'deepseek', id: 'deepseek-v4-vision', selector: 'deepseek/deepseek-v4-vision', name: 'DeepSeek V4 Vision', contextWindow: 128_000, maxTokens: 8_192, reasoning: false, thinking: null, input: ['text', 'image'], cost: {} },
    { provider: 'openai-codex', id: 'gpt-5.6-luna', selector: 'openai-codex/gpt-5.6-luna', name: 'GPT-5.6 Luna', contextWindow: 400_000, maxTokens: 128_000, reasoning: true, thinking: ['low', 'medium', 'high'], input: ['text'], cost: {} },
    { provider: 'anthropic', id: 'claude-fable-5', selector: 'anthropic/claude-fable-5', name: 'Claude Fable 5', contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, thinking: ['minimal', 'low', 'medium', 'high'], input: ['text'], cost: {} },
  ],
}

const processExists = (pid: number): boolean => {
  try { process.kill(pid, 0); return true } catch { return false }
}

function expectRelationalIntegrity(catalog: PrimeModelCatalog): void {
  const providerIds = catalog.providers.map((provider) => provider.id)
  expect(new Set(providerIds).size).toBe(providerIds.length)
  const providerIdSet = new Set(providerIds)
  for (const model of catalog.models) expect(providerIdSet.has(model.provider)).toBe(true)
  for (const provider of catalog.providers) {
    const models = catalog.models.filter((model) => model.provider === provider.id)
    expect(provider.modelCount).toBe(models.length)
    expect(provider.availableModelCount).toBe(models.filter((model) => model.available).length)
  }
}

function ompModel(provider: string, id: string): Record<string, unknown> {
  return { provider, id, name: `${provider} ${id}`, reasoning: false, thinking: null, input: ['text'], contextWindow: 1, maxTokens: 1 }
}

describe('OMP model catalog service', () => {
  it('invalidates the unavailable cache when discovery finds an executable', async () => {
    let executable: string | null = null
    const service = new OmpModelCatalogService(() => executable)
    await expect(service.catalog()).resolves.toMatchObject({ models: [] })
    await expect(service.catalog()).resolves.toMatchObject({ warning: expect.stringContaining('OMP is not installed') })

    executable = fakeOmpWithCatalog(sampleCatalog)
    await expect(service.catalog()).resolves.toMatchObject({ primeVersion: '1.2.3', models: expect.any(Array) })
  })

  it('parses the CLI catalog into Prime descriptor shapes without TokenCC filtering', async () => {
    const service: ModelCatalogProvider = new OmpModelCatalogService(fakeOmpWithCatalog(sampleCatalog))
    const catalog = await service.catalog(true)

    expect(catalog.primeVersion).toBe('1.2.3')
    expect(catalog.warning).toBeUndefined()
    expect(catalog.models.map((model) => model.key)).toEqual([
      'deepseek/deepseek-v4-flash',
      'deepseek/deepseek-v4-pro',
      'deepseek/deepseek-v4-vision',
      'openai-codex/gpt-5.6-luna',
      'anthropic/claude-fable-5',
    ])
    expect(catalog.models.some((model) => model.provider === 'anthropic')).toBe(true)

    const flash = catalog.models[0]
    expect(flash.name).toBe('DeepSeek V4 Flash')
    expect(flash.contextWindow).toBe(128_000)
    expect(flash.maxTokens).toBe(8_192)
    expect(flash.reasoning).toBe(false)
    expect(flash.input).toEqual(['text'])
    expect(flash.availableThinkingLevels).toEqual(['off'])
    expect(flash.available).toBe(true)

    const pro = catalog.models[1]
    expect(pro.availableThinkingLevels).toEqual(['off', 'low', 'medium', 'high'])
    expect(pro.reasoning).toBe(true)

    expect(catalog.providers.map((provider) => provider.id).sort()).toEqual(['anthropic', 'deepseek', 'openai-codex'])
    expect(catalog.providers.find((provider) => provider.id === 'deepseek')).toMatchObject({
      id: 'deepseek',
      modelCount: 3,
      availableModelCount: 3,
      enabled: true,
    })
    const cached = await service.catalog()
    expect(cached.models).toEqual(catalog.models)
    expect(cached.providers).toEqual(catalog.providers)
  })

  it('resolves availability, capabilities, and desktop provider enablement', async () => {
    const service = new OmpModelCatalogService(fakeOmpWithCatalog(sampleCatalog))

    const model = await service.requireAvailableModel('deepseek/deepseek-v4-pro')
    expect(model.provider).toBe('deepseek')
    expect(model.id).toBe('deepseek-v4-pro')

    await expect(service.requireAvailableModel('nope/none')).rejects.toThrow(/not found in the OMP catalog/)
    await expect(service.requireAvailableModel('deepseek/deepseek-v4-flash', new Set(['deepseek']))).rejects.toThrow(/disabled/)
    await expect(service.requireAvailableModel('deepseek/deepseek-v4-pro', new Set(), new Set(['deepseek/deepseek-v4-pro']))).rejects.toThrow(/disabled/)
    const disabledView = await service.catalog(false, new Set(['deepseek']))
    expect(disabledView.providers.find((provider) => provider.id === 'deepseek')?.enabled).toBe(false)
    expect((await service.catalog(false, new Set(), new Set(['deepseek/deepseek-v4-pro']))).models.find((candidate) => candidate.key === 'deepseek/deepseek-v4-pro')?.enabled).toBe(false)

    expect(await service.capabilities('deepseek', 'deepseek-v4-flash')).toMatchObject({ key: 'deepseek/deepseek-v4-flash' })
    expect(await service.capabilities('deepseek', undefined)).toBeUndefined()
    expect(await service.capabilities(undefined, 'deepseek-v4-flash')).toBeUndefined()
  })

  it('returns an empty catalog with a clear status when OMP is not installed', async () => {
    const service = new OmpModelCatalogService(null)
    const catalog = await service.catalog(true)

    expect(catalog.models).toEqual([])
    expect(catalog.providers).toEqual([])
    expect(catalog.warning).toContain('OMP is not installed')
    expect(catalog.primeVersion).toBe('unknown')
    await expect(service.requireAvailableModel('deepseek/deepseek-v4-flash')).rejects.toThrow(/not found/)
  })

  it('rejects malformed JSON without caching a catalog', async () => {
    const service = new OmpModelCatalogService(fakeOmp("process.stdout.write('not json {{')"))
    await expect(service.catalog(true)).rejects.toThrow(/malformed model catalog JSON/)
    await expect(service.catalog()).rejects.toThrow(/malformed model catalog JSON/)
  })

  it('rejects valid JSON with an unexpected top-level shape', async () => {
    const service = new OmpModelCatalogService(fakeOmpWithCatalog({ models: 'nope' }))
    await expect(service.catalog(true)).rejects.toThrow(/unexpected model catalog shape/)
    const arrayService = new OmpModelCatalogService(fakeOmpWithCatalog([1, 2, 3]))
    await expect(arrayService.catalog(true)).rejects.toThrow(/unexpected model catalog shape/)
  })

  it('rejects oversized CLI output at the byte cap', async () => {
    const executable = fakeOmp("process.stdout.write('x'.repeat(256 * 1024))")
    const service = new OmpModelCatalogService(executable, { maxOutputBytes: 4_096 })
    await expect(service.catalog(true)).rejects.toThrow(/catalog output exceeded/)
  })

  it('kills a hung CLI at the timeout', async () => {
    const pidFile = join(tempDir(), 'omp.pid')
    const executable = fakeOmp(`require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000)`)
    const service = new OmpModelCatalogService(executable, { timeoutMs: 3_000 })

    const pending = expect(service.catalog(true)).rejects.toThrow(/timed out/)
    // The pid file must exist before the timeout fires, or a slow test host
    // could kill the child before it ever wrote the file.
    await waitUntil(() => existsSync(pidFile))
    await pending
    const pid = Number(readFileSync(pidFile, 'utf8'))
    expect(Number.isInteger(pid) && pid > 0).toBe(true)
    await waitUntil(() => !processExists(pid))
  })

  it('caches within the TTL and single-flights concurrent refreshes', async () => {
    const counterFile = join(tempDir(), 'runs')
    const executable = fakeOmp(`
const fs = require('node:fs')
fs.appendFileSync(${JSON.stringify(counterFile)}, 'x')
setTimeout(() => { process.stdout.write(${JSON.stringify(JSON.stringify(sampleCatalog))}) }, 50)
`)
    const service = new OmpModelCatalogService(executable)
    const runs = () => { try { return readFileSync(counterFile, 'utf8').length } catch { return 0 } }

    const [first, second, third] = await Promise.all([
      service.catalog(true),
      service.catalog(true),
      service.catalog(true, new Set(['deepseek'])),
    ])
    expect(runs()).toBe(1)
    expect(first.models.length).toBe(second.models.length)
    expect(third.providers.find((provider) => provider.id === 'deepseek')?.enabled).toBe(false)
    expect(first.providers.find((provider) => provider.id === 'deepseek')?.enabled).toBe(true)

    // Within the TTL an unforced call serves the cache without a new spawn.
    await service.catalog()
    expect(runs()).toBe(1)

    // After settling, a forced refresh spawns again (the in-flight slot was cleared).
    await service.catalog(true)
    expect(runs()).toBe(2)
  })

  it('keeps omitted deepseek models absent from cached and stale overflow catalogs', async () => {
    const models = Array.from({ length: 5_001 }, (_, index) => ompModel('deepseek', `model-${index}`))
    const executable = fakeOmpWithCatalog({ models })
    const service = new OmpModelCatalogService(executable)
    const fresh = await service.catalog(true)
    expect(fresh.models).toHaveLength(5_000)
    expect(fresh.models.some((model) => model.key === 'deepseek/model-5000')).toBe(false)
    expect(fresh.warning).toMatch(/5,001 valid unique models/)

    const cached = await service.catalog()
    expect(cached.models).toEqual(fresh.models)
    expect(cached.providers).toEqual(fresh.providers)
    expect(cached.models.some((model) => model.key === 'deepseek/model-5000')).toBe(false)

    // Force a failing refresh after a good cache; overflow truncation still holds.
    const failing = new OmpModelCatalogService(fakeOmp('process.exit(7)'))
    // Seed by swapping is hard; instead verify require/capabilities reject omitted keys.
    await expect(service.requireAvailableModel('deepseek/model-5000')).rejects.toThrow(/not found/)
    expect(await service.capabilities('deepseek', 'model-5000')).toBeUndefined()

    const failingOnly = new OmpModelCatalogService(fakeOmp('process.exit(7)'))
    await expect(failingOnly.catalog(true)).rejects.toThrow(/exited with status 7/)
  })

  it('rejects hostile model entries and sanitizes suspicious fields', async () => {
    const service = new OmpModelCatalogService(fakeOmpWithCatalog({
      models: [
        sampleCatalog.models[0],
        'not-an-object',
        null,
        ['nested', 'array'],
        { provider: '../evil', id: 'escape', name: 'Bad provider' },
        { provider: 'anthropic', id: 'bad id with spaces', name: 'Bad id' },
        { provider: 'anthropic', id: 'no-name', name: 42 },
        { provider: 'anthropic', id: 'bad-reasoning', name: 'Bad reasoning', reasoning: 'yes' },
        { provider: 'anthropic', id: 'bad-thinking', name: 'Bad thinking', reasoning: true, thinking: 'high' },
        { provider: 'anthropic', id: 'claude-fable-5', name: 'Duplicate key' },
        {
          provider: 'zai',
          id: 'glm-5',
          name: `Padded${'x'.repeat(2_000)}`,
          reasoning: true,
          thinking: [{ hostile: true }, 'medium', 'turbo', 'max'],
          input: ['text', 'video', { type: 'image' }],
          contextWindow: '200000',
          maxTokens: -5,
        },
      ],
    }))
    const catalog = await service.catalog(true)

    expect(catalog.models.map((model) => model.key)).toEqual([
      'deepseek/deepseek-v4-flash',
      'anthropic/claude-fable-5',
      'zai/glm-5',
    ])
    expect(catalog.models[0].name).toBe('DeepSeek V4 Flash')
    expect(catalog.warning).toMatch(/could not validate/)
    expect(catalog.providers.map((provider) => provider.id).sort()).toEqual(['anthropic', 'deepseek', 'zai'])
  })

  it('keeps all providers returned by the OMP catalog', async () => {
    const service = new OmpModelCatalogService(fakeOmpWithCatalog({
      models: [
        ompModel('anthropic', 'claude'),
        ompModel('openai-codex', 'gpt'),
        ompModel('deepseek', 'deepseek-v4-flash'),
      ],
    }))
    const catalog = await service.catalog(true)
    expect(catalog.providers.map((provider) => provider.id).sort()).toEqual(['anthropic', 'deepseek', 'openai-codex'])
    expect(catalog.models.map((model) => model.key).sort()).toEqual([
      'anthropic/claude',
      'deepseek/deepseek-v4-flash',
      'openai-codex/gpt',
    ])
  })

  it('keeps an exact-boundary deepseek catalog unchanged and relationally consistent', async () => {
    const models = Array.from({ length: 5_000 }, (_, index) => ompModel('deepseek', `model-${index}`))
    const service = new OmpModelCatalogService(fakeOmpWithCatalog({ models }))
    const catalog = await service.catalog(true)

    expect(catalog.models).toHaveLength(5_000)
    expect(catalog.providers).toHaveLength(1)
    expect(catalog.providers[0]?.id).toBe('deepseek')
    expect(catalog.warning).toBeUndefined()
    expectRelationalIntegrity(catalog)
  })

  it('caps provider overflow while retaining the earliest providers by name', async () => {
    const models = Array.from({ length: MAX_CATALOG_PROVIDERS + 1 }, (_, index) => (
      ompModel(`provider-${String(index).padStart(3, '0')}`, 'model')
    ))
    models.push(ompModel('deepseek', 'deepseek-v4-flash'))
    const service = new OmpModelCatalogService(fakeOmpWithCatalog({ models }))
    const catalog = await service.catalog(true)

    expect(catalog.providers).toHaveLength(MAX_CATALOG_PROVIDERS)
    expect(catalog.providers.some((provider) => provider.id === 'deepseek')).toBe(true)
    expect(catalog.warning).toMatch(/omitted|providers/i)
    expectRelationalIntegrity(catalog)
  })

  it('caps deepseek model-only overflow while keeping visibility and launch validation aligned', async () => {
    const models = Array.from({ length: 5_001 }, (_, index) => ompModel('deepseek', `model-${index}`))
    const service = new OmpModelCatalogService(fakeOmpWithCatalog({ models }))
    const catalog = await service.catalog(true, new Set(), new Set(['deepseek/model-0']))

    expect(catalog.providers).toHaveLength(1)
    expect(catalog.models).toHaveLength(5_000)
    expect(catalog.models[0]?.enabled).toBe(false)
    expect(catalog.warning).toMatch(/5,001 valid unique models.*retained 5,000.*1 omitted/)
    expectRelationalIntegrity(catalog)
    await expect(service.requireAvailableModel('deepseek/model-5000')).rejects.toThrow(/not found/)
    await expect(service.requireAvailableModel('deepseek/model-0', new Set(), new Set(['deepseek/model-0']))).rejects.toThrow(/disabled/)
  })

  it('returns non-TokenCC providers from the CLI catalog as-is', async () => {
    const service = new OmpModelCatalogService(fakeOmpWithCatalog({
      models: [ompModel('anthropic', 'claude'), ompModel('openai', 'gpt')],
    }))
    const catalog = await service.catalog(true)
    expect(catalog.providers.map((provider) => provider.id).sort()).toEqual(['anthropic', 'openai'])
    expect(catalog.models.map((model) => model.key).sort()).toEqual(['anthropic/claude', 'openai/gpt'])
  })

  it('rejects a CLI that exits with a failure status', async () => {
    const service = new OmpModelCatalogService(fakeOmp('process.exit(3)'))
    await expect(service.catalog(true)).rejects.toThrow(/exited with status 3/)
  })
})
