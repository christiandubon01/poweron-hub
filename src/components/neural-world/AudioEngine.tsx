/**
 * AudioEngine.tsx — NW43 + NW46: Procedural audio engine for Neural World.
 *
 * NW46 additions:
 *   - 5 sound profiles (SILENT / MINIMAL / AMBIENT / FOCUS / IMMERSIVE).
 *   - MINIMAL is the default for new users (no continuous drone).
 *   - Per-layer volume controls with 0.5s crossfades on all transitions.
 *   - Wind noise channel: filtered white noise + slow LFO on filter cutoff.
 *   - Crystal chime scheduler (AMBIENT mode: every 20–40 s random interval).
 *   - Drone only active in IMMERSIVE profile.
 *   - World pulse active only in FOCUS (50%) and IMMERSIVE (100%).
 *
 * Audio graph:
 *   AudioContext
 *   └── masterGain
 *       ├── ambientGain   — drone oscillators (IMMERSIVE only)
 *       ├── windGain      — wind noise (AMBIENT / FOCUS)
 *       ├── nodeGain      — node proximity tones channel
 *       ├── agentGain     — agent sounds channel
 *       ├── eventGain     — event chimes channel
 *       └── pulseGain     — world pulse channel
 *
 * Max 8 simultaneous OscillatorNodes (closest 8 sources enforced by SonicLandscape).
 * All GainNode transitions use linearRampToValueAtTime to avoid clicks/pops.
 *
 * Settings persisted to:
 *   nw_sound_profile_v1   — active SoundProfile
 *   nw_layer_volumes_v1   — LayerVolumes JSON
 */

// Re-export profile types so callers only need one import.
export type { SoundProfile, LayerVolumes } from './SoundProfileManager'
import {
  type SoundProfile,
  type LayerVolumes,
  PROFILE_CONFIGS,
  loadProfile,
  saveProfile,
  loadLayerVolumes,
  saveLayerVolumes,
  clamp01,
  DEFAULT_PROFILE,
} from './SoundProfileManager'

// ── Types ─────────────────────────────────────────────────────────────────────

export type ResonanceState = 'DISSONANT' | 'COHERENT' | 'GROWTH'

export type AudioChannel = 'ambient' | 'wind' | 'nodes' | 'agents' | 'events' | 'pulse'

/** Legacy settings shape — master volume only. Per-layer now managed via LayerVolumes. */
export interface AudioSettings {
  masterVolume: number
  muted: boolean
}

const SETTINGS_KEY = 'nw_audio_settings_v1'

const DEFAULT_SETTINGS: AudioSettings = {
  masterVolume: 0.30,
  muted: false,
}

const FADE_TIME = 0.5   // seconds — crossfade duration for profile transitions

// ── AudioEngine class ─────────────────────────────────────────────────────────

export class AudioEngine {
  private ctx: AudioContext | null = null
  private masterGain:  GainNode | null = null
  private ambientGain: GainNode | null = null
  private windGain:    GainNode | null = null
  private nodeGain:    GainNode | null = null
  private agentGain:   GainNode | null = null
  private eventGain:   GainNode | null = null
  private pulseGain:   GainNode | null = null

  // Ambient drone oscillators (IMMERSIVE only)
  private droneOsc1:      OscillatorNode | null = null
  private droneOsc2:      OscillatorNode | null = null
  private droneGain1:     GainNode | null = null
  private droneGain2:     GainNode | null = null
  private droneHarm1:     OscillatorNode | null = null
  private droneHarm2:     OscillatorNode | null = null
  private droneHarmGain1: GainNode | null = null
  private droneHarmGain2: GainNode | null = null

  // Wind noise (AMBIENT / FOCUS)
  private windSource:   AudioBufferSourceNode | null = null
  private windFilter:   BiquadFilterNode | null = null
  private windLfoOsc:   OscillatorNode | null = null
  private windLfoGain:  GainNode | null = null

