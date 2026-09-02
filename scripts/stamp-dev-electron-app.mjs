#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))

/**
 * @param {{
 *   platform?: NodeJS.Platform,
 *   electronApp?: string,
 *   icon?: string,
 *   copyFile?: (src: string, dest: string) => void,
 *   exists?: (path: string) => boolean,
 *   run?: (file: string, args: string[]) => { status: number | null, stdout?: string | null, stderr?: string | null },
 * }} [options]
 */
export function stampDevElectronApp({
  platform = process.platform,
  electronApp = join(repositoryRoot, 'node_modules', 'electron', 'dist', 'Electron.app'),
  icon = join(repositoryRoot, 'assets', 'icon-dev.icns'),
  copyFile = copyFileSync,
  exists = existsSync,
  run = (file, args) => spawnSync(file, args, { encoding: 'utf8' }),
} = {}) {
  if (platform !== 'darwin') return { stamped: false, reason: 'not-darwin' }
  if (!exists(electronApp)) throw new Error(`Electron.app is missing at ${electronApp}`)
  if (!exists(icon)) throw new Error(`DEV icon is missing at ${icon}`)
  copyFile(icon, join(electronApp, 'Contents', 'Resources', 'electron.icns'))
  const plist = join(electronApp, 'Contents', 'Info.plist')
  for (const key of ['CFBundleDisplayName', 'CFBundleName']) {
    const result = run('/usr/libexec/PlistBuddy', ['-c', `Set :${key} WorkDaddy Dev`, plist])
    if (result.status !== 0) throw new Error(`PlistBuddy failed to set ${key}: ${result.stderr || result.stdout || 'unknown error'}`)
  }
  const sign = run('codesign', ['--force', '--sign', '-', '--timestamp=none', electronApp])
  if (sign.status !== 0) throw new Error(`Ad-hoc codesign of Electron.app failed: ${sign.stderr || sign.stdout || 'unknown error'}`)
  return { stamped: true }
}

export function invokedAsScript() {
  if (!process.argv[1]) return true
  try {
    return import.meta.url === pathToFileURL(resolve(process.argv[1])).href
  } catch {
    return true
  }
}

if (invokedAsScript()) {
  try {
    const result = stampDevElectronApp()
    if (result.stamped) console.log('Stamped Electron.app as WorkDaddy Dev with the DEV icon.')
  } catch (error) {
    console.error(`Failed to stamp the DEV Electron.app: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
