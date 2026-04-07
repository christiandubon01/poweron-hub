// @ts-nocheck
/**
 * VoiceActivationButton — Voice pipeline integration + NexusDrawerPanel host.
 *
 * Responsibilities:
 *  1. Manages voice recording lifecycle (start/stop/listen)
 *  2. Hosts the NexusDrawerPanel (premium split layout with 3D orb + chat)
 *  3. Voice preprocessing: cleans transcripts before displaying + sending to NEXUS
 *  4. Text chat: routes typed messages through NEXUS processMessage
 *  5. Silence detection: auto-stops recording after 2 s of silence
 *
 * Voice preprocessing rules (applied to transcript_ready text before UI display):
 *  - Remove filler words: mhmm, uh, um, like, you know, also
 *  - Collapse repeated consecutive words ("from from" → "from")
 *  - Trim leading/trailing whitespace
 *  - Both original and cleaned transcript shown in the bubble
 *
 * Collapse behaviour (managed here, passed to NexusDrawerPanel):
 *  - drawerExpanded state: true = full drawer, false = 40 px orb stub
 *  - Toggled via chevron-right button inside drawer or orb stub button
 *  - Stored in sessionStorage so state survives panel navigation
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { getVoiceSubsystem, unlockAudioContext, voiceDebugLog, onDebugUpdate, onOrbStateChange, type VoiceSessionStatus } from '@/services/voice'
import { useAuth } from '@/hooks/useAuth'
import { NexusDrawerPanel, type DrawerMessage } from '@/components/nexus/NexusDrawerPanel'
import type { OrbState } from '@/components/nexus/NexusPresenceOrb'
import { supabase } from '@/lib/supabase'

// ── Voice preprocessing ────────────────────────────────────────────────────────

const FILLER_PATTERN = /\b(mhmm|uh|um|like|you\s+know|also)\b/gi

/**
 * cleanTranscript — lightweight transcript cleanup.
 * Removes filler words, collapses repeated consecutive words, trims whitespace.
 */
