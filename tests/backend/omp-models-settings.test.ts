import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createCustomProvider,
  deleteCustomProvider,
  discoverModels,
  listModelProviders,
  saveProvider,
  snapshotHasUsableProvider,
  validateCustomProviderId,
  validateOptionalApiKey,
} from '../../electron/main/omp-models-settings'

const fixtureDirs: string[] = []
afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'workdaddy-omp-models-'))
  fixtureDirs.push(dir)
  return dir
}

describe('validateOptionalApiKey', () => {
  it('treats empty as keep-stored and rejects whitespace or env-line pastes', () => {
    expect(validateOptionalApiKey('')).toBeUndefined()
    expect(validateOptionalApiKey(undefined)).toBeUndefined()
    expect(() => validateOptionalApiKey('   ')).toThrow(/Enter an API key/i)
    expect(() => validateOptionalApiKey('OPENAI_API_KEY=sk-test')).toThrow(/wrong format/i)
    expect(() => validateOptionalApiKey('"sk-quoted"')).toThrow(/wrong format/i)
    expect(validateOptionalApiKey('  sk-ok  ')).toBe('sk-ok')
  })
})

describe('validateCustomProviderId', () => {
  it('accepts lowercase route ids and refuses taken or catalog ids', () => {
    expect(validateCustomProviderId('my-gateway', new Set())).toBe('my-gateway')
    expect(() => validateCustomProviderId('DeepSeek', new Set())).toThrow(/lowercase/i)
    expect(() => validateCustomProviderId('deepseek', new Set())).toThrow(/already uses/i)
    expect(() => validateCustomProviderId('anthropic', new Set())).toThrow(/already uses/i)
    expect(() => validateCustomProviderId('taken', new Set(['taken']))).toThrow(/already uses/i)
  })
})

