import { describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  app: {
    getAppPath: vi.fn(() => '/tmp/prime-work'),
    isPackaged: false,
    on: vi.fn(),
    quit: vi.fn(),
    requestSingleInstanceLock: vi.fn(() => false),
  },
  BrowserWindow: class {},
  dialog: { showMessageBoxSync: vi.fn() },
  Menu: { buildFromTemplate: vi.fn(() => ({ popup: vi.fn() })) },
  nativeImage: { createFromPath: vi.fn() },
  protocol: { registerSchemesAsPrivileged: vi.fn() },
  session: {},
  Tray: class {},
}))

vi.mock('electron', () => electron)

import { extensionRuntimeEnvironment, type CapabilityExtensionPaths } from '../../electron/main/index'
import { OMP_RPC_ADAPTER } from '../../electron/main/agent-rpc'

const extensionPaths: CapabilityExtensionPaths = {
  browser: '/app/extensions/omp-work-browser.ts',
  askUser: '/app/extensions/omp-work-ask-user.ts',
}

const extensionPathsWithVault: CapabilityExtensionPaths = {
  ...extensionPaths,
  vault: '/app/extensions/omp-work-vault.ts',
}

/** What the browser bridge hands every runtime of the harness. */
const browserBridgeEnvironment = {
  PRIME_WORK_BROWSER_URL: 'http://127.0.0.1:45002',
  PRIME_WORK_BROWSER_TOKEN: 'browser-token',
}

describe('capability extension environment (OMP)', () => {
  it('populates the shared extension paths', () => {
    const environment = extensionRuntimeEnvironment(() => browserBridgeEnvironment, extensionPaths)

    expect(environment.PRIME_WORK_BROWSER_EXTENSION_PATH).toBe('/app/extensions/omp-work-browser.ts')
    expect(environment.PRIME_WORK_ASK_USER_EXTENSION_PATH).toBe('/app/extensions/omp-work-ask-user.ts')
    expect(environment.GOOEYPI_MANAGES_ASK_USER).toBe('1')
    // The loopback-broker contract from the bridge is preserved untouched.
    expect(environment.PRIME_WORK_BROWSER_URL).toBe('http://127.0.0.1:45002')
    expect(environment.PRIME_WORK_BROWSER_TOKEN).toBe('browser-token')
  })

  it('turns the shared environment into --extension injections for OMP runtimes', () => {
    const environment = extensionRuntimeEnvironment(() => browserBridgeEnvironment, extensionPaths)
    const args = OMP_RPC_ADAPTER.buildStartArgs({ cwd: '/work', environment })

    const injected: string[] = []
    for (let index = 0; index < args.length - 1; index += 1) {
      if (args[index] === '--extension') injected.push(args[index + 1])
    }
    expect(injected).toEqual([
      '/app/extensions/omp-work-browser.ts',
      '/app/extensions/omp-work-ask-user.ts',
    ])
    // OMP has no --skill flag; capabilities are extension-injected only.
    expect(args).not.toContain('--skill')
  })

  it('omits the ask_user extension when disabled', () => {
    const environment = extensionRuntimeEnvironment(() => browserBridgeEnvironment, extensionPaths, false)
    expect(environment.GOOEYPI_MANAGES_ASK_USER).toBe('1')
    expect(environment.PRIME_WORK_ASK_USER_EXTENSION_PATH).toBeUndefined()
    expect(OMP_RPC_ADAPTER.buildStartArgs({ cwd: '/work', environment })).not.toContain(extensionPaths.askUser)
  })

  it('does not mint or inject a browser claim when Browser is disabled', () => {
    const mintBrowserClaim = vi.fn(() => browserBridgeEnvironment)
    const environment = extensionRuntimeEnvironment(mintBrowserClaim, extensionPaths, true, false)
    expect(mintBrowserClaim).not.toHaveBeenCalled()
    expect(environment.PRIME_WORK_BROWSER_EXTENSION_PATH).toBeUndefined()
    expect(environment.PRIME_WORK_BROWSER_URL).toBeUndefined()
    expect(environment.PRIME_WORK_BROWSER_TOKEN).toBeUndefined()
    expect(OMP_RPC_ADAPTER.buildStartArgs({ cwd: '/work', environment })).not.toContain(extensionPaths.browser)
  })

  it('omits the vault extension and key/root when no vault config is provided', () => {
    const environment = extensionRuntimeEnvironment(() => browserBridgeEnvironment, extensionPathsWithVault)
    expect(environment.PRIME_WORK_VAULT_EXTENSION_PATH).toBeUndefined()
    expect(environment.ANCODER_VAULT_KEY).toBeUndefined()
    expect(environment.ANCODER_VAULT_ROOT).toBeUndefined()
    expect(OMP_RPC_ADAPTER.buildStartArgs({ cwd: '/work', environment })).not.toContain(extensionPathsWithVault.vault)
  })

  it('injects the vault extension, key, and root when vault config is provided', () => {
    const environment = extensionRuntimeEnvironment(
      () => browserBridgeEnvironment,
      extensionPathsWithVault,
      true,
      true,
      { key: 'deadbeef', root: '/app/vault-samples/code-review/payload' },
    )
    expect(environment.PRIME_WORK_VAULT_EXTENSION_PATH).toBe('/app/extensions/omp-work-vault.ts')
    expect(environment.ANCODER_VAULT_KEY).toBe('deadbeef')
    expect(environment.ANCODER_VAULT_ROOT).toBe('/app/vault-samples/code-review/payload')
    const args = OMP_RPC_ADAPTER.buildStartArgs({ cwd: '/work', environment })
    const injected: string[] = []
    for (let index = 0; index < args.length - 1; index += 1) {
      if (args[index] === '--extension') injected.push(args[index + 1])
    }
    expect(injected).toContain('/app/extensions/omp-work-vault.ts')
  })
})