export function cleanTranscript(raw: string): string {
  let cleaned = raw
    .replace(FILLER_PATTERN, '')
    .replace(/\s{2,}/g, ' ')
    .trim()

  // Collapse repeated consecutive words (up to 3 passes)
  for (let pass = 0; pass < 3; pass++) {
    cleaned = cleaned.replace(/\b(\w+)\s+\1\b/gi, '$1')
  }

  return cleaned.trim()
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface VoiceActivationButtonProps {
  className?: string
}

// ── Component ──────────────────────────────────────────────────────────────────

export function VoiceActivationButton({ className }: VoiceActivationButtonProps) {
  const { user, profile } = useAuth()

  const [status, setStatus]               = useState<VoiceSessionStatus>('inactive')
  const [initialized, setInitialized]     = useState(false)
  const [audioUnlocked, setAudioUnlocked] = useState(false)
  const [orbState, setOrbState]           = useState<OrbState>('inactive')

  // Drawer state
  const [drawerOpen, setDrawerOpen]         = useState(false)
  const [drawerExpanded, setDrawerExpanded] = useState(() => {
    try { return sessionStorage.getItem('nexus_drawer_expanded') !== 'false' } catch { return true }
  })

  // Messages — combined voice transcript + text chat
  const [messages, setMessages]   = useState<DrawerMessage[]>([])
  const [isSending, setIsSending] = useState(false)

  const conversationHistoryRef      = useRef([])
  const lastTranscriptRef           = useRef('')
  const lastCleanedTranscriptRef    = useRef('')

  // FIX 4 — Session continuity: key for sessionStorage persistence
  const DRAWER_SESSION_KEY = 'nexus_drawer_messages_v1'

  // FIX 4 — Load last 3 messages from previous session as faded context
  const [contextMessages, setContextMessages] = useState<DrawerMessage[]>(() => {
    try {
      const stored = sessionStorage.getItem('nexus_drawer_messages_v1')
      if (stored) {
        const msgs: DrawerMessage[] = JSON.parse(stored)
        return msgs.slice(-3)
      }
    } catch {}
    return []
  })

  // Silence detection refs
  const silenceTimerRef    = useRef(null)
  const silenceStartRef    = useRef(0)
  const analyserRef        = useRef(null)
  const silenceStreamRef   = useRef(null)
  const silenceRafRef      = useRef(null)
  const silenceAudioCtxRef = useRef(null)
  const [silenceProgress, setSilenceProgress] = useState(0)

  const SILENCE_THRESHOLD   = 0.01
  const SILENCE_DURATION_MS = 2000

  const isDebugMode = typeof window !== 'undefined' && window.location.search.includes('debug=1')
  const [debugTick, setDebugTick]           = useState(0)
  const [debugExpanded, setDebugExpanded]   = useState(false)
  const debugScrollRef = useRef(null)

  useEffect(() => {
    if (!isDebugMode) return
    return onDebugUpdate(() => setDebugTick(t => t + 1))
  }, [isDebugMode])

  useEffect(() => {
    if (debugScrollRef.current) {
      debugScrollRef.current.scrollTop = debugScrollRef.current.scrollHeight
    }
  }, [debugTick])

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)

  const toggleDrawer = useCallback(() => {
    setDrawerExpanded(prev => {
      const next = !prev
      try { sessionStorage.setItem('nexus_drawer_expanded', String(next)) } catch {}
      return next
    })
  }, [])

  // iOS AudioContext unlock
  useEffect(() => {
    if (audioUnlocked) return
    const unlock = () => {
      try { unlockAudioContext(); setAudioUnlocked(true) } catch {}
    }
    document.addEventListener('touchstart', unlock, { once: true })
    document.addEventListener('click', unlock, { once: true })
    return () => {
      document.removeEventListener('touchstart', unlock)
      document.removeEventListener('click', unlock)
    }
  }, [audioUnlocked])

  // Subscribe to orb state
  useEffect(() => {
    return onOrbStateChange((s) => setOrbState(s))
  }, [])

  // Voice subsystem init + events
  useEffect(() => {
    const orgId  = profile?.org_id
    const userId = user?.id
    if (!orgId || !userId) return

    const voice = getVoiceSubsystem()
    voice.initialize({ orgId, userId }).then(() => setInitialized(true)).catch(console.error)

    const unsub = voice.on((event) => {
      if (event.type === 'status_changed') {
        setStatus(voice.getStatus())
      }

      if (event.type === 'transcript_ready') {
        const data = event.data
        if (data?.text) {
          lastTranscriptRef.current        = data.text
          lastCleanedTranscriptRef.current = cleanTranscript(data.text)
        }
      }

      if (event.type === 'session_complete') {
        const session = event.session
        const raw     = lastTranscriptRef.current
        const cleaned = lastCleanedTranscriptRef.current || raw

        if (session && raw) {
          const ts = Date.now()

          // User bubble: cleaned text visible, original shown in gray sub-text
          const userMsg = {
            id:              `voice-user-${ts}`,
            role:            'user',
            content:         cleaned,
            originalContent: raw !== cleaned ? raw : undefined,
            timestamp:       ts,
            isVoice:         true,
          }

          const nexusMsg = {
            id:        `voice-nexus-${ts + 1}`,
            role:      'nexus',
            content:   session.agentResponse || 'No response',
            timestamp: ts + 1,
            isVoice:   true,
            agentId:   session.targetAgent || 'nexus',
          }

          setMessages(prev => [...prev, userMsg, nexusMsg])

          conversationHistoryRef.current = [
            ...conversationHistoryRef.current,
            { role: 'user',      content: cleaned,           timestamp: ts },
            { role: 'assistant', content: nexusMsg.content,  timestamp: ts + 1 },
          ].slice(-20)

          lastTranscriptRef.current        = ''
          lastCleanedTranscriptRef.current = ''
        }

        setDrawerOpen(true)
        setDrawerExpanded(true)
      }

      if (event.type === 'error') {
        const errData = event.data
        const errMsg  = typeof errData?.error === 'string' ? errData.error : 'Voice error'
        setMessages(prev => [...prev, {
          id:        `err-${Date.now()}`,
          role:      'nexus',
          content:   `⚠️ ${errMsg}`,
          timestamp: Date.now(),
          agentId:   'nexus',
        }])
        setTimeout(() => setStatus('inactive'), 3000)
      }
    })

    return () => unsub()
  }, [user?.id, profile?.org_id])

  // FIX 4 — Persist messages to sessionStorage whenever they change
  useEffect(() => {
    if (messages.length === 0) return
    try {
      sessionStorage.setItem(DRAWER_SESSION_KEY, JSON.stringify(messages))
    } catch {}
  }, [messages, DRAWER_SESSION_KEY])

  // Silence detection
  const stopSilenceDetection = useCallback(() => {
    if (silenceRafRef.current)      { cancelAnimationFrame(silenceRafRef.current); silenceRafRef.current = null }
    if (silenceTimerRef.current)    { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null }
    if (silenceStreamRef.current)   { silenceStreamRef.current.getTracks().forEach(t => t.stop()); silenceStreamRef.current = null }
    if (silenceAudioCtxRef.current) { try { silenceAudioCtxRef.current.close() } catch {} silenceAudioCtxRef.current = null }
    analyserRef.current     = null
    silenceStartRef.current = 0
    setSilenceProgress(0)
  }, [])

  const startSilenceDetection = useCallback(async () => {
    try {
      const stream   = await navigator.mediaDevices.getUserMedia({ audio: true })
      silenceStreamRef.current   = stream
      const audioCtx = new AudioContext()
      silenceAudioCtxRef.current = audioCtx
      const source   = audioCtx.createMediaStreamSource(stream)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 512
      source.connect(analyser)
      analyserRef.current = analyser

      const dataArray = new Float32Array(analyser.fftSize)

      const checkSilence = () => {
        if (!analyserRef.current) return
        analyserRef.current.getFloatTimeDomainData(dataArray)
        let sumSq = 0
        for (let i = 0; i < dataArray.length; i++) sumSq += dataArray[i] * dataArray[i]
        const rms = Math.sqrt(sumSq / dataArray.length)

        if (rms < SILENCE_THRESHOLD) {
          if (silenceStartRef.current === 0) silenceStartRef.current = Date.now()
          const elapsed = Date.now() - silenceStartRef.current
          setSilenceProgress(Math.min(elapsed / SILENCE_DURATION_MS, 1))
          if (elapsed >= SILENCE_DURATION_MS) {
            getVoiceSubsystem().stopRecording()
            stopSilenceDetection()
            return
          }
        } else {
          silenceStartRef.current = 0
          setSilenceProgress(0)
        }

        silenceRafRef.current = requestAnimationFrame(checkSilence)
      }

      silenceRafRef.current = requestAnimationFrame(checkSilence)
    } catch (err) {
      console.warn('[VoiceButton] Silence detection failed:', err)
    }
  }, [stopSilenceDetection])

  useEffect(() => {
    if (status === 'recording') startSilenceDetection()
    else                        stopSilenceDetection()
  }, [status, startSilenceDetection, stopSilenceDetection])

  useEffect(() => () => stopSilenceDetection(), [stopSilenceDetection])

  // Mic press handler
  const handleMicPress = useCallback(async () => {
    unlockAudioContext()
    if (window.speechSynthesis) {
      const u = new SpeechSynthesisUtterance(''); u.volume = 0
      window.speechSynthesis.speak(u)
      window.speechSynthesis.cancel()
    }

    const voice = getVoiceSubsystem()
    switch (status) {
      case 'inactive':
      case 'complete':
      case 'listening':
        if (!drawerOpen)            { setDrawerOpen(true); setDrawerExpanded(true) }
        else if (!drawerExpanded)   { setDrawerExpanded(true) }
        // FIX 1 — sync accumulated conversation history to voice subsystem
        // so voice queries share multi-turn context with text conversation
        voice.setConversationHistory(conversationHistoryRef.current)
        await voice.startRecording('normal')
        // B49 — log voice session start (fire-and-forget)
        supabase.from('hub_platform_events').insert({
          event_type:  'nexus_session',
          event_label: 'Voice session started',
          metadata:    { timestamp: new Date().toISOString() },
        }).then(() => {})
        break
      case 'recording':
        await voice.stopRecording()
        break
      case 'responding':
        await voice.stopSpeaking()
        break
    }
  }, [status, drawerOpen, drawerExpanded])

  // Text message send handler
  const handleSendText = useCallback(async (text) => {
    if (!text.trim() || isSending || !profile?.org_id) return

    const userMsg = {
      id:        `text-user-${Date.now()}`,
      role:      'user',
      content:   text,
      timestamp: Date.now(),
    }
    setMessages(prev => [...prev, userMsg])
    setIsSending(true)

    conversationHistoryRef.current = [
      ...conversationHistoryRef.current,
      { role: 'user', content: text, timestamp: userMsg.timestamp },
    ].slice(-20)

    try {
      const { processMessage, detectMode } = await import('@/agents/nexus')
      const mode = detectMode(text, 'briefing')

      const response = await processMessage({
        message:             text,
        orgId:               profile.org_id,
        userId:              profile.id,
        userName:            profile.full_name,
        conversationHistory: conversationHistoryRef.current,
        mode,
      })

      const agentName = response.agent?.agentId ?? 'nexus'
      const nexusMsg = {
        id:        `text-nexus-${Date.now()}`,
        role:      'nexus',
        content:   response.agent?.content ?? 'No response',
        timestamp: Date.now(),
        agentId:   agentName,
      }
      setMessages(prev => [...prev, nexusMsg])

      // B49 — log agent call (fire-and-forget)
      supabase.from('hub_platform_events').insert({
        event_type:  'agent_call',
        event_label: agentName,
        metadata:    { agentName, sessionId: null, timestamp: new Date().toISOString() },
      }).then(() => {})

      conversationHistoryRef.current = [
        ...conversationHistoryRef.current,
        { role: 'assistant', content: nexusMsg.content, timestamp: nexusMsg.timestamp },
      ].slice(-20)

    } catch (err) {
      console.error('[VoiceButton] Text send failed:', err)
      setMessages(prev => [...prev, {
        id:        `err-${Date.now()}`,
        role:      'nexus',
        content:   '⚠️ Something went wrong. Please try again.',
        timestamp: Date.now(),
        agentId:   'nexus',
      }])
    } finally {
      setIsSending(false)
    }
  }, [isSending, profile])

  if (!initialized) return null

  const isVisible = drawerOpen || status !== 'inactive'

  // ── NEXUS permanent entry point button ────────────────────────────────────
  // Always visible when the full NEXUS drawer is not already expanded.
  // Clicking opens the NEXUS voice conversation directly — no bucket selection.
  const handleOpenNexus = () => {
    setDrawerOpen(true)
    setDrawerExpanded(true)
    try { sessionStorage.setItem('nexus_drawer_expanded', 'true') } catch {}
  }

  return (
    <>
      {/* ── Permanent NEXUS floating button (bottom-right, always visible) ── */}
      {/* Hidden only when the full drawer is expanded — the panel itself is the CTA */}
      {!(isVisible && drawerExpanded) && (
        <button
          onClick={handleOpenNexus}
          title="Talk to NEXUS"
          style={{
            position: 'fixed',
            bottom: '96px',
            right: '24px',
            zIndex: 59,
            width: '56px',
            height: '56px',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
            border: '1.5px solid rgba(34,197,94,0.6)',
            boxShadow: '0 4px 20px rgba(34,197,94,0.35)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '2px',
            cursor: 'pointer',
            transition: 'transform 0.15s ease, box-shadow 0.15s ease',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.07)'; (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 6px 28px rgba(34,197,94,0.5)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)'; (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 20px rgba(34,197,94,0.35)' }}
          aria-label="Open NEXUS voice conversation"
        >
          {/* N icon in a circle */}
          <span style={{
            width: '24px',
            height: '24px',
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'monospace',
            fontWeight: 800,
            fontSize: '13px',
            color: '#ffffff',
            letterSpacing: '-0.5px',
          }}>
            N
          </span>
          <span style={{
            fontSize: '8px',
            fontWeight: 700,
            color: 'rgba(255,255,255,0.9)',
            letterSpacing: '0.05em',
            lineHeight: 1,
            fontFamily: 'monospace',
          }}>
            NEXUS
          </span>
        </button>
      )}

      <NexusDrawerPanel
        isOpen         = {isVisible}
        drawerExpanded = {drawerExpanded}
        onToggleDrawer = {() => {
          if (!drawerOpen) { setDrawerOpen(true); setDrawerExpanded(true) }
          else             { toggleDrawer() }
        }}
        orbState        = {orbState}
        voiceStatus     = {status}
        onMicPress      = {handleMicPress}
        messages        = {messages}
        onSendText      = {handleSendText}
        isSending       = {isSending}
        contextMessages = {contextMessages}
        micStream       = {getVoiceSubsystem().getMicStream()}
        ttsElement      = {getVoiceSubsystem().getCurrentAudio()}
      />

      {/* Silence progress bar */}
      {status === 'recording' && silenceProgress > 0 && (
        <div className="fixed z-[61]" style={{ bottom: '68px', right: '24px', width: '48px' }}>
          <div style={{ height: '3px', borderRadius: '2px', background: 'rgba(255,255,255,0.15)', overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${silenceProgress * 100}%`,
              background: silenceProgress > 0.7 ? '#ef4444' : '#eab308',
              borderRadius: '2px', transition: 'width 0.1s linear',
            }} />
          </div>
          <p style={{ fontSize: '9px', color: '#9ca3af', textAlign: 'center', margin: '2px 0 0' }}>
            {silenceProgress > 0.7 ? 'Auto-stop…' : 'Silence'}
          </p>
        </div>
      )}

      {/* Audio debug panel (only when ?debug=1) */}
      {isDebugMode && (
        <div style={{ position: 'fixed', bottom: '90px', right: '12px', zIndex: 9998 }}>
          {debugExpanded ? (
            <div style={{
              background: 'rgba(0,0,0,0.92)', border: '1px solid #2EE89A', borderRadius: '12px',
              width: '320px', maxHeight: '200px', overflow: 'hidden', display: 'flex', flexDirection: 'column',
            }}>
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '6px 10px', borderBottom: '1px solid rgba(255,255,255,0.1)',
              }}>
                <span style={{ color: '#2EE89A', fontFamily: 'monospace', fontSize: '10px', fontWeight: 700 }}>
                  AUDIO DEBUG · {voiceDebugLog.length} entries · {status}
                </span>
                <button onClick={() => setDebugExpanded(false)}
                  style={{ background: 'none', border: 'none', color: '#60607A', cursor: 'pointer', fontSize: '14px' }}>
                  ✕
                </button>
              </div>
              <div ref={debugScrollRef} style={{ overflow: 'auto', padding: '6px 10px', flex: 1 }}>
                {voiceDebugLog.map((entry, i) => (
                  <div key={i} style={{
                    fontFamily: 'monospace', fontSize: '10px',
                    color: entry.includes('ERROR') || entry.includes('FAILED') ? '#FF5060' :
                           entry.includes('OK') || entry.includes('complete') ? '#2EE89A' : '#A8A8C0',
                    marginBottom: '2px', wordBreak: 'break-all',
                  }}>{entry}</div>
                ))}
              </div>
            </div>
          ) : (
            <button onClick={() => setDebugExpanded(true)} style={{
              background: 'rgba(0,0,0,0.85)', border: '1px solid #2EE89A', borderRadius: '20px',
              padding: '6px 12px', color: '#2EE89A', fontFamily: 'monospace', fontSize: '10px',
              fontWeight: 700, cursor: 'pointer',
            }}>
              DEBUG {voiceDebugLog.length}
            </button>
          )}
        </div>
      )}
    </>
  )
}
