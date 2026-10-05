// Test harness: runs the REAL public/sw.js between "the page" and a fake network, with a working
// in-memory Cache Storage. `pageFetch` behaves like fetch() from a page controlled by the service
// worker: the worker's fetch handler sees the request and either answers it (respondWith) or the
// request falls through to the network untouched.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export type NetworkFetch = (request: Request) => Promise<Response>

export function createServiceWorkerFetch(network: NetworkFetch) {
  const swCode = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf-8')
  const handlers: Record<string, Array<(event: any) => void>> = {}
  const stores = new Map<string, Map<string, Response>>()

  const openCache = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map())
    const store = stores.get(name)!
    return {
      addAll: async () => undefined,
      match: async (request: Request) => store.get(request.url)?.clone(),
      put: async (request: Request, response: Response) => { store.set(request.url, response) },
    }
  }
  const caches = {
    open: async (name: string) => openCache(name),
    match: async () => undefined,
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
  }
  const self = {
    location: { origin: 'http://localhost:8888' },
    addEventListener: (type: string, fn: (event: any) => void) => { (handlers[type] ??= []).push(fn) },
    skipWaiting: async () => undefined,
    clients: { claim: async () => undefined, matchAll: async () => [] },
  }
  const quietConsole = { log: () => {}, warn: () => {}, error: () => {} }
  new Function('self', 'caches', 'fetch', 'indexedDB', 'console', swCode)(
    self, caches, network, { open: () => ({}) }, quietConsole,
  )

  async function pageFetch(url: string, init?: RequestInit): Promise<Response> {
    const request = new Request(url, init)
    let answered: Promise<Response> | null = null
    const event = {
      request,
      respondWith: (response: Response | Promise<Response>) => { answered = Promise.resolve(response) },
      waitUntil: () => {},
    }
    for (const handler of handlers.fetch ?? []) {
      handler(event)
      if (answered) break
    }
    return answered ?? network(request)
  }

  return { pageFetch, cacheKeys: (name: string) => [...(stores.get(name)?.keys() ?? [])] }
}
