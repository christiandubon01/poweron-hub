/**
 * src/store/modeContext.ts — Agent Mode global context.
 *
 * Exposes selectedMode + setSelectedMode via React context.
 * Persists the selection to localStorage under 'poweron_agent_mode'.
 * Default mode: 'standard'.
 */

import React, { createContext, useContext, useState } from 'react'
import type { AgentMode } from '@/types/index'

// ── Context shape ─────────────────────────────────────────────────────────────

interface ModeContextValue {
  selectedMode: AgentMode
  setSelectedMode: (mode: AgentMode) => void
}

const VALID_MODES: AgentMode[] = ['standard', 'field', 'office', 'estimating', 'executive']
const LS_KEY = 'poweron_agent_mode'
const DEFAULT_MODE: AgentMode = 'standard'

// ── Context ───────────────────────────────────────────────────────────────────

export const ModeContext = createContext<ModeContextValue>({
  selectedMode: DEFAULT_MODE,
  setSelectedMode: () => {},
})

// ── Provider ──────────────────────────────────────────────────────────────────

export function ModeProvider({ children }: { children: React.ReactNode }) {
  const [selectedMode, setSelectedModeState] = useState<AgentMode>(() => {
    try {
      const stored = localStorage.getItem(LS_KEY)
      if (stored && VALID_MODES.includes(stored as AgentMode)) {
        return stored as AgentMode
      }
    } catch {
      // localStorage unavailable (e.g. SSR or private browsing restrictions)
    }
    return DEFAULT_MODE
  })

  function setSelectedMode(mode: AgentMode) {
    setSelectedModeState(mode)
    try {
      localStorage.setItem(LS_KEY, mode)
    } catch {
      // ignore write failures
    }
  }

  return React.createElement(
    ModeContext.Provider,
    { value: { selectedMode, setSelectedMode } },
    children,
  )
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useMode(): ModeContextValue {
  return useContext(ModeContext)
}
