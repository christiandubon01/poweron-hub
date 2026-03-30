/**
 * Audio Preprocessing Service
 *
 * Handles audio filtering, resampling, and noise suppression
 * for job-site environments before sending to Whisper API.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface AudioPreprocessingOptions {
  targetSampleRate?: number    // 16000 for Whisper
  noiseSuppressionStrength?: number  // 0-1
  enableVAD?: boolean          // Voice Activity Detection
  echoCancellation?: boolean
}

export interface AudioAnalysis {
  durationSeconds: number
  sampleRate: number
  channels: number
  peakAmplitude: number
  rmsLevel: number
  estimatedNoiseDb: number
  hasVoiceActivity: boolean
}

// ── Constants ────────────────────────────────────────────────────────────────

const WHISPER_SAMPLE_RATE = 16000
const HIGH_PASS_CUTOFF_HZ = 80   // Remove low-frequency rumble
const NOISE_GATE_FLOOR = 0.01    // Minimum amplitude to keep
const VAD_ENERGY_THRESHOLD = 0.02 // RMS threshold for voice detection

// ── Implementation ───────────────────────────────────────────────────────────

export class AudioPreprocessor {
  private audioContext: AudioContext | null = null

  /**
   * Get or create the AudioContext (lazy initialization).
   */
  private getContext(): AudioContext {
    if (!this.audioContext || this.audioContext.state === 'closed') {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
    }
    return this.audioContext
  }

  /**
   * Preprocess audio blob for Whisper transcription.
   * Applies noise suppression, resampling, and format conversion.
   */
  async preprocess(
    audioBlob: Blob,
    options: AudioPreprocessingOptions = {}
  ): Promise<Blob> {
    const ctx = this.getContext()

    try {
      const arrayBuffer = await audioBlob.arrayBuffer()
      let audioBuffer = await ctx.decodeAudioData(arrayBuffer)

      console.log(
        `[AudioPreprocess] Input: ${audioBuffer.sampleRate}Hz, ` +
        `${audioBuffer.numberOfChannels}ch, ${audioBuffer.duration.toFixed(1)}s`
      )

      // Apply high-pass filter to remove low-frequency noise
      if (options.noiseSuppressionStrength !== undefined && options.noiseSuppressionStrength > 0) {
        audioBuffer = this.applyHighPassFilter(audioBuffer, HIGH_PASS_CUTOFF_HZ)
        audioBuffer = this.applyNoiseGate(audioBuffer, options.noiseSuppressionStrength)
      }

      // Resample to 16kHz for Whisper if needed
      const targetRate = options.targetSampleRate || WHISPER_SAMPLE_RATE
      if (audioBuffer.sampleRate !== targetRate) {
        audioBuffer = await this.resample(audioBuffer, targetRate)
      }

      // Convert to mono if stereo
      if (audioBuffer.numberOfChannels > 1) {
        audioBuffer = this.mixToMono(audioBuffer)
      }

      // Encode as WAV
      const wavBlob = this.encodeWAV(audioBuffer)

      console.log(
        `[AudioPreprocess] Output: ${targetRate}Hz, 1ch, ` +
        `${(wavBlob.size / 1024).toFixed(0)}KB WAV`
      )

      return wavBlob
    } catch (err) {
      console.error('[AudioPreprocess] Error:', err)
      // Return original blob as fallback
      return audioBlob
    }
  }

  /**
   * Analyze audio for noise level and voice activity.
   */
  async analyze(audioBlob: Blob): Promise<AudioAnalysis> {
    const ctx = this.getContext()
    const arrayBuffer = await audioBlob.arrayBuffer()
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer)

    const channelData = audioBuffer.getChannelData(0)
    let peakAmplitude = 0
    let sumSquared = 0

    for (let i = 0; i < channelData.length; i++) {
      const abs = Math.abs(channelData[i])
      if (abs > peakAmplitude) peakAmplitude = abs
      sumSquared += channelData[i] * channelData[i]
    }

    const rmsLevel = Math.sqrt(sumSquared / channelData.length)

    // Estimate noise in dB (relative to full scale)
    const noiseDb = rmsLevel > 0 ? 20 * Math.log10(rmsLevel) : -100

    return {
      durationSeconds: audioBuffer.duration,
      sampleRate: audioBuffer.sampleRate,
      channels: audioBuffer.numberOfChannels,
      peakAmplitude,
      rmsLevel,
      estimatedNoiseDb: noiseDb,
      hasVoiceActivity: rmsLevel > VAD_ENERGY_THRESHOLD,
    }
  }

  /**
   * Release AudioContext resources.
   */
  async dispose(): Promise<void> {
    if (this.audioContext && this.audioContext.state !== 'closed') {
      await this.audioContext.close()
      this.audioContext = null
    }
  }

  // ── Private Methods ──────────────────────────────────────────────────────

  /**
   * Resample audio to a target sample rate using OfflineAudioContext.
   */
  private async resample(audioBuffer: AudioBuffer, targetSampleRate: number): Promise<AudioBuffer> {
    const ratio = targetSampleRate / audioBuffer.sampleRate
    const newLength = Math.ceil(audioBuffer.length * ratio)

    const offlineCtx = new OfflineAudioContext(
      audioBuffer.numberOfChannels,
      newLength,
      targetSampleRate
    )

    const source = offlineCtx.createBufferSource()
    source.buffer = audioBuffer
    source.connect(offlineCtx.destination)
    source.start(0)

    return offlineCtx.startRendering()
  }

  /**
   * Apply a simple high-pass filter to remove low-frequency noise.
   */
  private applyHighPassFilter(audioBuffer: AudioBuffer, cutoffHz: number): AudioBuffer {
    const sampleRate = audioBuffer.sampleRate
    const rc = 1.0 / (2.0 * Math.PI * cutoffHz)
    const dt = 1.0 / sampleRate
    const alpha = rc / (rc + dt)

    for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
      const data = audioBuffer.getChannelData(ch)
      let prevInput = data[0]
      let prevOutput = data[0]

      for (let i = 1; i < data.length; i++) {
        const output = alpha * (prevOutput + data[i] - prevInput)
        prevInput = data[i]
        data[i] = output
        prevOutput = output
      }
    }

    return audioBuffer
  }

  /**
   * Apply noise gate: silence samples below dynamic threshold.
   */
  private applyNoiseGate(audioBuffer: AudioBuffer, strength: number): AudioBuffer {
    const threshold = NOISE_GATE_FLOOR + (1 - strength) * 0.05

    for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
      const data = audioBuffer.getChannelData(ch)
      for (let i = 0; i < data.length; i++) {
        if (Math.abs(data[i]) < threshold) {
          data[i] = 0
        }
      }
    }

    return audioBuffer
  }

  /**
   * Mix multi-channel audio down to mono.
   */
  private mixToMono(audioBuffer: AudioBuffer): AudioBuffer {
    const ctx = this.getContext()
    const mono = ctx.createBuffer(1, audioBuffer.length, audioBuffer.sampleRate)
    const monoData = mono.getChannelData(0)

    for (let i = 0; i < audioBuffer.length; i++) {
      let sum = 0
      for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
        sum += audioBuffer.getChannelData(ch)[i]
      }
      monoData[i] = sum / audioBuffer.numberOfChannels
    }

    return mono
  }

  /**
   * Encode an AudioBuffer as a WAV blob.
   */
  private encodeWAV(audioBuffer: AudioBuffer): Blob {
    const numChannels = audioBuffer.numberOfChannels
    const sampleRate = audioBuffer.sampleRate
    const bitDepth = 16
    const bytesPerSample = bitDepth / 8
    const blockAlign = numChannels * bytesPerSample

    // Interleave channels
    const samples = this.interleaveChannels(audioBuffer)

    // Create WAV file
    const dataSize = samples.length * bytesPerSample
    const buffer = new ArrayBuffer(44 + dataSize)
    const view = new DataView(buffer)

    // RIFF header
    this.writeString(view, 0, 'RIFF')
    view.setUint32(4, 36 + dataSize, true)
    this.writeString(view, 8, 'WAVE')

    // fmt chunk
    this.writeString(view, 12, 'fmt ')
    view.setUint32(16, 16, true)            // Subchunk1Size (PCM)
    view.setUint16(20, 1, true)             // AudioFormat (1 = PCM)
    view.setUint16(22, numChannels, true)
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, sampleRate * blockAlign, true) // ByteRate
    view.setUint16(32, blockAlign, true)
    view.setUint16(34, bitDepth, true)

    // data chunk
    this.writeString(view, 36, 'data')
    view.setUint32(40, dataSize, true)

    // Write PCM samples
    let offset = 44
    for (let i = 0; i < samples.length; i++) {
      const clamped = Math.max(-1, Math.min(1, samples[i]))
      view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7FFF, true)
      offset += 2
    }

    return new Blob([buffer], { type: 'audio/wav' })
  }

  private interleaveChannels(audioBuffer: AudioBuffer): Float32Array {
    if (audioBuffer.numberOfChannels === 1) {
      return audioBuffer.getChannelData(0)
    }

    const length = audioBuffer.length * audioBuffer.numberOfChannels
    const result = new Float32Array(length)
    let index = 0

    for (let i = 0; i < audioBuffer.length; i++) {
      for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
        result[index++] = audioBuffer.getChannelData(ch)[i]
      }
    }

    return result
  }

  private writeString(view: DataView, offset: number, str: string): void {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i))
    }
  }
}

// ── Singleton ────────────────────────────────────────────────────────────────

let _instance: AudioPreprocessor | null = null

export function getAudioPreprocessor(): AudioPreprocessor {
  if (!_instance) _instance = new AudioPreprocessor()
  return _instance
}
