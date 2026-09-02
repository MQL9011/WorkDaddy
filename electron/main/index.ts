import { app, BrowserWindow, dialog, Menu, nativeTheme, protocol, session, webContents } from 'electron'
import type { BrowserWindowConstructorOptions, Input, WebContents } from 'electron'
import { extname, isAbsolute, join, relative, resolve, win32 as win32Path } from 'node:path'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { BROWSER_PARTITION, type ApplicationMenuName, type AppMeta, type AppUpdateState, type PrimeEventEnvelope, type RuntimeInfo, type ThemeMode } from '../../src/types/api'
import { AgentRpcManager, OMP_RPC_ADAPTER } from './agent-rpc'
import { installApplicationMenu } from './application-menu'
import { MacBackgroundController, shouldStartInBackground } from './background'
import { BrowserDownloadGuard } from './browser-downloads'
import { installCrashGuards } from './crash-guard'
import { GitService } from './git'
import { isTrustedRendererUrl, registerIpc, type IpcRegistration } from './ipc'
import { HarnessDiscoveryService, reconcileActiveHarness } from './harness-discovery'
import { installOmp, managedOmpExecutablePath } from './omp-installer'
import { beginProcessShutdown, stopChildProcesses } from './process-utils'
import { PluginService, beginPluginDiscoveryShutdown } from './plugins'
import { OmpModelCatalogService } from './providers-omp'
import { ProjectService } from './projects'
import { SettingsService } from './settings-schedules'
import { AgentBrowserBridge } from './browser/agent-bridge'
import { AgentBrowserService } from './browser/agent-service'
import { SessionService } from './sessions'
import { ompSessionServiceOptions } from './sessions/omp'
import { type JsonStateStore, openDesktopStateStore, StateCompatibilityError, StateMigrationError } from './store'
import { TerminalService } from './terminal'
import { createManualUpdateCheck, getAutoUpdater, UpdateService } from './updates'

protocol.registerSchemesAsPrivileged([{ scheme: 'prime-work', privileges: { standard: true, secure: true, supportFetchAPI: true } }])

let mainWindow: BrowserWindow | null = null
let ipc: IpcRegistration | null = null
let ompAgents: AgentRpcManager | null = null
let terminals: TerminalService | null = null
let downloads: BrowserDownloadGuard | null = null
let updateService: UpdateService | null = null
let store: JsonStateStore | null = null
let agentBrowser: AgentBrowserService | null = null
let agentBrowserBridge: AgentBrowserBridge | null = null
let backgroundMode: MacBackgroundController | null = null
let shutdownStarted = false
let shutdownApproved = false
let confirmingShutdown = false
let trustedRendererUrl = ''
let windowCreation: Promise<BrowserWindow | null> | null = null
let startInBackground = false
const keepTestWindowsHidden = process.env.PRIME_WORK_E2E_HIDE_WINDOWS === '1'

installCrashGuards({
  logPath: () => {
    try { return join(app.getPath('userData'), 'crash.log') } catch { return null }
  },
  cleanup: async () => {
    ompAgents?.beginShutdown()
    beginProcessShutdown()
    await Promise.allSettled([ompAgents?.stopAll() ?? Promise.resolve(), stopChildProcesses()])
  },
})

export function appIconPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(app.getAppPath(), 'assets', 'icon-dev.png')
}

// One policy for every surface that serves renderer content: the app protocol
// response headers and the packaged browser-session header rewrite.
const RENDERER_CONTENT_SECURITY_POLICY = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"

const rendererContentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.map': 'application/json; charset=utf-8',
}

function registerRendererProtocol(): void {
  if (!app.isPackaged) return
  const rendererRoot = resolve(__dirname, '../renderer')
  protocol.handle('prime-work', async (request) => {
    try {
      const url = new URL(request.url)
      if (url.hostname !== 'app' || url.username || url.password || url.search || url.hash) return new Response('Not found', { status: 404 })
      const decoded = decodeURIComponent(url.pathname)
      const candidate = resolveRendererAssetPath(rendererRoot, decoded)
      if (!candidate) return new Response('Not found', { status: 404 })
      const body = await readFile(candidate)
      return new Response(body, { headers: {
        'Content-Type': rendererContentTypes[extname(candidate).toLowerCase()] ?? 'application/octet-stream',
        'Content-Security-Policy': RENDERER_CONTENT_SECURITY_POLICY,
        'X-Content-Type-Options': 'nosniff',
      } })
    } catch { return new Response('Not found', { status: 404 }) }
  })
}

