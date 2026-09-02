import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import type {
  DiscoveredModel,
  OmpCatalogProviderOption,
  OmpDiscoverableApi,
  OmpModelDraft,
  OmpModelsSnapshot,
  OmpProviderRow,
} from '../../src/types/api'
import { ompAgentDir, validateTokenccApiKey } from './tokencc-omp'
import { isRecord, rejectUnknownKeys, requireRecord, requireString, requireWebUrl } from './validation'

const require = createRequire(import.meta.url)
const yaml = require('js-yaml') as {
  load(source: string): unknown
  dump(value: unknown, options?: { lineWidth?: number; noRefs?: boolean }): string
}

const MAX_API_KEY_LENGTH = 512
const MAX_MODELS = 256
const MODEL_PROBE_TIMEOUT_MS = 15_000
const CUSTOM_ROUTE_PATTERN = /^[a-z][a-z0-9-]*$/
const ENV_LINE_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*=/

/** Mainstream API-key catalog providers (no OAuth / Bedrock / Azure). */
export const OMP_CATALOG_PROVIDERS: readonly OmpCatalogProviderOption[] = [
  { id: 'deepseek', displayName: 'DeepSeek', defaultModel: 'deepseek/deepseek-chat' },
  { id: 'anthropic', displayName: 'Anthropic', defaultModel: 'anthropic/claude-sonnet-4-5' },
  { id: 'openai', displayName: 'OpenAI', defaultModel: 'openai/gpt-5' },
  { id: 'google', displayName: 'Google', defaultModel: 'google/gemini-2.5-pro' },
  { id: 'openrouter', displayName: 'OpenRouter', defaultModel: 'openrouter/auto' },
  { id: 'groq', displayName: 'Groq', defaultModel: 'groq/llama-3.3-70b-versatile' },
  { id: 'mistral', displayName: 'Mistral', defaultModel: 'mistral/mistral-large-latest' },
  { id: 'xai', displayName: 'xAI', defaultModel: 'xai/grok-3' },
  { id: 'moonshot', displayName: 'Moonshot', defaultModel: 'moonshot/kimi-k2' },
  { id: 'minimax', displayName: 'MiniMax', defaultModel: 'minimax/MiniMax-M2' },
  { id: 'zai', displayName: 'Zhipu / Z.ai', defaultModel: 'zai/glm-4.6' },
  { id: 'together', displayName: 'Together', defaultModel: 'together/meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo' },
  { id: 'fireworks', displayName: 'Fireworks', defaultModel: 'fireworks/accounts/fireworks/models/llama-v3p1-70b-instruct' },
]

const CATALOG_BY_ID = new Map(OMP_CATALOG_PROVIDERS.map((provider) => [provider.id, provider]))

export const OMP_DISCOVERABLE_APIS = ['openai-completions', 'openai-responses'] as const
export type DiscoverModelsFn = (input: { baseUrl: string; apiKey?: string }) => Promise<readonly DiscoveredModel[]>

export function loadYamlObject(source: string, label: string): Record<string, unknown> {
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

export async function readYamlFile(path: string, label: string): Promise<Record<string, unknown>> {
  try {
    const source = await readFile(path, 'utf8')
    return loadYamlObject(source, label)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
}

export function dumpYaml(value: Record<string, unknown>): string {
  return `${yaml.dump(value, { lineWidth: 120, noRefs: true }).trimEnd()}\n`
}

export function providerHasApiKey(providers: Record<string, unknown>, providerId: string): boolean {
  const block = isRecord(providers[providerId]) ? providers[providerId] : null
  return Boolean(block && typeof block.apiKey === 'string' && block.apiKey.trim())
}

export function providerIsKeyless(providers: Record<string, unknown>, providerId: string): boolean {
  const block = isRecord(providers[providerId]) ? providers[providerId] : null
  return Boolean(block && block.auth === 'none')
}

export function providerUsable(providers: Record<string, unknown>, providerId: string): boolean {
  return providerHasApiKey(providers, providerId) || providerIsKeyless(providers, providerId)
}

export async function readModelsDoc(home = homedir()): Promise<Record<string, unknown>> {
  return readYamlFile(join(ompAgentDir(home), 'models.yml'), 'models.yml')
}

export async function listDeclaredProviderIds(home = homedir()): Promise<string[]> {
  try {
    const modelsDoc = await readModelsDoc(home)
    const providers = isRecord(modelsDoc.providers) ? modelsDoc.providers : {}
    return Object.keys(providers).filter((id) => typeof id === 'string' && id.length > 0 && id.length <= 128)
  } catch {
    return []
  }
}

function modelsPath(home: string): string {
  return join(ompAgentDir(home), 'models.yml')
}

function configPath(home: string): string {
  return join(ompAgentDir(home), 'config.yml')
}

function wrappedInQuotes(value: string): boolean {
  const quote = value[0]
  return (quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote)
}

/** Empty means keep the stored key. Whitespace-only and env-line pastes fail. */
export function validateOptionalApiKey(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'string') throw new TypeError('API key must be a string')
  if (raw.includes('\0')) throw new TypeError('API key contains a NUL byte')
  if (raw.length === 0) return undefined
  if (!raw.trim()) throw new TypeError('Enter an API key; leave the field empty to keep the stored key.')
  const trimmed = raw.trim()
  if (trimmed.length > MAX_API_KEY_LENGTH) throw new TypeError('API key is too long')
  if (ENV_LINE_PATTERN.test(trimmed) || wrappedInQuotes(trimmed)) throw new TypeError('This API key is the wrong format. Check it and paste it again.')
  return validateTokenccApiKey(raw)
}

export function validateCustomProviderId(raw: unknown, taken: ReadonlySet<string>): string {
  const id = requireString(raw, 'Provider ID', { min: 1, max: 64, trim: true })
  if (!CUSTOM_ROUTE_PATTERN.test(id)) throw new TypeError('Provider ID must start with a lowercase letter and may then use lowercase letters, digits, and hyphens.')
  if (taken.has(id) || CATALOG_BY_ID.has(id)) throw new TypeError('A provider already uses this ID.')
  return id
}

function parsePositiveInt(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) throw new TypeError(`${label} must be a positive integer`)
  return value
}

