/**
 * EastContinentLayer.tsx — NW10 East Continent full terrain mechanics.
 *
 * PowerOn Hub software business east continent (x=20..200).
 *
 * Features:
 * 1. Subscription towers    — five tier archetypes one per pricing tier
 *                              Solo $49    = small CylinderGeometry cluster
 *                              Growth $129 = medium tower
 *                              Pro $299    = tall tower
 *                              Pro+ $499   = very tall tower
 *                              Enterprise $800+ = massive monolith + TorusGeometry rings
 *                              Tower count = subscriber count per tier
 *                              Towers positioned in east continent grid
 * 2. MRR mountain           — single central SphereGeometry; height = MRR / 500
 * 3. Churn pools            — dark PlaneGeometry pool at tower base on cancel
 *                              evaporates over 30 days via opacity fade
 *                              multiple pools = visible alarm (red tint)
 * 4. Agent activity grid    — east ground subdivided into grid cells
 *                              each cell pulses when assigned agent is processing
 *                              high activity = bright pulse; idle = dark
 * 5. NDA gate               — BoxGeometry gate at east entry (x≈25)
 *                              unsigned users = small sphere stacks outside
 *                              signed = sphere moves through, tower spawns
 * 6. IP fortress            — BoxGeometry wall on east edge (x≈190)
 *                              height increases per IP filing; 2 filings = 2 height units
 * 7. Admin structures       — SPARK, SCOUT, ECHO, ATLAS, NEXUS, GUARDIAN
 *
 * All Three.js objects are disposed on unmount.
 */

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useWorldContext } from '../WorldContext'
import { subscribeWorldData, type NWWorldData } from '../DataBridge'
import { MeshPool } from '../ObjectPool'
import { getNodePosition } from '../NodePositionStore'
import { makeLabel, type NWLabel } from '../utils/makeLabel'

// ── Constants ──────────────────────────────────────────────────────────────────

const EAST_X_MIN = 35      // 15-unit margin from river edge (x=20)
const EAST_X_MAX = 185     // 15-unit margin from east world border (x=200)
const EAST_Z_MIN = -180
const EAST_Z_MAX = 180

// Subscription tier definitions
interface TierDef {
  id: string
  label: string
  price: number
  color: number
  emissive: number
  baseRadius: number
  height: number
  isMonolith?: boolean
}

const TIERS: TierDef[] = [
  { id: 'solo',       label: 'SOLO $49',       price: 49,  color: 0x1a3a2a, emissive: 0x00ff88, baseRadius: 0.8,  height: 1.5  },
  { id: 'growth',     label: 'GROWTH $129',     price: 129, color: 0x1a2a3a, emissive: 0x0088ff, baseRadius: 1.2,  height: 3.0  },
  { id: 'pro',        label: 'PRO $299',        price: 299, color: 0x2a1a3a, emissive: 0x8800ff, baseRadius: 1.6,  height: 5.5  },
  { id: 'proplus',    label: 'PRO+ $499',       price: 499, color: 0x3a2a1a, emissive: 0xff8800, baseRadius: 2.0,  height: 8.0  },
  { id: 'enterprise', label: 'ENTERPRISE $800+', price: 800, color: 0x1a1a3a, emissive: 0x4488ff, baseRadius: 3.5,  height: 14.0, isMonolith: true },
]

// Admin structure positions (east continent)
interface AdminStructureDef {
  id: string
  label: string
  x: number
  z: number
  color: number
  emissive: number
  type: 'spark' | 'scout' | 'echo' | 'atlas' | 'nexus' | 'guardian-post'
}

const ADMIN_STRUCTURES: AdminStructureDef[] = [
  { id: 'SPARK',    label: 'SPARK',    x: 60,  z: -120, color: 0x2a1500, emissive: 0xff6600, type: 'spark'          },
  { id: 'SCOUT',    label: 'SCOUT',    x: 160, z:  0,   color: 0x0a1a2a, emissive: 0x00ccff, type: 'scout'          },
  { id: 'ECHO',     label: 'ECHO',     x: 110, z: 130,  color: 0x0a0a20, emissive: 0x6600ff, type: 'echo'           },
  { id: 'ATLAS',    label: 'ATLAS',    x: 75,  z:  80,  color: 0x001a10, emissive: 0x00ff88, type: 'atlas'          },
  { id: 'NEXUS',    label: 'NEXUS',    x: 110, z: -60,  color: 0x1a001a, emissive: 0xff00ff, type: 'nexus'          },
]

// GUARDIAN posts — perimeter wall around east continent edge
const GUARDIAN_POST_POSITIONS = [
  { x: 30,  z: -170 }, { x: 80,  z: -170 }, { x: 130, z: -170 }, { x: 180, z: -170 },
  { x: 30,  z:  170 }, { x: 80,  z:  170 }, { x: 130, z:  170 }, { x: 180, z:  170 },
  { x: 190, z: -130 }, { x: 190, z: -70  }, { x: 190, z:  0   }, { x: 190, z:  70  }, { x: 190, z:  130 },
  { x: 25,  z: -130 }, { x: 25,  z: -70  }, { x: 25,  z:  0   }, { x: 25,  z:  70  }, { x: 25,  z:  130 },
]

// Grid dimensions for agent activity
const GRID_COLS = 12
const GRID_ROWS = 18
const CELL_SIZE_X = (EAST_X_MAX - EAST_X_MIN) / GRID_COLS
const CELL_SIZE_Z = (EAST_Z_MAX - EAST_Z_MIN) / GRID_ROWS

// ── Mock hub data (demo/fallback when no real subscribers loaded) ──────────────

interface HubSubscriber {
  id: string
  tier: string
  active: boolean
  cancelledAt: number | null // ms timestamp, null if active
}

interface HubState {
  subscribers: HubSubscriber[]
  mrr: number
  ipFilings: number
  ndaSignedCount: number
  ndaTotalCount: number
  agentActivity: Record<string, number>  // agentId → 0–1 activity level
}

