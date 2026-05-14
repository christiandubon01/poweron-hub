/**
 * src/features/blueprint-vr/Blueprint3DSpaceViewer.tsx
 *
 * True 3D dollhouse viewer for the Generate VR experience.
 *
 * Renderer:
 *   - three.js WebGL renderer
 *   - PerspectiveCamera + OrbitControls (orbit, zoom, pitch with clamps)
 *   - Raycaster click → room selection
 *
 * Geometry:
 *   - Floor slab + per-room floor surfaces (color cued by room role)
 *   - Exterior + interior walls extruded from the building model
 *   - Door / window opening proxies
 *   - Salon furniture proxies (reception counter, styling stations, vanities,
 *     waiting seats, restroom fixtures, utility panel) chosen by room role
 *   - Per-stage electrical overlays (underground / roughIn / trim / finished)
 *   - Optional ceiling, dimension overlays, and room labels
 *
 * The component is a controlled view: camera preset, selected room, stage,
 * and toggles are owned by the parent panel. Internal three.js scene is rebuilt
 * deterministically on building-model changes.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { BlueprintBuildingModel, BuildingRoomModel } from './buildingModel'
import type { VRStage } from './types'
import { placeElectricalComponentsInModel } from './electrical3DPlacement'
import BlueprintVRLegend from './BlueprintVRLegend'

type CameraPreset = 'top' | 'iso' | 'room'

export interface Blueprint3DSpaceViewerProps {
  buildingModel?: BlueprintBuildingModel | null
  activeStage: VRStage
  selectedRoomId?: string | null
  onRoomSelect?: (roomId: string) => void
  showElectrical?: boolean
  showDimensions?: boolean
  showLabels?: boolean
  wallOpacity?: number
  cameraPreset?: CameraPreset
  showCeiling?: boolean
}

const STAGE_COLOR: Record<VRStage, number> = {
  underground: 0xe07020,
  roughIn: 0x3b82f6,
  trim: 0x22c55e,
  finished: 0x06b6d4,
}

// ─── Color cues by room role ─────────────────────────────────────────────────

function getRoomColor(room: BuildingRoomModel): number {
  const label = room.label.toLowerCase()
  const type = room.metadata?.type || ''
  if (label.includes('reception') || label.includes('entrance')) return 0xc8a36b
  if (label.includes('waiting')) return 0xb89875
  if (label.includes('styling') || label.includes('salon') || label.includes('service area')) return 0xd9c4a2
  if (label.includes('hallway') || label.includes('circulation')) return 0x7a8a9c
  if (label.includes('bath') || label.includes('restroom') || type === 'bath') return 0x86a8c4
  if (label.includes('utility') || label.includes('panel') || type === 'utility') return 0x52606e
  if (label.includes('storage')) return 0x6b7280
  if (label.includes('back') || label.includes('service')) return 0x8a7f72
  if (type === 'kitchen') return 0xb6c4a8
  if (type === 'bedroom') return 0xc4a8b6
  if (type === 'living') return 0xd4c8a8
  return 0xa6b0bc
}

// ─── Furniture / fixture proxies per room role ───────────────────────────────

interface FurnitureSpec {
  /** Footprint relative to room bounds, in feet (centerX, centerZ, width, depth, height) */
  cx: number
  cz: number
  width: number
  depth: number
  height: number
  color: number
  label?: string
}

/**
 * Map an equipment-hint kind to a furniture spec (color / size). Used when the
 * scanner attaches hints to a room via room.equipmentHints.
 */
function hintToFurniture(
  kind: BuildingRoomModel['equipmentHints'] extends Array<infer T> | undefined
    ? T extends { kind: infer K }
      ? K
      : never
    : never,
): { color: number; width: number; depth: number; height: number } | null {
  switch (kind) {
    case 'reception-counter':
      return { color: 0x2a2118, width: 6, depth: 2, height: 3.4 }
    case 'waiting-chair':
      return { color: 0x1d2230, width: 1.8, depth: 1.8, height: 1.5 }
    case 'waiting-couch':
      return { color: 0x26303f, width: 4.5, depth: 2, height: 1.6 }
    case 'side-table':
      return { color: 0x3a2e1f, width: 1.4, depth: 1.4, height: 1.4 }
    case 'styling-chair':
      return { color: 0x2a2118, width: 2, depth: 2, height: 3.5 }
    case 'styling-mirror':
      return { color: 0x0a1018, width: 0.4, depth: 2.6, height: 4.8 }
    case 'vanity-counter':
      return { color: 0x3a2e1f, width: 2.6, depth: 1.4, height: 3 }
    case 'wash-sink':
    case 'shampoo-bowl':
      return { color: 0xd7e2ef, width: 2.2, depth: 2.6, height: 3.2 }
    case 'restroom-sink':
      return { color: 0xd7e2ef, width: 1.6, depth: 1.4, height: 2.8 }
    case 'toilet':
      return { color: 0xeef3f8, width: 1.4, depth: 2, height: 1.4 }
    case 'utility-panel':
      return { color: 0x101820, width: 1.6, depth: 0.4, height: 3 }
    case 'service-equipment':
      return { color: 0x1d2230, width: 2, depth: 1.8, height: 4 }
    case 'storage-shelving':
      return { color: 0x2b313c, width: 1.2, depth: 5, height: 6 }
    case 'storefront-sign':
      return { color: 0x6b4a26, width: 4, depth: 0.2, height: 1.2 }
    case 'decor-wall':
      return { color: 0x6b4a26, width: 4, depth: 0.4, height: 4 }
    case 'overhead-light':
    case 'track-light':
    case 'chandelier':
      return { color: 0xf2dfb0, width: 1, depth: 1, height: 0.4 }
    case 'receptacle':
    case 'switch':
    case 'gfci':
      // Electrical anchors are rendered by the stage engine, skip in furniture
      return null
    default:
      return null
  }
}

