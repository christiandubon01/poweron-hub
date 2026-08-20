/**
 * VOICE-1 — Server ElevenLabs authority + speak contract.
 *
 * Proves:
 * 1. POWERON_ELEVENLABS_API_KEY is preferred
 * 2. ELEVENLABS_API_KEY remains legacy server fallback
 * 3. VITE_ELEVENLABS_API_KEY is not used by server Nexus TTS
 * 4. Missing server credential fails truthfully
 * 5. Invalid credential fails truthfully
 * 6. Caller voice_id reaches ElevenLabs TTS endpoint (client → speak body)
 * 7. JWT / authenticated speak contract remains intact
 * 8. Successful ElevenLabs response returns audio
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  mapElevenLabsUpstreamFailure,
  resolveElevenLabsApiKey,
} from '../../netlify/functions/speakAuthority'

const root = resolve(__dirname, '../..')
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8')

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      refreshSession: vi.fn(),
    },
  },
}))

import { supabase } from '@/lib/supabase'
import { synthesizeWithElevenLabs } from '@/api/voice/elevenLabs'

describe('VOICE-1 — resolveElevenLabsApiKey authority', () => {
  it('1. prefers POWERON_ELEVENLABS_API_KEY over ELEVENLABS_API_KEY', () => {
    expect(
      resolveElevenLabsApiKey({
        POWERON_ELEVENLABS_API_KEY: 'poweron-secret',
        ELEVENLABS_API_KEY: 'legacy-secret',
        VITE_ELEVENLABS_API_KEY: 'vite-should-never-win',
      }),
    ).toBe('poweron-secret')
  })

  it('2. falls back to ELEVENLABS_API_KEY when POWERON unset', () => {
    expect(
      resolveElevenLabsApiKey({
        ELEVENLABS_API_KEY: 'legacy-secret',
        VITE_ELEVENLABS_API_KEY: 'vite-should-never-win',
      }),
    ).toBe('legacy-secret')
  })

  it('3. ignores VITE_ELEVENLABS_API_KEY entirely', () => {
    expect(
      resolveElevenLabsApiKey({
        VITE_ELEVENLABS_API_KEY: 'vite-only',
        VITE_ELEVEN_LABS_API_KEY: 'vite-alias',
      }),
    ).toBe('')
  })

  it('4. missing server credential resolves empty (speak maps to not_configured)', () => {
    expect(resolveElevenLabsApiKey({})).toBe('')
  })
})

describe('VOICE-1 — speak.ts source contracts', () => {
  const speak = read('netlify/functions/speak.ts')
  const example = read('.env.local.example')

  it('uses resolveElevenLabsApiKey and never falls back to VITE_* server-side', () => {
    expect(speak).toContain("from './speakAuthority'")
    expect(speak).toContain('resolveElevenLabsApiKey(process.env)')
    expect(speak).not.toMatch(/process\.env\.VITE_ELEVENLABS_API_KEY/)
    expect(speak).not.toMatch(/process\.env\.VITE_ELEVEN_LABS_API_KEY/)
  })

  it('4. missing credential returns truthful not_configured message', () => {
    expect(speak).toContain('POWERON_ELEVENLABS_API_KEY not configured on server')
    expect(speak).toContain("code: 'not_configured'")
  })

  it('5. invalid credential mapping is wired (no raw upstream body to client)', () => {
    expect(speak).toContain('mapElevenLabsUpstreamFailure')
    expect(speak).not.toMatch(/JSON\.stringify\(\{\s*error:\s*errText/)
  })

  it('7. JWT auth gate remains before ElevenLabs call', () => {
    expect(speak).toContain('verifyAuthenticatedUser')
    expect(speak).toContain('Authentication required.')
    const authIdx = speak.indexOf('const user = await verifyAuthenticatedUser(event)')
    const keyIdx = speak.indexOf('resolveElevenLabsApiKey(process.env)')
    const fetchIdx = speak.indexOf('api.elevenlabs.io/v1/text-to-speech')
    expect(authIdx).toBeGreaterThan(-1)
    expect(keyIdx).toBeGreaterThan(authIdx)
    expect(fetchIdx).toBeGreaterThan(keyIdx)
  })

  it('documents POWERON_ELEVENLABS_API_KEY empty in .env.local.example', () => {
    expect(example).toMatch(/POWERON_ELEVENLABS_API_KEY=\s*$/m)
    expect(example).toMatch(/SERVER-SIDE ONLY/i)
    expect(example).not.toMatch(/POWERON_ELEVENLABS_API_KEY=sk_/)
    expect(example).not.toMatch(/POWERON_ELEVENLABS_API_KEY=your-elevenlabs/)
  })
})

describe('VOICE-1 — mapElevenLabsUpstreamFailure', () => {
  it('5. invalid_api_key → invalid_credential', () => {
    const mapped = mapElevenLabsUpstreamFailure(
      401,
      JSON.stringify({ detail: { status: 'invalid_api_key' } }),
    )
    expect(mapped.code).toBe('invalid_credential')
    expect(mapped.error).toMatch(/rejected the server credential/i)
    expect(mapped.error).not.toMatch(/sk_|xi-api-key|invalid_api_key/i)
  })

  it('maps bad voice distinctly', () => {
    const mapped = mapElevenLabsUpstreamFailure(404, 'voice_not_found')
    expect(mapped.code).toBe('bad_voice')
    expect(mapped.statusCode).toBe(400)
  })

  it('maps upstream unavailability', () => {
    const mapped = mapElevenLabsUpstreamFailure(503, 'overload')
    expect(mapped.code).toBe('upstream_unavailable')
    expect(mapped.statusCode).toBe(502)
  })
})

describe('VOICE-1 — client Nexus TTS routes through speak (JWT + voice_id + audio)', () => {
  beforeEach(() => {
    vi.mocked(supabase.auth.getSession).mockReset()
    vi.mocked(supabase.auth.refreshSession).mockReset()
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: {
        session: {
          access_token: 'valid-jwt-token',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        },
      },
      error: null,
    } as any)
    vi.mocked(supabase.auth.refreshSession).mockResolvedValue({
      data: { session: null },
      error: null,
    } as any)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('6+7+8. posts authed speak with voice_id and returns non-empty audio', async () => {
    const audioBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
    const base64 = Buffer.from(audioBytes).toString('base64')
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ audio: base64, contentType: 'audio/mpeg' }),
      text: async () => '',
    })
    vi.stubGlobal('fetch', fetchSpy)

    const result = await synthesizeWithElevenLabs({
      text: 'PowerOn voice test.',
      voice_id: 'gOkFV1JMCt0G0n9xmBwV',
    })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('/.netlify/functions/speak')
    expect(init.method).toBe('POST')
    expect(String(init.headers.Authorization || '')).toBe('Bearer valid-jwt-token')
    const body = JSON.parse(init.body)
    expect(body.voice_id).toBe('gOkFV1JMCt0G0n9xmBwV')
    expect(body.text).toBe('PowerOn voice test.')
    expect(result.audioBlob.size).toBeGreaterThan(0)
    expect(result.charactersProcessed).toBeGreaterThan(0)
  })

  it('main path does not call api.elevenlabs.io from the browser', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        audio: Buffer.from([9, 9, 9]).toString('base64'),
        contentType: 'audio/mpeg',
      }),
    })
    vi.stubGlobal('fetch', fetchSpy)

    await synthesizeWithElevenLabs({
      text: 'hi',
      voice_id: 'gOkFV1JMCt0G0n9xmBwV',
    })

    const urls = fetchSpy.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(urls.every((u: string) => u.includes('/.netlify/functions/speak'))).toBe(true)
    expect(urls.some((u: string) => u.includes('api.elevenlabs.io'))).toBe(false)
  })

  it('main Nexus voice service still routes TTS through synthesizeWithElevenLabs', () => {
    const voice = read('src/services/voice.ts')
    expect(voice).toContain('synthesizeWithElevenLabs')
    expect(voice).not.toContain('streamSynthesis')
    expect(voice).not.toContain('api.elevenlabs.io')
  })
})
