/**
 * EnterpriseMetricsLayer.tsx — NW14: V5 Enterprise Metrics landscape.
 *
 * Night mirror world. Dark ground reflects lagging indicators.
 * Real terrain shows leading indicators as 3D features:
 *
 *   1. CAC Mountain vs LTV Mountain — unit economics gap valley between
 *   2. NRR Forest — trees grow/shrink by month cohort
 *   3. TTV River — time-to-value flow with waterfall drop-offs
 *   4. Engagement Depth Canyons — per-feature usage depth
 *   5. Cohort Health Rings — concentric circles on ground surface
 *   6. K-Factor Plain — seed particles for viral growth signal
 *   7. Payback Period Glacier — melting ice mass over time
 *   8. Feature Flag Storm — weather cells moving across terrain
 *   9. Power User Ridge — highest terrain for most active users
 *  10. Root System — transparent ground reveals dependency graph
 *  11. Benchmark Ghost — translucent top-quartile overlay
 *
 * Each gap between real and ghost terrain has a NEXUS hover trigger
 * showing specific action recommendations as HTML overlays.
 *
 * Positioned on EAST continent (x = 20 to 200) to co-exist with
 * existing Power On Solutions west-continent layers.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import { useWorldContext } from '../WorldContext'

// ── Simulated enterprise metric data (mock — SaaS metrics) ───────────────────

const MOCK_CAC = 1800        // Customer Acquisition Cost $
const MOCK_LTV = 8400        // Lifetime Value $
const MOCK_NRR = 0.87        // Net Revenue Retention (87%)
const MOCK_TTV_DAYS = 14     // Time to Value in days
const MOCK_KFACTOR = 0.32    // Viral K-Factor
const MOCK_PAYBACK_MO = 9    // Payback period in months
const MOCK_POWER_USER_PCT = 0.18  // 18% are power users

// Benchmark (top quartile) values
const BENCH_CAC = 1200
const BENCH_LTV = 12000
const BENCH_NRR = 1.1
const BENCH_TTV_DAYS = 7
const BENCH_PAYBACK_MO = 6

// NRR monthly cohort data (12 months)
const NRR_COHORTS = [1.05, 0.98, 1.12, 0.89, 1.02, 0.95, 0.88, 0.91, 0.87, 0.93, 0.96, 0.87]

// Engagement depth per feature (0-1)
const FEATURE_ENGAGEMENT = [
  { name: 'Dashboard', depth: 0.85 },
  { name: 'Reports', depth: 0.62 },
  { name: 'Alerts', depth: 0.45 },
  { name: 'API', depth: 0.38 },
  { name: 'Mobile', depth: 0.28 },
  { name: 'Integrations', depth: 0.22 },
]

// Cohort health by quarter (0-1)
const COHORT_HEALTH = [0.92, 0.78, 0.64, 0.51, 0.42]

// NEXUS action recommendations for each gap
const NEXUS_RECOMMENDATIONS: Record<string, string[]> = {
  cac_ltv: [
    'Reduce paid acquisition spend 15% — shift to content-led growth',
    'Expand onboarding touchpoints to increase LTV via expansion revenue',
    'Target higher-value ICP segments to improve unit economics',
  ],
  nrr: [
    'Deploy proactive CSM outreach for cohorts at <90% NRR',
    'Launch in-app upsell prompts tied to usage milestones',
    'Activate win-back sequence for churned accounts within 90 days',
  ],
  ttv: [
    'Compress onboarding to 3-step wizard — remove friction before first value',
    'Add guided setup checklist with progress bar visible on login',
    'Trigger success moment notification at first completed workflow',
  ],
  payback: [
    'Increase annual plan discount to shift MoM cash-on-hand',
    'Add implementation fee to front-load revenue recognition',
    'Reduce trial length from 14 to 7 days — shorten sales cycle',
  ],
}

// ── Position helpers (east continent zone) ───────────────────────────────────

/** East continent x: 20 to 190 */
function eastPos(nx: number, nz: number): { x: number; z: number } {
  return {
    x: 30 + nx * 150,   // 30–180
    z: (nz - 0.5) * 320,  // -160 to 160
  }
}

// ── EnterpriseMetricsLayer component ─────────────────────────────────────────

interface Props {
  visible: boolean
}

interface NexusHoverData {
  key: string
  label: string
  screenX: number
  screenY: number
  recommendations: string[]
}

