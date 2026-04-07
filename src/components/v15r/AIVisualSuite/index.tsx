// @ts-nocheck
/**
 * AIVisualSuite — index.tsx
 * B46 — AI Visual Suite
 *
 * Exports all 10 visualizer components and the shared engine.
 * localStorage keys:
 *   nexus_viz_mode  — selected visual index (default 0 = QuantumFoam)
 *   nexus_mtz       — MTZ level 0-1 (default 0)
 */

export { default as QuantumFoam }        from './QuantumFoam'
export { default as StrangeAttractor }   from './StrangeAttractor'
export { default as HyperbolicSpace }    from './HyperbolicSpace'
export { default as CellularAutomata }   from './CellularAutomata'
export { default as FieldLines }         from './FieldLines'
export { default as ReactionDiffusion }  from './ReactionDiffusion'
export { default as FlowField }          from './FlowField'
export { default as FourierEpicycles }   from './FourierEpicycles'
export { default as MandelbrotDepth }    from './MandelbrotDepth'
export { default as TopologyMorph }      from './TopologyMorph'
export { default as VisualInfoPopup }    from './VisualInfoPopup'
export { useVisualEngine }               from './useVisualEngine'
export type { VisualEngineProps }        from './useVisualEngine'
export { VISUAL_INFO }                   from './VisualInfoPopup'
export type { VisualInfo }               from './VisualInfoPopup'

// ─── Visual registry (for selector UI) ───────────────────────────────────────
export const VISUAL_NAMES = [
  'Quantum Foam',
  'Strange Attractor',
  'Hyperbolic Space',
  'Cellular Automata',
  'Field Lines',
  'Reaction Diffusion',
  'Flow Field',
  'Fourier Epicycles',
  'Mandelbrot Depth',
  'Topology Morph',
]

// ─── localStorage helpers ─────────────────────────────────────────────────────
const VIZ_MODE_KEY = 'nexus_viz_mode'
const MTZ_KEY      = 'nexus_mtz'

export function getVizMode(): number {
  try { return parseInt(localStorage.getItem(VIZ_MODE_KEY) ?? '0', 10) || 0 } catch { return 0 }
}
export function setVizMode(mode: number): void {
  try { localStorage.setItem(VIZ_MODE_KEY, String(mode)) } catch {}
}

export function getMTZLevel(): number {
  try { return parseFloat(localStorage.getItem(MTZ_KEY) ?? '0') || 0 } catch { return 0 }
}
export function setMTZLevel(level: number): void {
  try { localStorage.setItem(MTZ_KEY, String(Math.max(0, Math.min(1, level)))) } catch {}
}

// ─── Dynamic visual renderer ──────────────────────────────────────────────────
import React, { lazy, Suspense } from 'react'
import type { VisualEngineProps } from './useVisualEngine'

interface VisualRendererProps extends VisualEngineProps {
  mode?: number
  className?: string
  style?: React.CSSProperties
}

// Inline all visuals (already lazy at module level via parent route chunk)
import QuantumFoam        from './QuantumFoam'
import StrangeAttractor   from './StrangeAttractor'
import HyperbolicSpace    from './HyperbolicSpace'
import CellularAutomata   from './CellularAutomata'
import FieldLines         from './FieldLines'
import ReactionDiffusion  from './ReactionDiffusion'
import FlowField          from './FlowField'
import FourierEpicycles   from './FourierEpicycles'
import MandelbrotDepth    from './MandelbrotDepth'
import TopologyMorph      from './TopologyMorph'

const VISUAL_COMPONENTS = [
  QuantumFoam,
  StrangeAttractor,
  HyperbolicSpace,
  CellularAutomata,
  FieldLines,
  ReactionDiffusion,
  FlowField,
  FourierEpicycles,
  MandelbrotDepth,
  TopologyMorph,
]

/**
 * VisualRenderer — renders whichever visual is selected by `mode` index.
 * Drop-in replacement for any canvas-based orb visual.
 */
export function VisualRenderer({ mode = 0, bass = 0, mid = 0, high = 0, mtz = 0, hue = 160, className = '', style }: VisualRendererProps) {
  const idx = Math.max(0, Math.min(VISUAL_COMPONENTS.length - 1, mode))
  const Visual = VISUAL_COMPONENTS[idx]
  return <Visual bass={bass} mid={mid} high={high} mtz={mtz} hue={hue} className={className} style={style} />
}