/** Resolves a renderer URL path without relying on a platform-specific separator. */
export function resolveRendererAssetPath(rendererRoot: string, decodedPath: string): string | null {
  if (!decodedPath.startsWith('/') || decodedPath.includes('\0') || decodedPath.includes('\\')) return null
  const pathApi = /^[A-Za-z]:[\\/]/.test(rendererRoot) ? win32Path : { resolve, relative, isAbsolute }
  const candidate = pathApi.resolve(rendererRoot, `.${decodedPath === '/' ? '/index.html' : decodedPath}`)
  const relativePath = pathApi.relative(rendererRoot, candidate)
  if (!relativePath || relativePath.startsWith('..') || pathApi.isAbsolute(relativePath)) return null
  return candidate
}

function resolveRendererUrl(): string {
  const developmentUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined
  if (!developmentUrl) return app.isPackaged ? 'prime-work://app/index.html' : pathToFileURL(join(__dirname, '../renderer/index.html')).href
  const parsed = new URL(developmentUrl)
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) {
    throw new Error('ELECTRON_RENDERER_URL must use an uncredentialed loopback HTTP(S) origin')
  }
  return parsed.href
}

function isAllowedBrowserUrl(raw: string): boolean {
  if (raw === 'about:blank') return true
  try { const url = new URL(raw); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password } catch { return false }
}

export function hardenRenderer(window: BrowserWindow, trustedUrl: () => string = () => trustedRendererUrl): void {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('context-menu', (_event, params) => {
    if (params.mediaType !== 'image' || !params.hasImageContents) return
    const contents = window.webContents
    Menu.buildFromTemplate([{
      label: 'Copy Image',
      click: () => { if (!window.isDestroyed() && !contents.isDestroyed()) contents.copyImageAt(params.x, params.y) },
    }]).popup({ window })
  })
  window.webContents.on('will-attach-webview', (event, preferences, params) => {
    delete preferences.preload
    preferences.nodeIntegration = false
    preferences.nodeIntegrationInSubFrames = false
    preferences.contextIsolation = true
    preferences.sandbox = true
    preferences.webSecurity = true
    preferences.allowRunningInsecureContent = false
    // A guest page must never be able to attach a nested guest of its own.
    preferences.webviewTag = false
    const partition = typeof params.partition === 'string' ? params.partition : ''
    if (partition !== BROWSER_PARTITION || !isAllowedBrowserUrl(params.src)) event.preventDefault()
  })
  window.webContents.on('did-attach-webview', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-navigate', (event, target) => { if (!isAllowedBrowserUrl(target)) event.preventDefault() })
    contents.on('will-redirect', (event) => { if (!isAllowedBrowserUrl(event.url)) event.preventDefault() })
    contents.on('will-frame-navigate', (event) => { if (!isAllowedBrowserUrl(event.url)) event.preventDefault() })
    contents.once('destroyed', () => downloads?.cancelOwner(contents.id))
    // Guests reaching this point passed the will-attach-webview partition and
    // URL gates above, which makes them eligible for agent control.
    agentBrowser?.approveGuest(contents)
  })
  window.webContents.on('will-navigate', (event, target) => {
    const current = window.webContents.getURL()
    if (target !== current) event.preventDefault()
  })
  // Server redirects and sub-frame navigations bypass will-navigate; hold them
  // to the same trusted-renderer predicate the IPC gate uses.
  window.webContents.on('will-redirect', (event) => {
    if (!isTrustedRendererUrl(event.url, trustedUrl())) event.preventDefault()
  })
  window.webContents.on('will-frame-navigate', (event) => {
    if (!isTrustedRendererUrl(event.url, trustedUrl())) event.preventDefault()
  })
}

interface InitialRendererWindow {
  loadURL(url: string): Promise<unknown>
  isDestroyed(): boolean
  destroy(): void
}

export async function loadInitialRenderer(window: InitialRendererWindow, rendererUrl: string): Promise<void> {
  try {
    await window.loadURL(rendererUrl)
  } catch (error) {
    if (!window.isDestroyed()) window.destroy()
    throw error
  }
}

/** Work that would be lost by quitting: in-flight agent turns. */
export interface ActiveShutdownWork {
  runningAgents: number
}

export interface ShutdownPrompt {
  message: string
  detail: string
}