export function parseModelDrafts(value: unknown): OmpModelDraft[] {
  if (!Array.isArray(value)) throw new TypeError('models must be an array')
  if (value.length > MAX_MODELS) throw new TypeError('Too many models')
  const drafts: OmpModelDraft[] = []
  const seen = new Set<string>()
  for (const [index, row] of value.entries()) {
    if (!isRecord(row)) throw new TypeError(`models[${index}] must be an object`)
    rejectUnknownKeys(row, ['id', 'name', 'contextWindow', 'maxTokens'], `models[${index}]`)
    const id = requireString(row.id, `models[${index}].id`, { min: 1, max: 256, trim: true })
    if (seen.has(id)) throw new TypeError('Each model ID can appear only once.')
    seen.add(id)
    const draft: OmpModelDraft = { id }
    if (row.name !== undefined) draft.name = requireString(row.name, `models[${index}].name`, { min: 1, max: 500, trim: true })
    if (row.contextWindow !== undefined) draft.contextWindow = parsePositiveInt(row.contextWindow, `models[${index}].contextWindow`)
    if (row.maxTokens !== undefined) draft.maxTokens = parsePositiveInt(row.maxTokens, `models[${index}].maxTokens`)
    drafts.push(draft)
  }
  return drafts
}

function draftsFromYaml(value: unknown): OmpModelDraft[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((row) => {
    if (!isRecord(row) || typeof row.id !== 'string' || !row.id.trim()) return []
    const draft: OmpModelDraft = { id: row.id.trim() }
    if (typeof row.name === 'string' && row.name.trim()) draft.name = row.name.trim()
    if (typeof row.contextWindow === 'number' && Number.isInteger(row.contextWindow) && row.contextWindow > 0) draft.contextWindow = row.contextWindow
    if (typeof row.maxTokens === 'number' && Number.isInteger(row.maxTokens) && row.maxTokens > 0) draft.maxTokens = row.maxTokens
    return [draft]
  })
}

function modelsListUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '')
  return trimmed.endsWith('/v1') ? `${trimmed}/models` : `${trimmed}/v1/models`
}

export async function fetchOpenAiModels(input: { baseUrl: string; apiKey?: string }): Promise<readonly DiscoveredModel[]> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (input.apiKey) headers.Authorization = `Bearer ${input.apiKey}`
  let response: Response
  try {
    response = await fetch(modelsListUrl(input.baseUrl), {
      headers,
      signal: AbortSignal.timeout(MODEL_PROBE_TIMEOUT_MS),
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') throw new Error('The provider did not list models in time')
    throw new Error('Could not reach the provider to list models')
  }
  if (response.status === 401 || response.status === 403) throw new Error('The provider rejected this API key')
  if (!response.ok) throw new Error(`Model lookup failed (${response.status})`)
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new Error('The provider returned an invalid model list')
  }
  const rows = isRecord(payload) && Array.isArray(payload.data) ? payload.data : []
  const models: DiscoveredModel[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    if (!isRecord(row) || typeof row.id !== 'string' || !row.id.trim()) continue
    const id = row.id.trim()
    if (seen.has(id) || id.length > 256) continue
    seen.add(id)
    const name = typeof row.name === 'string' && row.name.trim() ? row.name.trim().slice(0, 500) : id
    models.push({ id, name })
    if (models.length >= MAX_MODELS) break
  }
  return models
}

