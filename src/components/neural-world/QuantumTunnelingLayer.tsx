/**
 * QuantumTunnelingLayer.tsx — NW70: Quantum Tunneling — instant teleport between related nodes.
 *
 * Detects node pairs with strong business relationships but large physical distance.
 *
 * Relationship types:
 *   gold    = same client_id  (client relationship)
 *   amber   = shared crew member (field_log crew overlap)
 *   teal    = material dependency (project type / name overlap)
 *   green   = revenue chain (sequential billing / invoice chain)
 *
 * Portal rings (TorusGeometry) hover above each connected node, pulse in sync.
 * A thin dotted connector line (10% opacity) links each portal pair.
 * Max 10 tunnel pairs shown at once (ranked by relationship strength).
 *
 * Click a ring → camera executes a 0.8-second "tunnel" animation:
 *   1. Zoom into the clicked ring (0.3 s)
 *   2. Warp flash overlay (0.15 s peak, 0.15 s fade) — CSS radial gradient + star streaks
 *   3. Emerge at the paired node (0.2 s camera settle)
 *
 * Toggle: dispatches / listens for 'nw:tunnels-toggle' CustomEvent.
 *
 * Export: named export  QuantumTunnelingLayer
 */

import { useEffect, useRef, useCallback } from 'react'
import * as THREE from 'three'
import { useWorldContext } from './WorldContext'
import {
  subscribeWorldData,
  seededPosition,
  type NWProject,
  type NWFieldLog,
  type NWWorldData,
} from './DataBridge'

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_TUNNEL_PAIRS   = 10
const MIN_DISTANCE_SQ    = 30 * 30   // pairs must be >30 units apart to qualify
const RING_Y_OFFSET      = 8         // rings hover this many units above the node base
const RING_RADIUS        = 3.2       // outer torus radius (world units)
const RING_TUBE          = 0.28      // torus tube radius
const RING_RADIAL_SEG    = 16
const RING_TUBE_SEG      = 64
const LINE_OPACITY       = 0.10      // dotted connector line opacity
const PULSE_SPEED        = 1.4       // radians/second for ring pulse cycle

// Tunnel animation timing (seconds)
const ANIM_ZOOM_IN_DUR   = 0.30
const ANIM_WARP_DUR      = 0.30
const ANIM_EMERGE_DUR    = 0.20
const ANIM_TOTAL_DUR     = ANIM_ZOOM_IN_DUR + ANIM_WARP_DUR + ANIM_EMERGE_DUR  // 0.80 s

// Ring colors per relationship type
const COLORS = {
  client:   0xffd700,   // gold
  crew:     0xffaa00,   // amber
  material: 0x00ccaa,   // teal
  revenue:  0x44ff88,   // green
} as const

type RelType = keyof typeof COLORS

// ── Types ─────────────────────────────────────────────────────────────────────

interface TunnelPair {
  id: string
  aId: string
  bId: string
  aPos: THREE.Vector3
  bPos: THREE.Vector3
  relType: RelType
  strength: number   // 0–1, used for sorting / opacity scaling
}

interface PortalRing {
  mesh: THREE.Mesh
  light: THREE.PointLight
  pairId: string
  nodeId: string
  pairedNodeId: string
  pairedPos: THREE.Vector3
  phase: number   // random phase offset for pulse desync between pairs
}

interface AnimState {
  active: boolean
  phase: 'zoom_in' | 'warp' | 'emerge'
  elapsed: number
  originPos: THREE.Vector3
  targetPos: THREE.Vector3
  zoomAnchor: THREE.Vector3   // world-pos of clicked ring (zoom toward it)
  lookAnchor: THREE.Vector3   // look target during emerge
}

// ── Warp overlay (DOM) ────────────────────────────────────────────────────────

let _warpEl: HTMLDivElement | null = null

