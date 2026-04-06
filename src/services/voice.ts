// @ts-nocheck
/**
 * Core Voice Subsystem — Orchestrates the full voice pipeline
 *
 * Pipeline: Wake Word → Record → Preprocess → Whisper STT → NEXUS Route →
 *           Agent Execute → ElevenLabs TTS → Play Response → Log Session
 *
 * This is the main entry point for all voice interactions in PowerOn Hub.
 * Backend wiring only — UI components will be added in a later phase.
 */

import { transcribeWithWhisper, estimateConfidence } from '@/api/voice/whisper'
import { synthesizeWithElevenLabs, revokeAudioUrl, DEFAULT_VOICE_ID } from '@/api/voice/elevenLabs'
import { getAudioPreprocessor } from './audioPreprocessing'
import { getWakeWordDetector, type WakeWordConfig } from './wakeWordDetector'
import { callClaude, extractText } from './claudeProxy'
import { processMessage } from '@/agents/nexus'
import { supabase } from '@/lib/supabase'
import { addTranscriptEntry } from '@/components/voice/VoiceTranscriptPanel'

// ── Types ────────────────────────────────────────────────────────────────────

export type VoiceSessionStatus =
  | 'inactive'
  | 'listening'
  | 'recording'
  | 'transcribing'
  | 'processing'
  | 'responding'
  | 'complete'
  | 'error'

export type VoiceMode = 'normal' | 'field' | 'push_to_talk'

export interface VoiceSession {
  id: string
  orgId: string
  userId: string
  mode: VoiceMode
  status: VoiceSessionStatus
  startedAt: Date
  endedAt?: Date

  // Audio input
  audioDurationSeconds?: number
  noiseLevel?: number

  // Transcription
  transcriptRaw?: string
  transcriptConfidence?: number
  language?: string

  // Classification
  detectedIntent?: string
  targetAgent?: string

  // Response
  agentResponse?: string
  responseAudioUrl?: string
  responseVoiceId?: string
  responseDurationSeconds?: number

  // Error
  error?: string
}

export interface VoicePreferences {
  enabled: boolean
  ttsVoiceId: string
  ttsSpeed: number
  asrLanguage: string
  noiseSuppressionStrength: number
  wakeWordEnabled: boolean
  wakeWordPhrase: string
  fieldModeEnabled: boolean
  pushToTalkEnabled: boolean
  pushToTalkKey?: string
}

export type VoiceEventType =
  | 'status_changed'
  | 'wake_word_detected'
  | 'recording_started'
  | 'recording_stopped'
  | 'transcript_ready'
  | 'response_ready'
  | 'session_complete'
  | 'error'

export type VoiceEventCallback = (event: {
  type: VoiceEventType
  session?: VoiceSession
  data?: unknown
}) => void

// ── Debug Log (on-screen diagnostics when ?debug=1) ─────────────────────────
// Module-level log array consumed by VoiceActivationButton debug overlay.

export const voiceDebugLog: string[] = []
let _debugListeners: Set<() => void> = new Set()

/** Push a timestamped entry to the on-screen debug log. Max 80 entries. */
export function debugPush(msg: string): void {
  const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  voiceDebugLog.push(`[${ts}] ${msg}`)
  if (voiceDebugLog.length > 80) voiceDebugLog.shift()
  _debugListeners.forEach(fn => { try { fn() } catch { /* ignore */ } })
}

/** Subscribe to debug log updates. Returns unsubscribe function. */
export function onDebugUpdate(fn: () => void): () => void {
  _debugListeners.add(fn)
  return () => _debugListeners.delete(fn)
}

// ── Orb State Emitter ──────────────────────────────────────────────────────
// Allows NexusPresenceOrb to subscribe to real-time voice state changes.

type OrbStateListener = (status: VoiceSessionStatus) => void
let _orbListeners: Set<OrbStateListener> = new Set()
let _lastOrbState: VoiceSessionStatus = 'inactive'

/** Subscribe to orb state changes. Returns unsubscribe function. */
export function onOrbStateChange(fn: OrbStateListener): () => void {
  _orbListeners.add(fn)
  // Immediately fire with current state so subscriber syncs on mount
  fn(_lastOrbState)
  return () => _orbListeners.delete(fn)
}

/** Emit orb state to all listeners. Called internally at every setStatus() transition. */
function emitOrbState(status: VoiceSessionStatus): void {
  _lastOrbState = status
  _orbListeners.forEach(fn => { try { fn(status) } catch { /* ignore */ } })
}

// ── iOS AudioContext Singleton ───────────────────────────────────────────────
// iOS Safari only allows AudioContext creation and resume during a user gesture.
// This module-level singleton is unlocked on the first mic-button tap and reused
// for all subsequent TTS playback. Creating a new context at playback time is
// too late — the async pipeline between tap and playback breaks the gesture chain.

let unlockedAudioContext: AudioContext | null = null

/**
 * Pre-unlock the AudioContext on a user gesture (tap/click).
 * MUST be called synchronously in the same call stack as the gesture event.
 * Plays a silent buffer to fully satisfy iOS autoplay policy.
 *
 * Note: TTS playback now uses Howler.js which handles iOS Safari autoplay
 * restrictions internally. This AudioContext unlock is retained for
 * getUserMedia / recording warm-up on iOS.
 */
