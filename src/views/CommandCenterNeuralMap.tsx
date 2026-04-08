// @ts-nocheck
/**
 * CommandCenterNeuralMap.tsx — B66 | Neural Map 1 — 5 Performance Scenarios + New Nodes
 *
 * B45 baseline: Neural Map sub-tab with Explore Mode + Goal Mode.
 * B46: Path comparison panel, actionable steps, decoration overlay.
 * B66 additions:
 *   - 5 Performance Scenario system (Pesimo → Alto) with NEXUS auto-classification
 *   - 3 new optional node types: RFI, Service Call, Cash Flow Velocity
 *   - Constellation/pulse ring animated background behind the Three.js canvas
 *
 * Protected files NOT touched: authStore.ts, netlify.toml, backupDataService.ts,
 *   vite.config.ts, SVGCharts.tsx, AdminCommandCenter.tsx
 */

import { useRef, useEffect, useState, useCallback } from 'react'
import * as THREE from 'three'
import { getBackupData, health, getKPIs } from '../services/backupDataService'
import { callClaude, extractText } from '../services/claudeProxy'

// ─── Types ────────────────────────────────────────────────────────────────────
type CCMapMode = 'explore' | 'goal'

/** B66: 5 performance scenarios */
type PerformanceScenario =
  | 'pesimo'
  | 'pesimo_creciendo'
  | 'mediano'
  | 'mediano_alcista'
  | 'alto'

interface CCNode {
  id: string
  label: string
  type: 'project' | 'agent' | 'decision' | 'data' | 'goalstep' | 'rfi' | 'servicecall' | 'cashflow'
  color: number
  size: number
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  fx: number
  fy: number
  fz: number
  mesh?: THREE.Sprite | THREE.Object3D
  meta?: Record<string, any>
  pinned?: boolean
  isBackground?: boolean
}

interface CCEdge {
  a: number
  b: number
  line?: THREE.Line | THREE.Mesh
  pathColor?: string
  isGoal?: boolean
  isBackground?: boolean
}

interface GoalProfile {
  id: string
  name: string
  color: string
  startingPoint: 'current' | 'fictional'
  startingCapital: number
  startingRevenue: number
  startingTeamSize: number
  targetAmount: number
  timeHorizonMonths: number
  scenarioFactors: string[]
  notes: string
  active: boolean
}

interface GeneratedMilestone {
  title: string
  description: string
  projectedDate: string
  dependencies: string[]
  accelerators: string[]
}

// ─── Constants ────────────────────────────────────────────────────────────────
const GOAL_STORAGE_KEY = 'poweron_goal_paths'

const GOAL_PROFILE_COLORS = [
  '#7c3aed', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444',
  '#a855f7', '#06b6d4', '#84cc16', '#fb923c', '#f43f5e',
]

const TIER_COLORS_HEX = ['#FFD24A', '#3A8EFF', '#2EE89A', '#AA6EFF', '#60607A']
const TIER_COLORS_INT = [0xFFD24A, 0x3A8EFF, 0x2EE89A, 0xAA6EFF, 0x60607A]

const AGENT_LIST = [
  { id: 'VAULT',     label: 'VAULT',     tier: 1, desc: 'Estimating & contract intelligence' },
  { id: 'OHM',       label: 'OHM',       tier: 2, desc: 'NEC code compliance' },
  { id: 'LEDGER',    label: 'LEDGER',    tier: 2, desc: 'Financial tracking' },
  { id: 'BLUEPRINT', label: 'BLUEPRINT', tier: 1, desc: 'Drawing analysis' },
  { id: 'CHRONO',    label: 'CHRONO',    tier: 2, desc: 'Scheduling & timeline' },
  { id: 'SPARK',     label: 'SPARK',     tier: 1, desc: 'Live call intelligence' },
  { id: 'ATLAS',     label: 'ATLAS',     tier: 3, desc: 'Material intelligence' },
  { id: 'NEXUS',     label: 'NEXUS',     tier: 1, desc: 'Orchestration brain' },
  { id: 'GUARDIAN',  label: 'GUARDIAN',  tier: 2, desc: 'Project health monitor' },
  { id: 'HUNTER',    label: 'HUNTER',    tier: 3, desc: 'Lead hunting' },
]

// ─── B66: Scenario Configuration ─────────────────────────────────────────────
const SCENARIO_CONFIG: Record<PerformanceScenario, {
  label: string
  emoji: string
  description: string
  nodeColorInt: number
  nodeColorHex: string
  lineColorInt: number
  lineColorHex: string
  glowOpacity: number
  borderColor: string
}> = {
  pesimo: {
    label: 'Pésimo',
    emoji: '🔴',
    description: 'Critical underperformance',
    nodeColorInt: 0xcc1111,
    nodeColorHex: '#cc1111',
    lineColorInt: 0x660000,
    lineColorHex: '#660000',
    glowOpacity: 0.45,
    borderColor: 'rgba(204,17,17,0.8)',
  },
  pesimo_creciendo: {
    label: 'Pésimo Creciendo',
    emoji: '🟠',
    description: 'Below average but improving',
    nodeColorInt: 0xff6600,
    nodeColorHex: '#ff6600',
    lineColorInt: 0x884400,
    lineColorHex: '#884400',
    glowOpacity: 0.4,
    borderColor: 'rgba(255,102,0,0.7)',
  },
  mediano: {
    label: 'Rendimiento Mediano',
    emoji: '🟡',
    description: 'Baseline expected output',
    nodeColorInt: 0xffcc00,
    nodeColorHex: '#ffcc00',
    lineColorInt: 0x886600,
    lineColorHex: '#886600',
    glowOpacity: 0.35,
    borderColor: 'rgba(255,204,0,0.7)',
  },
  mediano_alcista: {
    label: 'Rendimiento Mediano Alcista',
    emoji: '🟢',
    description: 'Above average, growth signals',
    nodeColorInt: 0x00ccaa,
    nodeColorHex: '#00ccaa',
    lineColorInt: 0x006644,
    lineColorHex: '#006644',
    glowOpacity: 0.4,
    borderColor: 'rgba(0,204,170,0.7)',
  },
  alto: {
    label: 'Rendimiento Alto',
    emoji: '💚',
    description: 'Optimal performance, all metrics green',
    nodeColorInt: 0x00ff44,
    nodeColorHex: '#00ff44',
    lineColorInt: 0x00aa22,
    lineColorHex: '#00aa22',
    glowOpacity: 0.65,
    borderColor: 'rgba(0,255,68,0.9)',
  },
}

const SCENARIO_ORDER: PerformanceScenario[] = [
  'pesimo', 'pesimo_creciendo', 'mediano', 'mediano_alcista', 'alto',
]

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getAvgHealth(): number {
  try {
    const d = getBackupData()
    if (!d?.projects?.length) return 75
    const scores = d.projects.map((p) => health(p, d).sc)
    return scores.reduce((a: number, b: number) => a + b, 0) / scores.length
  } catch { return 75 }
}

function formatMoney(n: number): string {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `$${(n / 1000).toFixed(0)}k`
  return `$${n.toFixed(0)}`
}

/** B66: NEXUS auto-classifies performance scenario from real data */
function classifyScenario(): PerformanceScenario {
  try {
    const d = getBackupData()
    if (!d) return 'mediano'
    const kpis = getKPIs(d)
    const avgHealth = getAvgHealth()

    // Compute score (0–100)
    let score = 50 // baseline

    // Collection rate: paid / pipeline
    const collectionRate = kpis.paid / Math.max(1, kpis.pipeline)
    if (collectionRate > 0.7) score += 20
    else if (collectionRate > 0.5) score += 10
    else if (collectionRate > 0.3) score += 2
    else if (collectionRate < 0.15) score -= 20
    else score -= 10

    // Project health
    if (avgHealth > 78) score += 15
    else if (avgHealth > 60) score += 5
    else if (avgHealth < 35) score -= 15
    else if (avgHealth < 50) score -= 5

    // Open RFI burden (stale = bad)
    const openRfis = kpis.openRfis || 0
    if (openRfis > 8) score -= 12
    else if (openRfis > 4) score -= 6
    else if (openRfis === 0) score += 5

    // Pipeline volume
    if (kpis.pipeline > 600000) score += 10
    else if (kpis.pipeline > 200000) score += 4
    else if (kpis.pipeline < 30000) score -= 10

    // AR exposure vs paid
    const arRatio = kpis.exposure / Math.max(1, kpis.paid)
    if (arRatio > 2.0) score -= 8
    else if (arRatio < 0.5) score += 5

    if (score >= 78) return 'alto'
    if (score >= 60) return 'mediano_alcista'
    if (score >= 40) return 'mediano'
    if (score >= 24) return 'pesimo_creciendo'
    return 'pesimo'
  } catch {
    return 'mediano'
  }
}

/** B66: Blend a node's natural color with the scenario color overlay */
function applyScenarioColor(naturalColorInt: number, scenario: PerformanceScenario, nodeType: string): number {
  if (nodeType === 'goalstep') return naturalColorInt // goal nodes keep their profile color
  const sc = SCENARIO_CONFIG[scenario]
  // Blend 60% scenario color, 40% natural color
  const nr = (naturalColorInt >> 16) & 0xff
  const ng = (naturalColorInt >> 8) & 0xff
  const nb = naturalColorInt & 0xff
  const sr = (sc.nodeColorInt >> 16) & 0xff
  const sg = (sc.nodeColorInt >> 8) & 0xff
  const sb = sc.nodeColorInt & 0xff
  const r = Math.round(nr * 0.4 + sr * 0.6)
  const g = Math.round(ng * 0.4 + sg * 0.6)
  const b = Math.round(nb * 0.4 + sb * 0.6)
  return (r << 16) | (g << 8) | b
}

