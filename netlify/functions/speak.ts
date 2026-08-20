// @ts-nocheck
/**
 * Netlify Function — ElevenLabs TTS Proxy
 *
 * Accepts POST { voice_id: string, text: string }
 * Calls ElevenLabs TTS with server-side credential authority:
 *   POWERON_ELEVENLABS_API_KEY (preferred)
 *   → ELEVENLABS_API_KEY (legacy server fallback)
 * Returns { audio: string, contentType: 'audio/mpeg' } — base64-encoded mp3.
 *
 * Browser / VITE_ELEVENLABS_* keys are never used here.
 */

import { createClient } from '@supabase/supabase-js'
import {
  mapElevenLabsUpstreamFailure,
  resolveElevenLabsApiKey,
} from './speakAuthority'

/**
 * SEC1 — Verify the caller's Supabase JWT.
 * Returns the authenticated user, or null if the token is missing/invalid.
 * Mirrors verifyAuthenticatedUser() in city-scraper.ts.
 */
async function verifyAuthenticatedUser(event: any) {
  const authHeader =
    event.headers?.authorization ||
    event.headers?.Authorization ||
    ''
  const token = String(authHeader).replace(/^Bearer\s+/i, '').trim()
  if (!token) return null

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
  const anonKey =
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    ''
  if (!supabaseUrl || !anonKey) return null

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await authClient.auth.getUser(token)
  if (error || !data?.user) return null
  return data.user
}

exports.handler = async (event: any, _context: any) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' }
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  // SEC1: reject unauthenticated callers before any paid ElevenLabs call.
  const user = await verifyAuthenticatedUser(event)
  if (!user) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: 'Authentication required.' }),
    }
  }

  const apiKey = resolveElevenLabsApiKey(process.env)
  const keyMeta = {
    poweron_set: Boolean(String(process.env.POWERON_ELEVENLABS_API_KEY || '').trim()),
    legacy_set: Boolean(String(process.env.ELEVENLABS_API_KEY || '').trim()),
    resolved_sk_shape: apiKey.startsWith('sk_'),
    resolved_len: apiKey.length,
  }
  console.log(
    `[speak] ElevenLabs key meta poweron_set=${keyMeta.poweron_set} legacy_set=${keyMeta.legacy_set} sk_shape=${keyMeta.resolved_sk_shape} len=${keyMeta.resolved_len}`,
  )

  if (!apiKey) {
    console.error('[speak] POWERON_ELEVENLABS_API_KEY / ELEVENLABS_API_KEY not configured')
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'POWERON_ELEVENLABS_API_KEY not configured on server',
        code: 'not_configured',
        key_meta: keyMeta,
      }),
    }
  }

  try {
    const body = JSON.parse(event.body || '{}')
    const { text, voice_id } = body

    if (!voice_id || !text) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'voice_id and text are required' }),
      }
    }

    console.log(`[speak] Synthesising voice=${voice_id} text="${String(text).slice(0, 60)}"`)

    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice_id}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: 1.0 },
      }),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      // Log status only — never echo upstream body to clients (may contain sensitive detail).
      console.error(`[speak] ElevenLabs error ${res.status} (body length=${errText.length})`)
      const mapped = mapElevenLabsUpstreamFailure(res.status, errText)
      return {
        statusCode: mapped.statusCode,
        headers,
        body: JSON.stringify({
          error: mapped.error,
          code: mapped.code,
          // Safe presence metadata only — never the secret.
          key_meta: keyMeta,
        }),
      }
    }

    const arrayBuffer = await res.arrayBuffer()
    const base64 = Buffer.from(arrayBuffer).toString('base64')

    console.log(`[speak] OK — ${arrayBuffer.byteLength} bytes`)

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ audio: base64, contentType: 'audio/mpeg' }),
    }
  } catch (err: any) {
    console.error('[speak] Unexpected error:', err?.message || err)
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({
        error: 'ElevenLabs upstream is unavailable.',
        code: 'upstream_unavailable',
      }),
    }
  }
}
