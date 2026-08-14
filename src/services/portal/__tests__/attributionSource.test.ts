import { describe, expect, it } from 'vitest'

import { classifySource } from '../attributionSource'

describe('classifySource', () => {
  it('classifies any click id as paid_search even with an organic referrer', () => {
    expect(classifySource({
      gclid: 'test123',
      referrer: 'https://www.google.com/search?q=electrician',
    })).toBe('paid_search')
  })

  it('classifies paid utm_medium values as paid_search', () => {
    expect(classifySource({ utm_medium: 'cpc' })).toBe('paid_search')
    expect(classifySource({ utm_medium: 'ppc' })).toBe('paid_search')
    expect(classifySource({ utm_medium: 'paid' })).toBe('paid_search')
  })

  it('classifies ai assistant utm_source values without a referrer', () => {
    expect(classifySource({ utm_source: 'chatgpt.com' })).toBe('ai_assistant')
  })

  it('classifies ai assistant referrers by hostname', () => {
    expect(classifySource({ referrer: 'https://www.perplexity.ai/search?q=panel+upgrade' })).toBe('ai_assistant')
  })

  it('classifies Google Maps and share.google referrers as gbp', () => {
    expect(classifySource({ referrer: 'https://www.google.com/maps/place/Power+On' })).toBe('gbp')
    expect(classifySource({ referrer: 'https://share.google/abc123' })).toBe('gbp')
  })

  it('classifies referral marketplace referrers as referral_site', () => {
    expect(classifySource({ referrer: 'https://www.yelp.com/biz/power-on-solutions' })).toBe('referral_site')
  })

  it('classifies social referrers as social', () => {
    expect(classifySource({ referrer: 'https://m.facebook.com/story.php?id=1' })).toBe('social')
  })

  it('classifies search engine referrers as organic_search', () => {
    expect(classifySource({ referrer: 'https://www.google.com/search?q=generator+install' })).toBe('organic_search')
  })

  it('classifies empty attribution and self-referrers as direct', () => {
    expect(classifySource({})).toBe('direct')
    expect(classifySource({ referrer: 'https://app.poweronsolutionsllc.com/portal' })).toBe('direct')
  })

  it('falls back to other for malformed referrers and unknown hosts', () => {
    expect(classifySource({ referrer: 'not a url' })).toBe('other')
    expect(classifySource({ referrer: 'https://example.com/path' })).toBe('other')
  })
})