export function EnterpriseMetricsLayer({ visible }: Props) {
  const { scene, camera, renderer } = useWorldContext()
  const groupRef = useRef<THREE.Group | null>(null)
  const ghostGroupRef = useRef<THREE.Group | null>(null)
  const animRef = useRef<number>(0)
  const particlesRef = useRef<THREE.Points | null>(null)
  const stormCellsRef = useRef<Array<{ mesh: THREE.Mesh; vel: THREE.Vector3 }>>([])
  const [nexusHover, setNexusHover] = useState<NexusHoverData | null>(null)
  const nexusMeshesRef = useRef<Array<{ mesh: THREE.Object3D; data: NexusHoverData }>>([])
  const raycasterRef = useRef(new THREE.Raycaster())
  const mouseRef = useRef(new THREE.Vector2())
  const tRef = useRef(0)

  // ── Build all terrain features ────────────────────────────────────────────
  useEffect(() => {
    const group = new THREE.Group()
    group.visible = visible
    scene.add(group)
    groupRef.current = group

    const ghostGroup = new THREE.Group()
    ghostGroup.visible = visible
    scene.add(ghostGroup)
    ghostGroupRef.current = ghostGroup

    nexusMeshesRef.current = []

    // ──────────────────────────────────────────────────────────────────────
    // 1. CAC Mountain vs LTV Mountain — unit economics gap valley
    // ──────────────────────────────────────────────────────────────────────

    const cacHeight = (MOCK_CAC / 2000) * 8       // scale to world units
    const ltvHeight = (MOCK_LTV / 12000) * 14
    const benchLtvHeight = (BENCH_LTV / 12000) * 14
    const benchCacHeight = (BENCH_CAC / 2000) * 8

    // CAC mountain (red-orange — cost)
    const cacGeo = new THREE.ConeGeometry(5, cacHeight, 8)
    const cacMat = new THREE.MeshStandardMaterial({
      color: 0xff4422,
      emissive: 0x440800,
      metalness: 0.3,
      roughness: 0.6,
    })
    const cacMesh = new THREE.Mesh(cacGeo, cacMat)
    cacMesh.position.set(50, cacHeight / 2, -30)
    cacMesh.castShadow = true
    group.add(cacMesh)

    // CAC label pulse ring
    const cacRingGeo = new THREE.RingGeometry(5.5, 6.2, 32)
    const cacRingMat = new THREE.MeshBasicMaterial({
      color: 0xff4422, transparent: true, opacity: 0.5, side: THREE.DoubleSide,
    })
    const cacRing = new THREE.Mesh(cacRingGeo, cacRingMat)
    cacRing.position.set(50, 0.1, -30)
    cacRing.rotation.x = -Math.PI / 2
    group.add(cacRing)

    // LTV mountain (green — value)
    const ltvGeo = new THREE.ConeGeometry(7, ltvHeight, 8)
    const ltvMat = new THREE.MeshStandardMaterial({
      color: 0x00e5cc,
      emissive: 0x003030,
      metalness: 0.3,
      roughness: 0.5,
    })
    const ltvMesh = new THREE.Mesh(ltvGeo, ltvMat)
    ltvMesh.position.set(75, ltvHeight / 2, -30)
    ltvMesh.castShadow = true
    group.add(ltvMesh)

    // Unit economics gap — canyon between mountains
    const gapGeo = new THREE.BoxGeometry(18, 0.5, 20)
    const gapMat = new THREE.MeshStandardMaterial({
      color: 0x1a0a00,
      emissive: 0x100500,
      metalness: 0.8,
      roughness: 0.2,
    })
    const gapMesh = new THREE.Mesh(gapGeo, gapMat)
    gapMesh.position.set(62, -0.3, -30)
    group.add(gapMesh)

    // Benchmark ghost LTV
    const ghostLtvGeo = new THREE.ConeGeometry(7, benchLtvHeight, 8)
    const ghostLtvMat = new THREE.MeshStandardMaterial({
      color: 0x00ff88,
      transparent: true,
      opacity: 0.18,
      wireframe: false,
      emissive: 0x004422,
      emissiveIntensity: 0.5,
    })
    const ghostLtv = new THREE.Mesh(ghostLtvGeo, ghostLtvMat)
    ghostLtv.position.set(75, benchLtvHeight / 2, -30)
    ghostGroup.add(ghostLtv)

    // Ghost wireframe overlay
    const ghostLtvWireGeo = new THREE.ConeGeometry(7.2, benchLtvHeight + 0.5, 8)
    const ghostLtvWireMat = new THREE.MeshBasicMaterial({
      color: 0x00ff88, wireframe: true, transparent: true, opacity: 0.35,
    })
    const ghostLtvWire = new THREE.Mesh(ghostLtvWireGeo, ghostLtvWireMat)
    ghostLtvWire.position.set(75, benchLtvHeight / 2, -30)
    ghostGroup.add(ghostLtvWire)

    // NEXUS trigger — CAC/LTV gap
    const nexusCacLtvMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1.5, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffcc00, transparent: true, opacity: 0.0 })
    )
    nexusCacLtvMesh.position.set(62, 2, -30)
    group.add(nexusCacLtvMesh)
    nexusMeshesRef.current.push({
      mesh: nexusCacLtvMesh,
      data: {
        key: 'cac_ltv',
        label: 'Unit Economics Gap',
        screenX: 0, screenY: 0,
        recommendations: NEXUS_RECOMMENDATIONS.cac_ltv,
      },
    })

    // ──────────────────────────────────────────────────────────────────────
    // 2. NRR Forest — trees growing/shrinking by cohort month
    // ──────────────────────────────────────────────────────────────────────

    NRR_COHORTS.forEach((nrr, idx) => {
      const treeH = 2 + nrr * 6
      const treeX = 40 + idx * 8
      const treeZ = 30

      // Trunk
      const trunkGeo = new THREE.CylinderGeometry(0.3, 0.5, treeH * 0.4, 6)
      const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a2a0a, roughness: 0.9 })
      const trunk = new THREE.Mesh(trunkGeo, trunkMat)
      trunk.position.set(treeX, treeH * 0.2, treeZ)
      group.add(trunk)

      // Canopy — color: green for nrr>1, amber for 0.9-1, red for <0.9
      const canopyColor = nrr >= 1.0 ? 0x00cc44 : nrr >= 0.9 ? 0xffaa00 : 0xff3322
      const canopyH = treeH * 0.7
      const canopyGeo = new THREE.ConeGeometry(1.8, canopyH, 7)
      const canopyMat = new THREE.MeshStandardMaterial({
        color: canopyColor,
        emissive: canopyColor,
        emissiveIntensity: 0.08,
        roughness: 0.7,
        metalness: 0.1,
      })
      const canopy = new THREE.Mesh(canopyGeo, canopyMat)
      canopy.position.set(treeX, treeH * 0.45 + canopyH / 2, treeZ)
      group.add(canopy)
    })

    // NEXUS trigger — NRR forest
    const nexusNrrMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1.5, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffcc00, transparent: true, opacity: 0.0 })
    )
    nexusNrrMesh.position.set(85, 2, 30)
    group.add(nexusNrrMesh)
    nexusMeshesRef.current.push({
      mesh: nexusNrrMesh,
      data: {
        key: 'nrr',
        label: 'NRR Retention Forest',
        screenX: 0, screenY: 0,
        recommendations: NEXUS_RECOMMENDATIONS.nrr,
      },
    })

    // ──────────────────────────────────────────────────────────────────────
    // 3. TTV River — time-to-value with waterfall drop-offs
    // ──────────────────────────────────────────────────────────────────────

    const riverPoints: THREE.Vector3[] = []
    const riverSteps = 20
    for (let i = 0; i <= riverSteps; i++) {
      const nx = i / riverSteps
      // River flows from NDA gate (z=-80) to first value moment (z=-60)
      // then waterfalls at drop-off points
      const x = 100 + nx * 40
      const z = -80 + nx * 40
      // Drop-off waterfalls at 30% and 70% through journey
      const y = nx < 0.3 ? 1.5 : nx < 0.31 ? -0.5 : nx < 0.7 ? 0.5 : nx < 0.71 ? -0.8 : 0.2
      riverPoints.push(new THREE.Vector3(x, y, z))
    }

    const riverGeo = new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3(riverPoints), 40, 0.4, 8, false
    )
    const riverMat = new THREE.MeshStandardMaterial({
      color: 0x0080ff,
      emissive: 0x002060,
      metalness: 0.8,
      roughness: 0.1,
      transparent: true,
      opacity: 0.75,
    })
    const riverMesh = new THREE.Mesh(riverGeo, riverMat)
    group.add(riverMesh)

    // Waterfall splashes at drop-off points
    const waterfallPositions = [
      { x: 112, z: -68 }, // 30% mark
      { x: 128, z: -52 }, // 70% mark
    ]
    waterfallPositions.forEach(({ x, z }) => {
      const splashGeo = new THREE.SphereGeometry(1.2, 8, 8)
      const splashMat = new THREE.MeshBasicMaterial({
        color: 0x40a0ff, transparent: true, opacity: 0.5,
      })
      const splash = new THREE.Mesh(splashGeo, splashMat)
      splash.position.set(x, 0.5, z)
      group.add(splash)

      // Drop indicator ring
      const dropRingGeo = new THREE.RingGeometry(1.5, 2.2, 16)
      const dropRingMat = new THREE.MeshBasicMaterial({
        color: 0x4060ff, transparent: true, opacity: 0.4, side: THREE.DoubleSide,
      })
      const dropRing = new THREE.Mesh(dropRingGeo, dropRingMat)
      dropRing.position.set(x, 0.05, z)
      dropRing.rotation.x = -Math.PI / 2
      group.add(dropRing)
    })

    // NDA gate post
    const gateGeo = new THREE.BoxGeometry(0.4, 4, 0.4)
    const gateMat = new THREE.MeshStandardMaterial({ color: 0xcc8800, emissive: 0x442200 })
    const gate = new THREE.Mesh(gateGeo, gateMat)
    gate.position.set(102, 2, -78)
    group.add(gate)

    // NEXUS trigger — TTV
    const nexusTtvMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1.5, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffcc00, transparent: true, opacity: 0.0 })
    )
    nexusTtvMesh.position.set(120, 2, -66)
    group.add(nexusTtvMesh)
    nexusMeshesRef.current.push({
      mesh: nexusTtvMesh,
      data: {
        key: 'ttv',
        label: 'Time-to-Value River',
        screenX: 0, screenY: 0,
        recommendations: NEXUS_RECOMMENDATIONS.ttv,
      },
    })

    // ──────────────────────────────────────────────────────────────────────
    // 4. Engagement Depth Canyons — one per feature
    // ──────────────────────────────────────────────────────────────────────

    FEATURE_ENGAGEMENT.forEach(({ depth }, idx) => {
      const canyonDepth = depth * 6 + 0.5
      const canyonW = 4
      const x = 45 + idx * 9
      const z = 70

      // Canyon wall
      const wallGeo = new THREE.BoxGeometry(canyonW, canyonDepth, 6)
      const wallMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(0.6 - depth * 0.3, 0.8, 0.25),
        metalness: 0.4, roughness: 0.7,
      })
      const wall = new THREE.Mesh(wallGeo, wallMat)
      wall.position.set(x, -canyonDepth / 2 + 0.1, z)
      group.add(wall)

      // Canyon floor glow (deeper = more intense)
      const glowGeo = new THREE.PlaneGeometry(canyonW - 0.5, 5.5)
      const glowMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color().setHSL(0.6 - depth * 0.3, 1, 0.5),
        transparent: true,
        opacity: depth * 0.6,
        side: THREE.DoubleSide,
      })
      const glowPlane = new THREE.Mesh(glowGeo, glowMat)
      glowPlane.position.set(x, -canyonDepth + 0.15, z)
      glowPlane.rotation.x = -Math.PI / 2
      group.add(glowPlane)
    })

    // ──────────────────────────────────────────────────────────────────────
    // 5. Cohort Health Rings — concentric circles on ground surface
    // ──────────────────────────────────────────────────────────────────────

    const ringCenterX = 160
    const ringCenterZ = -20
    COHORT_HEALTH.forEach((health, idx) => {
      const radius = 4 + idx * 5
      const ringGeo = new THREE.RingGeometry(radius - 0.4, radius, 64)
      const hue = health * 0.35  // green → yellow → red
      const ringMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color().setHSL(hue, 1, 0.5),
        transparent: true,
        opacity: 0.3 + health * 0.4,
        side: THREE.DoubleSide,
      })
      const ring = new THREE.Mesh(ringGeo, ringMat)
      ring.position.set(ringCenterX, 0.08, ringCenterZ)
      ring.rotation.x = -Math.PI / 2
      group.add(ring)
    })

    // Center cohort label dome
    const domGeo = new THREE.SphereGeometry(1.5, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2)
    const domMat = new THREE.MeshBasicMaterial({
      color: 0x00e5cc, transparent: true, opacity: 0.3,
    })
    const dome = new THREE.Mesh(domGeo, domMat)
    dome.position.set(ringCenterX, 0, ringCenterZ)
    group.add(dome)

    // ──────────────────────────────────────────────────────────────────────
    // 6. K-Factor Plain — seed particles for viral growth signal
    // ──────────────────────────────────────────────────────────────────────

    const kPlainCount = Math.floor(MOCK_KFACTOR * 800)
    const kPositions = new Float32Array(kPlainCount * 3)
    const kColors = new Float32Array(kPlainCount * 3)
    for (let i = 0; i < kPlainCount; i++) {
      const px = 130 + (Math.random() - 0.5) * 40
      const pz = 50 + (Math.random() - 0.5) * 40
      const age = Math.random()
      kPositions[i * 3]     = px
      kPositions[i * 3 + 1] = 0.3 + Math.random() * 1.5
      kPositions[i * 3 + 2] = pz
      // Color: gold-white seeds
      kColors[i * 3]     = 0.9 + age * 0.1
      kColors[i * 3 + 1] = 0.8 + age * 0.2
      kColors[i * 3 + 2] = 0.2 + age * 0.5
    }
    const kGeo = new THREE.BufferGeometry()
    kGeo.setAttribute('position', new THREE.BufferAttribute(kPositions, 3))
    kGeo.setAttribute('color', new THREE.BufferAttribute(kColors, 3))
    const kMat = new THREE.PointsMaterial({
      size: 0.25,
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
    })
    const kParticles = new THREE.Points(kGeo, kMat)
    group.add(kParticles)
    particlesRef.current = kParticles

    // ──────────────────────────────────────────────────────────────────────
    // 7. Payback Period Glacier — melting ice mass
    // ──────────────────────────────────────────────────────────────────────

    const glacierScale = MOCK_PAYBACK_MO / BENCH_PAYBACK_MO  // 1.5 = 50% too slow
    const glacierGeo = new THREE.DodecahedronGeometry(5 * glacierScale, 1)
    const glacierMat = new THREE.MeshStandardMaterial({
      color: 0x80d0ff,
      emissive: 0x104060,
      metalness: 0.1,
      roughness: 0.05,
      transparent: true,
      opacity: 0.65,
    })
    const glacier = new THREE.Mesh(glacierGeo, glacierMat)
    glacier.position.set(160, 3 * glacierScale, 50)
    group.add(glacier)

    // Melt drips under glacier
    for (let i = 0; i < 8; i++) {
      const dripGeo = new THREE.CylinderGeometry(0.05, 0.2, 0.8 + Math.random(), 5)
      const dripMat = new THREE.MeshBasicMaterial({
        color: 0x60b0ff, transparent: true, opacity: 0.5,
      })
      const drip = new THREE.Mesh(dripGeo, dripMat)
      drip.position.set(
        160 + (Math.random() - 0.5) * 6,
        0.3 + Math.random() * 0.5,
        50 + (Math.random() - 0.5) * 6
      )
      group.add(drip)
    }

    // Benchmark ghost glacier (smaller = faster payback is better)
    const benchGlacierGeo = new THREE.DodecahedronGeometry(5, 1)  // BENCH_PAYBACK=6 mo
    const benchGlacierMat = new THREE.MeshBasicMaterial({
      color: 0x40ff80, wireframe: true, transparent: true, opacity: 0.25,
    })
    const benchGlacier = new THREE.Mesh(benchGlacierGeo, benchGlacierMat)
    benchGlacier.position.set(160, 3, 50)
    ghostGroup.add(benchGlacier)

    // NEXUS trigger — payback
    const nexusPaybackMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1.5, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffcc00, transparent: true, opacity: 0.0 })
    )
    nexusPaybackMesh.position.set(160, 6, 50)
    group.add(nexusPaybackMesh)
    nexusMeshesRef.current.push({
      mesh: nexusPaybackMesh,
      data: {
        key: 'payback',
        label: 'Payback Period Glacier',
        screenX: 0, screenY: 0,
        recommendations: NEXUS_RECOMMENDATIONS.payback,
      },
    })

    // ──────────────────────────────────────────────────────────────────────
    // 8. Feature Flag Storm — weather cells moving across terrain
    // ──────────────────────────────────────────────────────────────────────

    stormCellsRef.current = []
    const stormCount = 6
    for (let i = 0; i < stormCount; i++) {
      const cellGeo = new THREE.TorusGeometry(3 + Math.random() * 2, 0.5, 8, 24)
      const cellMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color().setHSL(0.7 + Math.random() * 0.15, 1, 0.6),
        transparent: true,
        opacity: 0.35,
        wireframe: true,
      })
      const cell = new THREE.Mesh(cellGeo, cellMat)
      cell.position.set(
        80 + Math.random() * 80,
        3 + Math.random() * 5,
        -60 + Math.random() * 120
      )
      cell.rotation.x = Math.PI / 2 + (Math.random() - 0.5) * 0.4
      group.add(cell)

      // Random velocity across terrain
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 4,
        0,
        (Math.random() - 0.5) * 4
      )
      stormCellsRef.current.push({ mesh: cell, vel })
    }

    // ──────────────────────────────────────────────────────────────────────
    // 9. Power User Ridge Line — highest terrain for most engaged users
    // ──────────────────────────────────────────────────────────────────────

    const ridgePoints: THREE.Vector3[] = []
    const ridgeSegs = 16
    for (let i = 0; i <= ridgeSegs; i++) {
      const t = i / ridgeSegs
      const height = MOCK_POWER_USER_PCT * 20 * (0.6 + Math.sin(t * Math.PI * 3) * 0.4)
      ridgePoints.push(new THREE.Vector3(35 + t * 120, height, -100 + t * 20))
    }

    for (let i = 0; i < ridgeSegs; i++) {
      const p0 = ridgePoints[i]
      const p1 = ridgePoints[i + 1]
      const h = (p0.y + p1.y) / 2
      const pillarGeo = new THREE.CylinderGeometry(0.3, 0.6, h, 5)
      const pillarMat = new THREE.MeshStandardMaterial({
        color: 0xffaa00,
        emissive: 0x442200,
        metalness: 0.5,
        roughness: 0.4,
      })
      const pillar = new THREE.Mesh(pillarGeo, pillarMat)
      pillar.position.set((p0.x + p1.x) / 2, h / 2, (p0.z + p1.z) / 2)
      group.add(pillar)
    }

    // Ridge crest glow line
    const ridgeLineGeo = new THREE.BufferGeometry().setFromPoints(ridgePoints)
    const ridgeLineMat = new THREE.LineBasicMaterial({
      color: 0xffdd44, transparent: true, opacity: 0.9,
    })
    const ridgeLine = new THREE.Line(ridgeLineGeo, ridgeLineMat)
    group.add(ridgeLine)

    // ──────────────────────────────────────────────────────────────────────
    // 10. Root System — dependency graph visible through transparent ground
    // ──────────────────────────────────────────────────────────────────────

    const rootNodes = [
      { id: 'auth', x: 90, z: 20 },
      { id: 'billing', x: 110, z: 10 },
      { id: 'api', x: 130, z: 25 },
      { id: 'notify', x: 105, z: 35 },
      { id: 'storage', x: 120, z: 45 },
    ]
    const rootEdges = [
      ['auth', 'billing'], ['billing', 'api'], ['api', 'notify'],
      ['auth', 'notify'], ['billing', 'storage'], ['api', 'storage'],
    ]

    // Root node spheres (below ground, dimly lit)
    rootNodes.forEach(n => {
      const nodeGeo = new THREE.SphereGeometry(0.8, 8, 8)
      const nodeMat = new THREE.MeshBasicMaterial({
        color: 0x4444ff, transparent: true, opacity: 0.5,
      })
      const node = new THREE.Mesh(nodeGeo, nodeMat)
      node.position.set(n.x, -2, n.z)
      group.add(node)
    })

    // Root edges (dependency lines)
    const nodeMap = Object.fromEntries(rootNodes.map(n => [n.id, n]))
    rootEdges.forEach(([a, b]) => {
      const na = nodeMap[a]
      const nb = nodeMap[b]
      if (!na || !nb) return
      const pts = [
        new THREE.Vector3(na.x, -2, na.z),
        new THREE.Vector3((na.x + nb.x) / 2, -3, (na.z + nb.z) / 2),
        new THREE.Vector3(nb.x, -2, nb.z),
      ]
      const edgeGeo = new THREE.BufferGeometry().setFromPoints(pts)
      const edgeMat = new THREE.LineBasicMaterial({
        color: 0x6666ff, transparent: true, opacity: 0.4,
      })
      group.add(new THREE.Line(edgeGeo, edgeMat))
    })

    // ──────────────────────────────────────────────────────────────────────
    // 11. Benchmark Ghost overlay — translucent top-quartile terrain
    // ──────────────────────────────────────────────────────────────────────

    // Benchmark ghost for CAC mountain
    const ghostCacGeo = new THREE.ConeGeometry(5, benchCacHeight, 8)
    const ghostCacMat = new THREE.MeshBasicMaterial({
      color: 0xffaa44, wireframe: true, transparent: true, opacity: 0.25,
    })
    const ghostCac = new THREE.Mesh(ghostCacGeo, ghostCacMat)
    ghostCac.position.set(50, benchCacHeight / 2, -30)
    ghostGroup.add(ghostCac)

    // Ghost NRR benchmark forest (single reference tree at top-quartile NRR 1.1)
    const benchNrrH = 2 + 1.1 * 6
    const ghostTreeGeo = new THREE.ConeGeometry(2, benchNrrH, 6)
    const ghostTreeMat = new THREE.MeshBasicMaterial({
      color: 0x44ff88, wireframe: true, transparent: true, opacity: 0.25,
    })
    const ghostTree = new THREE.Mesh(ghostTreeGeo, ghostTreeMat)
    ghostTree.position.set(125, benchNrrH / 2, 30)
    ghostGroup.add(ghostTree)

    // ──────────────────────────────────────────────────────────────────────
    // Point lights for dramatic night illumination
    // ──────────────────────────────────────────────────────────────────────

    const lights = [
      { color: 0xff2200, intensity: 1.2, x: 50,  y: 8, z: -30 },  // CAC red
      { color: 0x00e5cc, intensity: 1.5, x: 75,  y: 12, z: -30 }, // LTV teal
      { color: 0x4488ff, intensity: 0.8, x: 120, y: 5,  z: -65 }, // TTV blue
      { color: 0xffaa00, intensity: 1.0, x: 40,  y: 8, z: -100 }, // Ridge gold
      { color: 0x8040ff, intensity: 0.7, x: 160, y: 6,  z: 50 },  // Glacier purple
    ]
    lights.forEach(l => {
      const pl = new THREE.PointLight(l.color, l.intensity, 40)
      pl.position.set(l.x, l.y, l.z)
      group.add(pl)
    })

    return () => {
      if (groupRef.current) {
        scene.remove(groupRef.current)
        groupRef.current.traverse(obj => {
          if ((obj as THREE.Mesh).geometry) (obj as THREE.Mesh).geometry.dispose()
          if ((obj as THREE.Mesh).material) {
            const mat = (obj as THREE.Mesh).material
            if (Array.isArray(mat)) mat.forEach(m => m.dispose())
            else (mat as THREE.Material).dispose()
          }
        })
        groupRef.current = null
      }
      if (ghostGroupRef.current) {
        scene.remove(ghostGroupRef.current)
        ghostGroupRef.current.traverse(obj => {
          if ((obj as THREE.Mesh).geometry) (obj as THREE.Mesh).geometry.dispose()
          if ((obj as THREE.Mesh).material) {
            const mat = (obj as THREE.Mesh).material
            if (Array.isArray(mat)) mat.forEach(m => m.dispose())
            else (mat as THREE.Material).dispose()
          }
        })
        ghostGroupRef.current = null
      }
      cancelAnimationFrame(animRef.current)
    }
  }, [scene])

  // ── Visibility toggle ─────────────────────────────────────────────────────
  useEffect(() => {
    if (groupRef.current) groupRef.current.visible = visible
    if (ghostGroupRef.current) ghostGroupRef.current.visible = visible
    if (!visible) setNexusHover(null)
  }, [visible])

  // ── Animation loop — storm cells + particle drift + ghost pulse ───────────
  useEffect(() => {
    if (!visible) return

    let lastT = performance.now()

    function animate() {
      animRef.current = requestAnimationFrame(animate)
      const now = performance.now()
      const delta = Math.min((now - lastT) / 1000, 0.05)
      lastT = now
      tRef.current += delta

      const t = tRef.current

      // Move storm cells
      stormCellsRef.current.forEach(({ mesh, vel }) => {
        mesh.position.x += vel.x * delta
        mesh.position.z += vel.z * delta
        mesh.rotation.z += delta * 0.5

        // Bounce within east continent bounds
        if (mesh.position.x < 35 || mesh.position.x > 185) vel.x *= -1
        if (mesh.position.z < -165 || mesh.position.z > 165) vel.z *= -1

        // Pulse opacity
        const mat = mesh.material as THREE.MeshBasicMaterial
        mat.opacity = 0.2 + Math.sin(t * 1.5 + mesh.position.x) * 0.15
      })

      // Particle drift (K-factor plain)
      if (particlesRef.current) {
        const positions = particlesRef.current.geometry.attributes.position
        const count = positions.count
        for (let i = 0; i < count; i++) {
          const py = positions.getY(i)
          // Slow upward drift, reset at top
          positions.setY(i, py + delta * 0.3)
          if (py > 2.5) positions.setY(i, 0.3)
        }
        positions.needsUpdate = true
      }

      // Ghost pulse
      if (ghostGroupRef.current) {
        const pulse = 0.12 + Math.sin(t * 1.2) * 0.06
        ghostGroupRef.current.traverse(obj => {
          const mesh = obj as THREE.Mesh
          if (mesh.material) {
            const mat = mesh.material as THREE.Material & { opacity?: number }
            if (typeof mat.opacity === 'number' && mat.transparent) {
              mat.opacity = pulse
            }
          }
        })
      }
    }

    animate()
    return () => cancelAnimationFrame(animRef.current)
  }, [visible])

  // ── Raycaster for NEXUS hover triggers ───────────────────────────────────
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!visible || !camera || !renderer) return
    const rect = renderer.domElement.getBoundingClientRect()
    mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    mouseRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1

    raycasterRef.current.setFromCamera(mouseRef.current, camera)
    const meshes = nexusMeshesRef.current.map(n => n.mesh as THREE.Mesh)
    const hits = raycasterRef.current.intersectObjects(meshes, false)

    if (hits.length > 0) {
      const hit = hits[0]
      const found = nexusMeshesRef.current.find(n => n.mesh === hit.object)
      if (found) {
        // Project hit point to screen
        const pos = hit.point.clone().project(camera)
        const rect2 = renderer.domElement.getBoundingClientRect()
        const sx = (pos.x * 0.5 + 0.5) * rect2.width + rect2.left
        const sy = (-pos.y * 0.5 + 0.5) * rect2.height + rect2.top
        setNexusHover({
          ...found.data,
          screenX: sx,
          screenY: sy,
        })
      }
    } else {
      setNexusHover(null)
    }
  }, [visible, camera, renderer])

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [handleMouseMove])

  // ── NEXUS hover overlay (HTML) ────────────────────────────────────────────
  if (!visible) return null

  return nexusHover ? (
    <div
      style={{
        position: 'fixed',
        left: Math.min(nexusHover.screenX, window.innerWidth - 320),
        top: Math.max(20, nexusHover.screenY - 180),
        zIndex: 200,
        pointerEvents: 'none',
        width: 300,
      }}
    >
      <div style={{
        background: 'rgba(10, 5, 30, 0.92)',
        border: '1px solid rgba(160, 80, 255, 0.7)',
        borderRadius: 8,
        padding: '14px 16px',
        backdropFilter: 'blur(12px)',
        boxShadow: '0 0 30px rgba(120,40,220,0.4)',
      }}>
        <div style={{
          fontSize: 9,
          letterSpacing: 2,
          color: 'rgba(160,100,255,0.7)',
          marginBottom: 4,
          fontFamily: 'monospace',
        }}>
          ◈ NEXUS — V5 ENTERPRISE
        </div>
        <div style={{
          fontSize: 12,
          fontWeight: 700,
          color: '#c080ff',
          marginBottom: 10,
          fontFamily: 'monospace',
          letterSpacing: 0.5,
        }}>
          {nexusHover.label}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {nexusHover.recommendations.map((rec, idx) => (
            <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <span style={{
                color: '#a060ff',
                fontSize: 10,
                fontFamily: 'monospace',
                flexShrink: 0,
                marginTop: 1,
              }}>
                {idx + 1}.
              </span>
              <span style={{
                fontSize: 11,
                color: 'rgba(220,200,255,0.85)',
                lineHeight: 1.5,
              }}>
                {rec}
              </span>
            </div>
          ))}
        </div>
        <div style={{
          marginTop: 10,
          fontSize: 8,
          color: 'rgba(120,80,180,0.6)',
          fontFamily: 'monospace',
          letterSpacing: 1,
        }}>
          HOVER TO EXPLORE · V5 ENTERPRISE METRICS
        </div>
      </div>
    </div>
  ) : null
}