// ─── Canvas icon helpers ──────────────────────────────────────────────────────
function makeGoalStepCanvasCC(colorHex: string, stepIndex: number): HTMLCanvasElement {
  const SIZE = 128
  const c = document.createElement('canvas')
  c.width = SIZE; c.height = SIZE
  const ctx = c.getContext('2d')!
  ctx.clearRect(0, 0, SIZE, SIZE)
  ctx.fillStyle = colorHex + '22'
  ctx.strokeStyle = colorHex
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(64, 10); ctx.lineTo(112, 64); ctx.lineTo(64, 118); ctx.lineTo(16, 64)
  ctx.closePath(); ctx.fill(); ctx.stroke()
  ctx.strokeStyle = colorHex + '66'; ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(64, 24); ctx.lineTo(98, 64); ctx.lineTo(64, 104); ctx.lineTo(30, 64)
  ctx.closePath(); ctx.stroke()
  ctx.fillStyle = colorHex
  ctx.font = 'bold 38px monospace'
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(String(stepIndex + 1), 64, 65)
  return c
}

function makeBackgroundNodeCanvas(colorHex: string): HTMLCanvasElement {
  const SIZE = 64
  const c = document.createElement('canvas')
  c.width = SIZE; c.height = SIZE
  const ctx = c.getContext('2d')!
  ctx.clearRect(0, 0, SIZE, SIZE)
  ctx.globalAlpha = 0.5
  ctx.strokeStyle = colorHex
  ctx.lineWidth = 2
  ctx.beginPath(); ctx.arc(32, 32, 20, 0, Math.PI * 2); ctx.stroke()
  ctx.fillStyle = colorHex + '33'
  ctx.beginPath(); ctx.arc(32, 32, 20, 0, Math.PI * 2); ctx.fill()
  return c
}

/** B66: RFI node — hexagonal warning shape */
function makeRFINodeCanvas(colorHex: string, rfiCount: number): HTMLCanvasElement {
  const SIZE = 96
  const c = document.createElement('canvas')
  c.width = SIZE; c.height = SIZE
  const ctx = c.getContext('2d')!
  ctx.clearRect(0, 0, SIZE, SIZE)
  // Hexagon
  const cx = 48, cy = 48, r = 30
  ctx.beginPath()
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6
    const x = cx + r * Math.cos(angle), y = cy + r * Math.sin(angle)
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
  }
  ctx.closePath()
  ctx.fillStyle = colorHex + '22'
  ctx.strokeStyle = colorHex
  ctx.lineWidth = 2.5
  ctx.fill(); ctx.stroke()
  // Label
  ctx.fillStyle = colorHex
  ctx.font = 'bold 20px monospace'
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText('R', cx, cy - 6)
  ctx.font = 'bold 12px monospace'
  ctx.fillText(String(rfiCount), cx, cy + 9)
  return c
}

/** B66: Service call node — square badge */
function makeServiceCallCanvas(colorHex: string, callCount: number): HTMLCanvasElement {
  const SIZE = 96
  const c = document.createElement('canvas')
  c.width = SIZE; c.height = SIZE
  const ctx = c.getContext('2d')!
  ctx.clearRect(0, 0, SIZE, SIZE)
  // Rounded square
  const pad = 12
  ctx.beginPath()
  ctx.roundRect(pad, pad, SIZE - pad * 2, SIZE - pad * 2, 8)
  ctx.fillStyle = colorHex + '1a'
  ctx.strokeStyle = colorHex
  ctx.lineWidth = 2.5
  ctx.fill(); ctx.stroke()
  // Inner cross (wrench symbol)
  ctx.strokeStyle = colorHex + 'cc'
  ctx.lineWidth = 2
  ctx.beginPath(); ctx.moveTo(48, 24); ctx.lineTo(48, 72); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(24, 48); ctx.lineTo(72, 48); ctx.stroke()
  // Count badge
  ctx.fillStyle = colorHex
  ctx.font = 'bold 13px monospace'
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(String(callCount), 48, 48)
  return c
}

/** B66: Cash flow velocity node — diamond with $ */
function makeCashFlowCanvas(colorHex: string, rate: string): HTMLCanvasElement {
  const SIZE = 96
  const c = document.createElement('canvas')
  c.width = SIZE; c.height = SIZE
  const ctx = c.getContext('2d')!
  ctx.clearRect(0, 0, SIZE, SIZE)
  // Diamond
  ctx.beginPath()
  ctx.moveTo(48, 8); ctx.lineTo(88, 48); ctx.lineTo(48, 88); ctx.lineTo(8, 48)
  ctx.closePath()
  ctx.fillStyle = colorHex + '1a'
  ctx.strokeStyle = colorHex
  ctx.lineWidth = 2.5
  ctx.fill(); ctx.stroke()
  ctx.fillStyle = colorHex
  ctx.font = 'bold 16px monospace'
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText('$', 48, 36)
  ctx.font = 'bold 10px monospace'
  ctx.fillText(rate, 48, 56)
  return c
}

// ─── Build scene data ─────────────────────────────────────────────────────────
function buildSceneData(
  mode: CCMapMode,
  profiles: GoalProfile[],
  scenario: PerformanceScenario,
): { nodes: CCNode[]; edges: CCEdge[] } {
  const nodes: CCNode[] = []
  const edges: CCEdge[] = []
  const rand = (scale = 5) => (Math.random() - 0.5) * scale

  const data = getBackupData()
  const projects = data?.projects || []
  const kpis = data ? getKPIs(data) : {}

  // ── Project nodes ──────────────────────────────────────────────────────────
  const projNodeIndices: number[] = []
  projects.slice(0, 8).forEach((p) => {
    const sc = health(p, data).sc
    const naturalClr = sc > 70 ? 0x00ff88 : sc > 40 ? 0xffcc00 : 0xff6600
    const clr = applyScenarioColor(naturalClr, scenario, 'project')
    const sz = 0.10 + Math.min(0.18, (p.contract || 50000) / 1000000)
    const idx = nodes.length
    projNodeIndices.push(idx)
    nodes.push({
      id: 'proj_' + p.id, label: p.name || 'Project', type: 'project',
      color: clr, size: sz, x: rand(4), y: rand(3), z: rand(4),
      vx: 0, vy: 0, vz: 0, fx: 0, fy: 0, fz: 0,
      meta: { healthScore: Math.round(sc), contract: p.contract || 0 },
      isBackground: true,
    })
  })

  // ── Agent nodes ────────────────────────────────────────────────────────────
  AGENT_LIST.slice(0, 8).forEach((ag) => {
    const tierClr = TIER_COLORS_INT[Math.min(ag.tier - 1, 4)]
    const clr = applyScenarioColor(tierClr, scenario, 'agent')
    nodes.push({
      id: 'ag_' + ag.id, label: ag.label, type: 'agent',
      color: clr, size: 0.09 + Math.random() * 0.04,
      x: rand(5), y: rand(5), z: rand(5),
      vx: 0, vy: 0, vz: 0, fx: 0, fy: 0, fz: 0,
      meta: { tier: ag.tier, desc: ag.desc },
      isBackground: true,
    })
  })

  // ── Data KPI nodes ─────────────────────────────────────────────────────────
  const metrics = [
    { label: 'Pipeline', value: kpis.totalPipeline || kpis.pipeline || 0, naturalColor: 0x22c55e },
    { label: 'Paid',     value: kpis.totalPaid || kpis.paid || 0,         naturalColor: 0x22c55e },
    { label: 'Unbilled', value: kpis.totalUnbilled || kpis.svcUnbilled || 0, naturalColor: 0xa855f7 },
  ]
  const ledgerIdx = nodes.findIndex((n) => n.id === 'ag_LEDGER')
  const dataNodeIndices: number[] = []
  metrics.forEach((m, i) => {
    const sz = 0.09 + Math.min(0.20, Math.abs(m.value) / 2000000)
    const absVal = Math.abs(m.value)
    const clr = applyScenarioColor(m.naturalColor, scenario, 'data')
    const idx = nodes.length
    dataNodeIndices.push(idx)
    nodes.push({
      id: 'data_' + i, label: m.label, type: 'data',
      color: clr, size: sz, x: rand(3), y: rand(3), z: rand(3),
      vx: 0, vy: 0, vz: 0, fx: 0, fy: 0, fz: 0,
      meta: { valueStr: formatMoney(absVal) },
      isBackground: true,
    })
  })

  // ── Agent → project background edges ──────────────────────────────────────
  const agentNodes = nodes.filter((n) => n.type === 'agent')
  const projNodes  = nodes.filter((n) => n.type === 'project')
  agentNodes.slice(0, 4).forEach((ag) => {
    const projIdx = Math.floor(Math.random() * Math.max(1, projNodes.length))
    const a = nodes.indexOf(ag), b = nodes.indexOf(projNodes[projIdx])
    if (a >= 0 && b >= 0 && a !== b) edges.push({ a, b, isBackground: true })
  })

  // ── B66: RFI nodes (branch off project nodes where RFIs exist) ────────────
  projects.slice(0, 8).forEach((p, pi) => {
    const openRfis = (p.rfis || []).filter((r: any) => r.status !== 'answered')
    if (!openRfis.length) return
    const parentIdx = projNodeIndices[pi]
    if (parentIdx === undefined) return

    // Calc avg age of open RFIs
    const now = Date.now()
    const avgAgeDays = openRfis.reduce((sum: number, r: any) => {
      const created = r.createdAt ? new Date(r.createdAt).getTime() : now
      return sum + Math.floor((now - created) / 86400000)
    }, 0) / openRfis.length

    const rfiClr = applyScenarioColor(
      avgAgeDays > 14 ? 0xff4444 : avgAgeDays > 7 ? 0xffa500 : 0xffdd00,
      scenario,
      'rfi',
    )
    const pn = nodes[parentIdx]
    const rfiIdx = nodes.length
    nodes.push({
      id: 'rfi_' + p.id,
      label: `RFI (${openRfis.length})`,
      type: 'rfi',
      color: rfiClr,
      size: 0.07 + openRfis.length * 0.01,
      x: (pn?.x ?? 0) + 0.8 + rand(0.5),
      y: (pn?.y ?? 0) + 0.8 + rand(0.5),
      z: (pn?.z ?? 0) + rand(0.5),
      vx: 0, vy: 0, vz: 0, fx: 0, fy: 0, fz: 0,
      meta: { rfiCount: openRfis.length, avgAgeDays: Math.round(avgAgeDays), projName: p.name },
      isBackground: true,
    })
    // Edge from project → rfi
    edges.push({ a: parentIdx, b: rfiIdx, isBackground: true })
  })

  // ── B66: Service call nodes (show open/active service calls) ──────────────
  const activeCalls = data?.activeServiceCalls || []
  if (activeCalls.length > 0) {
    const svcClr = applyScenarioColor(0x38bdf8, scenario, 'servicecall')
    const svcIdx = nodes.length
    nodes.push({
      id: 'svc_calls',
      label: `Service (${activeCalls.length})`,
      type: 'servicecall',
      color: svcClr,
      size: 0.10 + Math.min(0.12, activeCalls.length * 0.015),
      x: rand(4) + 3,
      y: rand(3) - 2,
      z: rand(4),
      vx: 0, vy: 0, vz: 0, fx: 0, fy: 0, fz: 0,
      meta: { callCount: activeCalls.length },
      isBackground: true,
    })
    // Edge from LEDGER agent to service calls if LEDGER exists
    if (ledgerIdx >= 0) {
      edges.push({ a: ledgerIdx, b: svcIdx, isBackground: true })
    }
  }

  // ── B66: Cash flow velocity node (connects LEDGER + Pipeline data) ─────────
  const pipeline = kpis.pipeline || 0
  const paid = kpis.paid || 0
  if (pipeline > 0) {
    const collRate = Math.round((paid / Math.max(1, pipeline)) * 100)
    const cashClr = applyScenarioColor(
      collRate > 65 ? 0x00ff88 : collRate > 40 ? 0xffcc00 : 0xff6600,
      scenario,
      'cashflow',
    )
    const cfIdx = nodes.length
    nodes.push({
      id: 'cashflow_vel',
      label: 'Cash Velocity',
      type: 'cashflow',
      color: cashClr,
      size: 0.11,
      x: rand(3),
      y: rand(3) + 3,
      z: rand(3),
      vx: 0, vy: 0, vz: 0, fx: 0, fy: 0, fz: 0,
      meta: { collectionRate: collRate, paidStr: formatMoney(paid), pipelineStr: formatMoney(pipeline) },
      isBackground: true,
    })
    // Connect to LEDGER agent and Pipeline data node
    if (ledgerIdx >= 0) {
      edges.push({ a: ledgerIdx, b: cfIdx, isBackground: true })
    }
    if (dataNodeIndices[0] !== undefined) {
      edges.push({ a: dataNodeIndices[0], b: cfIdx, isBackground: true })
    }
  }

  // ── Goal Mode: add goal path nodes in foreground ───────────────────────────
  if (mode === 'goal') {
    const activeProfiles = profiles.filter((p) => p.active)
    activeProfiles.forEach((profile, profileIdx) => {
      const milestoneCount = Math.min(10, Math.max(6, Math.round(profile.timeHorizonMonths / 5)))
      const yOffset = 5 + profileIdx * 2.2
      const pathStart = nodes.length

      for (let i = 0; i < milestoneCount; i++) {
        const xPos = (i - milestoneCount / 2) * 1.8
        nodes.push({
          id: `goal_${profile.id}_${i}`,
          label: profile.name + ` M${i + 1}`,
          type: 'goalstep',
          color: parseInt(profile.color.replace('#', ''), 16),
          size: 0.22,
          x: xPos, y: yOffset, z: profileIdx * 0.5,
          vx: 0, vy: 0, vz: 0, fx: 0, fy: 0, fz: 0,
          pinned: true,
          isBackground: false,
          meta: {
            goalColor: profile.color,
            stepIndex: i,
            profileName: profile.name,
            profileId: profile.id,
            targetAmount: profile.targetAmount,
            timeHorizonMonths: profile.timeHorizonMonths,
            milestoneCount,
          },
        })
        if (i > 0) {
          edges.push({
            a: pathStart + i - 1,
            b: pathStart + i,
            pathColor: profile.color,
            isGoal: true,
            isBackground: false,
          })
        }
      }
    })
  }

  return { nodes, edges }
}

