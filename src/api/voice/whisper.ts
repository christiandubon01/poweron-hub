/**
 * Whisper API Integration — Speech-to-Text
 *
 * Uses Netlify proxy (/.netlify/functions/whisper) to call OpenAI Whisper API.
 * Falls back to direct API call with VITE_OPENAI_API_KEY if proxy unavailable.
 * Supports audio preprocessing for job-site noise environments.
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

const PROXY_URL = '/.netlify/functions/whisper'
const DIRECT_URL = 'https://api.openai.com/v1/audio/transcriptions'
const WHISPER_MODEL = 'whisper-1'
const MAX_AUDIO_SIZE_MB = 25   // Whisper limit
const SUPPORTED_FORMATS = ['audio/webm', 'audio/wav', 'audio/mp3', 'audio/mp4', 'audio/mpeg', 'audio/ogg']

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convert a Blob to a base64-encoded string.
 * B57 FIX 4: replaced single-byte loop (O(n) string concatenation, ~3-8s for 200KB WAV)
 * with 8 KB chunk spread — typically 10-30× faster for typical voice recordings.
 */
async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const CHUNK = 8192
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/** Build the prompt string for Whisper context */
function buildPrompt(options: { prompt?: string; noiseDb?: number }): string | undefined {
  if (options.prompt) return options.prompt
  if (options.noiseDb && options.noiseDb > 70) {
    return 'PowerOn Hub electrical contracting. Commands like schedule, leads, invoices, estimates, crew, projects.'
  }
  return undefined
}

// ── Implementation ───────────────────────────────────────────────────────────

/**
 * Transcribe audio via Netlify proxy → OpenAI Whisper API.
 * Falls back to direct API call if proxy is unavailable.
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
  // Validate audio size
  const sizeMb = audioBlob.size / (1024 * 1024)
  if (sizeMb > MAX_AUDIO_SIZE_MB) {
    throw new Error(`Audio file too large (${sizeMb.toFixed(1)}MB). Whisper limit is ${MAX_AUDIO_SIZE_MB}MB.`)
  }

  // Validate audio format
  if (!SUPPORTED_FORMATS.some(f => audioBlob.type.startsWith(f.split('/')[0]))) {
    console.warn(`[Whisper] Unexpected audio type: ${audioBlob.type}. Attempting transcription anyway.`)
  }

  const ext = getExtensionFromMimeType(audioBlob.type)
  const promptText = buildPrompt(options)

  console.log(`[Whisper] Transcribing ${sizeMb.toFixed(2)}MB audio (${audioBlob.type})...`)

  // ── Try 1: Netlify proxy (sends base64 JSON, keeps API key server-side) ──
  try {
    const base64Audio = await blobToBase64(audioBlob)

    const proxyBody: Record<string, any> = {
      audio: base64Audio,
      filename: `recording.${ext}`,
      language: options.language || 'en',
    }
    if (options.temperature !== undefined) proxyBody.temperature = options.temperature
    if (promptText) proxyBody.prompt = promptText

    const proxyRes = await fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(proxyBody),
    })

    if (proxyRes.ok) {
      const data = await proxyRes.json()
      const result = parseWhisperResponse(data, options.language)
      console.log(`[Whisper] Transcribed via proxy: "${result.text}" (${result.duration.toFixed(1)}s)`)
      return result
    }

    console.warn(`[Whisper] Proxy returned ${proxyRes.status}, falling back to direct API...`)
  } catch (proxyErr) {
    console.warn('[Whisper] Proxy unavailable, falling back to direct API...', proxyErr)
  }

  // ── Try 2: Direct OpenAI call (needs VITE_OPENAI_API_KEY, local dev only) ──
  const apiKey = import.meta.env.DEV ? import.meta.env.VITE_OPENAI_API_KEY : undefined
  if (!apiKey) {
    throw new Error('Whisper proxy unavailable and no VITE_OPENAI_API_KEY configured.')
  }

  const formData = new FormData()
  formData.append('file', audioBlob, `recording.${ext}`)
  formData.append('model', WHISPER_MODEL)
  formData.append('language', options.language || 'en')
  formData.append('response_format', 'verbose_json')
  formData.append('timestamp_granularities[]', 'segment')
  if (options.temperature !== undefined) formData.append('temperature', String(options.temperature))
  if (promptText) formData.append('prompt', promptText)

  const response = await fetch(DIRECT_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  })

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'Unknown error')
    throw new Error(`Whisper API error (${response.status}): ${errorBody}`)
  }

  const data = await response.json()
  const result = parseWhisperResponse(data, options.language)
  console.log(`[Whisper] Transcribed via direct API: "${result.text}" (${result.duration.toFixed(1)}s)`)
  return result
}

/** Parse raw Whisper API JSON into our typed WhisperResponse */
function parseWhisperResponse(data: any, fallbackLang?: string): WhisperResponse {
  return {
    text: data.text?.trim() || '',
    language: data.language || fallbackLang || 'en',
    duration: data.duration || 0,
    segments: data.segments || [],
  }
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