export function activeShutdownWork(runtimes: readonly RuntimeInfo[]): ActiveShutdownWork {
  const running = runtimes.filter((runtime) => runtime.isStreaming
    || runtime.isCompacting === true
    || runtime.sessionActions?.active !== undefined
    || (runtime.sessionActions?.queuedCount ?? 0) > 0)
  return { runningAgents: running.length }
}

/** Null when nothing is active, which is the signal to close without a prompt. */
export function shutdownPrompt(work: ActiveShutdownWork): ShutdownPrompt | null {
  if (work.runningAgents === 0) return null
  const detail = work.runningAgents === 1
    ? 'An agent run is still in progress and will be stopped.'
    : `${work.runningAgents} agent runs are still in progress and will be stopped.`
  return {
    message: 'Close WorkDaddy while an agent is running?',
    detail,
  }
}

export async function confirmAppClose(window: BrowserWindow | null, prompt: ShutdownPrompt): Promise<boolean> {
  const options = {
    type: 'warning' as const,
    buttons: ['Cancel', 'Close WorkDaddy'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    title: 'WorkDaddy',
    ...prompt,
  }
  const { response } = window && !window.isDestroyed()
    ? await dialog.showMessageBox(window, options)
    : await dialog.showMessageBox(options)
  return response === 1
}

function pendingShutdownPrompt(): ShutdownPrompt | null {
  const runtimes = ompAgents?.list() ?? []
  return shutdownPrompt(activeShutdownWork(runtimes))
}

/**
 * The one confirmation path for both ✕ and Quit: the dialog is async so agent
 * RPC, IPC, and schedule ticks keep running while it is open, and the approved
 * flag lets the programmatic quit through without re-asking.
 */
function requestShutdown(window: BrowserWindow | null, prompt: ShutdownPrompt): void {
  confirmingShutdown = true
  void confirmAppClose(window, prompt).then((approved) => {
    if (!approved) return
    shutdownApproved = true
    app.quit()
  }).catch((error: unknown) => {
    console.error(`WorkDaddy close confirmation failed: ${boundedErrorMessage(error)}`)
  }).finally(() => { confirmingShutdown = false })
}

export function interfaceZoomFactor(): number {
  return (store?.getSettings().interfaceFontScale ?? 110) / 100
}

/**
 * App windows only: embedded browser guests and their views keep their own
 * zoom, so the app scale is applied through the window list rather than to
 * every webContents in the process.
 */
function applyInterfaceZoom(scale: number): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue
    const contents = window.webContents
    if (!contents.isDestroyed()) contents.setZoomFactor(scale / 100)
  }
}

type ResolvedTheme = Exclude<ThemeMode, 'system'>

function windowsTitleBarOverlay(theme: ResolvedTheme): { color: string; symbolColor: string; height: number } {
  return theme === 'dark'
    ? { color: '#171716', symbolColor: '#f1f1ee', height: 32 }
    : { color: '#ffffff', symbolColor: '#20201e', height: 32 }
}

function resolvedWindowTheme(theme: ThemeMode | undefined): ResolvedTheme {
  if (theme === 'dark') return 'dark'
  if (theme === 'system' && nativeTheme.shouldUseDarkColors) return 'dark'
  return 'light'
}

export function mainWindowChromeOptions(platform: NodeJS.Platform = process.platform, theme: ResolvedTheme = 'light'): BrowserWindowConstructorOptions {
  if (platform === 'darwin') return {
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    vibrancy: 'sidebar',
    visualEffectState: 'active',
  }
  if (platform === 'win32') return {
    // The native caption controls share a dedicated menu row. WorkDaddy's own
    // 52px toolbar remains a separate application surface below it.
    titleBarStyle: 'hidden',
    titleBarOverlay: windowsTitleBarOverlay(theme),
    autoHideMenuBar: true,
  }
  if (platform === 'linux') return {
    titleBarStyle: 'hidden',
    titleBarOverlay: { height: 52 },
    autoHideMenuBar: true,
  }
  return { titleBarStyle: 'default' }
}

export function isMacWindowCloseShortcut(
  input: Pick<Input, 'type' | 'key' | 'shift' | 'control' | 'alt' | 'meta'>,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform === 'darwin'
    && input.type === 'keyDown'
    && input.key.toLowerCase() === 'q'
    && input.meta
    && !input.shift
    && !input.control
    && !input.alt
}

