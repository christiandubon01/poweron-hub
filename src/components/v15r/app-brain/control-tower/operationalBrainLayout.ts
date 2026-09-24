import type { AppBrainNode, AppBrainNodeCategory } from '../../appBrainMap'

/**
 * ATB-6E shell (accepted) + ATB-6F label scale (accepted) + ATB-6G depth (accepted)
 * + ATB-6H neural composition.
 * Semantic edges stay in APP_BRAIN_EDGES / APP_BRAIN_NODES.connections.
 * Positions are a locked asymmetric cloud around App Brain. No runtime physics.
 */
export type LabelWeight = 'primary' | 'normal' | 'quiet'

export const OPERATIONAL_NODE_LAYOUT: Record<string, [number, number, number]> = {
  'app-brain': [0.2, 0.1, 0.22],
  'app-shell': [-0.42, 0.82, 0.68],
  'v15r-layout': [-0.72, -0.42, 0.16],
  'admin-tools': [1.38, 1.08, -0.44],
  'ai-nexus': [2.35, 1.74, 0.55],
  projects: [-2.68, 0.55, -0.2],
  'field-log': [-1.55, -1.88, 0.78],
  blueprint: [0.95, -0.92, 0.46],
  'material-takeoff': [2.72, -0.48, 0.28],
  'shared-systems': [-2.18, 1.72, -0.76],
  'data-persistence': [1.62, -1.58, -0.88],
}

/** Small label shifts so the cloud does not stack captions. Screen scale stays ATB-6F. */
export const OPERATIONAL_LABEL_NUDGE: Record<string, [number, number]> = {
  'app-brain': [0.06, 0.04],
  'app-shell': [-0.04, 0.1],
  'v15r-layout': [-0.12, 0.02],
  'admin-tools': [0.08, 0.08],
  'ai-nexus': [0.1, 0.08],
  projects: [-0.14, 0.04],
  'field-log': [-0.06, -0.08],
  blueprint: [-0.02, 0.1],
  'material-takeoff': [0.12, 0.02],
  'shared-systems': [-0.1, 0.08],
  'data-persistence': [-0.34, 0.16],
}

export const OPERATIONAL_CAMERA_POSITION: [number, number, number] = [0.96, 0.34, 7.2]
export const OPERATIONAL_CAMERA_LOOK_AT: [number, number, number] = [0.08, 0.04, 0.05]
export const OPERATIONAL_CAMERA_Z = OPERATIONAL_CAMERA_POSITION[2]
export const OPERATIONAL_CAMERA_FOV = 48

/**
 * ATB-6F screen-constant sprite size. ATB-6G keeps these bounds and applies
 * distance-aware world scale with a tight apparent-size clamp.
 */
export const OPERATIONAL_LABEL_SCALE: [number, number] = [0.42, 0.105]
export const OPERATIONAL_LABEL_WEIGHT_SCALE: Record<LabelWeight, number> = {
  primary: 1.12,
  normal: 1,
  quiet: 0.93,
}
export const OPERATIONAL_LABEL_REFERENCE_DISTANCE = 6.7
export const OPERATIONAL_LABEL_APPARENT_MIN = 0.86
export const OPERATIONAL_LABEL_APPARENT_MAX = 1.14
export const OPERATIONAL_NODE_SCALE_CAP = 1.42
/** App Brain ring only. The node sphere stays the same size. */
export const OPERATIONAL_HUB_RING_SCALE = 1.18

export function labelWeightFor(category: AppBrainNodeCategory): LabelWeight {
  if (category === 'shell' || category === 'shared' || category === 'core') return 'primary'
  if (category === 'data') return 'quiet'
  return 'normal'
}

export function operationalLabelScale(weight: LabelWeight = 'normal'): [number, number] {
  const factor = OPERATIONAL_LABEL_WEIGHT_SCALE[weight]
  return [OPERATIONAL_LABEL_SCALE[0] * factor, OPERATIONAL_LABEL_SCALE[1] * factor]
}

export function operationalZExtent(layout: Record<string, [number, number, number]> = OPERATIONAL_NODE_LAYOUT): { min: number; max: number; span: number } {
  const zs = Object.values(layout).map((position) => position[2])
  const min = Math.min(...zs)
  const max = Math.max(...zs)
  return { min, max, span: max - min }
}

