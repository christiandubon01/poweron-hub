// @ts-nocheck
/**
 * NexusAdminView.tsx — NAV1 | Merged ORB Lab + NEXUS Admin
 *
 * The ORB is the visual interface for NEXUS Admin — no longer separate views.
 *
 * ENTRY MODE SELECTOR: On open, shows NEXUS Electrical vs NEXUS Admin Full Oversight.
 * Sub-tabs: Combined / Electrical / Software / RMO (persists in nexusStore).
 *
 * THREE INDEPENDENT PANELS:
 *   Panel 1 — ORB PANEL: Animated orb, collapses independently
 *   Panel 2 — TRANSCRIPT PANEL: Live voice transcript, collapses independently
 *   Panel 3 — CONTROLS PANEL: Voice session controls (always visible)
 *
 * Route: nexus-admin (previously viz-lab + nexus-voice merged)
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Mic, MicOff, Square, ChevronDown, ChevronRight, X, Zap, ShieldAlert } from 'lucide-react'
import { useNexusStore } from '@/store/nexusStore'
import { useUIStore } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'
import type { NexusMode, NexusContextMode } from '@/store/nexusStore'
import NexusPresenceOrb from '@/components/nexus/NexusPresenceOrb'
import NexusThreeOrb from '@/components/nexus/NexusThreeOrb'
import { VisualRenderer, getVizMode } from '@/components/v15r/AIVisualSuite'
import { supabase } from '@/lib/supabase'
import { runNexusEngine } from '@/agents/nexusPromptEngine'
import { synthesizeWithElevenLabs, DEFAULT_VOICE_ID } from '@/api/voice/elevenLabs'

// ── Whisper helper (same pattern as VoiceHub.tsx QuickCaptureTab) ─────────────
async function transcribeAudioBlobNexus(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer()
  const uint8 = new Uint8Array(arrayBuffer)
  let binary = ''
  const CHUNK = 8192
  for (let i = 0; i < uint8.byteLength; i += CHUNK) {
    binary += String.fromCharCode(...uint8.subarray(i, i + CHUNK))
  }
  const base64 = btoa(binary)
  const mimeType = blob.type || 'audio/webm'
  const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm'
  const res = await fetch('/.netlify/functions/whisper', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio: base64, filename: `nexus.${ext}`, language: 'en' }),
  })
  if (!res.ok) throw new Error(`Whisper error ${res.status}`)
  const data = await res.json()
  return (data.text || '').trim()
}

// ─── Constants ────────────────────────────────────────────────────────────────

// NAV1-FIX-VS: ORB LAB header context picker — two top-level context buttons
type OrbContext = 'electrical' | 'ecosystem'
const ORB_CONTEXT_BUTTONS: { id: OrbContext; label: string; color: string; hoverBg: string; activeBg: string; border: string }[] = [
  { id: 'electrical', label: 'Electrical', color: '#22c55e', hoverBg: 'rgba(34,197,94,0.15)', activeBg: 'rgba(34,197,94,0.22)', border: 'rgba(34,197,94,0.55)' },
  { id: 'ecosystem',  label: 'Ecosystem',  color: '#38bdf8', hoverBg: 'rgba(56,189,248,0.15)', activeBg: 'rgba(56,189,248,0.22)', border: 'rgba(56,189,248,0.55)' },
]

const CONTEXT_TABS: { id: NexusContextMode; label: string }[] = [
  { id: 'combined',   label: 'Combined'   },
  { id: 'electrical', label: 'Electrical' },
  { id: 'software',   label: 'Software'   },
  { id: 'rmo',        label: 'RMO'        },
]

// ─── Orb Animator ─────────────────────────────────────────────────────────────

function NexusOrbVisual({ mode, active, muted }: { mode: NexusMode; active: boolean; muted: boolean }) {
  const isElectrical = mode === 'electrical'
  const primaryColor = isElectrical ? '#22c55e' : '#a855f7'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '16px' }}>
      {/* Main ORB — swap by mode */}
      {isElectrical ? (
        <NexusThreeOrb state={active ? 'responding' : 'inactive'} />
      ) : (
        // NEXUS-VOICE4 FIX 5: Full Oversight mode uses VisualRenderer from AIVisualSuite
        <div style={{ width: 220, height: 220, borderRadius: '50%', overflow: 'hidden', position: 'relative' }}>
          <VisualRenderer
            mode={getVizMode()}
            bass={active ? 0.6 : 0.1}
            mid={active ? 0.4 : 0.05}
            high={active ? 0.3 : 0.05}
            mtz={0}
            hue={280}
            style={{ width: '100%', height: '100%' }}
          />
        </div>
      )}

      {/* Mode label */}
      <div style={{ textAlign: 'center' }}>
        <div style={{
          fontFamily: 'monospace',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: primaryColor,
          marginBottom: 4,
        }}>
          {isElectrical ? 'NEXUS — ELECTRICAL' : 'NEXUS ADMIN — FULL OVERSIGHT'}
        </div>
        <div style={{ fontSize: 12, color: '#6b7280' }}>
          {active ? (muted ? 'Muted' : 'Listening...') : 'Ready'}
        </div>
      </div>

      <style>{`
        @keyframes orbPulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.04); }
        }
      `}</style>
    </div>
  )
}

// ─── Mode Selector ─────────────────────────────────────────────────────────────

