// @ts-nocheck
/**
 * CombinedNeuralMap.tsx — B67 | Neural Map 2 - Combined Business Intelligence
 *
 * Two root nodes: [Power On Solutions LLC] and [PowerOn Hub]
 * RMO bridge node sits between both as a connector
 * POS branch: Lead Acquired → ... → Compliance Record (9 nodes)
 * Hub branch: Platform Built → ... → Revenue (7 nodes)
 * Animated constellation background + pulse ring effects
 * Projection Mode (dashed) vs Active Mode (solid)
 * Tap node: expand detail panel on right (AI, Human, Economics, Compliance, Risk)
 * Drag to reposition nodes. Zoom + pan.
 */

import { useRef, useEffect, useState, useCallback } from 'react'

// ─── Types ─────────────────────────────────────────────────────────────────

interface NodeMeta {
  ai: string
  human: string
  economics: string
  risk: string
  compliance: string
}

interface MapNode {
  id: string
  label: string
  branch: 'pos' | 'hub' | 'rmo' | 'root'
  color: string
  size: number
  xPct: number
  yPct: number
  meta: NodeMeta
  isRevenue?: boolean
}

interface MapEdge {
  from: string
  to: string
  color: string
}

interface StarDot {
  x: number; y: number
  opacity: number; baseOpacity: number
  speed: number; size: number
  twinkleOffset: number
}

interface PulseRing {
  nodeId: string; startTime: number; color: string
}

interface NodePos {
  x: number; y: number
}

// ─── Node Definitions ───────────────────────────────────────────────────────

