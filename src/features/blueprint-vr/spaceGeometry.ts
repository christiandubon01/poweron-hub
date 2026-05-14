/**
 * src/features/blueprint-vr/spaceGeometry.ts
 *
 * Converts a BuildingSpace (or fallback) into isometric SVG geometry data.
 * Pure TypeScript — no React, no DOM, no external dependencies.
 *
 * Coordinate system:
 *   World: X+ = right/east, Z+ = forward/south (into screen), Y+ = up
 *   Viewer: top-northeast, looking at building center
 *   Isometric projection:
 *     screen_x = (world_x - world_z) * ISO_X + CX
 *     screen_y = (world_x + world_z) * ISO_Y - world_y * ISO_H + CY
 */

import type { BuildingSpace } from './dimensionModel'
import type { VRStage } from './types'

// ─── Viewport & Projection Constants ─────────────────────────────────────────

export const GEO_VW = 600
export const GEO_VH = 490

const SCALE  = 8                               // px per foot (floor plane)
const ISO_X  = SCALE * Math.cos(Math.PI / 6)  // ≈ 6.928 px/ft
const ISO_Y  = SCALE * Math.sin(Math.PI / 6)  // ≈ 4.000 px/ft
const ISO_H  = 14                              // px per foot of wall height (exaggerated)

// Default building spec (fallback)
const DEF_W     = 40   // ft width
const DEF_D     = 30   // ft depth
const DEF_H     = 9    // ft wall height
const DEF_CEIL  = 8    // ft ceiling height
const DEF_SLAB  = 4    // inches slab thickness

// Projection center tuned for the default 40×30 ft building
const BASE_CX = 260
const BASE_CY = 160

// Wall thickness (visual only)
const WALL_T = 0.6  // ft

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Pt { sx: number; sy: number }

export interface GeoPoly {
  kind: 'poly'
  id: string
  pts: Pt[]
  fill: string
  stroke: string
  strokeWidth: number
  opacity: number
  zOrder: number
  strokeDasharray?: string
}

export interface GeoLine {
  kind: 'line'
  id: string
  x1: number; y1: number; x2: number; y2: number
  stroke: string
  strokeWidth: number
  opacity: number
  zOrder: number
  strokeDasharray?: string
}

export interface GeoCircle {
  kind: 'circle'
  id: string
  cx: number; cy: number; r: number
  fill: string
  stroke: string
  strokeWidth: number
  opacity: number
  zOrder: number
}

export interface GeoText {
  kind: 'text'
  id: string
  x: number; y: number
  text: string
  fill: string
  fontSize: number
  fontWeight?: string
  textAnchor?: 'start' | 'middle' | 'end' | 'inherit'
  dominantBaseline?: 'auto' | 'middle' | 'hanging' | 'central' | 'alphabetic' | 'ideographic' | 'mathematical' | 'text-before-edge' | 'text-after-edge' | 'use-script' | 'no-change' | 'reset-size' | 'inherit'
  letterSpacing?: number
  fontFamily?: string
  opacity: number
  zOrder: number
}

export type GeoShape = GeoPoly | GeoLine | GeoCircle | GeoText

export interface GeoDim {
  id: string
  line: [Pt, Pt]
  tick1: [Pt, Pt]
  tick2: [Pt, Pt]
  labelPt: Pt
  labelText: string
  stroke: string
}

export interface SpaceGeometry {
  vw: number
  vh: number
  baseShapes: GeoShape[]               // floors, walls, grid, room labels
  compsByStage: Record<VRStage, GeoShape[]>
  dims: GeoDim[]
  badges: Array<{ x: number; y: number; label: string; value: string; color: string; inferred: boolean }>
  bldg: { W: number; D: number; H: number; ceilH: number; slabIn: number }
  isInferred: boolean
}

// ─── Projection Helpers ───────────────────────────────────────────────────────

function iso(x: number, z: number, y: number): Pt {
  return {
    sx: (x - z) * ISO_X + BASE_CX,
    sy: (x + z) * ISO_Y - y * ISO_H + BASE_CY,
  }
}

// ─── Shape Factory Helpers ────────────────────────────────────────────────────

function poly(
  id: string, pts: Pt[], fill: string, stroke: string,
  sw: number, opacity: number, zOrder: number, dash?: string
): GeoPoly {
  return { kind: 'poly', id, pts, fill, stroke, strokeWidth: sw, opacity, zOrder, strokeDasharray: dash }
}

function gline(
  id: string, p1: Pt, p2: Pt, stroke: string,
  sw: number, opacity: number, zOrder: number, dash?: string
): GeoLine {
  return { kind: 'line', id, x1: p1.sx, y1: p1.sy, x2: p2.sx, y2: p2.sy, stroke, strokeWidth: sw, opacity, zOrder, strokeDasharray: dash }
}

