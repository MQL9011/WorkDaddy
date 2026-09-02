import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  TOKENCC_BASE_URL,
  TOKENCC_DEFAULT_MODEL,
  TOKENCC_DEEPSEEK_PROVIDER_NAME,
  TOKENCC_OPENAI_DEFAULT_MODEL,
  TOKENCC_OPENAI_PROVIDER_ID,
  TOKENCC_OPENAI_PROVIDER_NAME,
  TOKENCC_PROVIDER_ID,
  TOKENCC_SLOW_MODEL,
  TOKENCC_SMOL_MODEL,
  classifyTokenccModelIds,
  filterTokenccCatalog,
  getTokenccStatus,
  saveTokenccApiKey,
  validateTokenccApiKey,
} from '../../electron/main/tokencc-omp'
import type { PrimeModelCatalog } from '../../src/types/api'

const fixtureDirs: string[] = []

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'workdaddy-tokencc-'))
  fixtureDirs.push(dir)
  return dir
}

const probeDeepseek = async () => ['deepseek-v4-flash', 'deepseek-v4-pro']
const probeOpenai = async () => ['gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-5.4-mini']

describe('validateTokenccApiKey', () => {
  it('accepts trimmed printable keys and rejects empty or control characters', () => {
    expect(validateTokenccApiKey('  sk-test-key  ')).toBe('sk-test-key')
    expect(() => validateTokenccApiKey('')).toThrow(/required/i)
    expect(() => validateTokenccApiKey('bad key')).toThrow(/invalid/i)
    expect(() => validateTokenccApiKey('sk-\0null')).toThrow(/NUL/i)
  })
})

describe('classifyTokenccModelIds', () => {
  it('routes DeepSeek and OpenAI catalogs to separate families', () => {
    expect(classifyTokenccModelIds(['deepseek-v4-flash'])).toBe('deepseek')
    expect(classifyTokenccModelIds(['gpt-5.6-luna', 'codex-auto-review'])).toBe('openai')
    expect(() => classifyTokenccModelIds(['claude-sonnet'])).toThrow(/did not list/i)
  })
})

describe('saveTokenccApiKey / getTokenccStatus', () => {
  it('writes a DeepSeek key without returning it and leaves other providers intact', async () => {
    const home = tempHome()
    const agentDir = join(home, '.omp', 'agent')
    mkdirSync(agentDir, { recursive: true })
    writeFileSync(join(agentDir, 'models.yml'), `providers:\n  anthropic:\n    baseUrl: "https://example.com"\n    apiKey: "keep-me"\n`)
    writeFileSync(join(agentDir, 'config.yml'), `symbolPreset: unicode\n`)

    const result = await saveTokenccApiKey('sk-tokencc-secret', home, probeDeepseek)
    expect(result).toEqual({
      configured: true,
      provider: TOKENCC_PROVIDER_ID,
      family: 'deepseek',
      defaultModel: TOKENCC_DEFAULT_MODEL,
      families: { deepseek: true, openai: false },
    })
    expect(JSON.stringify(result)).not.toContain('sk-tokencc-secret')

    const models = readFileSync(join(agentDir, 'models.yml'), 'utf8')
    expect(models).toContain('anthropic:')
    expect(models).toContain('keep-me')
    expect(models).toContain('deepseek:')
    expect(models).toContain(TOKENCC_BASE_URL)
    expect(models).toContain('sk-tokencc-secret')

    expect(readFileSync(join(agentDir, 'config.yml'), 'utf8')).toContain('symbolPreset: unicode')

    await expect(getTokenccStatus(home)).resolves.toEqual({ configured: true, deepseek: true, openai: false })
  })

  it('writes an OpenAI key to openai-codex without wiping a DeepSeek key', async () => {
    const home = tempHome()
    await saveTokenccApiKey('sk-deepseek-family', home, probeDeepseek)
    const result = await saveTokenccApiKey('sk-openai-family', home, probeOpenai)
    expect(result).toMatchObject({
      provider: TOKENCC_OPENAI_PROVIDER_ID,
      family: 'openai',
      defaultModel: TOKENCC_OPENAI_DEFAULT_MODEL,
      families: { deepseek: true, openai: true },
    })
    expect(JSON.stringify(result)).not.toContain('sk-openai-family')
    expect(JSON.stringify(result)).not.toContain('sk-deepseek-family')

    const models = readFileSync(join(home, '.omp', 'agent', 'models.yml'), 'utf8')
    expect(models).toContain('sk-deepseek-family')
    expect(models).toContain('sk-openai-family')
    expect(models).toContain('openai-codex:')

    await expect(getTokenccStatus(home)).resolves.toEqual({ configured: true, deepseek: true, openai: true })
  })

  it('writes an OpenAI key without pinning model roles', async () => {
    const home = tempHome()
    const agentDir = join(home, '.omp', 'agent')
    mkdirSync(agentDir, { recursive: true })
    writeFileSync(join(agentDir, 'config.yml'), 'symbolPreset: unicode\n')
    await saveTokenccApiKey('sk-openai-only', home, probeOpenai)
    const config = readFileSync(join(agentDir, 'config.yml'), 'utf8')
    expect(config).toContain('symbolPreset: unicode')
    expect(config).not.toContain(TOKENCC_OPENAI_DEFAULT_MODEL)
    await expect(getTokenccStatus(home)).resolves.toEqual({ configured: true, deepseek: false, openai: true })
  })

  it('reports unconfigured when no TokenCC apiKey exists', async () => {
    const home = tempHome()
    await expect(getTokenccStatus(home)).resolves.toEqual({ configured: false, deepseek: false, openai: false })
  })
})

