/**
 * ThreatMovementLayer.tsx — NW48: Negative business indicators manifest as
 * threat objects that physically drift toward the camera, creating urgency.
 *
 * Threat types:
 *   overdue_invoice   — red crystalline shard, size ∝ dollar amount
 *   stalled_project   — amber frozen mountain fragment
 *   expiring_contract — pulsing orange countdown ring
 *   cold_lead         — fading blue wisp
 *   negative_cashflow — dark red fog tendril
 *
 * Movement:
 *   Threats spawn at their source node (project mountain, AR stalactite, etc.)
 *   and drift toward the camera over ~30 seconds (0.5 unit/s simulated).
 *   They grow from 1.0× to 1.3× scale as they approach.
 *   When close (driftProgress > 0.85): pulse red, play optional warning tone.
 *   They orbit at the viewport edges — never blocking the center view.
 *
 * Dismissal:
 *   Click → detail panel with issue description + recommendation.
 *   ACKNOWLEDGE → threat stops drifting, returns to source, dims to 30%.
 *   RESOLVE     → satisfying particle burst dissolve.
 *
 * Urgency escalation:
 *   7+ days old  → faster pulse (2.5 Hz vs 1.0 Hz)
 *   14+ days old → deep red tint regardless of type
 *   30+ days old → faint red trail while orbiting
 */

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
} from 'react'
import * as THREE from 'three'
import { useWorldContext } from './WorldContext'
import {
  subscribeWorldData,
  seededPosition,
  type NWWorldData,
  type NWFieldLog,
  type NWInvoice,
} from './DataBridge'

// ── Constants ─────────────────────────────────────────────────────────────────

const MS7  =  7 * 86_400_000
const MS14 = 14 * 86_400_000
const MS30 = 30 * 86_400_000

const DRIFT_RATE       = 0.025   // driftProgress / second → full orbit in ~40 s
const RETURN_RATE      = 0.40    // returnProgress / second
const DISSOLVE_RATE    = 1.20    // dissolveProgress / second
const RENDER_EVERY_N   = 3       // update React state every N frames

// ── Types ─────────────────────────────────────────────────────────────────────

type ThreatType =
  | 'overdue_invoice'
  | 'stalled_project'
  | 'expiring_contract'
  | 'cold_lead'
  | 'negative_cashflow'

type ThreatState = 'active' | 'acknowledged' | 'resolved'

interface ThreatDef {
  id: string
  type: ThreatType
  label: string
  subLabel: string
  description: string
  recommendation: string
  sourceWorldX: number
  sourceWorldZ: number
  amount: number
  ageMs: number
}

interface ThreatAnim {
  driftProgress: number
  orbitAngle: number
  orbitAngularVel: number   // rad / s (positive or negative — seeded)
  warningPlayed: boolean
  dissolveProgress: number
  returnProgress: number
}

interface ThreatEntry {
  def: ThreatDef
  state: ThreatState
  anim: ThreatAnim
}

interface TrailPt { x: number; y: number; a: number }

interface Particle { x: number; y: number; vx: number; vy: number; life: number; maxLife: number }

interface RenderThreat {
  id: string
  type: ThreatType
  label: string
  subLabel: string
  description: string
  recommendation: string
  screenX: number
  screenY: number
  scale: number
  opacity: number
  deepRed: boolean
  hasTrail: boolean
  trailPoints: TrailPt[]
  particles: { x: number; y: number; a: number }[]
  state: ThreatState
  ageMs: number
  amount: number
  isClose: boolean
  pulseClass: string
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

function worldToScreen(
  wx: number, wy: number, wz: number,
  camera: THREE.PerspectiveCamera,
  cw: number, ch: number,
): { x: number; y: number; visible: boolean } {
  const v = new THREE.Vector3(wx, wy, wz)
  v.project(camera)
  if (v.z > 1) return { x: cw / 2, y: ch * 0.3, visible: false }
  return {
    x: (v.x *  0.5 + 0.5) * cw,
    y: (v.y * -0.5 + 0.5) * ch,
    visible: true,
  }
}

function orbitPt(angle: number, cw: number, ch: number): { x: number; y: number } {
  // Elliptical orbit sized to viewport edges with 6% inset
  const rx = cw * 0.44
  const ry = ch * 0.44
  return { x: cw / 2 + rx * Math.cos(angle), y: ch / 2 + ry * Math.sin(angle) }
}

function smoothStep(t: number): number {
  const c = Math.max(0, Math.min(1, t))
  return c * c * (3 - 2 * c)
}

function lerp(a: number, b: number, t: number): number { return a + (b - a) * t }

function seededFloat(s: string): number {
  let h = 0xdeadbeef
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 2654435761)
  return (h >>> 0) / 0xffffffff
}

