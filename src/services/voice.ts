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
import { classifyVoiceIntent } from '@/api/voice/routing'
import { getAudioPreprocessor } from './audioPreprocessing'
import { getWakeWordDetector, type WakeWordConfig } from './wakeWordDetector'
import { getVoiceCommandExecutor } from './voiceCommandExecutor'
import { callClaude, extractText } from './claudeProxy'
import { supabase } from '@/lib/supabase'

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
  private speakingStartTime: number = 0
  private static readonly MIN_SPEAKING_DISPLAY_MS = 2000

  // Context
  private orgId: string = ''
  private userId: string = ''

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

    // Startup checks — warn if API keys are missing
    if (!import.meta.env.VITE_OPENAI_API_KEY) {
      console.warn('[Voice] VITE_OPENAI_API_KEY not set — Whisper will use Netlify proxy only. Direct fallback disabled.')
    }
    if (!import.meta.env.VITE_ELEVENLABS_API_KEY) {
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
    this.cleanupRecording()

    try {
      // Step 1: Preprocess audio
      this.setStatus('transcribing')
      const preprocessor = getAudioPreprocessor()

      const analysis = await preprocessor.analyze(audioBlob)
      if (this.currentSession) {
        this.currentSession.audioDurationSeconds = analysis.durationSeconds
        this.currentSession.noiseLevel = analysis.estimatedNoiseDb
      }

      if (!analysis.hasVoiceActivity) {
        console.log('[Voice] No voice activity detected')
        this.setStatus('inactive')
        return
      }

      const processedAudio = await preprocessor.preprocess(audioBlob, {
        targetSampleRate: 16000,
        noiseSuppressionStrength: mode === 'field'
          ? this.preferences.noiseSuppressionStrength
          : 0,
      })

      // Step 2: Transcribe with Whisper
      const whisperResult = await transcribeWithWhisper(processedAudio, {
        language: this.preferences.asrLanguage,
        noiseDb: analysis.estimatedNoiseDb,
      })

      if (!whisperResult.text || whisperResult.text.trim().length === 0) {
        console.log('[Voice] Empty transcription')
        this.setStatus('inactive')
        return
      }

      const confidence = estimateConfidence(whisperResult.segments || [])

      if (this.currentSession) {
        this.currentSession.transcriptRaw = whisperResult.text
        this.currentSession.transcriptConfidence = confidence
        this.currentSession.language = whisperResult.language
      }

      this.emit('transcript_ready', { text: whisperResult.text, confidence })

      // Step 3-5: Route, execute, respond
      await this.executeVoicePipeline(whisperResult.text)
    } catch (err) {
      console.error('[Voice] Pipeline error:', err)
      if (this.currentSession) {
        this.currentSession.status = 'error'
        this.currentSession.error = err instanceof Error ? err.message : 'Unknown error'
      }
      this.setStatus('error')
      this.emit('error', { error: err })
    }
  }

  /**
   * Execute the voice pipeline from transcribed text to spoken response.
   * Tries full agent routing first; falls back to direct Claude call.
   */
  private async executeVoicePipeline(transcript: string): Promise<VoiceSession> {
    console.log('[Voice] Transcribed:', transcript)
    let responseText = ''

    // Step 3: Try full agent routing, fall back to direct Claude
    this.setStatus('processing')
    try {
      const classification = await classifyVoiceIntent(transcript)

      if (this.currentSession) {
        this.currentSession.detectedIntent = classification.intent
        this.currentSession.targetAgent = classification.agent
      }

      // Step 4: Execute command via agent
      const executor = getVoiceCommandExecutor()
      const result = await executor.execute(
        classification.agent,
        classification.intent,
        classification.parameters,
        {
          orgId: this.orgId,
          userId: this.userId,
          mode: this.currentSession?.mode || 'normal',
        }
      )
      responseText = result.responseText
      console.log('[Voice] Agent response received via', classification.agent)
    } catch (routeErr) {
      console.warn('[Voice] Agent routing failed, falling back to Claude:', routeErr)

      // Fallback: send transcript directly to Claude via proxy
      try {
        const NEXUS_SYSTEM = 'You are NEXUS, a helpful AI assistant for Power On Solutions LLC, a C-10 electrical contractor in the Coachella Valley, CA. You respond to voice commands. Be concise and conversational — your response will be spoken aloud. Keep answers under 3 sentences when possible.'
        const claudeResult = await callClaude({
          system: NEXUS_SYSTEM,
          messages: [{ role: 'user', content: transcript }],
          max_tokens: 512,
        })
        responseText = extractText(claudeResult)
        console.log('[Voice] Claude response received (fallback)')
      } catch (claudeErr) {
        console.error('[Voice] Claude fallback also failed:', claudeErr)
        responseText = 'Sorry, I couldn\'t process that request. Please try again.'
      }
    }

    if (this.currentSession) {
      this.currentSession.agentResponse = responseText
    }

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

    let ttsPlayed = false
    try {
      const ttsResult = await synthesizeWithElevenLabs({
        text: responseText,
        voice_id: this.preferences.ttsVoiceId,
        voice_settings: {
          stability: 0.75,
          similarity_boost: 0.75,
        },
      })

      if (this.currentSession) {
        this.currentSession.responseAudioUrl = ttsResult.audioUrl
        this.currentSession.responseVoiceId = this.preferences.ttsVoiceId
        this.currentSession.responseDurationSeconds = ttsResult.durationSeconds
      }

      // Step 6: Play response (with interruptible audio reference)
      console.log('[Voice] Playing TTS audio')
      await this.playAudioTracked(ttsResult.audioUrl)
      revokeAudioUrl(ttsResult.audioUrl)
      ttsPlayed = true
    } catch (ttsErr) {
      console.warn('[Voice] ElevenLabs TTS failed, trying speechSynthesis fallback:', ttsErr)
    }

    // Fallback: browser speechSynthesis
    if (!ttsPlayed && typeof window !== 'undefined' && window.speechSynthesis) {
      try {
        console.log('[Voice] Using speechSynthesis fallback')
        await this.speakWithSynthesis(responseText)
      } catch (synthErr) {
        console.warn('[Voice] speechSynthesis also failed:', synthErr)
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
   * Fallback TTS using browser's built-in speechSynthesis API.
   */
  private speakWithSynthesis(text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!window.speechSynthesis) { reject(new Error('speechSynthesis not available')); return }
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.rate = this.preferences.ttsSpeed
      utterance.onend = () => resolve()
      utterance.onerror = (e) => reject(e)
      window.speechSynthesis.speak(utterance)
    })
  }

  // ── Private: Audio Playback ───────────────────────────────────────────────

  private playAudio(audioUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const audio = new Audio(audioUrl)
      audio.playbackRate = this.preferences.ttsSpeed
      audio.onended = () => resolve()
      audio.onerror = (err) => reject(err)
      audio.play().catch(reject)
    })
  }

  /**
   * Play audio with a tracked reference so it can be interrupted.
   * Resolves when audio finishes or is stopped externally.
   */
  private playAudioTracked(audioUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Stop any previously playing audio
      this.stopCurrentAudio()

      const audio = new Audio(audioUrl)
      audio.playbackRate = this.preferences.ttsSpeed
      this.currentAudio = audio

      audio.onended = () => {
        this.currentAudio = null
        resolve()
      }
      audio.onerror = (err) => {
        this.currentAudio = null
        reject(err)
      }
      audio.onpause = () => {
        // If paused externally (interrupt), resolve instead of hanging
        this.currentAudio = null
        resolve()
      }
      audio.play().catch((err) => {
        this.currentAudio = null
        reject(err)
      })
    })
  }

  // ── Private: Events ───────────────────────────────────────────────────────

  private setStatus(status: VoiceSessionStatus): void {
    this.status = status
    if (this.currentSession) {
      this.currentSession.status = status
    }
    this.emit('status_changed', { status })
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
      const { data } = await supabase
        .from('voice_preferences' as never)
        .select('*')
        .eq('org_id', this.orgId)
        .eq('user_id', this.userId)
        .single()

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
