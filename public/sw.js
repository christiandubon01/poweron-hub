// PowerOn Hub — Service Worker (Session 14 — Offline Capability)
// Strategy:
//   - App shell + NEC data: cache-first (pre-cached on install)
//   - Static assets (JS/CSS/fonts/icons): cache-first
//   - Field log POSTs when offline: queue to IndexedDB → auto-sync on reconnect
//   - API/AI calls: network-first, graceful offline error
//   - Supabase data GETs: stale-while-revalidate

const CACHE_NAME = 'poweron-v3'
const APP_SHELL_CACHE = 'poweron-shell-v3'
const DATA_CACHE = 'poweron-data-v3'

// Patterns for network-first (AI + API calls)
const API_PATTERNS = [/\/api\//, /claude\.ai/, /anthropic\.com/, /netlify\/functions\//]

// Patterns for cache-first (static assets)
const STATIC_PATTERNS = [/\/assets\//, /\/icons\//, /\.woff2?$/, /\.ttf$/, /\.otf$/]

// Supabase patterns (data sync — stale-while-revalidate)
const SUPABASE_PATTERNS = [/supabase\.co/]

// App shell: critical files for offline load
const APP_SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
]

// IndexedDB config for offline queue
const IDB_NAME = 'poweron-offline-queue'
const IDB_VERSION = 1
const STORE_FIELD_LOG = 'fieldLogQueue'

// ── IndexedDB helpers ─────────────────────────────────────────────────────────

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION)
    req.onupgradeneeded = (e) => {
      const db = e.target.result
      if (!db.objectStoreNames.contains(STORE_FIELD_LOG)) {
        const store = db.createObjectStore(STORE_FIELD_LOG, { keyPath: 'id', autoIncrement: true })
        store.createIndex('timestamp', 'timestamp', { unique: false })
        store.createIndex('projectId', 'projectId', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function enqueueFieldLog(request) {
  const db = await openDB()
  const body = await request.clone().text()
  let parsedBody = null
  try { parsedBody = JSON.parse(body) } catch (_) {}

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_FIELD_LOG, 'readwrite')
    const store = tx.objectStore(STORE_FIELD_LOG)
    const record = {
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
      body,
      projectId: parsedBody?.project_id || parsedBody?.projectId || null,
      timestamp: Date.now(),
      retries: 0,
    }
    const req = store.add(record)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function getQueuedLogs() {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_FIELD_LOG, 'readonly')
    const store = tx.objectStore(STORE_FIELD_LOG)
    const req = store.getAll()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function deleteQueuedLog(id) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_FIELD_LOG, 'readwrite')
    const store = tx.objectStore(STORE_FIELD_LOG)
    const req = store.delete(id)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

async function updateQueuedLogRetries(id, retries) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_FIELD_LOG, 'readwrite')
    const store = tx.objectStore(STORE_FIELD_LOG)
    const getReq = store.get(id)
    getReq.onsuccess = () => {
      const record = getReq.result
      if (record) {
        record.retries = retries
        const putReq = store.put(record)
        putReq.onsuccess = () => resolve()
        putReq.onerror = () => reject(putReq.error)
      } else {
        resolve()
      }
    }
    getReq.onerror = () => reject(getReq.error)
  })
}

// ── Sync queued field logs to Supabase ───────────────────────────────────────

async function syncQueuedFieldLogs() {
  let queued
  try {
    queued = await getQueuedLogs()
  } catch (err) {
    console.warn('[SW] Could not read queue:', err)
    return { synced: 0, failed: 0 }
  }

  if (!queued || queued.length === 0) return { synced: 0, failed: 0 }

  let synced = 0
  let failed = 0

  // Process in timestamp order (oldest first)
  const sorted = [...queued].sort((a, b) => a.timestamp - b.timestamp)

  for (const record of sorted) {
    try {
      const response = await fetch(record.url, {
        method: record.method,
        headers: record.headers,
        body: record.body,
      })
      if (response.ok) {
        await deleteQueuedLog(record.id)
        synced++
      } else {
        await updateQueuedLogRetries(record.id, (record.retries || 0) + 1)
        failed++
      }
    } catch (_) {
      await updateQueuedLogRetries(record.id, (record.retries || 0) + 1)
      failed++
    }
  }

  // Notify all clients
  if (synced > 0 || failed > 0) {
    try {
      const clients = await self.clients.matchAll({ includeUncontrolled: true })
      clients.forEach(client => {
        client.postMessage({
          type: 'FIELD_LOG_SYNC_COMPLETE',
          synced,
          failed,
          total: queued.length,
        })
      })
    } catch (_) {}
  }

  return { synced, failed }
}

// ── Notify clients of offline queue ──────────────────────────────────────────

async function notifyOfflineSave(queueLength) {
  try {
    const clients = await self.clients.matchAll({ includeUncontrolled: true })
    clients.forEach(client => {
      client.postMessage({
        type: 'FIELD_LOG_QUEUED_OFFLINE',
        queueLength,
      })
    })
  } catch (_) {}
}

