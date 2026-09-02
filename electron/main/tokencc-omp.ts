import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import type { PrimeModelCatalog } from '../../src/types/api'
import { HARNESSES } from './harness'
import { isRecord } from './validation'

const require = createRequire(import.meta.url)
const yaml = require('js-yaml') as {
  load(source: string): unknown
  dump(value: unknown, options?: { lineWidth?: number; noRefs?: boolean }): string
}

/** omp provider id for TokenCC DeepSeek keys. */
export const TOKENCC_DEEPSEEK_PROVIDER_ID = 'deepseek'
/** omp provider id for TokenCC OpenAI/Codex keys. */
export const TOKENCC_OPENAI_PROVIDER_ID = 'openai-codex'
/** @deprecated Use TOKENCC_DEEPSEEK_PROVIDER_ID. Kept for existing imports. */
export const TOKENCC_PROVIDER_ID = TOKENCC_DEEPSEEK_PROVIDER_ID

export const TOKENCC_PROVIDER_NAME = 'TokenCC'
export const TOKENCC_DEEPSEEK_PROVIDER_NAME = 'TokenCC · DeepSeek'
export const TOKENCC_OPENAI_PROVIDER_NAME = 'TokenCC · OpenAI'
export const TOKENCC_BASE_URL = 'https://tokencc.fit'

export const TOKENCC_DEFAULT_MODEL = 'deepseek/deepseek-v4-flash'
export const TOKENCC_SMOL_MODEL = 'deepseek/deepseek-v4-flash'
export const TOKENCC_SLOW_MODEL = 'deepseek/deepseek-v4-pro'
export const TOKENCC_OPENAI_DEFAULT_MODEL = 'openai-codex/gpt-5.6-luna'
export const TOKENCC_OPENAI_SMOL_MODEL = 'openai-codex/gpt-5.4-mini'
export const TOKENCC_OPENAI_SLOW_MODEL = 'openai-codex/gpt-5.6-sol'

export const TOKENCC_PROVIDER_IDS = [TOKENCC_DEEPSEEK_PROVIDER_ID, TOKENCC_OPENAI_PROVIDER_ID] as const

const MAX_API_KEY_LENGTH = 512
const API_KEY_PATTERN = /^[\x21-\x7E]+$/
const MODEL_PROBE_TIMEOUT_MS = 15_000

export type TokenccFamily = 'deepseek' | 'openai'
export type TokenccProviderId = typeof TOKENCC_DEEPSEEK_PROVIDER_ID | typeof TOKENCC_OPENAI_PROVIDER_ID

export interface TokenccSaveResult {
  configured: true
  provider: TokenccProviderId
  family: TokenccFamily
  defaultModel: string
  families: { deepseek: boolean; openai: boolean }
}

export interface TokenccStatus {
  configured: boolean
  deepseek: boolean
  openai: boolean
}

export type TokenccModelProbe = (apiKey: string) => Promise<readonly string[]>

export function ompAgentDir(home = homedir()): string {
  return HARNESSES.omp.agentDir(home)
}

export function validateTokenccApiKey(raw: unknown): string {
  if (typeof raw !== 'string') throw new TypeError('API key must be a string')
  if (raw.includes('\0')) throw new TypeError('API key contains a NUL byte')
  const key = raw.trim()
  if (!key) throw new TypeError('API key is required')
  if (key.length > MAX_API_KEY_LENGTH) throw new TypeError('API key is too long')
  if (!API_KEY_PATTERN.test(key)) throw new TypeError('API key contains invalid characters')
  return key
}

/** TokenCC keys are family-scoped: a DeepSeek key cannot list GPT models and vice versa. */
export function classifyTokenccModelIds(ids: readonly string[]): TokenccFamily {
  const hasDeepseek = ids.some((id) => id.toLowerCase().startsWith('deepseek'))
  const hasOpenai = ids.some((id) => /^(gpt-|codex-)/i.test(id) || id.toLowerCase().includes('openai'))
  if (hasDeepseek && !hasOpenai) return 'deepseek'
  if (hasOpenai && !hasDeepseek) return 'openai'
  if (hasDeepseek && hasOpenai) return 'deepseek'
  throw new Error('This TokenCC key did not list DeepSeek or OpenAI models')
}

export function providerIdForFamily(family: TokenccFamily): TokenccProviderId {
  return family === 'openai' ? TOKENCC_OPENAI_PROVIDER_ID : TOKENCC_DEEPSEEK_PROVIDER_ID
}

