/**
 * Session partition shared by the in-app browser webviews. The renderer's
 * webview attribute must match the main process's will-attach-webview gate
 * exactly, or webview attach is silently blocked.
 */
export const BROWSER_PARTITION = 'persist:prime-work-browser'

export type ThemeMode = 'system' | 'light' | 'dark'
export type WorkspaceView = 'session' | 'projects' | 'activity' | 'plugins' | 'skills' | 'settings'
export type InspectorTab = 'summary' | 'changes' | 'browser' | 'files'
export type SessionStatus = 'idle' | 'running' | 'waiting' | 'complete' | 'failed' | 'unknown'

export const HARNESS_IDS = ['omp'] as const
export type HarnessId = (typeof HARNESS_IDS)[number]

/**
 * OMP tool-approval preference. 'inherit' defers to OMP's own
 * `~/.omp/agent/config.yml`; the other values are passed to the omp CLI as
 * `--approval-mode` when starting an OMP runtime.
 */
export const OMP_APPROVAL_MODES = ['inherit', 'always-ask', 'write', 'yolo'] as const
export type OmpApprovalMode = (typeof OMP_APPROVAL_MODES)[number]

export interface HarnessStatus {
  path: string | null
  version: string | null
}

export interface AppMeta {
  version: string
  platform: NodeJS.Platform
  homeDir: string
  harnesses: Record<HarnessId, HarnessStatus>
}

export type OmpInstallPhase = 'checking' | 'downloading' | 'verifying' | 'installing'
export interface InstalledOmp { path: string; version: string }

export type ApplicationMenuName = 'file' | 'edit' | 'view' | 'window' | 'help'

export type AppUpdatePhase = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'not-available' | 'error' | 'unsupported'

export interface AppUpdateState {
  phase: AppUpdatePhase
  version?: string
  percent?: number
  message?: string
}

export interface ProjectRecord {
  id: string
  /** Agent harness this project grant belongs to; grants never cross harnesses. */
  harness: HarnessId
  name: string
  path: string
  folders: string[]
  primaryFolder: string
  pinned: boolean
  createdAt: string
  lastOpenedAt: string
  sessionCount: number
  gitBranch?: string
  inferred?: boolean
  /**
   * True when the primary folder's persisted identity still matches the live
   * directory. Inferred projects and stale grants are false until re-granted.
   */
  authorized: boolean
}

export interface SessionRecord {
  id: string
  /** Agent harness that owns this session; populated by the owning session service. */
  harness: HarnessId
  filePath: string
  projectPath: string
  title: string
  createdAt: string
  updatedAt: string
  lastUserMessageAt?: string
  status: SessionStatus
  model?: string
  provider?: string
  thinkingLevel?: string
  depth: number
  pinned?: boolean
  unread?: boolean
  /** Monotonic renderer lifecycle revision used to distinguish attention events. */
  eventRevision?: number
  /** Lifecycle revision that authored the current status; absent when the catalog owns it. */
  statusEventRevision?: number
  preview?: string
  archived?: boolean
  syncRevision?: number
}

export interface PromptImage {
  type: 'image'
  mimeType: string
  data: string
}

export interface BrowserAnnotationRect {
  x: number
  y: number
  width: number
  height: number
}

/** Element info captured from the embedded browser page. Every field is untrusted page data: bounded on capture, rendered as plain text only. */
export interface BrowserAnnotationElement {
  selector: string
  tagName: string
  id: string
  classes: string[]
  text: string
  href?: string
  src?: string
  rect: BrowserAnnotationRect
}

export interface BrowserAnnotation {
  id: string
  comment: string
  element: BrowserAnnotationElement
  pageUrl: string
  pageTitle: string
  /** True once the page navigated away after capture: the live marker is gone but the captured info remains valid. */
  stale: boolean
  createdAt: number
}

export type PrimeCompactionReason = 'manual' | 'threshold' | 'overflow' | 'requested'
export type PrimeCompactionStatus = 'running' | 'done' | 'failed' | 'cancelled'
export type PrimeCompactionOutcome = 'failed' | 'cancelled' | 'skipped'