function buildRoomFurniture(room: BuildingRoomModel): FurnitureSpec[] {
  const label = room.label.toLowerCase()
  const w = room.bounds.max.x - room.bounds.min.x
  const d = room.bounds.max.y - room.bounds.min.y
  const out: FurnitureSpec[] = []

  // 1) Equipment hints from the scanner take priority — render every hint that
  //    maps to a furniture spec at its normalized position.
  const hints = room.equipmentHints || []
  let usedHints = false
  for (const hint of hints) {
    const spec = hintToFurniture(hint.kind)
    if (!spec) continue
    usedHints = true
    const nx = hint.positionNormalized?.x ?? 0.5
    const ny = hint.positionNormalized?.y ?? 0.5
    out.push({
      cx: Math.max(0.5, Math.min(w - 0.5, nx * w)),
      cz: Math.max(0.5, Math.min(d - 0.5, ny * d)),
      width: Math.min(w - 1, spec.width),
      depth: Math.min(d - 1, spec.depth),
      height: spec.height,
      color: spec.color,
      label: hint.label,
    })
  }
  if (usedHints) return out

  // 2) Otherwise fall back to label-driven proxies.
  if (label.includes('reception') || label.includes('entrance')) {
    out.push({ cx: w / 2, cz: d * 0.7, width: w * 0.6, depth: 2, height: 3.2, color: 0x2a2118, label: 'Reception Counter' })
    out.push({ cx: w * 0.2, cz: d * 0.35, width: 1.6, depth: 1.6, height: 1.6, color: 0x1d2230 })
    out.push({ cx: w * 0.5, cz: d * 0.35, width: 1.6, depth: 1.6, height: 1.6, color: 0x1d2230 })
    out.push({ cx: w * 0.8, cz: d * 0.35, width: 1.6, depth: 1.6, height: 1.6, color: 0x1d2230 })
  } else if (label.includes('waiting')) {
    out.push({ cx: w * 0.25, cz: d / 2, width: 2.2, depth: 1.8, height: 1.6, color: 0x1d2230 })
    out.push({ cx: w * 0.5, cz: d / 2, width: 2.2, depth: 1.8, height: 1.6, color: 0x1d2230 })
    out.push({ cx: w * 0.75, cz: d / 2, width: 2.2, depth: 1.8, height: 1.6, color: 0x1d2230 })
  } else if (label.includes('styling') || label.includes('salon') || label.includes('service')) {
    const stations = Math.max(3, Math.floor(d / 5))
    for (let i = 0; i < stations; i++) {
      const cz = (d / (stations + 1)) * (i + 1)
      out.push({ cx: 1.4, cz, width: 1.2, depth: 2.4, height: 4.5, color: 0x1d2230, label: 'Mirror' })
      out.push({ cx: 3, cz, width: 1.6, depth: 1.6, height: 1.6, color: 0x2a2118, label: 'Chair' })
      out.push({ cx: w - 1.4, cz, width: 1.2, depth: 2.4, height: 4.5, color: 0x1d2230 })
      out.push({ cx: w - 3, cz, width: 1.6, depth: 1.6, height: 1.6, color: 0x2a2118 })
    }
    out.push({ cx: w / 2, cz: d / 2, width: w * 0.35, depth: 2, height: 1.2, color: 0x3a2e1f, label: 'Vanity' })
  } else if (label.includes('bath') || label.includes('restroom')) {
    out.push({ cx: w * 0.3, cz: d * 0.3, width: 1.4, depth: 1.4, height: 1.4, color: 0xd7e2ef, label: 'Sink' })
    out.push({ cx: w * 0.75, cz: d * 0.35, width: 1.4, depth: 2.2, height: 1.4, color: 0xeef3f8, label: 'Toilet' })
  } else if (label.includes('utility') || label.includes('panel')) {
    out.push({ cx: w / 2, cz: 1, width: w * 0.5, depth: 0.4, height: 3, color: 0x101820, label: 'Panel' })
    out.push({ cx: 1, cz: d / 2, width: 1, depth: 1.4, height: 4, color: 0x1d2230, label: 'Rack' })
  } else if (label.includes('storage')) {
    out.push({ cx: 1, cz: d / 2, width: 1.4, depth: d * 0.8, height: 5, color: 0x2b313c, label: 'Shelving' })
    out.push({ cx: w - 1, cz: d / 2, width: 1.4, depth: d * 0.8, height: 5, color: 0x2b313c })
  } else if (label.includes('hallway') || label.includes('circulation')) {
    // Hallway intentionally clear
  } else if (label.includes('back') || label.includes('service')) {
    out.push({ cx: 1.5, cz: d * 0.3, width: 1.6, depth: 1.6, height: 1.8, color: 0x2a3140, label: 'Wash Bay' })
    out.push({ cx: w - 1.5, cz: d * 0.7, width: 2, depth: 1.6, height: 1.2, color: 0x4a3a26, label: 'Counter' })
  }
  return out
}

