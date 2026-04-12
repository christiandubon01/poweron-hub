/**
 * LearningPathLayer.tsx — NW76
 *
 * Visualizes personal learning goals and skill development as a glowing trail
 * through the Neural World landscape.
 *
 * Features:
 *  - TubeGeometry path (CatmullRomCurve3) connecting milestone gem markers
 *  - Gradient path: teal (start) → gold (mastery)
 *  - Milestone gems: completed=solid gold, current=pulsing teal w/ progress ring,
 *    future=dim ghostly outline
 *  - 5 learning domains for Christian: NEC Code Mastery, Business Finance,
 *    Solar Certification, Estimating, Leadership
 *  - 5 milestones per domain: Beginner → Intermediate → Advanced → Expert → Master
 *  - Reading list tie-in: Meditations, Man's Search for Meaning, Book of Five Rings,
 *    Tao Te Ching contribute to Leadership domain progress
 *  - Hexagonal radar chart HUD showing proficiency per domain
 *  - Click milestone → info panel (requirements, resources, estimated time)
 *  - Path grows as new skills are added into uncharted territory
 *  - Data persisted to localStorage: progress, completed milestones, timestamps
 *
 * Events consumed:
 *   nw:learning-path-activate   — show the layer
 *   nw:learning-path-deactivate — hide the layer
 *   nw:milestone-complete       — { domainId, milestoneIdx } mark milestone done
 *   nw:milestone-checkin        — { domainId, milestoneIdx, pct } update progress %
 *
 * Named export: LearningPathLayer
 */

