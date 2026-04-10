/**
 * ConstellationModeLayer.tsx — NW56: Zoom-out constellation view.
 *
 * When the camera zooms out beyond a threshold, the world transforms into a
 * constellation view — projects become stars, connections become constellation
 * lines, patterns emerge that aren't visible up close.
 *
 * ZOOM THRESHOLDS:
 *   < 80 units  — normal view, layer invisible
 *   80–120 units — crossfade transition (world fades, stars fade in)
 *   > 120 units  — full constellation view
 *
 * Stars:
 *   - Project mountains → bright stars (size ∝ contract_value)
 *   - Color by project type: blue=residential, yellow=commercial, green=service, orange=solar
 *   - Subscription/hub towers → smaller dimmer stars
 *   - Revenue river → luminous Milky Way band
 *   - Ground plane fades to dark space via overlay plane
 *
 * Constellation Lines:
 *   - Same project type (crew proxy) → thin white lines
 *   - Same revenue bracket → gold lines
 *   - Temporal dependency chain → teal directional lines
 *
 * Pattern Labels:
 *   - Groups of ≥2 connected stars get an auto-generated constellation name
 *   - Rendered as HTML overlays for crisp text
 *
 * Interaction:
 *   - Click star → minimal HUD name + value
 *   - Click line → relationship tooltip
 *   - Double-click star → zoom back down to project (dispatches nw:constellation-zoom-in)
 */

import React, { useEffect, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import { useWorldContext } from './WorldContext'
import {
  subscribeWorldData,
  seededPosition,
  contractValueToHeight,
  type NWWorldData,
  type NWProject,
} from './DataBridge'

// ── Constants ─────────────────────────────────────────────────────────────────

const ZOOM_NORMAL     = 80    // below this: constellation fully hidden
const ZOOM_FULL       = 120   // above this: constellation fully visible
const STAR_Y          = 70    // height at which stars float in "space"
const OVERLAY_MAX_OPACITY = 0.93  // how dark the space overlay gets

// Revenue brackets for gold lines
const REV_BRACKETS = [0, 10_000, 50_000, 150_000, 500_000, Infinity] as const

// Type → color
const TYPE_COLOR: Record<string, number> = {
  residential: 0x4488ff,
  commercial:  0xffcc00,
  service:     0x44ff88,
  solar:       0xff8800,
}
const COLOR_DEFAULT_STAR = 0xffffff

// ── Helpers ───────────────────────────────────────────────────────────────────

function orbitFade(radius: number): number {
  if (radius <= ZOOM_NORMAL) return 0
  if (radius >= ZOOM_FULL)   return 1
  return (radius - ZOOM_NORMAL) / (ZOOM_FULL - ZOOM_NORMAL)
}

function revBracket(v: number): number {
  for (let i = 0; i < REV_BRACKETS.length - 1; i++) {
    if (v >= REV_BRACKETS[i] && v < REV_BRACKETS[i + 1]) return i
  }
  return REV_BRACKETS.length - 2
}

/** Deterministic "seeded" number from a string */
function seedFloat(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i)
  return ((h >>> 0) / 0xffffffff)
}

// ── Auto constellation naming ─────────────────────────────────────────────────

const PREFIXES  = ['The', 'Great', 'Northern', 'Western', 'Eastern', 'Golden']
const SUFFIXES  = ['Cluster', 'Belt', 'Chain', 'Ring', 'Reach', 'Circuit', 'Arc', 'Path']
const SOLO_NAMES = ['The Solo Runner', 'The Lone Star', 'The Outlier', 'The Pioneer']