export function popupApplicationMenu(sender: WebContents, menuName: ApplicationMenuName, x: number, y: number): boolean {
  const window = BrowserWindow.fromWebContents(sender)
  const applicationMenu = Menu.getApplicationMenu()
  const menuItem = applicationMenu?.items.find((item) => item.label.replaceAll('&', '').toLowerCase() === menuName)
  if (!window || window.isDestroyed() || !menuItem?.submenu) return false
  const zoom = sender.getZoomFactor()
  menuItem.submenu.popup({ window, x: Math.round(x * zoom), y: Math.round(y * zoom) })
  return true
}

export function setTitleBarTheme(sender: WebContents, theme: ResolvedTheme): boolean {
  const window = BrowserWindow.fromWebContents(sender)
  if (process.platform !== 'win32' || !window || window.isDestroyed()) return false
  window.setTitleBarOverlay(windowsTitleBarOverlay(theme))
  return true
}

async function createWindow(): Promise<BrowserWindow | null> {
  if (shutdownStarted) return null
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#f5f5f4',
    icon: appIconPath(),
    ...mainWindowChromeOptions(process.platform, resolvedWindowTheme(store?.getSettings().theme)),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      zoomFactor: interfaceZoomFactor(),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: true,
    },
  })
  mainWindow = window
  const renderer = window.webContents
  const rendererId = renderer.id
  hardenRenderer(window)
  renderer.on('before-input-event', (event, input) => {
    if (!isMacWindowCloseShortcut(input)) return
    event.preventDefault()
    if (!window.isDestroyed()) window.close()
  })
  renderer.on('did-finish-load', () => {
    if (renderer.isDestroyed()) return
    // A reload resets the zoom factor, so the persisted scale is re-applied
    // on every load rather than only at window creation.
    renderer.setZoomFactor(interfaceZoomFactor())
    if (isTrustedRendererUrl(renderer.getURL(), trustedRendererUrl)) ipc?.authorize(renderer)
  })
  renderer.on('did-start-navigation', (_event, url, _isInPlace, isMainFrame) => {
    if (isMainFrame && !isTrustedRendererUrl(url, trustedRendererUrl)) ipc?.revoke(rendererId)
  })
  renderer.on('render-process-gone', () => ipc?.revoke(rendererId))
  let rendererLoaded = false
  let readyToShow = false
  window.once('ready-to-show', () => {
    readyToShow = true
    if (!keepTestWindowsHidden && !backgroundMode?.isBackgrounded() && rendererLoaded && !shutdownStarted && !window.isDestroyed() && mainWindow === window) window.show()
  })
  window.on('close', (event) => {
    if (shutdownStarted || shutdownApproved) return
    if (backgroundMode?.handleWindowClose(window)) {
      event.preventDefault()
      return
    }
    const prompt = pendingShutdownPrompt()
    if (!prompt) return
    event.preventDefault()
    if (!confirmingShutdown) requestShutdown(window, prompt)
  })
  window.on('closed', () => {
    ipc?.revoke(rendererId)
    if (mainWindow === window) mainWindow = null
  })
  try {
    await loadInitialRenderer(window, trustedRendererUrl)
  } catch (error) {
    ipc?.revoke(rendererId)
    if (mainWindow === window) mainWindow = null
    throw error
  }
  if (shutdownStarted || window.isDestroyed() || mainWindow !== window) {
    ipc?.revoke(rendererId)
    if (!window.isDestroyed()) window.destroy()
    if (mainWindow === window) mainWindow = null
    return null
  }
  rendererLoaded = true
  if (!keepTestWindowsHidden && !backgroundMode?.isBackgrounded() && readyToShow) window.show()
  return window
}

function ensureWindow(): Promise<BrowserWindow | null> {
  if (shutdownStarted) return Promise.resolve(null)
  if (mainWindow && !mainWindow.isDestroyed()) return windowCreation ?? Promise.resolve(mainWindow)
  if (windowCreation) return windowCreation
  const creation = createWindow()
  windowCreation = creation
  const clearCreation = () => { if (windowCreation === creation) windowCreation = null }
  void creation.then(clearCreation, clearCreation)
  return creation
}

function boundedErrorMessage(error: unknown, maxLength = 512): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/[\r\n\t]+/g, ' ').slice(0, maxLength) || 'Unknown error'
}

export interface StartupFailureDialog {
  title: string
  detail: string
}

