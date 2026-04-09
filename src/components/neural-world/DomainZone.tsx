/**
 * DomainZone.ts — NW28: Domain zone platform utility.
 * B72: Labels converted to makeLabel (40% smaller, frustum culled, fade transitions).
 *
 * Creates a flat PlaneGeometry 20×20 domain zone with:
 * - Semi-transparent floor plane
 * - Glowing border (EdgesGeometry + LineSegments)
 * - Floating label sprite above the zone (NWLabel — frustum culled)
 * - Optional sub-zone indicator
 *
 * Returns an object with all created meshes + a dispose() function.
 */

import * as THREE from 'three'
import { makeLabel, disposeLabel, type NWLabel } from './utils/makeLabel'

export interface DomainZoneConfig {
  /** Unique domain identifier */
  id: string
  /** Display name (shown as floating label) */
  name: string
  /** Agent ID associated with this domain */
  agentId: string
  /** World-space X position */
  worldX: number
  /** World-space Z position */
  worldZ: number
  /** Border/glow color as 0xRRGGBB */
  borderColor: number
  /** Platform floor Y (default 0.05) */
  floorY?: number
}

export interface DomainZoneInstance {
  group: THREE.Group
  platform: THREE.Mesh
  borderLines: THREE.LineSegments
  /** NWLabel — call updateVisibility(camera, worldPos) every frame */
  labelSprite: NWLabel
  cubeDropGroup: THREE.Group
  dispose: () => void
}

// ── Color helper ───────────────────────────────────────────────────────────────

function hexToCSS(hex: number): string {
  return '#' + hex.toString(16).padStart(6, '0')
}

// ── Factory ────────────────────────────────────────────────────────────────────

export function createDomainZone(
  scene: THREE.Scene,
  cfg: DomainZoneConfig
): DomainZoneInstance {
  const floorY  = cfg.floorY ?? 0.05
  const group   = new THREE.Group()
  group.position.set(cfg.worldX, 0, cfg.worldZ)
  const colorStr = hexToCSS(cfg.borderColor)

  // ── Floor plane ───────────────────────────────────────────────────────────
  const planeGeo = new THREE.PlaneGeometry(20, 20)
  const planeMat = new THREE.MeshBasicMaterial({
    color: cfg.borderColor,
    transparent: true,
    opacity: 0.06,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  const platform = new THREE.Mesh(planeGeo, planeMat)
  platform.rotation.x = -Math.PI / 2
  platform.position.y = floorY
  group.add(platform)

  // ── Border glow ───────────────────────────────────────────────────────────
  const borderGeo  = new THREE.EdgesGeometry(new THREE.BoxGeometry(20, 0.1, 20))
  const borderMat  = new THREE.LineBasicMaterial({
    color: cfg.borderColor,
    transparent: true,
    opacity: 0.7,
  })
  const borderLines = new THREE.LineSegments(borderGeo, borderMat)
  borderLines.position.y = floorY + 0.05
  group.add(borderLines)

  // ── Floating domain label (B72: NWLabel, 'domain' type, frustum culled) ───
  // Domain labels: bold, max 1.2em equivalent (1.92 world units)
  const labelSprite = makeLabel(cfg.name, colorStr, { labelType: 'domain' })
  labelSprite.position.set(0, 8, 0)
  group.add(labelSprite)

  // ── Sub-label (agent ID) — smaller, agent type ────────────────────────────
  const subLabel = makeLabel(cfg.agentId, colorStr, { labelType: 'agent' })
  subLabel.position.set(0, 6, 0)
  group.add(subLabel)

  // ── Data cube drop group ──────────────────────────────────────────────────
  const cubeDropGroup = new THREE.Group()
  cubeDropGroup.position.y = floorY + 0.3
  group.add(cubeDropGroup)

  scene.add(group)

  // ── Dispose ───────────────────────────────────────────────────────────────
  function dispose() {
    scene.remove(group)
    planeGeo.dispose()
    planeMat.dispose()
    borderGeo.dispose()
    borderMat.dispose()
    disposeLabel(labelSprite)
    disposeLabel(subLabel)
  }

  return { group, platform, borderLines, labelSprite, cubeDropGroup, dispose }
}