export function familyForProviderId(providerId: TokenccProviderId): TokenccFamily {
  return providerId === TOKENCC_OPENAI_PROVIDER_ID ? 'openai' : 'deepseek'
}

export function displayNameForProvider(providerId: string): string {
  if (providerId === TOKENCC_OPENAI_PROVIDER_ID) return TOKENCC_OPENAI_PROVIDER_NAME
  if (providerId === TOKENCC_DEEPSEEK_PROVIDER_ID) return TOKENCC_DEEPSEEK_PROVIDER_NAME
  return TOKENCC_PROVIDER_NAME
}

function loadYamlObject(source: string, label: string): Record<string, unknown> {
  if (!source.trim()) return {}
  let parsed: unknown
  try {
    parsed = yaml.load(source)
  } catch {
    throw new Error(`${label} is not valid YAML`)
  }
  if (parsed === undefined || parsed === null) return {}
  if (!isRecord(parsed)) throw new Error(`${label} must be a YAML mapping`)
  return parsed
}

async function readYamlFile(path: string, label: string): Promise<Record<string, unknown>> {
  try {
    const source = await readFile(path, 'utf8')
    return loadYamlObject(source, label)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
}

function dumpYaml(value: Record<string, unknown>): string {
  return `${yaml.dump(value, { lineWidth: 120, noRefs: true }).trimEnd()}\n`
}

function providerHasApiKey(providers: Record<string, unknown>, providerId: string): boolean {
  const block = isRecord(providers[providerId]) ? providers[providerId] : null
  return Boolean(block && typeof block.apiKey === 'string' && block.apiKey.trim())
}

function familiesFromProviders(providers: Record<string, unknown>): { deepseek: boolean; openai: boolean } {
  return {
    deepseek: providerHasApiKey(providers, TOKENCC_DEEPSEEK_PROVIDER_ID),
    openai: providerHasApiKey(providers, TOKENCC_OPENAI_PROVIDER_ID),
  }
}

async function probeTokenccModelIds(apiKey: string): Promise<readonly string[]> {
  let response: Response
  try {
    response = await fetch(`${TOKENCC_BASE_URL}/v1/models`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(MODEL_PROBE_TIMEOUT_MS),
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') throw new Error('TokenCC model lookup timed out')
    throw new Error('Could not reach TokenCC to identify this API key')
  }
  if (response.status === 401 || response.status === 403) throw new Error('TokenCC rejected this API key')
  if (!response.ok) throw new Error(`TokenCC model lookup failed (${response.status})`)
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new Error('TokenCC returned an invalid model list')
  }
  const rows = isRecord(payload) && Array.isArray(payload.data) ? payload.data : []
  return rows.flatMap((row) => (isRecord(row) && typeof row.id === 'string' && row.id.trim() ? [row.id.trim()] : []))
}

export function pinTokenccModelRoles(configDoc: Record<string, unknown>, family: TokenccFamily, existingDeepseek: boolean): void {
  // Kept for unit tests of legacy helpers; product paths no longer pin TokenCC defaults.
  const modelRoles = isRecord(configDoc.modelRoles) ? { ...configDoc.modelRoles } : {}
  if (family === 'deepseek') {
    modelRoles.default = TOKENCC_DEFAULT_MODEL
    modelRoles.smol = TOKENCC_SMOL_MODEL
    modelRoles.slow = TOKENCC_SLOW_MODEL
  } else if (!existingDeepseek) {
    modelRoles.default = TOKENCC_OPENAI_DEFAULT_MODEL
    modelRoles.smol = TOKENCC_OPENAI_SMOL_MODEL
    modelRoles.slow = TOKENCC_OPENAI_SLOW_MODEL
  }
  configDoc.modelRoles = modelRoles
}

/**
 * Classifies a TokenCC key by probing /v1/models, then merges it into the matching
 * omp provider (deepseek or openai-codex). The other family is left untouched.
 */
export async function saveTokenccApiKey(
  rawKey: unknown,
  home = homedir(),
  probe: TokenccModelProbe = probeTokenccModelIds,
): Promise<TokenccSaveResult> {
  const apiKey = validateTokenccApiKey(rawKey)
  const family = classifyTokenccModelIds(await probe(apiKey))
  const providerId = providerIdForFamily(family)
  const agentDir = ompAgentDir(home)
  await mkdir(agentDir, { recursive: true })

  const modelsPath = join(agentDir, 'models.yml')

  const modelsDoc = await readYamlFile(modelsPath, 'models.yml')
  const providers = isRecord(modelsDoc.providers) ? { ...modelsDoc.providers } : {}
  const existing = isRecord(providers[providerId]) ? { ...providers[providerId] } : {}
  providers[providerId] = {
    ...existing,
    baseUrl: TOKENCC_BASE_URL,
    apiKey,
  }
  modelsDoc.providers = providers
  await writeFile(modelsPath, dumpYaml(modelsDoc), 'utf8')

  const families = familiesFromProviders(providers)
  return {
    configured: true,
    provider: providerId,
    family,
    defaultModel: family === 'openai' ? TOKENCC_OPENAI_DEFAULT_MODEL : TOKENCC_DEFAULT_MODEL,
    families,
  }
}

/** Returns which TokenCC families already have a key — never returns the key itself. */
export async function getTokenccStatus(home = homedir()): Promise<TokenccStatus> {
  const modelsPath = join(ompAgentDir(home), 'models.yml')
  try {
    const modelsDoc = await readYamlFile(modelsPath, 'models.yml')
    const providers = isRecord(modelsDoc.providers) ? modelsDoc.providers : {}
    const families = familiesFromProviders(providers)
    return { configured: families.deepseek || families.openai, ...families }
  } catch {
    return { configured: false, deepseek: false, openai: false }
  }
}

function catalogProvider(
  providerId: string,
  models: PrimeModelCatalog['models'],
  extras?: Partial<PrimeModelCatalog['providers'][number]>,
): PrimeModelCatalog['providers'][number] {
  const familyModels = models.filter((model) => model.provider === providerId)
  const isTokencc = (TOKENCC_PROVIDER_IDS as readonly string[]).includes(providerId)
  return {
    id: providerId,
    name: isTokencc ? displayNameForProvider(providerId) : providerId,
    authMethod: 'api_key',
    configured: familyModels.length > 0,
    authLabel: isTokencc ? `${TOKENCC_PROVIDER_NAME} API key` : 'API key',
    modelCount: familyModels.length,
    availableModelCount: familyModels.filter((model) => model.available).length,
    enabled: familyModels.length === 0 || familyModels.some((model) => model.enabled !== false),
    ...extras,
  }
}

/** Product filter: TokenCC families always, plus user-declared custom providers. */
export function filterTokenccCatalog(catalog: PrimeModelCatalog, extraProviderIds: readonly string[] = []): PrimeModelCatalog {
  const allowed = new Set<string>([...TOKENCC_PROVIDER_IDS, ...extraProviderIds])
  const models = catalog.models.filter((model) => allowed.has(model.provider))
  const byId = new Map(
    catalog.providers
      .filter((provider) => allowed.has(provider.id))
      .map((provider) => {
        const familyModels = models.filter((model) => model.provider === provider.id)
        const isTokencc = (TOKENCC_PROVIDER_IDS as readonly string[]).includes(provider.id)
        return [provider.id, {
          ...provider,
          name: isTokencc ? displayNameForProvider(provider.id) : (provider.name || provider.id),
          authLabel: isTokencc ? `${TOKENCC_PROVIDER_NAME} API key` : (provider.authLabel ?? 'API key'),
          modelCount: familyModels.length,
          availableModelCount: familyModels.filter((model) => model.available).length,
        }]
      }),
  )

  const providers = TOKENCC_PROVIDER_IDS.map((providerId) => {
    const existing = byId.get(providerId)
    byId.delete(providerId)
    return existing ?? catalogProvider(providerId, models)
  })
  for (const providerId of extraProviderIds) {
    if ((TOKENCC_PROVIDER_IDS as readonly string[]).includes(providerId) || providers.some((provider) => provider.id === providerId)) continue
    providers.push(byId.get(providerId) ?? catalogProvider(providerId, models))
    byId.delete(providerId)
  }
  for (const leftover of byId.values()) providers.push(leftover)

  const warning = models.length
    ? catalog.warning
    : [catalog.warning, 'Add your TokenCC API key in Settings → Models to load models.'].filter(Boolean).join(' ')

  return {
    ...catalog,
    models,
    providers,
    warning: warning || undefined,
  }
}
