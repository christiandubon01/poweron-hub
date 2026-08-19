// @ts-nocheck
/**
 * Claude API Proxy Client
 *
 * ALL Claude calls go through /.netlify/functions/claude — the server-side
 * Netlify proxy that holds POWERON_ANTHROPIC_API_KEY (production / netlify
 * dev) or the Vite configureServer Claude path (npm run dev). The browser
 * never reads, stores, or transmits an Anthropic secret: there is no
 * browser-side VITE Anthropic-key path and no direct Anthropic API call
 * from the client.
 *
 * AI-KEY (reconstructed from surviving local WIP):
 * - Backend authority: netlify/functions/claude.ts → POWERON_ANTHROPIC_API_KEY
 * - Local Vite authority: vite.config.js claudeDevProxy → ANTHROPIC_API_KEY
 *   (Node-only; client Vite Anthropic env is forced undefined in the bundle)
 * - Frontend: POST /.netlify/functions/claude with authedJsonHeaders only
 *
 * COACH-LINK-RUNTIME-2: HTTP 2xx proxy responses are returned (or fail clearly).
 * They must never fall through into a generic "temporarily unavailable" path
 * that hides a successful or status-bearing proxy response.
 */

import { authedJsonHeaders } from '@/services/authedFetch'

var PROXY_URL = '/.netlify/functions/claude'

/**
 * Map a non-2xx proxy response to a sanitized browser-facing message.
 * Known classes get stable copy; other statuses keep an explicit Proxy error
 * with the HTTP status so RUNTIME-2 callers are not fed a fake outage.
 */
function sanitizeProxyStatus(status: number, body: string): string {
  if (status === 500 && /not configured/i.test(body)) {
    return 'AI service is not configured on this environment.'
  }
  if (status === 401) {
    return 'AI service is not available. Please try again.'
  }
  if (status === 404) {
    return 'AI service is not available.'
  }
  if (status === 429) {
    return 'AI service is busy. Please try again shortly.'
  }
  // RUNTIME-2: preserve status class — do not collapse into generic unavailable.
  return `Proxy error (${status}): ${body.slice(0, 200)}`
}

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
 * Call Claude via the server-side Netlify proxy ONLY.
 * Fails closed when the proxy is unreachable or returns a non-2xx status.
 * Never falls back to a browser-held Anthropic key.
 */
export async function callClaude(req: ClaudeRequest): Promise<ClaudeResponse> {
  const { messages, system, max_tokens = 1024, model, signal, tools } = req

  // Omit model when unset so netlify/functions/claude.ts DEFAULT_MODEL remains
  // the canonical model authority (AI-KEY / server contract).
  const proxyPayload: Record<string, unknown> = { messages, system, max_tokens }
  if (model) proxyPayload.model = model
  if (tools && tools.length > 0) proxyPayload.tools = tools

  let response: Response
  try {
    response = await fetch(PROXY_URL, {
      method: 'POST',
      headers: await authedJsonHeaders(),
      body: JSON.stringify(proxyPayload),
      signal,
    })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw err
    // Network / proxy unreachable — fail closed (no browser direct Anthropic).
    throw new Error('AI service is not reachable on this environment.')
  }

  // RUNTIME-2: HTTP 2xx must be consumed and returned — never mapped to a
  // generic unavailable fallback.
  if (response.ok) {
    try {
      return await response.json()
    } catch {
      throw new Error(
        'AI service returned an unreadable response. Please try again.',
      )
    }
  }

  let errBody = ''
  try {
    errBody = await response.text()
  } catch {
    /* ignore */
  }
  throw new Error(sanitizeProxyStatus(response.status, errBody))
}

/**
 * Helper: extract text from Claude response
 */
export function extractText(response: ClaudeResponse): string {
  return response.content?.find((c) => c.type === 'text')?.text || ''
}

// ── NEXUS Prompt Engine integration ──────────────────────────────────────────
// V3 integration: callNexus() routes queries through the NEXUS Prompt Engine
// (nexusPromptEngine.ts) which handles query classification, ECHO context
// injection, and multi-agent routing before calling the Claude API.
//
// This wraps the existing callClaude() path — existing code using callClaude()
// directly continues to work unchanged.

import type { NexusRequest, NexusResponse } from '@/agents/nexusPromptEngine'

/**
 * Route a query through the NEXUS Prompt Engine.
 * Uses runNexusEngine() for classification, context injection, and structured
 * response parsing. Falls back to a plain callClaude() if NEXUS fails.
 */
export async function callNexus(request: NexusRequest): Promise<NexusResponse> {
  try {
    const { runNexusEngine } = await import('@/agents/nexusPromptEngine')
    return await runNexusEngine(request)
  } catch (err) {
    console.error(
      '[claudeProxy] callNexus error — falling back to plain Claude:',
      err,
    )
    const response = await callClaude({
      messages: [{ role: 'user', content: request.query }],
      system: request.systemPromptOverride,
      max_tokens: 1024,
    })
    const text = extractText(response)
    return {
      query: request.query,
      primaryTarget: 'NEXUS',
      response: text,
      confidence: 0,
      agentsInvolved: ['NEXUS'],
      timestamp: new Date().toISOString(),
    } as NexusResponse
  }
}
