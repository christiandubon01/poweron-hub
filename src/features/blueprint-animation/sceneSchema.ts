import type {
  BlueprintAnimationPlaybackOptions,
  BlueprintScopeAnimationScene,
  BlueprintScopeAnimationSceneV1,
} from './types'

export const BLUEPRINT_ANIMATION_SCENE_SCHEMA_VERSION = 1 as const

export const DEFAULT_BLUEPRINT_ANIMATION_PLAYBACK_OPTIONS: BlueprintAnimationPlaybackOptions = {
  travelSpeed: 0.35,
  nodePauseMs: 150,
  fixtureFadeMs: 300,
  deviceReactionMs: 120,
  dimmedCircuitOpacity: 0.45,
  branchMode: 'simultaneous',
  sourceMode: 'simultaneous',
  direction: 'forward',
  loop: false,
  holdActivatedNodes: true,
  reducedMotion: false,
}

export type BlueprintAnimationSceneParseResult =
  | { status: 'absent'; scene: undefined }
  | { status: 'supported'; scene: BlueprintScopeAnimationSceneV1 }
  | { status: 'unsupported-version'; scene: BlueprintScopeAnimationScene; schemaVersion: number }
  | { status: 'malformed'; scene: undefined; reason: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value)) as T
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function finiteNumber(value: unknown, fallback: number): number {
  if (value == null) return fallback
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function sanitizePlaybackOptions(raw: unknown): BlueprintAnimationPlaybackOptions {
  const value = isRecord(raw) ? raw : {}
  return {
    // Defaults fill absent/non-numeric fields. Finite out-of-range values remain intact so
    // graph validation can report them instead of the parser silently repairing user data.
    travelSpeed: finiteNumber(value.travelSpeed, DEFAULT_BLUEPRINT_ANIMATION_PLAYBACK_OPTIONS.travelSpeed),
    nodePauseMs: finiteNumber(value.nodePauseMs, DEFAULT_BLUEPRINT_ANIMATION_PLAYBACK_OPTIONS.nodePauseMs),
    fixtureFadeMs: finiteNumber(value.fixtureFadeMs, DEFAULT_BLUEPRINT_ANIMATION_PLAYBACK_OPTIONS.fixtureFadeMs),
    deviceReactionMs: finiteNumber(value.deviceReactionMs, DEFAULT_BLUEPRINT_ANIMATION_PLAYBACK_OPTIONS.deviceReactionMs),
    dimmedCircuitOpacity: finiteNumber(value.dimmedCircuitOpacity, DEFAULT_BLUEPRINT_ANIMATION_PLAYBACK_OPTIONS.dimmedCircuitOpacity),
    branchMode: value.branchMode === 'sequential' ? 'sequential' : 'simultaneous',
    sourceMode: value.sourceMode === 'sequential' ? 'sequential' : 'simultaneous',
    direction: value.direction === 'reverse' ? 'reverse' : 'forward',
    loop: value.loop === true,
    holdActivatedNodes: value.holdActivatedNodes !== false,
    reducedMotion: value.reducedMotion === true,
  }
}

function sanitizeObjectArray(raw: unknown): Array<Record<string, unknown>> {
  return Array.isArray(raw) ? raw.filter(isRecord).map(cloneValue) : []
}

export function createDefaultBlueprintAnimationScene(options: {
  id?: string
  now?: string
} = {}): BlueprintScopeAnimationSceneV1 {
  const now = options.now ?? new Date().toISOString()
  const id = options.id ?? `animation_scene_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  return {
    schemaVersion: BLUEPRINT_ANIMATION_SCENE_SCHEMA_VERSION,
    id,
    revision: 1,
    createdAt: now,
    updatedAt: now,
    nodes: [],
    edges: [],
    sources: [],
    manualTraversal: [],
    branchOrders: [],
    events: [],
    playbackOptions: { ...DEFAULT_BLUEPRINT_ANIMATION_PLAYBACK_OPTIONS },
  }
}

export function parseBlueprintAnimationScene(raw: unknown): BlueprintAnimationSceneParseResult {
  if (raw == null) return { status: 'absent', scene: undefined }
  if (!isRecord(raw)) return { status: 'malformed', scene: undefined, reason: 'Scene must be an object.' }

  const schemaVersion = Number(raw.schemaVersion)
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1) {
    return { status: 'malformed', scene: undefined, reason: 'Scene schemaVersion must be a positive integer.' }
  }
  if (schemaVersion !== BLUEPRINT_ANIMATION_SCENE_SCHEMA_VERSION) {
    const scene = cloneValue(raw) as BlueprintScopeAnimationScene
    return { status: 'unsupported-version', scene, schemaVersion }
  }

  const now = new Date().toISOString()
  const id = stringValue(raw.id).trim()
  if (!id) return { status: 'malformed', scene: undefined, reason: 'Scene id is required.' }
  const revision = Math.max(1, Math.floor(finiteNumber(raw.revision, 1)))
  const scene: BlueprintScopeAnimationSceneV1 = {
    ...cloneValue(raw),
    schemaVersion: BLUEPRINT_ANIMATION_SCENE_SCHEMA_VERSION,
    id,
    revision,
    createdAt: stringValue(raw.createdAt, now),
    updatedAt: stringValue(raw.updatedAt, stringValue(raw.createdAt, now)),
    nodes: sanitizeObjectArray(raw.nodes) as unknown as BlueprintScopeAnimationSceneV1['nodes'],
    edges: sanitizeObjectArray(raw.edges) as unknown as BlueprintScopeAnimationSceneV1['edges'],
    sources: sanitizeObjectArray(raw.sources) as unknown as BlueprintScopeAnimationSceneV1['sources'],
    manualTraversal: sanitizeObjectArray(raw.manualTraversal) as unknown as BlueprintScopeAnimationSceneV1['manualTraversal'],
    branchOrders: sanitizeObjectArray(raw.branchOrders) as unknown as BlueprintScopeAnimationSceneV1['branchOrders'],
    events: sanitizeObjectArray(raw.events) as unknown as BlueprintScopeAnimationSceneV1['events'],
    playbackOptions: sanitizePlaybackOptions(raw.playbackOptions),
  }
  return { status: 'supported', scene }
}

export function sanitizeBlueprintAnimationSceneForStorage(raw: unknown): BlueprintScopeAnimationScene | undefined {
  const result = parseBlueprintAnimationScene(raw)
  return result.status === 'supported' || result.status === 'unsupported-version' ? result.scene : undefined
}

export function isSupportedBlueprintAnimationScene(
  scene: BlueprintScopeAnimationScene | undefined,
): scene is BlueprintScopeAnimationSceneV1 {
  return scene?.schemaVersion === BLUEPRINT_ANIMATION_SCENE_SCHEMA_VERSION
}