const ALL_NODES: MapNode[] = [
  // ── ROOT NODES ──
  {
    id: 'pos-root',
    label: 'Power On\nSolutions LLC',
    branch: 'root', color: '#00d4ff', size: 44,
    xPct: 0.20, yPct: 0.09,
    meta: {
      ai: 'NEXUS orchestrates all AI agents across the entire Power On Solutions pipeline — VAULT, OHM, LEDGER, GUARDIAN, SPARK, BLUEPRINT, CHRONO, ATLAS',
      human: 'Owner/operator Christian manages all projects, estimates, field operations, collections and compliance as sole operator',
      economics: 'Annual revenue target: $400K+ | Overhead tracked in settings | Net margin goal: 35% | Active pipeline tracked weekly',
      risk: 'Single-operator dependency, seasonal project variability, material cost fluctuations, subcontractor availability',
      compliance: 'CA Contractor License C-10, 5-year document retention required, OSHA field safety compliance, bonded and insured'
    }
  },
  {
    id: 'hub-root',
    label: 'PowerOn\nHub',
    branch: 'root', color: '#a855f7', size: 44,
    xPct: 0.80, yPct: 0.09,
    meta: {
      ai: 'NEXUS AI orchestration brain + 15 specialized agents across all Hub features — full agent roster active in production',
      human: 'Platform administrator manages onboarding, agent configuration, roadmap planning via Claude Cowork sessions',
      economics: 'SaaS platform | RMO subscription model | Beta phase: $0 | Short-term target MRR: $5K | Long-term: $50K+',
      risk: 'Platform adoption curve, competitor landscape, Supabase/API cost scaling at volume, feature support burden',
      compliance: 'SOC2 path planned, data privacy CCPA/GDPR compliance required at launch, contractor license database accuracy critical'
    }
  },

  // ── RMO BRIDGE ──
  {
    id: 'rmo',
    label: 'RMO\nBridge',
    branch: 'rmo', color: '#f59e0b', size: 40,
    xPct: 0.50, yPct: 0.21,
    meta: {
      ai: 'NEXUS reads RMO pipeline data to surface deal status, income projections, and required next actions for activation',
      human: 'Owner manages RMO client relationships, uploads activation documents, sets monthly income targets',
      economics: 'Deal Status: PENDING ACTIVATION | Scenario A: 10 systems/mo → $2K–$3K/mo | Scenario B: 25 systems/mo → $6K–$8K/mo | Document Upload: PENDING',
      risk: 'RMO deal not yet active — all income is projected only. Regulatory risk if solar incentive programs change. Activation timeline uncertain.',
      compliance: 'Document upload status: PENDING — NDA, Service Agreement, License verification all required before activation'
    }
  },

  // ── POS BRANCH (left column) ──
  {
    id: 'lead-acquired',
    label: 'Lead\nAcquired',
    branch: 'pos', color: '#22d3ee', size: 32,
    xPct: 0.065, yPct: 0.28,
    meta: {
      ai: 'HUNTER agent scores lead quality from GC contacts table, auto-creates CRM pipeline entry, flags high-value targets',
      human: 'Owner qualifies inbound leads, sets follow-up schedule, assigns priority tier, contacts GC via phone or text',
      economics: 'Avg lead acquisition cost: $50–$200 | Conversion rate target: 40–55% | Time to qualify: 1–3 hrs | LTV per converted lead: $15K–$85K',
      risk: 'Lead quality variance, ghosting after initial contact, competitor undercutting on price, seasonal slowdowns',
      compliance: 'CCPA consent capture at lead entry, lead source logging required — 5-year retention in leads table'
    }
  },
  {
    id: 'estimate-created',
    label: 'Estimate\nCreated',
    branch: 'pos', color: '#22d3ee', size: 32,
    xPct: 0.06, yPct: 0.40,
    meta: {
      ai: 'VAULT agent assembles estimate: labor calculation, material pricing from price book, overhead injection, markup application',
      human: 'Owner reviews all line items, adjusts scope, applies final markup, generates PDF, sends to client via email',
      economics: 'Avg estimate value: $8K–$85K | Labor: 35–45% | Materials: 40–50% | Overhead: 15–20% | Avg prep time: 2–6 hrs',
      risk: 'Scope creep at estimate stage, material price volatility between estimate and execution, labor rate assumption errors',
      compliance: 'Estimate PDF archived in blueprint_uploads, signed copy required before work begins — stored 5 years'
    }
  },
  {
    id: 'contract-signed',
    label: 'Contract\nSigned',
    branch: 'pos', color: '#22d3ee', size: 32,
    xPct: 0.065, yPct: 0.52,
    meta: {
      ai: 'BLUEPRINT agent parses contract documents, flags non-standard clauses, scope gaps, and missing terms for review',
      human: 'Owner negotiates terms, signs contract, schedules kickoff meeting, sets phase targets and milestones',
      economics: 'Contract value locked at signing | Deposit: 10–30% collected at signing | Time to signature: 3–14 days avg',
      risk: 'Scope ambiguity in contract language, change order risk if scope not precisely defined, payment term disputes',
      compliance: 'Signed contract + permit docs — 5-year retention required, stored in compliance_records table'
    }
  },
  {
    id: 'active-project',
    label: 'Active\nProject',
    branch: 'pos', color: '#22d3ee', size: 32,
    xPct: 0.075, yPct: 0.64,
    meta: {
      ai: 'GUARDIAN monitors project health daily: phase completion %, labor burn rate, schedule drift alerts',
      human: 'Owner + crew execute field work, log hours daily, update phase completion percentages in app',
      economics: 'Avg project duration: 4–16 weeks | Daily revenue target tracked vs actuals | Budget variance alerts at 10%',
      risk: 'Schedule overrun, labor underestimation, inspector delays, material delivery failures, weather delays',
      compliance: 'Daily field logs required in logs table, permit inspections logged with timestamps — 5-year retention'
    }
  },
  {
    id: 'field-work',
    label: 'Field Work',
    branch: 'pos', color: '#22d3ee', size: 32,
    xPct: 0.07, yPct: 0.76,
    meta: {
      ai: 'CHRONO agent tracks schedule milestones, predicts completion date, flags at-risk phases and crew conflicts',
      human: 'Field crew logs daily work via mobile app, supervisor reviews logs, owner approves timesheets and mileage',
      economics: 'Labor: $75–$120/hr | Mileage: tracked per trip at IRS rate | Field phase: 60–70% of total project cost',
      risk: 'Weather delays, crew availability, unexpected site conditions, code non-compliance discovered in field',
      compliance: 'OSHA field safety logs required, T&M records mandatory, photo documentation in voice_notes — 5-year retention'
    }
  },
  {
    id: 'rfi-resolution',
    label: 'RFI\nResolution',
    branch: 'pos', color: '#22d3ee', size: 32,
    xPct: 0.14, yPct: 0.85,
    meta: {
      ai: 'OHM agent interprets NEC code requirements for RFI context, BLUEPRINT agent cross-checks drawings for discrepancies',
      human: 'Owner submits RFI to GC or inspector, documents the response, updates scope and schedule if required',
      economics: 'RFI delay cost: $200–$2K/day for idle crew | Avg resolution time: 3–10 business days | Change order value: $500–$5K',
      risk: 'GC responsiveness delays, inspector interpretation variance, scope changes that increase cost without contract update',
      compliance: 'All RFIs logged in rfis table with full timestamps and GC responses archived — 5-year retention required'
    }
  },
  {
    id: 'invoice-sent',
    label: 'Invoice\nSent',
    branch: 'pos', color: '#22d3ee', size: 32,
    xPct: 0.26, yPct: 0.91,
    meta: {
      ai: 'LEDGER agent generates invoice from project actuals, validates against estimate, flags potential overbilling',
      human: 'Owner reviews invoice line items, adds extras and change orders, sends final invoice to GC or client',
      economics: 'Avg invoice: $12K–$90K | Net 30 payment terms typical | Progress billing: 30/60/final structure common',
      risk: 'GC disputes on line items, lien deadline pressure if payment delayed, unbilled work if field logs are incomplete',
      compliance: 'Invoice + all signed change orders archived, preliminary lien rights preserved — 5-year retention'
    }
  },
  {
    id: 'payment-collected',
    label: 'Payment\nCollected',
    branch: 'pos', color: '#22d3ee', size: 32,
    xPct: 0.37, yPct: 0.88,
    meta: {
      ai: 'LEDGER tracks outstanding balances and aging, GUARDIAN triggers alert if payment is more than 15 days late',
      human: 'Owner follows up on collections via phone, records payment received, updates cashflow projection',
      economics: 'Avg collection time: 14–45 days after invoice | Target DSO: under 30 days | Collection failure rate: <5%',
      risk: 'GC slow pay patterns, lien filing window expiration, client financial distress on large contracts',
      compliance: 'Payment records stored in projects and serviceLogs tables, conditional lien release issued on final payment'
    }
  },
  {
    id: 'compliance-record',
    label: 'Compliance\nRecord',
    branch: 'pos', color: '#22d3ee', size: 32,
    xPct: 0.41, yPct: 0.78,
    meta: {
      ai: 'VAULT + GUARDIAN archive all compliance artifacts, surface at-risk retention gaps, flag expiring items',
      human: 'Owner finalizes project closeout, confirms permit final sign-offs, archives all project documents',
      economics: 'Compliance overhead: ~$0–$500/project | Storage via Supabase: ~$0.023/GB | Penalty avoidance value: high',
      risk: 'Missing inspection sign-offs, expired permits, incomplete lien release, missing contractor signatures',
      compliance: 'ALL project docs retained 5 years minimum: permits, contracts, invoices, RFIs, field logs, change orders'
    }
  },

  // ── HUB BRANCH (right column) ──
  {
    id: 'platform-built',
    label: 'Platform\nBuilt',
    branch: 'hub', color: '#c084fc', size: 32,
    xPct: 0.935, yPct: 0.28,
    meta: {
      ai: 'NEXUS + BLUEPRINT agents power core features during build phase, CI/CD via Netlify with Claude Cowork sessions',
      human: 'Owner/developer builds React+Supabase+Netlify stack in iterative AI-assisted sprints over 60+ sessions',
      economics: 'Dev cost: ~$0 (AI-assisted) | Infra: ~$25/mo Supabase + Netlify | Total build: 60+ sessions, ~120 hours',
      risk: 'Technical debt accumulation, TypeScript build errors, feature scope creep, single developer bottleneck',
      compliance: 'Netlify deploy config locked, Supabase migrations versioned in git, all code changes in commit history'
    }
  },
  {
    id: 'beta-users',
    label: 'Beta\nUsers',
    branch: 'hub', color: '#c084fc', size: 32,
    xPct: 0.92, yPct: 0.40,
    meta: {
      ai: 'HUNTER agent identifies contractor beta prospects, SPARK manages outreach call scripts for onboarding',
      human: 'Owner personally onboards beta users, collects structured feedback, manages feature access by tier',
      economics: 'Beta price: $0/mo | Target cohort: 5–10 active contractors | Lifetime value per paying user: $1,200+/yr',
      risk: 'Low adoption if UX not intuitive, feedback overload without revenue, support burden without staff',
      compliance: 'Beta TOS agreement required at signup, user data privacy per CCPA, usage analytics with explicit consent'
    }
  },
  {
    id: 'voice-sessions',
    label: 'Voice\nSessions',
    branch: 'hub', color: '#c084fc', size: 32,
    xPct: 0.935, yPct: 0.52,
    meta: {
      ai: 'NEXUS voice pipeline: OpenAI Whisper transcription → NEXUS query classification → ElevenLabs TTS response',
      human: 'Users trigger voice via mic button in app, review NEXUS responses in voice drawer, use in field on mobile',
      economics: 'OpenAI Whisper: $0.006/min | ElevenLabs: ~$0.18/1K chars | Avg session cost: $0.04 | 50 sessions/day: $2/day',
      risk: 'API cost scaling at user volume, audio quality degradation in noisy field environments, latency on 4G mobile',
      compliance: 'Voice session logs stored in journal_entries, raw audio not retained beyond current session'
    }
  },
  {
    id: 'agent-usage',
    label: 'Agent\nUsage',
    branch: 'hub', color: '#c084fc', size: 32,
    xPct: 0.92, yPct: 0.64,
    meta: {
      ai: '15 specialized agents: VAULT, OHM, LEDGER, BLUEPRINT, CHRONO, SPARK, ATLAS, NEXUS, GUARDIAN, HUNTER, PULSE, ECHO, SCOUT, CHRONO+, LEDGER+',
      human: 'Users invoke agents via natural language queries, voice commands, or direct panel actions across 10 views',
      economics: 'Claude API: ~$0.003–$0.015/query | Avg active user: 50 queries/day | Monthly API cost per user: $5–$20',
      risk: 'API cost spikes under heavy load, hallucination risk in financial/compliance contexts, context window limits',
      compliance: 'Agent audit log in hub_platform_events table, ECHO context 24-hr rolling window, 5-year agent log retention'
    }
  },
  {
    id: 'feedback-loops',
    label: 'Feedback\nLoops',
    branch: 'hub', color: '#c084fc', size: 32,
    xPct: 0.86, yPct: 0.74,
    meta: {
      ai: 'GUARDIAN + NEXUS analyze session usage patterns, surface repeated pain points, flag high-priority roadmap items',
      human: 'Owner reviews structured feedback from beta users, prioritizes feature requests, plans sprint scope with Claude',
      economics: 'Feedback collection: $0 | Sprint cycle: 2–4 days | ROI: improved feature stickiness and retention',
      risk: 'Signal vs noise ratio in feedback, over-pivoting on single-user edge cases, bias toward power users',
      compliance: 'User feedback stored in Supabase with user consent, no PII in public roadmap, beta NDA covers internal data'
    }
  },
  {
    id: 'pattern-learning',
    label: 'Pattern\nLearning',
    branch: 'hub', color: '#c084fc', size: 32,
    xPct: 0.80, yPct: 0.84,
    meta: {
      ai: 'ECHO context memory (24hr rolling window) captures usage patterns, NEXUS cross-references for smarter routing',
      human: 'Owner validates learned patterns over time, corrects misrouted queries, updates agent instruction sets',
      economics: 'Pattern data stored in Supabase echo_context table | Accuracy improvement measurable per sprint | Subscription stickiness ↑',
      risk: 'ECHO context contamination risk across users, privacy of individual usage patterns, stale pattern decay',
      compliance: 'ECHO entries isolated per user ID, 24-hr window enforced in code, 5-year retention in echo_context table'
    }
  },
  {
    id: 'revenue',
    label: 'Revenue',
    branch: 'hub', color: '#a855f7', size: 36,
    xPct: 0.67, yPct: 0.91,
    isRevenue: true,
    meta: {
      ai: 'LEDGER+ projects MRR from active subscriptions, NEXUS surfaces churn risk alerts and upsell opportunities',
      human: 'Owner manages subscription billing, pricing adjustments, upsell campaigns, and renewal outreach',
      economics: 'PROJECTION: 10 users @ $99/mo = $990 MRR | 50 users = $4,950 MRR | 200 users = $19,800 MRR | Target: $50K MRR',
      risk: 'Subscription churn if core value not delivered daily, pricing pressure from free alternatives, market saturation',
      compliance: 'Revenue recognition per ASC 606, subscription billing records retained 7 years, refund policy documented'
    }
  }
]

