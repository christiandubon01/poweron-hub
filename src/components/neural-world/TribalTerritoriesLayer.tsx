/**
 * TribalTerritoriesLayer.tsx — NW72: Crew tribal territory boundaries.
 *
 * Each crew member gets a territory that encloses all their assigned projects,
 * rendered as a ground-plane overlay on the Neural World west continent.
 *
 * Features:
 *   • Convex hull of project world positions + padding, smoothed with CatmullRom
 *   • 10-color palette cycling per crew member
 *   • Fill: 15% opacity · Border: 80% opacity
 *   • Overlap zones: shared-project positions highlighted with blended bright discs
 *   • Lone wolf (1 project): small isolated pulsing circle — flag for reassignment
 *   • Overextended (>50% world X span): red border pulse animation
 *   • Click territory fill mesh → detail panel (crew, projects, hours, utilisation)
 *   • Toggle: all-territories overlay vs. individual-crew focus mode
 *   • Data: crew_assignments table (crew_name, project_id, hours_per_week) via Supabase
 *           + DataBridge projects for seeded world positions
 */

import React, { useEffect, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import { useWorldContext } from './WorldContext'
import {
  subscribeWorldData,
  seededPosition,
  type NWWorldData,
  type NWProject,
} from './DataBridge'
import { supabase } from '@/lib/supabase'

// ── Types ─────────────────────────────────────────────────────────────────────

interface CrewAssignment {
  crew_name: string
  project_id: string
  hours_per_week: number
}

interface Point2D {
  x: number
  z: number
}

interface CrewTerritoryData {
  crewName: string
  projectIds: string[]
  hoursPerWeek: number[]
  positions: Point2D[]          // world-space project positions
  smoothHull: THREE.Vector3[]   // CatmullRom-smoothed hull points
  centroid: Point2D
  spanX: number                 // territory X extent
  isLoneWolf: boolean           // only 1 project
  isOverextended: boolean       // spans >50% of west-continent width
  colorThree: number            // Three.js hex color
  colorCSS: string              // CSS hex string
}

interface TerritoryEntry {
  fillMesh: THREE.Mesh
  borderLine: THREE.LineLoop
  loneWolfRing: THREE.LineLoop | null
  animTime: number
  data: CrewTerritoryData
}

interface SelectedInfo {
  crewName: string
  projectIds: string[]
  projectNames: string[]
  totalHoursPerWeek: number
  utilizationRate: number       // (totalHoursPerWeek / 40) clamped 0–1
  isLoneWolf: boolean
  isOverextended: boolean
  colorCSS: string
}

type ViewMode = 'all' | 'individual'

// ── Constants ─────────────────────────────────────────────────────────────────

const TERRITORY_Y        = 0.12   // just above ground (customer territories at 0.05)
const HULL_PADDING       = 10     // world units outward from hull vertices
const LONE_WOLF_RADIUS   = 8      // circle radius for lone-wolf territories
const LONE_WOLF_SEGMENTS = 32
const SMOOTH_SEGMENTS    = 64     // CatmullRom curve output points
const OVERLAP_DISC_R     = 3.5    // radius of shared-project highlight disc
const OVERLAP_DISC_SEGS  = 16
const MAX_HOURS_WEEK     = 40     // 100% utilisation denominator
// West continent project X range: -35 to -185 = 150 units wide
const WORLD_X_SPAN       = 150
const OVEREXTEND_THRESH  = WORLD_X_SPAN * 0.5   // 75 units

/** 10 visually distinct, saturated game-palette colours */
const CREW_PALETTE_THREE: number[] = [
  0x00ffcc,   // teal
  0xff6b35,   // orange
  0x7b2fff,   // purple
  0xffe135,   // yellow
  0x00b4d8,   // cyan
  0xff3366,   // pink-red
  0x44cf6c,   // green
  0xff9f1c,   // amber
  0xa8dadc,   // powder-blue
  0xf72585,   // hot-pink
]

const CREW_PALETTE_CSS: string[] = [
  '#00ffcc',
  '#ff6b35',
  '#7b2fff',
  '#ffe135',
  '#00b4d8',
  '#ff3366',
  '#44cf6c',
  '#ff9f1c',
  '#a8dadc',
  '#f72585',
]

// ── Geometry helpers ──────────────────────────────────────────────────────────

/** Graham-scan convex hull in XZ plane. Returns CCW hull vertices. */
function convexHull2D(points: Point2D[]): Point2D[] {
  if (points.length <= 2) return [...points]

  // Find the lowest-Z anchor (leftmost on tie)
  let anchor = points[0]
  for (const p of points) {
    if (p.z < anchor.z || (p.z === anchor.z && p.x < anchor.x)) anchor = p
  }

  const rest = points.filter(p => p !== anchor)
  rest.sort((a, b) => {
    const aa = Math.atan2(a.z - anchor.z, a.x - anchor.x)
    const ab = Math.atan2(b.z - anchor.z, b.x - anchor.x)
    return aa - ab
  })

  const hull: Point2D[] = [anchor]
  for (const p of rest) {
    while (hull.length >= 2) {
      const o = hull[hull.length - 2]!
      const a = hull[hull.length - 1]!
      const cross = (a.x - o.x) * (p.z - o.z) - (a.z - o.z) * (p.x - o.x)
      if (cross <= 0) hull.pop()
      else break
    }
    hull.push(p)
  }
  return hull
}

/** Expand hull outward from centroid by `padding` world units. */
function expandHull(hull: Point2D[], padding: number): Point2D[] {
  if (hull.length === 0) return hull
  const cx = hull.reduce((s, p) => s + p.x, 0) / hull.length
  const cz = hull.reduce((s, p) => s + p.z, 0) / hull.length

  return hull.map(p => {
    const dx = p.x - cx
    const dz = p.z - cz
    const dist = Math.sqrt(dx * dx + dz * dz)
    if (dist < 0.001) return { x: cx + padding, z: cz }
    const factor = (dist + padding) / dist
    return { x: cx + dx * factor, z: cz + dz * factor }
  })
}

/** Generate a circle as a hull approximation for lone-wolf territories. */
function circleHull(cx: number, cz: number, radius: number, segments: number): Point2D[] {
  const pts: Point2D[] = []
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2
    pts.push({ x: cx + Math.cos(angle) * radius, z: cz + Math.sin(angle) * radius })
  }
  return pts
}