  // Crystal chime scheduler
  private crystalChimeTimerId: ReturnType<typeof setTimeout> | null = null

  // GUARDIAN hum oscillator
  private guardianOsc:  OscillatorNode | null = null
  private guardianGain: GainNode | null = null

  // Active oscillator count tracking for budget
  private activeOscCount = 0
  private readonly MAX_OSC = 8

  private settings: AudioSettings
  private currentProfile: SoundProfile
  private layerVolumes: LayerVolumes

  private currentResonanceState: ResonanceState = 'COHERENT'
  private resonanceScoreVal = 0.5

  // World pulse tracking
  private pulseIntervalId: ReturnType<typeof setInterval> | null = null
  private pulsePhase = 0

  // GROWTH cycle tracking for volume envelope
  private growthCycleStart = 0

  constructor() {
    this.settings     = this.loadSettings()
    this.currentProfile = loadProfile()
    this.layerVolumes = loadLayerVolumes()
    // Sync master volume from profile volumes if stored separately
    if (this.layerVolumes.master !== this.settings.masterVolume) {
      this.settings.masterVolume = this.layerVolumes.master
    }
  }

  // ── Legacy settings (master vol / mute) ──────────────────────────────────

  loadSettings(): AudioSettings {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY)
      if (!raw) return { ...DEFAULT_SETTINGS }
      const parsed = JSON.parse(raw) as Partial<AudioSettings>
      return {
        masterVolume: clamp01(parsed.masterVolume ?? DEFAULT_SETTINGS.masterVolume),
        muted:        parsed.muted ?? DEFAULT_SETTINGS.muted,
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
  }

  // ── Profile API ───────────────────────────────────────────────────────────

  getProfile(): SoundProfile {
    return this.currentProfile
  }

  getLayerVolumes(): LayerVolumes {
    return { ...this.layerVolumes }
  }

  /**
   * Switch to a new sound profile with a 0.5s crossfade.
   * Starts/stops wind, drone, proximity, pulse layers as needed.
   */
  setProfile(profile: SoundProfile, fade = FADE_TIME): void {
    const prevProfile = this.currentProfile
    this.currentProfile = profile
    saveProfile(profile)

    if (profile === 'SILENT') {
      this.settings.muted = true
    } else {
      this.settings.muted = false
    }
    this.saveSettings()

    if (!this.ctx) return

    const cfg    = PROFILE_CONFIGS[profile]
    const prevCfg = PROFILE_CONFIGS[prevProfile]
    const t      = this.ctx.currentTime

    // Master gain
    const masterTarget = profile === 'SILENT'
      ? 0
      : this.layerVolumes.master
    this.masterGain?.gain.linearRampToValueAtTime(masterTarget, t + fade)

    // Drone layer — start/stop
    if (cfg.droneEnabled && !prevCfg.droneEnabled) {
      this.startAmbientDrone(this.currentResonanceState, fade)
    } else if (!cfg.droneEnabled && prevCfg.droneEnabled) {
      this.fadeOutDrone(fade)
    }

    // Wind layer
    if (cfg.windEnabled && !prevCfg.windEnabled) {
      this.startWindNoise()
    } else if (!cfg.windEnabled && prevCfg.windEnabled) {
      this.stopWindNoise()
    }

    // Crystal chimes
    if (cfg.crystalChimes && !prevCfg.crystalChimes) {
      this.startCrystalChimeScheduler()
    } else if (!cfg.crystalChimes && prevCfg.crystalChimes) {
      this.stopCrystalChimeScheduler()
    }

    // Channel gain targets
    this.applyAllChannelGains(fade)
  }