function computeScreenPos(
  entry: ThreatEntry,
  cw: number, ch: number,
  camera: THREE.PerspectiveCamera,
): { x: number; y: number } {
  const { def, anim, state } = entry
  const src = worldToScreen(def.sourceWorldX, 0.5, def.sourceWorldZ, camera, cw, ch)
  const orb = orbitPt(anim.orbitAngle, cw, ch)
  const t   = smoothStep(anim.driftProgress)

  if (state === 'acknowledged') {
    const rt = smoothStep(anim.returnProgress)
    return {
      x: lerp(lerp(src.x, orb.x, t), src.x, rt),
      y: lerp(lerp(src.y, orb.y, t), src.y, rt),
    }
  }
  return { x: lerp(src.x, orb.x, t), y: lerp(src.y, orb.y, t) }
}

// Optional warning tone via Web Audio
function playWarningTone(): void {
  try {
    const win = window as unknown as Record<string, unknown>
    const Ctx = (win.AudioContext ?? win.webkitAudioContext) as (new () => AudioContext) | undefined
    if (!Ctx) return
    const ctx  = new Ctx()
    const osc  = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.setValueAtTime(880, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.15)
    gain.gain.setValueAtTime(0.04, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.3)
  } catch { /* audio unavailable */ }
}

// ── Threat derivation ─────────────────────────────────────────────────────────

