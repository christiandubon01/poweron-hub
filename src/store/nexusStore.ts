// @ts-nocheck
/**
 * nexusStore.ts — Zustand store for NEXUS multi-session state (B61a)
 *
 * Tracks:
 *  - activeSessionId: the currently open nexus_sessions row UUID
 *  - sessionList: cached list of sessions for the sidebar
 *
 * Consumers:
 *  - VoiceActivationButton (message persistence, session switching)
 *  - SessionManagerSidebar (session list display)
 *  - NexusDrawerPanel (passes session props down)
 */

import { create } from 'zustand'

export interface NexusSessionRow {
  id:            string
  user_id:       string
  org_id:        string | null
  topic_name:    string
  agent:         string
  created_at:    string
  last_active:   string
  message_count: number
}

interface NexusState {
  /** UUID of the active nexus_sessions row, null before first load */
  activeSessionId: string | null
  /** Cached session list (newest first) for sidebar */
  sessionList: NexusSessionRow[]

  setActiveSessionId: (id: string | null) => void
  setSessionList: (sessions: NexusSessionRow[]) => void
  /** Update a single session's last_active + message_count in the cache */
  bumpSession: (id: string, lastActive: string, messageCount: number) => void
  /** Prepend a newly created session to the list */
  prependSession: (session: NexusSessionRow) => void
}

export const useNexusStore = create<NexusState>((set) => ({
  activeSessionId: null,
  sessionList:     [],

  setActiveSessionId: (id) => set({ activeSessionId: id }),

  setSessionList: (sessions) => set({ sessionList: sessions }),

  bumpSession: (id, lastActive, messageCount) =>
    set((state) => ({
      sessionList: state.sessionList.map((s) =>
        s.id === id ? { ...s, last_active: lastActive, message_count: messageCount } : s
      ),
    })),

  prependSession: (session) =>
    set((state) => ({ sessionList: [session, ...state.sessionList] })),
}))