function circ(
  id: string, pt: Pt, r: number, fill: string,
  stroke: string, sw: number, opacity: number, zOrder: number
): GeoCircle {
  return { kind: 'circle', id, cx: pt.sx, cy: pt.sy, r, fill, stroke, strokeWidth: sw, opacity, zOrder }
}

type LblOpts = Partial<Pick<GeoText, 'fontWeight' | 'textAnchor' | 'dominantBaseline' | 'letterSpacing' | 'fontFamily'>>

function lbl(
  id: string, pt: Pt, text: string, fill: string,
  fontSize: number, opacity: number, zOrder: number,
  opts: LblOpts = {}
): GeoText {
  return { kind: 'text', id, x: pt.sx, y: pt.sy, text, fill, fontSize, opacity, zOrder, ...opts }
}

// ─── Building Spec ────────────────────────────────────────────────────────────

interface BuildingSpec {
  W: number; D: number; H: number; ceilH: number; slabIn: number
  divX: number   // vertical partition X (main | bedrooms)
  divZ: number   // horizontal partition Z (bedroom | kitchen)
}

function getSpec(space: BuildingSpace | null | undefined): { spec: BuildingSpec; isInferred: boolean } {
  if (space && space.footprint.width > 0 && space.footprint.height > 0) {
    const W = space.footprint.width
    const D = space.footprint.height
    const H = space.wallHeight.unit === 'ft' ? space.wallHeight.value : space.wallHeight.value / 12
    const ceilH = space.ceilingHeight.unit === 'ft' ? space.ceilingHeight.value : space.ceilingHeight.value / 12
    const slabIn = space.slabThickness.unit === 'in' ? space.slabThickness.value : space.slabThickness.value * 12
    return {
      spec: { W, D, H, ceilH, slabIn, divX: Math.round(W * 0.65), divZ: Math.round(D * 0.5) },
      isInferred: space.metadata.confidence < 0.8,
    }
  }
  return {
    spec: {
      W: DEF_W, D: DEF_D, H: DEF_H, ceilH: DEF_CEIL, slabIn: DEF_SLAB,
      divX: Math.round(DEF_W * 0.65), divZ: Math.round(DEF_D * 0.5),
    },
    isInferred: true,
  }
}

// ─── Wall Colors ──────────────────────────────────────────────────────────────

const WC = {
  back:   { fill: 'rgba(48,62,88,0.52)',    stroke: 'rgba(85,115,160,0.55)'  },
  left:   { fill: 'rgba(40,54,78,0.48)',    stroke: 'rgba(75,105,150,0.50)'  },
  front:  { fill: 'rgba(72,92,125,0.55)',   stroke: 'rgba(105,140,185,0.70)' },
  right:  { fill: 'rgba(64,84,118,0.52)',   stroke: 'rgba(98,132,178,0.65)'  },
  part:   { fill: 'rgba(56,72,102,0.48)',   stroke: 'rgba(88,118,165,0.55)'  },
  top:    { fill: 'rgba(98,118,152,0.58)',  stroke: 'rgba(120,148,188,0.55)' },
} as const

// ─── Base Shapes (floors + walls + grid + labels) ─────────────────────────────

