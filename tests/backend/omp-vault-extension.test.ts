import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OmpExtensionApi } from '../../assets/extensions/omp-work-vault'

interface RegisteredTool {
  name: string
  label: string
  description: string
  parameters: unknown
  execute(
    toolCallId: string,
    params: { file: string },
  ): Promise<{ content: Array<{ text: string }>; details: Record<string, unknown> }>
}

function piHost() {
  const tools: RegisteredTool[] = []
  const schema = (kind: string) => (...args: unknown[]) => ({ kind, args })
  return {
    tools,
    pi: {
      typebox: { Type: { Object: schema('object'), String: schema('string') } },
      registerTool: (tool: RegisteredTool) => { tools.push(tool) },
    },
  }
}

const KEY_HEX = 'ab'.repeat(32)
const OTHER_KEY_HEX = 'cd'.repeat(32)

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(hex.length / 2)
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  return bytes
}

/** Builds a real `CC_VAULT_V1` envelope, matching the companion vault.py tool's output. */
async function encryptEnvelope(plaintext: string, relativePath: string, keyHex: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', hexToBytes(keyHex), 'AES-GCM', false, ['encrypt'])
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: new TextEncoder().encode(relativePath), tagLength: 128 },
    key,
    new TextEncoder().encode(plaintext),
  ))
  const payload = new Uint8Array(nonce.length + ciphertext.length)
  payload.set(nonce)
  payload.set(ciphertext, nonce.length)
  return `CC_VAULT_V1\npath:${relativePath}\n\n${Buffer.from(payload).toString('base64')}\n`
}

const dirs: string[] = []

function vaultRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'maerwen-vault-'))
  dirs.push(dir)
  return dir
}

