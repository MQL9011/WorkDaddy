import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultSettings, JsonStateStore } from '../../electron/main/store'
import type { DesktopState } from '../../electron/main/store'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function loadState(value: unknown): DesktopState {
  const dir = mkdtempSync(join(tmpdir(), 'gooeypi-store-parse-'))
  dirs.push(dir)
  const path = join(dir, 'state.json')
  writeFileSync(path, JSON.stringify(value))
  return new JsonStateStore(path).snapshot()
}

describe('persisted project parsing', () => {
  it('keeps well-formed projects and repairs missing optional fields', () => {
    const { projects } = loadState({
      version: 3,
      projects: [{
        id: 'project-1',
        harness: 'omp',
        name: 'WorkDaddy',
        path: '/repos/gooey-pi',
        primaryFolder: '/repos/gooey-pi',
        pinned: 'yes',
        createdAt: 'not a date',
        lastOpenedAt: '2025-12-02T09:00:00.000Z',
      }],
    })
    expect(projects).toHaveLength(1)
    expect(projects[0]).toMatchObject({ harness: 'omp', folders: ['/repos/gooey-pi'], pinned: false, lastOpenedAt: '2025-12-02T09:00:00.000Z' })
    expect(Number.isFinite(Date.parse(projects[0].createdAt))).toBe(true)
    expect(projects[0].folderIdentities).toBeUndefined()
  })

  it('drops projects that are not records or lack an id, name, path, folders, or primary folder', () => {
    expect(loadState({ version: 3, projects: ['project-1', null] }).projects).toEqual([])
    expect(loadState({ version: 3, projects: [{ id: 'p', name: 'n' }] }).projects).toEqual([])
    expect(loadState({ version: 3, projects: [{ id: 'p', name: 'n', path: '/repo', folders: [], primaryFolder: '/repo' }] }).projects).toEqual([])
    expect(loadState({ version: 3, projects: [{ id: 'p', name: 'n', path: '/repo', folders: ['/repo'] }] }).projects).toEqual([])
    expect(loadState({ version: 3, projects: { id: 'p' } }).projects).toEqual([])
  })

  it('keeps only folder identities with string device and inode numbers and a plausible birth time', () => {
    const { projects } = loadState({
      version: 3,
      projects: [{
        id: 'project-1',
        harness: 'omp',
        name: 'WorkDaddy',
        path: '/repos/gooey-pi',
        folders: ['/repos/gooey-pi', 7],
        primaryFolder: '/repos/gooey-pi',
        folderIdentities: {
          '/repos/gooey-pi': { dev: '1', ino: '2', birthtimeNs: '1700000000000000000' },
          '/repos/other': { dev: '1', ino: '3', birthtimeNs: 'yesterday' },
          '/repos/third': { dev: 1, ino: 3 },
          '/repos/fourth': 'identity',
        },
      }],
    })
    expect(projects[0].folders).toEqual(['/repos/gooey-pi'])
    expect(projects[0].folderIdentities).toEqual({
      '/repos/gooey-pi': { dev: '1', ino: '2', birthtimeNs: '1700000000000000000' },
      '/repos/other': { dev: '1', ino: '3', birthtimeNs: undefined },
    })
  })

  it.each([1, 2])('migrates only absent harnesses from recognized pre-harness version %s to omp', (version) => {
    const legacyProject = {
      id: 'legacy-project',
      name: 'Legacy',
      path: '/repos/legacy',
      folders: ['/repos/legacy'],
      primaryFolder: '/repos/legacy',
    }
    const { projects } = loadState({
      version,
      projects: [legacyProject, { ...legacyProject, id: 'unknown-project', harness: 'future-harness' }],
    })

    expect(projects).toHaveLength(1)
    expect(projects[0]).toMatchObject({ id: 'legacy-project', harness: 'omp' })
  })

  it.each([3, 4])('drops version %s projects whose harness is absent or unknown', (version) => {
    const project = {
      id: 'project-1',
      name: 'WorkDaddy',
      path: '/repos/gooey-pi',
      folders: ['/repos/gooey-pi'],
      primaryFolder: '/repos/gooey-pi',
    }
    const { projects } = loadState({
      version,
      projects: [project, { ...project, id: 'unknown-project', harness: 'future-harness' }, { ...project, id: 'omp-project', harness: 'omp' }],
    })

    expect(projects.map(({ id, harness }) => ({ id, harness }))).toEqual([{ id: 'omp-project', harness: 'omp' }])
  })
})

describe('persisted settings parsing', () => {
  it('falls back to defaults when settings are missing or not a record', () => {
    expect(loadState({ version: 3 }).settings).toEqual(defaultSettings())
    expect(loadState({ version: 3, settings: 'dark' }).settings).toEqual(defaultSettings())
    expect(loadState('not a state').settings).toEqual(defaultSettings())
  })

  it('keeps only absolute, bounded runtime paths and known harness identifiers', () => {
    const { settings } = loadState({
      version: 3,
      settings: { runtimePaths: { omp: 'omp' }, enabledHarnesses: ['omp', 'omp', 'ollama'], activeHarness: 'ollama' },
    })
    expect(settings.runtimePaths).toEqual({ omp: '' })
    expect(settings.enabledHarnesses).toEqual(['omp'])
    expect(settings.activeHarness).toBe('omp')

    const { settings: absolute } = loadState({
      version: 3,
      settings: { runtimePaths: { omp: '/usr/local/bin/omp' } },
    })
    expect(absolute.runtimePaths).toEqual({ omp: '/usr/local/bin/omp' })

    const { settings: oversized } = loadState({
      version: 3,
      settings: { runtimePaths: { omp: '/'.padEnd(4_097, 'x') } },
    })
    expect(oversized.runtimePaths).toEqual({ omp: '' })
  })

  it('defaults background behavior off and preserves valid opt-in values', () => {
    expect(loadState({ version: 4, settings: {} }).settings).toMatchObject({
      keepRunningInBackground: false,
      launchAtLogin: false,
    })
    expect(loadState({ version: 4, settings: { keepRunningInBackground: true, launchAtLogin: true } }).settings).toMatchObject({
      keepRunningInBackground: true,
      launchAtLogin: true,
    })
    expect(loadState({ version: 4, settings: { keepRunningInBackground: 'yes', launchAtLogin: 1 } }).settings).toMatchObject({
      keepRunningInBackground: false,
      launchAtLogin: false,
    })
  })

  it('filters disabled provider and model identifiers to their documented shapes', () => {
    const { settings } = loadState({
      version: 3,
      settings: {
        // Legacy Prime/pi keys from older state files are silently ignored.
        disabledProviders: ['openai', 'openai', '-bad', 42],
        disabledModels: ['openai/gpt-5', 'gpt-5', 7],
        piDisabledProviders: 'openai',
        piDisabledModels: ['openai/gpt-5'],
        ompDisabledProviders: ['anthropic', 'anthropic', '-bad', 42],
        ompDisabledModels: 'anthropic/claude',
      },
    })
    expect(settings.ompDisabledProviders).toEqual(['anthropic'])
    expect(settings.ompDisabledModels).toEqual([])
  })
})
