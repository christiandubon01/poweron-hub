/**
 * TectonicPlatesLayer.tsx — NW52: Business-domain tectonic plates.
 *
 * The ground plane is divided into four tectonic plates, one per business domain:
 *   - Residential  → blue-tinted ground region
 *   - Commercial   → yellow-tinted ground region
 *   - Service      → green-tinted ground region
 *   - Solar        → orange-tinted ground region
 *
 * PLATE SIZE is proportional to each domain's share of total project contract_value.
 *
 * FAULT LINES: Glowing amber cracks (2px-equivalent geometry) between plate edges.
 *   - Static: amber glow (color #ffaa33)
 *   - Competing growth (two domains both growing): red glow (#ff3333)
 *
 * PLATE MOVEMENT:
 *   - Growing domain → plate expands outward (0.1 world-unit shift per month)
 *   - Shrinking domain → plate contracts
 *   - Smooth lerp interpolation toward target sizes
 *
 * EARTHQUAKE EVENTS:
 *   - Significant domain shift triggers:
 *       • Fault line flash burst
 *       • Screen shake (0.5px amplitude, 0.3s, CSS transform on canvas)
 *       • Seismic ring radiated outward from event point
 *       • NEXUS notification dispatched as 'nw:tectonic-shift'
 *
 * PLATE LABELS (React overlay, not Three.js):
 *   - Domain name + revenue % + growth arrow
 *   - Semi-transparent, centered on plate world position (projected to screen)
 *
 * TEMPORAL INTEGRATION (NW39):
 *   Listens to 'nw:temporal-snapshot' custom event to rewind plate positions
 *   to their historical state.
 *
 * Layers Panel: registered as id 'tectonic-plates', OFF by default.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import { useWorldContext } from './WorldContext'
import { subscribeWorldData, type NWWorldData, type NWProject } from './DataBridge'

// ── Constants ──────────────────────────────────────────────────────────────────

/** Ground plane Y position — plates sit just above it to avoid z-fighting */
const PLATE_Y = 0.05

/** Total world area for plates (a square centred at origin, units²) */
const WORLD_SIDE = 320

/** How many world-units one domain grows per month of expanding data */
const UNITS_PER_MONTH = 0.1

/** Significant shift threshold for earthquake events (fractional change) */
const EARTHQUAKE_THRESHOLD = 0.08

/** Minimum share so a domain is never invisible */
const MIN_SHARE = 0.04

/** Screen-shake amplitude in pixels */
const SHAKE_AMPLITUDE = 0.5
const SHAKE_DURATION_MS = 300

/** Seismic ring expansion speed (world units per frame) */
const RING_EXPAND_SPEED = 1.2
const RING_MAX_RADIUS = 80
const RING_FADE_SPEED = 0.025

// ── Domain definitions ────────────────────────────────────────────────────────

type DomainKey = 'residential' | 'commercial' | 'service' | 'solar'

interface DomainDef {
  key: DomainKey
  label: string
  icon: string
  /** Base hue for THREE material */
  colorHex: number
  /** CSS color for the React label */
  cssColor: string
  /** Plate quadrant: which half of X and Z axes */
  quadrantX: -1 | 1
  quadrantZ: -1 | 1
}