export type MessagePart =
  | { type: 'text'; partId?: string; text: string }
  | { type: 'thinking'; partId?: string; text: string }
  | { type: 'toolCall'; partId?: string; id?: string; name: string; args?: unknown }
  | { type: 'toolResult'; partId?: string; name?: string; text: string; isError?: boolean; streaming?: boolean }
  | { type: 'agentMessage'; partId?: string; text: string; agentName?: string }
  | { type: 'image'; partId?: string; mimeType?: string; data?: string; dataTruncated?: boolean }
  | {
      type: 'compaction'
      partId?: string
      status: PrimeCompactionStatus
      reason?: PrimeCompactionReason
      outcome?: PrimeCompactionOutcome
      tokensBefore?: number
      firstKeptEntryId?: string
      summary?: string
      error?: string
      customInstructions?: string
      willRetry?: boolean
    }

export interface TranscriptMessage {
  id: string
  role: 'user' | 'assistant' | 'agent' | 'goal' | 'tool' | 'system'
  /** Renderer-local steering lifecycle. Persisted transcripts remain harness-owned. */
  steerState?: 'accepted' | 'read'
  /** Lightweight renderer-only boundary showing where an accepted steer was consumed. */
  kind?: 'steer-read-marker'
  timestamp?: string | number
  agentName?: string
  startedAt?: string | number
  completedAt?: string | number
  parts: MessagePart[]
  streaming?: boolean
}

export interface PrimeContextUsage {
  tokens: number | null
  contextWindow: number
  percent: number | null
}

export interface RuntimeInfo {
  runtimeId: string
  harness: HarnessId
  sessionId?: string
  sessionFile?: string
  cwd: string
  isStreaming: boolean
  sessionActions?: SessionActionSnapshot
  isCompacting?: boolean
  model?: { provider?: string; id?: string; name?: string } | null
  thinkingLevel?: string
  availableThinkingLevels?: PrimeThinkingLevel[]
  fastModeSupported?: boolean
  imageInputSupported?: boolean
  fastModeAvailable?: boolean
  serviceTier?: PrimeServiceTier
  contextUsage?: PrimeContextUsage
}

export const PRIME_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export type PrimeThinkingLevel = (typeof PRIME_THINKING_LEVELS)[number]
export type PrimeServiceTier = 'auto' | 'default' | 'flex' | 'scale' | 'priority' | null
export type ProviderAuthMethod = 'oauth' | 'api_key' | 'external'
export type ProviderAuthSource = 'stored' | 'runtime' | 'environment' | 'prime_cli' | 'fallback' | 'models_json_key' | 'models_json_command' | 'stale'

export interface PrimeModelDescriptor {
  key: string
  provider: string
  id: string
  name: string
  reasoning: boolean
  input: Array<'text' | 'image'>
  contextWindow: number
  maxTokens: number
  availableThinkingLevels: PrimeThinkingLevel[]
  fastModeSupported: boolean
  available: boolean
  /** WorkDaddy visibility policy for this harness; absent catalogs predate per-model controls. */
  enabled?: boolean
}

export interface PrimeProviderDescriptor {
  id: string
  name: string
  authMethod: ProviderAuthMethod
  configured: boolean
  authSource?: ProviderAuthSource
  authLabel?: string
  modelCount: number
  availableModelCount: number
  enabled: boolean
}

export interface PrimeModelCatalog {
  primeVersion: string
  refreshedAt: string
  models: PrimeModelDescriptor[]
  providers: PrimeProviderDescriptor[]
  warning?: string
}

export interface TokenccStatus {
  configured: boolean
  deepseek: boolean
  openai: boolean
}

export interface TokenccSaveResult {
  configured: true
  provider: 'deepseek' | 'openai-codex'
  family: 'deepseek' | 'openai'
  defaultModel: string
  families: { deepseek: boolean; openai: boolean }
}

export type OmpDiscoverableApi = 'openai-completions' | 'openai-responses'
export type OmpProviderKind = 'catalog' | 'custom'

