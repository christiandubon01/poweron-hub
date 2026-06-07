/**
 * Pure adapter: Wave 03 models + generated manifests → 3D scene overlay hints.
 */

import { GENERATED_APP_BRAIN_MANIFEST } from '../generatedAppBrainManifest'
import { GENERATED_APP_BRAIN_WORK_MANIFEST } from '../generatedAppBrainWorkManifest'
import { APP_BRAIN_EDGES, APP_BRAIN_NODE_OVERLAY_KEYS, APP_BRAIN_NODES } from '../appBrainMap'
import { APP_BRAIN_ACTIVE_SESSIONS } from './appBrainSeedData'
import { createImportGraphOverlay } from './appBrainImportGraphOverlay'
import {
  buildActiveWorkAnimationSnapshot,
  createAgentSessionVisualState,
  deriveDomainPulseState,
  deriveOverlapWarningAnimation,
} from './appBrainActiveWorkAnimationModel'
import type { AgentType, AnimationState } from './appBrainActiveWorkAnimationTypes'
import type { AgentModel, LiveWorkSession } from './appBrainWorkTypes'
import type {
  AppBrainSceneOverlay,
  AppBrainSceneOverlayMode,
  SceneOverlayEdgeHint,
  SceneOverlayNodeHint,
  SceneOverlayRisk,
  SceneOverlayStatus,
} from './appBrainSceneOverlayTypes'
import { edgeHintKey } from './appBrainSceneOverlayTypes'

const OVERLAY_CACHE = new Map<AppBrainSceneOverlayMode, AppBrainSceneOverlay>()

const AGENT_TYPES: AgentType[] = ['Claude', 'Codex', 'Cursor', 'Haiku', 'Manual/Owner']

const RISK_FROM_GRAPH: Record<string, SceneOverlayRisk> = {
  critical: 'critical',
  high: 'high',
  medium: 'medium',
  low: 'low',
  minimal: 'minimal',
}

