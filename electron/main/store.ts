import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, statSync } from 'node:fs'
import { open, rename, unlink } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { INTERFACE_FONT_SCALES, type AppSettings, type HarnessId, type ProjectRecord } from '../../src/types/api'
import { isRecord } from './validation'

export interface FolderIdentity {
  dev: string
  ino: string
  /** Stable across filesystem device-number changes caused by a remount. */
  birthtimeNs?: string
}

export interface PersistedProject extends Omit<ProjectRecord, 'sessionCount' | 'gitBranch' | 'inferred' | 'authorized'> {
  folderIdentities?: Record<string, FolderIdentity>
}

export interface DesktopState {
  version: 4
  projects: PersistedProject[]
  settings: AppSettings
  archivedSessions: string[]
  dismissedProjectPaths: string[]
}

export const CURRENT_DESKTOP_STATE_FILENAME = 'prime-work-state-v4.json'
export const LEGACY_DESKTOP_STATE_FILENAME = 'prime-work-state.json'
const CURRENT_DESKTOP_STATE_VERSION = 4 as const
type SupportedDesktopStateVersion = 1 | 2 | 3 | typeof CURRENT_DESKTOP_STATE_VERSION

export class StateCompatibilityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StateCompatibilityError'
  }
}

export class UnsupportedStateVersionError extends StateCompatibilityError {
  constructor(
    readonly stateVersion: number,
    readonly statePath: string,
  ) {
    super(`Desktop state schema version ${stateVersion} at ${statePath} is newer than supported version ${CURRENT_DESKTOP_STATE_VERSION}. Upgrade WorkDaddy to a compatible version; the state file was left unchanged.`)
    this.name = 'UnsupportedStateVersionError'
  }
}

export class StateMigrationError extends Error {
  constructor(
    message: string,
    readonly currentStatePath: string,
    readonly legacyStatePath: string,
    readonly backupStatePath?: string,
  ) {
    const backup = backupStatePath ? ` Byte-exact recovery copy: ${backupStatePath}.` : ''
    super(`${message} Startup stopped before state became writable. Retry after checking that the state directory is writable. Current v4 state: ${currentStatePath}. Legacy compatibility state: ${legacyStatePath}.${backup} Do not delete or edit these files without making a separate backup.`)
    this.name = 'StateMigrationError'
  }
}

type WindowsLegacyTombstoneReason = 'fresh' | 'migration' | 'quarantine'

interface WindowsLegacyTombstone {
  schemaVersion: 1
  status: 'pending' | 'complete'
  currentStateFile: typeof CURRENT_DESKTOP_STATE_FILENAME
  backupFile: string | null
  reason: WindowsLegacyTombstoneReason
}

const WINDOWS_LEGACY_TOMBSTONE_KEY = 'gooeyPiV4Migration'

function parseWindowsLegacyTombstone(value: unknown): WindowsLegacyTombstone | null {
  if (!isRecord(value) || value.version !== 3) return null
  if (!Array.isArray(value.projects) || value.projects.length !== 0 || !Array.isArray(value.schedules) || value.schedules.length !== 0) return null
  const marker = value[WINDOWS_LEGACY_TOMBSTONE_KEY]
  if (!isRecord(marker) || marker.schemaVersion !== 1 || marker.currentStateFile !== CURRENT_DESKTOP_STATE_FILENAME) return null
  if (marker.status !== 'pending' && marker.status !== 'complete') return null
  if (marker.reason !== 'fresh' && marker.reason !== 'migration' && marker.reason !== 'quarantine') return null
  const backupFile = marker.backupFile
  if (backupFile !== null && (typeof backupFile !== 'string' || basename(backupFile) !== backupFile || !backupFile.startsWith(`${LEGACY_DESKTOP_STATE_FILENAME}.migrated-v4-`) || backupFile.length > 512)) return null
  if (marker.reason === 'fresh' && backupFile !== null) return null
  if (marker.reason === 'migration' && backupFile === null) return null
  if (marker.reason === 'quarantine' && (marker.status !== 'complete' || backupFile === null)) return null
  return {
    schemaVersion: 1,
    status: marker.status,
    currentStateFile: CURRENT_DESKTOP_STATE_FILENAME,
    backupFile,
    reason: marker.reason,
  }
}

