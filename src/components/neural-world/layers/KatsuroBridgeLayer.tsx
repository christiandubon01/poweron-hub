/**
 * KatsuroBridgeLayer.tsx — NW35: Katsuro Bridge Tower.
 *
 * Elevated tower between both continents above the Fortress at x=10, y=20, z=0.
 *
 * STRUCTURE:
 *   - Tall tower: CylinderGeometry (r=4, h=25) with crimson base #FF3030
 *   - Gold lightning accent edge strips running vertically (thin boxes)
 *   - Platform at top: CircleGeometry r=6
 *   - Katsuro figure — samurai-inspired humanoid (NOT an orb):
 *       torso CylinderGeometry + head SphereGeometry + shoulders BoxGeometry
 *       Color: crimson core #FF3030 with gold #FFD700 edges
 *       Gold spark particle effect drifting upward
 *       Floating label "⚡ KATSURO RAIJIN"
 *
 * READ LINES:
 *   Thin gold lines (opacity 0.3) from Katsuro tower TO every Hub domain zone.
 *   Small arrow particles flowing FROM domain TOWARD Katsuro.
 *   When Hub Audit mode active (nw:hub-audit), lines brighten (opacity 0.8) and pulse.
 *
 * HANDOFF VISUALIZATION:
 *   Every 90s (or on nw:katsuro-handoff):
 *     - Gold octahedron packet spawns at tower top
 *     - Travels arc DOWN to Fortress OPERATOR monument
 *     - NEXUS flashes, packet merges into briefing sphere
 *     - Subtitle "Katsuro handoff received: [type]"
 *     - Teal return pulse from NEXUS back up to Katsuro
 *
 * LIFE BLOCK OVERLAYS (semi-transparent ground zones when layer ON):
 *   App Build (#3A8EFF, 15%), App Strategy (#AA6EFF), Electrical Pipeline (#FF9040),
 *   RMO Oversight (#FF6B6B), Family (#FFF5E6), Money (#90EE90)
 *
 * PLANNED AGENT WIREFRAMES:
 *   HUNTER, NEGOTIATE, SENTINEL, ATLAS-ENTERPRISE, PersonalOS agents as wireframe
 *   spheres at their future domain positions. Gentle pulse. Dim "PLANNED Vn" labels.
 *
 * PersonalOS agents orbiting Katsuro's tower platform:
 *   CORE (white), MOMENTUM (orange orbiting), MIRROR (silver-blue), ATLAS Personal (green)
 *
 * Toggled by the "katsuro-bridge" layer in CommandHUD.
 * Tower always stays; read lines + overlays + handoffs hidden when layer OFF.
 */

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useWorldContext } from '../WorldContext'
import { makeLabel, disposeLabel, type NWLabel } from '../utils/makeLabel'

// ── Constants ──────────────────────────────────────────────────────────────────

const KX = 10    // tower center x
const KZ = 0     // tower center z
const TOWER_BASE_Y   = 0
const TOWER_HEIGHT   = 25
const TOWER_TOP_Y    = TOWER_BASE_Y + TOWER_HEIGHT
const FIGURE_BASE_Y  = TOWER_TOP_Y + 0.5  // figure sits on top platform
const PLATFORM_Y     = TOWER_TOP_Y
const HANDOFF_INTERVAL = 90_000  // ms between auto handoffs

const CRIMSON = 0xFF3030
const GOLD    = 0xFFD700
const TEAL    = 0x00E5CC

// Domain positions for read lines (matching AgentFlightLayer)
const DOMAIN_TARGETS = [
  { id: 'lead-acquisition',    x: -175, z: -120 },
  { id: 'closing',             x: -150, z:   60 },
  { id: 'project-installation',x: -130, z:  -70 },
  { id: 'compliance',          x: -165, z: -110 },
  { id: 'material-takeoff',    x: -172, z:   90 },
  { id: 'revenue',             x:  -35, z:   25 },
  { id: 'progress-tracking',   x: -105, z:    0 },
  { id: 'analysis',            x:  160, z:    0 },
  { id: 'memory',              x:  110, z:  130 },
  { id: 'geographic',          x:   75, z:   80 },
]

// Operator monument position (from FortressLayer/AgentFlightLayer)
const OPERATOR_X = 25
const OPERATOR_Z = 0

