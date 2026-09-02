/**
 * OMP Work vault decryption tool.
 *
 * Loaded via --extension when the desktop app spawns an OMP runtime for a
 * project that ships AES-256-GCM encrypted skill bodies — the ".enc" envelope
 * produced by a separate `vault.py` tool (not part of this repository; see
 * assets/vault-samples/code-review/README.md for where it lives and how the
 * checked-in fixture was generated):
 *
 *   CC_VAULT_V1\npath:<relative path>\n\n<base64(nonce[12] || ciphertext || tag)>
 *
 * `path` is stored in the envelope header and doubles as the AES-GCM
 * additional authenticated data, so a renamed or moved .enc file fails to
 * decrypt instead of silently decrypting under the wrong identity.
 *
 * Decryption happens inside this OMP process — never in the Electron main
 * process, which stays free to keep the UI responsive — and the key only
 * arrives through the environment the desktop app sets when it starts this
 * runtime (MAERWEN_VAULT_KEY / MAERWEN_VAULT_ROOT). A plugin's ciphertext can
 * therefore only be read back by an OMP runtime the desktop app itself
 * launched, the same way PRIME_WORK_BROWSER_TOKEN scopes the browser bridge
 * to runtimes WorkDaddy started.
 *
 * Self-contained: OMP imports this directly under Bun from app resources, so
 * it must not depend on repo modules or npm packages (only Node builtins and
 * the injected `pi` API).
 *
 * Threat model (deliberately not stronger than this): this protects
 * protected skill content at rest against a customer casually copying plugin
 * files, the same guarantee vault.py's own README documents. It is not DRM —
 * anyone who extracts MAERWEN_VAULT_KEY from the packaged app (or from this
 * process's memory/environment while it runs) can decrypt every payload it
 * protects, and the plaintext this tool returns is still sent to the model
 * like any other tool result.
 */

import { readFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'

interface OmpSchemaOptions {
  description?: string
}

interface OmpTypebox {
  Object(properties: Record<string, unknown>, options?: OmpSchemaOptions): unknown
  String(options?: OmpSchemaOptions): unknown
}

interface OmpToolResult {
  content: Array<{ type: 'text'; text: string }>
  details: Record<string, unknown>
}

interface OmpToolDefinition<Params> {
  name: string
  label: string
  description: string
  parameters: unknown
  execute(toolCallId: string, params: Params): Promise<OmpToolResult>
}

export interface OmpExtensionApi {
  typebox?: { Type: OmpTypebox }
  registerTool<Params>(tool: OmpToolDefinition<Params>): void
}

async function importHostModule(specifier: string): Promise<Record<string, unknown> | undefined> {
  try {
    return (await import(specifier)) as Record<string, unknown>
  } catch {
    return undefined
  }
}

async function resolveHostTypebox(): Promise<OmpTypebox> {
  const hostType = (await importHostModule('typebox'))?.Type as OmpTypebox | undefined
  if (hostType) {
    return {
      Object: (properties, options) => hostType.Object(properties, options),
      String: (options) => hostType.String(options),
    }
  }
  // Last resort: plain JSON Schema builders covering exactly this file's usage.
  return {
    Object: (properties, options) => ({ type: 'object', properties, required: Object.keys(properties), ...(options ?? {}) }),
    String: (options) => ({ type: 'string', ...(options ?? {}) }),
  }
}

const VAULT_KEY_HEX = process.env.MAERWEN_VAULT_KEY
const VAULT_ROOT = process.env.MAERWEN_VAULT_ROOT
const ENVELOPE_MAGIC = 'CC_VAULT_V1'
const NONCE_LENGTH = 12
const MAX_FILE_PATH_LENGTH = 512
const MAX_ENVELOPE_BYTES = 2 * 1024 * 1024

function isWithin(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

// Return types are pinned to Uint8Array<ArrayBuffer> (not bare Uint8Array,
// which TypeScript's typed-array generics default to Uint8Array<ArrayBufferLike>
// — a union that also covers SharedArrayBuffer) because WebCrypto's
// BufferSource parameters require a concrete ArrayBuffer-backed view, and
// every array here is always freshly allocated, never shared.
function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) throw new Error('Vault key is not valid hex')
  const bytes = new Uint8Array(hex.length / 2)
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  return bytes
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/** Parses the `CC_VAULT_V1` envelope emitted by `vault.py encrypt-file`/`encrypt-dir`. */
function parseEnvelope(raw: string): { path: string; nonce: Uint8Array<ArrayBuffer>; ciphertext: Uint8Array<ArrayBuffer> } {
  const separator = raw.indexOf('\n\n')
  if (separator < 0) throw new Error('Malformed vault envelope')
  const [magic, pathLine] = raw.slice(0, separator).split('\n')
  if (magic !== ENVELOPE_MAGIC) throw new Error('Unsupported vault envelope version')
  if (!pathLine?.startsWith('path:')) throw new Error('Malformed vault envelope: missing path')
  const path = pathLine.slice('path:'.length)
  let payload: Uint8Array<ArrayBuffer>
  try {
    payload = base64ToBytes(raw.slice(separator + 2).trim())
  } catch {
    throw new Error('Malformed vault envelope: invalid base64 payload')
  }
  if (payload.length <= NONCE_LENGTH) throw new Error('Malformed vault envelope: payload too short')
  return { path, nonce: payload.slice(0, NONCE_LENGTH), ciphertext: payload.slice(NONCE_LENGTH) }
}

function rejectUnsafeRelativePath(path: string): void {
  // The `typeof` check guards against a host that skips or bypasses the
  // TypeBox parameter schema; every check after it assumes a string.
  if (
    typeof path !== 'string'
    || !path
    || path.length > MAX_FILE_PATH_LENGTH
    || isAbsolute(path)
    || path.split(/[\\/]/).includes('..')
    || /[\0\r\n]/.test(path)
  ) throw new Error('Invalid vault file path')
}

async function decryptVaultFile(relativePath: string): Promise<string> {
  if (!VAULT_KEY_HEX || !VAULT_ROOT) throw new Error('The vault is not available in this runtime')
  rejectUnsafeRelativePath(relativePath)

  const encryptedPath = resolve(VAULT_ROOT, `${relativePath}.enc`)
  if (!isWithin(VAULT_ROOT, encryptedPath)) throw new Error('Invalid vault file path')

  let raw: string
  try {
    raw = readFileSync(encryptedPath, { encoding: 'utf8' })
  } catch {
    throw new Error(`Vault file not found: ${relativePath}`)
  }
  if (raw.length > MAX_ENVELOPE_BYTES) throw new Error('Vault file is too large')

  const { path: storedPath, nonce, ciphertext } = parseEnvelope(raw.trim())
  // The envelope's path is also the AES-GCM AAD (see decrypt below); reject
  // the mismatch before touching the key so a renamed .enc file fails fast
  // with a clear reason instead of an opaque decrypt error.
  if (storedPath !== relativePath) throw new Error('Vault file path does not match its envelope')

  let key: CryptoKey
  try {
    key = await crypto.subtle.importKey('raw', hexToBytes(VAULT_KEY_HEX), 'AES-GCM', false, ['decrypt'])
  } catch {
    throw new Error('Vault key is misconfigured')
  }
  let plaintext: ArrayBuffer
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: new TextEncoder().encode(storedPath), tagLength: 128 },
      key,
      ciphertext,
    )
  } catch {
    throw new Error('Vault decryption failed: wrong key or corrupted file')
  }
  return new TextDecoder().decode(plaintext)
}

export default function (pi: OmpExtensionApi): void | Promise<void> {
  // Inert outside a runtime WorkDaddy launched with vault key/root set —
  // mirrors omp-work-browser.ts's no-broker-env early return.
  if (!VAULT_KEY_HEX || !VAULT_ROOT) return

  // OMP injects a TypeBox shim and calls the factory without awaiting it, so
  // that path must stay fully synchronous; base pi awaits the factory, so the
  // fallback may resolve builders asynchronously before registering.
  const injected = pi.typebox?.Type
  if (injected) {
    registerTools(pi, injected)
    return
  }
  return resolveHostTypebox().then((hostType) => { registerTools(pi, hostType) })
}

function registerTools(pi: OmpExtensionApi, Type: OmpTypebox): void {
  pi.registerTool<{ file: string }>({
    name: 'vault_read',
    label: 'Vault read',
    description: 'Read a protected document from this plugin\'s encrypted vault by its logical relative path (for example "SKILL.md" or "references/checklist.md") and return the decrypted plaintext. The matching file on disk is AES-256-GCM ciphertext and cannot be read with the ordinary file-reading tool — always call vault_read for any path the plugin\'s instructions point you at instead.',
    parameters: Type.Object({
      file: Type.String({ description: 'Logical relative path of the protected document, without the .enc suffix' }),
    }),
    async execute(_toolCallId, params) {
      const text = await decryptVaultFile(params.file)
      return { content: [{ type: 'text', text }], details: { file: params.file } }
    },
  })
}