// ─── Edge Definitions ─────────────────────────────────────────────────────────

const MAP_EDGES: MapEdge[] = [
  // POS root → first node
  { from: 'pos-root', to: 'lead-acquired', color: '#22d3ee' },
  // POS sequence
  { from: 'lead-acquired', to: 'estimate-created', color: '#22d3ee' },
  { from: 'estimate-created', to: 'contract-signed', color: '#22d3ee' },
  { from: 'contract-signed', to: 'active-project', color: '#22d3ee' },
  { from: 'active-project', to: 'field-work', color: '#22d3ee' },
  { from: 'field-work', to: 'rfi-resolution', color: '#22d3ee' },
  { from: 'rfi-resolution', to: 'invoice-sent', color: '#22d3ee' },
  { from: 'invoice-sent', to: 'payment-collected', color: '#22d3ee' },
  { from: 'payment-collected', to: 'compliance-record', color: '#22d3ee' },
  // Hub root → first node
  { from: 'hub-root', to: 'platform-built', color: '#c084fc' },
  // Hub sequence
  { from: 'platform-built', to: 'beta-users', color: '#c084fc' },
  { from: 'beta-users', to: 'voice-sessions', color: '#c084fc' },
  { from: 'voice-sessions', to: 'agent-usage', color: '#c084fc' },
  { from: 'agent-usage', to: 'feedback-loops', color: '#c084fc' },
  { from: 'feedback-loops', to: 'pattern-learning', color: '#c084fc' },
  { from: 'pattern-learning', to: 'revenue', color: '#c084fc' },
  // RMO bridge to both roots
  { from: 'pos-root', to: 'rmo', color: '#f59e0b' },
  { from: 'hub-root', to: 'rmo', color: '#f59e0b' },
]