// Life block overlays
const LIFE_BLOCKS = [
  { id: 'app-build',          label: 'App Build',          color: '#3A8EFF', alpha: 0.15, cx: 120, cz:  20, rw: 80, rd: 80 },
  { id: 'app-strategy',       label: 'App Strategy',       color: '#AA6EFF', alpha: 0.12, cx:   0, cz:  10, rw: 420, rd: 10 },
  { id: 'electrical-pipeline',label: 'Electrical Pipeline',color: '#FF9040', alpha: 0.15, cx: -130, cz:  0, rw: 100, rd: 120 },
  { id: 'rmo-oversight',      label: 'RMO Oversight',      color: '#FF6B6B', alpha: 0.15, cx: -160, cz: -50, rw: 60, rd: 50 },
  { id: 'family',             label: 'Family',             color: '#FFF5E6', alpha: 0.12, cx:   0, cz:   0, rw: 20, rd: 20 },
  { id: 'money',              label: 'Money',              color: '#90EE90', alpha: 0.15, cx:  -35, cz:  25, rw: 80, rd: 60 },
]

// Planned agents
const PLANNED_AGENTS = [
  { id: 'HUNTER',       version: 'V4', color: 0xFFE040, x: -180, z: -140, role: 'Lead Hunter' },
  { id: 'NEGOTIATE',    version: 'V4', color: 0xFF9040, x: -155, z:   55, role: 'Negotiation' },
  { id: 'SENTINEL',     version: 'V5', color: 0xFF5060, x:   30, z:  -15, role: 'Security' },
  { id: 'ATLAS-ENT',    version: 'V6', color: 0x40FF80, x:   90, z:  100, role: 'Enterprise Map' },
]

// PersonalOS agents (orbit Katsuro tower)
const PERSONAL_OS_AGENTS = [
  { id: 'CORE',         version: 'V5', color: 0xFFFFFF, orbitR: 0,   orbitSpeed: 0,    label: 'CORE' },
  { id: 'MOMENTUM',     version: 'V5', color: 0xFF8C00, orbitR: 8,   orbitSpeed: 0.4,  label: 'MOMENTUM' },
  { id: 'MIRROR',       version: 'V5', color: 0x9AC8FF, orbitR: 11,  orbitSpeed: -0.3, label: 'MIRROR' },
  { id: 'ATLAS-PERSONAL',version:'V6', color: 0x5FBD8A, orbitR: 14,  orbitSpeed: 0.25, label: 'ATLAS PERSONAL' },
]

// ── Dispose helper ─────────────────────────────────────────────────────────────

function disposeGroup(scene: THREE.Scene, g: THREE.Group | null) {
  if (!g) return
  scene.remove(g)
  g.traverse(child => {
    const m = child as THREE.Mesh
    if (m.geometry) m.geometry.dispose()
    const mat = m.material as THREE.Material | THREE.Material[] | undefined
    if (Array.isArray(mat)) mat.forEach(x => x.dispose())
    else if (mat) mat.dispose()
    const smat = (child as THREE.Sprite).material as THREE.SpriteMaterial | undefined
    if (smat?.map) { smat.map.dispose(); smat.dispose() }
  })
}

function disposeObj(scene: THREE.Scene, obj: THREE.Object3D | null) {
  if (!obj) return
  scene.remove(obj)
  const m = obj as THREE.Mesh
  if (m.geometry) m.geometry.dispose()
  const mat = m.material as THREE.Material | THREE.Material[] | undefined
  if (Array.isArray(mat)) mat.forEach(x => x.dispose())
  else if (mat) mat.dispose()
}

// ── Props ──────────────────────────────────────────────────────────────────────

interface KatsuroBridgeLayerProps {
  visible: boolean
}

// ── Component ──────────────────────────────────────────────────────────────────

