// @ts-nocheck
/**
 * uiStore.ts — Global UI state (Zustand)
 *
 * B62: orbLabActive flag — true when ORB LAB is mounted.
 * NAV1: pinnedInsightsOpen / winsLogOpen — independent toggle state for each panel.
 *       Each has its own open/close button. State persists within session.
 *       Both can be open simultaneously without overlap (side-by-side on wide screens).
 */

import { create } from 'zustand'

interface UIState {
  /** True while ORB LAB view is mounted — hides floating NEXUS mic */
  orbLabActive: boolean
  setOrbLabActive: (active: boolean) => void

  /** NAV1 — Pinned Insights panel open state (independent toggle) */
  pinnedInsightsOpen: boolean
  setPinnedInsightsOpen: (open: boolean) => void
  togglePinnedInsights: () => void

  /** NAV1 — Wins Log panel open state (independent toggle) */
  winsLogOpen: boolean
  setWinsLogOpen: (open: boolean) => void
  toggleWinsLog: () => void
}

export const useUIStore = create<UIState>((set) => ({
  orbLabActive: false,
  setOrbLabActive: (active: boolean) => set({ orbLabActive: active }),

  pinnedInsightsOpen: false,
  setPinnedInsightsOpen: (open: boolean) => set({ pinnedInsightsOpen: open }),
  togglePinnedInsights: () => set((state) => ({ pinnedInsightsOpen: !state.pinnedInsightsOpen })),

  winsLogOpen: false,
  setWinsLogOpen: (open: boolean) => set({ winsLogOpen: open }),
  toggleWinsLog: () => set((state) => ({ winsLogOpen: !state.winsLogOpen })),
}))
