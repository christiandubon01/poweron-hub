/**
 * DomainZone.ts — NW28: Domain zone platform utility.
 *
 * Creates a flat PlaneGeometry 20×20 domain zone with:
 * - Semi-transparent floor plane
 * - Glowing border (EdgesGeometry + LineSegments)
 * - Floating label sprite above the zone
 * - Optional sub-zone indicator
 *
 * Returns an object with all created meshes + a dispose() function.
 */

import * as THREE from 'three'

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
  labelSprite: THREE.Sprite
  cubeDropGroup: THREE.Group
  dispose: () => void
}

// ── Text sprite ────────────────────────────────────────────────────────────────

function makeDomainLabel(text: string, color: string): THREE.Sprite {
  const fontSize = 22
  const padding  = 10
  const canvas   = document.createElement('canvas')
  const ctx      = canvas.getContext('2d')!
  ctx.font       = `bold ${fontSize}px monospace`
  const metrics  = ctx.measureText(text)
  const tw       = Math.max(256, Math.ceil(metrics.width) + padding * 2)
  const th       = fontSize + padding * 2
  canvas.width   = tw
  canvas.height  = th

  ctx.font        = `bold ${fontSize}px monospace`
  ctx.fillStyle   = 'rgba(5,5,12,0.85)'
  ctx.fillRect(0, 0, tw, th)
  ctx.strokeStyle = color + '88'
  ctx.lineWidth   = 1.5
  ctx.strokeRect(0.5, 0.5, tw - 1, th - 1)
  ctx.fillStyle   = color
  ctx.textBaseline = 'middle'
  ctx.fillText(text, padding, th / 2)

  const texture = new THREE.CanvasTexture(canvas)
  const mat     = new THREE.SpriteMaterial({
    map: texture,
    depthWrite: false,
    transparent: true,
    opacity: 0.9,
  })
  const sprite  = new THREE.Sprite(mat)
  sprite.scale.set((tw / th) * 5, 5, 1)
  return sprite
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
  const floorY = cfg.floorY ?? 0.05
  const group  = new THREE.Group()
  group.position.set(cfg.worldX, 0, cfg.worldZ)

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

  // ── Floating label ────────────────────────────────────────────────────────
  const colorStr    = hexToCSS(cfg.borderColor)
  const labelSprite = makeDomainLabel(cfg.name, colorStr)
  labelSprite.position.set(0, 8, 0)
  group.add(labelSprite)

  // ── Sub-label (agent ID) ──────────────────────────────────────────────────
  const subLabel = makeDomainLabel(cfg.agentId, colorStr)
  subLabel.scale.multiplyScalar(0.6)
  subLabel.position.set(0, 6, 0)
  subLabel.material.opacity = 0.55
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
    ;(labelSprite.material as THREE.SpriteMaterial).map?.dispose()
    ;(labelSprite.material as THREE.SpriteMaterial).dispose()
    ;(subLabel.material as THREE.SpriteMaterial).map?.dispose()
    ;(subLabel.material as THREE.SpriteMaterial).dispose()
  }

  return { group, platform, borderLines, labelSprite, cubeDropGroup, dispose }
}