  setLayerVolume(key: keyof LayerVolumes, value: number): void {
    this.layerVolumes[key] = clamp01(value)
    saveLayerVolumes(this.layerVolumes)

    if (key === 'master') {
      this.settings.masterVolume = this.layerVolumes.master
      this.saveSettings()
      this.applyMasterVolume()
    } else {
      this.applyAllChannelGains(0.08)
    }
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
      const profile = this.currentProfile
      this.masterGain.gain.value = (profile === 'SILENT' || this.settings.muted)
        ? 0
        : this.layerVolumes.master
      this.masterGain.connect(this.ctx.destination)

      // Channel gains
      this.ambientGain = this.createChannelGain('ambient')
      this.windGain    = this.createChannelGain('wind')
      this.nodeGain    = this.createChannelGain('nodes')
      this.agentGain   = this.createChannelGain('agents')
      this.eventGain   = this.createChannelGain('events')
      this.pulseGain   = this.createChannelGain('pulse')

      const cfg = PROFILE_CONFIGS[profile]

      // Start drone only in IMMERSIVE
      if (cfg.droneEnabled) {
        this.startAmbientDrone(this.currentResonanceState, 3)
      }

      // Start GUARDIAN hum only when proximity is active
      if (cfg.proximityEnabled) {
        this.startGuardianHum()
      }

      // Start world pulse only in FOCUS / IMMERSIVE
      if (cfg.pulseEnabled) {
        this.startWorldPulse()
      }

      // Wind noise for AMBIENT / FOCUS
      if (cfg.windEnabled) {
        this.startWindNoise()
      }

      // Crystal chimes for AMBIENT
      if (cfg.crystalChimes) {
        this.startCrystalChimeScheduler()
      }

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
    this.stopWindNoise()
    this.stopCrystalChimeScheduler()
    try { this.ctx?.close() } catch { /* ignore */ }
    this.ctx         = null
    this.masterGain  = null
    this.ambientGain = null
    this.windGain    = null
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
    g.gain.value = this.channelTargetVolume(channel)
    g.connect(this.masterGain)
    return g
  }

  /** Target gain for a channel given the current profile + layer volumes. */
  private channelTargetVolume(channel: AudioChannel): number {
    const cfg = PROFILE_CONFIGS[this.currentProfile]
    const v   = this.layerVolumes
    switch (channel) {
      case 'ambient': return cfg.droneEnabled     ? v.drone     : 0
      case 'wind':    return cfg.windEnabled       ? v.ambient   : 0
      case 'nodes':   return cfg.proximityEnabled  ? v.proximity : 0
      case 'agents':  return cfg.proximityEnabled  ? v.proximity : 0
      case 'events':  return cfg.eventsEnabled     ? v.events    : 0
      case 'pulse':   return cfg.pulseEnabled
        ? (v.pulse * cfg.pulseVolumeScale)
        : 0
    }
  }

  private channelGainNode(channel: AudioChannel): GainNode | null {
    switch (channel) {
      case 'ambient': return this.ambientGain
      case 'wind':    return this.windGain
      case 'nodes':   return this.nodeGain
      case 'agents':  return this.agentGain
      case 'events':  return this.eventGain
      case 'pulse':   return this.pulseGain
    }
  }

  private applyAllChannelGains(fade = FADE_TIME): void {
    const channels: AudioChannel[] = ['ambient', 'wind', 'nodes', 'agents', 'events', 'pulse']
    channels.forEach(ch => this.applyChannelGain(ch, fade))
  }

  private applyChannelGain(channel: AudioChannel, fade = FADE_TIME): void {
    const node = this.channelGainNode(channel)
    if (!node || !this.ctx) return
    const t = this.ctx.currentTime + Math.max(0.01, fade)
    node.gain.linearRampToValueAtTime(this.channelTargetVolume(channel), t)
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
    osc.type = type
    osc.frequency.value = freq
    osc.connect(gain)
    gain.connect(destination)
    this.activeOscCount++
    osc.onended = () => { this.activeOscCount-- }
    return { osc, gain }
  }

  // ── Master volume / mute ──────────────────────────────────────────────────