function deriveThreats(data: NWWorldData): ThreatDef[] {
  const now  = Date.now()
  const defs: ThreatDef[] = []

  // 1. Overdue invoices (unpaid 30+ days)
  for (const inv of data.invoices as NWInvoice[]) {
    if (inv.status === 'paid' || inv.status === 'cancelled') continue
    if (!inv.created_at) continue
    const age = now - new Date(inv.created_at).getTime()
    if (age < MS30) continue
    const proj = data.projects.find(p => p.id === inv.project_id)
    const pos  = proj ? seededPosition(proj.id) : { x: -80, z: 20 }
    const days = Math.floor(age / 86_400_000)
    defs.push({
      id: `invoice-${inv.id}`,
      type: 'overdue_invoice',
      label: 'Overdue Invoice',
      subLabel: `$${Math.round(inv.amount).toLocaleString()} · ${days}d unpaid`,
      description: `Invoice ${inv.id.slice(0, 8).toUpperCase()} has been unpaid for ${days} days.`,
      recommendation: 'Send payment reminder or escalate to a collection call. Offer a payment plan if over 45 days.',
      sourceWorldX: pos.x,
      sourceWorldZ: pos.z,
      amount: inv.amount,
      ageMs: age,
    })
  }

  // 2. Stalled projects (active, no field log in 14+ days)
  const activeProjs = data.projects.filter(p =>
    p.status === 'in_progress' || p.status === 'approved',
  )
  for (const proj of activeProjs) {
    const logs = (data.fieldLogs as NWFieldLog[]).filter(fl => fl.project_id === proj.id)
    let lastMs = proj.created_at ? new Date(proj.created_at).getTime() : 0
    for (const fl of logs) {
      if (fl.log_date) {
        const t = new Date(fl.log_date).getTime()
        if (t > lastMs) lastMs = t
      }
    }
    if (lastMs === 0) continue
    const stalledMs = now - lastMs
    if (stalledMs < MS14) continue
    const pos  = seededPosition(proj.id)
    const days = Math.floor(stalledMs / 86_400_000)
    defs.push({
      id: `stalled-${proj.id}`,
      type: 'stalled_project',
      label: 'Stalled Project',
      subLabel: `${proj.name.slice(0, 18)} · ${days}d idle`,
      description: `"${proj.name}" has no field log activity for ${days} days.`,
      recommendation: 'Log field activity or review for blockers. Check phase schedule and crew availability.',
      sourceWorldX: pos.x,
      sourceWorldZ: pos.z,
      amount: proj.contract_value,
      ageMs: stalledMs,
    })
  }

  // 3. Contracts nearing end (proxy: in-progress, phase > 70%, created 60+ days ago, <30d est. remaining)
  for (const proj of data.projects) {
    if (proj.status !== 'in_progress') continue
    if (!proj.created_at) continue
    const projAge = now - new Date(proj.created_at).getTime()
    if (projAge < 60 * 86_400_000) continue
    if (proj.phase_completion < 70) continue
    const estEnd     = new Date(proj.created_at).getTime() + 90 * 86_400_000
    const msRemaining = estEnd - now
    if (msRemaining <= 0 || msRemaining > MS30) continue
    const daysLeft = Math.floor(msRemaining / 86_400_000)
    const pos = seededPosition(proj.id + '-exp')
    defs.push({
      id: `expiring-${proj.id}`,
      type: 'expiring_contract',
      label: 'Contract Expiring',
      subLabel: `${proj.name.slice(0, 18)} · ${daysLeft}d left`,
      description: `"${proj.name}" is ${proj.phase_completion}% complete. Estimated contract end in ~${daysLeft} days.`,
      recommendation: 'Confirm close-out milestones. Prepare punch list and schedule final inspection now.',
      sourceWorldX: pos.x,
      sourceWorldZ: pos.z,
      amount: proj.contract_value,
      ageMs: MS30 - msRemaining,
    })
  }

  // 4. Leads going cold (client territories, 7–180 days no contact)
  const coldLeads = data.clientTerritories
    .filter(ct => ct.daysSinceContact >= 7 && ct.daysSinceContact < 180)
    .sort((a, b) => b.lifetimeValue - a.lifetimeValue)
    .slice(0, 5)
  for (const ct of coldLeads) {
    defs.push({
      id: `cold-${ct.clientKey}`,
      type: 'cold_lead',
      label: 'Lead Going Cold',
      subLabel: `${ct.clientName.slice(0, 18)} · ${ct.daysSinceContact}d silent`,
      description: `${ct.clientName} — no activity for ${ct.daysSinceContact} days. Relationship at risk.`,
      recommendation: 'Schedule follow-up call. Send project update or seasonal offer within 48 hours.',
      sourceWorldX: ct.worldX,
      sourceWorldZ: ct.worldZ,
      amount: ct.lifetimeValue,
      ageMs: ct.daysSinceContact * 86_400_000,
    })
  }

  // 5. Negative cash flow signal (AR over 30d exceeds recent collections by >30%)
  const arTotal    = (data.accountingSignals.arOver30Days as NWInvoice[]).reduce((s: number, inv: NWInvoice) => s + inv.amount, 0)
  const recentPaid = data.accountingSignals.recentPaidAmount
  if (arTotal > 0 && arTotal > recentPaid * 1.3) {
    defs.push({
      id: 'cashflow-warning',
      type: 'negative_cashflow',
      label: 'Cash Flow Warning',
      subLabel: `$${Math.round(arTotal / 1000)}k overdue vs $${Math.round(recentPaid / 1000)}k in`,
      description: `Outstanding AR ($${Math.round(arTotal).toLocaleString()}) significantly exceeds recent 30-day collections ($${Math.round(recentPaid).toLocaleString()}).`,
      recommendation: 'Prioritize top 3 overdue accounts for collection calls. Review billing frequency and payment terms.',
      sourceWorldX: -60,
      sourceWorldZ: 30,
      amount: arTotal,
      ageMs: MS30,
    })
  }

  return defs
}

// ── Threat icon (SVG) ─────────────────────────────────────────────────────────