/** Smooth hull with CatmullRom curve and return world-space Three.js vectors. */
function smoothHull(hull: Point2D[], y: number): THREE.Vector3[] {
  if (hull.length < 2) {
    return hull.map(p => new THREE.Vector3(p.x, y, p.z))
  }
  const pts3 = hull.map(p => new THREE.Vector3(p.x, y, p.z))
  const curve = new THREE.CatmullRomCurve3(pts3, true, 'catmullrom', 0.5)
  return curve.getPoints(Math.max(SMOOTH_SEGMENTS, hull.length * 6))
}

/** Build fill mesh from smooth hull using fan triangulation (works for convex shapes). */
function buildFillMesh(smoothPts: THREE.Vector3[], colorHex: number): THREE.Mesh {
  const positions: number[] = []
  const cx = smoothPts.reduce((s, p) => s + p.x, 0) / smoothPts.length
  const cz = smoothPts.reduce((s, p) => s + p.z, 0) / smoothPts.length
  const y  = TERRITORY_Y

  for (let i = 0; i < smoothPts.length; i++) {
    const a = smoothPts[i]!
    const b = smoothPts[(i + 1) % smoothPts.length]!
    positions.push(cx, y, cz, a.x, y, a.z, b.x, y, b.z)
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  const mat = new THREE.MeshBasicMaterial({
    color: colorHex,
    transparent: true,
    opacity: 0.15,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
  return new THREE.Mesh(geo, mat)
}

/** Build a LineLoop border from smooth hull points. */
function buildBorderLine(smoothPts: THREE.Vector3[], colorHex: number): THREE.LineLoop {
  const geo = new THREE.BufferGeometry().setFromPoints(smoothPts)
  const mat = new THREE.LineBasicMaterial({
    color: colorHex,
    transparent: true,
    opacity: 0.80,
    depthWrite: false,
  })
  return new THREE.LineLoop(geo, mat)
}

/** Build a pulsing lone-wolf ring (world-space circle, positioned at centroid). */
function buildLoneWolfRing(cx: number, cz: number, colorHex: number): THREE.LineLoop {
  const pts: THREE.Vector3[] = []
  for (let i = 0; i <= LONE_WOLF_SEGMENTS; i++) {
    const angle = (i / LONE_WOLF_SEGMENTS) * Math.PI * 2
    pts.push(new THREE.Vector3(
      cx + Math.cos(angle) * LONE_WOLF_RADIUS,
      TERRITORY_Y + 0.02,
      cz + Math.sin(angle) * LONE_WOLF_RADIUS,
    ))
  }
  const geo = new THREE.BufferGeometry().setFromPoints(pts)
  const mat = new THREE.LineBasicMaterial({
    color: colorHex,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  })
  return new THREE.LineLoop(geo, mat)
}

/** Build a small bright disc at a world position (shared-project overlap indicator). */
function buildOverlapDisc(x: number, z: number, color1: number, color2: number): THREE.Mesh {
  // Blend two territory colours
  const c1 = new THREE.Color(color1)
  const c2 = new THREE.Color(color2)
  const blended = c1.clone().lerp(c2, 0.5).addScalar(0.3)

  const positions: number[] = []
  const y = TERRITORY_Y + 0.04
  for (let i = 0; i < OVERLAP_DISC_SEGS; i++) {
    const a1 = (i / OVERLAP_DISC_SEGS) * Math.PI * 2
    const a2 = ((i + 1) / OVERLAP_DISC_SEGS) * Math.PI * 2
    positions.push(x, y, z)
    positions.push(x + Math.cos(a1) * OVERLAP_DISC_R, y, z + Math.sin(a1) * OVERLAP_DISC_R)
    positions.push(x + Math.cos(a2) * OVERLAP_DISC_R, y, z + Math.sin(a2) * OVERLAP_DISC_R)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  const mat = new THREE.MeshBasicMaterial({
    color: blended,
    transparent: true,
    opacity: 0.42,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
  return new THREE.Mesh(geo, mat)
}

/** Dispose a Three.js object and all its children from the scene. */
function disposeObject(scene: THREE.Scene, obj: THREE.Object3D | null): void {
  if (!obj) return
  scene.remove(obj)
  obj.traverse(child => {
    const mesh = child as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    if (mesh.material) {
      if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.dispose())
      else mesh.material.dispose()
    }
  })
}

// ── Component ─────────────────────────────────────────────────────────────────

export function TribalTerritoriesLayer() {
  const { scene, camera, renderer } = useWorldContext()

  // ── React state ────────────────────────────────────────────────────────────
  const [viewMode, setViewMode]               = useState<ViewMode>('all')
  const [activeCrewIndex, setActiveCrewIndex] = useState(0)
  const [selectedInfo, setSelectedInfo]       = useState<SelectedInfo | null>(null)

  // ── Internal refs ──────────────────────────────────────────────────────────
  const entriesRef          = useRef<Map<string, TerritoryEntry>>(new Map())
  const overlapDiscsRef     = useRef<THREE.Mesh[]>([])
  const projectsRef         = useRef<NWProject[]>([])
  const territoriesDataRef  = useRef<CrewTerritoryData[]>([])
  const frameHandlerRef     = useRef<((e: Event) => void) | null>(null)
  const meshToCrewRef       = useRef<Map<THREE.Mesh, string>>(new Map())
  const viewModeRef         = useRef<ViewMode>('all')
  const activeIndexRef      = useRef(0)
  const raycaster           = useRef(new THREE.Raycaster())
  const mouseNDC            = useRef(new THREE.Vector2())

  // Keep refs in sync with state
  useEffect(() => { viewModeRef.current = viewMode }, [viewMode])
  useEffect(() => { activeIndexRef.current = activeCrewIndex }, [activeCrewIndex])

  // ── Build territory data from assignments + projects ───────────────────────

  const buildTerritoryData = useCallback(
    (assignments: CrewAssignment[], projects: NWProject[]): CrewTerritoryData[] => {
      // Group assignments by crew name
      const crewMap = new Map<string, { projectIds: string[]; hoursPerWeek: number[] }>()
      for (const a of assignments) {
        const name = a.crew_name.trim()
        if (!name) continue
        const existing = crewMap.get(name)
        if (existing) {
          existing.projectIds.push(a.project_id)
          existing.hoursPerWeek.push(a.hours_per_week)
        } else {
          crewMap.set(name, { projectIds: [a.project_id], hoursPerWeek: [a.hours_per_week] })
        }
      }

      const projectIdToName = new Map(projects.map(p => [p.id, p.name]))
      const territories: CrewTerritoryData[] = []
      let colorIdx = 0

      for (const [crewName, { projectIds, hoursPerWeek }] of crewMap) {
        // World positions for this crew's projects
        const positions: Point2D[] = projectIds.map(id => seededPosition(id))

        // Derive centroid
        const cx = positions.length > 0
          ? positions.reduce((s, p) => s + p.x, 0) / positions.length
          : -110
        const cz = positions.length > 0
          ? positions.reduce((s, p) => s + p.z, 0) / positions.length
          : 0

        const isLoneWolf = projectIds.length === 1

        let hull: Point2D[]
        let expandedHull: Point2D[]

        if (isLoneWolf) {
          // Single-project: use a small isolated circle
          expandedHull = circleHull(cx, cz, LONE_WOLF_RADIUS, LONE_WOLF_SEGMENTS)
          hull = expandedHull
        } else {
          hull = convexHull2D(positions)
          expandedHull = expandHull(hull.length >= 3 ? hull : positions, HULL_PADDING)
        }

        const smoothed = smoothHull(expandedHull, TERRITORY_Y)

        // Compute X span for overextended detection
        const xs = expandedHull.map(p => p.x)
        const spanX = xs.length > 0 ? Math.max(...xs) - Math.min(...xs) : 0
        const isOverextended = spanX > OVEREXTEND_THRESH

        const colorThree = CREW_PALETTE_THREE[colorIdx % CREW_PALETTE_THREE.length]!
        const colorCSS   = CREW_PALETTE_CSS[colorIdx % CREW_PALETTE_CSS.length]!
        colorIdx++

        territories.push({
          crewName,
          projectIds,
          hoursPerWeek,
          positions,
          smoothHull: smoothed,
          centroid: { x: cx, z: cz },
          spanX,
          isLoneWolf,
          isOverextended,
          colorThree,
          colorCSS,
        })
      }

      return territories
    },
    [],
  )

  // ── Render territories into scene ─────────────────────────────────────────

  const renderTerritories = useCallback(
    (territories: CrewTerritoryData[]) => {
      // Dispose existing
      for (const [, entry] of entriesRef.current) {
        disposeObject(scene, entry.fillMesh)
        disposeObject(scene, entry.borderLine)
        if (entry.loneWolfRing) disposeObject(scene, entry.loneWolfRing)
      }
      entriesRef.current.clear()
      meshToCrewRef.current.clear()

      for (const disc of overlapDiscsRef.current) {
        disposeObject(scene, disc)
      }
      overlapDiscsRef.current = []

      // Add overlap discs for shared projects between each pair of territories
      for (let i = 0; i < territories.length; i++) {
        for (let j = i + 1; j < territories.length; j++) {
          const a = territories[i]!
          const b = territories[j]!
          const sharedIds = a.projectIds.filter(id => b.projectIds.includes(id))
          for (const id of sharedIds) {
            const pos = seededPosition(id)
            const disc = buildOverlapDisc(pos.x, pos.z, a.colorThree, b.colorThree)
            scene.add(disc)
            overlapDiscsRef.current.push(disc)
          }
        }
      }

      // Build and add each territory
      for (const td of territories) {
        const fillMesh   = buildFillMesh(td.smoothHull, td.colorThree)
        const borderLine = buildBorderLine(td.smoothHull, td.colorThree)

        let loneWolfRing: THREE.LineLoop | null = null
        if (td.isLoneWolf) {
          loneWolfRing = buildLoneWolfRing(td.centroid.x, td.centroid.z, td.colorThree)
          scene.add(loneWolfRing)
        }

        scene.add(fillMesh)
        scene.add(borderLine)

        meshToCrewRef.current.set(fillMesh, td.crewName)

        entriesRef.current.set(td.crewName, {
          fillMesh,
          borderLine,
          loneWolfRing,
          animTime: Math.random() * Math.PI * 2,
          data: td,
        })
      }

      // Apply initial visibility based on view mode
      applyViewMode(viewModeRef.current, activeIndexRef.current, territories)
    },
    [scene],
  )

  // ── View mode visibility logic ────────────────────────────────────────────

  const applyViewMode = useCallback(
    (mode: ViewMode, activeIdx: number, territories: CrewTerritoryData[]) => {
      let idx = 0
      for (const [crewName, entry] of entriesRef.current) {
        const isActive = mode === 'all' || idx === activeIdx
        entry.fillMesh.visible   = isActive
        entry.borderLine.visible = isActive
        if (entry.loneWolfRing) entry.loneWolfRing.visible = isActive
        idx++
      }
      // Overlap discs only in 'all' mode
      for (const disc of overlapDiscsRef.current) {
        disc.visible = mode === 'all'
      }
    },
    [],
  )

  // Keep view mode applied whenever state changes
  useEffect(() => {
    applyViewMode(viewMode, activeCrewIndex, territoriesDataRef.current)
  }, [viewMode, activeCrewIndex, applyViewMode])

  // ── Frame animation handler ───────────────────────────────────────────────

  const setupFrameHandler = useCallback(() => {
    if (frameHandlerRef.current) {
      window.removeEventListener('nw:frame', frameHandlerRef.current)
    }

    const handler = () => {
      const dt = 0.016
      for (const [, entry] of entriesRef.current) {
        entry.animTime += dt

        const { data } = entry
        const borderMat = entry.borderLine.material as THREE.LineBasicMaterial

        if (data.isOverextended) {
          // Red border pulse: override colour and opacity
          const pulse = 0.5 + 0.5 * Math.sin(entry.animTime * 4.0)
          borderMat.color.setHex(0xff2222)
          borderMat.opacity = 0.55 + pulse * 0.45
        } else {
          // Ensure normal colour restored
          borderMat.color.setHex(data.colorThree)
          borderMat.opacity = 0.80
        }

        // Lone wolf ring: scale pulse
        if (entry.loneWolfRing) {
          const pulse = 0.92 + 0.08 * Math.sin(entry.animTime * 2.5)
          entry.loneWolfRing.scale.setScalar(pulse)
          const ringMat = entry.loneWolfRing.material as THREE.LineBasicMaterial
          ringMat.opacity = 0.70 + 0.30 * Math.abs(Math.sin(entry.animTime * 2.5))
        }
      }
    }

    window.addEventListener('nw:frame', handler)
    frameHandlerRef.current = handler
  }, [])

  // ── Click handler (raycasting) ────────────────────────────────────────────

  const handleClick = useCallback(
    (e: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect()
      mouseNDC.current.x = ((e.clientX - rect.left) / rect.width)  * 2 - 1
      mouseNDC.current.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1

      raycaster.current.setFromCamera(mouseNDC.current, camera)

      const fillMeshes = Array.from(meshToCrewRef.current.keys())
        .filter(m => m.visible)

      const hits = raycaster.current.intersectObjects(fillMeshes, false)
      if (hits.length === 0) {
        setSelectedInfo(null)
        return
      }

      const hitMesh = hits[0]!.object as THREE.Mesh
      const crewName = meshToCrewRef.current.get(hitMesh)
      if (!crewName) return

      const entry = entriesRef.current.get(crewName)
      if (!entry) return

      const { data } = entry
      const projectNames = data.projectIds.map(id => {
        const proj = projectsRef.current.find(p => p.id === id)
        return proj ? proj.name : id
      })
      const totalHours = data.hoursPerWeek.reduce((s, h) => s + h, 0)
      const utilizationRate = Math.min(1, totalHours / MAX_HOURS_WEEK)

      setSelectedInfo({
        crewName,
        projectIds: data.projectIds,
        projectNames,
        totalHoursPerWeek: totalHours,
        utilizationRate,
        isLoneWolf: data.isLoneWolf,
        isOverextended: data.isOverextended,
        colorCSS: data.colorCSS,
      })
    },
    [camera, renderer],
  )

  // ── Main effect: Supabase fetch + DataBridge subscription ─────────────────

  useEffect(() => {
    let assignments: CrewAssignment[] = []
    let mounted = true

    // Fetch crew_assignments from Supabase (non-fatal if table missing)
    ;(async () => {
      try {
        const { data, error } = await (supabase as any)
          .from('crew_assignments')
          .select('crew_name, project_id, hours_per_week')
          .limit(500)

        if (!mounted) return
        if (!error && Array.isArray(data)) {
          assignments = (data as any[]).map((r: any) => ({
            crew_name:     String(r.crew_name     ?? ''),
            project_id:    String(r.project_id    ?? ''),
            hours_per_week: typeof r.hours_per_week === 'number' ? r.hours_per_week : 0,
          })).filter(r => r.crew_name && r.project_id)
        }
      } catch {
        // Table doesn't exist yet — continue with empty assignments
      }

      if (!mounted) return

      // If no real assignments, synthesise from existing crew members (graceful demo)
      if (assignments.length === 0) {
        const projects = projectsRef.current
        if (projects.length > 0) {
          const fakeCrews = ['Alpha Crew', 'Beta Crew', 'Sparky']
          assignments = projects.map((p, i) => ({
            crew_name:      fakeCrews[i % fakeCrews.length]!,
            project_id:     p.id,
            hours_per_week: 20 + (i % 3) * 10,
          }))
        }
      }

      const territories = buildTerritoryData(assignments, projectsRef.current)
      territoriesDataRef.current = territories
      renderTerritories(territories)
    })()

    // DataBridge subscription: refresh territory positions when projects change
    const unsub = subscribeWorldData((data: NWWorldData) => {
      if (!mounted) return
      projectsRef.current = data.projects

      const territories = buildTerritoryData(assignments, data.projects)
      territoriesDataRef.current = territories
      renderTerritories(territories)
    })

    setupFrameHandler()
    renderer.domElement.addEventListener('click', handleClick)

    return () => {
      mounted = false
      unsub()

      // Dispose all scene objects
      for (const [, entry] of entriesRef.current) {
        disposeObject(scene, entry.fillMesh)
        disposeObject(scene, entry.borderLine)
        if (entry.loneWolfRing) disposeObject(scene, entry.loneWolfRing)
      }
      entriesRef.current.clear()
      meshToCrewRef.current.clear()

      for (const disc of overlapDiscsRef.current) {
        disposeObject(scene, disc)
      }
      overlapDiscsRef.current = []

      if (frameHandlerRef.current) {
        window.removeEventListener('nw:frame', frameHandlerRef.current)
        frameHandlerRef.current = null
      }

      renderer.domElement.removeEventListener('click', handleClick)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene])

  // ── UI helpers ────────────────────────────────────────────────────────────

  const crews = territoriesDataRef.current
  const crewCount = entriesRef.current.size

  const handleToggleMode = () => {
    setViewMode(prev => prev === 'all' ? 'individual' : 'all')
    if (viewMode === 'all') setActiveCrewIndex(0)
  }

  const handlePrevCrew = () => {
    setActiveCrewIndex(prev => (prev - 1 + crewCount) % Math.max(crewCount, 1))
  }

  const handleNextCrew = () => {
    setActiveCrewIndex(prev => (prev + 1) % Math.max(crewCount, 1))
  }

  const formatHours = (h: number) => `${h.toFixed(0)} hrs/wk`

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── View mode toggle control ───────────────────────────────────────── */}
      <div
        style={{
          position:       'fixed',
          bottom:         '130px',
          right:          '20px',
          zIndex:         300,
          display:        'flex',
          flexDirection:  'column',
          gap:            '6px',
          alignItems:     'flex-end',
        }}
      >
        <button
          onClick={handleToggleMode}
          style={{
            background:   'rgba(0,10,20,0.85)',
            border:       '1px solid rgba(0,255,180,0.35)',
            borderRadius: '8px',
            color:        '#aaffd8',
            cursor:       'pointer',
            fontSize:     '11px',
            fontFamily:   'monospace',
            fontWeight:   700,
            letterSpacing:'0.06em',
            padding:      '6px 12px',
            backdropFilter:'blur(6px)',
            transition:   'border-color 0.2s',
          }}
          title="Toggle territory view mode"
        >
          {viewMode === 'all' ? '⬛ ALL TERRITORIES' : '👤 INDIVIDUAL MODE'}
        </button>

        {viewMode === 'individual' && crewCount > 0 && (
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            <button
              onClick={handlePrevCrew}
              style={{
                background: 'rgba(0,10,20,0.85)',
                border: '1px solid rgba(0,255,180,0.25)',
                borderRadius: '6px',
                color: '#aaffd8',
                cursor: 'pointer',
                fontSize: '14px',
                padding: '4px 9px',
                fontFamily: 'monospace',
              }}
            >
              ‹
            </button>
            <span
              style={{
                fontSize: '10px',
                color: '#aaffd8',
                fontFamily: 'monospace',
                fontWeight: 700,
                background: 'rgba(0,10,20,0.75)',
                padding: '4px 8px',
                borderRadius: '5px',
                minWidth: '80px',
                textAlign: 'center',
              }}
            >
              {crews[activeCrewIndex]?.crewName ?? '—'}
            </span>
            <button
              onClick={handleNextCrew}
              style={{
                background: 'rgba(0,10,20,0.85)',
                border: '1px solid rgba(0,255,180,0.25)',
                borderRadius: '6px',
                color: '#aaffd8',
                cursor: 'pointer',
                fontSize: '14px',
                padding: '4px 9px',
                fontFamily: 'monospace',
              }}
            >
              ›
            </button>
          </div>
        )}
      </div>

      {/* ── Detail panel (appears on territory click) ──────────────────────── */}
      {selectedInfo && (
        <div
          style={{
            position:       'fixed',
            top:            '50%',
            left:           '50%',
            transform:      'translate(-50%, -50%)',
            zIndex:         500,
            background:     'rgba(0,8,18,0.92)',
            border:         `1px solid ${selectedInfo.colorCSS}55`,
            borderRadius:   '14px',
            padding:        '22px 26px',
            minWidth:       '280px',
            maxWidth:       '360px',
            backdropFilter: 'blur(14px)',
            color:          '#e8f4ff',
            fontFamily:     'monospace',
            boxShadow:      `0 0 30px ${selectedInfo.colorCSS}22`,
          }}
        >
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div
                style={{
                  width:        '10px',
                  height:       '10px',
                  borderRadius: '50%',
                  background:   selectedInfo.colorCSS,
                  boxShadow:    `0 0 8px ${selectedInfo.colorCSS}`,
                  flexShrink:   0,
                }}
              />
              <span
                style={{
                  fontSize:    '13px',
                  fontWeight:  700,
                  color:       selectedInfo.colorCSS,
                  letterSpacing:'0.08em',
                  textTransform:'uppercase',
                }}
              >
                {selectedInfo.crewName}
              </span>
            </div>
            <button
              onClick={() => setSelectedInfo(null)}
              style={{
                background:   'transparent',
                border:       'none',
                color:        '#667',
                cursor:       'pointer',
                fontSize:     '16px',
                lineHeight:   1,
                padding:      '0 2px',
              }}
              title="Close"
            >
              ✕
            </button>
          </div>

          {/* Warning badges */}
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '14px' }}>
            {selectedInfo.isLoneWolf && (
              <span
                style={{
                  background: 'rgba(255,180,0,0.15)',
                  border:     '1px solid rgba(255,180,0,0.5)',
                  borderRadius:'5px',
                  color:      '#ffb400',
                  fontSize:   '10px',
                  fontWeight: 700,
                  padding:    '3px 8px',
                  letterSpacing:'0.05em',
                }}
              >
                ⚠ LONE WOLF — CONSIDER REASSIGNING
              </span>
            )}
            {selectedInfo.isOverextended && (
              <span
                style={{
                  background: 'rgba(255,34,34,0.15)',
                  border:     '1px solid rgba(255,34,34,0.55)',
                  borderRadius:'5px',
                  color:      '#ff4444',
                  fontSize:   '10px',
                  fontWeight: 700,
                  padding:    '3px 8px',
                  letterSpacing:'0.05em',
                }}
              >
                🔴 OVEREXTENDED — TOO SPREAD OUT
              </span>
            )}
          </div>

          {/* Stats row */}
          <div
            style={{
              display:             'grid',
              gridTemplateColumns: '1fr 1fr',
              gap:                 '10px',
              marginBottom:        '14px',
            }}
          >
            {[
              { label: 'PROJECTS',    value: String(selectedInfo.projectIds.length) },
              { label: 'HOURS / WK',  value: formatHours(selectedInfo.totalHoursPerWeek) },
              { label: 'UTILISATION', value: `${Math.round(selectedInfo.utilizationRate * 100)}%` },
              {
                label: 'STATUS',
                value: selectedInfo.utilizationRate >= 0.9 ? 'MAXED OUT'
                     : selectedInfo.utilizationRate >= 0.6 ? 'ACTIVE'
                     : 'AVAILABLE',
              },
            ].map(({ label, value }) => (
              <div
                key={label}
                style={{
                  background:   'rgba(255,255,255,0.04)',
                  border:       '1px solid rgba(255,255,255,0.08)',
                  borderRadius: '8px',
                  padding:      '8px 10px',
                }}
              >
                <div style={{ fontSize: '9px', color: '#556', letterSpacing: '0.1em', marginBottom: '3px' }}>
                  {label}
                </div>
                <div
                  style={{
                    fontSize:  '13px',
                    fontWeight: 700,
                    color:     label === 'STATUS' && selectedInfo.utilizationRate >= 0.9
                               ? '#ff4444'
                               : selectedInfo.colorCSS,
                  }}
                >
                  {value}
                </div>
              </div>
            ))}
          </div>

          {/* Utilisation bar */}
          <div style={{ marginBottom: '14px' }}>
            <div style={{ fontSize: '9px', color: '#556', letterSpacing: '0.1em', marginBottom: '5px' }}>
              UTILISATION RATE
            </div>
            <div
              style={{
                background:   'rgba(255,255,255,0.07)',
                borderRadius: '4px',
                height:       '6px',
                overflow:     'hidden',
              }}
            >
              <div
                style={{
                  width:        `${Math.round(selectedInfo.utilizationRate * 100)}%`,
                  height:       '100%',
                  background:   selectedInfo.utilizationRate >= 0.9
                                ? 'linear-gradient(90deg,#ff4444,#ff8888)'
                                : `linear-gradient(90deg,${selectedInfo.colorCSS}88,${selectedInfo.colorCSS})`,
                  borderRadius: '4px',
                  transition:   'width 0.3s ease',
                }}
              />
            </div>
          </div>

          {/* Project list */}
          <div>
            <div style={{ fontSize: '9px', color: '#556', letterSpacing: '0.1em', marginBottom: '6px' }}>
              ASSIGNED PROJECTS
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {selectedInfo.projectNames.map((name, i) => (
                <div
                  key={selectedInfo.projectIds[i] ?? i}
                  style={{
                    display:      'flex',
                    alignItems:   'center',
                    gap:          '6px',
                    fontSize:     '11px',
                    color:        '#b0c8e0',
                    background:   'rgba(255,255,255,0.03)',
                    borderRadius: '5px',
                    padding:      '4px 8px',
                  }}
                >
                  <div
                    style={{
                      width:        '5px',
                      height:       '5px',
                      borderRadius: '50%',
                      background:   selectedInfo.colorCSS,
                      flexShrink:   0,
                    }}
                  />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {name}
                  </span>
                  <span style={{ color: '#445', fontSize: '10px', flexShrink: 0 }}>
                    {formatHours(selectedInfo.totalHoursPerWeek / selectedInfo.projectIds.length)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