function buildBaseShapes(s: BuildingSpec): GeoShape[] {
  const { W, D, H, divX, divZ } = s
  const shapes: GeoShape[] = []

  // ── Floor tiles ─────────────────────────────────────────────────────────────
  shapes.push(poly('fl-main', [
    iso(0,    0, 0), iso(divX, 0,    0), iso(divX, D, 0), iso(0,    D, 0),
  ], 'rgba(0,229,204,0.07)', 'rgba(0,210,185,0.18)', 0.5, 1, -100))

  shapes.push(poly('fl-bed', [
    iso(divX, 0,    0), iso(W,    0,    0), iso(W,    divZ, 0), iso(divX, divZ, 0),
  ], 'rgba(255,210,90,0.06)', 'rgba(210,170,60,0.18)', 0.5, 1, -100))

  shapes.push(poly('fl-kit', [
    iso(divX, divZ, 0), iso(W,    divZ, 0), iso(W,    D,    0), iso(divX, D,    0),
  ], 'rgba(80,170,255,0.06)', 'rgba(60,140,220,0.18)', 0.5, 1, -100))

  // ── Floor grid ──────────────────────────────────────────────────────────────
  for (let x = 5; x < W; x += 5) {
    shapes.push(gline(`gx-${x}`, iso(x, 0, 0), iso(x, D, 0),
      'rgba(100,150,200,0.09)', 0.5, 1, -99))
  }
  for (let z = 5; z < D; z += 5) {
    shapes.push(gline(`gz-${z}`, iso(0, z, 0), iso(W, z, 0),
      'rgba(100,150,200,0.09)', 0.5, 1, -99))
  }

  // ── Room labels (on floor) ───────────────────────────────────────────────────
  shapes.push(lbl('rl-main', iso(divX / 2, D / 2, 0), 'MAIN',
    'rgba(255,255,255,0.11)', 20, 1, -98,
    { fontWeight: '700', textAnchor: 'middle', dominantBaseline: 'middle', letterSpacing: 4, fontFamily: 'monospace' }))

  shapes.push(lbl('rl-bed', iso((divX + W) / 2, divZ / 2, 0), 'BEDROOM',
    'rgba(255,255,255,0.09)', 10, 1, -98,
    { fontWeight: '700', textAnchor: 'middle', dominantBaseline: 'middle', letterSpacing: 2, fontFamily: 'monospace' }))

  shapes.push(lbl('rl-kit', iso((divX + W) / 2, (divZ + D) / 2, 0), 'KITCHEN',
    'rgba(255,255,255,0.09)', 10, 1, -98,
    { fontWeight: '700', textAnchor: 'middle', dominantBaseline: 'middle', letterSpacing: 2, fontFamily: 'monospace' }))

  // ── Wall faces (painter's order: back→front, ascending midX+midZ) ────────────
  // wallFace: bottom-left, bottom-right, top-right, top-left
  const wf = (x1: number, z1: number, x2: number, z2: number): Pt[] => [
    iso(x1, z1, 0), iso(x2, z2, 0), iso(x2, z2, H), iso(x1, z1, H),
  ]

  // Left wall  x=0, z=0..D   zOrder = 0 + D/2 = 15
  shapes.push(poly('wl-left',  wf(0,    0,    0,    D),    WC.left.fill,  WC.left.stroke,  1.5, 1, 15))
  // Back wall  z=0, x=0..W   zOrder = W/2 + 0 = 20
  shapes.push(poly('wl-back',  wf(0,    0,    W,    0),    WC.back.fill,  WC.back.stroke,  1.5, 1, 20))
  // Partition X  x=divX, z=0..D   zOrder = divX + D/2
  shapes.push(poly('wl-px',    wf(divX, 0,    divX, D),    WC.part.fill,  WC.part.stroke,  1.0, 1, divX + D / 2))
  // Partition Z  z=divZ, x=divX..W   zOrder = (divX+W)/2 + divZ
  shapes.push(poly('wl-pz',    wf(divX, divZ, W,    divZ), WC.part.fill,  WC.part.stroke,  1.0, 1, (divX + W) / 2 + divZ))
  // Front wall  z=D, x=0..W   zOrder = W/2 + D
  shapes.push(poly('wl-front', wf(0,    D,    W,    D),    WC.front.fill, WC.front.stroke, 1.5, 1, W / 2 + D))
  // Right wall  x=W, z=0..D   zOrder = W + D/2
  shapes.push(poly('wl-right', wf(W,    0,    W,    D),    WC.right.fill, WC.right.stroke, 1.5, 1, W + D / 2))

  // ── Wall top edges (show wall thickness) ──────────────────────────────────
  // Front wall top (inward = -Z)
  shapes.push(poly('wt-front', [
    iso(0, D, H), iso(W, D, H), iso(W, D - WALL_T, H), iso(0, D - WALL_T, H),
  ], WC.top.fill, WC.top.stroke, 0.8, 0.9, W / 2 + D + 5))

  // Right wall top (inward = -X)
  shapes.push(poly('wt-right', [
    iso(W, 0, H), iso(W, D, H), iso(W - WALL_T, D, H), iso(W - WALL_T, 0, H),
  ], WC.top.fill, WC.top.stroke, 0.8, 0.9, W + D / 2 + 5))

  // Back wall top (inward = +Z)
  shapes.push(poly('wt-back', [
    iso(0, 0, H), iso(W, 0, H), iso(W, WALL_T, H), iso(0, WALL_T, H),
  ], WC.top.fill, WC.top.stroke, 0.8, 0.9, W / 2 + 5))

  // Left wall top (inward = +X)
  shapes.push(poly('wt-left', [
    iso(0, 0, H), iso(0, D, H), iso(WALL_T, D, H), iso(WALL_T, 0, H),
  ], WC.top.fill, WC.top.stroke, 0.8, 0.9, D / 2 + 5))

  // Partition tops
  shapes.push(poly('wt-px', [
    iso(divX, 0, H), iso(divX, D, H), iso(divX + WALL_T, D, H), iso(divX + WALL_T, 0, H),
  ], WC.top.fill, WC.top.stroke, 0.6, 0.75, divX + D / 2 + 5))

  shapes.push(poly('wt-pz', [
    iso(divX, divZ, H), iso(W, divZ, H), iso(W, divZ + WALL_T, H), iso(divX, divZ + WALL_T, H),
  ], WC.top.fill, WC.top.stroke, 0.6, 0.75, (divX + W) / 2 + divZ + 5))

  // ── Door openings (cut out entries) ─────────────────────────────────────────
  // Main entry on front wall (center bottom): x=14..18, z=D
  // Draw a gap indicator — thin bright line at door position
  shapes.push(gline('door-entry', iso(14, D, 0), iso(18, D, 0),
    'rgba(0,229,204,0.4)', 2, 1, W / 2 + D + 1, '3 2'))
  // Bedroom door on partition x=divX at z=4..7
  shapes.push(gline('door-bed', iso(divX, 4, 0), iso(divX, 7, 0),
    'rgba(255,210,90,0.35)', 1.5, 1, divX + D / 2 + 1, '3 2'))
  // Kitchen door on partition x=divX at z=21..24
  shapes.push(gline('door-kit', iso(divX, 21, 0), iso(divX, 24, 0),
    'rgba(80,170,255,0.35)', 1.5, 1, divX + D / 2 + 1, '3 2'))

  return shapes
}

