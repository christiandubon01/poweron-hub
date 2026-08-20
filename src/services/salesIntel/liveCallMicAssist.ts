/**
 * COACH-LINK-4B1 — Browser mic capture helpers for Live Call Assist.
 *
 * Isolated from Practice / SparkTrainingVoice. Transcription uses the shared
 * Whisper frontend authority (`transcribeWithWhisper`). No audio persistence.
 */

import { transcribeWithWhisper } from '@/api/voice/whisper'

export type MicAssistPhase =
  | 'idle'
  | 'requesting'
  | 'recording'
  | 'transcribing'
  | 'error'

export const MIC_PERMISSION_FALLBACK =
  'Microphone unavailable. You can still type what the customer said.'

export const MIC_WHISPER_FALLBACK =
  'Transcription failed. You can still type what the customer said.'

/** Missing/expired Supabase JWT for /.netlify/functions/whisper (SEC2). */
export const MIC_AUTH_FALLBACK =
  'Transcription session expired. Sign in again and retry.'

/** Upstream / issuer verification failure (not a missing browser JWT). */
export const MIC_VERIFY_FALLBACK =
  'Transcription authentication could not be verified.'

export const MIC_EMPTY_RECORDING_FALLBACK =
  'No audio captured. Try again, or type what the customer said.'

export const MIC_BROWSER_DISCLAIMER =
  "Uses this device's microphone. What it can hear from a phone call depends on your Windows/audio setup."

/**
 * Map Whisper/mic failures to owner-safe Live Call copy.
 * Distinguishes auth / verify / empty recording / mic / generic Whisper without
 * exposing tokens or backend internals.
 */
export function mapLiveCallMicError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  if (/could not be verified|valid issuer|invalid_issuer/i.test(msg)) {
    return MIC_VERIFY_FALLBACK
  }
  if (
    /signed in|sign in again|Authentication required|session expired/i.test(
      msg,
    )
  ) {
    return MIC_AUTH_FALLBACK
  }
  if (/Microphone unavailable/i.test(msg)) {
    return MIC_PERMISSION_FALLBACK
  }
  if (/No audio captured|empty recording|audio file too large/i.test(msg)) {
    return /audio file too large/i.test(msg)
      ? MIC_WHISPER_FALLBACK
      : MIC_EMPTY_RECORDING_FALLBACK
  }
  return MIC_WHISPER_FALLBACK
}

const RECORDER_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg',
] as const

/** Pick a MediaRecorder MIME the browser supports; undefined → let browser choose. */
export function pickSupportedRecorderMimeType(
  isTypeSupported: (type: string) => boolean = (type) =>
    typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type),
): string | undefined {
  for (const type of RECORDER_MIME_CANDIDATES) {
    try {
      if (isTypeSupported(type)) return type
    } catch {
      // ignore unsupported probe errors
    }
  }
  return undefined
}

/** Stop every track on a stream (safe on null/already-stopped). */
export function releaseMediaStream(stream: MediaStream | null | undefined): void {
  if (!stream) return
  for (const track of stream.getTracks()) {
    try {
      track.stop()
    } catch {
      // ignore
    }
  }
}

/**
 * Insert Whisper transcript into the existing Live Coach textarea.
 * Empty field → replace. Non-empty → append with a blank-line separator
 * (never silently overwrite owner typing).
 */
export function mergeTranscriptIntoOwnerNote(
  existing: string,
  transcript: string,
): string {
  const next = transcript.trim()
  if (!next) return existing
  const prev = existing.trimEnd()
  if (!prev) return next
  return `${prev}\n\n${next}`
}

export function blobMimeBase(mimeType: string): string {
  const base = (mimeType || 'audio/webm').split(';')[0].trim()
  return base || 'audio/webm'
}

/** Transcribe a captured browser Blob via shared Whisper client. */
export async function transcribeLiveCallMicBlob(
  audioBlob: Blob,
): Promise<string> {
  const result = await transcribeWithWhisper(audioBlob, {
    language: 'en',
    temperature: 0.2,
    prompt: 'Electrical contractor sales call. Owner coaching notes.',
  })
  return (result.text || '').trim()
}

/**
 * One-at-a-time browser mic session for Call Assist.
 * Prevents duplicate MediaRecorders; never persists audio.
 */
export class LiveCallMicSession {
  private stream: MediaStream | null = null
  private recorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  private mimeType = 'audio/webm'

  get isActive(): boolean {
    return this.recorder != null || this.stream != null
  }

  get recordingMimeType(): string {
    return this.mimeType
  }

  async start(
    getUserMedia?: (
      constraints: MediaStreamConstraints,
    ) => Promise<MediaStream>,
  ): Promise<void> {
    if (this.isActive) {
      throw new Error('Mic session already active')
    }
    if (typeof MediaRecorder === 'undefined') {
      throw new Error(MIC_PERMISSION_FALLBACK)
    }

    const requestMic =
      getUserMedia ??
      ((constraints: MediaStreamConstraints) => {
        if (
          typeof navigator === 'undefined' ||
          !navigator.mediaDevices?.getUserMedia
        ) {
          return Promise.reject(new Error(MIC_PERMISSION_FALLBACK))
        }
        return navigator.mediaDevices.getUserMedia(constraints)
      })

    let stream: MediaStream
    try {
      stream = await requestMic({ audio: true })
    } catch {
      throw new Error(MIC_PERMISSION_FALLBACK)
    }
    this.stream = stream
    this.chunks = []

    const mime = pickSupportedRecorderMimeType()
    this.mimeType = mime ? blobMimeBase(mime) : 'audio/webm'

    let recorder: MediaRecorder
    try {
      recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream)
      if (recorder.mimeType) {
        this.mimeType = blobMimeBase(recorder.mimeType)
      }
    } catch {
      releaseMediaStream(stream)
      this.stream = null
      throw new Error(MIC_PERMISSION_FALLBACK)
    }

    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) {
        this.chunks.push(event.data)
      }
    }

    this.recorder = recorder
    try {
      recorder.start()
    } catch {
      this.cancel()
      throw new Error(MIC_PERMISSION_FALLBACK)
    }
  }

  /** Stop recorder, release tracks, return Blob for Whisper (or empty). */
  async stopAndCollect(): Promise<Blob> {
    const recorder = this.recorder
    const stream = this.stream
    const mimeType = this.mimeType

    if (!recorder) {
      releaseMediaStream(stream)
      this.stream = null
      this.chunks = []
      return new Blob([], { type: mimeType })
    }

    const blob = await new Promise<Blob>((resolve) => {
      const finish = () => {
        const out = new Blob(this.chunks, { type: mimeType })
        this.chunks = []
        resolve(out)
      }
      recorder.onstop = () => finish()
      try {
        if (recorder.state !== 'inactive') recorder.stop()
        else finish()
      } catch {
        finish()
      }
    })

    releaseMediaStream(stream)
    this.stream = null
    this.recorder = null
    this.chunks = []
    return blob
  }

  /** Stop + release + discard; no Whisper. */
  cancel(): void {
    const recorder = this.recorder
    const stream = this.stream
    this.recorder = null
    this.stream = null
    this.chunks = []
    if (recorder) {
      try {
        recorder.ondataavailable = null
        recorder.onstop = null
        if (recorder.state !== 'inactive') recorder.stop()
      } catch {
        // ignore
      }
    }
    releaseMediaStream(stream)
  }
}