export function startupFailureDialog(error: unknown): StartupFailureDialog | null {
  if (error instanceof StateMigrationError) {
    return { title: 'WorkDaddy state migration failed', detail: boundedErrorMessage(error, 2_048) }
  }
  if (error instanceof StateCompatibilityError) {
    return { title: 'WorkDaddy update required', detail: boundedErrorMessage(error, 2_048) }
  }
  return null
}

/** Filesystem locations of the shared capability extensions injected into extension-based harnesses. */
export interface CapabilityExtensionPaths {
  browser: string
  askUser: string
  /** Absent when the vault PoC extension has not been wired up for this runtime. */
  vault?: string
}

/**
 * PoC-only vault decryption config: the AES-256-GCM key (hex-encoded) and the
 * directory holding the `.enc` payloads it may decrypt for one runtime. Both
 * values only ever travel through the child process environment — never
 * written to disk or exposed to the renderer. Real key management (rotation,
 * per-release keys, a harder-to-extract embedding than a source constant) is
 * explicitly out of scope for this PoC; see the vault PoC plan for the
 * accepted threat model.
 */
export interface MaerwenVaultConfig {
  key: string
  root: string
}

/**
 * Runtime environment for OMP: the capability-broker variables from the
 * lazily enabled browser bridge, plus the PRIME_WORK_*_EXTENSION_PATH
 * variables the harness adapter turns into --extension argv.
 */
export function extensionRuntimeEnvironment(
  browserBridgeEnvironment: () => NodeJS.ProcessEnv,
  extensionPaths: CapabilityExtensionPaths,
  askUserEnabled = true,
  browserEnabled = true,
  vault?: MaerwenVaultConfig,
): NodeJS.ProcessEnv {
  return {
    ...(browserEnabled ? browserBridgeEnvironment() : {}),
    PRIME_WORK_BROWSER_EXTENSION_PATH: browserEnabled ? extensionPaths.browser : undefined,
    PRIME_WORK_ASK_USER_EXTENSION_PATH: askUserEnabled ? extensionPaths.askUser : undefined,
    PRIME_WORK_VAULT_EXTENSION_PATH: vault ? extensionPaths.vault : undefined,
    MAERWEN_VAULT_KEY: vault?.key,
    MAERWEN_VAULT_ROOT: vault?.root,
    GOOEYPI_MANAGES_ASK_USER: '1',
  }
}

