const DB_NAME = 'poweron-storage'
const STORE_NAME = 'key-value'
const DB_VERSION = 1

let dbPromise: Promise<IDBDatabase> | null = null

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB is unavailable'))
  }
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => {
        db.close()
        dbPromise = null
      }
      resolve(db)
    }
    request.onerror = () => {
      dbPromise = null
      reject(request.error || new Error('Failed to open IndexedDB'))
    }
    request.onblocked = () => {
      dbPromise = null
      reject(new Error('IndexedDB open was blocked'))
    }
  })

  return dbPromise
}

export async function idbGet<T>(key: IDBValidKey): Promise<T | undefined> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key)
    request.onsuccess = () => resolve(request.result as T | undefined)
    request.onerror = () => reject(request.error || new Error('IndexedDB read failed'))
  })
}

export async function idbSet(key: IDBValidKey, value: unknown): Promise<void> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).put(value, key)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB write failed'))
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB write aborted'))
  })
}

/**
 * Atomically inspect and optionally replace one value. The read and write share a
 * single readwrite transaction, so callers in different tabs cannot race a stale
 * compare followed by an unconditional put.
 */
export async function idbAtomicUpdate<T>(
  key: IDBValidKey,
  update: (current: T | undefined) =>
    | { action: 'keep' }
    | { action: 'put'; value: T }
    | { action: 'delete' },
): Promise<{ action: 'kept' | 'put' | 'deleted'; value: T | undefined }> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.get(key)
    let action: 'kept' | 'put' | 'deleted' = 'kept'
    let resolvedValue: T | undefined

    request.onsuccess = () => {
      try {
        const current = request.result as T | undefined
        const decision = update(current)
        if (decision.action === 'put') {
          action = 'put'
          resolvedValue = decision.value
          store.put(decision.value, key)
        } else if (decision.action === 'delete') {
          action = 'deleted'
          resolvedValue = undefined
          store.delete(key)
        } else {
          resolvedValue = current
        }
      } catch (error) {
        try { transaction.abort() } catch { /* ignore */ }
        reject(error)
      }
    }
    request.onerror = () => reject(request.error || new Error('IndexedDB atomic read failed'))
    transaction.oncomplete = () => resolve({ action, value: resolvedValue })
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB atomic update failed'))
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB atomic update aborted'))
  })
}

export async function idbDelete(key: IDBValidKey): Promise<void> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).delete(key)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB delete failed'))
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB delete aborted'))
  })
}

export async function idbKeys(): Promise<IDBValidKey[]> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAllKeys()
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('IndexedDB key listing failed'))
  })
}