async function loadVaultExtension() {
  vi.resetModules()
  return (await import('../../assets/extensions/omp-work-vault')).default
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('omp-work-vault extension', () => {
  it('registers nothing without a configured key and root', async () => {
    vi.stubEnv('MAERWEN_VAULT_KEY', '')
    vi.stubEnv('MAERWEN_VAULT_ROOT', '')
    const factory = await loadVaultExtension()
    const { tools, pi } = piHost()
    await factory(pi as unknown as OmpExtensionApi)
    expect(tools).toHaveLength(0)
  })

  it('registers a standalone vault_read tool when key and root are configured', async () => {
    vi.stubEnv('MAERWEN_VAULT_KEY', KEY_HEX)
    vi.stubEnv('MAERWEN_VAULT_ROOT', vaultRoot())
    const factory = await loadVaultExtension()
    const { tools, pi } = piHost()
    await factory(pi as unknown as OmpExtensionApi)
    expect(tools).toHaveLength(1)
    expect(tools[0]).toMatchObject({ name: 'vault_read', label: 'Vault read' })
    expect(tools[0].description).toContain('vault_read')
    expect(tools[0].parameters).toBeDefined()
  })

  it('decrypts a top-level and a nested reference file to their exact plaintext', async () => {
    const root = vaultRoot()
    mkdirSync(join(root, 'references'), { recursive: true })
    writeFileSync(join(root, 'SKILL.md.enc'), await encryptEnvelope('# Body\nProtected instructions.', 'SKILL.md', KEY_HEX))
    writeFileSync(join(root, 'references', 'checklist.md.enc'), await encryptEnvelope('- item one', 'references/checklist.md', KEY_HEX))
    vi.stubEnv('MAERWEN_VAULT_KEY', KEY_HEX)
    vi.stubEnv('MAERWEN_VAULT_ROOT', root)
    const factory = await loadVaultExtension()
    const { tools, pi } = piHost()
    await factory(pi as unknown as OmpExtensionApi)
    const tool = tools[0]

    const skill = await tool.execute('call-1', { file: 'SKILL.md' })
    expect(skill.content[0].text).toBe('# Body\nProtected instructions.')
    expect(skill.details).toEqual({ file: 'SKILL.md' })

    const checklist = await tool.execute('call-2', { file: 'references/checklist.md' })
    expect(checklist.content[0].text).toBe('- item one')
  })

  it('rejects the wrong key with a generic decryption error', async () => {
    const root = vaultRoot()
    writeFileSync(join(root, 'SKILL.md.enc'), await encryptEnvelope('secret body', 'SKILL.md', KEY_HEX))
    vi.stubEnv('MAERWEN_VAULT_KEY', OTHER_KEY_HEX)
    vi.stubEnv('MAERWEN_VAULT_ROOT', root)
    const factory = await loadVaultExtension()
    const { tools, pi } = piHost()
    await factory(pi as unknown as OmpExtensionApi)
    await expect(tools[0].execute('call-1', { file: 'SKILL.md' })).rejects.toThrow('wrong key or corrupted file')
  })

  it('rejects a renamed envelope via the path AAD mismatch', async () => {
    const root = vaultRoot()
    // Encrypted under one logical path but saved on disk under another name.
    writeFileSync(join(root, 'renamed.md.enc'), await encryptEnvelope('secret body', 'SKILL.md', KEY_HEX))
    vi.stubEnv('MAERWEN_VAULT_KEY', KEY_HEX)
    vi.stubEnv('MAERWEN_VAULT_ROOT', root)
    const factory = await loadVaultExtension()
    const { tools, pi } = piHost()
    await factory(pi as unknown as OmpExtensionApi)
    await expect(tools[0].execute('call-1', { file: 'renamed.md' })).rejects.toThrow('does not match its envelope')
  })

  it('rejects path traversal and absolute paths outside the vault root', async () => {
    vi.stubEnv('MAERWEN_VAULT_KEY', KEY_HEX)
    vi.stubEnv('MAERWEN_VAULT_ROOT', vaultRoot())
    const factory = await loadVaultExtension()
    const { tools, pi } = piHost()
    await factory(pi as unknown as OmpExtensionApi)
    await expect(tools[0].execute('call-1', { file: '../secrets/keys.md' })).rejects.toThrow('Invalid vault file path')
    await expect(tools[0].execute('call-2', { file: '/etc/passwd' })).rejects.toThrow('Invalid vault file path')
  })

  it('reports a clear error for a file that does not exist', async () => {
    vi.stubEnv('MAERWEN_VAULT_KEY', KEY_HEX)
    vi.stubEnv('MAERWEN_VAULT_ROOT', vaultRoot())
    const factory = await loadVaultExtension()
    const { tools, pi } = piHost()
    await factory(pi as unknown as OmpExtensionApi)
    await expect(tools[0].execute('call-1', { file: 'missing.md' })).rejects.toThrow('Vault file not found')
  })

  it('rejects a non-string file parameter even if the tool schema is bypassed', async () => {
    vi.stubEnv('MAERWEN_VAULT_KEY', KEY_HEX)
    vi.stubEnv('MAERWEN_VAULT_ROOT', vaultRoot())
    const factory = await loadVaultExtension()
    const { tools, pi } = piHost()
    await factory(pi as unknown as OmpExtensionApi)
    await expect(tools[0].execute('call-1', { file: 123 as unknown as string })).rejects.toThrow('Invalid vault file path')
  })

  describe('malformed envelopes', () => {
    it('rejects a missing header separator', async () => {
      const root = vaultRoot()
      writeFileSync(join(root, 'SKILL.md.enc'), 'not an envelope at all')
      vi.stubEnv('MAERWEN_VAULT_KEY', KEY_HEX)
      vi.stubEnv('MAERWEN_VAULT_ROOT', root)
      const factory = await loadVaultExtension()
      const { tools, pi } = piHost()
      await factory(pi as unknown as OmpExtensionApi)
      await expect(tools[0].execute('call-1', { file: 'SKILL.md' })).rejects.toThrow('Malformed vault envelope')
    })

    it('rejects an unrecognized magic/version header', async () => {
      const root = vaultRoot()
      writeFileSync(join(root, 'SKILL.md.enc'), 'CC_VAULT_V2\npath:SKILL.md\n\nQQ==\n')
      vi.stubEnv('MAERWEN_VAULT_KEY', KEY_HEX)
      vi.stubEnv('MAERWEN_VAULT_ROOT', root)
      const factory = await loadVaultExtension()
      const { tools, pi } = piHost()
      await factory(pi as unknown as OmpExtensionApi)
      await expect(tools[0].execute('call-1', { file: 'SKILL.md' })).rejects.toThrow('Unsupported vault envelope version')
    })

    it('rejects a header missing the path: line', async () => {
      const root = vaultRoot()
      writeFileSync(join(root, 'SKILL.md.enc'), 'CC_VAULT_V1\nnope:SKILL.md\n\nQQ==\n')
      vi.stubEnv('MAERWEN_VAULT_KEY', KEY_HEX)
      vi.stubEnv('MAERWEN_VAULT_ROOT', root)
      const factory = await loadVaultExtension()
      const { tools, pi } = piHost()
      await factory(pi as unknown as OmpExtensionApi)
      await expect(tools[0].execute('call-1', { file: 'SKILL.md' })).rejects.toThrow('Malformed vault envelope: missing path')
    })

    it('rejects an invalid base64 payload', async () => {
      const root = vaultRoot()
      writeFileSync(join(root, 'SKILL.md.enc'), 'CC_VAULT_V1\npath:SKILL.md\n\nnot-base64!!!\n')
      vi.stubEnv('MAERWEN_VAULT_KEY', KEY_HEX)
      vi.stubEnv('MAERWEN_VAULT_ROOT', root)
      const factory = await loadVaultExtension()
      const { tools, pi } = piHost()
      await factory(pi as unknown as OmpExtensionApi)
      await expect(tools[0].execute('call-1', { file: 'SKILL.md' })).rejects.toThrow('invalid base64 payload')
    })

    it('rejects a payload too short to hold a GCM nonce', async () => {
      const root = vaultRoot()
      // 4 raw bytes, base64-encoded — shorter than the 12-byte nonce alone.
      writeFileSync(join(root, 'SKILL.md.enc'), `CC_VAULT_V1\npath:SKILL.md\n\n${Buffer.from([1, 2, 3, 4]).toString('base64')}\n`)
      vi.stubEnv('MAERWEN_VAULT_KEY', KEY_HEX)
      vi.stubEnv('MAERWEN_VAULT_ROOT', root)
      const factory = await loadVaultExtension()
      const { tools, pi } = piHost()
      await factory(pi as unknown as OmpExtensionApi)
      await expect(tools[0].execute('call-1', { file: 'SKILL.md' })).rejects.toThrow('payload too short')
    })
  })
})
