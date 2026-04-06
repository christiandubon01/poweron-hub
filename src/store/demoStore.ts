// @ts-nocheck
/**
 * demoStore.ts — Demo Mode state (Zustand) + React context bridge.
 *
 * E3 | Demo Mode: added DemoContext + DemoProvider for tree-wide injection.
 * B5 | Demo Mode Industry Selector: added multi-industry switching with
 *      template-driven company name, price book, phases, label overrides,
 *      and NEXUS personality.
 *
 * Responsibilities:
 *   - Holds a single boolean: isDemoMode
 *   - Holds the active demo industry: currentIndustry (default 'electrical')
 *   - Persists to localStorage key 'poweron-demo-mode'
 *     (separate from all real data keys — never conflicts with authStore
 *      or the main data key 'poweron_backup_data')
 *   - Persists selected industry to localStorage key 'poweron_demo_industry'
 *   - NEVER writes to Supabase
 *   - NEVER modifies real data localStorage keys
 *
 * Usage:
 *   const { isDemoMode, toggleDemoMode, enableDemoMode, disableDemoMode } = useDemoStore()
 *   const { currentIndustry, setIndustry, getDemoCompanyName, getDemoData } = useDemoStore()
 *
 * Hook:
 *   useDemoMode() → shortcut returning all demo state
 */

import { create } from 'zustand'
import React, { createContext, useContext, useEffect } from 'react'
import { getTemplate } from '@/config/templates/index'

// ── Storage keys ─────────────────────────────────────────────────────────────
const DEMO_MODE_KEY = 'poweron-demo-mode'
const DEMO_INDUSTRY_KEY = 'poweron_demo_industry'

// ── Industry display name map ─────────────────────────────────────────────────
export const INDUSTRY_LABELS: Record<string, string> = {
  'electrical': 'Electrical',
  'plumbing': 'Plumbing',
  'gc': 'General Contractor',
  'medical-billing': 'Medical Billing',
  'mechanic': 'Mechanic',
  'electrical-supplier': 'Electrical Supplier',
}

// ── Load persisted values ─────────────────────────────────────────────────────
function loadPersistedDemoMode(): boolean {
  try {
    return localStorage.getItem(DEMO_MODE_KEY) === 'true'
  } catch {
    return false
  }
}

function loadPersistedDemoIndustry(): string {
  try {
    return localStorage.getItem(DEMO_INDUSTRY_KEY) || 'electrical'
  } catch {
    return 'electrical'
  }
}

// ── State shape ──────────────────────────────────────────────────────────────

interface DemoState {
  isDemoMode: boolean

  /**
   * True once the store has confirmed its persisted value has been loaded.
   * Panels must check `hasHydrated` before trusting `isDemoMode` so they
   * don't render real data on the first paint when demo mode is active.
   */
  hasHydrated: boolean

  /** Currently active demo industry slug (e.g. 'electrical', 'plumbing') */
  currentIndustry: string

  /** Toggle demo mode on/off */
  toggleDemoMode: () => void

  /** Enable demo mode */
  enableDemoMode: () => void

  /** Disable demo mode */
  disableDemoMode: () => void

  /** Called once by AppShell after mount to signal hydration is complete */
  setHasHydrated: () => void

  /** Set active demo industry; persists to localStorage and updates URL if demo is active */
  setIndustry: (industry: string) => void

  /** Returns the demo company name from the active industry template */
  getDemoCompanyName: () => string

  /** Returns template data by type: 'priceBook' | 'phases' | 'labels' | 'nexusPersonality' */
  getDemoData: (dataType: string) => unknown
}

// ── Store ────────────────────────────────────────────────────────────────────

export const useDemoStore = create<DemoState>((set, get) => ({
  isDemoMode: loadPersistedDemoMode(),
  currentIndustry: loadPersistedDemoIndustry(),

  // Starts false; AppShell sets it to true in its first useEffect so panels
  // know hydration is complete before checking isDemoMode.
  hasHydrated: false,

  setHasHydrated: () => set({ hasHydrated: true }),

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
    // Remove ?demo=true and ?industry from URL without a page reload
    try {
      const url = new URL(window.location.href)
      if (url.searchParams.has('demo')) {
        url.searchParams.delete('demo')
        url.searchParams.delete('industry')
        window.history.replaceState({}, '', url.toString())
      }
    } catch { /* ignore */ }
    try { window.dispatchEvent(new CustomEvent('poweron:demo-mode-changed', { detail: { isDemoMode: false } })) } catch { /* ignore */ }
  },

  setIndustry: (industry: string) => {
    try { localStorage.setItem(DEMO_INDUSTRY_KEY, industry) } catch { /* ignore */ }
    set({ currentIndustry: industry })
    // Update URL if demo is currently active
    try {
      if (get().isDemoMode) {
        const url = new URL(window.location.href)
        url.searchParams.set('industry', industry)
        window.history.replaceState({}, '', url.toString())
      }
    } catch { /* ignore */ }
  },

  getDemoCompanyName: () => {
    const { currentIndustry } = get()
    if (!currentIndustry || currentIndustry === 'electrical') return 'Pacific Coast Electric LLC'
    try {
      const template = getTemplate(currentIndustry)
      return template?.demoCompanyName ?? 'Demo Company LLC'
    } catch {
      return 'Demo Company LLC'
    }
  },

  getDemoData: (dataType: string) => {
    const { currentIndustry } = get()
    try {
      const template = getTemplate(currentIndustry)
      if (!template) return null
      switch (dataType) {
        case 'priceBook': return template.priceBookItems
        case 'phases': return template.projectPhases
        case 'labels': return template.labelOverrides
        case 'nexusPersonality': return (template as any).nexusPersonality ?? null
        default: return null
      }
    } catch {
      return null
    }
  },
}))

// ── Convenience hook ─────────────────────────────────────────────────────────

export function useDemoMode() {
  const {
    isDemoMode, hasHydrated, toggleDemoMode, enableDemoMode, disableDemoMode,
    currentIndustry, setIndustry, getDemoCompanyName, getDemoData,
  } = useDemoStore()
  return {
    isDemoMode, hasHydrated, toggleDemoMode, enableDemoMode, disableDemoMode,
    currentIndustry, setIndustry, getDemoCompanyName, getDemoData,
  }
}

// ── React Context bridge (E3 | Demo Mode) ────────────────────────────────────
// Allows consuming components to read demo state via useContext(DemoContext)
// in addition to the existing useDemoStore() Zustand hook.

export const DemoContext = createContext<DemoState | null>(null)

/**
 * DemoProvider — wraps the app to expose demo mode state via React context.
 * Also checks ?demo=true and ?industry=<slug> on mount and auto-enables
 * demo mode / sets industry if present.
 * Pair with DemoContext for consumption or continue using useDemoStore().
 */
export function DemoProvider({ children }: { children: React.ReactNode }) {
  const store = useDemoStore()

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    // Auto-enable from URL param (backup in case DemoGate hasn't handled it yet)
    if (params.get('demo') === 'true') {
      store.enableDemoMode()
    }
    // Auto-set industry from URL param
    const industryParam = params.get('industry')
    if (industryParam && industryParam in INDUSTRY_LABELS) {
      store.setIndustry(industryParam)
    }
  }, [])

  return React.createElement(DemoContext.Provider, { value: store }, children)
}

/** Hook to consume DemoContext (alternative to useDemoStore) */
export function useDemoContext(): DemoState {
  const ctx = useContext(DemoContext)
  if (!ctx) {
    // Fall back to direct store access if used outside DemoProvider
    return useDemoStore.getState()
  }
  return ctx
}
