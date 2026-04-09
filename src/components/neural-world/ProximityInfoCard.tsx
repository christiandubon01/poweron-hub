/**
 * ProximityInfoCard.tsx — NW-PROX: Domain Awareness HUD.
 *
 * Proximity-based info cards that appear when the camera approaches a domain
 * zone, project mountain, special entity, or subscription tower.
 * No clicks required — pure spatial awareness.
 *
 * Distance thresholds:
 *   Domain zones / special entities: activate < 18 units + looking toward (dot > 0.3)
 *                                    deactivate when > 22 units OR looking away
 *   Project mountains / subscription towers: activate + deactivate < 12 units
 *
 * Max 1 card visible at a time (closest qualifying entity wins).
 * Fade-in 0.5s, fade-out 0.3s, 0.2s gap when transitioning between entities.
 * Distance checks every 10 frames (~6×/second) for performance.
 * Toggled by the 'proximity-info' layer in CommandHUD.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import * as THREE from 'three'
import { useWorldContext } from './WorldContext'
import { DOMAIN_DEFS } from './layers/AgentFlightLayer'
import { getWorldData, seededPosition, type NWProject } from './DataBridge'
import type { DomainZoneConfig } from './DomainZone'

// ── Agent color map ────────────────────────────────────────────────────────────

const AGENT_COLORS: Record<string, string> = {
  SPARK:     '#FFE040',
  NEXUS:     '#FF44FF',
  VAULT:     '#FFD24A',
  BLUEPRINT: '#3A8EFF',
  OHM:       '#FF9040',
  ECHO:      '#4060CC',
  LEDGER:    '#2EE89A',
  SCOUT:     '#40D4FF',
  ATLAS:     '#40FF80',
  CHRONO:    '#FF8080',
  GUARDIAN:  '#FF4040',
}

// ── Special entity definitions ─────────────────────────────────────────────────

interface SpecialEntity {
  id: string
  name: string
  color: string
  worldX: number
  worldZ: number
  kind: 'fortress' | 'katsuro' | 'operator'
}

const SPECIAL_ENTITIES: SpecialEntity[] = [
  { id: 'operator',       name: 'OPERATOR',       color: '#FFD700', worldX:  0,  worldZ: 0,  kind: 'operator'  },
  { id: 'katsuro-bridge', name: 'KATSURO BRIDGE',  color: '#FF3030', worldX: 10,  worldZ: 0,  kind: 'katsuro'   },
  { id: 'fortress',       name: 'FORTRESS',        color: '#FF4040', worldX: 25,  worldZ: 0,  kind: 'fortress'  },
]

// ── Subscription tier definitions (approximate east continent centers) ──────────

interface TierEntity {
  id: string
  label: string
  price: number
  color: string
  worldX: number
  worldZ: number
}

const TIER_ENTITIES: TierEntity[] = [
  { id: 'tier-solo',       label: 'SOLO',       price: 49,  color: '#00ff88', worldX: 110, worldZ: -144 },
  { id: 'tier-growth',     label: 'GROWTH',     price: 129, color: '#0088ff', worldX: 110, worldZ: -72  },
  { id: 'tier-pro',        label: 'PRO',        price: 299, color: '#8800ff', worldX: 110, worldZ:  0   },
  { id: 'tier-proplus',    label: 'PRO+',       price: 499, color: '#ff8800', worldX: 110, worldZ:  72  },
  { id: 'tier-enterprise', label: 'ENTERPRISE', price: 800, color: '#4488ff', worldX: 110, worldZ:  144 },
]

// ── Content types ──────────────────────────────────────────────────────────────

interface HealthStatus {
  level: 'green' | 'amber' | 'red'
  reason: string
}

interface CardAgent {
  name: string
  color: string
  primary: boolean
}

interface CardContent {
  entityId: string
  line1Text: string
  line1Color: string
  line2Text: string
  line3Agents: CardAgent[]
  line4Text: string
  line5: HealthStatus
}

// ── Entity check union type ────────────────────────────────────────────────────

type EntityCheck =
  | { id: string; wx: number; wz: number; threshIn: number; threshStay: number; needDot: boolean; kind: 'domain'; ref: DomainZoneConfig }
  | { id: string; wx: number; wz: number; threshIn: number; threshStay: number; needDot: boolean; kind: 'special'; ref: SpecialEntity }
  | { id: string; wx: number; wz: number; threshIn: number; threshStay: number; needDot: boolean; kind: 'project'; ref: NWProject }
  | { id: string; wx: number; wz: number; threshIn: number; threshStay: number; needDot: boolean; kind: 'tower'; ref: TierEntity }

// ── Helpers ────────────────────────────────────────────────────────────────────

function hexToCSS(hex: number): string {
  return '#' + hex.toString(16).padStart(6, '0')
}

function fmtK(n: number): string {
  if (n >= 1000) return `$${Math.round(n / 1000)}k`
  return `$${Math.round(n)}`
}

function parseAgents(agentId: string): CardAgent[] {
  return agentId.split('+').map((name, i) => ({
    name: name.trim(),
    color: AGENT_COLORS[name.trim()] ?? '#ffffff',
    primary: i === 0,
  }))
}

// ── Content builders ────────────────────────────────────────────────────────────

function buildDomainContent(domainId: string, def: DomainZoneConfig): CardContent {
  const data = getWorldData()
  const { projects, invoices, rfis, fieldLogs, hubEvents, accountingSignals } = data

  // Domain label display map
  const labelMap: Record<string, string> = {
    'lead-acquisition':     'LEAD ACQUISITION',
    'closing':              'CLOSING',
    'project-installation': 'PROJECT INSTALL',
    'compliance':           'COMPLIANCE',
    'material-takeoff':     'MATERIAL TAKEOFF',
    'progress-tracking':    'SCHEDULING',
    'revenue':              'REVENUE',
    'analysis':             'OBSERVATORY',
    'memory':               'MEMORY',
    'geographic':           'GEOGRAPHIC',
  }
  const displayLabel = labelMap[domainId] ?? def.name.toUpperCase()
  const domainColor = hexToCSS(def.borderColor)

  // LINE 2: activity
  let line2 = 'Active and monitoring'
  switch (domainId) {
    case 'lead-acquisition': {
      const n = projects.filter(p => p.status === 'lead').length
      line2 = `${n} active lead${n !== 1 ? 's' : ''} in pipeline`
      break
    }
    case 'closing': {
      const n = projects.filter(p => p.status === 'estimate' || p.status === 'pending').length
      line2 = `${n} estimate${n !== 1 ? 's' : ''} pending`
      break
    }
    case 'project-installation': {
      const n = projects.filter(p => p.status === 'in_progress').length
      line2 = `${n} project${n !== 1 ? 's' : ''} in rough-in phase`
      break
    }
    case 'compliance': {
      const n = rfis.filter(r => r.status === 'open').length
      line2 = `${n} open RFI${n !== 1 ? 's' : ''} across projects`
      break
    }
    case 'material-takeoff': {
      const n = projects.filter(p => p.material_cost > 0).length
      const total = projects.reduce((s, p) => s + p.material_cost, 0)
      line2 = `${n} estimate${n !== 1 ? 's' : ''} this month, ${fmtK(total)} total`
      break
    }
    case 'progress-tracking': {
      const n = projects.filter(p => p.status === 'in_progress').length
      line2 = `${n} event${n !== 1 ? 's' : ''} this week`
      break
    }
    case 'revenue': {
      const pending = invoices.filter(i => i.status !== 'paid' && i.status !== 'cancelled')
      const outstanding = pending.reduce((s, i) => s + i.amount, 0)
      line2 = `${pending.length} invoice${pending.length !== 1 ? 's' : ''} pending, ${fmtK(outstanding)} outstanding`
      break
    }
    case 'analysis': {
      const n = hubEvents.filter(e => e.event_type === 'feature_launched').length
      line2 = `${n} improvement opportunit${n !== 1 ? 'ies' : 'y'} found`
      break
    }
    case 'memory': {
      const n = Math.min(fieldLogs.length, 999)
      line2 = `${n} context entr${n !== 1 ? 'ies' : 'y'} cached`
      break
    }
    case 'geographic': {
      const n = accountingSignals.serviceAreaCount
      line2 = `${n} service area${n !== 1 ? 's' : ''} mapped`
      break
    }
  }

  // LINE 3: agents
  const line3Agents = parseAgents(def.agentId)

  // LINE 4: crew
  const hasCrew = accountingSignals.activeCrewCount > 0
  const crewMap: Record<string, string> = {
    'project-installation': 'Lead Electrician, Apprentice',
    'compliance':           'Field Inspector',
    'revenue':              'Office Admin',
    'closing':              'Estimator',
    'material-takeoff':     'Estimator',
    'progress-tracking':    'Project Manager',
    'lead-acquisition':     'Sales Lead',
  }
  const line4 = hasCrew
    ? `Crew: ${crewMap[domainId] ?? 'Field Tech'}`
    : 'Crew: Owner (you)'

  // LINE 5: health
  let health: HealthStatus
  switch (domainId) {
    case 'revenue': {
      const arAmt = accountingSignals.arOver30Days.reduce((s, inv) => s + inv.amount, 0)
      if (arAmt < 500)  health = { level: 'green', reason: 'All invoices current' }
      else if (arAmt < 2000) health = { level: 'amber', reason: `${fmtK(arAmt)} overdue` }
      else health = { level: 'red', reason: `${fmtK(arAmt)} overdue — urgent` }
      break
    }
    case 'compliance': {
      const n = rfis.filter(r => r.status === 'open').length
      if (n === 0)    health = { level: 'green', reason: 'No open RFIs' }
      else if (n <= 3) health = { level: 'amber', reason: `${n} RFIs open` }
      else             health = { level: 'red', reason: `${n} RFIs critical` }
      break
    }
    case 'lead-acquisition': {
      const n = projects.filter(p => p.status === 'lead').length
      if (n > 2)      health = { level: 'green', reason: `${n} active leads` }
      else if (n === 1) health = { level: 'amber', reason: '1 lead in pipeline' }
      else              health = { level: 'red', reason: 'No leads in pipeline' }
      break
    }
    case 'project-installation':
    case 'progress-tracking': {
      const active = projects.filter(p => p.status === 'in_progress')
      const delayed = active.filter(p => p.health_score < 70).length
      if (delayed === 0) health = { level: 'green', reason: 'All projects on track' }
      else if (delayed === 1) health = { level: 'amber', reason: '1 project delayed' }
      else health = { level: 'red', reason: `${delayed} projects delayed` }
      break
    }
    case 'closing': {
      const n = projects.filter(p => p.status === 'estimate').length
      if (n > 0) health = { level: 'amber', reason: `${n} pending close` }
      else health = { level: 'green', reason: 'Pipeline clear' }
      break
    }
    default:
      health = { level: 'green', reason: 'Operating normally' }
  }

  return {
    entityId:    domainId,
    line1Text:   `◈ ${displayLabel}`,
    line1Color:  domainColor,
    line2Text:   line2,
    line3Agents,
    line4Text:   line4,
    line5:       health,
  }
}

function buildSpecialContent(entity: SpecialEntity): CardContent {
  const data = getWorldData()
  const { projects, invoices, fieldLogs, hubEvents, accountingSignals } = data

  switch (entity.kind) {
    case 'operator': {
      const active = projects.filter(p =>
        p.status === 'in_progress' || p.status === 'approved' || p.status === 'pending'
      ).length
      const pipeline = projects
        .filter(p => p.status !== 'completed' && p.status !== 'cancelled')
        .reduce((s, p) => s + p.contract_value, 0)
      return {
        entityId:    entity.id,
        line1Text:   '◈ OPERATOR',
        line1Color:  '#FFD700',
        line2Text:   `You. Managing ${active} active project${active !== 1 ? 's' : ''}, ${fmtK(pipeline)} pipeline`,
        line3Agents: [{ name: 'NEXUS', color: '#FF44FF', primary: true }],
        line4Text:   'Crew: Owner (you)',
        line5:       { level: 'green', reason: 'Command center active' },
      }
    }
    case 'fortress': {
      const joined   = hubEvents.filter(e => e.event_type === 'subscriber_joined').length
      const unsigned = Math.max(0, Math.ceil(projects.length * 0.25))
      const ipCount  = Math.max(1, Math.floor(projects.length * 0.4))
      const health: HealthStatus = unsigned > 3
        ? { level: 'red', reason: `${unsigned} unsigned NDAs` }
        : unsigned > 0
        ? { level: 'amber', reason: `${unsigned} NDAs pending` }
        : { level: 'green', reason: `${ipCount} IP filings secured` }
      return {
        entityId:    entity.id,
        line1Text:   '◈ FORTRESS',
        line1Color:  '#FF4040',
        line2Text:   `${joined} NDA signed, ${unsigned} unsigned`,
        line3Agents: [
          { name: 'GUARDIAN', color: '#FF4040', primary: true },
          { name: 'VAULT',    color: '#FFD24A', primary: false },
        ],
        line4Text:   'Crew: Owner (you)',
        line5:       health,
      }
    }
    case 'katsuro': {
      const domainCount = DOMAIN_DEFS.length
      const lastLog     = fieldLogs[0]
      const lastTime    = lastLog?.log_date
        ? new Date(lastLog.log_date).toLocaleDateString()
        : 'recently'
      return {
        entityId:    entity.id,
        line1Text:   '◈ KATSURO BRIDGE',
        line1Color:  '#FF3030',
        line2Text:   `Read access: ${domainCount} domains monitored`,
        line3Agents: [{ name: 'NEXUS', color: '#FF44FF', primary: true }],
        line4Text:   `Last handoff: ${lastTime}`,
        line5:       { level: 'green', reason: 'Bridge integrity 100%' },
      }
    }
  }
}

function buildProjectContent(project: NWProject): CardContent {
  const data = getWorldData()
  const { rfis, fieldLogs } = data

  // Stage label
  const stageMap: Record<string, string> = {
    lead:        'Lead',
    estimate:    'Estimating',
    pending:     'Planning',
    approved:    'Site Prep',
    in_progress: 'Rough-in',
    on_hold:     'On Hold',
    completed:   'Finish',
    cancelled:   'Cancelled',
  }
  const stageName  = stageMap[project.status] ?? project.status
  const pct        = Math.round(project.phase_completion ?? 0)

  // Deterministic material split from project ID
  let hash = 0
  for (let i = 0; i < project.id.length; i++) {
    hash = Math.imul(hash * 31 + project.id.charCodeAt(i), 1) >>> 0
  }
  const diamond = 30 + (hash % 40)
  const gold    = Math.round((100 - diamond) * 0.45)
  const ruby    = Math.round((100 - diamond) * 0.30)
  const obsidian = 100 - diamond - gold - ruby

  // Visiting agents from field logs
  const hasLogs = fieldLogs.some(fl => fl.project_id === project.id)
  const visitingAgents: CardAgent[] = hasLogs
    ? [
        { name: 'OHM',       color: '#FF9040', primary: true  },
        { name: 'BLUEPRINT', color: '#3A8EFF', primary: false },
      ]
    : [{ name: 'BLUEPRINT', color: '#3A8EFF', primary: true }]

  // Health from health_score
  const health: HealthStatus = project.health_score >= 70
    ? { level: 'green', reason: 'On schedule' }
    : project.health_score >= 40
    ? { level: 'amber', reason: 'Slight delays' }
    : { level: 'red',   reason: 'Behind schedule' }

  // Stage color (OPP stage colors)
  const stageColorMap: Record<string, string> = {
    'Lead':       '#FF6600',
    'Estimating': '#990000',
    'Planning':   '#FF0000',
    'Site Prep':  '#FF9900',
    'Rough-in':   '#93C47D',
    'Finish':     '#38761D',
    'On Hold':    '#999999',
  }
  const stageColor = stageColorMap[stageName] ?? '#00e5cc'

  return {
    entityId:    `project-${project.id}`,
    line1Text:   `⛰ ${project.name.toUpperCase()}`,
    line1Color:  stageColor,
    line2Text:   `Stage: ${stageName} (${pct}% complete)`,
    line3Agents: visitingAgents,
    line4Text:   `Diamond ${diamond}% · Gold ${gold}% · Ruby ${ruby}% · Obsidian ${obsidian}%`,
    line5:       health,
  }
}

function buildTowerContent(tier: TierEntity): CardContent {
  const data = getWorldData()
  const { accountingSignals, hubEvents } = data
  const subCount   = accountingSignals.hubSubscriberCount
  const churnLevel = subCount > 10 ? 'low' : subCount > 5 ? 'medium' : 'high'
  const lastEvent  = hubEvents.find(e => e.event_type === 'subscriber_joined')
  const daysAgo    = lastEvent?.created_at
    ? Math.floor((Date.now() - new Date(lastEvent.created_at).getTime()) / 86400000)
    : null
  const lastActive = daysAgo !== null ? `${daysAgo} days ago` : 'unknown'

  const health: HealthStatus = churnLevel === 'low'
    ? { level: 'green', reason: `Churn risk: low · Last active: ${lastActive}` }
    : churnLevel === 'medium'
    ? { level: 'amber', reason: `Churn risk: medium · Last active: ${lastActive}` }
    : { level: 'red',   reason: `Churn risk: high · Last active: ${lastActive}` }

  return {
    entityId:    tier.id,
    line1Text:   `◈ ${tier.label} TOWER`,
    line1Color:  tier.color,
    line2Text:   `${tier.label} · $${tier.price}/mo`,
    line3Agents: [{ name: 'SCOUT', color: '#40D4FF', primary: true }],
    line4Text:   `Materials: Gold 70% · Ruby 20% · Obsidian 10%`,
    line5:       health,
  }
}

function buildEntityContent(entity: EntityCheck): CardContent {
  switch (entity.kind) {
    case 'domain':  return buildDomainContent(entity.id, entity.ref)
    case 'special': return buildSpecialContent(entity.ref)
    case 'project': return buildProjectContent(entity.ref)
    case 'tower':   return buildTowerContent(entity.ref)
  }
}

// ── Main Component ─────────────────────────────────────────────────────────────

interface ProximityInfoCardProps {
  visible: boolean
}

interface CardState {
  content: CardContent | null
  showing: boolean
  screenX: number
  screenY: number
}

export function ProximityInfoCard({ visible }: ProximityInfoCardProps) {
  const { camera, renderer, playerPosition } = useWorldContext()

  const [card, setCard] = useState<CardState>({
    content: null,
    showing: false,
    screenX: 0,
    screenY: 0,
  })

  const frameRef           = useRef(0)
  const activeEntityIdRef  = useRef<string | null>(null)
  const transitionTimerRef = useRef<number | null>(null)
  const showingRef         = useRef(false)
  const visibleRef         = useRef(visible)

  useEffect(() => { visibleRef.current = visible }, [visible])

  // ── Core proximity check (called every 10th frame) ────────────────────────

  const checkProximity = useCallback(() => {
    const cam    = camera
    const camPos = cam.position
    const data   = getWorldData()
    const camFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion)

    const canvas = renderer.domElement
    const w = (canvas.clientWidth  || canvas.offsetWidth  || 800)
    const h = (canvas.clientHeight || canvas.offsetHeight || 600)

    // Build full entity list
    const entities: EntityCheck[] = [
      ...DOMAIN_DEFS.map(d => ({
        id: d.id, wx: d.worldX, wz: d.worldZ,
        threshIn: 18, threshStay: 22, needDot: true,
        kind: 'domain' as const, ref: d,
      })),
      ...SPECIAL_ENTITIES.map(e => ({
        id: e.id, wx: e.worldX, wz: e.worldZ,
        threshIn: 18, threshStay: 22, needDot: true,
        kind: 'special' as const, ref: e,
      })),
      ...data.projects.map(p => {
        const pp = seededPosition(p.id)
        return {
          id: `project-${p.id}`, wx: pp.x, wz: pp.z,
          threshIn: 12, threshStay: 12, needDot: false,
          kind: 'project' as const, ref: p,
        }
      }),
      ...TIER_ENTITIES.map(t => ({
        id: t.id, wx: t.worldX, wz: t.worldZ,
        threshIn: 12, threshStay: 12, needDot: false,
        kind: 'tower' as const, ref: t,
      })),
    ]

    const currentId = activeEntityIdRef.current

    // Helper: project world pos to screen
    function projectPos(wx: number, wz: number): { sx: number; sy: number; onScreen: boolean } {
      const v = new THREE.Vector3(wx, 0, wz).project(cam)
      const onScreen = v.z < 1 && Math.abs(v.x) < 1.0 && Math.abs(v.y) < 1.0
      return {
        sx: (v.x + 1) / 2 * w,
        sy: (-v.y + 1) / 2 * h,
        onScreen,
      }
    }

    // Scan: check current entity validity and find best new candidate
    let currentValid = false
    let currentSX = 0, currentSY = 0
    let bestCandidate: { entity: EntityCheck; dist: number; sx: number; sy: number } | null = null

    for (const entity of entities) {
      const entityPos = new THREE.Vector3(entity.wx, 0, entity.wz)
      const dist      = camPos.distanceTo(entityPos)
      const dir       = entityPos.clone().sub(camPos)
      if (dir.lengthSq() > 0) dir.normalize()
      const dot       = camFwd.dot(dir)
      const lookOk    = !entity.needDot || dot > 0.3

      const { sx, sy, onScreen } = projectPos(entity.wx, entity.wz)
      if (!onScreen) continue

      if (entity.id === currentId) {
        // Check hysteresis: current entity stays if within threshStay + looking OK
        if (dist < entity.threshStay && lookOk) {
          currentValid = true
          currentSX = sx
          currentSY = sy
        }
        continue
      }

      // Candidate for activation
      if (dist < entity.threshIn && lookOk) {
        if (!bestCandidate || dist < bestCandidate.dist) {
          bestCandidate = { entity, dist, sx, sy }
        }
      }
    }

    // ── Decision logic ───────────────────────────────────────────────────────

    if (currentValid) {
      if (!bestCandidate) {
        // Keep current, just update screen position
        setCard(prev => ({ ...prev, screenX: currentSX, screenY: currentSY }))
      } else {
        // A closer entity appeared — transition to it
        if (transitionTimerRef.current) {
          clearTimeout(transitionTimerRef.current)
          transitionTimerRef.current = null
        }
        showingRef.current = false
        setCard(prev => ({ ...prev, showing: false }))
        const { entity, sx, sy } = bestCandidate
        transitionTimerRef.current = window.setTimeout(() => {
          const content = buildEntityContent(entity)
          activeEntityIdRef.current = entity.id
          showingRef.current        = true
          setCard({ content, showing: true, screenX: sx, screenY: sy })
          transitionTimerRef.current = null
        }, 500) // 300ms fade-out + 200ms gap
      }
    } else if (bestCandidate) {
      // New entity in range, no current active one (or current just left)
      if (transitionTimerRef.current) {
        clearTimeout(transitionTimerRef.current)
        transitionTimerRef.current = null
      }
      const { entity, sx, sy } = bestCandidate

      if (currentId && showingRef.current) {
        // Was showing something — fade out, gap, fade in
        showingRef.current        = false
        activeEntityIdRef.current = null
        setCard(prev => ({ ...prev, showing: false }))
        transitionTimerRef.current = window.setTimeout(() => {
          const content = buildEntityContent(entity)
          activeEntityIdRef.current = entity.id
          showingRef.current        = true
          setCard({ content, showing: true, screenX: sx, screenY: sy })
          transitionTimerRef.current = null
        }, 500)
      } else {
        // Nothing was showing — fade in immediately
        const content = buildEntityContent(entity)
        activeEntityIdRef.current = entity.id
        showingRef.current        = true
        setCard({ content, showing: true, screenX: sx, screenY: sy })
      }
    } else if (!currentValid && currentId) {
      // Current entity left range, no replacement
      if (transitionTimerRef.current) {
        clearTimeout(transitionTimerRef.current)
        transitionTimerRef.current = null
      }
      showingRef.current        = false
      activeEntityIdRef.current = null
      setCard(prev => ({ ...prev, showing: false }))
    }
  }, [camera, renderer, playerPosition])

  // ── Subscribe to nw:frame (every 10 frames) ───────────────────────────────

  useEffect(() => {
    function onFrame() {
      frameRef.current++
      if (frameRef.current % 10 !== 0) return
      if (visibleRef.current) {
        checkProximity()
      } else if (showingRef.current) {
        // Layer toggled off — hide immediately
        showingRef.current        = false
        activeEntityIdRef.current = null
        setCard(prev => ({ ...prev, showing: false }))
      }
    }
    window.addEventListener('nw:frame', onFrame)
    return () => {
      window.removeEventListener('nw:frame', onFrame)
      if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current)
    }
  }, [checkProximity])

  // Fade out when layer toggled off
  useEffect(() => {
    if (!visible) {
      showingRef.current        = false
      activeEntityIdRef.current = null
      setCard(prev => ({ ...prev, showing: false }))
    }
  }, [visible])

  // ── Render ─────────────────────────────────────────────────────────────────

  const { content, showing, screenX, screenY } = card
  if (!content) return null

  const healthColor: string =
    content.line5.level === 'green'
      ? '#00ff88'
      : content.line5.level === 'amber'
      ? '#FF9040'
      : '#FF4040'

  const transitionTime = showing ? '0.5s' : '0.3s'
  const cardOffsetY    = showing ? 80 : 70

  // For project content, LINE 4 is the materials line (styled differently)
  const isProject = content.entityId.startsWith('project-')

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 22,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position:         'absolute',
          left:             screenX,
          top:              screenY,
          transform:        `translate(-50%, calc(-100% - ${cardOffsetY}px))`,
          opacity:          showing ? 1 : 0,
          transition:       `opacity ${transitionTime} ease, transform ${transitionTime} ease`,
          maxWidth:         280,
          padding:          '14px 16px',
          background:       'rgba(8,8,12,0.92)',
          border:           `1px solid ${content.line1Color}66`,
          borderRadius:     12,
          fontFamily:       'monospace',
          backdropFilter:   'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          boxShadow:        `0 4px 28px rgba(0,0,0,0.7), 0 0 24px ${content.line1Color}18`,
          pointerEvents:    'none',
          minWidth:         200,
          userSelect:       'none',
        }}
      >
        {/* LINE 1 — DOMAIN NAME */}
        <div style={{
          fontSize:     14,
          fontWeight:   700,
          color:        content.line1Color,
          letterSpacing: 1.5,
          marginBottom: 7,
          textShadow:   `0 0 10px ${content.line1Color}55`,
          whiteSpace:   'nowrap',
          overflow:     'hidden',
          textOverflow: 'ellipsis',
        }}>
          {content.line1Text}
        </div>

        {/* LINE 2 — CURRENT ACTIVITY */}
        <div style={{
          fontSize:     12,
          color:        'rgba(255,255,255,0.88)',
          letterSpacing: 0.3,
          marginBottom: 5,
          lineHeight:   1.45,
        }}>
          {content.line2Text}
        </div>

        {/* LINE 3 — ASSIGNED AGENTS */}
        {content.line3Agents.length > 0 && (
          <div style={{
            fontSize:     11,
            letterSpacing: 0.3,
            marginBottom: 5,
            display:      'flex',
            alignItems:   'center',
            gap:          4,
            flexWrap:     'wrap',
          }}>
            <span style={{ color: 'rgba(0,229,204,0.6)', marginRight: 1 }}>Agents:</span>
            {content.line3Agents.slice(0, 3).map((agent, i) => (
              <span key={agent.name} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <span style={{ color: agent.color, fontWeight: 700 }}>{agent.name}</span>
                {agent.primary && content.line3Agents.length > 1 && (
                  <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 9 }}>(primary)</span>
                )}
                {!agent.primary && (
                  <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 9 }}>(support)</span>
                )}
                {i < Math.min(content.line3Agents.length, 3) - 1 && (
                  <span style={{ color: 'rgba(255,255,255,0.25)' }}>,</span>
                )}
              </span>
            ))}
          </div>
        )}

        {/* LINE 4 — HUMAN ROLES / MATERIALS */}
        <div style={{
          fontSize:     11,
          color:        isProject ? 'rgba(255,255,255,0.55)' : '#FF9040',
          letterSpacing: 0.3,
          marginBottom: 6,
          lineHeight:   1.4,
        }}>
          {content.line4Text}
        </div>

        {/* LINE 5 — HEALTH STATUS */}
        <div style={{
          fontSize:    11,
          display:     'flex',
          alignItems:  'center',
          gap:         5,
          letterSpacing: 0.3,
        }}>
          <div style={{
            width:       6,
            height:      6,
            borderRadius: '50%',
            background:  healthColor,
            boxShadow:   `0 0 6px ${healthColor}`,
            flexShrink:  0,
          }} />
          <span style={{ color: healthColor, fontWeight: 700, fontSize: 10 }}>
            {content.line5.level === 'green'
              ? 'HEALTHY'
              : content.line5.level === 'amber'
              ? 'ATTENTION'
              : 'CRITICAL'}
          </span>
          <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: 10 }}>
            — {content.line5.reason}
          </span>
        </div>
      </div>
    </div>
  )
}

export default ProximityInfoCard
