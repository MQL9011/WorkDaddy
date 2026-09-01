import { describe, expect, it } from 'vitest'
import { parseMcpCommand } from '../../src/hooks/useWorkspaceActions'

describe('OMP MCP slash command routing', () => {
  it('intercepts the remote-auth command', () => {
    expect(parseMcpCommand('/mcp reauth docs', 'omp')).toEqual({ type: 'authenticate', server: 'docs' })
    expect(parseMcpCommand('/mcp reauth', 'omp')).toEqual({ type: 'authenticate' })
  })

  it('blocks unsafe auth targets instead of forwarding them to the harness', () => {
    expect(parseMcpCommand('/mcp reauth ../docs', 'omp')).toEqual({ type: 'authenticate' })
    expect(parseMcpCommand('/mcp reauth __proto__', 'omp')).toEqual({ type: 'authenticate' })
  })

  it('leaves other MCP commands alone', () => {
    expect(parseMcpCommand('/mcp list', 'omp')).toBeUndefined()
    expect(parseMcpCommand('/mcp', 'omp')).toBeUndefined()
  })
})
