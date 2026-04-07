// @ts-nocheck
/**
 * Netlify Function — ElevenLabs TTS Proxy
 *
 * Accepts POST { voiceId: string, text: string }
 * Calls ElevenLabs TTS with the server-side ELEVENLABS_API_KEY.
 * Returns { audio: string } — base64-encoded mp3.
 */

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