// ─── Dimension Annotations ────────────────────────────────────────────────────

function buildDims(s: BuildingSpec): GeoDim[] {
  const { W, D, H } = s
  const dimColor = 'rgba(0,221,204,0.55)'
  const dims: GeoDim[] = []

  // Width dimension (along X at Z = D+2)
  const wStart = iso(0, D + 2.5, 0)
  const wEnd   = iso(W, D + 2.5, 0)
  const wMid   = iso(W / 2, D + 2.5, 0)
  dims.push({
    id: 'dim-width',
    line: [wStart, wEnd],
    tick1: [iso(0, D + 1.8, 0), iso(0, D + 3.2, 0)],
    tick2: [iso(W, D + 1.8, 0), iso(W, D + 3.2, 0)],
    labelPt: { sx: wMid.sx, sy: wMid.sy + 10 },
    labelText: `${W}'-0" WIDTH`,
    stroke: dimColor,
  })

  // Depth dimension (along Z at X = W+2.5)
  const dStart = iso(W + 2.5, 0, 0)
  const dEnd   = iso(W + 2.5, D, 0)
  const dMid   = iso(W + 2.5, D / 2, 0)
  dims.push({
    id: 'dim-depth',
    line: [dStart, dEnd],
    tick1: [iso(W + 1.8, 0, 0), iso(W + 3.2, 0, 0)],
    tick2: [iso(W + 1.8, D, 0), iso(W + 3.2, D, 0)],
    labelPt: { sx: dMid.sx + 10, sy: dMid.sy },
    labelText: `${D}'-0" DEPTH`,
    stroke: dimColor,
  })

  // Height dimension (vertical at X=W+2, Z=0)
  const hBase = iso(W + 2, 0, 0)
  const hTop  = iso(W + 2, 0, H)
  dims.push({
    id: 'dim-height',
    line: [hBase, hTop],
    tick1: [{ sx: hBase.sx - 6, sy: hBase.sy }, { sx: hBase.sx + 6, sy: hBase.sy }],
    tick2: [{ sx: hTop.sx  - 6, sy: hTop.sy  }, { sx: hTop.sx  + 6, sy: hTop.sy  }],
    labelPt: { sx: hTop.sx + 8, sy: (hBase.sy + hTop.sy) / 2 },
    labelText: `${H}' HT`,
    stroke: 'rgba(255,215,0,0.55)',
  })

  return dims
}

// ─── Electrical Components by Stage ──────────────────────────────────────────