function providerRow(id: string, block: Record<string, unknown>): OmpProviderRow {
  const catalog = CATALOG_BY_ID.get(id)
  const models = draftsFromYaml(block.models)
  const displayName = typeof block.displayName === 'string' && block.displayName.trim()
    ? block.displayName.trim()
    : (catalog?.displayName ?? id)
  const kind = catalog ? 'catalog' : 'custom'
  return {
    id,
    displayName,
    kind,
    configured: typeof block.apiKey === 'string' && Boolean(block.apiKey.trim()),
    keylessAuth: block.auth === 'none',
    removable: true,
    baseUrl: typeof block.baseUrl === 'string' && block.baseUrl.trim() ? block.baseUrl.trim() : undefined,
    api: typeof block.api === 'string' ? block.api : undefined,
    modelsOverridden: models.length > 0,
    models,
  }
}

export async function listModelProviders(home = homedir()): Promise<OmpModelsSnapshot> {
  const modelsDoc = await readModelsDoc(home)
  const providers = isRecord(modelsDoc.providers) ? modelsDoc.providers : {}
  const rows: OmpProviderRow[] = []
  for (const [id, value] of Object.entries(providers)) {
    if (!isRecord(value)) continue
    rows.push(providerRow(id, value))
  }
  rows.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'catalog' ? -1 : 1
    return a.displayName.localeCompare(b.displayName)
  })
  const taken = new Set(rows.map((row) => row.id))
  const availableCatalog = OMP_CATALOG_PROVIDERS.filter((provider) => !taken.has(provider.id))
  return { rows, availableCatalog }
}

export function snapshotHasUsableProvider(snapshot: OmpModelsSnapshot): boolean {
  return snapshot.rows.some((row) => row.configured || row.keylessAuth)
}

async function writeModelsDoc(home: string, modelsDoc: Record<string, unknown>): Promise<void> {
  const agentDir = ompAgentDir(home)
  await mkdir(agentDir, { recursive: true })
  await writeFile(modelsPath(home), dumpYaml(modelsDoc), 'utf8')
}

function requireDiscoverableApi(value: unknown): OmpDiscoverableApi {
  const api = requireString(value, 'api', { min: 1, max: 64, trim: true })
  if (!(OMP_DISCOVERABLE_APIS as readonly string[]).includes(api)) throw new TypeError('Unsupported API protocol')
  return api as OmpDiscoverableApi
}

function applyModelOverride(block: Record<string, unknown>, models: OmpModelDraft[] | undefined, resetModels: boolean | undefined): Record<string, unknown> {
  const next = { ...block }
  if (resetModels) {
    delete next.models
    return next
  }
  if (models) next.models = models
  return next
}

/** Seed modelRoles.default only when the user has not set one yet. */
async function maybePinDefaultModel(home: string, providerId: string, models?: OmpModelDraft[]): Promise<void> {
  const catalog = CATALOG_BY_ID.get(providerId)
  const preferred = catalog?.defaultModel
    ?? (models?.[0] ? `${providerId}/${models[0].id}` : undefined)
  if (!preferred) return
  const configDoc = await readYamlFile(configPath(home), 'config.yml')
  const modelRoles = isRecord(configDoc.modelRoles) ? { ...configDoc.modelRoles } : {}
  if (typeof modelRoles.default === 'string' && modelRoles.default.trim()) return
  modelRoles.default = preferred
  configDoc.modelRoles = modelRoles
  await mkdir(ompAgentDir(home), { recursive: true })
  await writeFile(configPath(home), dumpYaml(configDoc), 'utf8')
}