// ── Install — pre-cache app shell ─────────────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then((cache) => {
      return cache.addAll(APP_SHELL_URLS).catch(err => {
        console.warn('[SW] App shell pre-cache partial failure (ok in dev):', err)
      })
    }).then(() => self.skipWaiting())
  )
})

// ── Activate — delete ALL old caches to force fresh asset loads ──────────────

self.addEventListener('activate', (event) => {
  var VALID_CACHES = new Set([CACHE_NAME, APP_SHELL_CACHE, DATA_CACHE])
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return !VALID_CACHES.has(k) }).map(function(k) {
          console.log('[SW] Deleting old cache:', k)
          return caches.delete(k)
        })
      )
    }).then(function() { return self.clients.claim() })
  )
})

// ── Message handler ───────────────────────────────────────────────────────────

self.addEventListener('message', (event) => {
  if (!event.data) return

  if (event.data.type === 'SYNC_NOW') {
    event.waitUntil(syncQueuedFieldLogs())
    return
  }

  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
    return
  }

  if (event.data.type === 'GET_QUEUE_LENGTH') {
    getQueuedLogs().then(queued => {
      if (event.source) {
        event.source.postMessage({
          type: 'QUEUE_LENGTH',
          length: queued?.length || 0,
        })
      }
    }).catch(() => {})
    return
  }
})

// ── Background sync (if supported by browser) ────────────────────────────────

self.addEventListener('sync', (event) => {
  if (event.tag === 'field-log-sync') {
    event.waitUntil(syncQueuedFieldLogs())
  }
})

// ── Fetch handler ─────────────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const url = event.request.url
  const method = event.request.method

  // Skip non-http(s) and browser-extension requests
  if (!url.startsWith('http')) return
  if (url.includes('chrome-extension')) return

  // ── POST to Supabase or field-log endpoints — intercept when offline ──────
  if (method === 'POST' && (
    SUPABASE_PATTERNS.some(p => p.test(url)) ||
    url.includes('/field-log') ||
    url.includes('/logs') ||
    url.includes('/serviceLogs')
  )) {
    event.respondWith(
      fetch(event.request.clone()).catch(async () => {
        // Offline — queue the request in IndexedDB
        try {
          await enqueueFieldLog(event.request)
          const queued = await getQueuedLogs()
          await notifyOfflineSave(queued?.length || 1)

          // Return a synthetic 202 so the app thinks it succeeded
          return new Response(
            JSON.stringify({
              status: 'queued',
              message: 'Saved offline — will sync when connected',
              offline: true,
            }),
            {
              status: 202,
              headers: { 'Content-Type': 'application/json' },
            }
          )
        } catch (queueErr) {
          console.error('[SW] Failed to queue field log:', queueErr)
          return new Response(
            JSON.stringify({ error: 'Offline — save failed' }),
            { status: 503, headers: { 'Content-Type': 'application/json' } }
          )
        }
      })
    )
    return
  }

  // ── All other non-GET — pass through without interference ─────────────────
  if (method !== 'GET') return

  // ── AI / Anthropic API — network-first, offline graceful error ────────────
  if (API_PATTERNS.some((p) => p.test(url))) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(
          JSON.stringify({ error: 'Offline — AI features require internet connection' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        )
      )
    )
    return
  }

  // ── Static assets — cache-first with network update ───────────────────────
  if (STATIC_PATTERNS.some((p) => p.test(url))) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        // Return cached immediately; update in background
        const networkFetch = fetch(event.request).then((response) => {
          if (response && response.status === 200) {
            const cloned = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cloned))
          }
          return response
        }).catch(() => null)

        return cached || networkFetch
      })
    )
    return
  }

  // ── Supabase GETs — stale-while-revalidate ────────────────────────────────
  if (SUPABASE_PATTERNS.some((p) => p.test(url))) {
    event.respondWith(
      caches.open(DATA_CACHE).then(async (cache) => {
        const cached = await cache.match(event.request)

        // Always try to update cache from network
        const networkFetch = fetch(event.request).then((response) => {
          if (response && response.status === 200) {
            cache.put(event.request, response.clone())
          }
          return response
        }).catch(() => null)

        // Return cached immediately if available, otherwise wait for network
        if (cached) {
          // Background refresh — don't wait
          networkFetch.catch(() => {})
          return cached
        }

        const fresh = await networkFetch
        return fresh || new Response(
          JSON.stringify({ error: 'Offline — no cached data available' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        )
      })
    )
    return
  }

  // ── Navigation requests — network-first, fallback to cached shell ─────────
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).then((response) => {
        if (response && response.status === 200) {
          const cloned = response.clone()
          caches.open(APP_SHELL_CACHE).then((cache) => cache.put(event.request, cloned))
        }
        return response
      }).catch(async () => {
        const cached = await caches.match(event.request)
        if (cached) return cached
        const root = await caches.match('/')
        if (root) return root
        const index = await caches.match('/index.html')
        return index || new Response(
          '<!DOCTYPE html><html><body><h1>PowerOn Hub — Offline</h1><p>Connect to the internet to load the app.</p></body></html>',
          { headers: { 'Content-Type': 'text/html' } }
        )
      })
    )
    return
  }

  // ── Everything else — network-first with cache fallback ───────────────────
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
