/**
 * ElevenLabs API Integration — Text-to-Speech
 *
 * Converts agent response text into natural-sounding audio.
 * Supports multiple voices, speed control, and streaming.
 * Requires VITE_ELEVEN_LABS_API_KEY in .env
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface ElevenLabsVoice {
  voice_id: string
  name: string
  category: 'premade' | 'cloned'
  gender: 'male' | 'female'
  settings?: {
    stability: number         // 0-1, higher = more consistent
    similarity_boost: number  // 0-1, higher = closer to original voice
  }
}

export interface TTSRequest {
  text: string
  voice_id: string
  model_id?: string           // 'eleven_turbo_v2_5' (default) | 'eleven_multilingual_v2'
  voice_settings?: {
    stability: number
    similarity_boost: number
    style?: number            // 0-1, expressiveness
    use_speaker_boost?: boolean
  }
  speed?: number              // 0.5-2.0
}

export interface TTSResponse {
  audioBlob: Blob
  audioUrl: string            // Object URL for playback
  durationSeconds: number     // Estimated duration
  charactersProcessed: number
}

// ── Available Voices ─────────────────────────────────────────────────────────

export const AVAILABLE_VOICES: ElevenLabsVoice[] = [
  {
    voice_id: 'pNInz6obpgDQGcFmaJgB',
    name: 'Adam',
    category: 'premade',
    gender: 'male',
    settings: { stability: 0.75, similarity_boost: 0.75 },
  },
  {
    voice_id: 'EXAVITQu4vr4xnSDxMaL',
    name: 'Bella',
    category: 'premade',
    gender: 'female',
    settings: { stability: 0.7, similarity_boost: 0.8 },
  },
  {
    voice_id: 'VR6AewLTigWG4xSOukaG',
    name: 'Arnold',
    category: 'premade',
    gender: 'male',
    settings: { stability: 0.8, similarity_boost: 0.7 },
  },
  {
    voice_id: 'AZnzlk1XvdvUeBnXmlld',
    name: 'Domi',
    category: 'premade',
    gender: 'female',
    settings: { stability: 0.65, similarity_boost: 0.85 },
  },
]

export const DEFAULT_VOICE_ID = AVAILABLE_VOICES[0].voice_id // Adam

// ── Constants ────────────────────────────────────────────────────────────────

const ELEVEN_LABS_BASE_URL = 'https://api.elevenlabs.io/v1'
const MAX_TEXT_LENGTH = 5000   // ElevenLabs character limit per request
const WORDS_PER_MINUTE = 150   // Average speaking rate for duration estimation

// ── Implementation ───────────────────────────────────────────────────────────

/**
 * Synthesize speech from text using ElevenLabs API.
 * Returns audio blob and object URL for playback.
 */
export async function synthesizeWithElevenLabs(request: TTSRequest): Promise<TTSResponse> {
  const apiKey = import.meta.env.VITE_ELEVEN_LABS_API_KEY

  if (!apiKey) {
    throw new Error('VITE_ELEVEN_LABS_API_KEY not configured. Add it to your .env file.')
  }

  if (!request.text || request.text.trim().length === 0) {
    throw new Error('Text is required for speech synthesis.')
  }

  // Truncate if too long
  const text = request.text.length > MAX_TEXT_LENGTH
    ? request.text.slice(0, MAX_TEXT_LENGTH) + '...'
    : request.text

  const voiceId = request.voice_id || DEFAULT_VOICE_ID

  console.log(`[ElevenLabs] Synthesizing ${text.length} chars with voice ${voiceId}...`)

  const response = await fetch(
    `${ELEVEN_LABS_BASE_URL}/text-to-speech/${voiceId}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: request.model_id || 'eleven_turbo_v2_5',
        voice_settings: request.voice_settings || {
          stability: 0.75,
          similarity_boost: 0.75,
          style: 0.5,
          use_speaker_boost: true,
        },
      }),
    }
  )

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'Unknown error')
    throw new Error(`ElevenLabs API error (${response.status}): ${errorBody}`)
  }

  const audioBlob = await response.blob()
  const audioUrl = URL.createObjectURL(audioBlob)

  // Estimate duration from word count
  const words = text.split(/\s+/).length
  const speed = request.speed || 1.0
  const durationSeconds = (words / WORDS_PER_MINUTE) * 60 / speed

  const result: TTSResponse = {
    audioBlob,
    audioUrl,
    durationSeconds: Number(durationSeconds.toFixed(1)),
    charactersProcessed: text.length,
  }

  console.log(`[ElevenLabs] Synthesized ~${result.durationSeconds}s audio (${(audioBlob.size / 1024).toFixed(0)}KB)`)

  return result
}

/**
 * Stream TTS audio for lower latency on longer responses.
 * Returns a ReadableStream of audio chunks.
 */
export async function streamSynthesis(
  text: string,
  voiceId: string = DEFAULT_VOICE_ID
): Promise<ReadableStream<Uint8Array> | null> {
  const apiKey = import.meta.env.VITE_ELEVEN_LABS_API_KEY
  if (!apiKey) throw new Error('VITE_ELEVEN_LABS_API_KEY not configured.')

  const response = await fetch(
    `${ELEVEN_LABS_BASE_URL}/text-to-speech/${voiceId}/stream`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: { stability: 0.75, similarity_boost: 0.75 },
      }),
    }
  )

  if (!response.ok) {
    throw new Error(`ElevenLabs stream error (${response.status})`)
  }

  return response.body
}

/**
 * Get a voice by name.
 */
export function getVoiceByName(name: string): ElevenLabsVoice | undefined {
  return AVAILABLE_VOICES.find(v => v.name.toLowerCase() === name.toLowerCase())
}

/**
 * Get a voice by ID.
 */
export function getVoiceById(voiceId: string): ElevenLabsVoice | undefined {
  return AVAILABLE_VOICES.find(v => v.voice_id === voiceId)
}

/**
 * Revoke an audio object URL to free memory.
 */
export function revokeAudioUrl(url: string): void {
  try {
    URL.revokeObjectURL(url)
  } catch {
    // Ignore — URL may already be revoked
  }
}
