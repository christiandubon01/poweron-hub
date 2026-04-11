// @ts-nocheck
/**
 * VoiceSettings — Voice preferences panel
 *
 * Allows the user to:
 *   - Select ElevenLabs voice (4 options with preview)
 *   - Adjust TTS playback speed
 *   - Set wake word sensitivity
 *   - Toggle hands-free (wake word) mode
 *   - Toggle push-to-talk
 *   - Set noise suppression strength for field mode
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { Volume2, Mic, Radio, Shield, Save, Loader2, Check, Play, Square, AlertCircle } from 'lucide-react'
import { clsx } from 'clsx'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { AVAILABLE_VOICES, type ElevenLabsVoice, fetchElevenLabsVoices, type ElevenLabsAPIVoice } from '@/api/voice/elevenLabs'

interface VoicePrefs {
  enabled: boolean
  tts_voice_id: string
  tts_speed: number
  asr_language: string
  noise_suppression_strength: number
  wake_word_enabled: boolean
  wake_word_phrase: string
  field_mode_enabled: boolean
  push_to_talk_enabled: boolean
  push_to_talk_key: string
  voice_response_delay: number      // seconds before NEXUS responds (0.5-5.0, default 1.75)
  ask_before_responding: boolean    // whether to ask "Anything else?" before processing
}

const DEFAULT_PREFS: VoicePrefs = {
  enabled: true,
  tts_voice_id: AVAILABLE_VOICES[0]?.voice_id || '',
  tts_speed: 1.0,
  asr_language: 'en',
  noise_suppression_strength: 0.7,
  wake_word_enabled: true,
  wake_word_phrase: 'Hey NEXUS',
  field_mode_enabled: true,
  push_to_talk_enabled: false,
  push_to_talk_key: 'Space',
  voice_response_delay: 1.75,       // 1.75 seconds default
  ask_before_responding: false,
}

export function VoiceSettings() {
  const { user, profile } = useAuth()
  const [prefs, setPrefs] = useState<VoicePrefs>(DEFAULT_PREFS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // API-fetched voices
  const [apiVoices, setApiVoices] = useState<ElevenLabsAPIVoice[]>([])
  const [voicesLoading, setVoicesLoading] = useState(true)
  const [previewingVoice, setPreviewingVoice] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const previewAudioRef = useRef<HTMLAudioElement | null>(null)

  const orgId = profile?.org_id
  const userId = user?.id

  // Fetch ElevenLabs voices from API
  useEffect(() => {
    let cancelled = false
    fetchElevenLabsVoices().then(voices => {
      if (!cancelled) {
        setApiVoices(voices)
        setVoicesLoading(false)
      }
    }).catch(() => {
      if (!cancelled) setVoicesLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  // Web Speech API fallback for preview when HTMLAudioElement fails (iPhone Chrome/Safari)
  const speakPreviewFallback = useCallback((voiceName: string, voiceId: string) => {
    if (!window.speechSynthesis) {
      setPreviewingVoice(null)
      setPreviewError(voiceId)
      setTimeout(() => setPreviewError(null), 3000)
      return
    }
    const utterance = new SpeechSynthesisUtterance(
      `This is ${voiceName}. I am your NEXUS voice assistant for Power On Solutions.`
    )
    utterance.rate = 1.0
    utterance.pitch = 1.0
    utterance.volume = 1.0
    utterance.onstart = () => {
      setPreviewLoading(null)
      setPreviewingVoice(voiceId)
    }
    utterance.onend = () => setPreviewingVoice(null)
    utterance.onerror = () => {
      setPreviewingVoice(null)
      setPreviewError(voiceId)
      setTimeout(() => setPreviewError(null), 3000)
    }
    window.speechSynthesis.speak(utterance)
  }, [])

  // Preview voice playback — uses HTMLAudioElement with playsInline for iOS,
  // falls back to Web Speech API if audio playback fails (iPhone Chrome/Safari)
  const handlePreview = useCallback((voice: ElevenLabsAPIVoice) => {
    // Stop any current preview
    if (previewAudioRef.current) {
      previewAudioRef.current.pause()
      previewAudioRef.current.removeAttribute('src')
      previewAudioRef.current = null
    }
    // Cancel any ongoing Web Speech
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel()
    }

    // Toggle off if already previewing this voice
    if (previewingVoice === voice.voice_id) {
      setPreviewingVoice(null)
      setPreviewLoading(null)
      return
    }

    if (!voice.preview_url) {
      // No preview URL — try Web Speech fallback directly
      speakPreviewFallback(voice.name, voice.voice_id)
      return
    }

    // Show loading state
    setPreviewLoading(voice.voice_id)
    setPreviewError(null)

    // Fetch audio data, then play via HTMLAudioElement with playsInline
    fetch(voice.preview_url)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.arrayBuffer()
      })
      .then(buffer => {
        const blob = new Blob([buffer], { type: 'audio/mpeg' })
        const url = URL.createObjectURL(blob)

        const audio = document.createElement('audio')
        audio.playsInline = true
        audio.preload = 'auto'
        audio.src = url

        audio.oncanplaythrough = () => {
          setPreviewLoading(null)
          setPreviewingVoice(voice.voice_id)
          audio.play().catch(() => {
            // HTMLAudioElement failed — fall back to Web Speech API
            URL.revokeObjectURL(url)
            speakPreviewFallback(voice.name, voice.voice_id)
          })
        }

        audio.onended = () => {
          setPreviewingVoice(null)
          URL.revokeObjectURL(url)
        }

        audio.onerror = () => {
          setPreviewLoading(null)
          URL.revokeObjectURL(url)
          // Fall back to Web Speech instead of showing error
          speakPreviewFallback(voice.name, voice.voice_id)
        }

        audio.load()
        previewAudioRef.current = audio
      })
      .catch(() => {
        setPreviewLoading(null)
        // Fetch failed — fall back to Web Speech
        speakPreviewFallback(voice.name, voice.voice_id)
      })
  }, [previewingVoice, speakPreviewFallback])

  // Cleanup preview on unmount
  useEffect(() => {
    return () => {
      if (previewAudioRef.current) {
        previewAudioRef.current.pause()
        previewAudioRef.current = null
      }
    }
  }, [])

  // Load preferences
  useEffect(() => {
    if (!orgId || !userId) return

    const load = async () => {
      try {
        // FIX 2: Remove .eq('org_id') — RLS uses user_id = auth.uid(), filter by user_id only
        // Use .limit(1) instead of .single() to avoid 406 when no row exists yet
        const { data: rows } = await supabase
          .from('voice_preferences' as never)
          .select('*')
          .eq('user_id', userId)
          .limit(1)

        const data = (rows as any[])?.[0] || null

        // localStorage is the source of truth for voice_id and speed —
        // the user may have changed these since last Supabase save.
        const lsVoiceId = localStorage.getItem('nexus_voice_id') || null
        const lsSpeed = localStorage.getItem('nexus_speech_rate') ? parseFloat(localStorage.getItem('nexus_speech_rate')!) : null

        if (data) {
          const d = data as any
          setPrefs({
            enabled: d.enabled ?? true,
            tts_voice_id: lsVoiceId || d.tts_voice_id || DEFAULT_PREFS.tts_voice_id,
            tts_speed: lsSpeed ?? d.tts_speed ?? 1.0,
            asr_language: d.asr_language || 'en',
            noise_suppression_strength: d.noise_suppression_strength ?? 0.7,
            wake_word_enabled: d.wake_word_enabled ?? true,
            wake_word_phrase: d.wake_word_phrase || 'Hey NEXUS',
            field_mode_enabled: d.field_mode_enabled ?? true,
            push_to_talk_enabled: d.push_to_talk_enabled ?? false,
            push_to_talk_key: d.push_to_talk_key || 'Space',
            voice_response_delay: d.voice_response_delay ?? 1.75,
            ask_before_responding: d.ask_before_responding ?? false,
          })
        } else if (lsVoiceId || lsSpeed !== null) {
          // No Supabase row yet — seed from localStorage
          setPrefs(prev => ({
            ...prev,
            ...(lsVoiceId ? { tts_voice_id: lsVoiceId } : {}),
            ...(lsSpeed !== null ? { tts_speed: lsSpeed } : {}),
          }))
        }
      } catch {
        // No preferences yet — use defaults
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [orgId, userId])

  const handleSave = async () => {
    if (!orgId || !userId) return

    setSaving(true)
    try {
      await supabase
        .from('voice_preferences' as never)
        .upsert({
          org_id: orgId,
          user_id: userId,
          ...prefs,
          updated_at: new Date().toISOString(),
        })

      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      console.error('[VoiceSettings] Save error:', err)
    } finally {
      setSaving(false)
    }
  }

  // Voice update confirmation state
  const [voiceUpdated, setVoiceUpdated] = useState(false)

  const update = (key: keyof VoicePrefs, value: unknown) => {
    setPrefs(prev => ({ ...prev, [key]: value }))
    setSaved(false)
    // Persist voice ID to localStorage immediately so TTS picks it up at call time
    if (key === 'tts_voice_id' && typeof value === 'string') {
      localStorage.setItem('nexus_voice_id', value)
      const voiceName = apiVoices.find(v => v.voice_id === value)?.name || value
      console.log('[VoiceSettings] Selected voice:', voiceName, value)
      setVoiceUpdated(true)
      setTimeout(() => setVoiceUpdated(false), 3000)
    }
    // Persist speech rate to localStorage immediately
    if (key === 'tts_speed' && typeof value === 'number') {
      localStorage.setItem('nexus_speech_rate', String(value))
      console.log('[VoiceSettings] Speech rate updated:', value)
    }
  }

  const selectedVoice = apiVoices.find(v => v.voice_id === prefs.tts_voice_id)
    || AVAILABLE_VOICES.find(v => v.voice_id === prefs.tts_voice_id)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        <Loader2 className="w-6 h-6 animate-spin mr-2" />
        Loading voice settings...
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
          <Mic className="w-5 h-5 text-emerald-400" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-gray-100">Voice Settings</h2>
          <p className="text-sm text-gray-400">Configure ECHO voice agent preferences</p>
        </div>
      </div>

      {/* Master toggle */}
      <Section>
        <Toggle
          label="Enable Voice"
          description="Turn the ECHO voice agent on or off"
          checked={prefs.enabled}
          onChange={v => update('enabled', v)}
        />
      </Section>

      {/* Voice Selection */}
      <Section title="NEXUS Voice" icon={<Volume2 className="w-4 h-4" />}>
        <p className="text-sm text-gray-400 mb-3">Choose the voice for spoken responses</p>
        {voicesLoading ? (
          <div className="flex items-center gap-2 text-gray-500 text-sm py-4">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading voices...
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[320px] overflow-y-auto pr-1">
            {apiVoices.map((voice) => (
              <APIVoiceCard
                key={voice.voice_id}
                voice={voice}
                selected={prefs.tts_voice_id === voice.voice_id}
                previewing={previewingVoice === voice.voice_id}
                previewLoading={previewLoading === voice.voice_id}
                previewFailed={previewError === voice.voice_id}
                onClick={() => update('tts_voice_id', voice.voice_id)}
                onPreview={() => handlePreview(voice)}
              />
            ))}
          </div>
        )}

        {/* Voice updated confirmation */}
        {voiceUpdated && (
          <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-medium animate-fade-in">
            <Check className="w-3.5 h-3.5 flex-shrink-0" />
            Voice updated — tap mic to test
          </div>
        )}

        {/* Speed slider */}
        <div className="mt-5">
          <label className="flex items-center justify-between text-sm">
            <span className="text-gray-300">Speech Speed</span>
            <span className="text-emerald-400 font-mono">{prefs.tts_speed.toFixed(1)}x</span>
          </label>
          <input
            type="range"
            min={0.7}
            max={1.3}
            step={0.05}
            value={prefs.tts_speed}
            onChange={e => update('tts_speed', parseFloat(e.target.value))}
            className="w-full mt-2 accent-emerald-500"
          />
          <div className="flex justify-between text-xs text-gray-600 mt-1">
            <span>0.7x Slow</span>
            <span>1.0x Normal</span>
            <span>1.3x Fast</span>
          </div>
        </div>
      </Section>

      {/* Wake Word / Hands-Free */}
      <Section title="Activation" icon={<Radio className="w-4 h-4" />}>
        <Toggle
          label="Hands-Free Mode"
          description={`Say "${prefs.wake_word_phrase}" to activate without pressing the button`}
          checked={prefs.wake_word_enabled}
          onChange={v => update('wake_word_enabled', v)}
        />

        <div className="mt-4">
          <Toggle
            label="Push-to-Talk"
            description="Hold a key to record instead of pressing the mic button"
            checked={prefs.push_to_talk_enabled}
            onChange={v => update('push_to_talk_enabled', v)}
          />
          {prefs.push_to_talk_enabled && (
            <div className="mt-2 ml-12">
              <select
                value={prefs.push_to_talk_key}
                onChange={e => update('push_to_talk_key', e.target.value)}
                className="bg-gray-800 text-gray-200 text-sm rounded-lg px-3 py-1.5 border border-gray-700"
              >
                <option value="Space">Spacebar</option>
                <option value="Ctrl+Space">Ctrl + Space</option>
                <option value="F5">F5</option>
              </select>
            </div>
          )}
        </div>
      </Section>

      {/* Field Mode / Noise */}
      <Section title="Field Mode" icon={<Shield className="w-4 h-4" />}>
        <Toggle
          label="Field Mode"
          description="Optimized for noisy job-site environments with enhanced noise suppression"
          checked={prefs.field_mode_enabled}
          onChange={v => update('field_mode_enabled', v)}
        />

        {prefs.field_mode_enabled && (
          <div className="mt-4 ml-12">
            <label className="flex items-center justify-between text-sm">
              <span className="text-gray-300">Noise Suppression</span>
              <span className="text-emerald-400 font-mono">
                {Math.round(prefs.noise_suppression_strength * 100)}%
              </span>
            </label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={prefs.noise_suppression_strength}
              onChange={e => update('noise_suppression_strength', parseFloat(e.target.value))}
              className="w-full mt-2 accent-emerald-500"
            />
            <div className="flex justify-between text-xs text-gray-600 mt-1">
              <span>Off</span>
              <span>Light</span>
              <span>Maximum</span>
            </div>
          </div>
        )}
      </Section>

      {/* Voice Response Timing */}
      <Section title="Response Behavior" icon={<Radio className="w-4 h-4" />}>
        <p className="text-sm text-gray-400 mb-4">Customize how NEXUS responds after you speak</p>
        
        {/* Response delay slider */}
        <div className="mb-5">
          <label className="flex items-center justify-between text-sm">
            <span className="text-gray-300">Response Delay</span>
            <span className="text-emerald-400 font-mono">{prefs.voice_response_delay.toFixed(2)}s</span>
          </label>
          <p className="text-xs text-gray-500 mt-1 mb-2">Time before NEXUS starts speaking after silence detection</p>
          <input
            type="range"
            min={0.5}
            max={5.0}
            step={0.25}
            value={prefs.voice_response_delay}
            onChange={e => update('voice_response_delay', parseFloat(e.target.value))}
            className="w-full accent-emerald-500"
          />
          <div className="flex justify-between text-xs text-gray-600 mt-1">
            <span>0.5s Fast</span>
            <span>1.75s Default</span>
            <span>5.0s Slow</span>
          </div>
        </div>

        {/* Ask before responding toggle */}
        <Toggle
          label="Ask Before Responding"
          description='After silence, NEXUS will say "Anything else?" and wait 2 seconds for follow-up'
          checked={prefs.ask_before_responding}
          onChange={v => update('ask_before_responding', v)}
        />
      </Section>

      {/* Save button */}
      <div className="flex justify-end pt-2">
        <button
          onClick={handleSave}
          disabled={saving || saved}
          className={clsx(
            'flex items-center gap-2 px-6 py-2.5 rounded-lg font-medium transition-all',
            saved
              ? 'bg-emerald-600 text-white'
              : 'bg-emerald-600 hover:bg-emerald-500 text-white',
            (saving || saved) && 'opacity-80',
          )}
        >
          {saving ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>
          ) : saved ? (
            <><Check className="w-4 h-4" /> Saved</>
          ) : (
            <><Save className="w-4 h-4" /> Save Preferences</>
          )}
        </button>
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Section({ title, icon, children }: {
  title?: string
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="bg-gray-800/50 rounded-xl p-5 border border-gray-700/50">
      {title && (
        <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">
          {icon && <span className="text-emerald-400">{icon}</span>}
          {title}
        </h3>
      )}
      {children}
    </div>
  )
}