export async function settleShutdown(
  steps: ReadonlyArray<PromiseLike<unknown>>,
  options: { watchdogMs?: number; log?: (message: string) => void } = {},
): Promise<void> {
  const log = options.log ?? ((message: string) => console.error(message))
  const watchdogMs = options.watchdogMs ?? 10_000
  const settled = Promise.allSettled(steps).then((results) => {
    for (const result of results) {
      if (result.status === 'rejected') log(`WorkDaddy shutdown step failed: ${boundedErrorMessage(result.reason)}`)
    }
  })
  let timer: NodeJS.Timeout | undefined
  const watchdog = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      log(`WorkDaddy shutdown did not finish within ${watchdogMs} ms; quitting anyway`)
      resolve()
    }, watchdogMs)
    timer.unref?.()
  })
  try {
    await Promise.race([settled, watchdog])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function requestWindow(reason: 'activation' | 'second instance' | 'menu bar' | 'settings', afterOpen?: (window: BrowserWindow) => void): void {
  void ensureWindow().then((window) => {
    if (!window || shutdownStarted || window.isDestroyed()) return
    if (!keepTestWindowsHidden) {
      if (window.isMinimized()) window.restore()
      window.show()
      window.focus()
    }
    afterOpen?.(window)
  }).catch((error: unknown) => {
    if (!shutdownStarted) console.error(`WorkDaddy failed to open a window after ${reason}: ${boundedErrorMessage(error)}`)
  })
}

function revealApplication(reason: 'activation' | 'second instance'): void {
  if (backgroundMode) backgroundMode.open()
  else requestWindow(reason)
}

export function routeAllWindowsClosed(
  shutdownInProgress: boolean,
  background: Pick<MacBackgroundController, 'handleAllWindowsClosed'> | null,
  quit: () => void,
): void {
  if (shutdownInProgress) return
  if (!background?.handleAllWindowsClosed()) quit()
}

async function bootstrap(): Promise<void> {
  const userDataPath = app.getPath('userData')
  const stateStore = await openDesktopStateStore(userDataPath)
  store = stateStore
  backgroundMode = new MacBackgroundController({
    iconPath: appIconPath(),
    getSettings: () => stateStore.getSettings(),
    onOpen: () => requestWindow('menu bar'),
    onSettings: () => requestWindow('settings', (window) => {
      if (!window.webContents.isDestroyed()) window.webContents.send('app:open-settings')
    }),
    onQuit: () => app.quit(),
    startInBackground,
  })
  const discovery = new HarnessDiscoveryService(() => {
    const runtimePaths = stateStore.getSettings().runtimePaths
    return { omp: runtimePaths.omp || managedOmpExecutablePath(userDataPath) }
  })
  const initialHarnesses = await discovery.refresh()
  await reconcileActiveHarness(stateStore, initialHarnesses)
  if (shutdownStarted) return
  const ompExecutable = () => discovery.executable('omp')
  // OMP has no live-CLI overlay (`omp list --json` does not exist), so the OMP
  // catalog is constructed with a null executable and JSONL-only metadata.
  const ompSessions = new SessionService(stateStore, null, undefined, ompSessionServiceOptions())
  const ompProjects = new ProjectService(stateStore, () => mainWindow, 'omp')
  const git = new GitService((cwd) => ompProjects.authorizeCwd(cwd))

  const ompDisabledProviders = () => new Set(stateStore.getSettings().ompDisabledProviders)
  const ompDisabledModels = () => new Set(stateStore.getSettings().ompDisabledModels)
  const ompCatalog = new OmpModelCatalogService(ompExecutable)
  // The OMP manager exists whether or not the omp CLI is installed; starting a
  // runtime without it fails with the adapter's per-harness not-found error.
  const ompManager = new AgentRpcManager(
    ompExecutable,
    (cwd) => ompProjects.authorizeCwd(cwd),
    (path) => ompSessions.requireSessionPath(path),
    ompCatalog,
    ompDisabledProviders,
    OMP_RPC_ADAPTER,
    () => {
      const mode = stateStore.getSettings().ompApprovalMode
      return mode === 'inherit' ? undefined : mode
    },
  )
  ompManager.setDisabledModelsProvider(ompDisabledModels)
  ompAgents = ompManager
  ompSessions.bindRuntimeHooks({
    get: (path) => ompAgents?.getForSession(path),
    all: () => ompAgents?.list() ?? [],
    stop: async (path) => { await ompAgents?.stopForSession(path) },
    rename: async (path, title) => ompAgents?.renameForSession(path, title) ?? false,
  })
  terminals = new TerminalService(
    (cwd) => ompProjects.authorizeCwd(cwd),
    () => stateStore.getSettings().terminalShell,
    (path) => ompSessions.requireSessionPath(path),
  )
  ompProjects.bindProviders({
    sessions: () => ompSessions.list(undefined, true),
    branch: (cwd) => git.branch(cwd),
    stopProjectProcesses: async (roots) => {
      ompPlugins.evictProjects(roots)
      await Promise.all([ompManager.stopForProjectRoots(roots), terminals!.killForProjectRoots(roots)])
    },
  })
  downloads = new BrowserDownloadGuard(isAllowedBrowserUrl, app.getPath('downloads'))
  const settings = new SettingsService(
    stateStore,
    (shell) => terminals!.validateShell(shell),
    () => downloads?.cancelAll(true),
    (previous, next) => backgroundMode?.applySettings(previous, next),
  )
  const browserProfile = session.fromPartition(BROWSER_PARTITION)
  browserProfile.on('will-download', (event, item, owner) => downloads?.handle(event, item, owner, settings.get().browserAskForDownloads))
  const ompBrowserExtensionPath = app.isPackaged
    ? join(process.resourcesPath, 'extensions', 'omp-work-browser.ts')
    : join(app.getAppPath(), 'assets', 'extensions', 'omp-work-browser.ts')
  const ompAskUserExtensionPath = app.isPackaged
    ? join(process.resourcesPath, 'extensions', 'omp-work-ask-user.ts')
    : join(app.getAppPath(), 'assets', 'extensions', 'omp-work-ask-user.ts')
  const ompVaultExtensionPath = app.isPackaged
    ? join(process.resourcesPath, 'extensions', 'omp-work-vault.ts')
    : join(app.getAppPath(), 'assets', 'extensions', 'omp-work-vault.ts')
  // PoC-only fixture: a code-review skill body pre-encrypted with the key
  // below via a vault.py tool that lives outside this repo (see
  // assets/vault-samples/code-review/README.md). Real distribution needs a
  // real packaging pipeline and key story; this only proves the OMP-side
  // decryption path works end to end. See the vault PoC plan for what is
  // explicitly out of scope this round.
  const maerwenVaultPocRoot = app.isPackaged
    ? join(process.resourcesPath, 'vault-samples', 'code-review', 'payload')
    : join(app.getAppPath(), 'assets', 'vault-samples', 'code-review', 'payload')
  const maerwenVaultPocKeyHex = 'b102cf6f899bc5fdb291ef7f1f6a03d80691c9040d866a300164ebf274ad9fb5'
  const ompPlugins = new PluginService(ompExecutable, (path) => ompProjects.authorizeProjectRoot(path), {
    harness: 'omp',
    builtInSkills: async () => [{
      id: 'omp-work-browser', name: 'Browser',
      description: 'OMP extension for driving this thread\'s in-app browser.',
      kind: 'extension', location: 'system', path: ompBrowserExtensionPath, enabled: stateStore.getSettings().browserEnabled,
    }, {
      id: 'gooeypi-ask-user', name: 'Ask user',
      description: 'OMP extension for asking focused multiple-choice questions in the WorkDaddy app.',
      kind: 'extension', location: 'system', path: ompAskUserExtensionPath, enabled: stateStore.getSettings().askUserEnabled,
    }],
  })
  const browserService = new AgentBrowserService({
    getGuest: (webContentsId) => {
      const contents = webContents.fromId(webContentsId)
      return contents && !contents.isDestroyed() ? contents : undefined
    },
  })
  agentBrowser = browserService
  const browserBridge = new AgentBrowserBridge({ service: browserService, terminals, extensionPath: ompBrowserExtensionPath })
  await browserBridge.start()
  agentBrowserBridge = browserBridge
  const revokeRuntimeCapabilities = (environment: NodeJS.ProcessEnv): void => {
    const claims: Array<[string, { revoke(token: string | undefined): boolean }, string | undefined]> = [
      ['browser', browserBridge, environment.PRIME_WORK_BROWSER_TOKEN],
    ]
    for (const [name, bridge, token] of claims) {
      try { bridge.revoke(token) } catch (error) {
        console.error(`WorkDaddy failed to revoke ${name} runtime capability: ${boundedErrorMessage(error)}`)
      }
    }
  }
  // OMP runtimes get capability-scoped brokers through OMP-flavored
  // extensions. OMP has no --skill flag, so their tool descriptions carry the
  // app-specific usage guidance while OMP's own skills stay discovery-based.
  const capabilityExtensionPaths: CapabilityExtensionPaths = {
    browser: ompBrowserExtensionPath,
    askUser: ompAskUserExtensionPath,
    vault: ompVaultExtensionPath,
  }
  ompManager.setRuntimeEnvironmentProvider((scope) => (
    extensionRuntimeEnvironment(
      () => browserBridge.environmentFor(scope),
      capabilityExtensionPaths,
      stateStore.getSettings().askUserEnabled && scope.interactive,
      stateStore.getSettings().browserEnabled,
      { key: maerwenVaultPocKeyHex, root: maerwenVaultPocRoot },
    )
  ))
  ompManager.setRuntimeStartListener((environment, _info) => {
    browserBridge.bindSession(environment.PRIME_WORK_BROWSER_TOKEN, _info.sessionFile)
  })
  ompManager.setRuntimeEndListener((environment) => revokeRuntimeCapabilities(environment))
  if (shutdownStarted) return
  const meta: AppMeta = {
    version: app.getVersion(),
    platform: process.platform,
    homeDir: homedir(),
    harnesses: initialHarnesses,
  }
  const updates = new UpdateService(getAutoUpdater(), { enabled: app.isPackaged })
  updateService = updates
  const refreshHarnesses = async () => {
    const harnesses = await discovery.refresh()
    const currentSettings = await reconcileActiveHarness(stateStore, harnesses)
    meta.harnesses = harnesses
    return { meta: structuredClone(meta), settings: currentSettings }
  }
  trustedRendererUrl = resolveRendererUrl()
  ipc = registerIpc({
    meta, refreshHarnesses, projects: ompProjects, sessions: ompSessions, agents: ompManager, terminals, git, plugins: ompPlugins, catalog: ompCatalog, settings, updates, browser: browserService,
    popupApplicationMenu, setTitleBarTheme,
    applyInterfaceZoom,
    installOmp: (onProgress) => installOmp(userDataPath, { onProgress }),
  }, trustedRendererUrl)
  const forwardAgentEvent = (envelope: PrimeEventEnvelope): void => {
    const renderer = mainWindow?.webContents
    if (!shutdownStarted && renderer && !renderer.isDestroyed()
      && isTrustedRendererUrl(renderer.getURL(), trustedRendererUrl)
      && isTrustedRendererUrl(renderer.mainFrame.url, trustedRendererUrl)) {
      renderer.send('agent:event', envelope)
    }
  }
  ompManager.setEventSink(forwardAgentEvent)
  updates.setEventSink((state: AppUpdateState) => {
    const renderer = mainWindow?.webContents
    if (!shutdownStarted && renderer && !renderer.isDestroyed()
      && isTrustedRendererUrl(renderer.getURL(), trustedRendererUrl)
      && isTrustedRendererUrl(renderer.mainFrame.url, trustedRendererUrl)) {
      renderer.send('updates:changed', state)
    }
  })
  installApplicationMenu({
    appName: 'WorkDaddy',
    updatesEnabled: updates.isEnabled(),
    closeWindow: () => {
      const window = mainWindow
      if (!window || window.isDestroyed()) app.quit()
      else window.close()
    },
    checkForUpdates: createManualUpdateCheck(() => updates.check(), async (notification) => {
      await dialog.showMessageBox({
        type: notification.type,
        title: 'WorkDaddy',
        message: notification.message,
        detail: notification.detail,
      })
    }),
  })
  backgroundMode.start()
  await ensureWindow()
  updates.start()
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()
else void app.whenReady().then(async () => {
  registerRendererProtocol()
  let wasOpenedAtLogin = false
  if (process.platform === 'darwin' && app.isPackaged) {
    try { wasOpenedAtLogin = app.getLoginItemSettings().wasOpenedAtLogin } catch { /* The explicit flag remains available if the OS lookup fails. */ }
  }
  startInBackground = shouldStartInBackground(process.argv, wasOpenedAtLogin)
  if (!app.isPackaged) app.setName('WorkDaddy Dev')
  if (process.platform === 'darwin') {
    app.setActivationPolicy(startInBackground ? 'accessory' : 'regular')
    if (!startInBackground) app.dock?.setIcon(appIconPath())
  }
  const browserSession = session.defaultSession
  browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  browserSession.setPermissionCheckHandler(() => false)
  const browserProfile = session.fromPartition(BROWSER_PARTITION)
  browserProfile.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  browserProfile.setPermissionCheckHandler(() => false)
  if (app.isPackaged) {
    browserSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [RENDERER_CONTENT_SECURITY_POLICY],
        },
      })
    })
  }
  await bootstrap()
  app.on('second-instance', () => {
    if (!shutdownStarted) revealApplication('second instance')
  })
  app.on('activate', () => {
    if (!shutdownStarted && (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible())) revealApplication('activation')
  })
}).catch((error: unknown) => {
  const failureDialog = startupFailureDialog(error)
  if (failureDialog) dialog.showErrorBox(failureDialog.title, failureDialog.detail)
  if (!shutdownStarted) console.error(`WorkDaddy failed to start: ${boundedErrorMessage(error)}`)
  app.quit()
})

