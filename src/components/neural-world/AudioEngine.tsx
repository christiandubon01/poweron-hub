/**
 * AudioEngine.tsx — NW43: Procedural audio engine for Neural World.
 *
 * All sounds generated via Web Audio API OscillatorNode / BufferSourceNode.
 * Zero audio file downloads. Procedural synthesis only.
 *
 * Architecture:
 *   AudioContext (created on first user interaction, browser requirement)
 *   └── masterGain (0–1, default 0.30)
 *       ├── ambientGain    — ambient drone channel
 *       ├── nodeGain       — node proximity tones channel
 *       ├── agentGain      — agent sounds channel
 *       ├── eventGain      — event chimes channel
 *       └── pulseGain      — world pulse channel
 *
 * Max 8 simultaneous OscillatorNodes (closest 8 sources enforced by SonicLandscape).
 * All GainNode transitions use linearRampToValueAtTime to avoid clicks.
 *
 * Settings persisted to 'nw_audio_settings_v1' in localStorage.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type ResonanceState = 'DISSONANT' | 'COHERENT' | 'GROWTH'

export type AudioChannel = 'ambient' | 'nodes' | 'agents' | 'events' | 'pulse'

export interface AudioSettings {
  masterVolume: number          // 0–1, default 0.30
  muted: boolean
  ambientEnabled: boolean
  nodesEnabled: boolean
  agentsEnabled: boolean
  eventsEnabled: boolean
  pulseEnabled: boolean
}

const SETTINGS_KEY = 'nw_audio_settings_v1'

const DEFAULT_SETTINGS: AudioSettings = {
  masterVolume: 0.30,
  muted: false,
  ambientEnabled: true,
  nodesEnabled: true,
  agentsEnabled: true,
  eventsEnabled: true,
  pulseEnabled: true,
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

// ── AudioEngine class ─────────────────────────────────────────────────────────

export class AudioEngine {
  private ctx: AudioContext | null = null
  private masterGain: GainNode | null = null
  private ambientGain: GainNode | null = null
  private nodeGain: GainNode | null = null
  private agentGain: GainNode | null = null
  private eventGain: GainNode | null = null
  private pulseGain: GainNode | null = null

  // Ambient drone oscillators
  private droneOsc1: OscillatorNode | null = null
  private droneOsc2: OscillatorNode | null = null
  private droneGain1: GainNode | null = null
  private droneGain2: GainNode | null = null
  private droneHarm1: OscillatorNode | null = null
  private droneHarm2: OscillatorNode | null = null
  private droneHarmGain1: GainNode | null = null
  private droneHarmGain2: GainNode | null = null

  // GUARDIAN hum oscillator
  private guardianOsc: OscillatorNode | null = null
  private guardianGain: GainNode | null = null

  // Active oscillator count tracking for budget
  private activeOscCount = 0
  private readonly MAX_OSC = 8

  private settings: AudioSettings
  private currentResonanceState: ResonanceState = 'COHERENT'
  private resonanceScoreVal = 0.5

  // World pulse tracking
  private pulseIntervalId: ReturnType<typeof setInterval> | null = null
  private pulsePhase = 0

  // GROWTH cycle tracking for volume envelope
  private growthCycleStart = 0

  constructor() {
    this.settings = this.loadSettings()
  }

  // ── Settings persistence ──────────────────────────────────────────────────

  loadSettings(): AudioSettings {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY)
      if (!raw) return { ...DEFAULT_SETTINGS }
      const parsed = JSON.parse(raw) as Partial<AudioSettings>
      return {
        masterVolume:    clamp01(parsed.masterVolume    ?? DEFAULT_SETTINGS.masterVolume),
        muted:           parsed.muted           ?? DEFAULT_SETTINGS.muted,
        ambientEnabled:  parsed.ambientEnabled  ?? DEFAULT_SETTINGS.ambientEnabled,
        nodesEnabled:    parsed.nodesEnabled    ?? DEFAULT_SETTINGS.nodesEnabled,
        agentsEnabled:   parsed.agentsEnabled   ?? DEFAULT_SETTINGS.agentsEnabled,
        eventsEnabled:   parsed.eventsEnabled   ?? DEFAULT_SETTINGS.eventsEnabled,
        pulseEnabled:    parsed.pulseEnabled    ?? DEFAULT_SETTINGS.pulseEnabled,
      }
    } catch {
      return { ...DEFAULT_SETTINGS }
    }
  }

  saveSettings(): void {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings))
    } catch { /* non-blocking */ }
  }

  getSettings(): AudioSettings {
    return { ...this.settings }
  }

  updateSettings(patch: Partial<AudioSettings>): void {
    this.settings = { ...this.settings, ...patch }
    this.saveSettings()
    this.applyMasterVolume()
    if ('ambientEnabled' in patch) this.applyChannelGain('ambient')
    if ('nodesEnabled'   in patch) this.applyChannelGain('nodes')
    if ('agentsEnabled'  in patch) this.applyChannelGain('agents')
    if ('eventsEnabled'  in patch) this.applyChannelGain('events')
    if ('pulseEnabled'   in patch) this.applyChannelGain('pulse')
  }

  // ── AudioContext lifecycle ────────────────────────────────────────────────

  /**
   * Must be called from a user-gesture handler (browser requirement).
   * Safe to call multiple times — idempotent after first call.
   */
  init(): boolean {
    if (this.ctx) return true
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (!Ctx) return false
      this.ctx = new Ctx()

      // Master gain
      this.masterGain = this.ctx.createGain()
      this.masterGain.gain.value = this.settings.muted ? 0 : this.settings.masterVolume
      this.masterGain.connect(this.ctx.destination)

      // Channel gains
      this.ambientGain = this.createChannelGain('ambient')
      this.nodeGain    = this.createChannelGain('nodes')
      this.agentGain   = this.createChannelGain('agents')
      this.eventGain   = this.createChannelGain('events')
      this.pulseGain   = this.createChannelGain('pulse')

      // Start ambient drone
      this.startAmbientDrone(this.currentResonanceState)

      // Start GUARDIAN hum
      this.startGuardianHum()

      // Start world pulse
      this.startWorldPulse()

      return true
    } catch {
      return false
    }
  }

  get isInitialized(): boolean {
    return this.ctx !== null
  }

  dispose(): void {
    this.stopWorldPulse()
    this.stopAmbientDrone()
    this.stopGuardianHum()
    try {
      this.ctx?.close()
    } catch { /* ignore */ }
    this.ctx         = null
    this.masterGain  = null
    this.ambientGain = null
    this.nodeGain    = null
    this.agentGain   = null
    this.eventGain   = null
    this.pulseGain   = null
    this.activeOscCount = 0
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private createChannelGain(channel: AudioChannel): GainNode {
    if (!this.ctx || !this.masterGain) throw new Error('not initialized')
    const g = this.ctx.createGain()
    g.gain.value = this.channelEnabled(channel) ? 1 : 0
    g.connect(this.masterGain)
    return g
  }

  private channelEnabled(channel: AudioChannel): boolean {
    switch (channel) {
      case 'ambient': return this.settings.ambientEnabled
      case 'nodes':   return this.settings.nodesEnabled
      case 'agents':  return this.settings.agentsEnabled
      case 'events':  return this.settings.eventsEnabled
      case 'pulse':   return this.settings.pulseEnabled
    }
  }

  private applyMasterVolume(): void {
    if (!this.ctx || !this.masterGain) return
    const t = this.ctx.currentTime + 0.05
    const v = this.settings.muted ? 0 : this.settings.masterVolume
    this.masterGain.gain.linearRampToValueAtTime(v, t)
  }

  private applyChannelGain(channel: AudioChannel): void {
    const node = this.channelGainNode(channel)
    if (!node || !this.ctx) return
    const t = this.ctx.currentTime + 0.05
    node.gain.linearRampToValueAtTime(this.channelEnabled(channel) ? 1 : 0, t)
  }

  private channelGainNode(channel: AudioChannel): GainNode | null {
    switch (channel) {
      case 'ambient': return this.ambientGain
      case 'nodes':   return this.nodeGain
      case 'agents':  return this.agentGain
      case 'events':  return this.eventGain
      case 'pulse':   return this.pulseGain
    }
  }

  private canSpawnOsc(): boolean {
    return this.activeOscCount < this.MAX_OSC
  }

  private createOsc(freq: number, type: OscillatorType, destination: GainNode): {
    osc: OscillatorNode
    gain: GainNode
  } {
    if (!this.ctx) throw new Error('not initialized')
    const osc  = this.ctx.createOscillator()
    const gain = this.ctx.createGain()
    osc.type      = type
    osc.frequency.value = freq
    osc.connect(gain)
    gain.connect(destination)
    this.activeOscCount++
    osc.onended = () => { this.activeOscCount-- }
    return { osc, gain }
  }

  // ── Master volume / mute ──────────────────────────────────────────────────

  setMasterVolume(v: number): void {
    this.settings.masterVolume = clamp01(v)
    this.saveSettings()
    this.applyMasterVolume()
  }

  setMuted(muted: boolean): void {
    this.settings.muted = muted
    this.saveSettings()
    this.applyMasterVolume()
  }

  toggleMute(): boolean {
    const next = !this.settings.muted
    this.setMuted(next)
    return next
  }

  // ── Ambient Drone ─────────────────────────────────────────────────────────

  private stopAmbientDrone(): void {
    try { this.droneOsc1?.stop(); this.droneOsc2?.stop() } catch { /* ignore */ }
    try { this.droneHarm1?.stop(); this.droneHarm2?.stop() } catch { /* ignore */ }
    this.droneOsc1 = this.droneOsc2 = null
    this.droneGain1 = this.droneGain2 = null
    this.droneHarm1 = this.droneHarm2 = null
    this.droneHarmGain1 = this.droneHarmGain2 = null
  }

  private startAmbientDrone(state: ResonanceState): void {
    if (!this.ctx || !this.ambientGain) return
    this.stopAmbientDrone()

    const t = this.ctx.currentTime

    if (state === 'DISSONANT') {
      // Two slightly detuned oscillators → beat frequency 2–4 Hz
      // Base: 80 Hz, slightly detuned second at 83 Hz → ~3 Hz wobble
      if (!this.canSpawnOsc()) return
      const { osc: o1, gain: g1 } = this.createOsc(80, 'sine', this.ambientGain)
      g1.gain.setValueAtTime(0, t)
      g1.gain.linearRampToValueAtTime(0.35, t + 2)
      o1.start(t)
      this.droneOsc1 = o1
      this.droneGain1 = g1

      if (!this.canSpawnOsc()) return
      const { osc: o2, gain: g2 } = this.createOsc(83, 'sine', this.ambientGain)
      g2.gain.setValueAtTime(0, t)
      g2.gain.linearRampToValueAtTime(0.30, t + 2.5)
      o2.start(t)
      this.droneOsc2 = o2
      this.droneGain2 = g2

    } else if (state === 'COHERENT') {
      // Single clean sine tone: 110 Hz (A2)
      if (!this.canSpawnOsc()) return
      const { osc: o1, gain: g1 } = this.createOsc(110, 'sine', this.ambientGain)
      g1.gain.setValueAtTime(0, t)
      g1.gain.linearRampToValueAtTime(0.30, t + 3)
      o1.start(t)
      this.droneOsc1 = o1
      this.droneGain1 = g1

    } else {
      // GROWTH: 110 Hz + 220 Hz + 330 Hz harmonics
      // Volume envelope cycles over 10 seconds (matches orb growth cycle)
      this.growthCycleStart = t
      if (!this.canSpawnOsc()) return
      const { osc: o1, gain: g1 } = this.createOsc(110, 'sine', this.ambientGain)
      g1.gain.setValueAtTime(0, t)
      g1.gain.linearRampToValueAtTime(0.28, t + 3)
      o1.start(t)
      this.droneOsc1 = o1
      this.droneGain1 = g1

      if (!this.canSpawnOsc()) return
      const { osc: h1, gain: hg1 } = this.createOsc(220, 'sine', this.ambientGain)
      hg1.gain.setValueAtTime(0, t)
      hg1.gain.linearRampToValueAtTime(0.18, t + 4)
      h1.start(t)
      this.droneHarm1 = h1
      this.droneHarmGain1 = hg1

      if (!this.canSpawnOsc()) return
      const { osc: h2, gain: hg2 } = this.createOsc(330, 'sine', this.ambientGain)
      hg2.gain.setValueAtTime(0, t)
      hg2.gain.linearRampToValueAtTime(0.10, t + 5)
      h2.start(t)
      this.droneHarm2 = h2
      this.droneHarmGain2 = hg2
    }
  }

  setResonanceState(state: ResonanceState, score: number): void {
    if (state === this.currentResonanceState && Math.abs(score - this.resonanceScoreVal) < 0.02) return
    const prevState = this.currentResonanceState
    this.currentResonanceState = state
    this.resonanceScoreVal     = score

    if (this.ctx) {
      if (state !== prevState) {
        this.startAmbientDrone(state)
        this.restartWorldPulse()
      }
    }
  }

  // ── World Pulse ───────────────────────────────────────────────────────────

  private stopWorldPulse(): void {
    if (this.pulseIntervalId !== null) {
      clearInterval(this.pulseIntervalId)
      this.pulseIntervalId = null
    }
  }

  private restartWorldPulse(): void {
    this.stopWorldPulse()
    this.startWorldPulse()
  }

  private startWorldPulse(): void {
    if (!this.ctx || !this.pulseGain) return
    this.stopWorldPulse()

    const scheduleNextPulse = () => {
      if (!this.ctx || !this.pulseGain) return
      // interval depends on resonance state
      let intervalMs: number
      if (this.currentResonanceState === 'DISSONANT') {
        // Irregular: random 300–1500 ms
        intervalMs = 300 + Math.random() * 1200
      } else if (this.currentResonanceState === 'COHERENT') {
        intervalMs = 1000   // steady 1 Hz
      } else {
        // GROWTH: accelerating — phase-based, 500–800ms
        this.pulsePhase = (this.pulsePhase + 1) % 10
        intervalMs = Math.max(300, 800 - this.pulsePhase * 50)
      }
      this.playPulseTick()
      this.pulseIntervalId = setTimeout(scheduleNextPulse, intervalMs) as unknown as ReturnType<typeof setInterval>
    }

    scheduleNextPulse()
  }

  private playPulseTick(): void {
    if (!this.ctx || !this.pulseGain || !this.canSpawnOsc()) return
    const t   = this.ctx.currentTime
    const vol = this.currentResonanceState === 'DISSONANT' ? 0.08 : 0.05
    const { osc, gain } = this.createOsc(
      this.currentResonanceState === 'DISSONANT' ? 60 :
      this.currentResonanceState === 'GROWTH'    ? 140 : 100,
      'sine',
      this.pulseGain
    )
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(vol, t + 0.01)
    gain.gain.linearRampToValueAtTime(0, t + 0.12)
    osc.start(t)
    osc.stop(t + 0.15)
  }

  // ── GUARDIAN hum ──────────────────────────────────────────────────────────

  private stopGuardianHum(): void {
    try { this.guardianOsc?.stop() } catch { /* ignore */ }
    this.guardianOsc = null
    this.guardianGain = null
  }

  private startGuardianHum(): void {
    if (!this.ctx || !this.agentGain || !this.canSpawnOsc()) return
    const { osc, gain } = this.createOsc(40, 'sine', this.agentGain)
    gain.gain.value = 0  // controlled by proximity
    osc.start(this.ctx.currentTime)
    this.guardianOsc  = osc
    this.guardianGain = gain
  }

  setGuardianProximity(proximity01: number): void {
    if (!this.ctx || !this.guardianGain) return
    const t = this.ctx.currentTime + 0.1
    this.guardianGain.gain.linearRampToValueAtTime(proximity01 * 0.12, t)
  }

  // ── Node Proximity Sounds ─────────────────────────────────────────────────

  /**
   * Play a node proximity tone for a project mountain.
   * value: contract value (higher = higher pitch).
   * healthy: gold-heavy = clean tone, struggling = filtered/muffled.
   */
  playProjectTone(value: number, healthy: boolean): void {
    if (!this.ctx || !this.nodeGain || !this.canSpawnOsc()) return
    // Map contract value $0–$100k → pitch 200–600 Hz
    const freq = 200 + Math.min(value / 100000, 1) * 400
    const t    = this.ctx.currentTime
    const type: OscillatorType = healthy ? 'sine' : 'triangle'

    const { osc, gain } = this.createOsc(freq, type, this.nodeGain)
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(0.12, t + 0.3)
    gain.gain.linearRampToValueAtTime(0, t + 1.5)
    osc.start(t)
    osc.stop(t + 1.6)

    if (!healthy) {
      // Apply low-pass filter (muffled) via BiquadFilterNode
      if (!this.ctx) return
      const filter = this.ctx.createBiquadFilter()
      filter.type            = 'lowpass'
      filter.frequency.value = 300
      filter.Q.value         = 1
      osc.disconnect()
      osc.connect(filter)
      filter.connect(gain)
    }
  }

  /**
   * Play revenue river sound (white noise, volume scales with river width).
   * widthFactor: 0–1 relative width.
   * smooth: coherent = true, dissonant = false.
   */
  playRiverSound(widthFactor: number, smooth: boolean): void {
    if (!this.ctx || !this.nodeGain) return
    const duration = 2.0
    const bufSize  = Math.floor(this.ctx.sampleRate * duration)
    const buffer   = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate)
    const data     = buffer.getChannelData(0)

    // White noise
    for (let i = 0; i < bufSize; i++) {
      data[i] = (Math.random() * 2 - 1)
    }

    const source = this.ctx.createBufferSource()
    source.buffer = buffer

    const filter = this.ctx.createBiquadFilter()
    filter.type = smooth ? 'lowpass' : 'bandpass'
    filter.frequency.value = smooth ? 800 : 400
    filter.Q.value = smooth ? 0.5 : 2.0

    const gain = this.ctx.createGain()
    gain.gain.value = widthFactor * 0.15

    source.connect(filter)
    filter.connect(gain)
    gain.connect(this.nodeGain)
    source.start(this.ctx.currentTime)
    source.stop(this.ctx.currentTime + duration)
  }

  /**
   * AR stalactite tick — accelerates with age.
   * ageSeconds: age of the invoice. Older = faster tick rate.
   */
  playStalactiteTick(): void {
    if (!this.ctx || !this.nodeGain || !this.canSpawnOsc()) return
    const t = this.ctx.currentTime
    const { osc, gain } = this.createOsc(1200, 'sine', this.nodeGain)
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(0.08, t + 0.01)
    gain.gain.linearRampToValueAtTime(0, t + 0.05)
    osc.start(t)
    osc.stop(t + 0.06)
  }

  /**
   * Katsuro Bridge Tower chord: E minor (82 Hz, 123 Hz, 165 Hz).
   * distance: 0–20 units. Volume fades with distance.
   */
  playKatsuroBridgeChord(distance: number): void {
    if (!this.ctx || !this.nodeGain) return
    const proximity = Math.max(0, 1 - distance / 20)
    if (proximity < 0.05) return
    const freqs = [82, 123, 165]
    const t = this.ctx.currentTime
    freqs.forEach(freq => {
      if (!this.canSpawnOsc() || !this.ctx || !this.nodeGain) return
      const { osc, gain } = this.createOsc(freq, 'sine', this.nodeGain)
      gain.gain.setValueAtTime(0, t)
      gain.gain.linearRampToValueAtTime(proximity * 0.10, t + 0.5)
      gain.gain.linearRampToValueAtTime(proximity * 0.05, t + 2.0)
      gain.gain.linearRampToValueAtTime(0, t + 3.0)
      osc.start(t)
      osc.stop(t + 3.1)
    })
  }

  // ── Agent Sounds ──────────────────────────────────────────────────────────

  /**
   * Agent flyby whoosh — filtered noise burst, 0.3s.
   * speed: 0–1 relative speed (higher = higher pitch).
   */
  playAgentFlyby(speed: number): void {
    if (!this.ctx || !this.agentGain) return
    const duration = 0.3
    const bufSize  = Math.floor(this.ctx.sampleRate * duration)
    const buffer   = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate)
    const data     = buffer.getChannelData(0)
    for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1

    const source = this.ctx.createBufferSource()
    source.buffer = buffer

    const filter = this.ctx.createBiquadFilter()
    filter.type            = 'bandpass'
    filter.frequency.value = 600 + speed * 1400
    filter.Q.value         = 3

    const gain = this.ctx.createGain()
    gain.gain.setValueAtTime(0, this.ctx.currentTime)
    gain.gain.linearRampToValueAtTime(0.18, this.ctx.currentTime + 0.05)
    gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + duration)

    source.connect(filter)
    filter.connect(gain)
    gain.connect(this.agentGain)
    source.start(this.ctx.currentTime)
    source.stop(this.ctx.currentTime + duration + 0.05)
  }

  /**
   * NEXUS sweep deeper whoosh with harmonic overtone.
   */
  playNexusSweep(): void {
    if (!this.ctx || !this.agentGain) return
    const duration = 0.6
    const bufSize  = Math.floor(this.ctx.sampleRate * duration)
    const buffer   = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate)
    const data     = buffer.getChannelData(0)
    for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1

    const source = this.ctx.createBufferSource()
    source.buffer = buffer

    const filter = this.ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 400
    filter.Q.value = 2

    const gain = this.ctx.createGain()
    gain.gain.setValueAtTime(0, this.ctx.currentTime)
    gain.gain.linearRampToValueAtTime(0.22, this.ctx.currentTime + 0.1)
    gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + duration)
    source.connect(filter)
    filter.connect(gain)
    gain.connect(this.agentGain)
    source.start(this.ctx.currentTime)
    source.stop(this.ctx.currentTime + duration + 0.05)

    // Harmonic overtone
    if (this.canSpawnOsc()) {
      const t = this.ctx.currentTime
      const { osc, gain: hg } = this.createOsc(220, 'sine', this.agentGain)
      hg.gain.setValueAtTime(0, t)
      hg.gain.linearRampToValueAtTime(0.10, t + 0.15)
      hg.gain.linearRampToValueAtTime(0, t + 0.55)
      osc.start(t)
      osc.stop(t + 0.6)
    }
  }

  /**
   * Data cube pickup: crystalline chime 800 Hz, fast decay.
   */
  playDataCubePickup(): void {
    if (!this.ctx || !this.agentGain || !this.canSpawnOsc()) return
    const t = this.ctx.currentTime
    const { osc, gain } = this.createOsc(800, 'sine', this.agentGain)
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(0.18, t + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4)
    osc.start(t)
    osc.stop(t + 0.45)
  }

  /**
   * Data cube drop at domain: lower chime 400 Hz, medium decay.
   */
  playDataCubeDrop(): void {
    if (!this.ctx || !this.agentGain || !this.canSpawnOsc()) return
    const t = this.ctx.currentTime
    const { osc, gain } = this.createOsc(400, 'sine', this.agentGain)
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(0.15, t + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.8)
    osc.start(t)
    osc.stop(t + 0.85)
  }

  /**
   * NEXUS briefing merge at OPERATOR: chord resolution — multiple chimes
   * resolving to a consonant interval.
   */
  playNexusMerge(): void {
    if (!this.ctx || !this.agentGain) return
    const t = this.ctx.currentTime
    const freqs = [300, 400, 500, 600]
    freqs.forEach((freq, i) => {
      if (!this.ctx || !this.agentGain || !this.canSpawnOsc()) return
      const { osc, gain } = this.createOsc(freq, 'sine', this.agentGain)
      const delay = i * 0.08
      gain.gain.setValueAtTime(0, t + delay)
      gain.gain.linearRampToValueAtTime(0.12, t + delay + 0.05)
      gain.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.8)
      osc.start(t + delay)
      osc.stop(t + delay + 0.85)
    })
  }

  // ── Event Sounds ──────────────────────────────────────────────────────────

  /**
   * Invoice paid: bright ascending tone 300→600 Hz over 0.5s.
   */
  playInvoicePaid(): void {
    if (!this.ctx || !this.eventGain || !this.canSpawnOsc()) return
    const t = this.ctx.currentTime
    const { osc, gain } = this.createOsc(300, 'sine', this.eventGain)
    osc.frequency.setValueAtTime(300, t)
    osc.frequency.linearRampToValueAtTime(600, t + 0.5)
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(0.20, t + 0.05)
    gain.gain.linearRampToValueAtTime(0, t + 0.5)
    osc.start(t)
    osc.stop(t + 0.55)
  }

  /**
   * Lead captured by SPARK: short notification ping 500 Hz, 0.1s.
   */
  playLeadCaptured(): void {
    if (!this.ctx || !this.eventGain || !this.canSpawnOsc()) return
    const t = this.ctx.currentTime
    const { osc, gain } = this.createOsc(500, 'sine', this.eventGain)
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(0.15, t + 0.01)
    gain.gain.linearRampToValueAtTime(0, t + 0.1)
    osc.start(t)
    osc.stop(t + 0.12)
  }

  /**
   * Automation failure: low buzz (filtered sawtooth 100 Hz, 0.5s).
   */
  playAutomationFailure(): void {
    if (!this.ctx || !this.eventGain || !this.canSpawnOsc()) return
    const t = this.ctx.currentTime
    const { osc, gain } = this.createOsc(100, 'sawtooth', this.eventGain)

    // Apply lowpass filter for muffled buzz
    const filter = this.ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 300
    filter.Q.value = 2
    osc.disconnect()
    osc.connect(filter)
    filter.connect(gain)

    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(0.14, t + 0.05)
    gain.gain.linearRampToValueAtTime(0, t + 0.5)
    osc.start(t)
    osc.stop(t + 0.55)
  }

  /**
   * Phase transition (diamond→gold ripple): shimmering sweep.
   * White noise filtered through resonant bandpass, sweep 200→2000 Hz over 1s.
   */
  playPhaseTransition(): void {
    if (!this.ctx || !this.eventGain) return
    const duration = 1.0
    const bufSize  = Math.floor(this.ctx.sampleRate * duration)
    const buffer   = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate)
    const data     = buffer.getChannelData(0)
    for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1

    const source = this.ctx.createBufferSource()
    source.buffer = buffer

    const filter = this.ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.setValueAtTime(200, this.ctx.currentTime)
    filter.frequency.linearRampToValueAtTime(2000, this.ctx.currentTime + duration)
    filter.Q.value = 8

    const gain = this.ctx.createGain()
    gain.gain.setValueAtTime(0, this.ctx.currentTime)
    gain.gain.linearRampToValueAtTime(0.18, this.ctx.currentTime + 0.1)
    gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + duration)

    source.connect(filter)
    filter.connect(gain)
    gain.connect(this.eventGain)
    source.start(this.ctx.currentTime)
    source.stop(this.ctx.currentTime + duration + 0.05)
  }

  /**
   * Fog entered: ambient pad swell.
   * fogType: 'revenue' | 'security' | 'bandwidth' | 'improvement'
   */
  playFogEntered(fogType: 'revenue' | 'security' | 'bandwidth' | 'improvement'): void {
    if (!this.ctx || !this.ambientGain || !this.canSpawnOsc()) return
    // Different frequencies for different fog types
    const freqMap = {
      revenue:     55,   // deep
      security:    880,  // sharp
      bandwidth:   220,  // hazy mid
      improvement: 440,  // bright
    }
    const t    = this.ctx.currentTime
    const freq = freqMap[fogType]
    const type: OscillatorType = fogType === 'security' ? 'triangle' : 'sine'
    const { osc, gain } = this.createOsc(freq, type, this.ambientGain)
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(0.10, t + 1.0)
    gain.gain.linearRampToValueAtTime(0, t + 4.0)
    osc.start(t)
    osc.stop(t + 4.5)
  }

  /**
   * Fortress resonant hum when inside. Reverb simulated with delay feedback.
   */
  playFortressHum(): void {
    if (!this.ctx || !this.nodeGain || !this.canSpawnOsc()) return
    const t = this.ctx.currentTime
    const { osc, gain } = this.createOsc(60, 'sine', this.nodeGain)

    // Simple delay-based reverb simulation
    const delay = this.ctx.createDelay(0.5)
    delay.delayTime.value = 0.2
    const feedback = this.ctx.createGain()
    feedback.gain.value = 0.4
    delay.connect(feedback)
    feedback.connect(delay)
    osc.disconnect()
    osc.connect(delay)
    delay.connect(gain)

    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(0.12, t + 2.0)
    gain.gain.linearRampToValueAtTime(0, t + 5.0)
    osc.start(t)
    osc.stop(t + 5.5)
  }

  /**
   * Tick array for AR stalactites — call once per visible stalactite cluster.
   * count: number of stalactites in cluster.
   * avgAgeDays: average age for tick rate.
   */
  scheduleStalactiteTicks(count: number, avgAgeDays: number): void {
    if (!this.ctx || count === 0) return
    // Older = faster ticks. 30-day invoice → 2s interval; 90+ → 0.5s
    const intervalSec = Math.max(0.5, 2.0 - (avgAgeDays / 60))
    // Schedule a burst of count ticks spread over 1 second (polyrhythm)
    for (let i = 0; i < Math.min(count, 4); i++) {
      const offset = (i / count) * intervalSec
      setTimeout(() => this.playStalactiteTick(), offset * 1000)
    }
  }
}

// ── Singleton export ──────────────────────────────────────────────────────────

let _engine: AudioEngine | null = null

export function getAudioEngine(): AudioEngine {
  if (!_engine) _engine = new AudioEngine()
  return _engine
}

export function resetAudioEngine(): void {
  if (_engine) {
    _engine.dispose()
    _engine = null
  }
}
