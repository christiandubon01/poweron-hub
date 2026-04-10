/**
 * FossilRecordLayer.tsx — NW60: Fossil Record — Archaeological history of completed projects.
 *
 * When a project is marked 'completed', its mountain sinks into the ground and leaves
 * a FOSSIL IMPRINT: a flat circular area with embedded geological patterns showing
 * compressed material history. Amber glow. Warm, like ancient preserved treasure.
 *
 * FOSSIL DETAIL (hover):
 *   - Project name + date range
 *   - Total contract value → fossil radius
 *   - Total hours logged → layer depth
 *   - Profit margin → gold-to-obsidian band ratio
 *   - Notes from project record
 *
 * EXCAVATION MODE (click):
 *   - Layers peel back one by one, each revealing a project phase
 *   - Phase 1: materials used, crew assigned, time spent
 *   - Phase 2: same breakdown
 *   - Final layer: profit summary, lessons, reusable patterns
 *
 * FOSSIL DENSITY:
 *   - Areas with many completed projects = dense fossil beds
 *   - Areas with no history = bare ground — no legacy
 *
 * Layer panel toggle: "Fossil Record" — OFF by default.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import { useWorldContext } from './WorldContext'
import {
  subscribeWorldData,
  seededPosition,
  type NWProject,
  type NWFieldLog,
  type NWWorldData,
} from './DataBridge'

// ── Types ─────────────────────────────────────────────────────────────────────

interface FossilRecordLayerProps {
  visible: boolean
}

interface FossilData {
  projectId: string
  project: NWProject
  /** seededPosition result */
  worldX: number
  worldZ: number
  /** computed radius from contract_value */
  radius: number
  /** total hours from field logs */
  totalHours: number
  /** profit margin 0–1 */
  profitMargin: number
  /** disk geometry group */
  group: THREE.Group
  /** concentric ring band meshes (geological layers, innermost to outermost) */
  bands: THREE.Mesh[]
  /** invisible hit disk for raycasting */
  hitDisk: THREE.Mesh
  /** ambient glow point light */
  glowLight: THREE.PointLight
  /** glow ring mesh */
  glowRing: THREE.Mesh
  /** excavation state */
  excavating: boolean
  excavationStep: number
  excavationTimer: number
}

interface HoverInfo {
  fossilId: string
  screenX: number
  screenY: number
}

interface ExcavationState {
  fossilId: string
  step: number          // 0 = not started, 1–4 = phase layers revealed
  screenX: number
  screenY: number
}

// ── Band color palette (geological layers) ────────────────────────────────────

// Outermost (index 0) → innermost (last) in the geological stack
// Gold = earned revenue, Obsidian = risk/cost, Diamond = potential, Ruby = expenses
const BAND_COLORS = [
  new THREE.Color(0x3a2a00),  // deep dark earth — outer ring
  new THREE.Color(0x1a1a2e),  // obsidian — risk/cost band
  new THREE.Color(0x4a1a00),  // dark ruby — expense band
  new THREE.Color(0x1a3a2e),  // compressed emerald — management band
  new THREE.Color(0x5a4400),  // compressed gold — earned band
  new THREE.Color(0x2a2a4e),  // compressed diamond — potential band
]

const AMBER_GLOW = new THREE.Color(0xff9940)
const AMBER_GLOW_SUBTLE = new THREE.Color(0xcc6820)

// ── Fossil size helpers ───────────────────────────────────────────────────────

function contractToRadius(value: number): number {
  if (value <= 0)      return 1.2
  if (value >= 500000) return 8.0
  if (value >= 100000) return 4.0 + (value - 100000) / 100000
  if (value >= 50000)  return 2.5 + (value - 50000) / 50000 * 1.5
  if (value >= 10000)  return 1.5 + (value - 10000) / 40000
  return 1.2 + (value / 10000) * 0.3
}

function computeProfitMargin(project: NWProject): number {
  const revenue = project.contract_value ?? 0
  const cost    = project.material_cost  ?? 0
  if (revenue <= 0) return 0.3
  const raw = (revenue - cost) / revenue
  return Math.max(0, Math.min(1, raw))
}

// ── Fossil band ring builder ──────────────────────────────────────────────────

