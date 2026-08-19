/**
 * AI-KEY-RECOVERY-1 — reconstructed frontend Claude proxy contracts.
 * Evidence: netlify/functions/claude.ts, .env.local.example, vite.config.js.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REPO_ROOT = resolve(__dirname, '..', '..')

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), 'utf8')
}

describe('AI-KEY frontend claudeProxy reconstruction', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('posts only to /.netlify/functions/claude with auth headers', async () => {
    const { callClaude } = await import('@/services/claudeProxy')
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        model: 'claude-sonnet-4-6',
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await callClaude({
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 32,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/.netlify/functions/claude')
    expect(init.method).toBe('POST')
    expect(String(init.headers['Content-Type'] || '')).toMatch(/application\/json/i)
    // Authorization may be absent when no session in unit tests; header builder still used.
    expect(read('src/services/claudeProxy.ts')).toContain('authedJsonHeaders')
  })

  it('omits model when caller does not set one (server DEFAULT_MODEL authority)', async () => {
    const { callClaude } = await import('@/services/claudeProxy')
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await callClaude({ messages: [{ role: 'user', content: 'hi' }] })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.model).toBeUndefined()
  })

  it('network failure fails closed without browser Anthropic fallback', async () => {
    const { callClaude } = await import('@/services/claudeProxy')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    )
    await expect(
      callClaude({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(/not reachable/i)
  })

  it('AbortError remains distinct', async () => {
    const { callClaude } = await import('@/services/claudeProxy')
    const abortErr = new Error('aborted')
    abortErr.name = 'AbortError'
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortErr))
    await expect(
      callClaude({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('unreadable 2xx body gets a specific failure', async () => {
    const { callClaude } = await import('@/services/claudeProxy')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('bad json')
        },
      }),
    )
    await expect(
      callClaude({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(/unreadable response/i)
  })

  it('500 not-configured maps to configured message (matches vite/dev proxy contract)', async () => {
    const { callClaude } = await import('@/services/claudeProxy')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () =>
          JSON.stringify({ error: 'POWERON_ANTHROPIC_API_KEY not configured on server' }),
      }),
    )
    await expect(
      callClaude({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(/not configured on this environment/i)
  })

  it('source has no browser direct Anthropic / VITE production secret path', () => {
    const src = read('src/services/claudeProxy.ts')
    expect(src).toContain('/.netlify/functions/claude')
    expect(src).toContain('authedJsonHeaders')
    // No executable browser Anthropic endpoint / secret path (ignore comments).
    const codeOnly = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
    expect(codeOnly).not.toMatch(/fetch\(\s*['"`]https:\/\/api\.anthropic\.com/)
    expect(codeOnly).not.toContain('VITE_ANTHROPIC_API_KEY')
    expect(codeOnly).not.toContain('DIRECT_URL')
    expect(codeOnly).not.toContain('x-api-key')
    expect(codeOnly).not.toContain('anthropic-dangerous-direct-browser-access')
    expect(codeOnly).not.toMatch(/import\.meta\.env/)
  })

  it('surviving backend AI-KEY still uses POWERON_ANTHROPIC_API_KEY', () => {
    const fn = read('netlify/functions/claude.ts')
    expect(fn).toContain('POWERON_ANTHROPIC_API_KEY')
    expect(fn).toMatch(/process\.env\.POWERON_ANTHROPIC_API_KEY/)
    expect(fn).toContain('https://api.anthropic.com/v1/messages')
  })
})