// ─── B66: Constellation Background ───────────────────────────────────────────
function ConstellationBackground({ scenario }: { scenario: PerformanceScenario }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animRef = useRef<number>(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const sc = SCENARIO_CONFIG[scenario]

    // Generate stars
    const STAR_COUNT = 90
    const RING_COUNT = 3
    const stars = Array.from({ length: STAR_COUNT }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: Math.random() * 1.5 + 0.3,
      phase: Math.random() * Math.PI * 2,
      speed: Math.random() * 0.008 + 0.003,
    }))
    // Constellation connections (static pairs)
    const constellLines: [number, number][] = []
    for (let i = 0; i < STAR_COUNT; i++) {
      const j = (i + 2 + Math.floor(Math.random() * 4)) % STAR_COUNT
      if (Math.abs(stars[i].x - stars[j].x) < 0.22 && Math.abs(stars[i].y - stars[j].y) < 0.22) {
        constellLines.push([i, j])
      }
    }

    // Pulse rings
    const rings = Array.from({ length: RING_COUNT }, (_, i) => ({
      x: 0.2 + Math.random() * 0.6,
      y: 0.2 + Math.random() * 0.6,
      phase: (Math.PI * 2 * i) / RING_COUNT,
      speed: 0.005 + Math.random() * 0.004,
      maxR: 0.12 + Math.random() * 0.1,
    }))

    let t = 0

    function resize() {
      if (!canvas) return
      canvas.width = canvas.clientWidth
      canvas.height = canvas.clientHeight
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    function draw() {
      animRef.current = requestAnimationFrame(draw)
      t += 0.016
      if (!canvas || !ctx) return
      const W = canvas.width, H = canvas.height
      if (!W || !H) return

      ctx.clearRect(0, 0, W, H)

      // Constellation lines
      ctx.setLineDash([3, 8])
      ctx.lineWidth = 0.6
      ctx.strokeStyle = sc.nodeColorHex + '18'
      constellLines.forEach(([a, b]) => {
        const sa = stars[a], sb = stars[b]
        ctx.beginPath()
        ctx.moveTo(sa.x * W, sa.y * H)
        ctx.lineTo(sb.x * W, sb.y * H)
        ctx.stroke()
      })
      ctx.setLineDash([])

      // Stars
      stars.forEach((s) => {
        const brightness = 0.4 + Math.sin(t * s.speed * 60 + s.phase) * 0.35
        const alpha = Math.max(0.05, brightness)
        ctx.beginPath()
        ctx.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2)
        const grad = ctx.createRadialGradient(s.x * W, s.y * H, 0, s.x * W, s.y * H, s.r * 3)
        grad.addColorStop(0, sc.nodeColorHex + Math.round(alpha * 255).toString(16).padStart(2, '0'))
        grad.addColorStop(1, 'transparent')
        ctx.fillStyle = grad
        ctx.fill()
      })

      // Pulse rings
      rings.forEach((ring) => {
        const progress = ((t * ring.speed * 20 + ring.phase) % (Math.PI * 2)) / (Math.PI * 2)
        const currentR = ring.maxR * progress
        const opacity = (1 - progress) * 0.18
        if (opacity < 0.01) return
        ctx.beginPath()
        ctx.arc(ring.x * W, ring.y * H, currentR * Math.min(W, H), 0, Math.PI * 2)
        ctx.strokeStyle = sc.nodeColorHex + Math.round(opacity * 255).toString(16).padStart(2, '0')
        ctx.lineWidth = 1.2
        ctx.stroke()
      })
    }
    draw()

    return () => {
      cancelAnimationFrame(animRef.current)
      ro.disconnect()
    }
  }, [scenario])

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 0,
      }}
    />
  )
}