// ─── Helpers to build three.js geometry ──────────────────────────────────────

function createRoomFloorMesh(room: BuildingRoomModel): THREE.Mesh {
  const w = room.bounds.max.x - room.bounds.min.x
  const d = room.bounds.max.y - room.bounds.min.y
  const geom = new THREE.PlaneGeometry(w, d)
  geom.rotateX(-Math.PI / 2)
  const color = getRoomColor(room)
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.85,
    metalness: 0.05,
  })
  const mesh = new THREE.Mesh(geom, mat)
  mesh.position.set(room.bounds.min.x + w / 2, 0.01, room.bounds.min.y + d / 2)
  mesh.userData.kind = 'roomFloor'
  mesh.userData.roomId = room.id
  return mesh
}

function createSlabMesh(model: BlueprintBuildingModel): THREE.Mesh {
  const w = model.footprint.width
  const d = model.footprint.height
  const geom = new THREE.BoxGeometry(w + 1, 0.35, d + 1)
  const mat = new THREE.MeshStandardMaterial({
    color: 0x1a1f28,
    roughness: 0.95,
    metalness: 0.0,
  })
  const mesh = new THREE.Mesh(geom, mat)
  mesh.position.set(model.footprint.x + w / 2, -0.18, model.footprint.y + d / 2)
  return mesh
}

type WallKindString = 'exterior' | 'partition' | 'divider' | 'glass' | 'pony'

function createWallMesh(
  startX: number,
  startZ: number,
  endX: number,
  endZ: number,
  height: number,
  thickness: number,
  exterior: boolean,
  opacity: number,
  kind: WallKindString = exterior ? 'exterior' : 'partition',
): THREE.Mesh {
  const length = Math.hypot(endX - startX, endZ - startZ)
  // Pony walls are half-height (about 3 ft) for counter-style partitions.
  const wallHeight = kind === 'pony' ? Math.min(height, 3.2) : height
  const geom = new THREE.BoxGeometry(length, wallHeight, thickness)
  let color = exterior ? 0xece5d8 : 0xd7cebb
  let matOpacity = Math.min(1, Math.max(0.2, opacity))
  let transparent = opacity < 0.999
  if (kind === 'glass') {
    color = 0x9ec7f9
    matOpacity = 0.32
    transparent = true
  } else if (kind === 'divider') {
    color = 0x847766
    matOpacity = Math.max(0.7, matOpacity)
    transparent = true
  } else if (kind === 'pony') {
    color = 0xa89c80
  }
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: kind === 'glass' ? 0.15 : 0.9,
    metalness: kind === 'glass' ? 0.4 : 0.02,
    transparent,
    opacity: matOpacity,
  })
  const mesh = new THREE.Mesh(geom, mat)
  const midX = (startX + endX) / 2
  const midZ = (startZ + endZ) / 2
  mesh.position.set(midX, wallHeight / 2, midZ)
  const angle = Math.atan2(endZ - startZ, endX - startX)
  mesh.rotation.y = -angle
  mesh.userData.kind = kind
  mesh.userData.exterior = exterior
  return mesh
}

