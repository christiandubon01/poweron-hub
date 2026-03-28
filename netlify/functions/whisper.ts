// @ts-nocheck
/**
 * Netlify Function — Whisper API Proxy
 *
 * Accepts POST with multipart/form-data containing an audio file.
 * Forwards to OpenAI Whisper API using server-side OPENAI_API_KEY.
 * Returns the transcription JSON.
 *
 * This keeps the API key off the client and avoids CORS issues.
 */

const WHISPER_API_URL = 'https://api.openai.com/v1/audio/transcriptions'

exports.handler = async (event: any, _context: any) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' }
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'OPENAI_API_KEY not configured on server' }),
    }
  }

  try {
    // Parse the JSON body sent from the client
    // Client sends: { audio: base64string, filename: string, language: string, ... }
    const body = JSON.parse(event.body || '{}')
    const { audio, filename, language, temperature, prompt } = body

    if (!audio) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'audio (base64) is required' }),
      }
    }

    // Convert base64 back to binary
    const binaryAudio = Buffer.from(audio, 'base64')

    // Build multipart form data manually for the OpenAI API
    const boundary = '----NetlifyWhisperBoundary' + Date.now()

    const parts: Buffer[] = []

    // File part
    const fileHeader = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename || 'recording.webm'}"\r\nContent-Type: application/octet-stream\r\n\r\n`
    parts.push(Buffer.from(fileHeader))
    parts.push(binaryAudio)
    parts.push(Buffer.from('\r\n'))

    // Model part
    const modelPart = `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n`
    parts.push(Buffer.from(modelPart))

    // Language part
    if (language) {
      const langPart = `--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\n${language}\r\n`
      parts.push(Buffer.from(langPart))
    }

    // Response format
    const fmtPart = `--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\nverbose_json\r\n`
    parts.push(Buffer.from(fmtPart))

    // Timestamp granularities
    const tsPart = `--${boundary}\r\nContent-Disposition: form-data; name="timestamp_granularities[]"\r\n\r\nsegment\r\n`
    parts.push(Buffer.from(tsPart))

    // Temperature
    if (temperature !== undefined) {
      const tempPart = `--${boundary}\r\nContent-Disposition: form-data; name="temperature"\r\n\r\n${temperature}\r\n`
      parts.push(Buffer.from(tempPart))
    }

    // Prompt
    if (prompt) {
      const promptPart = `--${boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\n${prompt}\r\n`
      parts.push(Buffer.from(promptPart))
    }

    // End boundary
    parts.push(Buffer.from(`--${boundary}--\r\n`))

    const multipartBody = Buffer.concat(parts)

    const response = await fetch(WHISPER_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: multipartBody,
    })

    const result = await response.json()

    if (!response.ok) {
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({ error: result.error?.message || 'Whisper API error', detail: result }),
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(result),
    }
  } catch (err: any) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err?.message || 'Internal server error' }),
    }
  }
}
