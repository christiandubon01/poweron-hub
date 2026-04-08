// @ts-nocheck
/**
 * uiStore.ts — Global UI state (Zustand)
 *
 * B62: orbLabActive flag — true when ORB LAB is mounted.
 * Used by AppShell to hide the floating NEXUS mic while ORB LAB is open
 * so the inline mic button in the bottom bar is the only voice entry point.
 */

import { create } from 'zustand'

interface UIState {
  /** True while ORB LAB view is mounted — hides floating NEXUS mic */
  orbLabActive: boolean
  setOrbLabActive: (active: boolean) => void
}

export const useUIStore = create<UIState>((set) => ({
  orbLabActive: false,
  setOrbLabActive: (active: boolean) => set({ orbLabActive: active }),
}))
