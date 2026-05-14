/**
 * src/features/blueprint-vr/BlueprintVRLandscapeViewer.tsx
 *
 * SVG top-down floor plan viewer for the Blueprint VR feature.
 * Renders a construction site with stage-specific colored electrical components.
 * No dependencies, no Math.random, fully deterministic.
 */

import React from 'react'
import type { VRStage } from './types'

// ── Types ────────────────────────────────────────────────────────────

export interface BlueprintVRLandscapeViewerProps {
  selectedStage: VRStage
}

interface Theme {
  p: string  // primary
  s: string  // secondary
  a: string  // accent
  label: string
}

// ── Constants ────────────────────────────────────────────────────────

const VW = 520
const VH = 390

/** Floor plan outer bounds and room dividers */
const FP = {
  left: 20,   top: 28,  right: 500, bottom: 365,
  divX: 308,             // vertical wall: main room vs right rooms
  divY: 196,             // horizontal wall: bedroom vs kitchen
  entryX1: 178, entryX2: 218,   // main entry door gap (bottom wall)
  bdoorY1: 76,  bdoorY2: 116,   // bedroom interior door gap
  kdoorY1: 266, kdoorY2: 306,   // kitchen interior door gap
} as const

const WALL_CLR = 'rgba(148,163,200,0.55)'
const WALL_W   = 1.8

const THEMES: Record<VRStage, Theme> = {
  underground: { p: '#E07020', s: '#FF5252', a: '#FFA040', label: 'UNDERGROUND' },
  roughIn:     { p: '#3B82F6', s: '#EAB308', a: '#93C5FD', label: 'ROUGH IN'    },
  trim:        { p: '#22C55E', s: '#4ADE80', a: '#86EFAC', label: 'TRIM'        },
  finished:    { p: '#06B6D4', s: '#A78BFA', a: '#67E8F9', label: 'FINISHED'    },
}

const LEGEND: Record<VRStage, Array<{ color: string; label: string }>> = {
  underground: [
    { color: '#E07020', label: 'Conduit'         },
    { color: '#FF5252', label: 'Gnd/Stub-Up'     },
    { color: '#FFA040', label: 'Floor Box'        },
  ],
  roughIn: [
    { color: '#3B82F6', label: 'Device Box'       },
    { color: '#EAB308', label: 'Panel/Sub-Panel'  },
    { color: '#93C5FD', label: 'EMT/J-Box'        },
  ],
  trim: [
    { color: '#22C55E', label: 'Receptacle'       },
    { color: '#4ADE80', label: 'Switch'           },
    { color: '#86EFAC', label: 'Light Fixture'    },
  ],
  finished: [
    { color: '#06B6D4', label: 'Labeled Device'   },
    { color: '#A78BFA', label: 'Light/Circuit'    },
    { color: '#67E8F9', label: 'Circuit Path'     },
  ],
}

// ── Floor Plan Base (always visible) ─────────────────────────────────

