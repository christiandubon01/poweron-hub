// @ts-nocheck
/**
 * Netlify Function — OpenAI Embedding Proxy
 * Accepts POST with { input, model? }
 * Forwards to OpenAI Embeddings API using server-side OPENAI_API_KEY
 * Returns embedding vector JSON
 */

const OPENAI_API_URL = 'https://api.openai.com/v1/embeddings'
const DEFAULT_MODEL = 'text-embedding-3-small'

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
  if (!apiKey || apiKey.trim() === '') {
    console.error('[embed] OPENAI_API_KEY is not set or empty in Netlify environment variables.')
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({
        error: 'OPENAI_API_KEY is not configured on the server. Set it in Netlify → Site settings → Environment variables.',
      }),
    }
  }

  try {
    const body = JSON.parse(event.body || '{}')
    const { input, model } = body

    if (!input) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'input is required' }) }
    }

    const response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model || DEFAULT_MODEL,
        input: typeof input === 'string' ? input.slice(0, 8000) : input,
      }),
    })

    const result = await response.json()

    if (!response.ok) {
      return { statusCode: response.status, headers, body: JSON.stringify({ error: result.error?.message || 'OpenAI API error', detail: result }) }
    }

    return { statusCode: 200, headers, body: JSON.stringify(result) }
  } catch (err: any) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err?.message || 'Internal server error' }) }
  }
}
