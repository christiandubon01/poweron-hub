/**
 * Whisper API Integration — Speech-to-Text
 *
 * Uses OpenAI's Whisper API to transcribe voice commands.
 * Supports audio preprocessing for job-site noise environments.
 * Requires VITE_OPENAI_API_KEY in .env
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface WhisperRequest {
  audio: Blob
  language?: string           // ISO 639-1, default 'en'
  temperature?: number        // 0-1, lower = more deterministic
  prompt?: string             // Optional context hint for Whisper
  timestampGranularities?: ('segment' | 'word')[]
}

export interface WhisperSegment {
  id: number
  seek: number
  start: number               // seconds
  end: number                 // seconds
  text: string
  avg_logprob: number
  compression_ratio: number
  no_speech_prob: number
}

export interface WhisperResponse {
  text: string
  language: string
  duration: number            // seconds
  segments?: WhisperSegment[]
}

// ── Constants ────────────────────────────────────────────────────────────────

const WHISPER_API_URL = 'https://api.openai.com/v1/audio/transcriptions'
const WHISPER_MODEL = 'whisper-1'
const MAX_AUDIO_SIZE_MB = 25   // Whisper limit
const SUPPORTED_FORMATS = ['audio/webm', 'audio/wav', 'audio/mp3', 'audio/mp4', 'audio/mpeg', 'audio/ogg']

// ── Implementation ───────────────────────────────────────────────────────────

/**
 * Transcribe audio using OpenAI Whisper API.
 * Returns transcribed text with confidence and timing metadata.
 */
export async function transcribeWithWhisper(
  audioBlob: Blob,
  options: {
    language?: string
    temperature?: number
    prompt?: string
    noiseDb?: number
  } = {}
): Promise<WhisperResponse> {
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY

  if (!apiKey) {
    throw new Error('VITE_OPENAI_API_KEY not configured. Add it to your .env file.')
  }

  // Validate audio size
  const sizeMb = audioBlob.size / (1024 * 1024)
  if (sizeMb > MAX_AUDIO_SIZE_MB) {
    throw new Error(`Audio file too large (${sizeMb.toFixed(1)}MB). Whisper limit is ${MAX_AUDIO_SIZE_MB}MB.`)
  }

  // Validate audio format
  if (!SUPPORTED_FORMATS.some(f => audioBlob.type.startsWith(f.split('/')[0]))) {
    console.warn(`[Whisper] Unexpected audio type: ${audioBlob.type}. Attempting transcription anyway.`)
  }

  // Build form data
  const formData = new FormData()

  // Whisper requires a filename with extension
  const ext = getExtensionFromMimeType(audioBlob.type)
  formData.append('file', audioBlob, `recording.${ext}`)
  formData.append('model', WHISPER_MODEL)
  formData.append('language', options.language || 'en')
  formData.append('response_format', 'verbose_json')
  formData.append('timestamp_granularities[]', 'segment')

  if (options.temperature !== undefined) {
    formData.append('temperature', String(options.temperature))
  }

  // Add context prompt for better accuracy in noisy environments
  if (options.prompt) {
    formData.append('prompt', options.prompt)
  } else if (options.noiseDb && options.noiseDb > 70) {
    // Provide construction/field context for noisy environments
    formData.append(
      'prompt',
      'PowerOn Hub electrical contracting. Commands like schedule, leads, invoices, estimates, crew, projects.'
    )
  }

  console.log(`[Whisper] Transcribing ${sizeMb.toFixed(2)}MB audio (${audioBlob.type})...`)

  const response = await fetch(WHISPER_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  })

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'Unknown error')
    throw new Error(`Whisper API error (${response.status}): ${errorBody}`)
  }

  const data = await response.json()

  const result: WhisperResponse = {
    text: data.text?.trim() || '',
    language: data.language || options.language || 'en',
    duration: data.duration || 0,
    segments: data.segments || [],
  }

  console.log(`[Whisper] Transcribed: "${result.text}" (${result.duration.toFixed(1)}s, lang=${result.language})`)

  return result
}

/**
 * Estimate transcription confidence from Whisper segments.
 * Returns 0-1 score based on average log probability.
 */
export function estimateConfidence(segments: WhisperSegment[]): number {
  if (!segments || segments.length === 0) return 0

  const avgLogProb =
    segments.reduce((sum, seg) => sum + seg.avg_logprob, 0) / segments.length

  // Convert log probability to 0-1 confidence
  // avg_logprob is typically between -1 (low confidence) and 0 (high confidence)
  const confidence = Math.max(0, Math.min(1, 1 + avgLogProb))

  return Number(confidence.toFixed(3))
}

/**
 * Check if a segment likely contains no speech (background noise).
 */
export function isNonSpeechSegment(segment: WhisperSegment): boolean {
  return segment.no_speech_prob > 0.8
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getExtensionFromMimeType(mimeType: string): string {
  const map: Record<string, string> = {
    'audio/webm': 'webm',
    'audio/wav': 'wav',
    'audio/mp3': 'mp3',
    'audio/mp4': 'mp4',
    'audio/mpeg': 'mp3',
    'audio/ogg': 'ogg',
    'audio/x-m4a': 'm4a',
  }
  return map[mimeType] || 'webm'
}
