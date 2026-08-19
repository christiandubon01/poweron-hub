/**
 * Reproduce exact production Coach Me response → extractText → parseLiveCoachTip
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  parseLiveCoachTip,
} from '@/services/salesIntel/liveCallAssist'
import { extractText, type ClaudeResponse } from '@/services/claudeProxy'

/** Exact production HTTP 200 body (content[0].text) from COACH-LINK-RUNTIME-2 evidence. */
export const PROD_COACH_ME_INNER_JSON = `{"signal":"COMPETITOR QUOTE ON TABLE","category":"comparison","sayNext":"I completely understand — on a commercial job with three active permits and a TLMA plan check, you absolutely should compare. What I'd ask is let's make sure we're comparing apples to apples, because scope gaps on a project like this can cost you way more mid-build than the difference between two bids.","strategy":"1) Stall the price race — get the other quote's scope on the table first. Ask what's included: permit pulls, inspections, load calculations, panel specs, conduit runs. 2) Your edge is credibility on a complex permitted commercial project — don't surrender it by jumping to price.","ask":"Can you share what's in the other quote — specifically who's pulling the permits and how they're handling the TLMA plan check coordination?","optionalOpportunity":"Auto repair shops often need EV-ready conduit, 200A+ service, compressor circuits, and lift circuits — if the competing bid is light on any of those, that's a real cost risk you can flag professionally without badmouthing the competitor."}`

export const PROD_COACH_ME_CLAUDE_RESPONSE: ClaudeResponse = {
  model: 'claude-sonnet-4-6',
  content: [{ type: 'text', text: PROD_COACH_ME_INNER_JSON }],
  usage: { input_tokens: 830, output_tokens: 250 },
}

describe('COACH-LINK-RUNTIME-2 post-200 Coach Me contract', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })
  it('extractText reads content[0].text from production shape', () => {
    expect(extractText(PROD_COACH_ME_CLAUDE_RESPONSE)).toBe(PROD_COACH_ME_INNER_JSON)
  })

  it('category comparison is accepted and fields preserved', () => {
    const tip = parseLiveCoachTip(extractText(PROD_COACH_ME_CLAUDE_RESPONSE))
    expect(tip.category).toBe('comparison')
    expect(tip.signal).toBe('COMPETITOR QUOTE ON TABLE')
    expect(tip.sayNext).toContain('apples to apples')
    expect(tip.strategy).toContain('Stall the price race')
    expect(tip.ask).toContain('other quote')
    expect(tip.optionalOpportunity).toContain('EV-ready conduit')
  })

  it('malformed text still returns safe tip (does not throw)', () => {
    const tip = parseLiveCoachTip('not-json{{{')
    expect(tip.signal).toBe('GENERAL')
    expect(tip.sayNext.length).toBeGreaterThan(0)
  })

  it('empty text still returns safe tip (does not throw)', () => {
    const tip = parseLiveCoachTip('')
    expect(tip.sayNext).toMatch(/Coaching unavailable|retry/i)
  })

  it('callClaude returns HTTP 200 JSON and does not map it to temporarily unavailable', async () => {
    const { callClaude } = await import('@/services/claudeProxy')
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => PROD_COACH_ME_CLAUDE_RESPONSE,
      text: async () => JSON.stringify(PROD_COACH_ME_CLAUDE_RESPONSE),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await callClaude({
      messages: [{ role: 'user', content: 'competitor quote' }],
      system: 'coach',
      max_tokens: 600,
    })
    expect(result.content[0].text).toContain('COMPETITOR QUOTE ON TABLE')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('callClaude does not swallow non-ok proxy errors into temporarily unavailable', async () => {
    const { callClaude } = await import('@/services/claudeProxy')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({}),
        text: async () => '{"error":"messages: roles must alternate"}',
      }),
    )

    await expect(
      callClaude({
        messages: [{ role: 'user', content: 'x' }],
        max_tokens: 600,
      }),
    ).rejects.toThrow(/Proxy error \(400\)/)
  })

  it('callClaude posts to Netlify Claude proxy only (AI-KEY + RUNTIME-2)', async () => {
    const { callClaude } = await import('@/services/claudeProxy')
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => PROD_COACH_ME_CLAUDE_RESPONSE,
    })
    vi.stubGlobal('fetch', fetchMock)
    await callClaude({
      messages: [{ role: 'user', content: 'competitor quote' }],
      max_tokens: 600,
    })
    expect(fetchMock.mock.calls[0][0]).toBe('/.netlify/functions/claude')
    expect(JSON.stringify(fetchMock.mock.calls)).not.toMatch(/api\.anthropic\.com/)
  })
})