  private applyMasterVolume(): void {
    if (!this.ctx || !this.masterGain) return
    const t = this.ctx.currentTime + 0.05
    const v = (this.settings.muted || this.currentProfile === 'SILENT')
      ? 0
      : this.layerVolumes.master
    this.masterGain.gain.linearRampToValueAtTime(v, t)
  }

  setMasterVolume(v: number): void {
    this.layerVolumes.master    = clamp01(v)
    this.settings.masterVolume  = this.layerVolumes.master
    saveLayerVolumes(this.layerVolumes)
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

  // ── Ambient Drone (IMMERSIVE only) ────────────────────────────────────────

  private fadeOutDrone(fade = FADE_TIME): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime + fade
    const nodes = [
      this.droneGain1, this.droneGain2,
      this.droneHarmGain1, this.droneHarmGain2,
    ]
    nodes.forEach(g => {
      if (g) {
        g.gain.linearRampToValueAtTime(0, t)
      }
    })
    setTimeout(() => this.stopAmbientDrone(), (fade + 0.1) * 1000)
  }

  private stopAmbientDrone(): void {
    try { this.droneOsc1?.stop(); this.droneOsc2?.stop() } catch { /* ignore */ }
    try { this.droneHarm1?.stop(); this.droneHarm2?.stop() } catch { /* ignore */ }
    this.droneOsc1 = this.droneOsc2 = null
    this.droneGain1 = this.droneGain2 = null
    this.droneHarm1 = this.droneHarm2 = null
    this.droneHarmGain1 = this.droneHarmGain2 = null
  }

  private startAmbientDrone(state: ResonanceState, fadeSecs = FADE_TIME): void {
    if (!this.ctx || !this.ambientGain) return
    this.stopAmbientDrone()

    const t = this.ctx.currentTime

    if (state === 'DISSONANT') {
      // Two slightly detuned oscillators → beat frequency ~3 Hz
      if (!this.canSpawnOsc()) return
      const { osc: o1, gain: g1 } = this.createOsc(80, 'sine', this.ambientGain)
      g1.gain.setValueAtTime(0, t)
      g1.gain.linearRampToValueAtTime(0.35, t + fadeSecs)
      o1.start(t)
      this.droneOsc1 = o1
      this.droneGain1 = g1

      if (!this.canSpawnOsc()) return
      const { osc: o2, gain: g2 } = this.createOsc(83, 'sine', this.ambientGain)
      g2.gain.setValueAtTime(0, t)
      g2.gain.linearRampToValueAtTime(0.30, t + fadeSecs + 0.5)
      o2.start(t)
      this.droneOsc2 = o2
      this.droneGain2 = g2

    } else if (state === 'COHERENT') {
      // Single clean sine tone: 110 Hz (A2)
      if (!this.canSpawnOsc()) return
      const { osc: o1, gain: g1 } = this.createOsc(110, 'sine', this.ambientGain)
      g1.gain.setValueAtTime(0, t)
      g1.gain.linearRampToValueAtTime(0.30, t + fadeSecs)
      o1.start(t)
      this.droneOsc1 = o1
      this.droneGain1 = g1

    } else {
      // GROWTH: 110 Hz + 220 Hz + 330 Hz harmonics
      this.growthCycleStart = t
      if (!this.canSpawnOsc()) return
      const { osc: o1, gain: g1 } = this.createOsc(110, 'sine', this.ambientGain)
      g1.gain.setValueAtTime(0, t)
      g1.gain.linearRampToValueAtTime(0.28, t + fadeSecs)
      o1.start(t)
      this.droneOsc1 = o1
      this.droneGain1 = g1

      if (!this.canSpawnOsc()) return
      const { osc: h1, gain: hg1 } = this.createOsc(220, 'sine', this.ambientGain)
      hg1.gain.setValueAtTime(0, t)
      hg1.gain.linearRampToValueAtTime(0.18, t + fadeSecs + 1)
      h1.start(t)
      this.droneHarm1 = h1
      this.droneHarmGain1 = hg1

      if (!this.canSpawnOsc()) return
      const { osc: h2, gain: hg2 } = this.createOsc(330, 'sine', this.ambientGain)
      hg2.gain.setValueAtTime(0, t)
      hg2.gain.linearRampToValueAtTime(0.10, t + fadeSecs + 2)
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
      const cfg = PROFILE_CONFIGS[this.currentProfile]
      if (state !== prevState) {
        if (cfg.droneEnabled) {
          this.startAmbientDrone(state)
        }
        if (cfg.pulseEnabled) {
          this.restartWorldPulse()
        }
      }
    }
  }