function ThreatIcon({ type, size, deepRed }: { type: ThreatType; size: number; deepRed: boolean }) {
  const s = size
  switch (type) {
    case 'overdue_invoice': {
      const c  = deepRed ? '#8b0000' : '#ff2040'
      const c2 = deepRed ? '#cc0000' : '#ff6080'
      const pts = [
        [s / 2, 0], [s * 0.75, s * 0.2], [s, s * 0.45],
        [s * 0.65, s * 0.65], [s * 0.8, s], [s / 2, s * 0.78],
        [s * 0.2, s], [s * 0.35, s * 0.65], [0, s * 0.45], [s * 0.25, s * 0.2],
      ].map(([x, y]) => `${x},${y}`).join(' ')
      return (
        <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} style={{ display: 'block' }}>
          <polygon points={pts} fill={c} opacity={0.92} />
          <polygon points={pts} fill="none" stroke={c2} strokeWidth={1} />
          <line x1={s * 0.32} y1={s * 0.28} x2={s * 0.58} y2={s * 0.54}
            stroke="rgba(255,200,200,0.45)" strokeWidth={1} />
        </svg>
      )
    }
    case 'stalled_project': {
      const c  = deepRed ? '#8b4513' : '#f59e0b'
      const c2 = deepRed ? '#cc6600' : '#fcd34d'
      return (
        <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} style={{ display: 'block' }}>
          <polygon points={`${s / 2},0 ${s},${s} 0,${s}`} fill={c} opacity={0.90} />
          <polygon points={`${s / 2},0 ${s},${s} 0,${s}`}
            fill="none" stroke={c2} strokeWidth={1.5} />
          <line x1={s / 2} y1={s * 0.15} x2={s * 0.38} y2={s * 0.65}
            stroke="rgba(255,255,200,0.35)" strokeWidth={1} />
        </svg>
      )
    }
    case 'expiring_contract': {
      const c  = deepRed ? '#8b2500' : '#ff6600'
      const c2 = deepRed ? '#cc4400' : '#ff9940'
      const r  = s / 2 - 2
      return (
        <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} style={{ display: 'block' }}>
          <circle cx={s / 2} cy={s / 2} r={r} fill="none" stroke={c} strokeWidth={3} opacity={0.92} />
          <circle cx={s / 2} cy={s / 2} r={r * 0.45} fill={c} opacity={0.28} />
          <text x={s / 2} y={s / 2 + s * 0.12} textAnchor="middle"
            fontSize={s * 0.34} fill={c2} fontFamily="monospace" fontWeight="bold">!</text>
        </svg>
      )
    }
    case 'cold_lead': {
      const c = deepRed ? '#1a1a7b' : '#4080ff'
      return (
        <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} style={{ display: 'block' }}>
          <ellipse cx={s / 2} cy={s * 0.56} rx={s * 0.35} ry={s * 0.40} fill={c} opacity={0.75} />
          <ellipse cx={s / 2} cy={s * 0.22} rx={s * 0.11} ry={s * 0.16} fill={c} opacity={0.52} />
          <ellipse cx={s / 2} cy={s * 0.56} rx={s * 0.35} ry={s * 0.40}
            fill="none" stroke="#80b0ff" strokeWidth={0.8} opacity={0.60} />
        </svg>
      )
    }
    case 'negative_cashflow': {
      const c = deepRed ? '#400000' : '#8b0000'
      return (
        <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} style={{ display: 'block' }}>
          <ellipse cx={s * 0.44} cy={s * 0.56} rx={s * 0.42} ry={s * 0.30} fill={c} opacity={0.88} />
          <ellipse cx={s * 0.60} cy={s * 0.35} rx={s * 0.28} ry={s * 0.20} fill={c} opacity={0.72} />
          <ellipse cx={s * 0.28} cy={s * 0.30} rx={s * 0.20} ry={s * 0.16} fill={c} opacity={0.60} />
          <ellipse cx={s * 0.44} cy={s * 0.56} rx={s * 0.42} ry={s * 0.30}
            fill="none" stroke="#cc0000" strokeWidth={0.8} opacity={0.50} />
        </svg>
      )
    }
    default:
      return null
  }
}

// ── Detail Panel ──────────────────────────────────────────────────────────────

const TYPE_COLORS: Record<ThreatType, string> = {
  overdue_invoice:   '#ff2040',
  stalled_project:   '#f59e0b',
  expiring_contract: '#ff6600',
  cold_lead:         '#4080ff',
  negative_cashflow: '#cc0000',
}

interface DetailPanelProps {
  threat: RenderThreat
  onAcknowledge: (id: string) => void
  onResolve:     (id: string) => void
  onClose:       () => void
}

