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
import { ChevronRight, Mic, MicOff, Loader2, Send, Volume2 } from 'lucide-react'
import { clsx } from 'clsx'
import { NexusThreeOrb } from './NexusThreeOrb'
import type { OrbState } from './NexusPresenceOrb'
import type { VoiceSessionStatus } from '@/services/voice'

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
  isOpen:          boolean
  drawerExpanded:  boolean
  onToggleDrawer:  () => void
  orbState:        OrbState
  voiceStatus:     VoiceSessionStatus
  onMicPress:      () => void
  messages:        DrawerMessage[]
  onSendText:      (text: string) => Promise<void>
  isSending:       boolean
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

function MessageBubble({ msg }: { msg: DrawerMessage }) {
  const isUser = msg.role === 'user'
  const agentColor = msg.agentId ? AGENT_COLORS[msg.agentId] ?? '#8b5cf6' : '#8b5cf6'

  return (
    <div
      className={clsx(
        'flex gap-2 animate-fade-in',
        isUser ? 'flex-row-reverse' : 'flex-row'
      )}
    >
      {/* Avatar */}
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

        {/* Original voice transcript (gray, smaller) */}
        {msg.isVoice && msg.originalContent && msg.originalContent !== msg.content && (
          <p className="text-[11px] text-gray-400 mt-1.5 leading-relaxed whitespace-pre-wrap break-words m-0 border-t border-white/10 pt-1.5">
            <span className="text-[9px] uppercase tracking-wider text-gray-500 font-semibold">original: </span>
            {msg.originalContent}
          </p>
        )}

        {/* Timestamp */}
        <p
          className={clsx(
            'text-[9px] font-mono mt-1 m-0',
            isUser ? 'text-emerald-200/70 text-right' : 'text-gray-500'
          )}
        >
          {formatTime(msg.timestamp)}
          {msg.isVoice && ' 🎙'}
        </p>
      </div>
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
        <NexusThreeOrb state={orbState} />
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
}: NexusDrawerPanelProps) {
  const [textInput, setTextInput] = useState('')
  const messagesEndRef  = useRef<HTMLDivElement>(null)
  const textareaRef     = useRef<HTMLTextAreaElement>(null)
  const scrollContRef   = useRef<HTMLDivElement>(null)

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

          {/* Orb — fills the left half */}
          <div
            className="w-full flex-1"
            style={{ maxHeight: '100%', minHeight: 0 }}
          >
            <NexusThreeOrb state={orbState} />
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
          </div>

          {/* Messages — full height, scrollable */}
          <div
            ref={scrollContRef}
            className="flex-1 overflow-y-auto px-3 py-4 space-y-4 min-h-0"
            style={{ overscrollBehavior: 'contain' }}
          >
            {messages.length === 0 && (
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
            className="flex-shrink-0 px-3 pb-4 pt-2"
            style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
          >
            {/* Speaking state — stop button */}
            {isSpeaking && (
              <div className="flex items-center justify-center mb-2">
                <button
                  onClick={onMicPress}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-cyan-500/15 border border-cyan-500/30 text-cyan-400 text-xs font-semibold hover:bg-cyan-500/25 transition-colors"
                >
                  <Volume2 size={14} />
                  Speaking… (tap to stop)
                </button>
              </div>
            )}

            <div
              className="flex items-end gap-2 rounded-xl px-3 py-2"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.09)',
              }}
            >
              {/* Mic button */}
              <button
                onClick={onMicPress}
                disabled={isProcessing}
                className={clsx(
                  'flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center transition-all',
                  'focus:outline-none',
                  isRecording && 'bg-red-600/80 text-white scale-105',
                  isSpeaking  && 'bg-cyan-600/80 text-white',
                  isProcessing && 'bg-gray-700 text-gray-500 cursor-wait',
                  !isRecording && !isSpeaking && !isProcessing && 'bg-emerald-600/70 text-white hover:bg-emerald-600',
                )}
                aria-label={isRecording ? 'Stop recording' : 'Start recording'}
                title={isRecording ? 'Stop recording' : 'Press to speak'}
              >
                {isProcessing ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : isRecording ? (
                  <MicOff size={16} />
                ) : isSpeaking ? (
                  <Volume2 size={16} />
                ) : (
                  <Mic size={16} />
                )}
              </button>

              {/* Text input */}
              <textarea
                ref={textareaRef}
                value={textInput}
                onChange={e => setTextInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask NEXUS anything…"
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
        </div>
      </div>
    </>
  )
}

export default NexusDrawerPanel
