import { createHash } from 'node:crypto'
import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { HARNESSES } from './harness'

/**
 * Downloads and verifies the official omp (oh-my-pi) release binary for
 * first-run users who have no harness installed. omp is deliberately not
 * bundled in the installer (the macOS arm64 binary alone is ~110MB); this
 * fetches it on demand from the project's own GitHub Releases and verifies
 * it against the maintainers' own SHA256SUMS.txt before it is ever executed.
 *
 * This is the only outbound-HTTP code in the app. The source repository is
 * a fixed constant, never user-configurable, to keep "download and run" from
 * becoming "download and run anything".
 */
export const OMP_RELEASES_REPO = 'can1357/oh-my-pi'
const GITHUB_API_BASE = 'https://api.github.com'
const USER_AGENT = 'WorkDaddy'
// The observed darwin-arm64 asset is ~108MB; this leaves generous headroom
// for other platforms and future growth without allowing an unbounded body.
const MAX_ASSET_BYTES = 250 * 1024 * 1024
const MAX_CHECKSUMS_BYTES = 64 * 1024
const REQUEST_TIMEOUT_MS = 5 * 60_000

export interface HttpClient {
  fetchJson(url: string): Promise<unknown>
  fetchBuffer(url: string, options: { maxBytes: number; timeoutMs: number }): Promise<Buffer>
}

async function withTimeout<T>(timeoutMs: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try { return await run(controller.signal) } finally { clearTimeout(timer) }
}

