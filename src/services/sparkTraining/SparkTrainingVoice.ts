/**
 * ST2 — SPARK Training Voice Pipeline
 * 
 * Voice-to-voice conversational practice for SPARK.
 * 
 * ARCHITECTURE:
 * User speaks → Whisper STT → Claude character response → ElevenLabs TTS → playback
 * 
 * LATENCY TARGET: < 3 seconds total
 * - Whisper: ~1s for short utterances
 * - Claude Haiku: ~0.5s response
 * - ElevenLabs: ~0.5s for first audio chunk
 * 
 * VOICE SETUP:
 * - Character: Adam Stone (NFG5qt843uXKj4pFvR7C) — different from NEXUS Oxley
 * - Model: eleven_turbo_v2_5 for low latency
 * - Stability: 0.5, Similarity: 0.7 (natural conversation feel)
 */

import { transcribeWithWhisper } from '@/api/voice/whisper'
import { synthesizeWithElevenLabs } from '@/api/voice/elevenLabs'
import {
  addUserTurn,
  addAssistantTurn,
  getHistory,
  clearBuffer,
} from '@/services/voice/conversationBuffer'
import type { ConversationEntry } from '@/services/voice/conversationBuffer'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type VoiceMode = 'voice-only' | 'voice-transcript' | 'text-only'

export interface PracticeRound {
  id: string
  startedAt: number
  mode: VoiceMode
  character: CharacterPersonality
  difficulty: 1 | 2 | 3 | 4 | 5
}

export interface CharacterPersonality {
  name: string
  voiceId: string      // ElevenLabs voice ID
  personality: string  // Brief personality description for Claude
  tone: string         // e.g., "professional", "skeptical", "friendly"
}

export interface TranscriptEntry {
  speaker: 'user' | 'character'
  text: string
  timestamp: number
  audioUrl?: string    // For character responses
}

export interface VoiceAudioChunk {
  text: string
  audioUrl: string
  durationSeconds: number
  isFirst: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

export const ADAM_STONE_VOICE: CharacterPersonality = {
  name: 'Adam Stone',
  voiceId: 'NFG5qt843uXKj4pFvR7C',  // Different from NEXUS Oxley (gOkFV1JMCt0G0n9xmBwV)
  personality: 'Curious but cautious estimator. Asks lots of clarifying questions about scope and timeline.',
  tone: 'professional, detail-oriented, slightly skeptical',
}

const SILENCE_THRESHOLD_MS = 1500  // 1.5 seconds of silence = end user turn
const WHISPER_LANGUAGE = 'en'      // ISO 639-1 code
const TTS_MODEL = 'eleven_turbo_v2_5'
const STABILITY = 0.5              // Varied for natural feel
const SIMILARITY_BOOST = 0.7       // Natural conversation

// ─────────────────────────────────────────────────────────────────────────────
// State & Recording
// ─────────────────────────────────────────────────────────────────────────────

let mediaRecorder: MediaRecorder | null = null
let recordedChunks: Blob[] = []
let silenceTimer: ReturnType<typeof setTimeout> | null = null
let lastAudioTime = Date.now()

/**
 * Start recording audio from microphone.
 * Automatically stops after SILENCE_THRESHOLD_MS of silence.
 */
export async function startMicCapture(
  onSilenceDetected: (audioBlob: Blob) => void
): Promise<void> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    
    mediaRecorder = new MediaRecorder(stream, {
      mimeType: 'audio/webm',
    })
    
    recordedChunks = []
    
    mediaRecorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size > 0) {
        recordedChunks.push(event.data)
        lastAudioTime = Date.now()
        
        // Reset silence timer on new audio data
        if (silenceTimer) clearTimeout(silenceTimer)
        silenceTimer = setTimeout(() => {
          stopMicCapture(onSilenceDetected)
        }, SILENCE_THRESHOLD_MS)
      }
    }
    
    mediaRecorder.start(100)  // Emit data every 100ms for real-time silence detection
    lastAudioTime = Date.now()
    
    console.log('[SparkVoice] Microphone capture started')
  } catch (err) {
    console.error('[SparkVoice] Mic capture failed:', err)
    throw err
  }
}

/**
 * Stop recording and return the captured audio blob.
 */