function FloorPlanBase() {
  const bdMid = (FP.bdoorY1 + FP.bdoorY2) / 2
  const kdMid = (FP.kdoorY1 + FP.kdoorY2) / 2
  return (
    <g>
      {/* Room background tints */}
      <rect x={FP.left}  y={FP.top} width={FP.divX - FP.left}  height={FP.bottom - FP.top}  fill="rgba(0,229,204,0.014)" />
      <rect x={FP.divX}  y={FP.top} width={FP.right - FP.divX} height={FP.divY - FP.top}    fill="rgba(255,220,100,0.014)" />
      <rect x={FP.divX}  y={FP.divY} width={FP.right - FP.divX} height={FP.bottom - FP.divY} fill="rgba(100,200,255,0.014)" />

      {/* Outer walls */}
      <line x1={FP.left}  y1={FP.top}    x2={FP.right} y2={FP.top}    stroke={WALL_CLR} strokeWidth={WALL_W} />
      <line x1={FP.left}  y1={FP.top}    x2={FP.left}  y2={FP.bottom} stroke={WALL_CLR} strokeWidth={WALL_W} />
      <line x1={FP.right} y1={FP.top}    x2={FP.right} y2={FP.bottom} stroke={WALL_CLR} strokeWidth={WALL_W} />
      {/* Bottom wall with entry door gap */}
      <line x1={FP.left}      y1={FP.bottom} x2={FP.entryX1}  y2={FP.bottom} stroke={WALL_CLR} strokeWidth={WALL_W} />
      <line x1={FP.entryX2}   y1={FP.bottom} x2={FP.right}    y2={FP.bottom} stroke={WALL_CLR} strokeWidth={WALL_W} />

      {/* Interior vertical divider (main vs right rooms) with door gaps */}
      <line x1={FP.divX} y1={FP.top}      x2={FP.divX} y2={FP.bdoorY1} stroke={WALL_CLR} strokeWidth={WALL_W} />
      <line x1={FP.divX} y1={FP.bdoorY2}  x2={FP.divX} y2={FP.kdoorY1} stroke={WALL_CLR} strokeWidth={WALL_W} />
      <line x1={FP.divX} y1={FP.kdoorY2}  x2={FP.divX} y2={FP.bottom}  stroke={WALL_CLR} strokeWidth={WALL_W} />

      {/* Horizontal divider: bedroom / kitchen */}
      <line x1={FP.divX} y1={FP.divY} x2={FP.right} y2={FP.divY} stroke={WALL_CLR} strokeWidth={WALL_W} />

      {/* Door arcs */}
      <path
        d={`M ${FP.entryX1},${FP.bottom} Q ${(FP.entryX1+FP.entryX2)/2},${FP.bottom-22} ${FP.entryX2},${FP.bottom}`}
        fill="none" stroke="rgba(148,163,200,0.18)" strokeWidth="0.6" />
      <path
        d={`M ${FP.divX},${FP.bdoorY1} Q ${FP.divX-22},${bdMid} ${FP.divX},${FP.bdoorY2}`}
        fill="none" stroke="rgba(148,163,200,0.18)" strokeWidth="0.6" />
      <path
        d={`M ${FP.divX},${FP.kdoorY1} Q ${FP.divX-22},${kdMid} ${FP.divX},${FP.kdoorY2}`}
        fill="none" stroke="rgba(148,163,200,0.18)" strokeWidth="0.6" />

      {/* Room labels */}
      <text x={(FP.left + FP.divX) / 2} y={(FP.top + FP.bottom) / 2}
        textAnchor="middle" dominantBaseline="middle"
        fill="rgba(255,255,255,0.08)" fontSize="26" fontFamily="monospace" fontWeight="700" letterSpacing="4">
        MAIN
      </text>
      <text x={(FP.divX + FP.right) / 2} y={(FP.top + FP.divY) / 2}
        textAnchor="middle" dominantBaseline="middle"
        fill="rgba(255,255,255,0.08)" fontSize="13" fontFamily="monospace" fontWeight="700" letterSpacing="2">
        BEDROOM
      </text>
      <text x={(FP.divX + FP.right) / 2} y={(FP.divY + FP.bottom) / 2}
        textAnchor="middle" dominantBaseline="middle"
        fill="rgba(255,255,255,0.08)" fontSize="13" fontFamily="monospace" fontWeight="700" letterSpacing="2">
        KITCHEN
      </text>

      {/* North arrow */}
      <text x={FP.right - 4} y={FP.top + 10} textAnchor="end"
        fill="rgba(255,255,255,0.18)" fontSize="7.5" fontFamily="monospace">↑N</text>
    </g>
  )
}

// ── Underground Layer ─────────────────────────────────────────────────

