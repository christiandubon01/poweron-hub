// @ts-nocheck
/**
 * NexusDrawerPanel — Premium right-side split drawer for the NEXUS voice session.
 *
 * Layout:
 *   LEFT HALF  — 3D Orb (NexusThreeOrb) that reacts to voice state
 *   RIGHT HALF — Scrollable chat with message bubbles + input (mic + text)
 *
 * Collapse behaviour:
 *   - ChevronRight button slides the drawer fully off screen (translateX 100%)
 *   - While collapsed a 40 px floating orb circle sits bottom-right to reopen
 *   - Transition: 300 ms ease-in-out
 *
 * Props consumed by parent (VoiceActivationButton):
 *   isOpen        — whether the drawer is visible at all (parent logic)
 *   drawerExpanded — whether the drawer is expanded (vs collapsed to orb stub)
 *   onToggleDrawer — collapse / expand the drawer
 *   orbState      — current OrbState from voice subsystem
 *   voiceStatus   — raw VoiceSessionStatus string
 *   onMicPress    — fires voice start/stop recording
 *   messages      — DrawerMessage[] (combined voice + text chat)
 *   onSendText    — async (text: string) => void  (parent handles processMessage)
 *   isSending     — true while text message is being processed
 */

import React, { useState, useRef, useEffect, useCallback } from 'react'
import { ChevronRight, Mic, MicOff, Loader2, Send, Volume2, VolumeX, Pin, Check } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { clsx } from 'clsx'
import { NexusThreeOrb } from './NexusThreeOrb'
import type { OrbState } from './NexusPresenceOrb'
import type { VoiceSessionStatus } from '@/services/voice'
// B46 — AI Visual Suite: QuantumFoam is the default NEXUS orb visual
import { VisualRenderer, getVizMode } from '@/components/v15r/AIVisualSuite'
// B49 — Live audio pipeline
import { useNEXUSAudio } from '@/components/v15r/AIVisualSuite/useNEXUSAudio'

// Map OrbState to VisualRenderer audio-reactive props
function orbStateToAudio(state: OrbState): { bass: number; mid: number; high: number; mtz: number; hue: number } {
  switch (state) {
    case 'listening':    return { bass: 0.25, mid: 0.45, high: 0.05, mtz: 0.0,  hue: 200 }
    case 'recording':    return { bass: 0.65, mid: 0.35, high: 0.30, mtz: 0.0,  hue: 0   }
    case 'transcribing': return { bass: 0.30, mid: 0.55, high: 0.40, mtz: 0.2,  hue: 55  }
    case 'processing':   return { bass: 0.50, mid: 0.70, high: 0.50, mtz: 0.45, hue: 280 }
    case 'responding':   return { bass: 0.75, mid: 0.55, high: 0.60, mtz: 0.1,  hue: 160 }
    case 'complete':     return { bass: 0.05, mid: 0.05, high: 0.0,  mtz: 0.0,  hue: 160 }
    case 'error':        return { bass: 0.40, mid: 0.20, high: 0.80, mtz: 0.65, hue: 28  }
    default:             return { bass: 0.0,  mid: 0.0,  high: 0.0,  mtz: 0.0,  hue: 160 }
  }
}

// ── Types ──────────────────────────────────────────────────────────────────────

export interface DrawerMessage {
  id:              string
  role:            'user' | 'nexus'
  content:         string          // cleaned / display text
  originalContent?: string         // original voice transcript (shown in gray below)
  timestamp:       number
  isVoice?:        boolean
  agentId?:        string
}

export interface NexusDrawerPanelProps {
  isOpen:           boolean
  drawerExpanded:   boolean
  onToggleDrawer:   () => void
  orbState:         OrbState
  voiceStatus:      VoiceSessionStatus
  onMicPress:       () => void
  messages:         DrawerMessage[]
  onSendText:       (text: string) => Promise<void>
  isSending:        boolean
  /** Last 3 messages from the previous session — shown faded at top for continuity */
  contextMessages?: DrawerMessage[]
  /** B49 — Live audio streams for visual reactivity */
  micStream?:   MediaStream | null
  ttsElement?:  HTMLAudioElement | null
}