function buildComps(s: BuildingSpec, stage: VRStage): GeoShape[] {
  const { W, D, H, divX, divZ } = s
  const out: GeoShape[] = []

  if (stage === 'underground') {
    const P = '#E07020', S = '#FF5252', A = '#FFA040'
    const ZO = 200  // render above base scene

    // Main horizontal underground feed (along front, y=0 dashed)
    out.push(gline('ug-h1', iso(2, D - 1, 0), iso(divX - 2, D - 1, 0), P, 2.5, 0.85, ZO, '8 3'))
    // Branch up toward panel
    out.push(gline('ug-v1', iso(W - 3.5, D - 1, 0), iso(W - 3.5, 1.5, 0), S, 2.5, 0.85, ZO, '8 3'))
    // Cross-connect
    out.push(gline('ug-h2', iso(divX - 2, D - 1, 0), iso(W - 3.5, D - 1, 0), P, 2, 0.7, ZO, '6 3'))
    // Service entrance stub at right-back
    out.push(gline('ug-svc', iso(W - 4, 0.8, 0), iso(W - 4, 3, 0), S, 1.8, 0.7, ZO, '5 3'))

    // Floor boxes (circles at y=0)
    const fbPos = [[6, D - 2], [13, D - 2], [20, D - 2], [W - 6, D - 4]] as [number, number][]
    fbPos.forEach(([x, z], i) => {
      out.push(circ(`ug-fb${i}o`, iso(x, z, 0), 7,   'rgba(0,0,0,0.75)', P, 1.5, 1, ZO + 1))
      out.push(circ(`ug-fb${i}i`, iso(x, z, 0), 2.5, P,                  P, 1,   1, ZO + 2))
      out.push(lbl(`ug-fb${i}l`, iso(x, z - 1.5, 0), 'FB', P, 6, 0.8, ZO + 3,
        { textAnchor: 'middle', fontFamily: 'monospace' }))
    })

    // Ground rod (T-shape near right-back corner)
    const grPt = iso(W - 1.5, 1, 0)
    out.push(gline('ug-gr1', { sx: grPt.sx, sy: grPt.sy }, { sx: grPt.sx, sy: grPt.sy + 14 }, S, 2, 1, ZO + 1))
    out.push(gline('ug-gr2', { sx: grPt.sx - 7, sy: grPt.sy + 14 }, { sx: grPt.sx + 7, sy: grPt.sy + 14 }, S, 2, 1, ZO + 1))
    out.push(gline('ug-gr3', { sx: grPt.sx - 5, sy: grPt.sy + 17 }, { sx: grPt.sx + 5, sy: grPt.sy + 17 }, S, 1.5, 1, ZO + 1))
    out.push(lbl('ug-grl', { sx: grPt.sx, sy: grPt.sy - 8 }, 'GND ROD', S, 6, 0.8, ZO + 2,
      { textAnchor: 'middle', fontFamily: 'monospace' }))

    // Stub-up arrow at panel location
    const stub = iso(W - 3.5, 1.5, 0.3)
    out.push(gline('ug-stub', { sx: stub.sx, sy: stub.sy + 18 }, { sx: stub.sx, sy: stub.sy }, S, 1.5, 1, ZO + 1))
    out.push(poly('ug-arrow', [
      { sx: stub.sx, sy: stub.sy - 4 },
      { sx: stub.sx - 5, sy: stub.sy + 5 },
      { sx: stub.sx + 5, sy: stub.sy + 5 },
    ], S, S, 1, 1, ZO + 2))
    out.push(lbl('ug-stubl', { sx: stub.sx + 8, sy: stub.sy }, 'STUB-UP', S, 6, 0.8, ZO + 3,
      { fontFamily: 'monospace' }))

    // Banner label
    const banPt = iso(W / 2 - 5, D + 0.5, 0)
    out.push(lbl('ug-banner', banPt, `── UNDERGROUND CONDUIT SYSTEM ──`, A, 6.5, 0.65, ZO + 5,
      { textAnchor: 'middle', fontFamily: 'monospace', letterSpacing: 1 }))

  } else if (stage === 'roughIn') {
    const P = '#3B82F6', S = '#EAB308', A = '#93C5FD'
    const ZO = 200

    // Panel box on right-back wall (at x=W, z=2..5, y=1..3.5)
    const panTL = iso(W, 2, 3.5)
    const panBR = iso(W, 5, 1)
    out.push(poly('ri-panel', [
      iso(W, 2, 3.5), iso(W, 5, 3.5), iso(W, 5, 1), iso(W, 2, 1),
    ], `${S}20`, S, 2, 1, ZO + 1))
    // Breaker lines in panel
    for (let i = 0; i < 5; i++) {
      const yF = 3.2 - i * 0.42
      out.push(gline(`ri-brk${i}`, iso(W, 2.3, yF), iso(W, 4.7, yF), S, 0.8, 0.6, ZO + 2))
    }
    out.push(lbl('ri-panl', iso(W, 3.5, 3.8), 'PANEL', S, 7, 1, ZO + 3,
      { textAnchor: 'middle', dominantBaseline: 'middle', fontWeight: '700', fontFamily: 'monospace' }))
    out.push(lbl('ri-pans', iso(W, 3.5, 2.5), '200A/1Ø', S, 6, 0.8, ZO + 3,
      { textAnchor: 'middle', dominantBaseline: 'middle', fontFamily: 'monospace' }))

    // Home run along back wall ceiling (y=H-0.3)
    out.push(gline('ri-hr', iso(1, 0.3, H - 0.3), iso(W - 0.5, 0.3, H - 0.3), P, 2, 0.6, ZO))
    out.push(lbl('ri-hrl', iso(W / 4, 0.3, H - 0.1), 'HOME RUN', P, 6, 0.65, ZO + 1,
      { textAnchor: 'middle', fontFamily: 'monospace' }))

    // Device boxes on left wall (x=0) at various z, y=1.5
    const lBoxZ = [4, 9, 14, 20, 25]
    lBoxZ.forEach((z, i) => {
      const pt = iso(0, z, 1.5)
      out.push(poly(`ri-lb${i}`, [
        { sx: pt.sx - 6, sy: pt.sy - 7 },
        { sx: pt.sx + 6, sy: pt.sy - 7 },
        { sx: pt.sx + 6, sy: pt.sy + 7 },
        { sx: pt.sx - 6, sy: pt.sy + 7 },
      ], `${P}20`, P, 1.5, 1, ZO + 1))
    })

    // Device boxes on bedroom right wall (x=W) at y=1.5
    const rBoxZ = [3, 8, 12]
    rBoxZ.forEach((z, i) => {
      const pt = iso(W, z, 1.5)
      out.push(poly(`ri-rb${i}`, [
        { sx: pt.sx - 5, sy: pt.sy - 6 },
        { sx: pt.sx + 5, sy: pt.sy - 6 },
        { sx: pt.sx + 5, sy: pt.sy + 6 },
        { sx: pt.sx - 5, sy: pt.sy + 6 },
      ], `${P}20`, P, 1.5, 1, ZO + 1))
    })

    // EMT runs along left wall
    out.push(gline('ri-emt1', iso(0.3, 0, 0), iso(0.3, D, 0), P, 1.2, 0.4, ZO))
    out.push(gline('ri-emt2', iso(W - 0.3, 0, 0), iso(W - 0.3, D, 0), P, 1, 0.35, ZO))

    // Junction boxes at ceiling
    const jbPos = [[divX / 2, D / 2], [(divX + W) / 2, divZ / 2]] as [number, number][]
    jbPos.forEach(([x, z], i) => {
      const pt = iso(x, z, H - 0.2)
      out.push(poly(`ri-jb${i}`, [
        { sx: pt.sx - 7, sy: pt.sy - 5 },
        { sx: pt.sx + 7, sy: pt.sy - 5 },
        { sx: pt.sx + 7, sy: pt.sy + 5 },
        { sx: pt.sx - 7, sy: pt.sy + 5 },
      ], `${A}18`, A, 1, 0.8, ZO + 1))
      out.push(lbl(`ri-jbl${i}`, pt, 'J', A, 6.5, 0.8, ZO + 2,
        { textAnchor: 'middle', dominantBaseline: 'middle', fontFamily: 'monospace' }))
    })

  } else if (stage === 'trim') {
    const P = '#22C55E', S = '#4ADE80', A = '#86EFAC'
    const ZO = 200

    // Outlets on left wall (receptacles)
    const outZ = [4, 9, 14, 20, 25]
    outZ.forEach((z, i) => {
      const pt = iso(0, z, 1.2)
      out.push(poly(`tr-out${i}`, [
        { sx: pt.sx - 5, sy: pt.sy - 7 },
        { sx: pt.sx + 5, sy: pt.sy - 7 },
        { sx: pt.sx + 5, sy: pt.sy + 7 },
        { sx: pt.sx - 5, sy: pt.sy + 7 },
      ], 'rgba(0,0,0,0.75)', P, 1.5, 1, ZO + 1))
      out.push(gline(`tr-sl${i}a`, { sx: pt.sx - 2, sy: pt.sy - 3 }, { sx: pt.sx - 2, sy: pt.sy + 3 }, P, 0.9, 1, ZO + 2))
      out.push(gline(`tr-sl${i}b`, { sx: pt.sx + 2, sy: pt.sy - 3 }, { sx: pt.sx + 2, sy: pt.sy + 3 }, P, 0.9, 1, ZO + 2))
    })

    // Switches near doors (at y=3.5)
    const swPos = [[divX - 0.5, 3.5, 3.5], [divX - 0.5, 20.5, 3.5]] as [number, number, number][]
    swPos.forEach(([x, z, y], i) => {
      const pt = iso(x, z, y)
      out.push(poly(`tr-sw${i}`, [
        { sx: pt.sx - 5, sy: pt.sy - 5 },
        { sx: pt.sx + 5, sy: pt.sy - 5 },
        { sx: pt.sx + 5, sy: pt.sy + 5 },
        { sx: pt.sx - 5, sy: pt.sy + 5 },
      ], 'rgba(0,0,0,0.75)', S, 1.5, 1, ZO + 1))
      out.push(lbl(`tr-swl${i}`, pt, 'S', S, 8, 1, ZO + 2,
        { textAnchor: 'middle', dominantBaseline: 'middle', fontWeight: '700', fontFamily: 'monospace' }))
    })

    // Ceiling lights (circle-X) at room centers
    const lightPos = [
      [divX / 2, D / 2, 'LT-MAIN'],
      [(divX + W) / 2, divZ / 2, 'LT-BED'],
      [(divX + W) / 2, (divZ + D) / 2, 'LT-KIT'],
    ] as [number, number, string][]

    lightPos.forEach(([x, z, name], i) => {
      const pt = iso(x, z, H)
      out.push(circ(`tr-lt${i}o`, pt, 11, 'rgba(0,0,0,0.55)', P, 1.5, 1, ZO + 1))
      out.push(gline(`tr-lt${i}xa`, { sx: pt.sx - 7, sy: pt.sy - 7 }, { sx: pt.sx + 7, sy: pt.sy + 7 }, P, 1, 1, ZO + 2))
      out.push(gline(`tr-lt${i}xb`, { sx: pt.sx + 7, sy: pt.sy - 7 }, { sx: pt.sx - 7, sy: pt.sy + 7 }, P, 1, 1, ZO + 2))
      out.push(circ(`tr-lt${i}c`, pt, 2.5, P, P, 1, 0.7, ZO + 3))
      out.push(lbl(`tr-ltnm${i}`, { sx: pt.sx, sy: pt.sy + 18 }, name, A, 6, 0.85, ZO + 4,
        { textAnchor: 'middle', fontFamily: 'monospace' }))
    })

    // Panel directory
    const pd = iso(W, 3.5, 3.0)
    out.push(lbl('tr-pdl', pd, 'PANEL DIR', P, 6.5, 0.85, ZO + 2,
      { textAnchor: 'middle', fontFamily: 'monospace', fontWeight: '700' }))
    out.push(lbl('tr-pds', { sx: pd.sx, sy: pd.sy + 10 }, 'CKT 1–20', A, 6, 0.7, ZO + 2,
      { textAnchor: 'middle', fontFamily: 'monospace' }))

  } else {
    // finished
    const P = '#06B6D4', S = '#A78BFA', A = '#67E8F9'
    const ZO = 200
    const panelPt = iso(W, 3.5, 2.5)

    // Circuit path lines from panel to device positions
    const devPts: [number, number, number][] = [
      [0, 4, 1.2], [0, 9, 1.2], [0, 14, 1.2], [0, 20, 1.2],
      [W, 3, 1.2], [W, 8, 1.2],
      [divX / 2, D / 2, H], [(divX + W) / 2, divZ / 2, H],
    ]
    devPts.forEach(([x, z, y], i) => {
      const pt = iso(x, z, y)
      out.push(gline(`fn-cp${i}`, panelPt, pt, i < 4 ? P : S, 0.6, 0.18, ZO, '4 7'))
    })

    // Labeled devices on left wall
    const fnZ = [4, 9, 14, 20, 25]
    fnZ.forEach((z, i) => {
      const pt = iso(0, z, 1.2)
      out.push(poly(`fn-dev${i}`, [
        { sx: pt.sx - 6, sy: pt.sy - 8 },
        { sx: pt.sx + 6, sy: pt.sy - 8 },
        { sx: pt.sx + 6, sy: pt.sy + 8 },
        { sx: pt.sx - 6, sy: pt.sy + 8 },
      ], 'rgba(0,0,0,0.85)', P, 1.5, 1, ZO + 1))
      out.push(gline(`fn-sl${i}a`, { sx: pt.sx - 2.5, sy: pt.sy - 3 }, { sx: pt.sx - 2.5, sy: pt.sy + 3 }, P, 0.9, 1, ZO + 2))
      out.push(gline(`fn-sl${i}b`, { sx: pt.sx + 2.5, sy: pt.sy - 3 }, { sx: pt.sx + 2.5, sy: pt.sy + 3 }, P, 0.9, 1, ZO + 2))
      out.push(lbl(`fn-devl${i}`, { sx: pt.sx, sy: pt.sy + 18 }, `A${i + 1}`, A, 6.5, 0.9, ZO + 3,
        { textAnchor: 'middle', fontFamily: 'monospace' }))
    })

    // As-built lights at room centers
    const ltPos = [
      [divX / 2, D / 2, 'L1'],
      [(divX + W) / 2, divZ / 2, 'L2'],
      [(divX + W) / 2, (divZ + D) / 2, 'L3'],
    ] as [number, number, string][]

    ltPos.forEach(([x, z, name], i) => {
      const pt = iso(x, z, H)
      out.push(circ(`fn-lt${i}o`, pt, 12, 'rgba(0,0,0,0.65)', S, 1.5, 1, ZO + 1))
      out.push(circ(`fn-lt${i}i`, pt, 5, `${S}30`, S, 1, 0.8, ZO + 2))
      out.push(gline(`fn-lt${i}xa`, { sx: pt.sx - 8, sy: pt.sy - 8 }, { sx: pt.sx + 8, sy: pt.sy + 8 }, S, 1, 1, ZO + 2))
      out.push(gline(`fn-lt${i}xb`, { sx: pt.sx + 8, sy: pt.sy - 8 }, { sx: pt.sx - 8, sy: pt.sy + 8 }, S, 1, 1, ZO + 2))
      out.push(lbl(`fn-ltnm${i}`, { sx: pt.sx, sy: pt.sy + 20 }, name, S, 7, 1, ZO + 4,
        { textAnchor: 'middle', fontFamily: 'monospace', fontWeight: '700' }))
    })

    // Panel as-built
    const pd = iso(W, 3.5, 2.5)
    out.push(lbl('fn-abt', { sx: pd.sx, sy: pd.sy - 5 }, 'AS-BUILT', P, 7, 1, ZO + 2,
      { textAnchor: 'middle', fontFamily: 'monospace', fontWeight: '700' }))
    ;(['CKT1 ✓', 'CKT2 ✓', 'CKT3 ✓', 'CKT4 ✓', 'CKT5 ✓'] as string[]).forEach((ck, i) => {
      out.push(lbl(`fn-ckt${i}`, { sx: pd.sx, sy: pd.sy + 8 + i * 9 }, ck,
        i % 2 === 0 ? P : S, 5.5, 0.9, ZO + 2,
        { textAnchor: 'middle', fontFamily: 'monospace' }))
    })

    // Completion watermark
    const wm = iso(W / 2 - 5, D + 0.2, 0)
    out.push(lbl('fn-wmark', wm, 'CONSTRUCTION COMPLETE — AS-BUILT VERIFIED',
      `${P}66`, 6.5, 1, ZO + 5,
      { textAnchor: 'middle', fontFamily: 'monospace', letterSpacing: 1.5, fontWeight: '700' }))
  }

  return out
}

