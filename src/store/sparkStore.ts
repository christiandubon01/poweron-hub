// @ts-nocheck
/**
 * sparkStore.ts — Zustand store for SPARK Live Call engine state
 *
 * Tracks:
 *  - mode: LISTENING, ANALYZING, DEBRIEFING, IDLE
 *  - transcript: rolling transcript buffer (last 5 minutes)
 *  - analysisResults: array of Claude analysis chunks
 *  - currentFlags: active red flags from latest analysis
 *  - sessionHistory: completed sessions with contact names + timestamps
 *
 * Consumers:
 *  - SparkEngine (state mutations during call lifecycle)
 *  - SparkLiveCall.tsx (UI rendering)
 *  - Agent bus (session events)
 */

import { create } from 'zustand'

export type SparkMode = 'LISTENING' | 'ANALYZING' | 'DEBRIEFING' | 'IDLE'

export interface SparkAnalysisResult {
  timestamp: string
  chunkIndex: number
  commitments: string[]
  amounts: number[]
  timelines: string[]
  flags: string[]
  opportunities: string[]
}

export interface SparkSessionRecord {
  id: string
  contactName: string | null
  startTime: string
  endTime: string | null
  transcript: string
  analysisResults: SparkAnalysisResult[]
  finalFlags: string[]
}

interface SparkState {
  /** Current mode: LISTENING, ANALYZING, DEBRIEFING, IDLE */
  mode: SparkMode

  /** Rolling transcript buffer (last 5 minutes of text) */
  transcript: string

  /** Array of analysis chunks from Claude */
  analysisResults: SparkAnalysisResult[]

  /** Current active red flags */
  currentFlags: string[]

  /** Completed sessions (persisted to localStorage) */
  sessionHistory: SparkSessionRecord[]

  /** Actions */
  setMode: (mode: SparkMode) => void
  appendTranscript: (text: string) => void
  trimTranscript: (maxMs: number) => void
  addAnalysisResult: (result: SparkAnalysisResult) => void
  setCurrentFlags: (flags: string[]) => void
  clearSession: () => void
  saveSession: (session: SparkSessionRecord) => void
  loadSessionHistory: (sessions: SparkSessionRecord[]) => void
}

export const useSparkStore = create<SparkState>((set) => ({
  mode: 'IDLE',
  transcript: '',
  analysisResults: [],
  currentFlags: [],
  sessionHistory: [],

  setMode: (mode) => set({ mode }),

  appendTranscript: (text) =>
    set((state) => ({
      transcript: state.transcript + ' ' + text,
    })),

  trimTranscript: (maxMs) =>
    set((state) => {
      // Simple implementation: if transcript exceeds reasonable length for 5 min @ 150wpm,
      // trim from the beginning. 5 min * 150 words/min ≈ 750 words ≈ 4000 chars
      const maxChars = 4000
      if (state.transcript.length > maxChars) {
        return {
          transcript: state.transcript.slice(-maxChars),
        }
      }
      return state
    }),

  addAnalysisResult: (result) =>
    set((state) => ({
      analysisResults: [...state.analysisResults, result],
    })),

  setCurrentFlags: (flags) => set({ currentFlags: flags }),

  clearSession: () =>
    set({
      mode: 'IDLE',
      transcript: '',
      analysisResults: [],
      currentFlags: [],
    }),

  saveSession: (session) =>
    set((state) => ({
      sessionHistory: [...state.sessionHistory, session],
    })),

  loadSessionHistory: (sessions) => set({ sessionHistory: sessions }),
}))