function createOpeningMesh(
  worldX: number,
  worldZ: number,
  widthFt: number,
  heightFt: number,
  type: 'door' | 'window',
): THREE.Mesh {
  const geom = new THREE.BoxGeometry(widthFt, heightFt, 0.7)
  const mat = new THREE.MeshStandardMaterial({
    color: type === 'window' ? 0x9ec8ff : 0xc7a973,
    transparent: true,
    opacity: type === 'window' ? 0.55 : 0.92,
    roughness: 0.4,
    metalness: 0.1,
    emissive: type === 'window' ? 0x224488 : 0x331a00,
    emissiveIntensity: 0.15,
  })
  const mesh = new THREE.Mesh(geom, mat)
  mesh.position.set(worldX, heightFt / 2, worldZ)
  return mesh
}

function createFurnitureMesh(spec: FurnitureSpec, originX: number, originZ: number): THREE.Mesh {
  const geom = new THREE.BoxGeometry(spec.width, spec.height, spec.depth)
  const mat = new THREE.MeshStandardMaterial({
    color: spec.color,
    roughness: 0.6,
    metalness: 0.15,
  })
  const mesh = new THREE.Mesh(geom, mat)
  mesh.position.set(originX + spec.cx, spec.height / 2, originZ + spec.cz)
  return mesh
}

function createElectricalMarker(
  x: number,
  z: number,
  y: number,
  color: number,
  stage: VRStage,
  category: string,
): THREE.Object3D {
  const group = new THREE.Group()
  // Differentiate visuals by stage
  if (stage === 'underground') {
    const geom = new THREE.SphereGeometry(0.22, 12, 8)
    const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.5 })
    const mesh = new THREE.Mesh(geom, mat)
    mesh.position.set(x, Math.max(-0.5, y), z)
    group.add(mesh)
    if (category.toLowerCase().includes('ground')) {
      const stub = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.05, 1.4, 8),
        new THREE.MeshStandardMaterial({ color: 0xff5252 }),
      )
      stub.position.set(x, 0.4, z)
      group.add(stub)
    }
  } else if (stage === 'roughIn') {
    const geom = new THREE.BoxGeometry(0.5, 0.7, 0.25)
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5 })
    const mesh = new THREE.Mesh(geom, mat)
    mesh.position.set(x, Math.max(1, y), z)
    group.add(mesh)
  } else if (stage === 'trim') {
    const geom = new THREE.BoxGeometry(0.4, 0.55, 0.18)
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.3 })
    const mesh = new THREE.Mesh(geom, mat)
    mesh.position.set(x, Math.max(1, y), z)
    group.add(mesh)
    const cover = new THREE.Mesh(
      new THREE.BoxGeometry(0.45, 0.6, 0.05),
      new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.2 }),
    )
    cover.position.set(x, Math.max(1, y), z + 0.08)
    group.add(cover)
  } else {
    const geom = new THREE.BoxGeometry(0.45, 0.6, 0.1)
    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.55,
      roughness: 0.25,
      metalness: 0.4,
    })
    const mesh = new THREE.Mesh(geom, mat)
    mesh.position.set(x, Math.max(1, y), z)
    group.add(mesh)
  }
  return group
}

// ─── Camera preset positions ─────────────────────────────────────────────────