  // ── Wind Noise (AMBIENT / FOCUS) ──────────────────────────────────────────

  private startWindNoise(): void {
    if (!this.ctx || !this.windGain) return
    this.stopWindNoise()

    // Long looping white-noise buffer (10 s)
    const duration = 10
    const sampleRate = this.ctx.sampleRate
    const bufSize = Math.floor(sampleRate * duration)
    const buffer = this.ctx.createBuffer(1, bufSize, sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < bufSize; i++) {
      // Brown-ish noise: integrate and normalize
      data[i] = Math.random() * 2 - 1
    }

    this.windSource = this.ctx.createBufferSource()
    this.windSource.buffer = buffer
    this.windSource.loop   = true

    // Low-pass filter for wind character
    this.windFilter = this.ctx.createBiquadFilter()
    this.windFilter.type            = 'lowpass'
    this.windFilter.frequency.value = 600
    this.windFilter.Q.value         = 0.5

    // Slow LFO on filter cutoff (0.1 Hz → 10 s period)
    this.windLfoOsc  = this.ctx.createOscillator()
    this.windLfoGain = this.ctx.createGain()
    this.windLfoOsc.type = 'sine'
    this.windLfoOsc.frequency.value = 0.1   // very slow
    this.windLfoGain.gain.value     = 300   // ± 300 Hz sweep around 600 Hz base

    this.windLfoOsc.connect(this.windLfoGain)
    this.windLfoGain.connect(this.windFilter.frequency)

    // Volume envelope — gentle fade in
    const windVolumeGain = this.ctx.createGain()
    windVolumeGain.gain.setValueAtTime(0, this.ctx.currentTime)
    windVolumeGain.gain.linearRampToValueAtTime(0.18, this.ctx.currentTime + 3)

    this.windSource.connect(this.windFilter)
    this.windFilter.connect(windVolumeGain)
    windVolumeGain.connect(this.windGain)

    this.windSource.start(this.ctx.currentTime)
    this.windLfoOsc.start(this.ctx.currentTime)
  }

  private stopWindNoise(): void {
    try { this.windSource?.stop() } catch { /* ignore */ }
    try { this.windLfoOsc?.stop() } catch { /* ignore */ }
    this.windSource  = null
    this.windFilter  = null
    this.windLfoOsc  = null
    this.windLfoGain = null
  }

  // ── Crystal Chime Scheduler (AMBIENT mode) ────────────────────────────────

  private startCrystalChimeScheduler(): void {
    this.stopCrystalChimeScheduler()
    const scheduleNext = () => {
      const delayMs = 20000 + Math.random() * 20000  // 20–40 s
      this.crystalChimeTimerId = setTimeout(() => {
        if (PROFILE_CONFIGS[this.currentProfile].crystalChimes) {
          this.playCrystalChime()
          scheduleNext()
        }
      }, delayMs)
    }
    // First chime after 5–12 s
    this.crystalChimeTimerId = setTimeout(() => {
      if (PROFILE_CONFIGS[this.currentProfile].crystalChimes) {
        this.playCrystalChime()
        scheduleNext()
      }
    }, 5000 + Math.random() * 7000)
  }

