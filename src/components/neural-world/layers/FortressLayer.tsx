/**
 * FortressLayer.tsx — NW30: Walkable Fortress Command Center.
 *
 * Replaces the flat NDA gate and IP fortress wall with a walkable
 * compound straddling the east continent boundary at x=25, z=0.
 *
 * STRUCTURE:
 *   - Outer walls: BoxGeometry perimeter (40×30 units, 8 tall). Dark metal
 *     #1a1a2e with emissive teal edge lines.
 *   - 4 corner towers: CylinderGeometry (radius 3, height 12) with PointLight.
 *   - Main gate: south-facing opening (6 units wide) integrating NDA gate arch.
 *     Red spheres (unsigned) queue outside. Green spheres (signed) pass through.
 *   - IP fortress wall: east wall of fortress. Height scales with ipFilings.
 *   - Interior courtyard: PlaneGeometry floor with subtle grid pattern.
 *   - Elevated overlook: north wall ramp + walkable platform at y=8.
 *   - OPERATOR monument relocated inside courtyard (center).
 *   - Holographic tactical table: CircleGeometry with glowing grid at y=1.5.
 *   - GUARDIAN patrols the fortress exterior perimeter.
 *
 * OVERLOOK HUD (y > 7, within fortress bounds):
 *   - Vignette CSS overlay.
 *   - Split-view HUD panel: west continent stats on left, east on right.
 *   - NEXUS companion comment bubble.
 *
 * COLLISION:
 *   - Dispatches 'nw:register-wall' events for each wall segment.
 *   - Fortress listens for 'nw:frame' to check player position and block
 *     through-wall movement (AABB-based).
 *
 * All Three.js objects are disposed on unmount.
 */

import React, { useState, useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useWorldContext } from '../WorldContext'
import { subscribeWorldData, type NWWorldData } from '../DataBridge'
import { makeLabel, type NWLabel } from '../utils/makeLabel'

// ── Fortress constants ────────────────────────────────────────────────────────

const FORTRESS_CX     = 25     // center x (straddles boundary)
const FORTRESS_CZ     = 0      // center z
const FORTRESS_W      = 40     // footprint width (x axis)
const FORTRESS_D      = 30     // footprint depth (z axis)
const WALL_H          = 8      // outer wall height
const WALL_THICK      = 1.2    // wall thickness
const TOWER_R         = 3      // corner tower radius
const TOWER_H         = 12     // corner tower height
const GATE_W          = 6      // main gate opening width
const OVERLOOK_Y      = 8      // overlook platform height

// Derived bounds
const FX_MIN = FORTRESS_CX - FORTRESS_W / 2   // 5
const FX_MAX = FORTRESS_CX + FORTRESS_W / 2   // 45
const FZ_MIN = FORTRESS_CZ - FORTRESS_D / 2   // -15
const FZ_MAX = FORTRESS_CZ + FORTRESS_D / 2   // 15

// Corner tower positions (relative to fortress center)
const CORNER_OFFSETS = [
  { x: -FORTRESS_W / 2, z: -FORTRESS_D / 2, label: 'SW' },
  { x:  FORTRESS_W / 2, z: -FORTRESS_D / 2, label: 'SE' },
  { x: -FORTRESS_W / 2, z:  FORTRESS_D / 2, label: 'NW' },
  { x:  FORTRESS_W / 2, z:  FORTRESS_D / 2, label: 'NE' },
]

// Colors
const WALL_COLOR     = 0x1a1a2e
const WALL_EMISSIVE  = 0x00e5cc
const FLOOR_COLOR    = 0x0d0d1a
const TABLE_COLOR    = 0x00e5cc
const RAMP_COLOR     = 0x12122a
const PLATFORM_COLOR = 0x0f0f22

// NEXUS overlook comments — cycling array
const NEXUS_OVERLOOK_LINES = [
  'Power On Solutions to the west — your core revenue engine.',
  'PowerOn Hub to the east — the software frontier.',
  'From here you command both continents.',
  'Watch the rivers — cash flows tell the whole story.',
  'Every mountain to the west is a project you built.',
  'The subscription towers to the east are growing.',
]

// ── Hub data type (mirrors EastContinentLayer) ────────────────────────────────

interface HubState {
  ipFilings: number
  ndaSignedCount: number
  ndaTotalCount: number
}

function getMockHubState(): HubState {
  return { ipFilings: 2, ndaSignedCount: 7, ndaTotalCount: 9 }
}

// NW31b: makeTextSprite replaced by shared makeLabel utility (see utils/makeLabel.ts)