export interface OmpCatalogProviderOption {
  id: string
  displayName: string
  defaultModel?: string
}

export interface OmpModelDraft {
  id: string
  name?: string
  contextWindow?: number
  maxTokens?: number
}

export interface OmpProviderRow {
  id: string
  displayName: string
  kind: OmpProviderKind
  configured: boolean
  keylessAuth: boolean
  removable: boolean
  baseUrl?: string
  api?: string
  modelsOverridden: boolean
  models: OmpModelDraft[]
}

export interface OmpModelsSnapshot {
  rows: OmpProviderRow[]
  availableCatalog: OmpCatalogProviderOption[]
}

export interface DiscoveredModel {
  id: string
  name: string
}

export interface SaveOmpProviderDraft {
  providerId: string
  apiKey?: string
  baseUrl?: string
  models?: OmpModelDraft[]
  resetModels?: boolean
}

export interface CreateOmpProviderDraft {
  id: string
  displayName?: string
  baseUrl: string
  api: OmpDiscoverableApi
  apiKey?: string
  models: OmpModelDraft[]
}

export interface DiscoverOmpModelsInput {
  providerId?: string
  baseUrl: string
  apiKey?: string
}

export interface PrimeEventEnvelope {
  runtimeId: string
  event: Record<string, unknown>
}

export interface SessionChangeEvent {
  filePath?: string
  /** Harness whose session catalog changed; absent events predate harness scoping. */
  harness?: HarnessId
}

export interface SkillRecord {
  id: string
  name: string
  description: string
  kind: 'skill' | 'extension' | 'prompt' | 'package' | 'mcp'
  location: 'bundled' | 'user' | 'project' | 'system'
  path?: string
  enabled: boolean
  icon?: string
  source?: string
  /** MCP server ids this package exists to bridge. Used to collapse duplicate capability rows. */
  associatedMcpServers?: string[]
  associatedPackageSource?: string
  /** Exact bounded map key used only for definition removal; never rendered as display copy. */
  definitionKey?: string
  /** False when an external definition key cannot be represented safely by the app removal API. */
  definitionRemovalAvailable?: boolean
  availability?: {
    available: boolean
    detail: string
    actionUrl?: string
  }
}

export interface PluginWarning {
  scope: 'user' | 'project'
  path: string
  message: string
}

export interface SkillDocumentFile {
  name: string
  isDirectory: boolean
  /** True when this subdirectory itself contains a SKILL.md that omp's non-recursive discovery will never see. */
  hasNestedSkill: boolean
}

/** Full contents of one SKILL.md, read on demand for the skill detail view. */
export interface SkillDocument {
  frontmatter: {
    name?: string
    description?: string
    globs?: string
    alwaysApply?: string
    disableModelInvocation?: string
  }
  body: string
  truncated: boolean
  baseDir: string
  files: SkillDocumentFile[]
}

export interface PluginCatalog {
  skills: SkillRecord[]
  warnings: PluginWarning[]
}

export type McpConnectionInput = {
  name: string
  scope: 'user' | 'project'
  projectPath?: string
} & (
  | { type: 'http'; url: string; auth?: 'none' | 'oauth' | 'bearer'; bearerTokenEnvVar?: string }
  | { type: 'stdio'; command: string; args?: string[] }
)

export interface McpStateInput {
  name: string
  scope: 'user' | 'project'
  projectPath?: string
  enabled: boolean
}

export interface CapabilityMutationInput {
  kind: 'package' | 'mcp'
  action: 'enable' | 'disable' | 'remove'
  name: string
  /** Exact bounded MCP map key for definition-only removal. */
  definitionKey?: string
  source?: string
  scope: 'user' | 'project'
  projectPath?: string
}

export interface ExtensionInstallInput {
  source: string
  scope: 'user' | 'project'
  projectPath?: string
}

export interface ProjectFileEntry { path: string; type: 'file' | 'directory' }
export interface ProjectFileListing { entries: ProjectFileEntry[]; skipped: number; truncated: boolean }

export interface GitWorktree {
  path: string
  name: string
  branch?: string
  head: string
  current: boolean
  detached: boolean
}

