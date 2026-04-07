// @ts-nocheck
/**
 * Netlify Function — Claude API Proxy
 *
 * Accepts POST with { messages, system, max_tokens, model, stream }
 * Forwards to Anthropic API using server-side ANTHROPIC_API_KEY
 * When stream: true — calls Anthropic streaming API, collects SSE deltas,
 * returns assembled response in the same JSON format as non-streaming.
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
    const { messages, system, max_tokens, model, tools, stream } = body

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

    // ── Streaming path: stream: true collects SSE deltas from Anthropic ──────
    // Enables faster time-to-first-token on Anthropic's side while the
    // Netlify function assembles the complete response before returning.
    if (stream) {
      payload.stream = true
      const streamResponse = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(payload),
      })

      if (!streamResponse.ok) {
        const errText = await streamResponse.text()
        return {
          statusCode: streamResponse.status,
          headers,
          body: JSON.stringify({ error: `Anthropic streaming error ${streamResponse.status}`, detail: errText.slice(0, 500) }),
        }
      }

      // Read SSE stream and collect text deltas
      const reader = streamResponse.body?.getReader()
      if (!reader) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'No stream body' }) }
      }

      const decoder = new TextDecoder()
      let assembled = ''
      let inputTokens = 0
      let outputTokens = 0
      let modelUsed = model || DEFAULT_MODEL
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        // Process complete SSE lines
        const lines = buffer.split('\n')
        buffer = lines.pop() || '' // keep incomplete line for next chunk

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (data === '[DONE]') continue
          try {
            const evt = JSON.parse(data)
            if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
              assembled += evt.delta.text || ''
            }
            if (evt.type === 'message_start' && evt.message) {
              modelUsed = evt.message.model || modelUsed
              inputTokens = evt.message.usage?.input_tokens || 0
            }
            if (evt.type === 'message_delta' && evt.usage) {
              outputTokens = evt.usage.output_tokens || 0
            }
          } catch { /* ignore malformed SSE lines */ }
        }
      }

      // Return in standard Anthropic messages response format
      const result = {
        id: `msg_stream_${Date.now()}`,
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: assembled }],
        model: modelUsed,
        stop_reason: 'end_turn',
        usage: { input_tokens: inputTokens, output_tokens: outputTokens },
        _streamed: true,
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(result),
      }
    }

    // ── Non-streaming path (default) ─────────────────────────────────────────
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