function UndergroundLayer({ t }: { t: Theme }) {
  const dash = { stroke: t.p, strokeWidth: 2, strokeDasharray: '7 3' } as const
  const floorBoxes = [
    { x: 80,  y: FP.bottom - 20 },
    { x: 165, y: FP.bottom - 20 },
    { x: 248, y: FP.bottom - 20 },
    { x: 400, y: FP.bottom - 20 },
  ]
  return (
    <g>
      {/* Main underground feed (horizontal, near slab bottom) */}
      <line x1={FP.left + 8}  y1={FP.bottom - 11} x2={FP.right - 8} y2={FP.bottom - 11} {...dash} />
      {/* Left branch vertical */}
      <line x1={80}  y1={FP.top + 8}  x2={80}  y2={FP.bottom - 11} {...dash} />
      {/* Center-left branch vertical (partial) */}
      <line x1={180} y1={138}         x2={180} y2={FP.bottom - 11} {...dash} />
      {/* Service entrance conduit (panel to slab) */}
      <line x1={430} y1={FP.top + 63} x2={430} y2={FP.bottom - 11}
        stroke={t.s} strokeWidth={2} strokeDasharray="7 3" />
      {/* Right-room branch */}
      <line x1={390} y1={FP.bottom - 11} x2={390} y2={FP.top + 8}
        stroke={t.a} strokeWidth={1.5} strokeDasharray="4 4" />

      {/* Floor boxes */}
      {floorBoxes.map((pt, i) => (
        <g key={i}>
          <circle cx={pt.x} cy={pt.y} r={7}   fill="rgba(0,0,0,0.7)" stroke={t.p} strokeWidth={1.5} />
          <circle cx={pt.x} cy={pt.y} r={2.5} fill={t.p} />
          <text x={pt.x} y={pt.y + 16} textAnchor="middle"
            fill={t.p} fontSize="5.5" fontFamily="monospace" opacity={0.85}>FB</text>
        </g>
      ))}

      {/* Ground rod (T-shape below floor line) */}
      <line x1={478} y1={FP.bottom - 6}  x2={478} y2={FP.bottom + 7}  stroke={t.s} strokeWidth={2}   />
      <line x1={472} y1={FP.bottom + 7}  x2={484} y2={FP.bottom + 7}  stroke={t.s} strokeWidth={2}   />
      <line x1={474} y1={FP.bottom + 10} x2={482} y2={FP.bottom + 10} stroke={t.s} strokeWidth={1.5} />
      <line x1={476} y1={FP.bottom + 13} x2={480} y2={FP.bottom + 13} stroke={t.s} strokeWidth={1}   />
      <text x={478} y={FP.bottom - 10} textAnchor="middle"
        fill={t.s} fontSize="5.5" fontFamily="monospace">GND ROD</text>

      {/* Stub-up arrow at panel location */}
      <line    x1={430} y1={FP.top + 60} x2={430} y2={FP.top + 46} stroke={t.s} strokeWidth={1.5} />
      <polygon points={`430,${FP.top + 41} 426,${FP.top + 50} 434,${FP.top + 50}`} fill={t.s} />
      <text x={436} y={FP.top + 48} fill={t.s} fontSize="5.5" fontFamily="monospace">STUB-UP</text>

      {/* Conduit sleeve at entry door */}
      <rect x={FP.entryX1 + 3} y={FP.bottom - 3} width={30} height={6}
        fill="rgba(0,0,0,0.5)" stroke={t.a} strokeWidth={1.2} rx={1} />
      <text x={(FP.entryX1 + FP.entryX2) / 2} y={FP.bottom + 9}
        textAnchor="middle" fill={t.a} fontSize="5.5" fontFamily="monospace">SLEEVE</text>

      {/* Banner */}
      <text x={(FP.left + FP.right) / 2} y={FP.bottom - 3}
        textAnchor="middle" fill={`${t.p}88`}
        fontSize="6" fontFamily="monospace" letterSpacing="1">
        ── UNDERGROUND CONDUIT SYSTEM ──
      </text>
    </g>
  )
}

// ── Rough In Layer ────────────────────────────────────────────────────