const DOMAINS: DomainDef[] = [
  {
    key: 'residential',
    label: 'Residential',
    icon: '🏠',
    colorHex: 0x1155cc,
    cssColor: '#4488ff',
    quadrantX: -1,
    quadrantZ: -1,
  },
  {
    key: 'commercial',
    label: 'Commercial',
    icon: '🏢',
    colorHex: 0xccaa11,
    cssColor: '#ffdd44',
    quadrantX: 1,
    quadrantZ: -1,
  },
  {
    key: 'service',
    label: 'Service',
    icon: '🔧',
    colorHex: 0x118833,
    cssColor: '#44cc66',
    quadrantX: -1,
    quadrantZ: 1,
  },
  {
    key: 'solar',
    label: 'Solar',
    icon: '☀️',
    colorHex: 0xcc6611,
    cssColor: '#ff8833',
    quadrantX: 1,
    quadrantZ: 1,
  },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Classify a project into a domain based on its `type` field.
 * Falls back to heuristics on the project name.
 */
function classifyProjectDomain(p: NWProject): DomainKey {
  const t = (p.type ?? '').toLowerCase()
  const n = (p.name ?? '').toLowerCase()

  if (t.includes('solar') || t.includes('pv') || n.includes('solar') || n.includes('panel')) {
    return 'solar'
  }
  if (
    t.includes('commercial') || t.includes('office') || t.includes('retail') ||
    t.includes('industrial') || n.includes('commercial') || n.includes('office') ||
    n.includes('medical') || n.includes('plaza') || n.includes('center') ||
    n.includes('mall') || n.includes('warehouse')
  ) {
    return 'commercial'
  }
  if (
    t.includes('service') || t.includes('repair') || t.includes('maintenance') ||
    n.includes('service') || n.includes('repair') || n.includes('maintenance')
  ) {
    return 'service'
  }
  // Default: residential
  return 'residential'
}

/** Derive per-domain revenue shares (0–1) from a project array */
function computeDomainShares(projects: NWProject[]): Record<DomainKey, number> {
  const totals: Record<DomainKey, number> = {
    residential: 0, commercial: 0, service: 0, solar: 0,
  }
  let grand = 0
  for (const p of projects) {
    const v = p.contract_value ?? 0
    totals[classifyProjectDomain(p)] += v
    grand += v
  }
  if (grand === 0) {
    // Equal distribution when no data
    return { residential: 0.25, commercial: 0.25, service: 0.25, solar: 0.25 }
  }
  const out: Record<DomainKey, number> = { residential: 0, commercial: 0, service: 0, solar: 0 }
  let usedShare = 0
  for (const d of DOMAINS) {
    out[d.key] = Math.max(MIN_SHARE, totals[d.key] / grand)
    usedShare += out[d.key]
  }
  // Normalise so shares sum to 1.0
  for (const d of DOMAINS) {
    out[d.key] /= usedShare
  }
  return out
}

/** Convert a domain share (0–1) to a half-side length in world units.
 *  Total area = WORLD_SIDE² / 4 per quadrant max.
 *  We scale from 0 → WORLD_SIDE/2 */
function shareToHalfSide(share: number): number {
  return (WORLD_SIDE / 2) * Math.sqrt(share)
}

// ── Types internal ────────────────────────────────────────────────────────────

interface PlateState {
  key: DomainKey
  currentShare: number
  targetShare: number
  halfSide: number        // current lerped half-side (world units)
  targetHalfSide: number
  centerX: number
  centerZ: number
  mesh: THREE.Mesh | null
  prevShare: number       // for earthquake detection
}

interface FaultLine {
  mesh: THREE.Mesh
  glowMesh: THREE.Mesh
  /** Current colour state: 'amber' | 'red' | 'flash' */
  state: 'amber' | 'red' | 'flash'
  flashTimer: number
}

interface SeismicRing {
  mesh: THREE.Mesh
  radius: number
  opacity: number
  cx: number
  cz: number
}

interface LabelData {
  key: DomainKey
  label: string
  icon: string
  cssColor: string
  share: number
  growthDir: 'up' | 'down' | 'stable'
  screenX: number
  screenY: number
  visible: boolean
}

// ── Component ──────────────────────────────────────────────────────────────────

interface TectonicPlatesLayerProps {
  visible: boolean
}

export function TectonicPlatesLayer({ visible }: TectonicPlatesLayerProps) {
  const { scene, camera, renderer } = useWorldContext()

  // Three.js refs
  const groupRef        = useRef<THREE.Group | null>(null)
  const plateStatesRef  = useRef<PlateState[]>([])
  const faultLinesRef   = useRef<FaultLine[]>([])
  const seismicRingsRef = useRef<SeismicRing[]>([])
  const frameHandlerRef = useRef<(() => void) | null>(null)
  const elapsedRef      = useRef(0)
  const canvasRef       = useRef<HTMLCanvasElement | null>(null)
  const shakeTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSharesRef   = useRef<Record<DomainKey, number> | null>(null)

  // React state for label overlay
  const [labels, setLabels] = useState<LabelData[]>([])
  const [shaking, setShaking] = useState(false)

  // ── Shake screen ──────────────────────────────────────────────────────────

  const triggerShake = useCallback(() => {
    if (shakeTimerRef.current) return // already shaking
    setShaking(true)
    shakeTimerRef.current = setTimeout(() => {
      setShaking(false)
      shakeTimerRef.current = null
    }, SHAKE_DURATION_MS)
  }, [])

  // ── NEXUS notification helper ─────────────────────────────────────────────

  const notifyNexus = useCallback((message: string) => {
    window.dispatchEvent(new CustomEvent('nw:tectonic-shift', {
      detail: { message, timestamp: new Date().toISOString() },
    }))
  }, [])

  // ── Build / rebuild plate meshes ──────────────────────────────────────────

  function buildPlateMeshes(group: THREE.Group, states: PlateState[]) {
    // Remove old meshes
    states.forEach(s => {
      if (s.mesh) {
        s.mesh.geometry.dispose()
        ;(s.mesh.material as THREE.Material).dispose()
        group.remove(s.mesh)
        s.mesh = null
      }
    })

    states.forEach(s => {
      const domain = DOMAINS.find(d => d.key === s.key)!
      const geo = new THREE.PlaneGeometry(s.halfSide * 2, s.halfSide * 2)
      const mat = new THREE.MeshBasicMaterial({
        color: domain.colorHex,
        transparent: true,
        opacity: 0.18,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.rotation.x = -Math.PI / 2
      mesh.position.set(s.centerX, PLATE_Y, s.centerZ)
      group.add(mesh)
      s.mesh = mesh
    })
  }

  function updatePlateMesh(s: PlateState) {
    if (!s.mesh) return
    s.mesh.position.set(s.centerX, PLATE_Y, s.centerZ)
    s.mesh.scale.set(
      s.halfSide / Math.max(0.01, s.targetHalfSide),
      s.halfSide / Math.max(0.01, s.targetHalfSide),
      1
    )
    // Simpler: just resize geometry each time halfSide changes noticeably
  }

  // ── Build fault line meshes ───────────────────────────────────────────────

  function buildFaultLines(group: THREE.Group): FaultLine[] {
    // Dispose old
    faultLinesRef.current.forEach(fl => {
      fl.mesh.geometry.dispose()
      ;(fl.mesh.material as THREE.Material).dispose()
      fl.glowMesh.geometry.dispose()
      ;(fl.glowMesh.material as THREE.Material).dispose()
      group.remove(fl.mesh)
      group.remove(fl.glowMesh)
    })

    const faults: FaultLine[] = []

    // Vertical fault line (X=0, runs along Z)
    faults.push(createFaultLine(group, true))
    // Horizontal fault line (Z=0, runs along X)
    faults.push(createFaultLine(group, false))

    return faults
  }

  function createFaultLine(group: THREE.Group, isVertical: boolean): FaultLine {
    const length = WORLD_SIDE
    const width  = 0.6   // ~2px equivalent at this scale

    const geo = new THREE.PlaneGeometry(
      isVertical ? width : length,
      isVertical ? length : width,
    )
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffaa33,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(0, PLATE_Y + 0.01, 0)
    group.add(mesh)

    // Glow overlay (slightly wider, lower opacity)
    const glowGeo = new THREE.PlaneGeometry(
      isVertical ? width * 4 : length,
      isVertical ? length : width * 4,
    )
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xffaa33,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    const glowMesh = new THREE.Mesh(glowGeo, glowMat)
    glowMesh.rotation.x = -Math.PI / 2
    glowMesh.position.set(0, PLATE_Y + 0.005, 0)
    group.add(glowMesh)

    return { mesh, glowMesh, state: 'amber', flashTimer: 0 }
  }

  function setFaultLineColor(fl: FaultLine, hex: number, glowOpacity: number) {
    const mat      = fl.mesh.material as THREE.MeshBasicMaterial
    const glowMat  = fl.glowMesh.material as THREE.MeshBasicMaterial
    mat.color.setHex(hex)
    glowMat.color.setHex(hex)
    glowMat.opacity = glowOpacity
  }

  // ── Create seismic ring ───────────────────────────────────────────────────

  function spawnSeismicRing(group: THREE.Group, cx: number, cz: number) {
    const geo = new THREE.RingGeometry(0.5, 1.5, 48)
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff6600,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(cx, PLATE_Y + 0.08, cz)
    group.add(mesh)

    seismicRingsRef.current.push({ mesh, radius: 1.0, opacity: 0.7, cx, cz })
  }

  // ── Project plate centers from 3D → 2D for React labels ──────────────────

  function projectToScreen(
    worldX: number, worldZ: number,
    cam: THREE.Camera,
    rend: THREE.WebGLRenderer,
  ): { x: number; y: number; visible: boolean } {
    const vec = new THREE.Vector3(worldX, 1, worldZ)
    vec.project(cam)
    const domEl = rend.domElement
    const x = (vec.x * 0.5 + 0.5) * domEl.clientWidth
    const y = (-vec.y * 0.5 + 0.5) * domEl.clientHeight
    // behind camera check
    const visible = vec.z < 1.0 && x > 0 && x < domEl.clientWidth && y > 0 && y < domEl.clientHeight
    return { x, y, visible }
  }

  // ── Main setup effect ─────────────────────────────────────────────────────

  useEffect(() => {
    const group = new THREE.Group()
    group.visible = visible
    group.name = 'TectonicPlatesLayer'
    scene.add(group)
    groupRef.current = group

    // Initialise plate states — equal shares initially
    const states: PlateState[] = DOMAINS.map(d => {
      const share     = 0.25
      const halfSide  = shareToHalfSide(share)
      const centerX   = d.quadrantX * (WORLD_SIDE / 4)
      const centerZ   = d.quadrantZ * (WORLD_SIDE / 4)
      return {
        key: d.key,
        currentShare: share,
        targetShare: share,
        halfSide,
        targetHalfSide: halfSide,
        centerX,
        centerZ,
        mesh: null,
        prevShare: share,
      }
    })
    plateStatesRef.current = states

    buildPlateMeshes(group, states)
    const faults = buildFaultLines(group)
    faultLinesRef.current = faults

    // ── Subscribe to live data ────────────────────────────────────────────

    const unsub = subscribeWorldData((data: NWWorldData) => {
      const shares = computeDomainShares(data.projects)
      const prev   = lastSharesRef.current

      // Detect earthquakes (significant share changes)
      if (prev) {
        for (const d of DOMAINS) {
          const delta = Math.abs(shares[d.key] - prev[d.key])
          if (delta >= EARTHQUAKE_THRESHOLD) {
            // Find largest project in this domain for notification
            const domainProjects = data.projects
              .filter(p => classifyProjectDomain(p) === d.key)
              .sort((a, b) => (b.contract_value ?? 0) - (a.contract_value ?? 0))
            const topProject = domainProjects[0]
            const pct = Math.round(shares[d.key] * 100)
            const msg = topProject
              ? `Tectonic shift: ${d.label} sector expanded ${Math.round(delta * 100)}% — new project ${topProject.name}`
              : `Tectonic shift: ${d.label} sector at ${pct}% of revenue mix`

            notifyNexus(msg)
            triggerShake()

            // Flash all fault lines
            faultLinesRef.current.forEach(fl => {
              fl.state = 'flash'
              fl.flashTimer = 30 // frames
              setFaultLineColor(fl, 0xffffff, 0.9)
            })

            // Spawn seismic ring at domain center
            const domState = states.find(s => s.key === d.key)
            if (domState) {
              spawnSeismicRing(group, domState.centerX, domState.centerZ)
            }
          }
        }
      }

      lastSharesRef.current = { ...shares }

      // Update plate targets
      states.forEach(s => {
        s.prevShare    = s.currentShare
        s.targetShare  = shares[s.key]
        s.targetHalfSide = shareToHalfSide(shares[s.key])
      })

      // Detect competing growth (two domains both growing) → red fault
      const growingDomains = states.filter(s => s.targetShare > s.currentShare)
      if (growingDomains.length >= 2) {
        faultLinesRef.current.forEach(fl => {
          if (fl.state !== 'flash') {
            fl.state = 'red'
            setFaultLineColor(fl, 0xff3333, 0.45)
          }
        })
      } else {
        faultLinesRef.current.forEach(fl => {
          if (fl.state === 'red') {
            fl.state = 'amber'
            setFaultLineColor(fl, 0xffaa33, 0.22)
          }
        })
      }
    })

    // ── Temporal playback (NW39) ──────────────────────────────────────────

    function onTemporalSnapshot(e: Event) {
      const ev = e as CustomEvent<{ projects?: NWProject[] }>
      if (!ev.detail?.projects) return
      const shares = computeDomainShares(ev.detail.projects)
      states.forEach(s => {
        s.targetShare    = shares[s.key]
        s.targetHalfSide = shareToHalfSide(shares[s.key])
      })
    }
    window.addEventListener('nw:temporal-snapshot', onTemporalSnapshot)

    // ── Per-frame animation ───────────────────────────────────────────────

    const frameHandler = () => {
      elapsedRef.current += 1

      // Lerp plate sizes
      let needRebuild = false
      states.forEach(s => {
        const prevHalf = s.halfSide
        s.halfSide += (s.targetHalfSide - s.halfSide) * 0.04
        s.currentShare += (s.targetShare - s.currentShare) * 0.04
        if (Math.abs(s.halfSide - prevHalf) > 0.01) needRebuild = true
      })

      if (needRebuild && group.visible) {
        buildPlateMeshes(group, states)
      }

      // Animate fault lines (pulse glow + flash decay)
      const t = elapsedRef.current
      faultLinesRef.current.forEach(fl => {
        if (fl.state === 'flash') {
          fl.flashTimer -= 1
          const pulse = Math.sin(t * 0.5) * 0.3 + 0.7
          setFaultLineColor(fl, fl.flashTimer > 15 ? 0xffffff : 0xffaa33, pulse)
          if (fl.flashTimer <= 0) {
            fl.state = 'amber'
            setFaultLineColor(fl, 0xffaa33, 0.22)
          }
        } else if (fl.state === 'amber') {
          // Gentle amber pulse
          const pulse = Math.sin(t * 0.02 + 1.5) * 0.12 + 0.22
          const mat = fl.glowMesh.material as THREE.MeshBasicMaterial
          mat.opacity = pulse
        }
      })

      // Animate seismic rings
      const rings = seismicRingsRef.current
      for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i]
        r.radius += RING_EXPAND_SPEED
        r.opacity -= RING_FADE_SPEED
        r.mesh.scale.setScalar(r.radius)
        ;(r.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, r.opacity)
        if (r.opacity <= 0) {
          r.mesh.geometry.dispose()
          ;(r.mesh.material as THREE.Material).dispose()
          group.remove(r.mesh)
          rings.splice(i, 1)
        }
      }

      // Update React labels every 10 frames
      if (t % 10 === 0 && group.visible) {
        const newLabels: LabelData[] = states.map(s => {
          const d   = DOMAINS.find(dd => dd.key === s.key)!
          const pos = projectToScreen(s.centerX, s.centerZ, camera, renderer)
          const growthDir: LabelData['growthDir'] =
            s.targetShare > s.currentShare + 0.005 ? 'up'
            : s.targetShare < s.currentShare - 0.005 ? 'down'
            : 'stable'
          return {
            key: s.key,
            label: d.label,
            icon: d.icon,
            cssColor: d.cssColor,
            share: s.currentShare,
            growthDir,
            screenX: pos.x,
            screenY: pos.y,
            visible: pos.visible,
          }
        })
        setLabels(newLabels)
      }
    }

    frameHandlerRef.current = frameHandler
    window.addEventListener('nw:frame', frameHandler)

    // ── Find renderer canvas for shake ────────────────────────────────────

    canvasRef.current = renderer?.domElement ?? null

    return () => {
      unsub()
      window.removeEventListener('nw:frame', frameHandler)
      window.removeEventListener('nw:temporal-snapshot', onTemporalSnapshot)
      frameHandlerRef.current = null

      // Dispose Three.js objects
      states.forEach(s => {
        if (s.mesh) {
          s.mesh.geometry.dispose()
          ;(s.mesh.material as THREE.Material).dispose()
        }
      })
      faultLinesRef.current.forEach(fl => {
        fl.mesh.geometry.dispose()
        ;(fl.mesh.material as THREE.Material).dispose()
        fl.glowMesh.geometry.dispose()
        ;(fl.glowMesh.material as THREE.Material).dispose()
      })
      seismicRingsRef.current.forEach(r => {
        r.mesh.geometry.dispose()
        ;(r.mesh.material as THREE.Material).dispose()
      })
      scene.remove(group)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, camera, renderer])

  // Sync visibility
  useEffect(() => {
    if (groupRef.current) groupRef.current.visible = visible
  }, [visible])

  // ── Render React label overlay ─────────────────────────────────────────────

  if (!visible) return null

  return (
    <>
      {/* Screen shake wrapper — applied to the canvas via CSS transform */}
      {shaking && (
        <style>{`
          @keyframes nw-quake {
            0%   { transform: translate(0px, 0px); }
            20%  { transform: translate(${SHAKE_AMPLITUDE}px, -${SHAKE_AMPLITUDE}px); }
            40%  { transform: translate(-${SHAKE_AMPLITUDE}px, ${SHAKE_AMPLITUDE}px); }
            60%  { transform: translate(${SHAKE_AMPLITUDE}px, ${SHAKE_AMPLITUDE}px); }
            80%  { transform: translate(-${SHAKE_AMPLITUDE}px, -${SHAKE_AMPLITUDE}px); }
            100% { transform: translate(0px, 0px); }
          }
          canvas { animation: nw-quake ${SHAKE_DURATION_MS}ms ease-out; }
        `}</style>
      )}

      {/* Plate labels — React overlay positioned over the Three.js canvas */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 12,
        }}
      >
        {labels.map(lbl =>
          lbl.visible ? (
            <div
              key={lbl.key}
              style={{
                position: 'absolute',
                left: lbl.screenX,
                top: lbl.screenY,
                transform: 'translate(-50%, -50%)',
                background: 'rgba(0,0,0,0.52)',
                border: `1px solid ${lbl.cssColor}55`,
                borderRadius: 6,
                padding: '4px 8px',
                fontFamily: 'monospace',
                color: lbl.cssColor,
                fontSize: 11,
                letterSpacing: 1,
                backdropFilter: 'blur(4px)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 1,
                minWidth: 80,
                boxShadow: `0 0 8px ${lbl.cssColor}33`,
              }}
            >
              <span style={{ fontSize: 14 }}>{lbl.icon}</span>
              <span style={{ fontWeight: 700, fontSize: 10, letterSpacing: 1.5 }}>
                {lbl.label.toUpperCase()}
              </span>
              <span style={{ fontSize: 11, color: '#fff', opacity: 0.85 }}>
                {Math.round(lbl.share * 100)}%
              </span>
              <span style={{ fontSize: 12 }}>
                {lbl.growthDir === 'up'
                  ? <span style={{ color: '#44ff88' }}>▲</span>
                  : lbl.growthDir === 'down'
                  ? <span style={{ color: '#ff4444' }}>▼</span>
                  : <span style={{ color: 'rgba(255,255,255,0.35)' }}>─</span>}
              </span>
            </div>
          ) : null,
        )}
      </div>
    </>
  )
}