const ANIMATION_TO_STATUS: Record<AnimationState, SceneOverlayStatus> = {
  idle: 'idle',
  planned: 'planned',
  running: 'running',
  blocked: 'blocked',
  'ready-for-qa': 'ready-for-qa',
  complete: 'complete',
  'repass-needed': 'repass-needed',
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function mapPathToNodeId(filePath: string): string | null {
  const path = filePath.toLowerCase()
  if (path.includes('app-brain') || path.includes('appbrain')) return 'app-brain'
  if (path.includes('field-log') || path.includes('fieldlog')) return 'field-log'
  if (path.includes('blueprint')) return 'blueprint'
  if (path.includes('mto') || path.includes('material-takeoff') || path.includes('material')) return 'material-takeoff'
  if (path.includes('project')) return 'projects'
  if (path.includes('nexus') || path.includes('neural') || path.includes('visual-suite') || path.includes('aivisual')) {
    return 'ai-nexus'
  }
  if (path.includes('admin') || path.includes('orb-lab')) return 'admin-tools'
  if (path.includes('backup') || path.includes('supabase') || path.includes('persist')) return 'data-persistence'
  if (path.includes('/store/') || path.includes('/services/') || path.includes('/utils/')) return 'shared-systems'
  if (path.includes('v15r') || path.includes('layout')) return 'v15r-layout'
  if (path.includes('appshell') || path.includes('app-shell')) return 'app-shell'
  return null
}

function resolveNodeForDomain(domain: string): string | null {
  for (const node of APP_BRAIN_NODES) {
    const keys = APP_BRAIN_NODE_OVERLAY_KEYS[node.id] ?? []
    if (keys.includes(domain)) return node.id
  }
  return mapPathToNodeId(domain)
}

function upsertNodeHint(
  hints: Record<string, SceneOverlayNodeHint>,
  nodeId: string,
  partial: Partial<SceneOverlayNodeHint> & Pick<SceneOverlayNodeHint, 'reason'>,
): void {
  const existing = hints[nodeId]
  const nextIntensity = Math.max(existing?.intensity ?? 0, partial.intensity ?? 0)
  const nextPulse = Math.max(existing?.pulse ?? 0, partial.pulse ?? 0)
  hints[nodeId] = {
    nodeId,
    intensity: nextIntensity,
    pulse: nextPulse,
    ring: existing?.ring || partial.ring || false,
    risk: pickHigherRisk(existing?.risk ?? 'minimal', partial.risk ?? 'minimal'),
    status: pickHigherStatus(existing?.status ?? 'none', partial.status ?? 'none'),
    label: partial.label ?? existing?.label,
    reason: partial.reason ?? existing?.reason,
  }
}

function pickHigherRisk(a: SceneOverlayRisk, b: SceneOverlayRisk): SceneOverlayRisk {
  const order: SceneOverlayRisk[] = ['minimal', 'low', 'medium', 'high', 'critical']
  return order.indexOf(a) >= order.indexOf(b) ? a : b
}

function pickHigherStatus(a: SceneOverlayStatus, b: SceneOverlayStatus): SceneOverlayStatus {
  const priority: SceneOverlayStatus[] = [
    'none',
    'idle',
    'complete',
    'planned',
    'ready-for-qa',
    'running',
    'repass-needed',
    'blocked',
  ]
  return priority.indexOf(a) >= priority.indexOf(b) ? a : b
}

function mapSessionStatus(status: LiveWorkSession['status']): AnimationState {
  switch (status) {
    case 'active':
      return 'running'
    case 'pending':
      return 'planned'
    case 'blocked':
      return 'blocked'
    case 'completed':
      return 'complete'
    case 'failed':
      return 'repass-needed'
    default:
      return 'idle'
  }
}

function toAgentType(agent: AgentModel): AgentType {
  if (agent === 'Claude' || agent === 'Codex' || agent === 'Cursor' || agent === 'Haiku') return agent
  return 'Manual/Owner'
}

function buildActiveWorkSnapshot() {
  const sessions = Object.values(APP_BRAIN_ACTIVE_SESSIONS.sessions)
  const agentSessions = {} as Record<AgentType, ReturnType<typeof createAgentSessionVisualState>>

  for (const agentType of AGENT_TYPES) {
    const match = sessions.find((s) => toAgentType(s.agent) === agentType)
    if (match) {
      agentSessions[agentType] = createAgentSessionVisualState(
        agentType,
        mapSessionStatus(match.status),
        match.sessionId,
        match.domain,
        {
          fileCount: match.touchedFiles.length,
          typecheckPass: match.typecheckResult === 'pass',
          buildPass: match.status !== 'failed',
        },
      )
    } else {
      agentSessions[agentType] = createAgentSessionVisualState(agentType, 'idle')
    }
  }

  const domainMap = new Map<string, { active: number; blocked: number; agents: AgentType[] }>()
  for (const session of sessions) {
    const entry = domainMap.get(session.domain) ?? { active: 0, blocked: 0, agents: [] }
    if (session.status === 'active' || session.status === 'pending') entry.active += 1
    if (session.status === 'blocked') entry.blocked += 1
    const agentType = toAgentType(session.agent)
    if (!entry.agents.includes(agentType)) entry.agents.push(agentType)
    domainMap.set(session.domain, entry)
  }

  const domainPulses = Object.fromEntries(
    Array.from(domainMap.entries()).map(([domainId, stats]) => [
      domainId,
      deriveDomainPulseState(domainId, domainId, stats.active, stats.blocked, {}, stats.agents),
    ]),
  )

  const overlapWarnings = [
    deriveOverlapWarningAnimation(
      'scene-overlap-app-brain',
      'Haiku',
      'Cursor',
      'domain',
      ['src/components/v15r/app-brain/**'],
      true,
    ),
  ]

  return buildActiveWorkAnimationSnapshot(agentSessions, domainPulses, overlapWarnings)
}

export const DEFAULT_ARCHITECTURE_SCENE_OVERLAY: AppBrainSceneOverlay = {
  mode: 'architecture',
  nodeHints: {},
  edgeHints: {},
  summary: {
    mode: 'architecture',
    generatedAt: new Date(0).toISOString(),
    snapshotLabel: 'Architecture map (default)',
    highlightedNodeCount: 0,
    highlightedEdgeCount: 0,
    warningCount: 0,
  },
}

export function buildArchitectureSceneOverlay(): AppBrainSceneOverlay {
  return {
    mode: 'architecture',
    nodeHints: {},
    edgeHints: {},
    summary: {
      mode: 'architecture',
      generatedAt: new Date(0).toISOString(),
      snapshotLabel: 'Architecture map (default)',
      highlightedNodeCount: 0,
      highlightedEdgeCount: 0,
      warningCount: 0,
    },
  }
}

export function buildImportGraphSceneOverlay(): AppBrainSceneOverlay {
  const overlay = createImportGraphOverlay([...GENERATED_APP_BRAIN_MANIFEST.files], { useDomainMapping: true })
  const nodeHints: Record<string, SceneOverlayNodeHint> = {}
  const edgeHints: Record<string, SceneOverlayEdgeHint> = {}
  let warningCount = 0

  const nodeScores = new Map<string, number>()

  for (const file of overlay.highTouchFiles) {
    const nodeId = mapPathToNodeId(file.filePath)
    if (!nodeId) continue
    const score = clamp01(file.score / 20)
    nodeScores.set(nodeId, Math.max(nodeScores.get(nodeId) ?? 0, score))
    upsertNodeHint(nodeHints, nodeId, {
      intensity: 0.35 + score * 0.55,
      pulse: 0.4 + score * 0.45,
      ring: score > 0.5,
      risk: score > 0.7 ? 'high' : score > 0.45 ? 'medium' : 'low',
      status: 'none',
      label: file.reason,
      reason: file.recommendation,
    })
  }

  for (const [domain, files] of Object.entries(overlay.summary.filesByDomain)) {
    const nodeId = resolveNodeForDomain(domain) ?? mapPathToNodeId(domain)
    if (!nodeId || files.length < 3) continue
    const intensity = clamp01(files.length / 40)
    upsertNodeHint(nodeHints, nodeId, {
      intensity: 0.25 + intensity * 0.4,
      pulse: 0.3 + intensity * 0.35,
      ring: files.length > 12,
      risk: intensity > 0.6 ? 'medium' : 'low',
      status: 'none',
      label: domain,
      reason: `${files.length} mapped files in ${domain}`,
    })
  }

  if (overlay.risk.overallRiskScore > 0.4) {
    warningCount += 1
    upsertNodeHint(nodeHints, 'shared-systems', {
      intensity: 0.55,
      pulse: 0.5,
      ring: true,
      risk: RISK_FROM_GRAPH[overlay.risk.overallRiskScore > 0.6 ? 'high' : 'medium'] ?? 'medium',
      status: 'none',
      reason: 'Import graph risk elevated — review shared coupling',
    })
  }

  for (const edge of APP_BRAIN_EDGES) {
    const fromScore = nodeScores.get(edge.from) ?? 0
    const toScore = nodeScores.get(edge.to) ?? 0
    const intensity = clamp01((fromScore + toScore) / 2 + edge.strength * 0.15)
    if (intensity < 0.2) continue
    edgeHints[edgeHintKey(edge.from, edge.to)] = {
      from: edge.from,
      to: edge.to,
      intensity,
      pulse: 0.35 + intensity * 0.5,
      risk: intensity > 0.55 ? 'medium' : 'low',
      reason: 'High-touch import relationship',
    }
  }

  return {
    mode: 'import-graph',
    nodeHints,
    edgeHints,
    summary: {
      mode: 'import-graph',
      generatedAt: overlay.generatedAt,
      snapshotLabel: `Import graph · ${overlay.summary.totalFiles} files · manifest ${GENERATED_APP_BRAIN_MANIFEST.generatedAt.slice(0, 10)}`,
      highlightedNodeCount: Object.keys(nodeHints).length,
      highlightedEdgeCount: Object.keys(edgeHints).length,
      warningCount: warningCount + overlay.risk.recommendations.length,
    },
  }
}

export function buildActiveWorkSceneOverlay(): AppBrainSceneOverlay {
  const snapshot = buildActiveWorkSnapshot()
  const nodeHints: Record<string, SceneOverlayNodeHint> = {}
  const edgeHints: Record<string, SceneOverlayEdgeHint> = {}

  for (const session of Object.values(snapshot.agentSessions)) {
    const nodeId = resolveNodeForDomain(session.domain ?? '') ?? 'app-brain'
    const status = ANIMATION_TO_STATUS[session.animationState]
    const isWarning = session.warning && session.warning !== 'none'
    const intensity =
      session.animationState === 'running'
        ? 0.85
        : session.animationState === 'blocked' || session.animationState === 'repass-needed'
          ? 0.75
          : session.animationState === 'ready-for-qa'
            ? 0.65
            : session.animationState === 'planned'
              ? 0.45
              : 0.2

    upsertNodeHint(nodeHints, nodeId, {
      intensity,
      pulse: session.animationState === 'running' ? 0.9 : isWarning ? 0.7 : 0.4,
      ring: isWarning || session.animationState === 'blocked',
      risk: session.animationState === 'blocked' ? 'high' : isWarning ? 'medium' : 'low',
      status,
      label: session.agent,
      reason: session.domain ? `${session.agent} · ${session.domain}` : session.agent,
    })
  }

  for (const [domainId, pulse] of Object.entries(snapshot.domainPulses)) {
    const nodeId = resolveNodeForDomain(domainId)
    if (!nodeId) continue
    upsertNodeHint(nodeHints, nodeId, {
      intensity: pulse.health === 'critical' ? 0.8 : pulse.health === 'warning' ? 0.6 : 0.35,
      pulse: pulse.activeSessions > 0 ? 0.55 + pulse.activeSessions * 0.08 : 0.25,
      ring: pulse.blockedSessions > 0,
      risk: pulse.health === 'critical' ? 'critical' : pulse.health === 'warning' ? 'medium' : 'low',
      status: pulse.blockedSessions > 0 ? 'blocked' : pulse.activeSessions > 0 ? 'running' : 'planned',
      label: pulse.domainLabel,
      reason: `${pulse.activeSessions} active · ${pulse.blockedSessions} blocked`,
    })
  }

  for (const warning of snapshot.overlapWarnings.filter((w) => !w.resolved)) {
    upsertNodeHint(nodeHints, 'app-brain', {
      intensity: 0.9,
      pulse: 0.95,
      ring: true,
      risk: warning.severity === 'high' ? 'critical' : 'high',
      status: 'blocked',
      label: 'Overlap',
      reason: `${warning.agentA} ↔ ${warning.agentB} · ${warning.overlapType}`,
    })
    upsertNodeHint(nodeHints, 'shared-systems', {
      intensity: 0.5,
      pulse: 0.6,
      ring: true,
      risk: 'medium',
      status: 'ready-for-qa',
      reason: 'Coordination boundary overlap hint',
    })
  }

  if (snapshot.summary.blockedCount > 0) {
    edgeHints[edgeHintKey('app-brain', 'shared-systems')] = {
      from: 'app-brain',
      to: 'shared-systems',
      intensity: 0.7,
      pulse: 0.8,
      risk: 'high',
      reason: 'Blocked session coordination path',
    }
  }

  const workLabel = GENERATED_APP_BRAIN_WORK_MANIFEST.generatedAt.slice(0, 10)

  return {
    mode: 'active-work',
    nodeHints,
    edgeHints,
    summary: {
      mode: 'active-work',
      generatedAt: GENERATED_APP_BRAIN_WORK_MANIFEST.generatedAt,
      snapshotLabel: `Active work seed · work manifest ${workLabel}`,
      highlightedNodeCount: Object.keys(nodeHints).length,
      highlightedEdgeCount: Object.keys(edgeHints).length,
      warningCount: snapshot.summary.warningCount,
    },
  }
}

export function buildSceneOverlay(mode: AppBrainSceneOverlayMode): AppBrainSceneOverlay {
  const cached = OVERLAY_CACHE.get(mode)
  if (cached) return cached

  let overlay: AppBrainSceneOverlay
  switch (mode) {
    case 'import-graph':
      overlay = buildImportGraphSceneOverlay()
      break
    case 'active-work':
      overlay = buildActiveWorkSceneOverlay()
      break
    case 'architecture':
    default:
      overlay = DEFAULT_ARCHITECTURE_SCENE_OVERLAY
      break
  }

  OVERLAY_CACHE.set(mode, overlay)
  return overlay
}