export async function saveProvider(raw: unknown, home = homedir()): Promise<OmpModelsSnapshot> {
  const draft = requireRecord(raw, 'provider')
  rejectUnknownKeys(draft, ['providerId', 'apiKey', 'baseUrl', 'models', 'resetModels'], 'provider')
  const providerId = requireString(draft.providerId, 'providerId', { min: 1, max: 128, trim: true })
  const apiKey = validateOptionalApiKey(draft.apiKey)
  const resetModels = draft.resetModels === true
  const models = draft.models === undefined ? undefined : parseModelDrafts(draft.models)
  const baseUrl = draft.baseUrl === undefined
    ? undefined
    : draft.baseUrl === ''
      ? ''
      : requireWebUrl(draft.baseUrl)

  const modelsDoc = await readModelsDoc(home)
  const providers = isRecord(modelsDoc.providers) ? { ...modelsDoc.providers } : {}
  const existing = isRecord(providers[providerId]) ? { ...providers[providerId] } : {}
  const isCatalog = CATALOG_BY_ID.has(providerId)
  const creating = !providers[providerId]

  if (creating && !isCatalog) throw new Error('Provider was not found')
  if (creating && apiKey === undefined) throw new TypeError('API key is required')
  if (!creating && apiKey === undefined && !providerHasApiKey(providers, providerId) && existing.auth !== 'none' && !isCatalog) {
    // Custom providers may stay keyless; catalog edits that never had a key still need one when creating.
  }

  let next: Record<string, unknown> = { ...existing }
  if (baseUrl !== undefined) {
    if (baseUrl === '') delete next.baseUrl
    else next.baseUrl = baseUrl.replace(/\/$/, '')
  }
  if (apiKey !== undefined) {
    next.apiKey = apiKey
    delete next.auth
  }
  if (isCatalog && !next.displayName) next.displayName = CATALOG_BY_ID.get(providerId)!.displayName
  next = applyModelOverride(next, models, resetModels)
  providers[providerId] = next
  modelsDoc.providers = providers
  await writeModelsDoc(home, modelsDoc)

  if (creating || apiKey !== undefined) {
    await maybePinDefaultModel(home, providerId, models ?? draftsFromYaml(next.models))
  }

  return listModelProviders(home)
}

export async function createCustomProvider(raw: unknown, home = homedir()): Promise<OmpModelsSnapshot> {
  const draft = requireRecord(raw, 'provider')
  rejectUnknownKeys(draft, ['id', 'displayName', 'baseUrl', 'api', 'apiKey', 'models'], 'provider')
  const modelsDoc = await readModelsDoc(home)
  const providers = isRecord(modelsDoc.providers) ? { ...modelsDoc.providers } : {}
  const taken = new Set(Object.keys(providers))
  const id = validateCustomProviderId(draft.id, taken)
  const baseUrl = requireWebUrl(draft.baseUrl).replace(/\/$/, '')
  const api = requireDiscoverableApi(draft.api)
  const models = parseModelDrafts(draft.models)
  if (models.length === 0) throw new TypeError('A custom provider needs at least one model.')
  const apiKey = validateOptionalApiKey(draft.apiKey)
  const displayName = draft.displayName === undefined || draft.displayName === ''
    ? undefined
    : requireString(draft.displayName, 'displayName', { min: 1, max: 120, trim: true })

  const block: Record<string, unknown> = { baseUrl, api, models }
  if (displayName) block.displayName = displayName
  if (apiKey) block.apiKey = apiKey
  else block.auth = 'none'

  providers[id] = block
  modelsDoc.providers = providers
  await writeModelsDoc(home, modelsDoc)
  await maybePinDefaultModel(home, id, models)
  return listModelProviders(home)
}

export async function deleteCustomProvider(rawId: unknown, home = homedir()): Promise<OmpModelsSnapshot> {
  const providerId = requireString(rawId, 'providerId', { min: 1, max: 128, trim: true })
  const modelsDoc = await readModelsDoc(home)
  const providers = isRecord(modelsDoc.providers) ? { ...modelsDoc.providers } : {}
  if (!providers[providerId]) return listModelProviders(home)
  delete providers[providerId]
  modelsDoc.providers = providers
  await writeModelsDoc(home, modelsDoc)
  return listModelProviders(home)
}

export async function discoverModels(
  raw: unknown,
  home = homedir(),
  probe: DiscoverModelsFn = fetchOpenAiModels,
): Promise<readonly DiscoveredModel[]> {
  const input = requireRecord(raw, 'discover')
  rejectUnknownKeys(input, ['providerId', 'baseUrl', 'apiKey'], 'discover')
  const baseUrl = requireWebUrl(input.baseUrl).replace(/\/$/, '')
  let apiKey = validateOptionalApiKey(input.apiKey)
  if (apiKey === undefined && typeof input.providerId === 'string' && input.providerId.trim()) {
    const modelsDoc = await readModelsDoc(home)
    const providers = isRecord(modelsDoc.providers) ? modelsDoc.providers : {}
    const stored = providers[input.providerId.trim()]
    if (isRecord(stored) && typeof stored.apiKey === 'string' && stored.apiKey.trim()) apiKey = stored.apiKey.trim()
  }
  const found = await probe({ baseUrl, apiKey })
  return found.map(({ id, name }) => ({ id, name }))
}