export function defaultSettings(): AppSettings {
  const defaultShell = process.platform === 'win32'
    ? (process.env.ComSpec && isAbsolute(process.env.ComSpec) ? process.env.ComSpec : 'C:\\Windows\\System32\\cmd.exe')
    : (process.env.SHELL?.startsWith('/') ? process.env.SHELL : '/bin/zsh')
  return {
    theme: 'system',
    locale: 'zh-CN',
    interfaceFontScale: 110,
    sidebarOpen: true,
    inspectorOpen: true,
    showFileChangesPopup: true,
    keepRunningInBackground: false,
    launchAtLogin: false,
    terminalOpen: false,
    defaultInspectorTab: 'summary',
    browserHome: 'https://www.google.com/',
    browserAskForDownloads: true,
    terminalShell: defaultShell,
    reduceMotion: false,
    showReasoningSummaries: true,
    showToolCalls: true,
    messageEnterAction: 'queue',
    runtimePaths: { omp: '' },
    enabledHarnesses: ['omp'],
    telemetry: false,
    askUserEnabled: false,
    browserEnabled: true,
    ompDisabledProviders: [],
    ompDisabledModels: [],
    activeHarness: 'omp',
    ompApprovalMode: 'inherit',
    onboardingCompleted: false,
  }
}

function defaultState(): DesktopState {
  return { version: CURRENT_DESKTOP_STATE_VERSION, projects: [], settings: defaultSettings(), archivedSessions: [], dismissedProjectPaths: [] }
}