// ─── Badges ───────────────────────────────────────────────────────────────────

function buildBadges(
  s: BuildingSpec,
  isInferred: boolean
): Array<{ x: number; y: number; label: string; value: string; color: string; inferred: boolean }> {
  return [
    { x: 12, y: 14, label: 'WIDTH',  value: `${s.W}'-0"`,     color: '#00ddcc', inferred: isInferred },
    { x: 12, y: 32, label: 'DEPTH',  value: `${s.D}'-0"`,     color: '#00ddcc', inferred: isInferred },
    { x: 12, y: 50, label: 'HEIGHT', value: `${s.H}'-0"`,     color: '#FFD700', inferred: isInferred },
    { x: 12, y: 68, label: 'CEIL',   value: `${s.ceilH}'-0"`, color: '#FFD700', inferred: isInferred },
    { x: 12, y: 86, label: 'SLAB',   value: `${s.slabIn}"`,   color: '#a0a0c0', inferred: isInferred },
  ]
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export function buildSpaceGeometry(
  space: BuildingSpace | null | undefined
): SpaceGeometry {
  const { spec, isInferred } = getSpec(space)

  const baseShapes = buildBaseShapes(spec)
  baseShapes.sort((a, b) => a.zOrder - b.zOrder)

  const compsByStage: Record<VRStage, GeoShape[]> = {
    underground: buildComps(spec, 'underground'),
    roughIn:     buildComps(spec, 'roughIn'),
    trim:        buildComps(spec, 'trim'),
    finished:    buildComps(spec, 'finished'),
  }

  return {
    vw: GEO_VW,
    vh: GEO_VH,
    baseShapes,
    compsByStage,
    dims: buildDims(spec),
    badges: buildBadges(spec, isInferred),
    bldg: { W: spec.W, D: spec.D, H: spec.H, ceilH: spec.ceilH, slabIn: spec.slabIn },
    isInferred,
  }
}
