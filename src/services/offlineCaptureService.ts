/**
 * offlineCaptureService.ts — B26 | Offline Capture IndexedDB
 *
 * Persists voice capture blobs + metadata to IndexedDB so recordings are
 * never lost when the device is offline. A background sync retries Whisper
 * transcription for every unsynced entry as soon as connectivity returns.
 *
 * Schema: { id, timestamp, audioBlob, transcript, category, synced, createdAt }
 * Uses only the native IndexedDB API — no external library dependency.
 */

const DB_NAME = 'poweron_offline_captures'
const STORE_NAME = 'captures'
const DB_VERSION = 1

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OfflineCapture {
  /** Unique capture ID — same key used in localStorage poweron_quick_captures */
  id: string
  /** ISO timestamp of when the recording stopped */
  timestamp: string
  /** Raw audio blob from MediaRecorder */
  audioBlob: Blob
  /** Whisper transcript — null when offline or not yet synced */
  transcript: string | null
  /** User-selected category (field / financial / personal / project / general) */
  category: string
  /** true once Whisper has successfully returned a transcript */
  synced: boolean
  /** ISO timestamp of record creation */
  createdAt: string
}

// ── DB helpers ─────────────────────────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('synced', 'synced', { unique: false })
        store.createIndex('createdAt', 'createdAt', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

// ── Public API ─────────────────────────────────────────────────────────────────

/** Persist a new capture to IndexedDB (call immediately when recording stops) */
export async function saveOfflineCapture(capture: OfflineCapture): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const req = store.put(capture)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

/** Update an existing record with the Whisper transcript and mark it synced */
export async function updateCaptureTranscript(id: string, transcript: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const getReq = store.get(id)
    getReq.onsuccess = () => {
      const record: OfflineCapture | undefined = getReq.result
      if (record) {
        record.transcript = transcript
        record.synced = true
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

/** Return all captures that have not yet been synced to Whisper */
export async function getPendingCaptures(): Promise<OfflineCapture[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const index = store.index('synced')
    const req = index.getAll(IDBKeyRange.only(0)) // IDBKeyRange.only(false) may fail in some browsers; use 0
    req.onsuccess = () => resolve((req.result || []) as OfflineCapture[])
    req.onerror = () => reject(req.error)
  })
}

/** Number of captures awaiting Whisper transcription */
export async function getPendingCount(): Promise<number> {
  try {
    const pending = await getPendingCaptures()
    return pending.length
  } catch {
    return 0
  }
}

// ── Whisper helper (mirrors VoiceHub.transcribeAudioBlob, no voice.ts dep) ────

async function transcribeBlob(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer()
  const uint8 = new Uint8Array(arrayBuffer)
  let binary = ''
  for (let i = 0; i < uint8.byteLength; i++) binary += String.fromCharCode(uint8[i])
  const base64 = btoa(binary)
  const mimeType = blob.type || 'audio/webm'
  const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm'
  const res = await fetch('/.netlify/functions/whisper', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio: base64, filename: `capture.${ext}`, language: 'en' }),
  })
  if (!res.ok) throw new Error(`Whisper ${res.status}`)
  const data = await res.json()
  return (data.text || '').trim()
}

const CAPTURE_HISTORY_KEY = 'poweron_quick_captures'

/**
 * Retry Whisper transcription for every unsynced capture.
 *
 * @param onSynced — called after each successful sync with (id, transcript)
 *                   so callers can refresh their local React state.
 */
export async function syncPendingCaptures(
  onSynced?: (id: string, transcript: string) => void,
): Promise<void> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return

  let pending: OfflineCapture[]
  try {
    pending = await getPendingCaptures()
  } catch {
    return // IndexedDB unavailable — bail silently
  }

  for (const capture of pending) {
    try {
      const transcript = await transcribeBlob(capture.audioBlob)
      if (!transcript) continue

      await updateCaptureTranscript(capture.id, transcript)

      // Mirror update into localStorage so the existing UI reads it
      try {
        const raw = localStorage.getItem(CAPTURE_HISTORY_KEY)
        const history: Array<Record<string, unknown>> = raw ? JSON.parse(raw) : []
        const idx = history.findIndex((e) => e.id === capture.id)
        if (idx >= 0) {
          history[idx] = { ...history[idx], transcript, synced: true }
        } else {
          // Entry not yet in localStorage (e.g. captured while offline, never saved by handleSave)
          history.unshift({
            id: capture.id,
            timestamp: capture.timestamp,
            durationSecs: 0,
            category: capture.category,
            transcript,
            synced: true,
          })
        }
        localStorage.setItem(CAPTURE_HISTORY_KEY, JSON.stringify(history.slice(0, 50)))
      } catch { /* storage unavailable */ }

      onSynced?.(capture.id, transcript)
    } catch {
      // Whisper failed — leave synced=false, will retry next interval
    }
  }
}
