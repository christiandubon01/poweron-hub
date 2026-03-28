// @ts-nocheck
/**
 * Wake Word Detector — "Hey NEXUS" activation
 *
 * Listens for the wake word using Picovoice Porcupine for on-device detection.
 * Falls back to a simple energy-based detection if Porcupine is not available.
 * Emits 'wakeWordDetected' custom events when triggered.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type WakeWordCallback = () => void

export interface WakeWordConfig {
  accessKey?: string           // Picovoice access key
  sensitivity?: number         // 0-1, higher = more sensitive (more false positives)
  wakePhrase?: string          // Custom wake phrase (default: "Hey NEXUS")
  enabled?: boolean
}

export type WakeWordStatus = 'uninitialized' | 'ready' | 'listening' | 'error'

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_SENSITIVITY = 0.5
const DEFAULT_WAKE_PHRASE = 'Hey NEXUS'
const CUSTOM_EVENT_NAME = 'wakeWordDetected'

// Energy-based fallback detection constants
const ENERGY_WINDOW_SIZE = 4096
const ENERGY_THRESHOLD = 0.015
const SILENCE_DURATION_MS = 500    // How long silence before we consider speech done
const MIN_SPEECH_DURATION_MS = 200 // Minimum speech duration to trigger

// ── Implementation ───────────────────────────────────────────────────────────

export class WakeWordDetector {
  private status: WakeWordStatus = 'uninitialized'
  private porcupineManager: any = null
  private callbacks: Set<WakeWordCallback> = new Set()
  private config: WakeWordConfig

  // Fallback: Web Audio API energy detection
  private audioContext: AudioContext | null = null
  private analyserNode: AnalyserNode | null = null
  private mediaStream: MediaStream | null = null
  private animFrameId: number | null = null
  private isSpeaking = false
  private speechStartTime = 0
  private lastSpeechTime = 0

  constructor(config: WakeWordConfig = {}) {
    this.config = {
      sensitivity: DEFAULT_SENSITIVITY,
      wakePhrase: DEFAULT_WAKE_PHRASE,
      enabled: true,
      ...config,
    }
  }

  /**
   * Initialize the wake word detector.
   * Tries Porcupine first, falls back to energy-based detection.
   */
  async initialize(): Promise<void> {
    if (!this.config.enabled) {
      this.status = 'ready'
      return
    }

    // Try Porcupine initialization
    if (this.config.accessKey) {
      try {
        await this.initPorcupine()
        return
      } catch (err) {
        console.warn('[WakeWord] Porcupine init failed, using energy fallback:', err)
      }
    }

    // Fallback: energy-based detection
    console.log('[WakeWord] Using energy-based fallback detection')
    this.status = 'ready'
  }

  /**
   * Start listening for the wake word.
   */
  async start(): Promise<void> {
    if (this.status === 'listening') return

    if (!this.config.enabled) {
      console.log('[WakeWord] Wake word detection disabled')
      return
    }

    if (this.porcupineManager) {
      await this.porcupineManager.start()
      this.status = 'listening'
      console.log('[WakeWord] Porcupine listening...')
    } else {
      await this.startEnergyDetection()
    }
  }

  /**
   * Stop listening for the wake word.
   */
  async stop(): Promise<void> {
    if (this.status !== 'listening') return

    if (this.porcupineManager) {
      await this.porcupineManager.stop()
    } else {
      this.stopEnergyDetection()
    }

    this.status = 'ready'
    console.log('[WakeWord] Stopped listening')
  }

  /**
   * Register a callback for wake word detection.
   */
  onWakeWord(callback: WakeWordCallback): () => void {
    this.callbacks.add(callback)
    return () => this.callbacks.delete(callback)
  }

  /**
   * Get current detector status.
   */
  getStatus(): WakeWordStatus {
    return this.status
  }

  /**
   * Release all resources.
   */
  async dispose(): Promise<void> {
    await this.stop()

    if (this.porcupineManager) {
      try { await this.porcupineManager.release() } catch { /* ignore */ }
      this.porcupineManager = null
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(t => t.stop())
      this.mediaStream = null
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      await this.audioContext.close()
      this.audioContext = null
    }

    this.callbacks.clear()
    this.status = 'uninitialized'
  }

  // ── Private: Porcupine ────────────────────────────────────────────────────

  private async initPorcupine(): Promise<void> {
    // Dynamic import to avoid bundling if not used
    const { PorcupineWorker } = await import('@picovoice/porcupine-web')

    // Porcupine requires a custom wake word model (.ppn file) trained for
    // "Hey NEXUS" via Picovoice Console (https://console.picovoice.ai/).
    // Place the .ppn file in public/models/porcupine/ and reference it here.
    // Until the custom model is trained, the energy-based fallback is used.
    this.porcupineManager = await PorcupineWorker.create(
      this.config.accessKey!,
      {
        publicPath: '/models/porcupine/',
        forceWrite: false,
        customWritePath: 'hey_nexus',
      },
      (detection: { index: number; label: string }) => {
        console.log(`[WakeWord] Porcupine detected: ${detection.label}`)
        this.triggerWakeWord()
      }
    )

    this.status = 'ready'
    console.log('[WakeWord] Porcupine initialized')
  }

  // ── Private: Energy-Based Fallback ────────────────────────────────────────

  private async startEnergyDetection(): Promise<void> {
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })

      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
      const source = this.audioContext.createMediaStreamSource(this.mediaStream)

      this.analyserNode = this.audioContext.createAnalyser()
      this.analyserNode.fftSize = ENERGY_WINDOW_SIZE
      source.connect(this.analyserNode)

      this.status = 'listening'
      this.monitorEnergy()
      console.log('[WakeWord] Energy detection listening...')
    } catch (err) {
      console.error('[WakeWord] Microphone access denied:', err)
      this.status = 'error'
    }
  }

  private stopEnergyDetection(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId)
      this.animFrameId = null
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(t => t.stop())
      this.mediaStream = null
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close()
      this.audioContext = null
    }

    this.analyserNode = null
  }

  /**
   * Monitor audio energy levels to detect speech onset.
   * This is a simple heuristic — not actual wake word recognition.
   * In production, this would be replaced by Porcupine with a trained model.
   */
  private monitorEnergy(): void {
    if (!this.analyserNode || this.status !== 'listening') return

    const bufferLength = this.analyserNode.frequencyBinCount
    const dataArray = new Float32Array(bufferLength)
    this.analyserNode.getFloatTimeDomainData(dataArray)

    // Calculate RMS energy
    let sumSquared = 0
    for (let i = 0; i < bufferLength; i++) {
      sumSquared += dataArray[i] * dataArray[i]
    }
    const rms = Math.sqrt(sumSquared / bufferLength)

    const now = Date.now()

    if (rms > ENERGY_THRESHOLD) {
      if (!this.isSpeaking) {
        this.isSpeaking = true
        this.speechStartTime = now
      }
      this.lastSpeechTime = now
    } else if (this.isSpeaking && now - this.lastSpeechTime > SILENCE_DURATION_MS) {
      // Speech ended — check if it was long enough
      const speechDuration = this.lastSpeechTime - this.speechStartTime
      if (speechDuration >= MIN_SPEECH_DURATION_MS) {
        console.log(`[WakeWord] Speech detected (${speechDuration}ms) — triggering wake word`)
        this.triggerWakeWord()
      }
      this.isSpeaking = false
    }

    this.animFrameId = requestAnimationFrame(() => this.monitorEnergy())
  }

  // ── Private: Trigger ──────────────────────────────────────────────────────

  private triggerWakeWord(): void {
    // Notify all registered callbacks
    for (const cb of this.callbacks) {
      try {
        cb()
      } catch (err) {
        console.error('[WakeWord] Callback error:', err)
      }
    }

    // Dispatch DOM event for components not using callbacks
    window.dispatchEvent(new CustomEvent(CUSTOM_EVENT_NAME))
  }
}

// ── Singleton ────────────────────────────────────────────────────────────────

let _instance: WakeWordDetector | null = null

export function getWakeWordDetector(config?: WakeWordConfig): WakeWordDetector {
  if (!_instance) _instance = new WakeWordDetector(config)
  return _instance
}