function buildFossilGroup(
  radius:       number,
  profitMargin: number,
  worldX:       number,
  worldZ:       number,
): { group: THREE.Group; bands: THREE.Mesh[]; hitDisk: THREE.Mesh; glowRing: THREE.Mesh; glowLight: THREE.PointLight } {
  const group = new THREE.Group()
  group.position.set(worldX, 0.01, worldZ)

  const bands: THREE.Mesh[] = []
  const numBands = BAND_COLORS.length

  // Build concentric disk bands (cylinder slices)
  for (let i = 0; i < numBands; i++) {
    const outerR = radius * (1 - i / numBands)
    const innerR = radius * (1 - (i + 1) / numBands)
    const bandHeight = 0.04 + (i / numBands) * 0.12   // deeper layers = thicker

    // Mix color based on profit margin (gold vs obsidian)
    const baseColor = BAND_COLORS[i].clone()
    if (profitMargin > 0.5) {
      // Good margin → increase gold warmth on upper bands
      const goldBoost = (profitMargin - 0.5) * 1.4
      baseColor.r = Math.min(1, baseColor.r + goldBoost * 0.3)
      baseColor.g = Math.min(1, baseColor.g + goldBoost * 0.15)
    } else {
      // Poor margin → darken with obsidian tone
      const obsBoost = (0.5 - profitMargin) * 1.2
      baseColor.r = Math.max(0, baseColor.r - obsBoost * 0.15)
      baseColor.g = Math.max(0, baseColor.g - obsBoost * 0.1)
    }

    const geo = new THREE.CylinderGeometry(outerR, outerR, bandHeight, 48, 1, false)
    const mat = new THREE.MeshStandardMaterial({
      color:     baseColor,
      emissive:  baseColor.clone().multiplyScalar(0.18),
      metalness: 0.6 + i * 0.06,
      roughness: 0.5 - i * 0.05,
      transparent: true,
      opacity:   0.85,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.y = i * 0.02   // stack layers slightly above each other
    group.add(mesh)
    bands.push(mesh)

    // Thin separator ring between bands
    if (i < numBands - 1 && outerR > 0.3) {
      const sepGeo = new THREE.TorusGeometry(outerR, 0.025, 4, 48)
      const sepMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(0xcc8820),
        transparent: true,
        opacity: 0.45,
      })
      const sep = new THREE.Mesh(sepGeo, sepMat)
      sep.rotation.x = Math.PI / 2
      sep.position.y = i * 0.02 + bandHeight / 2
      group.add(sep)
    }
  }

  // Center pattern — compressed core crystal
  const coreGeo = new THREE.CylinderGeometry(radius * 0.08, radius * 0.1, 0.22, 6, 1)
  const coreMat = new THREE.MeshStandardMaterial({
    color:     new THREE.Color(0xffd060),
    emissive:  new THREE.Color(0xcc8820),
    metalness: 0.9,
    roughness: 0.1,
    transparent: true,
    opacity:   0.9,
  })
  const core = new THREE.Mesh(coreGeo, coreMat)
  core.position.y = 0.12
  group.add(core)

  // Outer amber glow ring (decorative torus)
  const glowGeo = new THREE.TorusGeometry(radius + 0.15, 0.06, 4, 64)
  const glowMat = new THREE.MeshBasicMaterial({
    color:       AMBER_GLOW_SUBTLE,
    transparent: true,
    opacity:     0.55,
  })
  const glowRing = new THREE.Mesh(glowGeo, glowMat)
  glowRing.rotation.x = Math.PI / 2
  glowRing.position.y = 0.06
  group.add(glowRing)

  // Point light for amber glow
  const glowLight = new THREE.PointLight(AMBER_GLOW, 0.6, radius * 6, 2)
  glowLight.position.set(0, 0.8, 0)
  group.add(glowLight)

  // Hit disk (invisible, for raycasting)
  const hitGeo = new THREE.CylinderGeometry(radius + 0.5, radius + 0.5, 0.5, 16, 1)
  const hitMat = new THREE.MeshBasicMaterial({ visible: false })
  const hitDisk = new THREE.Mesh(hitGeo, hitMat)
  hitDisk.position.y = 0.25
  group.add(hitDisk)

  return { group, bands, hitDisk, glowRing, glowLight }
}

// ── Hover tooltip ─────────────────────────────────────────────────────────────

interface TooltipProps {
  fossil:   FossilData
  screenX:  number
  screenY:  number
}

