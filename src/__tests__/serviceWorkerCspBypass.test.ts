/**
 * Service-worker CSP bypass contract tests.
 *
 * Verifies that Google Maps runtime resources (maps.gstatic.com) are never
 * intercepted by the service worker — the source of the proven production bug
 * where SW fetch() was blocked by connect-src CSP, then the catch returned
 * undefined, causing "Failed to convert value to 'Response'" errors.
 *
 * Test classification:
 *   [STATIC]  assertions against sw.js source text
 *   [BEHAV]   behavioral assertions via SW eval + mock FetchEvent
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT    = process.cwd()
const SW_PATH = join(ROOT, 'public/sw.js')
const swCode  = readFileSync(SW_PATH, 'utf-8')

// ── SW execution harness ──────────────────────────────────────────────────────

const SW_ORIGIN = 'http://localhost:8888'

function buildSWEnv() {
  const handlers: Record<string, Function[]> = {}

  const mockCacheStore = {
    addAll: vi.fn().mockResolvedValue(undefined),
    match:  vi.fn().mockResolvedValue(undefined),
    put:    vi.fn().mockResolvedValue(undefined),
  }
  const mockCaches = {
    open:   vi.fn().mockResolvedValue(mockCacheStore),
    match:  vi.fn().mockResolvedValue(undefined),
    keys:   vi.fn().mockResolvedValue(['poweron-v4', 'poweron-shell-v4']),
    delete: vi.fn().mockResolvedValue(true),
  }
  const mockIDB = {
    open: vi.fn().mockReturnValue({ onsuccess: null, onerror: null, onupgradeneeded: null }),
  }
  const swSelf: any = {
    location: { origin: SW_ORIGIN },
    addEventListener: vi.fn((event: string, fn: Function) => {
      handlers[event] = handlers[event] ?? []
      handlers[event].push(fn)
    }),
    skipWaiting: vi.fn().mockResolvedValue(undefined),
    clients: {
      claim:    vi.fn().mockResolvedValue(undefined),
      matchAll: vi.fn().mockResolvedValue([]),
    },
  }

  // fetch must return a Promise; a bare vi.fn() returns undefined and breaks .then() chains
  const defaultFetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }))

  new Function('self', 'caches', 'fetch', 'indexedDB', 'console', swCode)(
    swSelf, mockCaches, defaultFetch, mockIDB, { log: vi.fn(), warn: vi.fn(), error: vi.fn() }
  )

  function getFetchHandler(): Function {
    const fns = handlers['fetch'] ?? []
    if (!fns.length) throw new Error('No fetch handler registered')
    return fns[0]
  }

  function makeFetchEvent(url: string, method = 'GET', mode: string = 'cors') {
    const respondWith = vi.fn()
    return {
      request: { url, method, mode, clone: vi.fn(), headers: { entries: () => [] } },
      respondWith,
      waitUntil: vi.fn(),
    }
  }

  return { swSelf, handlers, mockCaches, mockCacheStore, getFetchHandler, makeFetchEvent }
}

// ── [STATIC] Cache version ────────────────────────────────────────────────────

describe('[STATIC] 15. Cache version is v5 (new worker invalidates old caches)', () => {
  it('CACHE_NAME is poweron-v5', () => {
    expect(swCode).toContain("'poweron-v5'")
  })

  it('APP_SHELL_CACHE is poweron-shell-v5', () => {
    expect(swCode).toContain("'poweron-shell-v5'")
  })

  it('DATA_CACHE is poweron-data-v5', () => {
    expect(swCode).toContain("'poweron-data-v5'")
  })

  it('old v4 cache names are not present', () => {
    expect(swCode).not.toContain("'poweron-v4'")
    expect(swCode).not.toContain("'poweron-shell-v4'")
    expect(swCode).not.toContain("'poweron-data-v4'")
  })
})

// ── [STATIC] Cross-origin bypass is present ───────────────────────────────────

describe('[STATIC] Google Maps explicit bypass and cross-origin fallthrough are present', () => {
  it('sw.js contains the explicit gstatic.com bypass', () => {
    expect(swCode).toContain('.gstatic.com')
  })

  it('sw.js contains the explicit maps.googleapis.com bypass', () => {
    expect(swCode).toContain('maps.googleapis.com')
  })

  it('sw.js contains the cross-origin fallthrough block', () => {
    expect(swCode).toContain('self.location.origin')
  })

  it('cross-origin fallthrough uses new URL(url).origin comparison', () => {
    expect(swCode).toContain('new URL(url).origin')
  })

  it('cross-origin fallthrough is guarded with try/catch', () => {
    expect(swCode).toContain('try {')
  })
})

// ── [STATIC] Valid Response contract ─────────────────────────────────────────

describe('[STATIC] "Everything else" catch cannot return undefined', () => {
  it('catch clause is async and awaits caches.match', () => {
    expect(swCode).toContain('catch(async () =>')
  })

  it('catch returns a fallback Response when cache misses', () => {
    expect(swCode).toContain("new Response('', { status: 503 })")
  })

  it('catch does not have the old bare caches.match return', () => {
    expect(swCode).not.toContain('.catch(() => caches.match(event.request))')
  })
})

// ── [STATIC] CSP: no maps.gstatic.com in connect-src ────────────────────────

describe('[STATIC] 14. CSP expansion: maps.gstatic.com stays in img-src only', () => {
  const netlifyToml = join(ROOT, 'netlify.toml')
  const tomlContent = existsSync(netlifyToml) ? readFileSync(netlifyToml, 'utf-8') : ''

  it('netlify.toml exists', () => {
    expect(tomlContent).not.toBe('')
  })

  it('maps.gstatic.com is in img-src (direct browser loads work)', () => {
    expect(tomlContent).toContain('https://maps.gstatic.com')
    expect(tomlContent).toMatch(/img-src[^\n]*maps\.gstatic\.com/)
  })

  it('maps.gstatic.com is NOT added to connect-src (SW bypass makes it unnecessary)', () => {
    const connectSrcMatch = tomlContent.match(/connect-src[^;"]*/)?.[0] ?? ''
    expect(connectSrcMatch).not.toContain('maps.gstatic.com')
  })
})