export function unlockAudioContext(): void {
  if (!unlockedAudioContext) {
    unlockedAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
    debugPush(`AudioContext CREATED — state: ${unlockedAudioContext.state}`)
    console.log('[iOS Audio] Shared AudioContext created, state:', unlockedAudioContext.state)
  }
  if (unlockedAudioContext.state === 'suspended') {
    unlockedAudioContext.resume()
    debugPush(`AudioContext RESUMED — state: ${unlockedAudioContext.state}`)
    console.log('[iOS Audio] Shared AudioContext resumed')
  }
  debugPush(`unlockAudioContext() called — state: ${unlockedAudioContext.state}`)
  // Silent buffer unlock — fully satisfies iOS autoplay gate for AudioContext
  try {
    const silentBuffer = unlockedAudioContext.createBuffer(1, 1, 22050)
    const source = unlockedAudioContext.createBufferSource()
    source.buffer = silentBuffer
    source.connect(unlockedAudioContext.destination)
    source.start(0)
    debugPush('Silent buffer played — context fully unlocked')
    console.log('[iOS Audio] Silent buffer played — context fully unlocked')
  } catch (e) {
    debugPush(`Silent buffer ERROR: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/**
 * Get the shared pre-unlocked AudioContext (or null if not yet unlocked).
 */
export function getUnlockedAudioContext(): AudioContext | null {
  return unlockedAudioContext
}

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_RECORDING_SECONDS = 30
const DEFAULT_PREFERENCES: VoicePreferences = {
  enabled: true,
  ttsVoiceId: DEFAULT_VOICE_ID,
  ttsSpeed: 1.0,
  asrLanguage: 'en',
  noiseSuppressionStrength: 0.7,
  wakeWordEnabled: true,
  wakeWordPhrase: 'Hey NEXUS',
  fieldModeEnabled: true,
  pushToTalkEnabled: false,
  pushToTalkKey: 'Space',
}

// ── Implementation ───────────────────────────────────────────────────────────

export class VoiceSubsystem {
  private status: VoiceSessionStatus = 'inactive'
  private currentSession: VoiceSession | null = null
  private preferences: VoicePreferences = { ...DEFAULT_PREFERENCES }
  private listeners: Set<VoiceEventCallback> = new Set()

  // Recording state
  private mediaRecorder: MediaRecorder | null = null
  private mediaStream: MediaStream | null = null
  private audioChunks: Blob[] = []
  private recordingTimeout: ReturnType<typeof setTimeout> | null = null

  // Speaking state — mic suppression during TTS playback
  private currentAudio: HTMLAudioElement | null = null
  private lastTTSText: string = ''
  private speakingStartTime: number = 0
  private static readonly MIN_SPEAKING_DISPLAY_MS = 2000

  // iOS detection
  private static readonly IS_IOS = typeof navigator !== 'undefined' &&
    /iPhone|iPad|iPod/.test(navigator.userAgent)

  // AudioContext is now managed by the module-level singleton (unlockedAudioContext)
  // to ensure it's created on the user gesture call stack for iOS Safari.

  // Context
  private orgId: string = ''
  private userId: string = ''

  // Multi-turn conversation history — set by VoiceActivationButton before each recording
  // so voice queries share context with the text conversation thread.
  private conversationHistory: any[] = []

  /**
   * Initialize the voice subsystem with user context and preferences.
   */
  async initialize(config: {
    orgId: string
    userId: string
    preferences?: Partial<VoicePreferences>
    wakeWordConfig?: WakeWordConfig
  }): Promise<void> {
    this.orgId = config.orgId
    this.userId = config.userId

    // Load preferences from database or use provided/defaults
    if (config.preferences) {
      this.preferences = { ...DEFAULT_PREFERENCES, ...config.preferences }
    } else {
      await this.loadPreferences()
    }

    // Initialize wake word detector if enabled
    if (this.preferences.wakeWordEnabled) {
      const detector = getWakeWordDetector(config.wakeWordConfig)
      await detector.initialize()
      detector.onWakeWord(() => this.onWakeWordDetected())
    }

    // Startup checks — warn if API keys are missing (local dev only)
    if (import.meta.env.DEV && !import.meta.env.VITE_OPENAI_API_KEY) {
      console.warn('[Voice] VITE_OPENAI_API_KEY not set — Whisper will use Netlify proxy only. Direct fallback disabled.')
    }
    if (import.meta.env.DEV && !import.meta.env.VITE_ELEVENLABS_API_KEY) {
      console.warn('[Voice] VITE_ELEVENLABS_API_KEY not set — TTS will fall back to browser speechSynthesis.')
    }

    console.log('[Voice] Subsystem initialized', {
      orgId: this.orgId,
      wakeWord: this.preferences.wakeWordEnabled,
      ttsVoice: this.preferences.ttsVoiceId,
    })
  }

  /**
   * Start listening for the wake word (passive mode).
   */
  async startListening(): Promise<void> {
    if (!this.preferences.enabled) return

    if (this.preferences.wakeWordEnabled) {
      const detector = getWakeWordDetector()
      await detector.start()
    }

    this.setStatus('listening')
  }

  /**
   * Stop all voice activity.
   */
  async stopAll(): Promise<void> {
    // Stop any playing audio
    this.stopCurrentAudio()


    // Cancel browser speechSynthesis if active
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel()
    }

    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.stop()
    }

    const detector = getWakeWordDetector()
    await detector.stop()

    this.cleanupRecording()
    this.setStatus('inactive')
  }

  /**
   * Stop speaking only — interrupt TTS playback and return to idle.
   * Does NOT restart listening.
   */
  async stopSpeaking(): Promise<void> {
    console.log('[Voice] Stopping speech (user interrupt)')
    this.stopCurrentAudio()


    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel()
    }

    this.setStatus('inactive')
  }

  /**
   * Stop the current audio element if playing.
   */
  private stopCurrentAudio(): void {
    if (this.currentAudio) {
      try {
        this.currentAudio.pause()
        this.currentAudio.currentTime = 0
        this.currentAudio.src = ''
      } catch { /* ignore cleanup errors */ }
      this.currentAudio = null
    }
  }

  /**
   * Get the shared pre-unlocked AudioContext, or create a fallback.
   * Prefers the module-level singleton that was unlocked on user gesture.
   */
  private async ensureAudioContext(): Promise<AudioContext> {
    // Prefer the module-level singleton (unlocked on user tap)
    const shared = getUnlockedAudioContext()
    if (shared) {
      debugPush(`ensureAudioContext() — using shared, state: ${shared.state}`)
      if (shared.state === 'suspended') {
        await shared.resume()
        debugPush(`ensureAudioContext() — resumed, now: ${shared.state}`)
        console.log('[iOS Audio] Shared AudioContext resumed at playback time')
      }
      return shared
    }
    // Fallback: create one now (may fail on iOS if not in gesture stack)
    debugPush('ensureAudioContext() — NO shared context, creating fallback')
    console.warn('[iOS Audio] No pre-unlocked AudioContext — creating fallback (may fail on iOS)')
    unlockAudioContext()
    return getUnlockedAudioContext()!
  }

  /**
   * Start recording audio (triggered by wake word or push-to-talk).
   */
  async startRecording(mode: VoiceMode = 'normal'): Promise<void> {
    if (this.status === 'recording') return

    // Guard: require HTTPS (or localhost for dev)
    const proto = window.location.protocol
    const host = window.location.hostname
    if (proto !== 'https:' && host !== 'localhost' && host !== '127.0.0.1') {
      console.error('[Voice] Microphone requires HTTPS')
      this.setStatus('error')
      this.emit('error', { error: 'Microphone requires a secure connection (HTTPS). Please access the app via HTTPS.' })
      return
    }

    // Guard: navigator.mediaDevices must exist
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      console.error('[Voice] navigator.mediaDevices not available')
      this.setStatus('error')
      this.emit('error', { error: 'Microphone not available — please use HTTPS or grant microphone permission in your browser settings.' })
      return
    }

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: mode === 'field',
          autoGainControl: true,
          sampleRate: 16000,
        },
      })

      // Warm up AudioContext on user gesture (critical for iOS)
      // Note: The primary unlock happens synchronously in VoiceActivationButton's
      // tap handler via unlockAudioContext(). This is a secondary safety net.
      if (VoiceSubsystem.IS_IOS && !getUnlockedAudioContext()) {
        try {
          unlockAudioContext()
          console.log('[iOS Audio] AudioContext warmed on recording start (fallback)')
        } catch { /* ignore */ }
      }

      this.audioChunks = []
      this.mediaRecorder = new MediaRecorder(this.mediaStream, {
        mimeType: this.getSupportedMimeType(),
      })

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data)
        }
      }

      this.mediaRecorder.onstop = () => {
        this.processRecording(mode)
      }

      this.mediaRecorder.start(100) // Collect data every 100ms

      // Create new session
      this.currentSession = {
        id: crypto.randomUUID(),
        orgId: this.orgId,
        userId: this.userId,
        mode,
        status: 'recording',
        startedAt: new Date(),
      }

      this.setStatus('recording')
      this.emit('recording_started')

      // Auto-stop after max duration
      this.recordingTimeout = setTimeout(() => {
        this.stopRecording()
      }, MAX_RECORDING_SECONDS * 1000)

      console.log(`[Voice] Recording started (mode: ${mode})`)
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      const isPermissionDenied = errMsg.includes('Permission') || errMsg.includes('NotAllowedError') || errMsg.includes('permission')
      const userMessage = isPermissionDenied
        ? 'Microphone access blocked. Tap the lock icon in your browser and allow microphone.'
        : `Microphone error: ${errMsg}`
      console.error('[Voice] Failed to start recording:', err)
      this.setStatus('error')
      this.emit('error', { error: userMessage, permissionDenied: isPermissionDenied })
    }
  }

  /**
   * Stop recording and begin processing.
   */
  async stopRecording(): Promise<void> {
    if (this.recordingTimeout) {
      clearTimeout(this.recordingTimeout)
      this.recordingTimeout = null
    }

    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.stop()
      console.log('[Voice] Recording stopped')
      this.emit('recording_stopped')
    }
  }

  /**
   * Process a voice command from text (bypass recording/transcription).
   * Useful for testing or text-based voice commands.
   */
  async processTextCommand(text: string, mode: VoiceMode = 'normal'): Promise<VoiceSession> {
    this.currentSession = {
      id: crypto.randomUUID(),
      orgId: this.orgId,
      userId: this.userId,
      mode,
      status: 'processing',
      startedAt: new Date(),
      transcriptRaw: text,
      transcriptConfidence: 1.0,
      language: 'en',
    }

    return this.executeVoicePipeline(text)
  }

  /**
   * Subscribe to voice events.
   */
  on(callback: VoiceEventCallback): () => void {
    this.listeners.add(callback)
    return () => this.listeners.delete(callback)
  }

  /**
   * Get current voice status.
   */
  getStatus(): VoiceSessionStatus {
    return this.status
  }

  /**
   * Get current session.
   */
  getCurrentSession(): VoiceSession | null {
    return this.currentSession
  }

  /**
   * Get voice preferences.
   */
  getPreferences(): VoicePreferences {
    return { ...this.preferences }
  }

  /**
   * Set conversation history for the next voice pipeline call.
   * Called by VoiceActivationButton before startRecording() so the
   * voice path shares the same multi-turn context as text input.
   */
  setConversationHistory(history: any[]): void {
    this.conversationHistory = [...history]
  }

  /**
   * Update voice preferences.
   */
  async updatePreferences(updates: Partial<VoicePreferences>): Promise<void> {
    this.preferences = { ...this.preferences, ...updates }
    await this.savePreferences()
  }

  /**
   * Release all resources.
   */
  async dispose(): Promise<void> {
    await this.stopAll()

    const detector = getWakeWordDetector()
    await detector.dispose()

    const preprocessor = getAudioPreprocessor()
    await preprocessor.dispose()

    this.listeners.clear()
    console.log('[Voice] Subsystem disposed')
  }

  // ── Private: Pipeline ─────────────────────────────────────────────────────

  /**
   * Process recorded audio through the full voice pipeline.
   */
  private async processRecording(mode: VoiceMode): Promise<void> {
    if (this.audioChunks.length === 0) {
      console.warn('[Voice] No audio data recorded')
      this.setStatus('inactive')
      return
    }

    const audioBlob = new Blob(this.audioChunks, { type: this.getSupportedMimeType() })
    console.log('[Voice] Blob captured — size:', audioBlob.size, 'bytes, type:', audioBlob.type)
    this.cleanupRecording()

    try {
      // Step 1: Preprocess audio
      this.setStatus('transcribing')
      const preprocessor = getAudioPreprocessor()

      const analysis = await preprocessor.analyze(audioBlob)
      console.log('[Voice] Audio analysis — duration:', analysis.durationSeconds.toFixed(2), 's, hasVoiceActivity:', analysis.hasVoiceActivity, 'rms:', analysis.rmsLevel?.toFixed(4))
      if (this.currentSession) {
        this.currentSession.audioDurationSeconds = analysis.durationSeconds
        this.currentSession.noiseLevel = analysis.estimatedNoiseDb
      }

      // Guard: too short to transcribe
      if (analysis.durationSeconds < 0.5) {
        console.log('[Voice] Recording too short:', analysis.durationSeconds.toFixed(2), 's — skipping Whisper')
        this.setStatus('inactive')
        this.emit('error', { error: 'Too short — speak for at least half a second, then pause.' })
        return
      }

      if (!analysis.hasVoiceActivity) {
        console.log('[Voice] No voice activity detected')
        this.setStatus('inactive')
        this.emit('error', { error: 'No speech detected. Speak clearly into the mic and try again.' })
        return
      }

      const processedAudio = await preprocessor.preprocess(audioBlob, {
        targetSampleRate: 16000,
        noiseSuppressionStrength: mode === 'field'
          ? this.preferences.noiseSuppressionStrength
          : 0,
      })

      // Step 2: Transcribe with Whisper
      console.log('[Whisper] Sending audio to proxy — size:', processedAudio.size, 'bytes, type:', processedAudio.type)
      const whisperResult = await transcribeWithWhisper(processedAudio, {
        language: this.preferences.asrLanguage,
        noiseDb: analysis.estimatedNoiseDb,
      })
      console.log('[Whisper] Response received — text length:', whisperResult.text?.length, 'text:', whisperResult.text?.substring(0, 80))

      if (!whisperResult.text || whisperResult.text.trim().length === 0) {
        console.log('[Voice] Empty transcription from Whisper')
        this.setStatus('inactive')
        this.emit('error', { error: 'No speech recognized. Try speaking closer to the mic.' })
        return
      }

      const confidence = estimateConfidence(whisperResult.segments || [])

      if (this.currentSession) {
        this.currentSession.transcriptRaw = whisperResult.text
        this.currentSession.transcriptConfidence = confidence
        this.currentSession.language = whisperResult.language
      }

      console.log('[Voice] Emitting transcript_ready — text:', whisperResult.text.substring(0, 80))
      this.emit('transcript_ready', { text: whisperResult.text, confidence })

      // Step 3-5: Route, execute, respond
      await this.executeVoicePipeline(whisperResult.text)
    } catch (err) {
      // FIX: always pass error as string so QuickCaptureButton can display it
      const errMsg = err instanceof Error ? err.message : String(err)
      console.error('[Voice] Pipeline error:', errMsg)
      if (this.currentSession) {
        this.currentSession.status = 'error'
        this.currentSession.error = errMsg
      }
      this.setStatus('error')
      this.emit('error', { error: errMsg })
    }
  }

  /**
   * Execute the voice pipeline from transcribed text to spoken response.
   * Tries full agent routing first; falls back to direct Claude call.
   */
  private async executeVoicePipeline(transcript: string): Promise<VoiceSession> {
    console.log('[Voice] Transcribed:', transcript)
    let responseText = ''

    // Step 3: Route through NEXUS processMessage — classifies AND gets Claude response in one call
    this.setStatus('processing')
    try {
      const nexusResult = await processMessage({
        message: transcript,
        orgId: this.orgId,
        userId: this.userId,
        conversationHistory: this.conversationHistory,
        isVoiceCommand: true,
      })

      // Use voiceSummary for TTS (conversational, max 150 words)
      // Keep full agent.content for display in transcript panel
      const voiceText = nexusResult?.voiceSummary || ''
      const fullDisplayText = nexusResult?.agent?.content || ''
      responseText = voiceText || fullDisplayText

      if (this.currentSession) {
        this.currentSession.detectedIntent = nexusResult?.intent?.category || 'general'
        this.currentSession.targetAgent = nexusResult?.intent?.targetAgent || 'nexus'
        // Store full display text for transcript panel (agentResponse = display version)
        this.currentSession.agentResponse = fullDisplayText
      }

      // FIX 1 — update internal conversation history so next voice turn has context
      this.conversationHistory = [
        ...this.conversationHistory,
        { role: 'user', content: transcript, timestamp: Date.now() },
        { role: 'assistant', content: fullDisplayText || responseText, timestamp: Date.now() + 1 },
      ].slice(-20)

      console.log('[Voice] NEXUS response received via', nexusResult?.intent?.targetAgent, '— voice:', responseText?.substring(0, 100))
    } catch (routeErr) {
      console.warn('[Voice] NEXUS processMessage failed, falling back to direct Claude:', routeErr)

      // Fallback: send transcript directly to Claude via proxy
      try {
        const NEXUS_SYSTEM = `You are NEXUS, the AI chief-of-staff for Power On Solutions, an electrical contracting company run by Christian Dubon in the Coachella Valley. You have direct access to all business data: projects, invoices, field logs, leads, scheduling, and financials.

COMMUNICATION RULES — follow these exactly:
- Talk to Christian like a sharp, trusted advisor who knows his business cold
- Lead with the answer, never with setup
- Be direct and specific — use actual numbers, project names, and dates from the data
- No filler phrases: never say 'Great question', 'Certainly', 'Absolutely', 'Of course'
- No bullet point walls — weave information into natural sentences when speaking
- After giving the core answer, offer one follow-up: 'Want me to dig into X?' or 'Should I route this to LEDGER?'
- Match his energy — if he's brief, be brief. If he's asking for analysis, go deeper
- When data is missing: say exactly what's missing and what would fix it — never hedge
- Field Mode (default): max 2 sentences + one action offer
- Review Mode: full analysis, connect the dots across agents, surface what he hasn't asked yet
- Sound human — use contractions, vary sentence length, don't read like a report

Your response will be spoken aloud via TTS — keep it conversational and under 3 sentences unless he asks for analysis.`
        const claudeResult = await callClaude({
          system: NEXUS_SYSTEM,
          messages: [{ role: 'user', content: transcript }],
          max_tokens: 512,
        })
        responseText = extractText(claudeResult)
        console.log('[Voice] Claude direct fallback response:', responseText?.substring(0, 100))
      } catch (claudeErr) {
        console.error('[Voice] Claude fallback also failed:', claudeErr)
        responseText = 'Sorry, I couldn\'t process that request. Please try again.'
      }
    }

    // Final guard — never send empty text to TTS
    if (!responseText || responseText.trim().length === 0) {
      responseText = 'I processed your request but could not generate a response. Please try again.'
      console.warn('[Voice] Empty response — using fallback text')
    }

    console.log('[Voice] Speaking:', responseText?.substring(0, 100))

    // agentResponse may already be set to fullDisplayText by NEXUS path above
    if (this.currentSession && !this.currentSession.agentResponse) {
      this.currentSession.agentResponse = responseText
    }

    // Add transcript entry — show full display text in panel, speak the voice summary
    const displayText = this.currentSession?.agentResponse || responseText
    addTranscriptEntry(transcript, displayText, this.currentSession?.targetAgent)

    // ── SPEAKING state: mic OFF, wake word OFF ─────────────────────────
    // Completely disable microphone and audio input before playing response
    // to prevent ambient noise from canceling playback on iPhone/iOS.
    this.setStatus('responding')
    this.speakingStartTime = Date.now()

    // Ensure mic is fully released
    this.cleanupRecording()

    // Stop wake word detector during playback
    try {
      const detector = getWakeWordDetector()
      await detector.stop()
    } catch { /* ignore */ }

    console.log('[Voice] Entering SPEAKING state — mic disabled')

    // FIX: read mute state fresh from localStorage at CALL TIME — not at component mount.
    // Muted = zero audio plays, zero ElevenLabs API calls made.
    // Text response still renders in transcript panel regardless of mute state.
    const isMuted = typeof window !== 'undefined' && localStorage.getItem('nexus_mute') === 'true'

    let ttsPlayed = false
    if (isMuted) {
      debugPush('TTS muted (nexus_mute=true) — skipping ElevenLabs call and WebSpeech fallback')
      console.log('[Voice] TTS muted — skipping audio playback')
      ttsPlayed = true // set true so WebSpeech fallback below is also skipped
    } else {
      try {
        // Hard safety guard — truncate TTS text to 300 characters max.
        // 300 chars ≈ 20-25 seconds of audio, safe for iOS blob playback.
        // 800 chars still produced 46s audio which choked Howler on mobile.
        const ttsText = responseText.slice(0, 300)
        debugPush(`ElevenLabs TTS — sending ${ttsText.length} chars (original ${responseText.length} chars)`)
        debugPush('ElevenLabs TTS — requesting synthesis...')
        // Read voice ID fresh at CALL TIME — never cache it
        // B15: prefer poweron_nexus_voice (curated 3-voice selector) then legacy nexus_voice_id
        const activeVoiceId = (typeof window !== 'undefined' && (localStorage.getItem('poweron_nexus_voice') || localStorage.getItem('nexus_voice_id')))
          || this.preferences.ttsVoiceId
          || DEFAULT_VOICE_ID
        // Read speech rate fresh at CALL TIME
        const speechRate = typeof window !== 'undefined'
          ? parseFloat(localStorage.getItem('nexus_speech_rate') || '1.0')
          : 1.0
        console.log('[ElevenLabs] Firing TTS call — voice_id:', activeVoiceId, ', rate:', speechRate)
        debugPush(`TTS voice ID: ${activeVoiceId}, rate: ${speechRate}`)

        const ttsResult = await synthesizeWithElevenLabs({
          text: ttsText,
          voice_id: activeVoiceId,
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
          speed: speechRate,
        })

        debugPush(`ElevenLabs TTS — received blob ${ttsResult.audioBlob.size} bytes, ~${ttsResult.durationSeconds}s`)

        if (this.currentSession) {
          this.currentSession.responseAudioUrl = ttsResult.audioUrl
          this.currentSession.responseVoiceId = activeVoiceId
          this.currentSession.responseDurationSeconds = ttsResult.durationSeconds
        }

        // Step 6: Play response (with interruptible audio reference)
        this.lastTTSText = ttsText
        debugPush(`TTS chars: ${ttsText.length}`)
        debugPush('playAudioTracked() — starting playback...')
        console.log('[Voice] Playing TTS audio')
        await this.playAudioTracked(ttsResult.audioUrl)
        debugPush('playAudioTracked() — playback completed')
        revokeAudioUrl(ttsResult.audioUrl)
        ttsPlayed = true
      } catch (ttsErr) {
        debugPush(`TTS ERROR: ${ttsErr instanceof Error ? ttsErr.message : String(ttsErr)}`)
        console.warn('[Voice] ElevenLabs TTS failed, trying speechSynthesis fallback:', ttsErr)
      }
    }

    // Fallback: browser Web Speech API (especially important for iOS)
    // FIX: also gate WebSpeech fallback behind mute check — re-read fresh from localStorage
    const isMutedForFallback = typeof window !== 'undefined' && localStorage.getItem('nexus_mute') === 'true'
    if (!ttsPlayed && !isMutedForFallback && typeof window !== 'undefined' && window.speechSynthesis) {
      try {
        debugPush('ElevenLabs/Howler failed — falling back to WebSpeech')
        console.log(VoiceSubsystem.IS_IOS ? '[iOS Audio] Falling back to WebSpeech' : '[Voice] Using WebSpeech fallback')
        await this.speakWithWebSpeech(responseText)
      } catch (synthErr) {
        debugPush(`WebSpeech fallback also failed: ${synthErr instanceof Error ? synthErr.message : String(synthErr)}`)
        console.warn('[Voice] WebSpeech also failed:', synthErr)
      }
    }

    // Enforce minimum display time (2s) so transcript is readable
    const elapsed = Date.now() - this.speakingStartTime
    if (elapsed < VoiceSubsystem.MIN_SPEAKING_DISPLAY_MS) {
      await new Promise(resolve => setTimeout(resolve, VoiceSubsystem.MIN_SPEAKING_DISPLAY_MS - elapsed))
    }

    // Step 7: Complete session
    if (this.currentSession) {
      this.currentSession.status = 'complete'
      this.currentSession.endedAt = new Date()
    }

    this.setStatus('complete')
    this.emit('session_complete', { session: this.currentSession })

    // Step 8: Log session to database
    await this.logSession()

    // Always return to IDLE — user must tap again to speak next message.
    // This prevents ambient noise from accidentally re-activating the mic.
    this.setStatus('inactive')

    return this.currentSession!
  }

  /**
   * Fallback TTS using browser's native Web Speech API (speechSynthesis).
   * Works on iOS Safari with no autoplay restrictions or permissions required.
   * Picks the best available English voice and truncates to 300 chars.
   */
  private speakWithWebSpeech(text: string): Promise<void> {
    return new Promise((resolve) => {
      if (!window.speechSynthesis) {
        debugPush('WebSpeech not available')
        resolve()
        return
      }

      const speak = () => {
        window.speechSynthesis.cancel()

        const utterance = new SpeechSynthesisUtterance(text.slice(0, 300))
        utterance.rate = 0.95
        utterance.pitch = 1.0
        utterance.volume = 1.0
        utterance.lang = 'en-US'

        const voices = window.speechSynthesis.getVoices()
        debugPush(`WebSpeech — ${voices.length} voices available`)
        const preferred = voices.find(v => v.lang.startsWith('en') && v.localService)
        if (preferred) {
          utterance.voice = preferred
          debugPush(`WebSpeech — using voice: ${preferred.name}`)
        }

        utterance.onstart = () => debugPush('WebSpeech — started speaking')
        utterance.onend = () => { debugPush('WebSpeech — done'); resolve() }
        utterance.onerror = (e) => { debugPush(`WebSpeech error: ${e.error}`); resolve() }

        window.speechSynthesis.speak(utterance)
        debugPush('WebSpeech — speak() called')
      }

      // iOS sometimes needs voices to load first
      const voices = window.speechSynthesis.getVoices()
      if (voices.length === 0) {
        debugPush('WebSpeech — waiting for voices to load')
        window.speechSynthesis.onvoiceschanged = () => { speak() }
      } else {
        speak()
      }

      // 30-second timeout fallback
      setTimeout(() => resolve(), 30000)
    })
  }

  // ── Private: Audio Playback ───────────────────────────────────────────────

  private playAudio(audioUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // iOS requires: set src, call load(), append to DOM, then play
      const audio = new Audio()
      audio.src = audioUrl
      // playbackRate = 1.0 — ElevenLabs already generates audio at the correct speed
      // via voice_settings.speed; applying playbackRate here would double the effect.
      audio.playbackRate = 1.0
      audio.load() // critical for iOS — forces buffering before play
      document.body.appendChild(audio) // required for iOS WebView audio playback
      audio.onended = () => {
        try { document.body.removeChild(audio) } catch { /* already removed */ }
        resolve()
      }
      audio.onerror = (err) => {
        try { document.body.removeChild(audio) } catch { /* already removed */ }
        reject(err)
      }
      audio.play().catch((e) => {
        console.error('[iOS] Play failed:', e)
        try { document.body.removeChild(audio) } catch { /* already removed */ }
        reject(e)
      })
    })
  }

  /**
   * Play audio with a tracked reference so it can be interrupted.
   * Uses direct HTMLAudioElement with playsInline for all platforms.
   * Falls back to Web Speech API if fetch/decode fails.
   */
  private async playAudioTracked(url: string): Promise<void> {
    debugPush('playAudioTracked() — starting')
    try {
      const response = await fetch(url)
      const arrayBuffer = await response.arrayBuffer()
      debugPush(`playAudioTracked() — fetched ${arrayBuffer.byteLength} bytes`)
      await this.playAudioDirect(arrayBuffer)
    } catch (err) {
      debugPush(`playAudioTracked() — fetch failed: ${(err as Error).message}, falling back to WebSpeech`)
      await this.speakWithWebSpeech(this.lastTTSText || '')
    }
  }

  /**
   * Direct HTMLAudioElement playback with playsInline.
   *
   * Chrome iOS responds to HTMLAudioElement with playsInline=true after a user
   * gesture on the domain. Safari iOS may still fail — the onerror/catch
   * handlers fall back to Web Speech API automatically.
   *
   * Includes 35-second timeout fallback.
   */
  private playAudioDirect(audioData: ArrayBuffer): Promise<void> {
    debugPush('playAudioDirect() — entering')
    const blob = new Blob([audioData], { type: 'audio/mpeg' })
    const url = URL.createObjectURL(blob)
    debugPush(`playAudioDirect() — Blob URL created (${blob.size} bytes)`)

    return new Promise<void>((resolve) => {
      let settled = false
      const safeResolve = () => {
        if (!settled) {
          settled = true
          clearTimeout(hangTimeout)
          resolve()
        }
      }

      const audio = new Audio()
      audio.playsInline = true
      audio.autoplay = false
      audio.src = url
      audio.volume = 1.0
      // playbackRate = 1.0 — ElevenLabs already generates audio at the correct speed
      // via voice_settings.speed; applying playbackRate would double the effect.
      audio.playbackRate = 1.0
      document.body.appendChild(audio)
      this.currentAudio = audio

      audio.onended = () => {
        // AUDIO FIX: add 300ms delay before cleanup to ensure full audio drains
        // before the promise resolves and the next operation starts.
        setTimeout(() => {
          debugPush('HTMLAudio — playback complete (+ 300ms drain)')
          console.log('[Audio] HTMLAudioElement playback completed')
          URL.revokeObjectURL(url)
          try { document.body.removeChild(audio) } catch { /* already removed */ }
          this.currentAudio = null
          safeResolve()
        }, 300)
      }

      audio.onerror = () => {
        debugPush('HTMLAudio error — falling back to WebSpeech')
        console.warn('[Audio] HTMLAudioElement error, falling back to WebSpeech')
        URL.revokeObjectURL(url)
        try { document.body.removeChild(audio) } catch { /* already removed */ }
        this.currentAudio = null
        this.speakWithWebSpeech(this.lastTTSText || '').then(() => safeResolve())
      }

      audio.load()

      const playPromise = audio.play()
      if (playPromise !== undefined) {
        playPromise
          .then(() => debugPush('HTMLAudio — play() succeeded'))
          .catch((err) => {
            debugPush(`HTMLAudio play() failed: ${err instanceof Error ? err.message : String(err)} — falling back to WebSpeech`)
            console.warn('[Audio] HTMLAudioElement play() failed:', err)
            URL.revokeObjectURL(url)
            try { document.body.removeChild(audio) } catch { /* already removed */ }
            this.currentAudio = null
            this.speakWithWebSpeech(this.lastTTSText || '').then(() => safeResolve())
          })
      }

      // 35-second timeout fallback
      const hangTimeout = setTimeout(() => {
        debugPush('HTMLAudio — timeout (35s) fallback')
        console.warn('[Audio] HTMLAudioElement timeout (35s) — force-resolving')
        try { audio.pause(); document.body.removeChild(audio) } catch { /* ignore */ }
        URL.revokeObjectURL(url)
        this.currentAudio = null
        safeResolve()
      }, 35000)
    })
  }

  // ── Private: Events ───────────────────────────────────────────────────────

  private setStatus(status: VoiceSessionStatus): void {
    this.status = status
    if (this.currentSession) {
      this.currentSession.status = status
    }
    this.emit('status_changed', { status })
    emitOrbState(status)
  }

  private emit(type: VoiceEventType, data?: unknown): void {
    for (const listener of this.listeners) {
      try {
        listener({ type, session: this.currentSession || undefined, data })
      } catch (err) {
        console.error('[Voice] Event listener error:', err)
      }
    }
  }

  private onWakeWordDetected(): void {
    console.log('[Voice] Wake word detected!')
    this.emit('wake_word_detected')
    this.startRecording(this.preferences.pushToTalkEnabled ? 'push_to_talk' : 'normal')
  }

  // ── Private: Recording Cleanup ────────────────────────────────────────────

  private cleanupRecording(): void {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(t => t.stop())
      this.mediaStream = null
    }
    this.mediaRecorder = null
    this.audioChunks = []
  }

  private getSupportedMimeType(): string {
    const mimeTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg', 'audio/mp4']
    for (const type of mimeTypes) {
      if (MediaRecorder.isTypeSupported(type)) return type
    }
    return 'audio/webm' // fallback
  }

  // ── Private: Preferences ──────────────────────────────────────────────────

  private async loadPreferences(): Promise<void> {
    try {
      // FIX 2: Remove .eq('org_id') — RLS policy uses user_id = auth.uid(), filter by user_id only
      // Use .limit(1) instead of .single() to avoid 406 when no row exists yet
      const { data: rows } = await supabase
        .from('voice_preferences' as never)
        .select('*')
        .eq('user_id', this.userId)
        .limit(1)

      const data = (rows as any[])?.[0] || null

      if (data) {
        const prefs = data as any
        this.preferences = {
          enabled: prefs.enabled ?? true,
          ttsVoiceId: prefs.tts_voice_id || DEFAULT_VOICE_ID,
          ttsSpeed: prefs.tts_speed || 1.0,
          asrLanguage: prefs.asr_language || 'en',
          noiseSuppressionStrength: prefs.noise_suppression_strength || 0.7,
          wakeWordEnabled: prefs.wake_word_enabled ?? true,
          wakeWordPhrase: prefs.wake_word_phrase || 'Hey NEXUS',
          fieldModeEnabled: prefs.field_mode_enabled ?? true,
          pushToTalkEnabled: prefs.push_to_talk_enabled ?? false,
          pushToTalkKey: prefs.push_to_talk_key || 'Space',
        }
      }
    } catch {
      console.log('[Voice] No saved preferences, using defaults')
    }
  }

  private async savePreferences(): Promise<void> {
    try {
      await supabase
        .from('voice_preferences' as never)
        .upsert({
          org_id: this.orgId,
          user_id: this.userId,
          enabled: this.preferences.enabled,
          tts_voice_id: this.preferences.ttsVoiceId,
          tts_speed: this.preferences.ttsSpeed,
          asr_language: this.preferences.asrLanguage,
          noise_suppression_strength: this.preferences.noiseSuppressionStrength,
          wake_word_enabled: this.preferences.wakeWordEnabled,
          wake_word_phrase: this.preferences.wakeWordPhrase,
          field_mode_enabled: this.preferences.fieldModeEnabled,
          push_to_talk_enabled: this.preferences.pushToTalkEnabled,
          push_to_talk_key: this.preferences.pushToTalkKey,
          updated_at: new Date().toISOString(),
        })
    } catch (err) {
      console.error('[Voice] Failed to save preferences:', err)
    }
  }

  // ── Private: Session Logging ──────────────────────────────────────────────

  private async logSession(): Promise<void> {
    if (!this.currentSession) return

    try {
      const s = this.currentSession
      await supabase
        .from('voice_sessions' as never)
        .insert({
          id: s.id,
          org_id: s.orgId,
          user_id: s.userId,
          mode: s.mode,
          status: s.status,
          started_at: s.startedAt.toISOString(),
          ended_at: s.endedAt?.toISOString() || null,
          duration_seconds: s.endedAt
            ? Math.round((s.endedAt.getTime() - s.startedAt.getTime()) / 1000)
            : null,
          audio_duration_seconds: s.audioDurationSeconds || null,
          noise_level_db: s.noiseLevel || null,
          transcript_raw: s.transcriptRaw || null,
          transcript_confidence: s.transcriptConfidence || null,
          language: s.language || 'en-US',
          detected_intent: s.detectedIntent || null,
          target_agent: s.targetAgent || null,
          agent_response: s.agentResponse || null,
          response_audio_url: s.responseAudioUrl || null,
          response_voice_id: s.responseVoiceId || null,
          response_duration_seconds: s.responseDurationSeconds || null,
          error_message: s.error || null,
          created_at: new Date().toISOString(),
        })

      console.log(`[Voice] Session ${s.id} logged (${s.targetAgent}/${s.detectedIntent})`)
    } catch (err) {
      console.error('[Voice] Failed to log session:', err)
    }
  }
}

// ── Singleton ────────────────────────────────────────────────────────────────

let _instance: VoiceSubsystem | null = null

export function getVoiceSubsystem(): VoiceSubsystem {
  if (!_instance) _instance = new VoiceSubsystem()
  return _instance
}

// ── Context-aware silence thresholds (ms) ────────────────────────────────────
// Longer pauses are expected on job sites and while driving.
// These control how long the system waits after the user stops speaking
// before treating the utterance as complete.

export type VoiceContext = 'office' | 'job_site' | 'driving' | 'general'

const SILENCE_THRESHOLDS: Record<VoiceContext, number> = {
  office:   1500,  // quiet environment — respond quickly
  job_site: 3500,  // noisy, longer pauses expected
  driving:  2500,  // moderate noise
  general:  2000,  // default
}

const VOICE_CONTEXT_KEY = 'nexus_voice_context'

/**
 * Returns the currently active voice context, falling back to 'general'.
 */
export function getVoiceContext(): VoiceContext {
  if (typeof window === 'undefined') return 'general'
  const stored = localStorage.getItem(VOICE_CONTEXT_KEY) as VoiceContext | null
  if (stored && stored in SILENCE_THRESHOLDS) return stored
  return 'general'
}

/**
 * Sets the active voice context and persists it to localStorage.
 * Updates the effective silence threshold used by the voice pipeline.
 */
export function setVoiceContext(context: VoiceContext): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(VOICE_CONTEXT_KEY, context)
  console.log(`[Voice] Context switched to "${context}" — silence threshold: ${SILENCE_THRESHOLDS[context]}ms`)
}

/**
 * Returns the silence threshold in ms for the currently active voice context.
 */
export function getActiveSilenceThreshold(): number {
  return SILENCE_THRESHOLDS[getVoiceContext()]
}

/**
 * Returns all available silence thresholds (for settings UI or debugging).
 */
export { SILENCE_THRESHOLDS }