export function KatsuroBridgeLayer({ visible }: KatsuroBridgeLayerProps) {
  const { scene, camera } = useWorldContext()

  // Always-visible objects (tower + figure)
  const towerGroupRef       = useRef<THREE.Group | null>(null)
  const figureGroupRef      = useRef<THREE.Group | null>(null)
  const sparkParticlesRef   = useRef<THREE.Points | null>(null)
  const labelSpriteRef      = useRef<NWLabel | null>(null)

  // Layer-gated objects
  const readLinesGroupRef   = useRef<THREE.Group | null>(null)
  const lifeBlocksGroupRef  = useRef<THREE.Group | null>(null)
  const plannedGroupRef     = useRef<THREE.Group | null>(null)
  const personalOSGroupRef  = useRef<THREE.Group | null>(null)

  // Handoff packet
  const packetRef           = useRef<THREE.Mesh | null>(null)
  const packetActiveRef     = useRef(false)
  const packetProgressRef   = useRef(0)  // 0→1 for arc travel
  const subtitleTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Teal return pulse
  const returnPulseRef      = useRef<THREE.Mesh | null>(null)
  const returnProgressRef   = useRef(0)
  const returnActiveRef     = useRef(false)

  // Frame animation refs
  const frameHandlerRef     = useRef<(() => void) | null>(null)
  const elapsedRef          = useRef(0)
  const handoffTimerRef     = useRef<ReturnType<typeof setInterval> | null>(null)
  const initTimeoutRef      = useRef<ReturnType<typeof setTimeout> | null>(null)
  const allLabelSprites     = useRef<NWLabel[]>([])

  // Audit mode
  const auditModeRef        = useRef(false)
  const readLineMatRef      = useRef<THREE.LineBasicMaterial | null>(null)

  // Particle geometry data
  const sparkPosRef         = useRef<Float32Array | null>(null)
  const sparkVelRef         = useRef<Float32Array | null>(null)

  // PersonalOS orbit angles
  const personalOSAnglesRef = useRef<number[]>([0, 0, 0, 0])

  // ── Build tower + figure (always visible) ────────────────────────────────

  useEffect(() => {
    buildTower()
    buildFigure()
    buildLayerGated()
    setupFrameHandler()
    setupHandoffTimer()
    setupEventListeners()

    return () => {
      cleanup()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene])

  // ── Toggle layer-gated visibility ────────────────────────────────────────

  useEffect(() => {
    if (readLinesGroupRef.current) readLinesGroupRef.current.visible = visible
    if (lifeBlocksGroupRef.current) lifeBlocksGroupRef.current.visible = visible
    if (plannedGroupRef.current) plannedGroupRef.current.visible = visible
    if (personalOSGroupRef.current) personalOSGroupRef.current.visible = visible
  }, [visible])

  // ── Build functions ───────────────────────────────────────────────────────

  function buildTower() {
    if (towerGroupRef.current) disposeGroup(scene, towerGroupRef.current)
    const g = new THREE.Group()
    towerGroupRef.current = g

    // Main tower cylinder
    const towerGeo = new THREE.CylinderGeometry(4, 4.8, TOWER_HEIGHT, 8, 3)
    const towerMat = new THREE.MeshLambertMaterial({
      color: CRIMSON,
      emissive: new THREE.Color(CRIMSON).multiplyScalar(0.12),
    })
    const tower = new THREE.Mesh(towerGeo, towerMat)
    tower.position.set(KX, TOWER_BASE_Y + TOWER_HEIGHT / 2, KZ)
    g.add(tower)

    // Gold lightning accent strips (vertical, 8 sides = 8 strips)
    const sides = 8
    for (let i = 0; i < sides; i++) {
      const angle = (i / sides) * Math.PI * 2
      const r = 4.05
      const stripGeo = new THREE.BoxGeometry(0.18, TOWER_HEIGHT * 0.9, 0.18)
      const stripMat = new THREE.MeshLambertMaterial({
        color: GOLD,
        emissive: new THREE.Color(GOLD).multiplyScalar(0.35),
      })
      const strip = new THREE.Mesh(stripGeo, stripMat)
      strip.position.set(
        KX + Math.cos(angle) * r,
        TOWER_BASE_Y + TOWER_HEIGHT / 2,
        KZ + Math.sin(angle) * r,
      )
      g.add(strip)
    }

    // Platform at top
    const platGeo = new THREE.CylinderGeometry(6, 5.5, 0.6, 16)
    const platMat = new THREE.MeshLambertMaterial({
      color: 0x2a0808,
      emissive: new THREE.Color(GOLD).multiplyScalar(0.15),
    })
    const platform = new THREE.Mesh(platGeo, platMat)
    platform.position.set(KX, PLATFORM_Y + 0.3, KZ)
    g.add(platform)

    // Platform edge glow ring (flat torus)
    const ringGeo = new THREE.TorusGeometry(5.8, 0.15, 6, 32)
    const ringMat = new THREE.MeshLambertMaterial({
      color: GOLD,
      emissive: new THREE.Color(GOLD).multiplyScalar(0.8),
    })
    const ring = new THREE.Mesh(ringGeo, ringMat)
    ring.rotation.x = Math.PI / 2
    ring.position.set(KX, PLATFORM_Y + 0.65, KZ)
    g.add(ring)

    // Point light at tower top
    const light = new THREE.PointLight(GOLD, 2.5, 40)
    light.position.set(KX, PLATFORM_Y + 3, KZ)
    g.add(light)

    scene.add(g)
  }

  function buildFigure() {
    if (figureGroupRef.current) disposeGroup(scene, figureGroupRef.current)
    if (sparkParticlesRef.current) disposeObj(scene, sparkParticlesRef.current)
    if (labelSpriteRef.current) { scene.remove(labelSpriteRef.current); disposeLabel(labelSpriteRef.current) }
    allLabelSprites.current = []

    const fg = new THREE.Group()
    figureGroupRef.current = fg

    const base = FIGURE_BASE_Y
    const crimsonMat = new THREE.MeshLambertMaterial({
      color: CRIMSON,
      emissive: new THREE.Color(CRIMSON).multiplyScalar(0.25),
    })
    const goldEdgeMat = new THREE.MeshLambertMaterial({
      color: GOLD,
      emissive: new THREE.Color(GOLD).multiplyScalar(0.5),
    })

    // Legs
    for (let side = -1; side <= 1; side += 2) {
      const legGeo = new THREE.CylinderGeometry(0.18, 0.15, 0.8, 6)
      const leg = new THREE.Mesh(legGeo, crimsonMat)
      leg.position.set(KX + side * 0.22, base + 0.4, KZ)
      fg.add(leg)
    }

    // Torso
    const torsoGeo = new THREE.CylinderGeometry(0.3, 0.25, 1.0, 7)
    const torso = new THREE.Mesh(torsoGeo, crimsonMat)
    torso.position.set(KX, base + 1.3, KZ)
    fg.add(torso)

    // Chest gold accent
    const chestGeo = new THREE.BoxGeometry(0.55, 0.55, 0.12)
    const chest = new THREE.Mesh(chestGeo, goldEdgeMat)
    chest.position.set(KX, base + 1.4, KZ + 0.3)
    fg.add(chest)

    // Shoulders (angular BoxGeometry — samurai pauldrons)
    for (let side = -1; side <= 1; side += 2) {
      const shoulderGeo = new THREE.BoxGeometry(0.4, 0.28, 0.45)
      const shoulder = new THREE.Mesh(shoulderGeo, goldEdgeMat)
      shoulder.position.set(KX + side * 0.62, base + 1.7, KZ)
      shoulder.rotation.z = side * 0.18
      fg.add(shoulder)

      // Arm
      const armGeo = new THREE.CylinderGeometry(0.12, 0.10, 0.75, 5)
      const arm = new THREE.Mesh(armGeo, crimsonMat)
      arm.position.set(KX + side * 0.62, base + 1.28, KZ)
      arm.rotation.z = side * 0.25
      fg.add(arm)
    }

    // Head (sphere)
    const headGeo = new THREE.SphereGeometry(0.32, 8, 6)
    const head = new THREE.Mesh(headGeo, crimsonMat)
    head.position.set(KX, base + 2.15, KZ)
    fg.add(head)

    // Head crest / helmet ridge (gold)
    const crestGeo = new THREE.BoxGeometry(0.08, 0.28, 0.55)
    const crest = new THREE.Mesh(crestGeo, goldEdgeMat)
    crest.position.set(KX, base + 2.38, KZ)
    fg.add(crest)

    // Katana / weapon diagonal
    const bladeMat = new THREE.MeshLambertMaterial({ color: 0xC0C0FF, emissive: new THREE.Color(0x8888ff).multiplyScalar(0.3) })
    const bladeGeo = new THREE.BoxGeometry(0.06, 1.6, 0.04)
    const blade = new THREE.Mesh(bladeGeo, bladeMat)
    blade.rotation.z = 0.55
    blade.position.set(KX + 0.88, base + 1.75, KZ + 0.12)
    fg.add(blade)

    scene.add(fg)

    // ── Gold spark particles ──────────────────────────────────────────────
    const SPARK_COUNT = 60
    const positions = new Float32Array(SPARK_COUNT * 3)
    const velocities = new Float32Array(SPARK_COUNT * 3)
    for (let i = 0; i < SPARK_COUNT; i++) {
      const angle = Math.random() * Math.PI * 2
      const r = Math.random() * 0.7
      positions[i * 3 + 0] = KX + Math.cos(angle) * r
      positions[i * 3 + 1] = base + 1.5 + Math.random() * 1.5
      positions[i * 3 + 2] = KZ + Math.sin(angle) * r
      velocities[i * 3 + 0] = (Math.random() - 0.5) * 0.015
      velocities[i * 3 + 1] = 0.03 + Math.random() * 0.04
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.015
    }
    sparkPosRef.current = positions
    sparkVelRef.current = velocities

    const sparkGeo = new THREE.BufferGeometry()
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const sparkMat = new THREE.PointsMaterial({
      color: GOLD,
      size: 0.22,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    const sparks = new THREE.Points(sparkGeo, sparkMat)
    sparkParticlesRef.current = sparks
    scene.add(sparks)

    // ── Floating label ────────────────────────────────────────────────────
    const lbl = makeLabel('⚡ KATSURO RAIJIN', '#FFD700', { fontSize: 20 })
    lbl.position.set(KX, base + 3.5, KZ)
    labelSpriteRef.current = lbl
    allLabelSprites.current.push(lbl)
    scene.add(lbl)
  }

  function buildLayerGated() {
    buildReadLines()
    buildLifeBlocks()
    buildPlannedWireframes()
    buildPersonalOSOrbs()
  }

  function buildReadLines() {
    if (readLinesGroupRef.current) disposeGroup(scene, readLinesGroupRef.current)
    const g = new THREE.Group()
    readLinesGroupRef.current = g

    const mat = new THREE.LineBasicMaterial({
      color: GOLD,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
    })
    readLineMatRef.current = mat

    const towerPos = new THREE.Vector3(KX, PLATFORM_Y + 2, KZ)

    for (const dom of DOMAIN_TARGETS) {
      // Main read line
      const pts = [
        new THREE.Vector3(dom.x, 3, dom.z),
        towerPos,
      ]
      const geo = new THREE.BufferGeometry().setFromPoints(pts)
      const line = new THREE.Line(geo, mat)
      g.add(line)
    }

    g.visible = visible
    scene.add(g)
  }

  function buildLifeBlocks() {
    if (lifeBlocksGroupRef.current) disposeGroup(scene, lifeBlocksGroupRef.current)
    const g = new THREE.Group()
    lifeBlocksGroupRef.current = g

    for (const lb of LIFE_BLOCKS) {
      const r = parseInt(lb.color.slice(1, 3), 16)
      const gr = parseInt(lb.color.slice(3, 5), 16)
      const b = parseInt(lb.color.slice(5, 7), 16)

      const planeGeo = new THREE.PlaneGeometry(lb.rw, lb.rd)
      const planeMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(r / 255, gr / 255, b / 255),
        transparent: true,
        opacity: lb.alpha,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
      const plane = new THREE.Mesh(planeGeo, planeMat)
      plane.rotation.x = -Math.PI / 2
      plane.position.set(lb.cx, 0.15, lb.cz)
      g.add(plane)

      // Floating label
      const lbl = makeLabel(lb.label, lb.color, { fontSize: 14 })
      lbl.position.set(lb.cx, 2.5, lb.cz)
      g.add(lbl)
      allLabelSprites.current.push(lbl)
    }

    g.visible = visible
    scene.add(g)
  }

  function buildPlannedWireframes() {
    if (plannedGroupRef.current) disposeGroup(scene, plannedGroupRef.current)
    const g = new THREE.Group()
    plannedGroupRef.current = g

    for (const pa of PLANNED_AGENTS) {
      const r = 1.1
      const sGeo = new THREE.SphereGeometry(r, 8, 6)
      const wfGeo = new THREE.WireframeGeometry(sGeo)
      const wfMat = new THREE.LineBasicMaterial({
        color: pa.color,
        transparent: true,
        opacity: 0.30,
        depthWrite: false,
      })
      const wf = new THREE.LineSegments(wfGeo, wfMat)
      wf.position.set(pa.x, 3.5, pa.z)
      g.add(wf)
      sGeo.dispose()

      // Label: agent name + "PLANNED Vn"
      const lbl = makeLabel(`${pa.id}  PLANNED ${pa.version}`, '#888888', { fontSize: 13 })
      lbl.position.set(pa.x, 5.5, pa.z)
      g.add(lbl)
      allLabelSprites.current.push(lbl)
    }

    g.visible = visible
    scene.add(g)
  }

  function buildPersonalOSOrbs() {
    if (personalOSGroupRef.current) disposeGroup(scene, personalOSGroupRef.current)
    const g = new THREE.Group()
    personalOSGroupRef.current = g
    personalOSAnglesRef.current = [0, 0, 0, 0]

    const platformY = PLATFORM_Y + 1.2

    for (let i = 0; i < PERSONAL_OS_AGENTS.length; i++) {
      const pa = PERSONAL_OS_AGENTS[i]
      const sGeo = new THREE.SphereGeometry(0.55, 7, 5)
      const wfGeo = new THREE.WireframeGeometry(sGeo)
      const wfMat = new THREE.LineBasicMaterial({
        color: pa.color,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      })
      const wf = new THREE.LineSegments(wfGeo, wfMat)
      // Initial position (will be updated in frame loop for orbiters)
      const angle0 = (i / PERSONAL_OS_AGENTS.length) * Math.PI * 2
      const baseX = pa.orbitR > 0 ? KX + Math.cos(angle0) * pa.orbitR : KX
      const baseZ = pa.orbitR > 0 ? KZ + Math.sin(angle0) * pa.orbitR : KZ
      wf.position.set(baseX, platformY, baseZ)
      wf.userData = { idx: i, orbR: pa.orbitR, orbSpeed: pa.orbitSpeed, baseY: platformY }
      g.add(wf)
      sGeo.dispose()

      // Label
      const lbl = makeLabel(`${pa.label}  PLANNED ${pa.version}`, '#666688', { fontSize: 12 })
      lbl.position.set(baseX, platformY + 1.2, baseZ)
      lbl.userData = { idx: i, orbR: pa.orbitR, baseY: platformY }
      g.add(lbl)
      allLabelSprites.current.push(lbl)
    }

    g.visible = visible
    scene.add(g)
  }

  function buildHandoffPacket() {
    if (packetRef.current) disposeObj(scene, packetRef.current)
    const geo = new THREE.OctahedronGeometry(0.5)
    const mat = new THREE.MeshLambertMaterial({
      color: GOLD,
      emissive: new THREE.Color(GOLD).multiplyScalar(0.9),
      transparent: true,
      opacity: 0.0,
    })
    const packet = new THREE.Mesh(geo, mat)
    packet.position.set(KX, PLATFORM_Y + 3, KZ)
    packetRef.current = packet
    scene.add(packet)
  }

  function buildReturnPulse() {
    if (returnPulseRef.current) disposeObj(scene, returnPulseRef.current)
    const geo = new THREE.SphereGeometry(0.3, 6, 4)
    const mat = new THREE.MeshLambertMaterial({
      color: TEAL,
      emissive: new THREE.Color(TEAL).multiplyScalar(0.9),
      transparent: true,
      opacity: 0.0,
    })
    const pulse = new THREE.Mesh(geo, mat)
    returnPulseRef.current = pulse
    scene.add(pulse)
  }

  function triggerHandoff(type: string = 'brief') {
    if (packetActiveRef.current) return
    packetActiveRef.current = true
    packetProgressRef.current = 0
    returnActiveRef.current = false
    returnProgressRef.current = 0

    if (!packetRef.current) buildHandoffPacket()
    if (!returnPulseRef.current) buildReturnPulse()

    const pmat = packetRef.current!.material as THREE.MeshLambertMaterial
    pmat.opacity = 1.0

    // Show subtitle via custom event
    window.dispatchEvent(new CustomEvent('nw:katsuro-subtitle', {
      detail: { text: `Katsuro handoff received: ${type}` }
    }))

    // Auto-clear subtitle
    if (subtitleTimerRef.current) clearTimeout(subtitleTimerRef.current)
    subtitleTimerRef.current = setTimeout(() => {
      window.dispatchEvent(new CustomEvent('nw:katsuro-subtitle', { detail: { text: '' } }))
    }, 4000)
  }

  function setupHandoffTimer() {
    // Initial handoff after 5s, then every 90s
    const timeout = setTimeout(() => triggerHandoff('initial-brief'), 5000)
    handoffTimerRef.current = setInterval(() => {
      const types = ['data-sweep', 'compliance-report', 'revenue-brief', 'strategy-update']
      triggerHandoff(types[Math.floor(Math.random() * types.length)])
    }, HANDOFF_INTERVAL)

    // Store timeout for cleanup in its own ref (cannot attach to a plain number)
    initTimeoutRef.current = timeout
  }

  function setupEventListeners() {
    function onHubAudit(e: Event) {
      const ev = e as CustomEvent<{ active: boolean }>
      auditModeRef.current = !!ev.detail?.active
      if (readLineMatRef.current) {
        readLineMatRef.current.opacity = auditModeRef.current ? 0.8 : 0.3
      }
    }
    function onKatsuroHandoff(e: Event) {
      const ev = e as CustomEvent<{ type?: string }>
      triggerHandoff(ev.detail?.type ?? 'event-handoff')
    }

    window.addEventListener('nw:hub-audit', onHubAudit)
    window.addEventListener('nw:katsuro-handoff', onKatsuroHandoff)

    // Store for cleanup
    const cleanup = () => {
      window.removeEventListener('nw:hub-audit', onHubAudit)
      window.removeEventListener('nw:katsuro-handoff', onKatsuroHandoff)
    }
    ;(setupEventListeners as unknown as { _cleanup: () => void })._cleanup = cleanup
  }

  function setupFrameHandler() {
    buildHandoffPacket()
    buildReturnPulse()

    function onFrame() {
      const dt = 1 / 60
      elapsedRef.current += dt

      const t = elapsedRef.current

      // ── Figure idle animation ──────────────────────────────────────────
      if (figureGroupRef.current) {
        figureGroupRef.current.rotation.y = t * 0.4
        figureGroupRef.current.position.y = Math.sin(t * 0.7) * 0.3
      }

      // ── Gold spark update ──────────────────────────────────────────────
      if (sparkParticlesRef.current && sparkPosRef.current && sparkVelRef.current) {
        const pos = sparkPosRef.current
        const vel = sparkVelRef.current
        const base = FIGURE_BASE_Y
        const SPARK_COUNT = pos.length / 3
        for (let i = 0; i < SPARK_COUNT; i++) {
          pos[i * 3 + 0] += vel[i * 3 + 0]
          pos[i * 3 + 1] += vel[i * 3 + 1]
          pos[i * 3 + 2] += vel[i * 3 + 2]
          // Reset if too high or too far
          if (pos[i * 3 + 1] > base + 3.5 || Math.random() < 0.005) {
            const angle = Math.random() * Math.PI * 2
            const r = Math.random() * 0.7
            pos[i * 3 + 0] = KX + Math.cos(angle) * r
            pos[i * 3 + 1] = base + 1.2 + Math.random() * 0.5
            pos[i * 3 + 2] = KZ + Math.sin(angle) * r
            vel[i * 3 + 0] = (Math.random() - 0.5) * 0.015
            vel[i * 3 + 1] = 0.03 + Math.random() * 0.04
            vel[i * 3 + 2] = (Math.random() - 0.5) * 0.015
          }
        }
        const attr = sparkParticlesRef.current.geometry.attributes['position'] as THREE.BufferAttribute
        attr.needsUpdate = true

        // Pulse opacity
        const smat = sparkParticlesRef.current.material as THREE.PointsMaterial
        smat.opacity = 0.6 + Math.sin(t * 2.5) * 0.25
      }

      // ── Read line pulse in audit mode ──────────────────────────────────
      if (auditModeRef.current && readLineMatRef.current) {
        readLineMatRef.current.opacity = 0.5 + Math.sin(t * 3) * 0.3
      }

      // ── Handoff packet arc ─────────────────────────────────────────────
      if (packetActiveRef.current && packetRef.current) {
        packetProgressRef.current += dt / 4  // 4 seconds travel
        const p = Math.min(packetProgressRef.current, 1)

        const startX = KX, startY = PLATFORM_Y + 3, startZ = KZ
        const endX = OPERATOR_X, endY = 2, endZ = OPERATOR_Z
        const arcH = 30

        // Quadratic bezier arc
        const t_ = p
        const mt = 1 - t_
        const mx = mt * mt * startX + 2 * mt * t_ * ((startX + endX) / 2) + t_ * t_ * endX
        const my = mt * mt * startY + 2 * mt * t_ * (Math.max(startY, endY) + arcH) + t_ * t_ * endY
        const mz = mt * mt * startZ + 2 * mt * t_ * ((startZ + endZ) / 2) + t_ * t_ * endZ

        packetRef.current.position.set(mx, my, mz)
        packetRef.current.rotation.y = t * 4
        packetRef.current.rotation.x = t * 2.5

        const pmat = packetRef.current.material as THREE.MeshLambertMaterial
        pmat.opacity = p < 0.9 ? 1.0 : 1.0 - (p - 0.9) / 0.1

        if (p >= 1) {
          packetActiveRef.current = false
          pmat.opacity = 0
          packetRef.current.position.set(KX, PLATFORM_Y + 3, KZ)
          // Flash NEXUS
          window.dispatchEvent(new CustomEvent('nw:nexus-flash', { detail: { color: '#FFD700', duration: 600 } }))
          // Start return pulse
          returnActiveRef.current = true
          returnProgressRef.current = 0
        }
      }

      // ── Return teal pulse ──────────────────────────────────────────────
      if (returnActiveRef.current && returnPulseRef.current) {
        returnProgressRef.current += dt / 2  // 2 seconds return
        const p = Math.min(returnProgressRef.current, 1)

        const startX = OPERATOR_X, startY = 2, startZ = OPERATOR_Z
        const endX = KX, endY = PLATFORM_Y + 3, endZ = KZ
        const t_ = p
        const mt = 1 - t_
        const mx = mt * startX + t_ * endX
        const my = mt * mt * startY + 2 * mt * t_ * 15 + t_ * t_ * endY
        const mz = mt * startZ + t_ * endZ

        returnPulseRef.current.position.set(mx, my, mz)
        const rmat = returnPulseRef.current.material as THREE.MeshLambertMaterial
        rmat.opacity = p < 0.9 ? 0.85 : 0.85 * (1 - (p - 0.9) / 0.1)

        if (p >= 1) {
          returnActiveRef.current = false
          rmat.opacity = 0
        }
      }

      // ── PersonalOS orbs orbit ──────────────────────────────────────────
      if (personalOSGroupRef.current && visible) {
        const children = personalOSGroupRef.current.children
        let wfIdx = 0
        let lblIdx = 0
        // Interleaved: wf, lbl, wf, lbl...
        for (let i = 0; i < PERSONAL_OS_AGENTS.length; i++) {
          const pa = PERSONAL_OS_AGENTS[i]
          if (pa.orbitR <= 0) continue

          personalOSAnglesRef.current[i] = (personalOSAnglesRef.current[i] ?? 0) + pa.orbitSpeed * dt
          const angle = personalOSAnglesRef.current[i]
          const nx = KX + Math.cos(angle) * pa.orbitR
          const nz = KZ + Math.sin(angle) * pa.orbitR
          const ny = PLATFORM_Y + 1.2

          // Find the wireframe and label for this agent
          // Walk children: pairs [wireframe, label]
          const wf = children[i * 2] as THREE.LineSegments | undefined
          const lbl = children[i * 2 + 1] as THREE.Sprite | undefined
          if (wf) wf.position.set(nx, ny, nz)
          if (lbl) lbl.position.set(nx, ny + 1.2, nz)
        }
        // Gentle pulse scale for all wireframes
        const pulse = 0.95 + Math.sin(t * 2.0) * 0.05
        for (let i = 0; i < PERSONAL_OS_AGENTS.length; i++) {
          const wf = children[i * 2] as THREE.LineSegments | undefined
          if (wf) wf.scale.setScalar(pulse)
        }
      }

      // ── Planned agent wireframe pulse ──────────────────────────────────
      if (plannedGroupRef.current && visible) {
        const pulse = 0.95 + Math.sin(t * 2.0) * 0.05
        plannedGroupRef.current.children.forEach((child) => {
          if (child instanceof THREE.LineSegments) {
            child.scale.setScalar(pulse)
          }
        })
      }

      // ── Label visibility updates ───────────────────────────────────────
      if (camera) {
        const wp = new THREE.Vector3()
        for (const lbl of allLabelSprites.current) {
          lbl.getWorldPosition(wp)
          lbl.updateVisibility(camera as THREE.PerspectiveCamera, wp)
        }
        if (labelSpriteRef.current) {
          labelSpriteRef.current.getWorldPosition(wp)
          labelSpriteRef.current.updateVisibility(camera as THREE.PerspectiveCamera, wp)
        }
      }
    }

    frameHandlerRef.current = onFrame
    window.addEventListener('nw:frame', onFrame)
  }

  function cleanup() {
    if (frameHandlerRef.current) {
      window.removeEventListener('nw:frame', frameHandlerRef.current)
      frameHandlerRef.current = null
    }
    if (handoffTimerRef.current) {
      clearInterval(handoffTimerRef.current)
      handoffTimerRef.current = null
    }
    if (initTimeoutRef.current) {
      clearTimeout(initTimeoutRef.current)
      initTimeoutRef.current = null
    }
    if (subtitleTimerRef.current) {
      clearTimeout(subtitleTimerRef.current)
      subtitleTimerRef.current = null
    }

    // Call event listener cleanup
    const ec = (setupEventListeners as unknown as { _cleanup?: () => void })._cleanup
    if (ec) ec()

    // Dispose all Three.js objects
    disposeGroup(scene, towerGroupRef.current)
    disposeGroup(scene, figureGroupRef.current)
    disposeGroup(scene, readLinesGroupRef.current)
    disposeGroup(scene, lifeBlocksGroupRef.current)
    disposeGroup(scene, plannedGroupRef.current)
    disposeGroup(scene, personalOSGroupRef.current)

    if (sparkParticlesRef.current) {
      sparkParticlesRef.current.geometry.dispose()
      ;(sparkParticlesRef.current.material as THREE.Material).dispose()
      scene.remove(sparkParticlesRef.current)
      sparkParticlesRef.current = null
    }
    if (labelSpriteRef.current) {
      scene.remove(labelSpriteRef.current)
      disposeLabel(labelSpriteRef.current)
      labelSpriteRef.current = null
    }
    if (packetRef.current) {
      scene.remove(packetRef.current)
      ;(packetRef.current.geometry as THREE.BufferGeometry).dispose()
      ;(packetRef.current.material as THREE.Material).dispose()
      packetRef.current = null
    }
    if (returnPulseRef.current) {
      scene.remove(returnPulseRef.current)
      ;(returnPulseRef.current.geometry as THREE.BufferGeometry).dispose()
      ;(returnPulseRef.current.material as THREE.Material).dispose()
      returnPulseRef.current = null
    }

    towerGroupRef.current = null
    figureGroupRef.current = null
    readLinesGroupRef.current = null
    lifeBlocksGroupRef.current = null
    plannedGroupRef.current = null
    personalOSGroupRef.current = null
    allLabelSprites.current = []
  }

  return null
}