function RoughInLayer({ t }: { t: Theme }) {
  const boxes: Array<[number, number]> = [
    // Left wall of main room
    [FP.left + 8, 85], [FP.left + 8, 150], [FP.left + 8, 218], [FP.left + 8, 292],
    // Right wall of main room (at divider)
    [FP.divX - 8, 85], [FP.divX - 8, 150], [FP.divX - 8, 220],
    // Bedroom walls
    [FP.divX + 12, 54], [FP.divX + 12, 144], [FP.right - 8, 54], [FP.right - 8, 144],
    // Kitchen walls
    [FP.divX + 12, 224], [FP.divX + 12, 324], [FP.right - 8, 224], [FP.right - 8, 324],
  ]
  return (
    <g>
      {/* EMT runs along walls (thin lines) */}
      <line x1={FP.left  + 13} y1={FP.top + 5} x2={FP.left  + 13} y2={FP.bottom - 5}
        stroke={t.p} strokeWidth={1.4} opacity={0.4} />
      <line x1={FP.divX  - 13} y1={FP.top + 5} x2={FP.divX  - 13} y2={FP.bottom - 5}
        stroke={t.p} strokeWidth={1.4} opacity={0.4} />
      <line x1={FP.divX  + 13} y1={FP.top + 5} x2={FP.divX  + 13} y2={FP.bottom - 5}
        stroke={t.p} strokeWidth={1}   opacity={0.3} />
      <line x1={FP.right - 13} y1={FP.top + 5} x2={FP.right - 13} y2={FP.bottom - 5}
        stroke={t.p} strokeWidth={1}   opacity={0.3} />

      {/* Home run at ceiling */}
      <line x1={FP.left + 13} y1={FP.top + 22} x2={440} y2={FP.top + 22}
        stroke={t.p} strokeWidth={2} opacity={0.6} />
      <text x={(FP.left + 440) / 2} y={FP.top + 19}
        textAnchor="middle" fill={t.p} fontSize="5.5" fontFamily="monospace" opacity={0.7}>
        HOME RUN
      </text>

      {/* Service entrance conduit to panel */}
      <line x1={440} y1={FP.top + 22} x2={440} y2={FP.top + 67}
        stroke={t.s} strokeWidth={2.5} opacity={0.8} />

      {/* Panel box */}
      <rect x={416} y={FP.top + 5} width={56} height={40}
        fill={`${t.s}18`} stroke={t.s} strokeWidth={2} />
      {[0, 1, 2, 3, 4, 5].map(i => (
        <line key={i}
          x1={418} y1={FP.top + 10 + i * 5.5}
          x2={438} y2={FP.top + 10 + i * 5.5}
          stroke={t.s} strokeWidth={1} opacity={0.55} />
      ))}
      <text x={448} y={FP.top + 19} fill={t.s} fontSize="7"   fontFamily="monospace" fontWeight="700">PANEL</text>
      <text x={448} y={FP.top + 29} fill={t.s} fontSize="5.5" fontFamily="monospace">200A/1Ø</text>
      <text x={448} y={FP.top + 38} fill={t.s} fontSize="5"   fontFamily="monospace" opacity={0.7}>SERVICE</text>

      {/* Device boxes */}
      {boxes.map(([x, y], i) => (
        <rect key={i} x={x - 5} y={y - 5} width={10} height={10}
          fill={`${t.p}18`} stroke={t.p} strokeWidth={1.5} />
      ))}

      {/* Junction boxes in ceiling */}
      {([[155, FP.top + 10], [260, FP.top + 10]] as Array<[number, number]>).map(([x, y], i) => (
        <rect key={i} x={x - 6} y={y} width={12} height={12}
          fill={`${t.a}18`} stroke={t.a} strokeWidth={1} opacity={0.7} />
      ))}

      {/* Sub-panel in kitchen */}
      <rect x={FP.right - 30} y={FP.divY + 10} width={26} height={22}
        fill={`${t.s}15`} stroke={t.s} strokeWidth={1.5} opacity={0.8} />
      <text x={FP.right - 17} y={FP.divY + 24} textAnchor="middle"
        fill={t.s} fontSize="5.5" fontFamily="monospace">SUB-P</text>
    </g>
  )
}