function getWarpEl(): HTMLDivElement {
  if (!_warpEl) {
    const el = document.createElement('div')
    el.id = 'nw70-warp-overlay'
    el.style.cssText = [
      'position:fixed',
      'inset:0',
      'pointer-events:none',
      'z-index:9999',
      'opacity:0',
      'background:radial-gradient(ellipse at center,rgba(200,240,255,0.95) 0%,rgba(80,160,255,0.6) 30%,rgba(0,20,80,0.9) 70%,rgba(0,0,0,1) 100%)',
      'transition:none',
    ].join(';')

    // Star streaks layer inside overlay
    const streaks = document.createElement('canvas')
    streaks.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;'
    el.appendChild(streaks)

    document.body.appendChild(el)
    _warpEl = el
  }
  return _warpEl
}

function _drawStreaks(canvas: HTMLCanvasElement, intensity: number) {
  const w = canvas.width  = canvas.offsetWidth  || window.innerWidth
  const h = canvas.height = canvas.offsetHeight || window.innerHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, w, h)
  const cx = w / 2, cy = h / 2
  const count = Math.floor(intensity * 80)
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.1
    const len   = (0.25 + Math.random() * 0.5) * (Math.min(w, h) / 2) * intensity
    const x1    = cx + Math.cos(angle) * 10
    const y1    = cy + Math.sin(angle) * 10
    const x2    = cx + Math.cos(angle) * len
    const y2    = cy + Math.sin(angle) * len
    ctx.strokeStyle = `rgba(180,230,255,${0.4 + intensity * 0.5})`
    ctx.lineWidth   = 0.5 + Math.random() * 1.2
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
  }
}

function playWarpOverlay(onMidpoint: () => void) {
  const el     = getWarpEl()
  const canvas = el.querySelector('canvas') as HTMLCanvasElement
  const start  = performance.now()
  const halfMs = (ANIM_WARP_DUR / 2) * 1000
  const totalMs = ANIM_WARP_DUR * 1000
  let midFired  = false

  function tick(now: number) {
    const t   = Math.min((now - start) / totalMs, 1)
    // Rise 0→0.5, then fall 0.5→1  (bell curve)
    const intensity = t < 0.5 ? t * 2 : (1 - t) * 2
    el.style.opacity = String(intensity)
    _drawStreaks(canvas, intensity)
    if (!midFired && (now - start) >= halfMs) {
      midFired = true
      onMidpoint()
    }
    if (t < 1) {
      requestAnimationFrame(tick)
    } else {
      el.style.opacity = '0'
    }
  }
  requestAnimationFrame(tick)
}

// ── Geometry helpers ──────────────────────────────────────────────────────────

function disposeObj(scene: THREE.Scene, obj: THREE.Object3D | null): void {
  if (!obj) return
  scene.remove(obj)
  obj.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    const mat = mesh.material
    if (mat) {
      if (Array.isArray(mat)) mat.forEach(m => m.dispose())
      else (mat as THREE.Material).dispose()
    }
  })
}

