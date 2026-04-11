// @ts-nocheck
/**
 * nexusStore.ts — Zustand store for NEXUS multi-session state
 *
 * NAV1 additions:
 *  - nexusMode: 'electrical' | 'admin' — persists selected NEXUS mode
 *  - nexusContextMode: AdminContextMode — persists selected sub-tab
 *  - voiceSessionActive: boolean — true while voice session is running
 *  - voiceSessionMuted: boolean — true when muted
 *  - orbPanelCollapsed: boolean — ORB panel collapse state
 *  - transcriptPanelCollapsed: boolean — Transcript panel collapse state
 *  - transcriptLines: string[] — live transcript lines
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

export type NexusMode = 'electrical' | 'admin'
export type NexusContextMode = 'combined' | 'electrical' | 'software' | 'rmo'

interface NexusState {
  /** UUID of the active nexus_sessions row, null before first load */
  activeSessionId: string | null
  /** Cached session list (newest first) for sidebar */
  sessionList: NexusSessionRow[]

  /** NAV1 — NEXUS mode: 'electrical' | 'admin'. Persists until explicitly changed. */
  nexusMode: NexusMode
  /** NAV1 — NEXUS admin context sub-tab */
  nexusContextMode: NexusContextMode
  /** NAV1 — voice session state */
  voiceSessionActive: boolean
  voiceSessionMuted: boolean
  /** NAV1 — ORB panel collapsed state */
  orbPanelCollapsed: boolean
  /** NAV1 — Transcript panel collapsed state */
  transcriptPanelCollapsed: boolean
  /** NAV1 — live transcript lines */
  transcriptLines: string[]

  setActiveSessionId: (id: string | null) => void
  setSessionList: (sessions: NexusSessionRow[]) => void
  bumpSession: (id: string, lastActive: string, messageCount: number) => void
  prependSession: (session: NexusSessionRow) => void
  updateSessionTopicName: (id: string, topicName: string) => void

  /** NAV1 — NEXUS mode setters */
  setNexusMode: (mode: NexusMode) => void
  setNexusContextMode: (mode: NexusContextMode) => void
  setVoiceSessionActive: (active: boolean) => void
  setVoiceSessionMuted: (muted: boolean) => void
  setOrbPanelCollapsed: (collapsed: boolean) => void
  setTranscriptPanelCollapsed: (collapsed: boolean) => void
  appendTranscriptLine: (line: string) => void
  clearTranscript: () => void
}

export const useNexusStore = create<NexusState>((set) => ({
  activeSessionId: null,
  sessionList:     [],

  nexusMode:                'electrical',
  nexusContextMode:         'combined',
  voiceSessionActive:       false,
  voiceSessionMuted:        false,
  orbPanelCollapsed:        false,
  transcriptPanelCollapsed: false,
  transcriptLines:          [],

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

  updateSessionTopicName: (id, topicName) =>
    set((state) => ({
      sessionList: state.sessionList.map((s) =>
        s.id === id ? { ...s, topic_name: topicName } : s
      ),
    })),

  setNexusMode: (mode) => set({ nexusMode: mode }),
  setNexusContextMode: (mode) => set({ nexusContextMode: mode }),
  setVoiceSessionActive: (active) => set({ voiceSessionActive: active }),
  setVoiceSessionMuted: (muted) => set({ voiceSessionMuted: muted }),
  setOrbPanelCollapsed: (collapsed) => set({ orbPanelCollapsed: collapsed }),
  setTranscriptPanelCollapsed: (collapsed) => set({ transcriptPanelCollapsed: collapsed }),
  appendTranscriptLine: (line) =>
    set((state) => ({ transcriptLines: [...state.transcriptLines, line] })),
  clearTranscript: () => set({ transcriptLines: [] }),
}))
