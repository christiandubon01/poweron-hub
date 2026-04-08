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
import { getVoiceSubsystem, unlockAudioContext, voiceDebugLog, onDebugUpdate, onOrbStateChange, isOrbLabMode, type VoiceSessionStatus } from '@/services/voice'
import { useAuth } from '@/hooks/useAuth'
import { NexusDrawerPanel, type DrawerMessage } from '@/components/nexus/NexusDrawerPanel'
import type { OrbState } from '@/components/nexus/NexusPresenceOrb'
import { supabase } from '@/lib/supabase'
import { useNexusStore, type NexusSessionRow } from '@/store/nexusStore'
// B65b — Admin dual-mic panel
import { NexusAdminSelector } from '@/components/nexus/NexusAdminSelector'
import { setAdminNexusActive, setAdminContextMode, type AdminContextMode } from '@/services/nexusAdminContext'

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
  // B57 FIX 2: hide the floating NEXUS orb button when ORB LAB is active
  hideFloatingOrb?: boolean
}

// ── Component ──────────────────────────────────────────────────────────────────

export function VoiceActivationButton({ className, hideFloatingOrb = false }: VoiceActivationButtonProps) {
  const { user, profile } = useAuth()

  const [status, setStatus]               = useState<VoiceSessionStatus>('inactive')
  const [initialized, setInitialized]     = useState(false)
  const [audioUnlocked, setAudioUnlocked] = useState(false)
  const [orbState, setOrbState]           = useState<OrbState>('inactive')

  // B65b — Admin dual-mic panel state
  const isAdmin = !!user?.email && user.email === (import.meta.env.VITE_ADMIN_EMAIL as string)
  const [showAdminSelector, setShowAdminSelector] = useState(false)
  const [adminContextMode, setAdminContextModeState] = useState<AdminContextMode>('combined')
  // Track whether admin opened in full-oversight mode (for drawer header label)
  const [adminOversightActive, setAdminOversightActive] = useState(false)

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

  // B61a — Session store
  const { activeSessionId, setActiveSessionId, bumpSession, prependSession, setSessionList, updateSessionTopicName } = useNexusStore()

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

  // B61a — Session initialization: on mount, fetch or create the active session
  useEffect(() => {
    const userId = user?.id
    const orgId  = profile?.org_id
    if (!userId) return

    async function initSession() {
      try {
        // Fetch the most recent session for this user
        const { data, error } = await supabase
          .from('nexus_sessions')
          .select('*')
          .eq('user_id', userId)
          .order('last_active', { ascending: false })
          .limit(50)

        if (error) throw error

        if (data && data.length > 0) {
          // Set most recent session as active
          setActiveSessionId(data[0].id)
          setSessionList(data)
        } else {
          // No sessions exist — auto-create first one
          const { data: newSession, error: createErr } = await supabase
            .from('nexus_sessions')
            .insert({
              user_id:    userId,
              org_id:     orgId ?? null,
              topic_name: 'New Session',
              agent:      'nexus',
            })
            .select()
            .single()

          if (createErr) throw createErr
          if (newSession) {
            setActiveSessionId(newSession.id)
            setSessionList([newSession])
          }
        }
      } catch (err) {
        console.error('[VoiceButton] Session init failed:', err)
      }
    }

    initSession()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, profile?.org_id])

  // B61b — Auto-name session after 2 completed exchanges (message_count reaches 4)
  const autoNameSession = useCallback(async (sessionId: string) => {
    try {
      // Fetch last 4 messages (2 user + 2 assistant)
      const { data: msgs } = await supabase
        .from('nexus_messages')
        .select('role, content')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: false })
        .limit(4)

      if (!msgs || msgs.length < 4) return

      // Reverse so oldest is first (chronological order for Claude)
      const chronological = [...msgs].reverse()

      // Call Claude via proxy with naming system prompt
      const { callClaude, extractText } = await import('@/services/claudeProxy')
      const resp = await callClaude({
        system: 'You are a session naming assistant. Given this conversation, respond with ONLY a 2-5 word topic name. No punctuation. No quotes. Examples: Pipeline Review, Surgery Center RFIs, Weekly Cash Flow',
        messages: chronological.map((m) => ({
          role:    m.role as 'user' | 'assistant',
          content: m.content,
        })),
        max_tokens: 20,
      })

      const topicName = extractText(resp)?.trim()
      if (!topicName) return

      // Update Supabase + local store
      await supabase
        .from('nexus_sessions')
        .update({ topic_name: topicName })
        .eq('id', sessionId)

      updateSessionTopicName(sessionId, topicName)
      console.log('[VoiceButton] Auto-named session:', topicName)
    } catch (err) {
      console.warn('[VoiceButton] Auto-naming failed (non-critical):', err)
    }
  }, [updateSessionTopicName])

  // B61a — Helper: persist a user+assistant message pair to nexus_messages and bump session
  const persistMessagePair = useCallback(async (
    userContent: string,
    assistantContent: string,
    agentId: string,
  ) => {
    const sessionId = useNexusStore.getState().activeSessionId
    const userId    = user?.id
    if (!sessionId || !userId) return

    try {
      // Insert user + assistant messages
      await supabase.from('nexus_messages').insert([
        { session_id: sessionId, user_id: userId, role: 'user',      content: userContent,      agent: 'user'   },
        { session_id: sessionId, user_id: userId, role: 'assistant', content: assistantContent, agent: agentId  },
      ])

      // Update session last_active + message_count
      const now = new Date().toISOString()
      const { data: updated } = await supabase
        .from('nexus_sessions')
        .update({ last_active: now })
        .eq('id', sessionId)
        .select('message_count')
        .single()

      // Increment count locally (optimistic)
      const newCount = (updated?.message_count ?? 0) + 2
      await supabase
        .from('nexus_sessions')
        .update({ message_count: newCount })
        .eq('id', sessionId)

      bumpSession(sessionId, now, newCount)

      // B61b — Trigger auto-naming after exactly 2 exchanges (4 messages)
      if (newCount === 4) {
        autoNameSession(sessionId)
      }
    } catch (err) {
      console.error('[VoiceButton] Failed to persist messages:', err)
    }
  }, [user?.id, bumpSession, autoNameSession])

  // B61a — Session switch: clear state, load messages from selected session
  const handleSessionSwitch = useCallback((sessionId: string, loadedMessages: DrawerMessage[]) => {
    setActiveSessionId(sessionId)
    // Clear conversation buffer
    conversationHistoryRef.current = []
    // Set UI messages to the loaded session messages
    setMessages(loadedMessages)
    // Rebuild conversation history from loaded messages for context
    const history = loadedMessages.map((m) => ({
      role:      m.role === 'nexus' ? 'assistant' : 'user',
      content:   m.content,
      timestamp: m.timestamp,
    }))
    conversationHistoryRef.current = history.slice(-6)
  }, [setActiveSessionId])

  // B61a — New session: clear state
  const handleNewSession = useCallback((session: NexusSessionRow) => {
    setActiveSessionId(session.id)
    conversationHistoryRef.current = []
    setMessages([])
  }, [setActiveSessionId])

  // Silence detection refs
  const silenceTimerRef    = useRef(null)
  const silenceStartRef    = useRef(0)
  const analyserRef        = useRef(null)
  const silenceStreamRef   = useRef(null)
  const silenceRafRef      = useRef(null)
  const silenceAudioCtxRef = useRef(null)
  const [silenceProgress, setSilenceProgress] = useState(0)

  const SILENCE_THRESHOLD   = 0.01
  const SILENCE_DURATION_MS = 4000  // B60: 40 frames × 100ms = 4s (was 2s/20 frames)

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

  // Listen for sidebar NEXUS Voice click
  // B65b: for admin, sidebar click also shows the selector panel
  useEffect(() => {
    const handler = () => {
      if (isAdmin) {
        setShowAdminSelector(true)
        return
      }
      setDrawerOpen(true)
      setDrawerExpanded(true)
      try { sessionStorage.setItem('nexus_drawer_expanded', 'true') } catch {}
    }
    window.addEventListener('poweron:open-nexus-drawer', handler)
    return () => window.removeEventListener('poweron:open-nexus-drawer', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin])

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

          // B61a — Persist voice exchange to nexus_messages
          persistMessagePair(cleaned, nexusMsg.content, nexusMsg.agentId ?? 'nexus')

          lastTranscriptRef.current        = ''
          lastCleanedTranscriptRef.current = ''
        }

        // B56 FIX 2: suppress drawer when voice runs from ORB LAB (pure-visual mode)
        if (!isOrbLabMode()) {
          setDrawerOpen(true)
          setDrawerExpanded(true)
        }
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

      // B61a — Persist text exchange to nexus_messages
      persistMessagePair(text, nexusMsg.content, agentName)

      // B49 — log agent call (fire-and-forget)
      supabase.from('hub_platform_events').insert({
        event_type:  'agent_call',
        event_label: agentName,
        metadata:    { agentName, sessionId: useNexusStore.getState().activeSessionId ?? null, timestamp: new Date().toISOString() },
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
  // For non-admin: opens the NEXUS voice conversation directly.
  // For admin (B65b): shows the dual-mic selector panel first.
  const handleOpenNexus = () => {
    if (isAdmin) {
      setShowAdminSelector(true)
      return
    }
    // Non-admin: standard electrical context (unchanged)
    setAdminNexusActive(false)
    setAdminOversightActive(false)
    setDrawerOpen(true)
    setDrawerExpanded(true)
    try { sessionStorage.setItem('nexus_drawer_expanded', 'true') } catch {}
  }

  // B65b — Admin selector: handle mode selection
  const handleAdminSelect = useCallback((mode: 'electrical' | 'admin', contextMode: AdminContextMode) => {
    setShowAdminSelector(false)
    if (mode === 'admin') {
      // Full-oversight: activate admin context in the NEXUS system prompt
      setAdminNexusActive(true, contextMode)
      setAdminContextModeState(contextMode)
      setAdminOversightActive(true)
    } else {
      // Standard electrical: clear admin context
      setAdminNexusActive(false)
      setAdminOversightActive(false)
    }
    setDrawerOpen(true)
    setDrawerExpanded(true)
    try { sessionStorage.setItem('nexus_drawer_expanded', 'true') } catch {}
  }, [])

  // B65b — Admin context toggle (while drawer is open)
  const handleAdminContextChange = useCallback((mode: AdminContextMode) => {
    setAdminContextModeState(mode)
    setAdminContextMode(mode)  // updates module singleton → picked up on next NEXUS call
  }, [])

  return (
    <>
      {/* ── Permanent NEXUS floating button (bottom-right, always visible) ── */}
      {/* Hidden when: (a) full drawer is expanded, OR (b) ORB LAB is active (B57 FIX 2) */}
      {!(isVisible && drawerExpanded) && !hideFloatingOrb && (
        <button
          onClick={handleOpenNexus}
          title={isAdmin ? 'NEXUS — Select mode' : 'Talk to NEXUS'}
          style={{
            position: 'fixed',
            bottom: '96px',
            right: '24px',
            zIndex: 59,
            width: '56px',
            height: '56px',
            borderRadius: '50%',
            // B65b: admin button uses purple gradient when oversight mode was last active
            background: (isAdmin && adminOversightActive)
              ? 'linear-gradient(135deg, #a855f7 0%, #7c3aed 100%)'
              : 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
            border: (isAdmin && adminOversightActive)
              ? '1.5px solid rgba(168,85,247,0.6)'
              : '1.5px solid rgba(34,197,94,0.6)',
            boxShadow: (isAdmin && adminOversightActive)
              ? '0 4px 20px rgba(168,85,247,0.35)'
              : '0 4px 20px rgba(34,197,94,0.35)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '2px',
            cursor: 'pointer',
            transition: 'transform 0.15s ease, box-shadow 0.15s ease',
          }}
          onMouseEnter={e => {
            const btn = e.currentTarget as HTMLButtonElement
            btn.style.transform = 'scale(1.07)'
            btn.style.boxShadow = (isAdmin && adminOversightActive)
              ? '0 6px 28px rgba(168,85,247,0.5)'
              : '0 6px 28px rgba(34,197,94,0.5)'
          }}
          onMouseLeave={e => {
            const btn = e.currentTarget as HTMLButtonElement
            btn.style.transform = 'scale(1)'
            btn.style.boxShadow = (isAdmin && adminOversightActive)
              ? '0 4px 20px rgba(168,85,247,0.35)'
              : '0 4px 20px rgba(34,197,94,0.35)'
          }}
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

      {/* B65b — Admin selector panel: shown when admin taps the NEXUS button */}
      {showAdminSelector ? (
        <NexusAdminSelector
          onSelect={handleAdminSelect}
          onClose={() => setShowAdminSelector(false)}
          currentContextMode={adminContextMode}
          onContextModeChange={handleAdminContextChange}
        />
      ) : null}

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
        onSessionSwitch = {handleSessionSwitch}
        onNewSession    = {handleNewSession}
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