function buildRingMesh(relType: RelType, phase: number): THREE.Mesh {
  const geo = new THREE.TorusGeometry(RING_RADIUS, RING_TUBE, RING_RADIAL_SEG, RING_TUBE_SEG)
  const mat = new THREE.MeshStandardMaterial({
    color:      COLORS[relType],
    emissive:   new THREE.Color(COLORS[relType]).multiplyScalar(0.6),
    roughness:  0.15,
    metalness:  0.8,
    transparent: true,
    opacity:    0.88,
    depthWrite: false,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.userData.phase = phase
  return mesh
}

function buildConnectorLine(aPos: THREE.Vector3, bPos: THREE.Vector3): THREE.LineSegments {
  // Dashed line: sample ~40 dash segments between the two ring positions
  const segments = 40
  const positions: number[] = []
  for (let i = 0; i < segments; i++) {
    // Draw every other segment (creates dashed appearance)
    if (i % 2 === 0) {
      const t0 = i / segments
      const t1 = (i + 0.5) / segments
      const p0 = aPos.clone().lerp(bPos, t0)
      const p1 = aPos.clone().lerp(bPos, t1)
      positions.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  const mat = new THREE.LineBasicMaterial({
    color:       0xaaddff,
    transparent: true,
    opacity:     LINE_OPACITY,
    depthWrite:  false,
  })
  return new THREE.LineSegments(geo, mat)
}

// ── Relationship discovery ────────────────────────────────────────────────────

function _projectNodePos(id: string): THREE.Vector3 {
  const { x, z } = seededPosition(id)
  return new THREE.Vector3(x, RING_Y_OFFSET, z)
}

function _distSq(a: THREE.Vector3, b: THREE.Vector3): number {
  const dx = a.x - b.x, dz = a.z - b.z
  return dx * dx + dz * dz
}

function _hashPair(aId: string, bId: string): string {
  return aId < bId ? `${aId}::${bId}` : `${bId}::${aId}`
}

function discoverTunnelPairs(
  projects: NWProject[],
  fieldLogs: NWFieldLog[],
): TunnelPair[] {
  const active = projects.filter(p =>
    p.status === 'in_progress' || p.status === 'approved' ||
    p.status === 'pending'    || p.status === 'completed'
  )

  if (active.length < 2) return []

  const seen = new Set<string>()
  const pairs: TunnelPair[] = []

  // Build project positions once
  const posMap = new Map<string, THREE.Vector3>()
  for (const p of active) posMap.set(p.id, _projectNodePos(p.id))

  // ── 1. SAME CLIENT — gold ────────────────────────────────────────────────
  const clientMap = new Map<string, NWProject[]>()
  for (const p of active) {
    const key = p.client_id ?? `name_${p.name.split(' ')[0].toLowerCase()}`
    const arr = clientMap.get(key) ?? []
    arr.push(p)
    clientMap.set(key, arr)
  }
  for (const [, group] of clientMap) {
    if (group.length < 2) continue
    for (let i = 0; i < group.length - 1; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i], b = group[j]
        const aPos = posMap.get(a.id)!, bPos = posMap.get(b.id)!
        if (_distSq(aPos, bPos) < MIN_DISTANCE_SQ) continue
        const hash = _hashPair(a.id, b.id)
        if (seen.has(hash)) continue
        seen.add(hash)
        pairs.push({
          id: hash, aId: a.id, bId: b.id,
          aPos: aPos.clone(), bPos: bPos.clone(),
          relType: 'client',
          strength: 0.9 + Math.min(0.1, group.length * 0.01),
        })
      }
    }
  }

  // ── 2. SHARED CREW — amber ───────────────────────────────────────────────
  // Build crew→projects map from field_logs
  const crewProjectMap = new Map<string, Set<string>>()
  for (const fl of fieldLogs) {
    if (!fl.crew_id || !fl.project_id) continue
    const set = crewProjectMap.get(fl.crew_id) ?? new Set<string>()
    set.add(fl.project_id)
    crewProjectMap.set(fl.crew_id, set)
  }
  for (const [, projSet] of crewProjectMap) {
    const ids = [...projSet].filter(pid => posMap.has(pid))
    if (ids.length < 2) continue
    for (let i = 0; i < ids.length - 1; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const aId = ids[i], bId = ids[j]
        const aPos = posMap.get(aId)!, bPos = posMap.get(bId)!
        if (_distSq(aPos, bPos) < MIN_DISTANCE_SQ) continue
        const hash = _hashPair(aId, bId)
        if (seen.has(hash)) continue
        seen.add(hash)
        pairs.push({
          id: hash, aId, bId,
          aPos: aPos.clone(), bPos: bPos.clone(),
          relType: 'crew',
          strength: 0.75,
        })
      }
    }
  }

  // ── 3. MATERIAL DEPENDENCY — teal ───────────────────────────────────────
  // Projects sharing the same type tag or keywords in name (solar, panel, service, etc.)
  const TYPE_KEYWORDS = ['solar', 'pv', 'panel', 'service', 'remodel', 'commercial', 'residential']
  const typeGroupMap = new Map<string, NWProject[]>()
  for (const p of active) {
    const raw = (p.type ?? p.name).toLowerCase()
    for (const kw of TYPE_KEYWORDS) {
      if (raw.includes(kw)) {
        const arr = typeGroupMap.get(kw) ?? []
        arr.push(p)
        typeGroupMap.set(kw, arr)
        break
      }
    }
  }
  for (const [, group] of typeGroupMap) {
    if (group.length < 2) continue
    // Only link the two highest-value projects per type group
    const sorted = [...group].sort((a, b) => b.contract_value - a.contract_value).slice(0, 4)
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i], b = sorted[i + 1]
      const aPos = posMap.get(a.id)!, bPos = posMap.get(b.id)!
      if (_distSq(aPos, bPos) < MIN_DISTANCE_SQ) continue
      const hash = _hashPair(a.id, b.id)
      if (seen.has(hash)) continue
      seen.add(hash)
      pairs.push({
        id: hash, aId: a.id, bId: b.id,
        aPos: aPos.clone(), bPos: bPos.clone(),
        relType: 'material',
        strength: 0.65 + (a.contract_value + b.contract_value) / 2000000,
      })
    }
  }

  // ── 4. REVENUE CHAIN — green ────────────────────────────────────────────
  // Projects sorted by contract_value; consecutive high-value projects form revenue chains
  const sorted = [...active].sort((a, b) => b.contract_value - a.contract_value)
  for (let i = 0; i < sorted.length - 1 && i < 5; i++) {
    const a = sorted[i], b = sorted[i + 1]
    if (a.contract_value < 5000 || b.contract_value < 5000) continue
    const aPos = posMap.get(a.id)!, bPos = posMap.get(b.id)!
    if (_distSq(aPos, bPos) < MIN_DISTANCE_SQ) continue
    const hash = _hashPair(a.id, b.id)
    if (seen.has(hash)) continue
    seen.add(hash)
    pairs.push({
      id: hash, aId: a.id, bId: b.id,
      aPos: aPos.clone(), bPos: bPos.clone(),
      relType: 'revenue',
      strength: 0.80 + Math.min(0.20, (a.contract_value + b.contract_value) / 500000),
    })
  }

  // Sort by strength descending, cap at MAX_TUNNEL_PAIRS
  pairs.sort((a, b) => b.strength - a.strength)
  return pairs.slice(0, MAX_TUNNEL_PAIRS)
}