function Toggle({ label, description, checked, onChange }: {
  label: string
  description: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer group">
      <div className="pt-0.5">
        <div
          className={clsx(
            'w-10 h-6 rounded-full transition-colors relative',
            checked ? 'bg-emerald-600' : 'bg-gray-700',
          )}
          onClick={() => onChange(!checked)}
        >
          <div
            className={clsx(
              'absolute top-1 w-4 h-4 rounded-full bg-white transition-transform shadow-sm',
              checked ? 'translate-x-5' : 'translate-x-1',
            )}
          />
        </div>
      </div>
      <div>
        <span className="text-gray-200 font-medium text-sm group-hover:text-white transition-colors">
          {label}
        </span>
        <p className="text-xs text-gray-500 mt-0.5">{description}</p>
      </div>
    </label>
  )
}

function VoiceCard({ voice, selected, onClick }: {
  voice: ElevenLabsVoice
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'flex items-center gap-3 p-3 rounded-lg border transition-all text-left',
        selected
          ? 'border-emerald-500/50 bg-emerald-500/10'
          : 'border-gray-700 bg-gray-800/30 hover:border-gray-600',
      )}
    >
      <div
        className={clsx(
          'w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold',
          selected ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-700 text-gray-400',
        )}
      >
        {voice.name[0]}
      </div>
      <div>
        <span className={clsx(
          'text-sm font-medium',
          selected ? 'text-emerald-400' : 'text-gray-300',
        )}>
          {voice.name}
        </span>
        <p className="text-xs text-gray-500 capitalize">{voice.gender}</p>
      </div>
      {selected && (
        <Check className="w-4 h-4 text-emerald-400 ml-auto" />
      )}
    </button>
  )
}

