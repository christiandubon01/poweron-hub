/**
 * makeLabel.ts — NW31b shared text sprite factory.
 *
 * Replaces all local makeTextSprite helpers across Neural World layers.
 * Produces game-HUD-style labels that are:
 *   - Sized exactly to the text content (no 512px minimum width)
 *   - Themed with an accent color matching what the label represents
 *   - Frustum-culled (hidden when behind camera)
 *   - Distance-faded (full opacity ≤30 units, invisible ≥80 units)
 *   - Fixed world size (not giant from far away)
 *
 * Usage:
 *   const sprite = makeLabel('SPARK', '#ff6600')
 *   sprite.position.set(x, y + 1.5, z)
 *   scene.add(sprite)
 *
 *   // In frame handler:
 *   const wp = new THREE.Vector3()
 *   sprite.getWorldPosition(wp)
 *   ;(sprite as NWLabel).updateVisibility(camera, wp)
 */

import * as THREE from 'three'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface LabelOptions {
  /** Canvas font size in px (default 18) */
  fontSize?: number
  /** Y offset added to sprite.position.y — float above the node (default 0) */
  yOffset?: number
}

/** THREE.Sprite with an attached per-frame visibility updater. */
export interface NWLabel extends THREE.Sprite {
  /**
   * Call once per frame.
   * @param camera  Active perspective camera
   * @param worldPos  World position of this sprite (use sprite.getWorldPosition())
   */
  updateVisibility(camera: THREE.PerspectiveCamera, worldPos: THREE.Vector3): void
}

// ── Module-level temp vectors (single-threaded JS — safe to share) ────────────

const _tmpForward = new THREE.Vector3()
const _tmpDir     = new THREE.Vector3()

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Draw a rounded rectangle path on the canvas.
 * Caller must call ctx.fill() or ctx.stroke() after.
 */
function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number
): void {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.lineTo(x + w - rr, y)
  ctx.arcTo(x + w, y,     x + w, y + h, rr)
  ctx.lineTo(x + w, y + h - rr)
  ctx.arcTo(x + w, y + h, x,     y + h, rr)
  ctx.lineTo(x + rr, y + h)
  ctx.arcTo(x,     y + h, x,     y,     rr)
  ctx.lineTo(x, y + rr)
  ctx.arcTo(x,     y,     x + w, y,     rr)
  ctx.closePath()
}

/**
 * Convert a hex color string to rgba() with a given alpha.
 * Handles '#rgb', '#rrggbb'.
 */
function hexToRGBA(hex: string, alpha: number): string {
  let r = 255, g = 255, b = 255
  if (hex.startsWith('#')) {
    const h = hex.slice(1)
    if (h.length === 3) {
      r = parseInt(h[0] + h[0], 16)
      g = parseInt(h[1] + h[1], 16)
      b = parseInt(h[2] + h[2], 16)
    } else if (h.length === 6) {
      r = parseInt(h.slice(0, 2), 16)
      g = parseInt(h.slice(2, 4), 16)
      b = parseInt(h.slice(4, 6), 16)
    }
  }
  return `rgba(${r},${g},${b},${alpha.toFixed(2)})`
}

// ── Main factory ──────────────────────────────────────────────────────────────

/**
 * Create a game-HUD-style label sprite sized exactly to its text.
 *
 * @param text   Text to display (e.g. 'SPARK', 'NDA GATE', 'NET +$4.2k')
 * @param color  Accent/text color as hex string (e.g. '#ff6600').
 *               Used for both the text and the label border (at 30% opacity).
 * @param options  Optional overrides
 */
export function makeLabel(
  text: string,
  color = '#ffffff',
  options?: LabelOptions
): NWLabel {
  const fontSize   = options?.fontSize ?? 18
  const hPad       = 8    // horizontal padding px each side (spec: 8px)
  const vPad       = 6    // vertical padding px top/bottom (spec: 6px)
  const borderR    = 4    // border-radius equivalent on canvas

  // ── 1. Measure text to size canvas exactly to content ─────────────────────
  const canvas  = document.createElement('canvas')
  const ctx     = canvas.getContext('2d')!
  ctx.font      = `bold ${fontSize}px sans-serif`
  const textW   = Math.ceil(ctx.measureText(text).width)
  const tw      = textW + hPad * 2
  const th      = fontSize + vPad * 2

  canvas.width  = tw
  canvas.height = th

  // ── 2. Draw background — rounded rect, rgba(8,8,12,0.85) ─────────────────
  ctx.font      = `bold ${fontSize}px sans-serif`  // reset after canvas resize
  ctx.clearRect(0, 0, tw, th)

  ctx.fillStyle = 'rgba(8,8,12,0.85)'
  roundedRect(ctx, 0, 0, tw, th, borderR)
  ctx.fill()

  // ── 3. Draw border — 1px accent color at 30% opacity ─────────────────────
  ctx.strokeStyle = hexToRGBA(color, 0.3)
  ctx.lineWidth   = 1
  roundedRect(ctx, 0.5, 0.5, tw - 1, th - 1, borderR)
  ctx.stroke()

  // ── 4. Draw text ──────────────────────────────────────────────────────────
  ctx.fillStyle    = color
  ctx.textBaseline = 'middle'
  ctx.fillText(text, hPad, th / 2)

  // ── 5. Create THREE.Sprite ────────────────────────────────────────────────
  const texture = new THREE.CanvasTexture(canvas)
  const mat     = new THREE.SpriteMaterial({
    map:        texture,
    depthWrite: false,
    transparent: true,
    opacity:    1.0,
  })
  const sprite  = new THREE.Sprite(mat)

  // Fixed world height of 1.6 units; width proportional to canvas aspect.
  // This prevents giant labels — close = readable, far = faded out.
  const worldH = 1.6
  const worldW = (tw / th) * worldH
  sprite.scale.set(worldW, worldH, 1)

  // ── 6. Attach per-frame visibility updater ────────────────────────────────
  ;(sprite as NWLabel).updateVisibility = function(
    camera: THREE.PerspectiveCamera,
    worldPos: THREE.Vector3
  ): void {
    // Direction from camera to node
    _tmpDir.subVectors(worldPos, camera.position)
    const dist = _tmpDir.length()

    // Camera forward vector
    camera.getWorldDirection(_tmpForward)

    // Dot product: negative means behind camera
    const dot = _tmpDir.normalize().dot(_tmpForward)
    if (dot < 0) {
      sprite.visible = false
      return
    }

    // Distance cull: beyond 80 units → invisible
    if (dist > 80) {
      sprite.visible = false
      return
    }

    sprite.visible = true

    // Distance fade: full opacity ≤30 units, fade to 0 between 30–80
    if (dist <= 30) {
      mat.opacity = 1.0
    } else {
      mat.opacity = Math.max(0, 1.0 - (dist - 30) / 50)
    }
  }

  return sprite as NWLabel
}

/**
 * Dispose a label sprite and free its canvas texture.
 * Call before removing the sprite from the scene.
 */
export function disposeLabel(sprite: THREE.Sprite): void {
  const mat = sprite.material as THREE.SpriteMaterial
  if (mat?.map) {
    mat.map.dispose()
  }
  mat?.dispose()
}