function applyCameraPreset(
  controls: OrbitControls,
  camera: THREE.PerspectiveCamera,
  preset: CameraPreset,
  model: BlueprintBuildingModel | null,
  selectedRoom: BuildingRoomModel | null,
): void {
  const w = model?.footprint.width || 30
  const d = model?.footprint.height || 30
  const cx = (model?.footprint.x || 0) + w / 2
  const cz = (model?.footprint.y || 0) + d / 2

  if (preset === 'top') {
    const radius = Math.max(w, d) * 0.95
    camera.position.set(cx, radius * 1.4, cz + 0.1)
    controls.target.set(cx, 0, cz)
  } else if (preset === 'iso') {
    const radius = Math.max(w, d) * 0.95
    camera.position.set(cx - radius * 0.9, radius * 0.8, cz - radius * 0.9)
    controls.target.set(cx, 2.5, cz)
  } else if (preset === 'room' && selectedRoom) {
    const rw = selectedRoom.bounds.max.x - selectedRoom.bounds.min.x
    const rd = selectedRoom.bounds.max.y - selectedRoom.bounds.min.y
    const rcx = selectedRoom.bounds.min.x + rw / 2
    const rcz = selectedRoom.bounds.min.y + rd / 2
    const radius = Math.max(rw, rd) * 1.8 + 6
    camera.position.set(rcx - radius * 0.5, radius * 0.65, rcz - radius * 0.5)
    controls.target.set(rcx, 1.5, rcz)
  } else {
    const radius = Math.max(w, d) * 0.95
    camera.position.set(cx - radius * 0.9, radius * 0.8, cz - radius * 0.9)
    controls.target.set(cx, 2.5, cz)
  }
  controls.update()
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function Blueprint3DSpaceViewer({
  buildingModel,
  activeStage,
  selectedRoomId = null,
  onRoomSelect,
  showElectrical = true,
  showDimensions = true,
  showLabels = true,
  wallOpacity = 0.8,
  cameraPreset = 'iso',
  showCeiling = false,
}: Blueprint3DSpaceViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const overlayRef = useRef<HTMLDivElement | null>(null)

  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const buildingGroupRef = useRef<THREE.Group | null>(null)
  const stageGroupRef = useRef<THREE.Group | null>(null)
  const selectedHighlightRef = useRef<THREE.Mesh | null>(null)
  const animRef = useRef<number | null>(null)
  const roomMeshesRef = useRef<THREE.Mesh[]>([])
  const [cameraInfo, setCameraInfo] = useState<{ az: number; pitch: number; zoom: number }>({
    az: 0,
    pitch: 35,
    zoom: 30,
  })

  const electrical = useMemo(() => {
    if (!buildingModel || !showElectrical) return []
    return placeElectricalComponentsInModel(buildingModel, activeStage)
  }, [buildingModel, showElectrical, activeStage])

  const selectedRoom = useMemo(() => {
    const rooms = buildingModel?.levels[0]?.rooms || []
    return rooms.find((r) => r.id === selectedRoomId) || null
  }, [buildingModel, selectedRoomId])

  const stageColor = STAGE_COLOR[activeStage]

  // ── Init scene once ─────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return

    const width = container.clientWidth || 620
    const height = 440

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(width, height, false)
    renderer.setClearColor(0x070b12, 1)
    rendererRef.current = renderer

    const scene = new THREE.Scene()
    scene.fog = new THREE.Fog(0x070b12, 60, 200)
    sceneRef.current = scene

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.5, 500)
    camera.position.set(-30, 25, -30)
    cameraRef.current = camera

    const controls = new OrbitControls(camera, canvas)
    controls.enableDamping = true
    controls.dampingFactor = 0.12
    controls.minDistance = 6
    controls.maxDistance = 120
    controls.minPolarAngle = 0.08
    controls.maxPolarAngle = Math.PI / 2 - 0.05
    controls.target.set(0, 2.5, 0)
    controls.update()
    controlsRef.current = controls

    // Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.55)
    scene.add(ambient)
    const hemi = new THREE.HemisphereLight(0xb4dcff, 0x2a2316, 0.55)
    scene.add(hemi)
    const dir = new THREE.DirectionalLight(0xfff1d6, 1.05)
    dir.position.set(40, 70, 30)
    scene.add(dir)
    const accent = new THREE.PointLight(0x00ddcc, 0.35, 80)
    accent.position.set(0, 18, 0)
    scene.add(accent)

    const buildingGroup = new THREE.Group()
    buildingGroup.name = 'building'
    scene.add(buildingGroup)
    buildingGroupRef.current = buildingGroup

    const stageGroup = new THREE.Group()
    stageGroup.name = 'stage'
    scene.add(stageGroup)
    stageGroupRef.current = stageGroup

    // Grid as subtle ground reference
    const grid = new THREE.GridHelper(120, 60, 0x0e3038, 0x0a1018)
    ;(grid.material as THREE.Material).transparent = true
    ;(grid.material as THREE.Material).opacity = 0.45
    grid.position.y = -0.001
    scene.add(grid)

    // Render loop
    const animate = () => {
      controls.update()
      renderer.render(scene, camera)

      // Update camera info display
      const offset = new THREE.Vector3().subVectors(camera.position, controls.target)
      const radius = offset.length()
      const az = (Math.atan2(offset.x, offset.z) * 180) / Math.PI
      const pitch = (Math.acos(Math.max(-1, Math.min(1, offset.y / radius))) * 180) / Math.PI
      setCameraInfo({ az, pitch: 90 - pitch, zoom: radius })

      animRef.current = requestAnimationFrame(animate)
    }
    animate()

    // Resize handling
    const handleResize = () => {
      const c = containerRef.current
      if (!c || !rendererRef.current || !cameraRef.current) return
      const newW = c.clientWidth || 620
      const newH = 440
      rendererRef.current.setSize(newW, newH, false)
      cameraRef.current.aspect = newW / newH
      cameraRef.current.updateProjectionMatrix()
    }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      if (animRef.current !== null) cancelAnimationFrame(animRef.current)
      controls.dispose()
      renderer.dispose()
      scene.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Rebuild building geometry when model changes ────────────────────────
  useEffect(() => {
    const scene = sceneRef.current
    const buildingGroup = buildingGroupRef.current
    if (!scene || !buildingGroup) return

    // Clear previous building meshes
    while (buildingGroup.children.length > 0) {
      const child = buildingGroup.children[0]
      buildingGroup.remove(child)
      ;(child as THREE.Mesh).geometry?.dispose?.()
      const mat = (child as THREE.Mesh).material as THREE.Material | THREE.Material[]
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
      else if (mat && (mat as THREE.Material).dispose) (mat as THREE.Material).dispose()
    }
    roomMeshesRef.current = []
    selectedHighlightRef.current = null

    if (!buildingModel || (buildingModel.levels[0]?.rooms || []).length === 0) return

    // Slab
    buildingGroup.add(createSlabMesh(buildingModel))

    const wallHeight =
      buildingModel.wallHeight.unit === 'ft'
        ? buildingModel.wallHeight.value
        : buildingModel.wallHeight.value / 12

    const rooms = buildingModel.levels[0].rooms

    for (const room of rooms) {
      const floor = createRoomFloorMesh(room)
      buildingGroup.add(floor)
      roomMeshesRef.current.push(floor)
    }

    // Walls: render each unique wall once. For simplicity we render the four
    // perimeter walls of each room (interior walls naturally double up where
    // rooms touch, which gives a believable thickness).
    for (const room of rooms) {
      for (const wall of room.walls) {
        const dx = wall.end.x - wall.start.x
        const dz = wall.end.y - wall.start.y
        const length = Math.hypot(dx, dz)
        if (length < 0.5) continue
        const exterior =
          wall.start.x === buildingModel.footprint.x ||
          wall.end.x === buildingModel.footprint.x ||
          wall.start.x === buildingModel.footprint.x + buildingModel.footprint.width ||
          wall.end.x === buildingModel.footprint.x + buildingModel.footprint.width ||
          wall.start.y === buildingModel.footprint.y ||
          wall.end.y === buildingModel.footprint.y ||
          wall.start.y === buildingModel.footprint.y + buildingModel.footprint.height ||
          wall.end.y === buildingModel.footprint.y + buildingModel.footprint.height
        const thickness =
          wall.thickness.unit === 'ft'
            ? wall.thickness.value
            : wall.thickness.value / 12
        const wallKind: WallKindString =
          (wall.kind as WallKindString | undefined) ||
          (exterior ? 'exterior' : 'partition')
        // Divider walls render their actual thin thickness without a floor of 0.3.
        const minThickness = wallKind === 'divider' ? 0.12 : 0.3
        const wallMesh = createWallMesh(
          wall.start.x,
          wall.start.y,
          wall.end.x,
          wall.end.y,
          wallHeight,
          Math.max(minThickness, thickness),
          exterior,
          wallOpacity,
          wallKind,
        )
        buildingGroup.add(wallMesh)

        // Openings (door / window)
        for (const opening of wall.openings) {
          const t = Math.min(1, Math.max(0, opening.positionAlongWall.value / length))
          const ox = wall.start.x + dx * t
          const oz = wall.start.y + dz * t
          const opW =
            opening.width.unit === 'ft' ? opening.width.value : opening.width.value / 12
          const opH =
            opening.height.unit === 'ft' ? opening.height.value : opening.height.value / 12
          buildingGroup.add(createOpeningMesh(ox, oz, opW || 3, opH || 7, opening.type))
        }
      }
    }

    // Furniture proxies
    for (const room of rooms) {
      const specs = buildRoomFurniture(room)
      for (const spec of specs) {
        buildingGroup.add(createFurnitureMesh(spec, room.bounds.min.x, room.bounds.min.y))
      }
    }

    // Optional ceiling
    if (showCeiling) {
      const w = buildingModel.footprint.width
      const d = buildingModel.footprint.height
      const ceilGeo = new THREE.PlaneGeometry(w, d)
      ceilGeo.rotateX(Math.PI / 2)
      const ceilMat = new THREE.MeshStandardMaterial({
        color: 0xeae4d6,
        transparent: true,
        opacity: 0.25,
        side: THREE.DoubleSide,
      })
      const ceiling = new THREE.Mesh(ceilGeo, ceilMat)
      ceiling.position.set(
        buildingModel.footprint.x + w / 2,
        wallHeight - 0.05,
        buildingModel.footprint.y + d / 2,
      )
      buildingGroup.add(ceiling)
    }
  }, [buildingModel, wallOpacity, showCeiling])

  // ── Highlight selected room ─────────────────────────────────────────────
  useEffect(() => {
    const buildingGroup = buildingGroupRef.current
    if (!buildingGroup || !buildingModel) return
    if (selectedHighlightRef.current) {
      buildingGroup.remove(selectedHighlightRef.current)
      selectedHighlightRef.current.geometry.dispose()
      ;(selectedHighlightRef.current.material as THREE.Material).dispose()
      selectedHighlightRef.current = null
    }
    if (!selectedRoom) return
    const w = selectedRoom.bounds.max.x - selectedRoom.bounds.min.x
    const d = selectedRoom.bounds.max.y - selectedRoom.bounds.min.y
    const geom = new THREE.PlaneGeometry(w, d)
    geom.rotateX(-Math.PI / 2)
    const mat = new THREE.MeshBasicMaterial({
      color: stageColor,
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
    })
    const mesh = new THREE.Mesh(geom, mat)
    mesh.position.set(
      selectedRoom.bounds.min.x + w / 2,
      0.03,
      selectedRoom.bounds.min.y + d / 2,
    )
    mesh.renderOrder = 2
    buildingGroup.add(mesh)
    selectedHighlightRef.current = mesh
  }, [selectedRoom, stageColor, buildingModel])

  // ── Update stage overlays ──────────────────────────────────────────────
  useEffect(() => {
    const stageGroup = stageGroupRef.current
    if (!stageGroup) return
    while (stageGroup.children.length > 0) {
      const c = stageGroup.children[0]
      stageGroup.remove(c)
      c.traverse((n) => {
        const m = n as THREE.Mesh
        if (m.geometry) m.geometry.dispose()
        if (m.material) {
          const mat = m.material as THREE.Material | THREE.Material[]
          if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose())
          else (mat as THREE.Material).dispose()
        }
      })
    }
    if (!showElectrical) return
    for (const comp of electrical) {
      stageGroup.add(
        createElectricalMarker(
          comp.worldPos.x,
          comp.worldPos.z,
          comp.worldPos.y,
          stageColor,
          activeStage,
          comp.category,
        ),
      )
    }
  }, [electrical, stageColor, activeStage, showElectrical])

  // ── Camera preset handling ─────────────────────────────────────────────
  useEffect(() => {
    const camera = cameraRef.current
    const controls = controlsRef.current
    if (!camera || !controls) return
    applyCameraPreset(controls, camera, cameraPreset, buildingModel || null, selectedRoom)
  }, [cameraPreset, buildingModel, selectedRoom])

  // ── Raycaster click → room select ──────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    const camera = cameraRef.current
    if (!canvas || !camera) return

    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    let downPos: { x: number; y: number } | null = null

    const handleDown = (e: PointerEvent) => {
      downPos = { x: e.clientX, y: e.clientY }
    }
    const handleUp = (e: PointerEvent) => {
      if (!downPos) return
      const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y)
      downPos = null
      if (moved > 6) return
      const rect = canvas.getBoundingClientRect()
      ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(ndc, camera)
      const hits = raycaster.intersectObjects(roomMeshesRef.current, false)
      if (hits.length > 0) {
        const hit = hits[0].object as THREE.Mesh
        const rid = hit.userData?.roomId as string | undefined
        if (rid && onRoomSelect) onRoomSelect(rid)
      }
    }

    canvas.addEventListener('pointerdown', handleDown)
    canvas.addEventListener('pointerup', handleUp)
    return () => {
      canvas.removeEventListener('pointerdown', handleDown)
      canvas.removeEventListener('pointerup', handleUp)
    }
  }, [onRoomSelect])

  // ── Label overlay (rendered above canvas as HTML for crisp text) ───────
  const labelOverlay = useMemo(() => {
    if (!showLabels || !buildingModel) return null
    const rooms = buildingModel.levels[0]?.rooms || []
    return rooms.map((room) => {
      const w = room.bounds.max.x - room.bounds.min.x
      const d = room.bounds.max.y - room.bounds.min.y
      return (
        <RoomLabel
          key={room.id}
          room={room}
          worldX={room.bounds.min.x + w / 2}
          worldZ={room.bounds.min.y + d / 2}
          worldY={Math.min(8, (buildingModel.wallHeight.unit === 'ft' ? buildingModel.wallHeight.value : buildingModel.wallHeight.value / 12) - 1)}
          camera={cameraRef.current}
          container={overlayRef.current}
          selected={selectedRoomId === room.id}
        />
      )
    })
  }, [showLabels, buildingModel, selectedRoomId])

  return (
    <div
      style={{
        border: '1px solid rgba(0,229,204,0.14)',
        borderRadius: 8,
        overflow: 'hidden',
        background: '#070b12',
      }}
    >
      <div
        ref={containerRef}
        style={{ position: 'relative', width: '100%', height: 440, background: '#070b12' }}
      >
        <canvas
          ref={canvasRef}
          style={{ display: 'block', width: '100%', height: '100%', cursor: 'grab' }}
          onMouseDown={(e) => {
            ;(e.currentTarget as HTMLCanvasElement).style.cursor = 'grabbing'
          }}
          onMouseUp={(e) => {
            ;(e.currentTarget as HTMLCanvasElement).style.cursor = 'grab'
          }}
        />
        <div
          ref={overlayRef}
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
        >
          {labelOverlay}
          {showDimensions && buildingModel && (
            <div
              style={{
                position: 'absolute',
                left: 12,
                bottom: 12,
                fontFamily: 'monospace',
                fontSize: 11,
                background: 'rgba(4,10,18,0.7)',
                border: '1px solid rgba(0,229,204,0.18)',
                color: '#7be5d8',
                padding: '6px 10px',
                borderRadius: 4,
              }}
            >
              <div>
                <span style={{ opacity: 0.6 }}>SUITE&nbsp;</span>
                {Math.round(buildingModel.footprint.width)}'-0" W &nbsp;×&nbsp;{' '}
                {Math.round(buildingModel.footprint.height)}'-0" D
              </div>
              <div style={{ opacity: 0.7 }}>
                CEIL {Math.round(buildingModel.ceilingHeight.value)}' • SLAB{' '}
                {buildingModel.slabThickness?.value
                  ? `${buildingModel.slabThickness.value}${buildingModel.slabThickness.unit === 'ft' ? 'ft' : 'in'}`
                  : '4in'}
              </div>
            </div>
          )}
          <div
            style={{
              position: 'absolute',
              right: 12,
              top: 12,
              fontFamily: 'monospace',
              fontSize: 10,
              background: 'rgba(4,10,18,0.7)',
              border: '1px solid rgba(0,229,204,0.18)',
              color: 'rgba(170,220,235,0.85)',
              padding: '5px 8px',
              borderRadius: 4,
              letterSpacing: 0.4,
            }}
          >
            <div>{activeStage.toUpperCase()} STAGE</div>
            <div style={{ opacity: 0.7 }}>
              az {cameraInfo.az.toFixed(0)}° · pitch {cameraInfo.pitch.toFixed(0)}° · zoom{' '}
              {cameraInfo.zoom.toFixed(0)} ft
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 8,
          padding: '7px 10px',
          borderTop: '1px solid rgba(0,229,204,0.12)',
        }}
      >
        <div style={{ color: 'rgba(255,255,255,0.7)', fontFamily: 'monospace', fontSize: 10 }}>
          Dollhouse • Drag to orbit · Vertical drag for pitch · Scroll to zoom · Click a room to enter
        </div>
        <div
          style={{
            color: `#${stageColor.toString(16).padStart(6, '0')}c9`,
            fontFamily: 'monospace',
            fontSize: 10,
          }}
        >
          {selectedRoom ? `Focus: ${selectedRoom.label}` : 'No room selected'}
        </div>
      </div>

      <div style={{ padding: '0 10px 10px' }}>
        <BlueprintVRLegend stage={activeStage} buildingModel={buildingModel} compact />
      </div>
    </div>
  )
}

