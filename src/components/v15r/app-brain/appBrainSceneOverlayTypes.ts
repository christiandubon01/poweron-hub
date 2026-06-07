/**
 * App Brain 3D scene overlay types — visual hints from generated snapshot/seed data.
 */

export type AppBrainSceneOverlayMode = 'architecture' | 'import-graph' | 'active-work'

export type SceneOverlayRisk = 'minimal' | 'low' | 'medium' | 'high' | 'critical'

export type SceneOverlayStatus =
  | 'none'
  | 'idle'
  | 'planned'
  | 'running'
  | 'blocked'
  | 'ready-for-qa'
  | 'complete'
  | 'repass-needed'

export interface SceneOverlayNodeHint {
  nodeId: string
  intensity: number
  pulse: number
  ring: boolean
  risk: SceneOverlayRisk
  status: SceneOverlayStatus
  label?: string
  reason?: string
}

export interface SceneOverlayEdgeHint {
  from: string
  to: string
  intensity: number
  pulse: number
  risk: SceneOverlayRisk
  reason?: string
}

export interface SceneOverlaySummary {
  mode: AppBrainSceneOverlayMode
  generatedAt: string
  snapshotLabel: string
  highlightedNodeCount: number
  highlightedEdgeCount: number
  warningCount: number
}

export interface AppBrainSceneOverlay {
  mode: AppBrainSceneOverlayMode
  nodeHints: Record<string, SceneOverlayNodeHint>
  edgeHints: Record<string, SceneOverlayEdgeHint>
  summary: SceneOverlaySummary
}

export function edgeHintKey(from: string, to: string): string {
  return `${from}->${to}`
}