app.on('window-all-closed', () => {
  routeAllWindowsClosed(shutdownStarted, backgroundMode, () => app.quit())
})

app.on('before-quit', (event) => {
  if (shutdownStarted) return
  if (!shutdownApproved) {
    const prompt = pendingShutdownPrompt()
    if (prompt) {
      event.preventDefault()
      if (!confirmingShutdown) requestShutdown(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() ? mainWindow : null, prompt)
      return
    }
  }
  event.preventDefault()
  shutdownStarted = true

  const registration = ipc
  ipc = null
  registration?.dispose()
  backgroundMode?.dispose()
  updateService?.dispose()
  ompAgents?.beginShutdown()
  beginProcessShutdown()
  beginPluginDiscoveryShutdown()
  downloads?.cancelAll()
  agentBrowser?.beginShutdown()
  void settleShutdown([
    agentBrowserBridge?.stop() ?? Promise.resolve(),
    terminals?.killAll() ?? Promise.resolve(),
    ompAgents?.stopAll() ?? Promise.resolve(),
    stopChildProcesses(),
  ]).then(async () => {
    // Await the drain so the final persist lands before the process exits.
    try { await store?.beginShutdown() } catch (error) { console.error(`WorkDaddy store shutdown failed: ${boundedErrorMessage(error)}`) }
  }).finally(() => app.quit())
})
