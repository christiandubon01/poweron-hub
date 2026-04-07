// @ts-nocheck
/**
 * AIVisualSuite — index.tsx
 * B48 — NEXUS Visual Suite Full Deploy
 *
 * Exports all B48 suite components and mode data.
 * localStorage keys:
 *   nexus_viz_mode  — selected visual index (default 0)
 *   nexus_mtz       — MTZ level 0-100 (default 0)
 *   nexus_viz_hue   — hue 0-100 (default 155)
 *   nexus_viz_speed — speed 0-100 (default 45)
 *   nexus_viz_int   — intensity 0-100 (default 75)
 */

// ─── B48 Suite ────────────────────────────────────────────────────────────────
export { default as VisualSuitePanel }  from './VisualSuitePanel'
export { default as VisualInfoPopup }   from './VisualInfoPopup'
export { default as VisualCarReel }     from './VisualCarReel'

// Mode descriptions (43 modes, ids 0-42)
export { MODE_DESCRIPTIONS }            from './modeDescriptions'
export type { ModeDesc }                from './modeDescriptions'

// Draw function registries
export { B1_DRAWS }                     from './modes/bucket1'
export { B2_DRAWS }                     from './modes/bucket2'
export { B3_DRAWS }                     from './modes/bucket3'
export type { DrawFn }                  from './modes/bucket1'

// ─── Legacy B46 exports (kept for backward compat) ───────────────────────────
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
export { useVisualEngine }               from './useVisualEngine'
export type { VisualEngineProps }        from './useVisualEngine'
export { VISUAL_INFO }                   from './VisualInfoPopup'
export type { VisualInfo }               from './VisualInfoPopup'

// ─── Visual registry ──────────────────────────────────────────────────────────
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

// ─── Legacy VisualRenderer ────────────────────────────────────────────────────
import React from 'react'
import type { VisualEngineProps } from './useVisualEngine'

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

interface VisualRendererProps extends VisualEngineProps {
  mode?: number
  className?: string
  style?: React.CSSProperties
}

const VISUAL_COMPONENTS = [
  QuantumFoam, StrangeAttractor, HyperbolicSpace, CellularAutomata, FieldLines,
  ReactionDiffusion, FlowField, FourierEpicycles, MandelbrotDepth, TopologyMorph,
]

export function VisualRenderer({ mode = 0, bass = 0, mid = 0, high = 0, mtz = 0, hue = 160, className = '', style }: VisualRendererProps) {
  const idx = Math.max(0, Math.min(VISUAL_COMPONENTS.length - 1, mode))
  const Visual = VISUAL_COMPONENTS[idx]
  return <Visual bass={bass} mid={mid} high={high} mtz={mtz} hue={hue} className={className} style={style} />
}
