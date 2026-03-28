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

import { useState, useEffect } from 'react'
import { Volume2, Mic, Radio, Shield, Save, Loader2, Check } from 'lucide-react'
import { clsx } from 'clsx'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { AVAILABLE_VOICES, type ElevenLabsVoice } from '@/api/voice/elevenLabs'

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
}

const DEFAULT_PREFS: VoicePrefs = {
  enabled: true,
  tts_voice_id: AVAILABLE_VOICES[0]?.voice_id || '',
  tts_speed: 1.0,
  asr_language: 'en-US',
  noise_suppression_strength: 0.7,
  wake_word_enabled: true,
  wake_word_phrase: 'Hey NEXUS',
  field_mode_enabled: true,
  push_to_talk_enabled: false,
  push_to_talk_key: 'Space',
}

export function VoiceSettings() {
  const { user, profile } = useAuth()
  const [prefs, setPrefs] = useState<VoicePrefs>(DEFAULT_PREFS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const orgId = profile?.org_id
  const userId = user?.id

  // Load preferences
  useEffect(() => {
    if (!orgId || !userId) return

    const load = async () => {
      try {
        const { data } = await supabase
          .from('voice_preferences' as never)
          .select('*')
          .eq('org_id', orgId)
          .eq('user_id', userId)
          .single()

        if (data) {
          const d = data as any
          setPrefs({
            enabled: d.enabled ?? true,
            tts_voice_id: d.tts_voice_id || DEFAULT_PREFS.tts_voice_id,
            tts_speed: d.tts_speed ?? 1.0,
            asr_language: d.asr_language || 'en-US',
            noise_suppression_strength: d.noise_suppression_strength ?? 0.7,
            wake_word_enabled: d.wake_word_enabled ?? true,
            wake_word_phrase: d.wake_word_phrase || 'Hey NEXUS',
            field_mode_enabled: d.field_mode_enabled ?? true,
            push_to_talk_enabled: d.push_to_talk_enabled ?? false,
            push_to_talk_key: d.push_to_talk_key || 'Space',
          })
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

  const update = (key: keyof VoicePrefs, value: unknown) => {
    setPrefs(prev => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  const selectedVoice = AVAILABLE_VOICES.find(v => v.voice_id === prefs.tts_voice_id)

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
      <Section title="Voice" icon={<Volume2 className="w-4 h-4" />}>
        <p className="text-sm text-gray-400 mb-3">Choose the voice for spoken responses</p>
        <div className="grid grid-cols-2 gap-3">
          {AVAILABLE_VOICES.map((voice) => (
            <VoiceCard
              key={voice.voice_id}
              voice={voice}
              selected={prefs.tts_voice_id === voice.voice_id}
              onClick={() => update('tts_voice_id', voice.voice_id)}
            />
          ))}
        </div>

        {/* Speed slider */}
        <div className="mt-5">
          <label className="flex items-center justify-between text-sm">
            <span className="text-gray-300">Speech Speed</span>
            <span className="text-emerald-400 font-mono">{prefs.tts_speed.toFixed(1)}x</span>
          </label>
          <input
            type="range"
            min={0.5}
            max={2.0}
            step={0.1}
            value={prefs.tts_speed}
            onChange={e => update('tts_speed', parseFloat(e.target.value))}
            className="w-full mt-2 accent-emerald-500"
          />
          <div className="flex justify-between text-xs text-gray-600 mt-1">
            <span>0.5x Slow</span>
            <span>1.0x Normal</span>
            <span>2.0x Fast</span>
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