function APIVoiceCard({ voice, selected, previewing, previewLoading, previewFailed, onClick, onPreview }: {
  voice: ElevenLabsAPIVoice
  selected: boolean
  previewing: boolean
  previewLoading?: boolean
  previewFailed?: boolean
  onClick: () => void
  onPreview: () => void
}) {
  const gender = voice.labels?.gender || voice.labels?.accent || voice.category || ''
  return (
    <div
      className={clsx(
        'flex items-center gap-3 p-3 rounded-lg border transition-all',
        selected
          ? 'border-emerald-500/50 bg-emerald-500/10'
          : 'border-gray-700 bg-gray-800/30 hover:border-gray-600',
      )}
    >
      <button onClick={onClick} className="flex items-center gap-3 flex-1 text-left min-w-0">
        <div
          className={clsx(
            'w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0',
            selected ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-700 text-gray-400',
          )}
        >
          {voice.name[0]}
        </div>
        <div className="min-w-0">
          <span className={clsx(
            'text-sm font-medium block truncate',
            selected ? 'text-emerald-400' : 'text-gray-300',
          )}>
            {voice.name}
          </span>
          <p className="text-xs capitalize truncate text-gray-500">
            {gender}
          </p>
        </div>
        {selected && (
          <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
        )}
      </button>
      {voice.preview_url ? (
        <button
          onClick={(e) => { e.stopPropagation(); onPreview() }}
          disabled={previewLoading}
          className={clsx(
            'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-colors',
            previewLoading
              ? 'bg-gray-700 text-gray-500 cursor-wait'
              : previewing
                ? 'bg-cyan-600 text-white'
                : previewFailed
                  ? 'bg-red-900/50 text-red-400'
                  : 'bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-gray-200',
          )}
          title={previewLoading ? 'Loading...' : previewing ? 'Stop preview' : previewFailed ? 'Preview failed' : 'Preview voice'}
        >
          {previewLoading ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : previewing ? (
            <Square className="w-3 h-3" />
          ) : previewFailed ? (
            <AlertCircle className="w-3 h-3" />
          ) : (
            <Play className="w-3 h-3 ml-0.5" />
          )}
        </button>
      ) : null}
    </div>
  )
}
