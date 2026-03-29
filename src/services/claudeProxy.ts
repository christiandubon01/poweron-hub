// @ts-nocheck
/**
 * Claude API Proxy Client
 *
 * All Claude calls go through /.netlify/functions/claude (server-side proxy).
 * Falls back to direct API call with VITE_ANTHROPIC_API_KEY if proxy unavailable.
 * This centralizes all Anthropic API access in the app.
 */

const PROXY_URL = '/.netlify/functions/claude'
const DIRECT_URL = 'https://api.anthropic.com/v1/messages'
const DEFAULT_MODEL = 'claude-sonnet-4-20250514'

export interface ClaudeRequest {
  messages: Array<{ role: 'user' | 'assistant'; content: string | any[] }>
  system?: string
  max_tokens?: number
  model?: string
  signal?: AbortSignal
  tools?: Array<{ type: string; name: string; [key: string]: unknown }>
}

export interface ClaudeResponse {
  content: Array<{ type: string; text: string }>
  model: string
  usage: { input_tokens: number; output_tokens: number }
}

/**
 * Call Claude via Netlify proxy (preferred) or direct API (fallback).
 */
export async function callClaude(req: ClaudeRequest): Promise<ClaudeResponse> {
  const { messages, system, max_tokens = 1024, model = DEFAULT_MODEL, signal, tools } = req

  // Try proxy first
  try {
    const proxyPayload: Record<string, unknown> = { messages, system, max_tokens, model }
    if (tools && tools.length > 0) proxyPayload.tools = tools

    const response = await fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(proxyPayload),
      signal,
    })

    if (response.ok) {
      console.log('[Claude] Response via proxy')
      return await response.json()
    }

    // If proxy returns 500 with "not configured", fall through to direct
    const errBody = await response.text()
    if (response.status === 500 && errBody.includes('not configured')) {
      console.warn('[Claude] Proxy key not configured, trying direct...')
    } else {
      throw new Error(`Proxy error (${response.status}): ${errBody.slice(0, 200)}`)
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw err
    // Proxy unreachable (e.g. local dev) — fall through to direct
    console.warn('[Claude] Proxy unavailable, trying direct API:', err instanceof Error ? err.message : err)
  }

  // Fallback: direct API call with VITE_ key
  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('No API key available — configure ANTHROPIC_API_KEY on Netlify or VITE_ANTHROPIC_API_KEY locally')
  }

  const response = await fetch(DIRECT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({ model, max_tokens, messages, ...(system ? { system } : {}), ...(tools?.length ? { tools } : {}) }),
    signal,
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`Claude API error (${response.status}): ${errText.slice(0, 200)}`)
  }

  console.log('[Claude] Response via direct API')
  return await response.json()
}

/**
 * Helper: extract text from Claude response
 */
export function extractText(response: ClaudeResponse): string {
  return response.content?.find(c => c.type === 'text')?.text || ''
}
