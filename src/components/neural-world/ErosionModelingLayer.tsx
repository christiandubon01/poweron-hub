/**
 * ErosionModelingLayer.tsx — NW55: Revenue decay visualization.
 *
 * Revenue sources erode over time without active maintenance.
 * Visualizes decay on project mountains and subscription towers when
 * no new activity is logged.
 *
 * EROSION STAGES (driven by days since last activity):
 *   Stage 0 (< 7 days):    healthy — no erosion
 *   Stage 1 (7–14 days):   hairline cracks on surface. Subtle.
 *   Stage 2 (14–30 days):  visible cracks, slight desaturation, small debris particles
 *   Stage 3 (30–60 days):  major cracks, significant desaturation, chunks falling, dust at base
 *   Stage 4 (60+ days):    near-rubble — mountain crumbling, barely recognizable
 *
 * TRIGGER SOURCES per project:
 *   - last field_log date      → 14+ days idle → surface cracks appear
 *   - last invoice date        → 30+ days idle → chunks break off peak
 *   - last crew assignment     → feeds composite erosion score
 *
 * SUBSCRIPTION TOWERS (hub_platform_events):
 *   - No payment event in 45+ days → rust patches (orange-brown material blend)
 *
 * RIVER EFFECT:
 *   - Sections fed by eroding projects → water thins and turns murky
 *
 * RESTORATION:
 *   - Cracks heal with 2s golden glow animation
 *   - Debris particles reverse (fly back up) over 3s
 *   - Color re-saturates over 3s
 *   - Dispatches 'nw:erosion-restored' for audio layer pickup
 *
 * LAYERS PANEL: "Erosion" toggle. ON by default.
 */

