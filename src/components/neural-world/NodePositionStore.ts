/**
 * NodePositionStore.ts — NW24: Singleton store for draggable node position overrides.
 *
 * All layers read from this store to determine where to place (or re-place) their nodes.
 * DragDropSystem writes to this store when nodes are moved.
 * WorldEngine loads saved positions from Supabase into this store on mount.
 *
 * Event: 'nw:node-moved'  — dispatched when a single node is repositioned
 *   detail: { id: string, x: number, z: number }
 *
 * Event: 'nw:positions-reset' — dispatched when all positions are cleared
 */

export interface NodePos {
  x: number
  z: number
}

// Internal map: nodeId → overridden position
const _overrides: Record<string, NodePos> = {}

/**
 * Resolve node position. Returns override if one exists, otherwise defaults.
 */
export function getNodePosition(id: string, defaultX: number, defaultZ: number): NodePos {
  return _overrides[id] ?? { x: defaultX, z: defaultZ }
}

/**
 * Store a new override position and fire nw:node-moved event.
 */
export function setNodePosition(id: string, x: number, z: number): void {
  _overrides[id] = { x, z }
  window.dispatchEvent(
    new CustomEvent<{ id: string; x: number; z: number }>('nw:node-moved', {
      detail: { id, x, z },
    })
  )
}

/**
 * Returns a shallow copy of all current overrides (for persistence).
 */
export function getAllOverrides(): Record<string, NodePos> {
  return { ..._overrides }
}

/**
 * Applies a saved overrides map (from Supabase).  Does NOT fire events.
 */
export function applyOverrides(saved: Record<string, NodePos>): void {
  Object.assign(_overrides, saved)
}

/**
 * Clears all overrides and fires nw:positions-reset.
 */
export function resetAllPositions(): void {
  for (const key of Object.keys(_overrides)) {
    delete _overrides[key]
  }
  window.dispatchEvent(new CustomEvent('nw:positions-reset'))
}

/**
 * Check if a node has an override.
 */
export function hasOverride(id: string): boolean {
  return id in _overrides
}