export interface GitFileChange {
  path: string
  status: string
  staged: boolean
  additions: number
  deletions: number
}
export interface GitStatus {
  isRepo: boolean
  branch?: string
  upstream?: string
  ahead?: number
  behind?: number
  files: GitFileChange[]
  truncated?: boolean
  error?: string
}
export interface GitDiff { path?: string; staged: boolean; text: string; truncated: boolean; error?: string }

/**
 * The one result shape for subprocess-backed operations (git commit, package
 * install, MCP settings updates). `reason` classifies failures: the subprocess
 * timed out, exceeded its output limit, exited non-zero, or the operation was
 * blocked before or instead of running the subprocess.
 */
export type ProcessFailureReason = 'timeout' | 'overflow' | 'exit' | 'blocked'
export interface ProcessOutcome { ok: boolean; output: string; reason?: ProcessFailureReason }

export interface TerminalSpawnOptions { cwd: string; sessionPath?: string; shell?: string; cols?: number; rows?: number }
export interface TerminalDataEvent { terminalId: string; data: string }
export interface TerminalExitEvent { terminalId: string; exitCode: number; signal?: number }
export interface TerminalSelectionContext { tabId: string; label: string; text: string; truncated: boolean }
export interface TerminalPromptContext extends TerminalSelectionContext { cwd?: string }
export interface TerminalActiveContext { label: string; content: string; truncated: boolean }

export type MessageEnterAction = 'queue' | 'steer'
export type PromptDeliveryIntent = 'queue' | 'steer'

export interface QueuedPrompt {
  id: string
  text: string
  intent: PromptDeliveryIntent
  /** Stable presentation data while a steer waits for the agent to pick it up. */
  timestamp?: number
  parts?: MessagePart[]
}

export interface SessionActionSnapshot {
  queuedCount: number
  steering: string[]
  followUps: string[]
  active?: {
    kind: 'turn' | 'session_command'
    phase: 'preparing' | 'committing' | 'running'
    label?: string
  }
}

export const INTERFACE_FONT_SCALES = [105, 110, 115] as const
export type InterfaceFontScale = typeof INTERFACE_FONT_SCALES[number]
export const LOCALE_PREFERENCES = ['system', 'en', 'zh-CN'] as const
export type LocalePreference = typeof LOCALE_PREFERENCES[number]

export interface AppSettings {
  theme: ThemeMode
  locale: LocalePreference
  /** Bounded interface text scale; 110 is the designed default. */
  interfaceFontScale: InterfaceFontScale
  sidebarOpen: boolean
  inspectorOpen: boolean
  showFileChangesPopup: boolean
  /** Keep the desktop process available for scheduled work after its window closes. */
  keepRunningInBackground: boolean
  /** Ask the operating system to launch WorkDaddy when the user signs in. */
  launchAtLogin: boolean
  terminalOpen: boolean
  defaultInspectorTab: InspectorTab
  browserHome: string
  browserAskForDownloads: boolean
  terminalShell: string
  reduceMotion: boolean
  showReasoningSummaries: boolean
  showToolCalls: boolean
  messageEnterAction: MessageEnterAction
  /** Optional absolute executable overrides; blank keeps automatic discovery. */
  runtimePaths: Record<HarnessId, string>
  /** Legacy visibility preference retained for state compatibility; executable detection is authoritative. */
  enabledHarnesses: HarnessId[]
  /**
   * Legacy diagnostics preference retained for persisted-state compatibility.
   * The Privacy UI deliberately ignores this field; any reporting use needs separate review.
   */
  telemetry: boolean
  /** WorkDaddy-managed ask_user tool, shared by every interactive harness. */
  askUserEnabled: boolean
  /** Expose WorkDaddy's thread-scoped in-app browser controls to new sessions. */
  browserEnabled: boolean
  /** Providers hidden from WorkDaddy's OMP model picker; OMP config is untouched. */
  ompDisabledProviders: string[]
  /** Models hidden from WorkDaddy's OMP model picker; OMP config is untouched. */
  ompDisabledModels: string[]
  /** Harness whose workspace the renderer shows; new installs default to 'omp'. */
  activeHarness: HarnessId
  /** OMP tool-approval override; 'inherit' leaves OMP's own config in charge. */
  ompApprovalMode: OmpApprovalMode
  /** True once the first-run wizard has been completed or explicitly skipped. */
  onboardingCompleted: boolean
}