function DetailPanel({ threat, onAcknowledge, onResolve, onClose }: DetailPanelProps) {
  const accent = TYPE_COLORS[threat.type]
  const days   = Math.floor(threat.ageMs / 86_400_000)

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9998,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.35)',
        backdropFilter: 'blur(2px)',
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'rgba(4, 4, 10, 0.97)',
          border: `1px solid ${accent}`,
          borderRadius: 10,
          padding: '22px 26px',
          minWidth: 330,
          maxWidth: 420,
          boxShadow: `0 0 48px ${accent}44, 0 10px 36px rgba(0,0,0,0.85)`,
          backdropFilter: 'blur(18px)',
          fontFamily: 'monospace',
          color: '#e8e8e8',
          position: 'relative',
          zIndex: 9999,
        }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute', top: 10, right: 14,
            background: 'none', border: 'none',
            color: 'rgba(255,255,255,0.35)', cursor: 'pointer',
            fontSize: 18, lineHeight: 1, padding: 0,
          }}
        >×</button>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <ThreatIcon type={threat.type} size={30} deepRed={false} />
          <div>
            <div style={{
              fontSize: 10, letterSpacing: 2.5,
              color: accent, fontWeight: 700, marginBottom: 2,
            }}>
              ⚠ THREAT DETECTED
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>
              {threat.label}
            </div>
          </div>
        </div>

        {/* Sub-label badge */}
        <div style={{
          fontSize: 10, letterSpacing: 1, color: accent,
          background: `${accent}18`,
          border: `1px solid ${accent}44`,
          borderRadius: 4, padding: '4px 9px', marginBottom: 13,
          display: 'inline-block',
        }}>
          {threat.subLabel}
        </div>

        {/* Description */}
        <div style={{
          fontSize: 11, lineHeight: 1.65,
          color: 'rgba(220,220,220,0.85)',
          marginBottom: 11,
        }}>
          {threat.description}
        </div>

        {/* Recommendation */}
        <div style={{
          fontSize: 10, lineHeight: 1.6,
          color: '#00e5cc',
          background: 'rgba(0,229,204,0.06)',
          border: '1px solid rgba(0,229,204,0.22)',
          borderRadius: 5, padding: '9px 11px',
          marginBottom: 16,
        }}>
          <span style={{ opacity: 0.55, letterSpacing: 0.5 }}>RECOMMENDED ACTION: </span>
          {threat.recommendation}
        </div>

        {/* Meta */}
        <div style={{
          fontSize: 9, color: 'rgba(255,255,255,0.28)',
          letterSpacing: 0.6, marginBottom: 16,
        }}>
          THREAT AGE: {days} DAY{days !== 1 ? 'S' : ''} &nbsp;·&nbsp; STATUS: {threat.state.toUpperCase()}
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 9 }}>
          {threat.state === 'active' && (
            <>
              <button
                onClick={() => onAcknowledge(threat.id)}
                style={{
                  flex: 1, padding: '9px 6px',
                  background: 'rgba(255,200,0,0.09)',
                  border: '1px solid rgba(255,200,0,0.5)',
                  borderRadius: 5, color: '#ffd700',
                  fontSize: 10, fontFamily: 'monospace',
                  fontWeight: 700, letterSpacing: 1.5,
                  cursor: 'pointer', transition: 'background 0.15s',
                }}
                onMouseEnter={e => { (e.currentTarget).style.background = 'rgba(255,200,0,0.18)' }}
                onMouseLeave={e => { (e.currentTarget).style.background = 'rgba(255,200,0,0.09)' }}
              >
                ACKNOWLEDGE
              </button>
              <button
                onClick={() => onResolve(threat.id)}
                style={{
                  flex: 1, padding: '9px 6px',
                  background: 'rgba(0,229,204,0.09)',
                  border: '1px solid rgba(0,229,204,0.5)',
                  borderRadius: 5, color: '#00e5cc',
                  fontSize: 10, fontFamily: 'monospace',
                  fontWeight: 700, letterSpacing: 1.5,
                  cursor: 'pointer', transition: 'background 0.15s',
                }}
                onMouseEnter={e => { (e.currentTarget).style.background = 'rgba(0,229,204,0.18)' }}
                onMouseLeave={e => { (e.currentTarget).style.background = 'rgba(0,229,204,0.09)' }}
              >
                RESOLVE
              </button>
            </>
          )}
          {threat.state === 'acknowledged' && (
            <div style={{
              flex: 1, textAlign: 'center',
              fontSize: 10, color: 'rgba(255,215,0,0.5)',
              letterSpacing: 1, padding: '9px 0',
            }}>
              ✓ ACKNOWLEDGED — RETURNING TO SOURCE
            </div>
          )}
          {threat.state === 'resolved' && (
            <div style={{
              flex: 1, textAlign: 'center',
              fontSize: 10, color: 'rgba(0,229,204,0.5)',
              letterSpacing: 1, padding: '9px 0',
            }}>
              ✓ RESOLVED — DISSOLVING
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

interface ThreatMovementLayerProps {
  visible:       boolean
  soundEnabled?: boolean
}

export function ThreatMovementLayer({ visible, soundEnabled = false }: ThreatMovementLayerProps) {
  const { camera } = useWorldContext()

  // Mutable animation state (not React state — avoids per-frame re-renders)
  const entriesRef   = useRef<Map<string, ThreatEntry>>(new Map())
  const trailsRef    = useRef<Map<string, TrailPt[]>>(new Map())
  const particlesRef = useRef<Map<string, Particle[]>>(new Map())

  // Keep camera ref fresh to avoid stale closure in frame handler
  const cameraRef = useRef<THREE.PerspectiveCamera>(camera)
  useEffect(() => { cameraRef.current = camera }, [camera])

  // Container size (live-updated via ResizeObserver)
  const containerRef = useRef<HTMLDivElement>(null)
  const cwRef        = useRef<number>(window.innerWidth)
  const chRef        = useRef<number>(window.innerHeight)

  // Frame bookkeeping
  const frameCountRef = useRef<number>(0)
  const lastTimeRef   = useRef<number>(performance.now())

  // React render state — updated every RENDER_EVERY_N frames
  const [renderThreats, setRenderThreats] = useState<RenderThreat[]>([])
  const [selectedId,    setSelectedId]    = useState<string | null>(null)

  // ── Container resize tracking ─────────────────────────────────────────────

  useEffect(() => {
    function sync() {
      if (containerRef.current) {
        cwRef.current = containerRef.current.clientWidth  || window.innerWidth
        chRef.current = containerRef.current.clientHeight || window.innerHeight
      }
    }
    const ro = new ResizeObserver(sync)
    if (containerRef.current) ro.observe(containerRef.current)
    sync()
    return () => ro.disconnect()
  }, [])

  // ── World data subscription ────────────────────────────────────────────────

  useEffect(() => {
    const unsub = subscribeWorldData((data: NWWorldData) => {
      const newDefs = deriveThreats(data)
      const entries = entriesRef.current

      for (const def of newDefs) {
        if (!entries.has(def.id)) {
          const f = seededFloat(def.id)
          entries.set(def.id, {
            def,
            state: 'active',
            anim: {
              driftProgress:   0,
              orbitAngle:      f * Math.PI * 2,
              orbitAngularVel: (0.15 + f * 0.15) * (f > 0.5 ? 1 : -1),
              warningPlayed:   false,
              dissolveProgress: 0,
              returnProgress:   0,
            },
          })
          trailsRef.current.set(def.id, [])
          particlesRef.current.set(def.id, [])
        } else {
          // Refresh definition (amounts / descriptions may update each data cycle)
          const entry = entries.get(def.id)
          if (entry) entry.def = def
        }
      }
    })
    return unsub
  }, [])

  // ── Animation frame handler ────────────────────────────────────────────────

  useEffect(() => {
    function onFrame() {
      if (!visible) return

      const now = performance.now()
      const dt  = Math.min((now - lastTimeRef.current) / 1000, 0.1)
      lastTimeRef.current = now

      const cw      = cwRef.current
      const ch      = chRef.current
      const cam     = cameraRef.current
      const entries = entriesRef.current

      for (const [id, entry] of entries) {
        const { anim, def, state } = entry

        // Resolved: advance dissolve + particles
        if (state === 'resolved') {
          if (anim.dissolveProgress >= 1) { entries.delete(id); continue }
          anim.dissolveProgress = Math.min(1, anim.dissolveProgress + dt * DISSOLVE_RATE)
          const parts = particlesRef.current.get(id) ?? []
          for (const p of parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt }
          particlesRef.current.set(id, parts.filter(p => p.life > 0))
          continue
        }

        // Acknowledged: drift back to source
        if (state === 'acknowledged') {
          anim.returnProgress = Math.min(1, anim.returnProgress + dt * RETURN_RATE)
        }

        // Active: advance drift + orbit angle
        if (state === 'active') {
          anim.driftProgress = Math.min(1, anim.driftProgress + dt * DRIFT_RATE)
          if (anim.driftProgress > 0.8) {
            anim.orbitAngle += anim.orbitAngularVel * dt
          }
        }

        // Trail recording (age > 30 days, every 4 frames)
        if (def.ageMs >= MS30 && frameCountRef.current % 4 === 0) {
          const { x, y } = computeScreenPos(entry, cw, ch, cam)
          const trail = trailsRef.current.get(id) ?? []
          trail.push({ x, y, a: 0.38 })
          if (trail.length > 8) trail.shift()
          trail.forEach((pt, i) => { pt.a = (i / trail.length) * 0.32 })
          trailsRef.current.set(id, trail)
        }

        // Warning sound on first close approach
        if (soundEnabled && state === 'active' && anim.driftProgress > 0.85 && !anim.warningPlayed) {
          playWarningTone()
          anim.warningPlayed = true
        }
      }

      frameCountRef.current++

      // Sync React state every N frames
      if (frameCountRef.current % RENDER_EVERY_N !== 0) return

      const result: RenderThreat[] = []
      for (const [id, entry] of entries) {
        const { def, state, anim } = entry
        if (state === 'resolved' && anim.dissolveProgress >= 1) continue

        const { x, y } = computeScreenPos(entry, cw, ch, cam)
        const scale     = 1.0 + smoothStep(anim.driftProgress) * 0.3
        const isClose   = anim.driftProgress > 0.85 && state === 'active'
        const deepRed   = def.ageMs >= MS14
        const hasTrail  = def.ageMs >= MS30

        const baseOpacity = state === 'acknowledged'
          ? 0.30
          : Math.max(0, 1.0 - anim.dissolveProgress)

        // Pulse class for CSS animation speed
        const pulseClass = def.ageMs >= MS7 ? 'threat-pulse-fast' : 'threat-pulse-slow'

        result.push({
          id, type: def.type, label: def.label, subLabel: def.subLabel,
          description: def.description, recommendation: def.recommendation,
          screenX: x, screenY: y, scale, opacity: baseOpacity,
          deepRed, hasTrail, isClose, pulseClass,
          trailPoints: trailsRef.current.get(id) ?? [],
          particles:  (particlesRef.current.get(id) ?? []).map(p => ({
            x: p.x, y: p.y, a: Math.max(0, (p.life / p.maxLife) * 0.85),
          })),
          state, ageMs: def.ageMs, amount: def.amount,
        })
      }
      setRenderThreats(result)
    }

    window.addEventListener('nw:frame', onFrame)
    return () => window.removeEventListener('nw:frame', onFrame)
  }, [visible, soundEnabled])

  // ── Action handlers ────────────────────────────────────────────────────────

  const handleAcknowledge = useCallback((id: string) => {
    const entry = entriesRef.current.get(id)
    if (entry) {
      entry.state = 'acknowledged'
      entry.anim.returnProgress = 0
    }
    setSelectedId(null)
    setRenderThreats(prev => prev.map(t => t.id === id ? { ...t, state: 'acknowledged' as ThreatState } : t))
  }, [])

  const handleResolve = useCallback((id: string) => {
    const entry = entriesRef.current.get(id)
    if (entry) {
      entry.state = 'resolved'
      // Burst particles at current screen position
      const { x, y } = computeScreenPos(entry, cwRef.current, chRef.current, cameraRef.current)
      const parts: Particle[] = []
      for (let i = 0; i < 20; i++) {
        const angle  = (i / 20) * Math.PI * 2 + Math.random() * 0.3
        const speed  = 45 + Math.random() * 90
        const life   = 0.35 + Math.random() * 0.45
        parts.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life, maxLife: life })
      }
      particlesRef.current.set(id, parts)
    }
    setSelectedId(null)
    setRenderThreats(prev => prev.map(t => t.id === id ? { ...t, state: 'resolved' as ThreatState } : t))
  }, [])

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!visible) return null

  const selectedThreat = selectedId ? renderThreats.find(t => t.id === selectedId) ?? null : null

  return (
    <>
      {/* Inject CSS pulse keyframes once */}
      <style>{`
        @keyframes threat-pulse-slow {
          0%,100% { filter: brightness(1); }
          50%      { filter: brightness(1.55); }
        }
        @keyframes threat-pulse-fast {
          0%,100% { filter: brightness(1); }
          50%      { filter: brightness(1.8) drop-shadow(0 0 5px currentColor); }
        }
        .threat-pulse-slow {
          animation: threat-pulse-slow 1.25s ease-in-out infinite;
        }
        .threat-pulse-fast {
          animation: threat-pulse-fast 0.55s ease-in-out infinite;
        }
      `}</style>

      {/* Fixed overlay — above world canvas, below UI panels */}
      <div
        ref={containerRef}
        style={{
          position: 'fixed', inset: 0,
          pointerEvents: 'none',
          zIndex: 45,
          overflow: 'hidden',
        }}
      >
        {renderThreats.map(threat => {
          if (threat.state === 'resolved' && threat.particles.length === 0) return null

          const color      = threat.deepRed ? '#8b0000' : TYPE_COLORS[threat.type]
          const markerPx   = Math.max(20, Math.min(34, 20 + threat.amount / 6000))
          const scaledPx   = Math.round(markerPx * threat.scale)

          return (
            <React.Fragment key={threat.id}>
              {/* Red orbit trail (30+ days old threats) */}
              {threat.hasTrail && threat.trailPoints.map((pt, i) => (
                <div
                  key={`trail-${i}`}
                  style={{
                    position: 'absolute',
                    left: pt.x - 3, top: pt.y - 3,
                    width: 6, height: 6,
                    borderRadius: '50%',
                    background: '#8b0000',
                    opacity: pt.a,
                    pointerEvents: 'none',
                    transform: 'translate(-50%,-50%)',
                  }}
                />
              ))}

              {/* Resolve burst particles */}
              {threat.particles.map((pt, i) => (
                <div
                  key={`part-${i}`}
                  style={{
                    position: 'absolute',
                    left: pt.x, top: pt.y,
                    width: 6, height: 6,
                    borderRadius: '50%',
                    background: color,
                    opacity: pt.a,
                    pointerEvents: 'none',
                    transform: 'translate(-50%,-50%)',
                    boxShadow: `0 0 4px ${color}`,
                  }}
                />
              ))}

              {/* Warning ring (close approach) */}
              {threat.isClose && (
                <div
                  style={{
                    position: 'absolute',
                    left: threat.screenX,
                    top:  threat.screenY,
                    width:  scaledPx + 18,
                    height: scaledPx + 18,
                    borderRadius: '50%',
                    border: `2px solid ${color}`,
                    opacity: 0.5,
                    transform: 'translate(-50%,-50%)',
                    pointerEvents: 'none',
                    animation: 'threat-pulse-fast 0.55s ease-in-out infinite',
                  }}
                />
              )}

              {/* Primary threat marker */}
              <div
                className={threat.pulseClass}
                style={{
                  position: 'absolute',
                  left: threat.screenX,
                  top:  threat.screenY,
                  width:  scaledPx,
                  height: scaledPx,
                  transform: 'translate(-50%,-50%)',
                  opacity: Math.min(1, Math.max(0, threat.opacity)),
                  cursor: threat.state === 'resolved' ? 'default' : 'pointer',
                  pointerEvents: threat.state === 'resolved' ? 'none' : 'all',
                  userSelect: 'none',
                }}
                onClick={() => { if (threat.state !== 'resolved') setSelectedId(threat.id) }}
                title={`${threat.label}: ${threat.subLabel}`}
              >
                <ThreatIcon type={threat.type} size={scaledPx} deepRed={threat.deepRed} />
              </div>
            </React.Fragment>
          )
        })}
      </div>

      {/* Detail panel (renders above everything when a threat is selected) */}
      {selectedThreat && (
        <DetailPanel
          threat={selectedThreat}
          onAcknowledge={handleAcknowledge}
          onResolve={handleResolve}
          onClose={() => setSelectedId(null)}
        />
      )}
    </>
  )
}