function getMockHubState(): HubState {
  return {
    subscribers: [
      { id: 's1',  tier: 'solo',       active: true,  cancelledAt: null },
      { id: 's2',  tier: 'solo',       active: true,  cancelledAt: null },
      { id: 's3',  tier: 'solo',       active: false, cancelledAt: Date.now() - 5 * 24 * 60 * 60 * 1000 },
      { id: 's4',  tier: 'growth',     active: true,  cancelledAt: null },
      { id: 's5',  tier: 'growth',     active: true,  cancelledAt: null },
      { id: 's6',  tier: 'growth',     active: false, cancelledAt: Date.now() - 20 * 24 * 60 * 60 * 1000 },
      { id: 's7',  tier: 'pro',        active: true,  cancelledAt: null },
      { id: 's8',  tier: 'pro',        active: true,  cancelledAt: null },
      { id: 's9',  tier: 'proplus',    active: true,  cancelledAt: null },
      { id: 's10', tier: 'enterprise', active: true,  cancelledAt: null },
    ],
    mrr: 2847,
    ipFilings: 2,
    ndaSignedCount: 7,
    ndaTotalCount: 9,
    agentActivity: {
      SPARK: 0.85,
      SCOUT: 0.3,
      ECHO: 0.6,
      ATLAS: 0.4,
      NEXUS: 0.9,
      GUARDIAN: 0.2,
      VAULT: 0.1,
      LEDGER: 0.5,
      OHM: 0.2,
      BLUEPRINT: 0.45,
      CHRONO: 0.3,
      HUNTER: 0.0,
    },
  }
}

// NW31b: makeTextSprite replaced by shared makeLabel utility (see utils/makeLabel.ts)

// ── Dispose helper ─────────────────────────────────────────────────────────────

function disposeObj(scene: THREE.Scene, obj: THREE.Object3D | null): void {
  if (!obj) return
  scene.remove(obj)
  if ((obj as THREE.Mesh).geometry) (obj as THREE.Mesh).geometry.dispose()
  const mat = (obj as THREE.Mesh | THREE.Line).material as THREE.Material | THREE.Material[] | undefined
  if (mat) {
    if (Array.isArray(mat)) mat.forEach(m => m.dispose())
    else mat.dispose()
  }
  const smat = (obj as THREE.Sprite).material as THREE.SpriteMaterial | undefined
  if (smat?.map) { smat.map.dispose(); smat.dispose() }
}

// ── Component ──────────────────────────────────────────────────────────────────