describe('list / save / custom providers', () => {
  it('starts empty and can add a catalog provider without pinning TokenCC roles', async () => {
    const home = tempHome()
    const empty = await listModelProviders(home)
    expect(empty.rows).toEqual([])
    expect(empty.availableCatalog.some((provider) => provider.id === 'deepseek')).toBe(true)
    expect(snapshotHasUsableProvider(empty)).toBe(false)

    const afterDeepseek = await saveProvider({ providerId: 'deepseek', apiKey: 'sk-deepseek-row' }, home)
    expect(afterDeepseek.rows).toHaveLength(1)
    expect(afterDeepseek.rows[0]).toMatchObject({ id: 'deepseek', kind: 'catalog', configured: true, removable: true, displayName: 'DeepSeek' })
    expect(afterDeepseek.availableCatalog.some((provider) => provider.id === 'deepseek')).toBe(false)
    expect(JSON.stringify(afterDeepseek)).not.toContain('sk-deepseek-row')

    const yaml = readFileSync(join(home, '.omp', 'agent', 'models.yml'), 'utf8')
    expect(yaml).toContain('sk-deepseek-row')
    expect(yaml).toContain('deepseek:')
    expect(yaml).not.toContain('tokencc.fit')

    const config = readFileSync(join(home, '.omp', 'agent', 'config.yml'), 'utf8')
    expect(config).toContain('default: deepseek/deepseek-chat')
    expect(config).not.toContain('deepseek-v4-flash')
  })

  it('keeps a stored key when the field is left empty and can override models', async () => {
    const home = tempHome()
    await saveProvider({ providerId: 'anthropic', apiKey: 'sk-keep' }, home)
    await saveProvider({
      providerId: 'anthropic',
      models: [{ id: 'claude-sonnet', name: 'Sonnet', contextWindow: 200000 }],
    }, home)
    const yaml = readFileSync(join(home, '.omp', 'agent', 'models.yml'), 'utf8')
    expect(yaml).toContain('sk-keep')
    expect(yaml).toContain('claude-sonnet')
    const listed = await listModelProviders(home)
    expect(listed.rows[0]?.modelsOverridden).toBe(true)
    expect(listed.rows[0]?.models).toEqual([expect.objectContaining({ id: 'claude-sonnet', name: 'Sonnet' })])

    await saveProvider({ providerId: 'anthropic', resetModels: true }, home)
    expect((await listModelProviders(home)).rows[0]?.modelsOverridden).toBe(false)
  })

  it('creates and deletes a custom provider without exposing its key', async () => {
    const home = tempHome()
    const created = await createCustomProvider({
      id: 'my-gateway',
      displayName: 'Acme',
      baseUrl: 'https://gateway.example/v1',
      api: 'openai-completions',
      apiKey: 'sk-custom-secret',
      models: [{ id: 'acme-think' }],
    }, home)
    expect(created.rows.some((row) => row.id === 'my-gateway' && row.displayName === 'Acme' && row.removable && row.configured)).toBe(true)
    expect(JSON.stringify(created)).not.toContain('sk-custom-secret')
    expect(readFileSync(join(home, '.omp', 'agent', 'models.yml'), 'utf8')).toContain('sk-custom-secret')

    const deleted = await deleteCustomProvider('my-gateway', home)
    expect(deleted.rows.some((row) => row.id === 'my-gateway')).toBe(false)
    expect(readFileSync(join(home, '.omp', 'agent', 'models.yml'), 'utf8')).not.toContain('my-gateway')
  })

  it('saves a custom provider with auth none when the key is omitted', async () => {
    const home = tempHome()
    const created = await createCustomProvider({
      id: 'local-llm',
      baseUrl: 'http://127.0.0.1:8000/v1',
      api: 'openai-completions',
      models: [{ id: 'qwen' }],
    }, home)
    const row = created.rows.find((item) => item.id === 'local-llm')
    expect(row).toMatchObject({ keylessAuth: true, configured: false })
    expect(snapshotHasUsableProvider(created)).toBe(true)
    expect(readFileSync(join(home, '.omp', 'agent', 'models.yml'), 'utf8')).toContain('auth: none')
  })

  it('can delete a catalog provider after it was added', async () => {
    const home = tempHome()
    await saveProvider({ providerId: 'openai', apiKey: 'sk-openai' }, home)
    const deleted = await deleteCustomProvider('openai', home)
    expect(deleted.rows.some((row) => row.id === 'openai')).toBe(false)
    expect(deleted.availableCatalog.some((provider) => provider.id === 'openai')).toBe(true)
  })

  it('does not overwrite an existing modelRoles.default', async () => {
    const home = tempHome()
    const agentDir = join(home, '.omp', 'agent')
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(agentDir, { recursive: true })
    writeFileSync(join(agentDir, 'config.yml'), 'modelRoles:\n  default: anthropic/claude-sonnet-4-5\n')
    await saveProvider({ providerId: 'deepseek', apiKey: 'sk-new' }, home)
    const config = readFileSync(join(agentDir, 'config.yml'), 'utf8')
    expect(config).toContain('default: anthropic/claude-sonnet-4-5')
    expect(config).not.toContain('deepseek/deepseek-chat')
  })
})

describe('discoverModels', () => {
  it('uses the typed key, never returns it, and can fall back to the stored key', async () => {
    const home = tempHome()
    await saveProvider({ providerId: 'deepseek', apiKey: 'sk-stored' }, home)
    const seen: Array<{ baseUrl: string; apiKey?: string }> = []
    const found = await discoverModels(
      { providerId: 'deepseek', baseUrl: 'https://api.deepseek.com' },
      home,
      async (input) => {
        seen.push(input)
        return [{ id: 'deepseek-chat', name: 'Chat' }]
      },
    )
    expect(found).toEqual([{ id: 'deepseek-chat', name: 'Chat' }])
    expect(JSON.stringify(found)).not.toContain('sk-stored')
    expect(seen[0]).toEqual({ baseUrl: 'https://api.deepseek.com', apiKey: 'sk-stored' })

    await discoverModels(
      { baseUrl: 'https://api.deepseek.com', apiKey: 'sk-typed' },
      home,
      async (input) => {
        seen.push(input)
        return []
      },
    )
    expect(seen[1]?.apiKey).toBe('sk-typed')
  })
})