import React, { useEffect, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import { useWorldContext } from './WorldContext'
import { makeLabel, disposeLabel, type NWLabel } from './utils/makeLabel'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface LPMilestone {
  label: string
  requirements: string[]
  resources: string[]
  estimatedWeeks: number
}

export interface LPDomain {
  id: string
  name: string
  color: string          // hex, e.g. '#14b8a6'
  description: string
  milestones: LPMilestone[]
}

export interface LPProgress {
  domainId: string
  completedCount: number       // 0–5
  currentPct: number           // 0–100 progress on current milestone
  completedAt: string[]        // ISO timestamps per completed milestone
  lastCheckin: string          // ISO timestamp
}

export interface LPState {
  active: boolean
  progress: Record<string, LPProgress>
  readingCompleted: string[]   // book ids
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain definitions — Christian's 5 learning domains
// ─────────────────────────────────────────────────────────────────────────────

const READING_BOOKS: Array<{ id: string; title: string; domainId: string; progressBoost: number }> = [
  { id: 'meditations',          title: 'Meditations',               domainId: 'leadership',   progressBoost: 25 },
  { id: 'mans-search',          title: "Man's Search for Meaning",  domainId: 'leadership',   progressBoost: 25 },
  { id: 'book-of-five-rings',   title: 'Book of Five Rings',        domainId: 'leadership',   progressBoost: 25 },
  { id: 'tao-te-ching',         title: 'Tao Te Ching',              domainId: 'leadership',   progressBoost: 25 },
]

const DOMAINS: LPDomain[] = [
  {
    id: 'nec-mastery',
    name: 'NEC Code Mastery',
    color: '#14b8a6',
    description: 'Deep knowledge of the National Electrical Code — the law of the trade.',
    milestones: [
      {
        label: 'Beginner',
        requirements: ['Read NEC Article 100 (Definitions)', 'Pass NEC Chapter 1 quiz'],
        resources: ['NFPA 70 2023 Edition', 'Mike Holt NEC Study Guide'],
        estimatedWeeks: 4,
      },
      {
        label: 'Intermediate',
        requirements: ['Complete NEC Chapters 2–4', 'Apply code on 5 real jobs'],
        resources: ['NEC Handbook w/ commentary', 'Code Check Electrical'],
        estimatedWeeks: 8,
      },
      {
        label: 'Advanced',
        requirements: ['Study Chapters 5–7 (Special Occupancies)', 'Complete 10 code-research lookups on job sites'],
        resources: ['NFPA 70E Arc Flash', 'Mike Holt Advanced NEC'],
        estimatedWeeks: 12,
      },
      {
        label: 'Expert',
        requirements: ['Ace EC exam practice tests ≥85%', 'Audit 3 completed projects for code compliance'],
        resources: ['State contractor exam prep', 'EC&M Magazine'],
        estimatedWeeks: 16,
      },
      {
        label: 'Master',
        requirements: ['Pass EC exam', 'Mentor apprentice on code interpretation', 'Write internal code reference sheet'],
        resources: ['NFPA 70 Annual updates', 'IEEE Standards'],
        estimatedWeeks: 20,
      },
    ],
  },
  {
    id: 'business-finance',
    name: 'Business Finance',
    color: '#f59e0b',
    description: 'Command of cash flow, overhead, pricing, and profitability for a growing electrical contractor.',
    milestones: [
      {
        label: 'Beginner',
        requirements: ['Understand P&L basics', 'Set up PowerOn Hub overhead model'],
        resources: ['PowerOn Hub Finance Panel', 'Simple Numbers by Greg Crabtree'],
        estimatedWeeks: 3,
      },
      {
        label: 'Intermediate',
        requirements: ['Track weekly cash flow for 8 weeks', 'Understand markup vs margin'],
        resources: ['PowerOn 52-Week Tracker', 'Profit First by Mike Michalowicz'],
        estimatedWeeks: 6,
      },
      {
        label: 'Advanced',
        requirements: ['Build annual revenue projection', 'Analyze job costing vs estimated on 10 projects'],
        resources: ['PowerOn Blueprint AI', 'E-Myth Revisited'],
        estimatedWeeks: 10,
      },
      {
        label: 'Expert',
        requirements: ['Achieve target gross margin ≥45% for 3 months', 'Create financial dashboard'],
        resources: ['SCORE Financial Templates', 'Harvard Business Review Finance'],
        estimatedWeeks: 14,
      },
      {
        label: 'Master',
        requirements: ['Forecast 12 months ahead within 10%', 'Build scalable pricing model'],
        resources: ['CFO-level financial modeling', 'Built to Sell by John Warrillow'],
        estimatedWeeks: 18,
      },
    ],
  },
  {
    id: 'solar-certification',
    name: 'Solar Certification',
    color: '#eab308',
    description: 'NABCEP certification path and solar installation expertise.',
    milestones: [
      {
        label: 'Beginner',
        requirements: ['Complete solar fundamentals course', 'Study PV system components'],
        resources: ['NABCEP Study Guide', 'Solar Energy International (SEI)'],
        estimatedWeeks: 5,
      },
      {
        label: 'Intermediate',
        requirements: ['Complete 3 residential solar installations', 'Study NEC Article 690'],
        resources: ['SolarPro Magazine', 'Enphase installer training'],
        estimatedWeeks: 10,
      },
      {
        label: 'Advanced',
        requirements: ['Complete NABCEP PV Associate exam', 'Design 3 systems from scratch'],
        resources: ['NABCEP PV Associate exam prep', 'Aurora Solar Design software'],
        estimatedWeeks: 14,
      },
      {
        label: 'Expert',
        requirements: ['Complete 10 commercial solar projects', 'Master battery storage integration'],
        resources: ['Tesla Powerwall installer program', 'Enphase IQ battery training'],
        estimatedWeeks: 20,
      },
      {
        label: 'Master',
        requirements: ['Achieve NABCEP PV Installation Professional', 'Train crew on solar installs'],
        resources: ['NABCEP PVIP exam', 'California CPUC Rule 21'],
        estimatedWeeks: 28,
      },
    ],
  },
  {
    id: 'estimating',
    name: 'Estimating',
    color: '#6366f1',
    description: 'Precision electrical estimating — from takeoff to profitable bid.',
    milestones: [
      {
        label: 'Beginner',
        requirements: ['Complete 5 service call estimates in PowerOn', 'Learn material takeoff basics'],
        resources: ['PowerOn Estimate Panel', 'Electrical Estimating Methods by RSMeans'],
        estimatedWeeks: 4,
      },
      {
        label: 'Intermediate',
        requirements: ['Bid and win 3 residential jobs within 5% of actual cost', 'Master labor units'],
        resources: ['NECA Manual of Labor Units', 'PowerOn MTO module'],
        estimatedWeeks: 8,
      },
      {
        label: 'Advanced',
        requirements: ['Estimate commercial job from blueprint', 'Achieve <8% cost variance on 5 jobs'],
        resources: ['Blueprint AI', 'RS Means Electrical Cost Data'],
        estimatedWeeks: 12,
      },
      {
        label: 'Expert',
        requirements: ['Win 5 competitive bids in one quarter', 'Build custom labor unit database'],
        resources: ['Estimating software comparison', 'PowerOn Price Book optimization'],
        estimatedWeeks: 16,
      },
      {
        label: 'Master',
        requirements: ['Teach estimating to crew lead', 'Achieve gross margin target on ≥80% of bids'],
        resources: ['NECA Estimator certification', 'Advanced takeoff software'],
        estimatedWeeks: 20,
      },
    ],
  },
  {
    id: 'leadership',
    name: 'Leadership',
    color: '#ec4899',
    description: 'Owner-operator leadership: mindset, crew management, and strategic vision.',
    milestones: [
      {
        label: 'Beginner',
        requirements: ['Read 1 leadership book from reading list', 'Define personal core values'],
        resources: ['Meditations — Marcus Aurelius', "Man's Search for Meaning — Viktor Frankl"],
        estimatedWeeks: 4,
      },
      {
        label: 'Intermediate',
        requirements: ['Complete reading list (4 books)', 'Implement weekly crew check-ins'],
        resources: ['Book of Five Rings — Miyamoto Musashi', 'Tao Te Ching — Lao Tzu'],
        estimatedWeeks: 8,
      },
      {
        label: 'Advanced',
        requirements: ['Build crew accountability system', 'Write company mission statement'],
        resources: ['PowerOn Crew Portal', 'Extreme Ownership by Jocko Willink'],
        estimatedWeeks: 12,
      },
      {
        label: 'Expert',
        requirements: ['Delegate 3 recurring tasks to crew', 'Conduct quarterly performance reviews'],
        resources: ['Who by Geoff Smart', 'Traction by Gino Wickman (EOS)'],
        estimatedWeeks: 16,
      },
      {
        label: 'Master',
        requirements: ['Operate business 1 week without owner on-site', 'Mentor junior electrician to journeyman'],
        resources: ['Built to Sell', 'Clockwork by Mike Michalowicz'],
        estimatedWeeks: 20,
      },
    ],
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const LS_KEY              = 'poweron_learning_path_v1'
const PATH_Y              = 0.3        // ground-level path height
const PATH_TUBE_R         = 0.18       // tube radius
const GEM_Y               = 3.5        // gem hover height
const GEM_CURRENT_Y       = 4.2        // current milestone higher
const PARTICLE_COUNT      = 80         // path particles
const DOMAIN_SPREAD_R     = 90         // radial spread of domain anchors
const MS_SPREAD           = 18         // distance between milestones within domain
const ROTATE_SPEED        = 0.5        // gem rotation speed (rad/s)
const PULSE_SPEED         = 2.2        // current milestone pulse speed
const COLOR_TEAL          = new THREE.Color(0x14b8a6)
const COLOR_GOLD          = new THREE.Color(0xffd700)
const COLOR_FUTURE        = new THREE.Color(0x334155)
const MILESTONES_PER_DOMAIN = 5

// ─────────────────────────────────────────────────────────────────────────────
// localStorage helpers
// ─────────────────────────────────────────────────────────────────────────────

function loadState(): LPState {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) return JSON.parse(raw) as LPState
  } catch {
    // ignore
  }
  // Default state
  const progress: Record<string, LPProgress> = {}
  DOMAINS.forEach(d => {
    progress[d.id] = {
      domainId: d.id,
      completedCount: 0,
      currentPct: 0,
      completedAt: [],
      lastCheckin: new Date().toISOString(),
    }
  })
  return { active: false, progress, readingCompleted: [] }
}

function saveState(state: LPState): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state))
  } catch {
    // ignore quota errors
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Geometry helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Deterministic world position for a given domain+milestone */
function milestonePosition(domainIdx: number, msIdx: number): THREE.Vector3 {
  const domainAngle = (domainIdx / DOMAINS.length) * Math.PI * 2 - Math.PI / 2
  const baseX = Math.cos(domainAngle) * DOMAIN_SPREAD_R
  const baseZ = Math.sin(domainAngle) * DOMAIN_SPREAD_R
  // Milestones extend outward from center in the same radial direction
  const radialX = Math.cos(domainAngle)
  const radialZ = Math.sin(domainAngle)
  const offset  = (msIdx - 2) * MS_SPREAD
  return new THREE.Vector3(
    baseX + radialX * offset,
    PATH_Y,
    baseZ + radialZ * offset,
  )
}

/** Build gradient color for path segment t ∈ [0,1]: teal → gold */
function pathColor(t: number): THREE.Color {
  return new THREE.Color().lerpColors(COLOR_TEAL, COLOR_GOLD, t)
}

// ─────────────────────────────────────────────────────────────────────────────
// Gem geometry factory
// ─────────────────────────────────────────────────────────────────────────────

type GemKind = 'completed' | 'current' | 'future'

function createGemMesh(kind: GemKind, domainColor: string): THREE.Mesh {
  const geo = new THREE.OctahedronGeometry(1.0, 1)

  let mat: THREE.MeshStandardMaterial

  if (kind === 'completed') {
    mat = new THREE.MeshStandardMaterial({
      color:             COLOR_GOLD,
      emissive:          COLOR_GOLD,
      emissiveIntensity: 0.9,
      metalness:         0.95,
      roughness:         0.05,
      transparent:       false,
    })
  } else if (kind === 'current') {
    const c = new THREE.Color(domainColor)
    mat = new THREE.MeshStandardMaterial({
      color:             c,
      emissive:          c,
      emissiveIntensity: 0.8,
      metalness:         0.7,
      roughness:         0.1,
      transparent:       true,
      opacity:           1.0,
    })
  } else {
    // future — ghostly dim outline
    mat = new THREE.MeshStandardMaterial({
      color:             COLOR_FUTURE,
      emissive:          COLOR_FUTURE,
      emissiveIntensity: 0.1,
      metalness:         0.2,
      roughness:         0.8,
      transparent:       true,
      opacity:           0.22,
      wireframe:         true,
    })
  }

  return new THREE.Mesh(geo, mat)
}

// ─────────────────────────────────────────────────────────────────────────────
// Radar chart HUD (canvas 2D overlay)
// ─────────────────────────────────────────────────────────────────────────────

interface RadarProps {
  domains: LPDomain[]
  progress: Record<string, LPProgress>
  visible: boolean
}

function RadarHUD({ domains, progress, visible }: RadarProps): React.ReactElement | null {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!visible) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const W = canvas.width
    const H = canvas.height
    const cx = W / 2
    const cy = H / 2
    const maxR = Math.min(cx, cy) - 32
    const N = domains.length

    ctx.clearRect(0, 0, W, H)

    // Background panel
    ctx.fillStyle = 'rgba(8,12,20,0.88)'
    ctx.beginPath()
    ctx.roundRect(0, 0, W, H, 12)
    ctx.fill()

    // Title
    ctx.fillStyle = '#94a3b8'
    ctx.font = 'bold 11px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('SKILL RADAR', cx, 18)

    // Grid rings (5 rings for 5 milestones)
    for (let ring = 1; ring <= 5; ring++) {
      const r = (ring / 5) * maxR
      ctx.beginPath()
      for (let i = 0; i < N; i++) {
        const angle = (i / N) * Math.PI * 2 - Math.PI / 2
        const x = cx + Math.cos(angle) * r
        const y = cy + Math.sin(angle) * r
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.closePath()
      ctx.strokeStyle = ring === 5 ? 'rgba(100,116,139,0.5)' : 'rgba(100,116,139,0.2)'
      ctx.lineWidth = ring === 5 ? 1 : 0.5
      ctx.stroke()
    }

    // Axes
    for (let i = 0; i < N; i++) {
      const angle = (i / N) * Math.PI * 2 - Math.PI / 2
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx + Math.cos(angle) * maxR, cy + Math.sin(angle) * maxR)
      ctx.strokeStyle = 'rgba(100,116,139,0.3)'
      ctx.lineWidth = 0.5
      ctx.stroke()
    }

    // Domain labels
    for (let i = 0; i < N; i++) {
      const d = domains[i]
      const angle = (i / N) * Math.PI * 2 - Math.PI / 2
      const labelR = maxR + 20
      const lx = cx + Math.cos(angle) * labelR
      const ly = cy + Math.sin(angle) * labelR
      ctx.fillStyle = d.color
      ctx.font = 'bold 9px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      // Abbreviate long names
      const short = d.name.split(' ').map(w => w[0]).join('')
      ctx.fillText(short, lx, ly)
    }

    // Data polygon
    const proficiencies = domains.map(d => {
      const p = progress[d.id]
      if (!p) return 0
      return (p.completedCount + p.currentPct / 100) / MILESTONES_PER_DOMAIN
    })

    ctx.beginPath()
    for (let i = 0; i < N; i++) {
      const angle = (i / N) * Math.PI * 2 - Math.PI / 2
      const r = proficiencies[i] * maxR
      const x = cx + Math.cos(angle) * r
      const y = cy + Math.sin(angle) * r
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()

    // Gradient fill
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR)
    grad.addColorStop(0, 'rgba(20,184,166,0.4)')
    grad.addColorStop(1, 'rgba(255,215,0,0.15)')
    ctx.fillStyle = grad
    ctx.fill()
    ctx.strokeStyle = '#14b8a6'
    ctx.lineWidth = 1.5
    ctx.stroke()

    // Data points with domain colors
    for (let i = 0; i < N; i++) {
      const angle = (i / N) * Math.PI * 2 - Math.PI / 2
      const r = proficiencies[i] * maxR
      const x = cx + Math.cos(angle) * r
      const y = cy + Math.sin(angle) * r
      ctx.beginPath()
      ctx.arc(x, y, 3.5, 0, Math.PI * 2)
      ctx.fillStyle = domains[i].color
      ctx.fill()
    }
  }, [domains, progress, visible])

  if (!visible) return null

  return (
    <canvas
      ref={canvasRef}
      width={200}
      height={200}
      style={{
        position:     'absolute',
        top:          '80px',
        right:        '16px',
        zIndex:       50,
        borderRadius: '12px',
        boxShadow:    '0 0 24px rgba(20,184,166,0.3)',
        pointerEvents: 'none',
      }}
    />
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Milestone info panel (React overlay)
// ─────────────────────────────────────────────────────────────────────────────

interface MilestoneInfo {
  domainName: string
  domainColor: string
  milestoneLabel: string
  requirements: string[]
  resources: string[]
  estimatedWeeks: number
  status: GemKind
  progress?: number
}

interface InfoPanelProps {
  info: MilestoneInfo | null
  onClose: () => void
  onComplete: () => void
  onCheckin: (pct: number) => void
}

function MilestoneInfoPanel({ info, onClose, onComplete, onCheckin }: InfoPanelProps): React.ReactElement | null {
  const [checkinPct, setCheckinPct] = useState(info?.progress ?? 0)

  useEffect(() => {
    setCheckinPct(info?.progress ?? 0)
  }, [info])

  if (!info) return null

  const statusColor: Record<GemKind, string> = {
    completed: '#ffd700',
    current:   info.domainColor,
    future:    '#64748b',
  }

  return (
    <div style={{
      position:        'absolute',
      bottom:          '24px',
      left:            '50%',
      transform:       'translateX(-50%)',
      zIndex:          60,
      background:      'rgba(8,12,20,0.96)',
      border:          `1px solid ${info.domainColor}55`,
      borderRadius:    '14px',
      padding:         '20px 24px',
      minWidth:        '340px',
      maxWidth:        '480px',
      boxShadow:       `0 0 40px ${info.domainColor}33`,
      backdropFilter:  'blur(12px)',
      color:           '#e2e8f0',
      fontFamily:      'sans-serif',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
        <div>
          <div style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '2px' }}>
            {info.domainName}
          </div>
          <div style={{ fontSize: '18px', fontWeight: 700, color: statusColor[info.status] }}>
            {info.milestoneLabel}
          </div>
          <div style={{
            display:       'inline-block',
            marginTop:     '4px',
            padding:       '2px 8px',
            borderRadius:  '20px',
            fontSize:      '10px',
            fontWeight:    600,
            background:    statusColor[info.status] + '22',
            color:         statusColor[info.status],
            textTransform: 'uppercase',
          }}>
            {info.status}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '18px', lineHeight: 1, padding: '0 0 0 12px' }}
        >
          ×
        </button>
      </div>

      {/* Estimated time */}
      <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '14px' }}>
        ⏱ Est. {info.estimatedWeeks} weeks to complete
      </div>

      {/* Requirements */}
      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>Requirements</div>
        {info.requirements.map((r, i) => (
          <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '4px', fontSize: '12px' }}>
            <span style={{ color: info.domainColor, flexShrink: 0 }}>›</span>
            <span>{r}</span>
          </div>
        ))}
      </div>

      {/* Resources */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>Resources</div>
        {info.resources.map((r, i) => (
          <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '4px', fontSize: '12px' }}>
            <span style={{ color: '#6366f1', flexShrink: 0 }}>📖</span>
            <span style={{ color: '#a5b4fc' }}>{r}</span>
          </div>
        ))}
      </div>

      {/* Progress check-in (current milestone only) */}
      {info.status === 'current' && (
        <div style={{ marginBottom: '14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
            <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Progress</span>
            <span style={{ fontSize: '12px', color: info.domainColor, fontWeight: 600 }}>{Math.round(checkinPct)}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={checkinPct}
            onChange={e => setCheckinPct(Number(e.target.value))}
            style={{ width: '100%', accentColor: info.domainColor, marginBottom: '8px' }}
          />
          <button
            onClick={() => onCheckin(checkinPct)}
            style={{
              width:        '100%',
              padding:      '8px',
              background:   info.domainColor + '22',
              border:       `1px solid ${info.domainColor}55`,
              borderRadius: '8px',
              color:        info.domainColor,
              fontSize:     '12px',
              fontWeight:   600,
              cursor:       'pointer',
            }}
          >
            Save Progress
          </button>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: '8px' }}>
        {info.status === 'current' && (
          <button
            onClick={onComplete}
            style={{
              flex:         1,
              padding:      '9px',
              background:   `linear-gradient(135deg, #14b8a6, #ffd700)`,
              border:       'none',
              borderRadius: '8px',
              color:        '#0f172a',
              fontSize:     '12px',
              fontWeight:   700,
              cursor:       'pointer',
            }}
          >
            ✓ Mark Complete
          </button>
        )}
        {info.status === 'future' && (
          <div style={{ flex: 1, fontSize: '11px', color: '#475569', textAlign: 'center', padding: '9px' }}>
            Complete previous milestones to unlock
          </div>
        )}
        {info.status === 'completed' && (
          <div style={{
            flex:         1,
            padding:      '9px',
            background:   '#ffd70022',
            border:       '1px solid #ffd70055',
            borderRadius: '8px',
            color:        '#ffd700',
            fontSize:     '12px',
            fontWeight:   600,
            textAlign:    'center',
          }}>
            ✓ Mastered
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Reading list panel
// ─────────────────────────────────────────────────────────────────────────────

interface ReadingListProps {
  completed: string[]
  onToggle: (id: string) => void
  visible: boolean
}

function ReadingListPanel({ completed, onToggle, visible }: ReadingListProps): React.ReactElement | null {
  if (!visible) return null
  return (
    <div style={{
      position:       'absolute',
      top:            '80px',
      left:           '16px',
      zIndex:         50,
      background:     'rgba(8,12,20,0.92)',
      border:         '1px solid rgba(20,184,166,0.25)',
      borderRadius:   '12px',
      padding:        '14px 16px',
      minWidth:       '210px',
      boxShadow:      '0 0 24px rgba(20,184,166,0.15)',
      backdropFilter: 'blur(10px)',
      color:          '#e2e8f0',
      fontFamily:     'sans-serif',
    }}>
      <div style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px' }}>
        📚 Reading List · Leadership
      </div>
      {READING_BOOKS.map(book => {
        const done = completed.includes(book.id)
        return (
          <div
            key={book.id}
            onClick={() => onToggle(book.id)}
            style={{
              display:      'flex',
              alignItems:   'center',
              gap:          '8px',
              padding:      '6px 0',
              cursor:       'pointer',
              borderBottom: '1px solid rgba(100,116,139,0.12)',
            }}
          >
            <div style={{
              width:        '16px',
              height:       '16px',
              borderRadius: '4px',
              border:       `1px solid ${done ? '#14b8a6' : '#334155'}`,
              background:   done ? '#14b8a622' : 'transparent',
              flexShrink:   0,
              display:      'flex',
              alignItems:   'center',
              justifyContent: 'center',
              fontSize:     '10px',
              color:        '#14b8a6',
            }}>
              {done ? '✓' : ''}
            </div>
            <div>
              <div style={{ fontSize: '11px', fontWeight: done ? 600 : 400, color: done ? '#14b8a6' : '#94a3b8' }}>
                {book.title}
              </div>
              <div style={{ fontSize: '10px', color: '#475569' }}>+{book.progressBoost}% Leadership</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

interface ClickedMilestone {
  domainIdx: number
  msIdx: number
}

export const LearningPathLayer: React.FC = () => {
  const { scene, camera } = useWorldContext()

  // ── State ──────────────────────────────────────────────────────────────────
  const [lpState, setLpState]     = useState<LPState>(loadState)
  const [visible, setVisible]     = useState(false)
  const [clicked, setClicked]     = useState<ClickedMilestone | null>(null)
  const [showReading, setShowReading] = useState(true)

  // ── Three.js refs ──────────────────────────────────────────────────────────
  const objectsRef   = useRef<THREE.Object3D[]>([])
  const labelsRef    = useRef<NWLabel[]>([])
  const gemsRef      = useRef<Map<string, THREE.Mesh>>(new Map())
  const ringsRef     = useRef<Map<string, THREE.Mesh>>(new Map())
  const particlesRef = useRef<THREE.Points | null>(null)
  const rafRef       = useRef<number>(0)
  const raycasterRef = useRef(new THREE.Raycaster())
  const pathPointsRef = useRef<THREE.Vector3[]>([])
  const particleOffsetsRef = useRef<Float32Array>(new Float32Array(PARTICLE_COUNT))

  // ── Persist state ──────────────────────────────────────────────────────────
  useEffect(() => {
    saveState(lpState)
  }, [lpState])

  // ── Computed: clicked milestone info ──────────────────────────────────────
  const milestoneInfo: MilestoneInfo | null = (() => {
    if (!clicked) return null
    const domain  = DOMAINS[clicked.domainIdx]
    const ms      = domain.milestones[clicked.msIdx]
    const prog    = lpState.progress[domain.id]
    let status: GemKind
    if (!prog) {
      status = clicked.msIdx === 0 ? 'current' : 'future'
    } else if (clicked.msIdx < prog.completedCount) {
      status = 'completed'
    } else if (clicked.msIdx === prog.completedCount) {
      status = 'current'
    } else {
      status = 'future'
    }
    return {
      domainName:     domain.name,
      domainColor:    domain.color,
      milestoneLabel: ms.label,
      requirements:   ms.requirements,
      resources:      ms.resources,
      estimatedWeeks: ms.estimatedWeeks,
      status,
      progress:       status === 'current' ? (prog?.currentPct ?? 0) : undefined,
    }
  })()

  // ── Clear Three.js objects ─────────────────────────────────────────────────
  const clearScene = useCallback(() => {
    cancelAnimationFrame(rafRef.current)

    objectsRef.current.forEach(obj => {
      scene.remove(obj)
      const mesh = obj as THREE.Mesh
      if (mesh.geometry) mesh.geometry.dispose()
      if (mesh.material) {
        const m = mesh.material
        if (Array.isArray(m)) m.forEach(x => x.dispose())
        else (m as THREE.Material).dispose()
      }
    })
    objectsRef.current = []

    labelsRef.current.forEach(l => {
      disposeLabel(l)
      scene.remove(l)
    })
    labelsRef.current = []

    if (particlesRef.current) {
      scene.remove(particlesRef.current)
      particlesRef.current.geometry.dispose()
      ;(particlesRef.current.material as THREE.Material).dispose()
      particlesRef.current = null
    }

    gemsRef.current.clear()
    ringsRef.current.clear()
    pathPointsRef.current = []
  }, [scene])

  // ── Build Three.js scene ───────────────────────────────────────────────────
  const buildScene = useCallback((state: LPState) => {
    clearScene()

    // Collect all milestone world positions
    const allPoints: THREE.Vector3[] = []

    DOMAINS.forEach((domain, dIdx) => {
      const prog = state.progress[domain.id]
      const completed = prog?.completedCount ?? 0
      const currentPct = prog?.currentPct ?? 0

      domain.milestones.forEach((_ms, mIdx) => {
        const pos = milestonePosition(dIdx, mIdx)
        allPoints.push(pos.clone())

        // Determine kind
        let kind: GemKind
        if (mIdx < completed) {
          kind = 'completed'
        } else if (mIdx === completed) {
          kind = 'current'
        } else {
          kind = 'future'
        }

        // Gem mesh
        const gem = createGemMesh(kind, domain.color)
        gem.position.set(pos.x, kind === 'current' ? GEM_CURRENT_Y : GEM_Y, pos.z)
        gem.scale.setScalar(kind === 'current' ? 1.5 : 1.0)
        gem.userData = { domainIdx: dIdx, msIdx: mIdx }
        scene.add(gem)
        objectsRef.current.push(gem)
        gemsRef.current.set(`${dIdx}-${mIdx}`, gem)

        // Point light for completed/current
        if (kind !== 'future') {
          const lightColor = kind === 'completed' ? 0xffd700 : new THREE.Color(domain.color).getHex()
          const light = new THREE.PointLight(lightColor, kind === 'current' ? 1.8 : 1.0, 14)
          light.position.set(pos.x, GEM_Y, pos.z)
          scene.add(light)
          objectsRef.current.push(light)
        }

        // Ground glow circle
        const circGeo = new THREE.CircleGeometry(kind === 'current' ? 3.5 : 2.0, 24)
        const circColor = kind === 'completed' ? COLOR_GOLD
                        : kind === 'current'   ? new THREE.Color(domain.color)
                        : COLOR_FUTURE
        const circMat = new THREE.MeshBasicMaterial({
          color:       circColor,
          transparent: true,
          opacity:     kind === 'future' ? 0.04 : 0.15,
          side:        THREE.DoubleSide,
        })
        const circ = new THREE.Mesh(circGeo, circMat)
        circ.rotation.x = -Math.PI / 2
        circ.position.set(pos.x, 0.05, pos.z)
        scene.add(circ)
        objectsRef.current.push(circ)

        // Progress ring for current milestone
        if (kind === 'current') {
          const ringAngle = (currentPct / 100) * Math.PI * 2
          const curve = new THREE.EllipseCurve(0, 0, 1.8, 1.8, 0, ringAngle, false, 0)
          const ringPts = curve.getPoints(48)
          const ringGeo = new THREE.BufferGeometry().setFromPoints(
            ringPts.map(p => new THREE.Vector3(p.x, 0, p.y))
          )
          const ringMat = new THREE.LineBasicMaterial({
            color:       new THREE.Color(domain.color),
            transparent: true,
            opacity:     0.9,
          })
          const ring = new THREE.Line(ringGeo, ringMat) as unknown as THREE.Mesh
          ring.position.set(pos.x, GEM_CURRENT_Y - 1.5, pos.z)
          scene.add(ring)
          objectsRef.current.push(ring)
          ringsRef.current.set(`${dIdx}-${mIdx}`, ring)
        }

        // Label
        const labelText = `${domain.name.split(' ').slice(0, 2).join(' ')} · ${_ms.label}`
        const labelColor = kind === 'completed' ? '#ffd700'
                         : kind === 'current'   ? domain.color
                         : '#334155'
        const label = makeLabel(labelText, labelColor, { labelType: 'agent' })
        const labelY = (kind === 'current' ? GEM_CURRENT_Y : GEM_Y) + 1.8
        label.position.set(pos.x, labelY, pos.z)
        scene.add(label)
        labelsRef.current.push(label)
      })
    })

    pathPointsRef.current = allPoints

    // ── Path tube (CatmullRomCurve3) ─────────────────────────────────────────
    // Build path through milestones in domain order (beginner → master per domain)
    if (allPoints.length >= 2) {
      try {
        const curve = new THREE.CatmullRomCurve3(
          allPoints.map(p => new THREE.Vector3(p.x, PATH_Y, p.z)),
          false,
          'catmullrom',
          0.5
        )

        const TUBE_SEGMENTS  = allPoints.length * 8
        const RADIAL_SEGMENTS = 6

        // Build gradient tube by splitting into segments with lerped color
        const GRADIENT_SEGMENTS = 12
        const pointsOnCurve = curve.getPoints(TUBE_SEGMENTS)

        for (let seg = 0; seg < GRADIENT_SEGMENTS; seg++) {
          const tStart = seg / GRADIENT_SEGMENTS
          const tEnd   = (seg + 1) / GRADIENT_SEGMENTS
          const startIdx = Math.floor(tStart * pointsOnCurve.length)
          const endIdx   = Math.min(Math.floor(tEnd * pointsOnCurve.length), pointsOnCurve.length - 1)
          const segPoints = pointsOnCurve.slice(startIdx, endIdx + 1)
          if (segPoints.length < 2) continue

          const segCurve  = new THREE.CatmullRomCurve3(segPoints)
          const tubeGeo   = new THREE.TubeGeometry(segCurve, Math.max(segPoints.length, 4), PATH_TUBE_R, RADIAL_SEGMENTS, false)
          const tMid      = (tStart + tEnd) / 2
          const col       = pathColor(tMid)
          const tubeMat   = new THREE.MeshStandardMaterial({
            color:             col,
            emissive:          col,
            emissiveIntensity: 0.6,
            transparent:       true,
            opacity:           0.65,
            metalness:         0.4,
            roughness:         0.3,
          })
          const tube = new THREE.Mesh(tubeGeo, tubeMat)
          scene.add(tube)
          objectsRef.current.push(tube)

          // Glow halo
          const haloGeo = new THREE.TubeGeometry(segCurve, Math.max(segPoints.length, 4), PATH_TUBE_R * 2.8, RADIAL_SEGMENTS, false)
          const haloMat = new THREE.MeshBasicMaterial({
            color:       col,
            transparent: true,
            opacity:     0.08,
          })
          const halo = new THREE.Mesh(haloGeo, haloMat)
          scene.add(halo)
          objectsRef.current.push(halo)
        }
      } catch {
        // If tube fails, skip gracefully
      }
    }

    // ── Path particles ────────────────────────────────────────────────────────
    if (allPoints.length >= 2) {
      const posArray = new Float32Array(PARTICLE_COUNT * 3)
      const colorArr = new Float32Array(PARTICLE_COUNT * 3)
      const offsets  = new Float32Array(PARTICLE_COUNT)

      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const t   = i / PARTICLE_COUNT
        const seg = Math.floor(t * (allPoints.length - 1))
        const tl  = t * (allPoints.length - 1) - seg
        const a   = allPoints[Math.min(seg, allPoints.length - 1)]
        const b   = allPoints[Math.min(seg + 1, allPoints.length - 1)]
        posArray[i * 3]     = a.x + (b.x - a.x) * tl
        posArray[i * 3 + 1] = PATH_Y + 0.4
        posArray[i * 3 + 2] = a.z + (b.z - a.z) * tl

        const c = pathColor(t)
        colorArr[i * 3]     = c.r
        colorArr[i * 3 + 1] = c.g
        colorArr[i * 3 + 2] = c.b

        offsets[i] = t
      }

      particleOffsetsRef.current = offsets

      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(posArray, 3))
      geo.setAttribute('color',    new THREE.BufferAttribute(colorArr, 3))
      const mat = new THREE.PointsMaterial({
        size:             0.3,
        transparent:      true,
        opacity:          0.85,
        sizeAttenuation:  true,
        vertexColors:     true,
      })
      particlesRef.current = new THREE.Points(geo, mat)
      scene.add(particlesRef.current)
    }

    // ── Animation loop ────────────────────────────────────────────────────────
    let lastTime = performance.now()

    function animate() {
      rafRef.current = requestAnimationFrame(animate)
      const now = performance.now()
      const dt  = Math.min((now - lastTime) / 1000, 0.1)
      lastTime  = now
      const t   = now / 1000

      // Rotate gems
      gemsRef.current.forEach((gem, key) => {
        const [, msIdxStr] = key.split('-')
        const msIdx = parseInt(msIdxStr, 10)
        const prog  = lpState.progress[DOMAINS[parseInt(key.split('-')[0], 10)]?.id ?? '']
        const completed = prog?.completedCount ?? 0

        gem.rotation.y += ROTATE_SPEED * dt
        gem.rotation.x += ROTATE_SPEED * 0.2 * dt

        if (msIdx === completed) {
          // Pulse current milestone scale
          const pulse = 1.5 + Math.sin(t * PULSE_SPEED) * 0.12
          gem.scale.setScalar(pulse)
          // Pulse height
          gem.position.y = GEM_CURRENT_Y + Math.sin(t * 1.4 + gem.position.x * 0.05) * 0.4
          // Pulse emissive
          const mat = gem.material as THREE.MeshStandardMaterial
          mat.emissiveIntensity = 0.6 + Math.sin(t * PULSE_SPEED) * 0.3
        } else {
          gem.position.y = GEM_Y + Math.sin(t * 0.9 + gem.position.z * 0.08) * 0.2
        }
      })

      // Progress ring pulse
      ringsRef.current.forEach(ring => {
        const lineMat = (ring as unknown as THREE.Line).material as THREE.LineBasicMaterial
        lineMat.opacity = 0.7 + Math.sin(t * PULSE_SPEED * 1.3) * 0.3
      })

      // Animate particles along path
      if (particlesRef.current && pathPointsRef.current.length >= 2) {
        const pts     = pathPointsRef.current
        const posAttr = particlesRef.current.geometry.getAttribute('position') as THREE.BufferAttribute
        const offsets = particleOffsetsRef.current
        const SPEED   = 0.04 / pts.length

        for (let i = 0; i < PARTICLE_COUNT; i++) {
          offsets[i] = (offsets[i] + dt * SPEED) % 1
          const tf  = offsets[i]
          const seg = Math.floor(tf * (pts.length - 1))
          const tl  = tf * (pts.length - 1) - seg
          const a   = pts[Math.min(seg, pts.length - 1)]
          const b   = pts[Math.min(seg + 1, pts.length - 1)]
          posAttr.setXYZ(
            i,
            a.x + (b.x - a.x) * tl,
            PATH_Y + 0.4 + Math.sin(tf * Math.PI * 6 + t) * 0.18,
            a.z + (b.z - a.z) * tl,
          )
        }
        posAttr.needsUpdate = true
      }

      // Update label visibility
      const wp = new THREE.Vector3()
      labelsRef.current.forEach(lbl => {
        lbl.getWorldPosition(wp)
        lbl.updateVisibility(camera, wp)
      })
    }
    animate()
  }, [scene, camera, clearScene, lpState])

  // ── Click ray-casting ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!visible) return

    function onClick(e: MouseEvent) {
      const canvas = (scene as unknown as { domElement?: HTMLElement }).domElement
        ?? document.querySelector('canvas')
      if (!canvas) return

      const rect = canvas.getBoundingClientRect()
      const ndcX =  ((e.clientX - rect.left)  / rect.width)  * 2 - 1
      const ndcY = -((e.clientY - rect.top)   / rect.height) * 2 + 1

      raycasterRef.current.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera)

      const gems = Array.from(gemsRef.current.values())
      const hits  = raycasterRef.current.intersectObjects(gems)
      if (hits.length > 0) {
        const { domainIdx, msIdx } = hits[0].object.userData as { domainIdx: number; msIdx: number }
        setClicked({ domainIdx, msIdx })
      }
    }

    window.addEventListener('click', onClick)
    return () => window.removeEventListener('click', onClick)
  }, [visible, scene, camera])

  // ── External event listeners ───────────────────────────────────────────────
  useEffect(() => {
    function onActivate() {
      setVisible(true)
      setLpState(prev => {
        const next = { ...prev, active: true }
        buildScene(next)
        return next
      })
    }

    function onDeactivate() {
      setVisible(false)
      setClicked(null)
      clearScene()
      setLpState(prev => ({ ...prev, active: false }))
    }

    function onMilestoneComplete(e: Event) {
      const { domainId, milestoneIdx } = (e as CustomEvent<{ domainId: string; milestoneIdx: number }>).detail
      setLpState(prev => {
        const prog = prev.progress[domainId]
        if (!prog || milestoneIdx !== prog.completedCount) return prev
        const updated: LPState = {
          ...prev,
          progress: {
            ...prev.progress,
            [domainId]: {
              ...prog,
              completedCount: prog.completedCount + 1,
              currentPct:     0,
              completedAt:    [...prog.completedAt, new Date().toISOString()],
              lastCheckin:    new Date().toISOString(),
            },
          },
        }
        if (visible) buildScene(updated)
        return updated
      })
      setClicked(null)
    }

    function onMilestoneCheckin(e: Event) {
      const { domainId, milestoneIdx, pct } = (e as CustomEvent<{ domainId: string; milestoneIdx: number; pct: number }>).detail
      setLpState(prev => {
        const prog = prev.progress[domainId]
        if (!prog || milestoneIdx !== prog.completedCount) return prev
        const updated: LPState = {
          ...prev,
          progress: {
            ...prev.progress,
            [domainId]: {
              ...prog,
              currentPct:  Math.max(0, Math.min(100, pct)),
              lastCheckin: new Date().toISOString(),
            },
          },
        }
        if (visible) buildScene(updated)
        return updated
      })
    }

    window.addEventListener('nw:learning-path-activate',   onActivate)
    window.addEventListener('nw:learning-path-deactivate', onDeactivate)
    window.addEventListener('nw:milestone-complete',       onMilestoneComplete)
    window.addEventListener('nw:milestone-checkin',        onMilestoneCheckin)

    // Auto-activate if state was previously active
    const saved = loadState()
    if (saved.active) {
      setVisible(true)
      buildScene(saved)
    }

    return () => {
      window.removeEventListener('nw:learning-path-activate',   onActivate)
      window.removeEventListener('nw:learning-path-deactivate', onDeactivate)
      window.removeEventListener('nw:milestone-complete',       onMilestoneComplete)
      window.removeEventListener('nw:milestone-checkin',        onMilestoneCheckin)
      clearScene()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Reading list toggle handler ────────────────────────────────────────────
  const handleReadingToggle = useCallback((bookId: string) => {
    setLpState(prev => {
      const already = prev.readingCompleted.includes(bookId)
      const book    = READING_BOOKS.find(b => b.id === bookId)
      if (!book) return prev

      let readingCompleted: string[]
      let progress = { ...prev.progress }

      if (already) {
        readingCompleted = prev.readingCompleted.filter(id => id !== bookId)
        // Reduce leadership progress
        const lp = progress[book.domainId]
        if (lp) {
          const newPct = Math.max(0, lp.currentPct - book.progressBoost)
          progress = {
            ...progress,
            [book.domainId]: { ...lp, currentPct: newPct, lastCheckin: new Date().toISOString() },
          }
        }
      } else {
        readingCompleted = [...prev.readingCompleted, bookId]
        // Boost leadership progress
        const lp = progress[book.domainId]
        if (lp) {
          const newPct = Math.min(100, lp.currentPct + book.progressBoost)
          progress = {
            ...progress,
            [book.domainId]: { ...lp, currentPct: newPct, lastCheckin: new Date().toISOString() },
          }
        }
      }

      const next = { ...prev, readingCompleted, progress }
      if (visible) buildScene(next)
      return next
    })
  }, [visible, buildScene])

  // ── Milestone panel actions ────────────────────────────────────────────────
  const handleComplete = useCallback(() => {
    if (!clicked || !milestoneInfo || milestoneInfo.status !== 'current') return
    const domain = DOMAINS[clicked.domainIdx]
    window.dispatchEvent(new CustomEvent('nw:milestone-complete', {
      detail: { domainId: domain.id, milestoneIdx: clicked.msIdx },
    }))
  }, [clicked, milestoneInfo])

  const handleCheckin = useCallback((pct: number) => {
    if (!clicked || !milestoneInfo || milestoneInfo.status !== 'current') return
    const domain = DOMAINS[clicked.domainIdx]
    window.dispatchEvent(new CustomEvent('nw:milestone-checkin', {
      detail: { domainId: domain.id, milestoneIdx: clicked.msIdx, pct },
    }))
  }, [clicked, milestoneInfo])

  // ── Render ────────────────────────────────────────────────────────────────
  if (!visible) return null

  return (
    <>
      {/* Radar HUD */}
      <RadarHUD
        domains={DOMAINS}
        progress={lpState.progress}
        visible={visible}
      />

      {/* Reading list */}
      <ReadingListPanel
        completed={lpState.readingCompleted}
        onToggle={handleReadingToggle}
        visible={showReading}
      />

      {/* Toggle reading list button */}
      <button
        onClick={() => setShowReading(v => !v)}
        style={{
          position:       'absolute',
          top:            '44px',
          left:           '16px',
          zIndex:         55,
          background:     'rgba(8,12,20,0.85)',
          border:         '1px solid rgba(20,184,166,0.25)',
          borderRadius:   '8px',
          padding:        '5px 10px',
          color:          '#14b8a6',
          fontSize:       '11px',
          fontWeight:     600,
          cursor:         'pointer',
          fontFamily:     'sans-serif',
        }}
      >
        📚 {showReading ? 'Hide' : 'Show'} Reading List
      </button>

      {/* Milestone info panel */}
      {milestoneInfo && (
        <MilestoneInfoPanel
          info={milestoneInfo}
          onClose={() => setClicked(null)}
          onComplete={handleComplete}
          onCheckin={handleCheckin}
        />
      )}

      {/* Domain legend */}
      <div style={{
        position:       'absolute',
        top:            '44px',
        right:          '16px',
        zIndex:         55,
        background:     'rgba(8,12,20,0.85)',
        border:         '1px solid rgba(100,116,139,0.2)',
        borderRadius:   '10px',
        padding:        '10px 14px',
        fontFamily:     'sans-serif',
        display:        'flex',
        flexDirection:  'column',
        gap:            '5px',
      }}>
        <div style={{ fontSize: '9px', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>
          Learning Path
        </div>
        {DOMAINS.map(d => {
          const prog  = lpState.progress[d.id]
          const done  = prog?.completedCount ?? 0
          const pct   = prog?.currentPct ?? 0
          return (
            <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: d.color, flexShrink: 0 }} />
              <div style={{ fontSize: '10px', color: '#94a3b8', minWidth: '110px' }}>{d.name}</div>
              <div style={{ fontSize: '10px', color: '#475569' }}>
                {done}/{MILESTONES_PER_DOMAIN}
                {done < MILESTONES_PER_DOMAIN && pct > 0 ? ` (${Math.round(pct)}%)` : ''}
              </div>
            </div>
          )
        })}
        <div style={{ marginTop: '6px', display: 'flex', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <div style={{ width: '8px', height: '8px', background: '#ffd700', borderRadius: '2px' }} />
            <span style={{ fontSize: '9px', color: '#64748b' }}>Completed</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <div style={{ width: '8px', height: '8px', background: '#14b8a6', borderRadius: '2px' }} />
            <span style={{ fontSize: '9px', color: '#64748b' }}>Current</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <div style={{ width: '8px', height: '8px', background: '#334155', borderRadius: '2px' }} />
            <span style={{ fontSize: '9px', color: '#64748b' }}>Future</span>
          </div>
        </div>
      </div>
    </>
  )
}

export default LearningPathLayer