// ─── HTML-projected room label ───────────────────────────────────────────────

function RoomLabel({
  room,
  worldX,
  worldZ,
  worldY,
  camera,
  container,
  selected,
}: {
  room: BuildingRoomModel
  worldX: number
  worldZ: number
  worldY: number
  camera: THREE.PerspectiveCamera | null
  container: HTMLDivElement | null
  selected: boolean
}) {
  const [pos, setPos] = useState<{ left: number; top: number; visible: boolean }>({
    left: 0,
    top: 0,
    visible: false,
  })

  useEffect(() => {
    let raf = 0
    const project = () => {
      if (camera && container) {
        const v = new THREE.Vector3(worldX, worldY, worldZ)
        const projected = v.project(camera)
        const x = (projected.x * 0.5 + 0.5) * container.clientWidth
        const y = (-projected.y * 0.5 + 0.5) * container.clientHeight
        const visible = projected.z > -1 && projected.z < 1
        setPos({ left: x, top: y, visible })
      }
      raf = requestAnimationFrame(project)
    }
    project()
    return () => cancelAnimationFrame(raf)
  }, [camera, container, worldX, worldY, worldZ])

  if (!pos.visible) return null
  return (
    <div
      style={{
        position: 'absolute',
        left: pos.left,
        top: pos.top,
        transform: 'translate(-50%, -50%)',
        pointerEvents: 'none',
        fontFamily: 'monospace',
        fontSize: 10.5,
        letterSpacing: 0.7,
        padding: '2px 6px',
        background: selected ? 'rgba(0,221,204,0.18)' : 'rgba(8,14,22,0.65)',
        border: selected ? '1px solid rgba(0,221,204,0.55)' : '1px solid rgba(255,255,255,0.12)',
        color: selected ? '#aef7ec' : 'rgba(240,245,250,0.82)',
        borderRadius: 3,
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}
    >
      {room.label}
    </div>
  )
}