/** One agent-controlled browser tab. The registry lives in the main process; the renderer hosts the webview guests and mirrors this state. */
export interface AgentBrowserTabRecord {
  tabId: string
  /** Canonical session file path of the thread this tab belongs to. */
  sessionFile: string
  url: string
  title: string
  /** Whether a live webview guest is currently bound to this tab. */
  attached: boolean
  /** Whether this is the session's currently targeted tab. */
  active: boolean
  canGoBack: boolean
  canGoForward: boolean
}

export interface AgentBrowserState {
  tabs: AgentBrowserTabRecord[]
}

/** Emitted for every agent browser action, so the UI can surface the Browser panel while the agent works. */
export interface AgentBrowserActivityEvent {
  sessionFile: string
  tabId: string
}

/** Emitted when the agent moves the pointer in a tab, so the UI can animate a synthetic cursor along the same path on the same clock. */
export interface AgentBrowserPointerEvent {
  tabId: string
  sessionFile: string
  /** Previous pointer position, or null when the cursor first appears in a tab. */
  from: { x: number; y: number } | null
  to: { x: number; y: number }
  action: 'move' | 'click' | 'scroll'
  /** How long the glide takes; 0 means the cursor appears in place. */
  durationMs: number
}

export interface PrimeWorkApi {
  app: { getMeta(): Promise<AppMeta>; refreshHarnesses(): Promise<{ meta: AppMeta; settings: AppSettings }>; openExternal(url: string): Promise<boolean>; revealPath(path: string): Promise<boolean>; popupMenu(menu: ApplicationMenuName, x: number, y: number): Promise<boolean>; setTitleBarTheme(theme: Exclude<ThemeMode, 'system'>): Promise<boolean>; onOpenSettings(callback: () => void): () => void; installOmp(): Promise<InstalledOmp>; onInstallOmpProgress(callback: (phase: OmpInstallPhase) => void): () => void }
  updates: {
    getState(): Promise<AppUpdateState>
    check(): Promise<AppUpdateState>
    downloadAndInstall(): Promise<boolean>
    onChanged(callback: (state: AppUpdateState) => void): () => void
  }
  projects: {
    list(harness?: HarnessId): Promise<ProjectRecord[]>
    listFiles(root: string, harness?: HarnessId): Promise<ProjectFileListing>
    listDirectory(root: string, directory: string, harness?: HarnessId): Promise<ProjectFileListing>
    listWorktrees(cwd: string, harness?: HarnessId): Promise<GitWorktree[]>
    openWorktree(cwd: string, path: string, harness?: HarnessId): Promise<ProjectRecord>
    createWorktree(cwd: string, branch: string, harness?: HarnessId): Promise<ProjectRecord | null>
    add(harness?: HarnessId): Promise<ProjectRecord | null>
    grantInferred(path: string, harness?: HarnessId): Promise<ProjectRecord>
    regrant(path: string, harness?: HarnessId): Promise<ProjectRecord>
    remove(id: string, harness?: HarnessId): Promise<boolean>
    touch(id: string, harness?: HarnessId): Promise<boolean>
  }
  sessions: {
    list(projectPath?: string, includeArchived?: boolean, harness?: HarnessId, force?: boolean): Promise<SessionRecord[]>
    read(filePath: string): Promise<TranscriptMessage[]>
    rename(filePath: string, title: string): Promise<boolean>
    archive(filePath: string, archived?: boolean): Promise<boolean>
    delete(filePath: string): Promise<boolean>
    onChanged(callback: (event: SessionChangeEvent) => void): () => void
  }
  agent: {
    start(options: { cwd: string; sessionPath?: string; model?: string; thinking?: string; fast?: boolean; harness?: HarnessId }): Promise<RuntimeInfo>
    command(runtimeId: string, command: Record<string, unknown>): Promise<Record<string, unknown>>
    stop(runtimeId: string): Promise<boolean>
    list(): Promise<RuntimeInfo[]>
    onEvent(callback: (envelope: PrimeEventEnvelope) => void): () => void
  }
  providers: {
    catalog(force?: boolean, harness?: HarnessId): Promise<PrimeModelCatalog>
    setEnabled(providerId: string, enabled: boolean, harness?: HarnessId): Promise<PrimeModelCatalog>
    setDisabled(providerIds: string[], harness?: HarnessId): Promise<PrimeModelCatalog>
    setModelEnabled(modelKey: string, enabled: boolean, harness?: HarnessId): Promise<PrimeModelCatalog>
    saveTokenccKey(apiKey: string): Promise<TokenccSaveResult>
    tokenccStatus(): Promise<TokenccStatus>
    listModelProviders(): Promise<OmpModelsSnapshot>
    saveProvider(draft: SaveOmpProviderDraft): Promise<OmpModelsSnapshot>
    createCustomProvider(draft: CreateOmpProviderDraft): Promise<OmpModelsSnapshot>
    deleteCustomProvider(providerId: string): Promise<OmpModelsSnapshot>
    discoverModels(input: DiscoverOmpModelsInput): Promise<readonly DiscoveredModel[]>
  }
  terminal: {
    create(options: TerminalSpawnOptions): Promise<{ terminalId: string; shell: string }>
    bindSession(terminalId: string, sessionPath: string): Promise<boolean>
    input(terminalId: string, data: string): void
    resize(terminalId: string, cols: number, rows: number): void
    setActiveContext(terminalId: string, context: TerminalActiveContext): void
    clearActiveContext(terminalId: string): void
    kill(terminalId: string): Promise<boolean>
    onData(callback: (event: TerminalDataEvent) => void): () => void
    onExit(callback: (event: TerminalExitEvent) => void): () => void
  }
  git: { status(cwd: string): Promise<GitStatus>; diff(cwd: string, path?: string, staged?: boolean): Promise<GitDiff>; stage(cwd: string, paths: string[]): Promise<boolean>; unstage(cwd: string, paths: string[]): Promise<boolean>; restore(cwd: string, paths: string[]): Promise<boolean>; commit(cwd: string, message: string): Promise<ProcessOutcome> }
  plugins: {
    list(projectPath?: string, harness?: HarnessId): Promise<PluginCatalog>
    install(source: string, harness?: HarnessId): Promise<ProcessOutcome>
    installExtension(input: ExtensionInstallInput, harness?: HarnessId): Promise<ProcessOutcome>
    connectMcp(input: McpConnectionInput, harness?: HarnessId): Promise<ProcessOutcome>
    setMcpEnabled(input: McpStateInput, harness?: HarnessId): Promise<ProcessOutcome>
    mutateCapability(input: CapabilityMutationInput, harness?: HarnessId): Promise<ProcessOutcome>
    refresh(harness?: HarnessId): Promise<PluginCatalog>
    readSkillDocument(path: string, harness?: HarnessId): Promise<SkillDocument>
  }
  settings: { get(): Promise<AppSettings>; update(patch: Partial<AppSettings>): Promise<AppSettings>; resetBrowserData(): Promise<boolean> }
  browser: {
    state(): Promise<AgentBrowserState>
    attachTab(tabId: string, webContentsId: number): Promise<boolean>
    selectTab(tabId: string): Promise<boolean>
    closeTab(tabId: string): Promise<boolean>
    setPreviewContext(webContentsId: number | null, sessionFile: string | null): Promise<boolean>
    navigateTab(tabId: string, action: 'back' | 'forward' | 'reload' | 'url', url?: string): Promise<boolean>
    onChanged(callback: (state: AgentBrowserState) => void): () => void
    onPointer(callback: (event: AgentBrowserPointerEvent) => void): () => void
    onActivity(callback: (event: AgentBrowserActivityEvent) => void): () => void
  }
}

declare global { interface Window { prime: PrimeWorkApi } }
