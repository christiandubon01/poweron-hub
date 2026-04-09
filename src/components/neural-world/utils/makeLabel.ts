/**
 * makeLabel.ts — NW31b shared text sprite factory.
 * B72: 40% smaller text, frustum culling with 25% pre-load buffer, fade transitions.
 *
 * Produces game-HUD-style labels that are:
 *   - Sized exactly to the text content (no 512px minimum width)
 *   - Themed with an accent color matching what the label represents
 *   - Frustum-culled using THREE.Frustum (camera.projectionMatrix × camera.matrixWorldInverse)
 *   - Pre-load buffered: frustum expanded 25% on all sides so labels load before entering view
 *   - Fade in 0.3s on frustum entry, fade out 0.2s on exit, then disposed (hidden)
 *   - Distance-faded (full opacity ≤30 units, invisible ≥80 units)
 *   - Fixed world size per label type (not giant from far away)
 *   - Max 40 simultaneous visible labels (global registry)
 *
 * Label types and world heights (B72 — base 1em = 1.6 units):
 *   'domain'  → 1.92 units (1.2em — VAULT, PULSE, LEDGER, etc.)
 *   'project' → 1.44 units (0.9em — project mountain labels, name only)
 *   'agent'   → 1.28 units (0.8em — agent name labels, name only unless hovered)
 *   default   → 1.92 units
 *
 * Usage:
 *   const sprite = makeLabel('SPARK', '#ff6600', { labelType: 'domain' })
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
  /**
   * Canvas font size in px (default 22 — B72: 40% reduced from original 36).
   * Controls texture sharpness; world size is determined by labelType.
   */
  fontSize?: number
  /** Y offset added to sprite.position.y — float above the node (default 0) */
  yOffset?: number
  /**
   * Label type controls 3D world height (B72):
   *   'domain'  → 1.92 units (1.2em — bold, VAULT/PULSE/LEDGER/CHRONO/BLUEPRINT)
   *   'project' → 1.44 units (0.9em — project mountain labels)
   *   'agent'   → 1.28 units (0.8em — agent name labels)
   *   default   → 1.92 units
   */
  labelType?: 'domain' | 'project' | 'agent'
}

/** THREE.Sprite with an attached per-frame visibility + fade updater. */
export interface NWLabel extends THREE.Sprite {
  /**
   * Call once per frame.
   * @param camera   Active perspective camera
   * @param worldPos World position of this sprite (use sprite.getWorldPosition())
   */
  updateVisibility(camera: THREE.PerspectiveCamera, worldPos: THREE.Vector3): void
}

// ── World heights per label type (B72: ~40% reduction from 3.2 base) ─────────

const WORLD_H_MAP: Partial<Record<NonNullable<LabelOptions['labelType']>, number>> = {
  domain:  1.92,  // 1.2em
  project: 1.44,  // 0.9em
  agent:   1.28,  // 0.8em
}
const WORLD_H_DEFAULT = 1.92  // same as 'domain' — max 1.2em per spec

// ── Global label registry (max 40 simultaneous visible labels) ────────────────

const _activeLabelSet  = new Set<THREE.Sprite>()
const MAX_VISIBLE_LABELS = 40

// ── Module-level temp objects (single-threaded JS — safe to share) ────────────

const _frustum    = new THREE.Frustum()
const _projScreen = new THREE.Matrix4()
const _tempProj   = new THREE.Matrix4()

// ── Constants (B72) ──────────────────────────────────────────────────────────

const BUFFER_FACTOR  = 0.25  // 25% frustum expansion for pre-load
const FADE_IN_DUR    = 0.3   // seconds — opacity 0 → 1
const FADE_OUT_DUR   = 0.2   // seconds — opacity 1 → 0

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
 * @param text     Text to display (e.g. 'SPARK', 'NDA GATE', 'NET +$4.2k')
 * @param color    Accent/text color as hex string (e.g. '#ff6600').
 *                 Used for both the text and the label border (at 30% opacity).
 * @param options  Optional overrides (fontSize, labelType, yOffset)
 */
