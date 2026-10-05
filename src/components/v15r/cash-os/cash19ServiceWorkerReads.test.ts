// The real public/sw.js must never answer an ONLINE Supabase read from a stale cache; the cache is an
// offline fallback only. (See cash19CurrentTabRefresh.test.tsx for the visible production symptom.)

import { describe, expect, it } from 'vitest'
import { createServiceWorkerFetch } from './serviceWorkerHarness'

const URL_ = 'https://proj.supabase.co/rest/v1/financial_transactions?select=*&organization_id=eq.org-1&order=id.asc&offset=0&limit=500'
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('service worker Supabase reads', () => {
  it('returns the CURRENT rows on a repeat read of the same url (no stale-first answer)', async () => {
    let balance = 0
    let online = true
    const sw = createServiceWorkerFetch(async () => {
      if (!online) throw new TypeError('Failed to fetch')
      return json([{ amount_minor: balance }])
    })
    expect(await (await sw.pageFetch(URL_)).json()).toEqual([{ amount_minor: 0 }])
    balance = -10300 // a write lands between the two reads
    expect(await (await sw.pageFetch(URL_)).json()).toEqual([{ amount_minor: -10300 }])
    expect(await (await sw.pageFetch(URL_)).json()).toEqual([{ amount_minor: -10300 }])
  })

  it('still serves the last cached copy when the network is unreachable', async () => {
    let online = true
    const sw = createServiceWorkerFetch(async () => {
      if (!online) throw new TypeError('Failed to fetch')
      return json([{ amount_minor: 5300 }])
    })
    await sw.pageFetch(URL_)
    online = false
    expect(await (await sw.pageFetch(URL_)).json()).toEqual([{ amount_minor: 5300 }])
  })

  it('offline with nothing cached returns the explicit 503, not undefined', async () => {
    const sw = createServiceWorkerFetch(async () => { throw new TypeError('Failed to fetch') })
    const res = await sw.pageFetch(URL_)
    expect(res.status).toBe(503)
  })

  it('does not cache or replace a non-200 online answer with an older cached one', async () => {
    let status = 200
    const sw = createServiceWorkerFetch(async () => json(status === 200 ? [{ ok: 1 }] : { message: 'denied' }, status))
    await sw.pageFetch(URL_)
    status = 401
    const res = await sw.pageFetch(URL_)
    expect(res.status).toBe(401)
  })

  it('leaves writes alone (non-GET is never intercepted)', async () => {
    let seen = 0
    const sw = createServiceWorkerFetch(async () => { seen++; return json({ id: 'x' }, 201) })
    const res = await sw.pageFetch('https://proj.supabase.co/rest/v1/financial_transactions', { method: 'POST', body: '{}' })
    expect(res.status).toBe(201)
    expect(seen).toBe(1)
  })
})