// ── Trim Layer ────────────────────────────────────────────────────────

function TrimLayer({ t }: { t: Theme }) {
  const outlets: Array<[number, number]> = [
    [FP.left + 8, 85], [FP.left + 8, 150], [FP.left + 8, 218], [FP.left + 8, 292],
    [FP.divX - 8, 85], [FP.divX - 8, 150], [FP.divX - 8, 220],
    [FP.divX + 12, 54], [FP.right - 8, 54],
    [FP.divX + 12, 224], [FP.right - 8, 324],
  ]
  const switches: Array<[number, number]> = [
    [FP.divX - 14, 346],
    [FP.divX - 14, FP.bdoorY2 + 8],
    [FP.divX - 14, FP.kdoorY2 - 8],
  ]
  const lights: Array<[number, number, string]> = [
    [(FP.left + FP.divX) / 2, (FP.top + FP.bottom) / 2, 'LT-MAIN'],
    [(FP.left + FP.divX) / 2, FP.top + 85,              'LT-HALL'],
    [(FP.divX + FP.right) / 2, (FP.top + FP.divY) / 2, 'LT-BED' ],
    [(FP.divX + FP.right) / 2, (FP.divY + FP.bottom) / 2, 'LT-KIT'],
  ]

  return (
    <g>
      {/* Outlet symbols */}
      {outlets.map(([x, y], i) => (
        <g key={i}>
          <rect x={x - 5} y={y - 6} width={10} height={12}
            fill="rgba(0,0,0,0.7)" stroke={t.p} strokeWidth={1.5} rx={1} />
          <line x1={x - 2} y1={y - 3} x2={x - 2} y2={y + 3} stroke={t.p} strokeWidth={0.8} />
          <line x1={x + 2} y1={y - 3} x2={x + 2} y2={y + 3} stroke={t.p} strokeWidth={0.8} />
        </g>
      ))}

      {/* Switch symbols */}
      {switches.map(([x, y], i) => (
        <g key={i}>
          <rect x={x - 5} y={y - 5} width={10} height={10}
            fill="rgba(0,0,0,0.7)" stroke={t.s} strokeWidth={1.5} rx={1} />
          <text x={x} y={y + 3.5} textAnchor="middle" dominantBaseline="middle"
            fill={t.s} fontSize="7.5" fontFamily="monospace" fontWeight="700">S</text>
        </g>
      ))}

      {/* Ceiling lights (circle with X) */}
      {lights.map(([x, y, lbl], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r={10} fill="rgba(0,0,0,0.5)" stroke={t.p} strokeWidth={1.5} />
          <line x1={x - 7} y1={y - 7} x2={x + 7} y2={y + 7} stroke={t.p} strokeWidth={1} />
          <line x1={x + 7} y1={y - 7} x2={x - 7} y2={y + 7} stroke={t.p} strokeWidth={1} />
          <circle cx={x} cy={y} r={2.5} fill={t.p} opacity={0.7} />
          <text x={x} y={y + 19} textAnchor="middle"
            fill={t.a} fontSize="5.5" fontFamily="monospace">{lbl}</text>
        </g>
      ))}

      {/* Panel directory */}
      <rect x={416} y={FP.top + 5} width={56} height={38}
        fill="rgba(0,0,0,0.7)" stroke={t.p} strokeWidth={1.5} />
      <text x={444} y={FP.top + 14} textAnchor="middle" fill={t.p}  fontSize="6.5" fontFamily="monospace" fontWeight="700">PANEL</text>
      <text x={444} y={FP.top + 22} textAnchor="middle" fill={t.a}  fontSize="5.5" fontFamily="monospace">DIRECTORY</text>
      <text x={444} y={FP.top + 29} textAnchor="middle" fill={t.a}  fontSize="5"   fontFamily="monospace">CKT 1–20</text>
      <text x={444} y={FP.top + 36} textAnchor="middle" fill={t.p}  fontSize="5"   fontFamily="monospace">LABELED ✓</text>
    </g>
  )
}