export function EastContinentLayer() {
  const { scene, camera } = useWorldContext()

  // NW31b: all label sprites for per-frame visibility updates
  const labelSpritesRef = useRef<THREE.Sprite[]>([])

  // ── Refs for all Three.js objects ─────────────────────────────────────────
  const towerGroupsRef = useRef<THREE.Group[]>([])
  const churnPoolsRef  = useRef<Array<{ mesh: THREE.Mesh; createdAt: number }>>([])
  // NW15: Object pool for churn pool discs (pre-alloc 5, max 20)
  const churnPoolMeshPoolRef = useRef<MeshPool | null>(null)
  const mrrMountainRef = useRef<THREE.Mesh | null>(null)
  const mrrGlowRef     = useRef<THREE.PointLight | null>(null)
  const agentCellsRef  = useRef<Array<{ mesh: THREE.Mesh; agentId: string }>>([])
  const ndaGateRef     = useRef<THREE.Group | null>(null)
  const ndaSpheresRef  = useRef<THREE.Mesh[]>([])
  const ipWallsRef     = useRef<THREE.Mesh[]>([])
  const adminMeshesRef = useRef<THREE.Object3D[]>([])
  const nexusPulseRef  = useRef<THREE.Mesh | null>(null)
  const guardianPostsRef = useRef<THREE.Mesh[]>([])
  const sparkRingsRef  = useRef<Array<{ ring: THREE.Mesh; phase: number }>>([])
  // NW24: Admin struct objects per ID (for repositioning)
  const adminStructObjsRef = useRef<Map<string, THREE.Object3D[]>>(new Map())
  const adminStructCurPosRef = useRef<Map<string, { x: number; z: number }>>(new Map())

  const frameHandlerRef = useRef<(() => void) | null>(null)
  const elapsedRef      = useRef(0)
  const hubStateRef     = useRef<HubState>(getMockHubState())

  // ── Seeded grid position for tower placement ──────────────────────────────

  function towerGridPosition(tierId: string, index: number): { x: number; z: number } {
    const tierIndex = TIERS.findIndex(t => t.id === tierId)
    const bandZ = EAST_Z_MIN + (tierIndex + 0.5) * ((EAST_Z_MAX - EAST_Z_MIN) / TIERS.length)
    const bandZHalf = (EAST_Z_MAX - EAST_Z_MIN) / TIERS.length / 2

    // Spread towers in X across the east continent
    const xSpan   = EAST_X_MAX - EAST_X_MIN
    const xOffset = (index % 8) / Math.max(1, 7) * xSpan * 0.85 + EAST_X_MIN + xSpan * 0.075
    const zOffset = bandZ + ((index % 3) - 1) * bandZHalf * 0.55

    return { x: xOffset, z: zOffset }
  }

  // ── Build subscription towers ─────────────────────────────────────────────

  function buildTowers(hubState: HubState) {
    // Remove old tower groups
    for (const grp of towerGroupsRef.current) {
      grp.traverse(obj => {
        if ((obj as THREE.Mesh).geometry) (obj as THREE.Mesh).geometry.dispose()
        const mat = (obj as THREE.Mesh).material as THREE.Material | undefined
        if (mat) mat.dispose()
      })
      scene.remove(grp)
    }
    towerGroupsRef.current = []

    const tierCounts: Record<string, HubSubscriber[]> = {}
    for (const t of TIERS) tierCounts[t.id] = []
    for (const sub of hubState.subscribers) {
      if (sub.active && tierCounts[sub.tier]) {
        tierCounts[sub.tier].push(sub)
      }
    }

    for (const tier of TIERS) {
      const subs = tierCounts[tier.id] ?? []
      subs.forEach((sub, idx) => {
        const { x, z } = towerGridPosition(tier.id, idx)
        const group = buildSingleTower(tier, sub.id, x, z)
        scene.add(group)
        towerGroupsRef.current.push(group)
      })
    }
  }

  function buildSingleTower(tier: TierDef, id: string, x: number, z: number): THREE.Group {
    const group = new THREE.Group()
    group.position.set(x, 0, z)
    group.userData.towerId = id
    group.userData.tierId  = tier.id

    const mat = new THREE.MeshLambertMaterial({
      color:   tier.color,
      emissive: new THREE.Color(tier.emissive).multiplyScalar(0.15),
    })

    if (tier.isMonolith) {
      // Enterprise: massive monolith + TorusGeometry rings
      const bodyGeo = new THREE.CylinderGeometry(tier.baseRadius * 0.7, tier.baseRadius, tier.height, 8)
      const body    = new THREE.Mesh(bodyGeo, mat)
      body.position.y = tier.height / 2
      body.castShadow = true
      group.add(body)

      // Three orbiting torus rings
      for (let r = 0; r < 3; r++) {
        const torusGeo = new THREE.TorusGeometry(tier.baseRadius * (1.5 + r * 0.5), 0.18, 8, 24)
        const torusMat = new THREE.MeshLambertMaterial({
          color:    tier.color,
          emissive: new THREE.Color(tier.emissive).multiplyScalar(0.4 + r * 0.15),
        })
        const torus = new THREE.Mesh(torusGeo, torusMat)
        torus.position.y = tier.height * (0.4 + r * 0.22)
        torus.rotation.x = Math.PI / 2 + r * 0.3
        torus.userData.orbitSpeed = 0.4 + r * 0.25
        torus.userData.orbitAxis  = r
        group.add(torus)
      }
    } else if (tier.id === 'solo') {
      // Solo: small cluster of 3 mini cylinders
      const offsets = [{ x: 0, z: 0 }, { x: 0.9, z: 0.5 }, { x: -0.9, z: 0.5 }]
      for (const off of offsets) {
        const cGeo = new THREE.CylinderGeometry(tier.baseRadius * 0.55, tier.baseRadius * 0.7, tier.height, 6)
        const c    = new THREE.Mesh(cGeo, mat)
        c.position.set(off.x, tier.height / 2, off.z)
        c.castShadow = true
        group.add(c)
      }
    } else {
      // Growth, Pro, Pro+: single cylinder tower
      const cGeo = new THREE.CylinderGeometry(tier.baseRadius * 0.75, tier.baseRadius, tier.height, 8)
      const c    = new THREE.Mesh(cGeo, mat)
      c.position.y = tier.height / 2
      c.castShadow = true
      group.add(c)
    }

    // Tower top light
    const light = new THREE.PointLight(tier.emissive, 0.8, 12)
    light.position.y = tier.height + 0.5
    group.add(light)

    // Label sprite — NW31b: tier accent color, sized to content
    const tierColor = `#${new THREE.Color(tier.emissive).getHexString()}`
    const sprite = makeLabel(tier.label, tierColor)
    sprite.position.set(0, tier.height + 2.2, 0)
    group.add(sprite)
    labelSpritesRef.current.push(sprite)

    return group
  }

  // ── Build churn pools ─────────────────────────────────────────────────────

  function buildChurnPools(hubState: HubState) {
    // NW15: Lazily create churn pool mesh pool
    if (!churnPoolMeshPoolRef.current) {
      churnPoolMeshPoolRef.current = new MeshPool(
        () => {
          const geo = new THREE.PlaneGeometry(8, 8, 4, 4)
          const mat = new THREE.MeshLambertMaterial({
            color:       0x220010,
            emissive:    new THREE.Color(0xff0033).multiplyScalar(0.25),
            transparent: true,
            opacity:     0.8,
            depthWrite:  false,
          })
          const m = new THREE.Mesh(geo, mat)
          m.frustumCulled = true
          m.rotation.x = -Math.PI / 2
          scene.add(m)
          return m
        },
        5,   // preallocate
        20   // max
      )
    }

    // Remove expired pools (> 30 days) — return to pool
    const thirtyDays = 30 * 24 * 60 * 60 * 1000
    const now = Date.now()
    const retained: Array<{ mesh: THREE.Mesh; createdAt: number }> = []
    for (const pool of churnPoolsRef.current) {
      if (now - pool.createdAt > thirtyDays) {
        scene.remove(pool.mesh)
        churnPoolMeshPoolRef.current!.release(pool.mesh)
      } else {
        retained.push(pool)
      }
    }
    churnPoolsRef.current = retained

    // Add new pools for recently cancelled subscribers
    const existingIds = new Set(churnPoolsRef.current.map(p => p.mesh.userData.subId))

    for (const sub of hubState.subscribers) {
      if (!sub.active && sub.cancelledAt !== null && !existingIds.has(sub.id)) {
        const age = now - sub.cancelledAt
        if (age > thirtyDays) continue // already expired

        const tier = TIERS.find(t => t.id === sub.tier) ?? TIERS[0]
        const idx  = hubState.subscribers.filter(s => s.tier === sub.tier).indexOf(sub)
        const { x, z } = towerGridPosition(sub.tier, Math.max(0, idx))

        const poolRadius = tier.baseRadius * 2.0

        // NW15: acquire from pool
        const pool = churnPoolMeshPoolRef.current!.acquire()
        pool.scale.set(poolRadius, 1, poolRadius)
        const mat = pool.material as THREE.MeshLambertMaterial
        mat.opacity = 1.0 - age / thirtyDays   // fades as it approaches 30-day mark
        pool.position.set(x, 0.05, z)
        pool.userData.subId = sub.id
        scene.add(pool)
        churnPoolsRef.current.push({ mesh: pool, createdAt: sub.cancelledAt! })
      }
    }
  }

  // ── Build MRR mountain ────────────────────────────────────────────────────

  function buildMRRMountain(mrr: number) {
    if (mrrMountainRef.current) {
      disposeObj(scene, mrrMountainRef.current)
      mrrMountainRef.current = null
    }
    if (mrrGlowRef.current) {
      scene.remove(mrrGlowRef.current)
      mrrGlowRef.current = null
    }

    // Height = MRR / 500 (minimum 0.5, scales up as MRR grows)
    const rawHeight  = mrr / 500
    const height     = Math.max(0.5, rawHeight)
    const radius     = Math.max(6, height * 1.4)

    const mrrGeo = new THREE.SphereGeometry(radius, 16, 12, 0, Math.PI * 2, 0, Math.PI / 1.8)
    const mrrMat = new THREE.MeshLambertMaterial({
      color:    0x0a1a2a,
      emissive: new THREE.Color(0x0066ff).multiplyScalar(0.2),
    })
    const mrrPos = getNodePosition('MRR_MOUNTAIN', 100, 0)
    const mountain = new THREE.Mesh(mrrGeo, mrrMat)
    mountain.position.set(mrrPos.x, 0, mrrPos.z)
    mountain.castShadow = true
    mountain.receiveShadow = true
    scene.add(mountain)
    mrrMountainRef.current = mountain

    // MRR label — NW31b: blue accent
    const label = makeLabel(`MRR $${mrr.toLocaleString()}`, '#4488ff')
    label.position.set(mrrPos.x, height + radius * 0.5 + 2, mrrPos.z)
    scene.add(label)
    adminMeshesRef.current.push(label)
    labelSpritesRef.current.push(label)

    // Summit glow
    const glow = new THREE.PointLight(0x4488ff, 1.2, radius * 2.5)
    glow.position.set(mrrPos.x, radius * 0.6, mrrPos.z)
    scene.add(glow)
    mrrGlowRef.current = glow
  }

  // ── Build agent activity grid ─────────────────────────────────────────────

  function buildAgentGrid() {
    for (const cell of agentCellsRef.current) {
      disposeObj(scene, cell.mesh)
    }
    agentCellsRef.current = []

    const agents = Object.keys(getMockHubState().agentActivity)
    let agentIdx = 0

    for (let col = 0; col < GRID_COLS; col++) {
      for (let row = 0; row < GRID_ROWS; row++) {
        const x = EAST_X_MIN + col * CELL_SIZE_X + CELL_SIZE_X / 2
        const z = EAST_Z_MIN + row * CELL_SIZE_Z + CELL_SIZE_Z / 2

        const agentId = agents[agentIdx % agents.length]
        agentIdx++

        const cellGeo = new THREE.PlaneGeometry(CELL_SIZE_X * 0.82, CELL_SIZE_Z * 0.82)
        const cellMat = new THREE.MeshLambertMaterial({
          color:       0x050518,
          emissive:    new THREE.Color(0x0033ff).multiplyScalar(0.0),
          transparent: true,
          opacity:     0.0,
          depthWrite:  false,
        })
        const cell = new THREE.Mesh(cellGeo, cellMat)
        cell.rotation.x = -Math.PI / 2
        cell.position.set(x, 0.02, z)
        cell.userData.agentId   = agentId
        cell.userData.pulsePhase = Math.random() * Math.PI * 2
        scene.add(cell)
        agentCellsRef.current.push({ mesh: cell, agentId })
      }
    }
  }

  // ── Build NDA gate ────────────────────────────────────────────────────────

  function buildNDAGate(ndaSigned: number, ndaTotal: number) {
    if (ndaGateRef.current) {
      ndaGateRef.current.traverse(obj => {
        if ((obj as THREE.Mesh).geometry) (obj as THREE.Mesh).geometry.dispose()
        const mat = (obj as THREE.Mesh).material as THREE.Material | undefined
        if (mat) mat.dispose()
      })
      scene.remove(ndaGateRef.current)
      ndaGateRef.current = null
    }
    for (const s of ndaSpheresRef.current) disposeObj(scene, s)
    ndaSpheresRef.current = []

    const gateGroup = new THREE.Group()
    const gateMat   = new THREE.MeshLambertMaterial({
      color:    0x0a1a0a,
      emissive: new THREE.Color(0x00ff44).multiplyScalar(0.2),
    })

    // Left pillar
    const pillarGeo = new THREE.BoxGeometry(0.8, 5, 0.8)
    const pillarL   = new THREE.Mesh(pillarGeo, gateMat)
    pillarL.position.set(-3.5, 2.5, 0)
    pillarL.castShadow = true
    gateGroup.add(pillarL)

    // Right pillar
    const pillarR = new THREE.Mesh(pillarGeo, gateMat)
    pillarR.position.set(3.5, 2.5, 0)
    pillarR.castShadow = true
    gateGroup.add(pillarR)

    // Top bar
    const topGeo = new THREE.BoxGeometry(8, 0.8, 0.8)
    const topBar  = new THREE.Mesh(topGeo, gateMat)
    topBar.position.set(0, 5.4, 0)
    topBar.castShadow = true
    gateGroup.add(topBar)

    // NDA label — NW31b: spec color #2EE89A
    const gateLabel = makeLabel('NDA GATE', '#2EE89A')
    gateLabel.position.set(0, 7.0, 0)
    gateGroup.add(gateLabel)
    labelSpritesRef.current.push(gateLabel)

    // Gate position: eastern entry — NW24: NodePositionStore override
    const ndaPos = getNodePosition('NDA_GATE', 25, 0)
    gateGroup.position.set(ndaPos.x, 0, ndaPos.z)
    scene.add(gateGroup)
    ndaGateRef.current = gateGroup

    // Unsigned users: small red spheres outside gate (west side, z varies)
    const unsigned = ndaTotal - ndaSigned
    for (let i = 0; i < unsigned; i++) {
      const sGeo = new THREE.SphereGeometry(0.35, 8, 6)
      const sMat = new THREE.MeshLambertMaterial({
        color:    0x330000,
        emissive: new THREE.Color(0xff2200).multiplyScalar(0.4),
      })
      const s = new THREE.Mesh(sGeo, sMat)
      s.position.set(22 - i * 1.0, 0.35, (i - unsigned / 2) * 0.9)
      scene.add(s)
      ndaSpheresRef.current.push(s)
    }

    // Signed users: small green spheres inside gate (east side)
    for (let i = 0; i < ndaSigned; i++) {
      const sGeo = new THREE.SphereGeometry(0.35, 8, 6)
      const sMat = new THREE.MeshLambertMaterial({
        color:    0x003300,
        emissive: new THREE.Color(0x00ff44).multiplyScalar(0.4),
      })
      const s = new THREE.Mesh(sGeo, sMat)
      s.position.set(28 + (i % 4) * 1.1, 0.35, Math.floor(i / 4) * 0.9 - 1.5)
      scene.add(s)
      ndaSpheresRef.current.push(s)
    }
  }

  // ── Build IP fortress ─────────────────────────────────────────────────────

  function buildIPFortress(ipFilings: number) {
    for (const w of ipWallsRef.current) disposeObj(scene, w)
    ipWallsRef.current = []

    // Wall segments along east edge x≈190, z range
    const wallMat = new THREE.MeshLambertMaterial({
      color:    0x1a1a3a,
      emissive: new THREE.Color(0x4444ff).multiplyScalar(0.2),
    })

    const wallHeight     = Math.max(1, ipFilings)   // 1 unit per filing, min 1
    const segmentCount   = 10
    const zSpan          = 340 // z from -170 to 170
    const segmentLength  = zSpan / segmentCount
    const ipPos = getNodePosition('IP_FORTRESS', 190, 0)  // NW24: override support

    for (let i = 0; i < segmentCount; i++) {
      const z = -170 + i * segmentLength + segmentLength / 2
      const wallGeo = new THREE.BoxGeometry(2.5, wallHeight, segmentLength * 0.85)
      const wall    = new THREE.Mesh(wallGeo, wallMat)
      wall.position.set(ipPos.x + 2, wallHeight / 2, z)
      wall.castShadow = true
      wall.receiveShadow = true
      scene.add(wall)
      ipWallsRef.current.push(wall)
    }

    // IP label — NW31b: blue accent
    const ipLabel = makeLabel(`IP FORTRESS · ${ipFilings} FILINGS`, '#6688ff')
    ipLabel.position.set(ipPos.x + 2, wallHeight + 2.5, 0)
    scene.add(ipLabel)
    adminMeshesRef.current.push(ipLabel)
    labelSpritesRef.current.push(ipLabel)
  }

  // ── Build admin structures ────────────────────────────────────────────────

  function buildAdminStructures() {
    for (const obj of adminMeshesRef.current) disposeObj(scene, obj)
    adminMeshesRef.current = []
    // NW31b: clear label sprites before rebuild
    labelSpritesRef.current = []
    adminStructObjsRef.current.clear()
    adminStructCurPosRef.current.clear()
    for (const post of guardianPostsRef.current) disposeObj(scene, post)
    guardianPostsRef.current = []
    for (const r of sparkRingsRef.current) disposeObj(scene, r.ring)
    sparkRingsRef.current = []
    if (nexusPulseRef.current) { disposeObj(scene, nexusPulseRef.current); nexusPulseRef.current = null }

    for (const def of ADMIN_STRUCTURES) {
      // NW24: Apply NodePositionStore override to def position
      const overridePos = getNodePosition(def.id, def.x, def.z)
      const defWithOverride: AdminStructureDef = { ...def, x: overridePos.x, z: overridePos.z }

      // Track adminMeshesRef length before build to capture which objects belong to this struct
      const beforeLen = adminMeshesRef.current.length
      const beforeSparkLen = sparkRingsRef.current.length

      switch (defWithOverride.type) {
        case 'spark':   buildSPARK(defWithOverride);   break
        case 'scout':   buildSCOUT(defWithOverride);   break
        case 'echo':    buildECHO(defWithOverride);    break
        case 'atlas':   buildATLAS(defWithOverride);   break
        case 'nexus':   buildNEXUS(defWithOverride);   break
        default: break
      }

      // Store all objects added by this build call
      const addedObjs = adminMeshesRef.current.slice(beforeLen)
      const addedSparkRings = sparkRingsRef.current.slice(beforeSparkLen).map(r => r.ring)
      adminStructObjsRef.current.set(def.id, [...addedObjs, ...addedSparkRings])
      adminStructCurPosRef.current.set(def.id, { x: overridePos.x, z: overridePos.z })
    }

    // GUARDIAN perimeter posts
    buildGUARDIANPerimeter()
  }

  // NW24: Reposition all objects of an admin struct by delta
  function repositionAdminStructEast(id: string, newX: number, newZ: number) {
    const curPos = adminStructCurPosRef.current.get(id)
    if (!curPos) return
    const dx = newX - curPos.x
    const dz = newZ - curPos.z
    const objs = adminStructObjsRef.current.get(id) ?? []
    for (const obj of objs) {
      obj.position.x += dx
      obj.position.z += dz
    }
    // Also handle nexusPulseRef if this is NEXUS
    if (id === 'NEXUS' && nexusPulseRef.current) {
      nexusPulseRef.current.position.x += dx
      nexusPulseRef.current.position.z += dz
    }
    adminStructCurPosRef.current.set(id, { x: newX, z: newZ })
  }

  function buildSPARK(def: AdminStructureDef) {
    // SPARK = tall broadcasting tower with radiating pulse rings
    const mat = new THREE.MeshLambertMaterial({
      color:    def.color,
      emissive: new THREE.Color(def.emissive).multiplyScalar(0.3),
    })

    // Tower body
    const bodyGeo = new THREE.CylinderGeometry(0.5, 1.2, 9, 8)
    const body    = new THREE.Mesh(bodyGeo, mat)
    body.position.set(def.x, 4.5, def.z)
    body.castShadow = true
    scene.add(body)
    adminMeshesRef.current.push(body)

    // Antenna spike
    const antGeo = new THREE.CylinderGeometry(0.05, 0.3, 3, 6)
    const ant     = new THREE.Mesh(antGeo, mat)
    ant.position.set(def.x, 10.5, def.z)
    scene.add(ant)
    adminMeshesRef.current.push(ant)

    // 3 pulse rings (torus) that animate outward
    for (let r = 0; r < 3; r++) {
      const ringGeo = new THREE.TorusGeometry(1.5 + r * 1.5, 0.12, 6, 20)
      const ringMat = new THREE.MeshLambertMaterial({
        color:       def.color,
        emissive:    new THREE.Color(def.emissive).multiplyScalar(0.6),
        transparent: true,
        opacity:     0.7,
      })
      const ring = new THREE.Mesh(ringGeo, ringMat)
      ring.rotation.x = Math.PI / 2
      ring.position.set(def.x, 9.5, def.z)
      scene.add(ring)
      sparkRingsRef.current.push({ ring, phase: r * (Math.PI * 2 / 3) })
    }

    const label = makeLabel(def.label, `#${new THREE.Color(def.emissive).getHexString()}`)
    label.position.set(def.x, 13, def.z)
    scene.add(label)
    adminMeshesRef.current.push(label)
    labelSpritesRef.current.push(label)
  }

  function buildSCOUT(def: AdminStructureDef) {
    // SCOUT = highest point observatory — tall tower with dome cap
    const mat = new THREE.MeshLambertMaterial({
      color:    def.color,
      emissive: new THREE.Color(def.emissive).multiplyScalar(0.25),
    })

    // Tower shaft
    const shaftGeo = new THREE.CylinderGeometry(0.8, 1.5, 16, 8)
    const shaft     = new THREE.Mesh(shaftGeo, mat)
    shaft.position.set(def.x, 8, def.z)
    shaft.castShadow = true
    scene.add(shaft)
    adminMeshesRef.current.push(shaft)

    // Observatory dome (half sphere)
    const domeGeo = new THREE.SphereGeometry(3, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2)
    const domeMat = new THREE.MeshLambertMaterial({
      color:    0x082030,
      emissive: new THREE.Color(def.emissive).multiplyScalar(0.3),
      transparent: true,
      opacity:  0.85,
    })
    const dome = new THREE.Mesh(domeGeo, domeMat)
    dome.position.set(def.x, 16, def.z)
    scene.add(dome)
    adminMeshesRef.current.push(dome)

    // Observation light
    const obsLight = new THREE.PointLight(def.emissive, 1.5, 30)
    obsLight.position.set(def.x, 18, def.z)
    scene.add(obsLight)
    adminMeshesRef.current.push(obsLight)

    const label = makeLabel(def.label, `#${new THREE.Color(def.emissive).getHexString()}`)
    label.position.set(def.x, 21, def.z)
    scene.add(label)
    adminMeshesRef.current.push(label)
    labelSpritesRef.current.push(label)
  }

  function buildECHO(def: AdminStructureDef) {
    // ECHO = cave structure at oldest mountain base
    const mat = new THREE.MeshLambertMaterial({
      color:    def.color,
      emissive: new THREE.Color(def.emissive).multiplyScalar(0.2),
    })

    // Cave entrance: arch made of boxes
    const archL = new THREE.Mesh(new THREE.BoxGeometry(1.2, 5, 1.8), mat)
    archL.position.set(def.x - 2.5, 2.5, def.z)
    archL.castShadow = true
    scene.add(archL)
    adminMeshesRef.current.push(archL)

    const archR = new THREE.Mesh(new THREE.BoxGeometry(1.2, 5, 1.8), mat)
    archR.position.set(def.x + 2.5, 2.5, def.z)
    archR.castShadow = true
    scene.add(archR)
    adminMeshesRef.current.push(archR)

    const archTop = new THREE.Mesh(new THREE.BoxGeometry(7, 1.2, 1.8), mat)
    archTop.position.set(def.x, 5.6, def.z)
    scene.add(archTop)
    adminMeshesRef.current.push(archTop)

    // Cave depth hint: dark interior box
    const interiorGeo = new THREE.BoxGeometry(3.8, 4.2, 6)
    const interiorMat = new THREE.MeshLambertMaterial({
      color:    0x05050a,
      emissive: new THREE.Color(def.emissive).multiplyScalar(0.08),
    })
    const interior = new THREE.Mesh(interiorGeo, interiorMat)
    interior.position.set(def.x, 2.5, def.z + 3)
    scene.add(interior)
    adminMeshesRef.current.push(interior)

    // Echo glow
    const echoLight = new THREE.PointLight(def.emissive, 0.8, 15)
    echoLight.position.set(def.x, 3, def.z + 4)
    scene.add(echoLight)
    adminMeshesRef.current.push(echoLight)

    const label = makeLabel(def.label, `#${new THREE.Color(def.emissive).getHexString()}`)
    label.position.set(def.x, 8, def.z)
    scene.add(label)
    adminMeshesRef.current.push(label)
    labelSpritesRef.current.push(label)
  }

  function buildATLAS(def: AdminStructureDef) {
    // ATLAS = map room building
    const mat = new THREE.MeshLambertMaterial({
      color:    def.color,
      emissive: new THREE.Color(def.emissive).multiplyScalar(0.2),
    })

    // Main building box
    const buildGeo = new THREE.BoxGeometry(9, 5, 7)
    const building  = new THREE.Mesh(buildGeo, mat)
    building.position.set(def.x, 2.5, def.z)
    building.castShadow = true
    building.receiveShadow = true
    scene.add(building)
    adminMeshesRef.current.push(building)

    // Roof ridge
    const roofGeo = new THREE.CylinderGeometry(0.3, 4.2, 2, 4)
    const roofMat = new THREE.MeshLambertMaterial({
      color:    def.color,
      emissive: new THREE.Color(def.emissive).multiplyScalar(0.3),
    })
    const roof = new THREE.Mesh(roofGeo, roofMat)
    roof.position.set(def.x, 6.5, def.z)
    roof.rotation.y = Math.PI / 4
    scene.add(roof)
    adminMeshesRef.current.push(roof)

    // Map data light
    const atlasLight = new THREE.PointLight(def.emissive, 0.9, 18)
    atlasLight.position.set(def.x, 6, def.z)
    scene.add(atlasLight)
    adminMeshesRef.current.push(atlasLight)

    const label = makeLabel(def.label, `#${new THREE.Color(def.emissive).getHexString()}`)
    label.position.set(def.x, 9, def.z)
    scene.add(label)
    adminMeshesRef.current.push(label)
    labelSpritesRef.current.push(label)
  }

  function buildNEXUS(def: AdminStructureDef) {
    // NEXUS = ambient — no fixed structure; world pulses when NEXUS active
    // Create a subtle pulsing sphere at center-top of east continent
    const nexusGeo = new THREE.SphereGeometry(2.5, 16, 12)
    const nexusMat = new THREE.MeshLambertMaterial({
      color:       0x100010,
      emissive:    new THREE.Color(def.emissive).multiplyScalar(0.4),
      transparent: true,
      opacity:     0.55,
      wireframe:   false,
    })
    const nexus = new THREE.Mesh(nexusGeo, nexusMat)
    nexus.position.set(def.x, 4, def.z)
    scene.add(nexus)
    nexusPulseRef.current = nexus
    adminMeshesRef.current.push(nexus)

    // NEXUS ambient light
    const nexusLight = new THREE.PointLight(def.emissive, 1.5, 40)
    nexusLight.position.set(def.x, 6, def.z)
    scene.add(nexusLight)
    adminMeshesRef.current.push(nexusLight)

    const label = makeLabel(def.label, `#${new THREE.Color(def.emissive).getHexString()}`)
    label.position.set(def.x, 8.5, def.z)
    scene.add(label)
    adminMeshesRef.current.push(label)
    labelSpritesRef.current.push(label)
  }

  function buildGUARDIANPerimeter() {
    const postMat = new THREE.MeshLambertMaterial({
      color:    0x0a0a20,
      emissive: new THREE.Color(0x2244ff).multiplyScalar(0.35),
    })

    for (const pos of GUARDIAN_POST_POSITIONS) {
      const postGeo = new THREE.BoxGeometry(1.2, 6, 1.2)
      const post    = new THREE.Mesh(postGeo, postMat)
      post.position.set(pos.x, 3, pos.z)
      post.castShadow = true
      scene.add(post)
      guardianPostsRef.current.push(post)

      // Perimeter light on each post
      const pLight = new THREE.PointLight(0x2244ff, 0.5, 12)
      pLight.position.set(pos.x, 6.5, pos.z)
      scene.add(pLight)
      guardianPostsRef.current.push(pLight as unknown as THREE.Mesh)
    }

    // GUARDIAN label at perimeter entry — NW31b: spec color #FF5060
    // NW38b: Y raised from 9→10 so GUARDIAN PERIMETER sits exactly 2 units above
    // OPERATOR (Y=8.0 in FortressLayer), giving a clean 2-unit stack.
    const guardLabel = makeLabel('GUARDIAN PERIMETER', '#FF5060')
    guardLabel.position.set(25, 10, 0)
    scene.add(guardLabel)
    adminMeshesRef.current.push(guardLabel)
    labelSpritesRef.current.push(guardLabel)
  }

  // ── Animation frame handler ───────────────────────────────────────────────

  function setupFrameHandler() {
    if (frameHandlerRef.current) {
      window.removeEventListener('nw:frame', frameHandlerRef.current)
    }

    const handler = () => {
      const dt = 0.016
      elapsedRef.current += dt
      const t = elapsedRef.current

      // Animate MRR mountain glow pulse
      if (mrrGlowRef.current) {
        mrrGlowRef.current.intensity = 0.8 + Math.sin(t * 1.2) * 0.4
      }

      // Animate enterprise tower torus rings (orbit)
      for (const grp of towerGroupsRef.current) {
        if (grp.userData.tierId === 'enterprise') {
          grp.traverse((obj) => {
            if ((obj as THREE.Mesh).geometry &&
              (obj as THREE.Mesh).geometry.type === 'TorusGeometry') {
              const axis = (obj as THREE.Mesh).userData.orbitAxis as number ?? 0
              const spd  = (obj as THREE.Mesh).userData.orbitSpeed as number ?? 0.5
              if (axis === 0) obj.rotation.z += spd * dt
              else if (axis === 1) obj.rotation.y += spd * dt
              else obj.rotation.x += spd * dt
            }
          })
        }
      }

      // Animate agent grid cell pulses
      const hubState = hubStateRef.current
      for (const cell of agentCellsRef.current) {
        const activity = hubState.agentActivity[cell.agentId] ?? 0
        const mat      = (cell.mesh as THREE.Mesh).material as THREE.MeshLambertMaterial
        const phase    = ((cell.mesh.userData.pulsePhase as number) ?? 0)
        const pulse    = activity * (0.5 + 0.5 * Math.sin(t * (2 + activity * 4) + phase))
        mat.emissive.setScalar(0)
        // High activity = bright teal/blue; idle = dark
        if (activity > 0.01) {
          const c = new THREE.Color(0x0033ff).lerp(new THREE.Color(0x00ffcc), activity)
          mat.emissive.copy(c).multiplyScalar(pulse * 0.6)
          mat.opacity = Math.max(0.0, pulse * 0.5)
        } else {
          mat.opacity = 0.0
        }
        mat.needsUpdate = true
      }

      // Animate SPARK pulse rings — expand outward, fade, reset
      for (const entry of sparkRingsRef.current) {
        const mat = (entry.ring as THREE.Mesh).material as THREE.MeshLambertMaterial
        const ringPhase = (t * 1.8 + entry.phase) % (Math.PI * 2)
        const normPhase = ringPhase / (Math.PI * 2)
        const scale     = 1.0 + normPhase * 3.5
        const opacity   = Math.max(0, 1.0 - normPhase)
        entry.ring.scale.set(scale, 1, scale)
        ;(mat as THREE.MeshLambertMaterial & { opacity: number }).opacity = opacity * 0.6
        mat.needsUpdate = true
      }

      // Animate NEXUS ambient sphere pulse (world pulse effect)
      if (nexusPulseRef.current) {
        const nexusMat = (nexusPulseRef.current as THREE.Mesh).material as THREE.MeshLambertMaterial
        const nexusPulse = 0.3 + 0.7 * Math.abs(Math.sin(t * 0.8))
        nexusMat.emissive.setRGB(
          nexusPulse * 1.0,
          nexusPulse * 0.0,
          nexusPulse * 1.0
        )
        nexusMat.opacity = 0.35 + nexusPulse * 0.25
        nexusMat.needsUpdate = true
        nexusPulseRef.current.rotation.y += dt * 0.3
      }

      // Update churn pool opacity (fade over 30 days)
      const now = Date.now()
      const thirtyDays = 30 * 24 * 60 * 60 * 1000
      for (const pool of churnPoolsRef.current) {
        const age = now - pool.createdAt
        const mat = (pool.mesh as THREE.Mesh).material as THREE.MeshLambertMaterial
        mat.opacity = Math.max(0, 1.0 - age / thirtyDays)
        mat.needsUpdate = true
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

  // ── Build all east continent objects ──────────────────────────────────────

  function buildAll(hubState: HubState) {
    buildTowers(hubState)
    buildChurnPools(hubState)
    buildMRRMountain(hubState.mrr)
    buildAgentGrid()
    buildNDAGate(hubState.ndaSignedCount, hubState.ndaTotalCount)
    buildIPFortress(hubState.ipFilings)
    buildAdminStructures()
  }

  // ── Mount / unmount ───────────────────────────────────────────────────────

  useEffect(() => {
    const hs = getMockHubState()
    hubStateRef.current = hs
    buildAll(hs)
    setupFrameHandler()

    // Listen for hub state updates from DataBridge / events
    const unsub = subscribeWorldData((_data: NWWorldData) => {
      // In future: extract hub subscriber data from _data
      // For now, keep mock state but allow external overrides
    })

    // Listen for live hub data injected via custom events
    function onHubData(e: Event) {
      const ev = e as CustomEvent<Partial<HubState>>
      if (ev.detail) {
        hubStateRef.current = { ...hubStateRef.current, ...ev.detail }
        buildAll(hubStateRef.current)
      }
    }
    window.addEventListener('nw:hub-data', onHubData)

    // NW24: Reposition admin structures on node-moved
    function onNodeMoved(e: Event) {
      const ev = e as CustomEvent<{ id: string; x: number; z: number }>
      if (!ev.detail) return
      const { id, x, z } = ev.detail
      if (adminStructObjsRef.current.has(id)) {
        repositionAdminStructEast(id, x, z)
      } else if (id === 'MRR_MOUNTAIN' || id === 'NDA_GATE' || id === 'IP_FORTRESS') {
        // Rebuild the specific object
        const hs = hubStateRef.current
        if (id === 'MRR_MOUNTAIN') buildMRRMountain(hs.mrr)
        if (id === 'NDA_GATE') buildNDAGate(hs.ndaSignedCount, hs.ndaTotalCount)
        if (id === 'IP_FORTRESS') buildIPFortress(hs.ipFilings)
      }
    }
    function onPositionsReset() {
      buildAdminStructures()
      const hs = hubStateRef.current
      buildMRRMountain(hs.mrr)
      buildNDAGate(hs.ndaSignedCount, hs.ndaTotalCount)
      buildIPFortress(hs.ipFilings)
    }
    window.addEventListener('nw:node-moved', onNodeMoved)
    window.addEventListener('nw:positions-reset', onPositionsReset)

    return () => {
      // Towers
      for (const grp of towerGroupsRef.current) {
        grp.traverse(obj => {
          if ((obj as THREE.Mesh).geometry) (obj as THREE.Mesh).geometry.dispose()
          const m = (obj as THREE.Mesh).material as THREE.Material | undefined
          if (m) m.dispose()
        })
        scene.remove(grp)
      }
      towerGroupsRef.current = []

      // Churn pools — NW15: dispose object pool
      for (const p of churnPoolsRef.current) scene.remove(p.mesh)
      churnPoolsRef.current = []
      if (churnPoolMeshPoolRef.current) {
        churnPoolMeshPoolRef.current.dispose()
        churnPoolMeshPoolRef.current = null
      }

      // MRR mountain
      if (mrrMountainRef.current) { disposeObj(scene, mrrMountainRef.current); mrrMountainRef.current = null }
      if (mrrGlowRef.current) { scene.remove(mrrGlowRef.current); mrrGlowRef.current = null }

      // Agent grid
      for (const cell of agentCellsRef.current) disposeObj(scene, cell.mesh)
      agentCellsRef.current = []

      // NDA gate
      if (ndaGateRef.current) {
        ndaGateRef.current.traverse(obj => {
          if ((obj as THREE.Mesh).geometry) (obj as THREE.Mesh).geometry.dispose()
          const m = (obj as THREE.Mesh).material as THREE.Material | undefined
          if (m) m.dispose()
        })
        scene.remove(ndaGateRef.current)
        ndaGateRef.current = null
      }
      for (const s of ndaSpheresRef.current) disposeObj(scene, s)
      ndaSpheresRef.current = []

      // IP walls
      for (const w of ipWallsRef.current) disposeObj(scene, w)
      ipWallsRef.current = []

      // Admin meshes
      for (const obj of adminMeshesRef.current) disposeObj(scene, obj)
      adminMeshesRef.current = []

      // NEXUS pulse
      if (nexusPulseRef.current) { disposeObj(scene, nexusPulseRef.current); nexusPulseRef.current = null }

      // Guardian posts
      for (const p of guardianPostsRef.current) disposeObj(scene, p)
      guardianPostsRef.current = []

      // SPARK rings
      for (const r of sparkRingsRef.current) disposeObj(scene, r.ring)
      sparkRingsRef.current = []

      // Frame handler
      if (frameHandlerRef.current) {
        window.removeEventListener('nw:frame', frameHandlerRef.current)
        frameHandlerRef.current = null
      }
      window.removeEventListener('nw:hub-data', onHubData)
      window.removeEventListener('nw:node-moved', onNodeMoved)
      window.removeEventListener('nw:positions-reset', onPositionsReset)
      unsub()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene])

  return null
}