// ── Agent color map ────────────────────────────────────────────────────────────

const AGENT_COLORS: Record<string, string> = {
  nexus:     '#8b5cf6',
  vault:     '#f59e0b',
  pulse:     '#06b6d4',
  ledger:    '#10b981',
  spark:     '#ec4899',
  blueprint: '#3b82f6',
  ohm:       '#f97316',
  chrono:    '#a855f7',
  scout:     '#6366f1',
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function orbStateLabel(status: VoiceSessionStatus): string {
  switch (status) {
    case 'recording':    return 'Recording…'
    case 'transcribing': return 'Transcribing…'
    case 'processing':   return 'Thinking…'
    case 'responding':   return 'Speaking…'
    case 'listening':    return 'Listening…'
    default:             return 'NEXUS'
  }
}

// ── Message bubble ─────────────────────────────────────────────────────────────

function MessageBubble({ msg, faded }: { msg: DrawerMessage; faded?: boolean }) {
  const isUser = msg.role === 'user'
  const agentColor = msg.agentId ? AGENT_COLORS[msg.agentId] ?? '#8b5cf6' : '#8b5cf6'
  // B52: Pin state
  const [pinned, setPinned] = React.useState(false)

  async function handlePin() {
    if (pinned) return
    try {
      await supabase.from('pinned_insights').insert({
        source:   'nexus',
        content:  msg.content,
        context:  'NEXUS conversation',
        category: msg.agentId ?? 'NEXUS',
      })
      setPinned(true)
      window.dispatchEvent(new CustomEvent('poweron:insight-pinned'))
      // Auto-reset after 2s
      setTimeout(() => setPinned(false), 2000)
    } catch {}
  }

  return (
    <div
      className={clsx(
        'flex gap-2 animate-fade-in',
        isUser ? 'flex-row-reverse' : 'flex-row',
        faded && 'opacity-40'
      )}
    >
      {/* Avatar — nexus side only */}
      {!isUser && (
        <div
          className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-[9px] font-mono font-bold mt-1"
          style={{
            background: `${agentColor}22`,
            border: `1px solid ${agentColor}44`,
            color: agentColor,
          }}
        >
          {(msg.agentId ?? 'N').charAt(0).toUpperCase()}
        </div>
      )}

      {/* Bubble */}
      <div
        className={clsx(
          'max-w-[78%] rounded-2xl px-3.5 py-2.5',
          isUser
            ? 'rounded-tr-sm bg-emerald-600/90 text-white'
            : 'rounded-tl-sm bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.08)] text-gray-200'
        )}
        style={{ position: 'relative' }}
      >
        {/* Agent badge for NEXUS messages */}
        {!isUser && msg.agentId && (
          <div className="mb-1">
            <span
              className="inline-block text-[9px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
              style={{ background: `${agentColor}22`, color: agentColor }}
            >
              {msg.agentId}
            </span>
          </div>
        )}

        {/* Main content */}
        <p className="text-sm leading-relaxed whitespace-pre-wrap break-words m-0">
          {msg.content}
        </p>

        {/* Voice transcript — show original Whisper text so user can verify what was heard */}
        {isUser && msg.isVoice && msg.originalContent && msg.originalContent !== msg.content && (
          <p className="text-[11px] text-emerald-200/60 mt-1.5 leading-relaxed whitespace-pre-wrap break-words m-0 border-t border-white/10 pt-1.5">
            <Mic size={9} className="inline mr-1 opacity-70" />
            <span className="text-[9px] uppercase tracking-wider text-emerald-200/50 font-semibold">heard: </span>
            {msg.originalContent}
          </p>
        )}

        {/* Timestamp + pin button row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
          <p
            className={clsx(
              'text-[9px] font-mono m-0',
              isUser ? 'text-emerald-200/70' : 'text-gray-500'
            )}
          >
            {formatTime(msg.timestamp)}
          </p>
          {/* B52: Pin button — only on NEXUS (non-user) messages */}
          {!isUser && (
            <button
              onClick={handlePin}
              title={pinned ? 'Pinned!' : 'Pin this insight'}
              style={{
                background:  'none',
                border:      'none',
                cursor:      pinned ? 'default' : 'pointer',
                color:       pinned ? '#00e5ff' : '#374151',
                padding:     '2px 4px',
                display:     'flex',
                alignItems:  'center',
                gap:         3,
                fontSize:    9,
                fontFamily:  'Courier New, monospace',
                transition:  'color 0.15s',
              }}
              onMouseEnter={e => { if (!pinned) (e.currentTarget as HTMLButtonElement).style.color = '#00e5ff' }}
              onMouseLeave={e => { if (!pinned) (e.currentTarget as HTMLButtonElement).style.color = '#374151' }}
            >
              {pinned ? <Check size={10} /> : <Pin size={10} />}
              {pinned ? 'Pinned' : ''}
            </button>
          )}
        </div>
      </div>

      {/* FIX 2 — Mic icon badge beside user voice messages (appears left of bubble in flex-row-reverse) */}
      {isUser && msg.isVoice && (
        <div className="flex-shrink-0 flex flex-col items-center justify-end pb-5 gap-0.5">
          <Mic size={11} className="text-emerald-400/60" />
        </div>
      )}
    </div>
  )
}

// ── Collapsed stub button ──────────────────────────────────────────────────────

function CollapsedOrbButton({ onClick, orbState }: { onClick: () => void; orbState: OrbState }) {
  const isActive = orbState !== 'inactive' && orbState !== 'complete'

  return (
    <button
      onClick={onClick}
      className={clsx(
        'fixed bottom-6 right-6 z-[60]',
        'w-10 h-10 rounded-full shadow-xl',
        'flex items-center justify-center',
        'transition-all duration-200',
        'focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 focus:ring-offset-gray-900',
      )}
      style={{
        background: isActive
          ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)'
          : 'rgba(16,185,129,0.15)',
        border: '1.5px solid rgba(16,185,129,0.5)',
      }}
      aria-label="Open NEXUS panel"
      title="Open NEXUS voice panel"
    >
      {/* Mini orb visual with mic icon fallback */}
      <div className="relative w-6 h-6">
        <VisualRenderer mode={getVizMode()} {...orbStateToAudio(orbState)} style={{ width: 24, height: 24, borderRadius: '50%', overflow: 'hidden' }} />
        {/* Mic SVG fallback — visible when orb canvas is transparent */}
        <svg className="absolute inset-0 w-6 h-6 text-emerald-300 opacity-60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" x2="12" y1="19" y2="22" />
        </svg>
      </div>
      {/* Active pulse ring */}
      {isActive && (
        <span className="absolute inset-0 rounded-full animate-ping bg-emerald-400/30 pointer-events-none" />
      )}
    </button>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function NexusDrawerPanel({
  isOpen,
  drawerExpanded,
  onToggleDrawer,
  orbState,
  voiceStatus,
  onMicPress,
  messages,
  onSendText,
  isSending,
  contextMessages = [],
  micStream,
  ttsElement,
}: NexusDrawerPanelProps) {
  // B49 — Live audio bands (falls back to simulation when streams are null)
  const { bass, mid, high } = useNEXUSAudio(micStream ?? null, ttsElement ?? null)
  // Map orbState to mtzBoost for visual intensity
  const _nexusMtzBoost: Record<string, number> = {
    inactive: 0.0, listening: 0.1, recording: 0.25,
    transcribing: 0.15, processing: 0.15, responding: 0.3, complete: 0.0, error: 0.0,
  }
  const _mtzBoost = _nexusMtzBoost[orbState] ?? 0.0
  const _vizMtz = Math.min(1.0, _mtzBoost)
  const [textInput, setTextInput] = useState('')
  const messagesEndRef  = useRef<HTMLDivElement>(null)
  const textareaRef     = useRef<HTMLTextAreaElement>(null)
  const scrollContRef   = useRef<HTMLDivElement>(null)

  // ── Mute state — synced via localStorage 'nexus_mute' ─────────────────────
  const [muted, setMuted] = useState(() => {
    try { return localStorage.getItem('nexus_mute') === 'true' } catch { return false }
  })

  // Sync mute state when QuickCapture toggles it (storage event)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'nexus_mute') {
        setMuted(e.newValue === 'true')
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const toggleMute = useCallback(() => {
    setMuted(prev => {
      const next = !prev
      try { localStorage.setItem('nexus_mute', String(next)) } catch {}
      return next
    })
  }, [])

  // ── "Tap mic to continue..." prompt logic ─────────────────────────────────
  const [showContinuePrompt, setShowContinuePrompt] = useState(false)
  const prevVoiceStatusRef = useRef<VoiceSessionStatus>(voiceStatus)
  const continuePromptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const prev = prevVoiceStatusRef.current
    prevVoiceStatusRef.current = voiceStatus

    // Show prompt when NEXUS finishes speaking and mic is idle
    if (
      prev === 'responding' &&
      (voiceStatus === 'inactive' || voiceStatus === 'complete' || voiceStatus === 'listening')
    ) {
      setShowContinuePrompt(true)
      if (continuePromptTimerRef.current) clearTimeout(continuePromptTimerRef.current)
      continuePromptTimerRef.current = setTimeout(() => setShowContinuePrompt(false), 3000)
    }

    // Hide immediately if user starts recording
    if (voiceStatus === 'recording' || voiceStatus === 'transcribing' || voiceStatus === 'processing') {
      setShowContinuePrompt(false)
      if (continuePromptTimerRef.current) clearTimeout(continuePromptTimerRef.current)
    }

    return () => {
      if (continuePromptTimerRef.current) clearTimeout(continuePromptTimerRef.current)
    }
  }, [voiceStatus])

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Send text handler
  const handleSendText = useCallback(async () => {
    const trimmed = textInput.trim()
    if (!trimmed || isSending) return
    setTextInput('')
    await onSendText(trimmed)
    textareaRef.current?.focus()
  }, [textInput, isSending, onSendText])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendText()
    }
  }

  // Voice button state helpers
  const isRecording   = voiceStatus === 'recording'
  const isProcessing  = voiceStatus === 'transcribing' || voiceStatus === 'processing'
  const isSpeaking    = voiceStatus === 'responding'

  if (!isOpen) return null

  // ── Collapsed state — show only the 40 px orb stub ──────────────────────
  if (!drawerExpanded) {
    return <CollapsedOrbButton onClick={onToggleDrawer} orbState={orbState} />
  }

  // ── Expanded drawer ──────────────────────────────────────────────────────

  return (
    <>
      {/* Backdrop (subtle, semi-transparent) */}
      <div
        className="fixed inset-0 z-[58] pointer-events-none"
        style={{ background: 'rgba(0,0,0,0.15)' }}
      />

      {/* Drawer */}
      <div
        className="fixed top-0 right-0 bottom-0 z-[59] flex"
        style={{
          width: 'min(660px, 90vw)',
          background: '#111827',
          borderLeft: '1px solid rgba(255,255,255,0.07)',
          boxShadow: '-12px 0 40px rgba(0,0,0,0.5)',
          transform: 'translateX(0)',
          transition: 'transform 300ms ease-in-out',
        }}
      >
        {/* ── LEFT: Orb panel ─────────────────────────────────────────────── */}
        <div
          className="relative flex flex-col items-center justify-center"
          style={{
            width: '45%',
            borderRight: '1px solid rgba(255,255,255,0.06)',
            background: 'rgba(0,0,0,0.25)',
          }}
        >
          {/* Collapse button — top left of orb panel */}
          <button
            onClick={onToggleDrawer}
            className="absolute top-3 left-3 p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors z-10"
            aria-label="Collapse NEXUS panel"
            title="Collapse panel"
          >
            <ChevronRight size={16} />
          </button>

          {/* NEXUS label */}
          <div className="absolute top-4 right-4 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[10px] font-mono font-bold text-emerald-400 uppercase tracking-widest">
              NEXUS
            </span>
          </div>

          {/* Orb — fills the left half — B49: live audio reactive */}
          <div
            className="w-full flex-1"
            style={{ maxHeight: '100%', minHeight: 0 }}
          >
            <VisualRenderer mode={getVizMode()} bass={bass} mid={mid} high={high} mtz={_vizMtz} hue={160} style={{ width: '100%', height: '100%' }} />
          </div>

          {/* State label */}
          <div className="absolute bottom-4 left-0 right-0 flex justify-center">
            <span
              className="text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 rounded-full"
              style={{
                background: 'rgba(0,0,0,0.4)',
                color: orbState === 'listening' || orbState === 'recording' ? '#3b82f6' :
                       orbState === 'responding' ? '#10b981' :
                       orbState === 'processing' || orbState === 'transcribing' ? '#a855f7' :
                       '#6b7280',
              }}
            >
              {orbStateLabel(voiceStatus)}
            </span>
          </div>
        </div>

        {/* ── RIGHT: Chat panel ────────────────────────────────────────────── */}
        <div className="flex flex-col flex-1 min-w-0">

          {/* Header */}
          <div
            className="flex-shrink-0 flex items-center justify-between px-4 py-3"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
          >
            <div>
              <div className="text-sm font-bold text-white">Voice Session</div>
              <div className="text-[10px] text-gray-500 font-mono">
                {messages.length} message{messages.length !== 1 ? 's' : ''}
              </div>
            </div>

            {/* Mute toggle — FIX 2 */}
            <button
              onClick={toggleMute}
              className={clsx(
                'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors',
                muted
                  ? 'bg-amber-500/20 border border-amber-500/40 text-amber-400'
                  : 'bg-white/5 border border-white/10 text-gray-400 hover:text-gray-200 hover:bg-white/10'
              )}
              aria-label={muted ? 'Unmute TTS' : 'Mute TTS'}
              title={muted ? 'TTS muted — tap to unmute' : 'Mute TTS output'}
            >
              {muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
              <span className="text-[10px]">{muted ? 'Muted' : 'Sound'}</span>
            </button>
          </div>

          {/* Messages — full height, scrollable */}
          <div
            ref={scrollContRef}
            className="flex-1 overflow-y-auto px-3 py-4 space-y-4 min-h-0"
            style={{ overscrollBehavior: 'contain' }}
          >
            {/* FIX 4 — Previous session context: faded, not interactive */}
            {contextMessages.length > 0 && (
              <div className="mb-3">
                <div className="text-[9px] font-mono text-gray-600 uppercase tracking-wider text-center mb-2 select-none">
                  — previous session —
                </div>
                <div className="pointer-events-none space-y-3">
                  {contextMessages.map(msg => (
                    <MessageBubble key={`ctx-${msg.id}`} msg={msg} faded />
                  ))}
                </div>
                <div className="border-t border-white/5 mt-3 pt-2 text-[9px] font-mono text-gray-700 text-center select-none">
                  new session
                </div>
              </div>
            )}

            {messages.length === 0 && contextMessages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center px-4 py-12">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center mb-3"
                  style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.25)' }}
                >
                  <Mic size={18} className="text-emerald-400" />
                </div>
                <p className="text-sm font-semibold text-gray-300 mb-1">Ready to listen</p>
                <p className="text-xs text-gray-500 leading-relaxed">
                  Press the mic button to speak, or type a message below.
                </p>
              </div>
            )}

            {messages.map(msg => (
              <MessageBubble key={msg.id} msg={msg} />
            ))}

            {/* Processing indicator */}
            {(isProcessing || isSending) && (
              <div className="flex gap-2">
                <div
                  className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-[9px] font-mono font-bold mt-1"
                  style={{
                    background: 'rgba(139,92,246,0.15)',
                    border: '1px solid rgba(139,92,246,0.3)',
                    color: '#8b5cf6',
                  }}
                >
                  N
                </div>
                <div className="rounded-2xl rounded-tl-sm px-3.5 py-2.5 bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.08)]">
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input area */}
          <div
            className="flex-shrink-0 px-3 pb-3 pt-2"
            style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
          >
            {/* ── FIX 1 — Large persistent centered mic button ─────────────── */}
            <div className="flex flex-col items-center mb-3 mt-1">
              {/* Large mic button — always visible, never disappears */}
              <button
                onClick={onMicPress}
                disabled={isProcessing}
                className={clsx(
                  'relative w-14 h-14 rounded-full flex items-center justify-center transition-all shadow-lg',
                  'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900',
                  isRecording  && 'focus:ring-red-400',
                  isSpeaking   && 'focus:ring-cyan-400',
                  isProcessing && 'focus:ring-gray-500',
                  !isRecording && !isSpeaking && !isProcessing && 'focus:ring-emerald-400',
                )}
                style={{
                  background: isRecording
                    ? 'rgba(220,38,38,0.85)'
                    : isSpeaking
                      ? 'rgba(8,145,178,0.85)'
                      : isProcessing
                        ? 'rgba(55,65,81,0.85)'
                        : 'rgba(16,185,129,0.85)',
                  boxShadow: isRecording
                    ? '0 0 0 0 rgba(220,38,38,0.4)'
                    : isSpeaking
                      ? '0 0 0 0 rgba(8,145,178,0.4)'
                      : '0 4px 24px rgba(16,185,129,0.25)',
                }}
                aria-label={
                  isRecording  ? 'Stop recording'
                  : isSpeaking  ? 'Stop speaking (barge in)'
                  : isProcessing ? 'Processing…'
                  : 'Start recording'
                }
                title={
                  isRecording  ? 'Tap to stop recording'
                  : isSpeaking  ? 'Tap to interrupt NEXUS'
                  : isProcessing ? 'Processing…'
                  : 'Tap to speak'
                }
              >
                {/* Pulse ring when recording */}
                {isRecording && (
                  <span className="absolute inset-0 rounded-full animate-ping bg-red-500/30 pointer-events-none" />
                )}
                {/* Speaking wave ring */}
                {isSpeaking && (
                  <span className="absolute inset-0 rounded-full animate-ping bg-cyan-500/25 pointer-events-none" />
                )}

                {isProcessing ? (
                  <Loader2 size={24} className="text-white animate-spin" />
                ) : isRecording ? (
                  <MicOff size={24} className="text-white" />
                ) : isSpeaking ? (
                  <Volume2 size={24} className="text-white" />
                ) : (
                  <Mic size={24} className="text-white" />
                )}
              </button>

              {/* State label below large mic */}
              <span className="mt-1.5 text-[10px] font-mono text-gray-400">
                {isRecording  ? 'Recording — tap to stop'
                 : isSpeaking  ? 'Speaking — tap to interrupt'
                 : isProcessing ? 'Processing…'
                 : 'Tap to speak'}
              </span>

              {/* FIX 3 — "Tap mic to continue..." prompt after NEXUS responds */}
              {showContinuePrompt && !isRecording && !isProcessing && !isSpeaking && (
                <span
                  className="mt-1 text-[11px] text-emerald-400/80 font-medium"
                  style={{
                    animation: 'fadeOut 3s ease-in-out forwards',
                  }}
                >
                  Tap mic to continue…
                </span>
              )}
            </div>

            {/* Text input row */}
            <div
              className="flex items-end gap-2 rounded-xl px-3 py-2"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.09)',
              }}
            >
              {/* Text input */}
              <textarea
                ref={textareaRef}
                value={textInput}
                onChange={e => setTextInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Or type a message…"
                rows={1}
                className="flex-1 bg-transparent text-sm text-gray-200 placeholder-gray-500 outline-none resize-none min-h-[20px] max-h-28 leading-relaxed"
                style={{ fontSize: '15px' }}  /* readable on iPad without zooming */
                disabled={isSending}
              />

              {/* Send button */}
              <button
                onClick={handleSendText}
                disabled={!textInput.trim() || isSending}
                className={clsx(
                  'flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center transition-all',
                  textInput.trim() && !isSending
                    ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                    : 'bg-gray-700/50 text-gray-500 cursor-not-allowed'
                )}
                aria-label="Send message"
              >
                <Send size={14} />
              </button>
            </div>

            <p className="text-center text-[9px] font-mono text-gray-600 mt-1.5">
              NEXUS · VAULT · PULSE · LEDGER · SPARK · BLUEPRINT · OHM · CHRONO · SCOUT
            </p>
          </div>

          {/* Fade-out keyframe for continue prompt */}
          <style>{`
            @keyframes fadeOut {
              0%   { opacity: 1; }
              60%  { opacity: 1; }
              100% { opacity: 0; }
            }
          `}</style>
        </div>
      </div>
    </>
  )
}

export default NexusDrawerPanel