// ── Component ─────────────────────────────────────────────────────────────────

export function QuantumTunnelingLayer() {
  const { scene, camera, renderer } = useWorldContext()

  // Visibility toggle
  const visibleRef = useRef(true)

  // Per-ring tracking: ringId → PortalRing
  const ringARef = useRef<Map<string, PortalRing>>(new Map())
  const ringBRef = useRef<Map<string, PortalRing>>(new Map())

  // Connector lines: pairId → LineSegments
  const linesRef = useRef<Map<string, THREE.LineSegments>>(new Map())

  // Root group for easy show/hide
  const groupRef = useRef<THREE.Group | null>(null)

  // Camera animation state
  const animRef = useRef<AnimState | null>(null)

  // Raycaster for ring clicks
  const raycasterRef = useRef(new THREE.Raycaster())

  // All ring meshes (for raycasting)
  const allRingMeshesRef = useRef<THREE.Mesh[]>([])

  // Frame handler ref
  const frameHandlerRef = useRef<((e: Event) => void) | null>(null)

  // ── Build / rebuild all tunnel portals ────────────────────────────────────

  const buildPortals = useCallback((pairs: TunnelPair[]) => {
    const scene_ = scene
    const group  = groupRef.current

    if (!group) return

    // Dispose existing rings, lights, lines
    for (const [, ring] of ringARef.current) {
      disposeObj(scene_, ring.mesh)
      scene_.remove(ring.light)
    }
    for (const [, ring] of ringBRef.current) {
      disposeObj(scene_, ring.mesh)
      scene_.remove(ring.light)
    }
    for (const [, line] of linesRef.current) {
      disposeObj(scene_, line)
    }
    ringARef.current.clear()
    ringBRef.current.clear()
    linesRef.current.clear()
    allRingMeshesRef.current = []

    for (const pair of pairs) {
      const phase = Math.random() * Math.PI * 2

      // ── Ring A ──────────────────────────────────────────────────────────
      const ringAMesh = buildRingMesh(pair.relType, phase)
      ringAMesh.position.copy(pair.aPos)
      // Face toward ring B: compute the flat direction angle, tilt ring toward partner
      const toB = new THREE.Vector3().subVectors(pair.bPos, pair.aPos).normalize()
      ringAMesh.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        new THREE.Vector3(toB.x, 0.4, toB.z).normalize()
      )
      ringAMesh.userData.pairId      = pair.id
      ringAMesh.userData.nodeId      = pair.aId
      ringAMesh.userData.pairedNodeId = pair.bId
      ringAMesh.userData.pairedPos   = pair.bPos.clone()
      ringAMesh.userData.isPortalRing = true
      group.add(ringAMesh)

      const lightA = new THREE.PointLight(COLORS[pair.relType], 1.2, 18)
      lightA.position.copy(pair.aPos)
      scene_.add(lightA)

      const portalA: PortalRing = {
        mesh: ringAMesh, light: lightA,
        pairId: pair.id, nodeId: pair.aId,
        pairedNodeId: pair.bId, pairedPos: pair.bPos.clone(),
        phase,
      }
      ringARef.current.set(pair.id, portalA)

      // ── Ring B ──────────────────────────────────────────────────────────
      const ringBMesh = buildRingMesh(pair.relType, phase + Math.PI) // opposite phase
      ringBMesh.position.copy(pair.bPos)
      const toA = new THREE.Vector3().subVectors(pair.aPos, pair.bPos).normalize()
      ringBMesh.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        new THREE.Vector3(toA.x, 0.4, toA.z).normalize()
      )
      ringBMesh.userData.pairId      = pair.id
      ringBMesh.userData.nodeId      = pair.bId
      ringBMesh.userData.pairedNodeId = pair.aId
      ringBMesh.userData.pairedPos   = pair.aPos.clone()
      ringBMesh.userData.isPortalRing = true
      group.add(ringBMesh)

      const lightB = new THREE.PointLight(COLORS[pair.relType], 1.2, 18)
      lightB.position.copy(pair.bPos)
      scene_.add(lightB)

      const portalB: PortalRing = {
        mesh: ringBMesh, light: lightB,
        pairId: pair.id, nodeId: pair.bId,
        pairedNodeId: pair.aId, pairedPos: pair.aPos.clone(),
        phase: phase + Math.PI,
      }
      ringBRef.current.set(pair.id + '_b', portalB)

      // Track for raycasting
      allRingMeshesRef.current.push(ringAMesh, ringBMesh)

      // ── Connector line ───────────────────────────────────────────────────
      const line = buildConnectorLine(pair.aPos, pair.bPos)
      scene_.add(line)
      linesRef.current.set(pair.id, line)
    }
  }, [scene])

  // ── Camera tunnel animation ────────────────────────────────────────────────

  const startTunnel = useCallback((clickedMesh: THREE.Mesh) => {
    if (animRef.current?.active) return   // already tunneling

    const pairedPos = clickedMesh.userData.pairedPos as THREE.Vector3
    if (!pairedPos) return

    const ringWorldPos = new THREE.Vector3()
    clickedMesh.getWorldPosition(ringWorldPos)

    // Emerge-point: pull back from ring face so we appear behind the destination ring
    const emergePos = pairedPos.clone()
    emergePos.y = pairedPos.y + 2
    // Offset slightly away from ring center to land "on the other side"
    const dx = pairedPos.x - ringWorldPos.x
    const dz = pairedPos.z - ringWorldPos.z
    const len = Math.sqrt(dx * dx + dz * dz) || 1
    emergePos.x += (dx / len) * 14
    emergePos.z += (dz / len) * 14

    animRef.current = {
      active:      true,
      phase:       'zoom_in',
      elapsed:     0,
      originPos:   camera.position.clone(),
      targetPos:   emergePos,
      zoomAnchor:  ringWorldPos.clone(),
      lookAnchor:  pairedPos.clone(),
    }
  }, [camera])

  // ── Animation tick (called by nw:frame) ───────────────────────────────────

  function tickAnimation(dt: number) {
    const anim = animRef.current
    if (!anim || !anim.active) return

    anim.elapsed += dt

    if (anim.phase === 'zoom_in') {
      const t = Math.min(anim.elapsed / ANIM_ZOOM_IN_DUR, 1)
      const ease = 1 - Math.pow(1 - t, 3)   // ease-in-cubic
      camera.position.lerpVectors(anim.originPos, anim.zoomAnchor, ease * 0.85)
      camera.lookAt(anim.zoomAnchor)

      if (anim.elapsed >= ANIM_ZOOM_IN_DUR) {
        anim.phase   = 'warp'
        anim.elapsed = 0

        // Fire warp overlay — at midpoint, snap camera to emerge position
        playWarpOverlay(() => {
          camera.position.copy(anim.targetPos)
          camera.lookAt(anim.lookAnchor)
        })
      }

    } else if (anim.phase === 'warp') {
      // During warp, camera position is managed by playWarpOverlay midpoint callback
      if (anim.elapsed >= ANIM_WARP_DUR) {
        anim.phase   = 'emerge'
        anim.elapsed = 0
      }

    } else if (anim.phase === 'emerge') {
      const t = Math.min(anim.elapsed / ANIM_EMERGE_DUR, 1)
      // Gentle ease-out settle: camera drifts slightly backward from ring
      const settleOffset = new THREE.Vector3(
        (anim.targetPos.x - anim.lookAnchor.x) * 0.15 * (1 - t),
        4 * (1 - t),
        (anim.targetPos.z - anim.lookAnchor.z) * 0.15 * (1 - t),
      )
      camera.position.copy(anim.targetPos).add(settleOffset)
      camera.lookAt(anim.lookAnchor)

      if (anim.elapsed >= ANIM_EMERGE_DUR) {
        anim.active = false
        animRef.current = null
      }
    }
  }

  // ── Setup frame handler ────────────────────────────────────────────────────

  function setupFrameHandler() {
    if (frameHandlerRef.current) {
      window.removeEventListener('nw:frame', frameHandlerRef.current)
    }

    let clock = 0

    const handler = () => {
      const dt = 0.016
      clock += dt

      if (!visibleRef.current) return

      // Pulse rings in sync
      for (const [, ring] of ringARef.current) {
        const mesh = ring.mesh
        const phase = (mesh.userData.phase as number) ?? 0
        const pulse = 0.75 + 0.25 * Math.sin(clock * PULSE_SPEED + phase)
        ;(mesh.material as THREE.MeshStandardMaterial).opacity = pulse * 0.88
        const scale = 0.95 + 0.08 * Math.sin(clock * PULSE_SPEED + phase)
        mesh.scale.setScalar(scale)
        // Light pulse in sync
        ring.light.intensity = 0.8 + 0.7 * Math.sin(clock * PULSE_SPEED + phase)
        // Slow rotation to add life
        mesh.rotation.z += dt * 0.15
      }
      for (const [, ring] of ringBRef.current) {
        const mesh = ring.mesh
        const phase = (mesh.userData.phase as number) ?? 0
        const pulse = 0.75 + 0.25 * Math.sin(clock * PULSE_SPEED + phase)
        ;(mesh.material as THREE.MeshStandardMaterial).opacity = pulse * 0.88
        const scale = 0.95 + 0.08 * Math.sin(clock * PULSE_SPEED + phase)
        mesh.scale.setScalar(scale)
        ring.light.intensity = 0.8 + 0.7 * Math.sin(clock * PULSE_SPEED + phase)
        mesh.rotation.z += dt * 0.15
      }

      // Camera tunnel animation
      tickAnimation(dt)
    }

    window.addEventListener('nw:frame', handler)
    frameHandlerRef.current = handler
  }

  // ── Click handler ──────────────────────────────────────────────────────────

  function setupClickHandler() {
    const canvas = renderer.domElement

    const onClick = (e: MouseEvent) => {
      if (!visibleRef.current) return
      if (animRef.current?.active) return    // ignore clicks mid-tunnel

      const rect   = canvas.getBoundingClientRect()
      const mouseX = ((e.clientX - rect.left) / rect.width)  * 2 - 1
      const mouseY = -((e.clientY - rect.top)  / rect.height) * 2 + 1
      const mouse  = new THREE.Vector2(mouseX, mouseY)

      raycasterRef.current.setFromCamera(mouse, camera)

      const rings = allRingMeshesRef.current
      const hits  = raycasterRef.current.intersectObjects(rings, false)

      if (hits.length > 0) {
        const clickedMesh = hits[0].object as THREE.Mesh
        if (clickedMesh.userData.isPortalRing) {
          startTunnel(clickedMesh)
        }
      }
    }

    canvas.addEventListener('click', onClick)
    return () => canvas.removeEventListener('click', onClick)
  }

  // ── Toggle listener ────────────────────────────────────────────────────────

  function setupToggleListener() {
    const onToggle = () => {
      visibleRef.current = !visibleRef.current
      const group = groupRef.current
      if (group) group.visible = visibleRef.current
      // Also toggle lines (in scene root)
      for (const [, line] of linesRef.current) {
        line.visible = visibleRef.current
      }
      // Toggle ring lights
      for (const [, ring] of ringARef.current) ring.light.visible = visibleRef.current
      for (const [, ring] of ringBRef.current) ring.light.visible = visibleRef.current
    }

    window.addEventListener('nw:tunnels-toggle', onToggle)
    return () => window.removeEventListener('nw:tunnels-toggle', onToggle)
  }

  // ── Mount ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    // Root group
    const group = new THREE.Group()
    group.name  = 'QuantumTunnelingLayer'
    scene.add(group)
    groupRef.current = group

    setupFrameHandler()
    const removeClick  = setupClickHandler()
    const removeToggle = setupToggleListener()

    // Subscribe to world data
    const unsub = subscribeWorldData((data: NWWorldData) => {
      const pairs = discoverTunnelPairs(data.projects, data.fieldLogs)
      buildPortals(pairs)
    })

    return () => {
      unsub()
      removeClick()
      removeToggle()

      if (frameHandlerRef.current) {
        window.removeEventListener('nw:frame', frameHandlerRef.current)
        frameHandlerRef.current = null
      }

      // Dispose rings
      for (const [, ring] of ringARef.current) {
        disposeObj(scene, ring.mesh)
        scene.remove(ring.light)
      }
      for (const [, ring] of ringBRef.current) {
        disposeObj(scene, ring.mesh)
        scene.remove(ring.light)
      }
      for (const [, line] of linesRef.current) {
        disposeObj(scene, line)
      }
      ringARef.current.clear()
      ringBRef.current.clear()
      linesRef.current.clear()
      allRingMeshesRef.current = []

      disposeObj(scene, group)
      groupRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene])

  return null
}