// ─── Comparison Sidebar ───────────────────────────────────────────────────────
function ComparisonSidebar({
  profiles,
  collapsed,
  onToggle,
}: {
  profiles: GoalProfile[]
  collapsed: boolean
  onToggle: () => void
}) {
  const active = profiles.filter((p) => p.active)

  return (
    <div style={{
      width: collapsed ? 36 : 300,
      flexShrink: 0,
      backgroundColor: 'rgba(4,8,18,0.97)',
      borderLeft: '1px solid rgba(255,255,255,0.08)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      transition: 'width 0.25s ease',
      fontFamily: 'ui-monospace,monospace',
    }}>
      {/* Toggle button */}
      <button
        onClick={onToggle}
        style={{
          padding: '10px 0',
          background: 'rgba(0,0,0,0.4)',
          border: 'none',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
          color: '#6b7280',
          cursor: 'pointer',
          fontSize: 13,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {collapsed ? '◀' : '▶'}
      </button>

      {!collapsed && (
        <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
          <div style={{ fontSize: 9, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>
            Path Comparison ({active.length} active)
          </div>

          {active.length === 0 && (
            <div style={{ fontSize: 11, color: '#374151', textAlign: 'center', marginTop: 20 }}>
              Activate 2+ goal profiles to compare
            </div>
          )}

          {active.map((profile, idx) => {
            const monthlyRequired = profile.targetAmount / Math.max(1, profile.timeHorizonMonths)
            const probability = Math.max(10, Math.min(95, Math.round(100 - (monthlyRequired / 20000) * 15 + idx * 3)))
            const nextMilestoneLabel = `Month ${Math.round(profile.timeHorizonMonths * 0.33)} target`

            return (
              <div key={profile.id} style={{
                marginBottom: 14,
                padding: '12px',
                borderRadius: 8,
                border: `1px solid ${profile.color}44`,
                backgroundColor: profile.color + '0a',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: profile.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 11, fontWeight: 800, color: '#e2e8f0', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{profile.name}</span>
                </div>
                <div style={{ marginBottom: 6 }}>
                  <div style={{ fontSize: 8, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Target</div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: profile.color }}>{formatMoney(profile.targetAmount)}</div>
                </div>
                <div style={{ marginBottom: 6 }}>
                  <div style={{ fontSize: 8, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Time Horizon</div>
                  <div style={{ fontSize: 11, color: '#d1d5db' }}>{profile.timeHorizonMonths} months</div>
                </div>
                <div style={{ marginBottom: 6 }}>
                  <div style={{ fontSize: 8, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Projected Milestone</div>
                  <div style={{ fontSize: 10, color: '#9ca3af' }}>{nextMilestoneLabel}</div>
                </div>
                <div>
                  <div style={{ fontSize: 8, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>% Probability</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.06)' }}>
                      <div style={{ height: '100%', borderRadius: 3, width: `${probability}%`, backgroundColor: probability > 65 ? '#10b981' : probability > 40 ? '#f59e0b' : '#ef4444', transition: 'width 0.5s' }} />
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 800, color: probability > 65 ? '#10b981' : probability > 40 ? '#f59e0b' : '#ef4444', minWidth: 28 }}>{probability}%</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Goal Node Click Panel ────────────────────────────────────────────────────
function GoalNodePanel({
  node,
  screenX,
  screenY,
  onClose,
  profiles,
}: {
  node: CCNode | null
  screenX: number
  screenY: number
  onClose: () => void
  profiles: GoalProfile[]
}) {
  if (!node || node.type !== 'goalstep') return null
  const profile = profiles.find((p) => p.id === node.meta?.profileId)
  const stepNum = (node.meta?.stepIndex || 0) + 1
  const total = node.meta?.milestoneCount || 8
  const daysPerStep = Math.round(((node.meta?.timeHorizonMonths || 12) / total) * 30)
  const projDate = new Date()
  projDate.setDate(projDate.getDate() + daysPerStep * (node.meta?.stepIndex || 0))
  const dateStr = projDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })

  return (
    <div style={{
      position: 'absolute',
      left: Math.min(screenX + 18, (typeof window !== 'undefined' ? window.innerWidth : 800) - 280),
      top: Math.min(screenY - 10, (typeof window !== 'undefined' ? window.innerHeight : 600) - 200),
      width: 260,
      background: 'rgba(4,8,18,0.97)',
      border: `1px solid ${node.meta?.goalColor || '#7c3aed'}44`,
      borderRadius: 10,
      padding: '14px 16px',
      zIndex: 200,
      fontFamily: 'ui-monospace,monospace',
      boxShadow: `0 0 20px ${node.meta?.goalColor || '#7c3aed'}22`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 8, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Goal Path Node</div>
          <div style={{ fontSize: 13, fontWeight: 800, color: node.meta?.goalColor || '#7c3aed' }}>Milestone {stepNum} of {total}</div>
        </div>
        <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#9ca3af', borderRadius: 5, padding: '4px 8px', fontSize: 12, cursor: 'pointer' }}>✕</button>
      </div>

      {profile && (
        <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 10 }}>
          Profile: <span style={{ color: node.meta?.goalColor }}>{profile.name}</span>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 8, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Action Required</div>
          <div style={{ fontSize: 11, color: '#d1d5db' }}>
            {stepNum === 1 ? 'Complete baseline assessment & set KPIs' :
             stepNum <= 3 ? 'Execute pipeline growth activities' :
             stepNum <= 6 ? 'Optimize revenue systems & team' :
             'Scale toward final target milestone'}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 8, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Projected Date</div>
          <div style={{ fontSize: 11, color: '#d1d5db' }}>{dateStr}</div>
        </div>
        <div>
          <div style={{ fontSize: 8, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Projected Outcome</div>
          <div style={{ fontSize: 11, color: '#d1d5db' }}>
            {formatMoney(((node.meta?.targetAmount || 0) / total) * stepNum)} progress toward {formatMoney(node.meta?.targetAmount || 0)} target
          </div>
        </div>
        <div>
          <div style={{ fontSize: 8, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Timeline to Next</div>
          <div style={{ fontSize: 11, color: '#d1d5db' }}>{daysPerStep} days</div>
        </div>
      </div>

      <button style={{
        width: '100%', padding: '8px', borderRadius: 6, fontSize: 11, fontWeight: 700,
        background: (node.meta?.goalColor || '#7c3aed') + '22',
        border: `1px solid ${node.meta?.goalColor || '#7c3aed'}44`,
        color: node.meta?.goalColor || '#7c3aed',
        cursor: 'pointer', letterSpacing: '0.05em',
      }}>
        ⚡ Dive Deeper
      </button>
    </div>
  )
}

// ─── Actionable Steps Panel ───────────────────────────────────────────────────
function ActionableStepsPanel({
  onPathGenerated,
}: {
  onPathGenerated: (profile: GoalProfile) => void
}) {
  const [targetAmount, setTargetAmount] = useState(250000)
  const [timeHorizon, setTimeHorizon] = useState(24)
  const [generating, setGenerating] = useState(false)
  const [lastMilestones, setLastMilestones] = useState<GeneratedMilestone[]>([])
  const [expanded, setExpanded] = useState(false)

  async function generatePath() {
    setGenerating(true)
    try {
      const data = getBackupData()
      const kpis = data ? getKPIs(data) : {}
      const projects = data?.projects?.length ?? 0
      const pipeline = kpis.pipeline ?? 0
      const paid = kpis.paid ?? 0

      const systemPrompt = `You are a business growth strategist for Power On Solutions, an electrical contractor. Return ONLY valid JSON.`
      const userPrompt = `Current business state:
- Projects: ${projects}
- Pipeline: ${formatMoney(pipeline)}
- Paid this period: ${formatMoney(paid)}

Target: ${formatMoney(targetAmount)} in ${timeHorizon} months.

Return a JSON array of exactly 8 milestone objects with this shape:
{ "title": string, "description": string (1 sentence), "projectedDate": string (e.g. "Month 4"), "dependencies": string[] (1-2 items), "accelerators": string[] (1-2 items) }

Return ONLY the JSON array, no markdown, no explanation.`

      const res = await callClaude({
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        max_tokens: 1200,
      })
      const text = extractText(res)
      const cleaned = text.replace(/```json|```/g, '').trim()
      const startIdx = cleaned.indexOf('[')
      const endIdx = cleaned.lastIndexOf(']')
      if (startIdx >= 0 && endIdx > startIdx) {
        const milestones: GeneratedMilestone[] = JSON.parse(cleaned.slice(startIdx, endIdx + 1))
        setLastMilestones(milestones)
        setExpanded(true)

        const colorIdx = Math.floor(Math.random() * GOAL_PROFILE_COLORS.length)
        const newProfile: GoalProfile = {
          id: 'gen_' + Date.now(),
          name: `${formatMoney(targetAmount)} / ${timeHorizon}mo`,
          color: GOAL_PROFILE_COLORS[colorIdx],
          startingPoint: 'current',
          startingCapital: 0,
          startingRevenue: paid,
          startingTeamSize: 1,
          targetAmount,
          timeHorizonMonths: timeHorizon,
          scenarioFactors: [],
          notes: `Auto-generated path targeting ${formatMoney(targetAmount)} in ${timeHorizon} months`,
          active: true,
        }
        onPathGenerated(newProfile)
      }
    } catch (e) {
      console.error('Path generation failed:', e)
    }
    setGenerating(false)
  }

  return (
    <div style={{
      backgroundColor: '#0d1321',
      borderBottom: '1px solid #1e2d3d',
      padding: '12px 16px',
      flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        {/* Target Amount */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 9, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Target Amount</span>
            <span style={{ fontSize: 12, fontWeight: 800, color: '#10b981' }}>{formatMoney(targetAmount)}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="range" min={5000} max={1000000} step={5000} value={targetAmount}
              onChange={(e) => setTargetAmount(Number(e.target.value))}
              style={{ width: 140, accentColor: '#10b981', cursor: 'pointer' }}
            />
            <input
              type="number" min={5000} max={1000000} step={1000} value={targetAmount}
              onChange={(e) => setTargetAmount(Math.max(5000, Math.min(1000000, Number(e.target.value))))}
              style={{ width: 90, padding: '3px 6px', borderRadius: 5, border: '1px solid #1e3a2f', backgroundColor: '#060d0a', color: '#10b981', fontSize: 11, outline: 'none' }}
            />
          </div>
        </div>

        <div style={{ width: 1, height: 36, background: 'rgba(255,255,255,0.07)' }} />

        {/* Time Horizon */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 9, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Time Horizon</span>
            <span style={{ fontSize: 12, fontWeight: 800, color: '#0ea5e9' }}>{timeHorizon} months</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="range" min={12} max={240} step={6} value={timeHorizon}
              onChange={(e) => setTimeHorizon(Number(e.target.value))}
              style={{ width: 140, accentColor: '#0ea5e9', cursor: 'pointer' }}
            />
            <input
              type="number" min={12} max={240} step={1} value={timeHorizon}
              onChange={(e) => setTimeHorizon(Math.max(12, Math.min(240, Number(e.target.value))))}
              style={{ width: 60, padding: '3px 6px', borderRadius: 5, border: '1px solid #1e2d3d', backgroundColor: '#060d18', color: '#0ea5e9', fontSize: 11, outline: 'none' }}
            />
          </div>
        </div>

        <div style={{ width: 1, height: 36, background: 'rgba(255,255,255,0.07)' }} />

        {/* Generate button */}
        <button
          onClick={generatePath}
          disabled={generating}
          style={{
            padding: '8px 18px', borderRadius: 7,
            border: '1px solid rgba(16,185,129,0.4)',
            backgroundColor: generating ? 'rgba(16,185,129,0.08)' : 'rgba(16,185,129,0.12)',
            color: '#10b981', fontSize: 12, fontWeight: 800,
            cursor: generating ? 'not-allowed' : 'pointer',
            opacity: generating ? 0.6 : 1,
            letterSpacing: '0.05em',
            transition: 'all 0.15s',
          }}
        >
          {generating ? '⏳ Generating…' : '⚡ Generate Path'}
        </button>

        {lastMilestones.length > 0 && (
          <button
            onClick={() => setExpanded((e) => !e)}
            style={{
              padding: '6px 12px', borderRadius: 6,
              border: '1px solid rgba(255,255,255,0.1)',
              backgroundColor: 'transparent',
              color: '#6b7280', fontSize: 10, fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {expanded ? '▲ Hide' : '▼ Milestones'} ({lastMilestones.length})
          </button>
        )}
      </div>

      {expanded && lastMilestones.length > 0 && (
        <div style={{ marginTop: 12, display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 8 }}>
          {lastMilestones.map((m, i) => (
            <div key={i} style={{
              minWidth: 200, padding: '10px 12px', borderRadius: 8,
              border: '1px solid #1e3a2f', backgroundColor: '#0a1a10', flexShrink: 0,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                <div style={{ width: 18, height: 18, borderRadius: '50%', backgroundColor: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 800, color: '#000', flexShrink: 0 }}>{i + 1}</div>
                <span style={{ fontSize: 10, fontWeight: 800, color: '#10b981' }}>{m.title}</span>
              </div>
              <div style={{ fontSize: 9, color: '#6b7280', marginBottom: 4 }}>{m.projectedDate}</div>
              <div style={{ fontSize: 9, color: '#9ca3af', lineHeight: 1.5, marginBottom: 6 }}>{m.description}</div>
              {m.accelerators?.length > 0 && (
                <div style={{ fontSize: 8, color: '#4ade80' }}>⚡ {m.accelerators[0]}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── The Three.js Neural Map (CC instance) ────────────────────────────────────
function CCNeuralMapCanvas({
  mode,
  profiles,
  scenario,
  onGoalNodeClick,
}: {
  mode: CCMapMode
  profiles: GoalProfile[]
  scenario: PerformanceScenario
  onGoalNodeClick: (node: CCNode, x: number, y: number) => void
}) {
  const mountRef = useRef<HTMLDivElement>(null)
  const modeRef = useRef<CCMapMode>(mode)
  const profilesRef = useRef<GoalProfile[]>(profiles)
  const scenarioRef = useRef<PerformanceScenario>(scenario)
  const rebuildRef = useRef<() => void>(() => {})
  const goalRebuildRef = useRef<() => void>(() => {})
  const onGoalNodeClickRef = useRef(onGoalNodeClick)

  useEffect(() => { modeRef.current = mode }, [mode])
  useEffect(() => { profilesRef.current = profiles }, [profiles])
  useEffect(() => {
    scenarioRef.current = scenario
    if (rebuildRef.current) rebuildRef.current()
  }, [scenario])
  useEffect(() => { onGoalNodeClickRef.current = onGoalNodeClick }, [onGoalNodeClick])

  useEffect(() => {
    if (rebuildRef.current) rebuildRef.current()
  }, [mode])

  useEffect(() => {
    if (goalRebuildRef.current) goalRebuildRef.current()
  }, [profiles])

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    const W = Math.max(mount.clientWidth || 600, 100)
    const H = Math.max(mount.clientHeight || 500, 100)

    const scene    = new THREE.Scene()
    const camera   = new THREE.PerspectiveCamera(55, W / H, 0.1, 100)
    camera.position.z = 10

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setSize(W, H)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearColor(0x020408, 0)   // alpha=0 so constellation bg shows through
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    mount.appendChild(renderer.domElement)

    // ── Decoration overlay (2D canvas) for glow + dash effects ───────────────
    const overlayCanvas = document.createElement('canvas')
    overlayCanvas.width = W; overlayCanvas.height = H
    overlayCanvas.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:5;'
    mount.appendChild(overlayCanvas)
    let overlayCtx: CanvasRenderingContext2D | null = overlayCanvas.getContext('2d')
    let lineDashOffset = 0

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.25); scene.add(ambientLight)
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.4); dirLight.position.set(5, 8, 5); scene.add(dirLight)

    const nodeGroup  = new THREE.Group(); scene.add(nodeGroup)
    const edgeGroup  = new THREE.Group(); scene.add(edgeGroup)
    const goalGroup  = new THREE.Group(); scene.add(goalGroup)

    const hitGeo = new THREE.SphereGeometry(1, 5, 5)
    const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.0, depthWrite: false })
    let hitSpheres: THREE.Mesh[] = []

    let currentNodes: CCNode[] = []
    let currentEdges: CCEdge[] = []
    let simulationActive = true
    let edgesAsTubes = false

    let labelContainer: HTMLDivElement | null = null
    let labelDivs: HTMLDivElement[] = []
    const _labelV3 = new THREE.Vector3()

    function createLabelContainer() {
      labelContainer = document.createElement('div')
      labelContainer.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:10;'
      mount.appendChild(labelContainer)
    }
    createLabelContainer()

    // ── Build sprites per node ────────────────────────────────────────────────
    function createNodeSprite(n: CCNode): THREE.Sprite {
      const isGoal = n.type === 'goalstep'
      const isBg   = n.isBackground && modeRef.current === 'goal'
      let canvas: HTMLCanvasElement

      if (isGoal) {
        canvas = makeGoalStepCanvasCC(n.meta?.goalColor || '#7c3aed', n.meta?.stepIndex || 0)
      } else if (n.type === 'rfi') {
        canvas = makeRFINodeCanvas('#' + n.color.toString(16).padStart(6, '0'), n.meta?.rfiCount || 1)
      } else if (n.type === 'servicecall') {
        canvas = makeServiceCallCanvas('#' + n.color.toString(16).padStart(6, '0'), n.meta?.callCount || 1)
      } else if (n.type === 'cashflow') {
        const rateStr = (n.meta?.collectionRate || 0) + '%'
        canvas = makeCashFlowCanvas('#' + n.color.toString(16).padStart(6, '0'), rateStr)
      } else {
        canvas = makeBackgroundNodeCanvas('#' + n.color.toString(16).padStart(6, '0'))
      }

      const texture = new THREE.CanvasTexture(canvas)
      const mat = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        opacity: isBg ? 0.4 : 1.0,
        depthWrite: false,
      })
      return new THREE.Sprite(mat)
    }

    // ── Rebuild full scene ────────────────────────────────────────────────────
    function rebuildScene() {
      hitSpheres.forEach((s) => scene.remove(s)); hitSpheres = []
      if (labelContainer) labelContainer.innerHTML = ''; labelDivs = []
      while (nodeGroup.children.length) nodeGroup.remove(nodeGroup.children[0])
      while (edgeGroup.children.length) edgeGroup.remove(edgeGroup.children[0])
      while (goalGroup.children.length) goalGroup.remove(goalGroup.children[0])
      edgesAsTubes = false

      const { nodes, edges } = buildSceneData(modeRef.current, profilesRef.current, scenarioRef.current)
      const capped = nodes.slice(0, 250)
      currentNodes = capped
      currentEdges = edges.filter((e) => e.a < capped.length && e.b < capped.length)

      currentNodes.forEach((n) => {
        const sprite = createNodeSprite(n)
        sprite.scale.setScalar(n.size * 1.6)
        sprite.position.set(n.x, n.y, n.z)
        n.type === 'goalstep' ? goalGroup.add(sprite) : nodeGroup.add(sprite)
        n.mesh = sprite

        const hs = new THREE.Mesh(hitGeo, hitMat)
        hs.scale.setScalar(n.size * 1.8)
        hs.position.set(n.x, n.y, n.z)
        scene.add(hs); hitSpheres.push(hs)
      })

      // Labels
      if (labelContainer) {
        labelDivs = currentNodes.map((n) => {
          const div = document.createElement('div')
          const isBg = n.isBackground && modeRef.current === 'goal'
          const opacity = isBg ? '0.35' : '1'
          div.style.cssText = `position:absolute;pointer-events:none;white-space:nowrap;font-family:monospace;font-size:9px;font-weight:700;letter-spacing:0.04em;background:rgba(4,8,18,0.82);border:1px solid rgba(255,255,255,0.06);border-radius:4px;padding:2px 5px;transform:translate(-50%,-100%);margin-top:-8px;opacity:${opacity};`
          if (n.type === 'goalstep') {
            div.style.color = n.meta?.goalColor || '#7c3aed'
            div.style.borderColor = (n.meta?.goalColor || '#7c3aed') + '44'
            div.textContent = n.meta?.profileName + ' M' + ((n.meta?.stepIndex || 0) + 1)
          } else if (n.type === 'project') {
            div.style.color = '#00ff88'
            div.textContent = n.label
          } else if (n.type === 'agent') {
            div.style.color = '#ca8a04'
            div.textContent = n.label
          } else if (n.type === 'rfi') {
            div.style.color = '#ff9944'
            div.textContent = n.label
          } else if (n.type === 'servicecall') {
            div.style.color = '#38bdf8'
            div.textContent = n.label
          } else if (n.type === 'cashflow') {
            div.style.color = '#34d399'
            div.textContent = `Cash ${n.meta?.collectionRate ?? 0}%`
          } else {
            div.style.color = '#06b6d4'
            div.textContent = n.label
          }
          labelContainer!.appendChild(div)
          return div
        })
      }

      // Edges
      currentEdges.forEach((e) => {
        const a = currentNodes[e.a], b = currentNodes[e.b]; if (!a || !b) return
        const geo = new THREE.BufferGeometry()
        const pts = new Float32Array([a.x, a.y, a.z, b.x, b.y, b.z])
        geo.setAttribute('position', new THREE.BufferAttribute(pts, 3))
        const isBgEdge = e.isBackground && modeRef.current === 'goal'
        const sc = SCENARIO_CONFIG[scenarioRef.current]
        const edgeColor = e.isGoal
          ? parseInt((e.pathColor || '#7c3aed').replace('#', ''), 16)
          : sc.lineColorInt
        const edgeOpacity = isBgEdge ? 0.15 : e.isGoal ? 0.75 : 0.45
        const mat = new THREE.LineBasicMaterial({ color: edgeColor, transparent: true, opacity: edgeOpacity })
        const line = new THREE.Line(geo, mat)
        e.isGoal ? goalGroup.add(line) : edgeGroup.add(line)
        e.line = line
      })

      simulationActive = true
    }

    rebuildScene()
    rebuildRef.current = rebuildScene
    goalRebuildRef.current = rebuildScene

    // ── Force simulation ──────────────────────────────────────────────────────
    function simulateStep() {
      const repulsion = 3.0, spring = 0.07, damping = 0.85, gravity = 0.03
      for (const n of currentNodes) { n.fx = 0; n.fy = 0; n.fz = 0 }
      for (let i = 0; i < currentNodes.length; i++) {
        const a = currentNodes[i]; if (a.pinned) continue
        for (let j = i + 1; j < currentNodes.length; j++) {
          const b = currentNodes[j]; if (b.pinned) continue
          const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z
          const distSq = Math.max(0.25, dx * dx + dy * dy + dz * dz), dist = Math.sqrt(distSq)
          const force = repulsion / distSq
          a.fx += dx / dist * force; a.fy += dy / dist * force; a.fz += dz / dist * force
          b.fx -= dx / dist * force; b.fy -= dy / dist * force; b.fz -= dz / dist * force
        }
      }
      for (const e of currentEdges) {
        const a = currentNodes[e.a], b = currentNodes[e.b]; if (!a || !b || e.isGoal) continue
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z
        const dist = Math.max(0.1, Math.sqrt(dx * dx + dy * dy + dz * dz)), target = 2.5
        const force = spring * (dist - target)
        if (!a.pinned) { a.fx += dx / dist * force; a.fy += dy / dist * force; a.fz += dz / dist * force }
        if (!b.pinned) { b.fx -= dx / dist * force; b.fy -= dy / dist * force; b.fz -= dz / dist * force }
      }
      const clusterTargets: Record<string, [number, number, number]> = {
        project: [-3, 0, 0], agent: [3, 0, 0], decision: [0, 3, 0], data: [0, -3, 0],
        rfi: [-3, 2, 0], servicecall: [4, -2, 0], cashflow: [0, 3, 0],
      }
      for (const n of currentNodes) {
        if (n.pinned) continue
        const ct = clusterTargets[n.type]
        if (ct) { n.fx += (ct[0] - n.x) * 0.015; n.fy += (ct[1] - n.y) * 0.015; n.fz += (ct[2] - n.z) * 0.015 }
      }
      let totalKE = 0
      for (const n of currentNodes) {
        if (n.pinned) { n.vx = 0; n.vy = 0; n.vz = 0; continue }
        n.fx -= n.x * gravity; n.fy -= n.y * gravity; n.fz -= n.z * gravity
        n.vx = (n.vx + n.fx) * damping; n.vy = (n.vy + n.fy) * damping; n.vz = (n.vz + n.fz) * damping
        n.x += n.vx; n.y += n.vy; n.z += n.vz
        if (n.mesh) (n.mesh as THREE.Object3D).position.set(n.x, n.y, n.z)
        totalKE += n.vx ** 2 + n.vy ** 2 + n.vz ** 2
      }
      hitSpheres.forEach((hs, i) => { const n = currentNodes[i]; if (n) hs.position.set(n.x, n.y, n.z) })
      if (!edgesAsTubes) {
        currentEdges.forEach((e) => {
          const a = currentNodes[e.a], b = currentNodes[e.b]; if (!a || !b || !e.line || e.isGoal) return
          const pos = (e.line as THREE.Line).geometry?.attributes?.position; if (!pos) return
          pos.setXYZ(0, a.x, a.y, a.z); pos.setXYZ(1, b.x, b.y, b.z); pos.needsUpdate = true
        })
      }
      if (totalKE < 0.001 * currentNodes.length) {
        simulationActive = false
        if (!edgesAsTubes) {
          edgesAsTubes = true
          const sc = SCENARIO_CONFIG[scenarioRef.current]
          currentEdges.forEach((e) => {
            if (e.isGoal) return
            const a = currentNodes[e.a], b = currentNodes[e.b]; if (!a || !b || !e.line) return
            const isBgEdge = e.isBackground && modeRef.current === 'goal'
            edgeGroup.remove(e.line as THREE.Object3D)
            ;(e.line as any).geometry?.dispose(); (e.line as any).material?.dispose()
            const path = new THREE.LineCurve3(new THREE.Vector3(a.x, a.y, a.z), new THREE.Vector3(b.x, b.y, b.z))
            const tubeGeo = new THREE.TubeGeometry(path, 2, 0.014, 4, false)
            const tubeMat = new THREE.MeshBasicMaterial({ color: sc.lineColorInt, transparent: true, opacity: isBgEdge ? 0.12 : 0.35 })
            const tubeMesh = new THREE.Mesh(tubeGeo, tubeMat)
            edgeGroup.add(tubeMesh); e.line = tubeMesh
          })
        }
      }
    }

    // ── Camera controls ───────────────────────────────────────────────────────
    let pulseTick = 0, animFrame: number
    let isDragging = false, dragMoved = false, lastMX = 0, lastMY = 0
    let camPhi = Math.PI / 6, camTheta = 0, camR = 10, targetCamR = 10
    const camLookAt = new THREE.Vector3(), targetLookAt = new THREE.Vector3()
    let hoveredNode: CCNode | null = null
    const raycaster = new THREE.Raycaster()
    const mouse = new THREE.Vector2()
    let tooltipDiv: HTMLDivElement | null = null

    function createTooltip() {
      tooltipDiv = document.createElement('div')
      tooltipDiv.style.cssText = 'position:absolute;background:rgba(4,8,18,0.92);border:1px solid rgba(0,255,136,0.2);color:#e2e8f0;font-size:11px;padding:7px 11px;border-radius:7px;pointer-events:none;white-space:nowrap;z-index:100;display:none;font-family:monospace;'
      mount.appendChild(tooltipDiv)
    }
    createTooltip()

    function updateTooltip(n: CCNode, mx: number, my: number, rect: DOMRect) {
      if (!tooltipDiv) return
      const typeLabel = n.type.charAt(0).toUpperCase() + n.type.slice(1)
      let metric = ''
      if (n.type === 'project') metric = `Health: <span style="color:#00ff88">${n.meta?.healthScore ?? '?'}%</span>`
      if (n.type === 'agent')   metric = `Tier ${n.meta?.tier ?? '?'} · ${n.meta?.desc ?? ''}`
      if (n.type === 'data')    metric = `<span style="color:#06b6d4">${n.meta?.valueStr ?? ''}</span>`
      if (n.type === 'goalstep') {
        const gc = n.meta?.goalColor || '#7c3aed'
        metric = `<span style="color:${gc}">Milestone ${(n.meta?.stepIndex || 0) + 1} · ${n.meta?.profileName || ''}</span>`
      }
      if (n.type === 'rfi') metric = `<span style="color:#ff9944">${n.meta?.rfiCount} open RFIs · avg ${n.meta?.avgAgeDays}d old</span>`
      if (n.type === 'servicecall') metric = `<span style="color:#38bdf8">${n.meta?.callCount} active service calls</span>`
      if (n.type === 'cashflow') metric = `<span style="color:#34d399">Collection: ${n.meta?.collectionRate}% · ${n.meta?.paidStr} / ${n.meta?.pipelineStr}</span>`
      tooltipDiv.innerHTML = `<div style="font-weight:800;color:#fff;margin-bottom:2px">${n.label}</div><div style="color:#4b5563;font-size:9px;text-transform:uppercase;letter-spacing:0.08em">${typeLabel}</div>${metric ? `<div style="font-size:10px;margin-top:3px">${metric}</div>` : ''}`
      tooltipDiv.style.display = 'block'
      tooltipDiv.style.left = (mx - rect.left + 15) + 'px'
      tooltipDiv.style.top  = (my - rect.top - 5) + 'px'
    }

    function onMouseDown(e: MouseEvent) { isDragging = true; dragMoved = false; lastMX = e.clientX; lastMY = e.clientY }
    function onMouseUp() { isDragging = false }
    function onMouseMove(e: MouseEvent) {
      if (isDragging) {
        const dx = e.clientX - lastMX, dy = e.clientY - lastMY
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragMoved = true
        camTheta -= dx * 0.008
        camPhi = Math.max(0.2, Math.min(Math.PI - 0.2, camPhi - dy * 0.008))
        lastMX = e.clientX; lastMY = e.clientY
      }
      const rect = mount.getBoundingClientRect()
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(mouse, camera)
      const hits = raycaster.intersectObjects(hitSpheres)
      if (hits.length > 0) {
        const hitIdx = hitSpheres.indexOf(hits[0].object as THREE.Mesh)
        hoveredNode = hitIdx >= 0 ? (currentNodes[hitIdx] || null) : null
        if (tooltipDiv && hoveredNode) updateTooltip(hoveredNode, e.clientX, e.clientY, rect)
      } else {
        hoveredNode = null
        if (tooltipDiv) tooltipDiv.style.display = 'none'
      }
    }
    function onWheel(e: WheelEvent) { targetCamR = Math.max(3, Math.min(20, targetCamR + e.deltaY * 0.01)) }
    function onClick(e: MouseEvent) {
      if (dragMoved) return
      const rect = mount.getBoundingClientRect()
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(mouse, camera)
      const hits = raycaster.intersectObjects(hitSpheres)
      if (hits.length > 0) {
        const hitIdx = hitSpheres.indexOf(hits[0].object as THREE.Mesh)
        const n = currentNodes[hitIdx]
        if (n && n.type === 'goalstep') {
          onGoalNodeClickRef.current(n, e.clientX - rect.left, e.clientY - rect.top)
        } else {
          targetLookAt.set(n?.x ?? 0, n?.y ?? 0, n?.z ?? 0)
        }
      }
    }
    function onDblClick(e: MouseEvent) {
      const rect = mount.getBoundingClientRect()
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(mouse, camera)
      const hits = raycaster.intersectObjects(hitSpheres)
      if (hits.length > 0) {
        const n = currentNodes[hitSpheres.indexOf(hits[0].object as THREE.Mesh)]
        if (n) { targetLookAt.set(n.x, n.y, n.z); targetCamR = 4 }
      } else {
        targetLookAt.set(0, 0, 0); targetCamR = 10
      }
    }

    renderer.domElement.addEventListener('mousedown', onMouseDown)
    renderer.domElement.addEventListener('mouseup', onMouseUp)
    renderer.domElement.addEventListener('mousemove', onMouseMove)
    renderer.domElement.addEventListener('wheel', onWheel, { passive: true })
    renderer.domElement.addEventListener('click', onClick)
    renderer.domElement.addEventListener('dblclick', onDblClick)

    // ── Animate ───────────────────────────────────────────────────────────────
    function animate() {
      animFrame = requestAnimationFrame(animate)
      pulseTick += 0.016
      camR += (targetCamR - camR) * 0.05
      camLookAt.lerp(targetLookAt, 0.05)
      if (!isDragging) camTheta += 0.0018
      if (simulationActive) simulateStep()
      camera.position.x = camR * Math.sin(camPhi) * Math.sin(camTheta)
      camera.position.y = camR * Math.cos(camPhi)
      camera.position.z = camR * Math.sin(camPhi) * Math.cos(camTheta)
      camera.lookAt(camLookAt)

      const pPulse = Math.sin(pulseTick * 3) * 0.5 + 0.5
      currentNodes.forEach((n) => {
        if (!n.mesh) return
        const sprite = n.mesh as THREE.Sprite
        const isHovered = hoveredNode === n
        const baseSize = n.type === 'goalstep' ? n.size * 1.8 : n.size * 1.4
        const targetScale = (isHovered ? baseSize * 1.25 : baseSize)
        const curScale = sprite.scale.x
        sprite.scale.setScalar(curScale + (targetScale - curScale) * 0.12)
        if (n.type === 'goalstep') {
          sprite.scale.setScalar((curScale + (targetScale - curScale) * 0.12) * (1 + Math.sin(pulseTick * 2 + (n.meta?.stepIndex || 0) * 0.5) * 0.06))
        }
        // B66: "alto" scenario — extra glow pulse on all nodes
        if (scenarioRef.current === 'alto' && n.type !== 'goalstep') {
          const extraPulse = 1 + Math.sin(pulseTick * 2.5 + (n.x * 0.3)) * 0.04
          sprite.scale.multiplyScalar(extraPulse)
        }
      })

      goalGroup.children.forEach((child, i) => {
        if (child instanceof THREE.Sprite) {
          child.position.y += Math.sin(pulseTick + i * 0.4) * 0.0006
        }
      })

      const fadeLabels = camR > 14
      currentNodes.forEach((n, i) => {
        const div = labelDivs[i]; if (!div) return
        _labelV3.set(n.x, n.y, n.z); _labelV3.project(camera)
        if (_labelV3.z > 1) { div.style.display = 'none'; return }
        const lx = (_labelV3.x + 1) / 2 * (mount.clientWidth || 600)
        const ly = (-_labelV3.y + 1) / 2 * (mount.clientHeight || 500)
        div.style.left = lx + 'px'; div.style.top = ly + 'px'
        div.style.display = 'block'
        const isBg = n.isBackground && modeRef.current === 'goal'
        div.style.opacity = fadeLabels ? '0' : isBg ? '0.35' : '1'
      })

      renderer.render(scene, camera)

      // ── Decoration overlay: node glows + animated edge dashes ──────────────
      if (overlayCtx) {
        const oc = overlayCtx
        const OW = overlayCanvas.width, OH = overlayCanvas.height
        oc.clearRect(0, 0, OW, OH)
        lineDashOffset -= 0.5
        const sc = SCENARIO_CONFIG[scenarioRef.current]

        currentNodes.forEach((n) => {
          const proj = new THREE.Vector3(n.x, n.y, n.z).project(camera)
          if (proj.z > 1) return
          const sx = (proj.x + 1) / 2 * OW
          const sy = (-proj.y + 1) / 2 * OH
          const pixR = Math.max(6, n.size * 55)
          const glowR = pixR * 2
          const hex = '#' + n.color.toString(16).padStart(6, '0')
          const isHot = n.type === 'agent' || n.type === 'goalstep' || n.type === 'cashflow' || ((n.meta?.healthScore ?? 75) > 70)
          const baseGlow = sc.glowOpacity
          const brightness = isHot ? baseGlow + Math.sin(pulseTick * 4) * 0.18 : baseGlow * 0.45
          const a1 = Math.round(brightness * 180).toString(16).padStart(2, '0')
          const a2 = Math.round(brightness * 50).toString(16).padStart(2, '0')
          const grad = oc.createRadialGradient(sx, sy, 0, sx, sy, glowR)
          grad.addColorStop(0, hex + a1)
          grad.addColorStop(0.55, hex + a2)
          grad.addColorStop(1, 'transparent')
          oc.fillStyle = grad
          oc.beginPath(); oc.arc(sx, sy, glowR, 0, Math.PI * 2); oc.fill()
        })

        // Faint animated dash offset on connection lines
        oc.setLineDash([4, 10])
        oc.lineDashOffset = lineDashOffset
        oc.strokeStyle = sc.lineColorHex + '14'
        oc.lineWidth = 0.8
        currentEdges.forEach((e) => {
          const a = currentNodes[e.a], b = currentNodes[e.b]; if (!a || !b) return
          const pa = new THREE.Vector3(a.x, a.y, a.z).project(camera)
          const pb = new THREE.Vector3(b.x, b.y, b.z).project(camera)
          if (pa.z > 1 || pb.z > 1) return
          const ax = (pa.x + 1) / 2 * OW, ay = (-pa.y + 1) / 2 * OH
          const bx = (pb.x + 1) / 2 * OW, by = (-pb.y + 1) / 2 * OH
          oc.beginPath(); oc.moveTo(ax, ay); oc.lineTo(bx, by); oc.stroke()
        })
        oc.setLineDash([])
      }
    }
    animate()

    const ro = new ResizeObserver(() => {
      if (!mount) return
      const w = mount.clientWidth, h = mount.clientHeight; if (!w || !h) return
      camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h)
      overlayCanvas.width = w; overlayCanvas.height = h
      overlayCtx = overlayCanvas.getContext('2d')
    })
    ro.observe(mount)

    return () => {
      cancelAnimationFrame(animFrame)
      ro.disconnect()
      renderer.domElement.removeEventListener('mousedown', onMouseDown)
      renderer.domElement.removeEventListener('mouseup', onMouseUp)
      renderer.domElement.removeEventListener('mousemove', onMouseMove)
      renderer.domElement.removeEventListener('wheel', onWheel)
      renderer.domElement.removeEventListener('click', onClick)
      renderer.domElement.removeEventListener('dblclick', onDblClick)
      nodeGroup.traverse((obj) => { if (obj instanceof THREE.Sprite) { obj.material.map?.dispose(); obj.material.dispose() } })
      edgeGroup.traverse((obj) => { if ((obj as any).geometry) (obj as any).geometry.dispose(); if ((obj as any).material) (obj as any).material.dispose() })
      goalGroup.traverse((obj) => { if (obj instanceof THREE.Sprite) { obj.material.map?.dispose(); obj.material.dispose() } })
      hitSpheres.forEach((s) => scene.remove(s)); hitGeo.dispose(); hitMat.dispose()
      renderer.dispose()
      if (tooltipDiv?.parentNode) tooltipDiv.parentNode.removeChild(tooltipDiv)
      if (labelContainer?.parentNode) labelContainer.parentNode.removeChild(labelContainer)
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement)
      if (mount.contains(overlayCanvas)) mount.removeChild(overlayCanvas)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={mountRef} style={{ position: 'absolute', inset: 0, zIndex: 1 }} />
}

// ─── B66: Scenario Selector UI ────────────────────────────────────────────────
function ScenarioSelector({
  scenario,
  autoScenario,
  manualOverride,
  onSelect,
  onClearOverride,
}: {
  scenario: PerformanceScenario
  autoScenario: PerformanceScenario
  manualOverride: boolean
  onSelect: (s: PerformanceScenario) => void
  onClearOverride: () => void
}) {
  const sc = SCENARIO_CONFIG[scenario]
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
      padding: '8px 16px',
      borderBottom: '1px solid rgba(255,255,255,0.07)',
      backgroundColor: 'rgba(0,0,0,0.5)',
      flexShrink: 0,
    }}>
      <span style={{ fontSize: 9, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.1em', marginRight: 2 }}>
        Scenario
      </span>

      {SCENARIO_ORDER.map((s) => {
        const cfg = SCENARIO_CONFIG[s]
        const isActive = scenario === s
        const isAuto = s === autoScenario
        return (
          <button
            key={s}
            onClick={() => onSelect(s)}
            title={cfg.description}
            style={{
              padding: '4px 12px',
              borderRadius: 6,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.04em',
              cursor: 'pointer',
              border: isActive ? `1px solid ${cfg.borderColor}` : '1px solid rgba(255,255,255,0.08)',
              backgroundColor: isActive ? cfg.nodeColorHex + '22' : 'rgba(255,255,255,0.04)',
              color: isActive ? cfg.nodeColorHex : '#6b7280',
              boxShadow: isActive ? `0 0 10px ${cfg.nodeColorHex}44` : 'none',
              transition: 'all 0.15s',
              position: 'relative',
            }}
          >
            {cfg.emoji} {cfg.label}
            {isAuto && !manualOverride && (
              <span style={{
                position: 'absolute', top: -5, right: -5,
                background: '#7c3aed', color: '#fff',
                fontSize: 7, fontWeight: 800, borderRadius: 3,
                padding: '1px 3px', letterSpacing: 0,
              }}>AUTO</span>
            )}
          </button>
        )
      })}

      {manualOverride && (
        <button
          onClick={onClearOverride}
          style={{
            padding: '3px 8px', borderRadius: 5, fontSize: 9, fontWeight: 700,
            border: '1px solid rgba(124,58,237,0.4)',
            backgroundColor: 'rgba(124,58,237,0.1)',
            color: '#7c3aed', cursor: 'pointer',
          }}
        >
          ↺ Auto
        </button>
      )}

      <div style={{
        marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <div style={{
          width: 8, height: 8, borderRadius: '50%',
          backgroundColor: sc.nodeColorHex,
          boxShadow: `0 0 6px ${sc.nodeColorHex}`,
        }} />
        <span style={{ fontSize: 9, color: sc.nodeColorHex, fontWeight: 700 }}>
          {sc.description}
        </span>
        {!manualOverride && (
          <span style={{ fontSize: 8, color: '#4b5563', marginLeft: 4 }}>· NEXUS auto</span>
        )}
      </div>
    </div>
  )
}

// ─── Main export ──────────────────────────────────────────────────────────────
export default function CommandCenterNeuralMap() {
  const [mapMode, setMapMode] = useState<CCMapMode>('explore')
  const [profiles, setProfiles] = useState<GoalProfile[]>([])
  const [comparisonCollapsed, setComparisonCollapsed] = useState(false)
  const [selectedGoalNode, setSelectedGoalNode] = useState<CCNode | null>(null)
  const [goalNodeX, setGoalNodeX] = useState(0)
  const [goalNodeY, setGoalNodeY] = useState(0)

  // B66: Scenario state
  const [autoScenario, setAutoScenario] = useState<PerformanceScenario>('mediano')
  const [manualScenario, setManualScenario] = useState<PerformanceScenario | null>(null)
  const activeScenario: PerformanceScenario = manualScenario ?? autoScenario

  // Auto-classify scenario on mount and when entering Goal Mode (real data)
  useEffect(() => {
    const classified = classifyScenario()
    setAutoScenario(classified)
  }, [mapMode])

  // Load goal profiles from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(GOAL_STORAGE_KEY)
      if (saved) {
        const parsed: GoalProfile[] = JSON.parse(saved)
        setProfiles(parsed)
      }
    } catch {}
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(GOAL_STORAGE_KEY, JSON.stringify(profiles))
    } catch {}
  }, [profiles])

  const handleGoalNodeClick = useCallback((node: CCNode, x: number, y: number) => {
    setSelectedGoalNode(node)
    setGoalNodeX(x)
    setGoalNodeY(y)
  }, [])

  const handlePathGenerated = useCallback((newProfile: GoalProfile) => {
    setProfiles((prev) => [...prev, newProfile])
    setMapMode('goal')
  }, [])

  const handleScenarioSelect = useCallback((s: PerformanceScenario) => {
    setManualScenario(s)
  }, [])

  const handleClearOverride = useCallback(() => {
    setManualScenario(null)
  }, [])

  const activeCount = profiles.filter((p) => p.active).length
  const showComparison = mapMode === 'goal' && activeCount >= 2
  const sc = SCENARIO_CONFIG[activeScenario]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 106px)', overflow: 'hidden', backgroundColor: '#020408', color: '#e2e8f0', fontFamily: 'ui-monospace, monospace' }}>

      {/* Feature 3 — Actionable steps panel (above map) */}
      <ActionableStepsPanel onPathGenerated={handlePathGenerated} />

      {/* Mode toggle bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 16px',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        backgroundColor: 'rgba(0,0,0,0.4)',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 9, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.1em', marginRight: 4 }}>Mode</span>
        {([['explore', '🔭 Explore Mode'], ['goal', '🎯 Goal Mode']] as [CCMapMode, string][]).map(([m, label]) => (
          <button
            key={m}
            onClick={() => setMapMode(m)}
            style={{
              padding: '5px 16px',
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: '0.06em',
              border: 'none',
              cursor: 'pointer',
              backgroundColor: mapMode === m ? (m === 'goal' ? '#7c3aed' : '#10b981') : 'rgba(255,255,255,0.06)',
              color: mapMode === m ? '#fff' : '#6b7280',
              transition: 'all 0.2s',
              boxShadow: mapMode === m ? `0 0 14px ${m === 'goal' ? 'rgba(124,58,237,0.4)' : 'rgba(16,185,129,0.35)'}` : 'none',
            }}
          >
            {label}
          </button>
        ))}

        {mapMode === 'goal' && (
          <>
            <div style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.07)', marginLeft: 4 }} />
            <span style={{ fontSize: 10, color: '#6b7280' }}>
              {activeCount} active {activeCount === 1 ? 'path' : 'paths'}
              {activeCount >= 2 && <span style={{ color: '#7c3aed', marginLeft: 6, fontSize: 9 }}>◀ comparison panel →</span>}
            </span>
          </>
        )}

        {mapMode === 'goal' && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
            {profiles.filter((p) => p.active).slice(0, 5).map((p) => (
              <div
                key={p.id}
                title={p.name}
                onClick={() => {
                  setProfiles((prev) => prev.map((pp) => pp.id === p.id ? { ...pp, active: false } : pp))
                }}
                style={{
                  width: 10, height: 10, borderRadius: '50%',
                  backgroundColor: p.color,
                  cursor: 'pointer',
                  boxShadow: `0 0 6px ${p.color}88`,
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* B66: Scenario selector */}
      <ScenarioSelector
        scenario={activeScenario}
        autoScenario={autoScenario}
        manualOverride={manualScenario !== null}
        onSelect={handleScenarioSelect}
        onClearOverride={handleClearOverride}
      />

      {/* Map area + comparison sidebar */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Canvas area */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden', backgroundColor: '#020408' }}>

          {/* B66: Constellation background behind Three.js */}
          <ConstellationBackground scenario={activeScenario} />

          <CCNeuralMapCanvas
            mode={mapMode}
            profiles={profiles}
            scenario={activeScenario}
            onGoalNodeClick={handleGoalNodeClick}
          />

          {/* Goal node click panel */}
          {selectedGoalNode && (
            <GoalNodePanel
              node={selectedGoalNode}
              screenX={goalNodeX}
              screenY={goalNodeY}
              onClose={() => setSelectedGoalNode(null)}
              profiles={profiles}
            />
          )}

          {/* B66: Scenario label — top-left of map */}
          <div style={{
            position: 'absolute', top: 12, left: 14, zIndex: 20,
            pointerEvents: 'none',
          }}>
            <div style={{
              padding: '6px 12px',
              borderRadius: 7,
              border: `1px solid ${sc.borderColor}`,
              backgroundColor: sc.nodeColorHex + '14',
              backdropFilter: 'blur(4px)',
              display: 'flex', alignItems: 'center', gap: 7,
            }}>
              <span style={{ fontSize: 14 }}>{sc.emoji}</span>
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, color: sc.nodeColorHex, letterSpacing: '0.04em' }}>
                  {sc.label}
                </div>
                <div style={{ fontSize: 8, color: '#6b7280', letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: 1 }}>
                  {sc.description}
                </div>
              </div>
            </div>
          </div>

          {/* Goal mode legend overlay */}
          {mapMode === 'goal' && (
            <div style={{
              position: 'absolute', bottom: 14, left: 14, zIndex: 20,
              background: 'rgba(4,8,18,0.85)', border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: 8, padding: '10px 14px',
              backdropFilter: 'blur(4px)',
            }}>
              <div style={{ fontSize: 9, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 7 }}>Goal Mode</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
                <div style={{ width: 8, height: 8, borderRadius: 1, backgroundColor: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)' }} />
                <span style={{ fontSize: 9, color: '#6b7280' }}>Background state (40% dim)</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <div style={{ width: 8, height: 8, transform: 'rotate(45deg)', backgroundColor: '#7c3aed' }} />
                <span style={{ fontSize: 9, color: '#9ca3af' }}>Goal path nodes (foreground)</span>
              </div>
            </div>
          )}

          {/* Explore mode summary overlay */}
          {mapMode === 'explore' && (
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20,
              pointerEvents: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 24,
              padding: '8px 20px',
              background: 'linear-gradient(180deg,rgba(4,8,18,0.88) 0%,rgba(4,8,18,0) 100%)',
            }}>
              {[
                { icon: '⬡', label: 'Projects', color: '#00ff88' },
                { icon: '■', label: 'Agents', color: '#ca8a04' },
                { icon: '●', label: 'Data KPIs', color: '#06b6d4' },
                { icon: '⬡', label: 'RFI', color: '#ff9944' },
                { icon: '■', label: 'Service', color: '#38bdf8' },
                { icon: '◆', label: 'Cash Flow', color: '#34d399' },
              ].map((item) => (
                <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ fontSize: 11, color: item.color }}>{item.icon}</span>
                  <span style={{ fontSize: 9, fontWeight: 700, color: item.color, letterSpacing: '0.05em' }}>{item.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Feature 2 — Comparison sidebar (only in goal mode with 2+ active) */}
        {showComparison && (
          <ComparisonSidebar
            profiles={profiles}
            collapsed={comparisonCollapsed}
            onToggle={() => setComparisonCollapsed((c) => !c)}
          />
        )}
      </div>

      <style>{`
        @keyframes ccNmSlideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
      `}</style>
    </div>
  )
}