// ── Dispose helper ─────────────────────────────────────────────────────────────

function disposeObj(scene: THREE.Scene, obj: THREE.Object3D | null): void {
  if (!obj) return
  scene.remove(obj)
  obj.traverse(child => {
    const mesh = child as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined
    if (Array.isArray(mat)) mat.forEach(m => m.dispose())
    else if (mat) mat.dispose()
    const smat = (child as THREE.Sprite).material as THREE.SpriteMaterial | undefined
    if (smat?.map) { smat.map.dispose(); smat.dispose() }
  })
}

// ── Component ──────────────────────────────────────────────────────────────────

export function FortressLayer() {
  const { scene, camera, playerPosition } = useWorldContext()

  // NW31b: all label sprites for per-frame visibility updates
  const labelSpritesRef = useRef<THREE.Sprite[]>([])

  // ── All Three.js object refs ─────────────────────────────────────────────
  const fortressGroupRef  = useRef<THREE.Group | null>(null)
  const ndaSpheresRef     = useRef<THREE.Mesh[]>([])
  const frameHandlerRef   = useRef<(() => void) | null>(null)
  const elapsedRef        = useRef(0)
  const tableLightRef     = useRef<THREE.PointLight | null>(null)
  const tableGridRef      = useRef<THREE.Mesh | null>(null)
  const cornerLightsRef   = useRef<THREE.PointLight[]>([])

  // ── HUD React state (overlook detection) ────────────────────────────────
  const [onOverlook,      setOnOverlook]      = useState(false)
  const [nexusComment,    setNexusComment]    = useState('')
  const nexusCommentIdx   = useRef(0)
  const lastCommentYRef   = useRef(-999)

  // ── World data subscription ──────────────────────────────────────────────
  const worldDataRef = useRef<NWWorldData | null>(null)
  const hubStateRef  = useRef<HubState>(getMockHubState())

  useEffect(() => {
    const unsub = subscribeWorldData(data => {
      worldDataRef.current = data
    })
    return () => unsub()
  }, [])

  // ── Build fortress on mount ──────────────────────────────────────────────
  useEffect(() => {
    buildFortress(hubStateRef.current)
    setupFrameHandler()

    return () => {
      // Cleanup
      if (frameHandlerRef.current) {
        window.removeEventListener('nw:frame', frameHandlerRef.current)
        frameHandlerRef.current = null
      }
      if (fortressGroupRef.current) {
        disposeObj(scene, fortressGroupRef.current)
        fortressGroupRef.current = null
      }
      for (const s of ndaSpheresRef.current) disposeObj(scene, s)
      ndaSpheresRef.current = []
      if (tableLightRef.current) { scene.remove(tableLightRef.current); tableLightRef.current = null }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene])

  // ── Build entire fortress ────────────────────────────────────────────────

  function buildFortress(hub: HubState) {
    if (fortressGroupRef.current) {
      disposeObj(scene, fortressGroupRef.current)
      fortressGroupRef.current = null
    }
    for (const s of ndaSpheresRef.current) disposeObj(scene, s)
    ndaSpheresRef.current = []
    // NW31b: clear label sprites before rebuild
    labelSpritesRef.current = []

    const group = new THREE.Group()
    group.position.set(0, 0, 0)  // world origin; all children use absolute coords

    // ── OUTER WALLS ──────────────────────────────────────────────────────

    const wallMat = new THREE.MeshLambertMaterial({
      color:    WALL_COLOR,
      emissive: new THREE.Color(WALL_EMISSIVE).multiplyScalar(0.08),
    })

    // Wall segments (4 sides), south wall has gate gap
    // North wall (full)
    addWallSegment(group, wallMat,
      FORTRESS_CX, WALL_H / 2, FZ_MAX,
      FORTRESS_W + WALL_THICK * 2, WALL_H, WALL_THICK,
    )

    // South wall: left half + right half (gate opening = GATE_W in center)
    const southHalfW = (FORTRESS_W - GATE_W) / 2 - WALL_THICK
    // Left half (negative x side)
    addWallSegment(group, wallMat,
      FORTRESS_CX - GATE_W / 2 - southHalfW / 2, WALL_H / 2, FZ_MIN,
      southHalfW, WALL_H, WALL_THICK,
    )
    // Right half (positive x side)
    addWallSegment(group, wallMat,
      FORTRESS_CX + GATE_W / 2 + southHalfW / 2, WALL_H / 2, FZ_MIN,
      southHalfW, WALL_H, WALL_THICK,
    )
    // Gate arch lintel above opening
    addWallSegment(group, wallMat,
      FORTRESS_CX, WALL_H - 0.5, FZ_MIN,
      GATE_W + WALL_THICK, 1.0, WALL_THICK,
    )

    // West wall (full)
    addWallSegment(group, wallMat,
      FX_MIN, WALL_H / 2, FORTRESS_CZ,
      WALL_THICK, WALL_H, FORTRESS_D,
    )

    // East wall — IP fortress integration; height scales with ipFilings
    const ipHeight = Math.max(WALL_H, WALL_H + hub.ipFilings * 1.5)
    const eastWallMat = new THREE.MeshLambertMaterial({
      color:    0x1a1a3a,
      emissive: new THREE.Color(0x4444ff).multiplyScalar(0.15),
    })
    addWallSegment(group, eastWallMat,
      FX_MAX, ipHeight / 2, FORTRESS_CZ,
      WALL_THICK, ipHeight, FORTRESS_D,
    )
    // IP label on east wall — NW31b
    const ipLabel = makeLabel(`IP FORTRESS · ${hub.ipFilings} FILINGS`, '#6688ff')
    ipLabel.position.set(FX_MAX + 0.5, ipHeight + 1.5, FORTRESS_CZ)
    group.add(ipLabel)
    labelSpritesRef.current.push(ipLabel)

    // Teal emissive edge lines along wall tops (thin flat boxes)
    const edgeMat = new THREE.MeshLambertMaterial({
      color:    0x001a18,
      emissive: new THREE.Color(WALL_EMISSIVE).multiplyScalar(0.6),
    })
    // North edge
    addEdgeLine(group, edgeMat, FORTRESS_CX, WALL_H, FZ_MAX, FORTRESS_W, 0.15, WALL_THICK * 0.5)
    // South-left edge
    addEdgeLine(group, edgeMat, FORTRESS_CX - GATE_W / 2 - southHalfW / 2, WALL_H, FZ_MIN, southHalfW, 0.15, WALL_THICK * 0.5)
    // South-right edge
    addEdgeLine(group, edgeMat, FORTRESS_CX + GATE_W / 2 + southHalfW / 2, WALL_H, FZ_MIN, southHalfW, 0.15, WALL_THICK * 0.5)
    // West edge
    addEdgeLine(group, edgeMat, FX_MIN, WALL_H, FORTRESS_CZ, WALL_THICK * 0.5, 0.15, FORTRESS_D)
    // East edge
    addEdgeLine(group, edgeMat, FX_MAX, ipHeight, FORTRESS_CZ, WALL_THICK * 0.5, 0.15, FORTRESS_D)

    // ── CORNER TOWERS ────────────────────────────────────────────────────

    cornerLightsRef.current = []
    for (const off of CORNER_OFFSETS) {
      const towerMat = new THREE.MeshLambertMaterial({
        color:    0x0d0d1f,
        emissive: new THREE.Color(WALL_EMISSIVE).multiplyScalar(0.12),
      })
      const towerGeo = new THREE.CylinderGeometry(TOWER_R * 0.6, TOWER_R, TOWER_H, 10)
      const tower    = new THREE.Mesh(towerGeo, towerMat)
      tower.position.set(FORTRESS_CX + off.x, TOWER_H / 2, FORTRESS_CZ + off.z)
      tower.castShadow = true
      group.add(tower)

      // Tower battlements (ring cap)
      const capGeo = new THREE.CylinderGeometry(TOWER_R * 0.65, TOWER_R * 0.65, 0.8, 10)
      const capMat = new THREE.MeshLambertMaterial({
        color:    0x111130,
        emissive: new THREE.Color(WALL_EMISSIVE).multiplyScalar(0.35),
      })
      const cap = new THREE.Mesh(capGeo, capMat)
      cap.position.set(FORTRESS_CX + off.x, TOWER_H + 0.4, FORTRESS_CZ + off.z)
      group.add(cap)

      // Tower top light
      const tLight = new THREE.PointLight(WALL_EMISSIVE, 1.2, 20)
      tLight.position.set(FORTRESS_CX + off.x, TOWER_H + 1.5, FORTRESS_CZ + off.z)
      scene.add(tLight)
      cornerLightsRef.current.push(tLight)
    }

    // ── COURTYARD FLOOR ──────────────────────────────────────────────────

    const floorGeo = new THREE.PlaneGeometry(FORTRESS_W - WALL_THICK * 2, FORTRESS_D - WALL_THICK * 2, 20, 15)
    const floorMat = new THREE.MeshLambertMaterial({
      color:    FLOOR_COLOR,
      emissive: new THREE.Color(0x001a14).multiplyScalar(0.4),
    })
    const floor = new THREE.Mesh(floorGeo, floorMat)
    floor.rotation.x = -Math.PI / 2
    floor.position.set(FORTRESS_CX, 0.03, FORTRESS_CZ)
    floor.receiveShadow = true
    group.add(floor)

    // Subtle grid overlay
    const gridGeo = new THREE.PlaneGeometry(FORTRESS_W - WALL_THICK * 2, FORTRESS_D - WALL_THICK * 2, 8, 6)
    const gridMat = new THREE.MeshLambertMaterial({
      color:       0x001a14,
      emissive:    new THREE.Color(WALL_EMISSIVE).multiplyScalar(0.08),
      transparent: true,
      opacity:     0.45,
      wireframe:   true,
      depthWrite:  false,
    })
    const grid = new THREE.Mesh(gridGeo, gridMat)
    grid.rotation.x = -Math.PI / 2
    grid.position.set(FORTRESS_CX, 0.05, FORTRESS_CZ)
    group.add(grid)

    // ── OVERLOOK: RAMP + PLATFORM (north wall) ───────────────────────────

    // Ramp: inclined BoxGeometry from y=0 to y=OVERLOOK_Y along z axis
    const rampLen = 14
    const rampGeo = new THREE.BoxGeometry(6, 0.4, rampLen)
    const rampMat = new THREE.MeshLambertMaterial({
      color:    RAMP_COLOR,
      emissive: new THREE.Color(WALL_EMISSIVE).multiplyScalar(0.1),
    })
    const ramp = new THREE.Mesh(rampGeo, rampMat)
    // Position at north side of courtyard, angled upward
    const rampAngle = Math.atan2(OVERLOOK_Y, rampLen)
    ramp.rotation.x = rampAngle  // tilt up toward north
    ramp.position.set(
      FORTRESS_CX,
      OVERLOOK_Y / 2,
      FZ_MAX - rampLen / 2 - WALL_THICK,
    )
    ramp.castShadow = true
    ramp.receiveShadow = true
    group.add(ramp)

    // Ramp handrail left
    const railGeo = new THREE.BoxGeometry(0.2, 0.4, rampLen + 1)
    const railMat = new THREE.MeshLambertMaterial({
      color:    0x0f0f28,
      emissive: new THREE.Color(WALL_EMISSIVE).multiplyScalar(0.3),
    })
    const railL = new THREE.Mesh(railGeo, railMat)
    railL.rotation.x = rampAngle
    railL.position.set(
      FORTRESS_CX - 3.2,
      OVERLOOK_Y / 2 + 0.8,
      FZ_MAX - rampLen / 2 - WALL_THICK,
    )
    group.add(railL)
    const railR = railL.clone()
    railR.position.x = FORTRESS_CX + 3.2
    group.add(railR)

    // Overlook platform: flat platform on top of north wall
    const platformGeo = new THREE.BoxGeometry(FORTRESS_W, 0.5, 6)
    const platformMat = new THREE.MeshLambertMaterial({
      color:    PLATFORM_COLOR,
      emissive: new THREE.Color(WALL_EMISSIVE).multiplyScalar(0.12),
    })
    const platform = new THREE.Mesh(platformGeo, platformMat)
    platform.position.set(FORTRESS_CX, OVERLOOK_Y + 0.25, FZ_MAX - 2.5)
    platform.castShadow = true
    platform.receiveShadow = true
    group.add(platform)

    // Platform edge light strip
    const platformEdgeGeo = new THREE.BoxGeometry(FORTRESS_W, 0.12, 0.2)
    const platformEdgeMat = new THREE.MeshLambertMaterial({
      color:    0x001a14,
      emissive: new THREE.Color(WALL_EMISSIVE).multiplyScalar(0.9),
    })
    const platformEdge = new THREE.Mesh(platformEdgeGeo, platformEdgeMat)
    platformEdge.position.set(FORTRESS_CX, OVERLOOK_Y + 0.56, FZ_MAX - 0.5)
    group.add(platformEdge)

    // Overlook label — NW31b
    const overlookLabel = makeLabel('⬆ OVERLOOK PLATFORM', '#00e5cc')
    overlookLabel.position.set(FORTRESS_CX, OVERLOOK_Y + 2.5, FZ_MAX - 2)
    group.add(overlookLabel)
    labelSpritesRef.current.push(overlookLabel)

    // ── HOLOGRAPHIC TACTICAL TABLE ────────────────────────────────────────

    const tableGeo = new THREE.CylinderGeometry(5, 5, 0.18, 32)
    const tableMat = new THREE.MeshLambertMaterial({
      color:       0x001510,
      emissive:    new THREE.Color(TABLE_COLOR).multiplyScalar(0.25),
      transparent: true,
      opacity:     0.82,
    })
    const table = new THREE.Mesh(tableGeo, tableMat)
    table.position.set(FORTRESS_CX, 1.5, FORTRESS_CZ)
    table.castShadow = false
    table.receiveShadow = false
    group.add(table)

    // Grid on top of table
    const tableGridGeo = new THREE.CircleGeometry(4.8, 32)
    const tableGridMat = new THREE.MeshLambertMaterial({
      color:       0x001510,
      emissive:    new THREE.Color(TABLE_COLOR).multiplyScalar(0.5),
      transparent: true,
      opacity:     0.7,
      wireframe:   true,
      depthWrite:  false,
    })
    const tableGrid = new THREE.Mesh(tableGridGeo, tableGridMat)
    tableGrid.rotation.x = -Math.PI / 2
    tableGrid.position.set(FORTRESS_CX, 1.6, FORTRESS_CZ)
    group.add(tableGrid)
    tableGridRef.current = tableGrid

    // Table glow light
    const tableLight = new THREE.PointLight(TABLE_COLOR, 1.4, 18)
    tableLight.position.set(FORTRESS_CX, 3.5, FORTRESS_CZ)
    scene.add(tableLight)
    tableLightRef.current = tableLight

    // Table label — NW31b
    const tableLabel = makeLabel('TACTICAL WAR ROOM', '#00e5cc')
    tableLabel.position.set(FORTRESS_CX, 4.2, FORTRESS_CZ)
    group.add(tableLabel)
    labelSpritesRef.current.push(tableLabel)

    // ── OPERATOR MONUMENT (center courtyard) ─────────────────────────────

    buildOperatorMonument(group)

    // ── NDA GATE ARCH (integrated into south wall opening) ───────────────

    buildNDAGateArch(group, hub)

    // ── FORTRESS LABEL ────────────────────────────────────────────────────

    // NW31b: fortress label
    const fortressLabel = makeLabel('◈ FORTRESS COMMAND CENTER', '#00e5cc')
    fortressLabel.position.set(FORTRESS_CX, WALL_H + 3.5, FZ_MIN - 2)
    group.add(fortressLabel)
    labelSpritesRef.current.push(fortressLabel)

    scene.add(group)
    fortressGroupRef.current = group

    // NDA spheres (built outside group so they can animate independently)
    buildNDASpheres(hub)
  }

  // ── Wall / edge helpers ──────────────────────────────────────────────────

  function addWallSegment(
    group: THREE.Group,
    mat: THREE.MeshLambertMaterial,
    cx: number, cy: number, cz: number,
    w: number, h: number, d: number,
  ) {
    const geo  = new THREE.BoxGeometry(w, h, d)
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(cx, cy, cz)
    mesh.castShadow    = true
    mesh.receiveShadow = true
    group.add(mesh)
  }

  function addEdgeLine(
    group: THREE.Group,
    mat: THREE.MeshLambertMaterial,
    cx: number, cy: number, cz: number,
    w: number, h: number, d: number,
  ) {
    const geo  = new THREE.BoxGeometry(w, h, d)
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(cx, cy, cz)
    group.add(mesh)
  }

  // ── Operator monument ────────────────────────────────────────────────────

  function buildOperatorMonument(group: THREE.Group) {
    // Base pedestal
    const pedGeo = new THREE.CylinderGeometry(1.8, 2.2, 1.0, 8)
    const pedMat = new THREE.MeshLambertMaterial({
      color:    0x0a0a18,
      emissive: new THREE.Color(0xffcc00).multiplyScalar(0.15),
    })
    const ped = new THREE.Mesh(pedGeo, pedMat)
    ped.position.set(FORTRESS_CX, 0.5, FORTRESS_CZ)
    group.add(ped)

    // Central obelisk
    const obGeo = new THREE.CylinderGeometry(0.3, 0.7, 5, 6)
    const obMat = new THREE.MeshLambertMaterial({
      color:    0x111122,
      emissive: new THREE.Color(0xffcc00).multiplyScalar(0.35),
    })
    const ob = new THREE.Mesh(obGeo, obMat)
    ob.position.set(FORTRESS_CX, 3.5, FORTRESS_CZ)
    ob.castShadow = true
    group.add(ob)

    // Top gold gem
    const gemGeo = new THREE.OctahedronGeometry(0.6, 0)
    const gemMat = new THREE.MeshLambertMaterial({
      color:    0x332200,
      emissive: new THREE.Color(0xffcc00).multiplyScalar(0.9),
    })
    const gem = new THREE.Mesh(gemGeo, gemMat)
    gem.position.set(FORTRESS_CX, 6.5, FORTRESS_CZ)
    group.add(gem)

    // Operator glow
    const opLight = new THREE.PointLight(0xffcc00, 1.5, 15)
    opLight.position.set(FORTRESS_CX, 7, FORTRESS_CZ)
    scene.add(opLight)

    // Label — NW31b: spec color gold #FFD24A
    const opLabel = makeLabel('◈ OPERATOR', '#FFD24A')
    opLabel.position.set(FORTRESS_CX, 8.0, FORTRESS_CZ)
    group.add(opLabel)
    labelSpritesRef.current.push(opLabel)
  }

  // ── NDA gate arch ────────────────────────────────────────────────────────

  function buildNDAGateArch(group: THREE.Group, hub: HubState) {
    const gateMat = new THREE.MeshLambertMaterial({
      color:    0x0a1a0a,
      emissive: new THREE.Color(0x00ff44).multiplyScalar(0.25),
    })

    // Left pillar
    const pillarGeo = new THREE.BoxGeometry(0.7, WALL_H * 0.85, 0.7)
    const pillarL   = new THREE.Mesh(pillarGeo, gateMat)
    pillarL.position.set(FORTRESS_CX - GATE_W / 2, WALL_H * 0.425, FZ_MIN)
    pillarL.castShadow = true
    group.add(pillarL)

    // Right pillar
    const pillarR = pillarL.clone()
    pillarR.position.x = FORTRESS_CX + GATE_W / 2
    group.add(pillarR)

    // Gate light beams (emissive vertical planes)
    const beamGeo = new THREE.PlaneGeometry(0.08, WALL_H * 0.85)
    const beamMat = new THREE.MeshLambertMaterial({
      color:       0x003300,
      emissive:    new THREE.Color(0x00ff44).multiplyScalar(0.8),
      transparent: true,
      opacity:     0.5,
      depthWrite:  false,
      side:        THREE.DoubleSide,
    })
    const beamL = new THREE.Mesh(beamGeo, beamMat)
    beamL.position.set(FORTRESS_CX - GATE_W / 2 + 0.4, WALL_H * 0.425, FZ_MIN)
    group.add(beamL)
    const beamR = beamL.clone()
    beamR.position.x = FORTRESS_CX + GATE_W / 2 - 0.4
    group.add(beamR)

    // Gate label — NW31b: spec color #2EE89A
    const gateLabel = makeLabel('NDA GATE', '#2EE89A')
    gateLabel.position.set(FORTRESS_CX, WALL_H + 1.2, FZ_MIN)
    group.add(gateLabel)
    labelSpritesRef.current.push(gateLabel)

    // NDA status — NW31b
    const pct    = hub.ndaTotalCount > 0
      ? Math.round(hub.ndaSignedCount / hub.ndaTotalCount * 100)
      : 0
    const statusLabel = makeLabel(`${hub.ndaSignedCount}/${hub.ndaTotalCount} SIGNED (${pct}%)`, '#2EE89A')
    statusLabel.position.set(FORTRESS_CX, WALL_H - 0.5, FZ_MIN)
    group.add(statusLabel)
    labelSpritesRef.current.push(statusLabel)
  }

  // ── NDA spheres (unsigned queue outside, signed inside) ──────────────────

  function buildNDASpheres(hub: HubState) {
    for (const s of ndaSpheresRef.current) disposeObj(scene, s)
    ndaSpheresRef.current = []

    const unsigned = hub.ndaTotalCount - hub.ndaSignedCount

    // Unsigned: red spheres outside south gate (south of fortress)
    for (let i = 0; i < unsigned; i++) {
      const sGeo = new THREE.SphereGeometry(0.38, 8, 6)
      const sMat = new THREE.MeshLambertMaterial({
        color:    0x330000,
        emissive: new THREE.Color(0xff2200).multiplyScalar(0.45),
      })
      const s = new THREE.Mesh(sGeo, sMat)
      s.position.set(
        FORTRESS_CX + (i - unsigned / 2) * 1.1,
        0.38,
        FZ_MIN - 2.5 - Math.floor(i / 8) * 1.2,
      )
      scene.add(s)
      ndaSpheresRef.current.push(s)
    }

    // Signed: green spheres inside gate (just north of gate opening)
    for (let i = 0; i < hub.ndaSignedCount; i++) {
      const sGeo = new THREE.SphereGeometry(0.38, 8, 6)
      const sMat = new THREE.MeshLambertMaterial({
        color:    0x003300,
        emissive: new THREE.Color(0x00ff44).multiplyScalar(0.45),
      })
      const s = new THREE.Mesh(sGeo, sMat)
      s.position.set(
        FORTRESS_CX + (i % 5 - 2) * 1.2,
        0.38,
        FZ_MIN + 2 + Math.floor(i / 5) * 1.2,
      )
      scene.add(s)
      ndaSpheresRef.current.push(s)
    }
  }

  // ── Frame animation handler ──────────────────────────────────────────────

  function setupFrameHandler() {
    if (frameHandlerRef.current) {
      window.removeEventListener('nw:frame', frameHandlerRef.current)
    }

    const handler = () => {
      const dt = 0.016
      elapsedRef.current += dt
      const t = elapsedRef.current

      // Animate table grid pulse
      if (tableGridRef.current) {
        const mat = tableGridRef.current.material as THREE.MeshLambertMaterial
        const pulse = 0.4 + 0.6 * Math.abs(Math.sin(t * 0.9))
        mat.emissive.copy(new THREE.Color(TABLE_COLOR)).multiplyScalar(pulse * 0.55)
        mat.needsUpdate = true
        tableGridRef.current.rotation.z = t * 0.07
      }

      // Animate table glow
      if (tableLightRef.current) {
        tableLightRef.current.intensity = 1.0 + Math.sin(t * 1.1) * 0.4
      }

      // Animate corner tower lights
      for (let i = 0; i < cornerLightsRef.current.length; i++) {
        const l = cornerLightsRef.current[i]
        l.intensity = 0.9 + 0.3 * Math.sin(t * 0.7 + i * Math.PI / 2)
      }

      // ── Wall collision (AABB push-out) ──────────────────────────────────
      const px = playerPosition.current.x
      const pz = playerPosition.current.z
      const py = playerPosition.current.y

      // Only apply wall collision if player is roughly at ground level (< overlook)
      // and inside or near fortress horizontal bounds
      if (py < OVERLOOK_Y - 0.5) {
        const margin = 1.2  // player collision radius

        // Inside the fortress zone x/z bounding box (with margin)
        const insideX = px > FX_MIN + margin && px < FX_MAX - margin
        const insideZ = pz > FZ_MIN + margin && pz < FZ_MAX - margin

        // West wall: push east if too close (only when inside z range)
        if (insideZ && px < FX_MIN + margin + WALL_THICK) {
          playerPosition.current.x = FX_MIN + margin + WALL_THICK
        }
        // East wall: push west if too close
        if (insideZ && px > FX_MAX - margin - WALL_THICK) {
          playerPosition.current.x = FX_MAX - margin - WALL_THICK
        }
        // North wall: push south if too close
        if (insideX && pz > FZ_MAX - margin - WALL_THICK) {
          playerPosition.current.z = FZ_MAX - margin - WALL_THICK
        }
        // South wall: only block if NOT in gate opening
        if (insideX && pz < FZ_MIN + margin + WALL_THICK) {
          // Check if player is in gate gap
          const inGateX = px > FORTRESS_CX - GATE_W / 2 + margin && px < FORTRESS_CX + GATE_W / 2 - margin
          if (!inGateX) {
            playerPosition.current.z = FZ_MIN + margin + WALL_THICK
          }
        }
      }

      // ── Overlook detection ──────────────────────────────────────────────
      const onPlat = (
        py > OVERLOOK_Y - 0.5 &&
        px > FX_MIN - 2 && px < FX_MAX + 2 &&
        pz > FZ_MAX - 8  && pz < FZ_MAX + 4
      )
      setOnOverlook(onPlat)

      // Trigger NEXUS comment when player first reaches overlook
      if (onPlat && Math.abs(py - lastCommentYRef.current) > 1.5) {
        lastCommentYRef.current = py
        const idx     = nexusCommentIdx.current % NEXUS_OVERLOOK_LINES.length
        nexusCommentIdx.current += 1
        setNexusComment(NEXUS_OVERLOOK_LINES[idx])
      }
      if (!onPlat && nexusComment !== '') {
        setNexusComment('')
        lastCommentYRef.current = -999
      }

      // NW31b: Frustum cull + distance fade all label sprites
      const _wp = new THREE.Vector3()
      for (const s of labelSpritesRef.current) {
        s.getWorldPosition(_wp)
        ;(s as NWLabel).updateVisibility(camera, _wp)
      }
    }

    window.addEventListener('nw:frame', handler)
    frameHandlerRef.current = handler
  }

  // ── Overlook HUD (React DOM overlay) ────────────────────────────────────

  // Collect live world stats for HUD
  const data = worldDataRef.current
  const totalContractValue = data
    ? data.projects.reduce((sum, p) => sum + (p.contract_value ?? 0), 0)
    : 0
  const activeProjects = data
    ? data.projects.filter(p => p.status === 'in_progress' || p.status === 'approved').length
    : 0
  const unpaidInvoices = data
    ? data.invoices.filter(inv => inv.status !== 'paid' && inv.status !== 'cancelled').length
    : 0
  const hub = hubStateRef.current

  return (
    <>
      {/* ── OVERLOOK HUD ── */}
      {onOverlook && (
        <div style={{
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 45,
          fontFamily: 'monospace',
        }}>
          {/* Vignette */}
          <div style={{
            position: 'absolute',
            inset: 0,
            background: 'radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,0.72) 100%)',
            pointerEvents: 'none',
          }} />

          {/* Split-view HUD panel */}
          <div style={{
            position: 'absolute',
            top: 20,
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            gap: 2,
            background: 'rgba(5,5,14,0.88)',
            border: '1px solid rgba(0,229,204,0.45)',
            borderRadius: 8,
            overflow: 'hidden',
            backdropFilter: 'blur(10px)',
            boxShadow: '0 0 24px rgba(0,229,204,0.15)',
          }}>
            {/* West continent — Power On Solutions */}
            <div style={{
              padding: '14px 22px',
              borderRight: '1px solid rgba(0,229,204,0.25)',
              minWidth: 200,
            }}>
              <div style={{ fontSize: 9, color: 'rgba(0,229,204,0.55)', letterSpacing: 2, marginBottom: 8 }}>
                ◈ WEST — POWER ON SOLUTIONS
              </div>
              <HudRow label="Contract Value" value={`$${(totalContractValue / 1000).toFixed(0)}k`} />
              <HudRow label="Active Projects" value={String(activeProjects)} />
              <HudRow label="Unpaid Invoices" value={String(unpaidInvoices)} accent={unpaidInvoices > 3} />
            </div>

            {/* Divider label */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              padding: '0 10px',
              fontSize: 16,
              color: 'rgba(0,229,204,0.4)',
            }}>
              ◈
            </div>

            {/* East continent — PowerOn Hub */}
            <div style={{
              padding: '14px 22px',
              minWidth: 200,
            }}>
              <div style={{ fontSize: 9, color: 'rgba(0,229,204,0.55)', letterSpacing: 2, marginBottom: 8 }}>
                ◈ EAST — POWERON HUB
              </div>
              <HudRow label="MRR (mock)"      value="$2,847" />
              <HudRow label="NDA Signed"      value={`${hub.ndaSignedCount} / ${hub.ndaTotalCount}`} />
              <HudRow label="IP Filings"      value={String(hub.ipFilings)} />
            </div>
          </div>

          {/* NEXUS comment bubble */}
          {nexusComment && (
            <div style={{
              position: 'absolute',
              bottom: 90,
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(5,5,14,0.88)',
              border: '1px solid rgba(160,0,255,0.5)',
              borderRadius: 6,
              padding: '8px 18px',
              fontSize: 11,
              color: 'rgba(200,150,255,0.9)',
              letterSpacing: 1,
              whiteSpace: 'nowrap',
              backdropFilter: 'blur(8px)',
              boxShadow: '0 0 18px rgba(160,0,255,0.2)',
            }}>
              <span style={{ opacity: 0.6, marginRight: 6 }}>◈ NEXUS</span>
              {nexusComment}
            </div>
          )}
        </div>
      )}
    </>
  )
}

// ── Small HUD row helper component ────────────────────────────────────────────

function HudRow({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 4 }}>
      <span style={{ fontSize: 10, color: 'rgba(0,229,204,0.55)', letterSpacing: 0.5 }}>{label}</span>
      <span style={{
        fontSize: 10,
        fontWeight: 700,
        color: accent ? '#ff5050' : '#00e5cc',
        letterSpacing: 0.5,
      }}>{value}</span>
    </div>
  )
}
