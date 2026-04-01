// @ts-nocheck
/**
 * demoStore.ts — Demo Mode state (Zustand).
 *
 * Responsibilities:
 *   - Holds a single boolean: isDemoMode
 *   - Persists to localStorage key 'poweron-demo-mode'
 *     (separate from all real data keys — never conflicts with authStore
 *      or the main data key 'poweron_backup_data')
 *   - NEVER writes to Supabase
 *   - NEVER modifies real data localStorage keys
 *
 * Usage:
 *   const { isDemoMode, toggleDemoMode, enableDemoMode, disableDemoMode } = useDemoStore()
 *
 * Hook:
 *   useDemoMode() → shortcut returning { isDemoMode, toggleDemoMode }
 */

import { create } from 'zustand'

// ── Storage key — unique, no conflict with auth or data stores ───────────────
const DEMO_MODE_KEY = 'poweron-demo-mode'

// ── Load persisted value ─────────────────────────────────────────────────────
function loadPersistedDemoMode(): boolean {
  try {
    return localStorage.getItem(DEMO_MODE_KEY) === 'true'
  } catch {
    return false
  }
}

// ── State shape ──────────────────────────────────────────────────────────────

interface DemoState {
  isDemoMode: boolean

  /** Toggle demo mode on/off */
  toggleDemoMode: () => void

  /** Enable demo mode */
  enableDemoMode: () => void

  /** Disable demo mode */
  disableDemoMode: () => void
}

// ── Store ────────────────────────────────────────────────────────────────────

export const useDemoStore = create<DemoState>((set, get) => ({
  isDemoMode: loadPersistedDemoMode(),

  toggleDemoMode: () => {
    const next = !get().isDemoMode
    try { localStorage.setItem(DEMO_MODE_KEY, String(next)) } catch { /* ignore */ }
    set({ isDemoMode: next })
    // Dispatch event so non-hook consumers (legacy panel patterns) can react
    try { window.dispatchEvent(new CustomEvent('poweron:demo-mode-changed', { detail: { isDemoMode: next } })) } catch { /* ignore */ }
  },

  enableDemoMode: () => {
    try { localStorage.setItem(DEMO_MODE_KEY, 'true') } catch { /* ignore */ }
    set({ isDemoMode: true })
    try { window.dispatchEvent(new CustomEvent('poweron:demo-mode-changed', { detail: { isDemoMode: true } })) } catch { /* ignore */ }
  },

  disableDemoMode: () => {
    try { localStorage.setItem(DEMO_MODE_KEY, 'false') } catch { /* ignore */ }
    set({ isDemoMode: false })
    try { window.dispatchEvent(new CustomEvent('poweron:demo-mode-changed', { detail: { isDemoMode: false } })) } catch { /* ignore */ }
  },
}))

// ── Convenience hook ─────────────────────────────────────────────────────────

export function useDemoMode() {
  const { isDemoMode, toggleDemoMode, enableDemoMode, disableDemoMode } = useDemoStore()
  return { isDemoMode, toggleDemoMode, enableDemoMode, disableDemoMode }
}