function FossilTooltip({ fossil, screenX, screenY }: TooltipProps) {
  const p = fossil.project
  const margin = Math.round(fossil.profitMargin * 100)
  const hoursStr = fossil.totalHours > 0 ? `${fossil.totalHours.toFixed(1)} hrs` : '—'
  const valueStr = p.contract_value > 0
    ? `$${p.contract_value.toLocaleString()}`
    : '—'
  const dateStr = p.created_at
    ? new Date(p.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : '—'

  // Clamp to viewport
  const clampedX = Math.min(screenX, window.innerWidth - 280)
  const clampedY = Math.max(screenY - 120, 8)

  return (
    <div style={{
      position:    'fixed',
      left:        clampedX + 16,
      top:         clampedY,
      zIndex:      9999,
      pointerEvents: 'none',
      width:       260,
    }}>
      <div style={{
        background:    'rgba(10, 6, 2, 0.92)',
        border:        '1px solid rgba(255, 153, 64, 0.5)',
        borderRadius:  6,
        padding:       '10px 14px',
        backdropFilter:'blur(12px)',
        boxShadow:     '0 0 20px rgba(255, 130, 40, 0.25)',
        fontFamily:    'monospace',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <div style={{
            width: 8, height: 8,
            borderRadius: '50%',
            background: '#ff9940',
            boxShadow:  '0 0 6px #ff9940',
            flexShrink: 0,
          }} />
          <div style={{ fontSize: 11, color: '#ffcc88', letterSpacing: 1, fontWeight: 700 }}>
            FOSSIL RECORD
          </div>
        </div>

        {/* Project name */}
        <div style={{ fontSize: 12, color: '#fff8e8', marginBottom: 6, fontWeight: 600, lineHeight: 1.3 }}>
          {p.name}
        </div>

        {/* Date */}
        <div style={{ fontSize: 10, color: 'rgba(255,200,120,0.6)', marginBottom: 8, letterSpacing: 0.5 }}>
          COMPLETED · {dateStr}
        </div>

        {/* Stats grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px' }}>
          <StatRow label="CONTRACT" value={valueStr} color="#ffcc44" />
          <StatRow label="HOURS"    value={hoursStr}  color="#88ccff" />
          <StatRow label="MARGIN"   value={`${margin}%`} color={margin > 40 ? '#88ff88' : margin > 20 ? '#ffcc44' : '#ff8866'} />
          <StatRow label="LAYERS"   value={`${fossil.bands.length}`} color="#cc88ff" />
        </div>

        {/* Click hint */}
        <div style={{
          marginTop:   8,
          paddingTop:  6,
          borderTop:   '1px solid rgba(255,153,64,0.2)',
          fontSize:    9,
          color:       'rgba(255,153,64,0.55)',
          letterSpacing: 1,
          textAlign:   'center',
        }}>
          CLICK TO EXCAVATE
        </div>
      </div>
    </div>
  )
}

function StatRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <>
      <div style={{ fontSize: 9, color: 'rgba(200,160,100,0.55)', letterSpacing: 1 }}>{label}</div>
      <div style={{ fontSize: 10, color, fontWeight: 600, textAlign: 'right' }}>{value}</div>
    </>
  )
}

// ── Excavation panel ──────────────────────────────────────────────────────────

interface ExcavationPanelProps {
  fossil:    FossilData
  step:      number
  onClose:   () => void
  onAdvance: () => void
  screenX:   number
  screenY:   number
}

const EXCAVATION_PHASE_LABELS = [
  'SURFACE LAYER — Project Overview',
  'STRATUM I — Phase 1 Material & Labor',
  'STRATUM II — Phase 2 Progress',
  'DEEP LAYER — Financial Summary',
  'CORE — Preserved Lessons',
]

function ExcavationPanel({ fossil, step, onClose, onAdvance, screenX, screenY }: ExcavationPanelProps) {
  const p = fossil.project
  const phase = EXCAVATION_PHASE_LABELS[Math.min(step - 1, EXCAVATION_PHASE_LABELS.length - 1)]
  const margin = Math.round(fossil.profitMargin * 100)

  // Panel position — clamp to viewport
  const panelW = 320
  const panelH = 400
  const px = Math.min(Math.max(screenX - panelW / 2, 12), window.innerWidth - panelW - 12)
  const py = Math.min(Math.max(screenY - panelH - 20, 12), window.innerHeight - panelH - 12)

  const isLastStep = step >= EXCAVATION_PHASE_LABELS.length

  return (
    <div style={{
      position:      'fixed',
      left:          px,
      top:           py,
      zIndex:        9999,
      width:         panelW,
      fontFamily:    'monospace',
      animation:     'nw60-excavate-in 0.35s ease-out',
    }}>
      {/* Inject keyframe once */}
      <style>{`
        @keyframes nw60-excavate-in {
          from { opacity: 0; transform: translateY(8px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0)   scale(1);    }
        }
        @keyframes nw60-layer-reveal {
          from { opacity: 0; transform: scaleX(0.85); }
          to   { opacity: 1; transform: scaleX(1);    }
        }
      `}</style>

      <div style={{
        background:    'rgba(8, 5, 2, 0.95)',
        border:        '1px solid rgba(255,153,64,0.6)',
        borderRadius:  8,
        backdropFilter:'blur(16px)',
        boxShadow:     '0 0 40px rgba(200,100,20,0.3), 0 0 80px rgba(200,100,20,0.1)',
        overflow:      'hidden',
      }}>
        {/* Title bar */}
        <div style={{
          display:         'flex',
          alignItems:      'center',
          justifyContent:  'space-between',
          padding:         '10px 14px',
          borderBottom:    '1px solid rgba(255,153,64,0.25)',
          background:      'rgba(255,100,20,0.08)',
        }}>
          <div>
            <div style={{ fontSize: 9, color: 'rgba(255,153,64,0.6)', letterSpacing: 2, marginBottom: 2 }}>
              ⛏ EXCAVATION MODE
            </div>
            <div style={{ fontSize: 12, color: '#ffcc88', fontWeight: 700, letterSpacing: 0.5 }}>
              {p.name}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background:  'none',
              border:      '1px solid rgba(255,153,64,0.3)',
              color:       'rgba(255,153,64,0.7)',
              borderRadius: 4,
              width:        26,
              height:       26,
              cursor:       'pointer',
              fontSize:     12,
              display:      'flex',
              alignItems:   'center',
              justifyContent: 'center',
            }}
          >✕</button>
        </div>

        {/* Stratum progress */}
        <div style={{ padding: '8px 14px', borderBottom: '1px solid rgba(255,153,64,0.12)' }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {EXCAVATION_PHASE_LABELS.map((_, i) => (
              <div key={i} style={{
                flex:         1,
                height:       3,
                borderRadius: 2,
                background:   i < step ? '#ff9940' : 'rgba(255,153,64,0.15)',
                transition:   'background 0.4s ease',
              }} />
            ))}
          </div>
          <div style={{ fontSize: 9, color: 'rgba(255,153,64,0.5)', letterSpacing: 1, marginTop: 5 }}>
            {phase}
          </div>
        </div>

        {/* Layer content */}
        <div style={{ padding: '12px 14px', minHeight: 200 }}>
          {step === 1 && (
            <ExcavationStep1 fossil={fossil} />
          )}
          {step === 2 && (
            <ExcavationStep2 fossil={fossil} />
          )}
          {step === 3 && (
            <ExcavationStep3 fossil={fossil} />
          )}
          {step === 4 && (
            <ExcavationStep4 fossil={fossil} margin={margin} />
          )}
          {step >= 5 && (
            <ExcavationStep5 fossil={fossil} margin={margin} />
          )}
        </div>

        {/* Controls */}
        <div style={{
          padding:      '8px 14px 12px',
          display:      'flex',
          gap:          8,
          borderTop:    '1px solid rgba(255,153,64,0.12)',
        }}>
          {!isLastStep && (
            <button
              onClick={onAdvance}
              style={{
                flex:          1,
                background:    'rgba(255,153,64,0.12)',
                border:        '1px solid rgba(255,153,64,0.4)',
                color:         '#ff9940',
                borderRadius:  4,
                padding:       '7px 12px',
                cursor:        'pointer',
                fontSize:      10,
                letterSpacing: 1.5,
                fontFamily:    'monospace',
                fontWeight:    600,
              }}
            >
              DIG DEEPER ▼
            </button>
          )}
          <button
            onClick={onClose}
            style={{
              background:    'rgba(255,255,255,0.04)',
              border:        '1px solid rgba(255,255,255,0.1)',
              color:         'rgba(255,255,255,0.35)',
              borderRadius:  4,
              padding:       '7px 12px',
              cursor:        'pointer',
              fontSize:      10,
              letterSpacing: 1.5,
              fontFamily:    'monospace',
              width:         isLastStep ? '100%' : undefined,
            }}
          >
            COVER FOSSIL
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Excavation step components ────────────────────────────────────────────────

function ExcavationStep1({ fossil }: { fossil: FossilData }) {
  const p = fossil.project
  return (
    <LayerReveal>
      <ExcavRow label="Status"       value="ARCHIVED — Completed" color="#88ff88" />
      <ExcavRow label="Contract"     value={p.contract_value > 0 ? `$${p.contract_value.toLocaleString()}` : '—'} color="#ffcc44" />
      <ExcavRow label="Created"      value={p.created_at ? new Date(p.created_at).toLocaleDateString() : '—'} color="#88ccff" />
      <ExcavRow label="Phase Done"   value={`${Math.round(p.phase_completion ?? 100)}%`} color="#cc88ff" />
      <ExcavRow label="Health Score" value={`${p.health_score ?? 100}/100`} color={p.health_score >= 80 ? '#88ff88' : '#ffaa44'} />
      <div style={{ marginTop: 10, fontSize: 9, color: 'rgba(255,180,80,0.5)', letterSpacing: 0.5 }}>
        Surface layer cleared. First stratum visible below.
      </div>
    </LayerReveal>
  )
}

function ExcavationStep2({ fossil }: { fossil: FossilData }) {
  const p = fossil.project
  const matCost = p.material_cost ?? 0
  const laborPct = Math.round(100 - (matCost / Math.max(p.contract_value, 1)) * 100)
  return (
    <LayerReveal>
      <div style={{ fontSize: 9, color: '#cc8844', letterSpacing: 1, marginBottom: 8 }}>
        ⬡ OBSIDIAN STRATUM — Cost Record
      </div>
      <ExcavRow label="Material Cost"  value={matCost > 0 ? `$${matCost.toLocaleString()}` : '—'} color="#ff8866" />
      <ExcavRow label="Labor Estimate" value={`~${Math.max(0, laborPct)}% of contract`} color="#ffcc44" />
      <ExcavRow label="Hours Logged"   value={fossil.totalHours > 0 ? `${fossil.totalHours.toFixed(1)} hrs` : '—'} color="#88ccff" />
      <ExcavRow label="Type"           value={p.type ?? 'General'} color="#cc88ff" />
      <div style={{ marginTop: 10, fontSize: 9, color: 'rgba(255,180,80,0.5)', letterSpacing: 0.5 }}>
        Obsidian band reveals material cost compression.
      </div>
    </LayerReveal>
  )
}

function ExcavationStep3({ fossil }: { fossil: FossilData }) {
  const p = fossil.project
  const completion = Math.round(p.phase_completion ?? 100)
  return (
    <LayerReveal>
      <div style={{ fontSize: 9, color: '#44aa88', letterSpacing: 1, marginBottom: 8 }}>
        ◈ EMERALD STRATUM — Execution Record
      </div>
      <ExcavRow label="Phase Completion" value={`${completion}%`}  color="#88ff88" />
      <ExcavRow label="Execution Band"   value={completion >= 95 ? 'FULL' : completion >= 70 ? 'PARTIAL' : 'INCOMPLETE'} color={completion >= 95 ? '#88ff88' : '#ffaa44'} />
      <ExcavRow label="Avg Hrs/Day"      value={fossil.totalHours > 0 ? `${(fossil.totalHours / 20).toFixed(1)} hrs` : '—'} color="#88ccff" />
      <div style={{ marginTop: 10, fontSize: 9, color: 'rgba(255,180,80,0.5)', letterSpacing: 0.5 }}>
        Emerald layer holds the management and execution history.
      </div>
    </LayerReveal>
  )
}

function ExcavationStep4({ fossil, margin }: { fossil: FossilData; margin: number }) {
  const p = fossil.project
  const revenue = p.contract_value ?? 0
  const cost    = p.material_cost  ?? 0
  const profit  = revenue - cost
  return (
    <LayerReveal>
      <div style={{ fontSize: 9, color: '#cc9900', letterSpacing: 1, marginBottom: 8 }}>
        ◆ GOLD STRATUM — Financial Core
      </div>
      <ExcavRow label="Total Revenue" value={revenue > 0 ? `$${revenue.toLocaleString()}` : '—'} color="#ffcc44" />
      <ExcavRow label="Total Cost"    value={cost > 0    ? `$${cost.toLocaleString()}`    : '—'} color="#ff8866" />
      <ExcavRow label="Gross Profit"  value={profit > 0  ? `$${profit.toLocaleString()}`  : '—'} color={profit > 0 ? '#88ff88' : '#ff6644'} />
      <ExcavRow label="Margin"        value={`${margin}%`} color={margin > 40 ? '#88ff88' : margin > 20 ? '#ffcc44' : '#ff8844'} />
      <div style={{ marginTop: 10, padding: '6px 8px', background: 'rgba(255,200,60,0.07)', borderRadius: 3, border: '1px solid rgba(255,200,60,0.15)' }}>
        <div style={{ fontSize: 9, color: '#cc9900', letterSpacing: 0.5 }}>
          Gold-to-Obsidian ratio: {margin}% gold / {100 - margin}% obsidian
        </div>
      </div>
    </LayerReveal>
  )
}

function ExcavationStep5({ fossil, margin }: { fossil: FossilData; margin: number }) {
  const p = fossil.project
  const performance = margin > 40 ? 'HIGH PERFORMER' : margin > 25 ? 'SOLID PROJECT' : margin > 10 ? 'MARGINAL' : 'BELOW TARGET'
  const perfColor   = margin > 40 ? '#88ff88' : margin > 25 ? '#ffcc44' : margin > 10 ? '#ffaa44' : '#ff6644'
  return (
    <LayerReveal>
      <div style={{ fontSize: 9, color: '#9966ff', letterSpacing: 1, marginBottom: 8 }}>
        ◉ DIAMOND CORE — Preserved Legacy
      </div>
      <div style={{
        background:   'rgba(160,100,255,0.08)',
        border:       '1px solid rgba(160,100,255,0.2)',
        borderRadius: 4,
        padding:      '8px 10px',
        marginBottom: 8,
      }}>
        <div style={{ fontSize: 10, color: perfColor, fontWeight: 700, letterSpacing: 1, marginBottom: 4 }}>
          {performance}
        </div>
        <div style={{ fontSize: 9, color: 'rgba(220,190,255,0.6)', lineHeight: 1.5 }}>
          {margin > 40
            ? 'Replicable pattern. Crew assignment and scope discipline made this project a benchmark.'
            : margin > 25
            ? 'Solid execution. Minor scope adjustments could push this into high-performer territory.'
            : margin > 10
            ? 'Margin compressed. Review material costs and labor hours for future similar work.'
            : 'Review scope definition and change order capture for future similar projects.'}
        </div>
      </div>
      <ExcavRow label="Project Type"   value={p.type ?? 'General'}  color="#cc88ff" />
      <ExcavRow label="Final Health"   value={`${p.health_score ?? 100}/100`} color="#88ccff" />
      <div style={{ marginTop: 8, fontSize: 9, color: 'rgba(160,100,255,0.5)', letterSpacing: 0.5, fontStyle: 'italic' }}>
        Diamond core preserved. This fossil is part of your permanent business record.
      </div>
    </LayerReveal>
  )
}

function LayerReveal({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      animation:  'nw60-layer-reveal 0.4s ease-out',
      lineHeight: 1.6,
    }}>
      {children}
    </div>
  )
}

function ExcavRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
      <span style={{ fontSize: 9, color: 'rgba(200,160,100,0.55)', letterSpacing: 0.8 }}>{label}</span>
      <span style={{ fontSize: 10, color, fontWeight: 600 }}>{value}</span>
    </div>
  )
}

// ── Dense bed density indicator (ground texture clustering) ──────────────────

function buildDensityCluster(
  cx: number,
  cz: number,
  count: number,
  scene: THREE.Scene,
): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = []
  // Scatter small mineral fragments around a dense fossil bed area
  const spread = Math.min(4 + count * 0.8, 12)
  const fragCount = Math.min(count * 3, 20)
  for (let i = 0; i < fragCount; i++) {
    const angle = (i / fragCount) * Math.PI * 2 + Math.random() * 0.5
    const r     = spread * (0.3 + Math.random() * 0.7)
    const fx    = cx + Math.cos(angle) * r
    const fz    = cz + Math.sin(angle) * r
    const size  = 0.06 + Math.random() * 0.12
    const geo   = new THREE.TetrahedronGeometry(size, 0)
    const mat   = new THREE.MeshStandardMaterial({
      color:     new THREE.Color(0xcc8820).lerp(new THREE.Color(0x1a1a2e), Math.random()),
      emissive:  new THREE.Color(0x220e00),
      metalness: 0.7,
      roughness: 0.3,
      transparent: true,
      opacity:   0.65,
    })
    const mesh  = new THREE.Mesh(geo, mat)
    mesh.position.set(fx, 0.03, fz)
    mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI)
    scene.add(mesh)
    meshes.push(mesh)
  }
  return meshes
}

