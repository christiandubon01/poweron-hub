// @ts-nocheck
/**
 * SessionManagerSidebar — B61a: Multi-session manager for NEXUS voice+text chat.
 *
 * Layout:
 *  - Scrollable list of nexus_sessions, newest first
 *  - Each card shows: topic_name, last_active (relative), message_count, agent badge
 *  - "+ New Session" button at the top
 *  - Active session gets a highlighted green border
 *  - Tapping a session calls onSelectSession(session.id)
 *
 * Props:
 *  onSelectSession  — called when user taps a session card
 *  onNewSession     — called when user taps "+ New Session"
 *  onClose          — called to collapse the sidebar
 */

import React, { useEffect, useCallback } from 'react'
import { Plus, X, MessageSquare } from 'lucide-react'
import { useNexusStore, type NexusSessionRow } from '@/store/nexusStore'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Convert an ISO timestamp to a human-readable relative time string */
function relativeTime(isoString: string): string {
  const now = Date.now()
  const ts  = new Date(isoString).getTime()
  const diff = Math.floor((now - ts) / 1000) // seconds

  if (diff < 60)           return 'just now'
  if (diff < 3600)         return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400)        return `${Math.floor(diff / 3600)}h ago`
  if (diff < 86400 * 7)    return `${Math.floor(diff / 86400)}d ago`
  return new Date(isoString).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

/** Agent badge color map */
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

// ── Session Card ───────────────────────────────────────────────────────────────

interface SessionCardProps {
  session:   NexusSessionRow
  isActive:  boolean
  onSelect:  () => void
}