describe('filterTokenccCatalog', () => {
  it('keeps DeepSeek and OpenAI Codex, branded as TokenCC families', () => {
    const catalog: PrimeModelCatalog = {
      primeVersion: '1.0.0',
      refreshedAt: new Date().toISOString(),
      providers: [
        { id: 'anthropic', name: 'Anthropic', authMethod: 'external', configured: true, modelCount: 1, availableModelCount: 1, enabled: true },
        { id: 'deepseek', name: 'deepseek', authMethod: 'api_key', configured: true, modelCount: 1, availableModelCount: 1, enabled: true },
        { id: 'openai-codex', name: 'OpenAI Codex', authMethod: 'api_key', configured: true, modelCount: 1, availableModelCount: 1, enabled: true },
      ],
      models: [
        { key: 'anthropic/claude', provider: 'anthropic', id: 'claude', name: 'Claude', reasoning: true, input: ['text'], contextWindow: 1, maxTokens: 1, availableThinkingLevels: ['off'], fastModeSupported: false, available: true },
        { key: 'deepseek/deepseek-v4-flash', provider: 'deepseek', id: 'deepseek-v4-flash', name: 'Flash', reasoning: false, input: ['text'], contextWindow: 1, maxTokens: 1, availableThinkingLevels: ['off'], fastModeSupported: false, available: true },
        { key: 'openai-codex/gpt-5.6-luna', provider: 'openai-codex', id: 'gpt-5.6-luna', name: 'Luna', reasoning: true, input: ['text'], contextWindow: 1, maxTokens: 1, availableThinkingLevels: ['off'], fastModeSupported: false, available: true },
      ],
    }

    const filtered = filterTokenccCatalog(catalog)
    expect(filtered.providers).toEqual([
      expect.objectContaining({ id: 'deepseek', name: TOKENCC_DEEPSEEK_PROVIDER_NAME, authLabel: 'TokenCC API key' }),
      expect.objectContaining({ id: 'openai-codex', name: TOKENCC_OPENAI_PROVIDER_NAME, authLabel: 'TokenCC API key' }),
    ])
    expect(filtered.models.map((model) => model.key)).toEqual([
      'deepseek/deepseek-v4-flash',
      'openai-codex/gpt-5.6-luna',
    ])
    expect(JSON.stringify(filtered)).not.toContain('sk-')
  })

  it('keeps user-declared custom providers alongside TokenCC', () => {
    const catalog: PrimeModelCatalog = {
      primeVersion: '1.0.0',
      refreshedAt: new Date().toISOString(),
      providers: [
        { id: 'anthropic', name: 'Anthropic', authMethod: 'external', configured: true, modelCount: 1, availableModelCount: 1, enabled: true },
        { id: 'my-gateway', name: 'Acme', authMethod: 'api_key', configured: true, modelCount: 1, availableModelCount: 1, enabled: true },
        { id: 'deepseek', name: 'deepseek', authMethod: 'api_key', configured: true, modelCount: 1, availableModelCount: 1, enabled: true },
      ],
      models: [
        { key: 'anthropic/claude', provider: 'anthropic', id: 'claude', name: 'Claude', reasoning: true, input: ['text'], contextWindow: 1, maxTokens: 1, availableThinkingLevels: ['off'], fastModeSupported: false, available: true },
        { key: 'my-gateway/acme-think', provider: 'my-gateway', id: 'acme-think', name: 'Acme Think', reasoning: false, input: ['text'], contextWindow: 1, maxTokens: 1, availableThinkingLevels: ['off'], fastModeSupported: false, available: true },
        { key: 'deepseek/deepseek-v4-flash', provider: 'deepseek', id: 'deepseek-v4-flash', name: 'Flash', reasoning: false, input: ['text'], contextWindow: 1, maxTokens: 1, availableThinkingLevels: ['off'], fastModeSupported: false, available: true },
      ],
    }
    const filtered = filterTokenccCatalog(catalog, ['my-gateway'])
    expect(filtered.providers.map((provider) => provider.id)).toEqual(['deepseek', 'openai-codex', 'my-gateway'])
    expect(filtered.models.map((model) => model.key)).toEqual([
      'my-gateway/acme-think',
      'deepseek/deepseek-v4-flash',
    ])
  })

  it('adds a setup warning when TokenCC models are missing', () => {
    const catalog: PrimeModelCatalog = {
      primeVersion: '1.0.0',
      refreshedAt: new Date().toISOString(),
      providers: [{ id: 'anthropic', name: 'Anthropic', authMethod: 'external', configured: false, modelCount: 0, availableModelCount: 0, enabled: true }],
      models: [],
    }
    const filtered = filterTokenccCatalog(catalog)
    expect(filtered.providers.map((provider) => provider.id)).toEqual(['deepseek', 'openai-codex'])
    expect(filtered.warning).toMatch(/TokenCC API key/i)
    expect(filtered.warning).toMatch(/Settings → Models/i)
  })
})
