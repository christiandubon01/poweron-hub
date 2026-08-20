/**
 * COACH-LINK-4B1D — Desktop Whisper auth / Live Call error visibility.
 *
 * Proves:
 * 1. Valid Supabase JWT → Bearer on Whisper / authed headers
 * 2. Missing JWT → truthful auth error (not generic transcription failure)
 * 3. Non-empty desktop blob still reaches transcribeWithWhisper
 * 4. iPad-compatible MIME picker preserved
 * 5. Live Call maps auth vs empty vs generic distinctly
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
import { authedJsonHeaders, getAuthToken } from '@/services/authedFetch'
import * as whisper from '@/api/voice/whisper'
import {
  mapLiveCallMicError,
  MIC_AUTH_FALLBACK,
  MIC_EMPTY_RECORDING_FALLBACK,
  MIC_VERIFY_FALLBACK,
  MIC_WHISPER_FALLBACK,
  pickSupportedRecorderMimeType,
  transcribeLiveCallMicBlob,
} from '@/services/salesIntel/liveCallMicAssist'

describe('COACH-LINK-4B1D — authedFetch JWT refresh', () => {
  beforeEach(() => {
    vi.mocked(supabase.auth.getSession).mockReset()
    vi.mocked(supabase.auth.refreshSession).mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('1. valid access_token → Authorization Bearer header', async () => {
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

    const headers = await authedJsonHeaders()
    expect(headers.Authorization).toBe('Bearer valid-jwt-token')
    expect(supabase.auth.refreshSession).not.toHaveBeenCalled()
  })

  it('1b. near-expiry token → refreshSession then Bearer', async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: {
        session: {
          access_token: 'stale-jwt',
          expires_at: Math.floor(Date.now() / 1000) + 10,
        },
      },
      error: null,
    } as any)
    vi.mocked(supabase.auth.refreshSession).mockResolvedValue({
      data: {
        session: {
          access_token: 'refreshed-jwt',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        },
      },
      error: null,
    } as any)

    const token = await getAuthToken()
    expect(token).toBe('refreshed-jwt')
    expect(supabase.auth.refreshSession).toHaveBeenCalledTimes(1)
  })

  it('2. missing JWT → no Authorization header', async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: null },
      error: null,
    } as any)
    vi.mocked(supabase.auth.refreshSession).mockResolvedValue({
      data: { session: null },
      error: { message: 'no session' },
    } as any)

    const headers = await authedJsonHeaders()
    expect(headers.Authorization).toBeUndefined()
    expect(headers['Content-Type']).toBe('application/json')
  })
})

describe('COACH-LINK-4B1D — Whisper + Live Call auth errors', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('2. missing JWT → signed-in error, not generic Whisper outage', async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: null },
      error: null,
    } as any)
    vi.mocked(supabase.auth.refreshSession).mockResolvedValue({
      data: { session: null },
      error: null,
    } as any)

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Authentication required.' }),
    })
    vi.stubGlobal('fetch', fetchSpy)

    await expect(
      whisper.transcribeWithWhisper(
        new Blob(['x'], { type: 'audio/webm' }),
        { language: 'en' },
      ),
    ).rejects.toThrow(/signed in/i)

    expect(fetchSpy).toHaveBeenCalled()
    const [, init] = fetchSpy.mock.calls[0]
    expect(init.headers.Authorization).toBeUndefined()
  })

  it('2b. mapLiveCallMicError maps signed-in → MIC_AUTH_FALLBACK', () => {
    expect(
      mapLiveCallMicError(
        new Error(
          'Transcription requires you to be signed in. Please sign in and try again.',
        ),
      ),
    ).toBe(MIC_AUTH_FALLBACK)
    expect(MIC_AUTH_FALLBACK).toMatch(/Sign in again/i)
    expect(MIC_AUTH_FALLBACK).not.toBe(MIC_WHISPER_FALLBACK)
  })

  it('2b2. invalid_issuer / verify failure → MIC_VERIFY_FALLBACK (not session expired)', () => {
    expect(
      mapLiveCallMicError(
        new Error('Transcription authentication could not be verified.'),
      ),
    ).toBe(MIC_VERIFY_FALLBACK)
    expect(MIC_VERIFY_FALLBACK).not.toMatch(/session expired/i)
    expect(
      mapLiveCallMicError(
        new Error('Your authentication token is not from a valid issuer.'),
      ),
    ).toBe(MIC_VERIFY_FALLBACK)
  })

  it('2c. empty recording vs generic Whisper errors stay distinct', () => {
    expect(MIC_EMPTY_RECORDING_FALLBACK).toMatch(/No audio captured/i)
    expect(MIC_EMPTY_RECORDING_FALLBACK).not.toBe(MIC_WHISPER_FALLBACK)
    expect(mapLiveCallMicError(new Error('network boom'))).toBe(
      MIC_WHISPER_FALLBACK,
    )
  })

  it('2d. OpenAI invalid_issuer 401 is not treated as missing Supabase JWT', async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: {
        session: {
          access_token: 'valid-jwt-token',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        },
      },
      error: null,
    } as any)

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({
        error: 'Your authentication token is not from a valid issuer.',
        detail: {
          error: {
            message: 'Your authentication token is not from a valid issuer.',
            type: 'invalid_request_error',
            code: 'invalid_issuer',
            param: null,
          },
          status: 401,
        },
      }),
    })
    vi.stubGlobal('fetch', fetchSpy)

    await expect(
      whisper.transcribeWithWhisper(
        new Blob(['x'], { type: 'audio/webm' }),
        { language: 'en' },
      ),
    ).rejects.toThrow(/could not be verified/i)
  })

  it('3. non-empty desktop blob still reaches transcribeWithWhisper', async () => {
    const spy = vi
      .spyOn(whisper, 'transcribeWithWhisper')
      .mockResolvedValue({
        text: 'desktop transcript',
        language: 'en',
        duration: 1,
      })

    const blob = new Blob(['desktop-audio'], { type: 'audio/webm' })
    const text = await transcribeLiveCallMicBlob(blob)

    expect(text).toBe('desktop transcript')
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0]).toBe(blob)
  })

  it('1c. valid JWT → Whisper request includes Bearer token', async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: {
        session: {
          access_token: 'valid-jwt-token',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        },
      },
      error: null,
    } as any)

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: 'ok', language: 'en', duration: 1 }),
    })
    vi.stubGlobal('fetch', fetchSpy)

    await whisper.transcribeWithWhisper(
      new Blob(['x'], { type: 'audio/webm' }),
      { language: 'en' },
    )

    expect(fetchSpy.mock.calls[0][0]).toBe('/.netlify/functions/whisper')
    expect(fetchSpy.mock.calls[0][1].headers.Authorization).toBe(
      'Bearer valid-jwt-token',
    )
  })

  it('4. iPad-compatible MIME preference preserved', () => {
    const picked = pickSupportedRecorderMimeType((type) =>
      type === 'audio/mp4' || type === 'audio/webm;codecs=opus',
    )
    expect(picked).toBe('audio/webm;codecs=opus')

    const safariLike = pickSupportedRecorderMimeType(
      (type) => type === 'audio/mp4',
    )
    expect(safariLike).toBe('audio/mp4')
  })

  it('panel wires mapLiveCallMicError + empty-recording copy', () => {
    const panel = read(
      'src/components/salesIntel/liveCall/LiveCallAssistPanel.tsx',
    )
    expect(panel).toContain('mapLiveCallMicError')
    expect(panel).toContain('MIC_EMPTY_RECORDING_FALLBACK')
    expect(panel).not.toMatch(/catch\s*\{\s*disposeMicSession\(\)\s*;\s*setMicError\(MIC_WHISPER_FALLBACK\)/)
  })

  it('authedFetch refreshes near-expiry tokens (source contract)', () => {
    const src = read('src/services/authedFetch.ts')
    expect(src).toContain('refreshSession')
    expect(src).toContain('getSession')
    expect(src).not.toContain('authStore')
    expect(src).not.toContain('SERVICE_ROLE')
  })
})