function ModeSelectorScreen({
  currentMode,
  contextMode,
  onSelectMode,
  onChangeContextMode,
}: {
  currentMode: NexusMode
  contextMode: NexusContextMode
  onSelectMode: (mode: NexusMode) => void
  onChangeContextMode: (mode: NexusContextMode) => void
}) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      padding: '32px 24px',
      gap: '20px',
    }}>
      <div style={{ textAlign: 'center', marginBottom: '8px' }}>
        <div style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: '#6b7280', textTransform: 'uppercase', marginBottom: 8 }}>
          NEXUS — Select Mode
        </div>
        <div style={{ fontSize: 13, color: '#4b5563' }}>Choose your operating context</div>
      </div>

      {/* ELECTRICAL option */}
      <button
        onClick={() => onSelectMode('electrical')}
        style={{
          width: '100%',
          maxWidth: 480,
          background: currentMode === 'electrical' ? 'rgba(34,197,94,0.15)' : 'rgba(34,197,94,0.06)',
          border: `1.5px solid ${currentMode === 'electrical' ? 'rgba(34,197,94,0.6)' : 'rgba(34,197,94,0.25)'}`,
          borderRadius: 12,
          padding: '16px 20px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          textAlign: 'left',
          transition: 'all 0.15s',
        }}
      >
        <div style={{
          width: 52, height: 52, borderRadius: '50%',
          background: 'linear-gradient(135deg, #22c55e, #16a34a)',
          border: '1.5px solid rgba(34,197,94,0.6)',
          boxShadow: '0 0 20px rgba(34,197,94,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <Mic size={22} color="#fff" />
        </div>
        <div>
          <div style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: '#22c55e', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 }}>
            NEXUS — ELECTRICAL
          </div>
          <div style={{ fontSize: 12, color: '#9ca3af', lineHeight: 1.4 }}>
            Electrical business context. Projects, pipeline, RFIs, AR, field logs.
          </div>
        </div>
        {currentMode === 'electrical' && (
          <div style={{ marginLeft: 'auto', color: '#22c55e', flexShrink: 0 }}>
            <Zap size={16} />
          </div>
        )}
      </button>

      {/* ADMIN FULL OVERSIGHT option */}
      <div style={{
        width: '100%',
        maxWidth: 480,
        background: currentMode === 'admin' ? 'rgba(168,85,247,0.15)' : 'rgba(168,85,247,0.06)',
        border: `1.5px solid ${currentMode === 'admin' ? 'rgba(168,85,247,0.6)' : 'rgba(168,85,247,0.25)'}`,
        borderRadius: 12,
        overflow: 'hidden',
      }}>
        <button
          onClick={() => onSelectMode('admin')}
          style={{
            width: '100%', background: 'transparent', border: 'none',
            padding: '16px 20px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 16, textAlign: 'left',
          }}
        >
          <div style={{
            width: 52, height: 52, borderRadius: '50%',
            background: 'linear-gradient(135deg, #a855f7, #7c3aed)',
            border: '1.5px solid rgba(168,85,247,0.6)',
            boxShadow: '0 0 20px rgba(168,85,247,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <ShieldAlert size={22} color="#fff" />
          </div>
          <div>
            <div style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: '#a855f7', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 }}>
              NEXUS ADMIN — FULL OVERSIGHT
            </div>
            <div style={{ fontSize: 12, color: '#9ca3af', lineHeight: 1.4 }}>
              All sources: electrical pipeline, software metrics, RMO, personal tools.
            </div>
          </div>
          {currentMode === 'admin' && (
            <div style={{ marginLeft: 'auto', color: '#a855f7', flexShrink: 0 }}>
              <ShieldAlert size={16} />
            </div>
          )}
        </button>

        {/* Sub-tabs */}
        <div style={{ display: 'flex', gap: 6, padding: '0 20px 16px', flexWrap: 'wrap' }}>
          {CONTEXT_TABS.map(tab => (
            <button
              key={tab.id}
              onClick={(e) => { e.stopPropagation(); onChangeContextMode(tab.id) }}
              style={{
                flex: '1 1 auto',
                minWidth: 70,
                padding: '5px 8px',
                borderRadius: 8,
                border: contextMode === tab.id
                  ? '1.5px solid rgba(168,85,247,0.7)'
                  : '1.5px solid rgba(255,255,255,0.10)',
                background: contextMode === tab.id ? 'rgba(168,85,247,0.20)' : 'rgba(255,255,255,0.04)',
                color: contextMode === tab.id ? '#c084fc' : '#6b7280',
                fontFamily: 'monospace',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.04em',
                cursor: 'pointer',
                textTransform: 'uppercase',
                transition: 'all 0.15s',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// NAV1-FIX-VS: ORB LAB header context picker button (hover state requires own component)
function OrbContextButton({ id, label, color, hoverBg, activeBg, border, active, onClick }: {
  id: OrbContext; label: string; color: string; hoverBg: string; activeBg: string; border: string; active: boolean; onClick: () => void
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={`Context: ${label}`}
      style={{
        padding: '4px 10px',
        borderRadius: 6,
        border: `1px solid ${active ? border : 'rgba(255,255,255,0.10)'}`,
        background: active ? activeBg : hovered ? hoverBg : 'transparent',
        color: active ? color : hovered ? color : '#6b7280',
        fontFamily: 'monospace',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        cursor: 'pointer',
        transition: 'all 0.15s',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  )
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function NexusAdminView() {
  const {
    nexusMode,
    nexusContextMode,
    voiceSessionActive,
    voiceSessionMuted,
    orbPanelCollapsed,
    transcriptPanelCollapsed,
    transcriptLines,
    setNexusMode,
    setNexusContextMode,
    setVoiceSessionActive,
    setVoiceSessionMuted,
    setOrbPanelCollapsed,
    setTranscriptPanelCollapsed,
    appendTranscriptLine,
    clearTranscript,
  } = useNexusStore()

  const setOrbLabActive = useUIStore((s) => s.setOrbLabActive)
  const ownerId = useAuthStore((s) => s.ownerId)

  const [showModeSelector, setShowModeSelector] = useState(false)
  // NAV1-FIX-VS: ORB LAB header context picker state
  const [orbContext, setOrbContext] = useState<OrbContext>('electrical')
  const transcriptEndRef = useRef<HTMLDivElement>(null)

  // NEXUS-VOICE1: voice pipeline state
  const [isProcessing, setIsProcessing] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])

  // NEXUS-VOICE4: local mute state (stops mic stream to Whisper, keeps recording active visually)
  const [localMuted, setLocalMuted] = useState(false)
  const localMutedRef = useRef(false)

  // NEXUS-VOICE2: continuous conversation history (persists across Start/Stop within a session)
  const conversationHistoryRef = useRef<{ role: 'user' | 'assistant'; content: string }[]>([])

  // NEXUS-VOICE2: silence detection refs
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const silenceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const silenceStartRef = useRef<number | null>(null)

  // NEXUS-VOICE4: hold phrases — stores running partial transcript for silence-gate checks
  const lastTranscriptRef = useRef<string>('')

  // NEXUS-VOICE5: recording guard — true from recording start until onstop handler completes
  const isRecordingRef = useRef<boolean>(false)

  // NEXUS-VOICE5: tracks currently playing TTS audio element so it can be interrupted
  const currentAudioRef = useRef<HTMLAudioElement | null>(null)

  // NEXUS-VOICE4: hold phrases list (lowercase, trimmed)
  const HOLD_PHRASES = ['uhm','uh','also','let me check','one second','let me grab that','hold on','wait','actually','and','so']

  // NEXUS-CTX1: Persistent context strip state
  const [contextExpanded, setContextExpanded] = useState(true)
  const [contextLoading, setContextLoading] = useState(true)
  const [contextData, setContextData] = useState<{
    lastSession: { type: string; createdAt: string } | null
    snapshot: { value: string; createdAt: string } | null
    memoryEntries: { content: string; createdAt: string }[]
  }>({ lastSession: null, snapshot: null, memoryEntries: [] })

  // NEXUS-CTX1: Fire 3 Supabase queries on mount
  useEffect(() => {
    const fetchContextData = async () => {
      setContextLoading(true)
      try {
        const [sessionRes, snapshotRes, memoryRes] = await Promise.allSettled([
          supabase
            .from('nexus_sessions')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(1),
          supabase
            .from('snapshots')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(1),
          supabase
            .from('memory_entries')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(2),
        ])

        const lastSession =
          sessionRes.status === 'fulfilled' && sessionRes.value.data && sessionRes.value.data.length > 0
            ? {
                type: sessionRes.value.data[0].session_type ?? sessionRes.value.data[0].context ?? sessionRes.value.data[0].type ?? 'Session',
                createdAt: sessionRes.value.data[0].created_at,
              }
            : null

        const snapshotRow =
          snapshotRes.status === 'fulfilled' && snapshotRes.value.data && snapshotRes.value.data.length > 0
            ? snapshotRes.value.data[0]
            : null
        const snapshot = snapshotRow
          ? {
              value: snapshotRow.pipeline ?? snapshotRow.revenue ?? snapshotRow.value ?? snapshotRow.summary ?? 'Snapshot',
              createdAt: snapshotRow.created_at,
            }
          : null

        const memoryEntries =
          memoryRes.status === 'fulfilled' && memoryRes.value.data
            ? memoryRes.value.data.map((row: any) => ({
                content: row.content ?? row.title ?? row.entry ?? 'Entry',
                createdAt: row.created_at,
              }))
            : []

        setContextData({ lastSession, snapshot, memoryEntries })
      } catch (_) {
        // Silently fail — data stays null/empty
      } finally {
        setContextLoading(false)
      }
    }
    fetchContextData()
  }, [])

  // Signal ORB LAB active to suppress floating NEXUS mic
  useEffect(() => {
    setOrbLabActive(true)
    return () => setOrbLabActive(false)
  }, [])

  // NEXUS-VOICE4: keep localMutedRef in sync with localMuted state
  useEffect(() => {
    localMutedRef.current = localMuted
  }, [localMuted])

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [transcriptLines])

  // NEXUS-VOICE2: clean up silence detection resources
  const cleanupSilenceDetection = useCallback(() => {
    if (silenceTimerRef.current !== null) {
      clearInterval(silenceTimerRef.current)
      silenceTimerRef.current = null
    }
    silenceStartRef.current = null
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {})
      audioContextRef.current = null
    }
    analyserRef.current = null
  }, [])

  // NEXUS-VOICE1 + NEXUS-VOICE2: full voice pipeline with continuous history + silence detection
  const handleStartSession = useCallback(async () => {
    // NEXUS-VOICE5: if TTS is still playing when user clicks Continue, stop it immediately
    if (currentAudioRef.current) {
      currentAudioRef.current.pause()
      currentAudioRef.current = null
      setIsSpeaking(false)
    }

    // NEXUS-VOICE2: Only clear the transcript display on the very first turn of a brand-new session.
    // conversationHistoryRef is NOT cleared here — it persists across Start/Stop cycles.
    // It is only cleared in handleEndSession (explicit session end).
    const isFirstTurn = conversationHistoryRef.current.length === 0
    if (isFirstTurn) {
      clearTranscript()
      appendTranscriptLine(`[${new Date().toLocaleTimeString()}] Session started — ${nexusMode === 'electrical' ? 'Electrical context' : 'Admin Full Oversight'}`)
    }

    setVoiceSessionActive(true)
    setVoiceSessionMuted(false)
    setIsListening(true)

    // Step 1: Open microphone
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (_err) {
      appendTranscriptLine('Microphone access denied — check browser permissions and try again.')
      setVoiceSessionActive(false)
      setIsListening(false)
      return
    }

    // NEXUS-VOICE2: Set up Web Audio API for silence detection
    try {
      const audioCtx = new AudioContext()
      audioContextRef.current = audioCtx
      const source = audioCtx.createMediaStreamSource(stream)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 2048
      source.connect(analyser)
      analyserRef.current = analyser

      const dataArray = new Uint8Array(analyser.fftSize)
      // NEXUS-VOICE5: updated silence threshold — 3000ms (was 2700ms)
      const RMS_THRESHOLD = 0.015
      const SILENCE_DURATION_MS = 3000

      silenceStartRef.current = null
      silenceTimerRef.current = setInterval(() => {
        if (!analyserRef.current) return
        analyserRef.current.getByteTimeDomainData(dataArray)

        // Calculate RMS
        let sumSq = 0
        for (let i = 0; i < dataArray.length; i++) {
          const normalized = (dataArray[i] - 128) / 128
          sumSq += normalized * normalized
        }
        const rms = Math.sqrt(sumSq / dataArray.length)

        if (rms < RMS_THRESHOLD) {
          // Below threshold — start or continue silence timer
          if (silenceStartRef.current === null) {
            silenceStartRef.current = Date.now()
          } else if (Date.now() - silenceStartRef.current >= SILENCE_DURATION_MS) {
            // NEXUS-VOICE4: hold phrase check — if transcript ends with a hold phrase, reset timer
            const transcript = lastTranscriptRef.current.toLowerCase().trim()
            const endsWithHold = HOLD_PHRASES.some(phrase => transcript.endsWith(phrase))
            if (endsWithHold) {
              // Reset silence timer and keep recording
              silenceStartRef.current = Date.now()
            } else {
              // Silence threshold reached — auto-stop recording
              silenceStartRef.current = null
              if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
                mediaRecorderRef.current.stop()
              }
            }
          }
        } else {
          // Sound detected — reset silence timer
          silenceStartRef.current = null
        }
      }, 100)
    } catch (_audioErr) {
      // Web Audio API unavailable — fall back to manual stop only
    }

    // Step 2: Begin recording
    audioChunksRef.current = []
    const mr = new MediaRecorder(stream)
    mediaRecorderRef.current = mr

    mr.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunksRef.current.push(e.data)
    }

    mr.onstop = async () => {
      // Clean up silence detection
      cleanupSilenceDetection()
      setIsListening(false)

      // NEXUS-VOICE5: clear recording guard — we are now in onstop handler
      isRecordingRef.current = false

      // Stop all mic tracks
      stream.getTracks().forEach(t => t.stop())

      const mimeType = mr.mimeType || 'audio/webm'
      const audioBlob = new Blob(audioChunksRef.current, { type: mimeType })
      audioChunksRef.current = []

      // NEXUS-VOICE4 FIX 2: if locally muted, skip Whisper — do not send audio to processing
      if (localMutedRef.current) {
        setIsProcessing(false)
        setVoiceSessionActive(false)
        return
      }

      // NEXUS-VOICE5: safety gate — abort if recording guard is still unexpectedly true
      if (isRecordingRef.current) {
        setIsProcessing(false)
        setVoiceSessionActive(false)
        return
      }

      setIsProcessing(true)

      // Step 3: Whisper transcription
      let transcribedText = ''
      try {
        transcribedText = await transcribeAudioBlobNexus(audioBlob)
      } catch (_err) {
        appendTranscriptLine('Transcription failed — try again.')
        setIsProcessing(false)
        setVoiceSessionActive(false)
        return
      }

      if (!transcribedText) {
        appendTranscriptLine('No speech detected — try again.')
        setIsProcessing(false)
        setVoiceSessionActive(false)
        return
      }

      appendTranscriptLine(`You: ${transcribedText}`)
      // NEXUS-VOICE4: keep lastTranscriptRef updated for hold phrase silence gate
      lastTranscriptRef.current = transcribedText

      // NEXUS-VOICE5 FIX 1: Build sessionContext — keep only last 6 turns (3 user + 3 NEXUS)
      // Older turns are dropped to prevent context overflow.
      const history = conversationHistoryRef.current
      const sessionContext = history.length > 0
        ? 'CONVERSATION SO FAR (most recent last):\n' +
          history.slice(-6).map(m => (m.role === 'user' ? 'Christian: ' : 'NEXUS: ') + m.content).join('\n')
        : undefined

      // NEXUS-VOICE2: Append user turn to history before calling engine
      conversationHistoryRef.current = [...history, { role: 'user', content: transcribedText }]

      // NEXUS-VOICE5 FIX 1: resolve agentMode from nexusMode for context-aware routing
      const agentMode = nexusMode === 'electrical' ? 'electrical' : 'admin'

      // NEXUS-VOICE5 FIX 1: resolve userId from ownerId (silently skip if unavailable)
      let resolvedUserId: string | undefined
      try {
        const { data: { session: authSession } } = await supabase.auth.getSession()
        resolvedUserId = authSession?.user?.id ?? (ownerId ?? undefined)
      } catch (_) {
        // silently skip — do not break flow
      }

      // Step 4: runNexusEngine with conversation context
      let nexusResponse
      try {
        nexusResponse = await runNexusEngine({
          query: transcribedText,
          agentMode,
          ...(sessionContext ? { sessionContext } : {}),
          ...(resolvedUserId ? { userId: resolvedUserId } : {}),
        })
      } catch (_err) {
        appendTranscriptLine('NEXUS unavailable — try again.')
        setIsProcessing(false)
        setVoiceSessionActive(false)
        return
      }

      // NEXUS-VOICE3: Only show speak field; strip markdown before display
      const rawSpeak = nexusResponse.speak || ''
      const speakText = rawSpeak
        .replace(/\*\*(.+?)\*\*/g, '$1')   // remove **bold**
        .replace(/\*(.+?)\*/g, '$1')        // remove *italic*
        .replace(/^#{1,6}\s+/gm, '')        // remove # headers
        .replace(/^[\s]*[-*]\s+/gm, '')     // remove bullet points (- or *)
        .replace(/\n{2,}/g, ' ')            // collapse multiple newlines
        .replace(/\n/g, ' ')                // remaining newlines to spaces
        .trim()
      appendTranscriptLine(`NEXUS: ${speakText}`)

      // NEXUS-VOICE4: Memory write — log exchange to nexus_sessions for traceability
      try {
        await supabase.from('nexus_sessions').insert({
          user_id:    resolvedUserId ?? null,
          org_id:     null,
          topic_name: nexusMode ?? 'voice-session',
          agent:      'nexus',
        })
      } catch (_memErr) {
        // Silently ignore — do not break voice flow
      }

      // NEXUS-VOICE2: Append assistant turn to history
      if (speakText) {
        conversationHistoryRef.current = [...conversationHistoryRef.current, { role: 'assistant', content: speakText }]
      }

      // Step 5: ElevenLabs TTS
      // NEXUS-VOICE5: only start TTS if runNexusEngine has returned AND recording guard is clear
      if (speakText && !isRecordingRef.current) {
        setIsSpeaking(true)
        try {
          const ttsResult = await synthesizeWithElevenLabs({
            text: speakText,
            voice_id: DEFAULT_VOICE_ID,
          })
          const audio = new Audio(ttsResult.audioUrl)
          // NEXUS-VOICE5: track playing audio so it can be interrupted by Continue
          currentAudioRef.current = audio
          audio.onended = () => {
            setIsSpeaking(false)
            currentAudioRef.current = null
            URL.revokeObjectURL(ttsResult.audioUrl)
          }
          audio.onerror = () => {
            setIsSpeaking(false)
            currentAudioRef.current = null
          }
          audio.play().catch(() => {
            setIsSpeaking(false)
            currentAudioRef.current = null
          })
        } catch (_err) {
          // ElevenLabs failed — text response already appended, skip audio silently
          setIsSpeaking(false)
          currentAudioRef.current = null
        }
      }

      setIsProcessing(false)
      setVoiceSessionActive(false)
    }

    // NEXUS-VOICE3: delay 600ms after getUserMedia to let mic stream stabilize
    // and avoid clipping the first words of each recording turn
    await new Promise<void>(resolve => setTimeout(resolve, 600))
    // NEXUS-VOICE5: arm recording guard before starting
    isRecordingRef.current = true
    mr.start()
  }, [nexusMode, ownerId, clearTranscript, setVoiceSessionActive, setVoiceSessionMuted, appendTranscriptLine, cleanupSilenceDetection])

  // NEXUS-VOICE2: explicit session end — clears conversation history
  const handleEndSession = useCallback(() => {
    cleanupSilenceDetection()
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop()
    }
    conversationHistoryRef.current = []
    setIsListening(false)
    setVoiceSessionActive(false)
    setIsProcessing(false)
    clearTranscript()
    appendTranscriptLine(`[${new Date().toLocaleTimeString()}] Session ended.`)
  }, [cleanupSilenceDetection, clearTranscript, setVoiceSessionActive, appendTranscriptLine])

  const handleStopSession = useCallback(() => {
    // Stop recording — triggers mr.onstop which runs the full pipeline
    // Does NOT clear conversation history (that's handleEndSession)
    cleanupSilenceDetection()
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop()
    } else {
      setVoiceSessionActive(false)
      setIsListening(false)
      appendTranscriptLine(`[${new Date().toLocaleTimeString()}] Recording stopped.`)
    }
  }, [cleanupSilenceDetection, setVoiceSessionActive, appendTranscriptLine])

  const handleToggleMute = useCallback(() => {
    setVoiceSessionMuted(!voiceSessionMuted)
  }, [voiceSessionMuted, setVoiceSessionMuted])

  const isElectrical = nexusMode === 'electrical'
  const modeColor = isElectrical ? '#22c55e' : '#a855f7'
  const modeLabelShort = isElectrical ? 'ELECTRICAL' : 'ADMIN FULL OVERSIGHT'

  // Layout logic: both open = side by side, one collapsed = other fills
  const bothOpen = !orbPanelCollapsed && !transcriptPanelCollapsed
  const orbFlex = bothOpen ? '0 0 45%' : orbPanelCollapsed ? '0 0 0%' : '1 1 100%'
  const transcriptFlex = bothOpen ? '0 0 55%' : transcriptPanelCollapsed ? '0 0 0%' : '1 1 100%'

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      minHeight: 0,
      backgroundColor: '#0a0e1a',
      color: '#e5e7eb',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      position: 'relative',
    }}>
      {/* ── Header ────────────────────────────────────────── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 20px',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            fontFamily: 'monospace',
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.1em',
            color: modeColor,
            textTransform: 'uppercase',
          }}>
            NEXUS ADMIN
          </div>
          <span style={{
            fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 4,
            backgroundColor: isElectrical ? 'rgba(34,197,94,0.2)' : 'rgba(168,85,247,0.2)',
            color: modeColor, textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>
            {modeLabelShort}
          </span>
          {nexusMode === 'admin' && (
            <span style={{
              fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
              backgroundColor: 'rgba(168,85,247,0.15)', color: '#c084fc',
              textTransform: 'uppercase', letterSpacing: '0.04em',
            }}>
              {nexusContextMode.toUpperCase()}
            </span>
          )}
        </div>

        {/* NAV1-FIX-VS: ORB LAB context picker — Electrical / Ecosystem */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <OrbContextButton id="electrical" label="Electrical" color="#22c55e" hoverBg="rgba(34,197,94,0.15)" activeBg="rgba(34,197,94,0.22)" border="rgba(34,197,94,0.55)" active={orbContext === 'electrical'} onClick={() => setOrbContext('electrical')} />
          <OrbContextButton id="ecosystem"  label="Ecosystem"  color="#38bdf8" hoverBg="rgba(56,189,248,0.15)" activeBg="rgba(56,189,248,0.22)" border="rgba(56,189,248,0.55)" active={orbContext === 'ecosystem'}  onClick={() => setOrbContext('ecosystem')} />
        </div>

        {/* Mode selector trigger button */}
        <button
          onClick={() => setShowModeSelector(!showModeSelector)}
          title="Change NEXUS mode"
          style={{
            padding: '6px 12px',
            borderRadius: 8,
            border: `1px solid ${modeColor}40`,
            background: `${modeColor}10`,
            color: modeColor,
            fontSize: 11,
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontFamily: 'monospace',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}
        >
          <Zap size={12} />
          Mode
          <ChevronDown size={12} style={{ transform: showModeSelector ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }} />
        </button>
      </div>

      {/* ── Mode Selector Dropdown ─────────────────────────── */}
      {showModeSelector && (
        <div style={{
          position: 'absolute',
          top: 53,
          right: 16,
          zIndex: 100,
          width: 360,
          maxWidth: 'calc(100vw - 32px)',
          backgroundColor: '#111827',
          border: '1px solid rgba(255,255,255,0.10)',
          borderRadius: 16,
          boxShadow: '0 16px 48px rgba(0,0,0,0.7)',
          overflow: 'hidden',
        }}>
          <ModeSelectorScreen
            currentMode={nexusMode}
            contextMode={nexusContextMode}
            onSelectMode={(mode) => { setNexusMode(mode); setShowModeSelector(false) }}
            onChangeContextMode={setNexusContextMode}
          />
        </div>
      )}

      {/* Backdrop for mode selector */}
      {showModeSelector && (
        <div
          onClick={() => setShowModeSelector(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 99 }}
        />
      )}

      {/* ── NEXUS-CTX1: Persistent Context Strip ─────────── */}
      <div style={{
        flexShrink: 0,
        background: 'rgba(255,255,255,0.03)',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        padding: contextExpanded ? '10px 20px' : '0 20px',
        height: contextExpanded ? 'auto' : '32px',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        transition: 'height 0.2s ease, padding 0.2s ease',
        position: 'relative',
      }}>
        {contextExpanded ? (
          <>
            {/* Section label */}
            <div style={{
              fontFamily: 'monospace',
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: '#374151',
              marginBottom: 6,
            }}>
              CONTEXT
            </div>

            {/* Row 1 — Last Session */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <span style={{ fontFamily: 'monospace', fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#6b7280', minWidth: 100 }}>
                LAST SESSION:
              </span>
              {contextLoading ? (
                <span style={{ fontSize: 11, color: '#4b5563' }}>—</span>
              ) : contextData.lastSession ? (
                <span style={{ fontSize: 11, color: '#d1d5db' }}>
                  {contextData.lastSession.type}
                  <span style={{ color: '#6b7280', marginLeft: 6 }}>
                    — {new Date(contextData.lastSession.createdAt).toLocaleString()}
                  </span>
                </span>
              ) : (
                <span style={{ fontSize: 11, color: '#4b5563', fontStyle: 'italic' }}>None logged yet</span>
              )}
            </div>

            {/* Row 2 — Snapshot */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <span style={{ fontFamily: 'monospace', fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#6b7280', minWidth: 100 }}>
                SNAPSHOT:
              </span>
              {contextLoading ? (
                <span style={{ fontSize: 11, color: '#4b5563' }}>—</span>
              ) : contextData.snapshot ? (
                <span style={{ fontSize: 11, color: '#d1d5db' }}>
                  {String(contextData.snapshot.value)}
                  <span style={{ color: '#6b7280', marginLeft: 6 }}>
                    — {new Date(contextData.snapshot.createdAt).toLocaleDateString()}
                  </span>
                </span>
              ) : (
                <span style={{ fontSize: 11, color: '#4b5563', fontStyle: 'italic' }}>None logged yet</span>
              )}
            </div>

            {/* Row 3 — Memory Entries */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
              <span style={{ fontFamily: 'monospace', fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#6b7280', minWidth: 100, paddingTop: 1 }}>
                PENDING:
              </span>
              {contextLoading ? (
                <span style={{ fontSize: 11, color: '#4b5563' }}>—</span>
              ) : contextData.memoryEntries.length > 0 ? (
                <span style={{ fontSize: 11, color: '#d1d5db' }}>
                  {contextData.memoryEntries.map((e, i) => (
                    <span key={i}>
                      {i > 0 && <span style={{ color: '#6b7280', margin: '0 4px' }}>/</span>}
                      {e.content}
                    </span>
                  ))}
                </span>
              ) : (
                <span style={{ fontSize: 11, color: '#4b5563', fontStyle: 'italic' }}>None logged yet</span>
              )}
            </div>
          </>
        ) : (
          /* Collapsed single-line */
          <div style={{ fontSize: 10, color: '#4b5563', fontFamily: 'monospace', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ textTransform: 'uppercase', fontWeight: 700 }}>CONTEXT</span>
            <span style={{ color: '#374151' }}>—</span>
            <span>{contextData.lastSession ? contextData.lastSession.type : 'No session'}</span>
            <span style={{ color: '#374151' }}>—</span>
            <span>{contextData.snapshot ? String(contextData.snapshot.value) : 'No snapshot'}</span>
          </div>
        )}

        {/* Toggle chevron */}
        <button
          onClick={() => setContextExpanded(!contextExpanded)}
          title={contextExpanded ? 'Collapse context strip' : 'Expand context strip'}
          style={{
            position: 'absolute',
            right: 12,
            top: '50%',
            transform: 'translateY(-50%)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: '#6b7280',
            padding: 4,
            display: 'flex',
            alignItems: 'center',
            transition: 'transform 0.2s',
          }}
        >
          <ChevronDown
            size={12}
            style={{ transform: contextExpanded ? 'rotate(0deg)' : 'rotate(180deg)', transition: 'transform 0.2s' }}
          />
        </button>
      </div>

      {/* ── Main Panel Area ────────────────────────────────── */}
      <div style={{
        display: 'flex',
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
        gap: 0,
      }}>
        {/* ── Panel 1: ORB ──────────────────────────────────── */}
        {!orbPanelCollapsed && (
          <div
            style={{
              flex: orbFlex,
              borderRight: bothOpen ? '1px solid rgba(255,255,255,0.08)' : 'none',
              display: 'flex',
              flexDirection: 'column',
              minWidth: 0,
              minHeight: 0,
              overflow: 'hidden',
              transition: 'flex 0.2s ease',
            }}
          >
            {/* Panel header */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 16px',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
              flexShrink: 0,
            }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                ORB INTERFACE
              </span>
              <button
                onClick={() => setOrbPanelCollapsed(true)}
                title="Collapse ORB panel"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', padding: 4, display: 'flex' }}
              >
                <ChevronRight size={14} />
              </button>
            </div>

            {/* ORB content */}
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              <NexusOrbVisual
                mode={nexusMode}
                active={voiceSessionActive || isSpeaking}
                muted={voiceSessionMuted}
              />
            </div>
          </div>
        )}

        {/* Collapsed ORB restore button */}
        {orbPanelCollapsed && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRight: '1px solid rgba(255,255,255,0.08)',
            padding: '8px 0',
            flexShrink: 0,
          }}>
            <button
              onClick={() => setOrbPanelCollapsed(false)}
              title="Expand ORB panel"
              style={{
                background: 'none', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 6, cursor: 'pointer', color: '#6b7280',
                padding: '12px 6px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
              }}
            >
              <ChevronRight size={12} style={{ transform: 'rotate(180deg)' }} />
              <span style={{ writingMode: 'vertical-rl', fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: '#6b7280', textTransform: 'uppercase' }}>ORB</span>
            </button>
          </div>
        )}

        {/* ── Panel 2: TRANSCRIPT ──────────────────────────── */}
        {!transcriptPanelCollapsed && (
          <div style={{
            flex: transcriptFlex,
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
            minHeight: 0,
            overflow: 'hidden',
            transition: 'flex 0.2s ease',
          }}>
            {/* Panel header */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 16px',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
              flexShrink: 0,
            }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                LIVE TRANSCRIPT
              </span>
              <button
                onClick={() => setTranscriptPanelCollapsed(true)}
                title="Collapse transcript panel"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', padding: 4, display: 'flex' }}
              >
                <ChevronRight size={14} style={{ transform: 'rotate(180deg)' }} />
              </button>
            </div>

            {/* Transcript content */}
            <div style={{
              flex: 1,
              overflowY: 'auto',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}>
              {transcriptLines.length === 0 ? (
                <div style={{ color: '#4b5563', fontSize: 13, textAlign: 'center', paddingTop: 40 }}>
                  Start a voice session to see the live transcript here.
                </div>
              ) : (
                transcriptLines.map((line, i) => (
                  <div
                    key={i}
                    style={{
                      fontSize: 13,
                      color: '#d1d5db',
                      lineHeight: 1.5,
                      padding: '6px 10px',
                      borderRadius: 6,
                      backgroundColor: i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent',
                      borderLeft: '2px solid rgba(255,255,255,0.06)',
                    }}
                  >
                    {line}
                  </div>
                ))
              )}
              <div ref={transcriptEndRef} />
            </div>
          </div>
        )}

        {/* Collapsed Transcript restore button */}
        {transcriptPanelCollapsed && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}>
            <button
              onClick={() => setTranscriptPanelCollapsed(false)}
              title="Expand transcript panel"
              style={{
                background: 'none', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 6, cursor: 'pointer', color: '#6b7280',
                padding: '12px 6px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
              }}
            >
              <ChevronRight size={12} />
              <span style={{ writingMode: 'vertical-rl', fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: '#6b7280', textTransform: 'uppercase' }}>TRANSCRIPT</span>
            </button>
          </div>
        )}
      </div>

      {/* ── Panel 3: CONTROLS (always visible, never collapsible) ── */}
      <div style={{
        flexShrink: 0,
        borderTop: '1px solid rgba(255,255,255,0.08)',
        padding: '12px 20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        backgroundColor: '#0d1120',
      }}>
        {/* Mode indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            backgroundColor: isSpeaking ? '#38bdf8' : isListening ? modeColor : isProcessing ? '#f59e0b' : voiceSessionActive ? (voiceSessionMuted ? '#f59e0b' : modeColor) : '#4b5563',
            boxShadow: isSpeaking ? '0 0 6px #38bdf8' : isListening ? `0 0 6px ${modeColor}` : isProcessing ? '0 0 6px #f59e0b' : voiceSessionActive ? `0 0 6px ${modeColor}` : 'none',
          }} />
          <span style={{ fontSize: 11, color: '#6b7280', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {isSpeaking ? 'Speaking' : isProcessing ? 'Processing...' : isListening ? 'Listening...' : voiceSessionActive ? (voiceSessionMuted ? 'Muted' : 'Live') : 'Standby'}
          </span>
          <span style={{ fontSize: 10, color: '#374151', fontFamily: 'monospace' }}>
            {modeLabelShort}
          </span>
        </div>

        {/* Voice controls */}
        {/* NEXUS-VOICE4 FIX 2: Continue button always visible, state-based label + overlay */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Main action button — changes label based on state */}
          <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
            <button
              onClick={isListening ? handleStopSession : (!isSpeaking && !isProcessing ? handleStartSession : undefined)}
              disabled={isSpeaking || isProcessing}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 20px', borderRadius: 24,
                background: isListening
                  ? `linear-gradient(135deg, ${isElectrical ? '#22c55e' : '#a855f7'}, ${isElectrical ? '#16a34a' : '#7c3aed'})`
                  : `linear-gradient(135deg, ${isElectrical ? '#22c55e' : '#a855f7'}, ${isElectrical ? '#16a34a' : '#7c3aed'})`,
                border: 'none', color: '#fff', fontSize: 13, fontWeight: 600,
                cursor: isSpeaking ? 'not-allowed' : 'pointer',
                opacity: 1,
                boxShadow: `0 4px 16px ${isElectrical ? 'rgba(34,197,94,0.35)' : 'rgba(168,85,247,0.35)'}`,
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <Mic size={16} />
              {isListening
                ? 'Listening'
                : isSpeaking
                  ? 'Speaking'
                  : isProcessing
                    ? 'Processing'
                    : (conversationHistoryRef.current.length > 0 ? 'Continue' : 'Start Session')}
              {/* 50% dark overlay while NEXUS TTS is speaking */}
              {isSpeaking && (
                <span style={{
                  position: 'absolute', inset: 0,
                  background: 'rgba(0,0,0,0.5)',
                  borderRadius: 24,
                  pointerEvents: 'none',
                }} />
              )}
            </button>
            {/* NEXUS-VOICE4 FIX 2: local mute button immediately to the right */}
            <button
              onClick={() => setLocalMuted(m => !m)}
              title={localMuted ? 'Unmute mic' : 'Mute mic'}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 32, height: 32, borderRadius: '50%', marginLeft: 6,
                background: localMuted ? 'rgba(245,158,11,0.2)' : 'rgba(255,255,255,0.08)',
                border: localMuted ? '1.5px solid rgba(245,158,11,0.5)' : '1.5px solid rgba(255,255,255,0.15)',
                color: localMuted ? '#f59e0b' : '#9ca3af',
                cursor: 'pointer',
              }}
            >
              {localMuted ? <MicOff size={14} /> : <Mic size={14} />}
            </button>
          </div>

          {/* Store mute toggle — shown while session active */}
          {voiceSessionActive && (
            <button
              onClick={handleToggleMute}
              title={voiceSessionMuted ? 'Unmute' : 'Mute'}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 40, height: 40, borderRadius: '50%',
                background: voiceSessionMuted ? 'rgba(245,158,11,0.2)' : 'rgba(255,255,255,0.08)',
                border: voiceSessionMuted ? '1.5px solid rgba(245,158,11,0.5)' : '1.5px solid rgba(255,255,255,0.15)',
                color: voiceSessionMuted ? '#f59e0b' : '#9ca3af',
                cursor: 'pointer',
              }}
            >
              {voiceSessionMuted ? <MicOff size={16} /> : <Mic size={16} />}
            </button>
          )}

          {/* End Session — shown when history exists and not mid-session */}
          {conversationHistoryRef.current.length > 0 && !isSpeaking && !isProcessing && !isListening && (
            <button
              onClick={handleEndSession}
              title="End session and clear history"
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 16px', borderRadius: 24,
                background: 'rgba(107,114,128,0.15)',
                border: '1.5px solid rgba(107,114,128,0.3)',
                color: '#9ca3af', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}
            >
              <X size={12} />
              End Session
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