function autoConstellationName(projects: NWProject[], groupKey: string): string {
  if (projects.length === 1) {
    const idx = Math.floor(seedFloat(groupKey) * SOLO_NAMES.length)
    return SOLO_NAMES[idx]
  }
  // Use client name or type
  const type = projects[0].type ?? 'Project'
  const typeLabel = type.charAt(0).toUpperCase() + type.slice(1)

  // Check if all same client
  const clientIds = new Set(projects.map(p => p.client_id).filter(Boolean))
  if (clientIds.size === 1 && projects[0].client_id) {
    // Try to derive a name from project names
    const firstWord = projects[0].name.split(' ')[0] ?? typeLabel
    return `The ${firstWord} Cluster`
  }

  // Revenue-based
  if (groupKey.startsWith('rev_')) {
    const labels = ['Micro', 'Small', 'Commercial', 'Premium', 'Enterprise']
    const idx = parseInt(groupKey.replace('rev_', '')) % labels.length
    return `${labels[idx]} Belt`
  }

  // Type-based group
  const seed = Math.floor(seedFloat(groupKey) * PREFIXES.length)
  const sfxSeed = Math.floor(seedFloat(groupKey + 'sfx') * SUFFIXES.length)
  return `${PREFIXES[seed]} ${typeLabel} ${SUFFIXES[sfxSeed]}`
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface StarEntry {
  mesh: THREE.Mesh
  project: NWProject
  worldPos: THREE.Vector3  // projected screen position (updated per frame)
  screenX: number
  screenY: number
  inView: boolean
}

interface LineEntry {
  line: THREE.Line
  kind: 'crew' | 'revenue' | 'temporal'
  label: string
  midScreen: { x: number; y: number; inView: boolean }
}

interface ConstellationGroup {
  name: string
  centerScreen: { x: number; y: number; inView: boolean }
  projects: NWProject[]
}

interface HUDState {
  type: 'star' | 'line' | null
  x: number
  y: number
  title: string
  subtitle: string
}

// ── Component ─────────────────────────────────────────────────────────────────

interface ConstellationModeLayerProps {
  visible: boolean
}

export function ConstellationModeLayer({ visible }: ConstellationModeLayerProps) {
  const { scene, camera, renderer } = useWorldContext()

  // Orbit radius from CameraController scroll events
  const orbitRadiusRef = useRef(80)
  const fadeRef        = useRef(0)

  // Three.js groups
  const groupRef       = useRef<THREE.Group | null>(null)
  const overlayRef     = useRef<THREE.Mesh | null>(null)
  const milkyWayRef    = useRef<THREE.Mesh | null>(null)
  const starsRef       = useRef<StarEntry[]>([])
  const linesRef       = useRef<LineEntry[]>([])

  // React HUD state
  const [hud, setHud]       = useState<HUDState>({ type: null, x: 0, y: 0, title: '', subtitle: '' })
  const [groups, setGroups] = useState<ConstellationGroup[]>([])
  const [fade, setFade]     = useState(0)

  // ── Orbit radius listener ────────────────────────────────────────────────
  useEffect(() => {
    function onOrbitRadius(e: Event) {
      const ev = e as CustomEvent<{ radius: number }>
      if (ev.detail?.radius !== undefined) {
        orbitRadiusRef.current = ev.detail.radius
      }
    }
    window.addEventListener('nw:orbit-radius', onOrbitRadius)
    return () => window.removeEventListener('nw:orbit-radius', onOrbitRadius)
  }, [])

  // ── Build Three.js scene objects ─────────────────────────────────────────
  useEffect(() => {
    const group = new THREE.Group()
    group.renderOrder = 900
    scene.add(group)
    groupRef.current = group

    // ── Space overlay: large dark plane that fades in to hide terrain ─────
    const overlayGeo = new THREE.PlaneGeometry(2000, 2000)
    const overlayMat = new THREE.MeshBasicMaterial({
      color: 0x000510,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    const overlay = new THREE.Mesh(overlayGeo, overlayMat)
    overlay.rotation.x = -Math.PI / 2
    overlay.position.y = 50
    overlay.renderOrder = 901
    group.add(overlay)
    overlayRef.current = overlay

    // ── Milky Way band: elongated luminous plane along the river axis ─────
    const mwGeo = new THREE.PlaneGeometry(30, 400)
    const mwMat = new THREE.MeshBasicMaterial({
      color: 0x88aaff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    const mw = new THREE.Mesh(mwGeo, mwMat)
    mw.rotation.x = -Math.PI / 2
    mw.position.set(0, STAR_Y - 1, 0)
    mw.renderOrder = 902
    group.add(mw)
    milkyWayRef.current = mw

    return () => {
      overlayGeo.dispose()
      overlayMat.dispose()
      mwGeo.dispose()
      mwMat.dispose()
      scene.remove(group)
    }
  }, [scene])

  // ── Build stars and lines from world data ─────────────────────────────────
  useEffect(() => {
    if (!groupRef.current) return

    const unsub = subscribeWorldData((data: NWWorldData) => {
      const group = groupRef.current
      if (!group) return
      const g = group  // TS-safe non-null alias for nested functions

      // Dispose old stars + lines
      starsRef.current.forEach(s => {
        s.mesh.geometry.dispose()
        ;(s.mesh.material as THREE.Material).dispose()
        group.remove(s.mesh)
      })
      starsRef.current = []

      linesRef.current.forEach(l => {
        l.line.geometry.dispose()
        ;(l.line.material as THREE.Material).dispose()
        group.remove(l.line)
      })
      linesRef.current = []

      const { projects } = data

      // ── Build stars ─────────────────────────────────────────────────────
      const starMap = new Map<string, THREE.Vector3>()

      projects.forEach(p => {
        const pos = seededPosition(p.id)
        const typeColor = (p.type && TYPE_COLOR[p.type]) ? TYPE_COLOR[p.type] : COLOR_DEFAULT_STAR
        const height = contractValueToHeight(p.contract_value)
        const radius = 0.3 + Math.min(height / 5, 1.2)

        const geo = new THREE.SphereGeometry(radius, 10, 8)
        const mat = new THREE.MeshStandardMaterial({
          color: typeColor,
          emissive: typeColor,
          emissiveIntensity: 1.8,
          transparent: true,
          opacity: 0,
          roughness: 0.1,
          metalness: 0.0,
        })
        const mesh = new THREE.Mesh(geo, mat)
        // Stars float at STAR_Y + small Y variation from seeded noise
        const starY = STAR_Y + (seedFloat(p.id + 'y') - 0.5) * 20
        mesh.position.set(pos.x, starY, pos.z)
        mesh.renderOrder = 903
        group.add(mesh)

        // Glow halo
        const haloGeo = new THREE.SphereGeometry(radius * 2.5, 8, 6)
        const haloMat = new THREE.MeshBasicMaterial({
          color: typeColor,
          transparent: true,
          opacity: 0,
          depthWrite: false,
        })
        const halo = new THREE.Mesh(haloGeo, haloMat)
        halo.renderOrder = 902
        mesh.add(halo)

        const worldPos = new THREE.Vector3(pos.x, starY, pos.z)
        starMap.set(p.id, worldPos)

        starsRef.current.push({
          mesh,
          project: p,
          worldPos,
          screenX: 0,
          screenY: 0,
          inView: false,
        })
      })

      // ── Subscription tower stars (hub events → dimmer small stars) ─────
      data.hubEvents.slice(0, 8).forEach((ev, i) => {
        const angle = (i / 8) * Math.PI * 2
        const r = 90 + seedFloat(ev.id) * 40
        const x = Math.cos(angle) * r
        const z = Math.sin(angle) * r
        const y = STAR_Y + (seedFloat(ev.id + 'y') - 0.5) * 10

        const geo = new THREE.SphereGeometry(0.18, 8, 6)
        const mat = new THREE.MeshBasicMaterial({
          color: 0xaaaacc,
          transparent: true,
          opacity: 0,
        })
        const mesh = new THREE.Mesh(geo, mat)
        mesh.position.set(x, y, z)
        mesh.renderOrder = 902
        group.add(mesh)

        starsRef.current.push({
          mesh,
          project: { id: ev.id, name: `Hub Event ${i + 1}`, status: 'lead', contract_value: 0, health_score: 100, org_id: '', material_cost: 0, phase_completion: 0, created_at: null, type: null, client_id: null },
          worldPos: new THREE.Vector3(x, y, z),
          screenX: 0,
          screenY: 0,
          inView: false,
        })
      })

      // ── Constellation Lines ─────────────────────────────────────────────

      // Helper: add a line between two project positions
      function addLine(pA: NWProject, pB: NWProject, kind: 'crew' | 'revenue' | 'temporal') {
        const posA = starMap.get(pA.id)
        const posB = starMap.get(pB.id)
        if (!posA || !posB) return

        const colors = {
          crew:     0xffffff,
          revenue:  0xffd700,
          temporal: 0x00e5cc,
        }
        const geo = new THREE.BufferGeometry().setFromPoints([posA, posB])
        const mat = new THREE.LineBasicMaterial({
          color: colors[kind],
          transparent: true,
          opacity: 0,
          depthWrite: false,
        })
        const line = new THREE.Line(geo, mat)
        line.renderOrder = 900
        g.add(line)

        const mid = posA.clone().lerp(posB, 0.5)
        const typeLabel = kind === 'crew' ? 'Shared type' : kind === 'revenue' ? 'Same revenue bracket' : 'Temporal chain'

        linesRef.current.push({
          line,
          kind,
          label: `${typeLabel}: ${pA.name} ↔ ${pB.name}`,
          midScreen: { x: 0, y: 0, inView: false },
        })

        // Temporal arrow indicator (small sphere midpoint)
        if (kind === 'temporal') {
          const arrowGeo = new THREE.SphereGeometry(0.12, 6, 4)
          const arrowMat = new THREE.MeshBasicMaterial({
            color: 0x00e5cc,
            transparent: true,
            opacity: 0,
          })
          const arrow = new THREE.Mesh(arrowGeo, arrowMat)
          arrow.position.copy(mid)
          arrow.renderOrder = 904
          g.add(arrow)
        }
      }

      // Type-based lines (proxy for "shared crew")
      const byType = new Map<string, NWProject[]>()
      projects.forEach(p => {
        const t = p.type ?? 'unknown'
        if (!byType.has(t)) byType.set(t, [])
        byType.get(t)!.push(p)
      })
      byType.forEach(grp => {
        for (let i = 0; i < grp.length - 1 && i < 4; i++) {
          addLine(grp[i], grp[i + 1], 'crew')
        }
      })

      // Revenue bracket lines (gold)
      const byRev = new Map<number, NWProject[]>()
      projects.forEach(p => {
        const b = revBracket(p.contract_value)
        if (!byRev.has(b)) byRev.set(b, [])
        byRev.get(b)!.push(p)
      })
      byRev.forEach(grp => {
        if (grp.length < 2) return
        for (let i = 0; i < grp.length - 1 && i < 5; i++) {
          addLine(grp[i], grp[i + 1], 'revenue')
        }
      })

      // Temporal dependency chain (teal) — sort by created_at
      const sorted = [...projects].sort((a, b) => {
        const ta = a.created_at ? new Date(a.created_at).getTime() : 0
        const tb = b.created_at ? new Date(b.created_at).getTime() : 0
        return ta - tb
      })
      for (let i = 0; i < sorted.length - 1 && i < 6; i++) {
        addLine(sorted[i], sorted[i + 1], 'temporal')
      }

      // ── Constellation group labels ─────────────────────────────────────
      const newGroups: ConstellationGroup[] = []

      // Client clusters
      const byClient = new Map<string, NWProject[]>()
      projects.forEach(p => {
        if (!p.client_id) return
        if (!byClient.has(p.client_id)) byClient.set(p.client_id, [])
        byClient.get(p.client_id)!.push(p)
      })
      byClient.forEach((grp, clientId) => {
        const name = autoConstellationName(grp, `client_${clientId}`)
        const cx = grp.reduce((s, p) => s + seededPosition(p.id).x, 0) / grp.length
        const cz = grp.reduce((s, p) => s + seededPosition(p.id).z, 0) / grp.length
        newGroups.push({
          name,
          centerScreen: { x: 0, y: 0, inView: false },
          projects: grp,
        })
        // Store 3D center for screen projection
        ;(newGroups[newGroups.length - 1] as ConstellationGroup & { _world3D?: THREE.Vector3 })._world3D =
          new THREE.Vector3(cx, STAR_Y + 8, cz)
      })

      // Type groups without a client
      byType.forEach((grp, type) => {
        if (grp.length < 2) return
        const name = autoConstellationName(grp, `type_${type}`)
        const cx = grp.reduce((s, p) => s + seededPosition(p.id).x, 0) / grp.length
        const cz = grp.reduce((s, p) => s + seededPosition(p.id).z, 0) / grp.length
        newGroups.push({
          name,
          centerScreen: { x: 0, y: 0, inView: false },
          projects: grp,
        })
        ;(newGroups[newGroups.length - 1] as ConstellationGroup & { _world3D?: THREE.Vector3 })._world3D =
          new THREE.Vector3(cx, STAR_Y + 10, cz)
      })

      // Solo projects (no client, no type group)
      const grouped = new Set<string>([
        ...Array.from(byClient.values()).flat().map(p => p.id),
        ...Array.from(byType.values()).filter(g => g.length >= 2).flat().map(p => p.id),
      ])
      projects.filter(p => !grouped.has(p.id)).forEach(p => {
        const pos = seededPosition(p.id)
        newGroups.push({
          name: autoConstellationName([p], `solo_${p.id}`),
          centerScreen: { x: 0, y: 0, inView: false },
          projects: [p],
        })
        ;(newGroups[newGroups.length - 1] as ConstellationGroup & { _world3D?: THREE.Vector3 })._world3D =
          new THREE.Vector3(pos.x, STAR_Y + 6, pos.z)
      })

      setGroups(newGroups)
    })

    return () => unsub()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene])

  // ── Per-frame animation ─────────────────────────────────────────────────
  useEffect(() => {
    const _tempV3    = new THREE.Vector3()
    const _tempNDC   = new THREE.Vector3()

    function projectToScreen(worldPos: THREE.Vector3): { x: number; y: number; inView: boolean } {
      _tempNDC.copy(worldPos).project(camera)
      const w = renderer.domElement.clientWidth  || renderer.domElement.width
      const h = renderer.domElement.clientHeight || renderer.domElement.height
      const x = (_tempNDC.x * 0.5 + 0.5) * w
      const y = (1 - (_tempNDC.y * 0.5 + 0.5)) * h
      const inView = _tempNDC.z < 1 && Math.abs(_tempNDC.x) < 1.2 && Math.abs(_tempNDC.y) < 1.2
      return { x, y, inView }
    }

    function onFrame() {
      if (!visible) return

      const t = performance.now() / 1000
      const f = orbitFade(orbitRadiusRef.current)
      fadeRef.current = f

      setFade(f)

      if (f <= 0) {
        // Fully hidden — ensure everything is invisible
        if (overlayRef.current) {
          (overlayRef.current.material as THREE.MeshBasicMaterial).opacity = 0
        }
        if (milkyWayRef.current) {
          (milkyWayRef.current.material as THREE.MeshBasicMaterial).opacity = 0
        }
        starsRef.current.forEach(s => {
          const mat = s.mesh.material as THREE.MeshStandardMaterial
          mat.opacity = 0
          const halo = s.mesh.children[0] as THREE.Mesh | undefined
          if (halo) (halo.material as THREE.MeshBasicMaterial).opacity = 0
        })
        linesRef.current.forEach(l => {
          (l.line.material as THREE.LineBasicMaterial).opacity = 0
        })
        return
      }

      // Overlay (dark space plane)
      if (overlayRef.current) {
        (overlayRef.current.material as THREE.MeshBasicMaterial).opacity =
          f * OVERLAY_MAX_OPACITY
      }

      // Milky Way band
      if (milkyWayRef.current) {
        const mwMat = milkyWayRef.current.material as THREE.MeshBasicMaterial
        mwMat.opacity = f * 0.12 + Math.sin(t * 0.3) * 0.02 * f
      }

      // Stars
      starsRef.current.forEach((s, i) => {
        const mat = s.mesh.material as THREE.MeshStandardMaterial
        const twinkle = 0.75 + 0.25 * Math.sin(t * (1.2 + seedFloat(s.project.id) * 0.8) + i * 1.7)
        mat.opacity = f * twinkle
        mat.emissiveIntensity = 1.5 + 0.5 * twinkle

        // Halo glow
        const halo = s.mesh.children[0] as THREE.Mesh | undefined
        if (halo) {
          (halo.material as THREE.MeshBasicMaterial).opacity = f * 0.18 * twinkle
        }

        // Slow float drift
        s.mesh.position.y = s.worldPos.y + Math.sin(t * 0.4 + i * 0.7) * 0.8

        // Project to screen
        _tempV3.copy(s.worldPos)
        _tempV3.y = s.mesh.position.y
        const sc = projectToScreen(_tempV3)
        s.screenX = sc.x
        s.screenY = sc.y
        s.inView  = sc.inView
      })

      // Lines
      linesRef.current.forEach(l => {
        const mat = l.line.material as THREE.LineBasicMaterial
        const baseOpacity = l.kind === 'crew' ? 0.35 : l.kind === 'revenue' ? 0.45 : 0.55
        mat.opacity = f * baseOpacity

        // Project midpoint
        const pts = (l.line.geometry as THREE.BufferGeometry).getAttribute('position')
        if (pts && pts.count >= 2) {
          _tempV3.set(
            (pts.getX(0) + pts.getX(1)) * 0.5,
            (pts.getY(0) + pts.getY(1)) * 0.5,
            (pts.getZ(0) + pts.getZ(1)) * 0.5,
          )
          const sc = projectToScreen(_tempV3)
          l.midScreen.x = sc.x
          l.midScreen.y = sc.y
          l.midScreen.inView = sc.inView
        }
      })

      // Constellation group labels — project their 3D centers
      setGroups(prev => prev.map(g => {
        const w3d = (g as ConstellationGroup & { _world3D?: THREE.Vector3 })._world3D
        if (!w3d) return g
        const sc = projectToScreen(w3d)
        return {
          ...g,
          _world3D: w3d,
          centerScreen: sc,
        } as ConstellationGroup
      }))
    }

    window.addEventListener('nw:frame', onFrame)
    return () => window.removeEventListener('nw:frame', onFrame)
  }, [visible, camera, renderer])

  // ── Visibility sync ───────────────────────────────────────────────────────
  useEffect(() => {
    if (groupRef.current) {
      groupRef.current.visible = visible
    }
  }, [visible])

  // ── Raycasting: click + double-click on stars ─────────────────────────────
  const lastClickTime = useRef(0)
  const lastClickId   = useRef('')

  const handleCanvasClick = useCallback((e: MouseEvent) => {
    if (!visible || fade <= 0.1) return
    const canvas = renderer.domElement
    const rect   = canvas.getBoundingClientRect()

    // Normalize mouse to NDC
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width)  * 2 - 1,
      -((e.clientY - rect.top)  / rect.height) * 2 + 1,
    )

    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(mouse, camera)

    const meshes = starsRef.current.map(s => s.mesh)
    const hits   = raycaster.intersectObjects(meshes, false)

    if (hits.length > 0) {
      const hitMesh = hits[0].object as THREE.Mesh
      const star = starsRef.current.find(s => s.mesh === hitMesh)
      if (!star) return

      const now = Date.now()
      if (now - lastClickTime.current < 400 && lastClickId.current === star.project.id) {
        // Double-click → zoom back in
        const pos = seededPosition(star.project.id)
        window.dispatchEvent(new CustomEvent('nw:constellation-zoom-in', {
          detail: { x: pos.x, y: 0, z: pos.z, projectId: star.project.id },
        }))
        setHud({ type: null, x: 0, y: 0, title: '', subtitle: '' })
      } else {
        // Single click → show HUD
        const val = star.project.contract_value > 0
          ? `$${(star.project.contract_value / 1000).toFixed(0)}k`
          : 'N/A'
        setHud({
          type: 'star',
          x: star.screenX,
          y: star.screenY,
          title: star.project.name,
          subtitle: `${star.project.type ?? 'project'} · ${val}`,
        })
      }

      lastClickTime.current = now
      lastClickId.current   = star.project.id
      return
    }

    // Check line hits (approximate: screen-space distance to midpoints)
    for (const l of linesRef.current) {
      if (!l.midScreen.inView) continue
      const dx = e.clientX - l.midScreen.x
      const dy = e.clientY - l.midScreen.y
      if (Math.sqrt(dx * dx + dy * dy) < 22) {
        setHud({
          type: 'line',
          x: l.midScreen.x,
          y: l.midScreen.y,
          title: l.kind === 'crew' ? 'Shared Crew Type' : l.kind === 'revenue' ? 'Revenue Bracket' : 'Temporal Chain',
          subtitle: l.label,
        })
        return
      }
    }

    // Miss — hide HUD
    setHud({ type: null, x: 0, y: 0, title: '', subtitle: '' })
  }, [visible, fade, camera, renderer])

  useEffect(() => {
    const canvas = renderer.domElement
    canvas.addEventListener('click', handleCanvasClick)
    return () => canvas.removeEventListener('click', handleCanvasClick)
  }, [renderer, handleCanvasClick])

  // ── Zoom-in listener: when nw:constellation-zoom-in is dispatched,
  //    we scroll back by programmatically setting orbit radius (dispatch
  //    nw:set-orbit-radius so CameraController can consume it) ──────────────
  useEffect(() => {
    function onZoomIn(e: Event) {
      const ev = e as CustomEvent<{ x: number; y: number; z: number }>
      // Dispatch a request to CameraController to zoom in
      window.dispatchEvent(new CustomEvent('nw:set-orbit-radius', {
        detail: { radius: 40, target: { x: ev.detail.x, y: ev.detail.y, z: ev.detail.z } },
      }))
    }
    window.addEventListener('nw:constellation-zoom-in', onZoomIn)
    return () => window.removeEventListener('nw:constellation-zoom-in', onZoomIn)
  }, [])

  // ── Dispose on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      starsRef.current.forEach(s => {
        s.mesh.geometry.dispose()
        ;(s.mesh.material as THREE.Material).dispose()
        s.mesh.children.forEach(c => {
          ;(c as THREE.Mesh).geometry?.dispose()
          ;(((c as THREE.Mesh).material) as THREE.Material)?.dispose()
        })
      })
      linesRef.current.forEach(l => {
        l.line.geometry.dispose()
        ;(l.line.material as THREE.Material).dispose()
      })
    }
  }, [])

  // ── React HTML overlay ───────────────────────────────────────────────────
  if (!visible || fade < 0.05) return null

  return (
    <>
      {/* ── Constellation group labels ── */}
      {groups.map((g, i) => {
        const sc = g.centerScreen
        if (!sc.inView || fade < 0.3) return null
        const labelOpacity = Math.max(0, (fade - 0.3) / 0.7)

        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: sc.x,
              top: sc.y,
              transform: 'translate(-50%, -50%)',
              pointerEvents: 'none',
              opacity: labelOpacity,
              transition: 'opacity 0.4s',
              zIndex: 60,
            }}
          >
            <div style={{
              fontFamily: 'monospace',
              fontSize: 10,
              letterSpacing: 2,
              color: 'rgba(180, 200, 255, 0.85)',
              textTransform: 'uppercase',
              textShadow: '0 0 8px rgba(100, 150, 255, 0.9)',
              whiteSpace: 'nowrap',
              userSelect: 'none',
            }}>
              ✦ {g.name}
            </div>
          </div>
        )
      })}

      {/* ── Click HUD ── */}
      {hud.type && (
        <div
          style={{
            position: 'absolute',
            left: Math.min(hud.x + 14, (renderer.domElement.clientWidth || 800) - 220),
            top: Math.max(hud.y - 36, 8),
            zIndex: 80,
            pointerEvents: 'none',
          }}
        >
          <div style={{
            background: 'rgba(4, 8, 24, 0.92)',
            border: `1px solid ${hud.type === 'star' ? 'rgba(100, 160, 255, 0.7)' : hud.type === 'line' ? 'rgba(255, 215, 0, 0.6)' : 'rgba(0, 229, 204, 0.6)'}`,
            borderRadius: 6,
            padding: '8px 12px',
            backdropFilter: 'blur(8px)',
            maxWidth: 210,
          }}>
            <div style={{
              fontFamily: 'monospace',
              fontSize: 11,
              fontWeight: 700,
              color: hud.type === 'star' ? '#88bbff' : hud.type === 'line' ? '#ffd700' : '#00e5cc',
              letterSpacing: 1,
              marginBottom: 3,
            }}>
              {hud.type === 'star' ? '★' : hud.type === 'line' ? '─' : '◈'} {hud.title}
            </div>
            <div style={{
              fontFamily: 'monospace',
              fontSize: 9,
              color: 'rgba(180, 200, 255, 0.7)',
              letterSpacing: 0.5,
            }}>
              {hud.subtitle}
            </div>
            {hud.type === 'star' && (
              <div style={{
                fontFamily: 'monospace',
                fontSize: 8,
                color: 'rgba(100, 120, 180, 0.55)',
                marginTop: 5,
                letterSpacing: 0.5,
              }}>
                DOUBLE-CLICK TO ZOOM IN
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Mode badge ── */}
      {fade > 0.6 && (
        <div
          style={{
            position: 'absolute',
            top: 14,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 65,
            pointerEvents: 'none',
            opacity: Math.min(1, (fade - 0.6) / 0.4),
            transition: 'opacity 0.5s',
          }}
        >
          <div style={{
            background: 'rgba(2, 4, 18, 0.88)',
            border: '1px solid rgba(80, 120, 220, 0.5)',
            borderRadius: 4,
            padding: '5px 14px',
            fontFamily: 'monospace',
            fontSize: 9,
            letterSpacing: 3,
            color: 'rgba(140, 180, 255, 0.75)',
            backdropFilter: 'blur(6px)',
          }}>
            ✦ CONSTELLATION VIEW
          </div>
        </div>
      )}
    </>
  )
}

export default ConstellationModeLayer