// ── Finished Layer ────────────────────────────────────────────────────

function FinishedLayer({ t }: { t: Theme }) {
  const devices: Array<[number, number, string]> = [
    [FP.left + 8, 85,  'A1'], [FP.left + 8, 150, 'A2'],
    [FP.left + 8, 218, 'A3'], [FP.left + 8, 292, 'A4'],
    [FP.divX - 8, 85,  'B1'], [FP.divX - 8, 150, 'B2'],
    [FP.divX + 12, 54, 'C1'], [FP.right - 8, 54, 'C2'],
    [FP.divX + 12, 224, 'D1'],[FP.right - 8, 324, 'D2'],
  ]
  const lights: Array<[number, number, string]> = [
    [(FP.left + FP.divX) / 2, (FP.top + FP.bottom) / 2, 'L1'],
    [(FP.left + FP.divX) / 2, FP.top + 85,              'L2'],
    [(FP.divX + FP.right) / 2, (FP.top + FP.divY) / 2, 'L3'],
    [(FP.divX + FP.right) / 2, (FP.divY + FP.bottom) / 2, 'L4'],
  ]
  const pX = 444
  const pY = FP.top + 24

  return (
    <g>
      {/* Circuit path lines from panel */}
      {devices.map(([x, y], i) => (
        <line key={`cp-${i}`} x1={pX} y1={pY} x2={x} y2={y}
          stroke={i < 4 ? t.p : t.s} strokeWidth={0.6} strokeDasharray="3 6" opacity={0.22} />
      ))}
      {lights.map(([x, y], i) => (
        <line key={`cpl-${i}`} x1={pX} y1={pY} x2={x} y2={y}
          stroke={t.s} strokeWidth={0.6} strokeDasharray="3 6" opacity={0.22} />
      ))}

      {/* Labeled devices */}
      {devices.map(([x, y, lbl], i) => (
        <g key={i}>
          <rect x={x - 6} y={y - 7} width={12} height={14}
            fill="rgba(0,0,0,0.82)" stroke={t.p} strokeWidth={1.5} rx={1} />
          <line x1={x - 3} y1={y - 3} x2={x - 3} y2={y + 3} stroke={t.p} strokeWidth={0.8} />
          <line x1={x + 3} y1={y - 3} x2={x + 3} y2={y + 3} stroke={t.p} strokeWidth={0.8} />
          <text x={x} y={y + 18} textAnchor="middle"
            fill={t.a} fontSize="6" fontFamily="monospace">{lbl}</text>
        </g>
      ))}

      {/* Lights with labels */}
      {lights.map(([x, y, lbl], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r={11} fill="rgba(0,0,0,0.6)" stroke={t.s} strokeWidth={1.5} />
          <circle cx={x} cy={y} r={5}  fill={`${t.s}28`} />
          <line x1={x - 7} y1={y - 7} x2={x + 7} y2={y + 7} stroke={t.s} strokeWidth={1} />
          <line x1={x + 7} y1={y - 7} x2={x - 7} y2={y + 7} stroke={t.s} strokeWidth={1} />
          <text x={x} y={y + 21} textAnchor="middle"
            fill={t.s} fontSize="6" fontFamily="monospace">{lbl}</text>
        </g>
      ))}

      {/* Panel as-built with circuit list */}
      <rect x={416} y={FP.top + 5} width={56} height={64}
        fill="rgba(0,0,0,0.9)" stroke={t.p} strokeWidth={2} />
      {['CKT 1', 'CKT 2', 'CKT 3', 'CKT 4', 'CKT 5', 'CKT 6'].map((c, i) => (
        <text key={i} x={444} y={FP.top + 13 + i * 8.5}
          textAnchor="middle"
          fill={i % 2 === 0 ? t.p : t.s}
          fontSize="5.5" fontFamily="monospace">{c} ✓</text>
      ))}
      <text x={444} y={FP.top + 74} textAnchor="middle"
        fill={t.a} fontSize="6" fontFamily="monospace" fontWeight="700">AS-BUILT</text>

      {/* Completion watermark */}
      <text x={(FP.left + FP.right) / 2} y={FP.bottom - 4}
        textAnchor="middle"
        fill={`${t.p}55`} fontSize="7.5" fontFamily="monospace" letterSpacing="2" fontWeight="700">
        CONSTRUCTION COMPLETE — AS-BUILT VERIFIED
      </text>
    </g>
  )
}

