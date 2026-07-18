// @ts-nocheck
/**
 * netlify/functions/whisper-proxy.ts — OpenAI Whisper API Proxy
 *
 * Accepts POST with JSON body containing base64-encoded audio.
 * Forwards to OpenAI Whisper API using server-side OPENAI_API_KEY.
 * Returns transcription text.
 *
 * Used by SPARK Live Call engine for chunked audio transcription
 * with support for field conditions (noisy job sites).
 *
 * Error handling:
 *  - Network errors logged, graceful degradation
 *  - Invalid audio blob → 400 error
 *  - Missing API key → 500 error
 *  - OpenAI errors → pass through
 */

import { createClient } from '@supabase/supabase-js'

const https = require('https')

const WHISPER_HOST = 'api.openai.com'
const WHISPER_PATH = '/v1/audio/transcriptions'

const _key = process.env.OPENAI_API_KEY || ''
console.log(`[whisper-proxy] Cold start. OPENAI_API_KEY present: ${!!_key}`)

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

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' }
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    }
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

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    console.error('[whisper-proxy] OPENAI_API_KEY is undefined')
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'OPENAI_API_KEY not configured' }),
    }
  }

  try {
    const body = JSON.parse(event.body || '{}')
    const { audio, filename, language = 'en', temperature, prompt } = body

    if (!audio) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'audio (base64) is required' }),
      }
    }

    console.log(`[whisper-proxy] Received audio: ${audio.length} base64 chars`)

    // Convert base64 to Buffer
    const binaryAudio = Buffer.from(audio, 'base64')
    console.log(`[whisper-proxy] Decoded buffer: ${binaryAudio.length} bytes`)

    // Build multipart form data
    const boundary = '----WhisperProxy' + Date.now()
    const CRLF = '\r\n'

    const fieldParts = [
      { name: 'model', value: 'whisper-1' },
      { name: 'response_format', value: 'text' },
      { name: 'language', value: 'en' }, // Always English per spec
    ]

    if (temperature !== undefined) {
      fieldParts.push({ name: 'temperature', value: String(temperature) })
    }

    // Domain hint helps Whisper with electrical contractor terminology
    fieldParts.push({
      name: 'prompt',
      value: prompt || 'PowerOn electrical contractor business operations field call',
    })

    // Assemble multipart body
    const buffers: Buffer[] = []

    // File part
    buffers.push(
      Buffer.from(
        `--${boundary}${CRLF}` +
          `Content-Disposition: form-data; name="file"; filename="${filename || 'recording.webm'}"${CRLF}` +
          `Content-Type: audio/webm${CRLF}${CRLF}`
      )
    )
    buffers.push(binaryAudio)
    buffers.push(Buffer.from(CRLF))

    // Text fields
    for (const field of fieldParts) {
      buffers.push(
        Buffer.from(
          `--${boundary}${CRLF}` + `Content-Disposition: form-data; name="${field.name}"${CRLF}${CRLF}` + `${field.value}${CRLF}`
        )
      )
    }

    // Closing boundary
    buffers.push(Buffer.from(`--${boundary}--${CRLF}`))

    const multipartBody = Buffer.concat(buffers)

    // Forward to OpenAI
    const openaiResult = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
      const req = https.request(
        {
          hostname: WHISPER_HOST,
          path: WHISPER_PATH,
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
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

    console.log(`[whisper-proxy] OpenAI returned: ${openaiResult.statusCode}`)

    if (openaiResult.statusCode !== 200) {
      let errDetail: any = {}
      try {
        errDetail = JSON.parse(openaiResult.body)
      } catch {
        /* body may not be JSON */
      }
      console.error(`[whisper-proxy] OpenAI error:`, openaiResult.body.slice(0, 200))
      return {
        statusCode: openaiResult.statusCode,
        headers,
        body: JSON.stringify({
          error: errDetail?.error?.message || 'Whisper API error',
        }),
      }
    }

    const transcribedText = openaiResult.body.trim()
    console.log(`[whisper-proxy] Transcribed: "${transcribedText.slice(0, 80)}"`)

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        text: transcribedText,
        language: language || 'en',
        duration: 0,
      }),
    }
  } catch (err: any) {
    console.error(`[whisper-proxy] Error: ${err?.message}`)
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: err?.message || 'Internal server error',
      }),
    }
  }
}
