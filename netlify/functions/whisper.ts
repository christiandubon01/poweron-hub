// @ts-nocheck
/**
 * Netlify Function — Whisper API Proxy
 *
 * Accepts POST with JSON body containing base64-encoded audio.
 * Forwards to OpenAI Whisper API using server-side POWERON_OPENAI_API_KEY
 * (with OPENAI_API_KEY as production fallback).
 * Returns the transcription JSON.
 *
 * Uses Node built-in https module (not fetch) for maximum compatibility
 * with Netlify's Node 18 runtime.
 *
 * AI-KEY / Whisper key authority (same class as POWERON_ANTHROPIC_API_KEY):
 * Under `netlify dev`, Netlify's AI Gateway may inject its own OPENAI_API_KEY
 * that is NOT valid against https://api.openai.com. Using that key yields
 * OpenAI 401 invalid_issuer. PowerOn's direct OpenAI credential lives in
 * POWERON_OPENAI_API_KEY. Prefer that name; fall back to OPENAI_API_KEY only
 * when POWERON_ is unset (production sites that already set OPENAI_API_KEY).
 */

import { createClient } from '@supabase/supabase-js'

const https = require('https')

const WHISPER_HOST = 'api.openai.com'
const WHISPER_PATH = '/v1/audio/transcriptions'

function resolveOpenAiApiKey(): string {
  return (
    process.env.POWERON_OPENAI_API_KEY ||
    process.env.OPENAI_API_KEY ||
    ''
  )
}

// Log key presence on cold start (never log full key)
const _key = resolveOpenAiApiKey()
console.log(
  `[whisper-proxy] Cold start. OPENAI key present: ${!!_key}, via_POWERON: ${!!process.env.POWERON_OPENAI_API_KEY}, prefix: ${_key.slice(0, 8)}...`,
)

/**
 * SEC2 — Verify the caller's Supabase JWT.
 * Returns the authenticated user, or null if the token is missing/invalid.
 * Mirrors verifyAuthenticatedUser() in speak.ts (SEC1).
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

  // SEC2: reject unauthenticated callers before any paid OpenAI call.
  const user = await verifyAuthenticatedUser(event)
  if (!user) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: 'Authentication required.' }),
    }
  }

  const apiKey = resolveOpenAiApiKey()
  if (!apiKey) {
    console.error('[whisper-proxy] POWERON_OPENAI_API_KEY / OPENAI_API_KEY is undefined')
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'OPENAI_API_KEY not configured on server' }),
    }
  }

  try {
    // ── Parse client JSON body ──────────────────────────────────────────────
    const body = JSON.parse(event.body || '{}')
    const { audio, filename, language, temperature, prompt } = body

    if (!audio) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'audio (base64) is required' }),
      }
    }

    console.log(`[whisper-proxy] Received audio: ${audio.length} base64 chars, filename=${filename || 'recording.webm'}`)

    // ── Convert base64 → Buffer ─────────────────────────────────────────────
    const binaryAudio = Buffer.from(audio, 'base64')
    console.log(`[whisper-proxy] Decoded audio buffer: ${binaryAudio.length} bytes`)

    // ── Build multipart/form-data ───────────────────────────────────────────
    const boundary = '----WhisperProxy' + Date.now()
    const CRLF = '\r\n'

    // B57-hotfix: use response_format=text — returns plain string, fastest Whisper response.
    // Removed verbose_json + timestamp_granularities to eliminate segment-parsing overhead.
    const fieldParts: Array<{ name: string; value: string }> = [
      { name: 'model', value: 'whisper-1' },
      { name: 'response_format', value: 'text' },
    ]
    // B60 FIX 3: Always lock to English regardless of client value
    fieldParts.push({ name: 'language', value: 'en' })
    if (temperature !== undefined) fieldParts.push({ name: 'temperature', value: String(temperature) })
    // B60 FIX 4: Always send domain hint so Whisper has context; client prompt takes precedence if richer
    fieldParts.push({ name: 'prompt', value: prompt || 'PowerOn electrical contractor business operations' })

    // Assemble all parts into a single Buffer
    const buffers: Buffer[] = []

    // File part
    buffers.push(Buffer.from(
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="file"; filename="${filename || 'recording.webm'}"${CRLF}` +
      `Content-Type: audio/webm${CRLF}${CRLF}`
    ))
    buffers.push(binaryAudio)
    buffers.push(Buffer.from(CRLF))

    // Text field parts
    for (const field of fieldParts) {
      buffers.push(Buffer.from(
        `--${boundary}${CRLF}` +
        `Content-Disposition: form-data; name="${field.name}"${CRLF}${CRLF}` +
        `${field.value}${CRLF}`
      ))
    }

    // Closing boundary
    buffers.push(Buffer.from(`--${boundary}--${CRLF}`))

    const multipartBody = Buffer.concat(buffers)
    console.log(`[whisper-proxy] Multipart body size: ${multipartBody.length} bytes`)

    // ── Send to OpenAI via Node https ───────────────────────────────────────
    const openaiResult = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
      const req = https.request(
        {
          hostname: WHISPER_HOST,
          path: WHISPER_PATH,
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': multipartBody.length,
          },
        },
        (res: any) => {
          const chunks: Buffer[] = []
          res.on('data', (chunk: Buffer) => chunks.push(chunk))
          res.on('end', () => {
            resolve({
              statusCode: res.statusCode,
              body: Buffer.concat(chunks).toString('utf-8'),
            })
          })
        }
      )

      req.on('error', (err: Error) => reject(err))
      req.write(multipartBody)
      req.end()
    })

    console.log(`[whisper-proxy] OpenAI returned status ${openaiResult.statusCode}`)

    // ── Parse & return ──────────────────────────────────────────────────────
    // B57-hotfix: response_format=text returns a plain string (not JSON).
    // Wrap it as { text, language, duration } so the client parseWhisperResponse works unchanged.
    if (openaiResult.statusCode !== 200) {
      let errDetail: any = {}
      try { errDetail = JSON.parse(openaiResult.body) } catch { /* body may not be JSON */ }
      console.error(`[whisper-proxy] OpenAI error ${openaiResult.statusCode}:`, openaiResult.body.slice(0, 500))
      return {
        statusCode: openaiResult.statusCode,
        headers,
        body: JSON.stringify({
          error: errDetail?.error?.message || 'Whisper API error',
          detail: errDetail,
        }),
      }
    }

    const transcribedText = openaiResult.body.trim()
    console.log(`[whisper-proxy] Transcribed: "${transcribedText.slice(0, 80)}"`)

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ text: transcribedText, language: language || 'en', duration: 0 }),
    }
  } catch (err: any) {
    console.error(`[whisper-proxy] Unhandled error: ${err?.message}`, err?.stack)
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: err?.message || 'Internal server error',
        stack: err?.stack || 'no stack',
      }),
    }
  }
}