export async function stopMicCapture(
  callback?: (audioBlob: Blob) => void
): Promise<Blob> {
  if (!mediaRecorder) {
    console.warn('[SparkVoice] No active recording')
    return new Blob()
  }
  
  if (silenceTimer) {
    clearTimeout(silenceTimer)
    silenceTimer = null
  }
  
  return new Promise<Blob>((resolve) => {
    mediaRecorder!.onstop = () => {
      const audioBlob = new Blob(recordedChunks, { type: 'audio/webm' })
      mediaRecorder!.stream.getTracks().forEach(track => track.stop())
      mediaRecorder = null
      recordedChunks = []
      
      callback?.(audioBlob)
      resolve(audioBlob)
    }
    
    mediaRecorder!.stop()
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Input Pipeline: Whisper STT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Transcribe user speech to text via Whisper.
 * Returns transcript text and appends to conversation history.
 */
export async function transcribeUserSpeech(audioBlob: Blob): Promise<string> {
  try {
    console.log('[SparkVoice] Transcribing user audio...')
    const startTime = performance.now()
    
    const result = await transcribeWithWhisper(audioBlob, {
      language: WHISPER_LANGUAGE,
      temperature: 0.3,  // More deterministic for training
      prompt: 'Electrical contractor estimates and project discussions.',
    })
    
    const elapsed = performance.now() - startTime
    console.log(`[SparkVoice] Transcribed in ${(elapsed / 1000).toFixed(2)}s: "${result.text}"`)
    
    // Append to conversation history
    addUserTurn(result.text)
    
    return result.text
  } catch (err) {
    console.error('[SparkVoice] Transcription failed:', err)
    throw err
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Claude Character Response
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get character response from Claude using role-play engine.
 * Streams response chunks for faster TTS start.
 */
export async function getCharacterResponse(
  character: CharacterPersonality,
  userText: string,
  difficulty: 1 | 2 | 3 | 4 | 5
): Promise<string> {
  try {
    console.log('[SparkVoice] Requesting character response from Claude...')
    const startTime = performance.now()
    
    // Build system prompt for character role-play
    const systemPrompt = buildCharacterSystemPrompt(character, difficulty)
    
    // Get conversation history for context
    const conversationHistory = getHistory()
    
    // Prepare messages array
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      ...conversationHistory,
      { role: 'user', content: userText }
    ]
    
    // Call Claude via netlify function
    const response = await fetch('/.netlify/functions/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemPrompt,
        messages,
        model: 'claude-3-5-haiku-20241022',  // Fast + capable for character responses
        maxTokens: 300,  // Keep responses concise for natural conversation
      })
    })
    
    if (!response.ok) {
      throw new Error(`Claude API error: ${response.status}`)
    }
    
    const data = await response.json()
    const characterText = data.content || ''
    
    const elapsed = performance.now() - startTime
    console.log(`[SparkVoice] Character response in ${(elapsed / 1000).toFixed(2)}s: "${characterText}"`)
    
    // Append to history
    addAssistantTurn(characterText)
    
    return characterText
  } catch (err) {
    console.error('[SparkVoice] Character response failed:', err)
    throw err
  }
}

/**
 * Build system prompt for character role-play.
 * Adjusts difficulty via scenario tension/objections.
 */
function buildCharacterSystemPrompt(
  character: CharacterPersonality,
  difficulty: 1 | 2 | 3 | 4 | 5
): string {
  const difficultyGuide: Record<number, string> = {
    1: 'Easy: Be cooperative and interested. Ask basic clarifying questions.',
    2: 'Medium: Show some skepticism. Mention budget concerns. Ask for timeline.',
    3: 'Hard: Raise 2-3 legitimate objections. Mention competitor quotes.',
    4: 'Harder: Push back on pricing. Question scope. Demand guarantees.',
    5: 'Expert: Aggressive objections. Price pressure. Consider walking away.',
  }
  
  return `You are ${character.name}, an estimator with a ${character.tone} personality.

${character.personality}

Difficulty level: ${difficultyGuide[difficulty]}

Keep responses natural and conversational. Ask follow-up questions to understand scope better. Respond in 1-3 sentences typically. Stay in character throughout the conversation.`
}

// ─────────────────────────────────────────────────────────────────────────────
// Output Pipeline: ElevenLabs TTS + Chunked Playback
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert character text to speech with low-latency chunking.
 * Yields audio chunks for immediate playback (don't wait for full response).
 */
export async function* characterSpeechGenerator(
  characterText: string,
  character: CharacterPersonality
): AsyncGenerator<VoiceAudioChunk> {
  try {
    console.log('[SparkVoice] Generating character audio...')
    const startTime = performance.now()
    
    // Split into sentences for faster TTS start
    const sentences = splitIntoSentences(characterText)
    
    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i].trim()
      if (!sentence) continue
      
      try {
        console.log(`[SparkVoice] Synthesizing sentence ${i + 1}/${sentences.length}...`)
        
        const ttsResult = await synthesizeWithElevenLabs({
          text: sentence,
          voice_id: character.voiceId,
          model_id: TTS_MODEL,
          voice_settings: {
            stability: STABILITY,
            similarity_boost: SIMILARITY_BOOST,
          }
        })
        
        const elapsed = performance.now() - startTime
        console.log(`[SparkVoice] Audio chunk ${i + 1} ready in ${(elapsed / 1000).toFixed(2)}s`)
        
        yield {
          text: sentence,
          audioUrl: ttsResult.audioUrl,
          durationSeconds: ttsResult.durationSeconds,
          isFirst: i === 0,
        }
      } catch (sentenceErr) {
        console.error(`[SparkVoice] Failed to synthesize sentence ${i + 1}:`, sentenceErr)
        // Continue with next sentence instead of failing entire response
      }
    }
  } catch (err) {
    console.error('[SparkVoice] Character speech generation failed:', err)
    throw err
  }
}