// ── Main Component ────────────────────────────────────────────────────

export default function BlueprintVRLandscapeViewer({ selectedStage }: BlueprintVRLandscapeViewerProps) {
  const theme  = THEMES[selectedStage]
  const legend = LEGEND[selectedStage]

  return (
    <div style={{
      width: '100%',
      background: '#06080F',
      borderRadius: 6,
      overflow: 'hidden',
      border: '1px solid rgba(0,229,204,0.12)',
    }}>
      <svg
        viewBox={`0 0 ${VW} ${VH}`}
        width="100%"
        style={{ display: 'block' }}
        preserveAspectRatio="xMidYMid meet"
        aria-label={`Electrical construction floor plan - ${theme.label} stage`}
      >
        <defs>
          <pattern id="vr-fp-grid" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(0,229,204,0.04)" strokeWidth="0.4" />
          </pattern>
        </defs>

        {/* Background */}
        <rect width={VW} height={VH} fill="url(#vr-fp-grid)" />

        {/* Stage indicator bar */}
        <rect x={0} y={0} width={VW} height={18} fill={`${theme.p}14`} />
        <text x={VW / 2} y={12} textAnchor="middle"
          fill={theme.p} fontSize="8" fontFamily="monospace" fontWeight="700" letterSpacing="2">
          ◆ {theme.label} PHASE — ELECTRICAL FLOOR PLAN ◆
        </text>

        {/* Floor plan base */}
        <FloorPlanBase />

        {/* Stage-specific electrical elements */}
        {selectedStage === 'underground' && <UndergroundLayer t={theme} />}
        {selectedStage === 'roughIn'     && <RoughInLayer     t={theme} />}
        {selectedStage === 'trim'        && <TrimLayer        t={theme} />}
        {selectedStage === 'finished'    && <FinishedLayer    t={theme} />}

        {/* Scale bar */}
        <line x1={FP.left + 5} y1={VH - 7} x2={FP.left + 45} y2={VH - 7}
          stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
        <line x1={FP.left + 5}  y1={VH - 10} x2={FP.left + 5}  y2={VH - 4}
          stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
        <line x1={FP.left + 45} y1={VH - 10} x2={FP.left + 45} y2={VH - 4}
          stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
        <text x={FP.left + 25} y={VH - 0} textAnchor="middle"
          fill="rgba(255,255,255,0.16)" fontSize="5.5" fontFamily="monospace">20′-0″</text>
      </svg>

      {/* Legend strip */}
      <div style={{
        display: 'flex',
        gap: 14,
        padding: '5px 12px',
        borderTop: `1px solid ${theme.p}22`,
        background: `${theme.p}0A`,
        flexWrap: 'wrap',
        alignItems: 'center',
      }}>
        {legend.map((item, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 8, height: 8, background: item.color, borderRadius: 1, flexShrink: 0 }} />
            <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, fontFamily: 'monospace' }}>
              {item.label}
            </span>
          </div>
        ))}
        <div style={{ marginLeft: 'auto', color: `${theme.p}99`, fontSize: 9, fontFamily: 'monospace', fontWeight: 700 }}>
          {theme.label}
        </div>
      </div>
    </div>
  )
}
