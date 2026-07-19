/** Persisted Package Circuit Animation scene definitions. */

export type BlueprintAnimationDeviceRole =
  | 'source'
  | 'control'
  | 'sensor'
  | 'junction'
  | 'load'
  | 'emergency-source'
  | 'emergency-driver'
  | 'transfer-device'

export type BlueprintAnimationChannelType =
  | 'switched-line-voltage'
  | 'constant-line-voltage'
  | 'zero-to-ten-volt-control'
  | 'low-voltage-control-signal'
  | 'emergency-power'
  | 'generic-route'

export type BlueprintAnimationBranchMode = 'sequential' | 'simultaneous'
export type BlueprintAnimationDirection = 'forward' | 'reverse'
export type BlueprintAnimationSourceMode = 'sequential' | 'simultaneous'

export type BlueprintAnimationNodeAnchor =
  | {
      kind: 'annotation-center'
      annotationId: string
    }
  | {
      kind: 'circuit-point'
      annotationId: string
      pointId: string
      pointIndexHint?: number
      geometryFingerprint: string
    }
  | {
      kind: 'virtual-point'
      pageNumber: number
      x: number
      y: number
    }

export type BlueprintAnimationGeometryRef =
  | {
      kind: 'circuit-segment'
      annotationId: string
      segmentId: string
      segmentIndexHint?: number
      fromT: number
      toT: number
      geometryFingerprint: string
    }
  | {
      kind: 'direct'
    }

export interface BlueprintAnimationNode {
  id: string
  roles: BlueprintAnimationDeviceRole[]
  anchor: BlueprintAnimationNodeAnchor
  label?: string
}

export interface BlueprintAnimationEdge {
  id: string
  fromNodeId: string
  toNodeId: string
  channel: BlueprintAnimationChannelType
  geometry: BlueprintAnimationGeometryRef
  fromPort?: string
  toPort?: string
}

export interface BlueprintAnimationSource {
  id: string
  nodeId: string
  channel?: BlueprintAnimationChannelType
  priority?: number
}

export interface BlueprintAnimationTraversalStep {
  id: string
  edgeId: string
  sourceId?: string
  direction?: BlueprintAnimationDirection
}

export interface BlueprintAnimationBranchOrder {
  id: string
  nodeId: string
  mode: BlueprintAnimationBranchMode
  outgoingEdgeIds: string[]
}

export type BlueprintAnimationEventType =
  | 'activate-node'
  | 'deactivate-node'
  | 'send-control-signal'
  | 'transfer-emergency-power'

export interface BlueprintAnimationEventDefinition {
  id: string
  type: BlueprintAnimationEventType
  nodeId?: string
  edgeId?: string
  delayMs?: number
}

export interface BlueprintAnimationPlaybackOptions {
  travelSpeed: number
  nodePauseMs: number
  fixtureFadeMs: number
  deviceReactionMs: number
  dimmedCircuitOpacity: number
  branchMode: BlueprintAnimationBranchMode
  sourceMode: BlueprintAnimationSourceMode
  direction: BlueprintAnimationDirection
  loop: boolean
  holdActivatedNodes: boolean
  reducedMotion: boolean
}

export interface BlueprintScopeAnimationSceneV1 {
  schemaVersion: 1
  id: string
  revision: number
  createdAt: string
  updatedAt: string
  nodes: BlueprintAnimationNode[]
  edges: BlueprintAnimationEdge[]
  sources: BlueprintAnimationSource[]
  manualTraversal: BlueprintAnimationTraversalStep[]
  branchOrders: BlueprintAnimationBranchOrder[]
  events: BlueprintAnimationEventDefinition[]
  playbackOptions: BlueprintAnimationPlaybackOptions
}

/** Raw future scenes remain persisted but are not editable or playable by schema-v1 code. */
export interface BlueprintScopeUnsupportedAnimationScene {
  schemaVersion: number
  [key: string]: unknown
}

export type BlueprintScopeAnimationScene =
  | BlueprintScopeAnimationSceneV1
  | BlueprintScopeUnsupportedAnimationScene

/** Runtime-resolved graph. It is derived from the persisted scene and never stored. */
export interface BlueprintAnimationResolvedGraph {
  sceneId: string
  revision: number
  nodes: Array<BlueprintAnimationNode & { pageNumber: number; x: number; y: number }>
  edges: Array<BlueprintAnimationEdge & { length: number }>
}

/** Ephemeral playback state. No field in this structure belongs in a persisted package. */
export interface BlueprintAnimationPlaybackState {
  status: 'idle' | 'playing' | 'paused' | 'complete' | 'cancelled'
  activeSourceIds: string[]
  activeNodeIds: string[]
  currentTraversalStepId?: string
  progress: number
}
