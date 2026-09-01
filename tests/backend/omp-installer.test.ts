import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ChecksumMismatchError,
  UnsupportedPlatformError,
  checkLatestOmpRelease,
  installOmp,
  managedHarnessDir,
  managedOmpExecutablePath,
  OMP_RELEASES_REPO,
  parseChecksums,
  type HttpClient,
} from '../../electron/main/omp-installer'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
const temp = () => { const dir = mkdtempSync(join(tmpdir(), 'workdaddy-omp-installer-')); dirs.push(dir); return dir }

const RELEASE_JSON = {
  tag_name: 'v17.3.5',
  assets: [
    { name: 'omp-browser-relay-extension.zip', size: 100, browser_download_url: 'https://example.test/omp-browser-relay-extension.zip' },
    { name: 'omp-darwin-arm64', size: 108_000_000, browser_download_url: 'https://example.test/omp-darwin-arm64' },
    { name: 'omp-darwin-x64', size: 108_000_000, browser_download_url: 'https://example.test/omp-darwin-x64' },
    { name: 'omp-linux-x64', size: 100_000_000, browser_download_url: 'https://example.test/omp-linux-x64' },
    { name: 'omp-windows-x64.exe', size: 100_000_000, browser_download_url: 'https://example.test/omp-windows-x64.exe' },
    { name: 'SHA256SUMS.txt', size: 400, browser_download_url: 'https://example.test/SHA256SUMS.txt' },
  ],
}

function fakeHttpClient(binaryContent: Buffer, options: { badChecksum?: boolean } = {}): HttpClient {
  const digest = createHash('sha256').update(binaryContent).digest('hex')
  const wrongDigest = '0'.repeat(64)
  const checksums = [
    `${options.badChecksum ? wrongDigest : digest}  omp-darwin-arm64`,
    `${digest}  omp-darwin-x64`,
    `${digest}  omp-linux-x64`,
    `${digest}  omp-windows-x64.exe`,
  ].join('\n')
  return {
    fetchJson: vi.fn(async (url: string) => {
      if (url === `https://api.github.com/repos/${OMP_RELEASES_REPO}/releases/latest`) return RELEASE_JSON
      throw new Error(`unexpected fetchJson url: ${url}`)
    }),
    fetchBuffer: vi.fn(async (url: string) => {
      if (url === 'https://example.test/SHA256SUMS.txt') return Buffer.from(checksums, 'utf8')
      if (url.startsWith('https://example.test/omp-')) return binaryContent
      throw new Error(`unexpected fetchBuffer url: ${url}`)
    }),
  }
}

describe('parseChecksums', () => {
  it('parses standard sha256sum output, including the binary-mode * prefix', () => {
    const content = [
      `${'a'.repeat(64)}  omp-darwin-arm64`,
      `${'b'.repeat(64)} *omp-linux-x64`,
      '',
      'not a checksum line',
    ].join('\n')
    expect(parseChecksums(content)).toEqual(new Map([
      ['omp-darwin-arm64', 'a'.repeat(64)],
      ['omp-linux-x64', 'b'.repeat(64)],
    ]))
  })
})

describe('checkLatestOmpRelease', () => {
  it('resolves the matching asset and checksums URL for this platform', async () => {
    const http = fakeHttpClient(Buffer.from('fake omp binary'))
    const release = await checkLatestOmpRelease(http, 'darwin', 'arm64')
    expect(release).toEqual({
      version: 'v17.3.5',
      asset: { name: 'omp-darwin-arm64', url: 'https://example.test/omp-darwin-arm64', size: 108_000_000 },
      checksumsUrl: 'https://example.test/SHA256SUMS.txt',
    })
  })

  it('rejects a platform/arch omp does not publish a binary for', async () => {
    const http = fakeHttpClient(Buffer.from('x'))
    await expect(checkLatestOmpRelease(http, 'win32', 'arm64')).rejects.toThrow(UnsupportedPlatformError)
    await expect(checkLatestOmpRelease(http, 'freebsd' as NodeJS.Platform, 'x64')).rejects.toThrow(UnsupportedPlatformError)
  })

  it('fails clearly when the release has no asset or no checksums for this platform', async () => {
    const withoutAsset: HttpClient = {
      fetchJson: vi.fn(async () => ({ tag_name: 'v1.0.0', assets: [] })),
      fetchBuffer: vi.fn(),
    }
    await expect(checkLatestOmpRelease(withoutAsset, 'darwin', 'arm64')).rejects.toThrow(/no omp-darwin-arm64 asset/)

    const withoutChecksums: HttpClient = {
      fetchJson: vi.fn(async () => ({ tag_name: 'v1.0.0', assets: [{ name: 'omp-darwin-arm64', size: 1, browser_download_url: 'https://example.test/a' }] })),
      fetchBuffer: vi.fn(),
    }
    await expect(checkLatestOmpRelease(withoutChecksums, 'darwin', 'arm64')).rejects.toThrow(/no SHA256SUMS\.txt/)
  })
})

describe('managed install paths', () => {
  it('places the managed binary under <userData>/bin, distinct from omp\'s own state', () => {
    const userData = '/home/user/Library/Application Support/WorkDaddy'
    expect(managedHarnessDir(userData)).toBe(join(userData, 'bin'))
    expect(managedOmpExecutablePath(userData, 'darwin')).toBe(join(userData, 'bin', 'omp'))
    expect(managedOmpExecutablePath(userData, 'win32')).toBe(join(userData, 'bin', 'omp.exe'))
  })
})

describe('installOmp', () => {
  it('downloads, verifies, and installs the binary as executable', async () => {
    const binaryContent = Buffer.from('#!/bin/sh\necho fake omp\n')
    const http = fakeHttpClient(binaryContent)
    const userData = temp()
    const phases: string[] = []

    const result = await installOmp(userData, { http, platform: 'darwin', arch: 'arm64', onProgress: (phase) => phases.push(phase) })

    expect(phases).toEqual(['checking', 'downloading', 'verifying', 'installing'])
    expect(result).toEqual({ path: join(userData, 'bin', 'omp'), version: 'v17.3.5' })
    expect(readFileSync(result.path)).toEqual(binaryContent)
    expect(statSync(result.path).mode & 0o777).toBe(0o755)
  })

  it('refuses to install when the downloaded bytes do not match the published checksum', async () => {
    const userData = temp()
    const http = fakeHttpClient(Buffer.from('tampered content'), { badChecksum: true })

    await expect(installOmp(userData, { http, platform: 'darwin', arch: 'arm64' })).rejects.toThrow(ChecksumMismatchError)
    expect(existsSync(join(userData, 'bin', 'omp'))).toBe(false)
    expect(existsSync(join(userData, 'bin'))).toBe(false)
  })

  it('never leaves a partial download at the final path if installation fails midway', async () => {
    const userData = temp()
    const http = fakeHttpClient(Buffer.from('fake omp binary'))
    await expect(installOmp(userData, { http, platform: 'freebsd' as NodeJS.Platform, arch: 'x64' })).rejects.toThrow(UnsupportedPlatformError)
    expect(existsSync(join(userData, 'bin'))).toBe(false)
  })
})
