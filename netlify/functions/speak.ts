// @ts-nocheck
/**
 * Netlify Function — ElevenLabs TTS Proxy
 *
 * Accepts POST { voiceId: string, text: string }
 * Calls ElevenLabs TTS with the server-side ELEVENLABS_API_KEY.
 * Returns { audio: string } — base64-encoded mp3.
 */

import { createClient } from '@supabase/supabase-js'

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

  const apiKey =
    process.env.ELEVENLABS_API_KEY ||
    process.env.VITE_ELEVENLABS_API_KEY ||
    process.env.VITE_ELEVEN_LABS_API_KEY

  if (!apiKey) {
    console.error('[speak] No ElevenLabs API key found')
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'ELEVENLABS_API_KEY not configured on server' }),
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

    console.log(`[speak] Synthesising voice=${voice_id} text="${text.slice(0, 60)}"`)

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
      const errText = await res.text()
      console.error(`[speak] ElevenLabs error ${res.status}:`, errText)
      return {
        statusCode: res.status,
        headers,
        body: JSON.stringify({ error: errText }),
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
    console.error('[speak] Unexpected error:', err)
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message || 'Unexpected error' }),
    }
  }
}