/** Versions 1 and 2 predate harness scoping, so only an absent value migrates to omp. */
function parseHarness(value: unknown, preHarnessState: boolean): HarnessId | null {
  if (value === 'omp') return value
  return preHarnessState && value === undefined ? 'omp' : null
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function parseProject(value: unknown, preHarnessState: boolean): PersistedProject | null {
  if (!isRecord(value)) return null
  if (typeof value.id !== 'string' || typeof value.name !== 'string' || typeof value.path !== 'string') return null
  const folders = Array.isArray(value.folders) ? value.folders.filter((item): item is string => typeof item === 'string') : [value.path]
  if (!folders.length || typeof value.primaryFolder !== 'string') return null
  const harness = parseHarness(value.harness, preHarnessState)
  if (!harness) return null
  const now = new Date().toISOString()
  const folderIdentities: Record<string, FolderIdentity> = {}
  if (isRecord(value.folderIdentities)) {
    for (const [path, identity] of Object.entries(value.folderIdentities)) {
      if (isRecord(identity) && typeof identity.dev === 'string' && typeof identity.ino === 'string') {
        folderIdentities[path] = {
          dev: identity.dev,
          ino: identity.ino,
          birthtimeNs: typeof identity.birthtimeNs === 'string' && /^\d{1,40}$/.test(identity.birthtimeNs) ? identity.birthtimeNs : undefined,
        }
      }
    }
  }
  return {
    id: value.id || randomUUID(),
    harness,
    name: value.name,
    path: value.path,
    folders,
    primaryFolder: value.primaryFolder,
    pinned: typeof value.pinned === 'boolean' ? value.pinned : false,
    createdAt: validDate(value.createdAt) ? value.createdAt : now,
    lastOpenedAt: validDate(value.lastOpenedAt) ? value.lastOpenedAt : now,
    folderIdentities: Object.keys(folderIdentities).length ? folderIdentities : undefined,
  }
}

function parseSettings(value: unknown, legacyState = false): AppSettings {
  const defaults = defaultSettings()
  if (!isRecord(value)) return defaults
  const parseRuntimePath = (path: unknown, fallback: string): string => (
    typeof path === 'string' && path.length <= 4_096 && (!path || isAbsolute(path)) ? path : fallback
  )
  const runtimePaths = isRecord(value.runtimePaths)
    ? { omp: parseRuntimePath(value.runtimePaths.omp, defaults.runtimePaths.omp) }
    : defaults.runtimePaths
  const enabledHarnesses = Array.isArray(value.enabledHarnesses)
    ? [...new Set(value.enabledHarnesses.filter((item): item is HarnessId => item === 'omp'))]
    : defaults.enabledHarnesses
  const usableHarnesses = enabledHarnesses.length ? enabledHarnesses : defaults.enabledHarnesses
  const activeHarness = value.activeHarness === 'omp'
    ? value.activeHarness as HarnessId
    : legacyState ? 'omp' : defaults.activeHarness
  return {
    theme: value.theme === 'light' || value.theme === 'dark' || value.theme === 'system' ? value.theme : defaults.theme,
    locale: value.locale === 'en' || value.locale === 'zh-CN' || value.locale === 'system' ? value.locale : defaults.locale,
    interfaceFontScale: INTERFACE_FONT_SCALES.includes(value.interfaceFontScale as AppSettings['interfaceFontScale'])
      ? value.interfaceFontScale as AppSettings['interfaceFontScale']
      : defaults.interfaceFontScale,
    sidebarOpen: typeof value.sidebarOpen === 'boolean' ? value.sidebarOpen : defaults.sidebarOpen,
    inspectorOpen: typeof value.inspectorOpen === 'boolean' ? value.inspectorOpen : defaults.inspectorOpen,
    showFileChangesPopup: typeof value.showFileChangesPopup === 'boolean' ? value.showFileChangesPopup : defaults.showFileChangesPopup,
    keepRunningInBackground: typeof value.keepRunningInBackground === 'boolean' ? value.keepRunningInBackground : defaults.keepRunningInBackground,
    launchAtLogin: typeof value.launchAtLogin === 'boolean' ? value.launchAtLogin : defaults.launchAtLogin,
    terminalOpen: typeof value.terminalOpen === 'boolean' ? value.terminalOpen : defaults.terminalOpen,
    defaultInspectorTab: value.defaultInspectorTab === 'changes' || value.defaultInspectorTab === 'browser' || value.defaultInspectorTab === 'files' || value.defaultInspectorTab === 'summary' ? value.defaultInspectorTab : defaults.defaultInspectorTab,
    browserHome: typeof value.browserHome === 'string' ? value.browserHome : defaults.browserHome,
    browserAskForDownloads: typeof value.browserAskForDownloads === 'boolean' ? value.browserAskForDownloads : defaults.browserAskForDownloads,
    terminalShell: typeof value.terminalShell === 'string' ? value.terminalShell : defaults.terminalShell,
    reduceMotion: typeof value.reduceMotion === 'boolean' ? value.reduceMotion : defaults.reduceMotion,
    showReasoningSummaries: typeof value.showReasoningSummaries === 'boolean' ? value.showReasoningSummaries : defaults.showReasoningSummaries,
    showToolCalls: typeof value.showToolCalls === 'boolean' ? value.showToolCalls : defaults.showToolCalls,
    messageEnterAction: value.messageEnterAction === 'queue' || value.messageEnterAction === 'steer' ? value.messageEnterAction : defaults.messageEnterAction,
    runtimePaths,
    enabledHarnesses: usableHarnesses,
    telemetry: typeof value.telemetry === 'boolean' ? value.telemetry : defaults.telemetry,
    askUserEnabled: typeof value.askUserEnabled === 'boolean' ? value.askUserEnabled : defaults.askUserEnabled,
    browserEnabled: typeof value.browserEnabled === 'boolean' ? value.browserEnabled : defaults.browserEnabled,
    ompDisabledProviders: Array.isArray(value.ompDisabledProviders)
      ? [...new Set(value.ompDisabledProviders.filter((item): item is string => typeof item === 'string' && /^[a-z0-9][a-z0-9._-]{0,127}$/i.test(item)))].slice(0, 256)
      : defaults.ompDisabledProviders,
    ompDisabledModels: parseDisabledModels(value.ompDisabledModels, defaults.ompDisabledModels),
    activeHarness,
    ompApprovalMode: value.ompApprovalMode === 'inherit' || value.ompApprovalMode === 'always-ask' || value.ompApprovalMode === 'write' || value.ompApprovalMode === 'yolo' ? value.ompApprovalMode : defaults.ompApprovalMode,
    onboardingCompleted: typeof value.onboardingCompleted === 'boolean' ? value.onboardingCompleted : defaults.onboardingCompleted,
  }
}

function parseDisabledModels(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback
  return [...new Set(value.filter((item): item is string => (
    typeof item === 'string' && /^[a-z0-9][a-z0-9._-]{0,127}\/[a-z0-9._:/+-]{1,256}$/i.test(item)
  )))].slice(0, 5_000)
}

const MAX_ARCHIVED_SESSIONS = 5_000
const MAX_DISMISSED_PROJECT_PATHS = 1_024
const MAX_STATE_FILE_BYTES = 64 * 1024 * 1024

/** Normalize every persisted collection against its deterministic retention invariant. */
function capUnboundedCollections(state: DesktopState): void {
  if (state.archivedSessions.length > MAX_ARCHIVED_SESSIONS) state.archivedSessions = state.archivedSessions.slice(-MAX_ARCHIVED_SESSIONS)
  if (state.dismissedProjectPaths.length > MAX_DISMISSED_PROJECT_PATHS) state.dismissedProjectPaths = state.dismissedProjectPaths.slice(-MAX_DISMISSED_PROJECT_PATHS)
}

function parseStateVersion(value: Record<string, unknown>, statePath: string): SupportedDesktopStateVersion {
  if (!Number.isSafeInteger(value.version)) throw new Error('Desktop state is missing a supported integer schema version')
  const version = Number(value.version)
  if (version > CURRENT_DESKTOP_STATE_VERSION) throw new UnsupportedStateVersionError(version, statePath)
  if (version !== 1 && version !== 2 && version !== 3 && version !== CURRENT_DESKTOP_STATE_VERSION) {
    throw new Error(`Desktop state schema version ${version} is not supported`)
  }
  return version
}

function parseState(value: unknown, statePath: string): { sourceVersion: SupportedDesktopStateVersion; state: DesktopState } {
  if (!isRecord(value)) throw new Error('Desktop state is missing a supported integer schema version')
  const version = parseStateVersion(value, statePath)
  const preHarnessProjectState = version === 1 || version === 2
  // Versions 1 and 2 predate harness scoping. Their absent harness fields are
  // the only project records allowed to inherit Prime.
  const state: DesktopState = {
    version: CURRENT_DESKTOP_STATE_VERSION,
    projects: Array.isArray(value.projects) ? value.projects.map((project) => parseProject(project, preHarnessProjectState)).filter((item): item is PersistedProject => item !== null) : [],
    settings: parseSettings(value.settings, preHarnessProjectState),
    archivedSessions: Array.isArray(value.archivedSessions) ? value.archivedSessions.filter((item): item is string => typeof item === 'string') : [],
    dismissedProjectPaths: Array.isArray(value.dismissedProjectPaths) ? value.dismissedProjectPaths.filter((item): item is string => typeof item === 'string') : [],
  }
  capUnboundedCollections(state)
  return { sourceVersion: version, state }
}

export interface JsonStateStoreFileHandle {
  writeFile(data: string | Uint8Array, options: { encoding: 'utf8' }): Promise<void>
  sync(): Promise<void>
  close(): Promise<void>
}

export interface JsonStateStoreFileSystem {
  open(path: string, flags: string, mode?: number): Promise<JsonStateStoreFileHandle>
  rename(oldPath: string, newPath: string): Promise<void>
  unlink(path: string): Promise<void>
}

const nodeFileSystem: JsonStateStoreFileSystem = {
  open: (path, flags, mode) => open(path, flags, mode) as Promise<FileHandle>,
  rename,
  unlink,
}

export class JsonStateStore {
  private state: DesktopState = defaultState()
  private queue: Promise<void> = Promise.resolve()
  private readyPromise: Promise<void> = Promise.resolve()
  private incompatibility: StateCompatibilityError | null = null
  private initializationFailure: Error | null = null
  private closed = false

  constructor(
    private readonly filePath: string,
    private readonly fileSystem: JsonStateStoreFileSystem = nodeFileSystem,
    private readonly legacyFilePath?: string,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {
    mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 })
    let sourcePath = filePath
    let sourceKind: 'current' | 'legacy' = 'current'
    try {
      let size: number
      try {
        size = statSync(sourcePath).size
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        if (!legacyFilePath) {
          this.scheduleFreshInitialization()
          return
        }
        sourcePath = legacyFilePath
        sourceKind = 'legacy'
        try {
          size = statSync(sourcePath).size
        } catch (legacyError) {
          if ((legacyError as NodeJS.ErrnoException).code !== 'ENOENT') throw legacyError
          if (this.platform === 'win32') this.scheduleWindowsFreshInitialization()
          else this.scheduleFreshInitialization()
          return
        }
      }
      if (size > MAX_STATE_FILE_BYTES) {
        throw new StateCompatibilityError(`Desktop state file at ${sourcePath} is ${size} bytes, which exceeds the ${MAX_STATE_FILE_BYTES}-byte safe parse limit. It was left unchanged; use the WorkDaddy version that created it, or move it aside only after making a backup.`)
      }
      const rawState = readFileSync(sourcePath)
      const serializedState: unknown = JSON.parse(rawState.toString('utf8'))
      if (this.platform === 'win32' && sourceKind === 'legacy') {
        const tombstone = parseWindowsLegacyTombstone(serializedState)
        if (tombstone) {
          this.scheduleWindowsTombstoneRecovery(tombstone)
          return
        }
      }
      const parsed = parseState(serializedState, sourcePath)
      this.state = parsed.state
      if (this.platform === 'win32' && legacyFilePath) {
        if (sourceKind === 'legacy') this.scheduleWindowsLegacyMigration(rawState)
        else this.scheduleWindowsLegacyProtection()
        return
      }
      const needsPersist = sourceKind === 'legacy' || (legacyFilePath !== undefined && parsed.sourceVersion !== CURRENT_DESKTOP_STATE_VERSION)
      if (needsPersist || legacyFilePath !== undefined) {
        this.scheduleInitialization(needsPersist, legacyFilePath !== undefined, 'WorkDaddy desktop state migration could not be completed')
      }
    } catch (error) {
      if (error instanceof StateCompatibilityError) {
        this.incompatibility = error
        if (legacyFilePath && sourceKind === 'current') {
          if (this.platform === 'win32') {
            this.scheduleInitializationOperation(
              () => this.ensureWindowsLegacyProtection(false),
              'WorkDaddy could not protect incompatible v4 state from a downgraded Windows binary',
            )
          } else {
            this.scheduleInitialization(
              false,
              true,
              'WorkDaddy could not protect incompatible v4 state from a downgraded binary',
            )
          }
        }
        return
      }
      let recoveryPath: string | undefined
      let preservationFailure: unknown
      try {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          console.error(`WorkDaddy desktop state was reset and backed up: ${error instanceof Error ? error.message : String(error)}`)
          recoveryPath = `${sourcePath}.corrupt-${Date.now()}`
          renameSync(sourcePath, recoveryPath)
        }
      } catch (failure) {
        preservationFailure = failure
        recoveryPath = undefined
      }
      if (this.platform === 'win32' && legacyFilePath) this.scheduleWindowsRecoveryInitialization(sourceKind, recoveryPath, preservationFailure)
      else this.scheduleInitialization(true, legacyFilePath !== undefined, 'WorkDaddy desktop state could not be rewritten after the reset')
    }
  }

  async ready(): Promise<void> {
    await this.readyPromise
    this.assertCompatible()
  }

  snapshot(): DesktopState {
    this.assertCompatible()
    return structuredClone(this.state)
  }

  getSettings(): AppSettings {
    this.assertCompatible()
    return structuredClone(this.state.settings)
  }

  getProjects(): PersistedProject[] {
    this.assertCompatible()
    return structuredClone(this.state.projects)
  }

  getArchivedSessions(): string[] {
    this.assertCompatible()
    return [...this.state.archivedSessions]
  }

  async update<T>(mutator: (draft: DesktopState) => T): Promise<T> {
    this.assertCompatible()
    if (this.initializationFailure) throw this.initializationFailure
    if (this.closed) throw new Error('Desktop state store is shutting down')
    const operation = this.queue.then(async () => {
      if (this.initializationFailure) throw this.initializationFailure
      const draft = structuredClone(this.state)
      const result = mutator(draft)
      capUnboundedCollections(draft)
      await this.persist(draft)
      this.state = draft
      return result
    })
    this.queue = operation.then(() => undefined, () => undefined)
    return operation
  }

  async beginShutdown(): Promise<void> {
    this.closed = true
    await this.queue
  }

  private assertCompatible(): void {
    if (this.incompatibility) throw this.incompatibility
  }

  private scheduleInitialization(persistState: boolean, retireLegacy: boolean, failurePrefix: string): void {
    this.scheduleInitializationOperation(async () => {
      if (persistState) await this.persist(this.state, true)
      if (retireLegacy) await this.retireLegacyState()
    }, failurePrefix)
  }

  private scheduleFreshInitialization(): void {
    this.scheduleInitializationOperation(
      () => this.persist(this.state),
      'WorkDaddy desktop state could not be initialized',
    )
  }

  private scheduleWindowsFreshInitialization(): void {
    this.scheduleInitializationOperation(
      () => this.initializeWindowsFreshState(),
      'WorkDaddy could not establish the Windows v4 compatibility marker',
    )
  }

  private async initializeWindowsFreshState(): Promise<void> {
    const pending = this.windowsLegacyTombstone('pending', null, 'fresh')
    await this.publishWindowsLegacyTombstone(pending)
    await this.persist(this.state)
    await this.publishWindowsLegacyTombstone({ ...pending, status: 'complete' })
  }

  private scheduleWindowsLegacyMigration(rawLegacyState: Uint8Array): void {
    const backupPath = this.nextLegacyBackupPath()
    const pending = this.windowsLegacyTombstone('pending', basename(backupPath), 'migration')
    this.scheduleInitializationOperation(async () => {
      try {
        await this.writeDurableFile(backupPath, rawLegacyState, 'wx')
        await this.publishWindowsLegacyTombstone(pending)
        await this.persist(this.state)
        await this.publishWindowsLegacyTombstone({ ...pending, status: 'complete' })
      } catch (error) {
        if (error instanceof StateCompatibilityError || error instanceof StateMigrationError) throw error
        throw this.migrationError(`The Windows desktop-state migration was interrupted: ${this.errorMessage(error)}`, this.verifiedBackupFile(backupPath))
      }
    }, 'WorkDaddy could not complete the Windows desktop-state migration')
  }

  private scheduleWindowsTombstoneRecovery(tombstone: WindowsLegacyTombstone): void {
    this.scheduleInitializationOperation(
      () => this.resumeWindowsTombstone(tombstone),
      'WorkDaddy could not resume the interrupted Windows desktop-state migration',
    )
  }

  private async resumeWindowsTombstone(tombstone: WindowsLegacyTombstone): Promise<void> {
    if (tombstone.status === 'complete') {
      const verifiedBackup = tombstone.backupFile
        ? this.verifiedBackupFile(join(dirname(this.legacyFilePath!), tombstone.backupFile))
        : undefined
      throw this.migrationError('The completed Windows compatibility marker exists, but the authoritative v4 state is missing. Automatic import was refused to avoid restoring stale grants', verifiedBackup)
    }
    if (tombstone.backupFile) {
      const backupPath = join(dirname(this.legacyFilePath!), tombstone.backupFile)
      try {
        const { size } = statSync(backupPath)
        if (size > MAX_STATE_FILE_BYTES) {
          throw new StateCompatibilityError(`Desktop state recovery file at ${backupPath} is ${size} bytes, which exceeds the ${MAX_STATE_FILE_BYTES}-byte safe parse limit. It was left unchanged.`)
        }
        const recovered = parseState(JSON.parse(readFileSync(backupPath, 'utf8')), backupPath)
        this.state = recovered.state
      } catch (error) {
        if (error instanceof StateCompatibilityError) throw error
        throw this.migrationError(`The pending Windows migration backup at ${backupPath} could not be read safely: ${this.errorMessage(error)}`, this.verifiedBackupFile(backupPath))
      }
    } else if (tombstone.reason !== 'fresh') {
      throw this.migrationError('The pending Windows compatibility marker has no recovery backup')
    }
    try {
      await this.persist(this.state)
      await this.publishWindowsLegacyTombstone({ ...tombstone, status: 'complete' })
    } catch (error) {
      if (error instanceof StateCompatibilityError || error instanceof StateMigrationError) throw error
      const verifiedBackup = tombstone.backupFile
        ? this.verifiedBackupFile(join(dirname(this.legacyFilePath!), tombstone.backupFile))
        : undefined
      throw this.migrationError(`The interrupted Windows migration could not publish recovered v4 state: ${this.errorMessage(error)}`, verifiedBackup)
    }
  }

  private scheduleWindowsLegacyProtection(): void {
    this.scheduleInitializationOperation(
      () => this.ensureWindowsLegacyProtection(true),
      'WorkDaddy could not protect v4 state from a downgraded Windows binary',
    )
  }

  private scheduleWindowsRecoveryInitialization(
    sourceKind: 'current' | 'legacy',
    recoveryPath: string | undefined,
    preservationFailure: unknown,
  ): void {
    this.scheduleInitializationOperation(async () => {
      if (preservationFailure) {
        throw this.migrationError(`The unreadable ${sourceKind} state could not be preserved before recovery: ${this.errorMessage(preservationFailure)}`)
      }
      if (sourceKind === 'current') {
        await this.recoverWindowsAfterCorruptCurrent(recoveryPath)
        return
      }
      await this.initializeWindowsFreshState()
    }, 'WorkDaddy desktop state could not be safely rewritten after reset')
  }

  private scheduleInitializationOperation(operation: () => Promise<void>, failurePrefix: string): void {
    const initialization = operation().catch((failure: unknown) => {
      if (failure instanceof StateCompatibilityError || failure instanceof StateMigrationError) throw failure
      if (this.legacyFilePath) throw this.migrationError(`${failurePrefix}: ${this.errorMessage(failure)}`)
      throw failure
    })
    this.readyPromise = initialization
    this.queue = initialization.catch((failure: unknown) => {
      this.initializationFailure = failure instanceof Error ? failure : new Error(String(failure))
      console.error(`${failurePrefix}: ${failure instanceof Error ? failure.message : String(failure)}`)
    })
  }

  private async retireLegacyState(): Promise<void> {
    if (!this.legacyFilePath) return
    const backupPath = this.nextLegacyBackupPath()
    try {
      await this.fileSystem.rename(this.legacyFilePath, backupPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !this.pathExists(backupPath)) return
      throw this.migrationError(`Legacy desktop state could not be retired before startup: ${this.errorMessage(error)}`, this.verifiedBackupFile(backupPath))
    }
    try {
      await this.syncParentDirectory(this.legacyFilePath, true)
    } catch (retirementSyncError) {
      try {
        await this.fileSystem.rename(backupPath, this.legacyFilePath)
      } catch (rollbackRenameError) {
        throw this.migrationError(`Legacy desktop state retirement was not durable: ${this.errorMessage(retirementSyncError)}; rollback rename failed: ${this.errorMessage(rollbackRenameError)}`, this.verifiedBackupFile(backupPath))
      }
      try {
        await this.syncParentDirectory(this.legacyFilePath, true)
      } catch (rollbackSyncError) {
        throw this.migrationError(`Legacy desktop state retirement was not durable: ${this.errorMessage(retirementSyncError)}; the legacy filename was restored, but rollback directory sync failed: ${this.errorMessage(rollbackSyncError)}`)
      }
      throw this.migrationError(`Legacy desktop state retirement was not durable: ${this.errorMessage(retirementSyncError)}; the legacy filename was restored and synchronized for a safe retry`)
    }
  }

  private async recoverWindowsAfterCorruptCurrent(corruptBackupPath?: string): Promise<void> {
    if (!this.legacyFilePath) return
    let size: number
    try {
      size = statSync(this.legacyFilePath).size
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      await this.initializeWindowsFreshState()
      return
    }

    const recoveryDetail = corruptBackupPath
      ? ` The unreadable v4 bytes were preserved at ${corruptBackupPath}.`
      : ''
    if (size > MAX_STATE_FILE_BYTES) {
      throw this.migrationError(`The current v4 state was corrupt and the legacy state is too large to classify safely; automatic recovery was refused.${recoveryDetail}`, corruptBackupPath)
    }

    let serializedLegacy: unknown
    try {
      serializedLegacy = JSON.parse(readFileSync(this.legacyFilePath, 'utf8'))
    } catch (error) {
      throw this.migrationError(`The current v4 state was corrupt and the legacy state is unreadable; both were preserved for explicit recovery: ${this.errorMessage(error)}.${recoveryDetail}`, corruptBackupPath)
    }

    const tombstone = parseWindowsLegacyTombstone(serializedLegacy)
    if (tombstone) {
      if (tombstone.status === 'pending') {
        await this.resumeWindowsTombstone(tombstone)
        return
      }
      const markerBackup = tombstone.backupFile
        ? this.verifiedBackupFile(join(dirname(this.legacyFilePath), tombstone.backupFile))
        : undefined
      throw this.migrationError(`The current v4 state was corrupt while a completed Windows compatibility marker was present. Automatic restoration of an older backup was refused to avoid restoring stale grants.${recoveryDetail}`, markerBackup ?? corruptBackupPath)
    }

    try {
      parseState(serializedLegacy, this.legacyFilePath)
    } catch (error) {
      const classification = error instanceof StateCompatibilityError
        ? error.message
        : `the legacy state is not a supported schema: ${this.errorMessage(error)}`
      throw this.migrationError(`The current v4 state was corrupt and ${classification}. Both files were preserved for explicit recovery.${recoveryDetail}`, corruptBackupPath)
    }
    throw this.migrationError(`The current v4 state was corrupt and an unmarked legacy state was also present. Automatic import was refused because it may have been recreated by a downgraded binary; both files were preserved for explicit recovery.${recoveryDetail}`, corruptBackupPath)
  }

  private async ensureWindowsLegacyProtection(currentIsAuthoritative: boolean): Promise<void> {
    if (!this.legacyFilePath) return
    let size: number
    try {
      size = statSync(this.legacyFilePath).size
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      await this.publishWindowsLegacyTombstone(this.windowsLegacyTombstone('complete', null, 'fresh'))
      return
    }

    if (size <= MAX_STATE_FILE_BYTES) {
      try {
        const tombstone = parseWindowsLegacyTombstone(JSON.parse(readFileSync(this.legacyFilePath, 'utf8')))
        if (tombstone) {
          if (tombstone.status === 'complete') return
          if (!currentIsAuthoritative) return
          if (tombstone.backupFile) {
            const expectedBackup = join(dirname(this.legacyFilePath), tombstone.backupFile)
            if (!this.pathExists(expectedBackup)) {
              throw this.migrationError(`The pending migration marker names a backup that is missing at ${expectedBackup}; completion was refused`)
            }
          }
          await this.publishWindowsLegacyTombstone({ ...tombstone, status: 'complete' })
          return
        }
      } catch (error) {
        if (error instanceof StateMigrationError) throw error
        // Invalid JSON or a non-marker legacy file is quarantined below.
      }
    }

    const backupPath = this.nextLegacyBackupPath()
    try {
      await this.fileSystem.rename(this.legacyFilePath, backupPath)
    } catch (renameError) {
      const verifiedBackup = this.verifiedBackupFile(backupPath)
      throw this.migrationError(`Quarantine rename failed for a legacy state recreated by a downgraded binary: ${this.errorMessage(renameError)}`, verifiedBackup)
    }
    try {
      await this.syncExistingFile(backupPath)
    } catch (syncError) {
      try {
        await this.fileSystem.rename(backupPath, this.legacyFilePath)
      } catch (rollbackError) {
        const verifiedBackup = this.verifiedBackupFile(backupPath)
        const location = verifiedBackup
          ? 'the byte-exact backup remains available'
          : this.pathExists(this.legacyFilePath)
            ? 'the legacy filename exists despite the reported rollback failure'
            : 'neither the backup nor legacy filename could be verified'
        throw this.migrationError(`Quarantine backup sync failed: ${this.errorMessage(syncError)}; rollback rename failed: ${this.errorMessage(rollbackError)}; ${location}`, verifiedBackup)
      }
      throw this.migrationError(`Quarantine backup sync failed: ${this.errorMessage(syncError)}; the legacy filename was restored for a safe retry`)
    }
    const marker = this.windowsLegacyTombstone('complete', basename(backupPath), 'quarantine')
    try {
      await this.publishWindowsLegacyTombstone(marker)
    } catch (error) {
      throw this.migrationError(`The downgraded legacy state was quarantined, but its zero-authority marker could not be published: ${this.errorMessage(error)}`, this.verifiedBackupFile(backupPath))
    }
  }

  private windowsLegacyTombstone(status: WindowsLegacyTombstone['status'], backupFile: string | null, reason: WindowsLegacyTombstoneReason): WindowsLegacyTombstone {
    return { schemaVersion: 1, status, currentStateFile: CURRENT_DESKTOP_STATE_FILENAME, backupFile, reason }
  }

  private async publishWindowsLegacyTombstone(marker: WindowsLegacyTombstone): Promise<void> {
    if (!this.legacyFilePath) return
    const temp = `${this.legacyFilePath}.${process.pid}.${randomUUID()}.tombstone.tmp`
    const serialized = `${JSON.stringify({
      version: 3,
      projects: [],
      settings: {},
      archivedSessions: [],
      dismissedProjectPaths: [],
      schedules: [],
      [WINDOWS_LEGACY_TOMBSTONE_KEY]: marker,
    }, null, 2)}\n`
    try {
      await this.writeDurableFile(temp, serialized, 'wx')
      await this.fileSystem.rename(temp, this.legacyFilePath)
    } finally {
      await this.fileSystem.unlink(temp).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      })
    }
  }

  private async writeDurableFile(path: string, data: string | Uint8Array, flags: string): Promise<void> {
    let completed = false
    try {
      const file = await this.fileSystem.open(path, flags, 0o600)
      try {
        await file.writeFile(data, { encoding: 'utf8' })
        await file.sync()
      } finally {
        await file.close()
      }
      completed = true
    } finally {
      if (!completed) {
        await this.fileSystem.unlink(path).catch((error: unknown) => {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        })
      }
    }
  }

  private async syncExistingFile(path: string): Promise<void> {
    const file = await this.fileSystem.open(path, 'r+')
    try { await file.sync() } finally { await file.close() }
  }

  private nextLegacyBackupPath(): string {
    return `${this.legacyFilePath}.migrated-v4-${Date.now()}-${randomUUID()}`
  }

  private pathExists(path: string): boolean {
    try {
      statSync(path)
      return true
    } catch {
      return false
    }
  }

  private verifiedBackupFile(path: string): string | undefined {
    return this.pathExists(path) ? basename(path) : undefined
  }

  private migrationError(message: string, backupPathOrFile?: string): StateMigrationError {
    return new StateMigrationError(
      message,
      this.filePath,
      this.legacyFilePath!,
      backupPathOrFile
        ? (isAbsolute(backupPathOrFile) ? backupPathOrFile : join(dirname(this.legacyFilePath!), backupPathOrFile))
        : undefined,
    )
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  private async persist(state: DesktopState, requireDirectorySync = false): Promise<void> {
    const temp = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`
    try {
      const file = await this.fileSystem.open(temp, 'w', 0o600)
      try {
        await file.writeFile(`${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8' })
        await file.sync()
      } finally {
        await file.close()
      }

      await this.fileSystem.rename(temp, this.filePath)

      await this.syncParentDirectory(this.filePath, requireDirectorySync)
    } finally {
      await this.fileSystem.unlink(temp).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      })
    }
  }

  private async syncParentDirectory(path: string, required = false): Promise<void> {
    if (this.platform === 'win32') return
    try {
      const directory = await this.fileSystem.open(dirname(path), 'r')
      try { await directory.sync() } finally { await directory.close() }
    } catch (error) {
      if (required) {
        throw new Error(`Desktop state directory could not be synchronized: ${error instanceof Error ? error.message : String(error)}`)
      }
      // Ordinary updates retain the pre-v4 best-effort behavior on filesystems
      // that cannot open or sync directory handles. Authority migration passes
      // `required` and fails readiness instead of claiming false durability.
    }
  }
}

/** Opens the versioned authority file and durably completes any one-way legacy migration. */
export async function openDesktopStateStore(userDataPath: string): Promise<JsonStateStore> {
  const store = new JsonStateStore(
    join(userDataPath, CURRENT_DESKTOP_STATE_FILENAME),
    nodeFileSystem,
    join(userDataPath, LEGACY_DESKTOP_STATE_FILENAME),
  )
  await store.ready()
  return store
}