export function makeLabel(
  text: string,
  color = '#ffffff',
  options?: LabelOptions
): NWLabel {
  // B72: default fontSize reduced from 36 to 22 (controls texture sharpness)
  const fontSize = options?.fontSize ?? 22
  const hPad     = 16   // horizontal padding px each side
  const vPad     = 12   // vertical padding px top/bottom
  const borderR  = 4    // border-radius equivalent on canvas

  // ── 1. Measure text to size canvas exactly to content ─────────────────────
  const canvas = document.createElement('canvas')
  const ctx    = canvas.getContext('2d')!
  ctx.font     = `bold ${fontSize}px sans-serif`
  const textW  = Math.ceil(ctx.measureText(text).width)
  const tw     = textW + hPad * 2
  const th     = fontSize + vPad * 2

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
    map:         texture,
    depthWrite:  false,
    transparent: true,
    opacity:     0.0,   // B72: start invisible, fade in on frustum entry
  })
  const sprite = new THREE.Sprite(mat)

  // B72: world height per label type (40% reduction from original 3.2)
  const worldH = WORLD_H_MAP[options?.labelType ?? 'default' as 'domain'] ?? WORLD_H_DEFAULT
  const worldW = (tw / th) * worldH
  sprite.scale.set(worldW, worldH, 1)
  sprite.visible = false  // hidden until frustum entry

  // ── 6. Per-label fade state (closed over in updateVisibility) ─────────────
  let opacity:   number              = 0.0
  let inFrustum: boolean             = false
  let fadeDir:   'in' | 'out' | 'none' = 'none'
  let lastTime:  number              = performance.now()

  ;(sprite as NWLabel).updateVisibility = function(
    camera: THREE.PerspectiveCamera,
    worldPos: THREE.Vector3
  ): void {
    const now = performance.now()
    const dt  = Math.min((now - lastTime) / 1000, 0.1)  // cap at 100ms
    lastTime  = now

    // ── Frustum check with 25% pre-load buffer ──────────────────────────────
    // Copy the camera projection matrix and widen it by BUFFER_FACTOR.
    // Dividing elements [0] (x-scale) and [5] (y-scale) by (1 + 0.25) = 1.25
    // is equivalent to increasing the half-FOV by 25%, expanding the visible
    // cone on all four sides before the label reaches screen edges.
    _tempProj.copy(camera.projectionMatrix)
    _tempProj.elements[0] /= (1 + BUFFER_FACTOR)  // widen left/right by 25%
    _tempProj.elements[5] /= (1 + BUFFER_FACTOR)  // widen top/bottom by 25%
    _projScreen.multiplyMatrices(_tempProj, camera.matrixWorldInverse)
    _frustum.setFromProjectionMatrix(_projScreen)
    const nowInFrustum = _frustum.containsPoint(worldPos)

    // ── Frustum state transitions ───────────────────────────────────────────
    if (nowInFrustum && !inFrustum) {
      // Entered (buffered) frustum — start fade in if slot available
      if (_activeLabelSet.size < MAX_VISIBLE_LABELS || _activeLabelSet.has(sprite)) {
        _activeLabelSet.add(sprite)
        fadeDir   = 'in'
        inFrustum = true
      }
      // else: slot full — label stays hidden until another label frees its slot
    } else if (!nowInFrustum && inFrustum) {
      // Left (buffered) frustum — start fade out
      fadeDir   = 'out'
      inFrustum = false
    }

    // ── Fade update ─────────────────────────────────────────────────────────
    if (fadeDir === 'in') {
      opacity = Math.min(1.0, opacity + dt / FADE_IN_DUR)
      if (opacity >= 1.0) fadeDir = 'none'
    } else if (fadeDir === 'out') {
      opacity = Math.max(0.0, opacity - dt / FADE_OUT_DUR)
      if (opacity <= 0.0) {
        // Fully faded out — dispose (hide) the label and free the registry slot
        _activeLabelSet.delete(sprite)
        sprite.visible = false
        return
      }
    }

    // ── Never entered frustum (or waiting for a registry slot) ─────────────
    if (opacity <= 0 && fadeDir === 'none') {
      sprite.visible = false
      return
    }

    // ── Distance cull: beyond 80 units → hide ──────────────────────────────
    const dist = camera.position.distanceTo(worldPos)
    if (dist > 80) {
      sprite.visible = false
      return
    }

    // ── Apply final opacity (distance fade: full ≤30 units, fade 30–80) ────
    sprite.visible = true
    const distFade = dist <= 30 ? 1.0 : Math.max(0, 1.0 - (dist - 30) / 50)
    mat.opacity    = opacity * distFade
  }

  return sprite as NWLabel
}

/**
 * Dispose a label sprite and free its canvas texture.
 * Automatically removes it from the global visibility registry.
 * Call before removing the sprite from the scene.
 */
export function disposeLabel(sprite: THREE.Sprite): void {
  _activeLabelSet.delete(sprite)
  const mat = sprite.material as THREE.SpriteMaterial
  if (mat?.map) mat.map.dispose()
  mat?.dispose()
}