/**
 * Split text into sentences for chunked TTS.
 * Simple regex-based splitting; good enough for training context.
 */
function splitIntoSentences(text: string): string[] {
  // Split on periods, exclamation marks, question marks
  // But preserve the punctuation
  const sentences = text.split(/(?<=[.!?])\s+/)
  return sentences.filter(s => s.length > 0)
}

// ─────────────────────────────────────────────────────────────────────────────
// Playback Control
// ─────────────────────────────────────────────────────────────────────────────

let currentAudioElement: HTMLAudioElement | null = null

/**
 * Play audio chunk and wait for completion.
 */
export async function playAudioChunk(audioUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      if (currentAudioElement) {
        currentAudioElement.pause()
      }
      
      currentAudioElement = new Audio(audioUrl)
      currentAudioElement.playbackRate = 1.0
      
      currentAudioElement.onended = () => {
        resolve()
      }
      
      currentAudioElement.onerror = (err) => {
        reject(err)
      }
      
      currentAudioElement.play().catch(reject)
    } catch (err) {
      reject(err)
    }
  })
}

/**
 * Stop any currently playing audio.
 */
export function stopAudio(): void {
  if (currentAudioElement) {
    currentAudioElement.pause()
    currentAudioElement.currentTime = 0
    currentAudioElement = null
  }
}

/**
 * Set volume for character audio (0-1).
 */
export function setCharacterVolume(volume: number): void {
  if (currentAudioElement) {
    currentAudioElement.volume = Math.max(0, Math.min(1, volume))
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Conversation Management
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Clear conversation history for new round.
 */
export function clearConversationHistory(): void {
  clearBuffer()
}

/**
 * Get current conversation as transcript entries.
 */
export function getConversationTranscript(): TranscriptEntry[] {
  const history = getHistory()
  return history.map((entry, idx) => ({
    speaker: entry.role === 'user' ? 'user' : 'character',
    text: entry.content,
    timestamp: Date.now() - (history.length - idx) * 1000,
  }))
}

// ─────────────────────────────────────────────────────────────────────────────
// Exported named exports
// ─────────────────────────────────────────────────────────────────────────────

export default {
  startMicCapture,
  stopMicCapture,
  transcribeUserSpeech,
  getCharacterResponse,
  characterSpeechGenerator,
  playAudioChunk,
  stopAudio,
  setCharacterVolume,
  clearConversationHistory,
  getConversationTranscript,
  ADAM_STONE_VOICE,
}
