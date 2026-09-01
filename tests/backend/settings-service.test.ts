import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ session: { fromPartition: vi.fn(), defaultSession: {} } }))

import { SettingsService } from '../../electron/main/settings-schedules'
import { JsonStateStore } from '../../electron/main/store'

const dirs: string[] = []
function makeService(validateShell: (shell: unknown) => string = () => '/bin/zsh', onDidUpdate?: ConstructorParameters<typeof SettingsService>[3]) {
  const dir = mkdtempSync(join(tmpdir(), 'prime-work-settings-'))
  dirs.push(dir)
  return new SettingsService(new JsonStateStore(join(dir, 'state.json')), validateShell, undefined, onDidUpdate)
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe('SettingsService.update', () => {
  it('applies every field of a full valid patch', async () => {
    const service = makeService()
    const next = await service.update({
      theme: 'dark',
      locale: 'zh-CN',
      interfaceFontScale: 105,
      sidebarOpen: false,
      inspectorOpen: true,
      showFileChangesPopup: false,
      keepRunningInBackground: true,
      launchAtLogin: true,
      terminalOpen: true,
      defaultInspectorTab: 'changes',
      browserHome: 'https://example.test/',
      browserAskForDownloads: false,
      terminalShell: '/bin/zsh',
      reduceMotion: true,
      showReasoningSummaries: false,
      showToolCalls: false,
      messageEnterAction: 'steer',
      runtimePaths: { omp: '/opt/omp' },
      enabledHarnesses: ['omp'],
      telemetry: false,
      askUserEnabled: false,
      ompDisabledProviders: ['anthropic', 'anthropic'],
      ompDisabledModels: ['anthropic/claude-sonnet-4'],
      activeHarness: 'omp',
      ompApprovalMode: 'always-ask',
    })
    expect(next).toMatchObject({
      theme: 'dark', locale: 'zh-CN', interfaceFontScale: 105, sidebarOpen: false, inspectorOpen: true, showFileChangesPopup: false, keepRunningInBackground: true, launchAtLogin: true, terminalOpen: true,
      defaultInspectorTab: 'changes', browserHome: 'https://example.test/',
      browserAskForDownloads: false, terminalShell: '/bin/zsh', reduceMotion: true,
      showReasoningSummaries: false, showToolCalls: false, messageEnterAction: 'steer',
      runtimePaths: { omp: '/opt/omp' }, enabledHarnesses: ['omp'],
      telemetry: false, askUserEnabled: false, ompDisabledProviders: ['anthropic'],
      ompDisabledModels: ['anthropic/claude-sonnet-4'],
      activeHarness: 'omp', ompApprovalMode: 'always-ask',
    })
    expect(service.get()).toEqual(next)
  })

  it('leaves unrelated settings untouched on a partial patch', async () => {
    const service = makeService()
    const before = service.get()
    const next = await service.update({ theme: 'light' })
    expect(next.theme).toBe('light')
    expect(next.sidebarOpen).toBe(before.sidebarOpen)
    expect(next.terminalShell).toBe(before.terminalShell)
  })

  it('rejects unknown keys, invalid enums, and malformed values without persisting', async () => {
    const service = makeService()
    const before = service.get()
    await expect(service.update({ nope: true })).rejects.toThrow(/not supported/)
    await expect(service.update('dark')).rejects.toThrow(/must be an object/)
    await expect(service.update({ theme: 'solarized' })).rejects.toThrow(/Invalid theme/)
    await expect(service.update({ locale: 'fr' })).rejects.toThrow(/Invalid locale/)
    await expect(service.update({ interfaceFontScale: 111 })).rejects.toThrow(/Invalid interface font scale/)
    await expect(service.update({ defaultInspectorTab: 'tools' })).rejects.toThrow(/Invalid inspector tab/)
    await expect(service.update({ messageEnterAction: 'send' })).rejects.toThrow(/Invalid message Enter action/)
    await expect(service.update({ runtimePaths: { omp: 'relative/omp' } })).rejects.toThrow(/must be absolute/)
    await expect(service.update({ runtimePaths: { omp: '/opt/omp', extra: '/tmp/evil' } })).rejects.toThrow(/not supported/)
    await expect(service.update({ enabledHarnesses: [] })).rejects.toThrow(/At least one harness/)
    await expect(service.update({ enabledHarnesses: ['codex'] })).rejects.toThrow(/is invalid/)
    await expect(service.update({ sidebarOpen: 'yes' })).rejects.toThrow(/must be a boolean/)
    await expect(service.update({ keepRunningInBackground: 'yes' })).rejects.toThrow(/must be a boolean/)
    await expect(service.update({ launchAtLogin: 1 })).rejects.toThrow(/must be a boolean/)
    await expect(service.update({ askUserEnabled: 'yes' })).rejects.toThrow(/must be a boolean/)
    await expect(service.update({ browserHome: 'javascript:alert(1)' })).rejects.toThrow(/scheme/)
    await expect(service.update({ ompDisabledProviders: ['../evil'] })).rejects.toThrow(/provider ID/)
    await expect(service.update({ ompDisabledProviders: Array.from({ length: 257 }, () => 'p') })).rejects.toThrow(/bounded/)
    await expect(service.update({ ompDisabledModels: ['missing-slash'] })).rejects.toThrow(/model key/)
    await expect(service.update({ activeHarness: 'codex' })).rejects.toThrow(/Invalid harness/)
    await expect(service.update({ ompApprovalMode: 'sudo' })).rejects.toThrow(/Invalid OMP approval mode/)
    expect(service.get()).toEqual(before)
  })

  it('routes terminalShell through the injected shell validator', async () => {
    const validateShell = vi.fn(() => '/bin/bash')
    const service = makeService(validateShell)
    const next = await service.update({ terminalShell: '/bin/bash' })
    expect(validateShell).toHaveBeenCalledWith('/bin/bash')
    expect(next.terminalShell).toBe('/bin/bash')
    validateShell.mockImplementation(() => { throw new TypeError('shell is not allowed') })
    await expect(service.update({ terminalShell: '/tmp/evil' })).rejects.toThrow(/not allowed/)
  })

  it('reports the persisted previous and next settings to lifecycle integrations', async () => {
    const onDidUpdate = vi.fn()
    const service = makeService(undefined, onDidUpdate)
    const before = service.get()
    const next = await service.update({ keepRunningInBackground: true })
    expect(onDidUpdate).toHaveBeenCalledWith(before, next)
    expect(next.keepRunningInBackground).toBe(true)
  })
})