// ── Main component ────────────────────────────────────────────────────────────

export function FossilRecordLayer({ visible }: FossilRecordLayerProps) {
  const { scene, camera, renderer } = useWorldContext()

  // Three.js fossil objects
  const fossilsRef          = useRef<Map<string, FossilData>>(new Map())
  const groupRef            = useRef<THREE.Group | null>(null)
  const densityMeshesRef    = useRef<THREE.Mesh[]>([])
  const raycasterRef        = useRef(new THREE.Raycaster())
  const mouseRef            = useRef(new THREE.Vector2(-9, -9))
  // Separate ref for screen-space mouse coords (THREE.Vector2 has no userData)
  const screenPosRef        = useRef<{ screenX: number; screenY: number }>({ screenX: 0, screenY: 0 })

  // React UI state
  const [hoverInfo,      setHoverInfo]      = useState<HoverInfo | null>(null)
  const [excavation,     setExcavation]     = useState<ExcavationState | null>(null)

  // ── Build / rebuild fossils when world data arrives ──────────────────────

  useEffect(() => {
    const group = new THREE.Group()
    group.visible = visible
    scene.add(group)
    groupRef.current = group

    const unsub = subscribeWorldData((data: NWWorldData) => {
      // Dispose old density meshes
      densityMeshesRef.current.forEach(m => {
        m.geometry.dispose()
        ;(m.material as THREE.Material).dispose()
        scene.remove(m)
      })
      densityMeshesRef.current = []

      // Dispose old fossils
      fossilsRef.current.forEach(f => {
        f.bands.forEach(b => { b.geometry.dispose(); (b.material as THREE.Material).dispose() })
        f.hitDisk.geometry.dispose(); (f.hitDisk.material as THREE.Material).dispose()
        f.glowRing.geometry.dispose(); (f.glowRing.material as THREE.Material).dispose()
        group.remove(f.group)
      })
      fossilsRef.current.clear()

      // Identify completed projects
      const completed = data.projects.filter(p => p.status === 'completed')

      // Compute hours per project
      const hoursByProject = new Map<string, number>()
      data.fieldLogs.forEach((fl: NWFieldLog) => {
        if (!fl.project_id) return
        hoursByProject.set(fl.project_id, (hoursByProject.get(fl.project_id) ?? 0) + fl.hours)
      })

      // Build zone density map (grid cells of ~15 units)
      const densityMap = new Map<string, { cx: number; cz: number; count: number }>()

      completed.forEach(p => {
        const pos    = seededPosition(p.id)
        const radius = contractToRadius(p.contract_value)
        const hours  = hoursByProject.get(p.id) ?? 0
        const margin = computeProfitMargin(p)

        const { group: fGroup, bands, hitDisk, glowRing, glowLight } =
          buildFossilGroup(radius, margin, pos.x, pos.z)
        group.add(fGroup)

        const fossil: FossilData = {
          projectId: p.id,
          project:   p,
          worldX:    pos.x,
          worldZ:    pos.z,
          radius,
          totalHours:   hours,
          profitMargin: margin,
          group:     fGroup,
          bands,
          hitDisk,
          glowRing,
          glowLight,
          excavating:      false,
          excavationStep:  0,
          excavationTimer: 0,
        }
        fossilsRef.current.set(p.id, fossil)

        // Track density grid
        const gx = Math.round(pos.x / 18)
        const gz = Math.round(pos.z / 18)
        const key = `${gx}_${gz}`
        const existing = densityMap.get(key)
        if (existing) {
          existing.count++
        } else {
          densityMap.set(key, { cx: gx * 18, cz: gz * 18, count: 1 })
        }
      })

      // Dense beds: 2+ fossils in same grid cell
      densityMap.forEach(cell => {
        if (cell.count >= 2) {
          const frags = buildDensityCluster(cell.cx, cell.cz, cell.count, scene)
          densityMeshesRef.current.push(...frags)
        }
      })
    })

    return () => {
      unsub()
      fossilsRef.current.forEach(f => {
        f.bands.forEach(b => { b.geometry.dispose(); (b.material as THREE.Material).dispose() })
        f.hitDisk.geometry.dispose(); (f.hitDisk.material as THREE.Material).dispose()
        f.glowRing.geometry.dispose(); (f.glowRing.material as THREE.Material).dispose()
      })
      fossilsRef.current.clear()
      densityMeshesRef.current.forEach(m => {
        m.geometry.dispose()
        ;(m.material as THREE.Material).dispose()
        scene.remove(m)
      })
      densityMeshesRef.current = []
      scene.remove(group)
    }
  }, [scene])

  // ── Visibility sync ──────────────────────────────────────────────────────

  useEffect(() => {
    if (groupRef.current) groupRef.current.visible = visible
    densityMeshesRef.current.forEach(m => { m.visible = visible })
    // Hide tooltip/excavation when layer goes off
    if (!visible) {
      setHoverInfo(null)
      setExcavation(null)
    }
  }, [visible])

  // ── Mouse move — raycaster hover ─────────────────────────────────────────

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!visible || !renderer) return
      const canvas = renderer.domElement
      const rect   = canvas.getBoundingClientRect()
      mouseRef.current.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1
      mouseRef.current.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1

      // Store screen position for tooltip
      screenPosRef.current = { screenX: e.clientX, screenY: e.clientY }
    }
    window.addEventListener('mousemove', onMouseMove)
    return () => window.removeEventListener('mousemove', onMouseMove)
  }, [visible, renderer])

  // ── Click — start excavation ─────────────────────────────────────────────

  const handleExcavationClose = useCallback(() => {
    setExcavation(null)
    setHoverInfo(null)
  }, [])

  const handleExcavationAdvance = useCallback(() => {
    setExcavation(prev => {
      if (!prev) return null
      return { ...prev, step: Math.min(prev.step + 1, EXCAVATION_PHASE_LABELS.length) }
    })
  }, [])

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!visible || !renderer || !camera) return
      const canvas = renderer.domElement
      const rect   = canvas.getBoundingClientRect()
      const mouse  = new THREE.Vector2(
         ((e.clientX - rect.left) / rect.width)  * 2 - 1,
        -((e.clientY - rect.top)  / rect.height) * 2 + 1,
      )
      raycasterRef.current.setFromCamera(mouse, camera)
      const hitMeshes: THREE.Mesh[] = []
      fossilsRef.current.forEach(f => hitMeshes.push(f.hitDisk))
      const hits = raycasterRef.current.intersectObjects(hitMeshes, false)
      if (hits.length === 0) return

      // Find which fossil was hit
      const hitMesh   = hits[0].object as THREE.Mesh
      const hitFossil = Array.from(fossilsRef.current.values()).find(f => f.hitDisk === hitMesh) ?? null
      if (!hitFossil) return

      // Project click position on screen
      const worldPos = new THREE.Vector3(hitFossil.worldX, 0.5, hitFossil.worldZ)
      worldPos.project(camera)
      const sx = ((worldPos.x + 1) / 2) * canvas.clientWidth
      const sy = ((-worldPos.y + 1) / 2) * canvas.clientHeight

      setExcavation({
        fossilId: hitFossil.projectId,
        step:     1,
        screenX:  sx,
        screenY:  sy,
      })
      setHoverInfo(null)

      // Trigger band-peel animation
      triggerBandPeel(hitFossil)
    }
    window.addEventListener('click', onClick)
    return () => window.removeEventListener('click', onClick)
  }, [visible, renderer, camera])

  // ── Band peel animation on excavation ────────────────────────────────────

  function triggerBandPeel(fossil: FossilData) {
    fossil.excavating = true
    fossil.excavationStep = 0
    // Stagger band lifts
    fossil.bands.forEach((band, i) => {
      const delay = i * 220
      setTimeout(() => {
        // Animate the band lifting slightly via userData flag
        band.userData.peeling = true
        band.userData.peelTarget = band.position.y + 0.3 + i * 0.12
        band.userData.peelStart  = band.position.y
        band.userData.peelT      = 0
      }, delay)
    })
  }

  // ── Frame loop: animations ────────────────────────────────────────────────

  useEffect(() => {
    let hoverCheckTimer = 0

    function onFrame() {
      if (!visible) return
      const t = performance.now() / 1000

      // Animate fossils
      fossilsRef.current.forEach((fossil, _id) => {
        // Glow pulse
        const glowMat = fossil.glowRing.material as THREE.MeshBasicMaterial
        const pulse = 0.35 + Math.sin(t * 1.8 + fossil.worldX * 0.1) * 0.2
        glowMat.opacity = pulse

        // Glow light intensity pulse
        fossil.glowLight.intensity = 0.3 + Math.sin(t * 1.4 + fossil.worldZ * 0.08) * 0.2

        // Band peel animations
        fossil.bands.forEach(band => {
          if (band.userData.peeling) {
            band.userData.peelT = Math.min(1, (band.userData.peelT ?? 0) + 0.05)
            const pt = easeOut(band.userData.peelT)
            band.position.y = band.userData.peelStart + (band.userData.peelTarget - band.userData.peelStart) * pt
            if (band.userData.peelT >= 1) {
              band.userData.peeling = false
            }
          }
        })
      })

      // Throttled hover detection (~8 Hz)
      hoverCheckTimer++
      if (hoverCheckTimer % 8 !== 0) return
      if (!camera || !renderer) return

      raycasterRef.current.setFromCamera(mouseRef.current, camera)
      const hitMeshes: THREE.Mesh[] = []
      fossilsRef.current.forEach(f => hitMeshes.push(f.hitDisk))
      const hits = raycasterRef.current.intersectObjects(hitMeshes, false)

      if (hits.length === 0) {
        setHoverInfo(null)
        return
      }

      const hitMesh      = hits[0].object as THREE.Mesh
      const hoveredFossil = Array.from(fossilsRef.current.values()).find(f => f.hitDisk === hitMesh) ?? null

      if (!hoveredFossil) {
        setHoverInfo(null)
        return
      }

      // If excavation panel for this fossil is open, don't show tooltip
      if (excavation && excavation.fossilId === hoveredFossil.projectId) {
        setHoverInfo(null)
        return
      }

      setHoverInfo({
        fossilId: hoveredFossil.projectId,
        screenX:  screenPosRef.current.screenX,
        screenY:  screenPosRef.current.screenY,
      })
    }

    window.addEventListener('nw:frame', onFrame)
    return () => window.removeEventListener('nw:frame', onFrame)
  }, [visible, camera, renderer, excavation])

  // ── Resolve hover/excavation fossil ─────────────────────────────────────

  const hoveredFossil   = hoverInfo   ? fossilsRef.current.get(hoverInfo.fossilId)   ?? null : null
  const excavatedFossil = excavation  ? fossilsRef.current.get(excavation.fossilId)  ?? null : null

  return (
    <>
      {/* Hover tooltip */}
      {hoveredFossil && hoverInfo && !excavation && (
        <FossilTooltip
          fossil={hoveredFossil}
          screenX={hoverInfo.screenX}
          screenY={hoverInfo.screenY}
        />
      )}

      {/* Excavation panel */}
      {excavatedFossil && excavation && (
        <ExcavationPanel
          fossil={excavatedFossil}
          step={excavation.step}
          onClose={handleExcavationClose}
          onAdvance={handleExcavationAdvance}
          screenX={excavation.screenX}
          screenY={excavation.screenY}
        />
      )}
    </>
  )
}

// ── Utility ───────────────────────────────────────────────────────────────────

function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}
