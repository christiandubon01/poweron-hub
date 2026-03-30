// PowerOn Hub — Service Worker
// H2: cache-first for static assets, network-first for API calls

const CACHE_NAME = 'poweron-v1'
const STATIC_PATTERNS = [/\/assets\//, /\/icons\//]
const API_PATTERNS = [/\/api\//, /claude\.ai/, /anthropic\.com/]

// Assets to pre-cache on install
const PRECACHE_URLS = [
  '/',
  '/index.html',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS)
    }).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const url = event.request.url

  // Skip non-GET requests
  if (event.request.method !== 'GET') return

  // Skip chrome-extension and non-http(s) requests
  if (!url.startsWith('http')) return

  // Network-first for API calls
  if (API_PATTERNS.some((p) => p.test(url))) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    )
    return
  }

  // Cache-first for static assets
  if (STATIC_PATTERNS.some((p) => p.test(url))) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached
        return fetch(event.request).then((response) => {
          if (response && response.status === 200) {
            const cloned = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cloned))
          }
          return response
        })
      })
    )
    return
  }

  // Network-first with cache fallback for everything else
  event.respondWith(
    fetch(event.request).then((response) => {
      if (response && response.status === 200) {
        const cloned = response.clone()
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cloned))
      }
      return response
    }).catch(() => caches.match(event.request))
  )
})