export function operationalDepthT(z: number): number {
  const { min, max, span } = operationalZExtent()
  if (span <= 0) return 0.5
  return Math.min(1, Math.max(0, (z - min) / (max - min)))
}

/** Rear ~0.91, front ~1.07. Keeps ATB-6F label bounds. */
export function operationalDepthCue(z: number): number {
  return 0.91 + operationalDepthT(z) * 0.16
}

/** Foreground nodes read slightly larger; rear nodes stay smaller. */
export function operationalNodeDepthScale(z: number): number {
  return 0.94 + operationalDepthT(z) * 0.12
}

/**
 * World-space sprite size for sizeAttenuation ON.
 * Apparent screen size stays near the ATB-6F bounds, with a small depth cue.
 */
export function operationalLabelWorldScale(weight: LabelWeight, distance: number, nodeZ: number): [number, number] {
  const [baseW, baseH] = operationalLabelScale(weight)
  const cue = operationalDepthCue(nodeZ)
  const travel = Math.min(OPERATIONAL_LABEL_APPARENT_MAX, Math.max(OPERATIONAL_LABEL_APPARENT_MIN, cue))
  const safeDistance = Math.max(4.2, distance)
  return [baseW * travel * safeDistance, baseH * travel * safeDistance]
}

export function operationalLabelNudge(nodeId: string): [number, number] {
  return OPERATIONAL_LABEL_NUDGE[nodeId] ?? [0, 0]
}

export function operationalCentroid(layout: Record<string, [number, number, number]> = OPERATIONAL_NODE_LAYOUT): [number, number, number] {
  const positions = Object.values(layout)
  const count = positions.length || 1
  return [
    positions.reduce((sum, position) => sum + position[0], 0) / count,
    positions.reduce((sum, position) => sum + position[1], 0) / count,
    positions.reduce((sum, position) => sum + position[2], 0) / count,
  ]
}

/** Existing edge.strength only. Quiet links stay softer; primary links read a little clearer. */
export function operationalEdgeOpacity(strength: number): number {
  const clamped = Math.min(1, Math.max(0, strength))
  return 0.12 + clamped * 0.2
}

function edgeSalt(fromId: string, toId: string): number {
  let hash = 2166136261
  const key = `${fromId}>${toId}`
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/**
 * Quadratic control for one semantic edge. Stronger links stay closer to the
 * chord. Bow side and depth arc are deterministic per edge, not a shared tree bend.
 */
export function operationalEdgeControl(
  fromId: string,
  toId: string,
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  strength: number,
): [number, number, number] {
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  const dz = to[2] - from[2]
  const length = Math.hypot(dx, dy, dz) || 1
  const salt = edgeSalt(fromId, toId)
  const side = (salt & 1) === 0 ? 1 : -1
  const tilt = ((salt >>> 3) % 7) / 6
  const quiet = 1 - Math.min(1, Math.max(0, strength))
  const bow = (0.09 + quiet * 0.2) * Math.min(1, length / 3.1)
  const px = -dy / length
  const py = dx / length
  return [
    (from[0] + to[0]) / 2 + px * bow * side,
    (from[1] + to[1]) / 2 + py * bow * side * 0.7,
    (from[2] + to[2]) / 2 + side * (0.045 + quiet * 0.07) * (0.4 + tilt),
  ]
}

export function operationalEdgeSamples(
  from: readonly [number, number, number],
  control: readonly [number, number, number],
  to: readonly [number, number, number],
  segments = 8,
): Array<[number, number, number]> {
  const points: Array<[number, number, number]> = []
  const steps = Math.max(1, segments)
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps
    const inv = 1 - t
    points.push([
      inv * inv * from[0] + 2 * inv * t * control[0] + t * t * to[0],
      inv * inv * from[1] + 2 * inv * t * control[1] + t * t * to[1],
      inv * inv * from[2] + 2 * inv * t * control[2] + t * t * to[2],
    ])
  }
  return points
}

export function operationalNodePosition(node: AppBrainNode, operational: boolean): [number, number, number] {
  if (operational) return OPERATIONAL_NODE_LAYOUT[node.id] ?? node.position
  return node.position
}