  private stopCrystalChimeScheduler(): void {
    if (this.crystalChimeTimerId !== null) {
      clearTimeout(this.crystalChimeTimerId)
      this.crystalChimeTimerId = null
    }
  }

  /**
   * Crystal chime: two-tone high-pitched soft chime (1200 Hz + 1800 Hz),
   * slow attack, long decay.
   */
  playCrystalChime(): void {
    if (!this.ctx || !this.eventGain) return
    const t = this.ctx.currentTime
    const chimes = [1200, 1800, 2400]
    chimes.forEach((freq, i) => {
      if (!this.ctx || !this.eventGain || !this.canSpawnOsc()) return
      const { osc, gain } = this.createOsc(freq, 'sine', this.eventGain)
      const delay = i * 0.15
      gain.gain.setValueAtTime(0, t + delay)
      gain.gain.linearRampToValueAtTime(0.06, t + delay + 0.08)
      gain.gain.exponentialRampToValueAtTime(0.001, t + delay + 2.5)
      osc.start(t + delay)
      osc.stop(t + delay + 2.6)
    })
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
      let intervalMs: number
      if (this.currentResonanceState === 'DISSONANT') {
        intervalMs = 300 + Math.random() * 1200
      } else if (this.currentResonanceState === 'COHERENT') {
        intervalMs = 1000
      } else {
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
    this.guardianOsc  = null
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
    const cfg = PROFILE_CONFIGS[this.currentProfile]
    if (!cfg.proximityEnabled) return
    const t = this.ctx.currentTime + 0.1
    this.guardianGain.gain.linearRampToValueAtTime(proximity01 * 0.12, t)
  }

  // ── Node Proximity Sounds ─────────────────────────────────────────────────

  playProjectTone(value: number, healthy: boolean): void {
    const cfg = PROFILE_CONFIGS[this.currentProfile]
    if (!cfg.proximityEnabled) return
    if (!this.ctx || !this.nodeGain || !this.canSpawnOsc()) return
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

  playRiverSound(widthFactor: number, smooth: boolean): void {
    const cfg = PROFILE_CONFIGS[this.currentProfile]
    if (!cfg.proximityEnabled) return
    if (!this.ctx || !this.nodeGain) return
    const duration = 2.0
    const bufSize  = Math.floor(this.ctx.sampleRate * duration)
    const buffer   = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate)
    const data     = buffer.getChannelData(0)

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

  playStalactiteTick(): void {
    if (!this.ctx || !this.nodeGain || !this.canSpawnOsc()) return
    const cfg = PROFILE_CONFIGS[this.currentProfile]
    if (!cfg.proximityEnabled) return
    const t = this.ctx.currentTime
    const { osc, gain } = this.createOsc(1200, 'sine', this.nodeGain)
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(0.08, t + 0.01)
    gain.gain.linearRampToValueAtTime(0, t + 0.05)
    osc.start(t)
    osc.stop(t + 0.06)
  }

  playKatsuroBridgeChord(distance: number): void {
    const cfg = PROFILE_CONFIGS[this.currentProfile]
    if (!cfg.proximityEnabled) return
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

  playAgentFlyby(speed: number): void {
    // Agent flyby is an event sound — active in MINIMAL+
    if (!this.ctx || !this.agentGain) return
    const cfg = PROFILE_CONFIGS[this.currentProfile]
    if (!cfg.eventsEnabled && !cfg.proximityEnabled) return
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

  playNexusSweep(): void {
    if (!this.ctx || !this.agentGain) return
    const cfg = PROFILE_CONFIGS[this.currentProfile]
    if (!cfg.eventsEnabled && !cfg.proximityEnabled) return
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

  playDataCubePickup(): void {
    if (!this.ctx || !this.agentGain || !this.canSpawnOsc()) return
    const cfg = PROFILE_CONFIGS[this.currentProfile]
    if (!cfg.eventsEnabled && !cfg.proximityEnabled) return
    const t = this.ctx.currentTime
    const { osc, gain } = this.createOsc(800, 'sine', this.agentGain)
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(0.18, t + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4)
    osc.start(t)
    osc.stop(t + 0.45)
  }

  playDataCubeDrop(): void {
    if (!this.ctx || !this.agentGain || !this.canSpawnOsc()) return
    const cfg = PROFILE_CONFIGS[this.currentProfile]
    if (!cfg.eventsEnabled && !cfg.proximityEnabled) return
    const t = this.ctx.currentTime
    const { osc, gain } = this.createOsc(400, 'sine', this.agentGain)
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(0.15, t + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.8)
    osc.start(t)
    osc.stop(t + 0.85)
  }

  playNexusMerge(): void {
    if (!this.ctx || !this.agentGain) return
    const cfg = PROFILE_CONFIGS[this.currentProfile]
    if (!cfg.eventsEnabled && !cfg.proximityEnabled) return
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

  playInvoicePaid(): void {
    if (!this.ctx || !this.eventGain || !this.canSpawnOsc()) return
    const cfg = PROFILE_CONFIGS[this.currentProfile]
    if (!cfg.eventsEnabled) return
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

  playLeadCaptured(): void {
    if (!this.ctx || !this.eventGain || !this.canSpawnOsc()) return
    const cfg = PROFILE_CONFIGS[this.currentProfile]
    if (!cfg.eventsEnabled) return
    const t = this.ctx.currentTime
    const { osc, gain } = this.createOsc(500, 'sine', this.eventGain)
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(0.15, t + 0.01)
    gain.gain.linearRampToValueAtTime(0, t + 0.1)
    osc.start(t)
    osc.stop(t + 0.12)
  }

  playAutomationFailure(): void {
    if (!this.ctx || !this.eventGain || !this.canSpawnOsc()) return
    const cfg = PROFILE_CONFIGS[this.currentProfile]
    if (!cfg.eventsEnabled) return
    const t = this.ctx.currentTime
    const { osc, gain } = this.createOsc(100, 'sawtooth', this.eventGain)

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

  playPhaseTransition(): void {
    if (!this.ctx || !this.eventGain) return
    const cfg = PROFILE_CONFIGS[this.currentProfile]
    if (!cfg.eventsEnabled) return
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

  playFogEntered(fogType: 'revenue' | 'security' | 'bandwidth' | 'improvement'): void {
    const cfg = PROFILE_CONFIGS[this.currentProfile]
    if (!cfg.eventsEnabled) return
    if (!this.ctx || !this.ambientGain || !this.canSpawnOsc()) return
    const freqMap = {
      revenue:     55,
      security:    880,
      bandwidth:   220,
      improvement: 440,
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

  playFortressHum(): void {
    const cfg = PROFILE_CONFIGS[this.currentProfile]
    if (!cfg.proximityEnabled) return
    if (!this.ctx || !this.nodeGain || !this.canSpawnOsc()) return
    const t = this.ctx.currentTime
    const { osc, gain } = this.createOsc(60, 'sine', this.nodeGain)

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

  scheduleStalactiteTicks(count: number, avgAgeDays: number): void {
    if (!this.ctx || count === 0) return
    const intervalSec = Math.max(0.5, 2.0 - (avgAgeDays / 60))
    for (let i = 0; i < Math.min(count, 4); i++) {
      const offset = (i / count) * intervalSec
      setTimeout(() => this.playStalactiteTick(), offset * 1000)
    }
  }

  // ── Compatibility shim for legacy callers ─────────────────────────────────

  /** @deprecated Use setProfile() instead. */
  setMasterVolumeCompat(v: number): void {
    this.setMasterVolume(v)
  }

  /** Returns the current profile for display in HUD. */
  get profile(): SoundProfile {
    return this.currentProfile
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

/** Default profile for new users. */
export { DEFAULT_PROFILE } from './SoundProfileManager'
