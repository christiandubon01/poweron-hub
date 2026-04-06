// @ts-nocheck
/**
 * Netlify Function — Claude API Proxy
 *
 * Accepts POST with { messages, system, max_tokens, model }
 * Forwards to Anthropic API using server-side ANTHROPIC_API_KEY
 * Returns Claude's response JSON
 *
 * This keeps the API key off the client and avoids CORS issues.
 */

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const DEFAULT_MODEL = 'claude-sonnet-4-6'
const DEFAULT_MAX_TOKENS = 1024

exports.handler = async (event: any, _context: any) => {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  }

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' }
  }

  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured on server' }),
    }
  }

  try {
    const body = JSON.parse(event.body || '{}')
    const { messages, system, max_tokens, model, tools } = body

    if (!messages || !Array.isArray(messages)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'messages array is required' }),
      }
    }

    const payload: Record<string, unknown> = {
      model: model || DEFAULT_MODEL,
      max_tokens: max_tokens || DEFAULT_MAX_TOKENS,
      messages,
    }
    if (system) payload.system = system
    if (tools && Array.isArray(tools)) payload.tools = tools

    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(payload),
    })

    const result = await response.json()

    if (!response.ok) {
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({ error: result.error?.message || 'Anthropic API error', detail: result }),
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(result),
    }
  } catch (err: any) {
    const message = err?.message || 'Internal server error'
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: message }),
    }
  }
}