// ─── Color helpers ────────────────────────────────────────────────────────────
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function CombinedNeuralMap() {
  const containerRef = useRef<HTMLDivElement>(null)
  const bgCanvasRef  = useRef<HTMLCanvasElement>(null)
  const fgCanvasRef  = useRef<HTMLCanvasElement>(null)
  const rafRef       = useRef<number>(0)
  const starsRef     = useRef<StarDot[]>([])
  const pulseRingsRef = useRef<PulseRing[]>([])
  const flowParticlesRef = useRef<{ edgeIdx: number; t: number; color: string }[]>([])
  const timeRef       = useRef<number>(0)

  // Node pixel positions (updated from pct on init/resize + drag)
  const posRef = useRef<Record<string, NodePos>>({})

  // Pan/zoom state
  const zoomRef   = useRef<number>(1)
  const panXRef   = useRef<number>(0)
  const panYRef   = useRef<number>(0)

  // Drag state
  const dragRef = useRef<{ nodeId: string | null; startX: number; startY: number; nodeStartX: number; nodeStartY: number; moved: boolean }>({
    nodeId: null, startX: 0, startY: 0, nodeStartX: 0, nodeStartY: 0, moved: false
  })
  // Pan drag state
  const panDragRef = useRef<{ active: boolean; startX: number; startY: number; panStartX: number; panStartY: number }>({
    active: false, startX: 0, startY: 0, panStartX: 0, panStartY: 0
  })

  const [projectionMode, setProjectionMode] = useState(true)
  const projRef = useRef(true)

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const selectedRef = useRef<string | null>(null)

  // Keep refs in sync
  useEffect(() => { projRef.current = projectionMode }, [projectionMode])
  useEffect(() => { selectedRef.current = selectedNodeId }, [selectedNodeId])

  // Initialize positions from percentage layout
  const initPositions = useCallback((W: number, H: number) => {
    const pos: Record<string, NodePos> = {}
    for (const n of ALL_NODES) {
      pos[n.id] = { x: n.xPct * W, y: n.yPct * H }
    }
    posRef.current = pos
  }, [])

  // ─── Canvas setup + animation loop ─────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current
    const bgCanvas  = bgCanvasRef.current
    const fgCanvas  = fgCanvasRef.current
    if (!container || !bgCanvas || !fgCanvas) return

    const bgCtx = bgCanvas.getContext('2d')!
    const fgCtx = fgCanvas.getContext('2d')!

    function resize() {
      const W = container.clientWidth
      const H = container.clientHeight
      bgCanvas.width  = W; bgCanvas.height  = H
      fgCanvas.width  = W; fgCanvas.height  = H
      initPositions(W, H)
      buildStars(W, H)
    }

    function buildStars(W: number, H: number) {
      const stars: StarDot[] = []
      for (let i = 0; i < 220; i++) {
        stars.push({
          x: Math.random() * W, y: Math.random() * H,
          opacity: 0.1 + Math.random() * 0.5,
          baseOpacity: 0.1 + Math.random() * 0.5,
          speed: 0.3 + Math.random() * 1.2,
          size: 0.5 + Math.random() * 1.5,
          twinkleOffset: Math.random() * Math.PI * 2
        })
      }
      starsRef.current = stars
    }

    // Seed initial flow particles for active mode
    function buildFlowParticles() {
      const particles: { edgeIdx: number; t: number; color: string }[] = []
      MAP_EDGES.forEach((e, i) => {
        // Stagger start positions
        particles.push({ edgeIdx: i, t: Math.random(), color: e.color })
        if (Math.random() > 0.5) {
          particles.push({ edgeIdx: i, t: Math.random(), color: e.color })
        }
      })
      flowParticlesRef.current = particles
    }

    resize()
    buildFlowParticles()

    // Seed initial pulse rings
    pulseRingsRef.current = []
    // Add a pulse ring for each node with staggered start
    ALL_NODES.forEach((n, idx) => {
      pulseRingsRef.current.push({
        nodeId: n.id,
        startTime: -idx * 0.3,
        color: n.color
      })
    })

    const ro = new ResizeObserver(resize)
    ro.observe(container)

    // ── Draw background (stars + constellation lines) ──────────────────────
    function drawBg(t: number) {
      const W = bgCanvas.width
      const H = bgCanvas.height
      bgCtx.fillStyle = '#060608'
      bgCtx.fillRect(0, 0, W, H)

      const stars = starsRef.current
      // Draw constellation lines first (under stars)
      bgCtx.lineWidth = 0.4
      for (let i = 0; i < stars.length; i++) {
        for (let j = i + 1; j < stars.length; j++) {
          const dx = stars[i].x - stars[j].x
          const dy = stars[i].y - stars[j].y
          const dist = Math.sqrt(dx*dx + dy*dy)
          if (dist < 110) {
            const alpha = (1 - dist / 110) * 0.12
            bgCtx.strokeStyle = `rgba(100,120,180,${alpha})`
            bgCtx.beginPath()
            bgCtx.moveTo(stars[i].x, stars[i].y)
            bgCtx.lineTo(stars[j].x, stars[j].y)
            bgCtx.stroke()
          }
        }
      }

      // Draw stars
      for (const s of stars) {
        const twinkle = 0.5 + 0.5 * Math.sin(t * s.speed + s.twinkleOffset)
        const alpha = s.baseOpacity * (0.4 + 0.6 * twinkle)
        bgCtx.fillStyle = `rgba(200,210,255,${alpha})`
        bgCtx.beginPath()
        bgCtx.arc(s.x, s.y, s.size, 0, Math.PI * 2)
        bgCtx.fill()
      }
    }

    // ── Coordinate transform ───────────────────────────────────────────────
    function toScreen(wx: number, wy: number): [number, number] {
      const z = zoomRef.current
      const px = panXRef.current
      const py = panYRef.current
      return [wx * z + px, wy * z + py]
    }

    function fromScreen(sx: number, sy: number): [number, number] {
      const z = zoomRef.current
      const px = panXRef.current
      const py = panYRef.current
      return [(sx - px) / z, (sy - py) / z]
    }

    // ── Hit test ────────────────────────────────────────────────────────────
    function hitTestNode(sx: number, sy: number): string | null {
      const nodesBySize = [...ALL_NODES].sort((a, b) => b.size - a.size)
      for (const n of nodesBySize) {
        const p = posRef.current[n.id]
        if (!p) continue
        const [ex, ey] = toScreen(p.x, p.y)
        const z = zoomRef.current
        const r = n.size * z
        if ((sx - ex) ** 2 + (sy - ey) ** 2 <= r * r) return n.id
      }
      return null
    }

    // ── Draw foreground (edges + nodes) ────────────────────────────────────
    function drawFg(t: number) {
      const W = fgCanvas.width
      const H = fgCanvas.height
      fgCtx.clearRect(0, 0, W, H)

      const pos = posRef.current
      const isProj = projRef.current
      const z = zoomRef.current

      // ── Edges ────────────────────────────────────────────────────────────
      for (const edge of MAP_EDGES) {
        const a = pos[edge.from]
        const b = pos[edge.to]
        if (!a || !b) continue
        const [ax, ay] = toScreen(a.x, a.y)
        const [bx, by] = toScreen(b.x, b.y)

        const isRmoEdge = edge.from === 'rmo' || edge.to === 'rmo'
        const isRevenueEdge = edge.to === 'revenue'

        // Determine dash pattern
        if (isProj || isRevenueEdge) {
          fgCtx.setLineDash(isRmoEdge ? [6 * z, 4 * z] : [5 * z, 5 * z])
        } else {
          fgCtx.setLineDash([])
        }

        const alpha = isProj ? 0.35 : 0.55
        fgCtx.strokeStyle = hexToRgba(edge.color, alpha)
        fgCtx.lineWidth = isProj ? 1.2 : 1.6

        // Subtle glow
        fgCtx.shadowColor = edge.color
        fgCtx.shadowBlur = isProj ? 0 : 4

        fgCtx.beginPath()
        fgCtx.moveTo(ax, ay)
        fgCtx.lineTo(bx, by)
        fgCtx.stroke()

        fgCtx.shadowBlur = 0
        fgCtx.setLineDash([])
      }

      // ── Flow particles (active mode only) ────────────────────────────────
      if (!isProj) {
        for (const p of flowParticlesRef.current) {
          const edge = MAP_EDGES[p.edgeIdx]
          if (!edge) continue
          const a = pos[edge.from]
          const b = pos[edge.to]
          if (!a || !b) continue
          const [ax, ay] = toScreen(a.x, a.y)
          const [bx, by] = toScreen(b.x, b.y)
          const px2 = ax + (bx - ax) * p.t
          const py2 = ay + (by - ay) * p.t
          fgCtx.fillStyle = hexToRgba(p.color, 0.85)
          fgCtx.shadowColor = p.color
          fgCtx.shadowBlur = 6
          fgCtx.beginPath()
          fgCtx.arc(px2, py2, 2.5 * z, 0, Math.PI * 2)
          fgCtx.fill()
        }
        fgCtx.shadowBlur = 0
      }

      // ── Pulse rings ──────────────────────────────────────────────────────
      const ringsToRemove: number[] = []
      for (let i = 0; i < pulseRingsRef.current.length; i++) {
        const pr = pulseRingsRef.current[i]
        const nodeData = ALL_NODES.find(n => n.id === pr.nodeId)
        if (!nodeData) continue
        const p = pos[pr.nodeId]
        if (!p) continue

        const elapsed = t - pr.startTime
        if (elapsed < 0) continue

        const DURATION = 2.4
        const progress = (elapsed % DURATION) / DURATION
        const [sx, sy] = toScreen(p.x, p.y)
        const maxR = (nodeData.size + 28) * z
        const r = maxR * progress
        const alpha = (1 - progress) * 0.4

        fgCtx.strokeStyle = hexToRgba(pr.color, alpha)
        fgCtx.lineWidth = 1.5
        fgCtx.beginPath()
        fgCtx.arc(sx, sy, r, 0, Math.PI * 2)
        fgCtx.stroke()
      }

      // ── Nodes ────────────────────────────────────────────────────────────
      const selId = selectedRef.current

      for (const n of ALL_NODES) {
        const p = pos[n.id]
        if (!p) continue
        const [sx, sy] = toScreen(p.x, p.y)
        const r = n.size * z
        const isSel = n.id === selId
        const isRevNode = n.isRevenue && isProj

        // Outer glow
        const glowGrad = fgCtx.createRadialGradient(sx, sy, r * 0.6, sx, sy, r * 2.2)
        glowGrad.addColorStop(0, hexToRgba(n.color, isSel ? 0.35 : 0.15))
        glowGrad.addColorStop(1, hexToRgba(n.color, 0))
        fgCtx.fillStyle = glowGrad
        fgCtx.beginPath()
        fgCtx.arc(sx, sy, r * 2.2, 0, Math.PI * 2)
        fgCtx.fill()

        // Node ring (dashed if revenue in projection mode)
        if (isRevNode) {
          fgCtx.setLineDash([5 * z, 4 * z])
        }
        fgCtx.strokeStyle = n.color
        fgCtx.lineWidth = isSel ? 3 : 1.8
        fgCtx.shadowColor = n.color
        fgCtx.shadowBlur = isSel ? 18 : 8

        // Node fill
        const fillGrad = fgCtx.createRadialGradient(sx - r * 0.25, sy - r * 0.25, 0, sx, sy, r)
        fillGrad.addColorStop(0, hexToRgba(n.color, 0.22))
        fillGrad.addColorStop(1, 'rgba(6,6,8,0.85)')
        fgCtx.fillStyle = fillGrad
        fgCtx.beginPath()
        fgCtx.arc(sx, sy, r, 0, Math.PI * 2)
        fgCtx.fill()
        fgCtx.stroke()

        fgCtx.shadowBlur = 0
        fgCtx.setLineDash([])

        // Inner dot
        fgCtx.fillStyle = hexToRgba(n.color, isSel ? 0.9 : 0.6)
        fgCtx.beginPath()
        fgCtx.arc(sx, sy, Math.max(3, r * 0.2), 0, Math.PI * 2)
        fgCtx.fill()

        // Node label
        const lines = n.label.split('\n')
        const fontSize = Math.max(8, Math.min(12, 11 * z))
        fgCtx.font = `600 ${fontSize}px ui-monospace, monospace`
        fgCtx.textAlign = 'center'
        const labelY = sy + r + fontSize * 1.4

        for (let li = 0; li < lines.length; li++) {
          // Text shadow
          fgCtx.fillStyle = 'rgba(0,0,0,0.8)'
          fgCtx.fillText(lines[li], sx + 0.5, labelY + li * (fontSize + 2) + 0.5)
          fgCtx.fillStyle = isSel ? '#fff' : hexToRgba(n.color, 0.9)
          fgCtx.fillText(lines[li], sx, labelY + li * (fontSize + 2))
        }

        // "PROJECTION" / "ACTIVE" badge on Revenue node
        if (n.isRevenue) {
          const badge = isProj ? '◇ PROJECTION' : '◆ ACTIVE'
          const badgeColor = isProj ? '#f59e0b' : '#22d3ee'
          const badgeFont = Math.max(7, 9 * z)
          fgCtx.font = `800 ${badgeFont}px ui-monospace, monospace`
          fgCtx.fillStyle = badgeColor
          fgCtx.fillText(badge, sx, labelY + lines.length * (fontSize + 2) + 4)
        }

        // RMO status badge
        if (n.id === 'rmo') {
          const badgeFont = Math.max(6, 8 * z)
          fgCtx.font = `700 ${badgeFont}px ui-monospace, monospace`
          fgCtx.fillStyle = '#f59e0b'
          fgCtx.fillText('PENDING ACTIVATION', sx, labelY + lines.length * (fontSize + 2) + 4)
        }
      }
    }

    // ── Animation loop ─────────────────────────────────────────────────────
    let lastTime = 0
    function loop(ts: number) {
      rafRef.current = requestAnimationFrame(loop)
      const dt = Math.min((ts - lastTime) / 1000, 0.05)
      lastTime = ts
      timeRef.current += dt

      const t = timeRef.current

      drawBg(t)

      // Advance flow particles
      const FLOW_SPEED = 0.18
      for (const p of flowParticlesRef.current) {
        p.t += dt * FLOW_SPEED
        if (p.t > 1) p.t = 0
      }

      drawFg(t)
    }

    rafRef.current = requestAnimationFrame(loop)

    // ── Mouse / Touch events ───────────────────────────────────────────────
    function getEventPos(e: MouseEvent | TouchEvent): [number, number] {
      const rect = fgCanvas.getBoundingClientRect()
      if ('touches' in e && e.touches.length > 0) {
        return [e.touches[0].clientX - rect.left, e.touches[0].clientY - rect.top]
      }
      return [(e as MouseEvent).clientX - rect.left, (e as MouseEvent).clientY - rect.top]
    }

    function onPointerDown(e: MouseEvent | TouchEvent) {
      const [sx, sy] = getEventPos(e)
      const nodeId = hitTestNode(sx, sy)
      if (nodeId) {
        const p = posRef.current[nodeId]
        dragRef.current = { nodeId, startX: sx, startY: sy, nodeStartX: p.x, nodeStartY: p.y, moved: false }
      } else {
        panDragRef.current = {
          active: true,
          startX: sx, startY: sy,
          panStartX: panXRef.current,
          panStartY: panYRef.current
        }
      }
      if ('touches' in e) e.preventDefault()
    }

    function onPointerMove(e: MouseEvent | TouchEvent) {
      const [sx, sy] = getEventPos(e)
      const drag = dragRef.current
      if (drag.nodeId) {
        const dx = sx - drag.startX
        const dy = sy - drag.startY
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true
        if (drag.moved) {
          const z = zoomRef.current
          posRef.current[drag.nodeId] = {
            x: drag.nodeStartX + dx / z,
            y: drag.nodeStartY + dy / z
          }
        }
      } else if (panDragRef.current.active) {
        const pd = panDragRef.current
        panXRef.current = pd.panStartX + (sx - pd.startX)
        panYRef.current = pd.panStartY + (sy - pd.startY)
      }
    }

    function onPointerUp(e: MouseEvent | TouchEvent) {
      const drag = dragRef.current
      if (drag.nodeId && !drag.moved) {
        // Click (no drag) — select node
        const id = drag.nodeId
        setSelectedNodeId(prev => prev === id ? null : id)
        // Add pulse ring
        const node = ALL_NODES.find(n => n.id === id)
        if (node) {
          pulseRingsRef.current.push({ nodeId: id, startTime: timeRef.current, color: node.color })
        }
      }
      dragRef.current = { nodeId: null, startX: 0, startY: 0, nodeStartX: 0, nodeStartY: 0, moved: false }
      panDragRef.current.active = false
    }

    function onWheel(e: WheelEvent) {
      e.preventDefault()
      const rect = fgCanvas.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const delta = e.deltaY > 0 ? 0.9 : 1.1
      const newZoom = Math.max(0.3, Math.min(3, zoomRef.current * delta))
      // Zoom toward cursor
      panXRef.current = mx - (mx - panXRef.current) * (newZoom / zoomRef.current)
      panYRef.current = my - (my - panYRef.current) * (newZoom / zoomRef.current)
      zoomRef.current = newZoom
    }

    fgCanvas.addEventListener('mousedown', onPointerDown)
    fgCanvas.addEventListener('mousemove', onPointerMove)
    fgCanvas.addEventListener('mouseup', onPointerUp)
    fgCanvas.addEventListener('wheel', onWheel, { passive: false })
    fgCanvas.addEventListener('touchstart', onPointerDown, { passive: false })
    fgCanvas.addEventListener('touchmove', onPointerMove, { passive: false })
    fgCanvas.addEventListener('touchend', onPointerUp)

    return () => {
      cancelAnimationFrame(rafRef.current)
      ro.disconnect()
      fgCanvas.removeEventListener('mousedown', onPointerDown)
      fgCanvas.removeEventListener('mousemove', onPointerMove)
      fgCanvas.removeEventListener('mouseup', onPointerUp)
      fgCanvas.removeEventListener('wheel', onWheel)
      fgCanvas.removeEventListener('touchstart', onPointerDown)
      fgCanvas.removeEventListener('touchmove', onPointerMove)
      fgCanvas.removeEventListener('touchend', onPointerUp)
    }
  }, [initPositions])

  // ─── Detail Panel ───────────────────────────────────────────────────────────
  const selectedNode = ALL_NODES.find(n => n.id === selectedNodeId)

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative', width: '100%', height: 'calc(100vh - 106px)',
        overflow: 'hidden', backgroundColor: '#060608',
        display: 'flex', flexDirection: 'column'
      }}
    >
      {/* ── Top bar: mode toggle + title ── */}
      <div style={{
        position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)',
        zIndex: 20, display: 'flex', alignItems: 'center', gap: 12,
        backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(10px)',
        border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10,
        padding: '6px 16px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: '#8b5cf6', boxShadow: '0 0 8px #8b5cf6', animation: 'cmPulse 2s ease-in-out infinite' }} />
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', color: '#8b5cf6', textTransform: 'uppercase' }}>Neural Map 2 — Combined</span>
        </div>
        <div style={{ width: 1, height: 16, backgroundColor: 'rgba(255,255,255,0.1)' }} />
        {/* Projection / Active toggle */}
        <button
          onClick={() => setProjectionMode(p => !p)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            backgroundColor: projectionMode ? 'rgba(245,158,11,0.12)' : 'rgba(34,211,238,0.12)',
            border: `1px solid ${projectionMode ? 'rgba(245,158,11,0.4)' : 'rgba(34,211,238,0.4)'}`,
            borderRadius: 6, padding: '4px 10px', cursor: 'pointer', transition: 'all 0.3s'
          }}
        >
          <div style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: projectionMode ? '#f59e0b' : '#22d3ee', boxShadow: `0 0 6px ${projectionMode ? '#f59e0b' : '#22d3ee'}` }} />
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', color: projectionMode ? '#f59e0b' : '#22d3ee' }}>
            {projectionMode ? '◇ PROJECTION MODE' : '◆ ACTIVE MODE'}
          </span>
        </button>
        {projectionMode && (
          <span style={{ fontSize: 9, color: '#6b7280', fontStyle: 'italic' }}>dashed = estimated data</span>
        )}
      </div>

      {/* ── Legend ── */}
      <div style={{
        position: 'absolute', bottom: 12, left: 12, zIndex: 20,
        display: 'flex', flexDirection: 'column', gap: 4,
        backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(8px)',
        border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8,
        padding: '8px 12px'
      }}>
        {[
          { color: '#00d4ff', label: 'Power On Solutions LLC' },
          { color: '#22d3ee', label: 'Electrical Operations' },
          { color: '#a855f7', label: 'PowerOn Hub' },
          { color: '#c084fc', label: 'Platform Pipeline' },
          { color: '#f59e0b', label: 'RMO Bridge' },
        ].map(({ color, label }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: color, boxShadow: `0 0 4px ${color}` }} />
            <span style={{ fontSize: 9, color: '#9ca3af', fontFamily: 'ui-monospace, monospace' }}>{label}</span>
          </div>
        ))}
        <div style={{ fontSize: 9, color: '#374151', marginTop: 4, fontFamily: 'ui-monospace, monospace' }}>Scroll: zoom · Drag: pan/move · Tap: details</div>
      </div>

      {/* ── Canvas layers ── */}
      <canvas ref={bgCanvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      <canvas ref={fgCanvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: 'grab' }} />

      {/* ── Detail panel ── */}
      {selectedNode && (
        <div style={{
          position: 'absolute', right: 0, top: 0, bottom: 0, width: 320,
          backgroundColor: 'rgba(6,6,8,0.92)', backdropFilter: 'blur(12px)',
          borderLeft: `1px solid ${hexToRgba(selectedNode.color, 0.3)}`,
          zIndex: 30, overflowY: 'auto', padding: '16px 16px 40px'
        }}>
          {/* Close button */}
          <button
            onClick={() => setSelectedNodeId(null)}
            style={{
              position: 'absolute', top: 10, right: 10, background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6,
              color: '#9ca3af', fontSize: 14, cursor: 'pointer', padding: '2px 8px',
              lineHeight: 1.4
            }}
          >×</button>

          {/* Node header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, marginTop: 4 }}>
            <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: selectedNode.color, boxShadow: `0 0 10px ${selectedNode.color}`, flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#fff', fontFamily: 'ui-monospace, monospace', lineHeight: 1.3 }}>
                {selectedNode.label.replace('\n', ' ')}
              </div>
              <div style={{ fontSize: 9, color: hexToRgba(selectedNode.color, 0.8), textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 2 }}>
                {selectedNode.branch === 'root' ? 'Root Node' :
                 selectedNode.branch === 'rmo' ? 'Bridge Node' :
                 selectedNode.branch === 'pos' ? 'Power On Solutions' : 'PowerOn Hub'}
                {selectedNode.isRevenue && ' · Revenue Node'}
              </div>
            </div>
          </div>

          {/* Detail sections */}
          {[
            { key: 'ai', label: '🤖 AI Agent', color: '#00d4ff' },
            { key: 'human', label: '👤 Human Tasks', color: '#22d3ee' },
            { key: 'economics', label: '💰 Economics', color: '#10b981' },
            { key: 'risk', label: '⚠️ Risk Factors', color: '#f59e0b' },
            { key: 'compliance', label: '📋 Compliance', color: '#a855f7' },
          ].map(({ key, label, color }) => (
            <div key={key} style={{ marginBottom: 14 }}>
              <div style={{
                fontSize: 9, fontWeight: 800, color, letterSpacing: '0.1em',
                textTransform: 'uppercase', marginBottom: 5, fontFamily: 'ui-monospace, monospace'
              }}>{label}</div>
              <div style={{
                fontSize: 11, color: '#d1d5db', lineHeight: 1.6,
                backgroundColor: hexToRgba(color, 0.06),
                border: `1px solid ${hexToRgba(color, 0.15)}`,
                borderRadius: 6, padding: '8px 10px',
                fontFamily: 'ui-sans-serif, system-ui, sans-serif'
              }}>
                {selectedNode.meta[key as keyof NodeMeta]}
              </div>
            </div>
          ))}

          {/* RMO special section */}
          {selectedNode.id === 'rmo' && (
            <div style={{ marginTop: 8, padding: '10px 12px', backgroundColor: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 8 }}>
              <div style={{ fontSize: 9, fontWeight: 800, color: '#f59e0b', letterSpacing: '0.1em', marginBottom: 6, fontFamily: 'ui-monospace, monospace' }}>RMO STATUS</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {[
                  { label: 'Deal Status', value: 'Pending Activation', c: '#f59e0b' },
                  { label: 'Income Mode', value: projectionMode ? 'Projection (Dashed)' : 'Active (Solid)', c: projectionMode ? '#f59e0b' : '#22d3ee' },
                  { label: 'Scenario A', value: '10 systems/mo → $2–3K/mo', c: '#c084fc' },
                  { label: 'Scenario B', value: '25 systems/mo → $6–8K/mo', c: '#a855f7' },
                ].map(({ label, value, c }) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 9, color: '#6b7280', fontFamily: 'ui-monospace, monospace' }}>{label}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: c, fontFamily: 'ui-monospace, monospace' }}>{value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Keyframe style */}
      <style>{`
        @keyframes cmPulse { 0%,100%{opacity:0.6;transform:scale(1)} 50%{opacity:1;transform:scale(1.3)} }
      `}</style>
    </div>
  )
}