function SessionCard({ session, isActive, onSelect }: SessionCardProps) {
  const agentColor = AGENT_COLORS[session.agent ?? 'nexus'] ?? '#8b5cf6'

  return (
    <button
      onClick={onSelect}
      style={{
        width:        '100%',
        textAlign:    'left',
        padding:      '10px 12px',
        borderRadius: '10px',
        border:       `1.5px solid ${isActive ? agentColor : 'rgba(255,255,255,0.07)'}`,
        background:   isActive ? `${agentColor}14` : 'rgba(255,255,255,0.03)',
        cursor:       'pointer',
        transition:   'border-color 0.15s, background 0.15s',
        marginBottom: '6px',
        display:      'block',
      }}
    >
      {/* Topic name */}
      <div style={{
        fontSize:     '12px',
        fontWeight:   600,
        color:        isActive ? '#f9fafb' : '#d1d5db',
        marginBottom: '4px',
        overflow:     'hidden',
        textOverflow: 'ellipsis',
        whiteSpace:   'nowrap',
      }}>
        {session.topic_name || 'New Session'}
      </div>

      {/* Meta row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
        {/* Relative time */}
        <span style={{ fontSize: '10px', color: '#6b7280' }}>
          {relativeTime(session.last_active)}
        </span>

        {/* Message count */}
        <span style={{
          display:      'flex',
          alignItems:   'center',
          gap:          '2px',
          fontSize:     '10px',
          color:        '#6b7280',
        }}>
          <MessageSquare size={9} />
          {session.message_count}
        </span>

        {/* Agent badge */}
        <span style={{
          fontSize:     '9px',
          fontWeight:   700,
          letterSpacing:'0.04em',
          padding:      '1px 5px',
          borderRadius: '4px',
          background:   `${agentColor}22`,
          color:        agentColor,
          border:       `1px solid ${agentColor}44`,
          fontFamily:   'monospace',
          textTransform:'uppercase',
          marginLeft:   'auto',
        }}>
          {session.agent ?? 'nexus'}
        </span>
      </div>
    </button>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

interface SessionManagerSidebarProps {
  onSelectSession: (sessionId: string, messages: Array<{ role: 'user' | 'assistant'; content: string; agentId?: string; timestamp: number }>) => void
  onNewSession:    (session: NexusSessionRow) => void
  onClose:         () => void
}

export function SessionManagerSidebar({ onSelectSession, onNewSession, onClose }: SessionManagerSidebarProps) {
  const { user, profile } = useAuth()
  const { activeSessionId, sessionList, setSessionList, setActiveSessionId, prependSession } = useNexusStore()

  // ── Load sessions on mount ────────────────────────────────────────────────

  const loadSessions = useCallback(async () => {
    if (!user?.id) return
    try {
      const { data, error } = await supabase
        .from('nexus_sessions')
        .select('*')
        .eq('user_id', user.id)
        .order('last_active', { ascending: false })
        .limit(50)

      if (error) throw error
      setSessionList(data ?? [])
    } catch (err) {
      console.error('[SessionManagerSidebar] Failed to load sessions:', err)
    }
  }, [user?.id, setSessionList])

  useEffect(() => {
    loadSessions()
  }, [loadSessions])

  // ── Create new session ────────────────────────────────────────────────────

  const handleNewSession = useCallback(async () => {
    if (!user?.id) return
    try {
      const { data, error } = await supabase
        .from('nexus_sessions')
        .insert({
          user_id:    user.id,
          org_id:     profile?.org_id ?? null,
          topic_name: 'New Session',
          agent:      'nexus',
        })
        .select()
        .single()

      if (error) throw error
      if (data) {
        prependSession(data)
        setActiveSessionId(data.id)
        onNewSession(data)
      }
    } catch (err) {
      console.error('[SessionManagerSidebar] Failed to create session:', err)
    }
  }, [user?.id, profile?.org_id, prependSession, setActiveSessionId, onNewSession])

  // ── Select session: load last 6 messages ─────────────────────────────────

  const handleSelectSession = useCallback(async (sessionId: string) => {
    setActiveSessionId(sessionId)
    try {
      const { data, error } = await supabase
        .from('nexus_messages')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: false })
        .limit(6)

      if (error) throw error

      // Reverse so oldest is first
      const msgs = (data ?? []).reverse().map((m) => ({
        role:      m.role as 'user' | 'assistant',
        content:   m.content,
        agentId:   m.agent ?? 'nexus',
        timestamp: new Date(m.created_at).getTime(),
      }))

      onSelectSession(sessionId, msgs)
    } catch (err) {
      console.error('[SessionManagerSidebar] Failed to load session messages:', err)
      onSelectSession(sessionId, [])
    }
  }, [setActiveSessionId, onSelectSession])

  return (
    <div style={{
      width:          '200px',
      minWidth:       '200px',
      height:         '100%',
      display:        'flex',
      flexDirection:  'column',
      borderRight:    '1px solid rgba(255,255,255,0.07)',
      background:     'rgba(10,12,18,0.95)',
      overflow:       'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding:        '12px 12px 8px',
        borderBottom:   '1px solid rgba(255,255,255,0.07)',
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        flexShrink:     0,
      }}>
        <span style={{
          fontSize:      '10px',
          fontWeight:    700,
          color:         '#9ca3af',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          fontFamily:    'monospace',
        }}>
          Sessions
        </span>
        <button
          onClick={onClose}
          style={{
            background:   'none',
            border:       'none',
            cursor:       'pointer',
            color:        '#6b7280',
            padding:      '2px',
            borderRadius: '4px',
            display:      'flex',
          }}
          title="Close session panel"
        >
          <X size={13} />
        </button>
      </div>

      {/* New Session button */}
      <div style={{ padding: '8px 10px 4px', flexShrink: 0 }}>
        <button
          onClick={handleNewSession}
          style={{
            width:        '100%',
            display:      'flex',
            alignItems:   'center',
            justifyContent: 'center',
            gap:          '5px',
            padding:      '7px 10px',
            borderRadius: '8px',
            background:   'rgba(34,197,94,0.12)',
            border:       '1px solid rgba(34,197,94,0.3)',
            color:        '#22c55e',
            fontSize:     '11px',
            fontWeight:   600,
            cursor:       'pointer',
            transition:   'background 0.15s',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(34,197,94,0.2)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(34,197,94,0.12)' }}
        >
          <Plus size={12} />
          New Session
        </button>
      </div>

      {/* Session list */}
      <div style={{
        flex:       1,
        overflowY:  'auto',
        padding:    '6px 10px 10px',
        scrollbarWidth: 'thin',
        scrollbarColor: 'rgba(255,255,255,0.1) transparent',
      }}>
        {sessionList.length === 0 ? (
          <div style={{
            textAlign:  'center',
            color:      '#4b5563',
            fontSize:   '11px',
            marginTop:  '20px',
            padding:    '0 8px',
            lineHeight: 1.5,
          }}>
            No sessions yet. Start a conversation!
          </div>
        ) : (
          sessionList.map((session) => (
            <SessionCard
              key       = {session.id}
              session   = {session}
              isActive  = {session.id === activeSessionId}
              onSelect  = {() => handleSelectSession(session.id)}
            />
          ))
        )}
      </div>
    </div>
  )
}