export const nodeHttpClient: HttpClient = {
  async fetchJson(url) {
    return withTimeout(REQUEST_TIMEOUT_MS, async (signal) => {
      const response = await fetch(url, { signal, headers: { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json' } })
      if (!response.ok) throw new Error(`GitHub API request failed: ${response.status} ${response.statusText}`)
      return response.json()
    })
  },
  async fetchBuffer(url, { maxBytes, timeoutMs }) {
    return withTimeout(timeoutMs, async (signal) => {
      const response = await fetch(url, { signal, headers: { 'User-Agent': USER_AGENT } })
      if (!response.ok) throw new Error(`Download failed: ${response.status} ${response.statusText}`)
      const declared = Number(response.headers.get('content-length'))
      if (Number.isFinite(declared) && declared > maxBytes) throw new Error('Download exceeds the maximum allowed size')
      const body = Buffer.from(await response.arrayBuffer())
      if (body.byteLength > maxBytes) throw new Error('Download exceeds the maximum allowed size')
      return body
    })
  },
}

interface GitHubReleaseAsset { name: string; size: number; browser_download_url: string }
interface GitHubRelease { tag_name: string; assets: GitHubReleaseAsset[] }

export interface OmpReleaseAsset { name: string; url: string; size: number }
export interface OmpRelease { version: string; asset: OmpReleaseAsset; checksumsUrl: string }

/** omp's release workflow publishes one prebuilt binary per platform/arch under these exact names. */
function assetNameFor(platform: NodeJS.Platform, arch: NodeJS.Architecture): string | null {
  if (platform === 'darwin') return arch === 'arm64' ? 'omp-darwin-arm64' : arch === 'x64' ? 'omp-darwin-x64' : null
  if (platform === 'linux') return arch === 'arm64' ? 'omp-linux-arm64' : arch === 'x64' ? 'omp-linux-x64' : null
  if (platform === 'win32') return arch === 'x64' ? 'omp-windows-x64.exe' : null
  return null
}

export class UnsupportedPlatformError extends Error {
  constructor(platform: NodeJS.Platform, arch: NodeJS.Architecture) {
    super(`omp does not publish a prebuilt binary for ${platform}/${arch}. Install it manually and point WorkDaddy at it in Harness settings.`)
    this.name = 'UnsupportedPlatformError'
  }
}

export async function checkLatestOmpRelease(
  http: HttpClient = nodeHttpClient,
  platform: NodeJS.Platform = process.platform,
  arch: NodeJS.Architecture = process.arch,
): Promise<OmpRelease> {
  const assetName = assetNameFor(platform, arch)
  if (!assetName) throw new UnsupportedPlatformError(platform, arch)
  const release = await http.fetchJson(`${GITHUB_API_BASE}/repos/${OMP_RELEASES_REPO}/releases/latest`) as GitHubRelease
  const asset = release.assets?.find((candidate) => candidate.name === assetName)
  const checksums = release.assets?.find((candidate) => candidate.name === 'SHA256SUMS.txt')
  if (!asset) throw new Error(`The latest omp release (${release.tag_name}) has no ${assetName} asset.`)
  if (!checksums) throw new Error(`The latest omp release (${release.tag_name}) has no SHA256SUMS.txt to verify against.`)
  return {
    version: release.tag_name,
    asset: { name: asset.name, url: asset.browser_download_url, size: asset.size },
    checksumsUrl: checksums.browser_download_url,
  }
}

/** Parses the standard `sha256sum`-format checksums file: one `<64-hex-digest>␠␠<filename>` line per asset. */
export function parseChecksums(content: string): Map<string, string> {
  const checksums = new Map<string, string>()
  for (const line of content.split('\n')) {
    const match = line.match(/^([0-9a-f]{64})\s+\*?(.+?)\s*$/)
    if (match) checksums.set(match[2], match[1])
  }
  return checksums
}

export class ChecksumMismatchError extends Error {
  constructor(name: string) {
    super(`Downloaded ${name} does not match the published checksum. Discarding it rather than installing an unverified binary.`)
    this.name = 'ChecksumMismatchError'
  }
}

/** Directory the app manages downloaded harness binaries in, distinct from omp's own `~/.omp` state. */
export function managedHarnessDir(userDataPath: string): string {
  return join(userDataPath, 'bin')
}

/**
 * Where a downloaded omp binary lives, if any. Harness discovery tries this
 * path unconditionally (via `access` + `X_OK`, which fails harmlessly when
 * nothing has been installed yet) whenever the user has not set their own
 * manual override in Settings, so an install becomes visible on the very
 * next discovery refresh with no further wiring.
 */
export function managedOmpExecutablePath(userDataPath: string, platform: NodeJS.Platform = process.platform): string {
  return join(managedHarnessDir(userDataPath), HARNESSES.omp.executableName(platform))
}

export interface InstallOmpOptions {
  http?: HttpClient
  platform?: NodeJS.Platform
  arch?: NodeJS.Architecture
  onProgress?(phase: 'checking' | 'downloading' | 'verifying' | 'installing'): void
}

export interface InstalledOmp { path: string; version: string }

/**
 * Downloads the latest omp release for this platform, verifies it against
 * the maintainers' SHA256SUMS.txt, and installs it into `<userDataPath>/bin`.
 * Never executes the downloaded bytes itself — `HarnessDiscoveryService`
 * picks the installed path up on its next refresh via the `--version` probe,
 * which is a spawn the caller controls, not this function.
 */
export async function installOmp(userDataPath: string, options: InstallOmpOptions = {}): Promise<InstalledOmp> {
  const http = options.http ?? nodeHttpClient
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  options.onProgress?.('checking')
  const release = await checkLatestOmpRelease(http, platform, arch)

  options.onProgress?.('downloading')
  const [binary, checksumsRaw] = await Promise.all([
    http.fetchBuffer(release.asset.url, { maxBytes: MAX_ASSET_BYTES, timeoutMs: REQUEST_TIMEOUT_MS }),
    http.fetchBuffer(release.checksumsUrl, { maxBytes: MAX_CHECKSUMS_BYTES, timeoutMs: REQUEST_TIMEOUT_MS }),
  ])

  options.onProgress?.('verifying')
  const checksums = parseChecksums(checksumsRaw.toString('utf8'))
  const expected = checksums.get(release.asset.name)
  if (!expected) throw new Error(`SHA256SUMS.txt has no entry for ${release.asset.name}.`)
  const actual = createHash('sha256').update(binary).digest('hex')
  if (actual !== expected) throw new ChecksumMismatchError(release.asset.name)

  options.onProgress?.('installing')
  const dir = managedHarnessDir(userDataPath)
  await mkdir(dir, { recursive: true })
  const finalName = HARNESSES.omp.executableName(platform)
  const finalPath = join(dir, finalName)
  const tempPath = `${finalPath}.download-${process.pid}-${Date.now()}`
  try {
    await writeFile(tempPath, binary, { mode: 0o755 })
    if (platform !== 'win32') await chmod(tempPath, 0o755)
    await rename(tempPath, finalPath)
  } catch (error) {
    await rm(tempPath, { force: true })
    throw error
  }
  return { path: finalPath, version: release.version }
}