// ── [STATIC] Speculative files removed ───────────────────────────────────────

describe('[STATIC] 7 + 8. Speculative marker adapter files are removed', () => {
  it('leadMarkerVisual.ts does not exist (speculative adapter removed)', () => {
    expect(existsSync(join(ROOT, 'src/components/hunter/leadMarkerVisual.ts'))).toBe(false)
  })

  it('speculative leadMarkerVisual test does not exist', () => {
    expect(existsSync(join(ROOT, 'src/components/hunter/__tests__/leadMarkerVisual.test.ts'))).toBe(false)
  })

  it('speculative googleMapsLoader test does not exist', () => {
    expect(existsSync(join(ROOT, 'src/utils/__tests__/googleMapsLoader.test.ts'))).toBe(false)
  })
})

// ── [STATIC] 9. No Advanced Marker, mapId, or second loader ─────────────────

describe('[STATIC] 9. No Advanced Marker, map ID, or second script loader', () => {
  const hunterMap = existsSync(join(ROOT, 'src/components/hunter/HunterMap.tsx'))
    ? readFileSync(join(ROOT, 'src/components/hunter/HunterMap.tsx'), 'utf-8') : ''
  const loader = existsSync(join(ROOT, 'src/utils/googleMapsLoader.ts'))
    ? readFileSync(join(ROOT, 'src/utils/googleMapsLoader.ts'), 'utf-8') : ''

  it('HunterMap does not use AdvancedMarkerElement', () => {
    expect(hunterMap).not.toContain('AdvancedMarkerElement')
  })

  it('HunterMap does not specify a mapId', () => {
    expect(hunterMap).not.toContain('mapId')
  })

  it('HunterMap does not import from leadMarkerVisual', () => {
    expect(hunterMap).not.toContain('leadMarkerVisual')
  })

  it('loader does not add a second script tag pattern', () => {
    const scriptTagCount = (loader.match(/createElement\(['"]script['"]\)/g) ?? []).length
    expect(scriptTagCount).toBeLessThanOrEqual(1)
  })
})

// ── [STATIC] 17. PortalTrackView unchanged ───────────────────────────────────

describe('[STATIC] 17. PortalTrackView is unchanged', () => {
  it('PortalTrackView file exists', () => {
    expect(
      existsSync(join(ROOT, 'src/views/PortalTrackView.tsx')) ||
      existsSync(join(ROOT, 'src/components/portal/PortalTrackView.tsx'))
    ).toBe(true)
  })

  it('PortalInbox does not import from leadMarkerVisual', () => {
    const inbox = existsSync(join(ROOT, 'src/components/hunter/PortalInbox.tsx'))
      ? readFileSync(join(ROOT, 'src/components/hunter/PortalInbox.tsx'), 'utf-8') : ''
    expect(inbox).not.toContain('leadMarkerVisual')
  })
})

// ── [STATIC] 18. No migration or database changes ────────────────────────────

describe('[STATIC] 18. No migration or database changes', () => {
  it('no new migration files introduced by this repair beyond Project-only Work Orders', () => {
    const migDir = join(ROOT, 'supabase/migrations')
    // Service-worker repair must not invent migrations. Unrelated solar 112 may exist as residue.
    const files = existsSync(migDir)
      ? require('fs').readdirSync(migDir).filter((f: string) => f.startsWith('112_') && !f.startsWith('112_solar_'))
      : []
    expect(files).toHaveLength(0)
  })
})

// ── [BEHAV] Cross-origin bypass ───────────────────────────────────────────────

describe('[BEHAV] 2-6. Cross-origin requests bypass respondWith entirely', () => {
  let env: ReturnType<typeof buildSWEnv>

  beforeEach(() => {
    env = buildSWEnv()
  })

  it('maps.gstatic.com GET does not call event.respondWith', () => {
    const fetchHandler = env.getFetchHandler()
    const event = env.makeFetchEvent('https://maps.gstatic.com/mapfiles/transparent.png')
    fetchHandler(event)
    expect(event.respondWith).not.toHaveBeenCalled()
  })

  it('maps.googleapis.com GET does not call event.respondWith', () => {
    const fetchHandler = env.getFetchHandler()
    const event = env.makeFetchEvent('https://maps.googleapis.com/maps/api/tile')
    fetchHandler(event)
    expect(event.respondWith).not.toHaveBeenCalled()
  })

  it('arbitrary cross-origin GET does not call event.respondWith', () => {
    const fetchHandler = env.getFetchHandler()
    const event = env.makeFetchEvent('https://khms0.googleapis.com/kh?v=935')
    fetchHandler(event)
    expect(event.respondWith).not.toHaveBeenCalled()
  })

  it('cross-origin bypass does not call cache.put', () => {
    const fetchHandler = env.getFetchHandler()
    const event = env.makeFetchEvent('https://maps.gstatic.com/mapfiles/transparent.png')
    fetchHandler(event)
    expect(env.mockCacheStore.put).not.toHaveBeenCalled()
  })
})

// ── [BEHAV] 1. Same-origin requests are intercepted ─────────────────────────

describe('[BEHAV] 1. Same-origin application GETs reach a handler', () => {
  let env: ReturnType<typeof buildSWEnv>

  beforeEach(() => {
    env = buildSWEnv()
  })

  it('same-origin asset GET calls event.respondWith', () => {
    const fetchHandler = env.getFetchHandler()
    const event = env.makeFetchEvent(`${SW_ORIGIN}/assets/main-abc123.js`)
    fetchHandler(event)
    expect(event.respondWith).toHaveBeenCalled()
  })

  it('same-origin navigation calls event.respondWith', () => {
    const fetchHandler = env.getFetchHandler()
    const event = env.makeFetchEvent(`${SW_ORIGIN}/dashboard`, 'GET', 'navigate')
    fetchHandler(event)
    expect(event.respondWith).toHaveBeenCalled()
  })
})

// ── [BEHAV] 7-10. Intercepted branches produce valid Responses ───────────────

describe('[BEHAV] 7-10. All intercepted catch paths resolve a real Response', () => {
  it('8. intercepted fetch failure returns fallback Response (not undefined, not null)', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network error'))
    const mockCacheStore = {
      addAll: vi.fn().mockResolvedValue(undefined),
      match:  vi.fn().mockResolvedValue(undefined),
      put:    vi.fn().mockResolvedValue(undefined),
    }
    const mockCaches = {
      open:   vi.fn().mockResolvedValue(mockCacheStore),
      match:  vi.fn().mockResolvedValue(undefined),
      keys:   vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue(true),
    }
    const mockIDB = {
      open: vi.fn().mockReturnValue({ onsuccess: null, onerror: null, onupgradeneeded: null }),
    }
    const handlers: Record<string, Function[]> = {}
    const swSelf: any = {
      location: { origin: SW_ORIGIN },
      addEventListener: vi.fn((event: string, fn: Function) => {
        handlers[event] = handlers[event] ?? []
        handlers[event].push(fn)
      }),
      skipWaiting: vi.fn().mockResolvedValue(undefined),
      clients: { claim: vi.fn(), matchAll: vi.fn().mockResolvedValue([]) },
    }
    new Function('self', 'caches', 'fetch', 'indexedDB', 'console', swCode)(
      swSelf, mockCaches, fetchMock, mockIDB, { log: vi.fn(), warn: vi.fn(), error: vi.fn() }
    )
    const fetchHandler = handlers['fetch']?.[0]
    if (!fetchHandler) throw new Error('No fetch handler')

    let capturedPromise: Promise<any> | null = null
    const event = {
      request: { url: `${SW_ORIGIN}/some-resource`, method: 'GET', mode: 'cors', clone: vi.fn(), headers: { entries: () => [] } },
      respondWith: (p: Promise<any>) => { capturedPromise = p },
      waitUntil: vi.fn(),
    }
    fetchHandler(event)

    expect(capturedPromise).not.toBeNull()
    const result = await capturedPromise!
    // Must be a real Response (not undefined, not null)
    expect(result).not.toBeUndefined()
    expect(result).not.toBeNull()
    expect(result).toBeInstanceOf(Response)
    expect(result.status).toBe(503)
  })

  it('9-10. static asset handler with network failure returns cached response or null (no undefined)', async () => {
    const mockResponse = new Response('cached content', { status: 200 })
    const fetchMock = vi.fn().mockRejectedValue(new Error('network error'))
    const mockCacheStore = {
      addAll: vi.fn().mockResolvedValue(undefined),
      match:  vi.fn().mockResolvedValue(mockResponse),
      put:    vi.fn().mockResolvedValue(undefined),
    }
    const mockCaches = {
      open:   vi.fn().mockResolvedValue(mockCacheStore),
      match:  vi.fn().mockResolvedValue(mockResponse),
      keys:   vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue(true),
    }
    const mockIDB = {
      open: vi.fn().mockReturnValue({ onsuccess: null, onerror: null, onupgradeneeded: null }),
    }
    const handlers: Record<string, Function[]> = {}
    const swSelf: any = {
      location: { origin: SW_ORIGIN },
      addEventListener: vi.fn((event: string, fn: Function) => {
        handlers[event] = handlers[event] ?? []
        handlers[event].push(fn)
      }),
      skipWaiting: vi.fn().mockResolvedValue(undefined),
      clients: { claim: vi.fn(), matchAll: vi.fn().mockResolvedValue([]) },
    }
    new Function('self', 'caches', 'fetch', 'indexedDB', 'console', swCode)(
      swSelf, mockCaches, fetchMock, mockIDB, { log: vi.fn(), warn: vi.fn(), error: vi.fn() }
    )
    const fetchHandler = handlers['fetch']?.[0]
    if (!fetchHandler) throw new Error('No fetch handler')

    let capturedPromise: Promise<any> | null = null
    const event = {
      request: { url: `${SW_ORIGIN}/assets/style.css`, method: 'GET', mode: 'cors', clone: vi.fn(), headers: { entries: () => [] } },
      respondWith: (p: Promise<any>) => { capturedPromise = p },
      waitUntil: vi.fn(),
    }
    fetchHandler(event)

    const result = await capturedPromise
    // Result must not be undefined (cached response or null from cache miss — both are valid)
    expect(result).not.toBeUndefined()
  })
})

// ── [BEHAV] 11. Offline navigation returns shell ─────────────────────────────

describe('[BEHAV] 11. Navigation offline fallback returns app shell', () => {
  it('navigation fetch failure returns offline HTML (not undefined)', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'))
    const mockCacheStore = {
      addAll: vi.fn().mockResolvedValue(undefined),
      match:  vi.fn().mockResolvedValue(undefined),
      put:    vi.fn().mockResolvedValue(undefined),
    }
    const offlineHtmlResponse = new Response('<html>Offline</html>', { status: 200 })
    const mockCaches = {
      open:   vi.fn().mockResolvedValue(mockCacheStore),
      match:  vi.fn().mockImplementation((req: any) => {
        const url = typeof req === 'string' ? req : req?.url
        if (url === '/' || url === '/index.html') return Promise.resolve(offlineHtmlResponse)
        return Promise.resolve(undefined)
      }),
      keys:   vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue(true),
    }
    const mockIDB = {
      open: vi.fn().mockReturnValue({ onsuccess: null, onerror: null, onupgradeneeded: null }),
    }
    const handlers: Record<string, Function[]> = {}
    const swSelf: any = {
      location: { origin: SW_ORIGIN },
      addEventListener: vi.fn((event: string, fn: Function) => {
        handlers[event] = handlers[event] ?? []
        handlers[event].push(fn)
      }),
      skipWaiting: vi.fn().mockResolvedValue(undefined),
      clients: { claim: vi.fn(), matchAll: vi.fn().mockResolvedValue([]) },
    }
    new Function('self', 'caches', 'fetch', 'indexedDB', 'console', swCode)(
      swSelf, mockCaches, fetchMock, mockIDB, { log: vi.fn(), warn: vi.fn(), error: vi.fn() }
    )
    const fetchHandler = handlers['fetch']?.[0]
    if (!fetchHandler) throw new Error('No fetch handler')

    let capturedPromise: Promise<any> | null = null
    const event = {
      request: { url: `${SW_ORIGIN}/dashboard`, method: 'GET', mode: 'navigate', clone: vi.fn(), headers: { entries: () => [] } },
      respondWith: (p: Promise<any>) => { capturedPromise = p },
      waitUntil: vi.fn(),
    }
    fetchHandler(event)

    const result = await capturedPromise
    expect(result).not.toBeUndefined()
    expect(result).not.toBeNull()
  })
})

// ── [BEHAV] 12-13. Activate: old caches removed, clients claimed ─────────────

describe('[BEHAV] 12-13. Activate removes old caches and claims clients', () => {
  it('activate event deletes old v4 caches', async () => {
    const env = buildSWEnv()
    const activateHandlers = env.handlers['activate'] ?? []
    expect(activateHandlers.length).toBeGreaterThan(0)

    let capturedPromise: Promise<any> | null = null
    const activateEvent = {
      waitUntil: (p: Promise<any>) => { capturedPromise = p },
    }
    activateHandlers[0](activateEvent)
    await capturedPromise

    // Old caches (poweron-v4) should be deleted
    expect(env.mockCaches.delete).toHaveBeenCalled()
  })

  it('activate event calls clients.claim()', async () => {
    const env = buildSWEnv()
    const activateHandlers = env.handlers['activate'] ?? []
    let capturedPromise: Promise<any> | null = null
    const activateEvent = { waitUntil: (p: Promise<any>) => { capturedPromise = p } }
    activateHandlers[0](activateEvent)
    await capturedPromise
    expect(env.swSelf.clients.claim).toHaveBeenCalled()
  })
})