import React, { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { useWorldContext } from './WorldContext'
import {
  subscribeWorldData,
  seededPosition,
  contractValueToHeight,
  type NWWorldData,
  type NWProject,
  type NWFieldLog,
  type NWInvoice,
  type NWHubEvent,
} from './DataBridge'

// ── Constants ──────────────────────────────────────────────────────────────────

const RIVER_X = 0
const RIVER_Y = 0.45

// Erosion thresholds (days)
const STAGE1_DAYS = 7
const STAGE2_DAYS = 14
const STAGE3_DAYS = 30
const STAGE4_DAYS = 60

// Invoice-specific threshold (triggers chunk-break effect from peak)
const INVOICE_CRACK_DAYS = 30

// Subscription tower payment gap threshold
const SUB_RUST_DAYS = 45

// Visual constants
const CRACK_COLOR_DARK = new THREE.Color(0x1a0a00)
const DEBRIS_COLOR     = new THREE.Color(0x4a3822)
const DUST_COLOR       = new THREE.Color(0x5a4a30)
const RUST_COLOR       = new THREE.Color(0x8b3a0a)
const MURKY_COLOR      = new THREE.Color(0x3a2a10)
const GLOW_COLOR       = new THREE.Color(0xffcc44)

const RESTORATION_GLOW_DURATION = 2.0    // seconds
const RESTORATION_RESATURATE_DURATION = 3.0
const MAX_DEBRIS_PER_MOUNTAIN = 20
const DEBRIS_FALL_SPEED = 0.025

// ── Types ─────────────────────────────────────────────────────────────────────

interface ErosionRecord {
  projectId: string
  projectName: string
  stage: number
  daysSinceActivity: number
  daysSinceFieldLog: number
  daysSinceInvoice: number
  hasInvoiceCrack: boolean  // true if 30+ days no invoice
  worldX: number
  worldZ: number
  mountainHeight: number
}

interface DebrisParticle {
  velocity: THREE.Vector3
  originalY: number
  active: boolean
  restoring: boolean
  restoreTimer: number
}

interface MountainErosionObject {
  projectId: string
  stage: number
  group: THREE.Group
  crackLines: THREE.LineSegments | null
  desatOverlay: THREE.Mesh | null
  debrisPoints: THREE.Points | null
  debrisParticles: DebrisParticle[]
  debrisPositions: Float32Array
  dustCloud: THREE.Mesh | null
  peakCrack: THREE.LineSegments | null   // chunk-break from invoice gap
  restorationGlow: THREE.PointLight | null
  restorationTimer: number               // counts down in seconds
  resaturateTimer: number                // for color re-saturation
  worldX: number
  worldZ: number
  mountainHeight: number
}

interface TowerRustObject {
  subId: string
  mesh: THREE.Mesh
  worldX: number
  worldZ: number
}

interface RiverMurkObject {
  projectId: string
  mesh: THREE.Mesh
  riverZ: number
}

interface RestorationFlash {
  projectId: string
  projectName: string
  expiresAt: number
}

// ── Erosion Computation ────────────────────────────────────────────────────────

const MS_PER_DAY = 24 * 60 * 60 * 1000

function daysSince(dateStr: string | null, now: number): number {
  if (!dateStr) return 9999
  const t = new Date(dateStr).getTime()
  if (isNaN(t)) return 9999
  return Math.max(0, (now - t) / MS_PER_DAY)
}

function computeErosionStage(days: number): number {
  if (days < STAGE1_DAYS) return 0
  if (days < STAGE2_DAYS) return 1
  if (days < STAGE3_DAYS) return 2
  if (days < STAGE4_DAYS) return 3
  return 4
}

/** Derive per-project erosion records from world data. */
function computeErosionRecords(data: NWWorldData, now: number): ErosionRecord[] {
  const { projects, fieldLogs, invoices } = data

  // Index field logs by project_id for fast lookup
  const logsByProject = new Map<string, NWFieldLog[]>()
  for (const fl of fieldLogs) {
    if (!fl.project_id) continue
    const arr = logsByProject.get(fl.project_id) ?? []
    arr.push(fl)
    logsByProject.set(fl.project_id, arr)
  }

  // Index invoices by project_id
  const invoicesByProject = new Map<string, NWInvoice[]>()
  for (const inv of invoices) {
    if (!inv.project_id) continue
    const arr = invoicesByProject.get(inv.project_id) ?? []
    arr.push(inv)
    invoicesByProject.set(inv.project_id, arr)
  }

  const records: ErosionRecord[] = []

  const activeStatuses = new Set(['in_progress', 'approved', 'pending', 'estimate'])

  for (const p of projects) {
    // Only track active / in-progress projects for erosion
    if (!activeStatuses.has(p.status)) continue

    // Days since last field log for this project
    const projLogs = logsByProject.get(p.id) ?? []
    const latestLog = projLogs.reduce<NWFieldLog | null>((best, fl) => {
      if (!best || !best.log_date) return fl
      if (!fl.log_date) return best
      return fl.log_date > best.log_date ? fl : best
    }, null)
    const daysFieldLog = daysSince(latestLog?.log_date ?? null, now)

    // Days since last crew assignment (field log with crew_id)
    const crewLogs = projLogs.filter(fl => fl.crew_id != null)
    const latestCrewLog = crewLogs.reduce<NWFieldLog | null>((best, fl) => {
      if (!best || !best.log_date) return fl
      if (!fl.log_date) return best
      return fl.log_date > best.log_date ? fl : best
    }, null)
    const daysCrew = daysSince(latestCrewLog?.log_date ?? null, now)

    // Days since last invoice
    const projInvoices = invoicesByProject.get(p.id) ?? []
    const latestInvoice = projInvoices.reduce<NWInvoice | null>((best, inv) => {
      if (!best || !best.created_at) return inv
      if (!inv.created_at) return best
      return inv.created_at > best.created_at ? inv : best
    }, null)
    const daysInvoice = daysSince(latestInvoice?.created_at ?? null, now)

    // Composite: worst of field log and crew (these drive the primary erosion clock)
    const primaryDays = Math.min(daysFieldLog, daysCrew)
    // If a project was just created and has no logs at all, treat as newly active (not eroded)
    const daysSinceCreated = daysSince(p.created_at, now)
    const effectiveDays = projLogs.length === 0 && daysSinceCreated < STAGE2_DAYS
      ? daysSinceCreated
      : primaryDays

    const stage = computeErosionStage(effectiveDays)
    const hasInvoiceCrack = daysInvoice >= INVOICE_CRACK_DAYS

    const pos = seededPosition(p.id)
    const height = contractValueToHeight(p.contract_value)

    records.push({
      projectId: p.id,
      projectName: p.name,
      stage,
      daysSinceActivity: effectiveDays,
      daysSinceFieldLog: daysFieldLog,
      daysSinceInvoice: daysInvoice,
      hasInvoiceCrack,
      worldX: pos.x,
      worldZ: pos.z,
      mountainHeight: height,
    })
  }

  return records
}

/** Compute days since last hub payment event (proxy for subscription payment). */
function computeSubsLastPaymentDays(hubEvents: NWHubEvent[], now: number): Map<string, number> {
  const result = new Map<string, number>()
  // Group subscriber_joined events as "payment" signals by subscriber_id in payload
  const paymentEvents = hubEvents.filter(e =>
    e.event_type === 'subscriber_joined' || e.event_type === 'payment_received'
  )
  for (const ev of paymentEvents) {
    const subId = String(ev.payload?.subscriber_id ?? ev.id)
    const d = daysSince(ev.created_at, now)
    const existing = result.get(subId)
    if (existing === undefined || d < existing) {
      result.set(subId, d)
    }
  }
  return result
}

// ── Geometry Builders ──────────────────────────────────────────────────────────

/** Build jagged crack lines for a given erosion stage. */
function buildCrackLines(
  scene: THREE.Scene,
  x: number,
  z: number,
  height: number,
  stage: number
): THREE.LineSegments {
  const crackCount = stage === 1 ? 2 : stage === 2 ? 5 : stage === 3 ? 10 : 16
  const opacity    = stage === 1 ? 0.28 : stage === 2 ? 0.52 : stage === 3 ? 0.76 : 0.92
  const radius     = Math.max(0.5, height * 0.18)

  const positions: number[] = []

  // Generate crack lines spiraling up the mountain
  const rng = mulberry32(hashCode(x, z))
  for (let c = 0; c < crackCount; c++) {
    const angleStart = rng() * Math.PI * 2
    const angleSpread = 0.25 + rng() * 0.4
    const yStart = rng() * height * 0.15
    const yEnd   = yStart + height * (0.25 + rng() * 0.6)
    const segments = 3 + Math.floor(rng() * 4)

    let curAngle = angleStart
    let curY     = yStart
    const radiusAtY = (y: number) => radius * (1 - y / height)

    for (let s = 0; s < segments; s++) {
      const r0 = radiusAtY(curY)
      const ax0 = x + Math.cos(curAngle) * r0
      const az0 = z + Math.sin(curAngle) * r0

      curAngle += (rng() - 0.4) * angleSpread
      curY     += (yEnd - yStart) / segments + (rng() - 0.5) * 0.3
      curY      = Math.max(0.05, Math.min(height, curY))

      const r1 = radiusAtY(curY)
      const ax1 = x + Math.cos(curAngle) * r1
      const az1 = z + Math.sin(curAngle) * r1

      positions.push(ax0, curY - (yEnd - yStart) / segments, az0)
      positions.push(ax1, curY, az1)
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  const mat = new THREE.LineBasicMaterial({
    color: CRACK_COLOR_DARK,
    transparent: true,
    opacity,
    depthWrite: false,
    linewidth: 1,
  })
  const lines = new THREE.LineSegments(geo, mat)
  scene.add(lines)
  return lines
}

/** Build peak-crack geometry (chunk break from invoice gap). */
function buildPeakCrack(
  scene: THREE.Scene,
  x: number,
  z: number,
  height: number
): THREE.LineSegments {
  const positions: number[] = []
  const rng = mulberry32(hashCode(x + 100, z + 100))

  // Radiating crack lines from mountain peak
  const crackCount = 4 + Math.floor(rng() * 3)
  for (let i = 0; i < crackCount; i++) {
    const angle = (i / crackCount) * Math.PI * 2 + rng() * 0.4
    const len   = 0.5 + rng() * 1.2
    const r0    = 0
    const r1    = len
    const yBase = height - rng() * 0.6

    positions.push(x + Math.cos(angle) * r0, yBase, z + Math.sin(angle) * r0)
    positions.push(x + Math.cos(angle) * r1, yBase - len * 0.4, z + Math.sin(angle) * r1)
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  const mat = new THREE.LineBasicMaterial({
    color: new THREE.Color(0x2a1000),
    transparent: true,
    opacity: 0.88,
    depthWrite: false,
  })
  const lines = new THREE.LineSegments(geo, mat)
  scene.add(lines)
  return lines
}

/** Build a desaturation overlay cone at the mountain position. */
function buildDesatOverlay(
  scene: THREE.Scene,
  x: number,
  z: number,
  height: number,
  stage: number
): THREE.Mesh {
  const opacity = stage === 1 ? 0.06 : stage === 2 ? 0.14 : stage === 3 ? 0.22 : 0.32
  const geo = new THREE.ConeGeometry(Math.max(0.4, height * 0.25), height, 8)
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0x808080),
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.set(x, height / 2, z)
  scene.add(mesh)
  return mesh
}

/** Build falling debris particle system. */
function buildDebrisSystem(
  scene: THREE.Scene,
  x: number,
  z: number,
  height: number,
  stage: number
): { points: THREE.Points; particles: DebrisParticle[]; positions: Float32Array } {
  const count = stage === 2 ? 6 : stage === 3 ? 14 : 20
  const actual = Math.min(count, MAX_DEBRIS_PER_MOUNTAIN)

  const positions = new Float32Array(actual * 3)
  const particles: DebrisParticle[] = []
  const rng = mulberry32(hashCode(x + 50, z + 50))

  for (let i = 0; i < actual; i++) {
    const angle = rng() * Math.PI * 2
    const dist  = rng() * height * 0.2
    const yStart = height * (0.4 + rng() * 0.5)

    positions[i * 3]     = x + Math.cos(angle) * dist
    positions[i * 3 + 1] = yStart
    positions[i * 3 + 2] = z + Math.sin(angle) * dist

    particles.push({
      velocity: new THREE.Vector3(
        (rng() - 0.5) * 0.04,
        -(0.01 + rng() * DEBRIS_FALL_SPEED),
        (rng() - 0.5) * 0.04
      ),
      originalY: yStart,
      active: true,
      restoring: false,
      restoreTimer: 0,
    })
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  const mat = new THREE.PointsMaterial({
    color: DEBRIS_COLOR,
    size: stage >= 3 ? 0.32 : 0.18,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
    sizeAttenuation: true,
  })
  const points = new THREE.Points(geo, mat)
  scene.add(points)

  return { points, particles, positions }
}

/** Build dust cloud plane at mountain base (stage 3+). */
function buildDustCloud(
  scene: THREE.Scene,
  x: number,
  z: number,
  height: number
): THREE.Mesh {
  const radius = Math.max(1.0, height * 0.35)
  const geo = new THREE.CircleGeometry(radius, 12)
  const mat = new THREE.MeshBasicMaterial({
    color: DUST_COLOR,
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.set(x, 0.08, z)
  scene.add(mesh)
  return mesh
}

/** Build rust patch torus for subscription tower. */
function buildRustPatch(
  scene: THREE.Scene,
  x: number,
  z: number,
  towerHeight: number
): THREE.Mesh {
  const geo = new THREE.TorusGeometry(0.8, 0.18, 6, 14)
  const mat = new THREE.MeshLambertMaterial({
    color: RUST_COLOR,
    emissive: RUST_COLOR.clone().multiplyScalar(0.22),
    transparent: true,
    opacity: 0.75,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.set(x, towerHeight * 0.55, z)
  scene.add(mesh)
  return mesh
}

/** Build murky river overlay at a river Z position fed by an eroding project. */
function buildMurkyRiverSection(
  scene: THREE.Scene,
  riverZ: number,
  stage: number
): THREE.Mesh {
  const length = 8 + stage * 4
  const width  = 4 + stage * 1.5
  const opacity = 0.12 + stage * 0.07
  const geo = new THREE.PlaneGeometry(width, length)
  const mat = new THREE.MeshBasicMaterial({
    color: MURKY_COLOR,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.NormalBlending,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.set(RIVER_X, RIVER_Y + 0.06, riverZ)
  scene.add(mesh)
  return mesh
}

// ── Simple seeded RNG (mulberry32) ────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let s = seed | 0
  return function () {
    s += 0x6d2b79f5
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 0xffffffff
  }
}

function hashCode(x: number, z: number): number {
  const xi = Math.round(x * 100)
  const zi = Math.round(z * 100)
  let h = 0xdeadbeef ^ xi
  h = Math.imul(h ^ zi, 2654435761)
  h = Math.imul(h ^ (h >>> 16), 2246822507)
  return (h >>> 0)
}

// ── Restoration Panel ─────────────────────────────────────────────────────────

interface RestorationPanelProps {
  flashes: RestorationFlash[]
  onDismiss: (id: string) => void
}

function RestorationPanel({ flashes, onDismiss }: RestorationPanelProps) {
  if (flashes.length === 0) return null

  return (
    <div style={{
      position: 'absolute',
      top: 80,
      right: 14,
      zIndex: 32,
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      pointerEvents: 'none',
    }}>
      {flashes.map(fl => (
        <div
          key={fl.projectId}
          style={{
            background: 'rgba(3, 8, 0, 0.92)',
            border: '1px solid rgba(255,200,64,0.6)',
            borderRadius: 6,
            padding: '8px 12px',
            fontFamily: 'monospace',
            boxShadow: '0 0 20px rgba(255,200,64,0.3)',
            animation: 'nw-erosion-restore-in 0.3s ease',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            pointerEvents: 'auto',
            cursor: 'pointer',
          }}
          onClick={() => onDismiss(fl.projectId)}
        >
          <span style={{ fontSize: 14, color: '#ffcc44' }}>✦</span>
          <div>
            <div style={{ fontSize: 9, color: 'rgba(255,200,64,0.5)', letterSpacing: 1.5, marginBottom: 1 }}>
              EROSION HEALED
            </div>
            <div style={{ fontSize: 11, color: '#ffcc44', letterSpacing: 0.5 }}>
              {fl.projectName}
            </div>
          </div>
        </div>
      ))}

      <style>{`
        @keyframes nw-erosion-restore-in {
          from { transform: translateX(40px); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
    </div>
  )
}

// ── ErosionStatusPanel (HUD summary) ──────────────────────────────────────────

interface ErosionStatusPanelProps {
  records: ErosionRecord[]
  visible: boolean
}

function ErosionStatusPanel({ records, visible }: ErosionStatusPanelProps) {
  const [open, setOpen] = useState(false)
  if (!visible) return null

  const eroding = records.filter(r => r.stage > 0)
  if (eroding.length === 0 && !open) return null

  const stageColor = (s: number) =>
    s === 4 ? '#ff3333' : s === 3 ? '#ff7722' : s === 2 ? '#ffaa00' : '#ffe566'

  const stageLabel = (s: number) =>
    s === 4 ? 'RUBBLE' : s === 3 ? 'CRUMBLING' : s === 2 ? 'CRACKED' : 'HAIRLINE'

  return (
    <div style={{
      position: 'absolute',
      bottom: 140,
      left: 14,
      zIndex: 32,
    }}>
      {/* Summary pill */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '5px 10px',
          borderRadius: 5,
          border: `1px solid ${eroding.length > 0 ? 'rgba(255,100,0,0.55)' : 'rgba(0,229,204,0.3)'}`,
          background: eroding.length > 0 ? 'rgba(20,5,0,0.88)' : 'rgba(0,5,0,0.85)',
          color: eroding.length > 0 ? '#ff8844' : 'rgba(0,229,204,0.6)',
          cursor: 'pointer',
          fontSize: 9,
          fontFamily: 'monospace',
          fontWeight: 700,
          letterSpacing: 1.5,
          backdropFilter: 'blur(8px)',
          transition: 'all 0.15s',
        }}
        title="Erosion Model — revenue decay by project"
      >
        <span style={{ fontSize: 11 }}>⛰</span>
        EROSION {eroding.length > 0 ? `(${eroding.length} ACTIVE)` : 'CLEAR'}
      </button>

      {/* Expanded panel */}
      {open && (
        <div style={{
          position: 'absolute',
          bottom: 36,
          left: 0,
          width: 280,
          background: 'rgba(3, 8, 2, 0.95)',
          border: '1px solid rgba(255,100,0,0.35)',
          borderRadius: 7,
          backdropFilter: 'blur(12px)',
          fontFamily: 'monospace',
          overflow: 'hidden',
          boxShadow: '0 0 24px rgba(255,100,0,0.15), 0 4px 24px rgba(0,0,0,0.8)',
        }}>
          <div style={{
            padding: '9px 12px 7px',
            borderBottom: '1px solid rgba(255,100,0,0.18)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <div>
              <div style={{ fontSize: 9, color: 'rgba(255,100,0,0.45)', letterSpacing: 2 }}>
                EROSION MODEL · NW55
              </div>
              <div style={{ fontSize: 12, color: '#ff8844', letterSpacing: 1.2, fontWeight: 700 }}>
                REVENUE DECAY MONITOR
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              style={{
                background: 'none',
                border: 'none',
                color: 'rgba(255,100,0,0.45)',
                fontSize: 14,
                cursor: 'pointer',
                padding: '2px 6px',
              }}
            >✕</button>
          </div>

          {/* Eroding projects list */}
          <div style={{ maxHeight: 260, overflowY: 'auto', padding: '8px 0' }}>
            {eroding.length === 0 ? (
              <div style={{ padding: '10px 12px', fontSize: 10, color: 'rgba(0,229,204,0.5)', letterSpacing: 1 }}>
                All active projects healthy — no erosion detected.
              </div>
            ) : (
              eroding
                .sort((a, b) => b.stage - a.stage || b.daysSinceActivity - a.daysSinceActivity)
                .map(r => (
                  <div key={r.projectId} style={{
                    padding: '6px 12px',
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}>
                    {/* Stage indicator */}
                    <div style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: stageColor(r.stage),
                      boxShadow: `0 0 6px ${stageColor(r.stage)}88`,
                      flexShrink: 0,
                    }} />

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 10,
                        color: 'rgba(255,255,255,0.8)',
                        fontWeight: 700,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        letterSpacing: 0.3,
                      }}>
                        {r.projectName}
                      </div>
                      <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', letterSpacing: 0.5, marginTop: 1 }}>
                        {Math.round(r.daysSinceActivity)}d idle ·{' '}
                        {r.hasInvoiceCrack ? `${Math.round(r.daysSinceInvoice)}d no invoice · ` : ''}
                        {stageLabel(r.stage)}
                      </div>
                    </div>

                    {/* Stage badge */}
                    <div style={{
                      fontSize: 9,
                      color: stageColor(r.stage),
                      border: `1px solid ${stageColor(r.stage)}66`,
                      borderRadius: 3,
                      padding: '1px 5px',
                      letterSpacing: 0.8,
                      flexShrink: 0,
                      fontWeight: 700,
                    }}>
                      S{r.stage}
                    </div>
                  </div>
                ))
            )}
          </div>

          {/* Footer legend */}
          <div style={{ padding: '7px 12px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', letterSpacing: 0.8, lineHeight: 1.6 }}>
              S1 hairline · S2 cracked · S3 crumbling · S4 rubble<br/>
              Log field activity to restore mountain health.
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

interface ErosionModelingLayerProps {
  visible: boolean
}

export function ErosionModelingLayer({ visible }: ErosionModelingLayerProps) {
  const { scene } = useWorldContext()

  // ── Scene object refs ──────────────────────────────────────────────────────
  const mountainObjectsRef = useRef<Map<string, MountainErosionObject>>(new Map())
  const towerRustObjectsRef = useRef<TowerRustObject[]>([])
  const riverMurkObjectsRef = useRef<RiverMurkObject[]>([])
  const groupRef = useRef<THREE.Group | null>(null)

  // ── State for React overlays ───────────────────────────────────────────────
  const [erosionRecords, setErosionRecords] = useState<ErosionRecord[]>([])
  const [restorationFlashes, setRestorationFlashes] = useState<RestorationFlash[]>([])

  // Previous stage tracking for restoration detection
  const prevStagesRef = useRef<Map<string, number>>(new Map())

  // Elapsed time for animations
  const elapsedRef = useRef(0)

  // ── Dispose helpers ────────────────────────────────────────────────────────

  function disposeMesh(m: THREE.Object3D | null) {
    if (!m) return
    scene.remove(m)
    if ((m as THREE.Mesh).geometry) (m as THREE.Mesh).geometry.dispose()
    const mat = (m as THREE.Mesh).material
    if (mat) {
      if (Array.isArray(mat)) mat.forEach(x => x.dispose())
      else mat.dispose()
    }
    if ((m as THREE.Points).material) {
      const pm = (m as THREE.Points).material as THREE.PointsMaterial
      pm.dispose()
    }
  }

  function disposeErosionObject(obj: MountainErosionObject) {
    if (obj.crackLines) { disposeMesh(obj.crackLines); obj.crackLines = null }
    if (obj.desatOverlay) { disposeMesh(obj.desatOverlay); obj.desatOverlay = null }
    if (obj.debrisPoints) { disposeMesh(obj.debrisPoints); obj.debrisPoints = null }
    if (obj.dustCloud) { disposeMesh(obj.dustCloud); obj.dustCloud = null }
    if (obj.peakCrack) { disposeMesh(obj.peakCrack); obj.peakCrack = null }
    if (obj.restorationGlow) { scene.remove(obj.restorationGlow); obj.restorationGlow = null }
    scene.remove(obj.group)
  }

  function disposeAll() {
    mountainObjectsRef.current.forEach(obj => disposeErosionObject(obj))
    mountainObjectsRef.current.clear()

    towerRustObjectsRef.current.forEach(r => disposeMesh(r.mesh))
    towerRustObjectsRef.current = []

    riverMurkObjectsRef.current.forEach(m => disposeMesh(m.mesh))
    riverMurkObjectsRef.current = []
  }

  // ── Build / update erosion objects from records ────────────────────────────

  function buildOrUpdateMountain(rec: ErosionRecord) {
    const existing = mountainObjectsRef.current.get(rec.projectId)
    const prevStage = existing?.stage ?? -1

    // Restoration detected
    if (prevStage > 0 && rec.stage === 0) {
      triggerRestoration(rec, existing)
    }

    // Same stage — only update restoration/animation timers, don't rebuild
    if (existing && existing.stage === rec.stage) {
      return
    }

    // Rebuild (stage changed or new)
    if (existing) {
      disposeErosionObject(existing)
      mountainObjectsRef.current.delete(rec.projectId)
    }

    if (rec.stage === 0) return   // no erosion — nothing to show

    const grp = new THREE.Group()
    grp.visible = visible
    scene.add(grp)

    const obj: MountainErosionObject = {
      projectId: rec.projectId,
      stage: rec.stage,
      group: grp,
      crackLines: null,
      desatOverlay: null,
      debrisPoints: null,
      debrisParticles: [],
      debrisPositions: new Float32Array(0),
      dustCloud: null,
      peakCrack: null,
      restorationGlow: null,
      restorationTimer: 0,
      resaturateTimer: 0,
      worldX: rec.worldX,
      worldZ: rec.worldZ,
      mountainHeight: rec.mountainHeight,
    }

    // Stage 1+: crack lines
    if (rec.stage >= 1) {
      obj.crackLines = buildCrackLines(scene, rec.worldX, rec.worldZ, rec.mountainHeight, rec.stage)
    }

    // Stage 2+: desaturation overlay + debris
    if (rec.stage >= 2) {
      obj.desatOverlay = buildDesatOverlay(scene, rec.worldX, rec.worldZ, rec.mountainHeight, rec.stage)
      const debris = buildDebrisSystem(scene, rec.worldX, rec.worldZ, rec.mountainHeight, rec.stage)
      obj.debrisPoints = debris.points
      obj.debrisParticles = debris.particles
      obj.debrisPositions = debris.positions
    }

    // Stage 3+: dust cloud + invoice peak crack
    if (rec.stage >= 3) {
      obj.dustCloud = buildDustCloud(scene, rec.worldX, rec.worldZ, rec.mountainHeight)
    }

    // Invoice gap: peak crack (30+ days no invoice)
    if (rec.hasInvoiceCrack && rec.stage >= 2) {
      obj.peakCrack = buildPeakCrack(scene, rec.worldX, rec.worldZ, rec.mountainHeight)
    }

    mountainObjectsRef.current.set(rec.projectId, obj)
  }

  /** Trigger restoration animation on a previously eroding mountain. */
  function triggerRestoration(rec: ErosionRecord, prevObj: MountainErosionObject | undefined) {
    // Create a temporary golden glow at mountain peak
    const glow = new THREE.PointLight(GLOW_COLOR, 2.8, rec.mountainHeight * 6 + 8)
    glow.position.set(rec.worldX, rec.mountainHeight + 1.5, rec.worldZ)
    scene.add(glow)

    if (prevObj) {
      prevObj.restorationGlow = glow
      prevObj.restorationTimer = RESTORATION_GLOW_DURATION
      prevObj.resaturateTimer  = RESTORATION_RESATURATE_DURATION
      // Mark debris particles for reversal
      for (const p of prevObj.debrisParticles) {
        p.restoring = true
        p.restoreTimer = RESTORATION_RESATURATE_DURATION
      }
    } else {
      // No prevObj — animate the glow directly and remove after duration
      let elapsed = 0
      function fadeGlow() {
        elapsed += 0.016
        glow.intensity = 2.8 * Math.max(0, 1 - elapsed / RESTORATION_GLOW_DURATION)
        if (elapsed < RESTORATION_GLOW_DURATION) {
          requestAnimationFrame(fadeGlow)
        } else {
          scene.remove(glow)
        }
      }
      requestAnimationFrame(fadeGlow)
    }

    // Show restoration flash in UI
    setRestorationFlashes(prev => [
      ...prev.filter(f => f.projectId !== rec.projectId),
      { projectId: rec.projectId, projectName: rec.projectName, expiresAt: Date.now() + 4000 },
    ])

    // Audio dispatch — SonicLandscape can pick this up
    window.dispatchEvent(new CustomEvent('nw:erosion-restored', {
      detail: { projectId: rec.projectId, projectName: rec.projectName },
    }))
  }

  /** Rebuild subscription tower rust patches from hub events. */
  function buildTowerRust(data: NWWorldData, now: number) {
    // Dispose old rust patches
    towerRustObjectsRef.current.forEach(r => disposeMesh(r.mesh))
    towerRustObjectsRef.current = []

    const subPaymentDays = computeSubsLastPaymentDays(data.hubEvents, now)

    // For each subscriber with a long payment gap, place a rust patch at their tower position
    // We use a seeded position derived from subscriber ID
    let towerIndex = 0
    for (const [subId, days] of subPaymentDays) {
      if (days < SUB_RUST_DAYS) continue

      // Derive a tower position (mirrors EastContinentLayer grid logic, tier 2 / mid-range)
      const tierIndex = 1  // tier 1 = "growth" band
      const eastXMin = 35
      const eastXMax = 185
      const eastZMin = -180
      const eastZMax = 180
      const bandZ = eastZMin + (tierIndex + 0.5) * ((eastZMax - eastZMin) / 5)
      const bandZHalf = (eastZMax - eastZMin) / 5 / 2
      const rng = mulberry32(hashCode(towerIndex * 37 + 13, towerIndex * 91))
      const zOff = (rng() - 0.5) * bandZHalf * 1.6
      const xSpan = eastXMax - eastXMin
      const xOff = (towerIndex % 8) / Math.max(1, 7) * xSpan * 0.85 + eastXMin + xSpan * 0.075

      const towerHeight = 4 + (days / 30) * 0.5  // rough height estimate

      const rustMesh = buildRustPatch(scene, xOff, bandZ + zOff, towerHeight)
      towerRustObjectsRef.current.push({ subId, mesh: rustMesh, worldX: xOff, worldZ: bandZ + zOff })
      towerIndex++
      if (towerIndex > 12) break  // cap at 12 rust patches for performance
    }
  }

  /** Rebuild murky river sections from eroding projects. */
  function buildRiverMurk(records: ErosionRecord[]) {
    riverMurkObjectsRef.current.forEach(m => disposeMesh(m.mesh))
    riverMurkObjectsRef.current = []

    const erodingProjects = records.filter(r => r.stage >= 2)
    for (const r of erodingProjects.slice(0, 8)) {
      // River Z section matches project Z position (tributaries from seededPosition)
      const riverZ = r.worldZ
      const murkMesh = buildMurkyRiverSection(scene, riverZ, r.stage)
      riverMurkObjectsRef.current.push({ projectId: r.projectId, mesh: murkMesh, riverZ })
    }
  }

  // ── World data subscription ────────────────────────────────────────────────

  useEffect(() => {
    const unsub = subscribeWorldData((data: NWWorldData) => {
      const now = Date.now()
      const records = computeErosionRecords(data, now)

      setErosionRecords(records)

      // Build / update mountain erosion objects
      const incomingIds = new Set(records.map(r => r.projectId))

      // Remove mountains no longer tracked
      for (const [id, obj] of mountainObjectsRef.current) {
        if (!incomingIds.has(id)) {
          disposeErosionObject(obj)
          mountainObjectsRef.current.delete(id)
          prevStagesRef.current.delete(id)
        }
      }

      // Build or update each mountain
      for (const rec of records) {
        buildOrUpdateMountain(rec)
        prevStagesRef.current.set(rec.projectId, rec.stage)
      }

      // Subscription tower rust
      buildTowerRust(data, now)

      // River murky sections
      buildRiverMurk(records)

      // Update visibility based on `visible` prop for all new objects
      mountainObjectsRef.current.forEach(obj => {
        obj.group.visible = visible
      })
      towerRustObjectsRef.current.forEach(r => {
        r.mesh.visible = visible
      })
      riverMurkObjectsRef.current.forEach(m => {
        m.mesh.visible = visible
      })
    })

    return () => {
      unsub()
      disposeAll()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene])

  // ── Visibility toggle ──────────────────────────────────────────────────────

  useEffect(() => {
    mountainObjectsRef.current.forEach(obj => {
      obj.group.visible = visible
      if (obj.crackLines) obj.crackLines.visible = visible
      if (obj.desatOverlay) obj.desatOverlay.visible = visible
      if (obj.debrisPoints) obj.debrisPoints.visible = visible
      if (obj.dustCloud) obj.dustCloud.visible = visible
      if (obj.peakCrack) obj.peakCrack.visible = visible
      if (obj.restorationGlow) obj.restorationGlow.visible = visible
    })
    towerRustObjectsRef.current.forEach(r => { r.mesh.visible = visible })
    riverMurkObjectsRef.current.forEach(m => { m.mesh.visible = visible })
  }, [visible])

  // ── Animation loop ─────────────────────────────────────────────────────────

  useEffect(() => {
    function onFrame() {
      if (!visible) return

      elapsedRef.current += 0.016

      const t = elapsedRef.current

      mountainObjectsRef.current.forEach(obj => {
        // ── Animate crack line flicker (subtle) ─────────────────────────────
        if (obj.crackLines) {
          const mat = obj.crackLines.material as THREE.LineBasicMaterial
          const baseOpacity = obj.stage === 1 ? 0.28 : obj.stage === 2 ? 0.52 : obj.stage === 3 ? 0.76 : 0.92
          mat.opacity = baseOpacity + Math.sin(t * 1.4 + obj.worldX * 0.3) * 0.06
        }

        // ── Animate desaturation overlay pulse ──────────────────────────────
        if (obj.desatOverlay) {
          const mat = obj.desatOverlay.material as THREE.MeshBasicMaterial
          const baseOpacity = obj.stage === 2 ? 0.14 : obj.stage === 3 ? 0.22 : 0.32
          mat.opacity = baseOpacity + Math.sin(t * 0.7 + obj.worldZ * 0.2) * 0.03

          // Re-saturation animation (restoration)
          if (obj.resaturateTimer > 0) {
            const progress = 1 - obj.resaturateTimer / RESTORATION_RESATURATE_DURATION
            mat.opacity = baseOpacity * (1 - progress)
            obj.resaturateTimer = Math.max(0, obj.resaturateTimer - 0.016)
          }
        }

        // ── Animate debris particles ─────────────────────────────────────────
        if (obj.debrisPoints && obj.debrisParticles.length > 0) {
          const geo = obj.debrisPoints.geometry as THREE.BufferGeometry
          const posAttr = geo.getAttribute('position') as THREE.BufferAttribute

          for (let i = 0; i < obj.debrisParticles.length; i++) {
            const p = obj.debrisParticles[i]
            if (!p.active) continue

            const xi = i * 3
            const yi = i * 3 + 1
            const zi = i * 3 + 2

            if (p.restoring) {
              // Fly back up toward original height
              posAttr.setY(i, posAttr.getY(i) + 0.04)
              p.restoreTimer = Math.max(0, p.restoreTimer - 0.016)
              if (posAttr.getY(i) >= p.originalY || p.restoreTimer <= 0) {
                posAttr.setX(i, obj.worldX + (Math.random() - 0.5) * obj.mountainHeight * 0.15)
                posAttr.setY(i, p.originalY)
                posAttr.setZ(i, obj.worldZ + (Math.random() - 0.5) * obj.mountainHeight * 0.15)
                p.restoring = false
              }
            } else {
              // Fall downward
              posAttr.setX(i, posAttr.getX(i) + p.velocity.x)
              posAttr.setY(i, posAttr.getY(i) + p.velocity.y)
              posAttr.setZ(i, posAttr.getZ(i) + p.velocity.z)

              // Respawn when particle hits ground
              if (posAttr.getY(i) < 0.1) {
                posAttr.setX(i, obj.worldX + (Math.random() - 0.5) * obj.mountainHeight * 0.2)
                posAttr.setY(i, p.originalY + Math.random() * 0.5)
                posAttr.setZ(i, obj.worldZ + (Math.random() - 0.5) * obj.mountainHeight * 0.2)
                p.velocity.x = (Math.random() - 0.5) * 0.04
                p.velocity.y = -(0.01 + Math.random() * DEBRIS_FALL_SPEED)
                p.velocity.z = (Math.random() - 0.5) * 0.04
              }

              // Suppress particle index access warning — xi/zi used for typing
              void xi; void zi
            }
          }
          posAttr.needsUpdate = true
        }

        // ── Animate dust cloud ────────────────────────────────────────────────
        if (obj.dustCloud) {
          const mat = obj.dustCloud.material as THREE.MeshBasicMaterial
          mat.opacity = 0.08 + Math.sin(t * 0.55 + obj.worldX * 0.5) * 0.07
          obj.dustCloud.scale.setScalar(0.92 + Math.sin(t * 0.38 + obj.worldZ * 0.4) * 0.1)
        }

        // ── Animate restoration glow ──────────────────────────────────────────
        if (obj.restorationGlow) {
          obj.restorationTimer = Math.max(0, obj.restorationTimer - 0.016)
          const progress = obj.restorationTimer / RESTORATION_GLOW_DURATION
          obj.restorationGlow.intensity = 2.8 * progress

          // Pulse glow during animation
          obj.restorationGlow.intensity *= 0.8 + Math.sin(t * 12) * 0.2

          if (obj.restorationTimer <= 0) {
            scene.remove(obj.restorationGlow)
            obj.restorationGlow = null
          }
        }

        // ── Animate peak crack wobble (invoice gap) ───────────────────────────
        if (obj.peakCrack) {
          const mat = obj.peakCrack.material as THREE.LineBasicMaterial
          mat.opacity = 0.7 + Math.sin(t * 2.8 + obj.worldX) * 0.2
        }
      })

      // ── Animate tower rust patches ──────────────────────────────────────────
      towerRustObjectsRef.current.forEach(r => {
        if (!r.mesh.visible) return
        const mat = r.mesh.material as THREE.MeshLambertMaterial
        mat.emissive.setHex(0x8b3a0a)
        mat.emissive.multiplyScalar(0.15 + Math.sin(t * 1.1 + r.worldX * 0.3) * 0.10)
        r.mesh.rotation.z = t * 0.25
      })

      // ── Animate murky river sections ─────────────────────────────────────────
      riverMurkObjectsRef.current.forEach(m => {
        if (!m.mesh.visible) return
        const mat = m.mesh.material as THREE.MeshBasicMaterial
        mat.opacity = Math.max(0.05, mat.opacity + Math.sin(t * 0.9 + m.riverZ * 0.1) * 0.01)
      })
    }

    window.addEventListener('nw:frame', onFrame)
    return () => window.removeEventListener('nw:frame', onFrame)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, scene])

  // ── Restoration flash expiry ───────────────────────────────────────────────

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now()
      setRestorationFlashes(prev => prev.filter(f => f.expiresAt > now))
    }, 500)
    return () => clearInterval(interval)
  }, [])

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Erosion status summary panel */}
      <ErosionStatusPanel records={erosionRecords} visible={visible} />

      {/* Restoration flash notifications */}
      {visible && (
        <RestorationPanel
          flashes={restorationFlashes}
          onDismiss={id =>
            setRestorationFlashes(prev => prev.filter(f => f.projectId !== id))
          }
        />
      )}
    </>
  )
}
