/**
 * AccountingLayer.tsx — NW11 Full Accounting Data Layer.
 *
 * Wires every business factor to terrain changes in real time.
 * All data pulled from DataBridge (Supabase). World updates every 60s.
 *
 * ── Revenue factors → terrain rises ──────────────────────────────────────────
 *   • New project won       → mountain formation tween (translucent grow mesh)
 *   • Invoice paid          → river brightness pulse (nw:river-paid-pulse event)
 *   • New Hub subscriber    → tower glow burst on east continent
 *   • Solar RMO fee         → gold tributary particles pulse
 *
 * ── Cost factors → terrain pressure ──────────────────────────────────────────
 *   • Material purchase     → canyon pulse darkens briefly then stabilises
 *   • Payroll run           → west continent dim wave (nw:payroll-dim event)
 *   • Overhead              → slow constant erosion overlay on all mountains
 *   • Subscription costs    → thin dark particle streams from east base
 *
 * ── Risk factors → terrain stress ────────────────────────────────────────────
 *   • Invoice >30 days      → AR stalactite growth indicator (amber spike)
 *   • Open RFI              → fault tension glow (red hairline near mountain)
 *   • Churn                 → dark evaporating pool (black disc on east ground)
 *   • Single client depend. → oversized shadow sphere above dominant mountain
 *
 * ── Growth factors → world expansion ─────────────────────────────────────────
 *   • New crew member       → labor ridge line between mountains
 *   • New service area      → west continent edge light column extension
 *   • Hub feature launch    → east continent small plateau section
 */

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useWorldContext } from '../WorldContext'
import {
  subscribeWorldData,
  seededPosition,
  contractValueToHeight,
  type NWWorldData,
  type NWProject,
  type NWInvoice,
} from '../DataBridge'

// ── Constants ──────────────────────────────────────────────────────────────────

const WEST_X_MIN   = -185
const WEST_X_MAX   = -35
const EAST_X_MIN   = 35
const EAST_X_MAX   = 185
const EAST_Z_MIN   = -180
const EAST_Z_MAX   = 180

// ── Helpers ────────────────────────────────────────────────────────────────────

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.min(1, Math.max(0, t))
}

function disposeObj(scene: THREE.Scene, obj: THREE.Object3D | null): void {
  if (!obj) return
  scene.remove(obj)
  obj.traverse(child => {
    const mesh = child as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined
    if (mat) {
      if (Array.isArray(mat)) mat.forEach(m => m.dispose())
      else mat.dispose()
    }
  })
}

// ── Tween engine (runs on nw:frame) ───────────────────────────────────────────

interface Tween {
  duration: number     // seconds
  elapsed: number      // seconds accumulated
  onUpdate: (t: number) => void   // t is 0–1 eased
  onComplete?: () => void
  done: boolean
}

function easeSinOut(t: number): number {
  return Math.sin((t * Math.PI) / 2)
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t
}

// ── Component ──────────────────────────────────────────────────────────────────

export function AccountingLayer() {
  const { scene } = useWorldContext()

  // ── Refs for all Three.js objects ─────────────────────────────────────────

  // Revenue: mountain formation tweens
  interface FormationEntry {
    mesh: THREE.Mesh
    tween: Tween
    targetHeight: number
    projectId: string
  }
  const formationsRef = useRef<Map<string, FormationEntry>>(new Map())

  // Revenue: river pulse (emissive plane in river zone)
  const riverPulseMeshRef  = useRef<THREE.Mesh | null>(null)
  const riverPulseTweenRef = useRef<Tween | null>(null)

  // Revenue: subscriber burst rings (east continent)
  const subscriberRingsRef = useRef<Array<{ ring: THREE.Mesh; tween: Tween }>>([])

  // Revenue: solar gold pulse particles
  const solarPulseRef    = useRef<THREE.Points | null>(null)
  const solarPhaseTweenRef = useRef<Tween | null>(null)

  // Cost: payroll dim overlay (west continent ambient sphere)
  const payrollDimRef   = useRef<THREE.PointLight | null>(null)
  const payrollTweenRef = useRef<Tween | null>(null)

  // Cost: overhead erosion mesh (thin translucent plane over mountains)
  const overheadErosionRef = useRef<THREE.Mesh | null>(null)

  // Cost: subscription cost streams (east base dark particles)
  const subCostStreamRef = useRef<THREE.Points | null>(null)

  // Risk: AR stalactite indicators (amber spikes over stale invoices)
  const arStalactitesRef = useRef<Map<string, THREE.Mesh>>(new Map())

  // Risk: dependency shadow (dark sphere above dominant project)
  const depShadowRef     = useRef<THREE.Mesh | null>(null)
  const depLightRef      = useRef<THREE.PointLight | null>(null)

  // Growth: service area edge columns
  const serviceColumnsRef = useRef<THREE.Mesh[]>([])

  // Growth: east feature plateaus from hub feature launches
  const featurePlateausRef = useRef<THREE.Mesh[]>([])

  // Growth: crew ridge lines
  const crewRidgesRef = useRef<THREE.Line[]>([])

  // Animation
  const tweensRef        = useRef<Tween[]>([])
  const frameHandlerRef  = useRef<((e: Event) => void) | null>(null)
  const elapsedRef       = useRef(0)
  const lastDataRef      = useRef<NWWorldData | null>(null)

  // ── Track previous state to detect changes ─────────────────────────────────

  const prevProjectCountRef    = useRef(0)
  const prevPaidInvoiceIdsRef  = useRef<Set<string>>(new Set())
  const prevSubscriberCountRef = useRef(0)
  const prevSolarIncomeRef     = useRef(0)
  const prevPayrollHoursRef    = useRef(0)
  const prevCrewCountRef       = useRef(0)
  const prevFeatureLaunchesRef = useRef(0)

  // ── Build river pulse plane ────────────────────────────────────────────────

  function buildRiverPulsePlane() {
    if (riverPulseMeshRef.current) return
    // Thin horizontal plane spanning the river channel
    const geo = new THREE.PlaneGeometry(38, 380)
    const mat = new THREE.MeshLambertMaterial({
      color: 0x00ccff,
      emissive: new THREE.Color(0x00ccff),
      emissiveIntensity: 0,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(0, 0.05, 0)
    scene.add(mesh)
    riverPulseMeshRef.current = mesh
  }

  // ── Trigger river brightness pulse on invoice paid ─────────────────────────

  function triggerRiverPulse(intensity: number) {
    const mesh = riverPulseMeshRef.current
    if (!mesh) return
    const mat = mesh.material as THREE.MeshLambertMaterial

    const tween: Tween = {
      duration: 3.0,
      elapsed: 0,
      done: false,
      onUpdate: (t) => {
        // Rise fast, hold, then fade
        const pulse = t < 0.3
          ? t / 0.3
          : 1 - (t - 0.3) / 0.7
        const i = easeSinOut(pulse) * Math.min(1, intensity)
        mat.emissiveIntensity = i * 0.8
        mat.opacity = i * 0.35
      },
      onComplete: () => {
        mat.emissiveIntensity = 0
        mat.opacity = 0
      },
    }
    riverPulseTweenRef.current = tween
    tweensRef.current.push(tween)
  }

  // ── Mountain formation tween for new projects ──────────────────────────────

  function spawnFormation(project: NWProject) {
    if (formationsRef.current.has(project.id)) return

    const { x, z } = seededPosition(project.id)
    if (x < WEST_X_MIN || x > WEST_X_MAX) return

    const targetH = contractValueToHeight(project.contract_value)
    if (targetH <= 0) return

    const radius = targetH * 0.3 + 1.2
    const geo = new THREE.ConeGeometry(radius, targetH, 10)
    const mat = new THREE.MeshLambertMaterial({
      color: 0x88ff44,
      emissive: new THREE.Color(0x44ff22),
      emissiveIntensity: 0.6,
      transparent: true,
      opacity: 0.0,
      wireframe: false,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(x, 0, z)
    scene.add(mesh)

    const tween: Tween = {
      duration: 8.0,
      elapsed: 0,
      done: false,
      onUpdate: (t) => {
        const easedT = easeInOut(t)
        // Grow from y=0 to full height
        const currentH = lerp(0.1, targetH, easedT)
        mesh.scale.y = currentH / targetH
        mesh.position.y = currentH / 2
        // Fade in then settle
        const opacity = t < 0.6
          ? t / 0.6 * 0.55
          : 0.55 - (t - 0.6) / 0.4 * 0.25
        mat.opacity = opacity
        mat.emissiveIntensity = (1 - t) * 0.6
      },
      onComplete: () => {
        // After tween, keep as very subtle overlay (settled terrain indicator)
        mat.opacity = 0.18
        mat.emissiveIntensity = 0.05
        mat.color.set(0x44aa22)
        mat.emissive.set(0x224410)
      },
    }
    tweensRef.current.push(tween)

    formationsRef.current.set(project.id, { mesh, tween, targetHeight: targetH, projectId: project.id })
  }

  // ── Subscriber tower spawn burst ring ─────────────────────────────────────

  function spawnSubscriberRing() {
    // Random position on east continent
    const x = EAST_X_MIN + Math.random() * (EAST_X_MAX - EAST_X_MIN)
    const z = EAST_Z_MIN + Math.random() * (EAST_Z_MAX - EAST_Z_MIN)

    const geo = new THREE.TorusGeometry(3, 0.25, 8, 32)
    const mat = new THREE.MeshLambertMaterial({
      color: 0x44ffcc,
      emissive: new THREE.Color(0x00ffcc),
      emissiveIntensity: 1.5,
      transparent: true,
      opacity: 0.9,
    })
    const ring = new THREE.Mesh(geo, mat)
    ring.position.set(x, 0.5, z)
    ring.rotation.x = -Math.PI / 2
    scene.add(ring)

    const tween: Tween = {
      duration: 2.5,
      elapsed: 0,
      done: false,
      onUpdate: (t) => {
        const scale = 1 + t * 4
        ring.scale.set(scale, scale, scale)
        mat.opacity = (1 - t) * 0.9
        mat.emissiveIntensity = (1 - t) * 1.5
        ring.position.y = 0.5 + t * 3
      },
      onComplete: () => {
        disposeObj(scene, ring)
        subscriberRingsRef.current = subscriberRingsRef.current.filter(r => r.ring !== ring)
      },
    }
    tweensRef.current.push(tween)
    subscriberRingsRef.current.push({ ring, tween })
  }

  // ── Solar RMO gold pulse particles ────────────────────────────────────────

  function buildSolarPulse(solarIncome: number) {
    if (solarPulseRef.current) {
      disposeObj(scene, solarPulseRef.current)
      solarPulseRef.current = null
    }
    if (solarIncome <= 0) return

    const count = Math.min(600, Math.floor(solarIncome / 100) + 80)
    const positions = new Float32Array(count * 3)

    // Particles spread across the river center — the "gold tributary"
    for (let i = 0; i < count; i++) {
      const ii = i * 3
      positions[ii]     = (Math.random() - 0.5) * 30    // river width
      positions[ii + 1] = Math.random() * 3 + 0.3
      positions[ii + 2] = (Math.random() - 0.5) * 360   // river length
    }

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))

    const mat = new THREE.PointsMaterial({
      color: 0xffcc00,
      size: 0.45,
      transparent: true,
      opacity: 0.7,
      sizeAttenuation: true,
    })

    const pts = new THREE.Points(geo, mat)
    scene.add(pts)
    solarPulseRef.current = pts
  }

  // ── Payroll dim pulse (west continent light drop) ─────────────────────────

  function buildPayrollLight() {
    if (payrollDimRef.current) return
    // Negative-effect simulated by a dark point light that absorbs glow briefly
    // We use a dim blue-gray PointLight at low intensity that spikes down briefly
    const light = new THREE.PointLight(0x102040, 0, 280)
    light.position.set(-110, 35, 0)   // high above west continent
    scene.add(light)
    payrollDimRef.current = light
  }

  function triggerPayrollDim(hours: number) {
    const light = payrollDimRef.current
    if (!light) return
    const intensity = Math.min(2.5, hours / 80)  // scale with hours

    const tween: Tween = {
      duration: 5.0,
      elapsed: 0,
      done: false,
      onUpdate: (t) => {
        // Dim pulse: ramp up quickly, hold, fade back
        const p = t < 0.25
          ? t / 0.25
          : 1 - (t - 0.25) / 0.75
        light.intensity = easeSinOut(p) * intensity
      },
      onComplete: () => { light.intensity = 0 },
    }
    payrollTweenRef.current = tween
    tweensRef.current.push(tween)
  }

  // ── Overhead erosion overlay ───────────────────────────────────────────────

  function buildOverheadErosion(overheadMonthly: number) {
    if (overheadErosionRef.current) {
      disposeObj(scene, overheadErosionRef.current)
      overheadErosionRef.current = null
    }
    // Thin semi-transparent reddish haze that covers west continent ground
    const intensity = Math.min(1, overheadMonthly / 20000)
    const geo = new THREE.PlaneGeometry(170, 380)
    const mat = new THREE.MeshLambertMaterial({
      color: 0x3a1000,
      emissive: new THREE.Color(0x180800),
      emissiveIntensity: intensity * 0.3,
      transparent: true,
      opacity: intensity * 0.12,
      side: THREE.DoubleSide,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(-110, 0.02, 0)
    scene.add(mesh)
    overheadErosionRef.current = mesh
  }

  // ── Subscription cost dark streams (east base) ────────────────────────────

  function buildSubCostStreams(subscriberCount: number) {
    if (subCostStreamRef.current) {
      disposeObj(scene, subCostStreamRef.current)
      subCostStreamRef.current = null
    }
    // Thin dark outflowing particles from east continent base edge (x≈35)
    const streamCount = Math.min(300, subscriberCount * 15 + 60)
    const positions = new Float32Array(streamCount * 3)

    for (let i = 0; i < streamCount; i++) {
      const ii = i * 3
      const t = Math.random()
      // Stream outward from east continent west edge
      positions[ii]     = EAST_X_MIN + t * 40          // x: 35 → 75 eastward
      positions[ii + 1] = 0.1 + Math.random() * 0.5
      positions[ii + 2] = EAST_Z_MIN + Math.random() * (EAST_Z_MAX - EAST_Z_MIN)
    }

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))

    const mat = new THREE.PointsMaterial({
      color: 0x001a2a,
      size: 0.35,
      transparent: true,
      opacity: 0.55,
      sizeAttenuation: true,
    })

    const pts = new THREE.Points(geo, mat)
    scene.add(pts)
    subCostStreamRef.current = pts
  }

  // ── AR stalactites (invoice >30 days) ─────────────────────────────────────

  function updateARStalactites(invoices: NWInvoice[], projects: NWProject[]) {
    const staleIds = new Set(invoices.map(inv => inv.id))

    // Remove resolved stalactites
    for (const [id, mesh] of arStalactitesRef.current) {
      if (!staleIds.has(id)) {
        disposeObj(scene, mesh)
        arStalactitesRef.current.delete(id)
      }
    }

    const projectMap = new Map(projects.map(p => [p.id, p]))

    for (const inv of invoices) {
      if (arStalactitesRef.current.has(inv.id)) continue

      // Position: above the associated project mountain
      const project = inv.project_id ? projectMap.get(inv.project_id) : null
      let x: number, z: number
      if (project) {
        const pos = seededPosition(project.id)
        x = pos.x
        z = pos.z
      } else {
        // No project: place on river edge
        x = -22 + Math.random() * 8
        z = (Math.random() - 0.5) * 340
      }

      // Age-based length: older = longer spike
      const ageMs = inv.created_at
        ? Date.now() - new Date(inv.created_at).getTime()
        : 30 * 24 * 60 * 60 * 1000
      const ageDays = ageMs / (24 * 60 * 60 * 1000)
      const spikeLen = Math.min(8, (ageDays - 30) / 10 + 1.5)

      const geo = new THREE.ConeGeometry(0.35, spikeLen, 6)
      const mat = new THREE.MeshLambertMaterial({
        color: 0xcc4400,
        emissive: new THREE.Color(0xaa2200),
        emissiveIntensity: 0.5 + Math.min(1, (ageDays - 30) / 60),
        transparent: true,
        opacity: 0.85,
      })
      const mesh = new THREE.Mesh(geo, mat)
      // Hang downward from high point (stalactite = upside-down cone)
      mesh.rotation.z = Math.PI
      mesh.position.set(x, 18 + spikeLen / 2, z)
      scene.add(mesh)

      arStalactitesRef.current.set(inv.id, mesh)
    }
  }

  // ── Dependency shadow sphere above dominant project ────────────────────────

  function updateDependencyShadow(
    dominantProjectId: string | null,
    ratio: number,
    projects: NWProject[]
  ) {
    // Only show if single client has >40% of total value
    if (!dominantProjectId || ratio < 0.4) {
      disposeObj(scene, depShadowRef.current)
      depShadowRef.current = null
      if (depLightRef.current) {
        scene.remove(depLightRef.current)
        depLightRef.current = null
      }
      return
    }

    const project = projects.find(p => p.id === dominantProjectId)
    if (!project) return

    const { x, z } = seededPosition(project.id)
    const h = contractValueToHeight(project.contract_value)
    const shadowRadius = 14 + ratio * 12   // bigger shadow for more dependency

    // Rebuild if needed
    disposeObj(scene, depShadowRef.current)
    if (depLightRef.current) scene.remove(depLightRef.current)

    const geo = new THREE.SphereGeometry(shadowRadius, 12, 8)
    const mat = new THREE.MeshLambertMaterial({
      color: 0x000000,
      emissive: new THREE.Color(0x110000),
      emissiveIntensity: 0.1,
      transparent: true,
      opacity: ratio * 0.28,
      side: THREE.BackSide,  // shadow cast inward
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(x, h + shadowRadius * 0.6, z)
    scene.add(mesh)
    depShadowRef.current = mesh

    // A dim red point light inside the shadow sphere to simulate reddish tint
    const light = new THREE.PointLight(0x440000, ratio * 0.5, shadowRadius * 2)
    light.position.set(x, h + 4, z)
    scene.add(light)
    depLightRef.current = light
  }

  // ── Service area west edge extension columns ───────────────────────────────

  function updateServiceColumns(serviceAreaCount: number) {
    // Dispose old columns
    for (const c of serviceColumnsRef.current) disposeObj(scene, c)
    serviceColumnsRef.current = []

    // One column per service area, placed along west edge (x≈-185)
    const cols = Math.min(serviceAreaCount, 20)
    const zStep = 360 / Math.max(1, cols - 1)

    for (let i = 0; i < cols; i++) {
      const z = -180 + i * zStep
      const h = 2 + (i % 3) * 0.8
      const geo = new THREE.CylinderGeometry(0.3, 0.5, h, 6)
      const mat = new THREE.MeshLambertMaterial({
        color: 0x2a1a00,
        emissive: new THREE.Color(0x663300),
        emissiveIntensity: 0.4,
        transparent: true,
        opacity: 0.7,
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.set(-188, h / 2, z)
      scene.add(mesh)
      serviceColumnsRef.current.push(mesh)
    }
  }

  // ── East continent hub feature plateaus ───────────────────────────────────

  function updateFeaturePlateaus(featureCount: number) {
    // Dispose old plateaus
    for (const p of featurePlateausRef.current) disposeObj(scene, p)
    featurePlateausRef.current = []

    const count = Math.min(featureCount, 12)
    for (let i = 0; i < count; i++) {
      // Place small plateaus along the east continent north edge
      const x = EAST_X_MIN + (i / Math.max(1, count - 1)) * (EAST_X_MAX - EAST_X_MIN)
      const z = EAST_Z_MAX - 10 - (i % 2) * 15
      const side = 6 + (i % 3) * 2

      const geo = new THREE.BoxGeometry(side, 0.8, side)
      const mat = new THREE.MeshLambertMaterial({
        color: 0x0a1a30,
        emissive: new THREE.Color(0x0044aa),
        emissiveIntensity: 0.35,
        transparent: true,
        opacity: 0.8,
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.set(x, 0.4 + (i % 4) * 0.2, z)
      scene.add(mesh)
      featurePlateausRef.current.push(mesh)
    }
  }

  // ── Crew ridge lines (west continent) ─────────────────────────────────────

  function updateCrewRidges(crewCount: number, projects: NWProject[]) {
    // Dispose old ridges
    for (const r of crewRidgesRef.current) {
      scene.remove(r)
      r.geometry.dispose()
      const mat = r.material as THREE.Material | undefined
      if (mat) mat.dispose()
    }
    crewRidgesRef.current = []

    // Crew ridges connect every pair of adjacent mountains (up to crewCount)
    const activeProjects = projects
      .filter(p => p.status === 'in_progress' || p.status === 'approved')
      .slice(0, crewCount + 1)

    if (activeProjects.length < 2) return

    for (let i = 0; i < Math.min(crewCount, activeProjects.length - 1); i++) {
      const pA = activeProjects[i]
      const pB = activeProjects[i + 1]
      const posA = seededPosition(pA.id)
      const posB = seededPosition(pB.id)

      const hA = contractValueToHeight(pA.contract_value)
      const hB = contractValueToHeight(pB.contract_value)

      const pts = [
        new THREE.Vector3(posA.x, hA * 0.5 + 1.5, posA.z),
        new THREE.Vector3(
          (posA.x + posB.x) / 2,
          Math.max(hA, hB) * 0.6 + 2.5,   // arch upward in the middle
          (posA.z + posB.z) / 2
        ),
        new THREE.Vector3(posB.x, hB * 0.5 + 1.5, posB.z),
      ]
      const curve = new THREE.CatmullRomCurve3(pts)
      const geo   = new THREE.BufferGeometry().setFromPoints(curve.getPoints(20))
      const mat   = new THREE.LineBasicMaterial({
        color: 0xff8833,
        transparent: true,
        opacity: 0.55,
      })
      const line = new THREE.Line(geo, mat)
      scene.add(line)
      crewRidgesRef.current.push(line)
    }
  }

  // ── Solar gold pulse animation (continuous float) ─────────────────────────

  function animateSolarPulse(elapsed: number) {
    const pts = solarPulseRef.current
    if (!pts) return
    const pos = (pts.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array
    const count = pos.length / 3
    for (let i = 0; i < count; i++) {
      const ii = i * 3
      // Gentle upward drift then reset
      pos[ii + 1] += 0.012
      if (pos[ii + 1] > 4) pos[ii + 1] = 0.2 + Math.random() * 0.3
      // Slight lateral drift
      pos[ii]   += Math.sin(elapsed * 0.5 + i) * 0.003
    }
    ;(pts.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true
    const mat = pts.material as THREE.PointsMaterial
    mat.opacity = 0.45 + Math.sin(elapsed * 1.2) * 0.2
  }

  // ── Subscription stream drift ──────────────────────────────────────────────

  function animateSubStreams(elapsed: number) {
    const pts = subCostStreamRef.current
    if (!pts) return
    const pos = (pts.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array
    const count = pos.length / 3
    for (let i = 0; i < count; i++) {
      const ii = i * 3
      // Drift eastward (away from continent)
      pos[ii] += 0.008
      if (pos[ii] > EAST_X_MIN + 50) pos[ii] = EAST_X_MIN
      pos[ii + 1] += Math.sin(elapsed * 0.3 + i * 0.1) * 0.002
    }
    ;(pts.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true
    const mat = pts.material as THREE.PointsMaterial
    mat.opacity = 0.35 + Math.sin(elapsed * 0.8) * 0.1
  }

  // ── Tick tweens ────────────────────────────────────────────────────────────

  function tickTweens(dt: number) {
    const alive: Tween[] = []
    for (const tw of tweensRef.current) {
      if (tw.done) continue
      tw.elapsed += dt
      const t = Math.min(1, tw.elapsed / tw.duration)
      tw.onUpdate(t)
      if (t >= 1) {
        tw.done = true
        tw.onComplete?.()
      } else {
        alive.push(tw)
      }
    }
    tweensRef.current = alive
  }

  // ── React to data changes ─────────────────────────────────────────────────

  function applyData(data: NWWorldData) {
    const sig = data.accountingSignals

    // ── Revenue: new project won → spawn formation tween ──────────────────
    const activeProjects = data.projects.filter(p =>
      p.status === 'in_progress' || p.status === 'approved' || p.status === 'pending'
    )
    for (const p of activeProjects) {
      if (!formationsRef.current.has(p.id)) {
        spawnFormation(p)
      }
    }
    // Clean up formations for removed/completed projects
    for (const [id] of formationsRef.current) {
      if (!data.projects.find(p => p.id === id)) {
        const entry = formationsRef.current.get(id)!
        disposeObj(scene, entry.mesh)
        formationsRef.current.delete(id)
      }
    }

    // ── Revenue: paid invoice → river brightness pulse ──────────────────
    const nowPaidIds = new Set(
      data.invoices.filter(inv => inv.status === 'paid').map(inv => inv.id)
    )
    const prev = prevPaidInvoiceIdsRef.current
    let newPaidTotal = 0
    for (const id of nowPaidIds) {
      if (!prev.has(id)) {
        const inv = data.invoices.find(i => i.id === id)
        if (inv) newPaidTotal += inv.amount
      }
    }
    if (newPaidTotal > 0) {
      triggerRiverPulse(Math.min(1, newPaidTotal / 10000))
    }
    prevPaidInvoiceIdsRef.current = nowPaidIds

    // ── Revenue: new Hub subscriber → burst ring ──────────────────────
    const subCount = sig.hubSubscriberCount
    if (subCount > prevSubscriberCountRef.current) {
      const diff = subCount - prevSubscriberCountRef.current
      for (let i = 0; i < Math.min(diff, 3); i++) {
        spawnSubscriberRing()
      }
    }
    prevSubscriberCountRef.current = subCount

    // ── Revenue: solar RMO → gold pulse rebuild if changed ──────────────
    if (Math.abs(data.solarIncome - prevSolarIncomeRef.current) > 500) {
      buildSolarPulse(data.solarIncome)
      prevSolarIncomeRef.current = data.solarIncome
    }

    // ── Cost: payroll run (field log hours spike) → west dim ──────────
    const hours = sig.recentPayrollHours
    if (hours > prevPayrollHoursRef.current + 20) {
      triggerPayrollDim(hours)
    }
    prevPayrollHoursRef.current = hours

    // ── Cost: overhead erosion (rebuild on data change) ─────────────
    buildOverheadErosion(sig.overheadMonthly)

    // ── Cost: subscription streams (rebuild on subscriber count change) ─
    buildSubCostStreams(sig.hubSubscriberCount)

    // ── Risk: AR stalactites for invoices >30 days ─────────────────
    updateARStalactites(sig.arOver30Days, data.projects)

    // ── Risk: single client dependency shadow ─────────────────────
    updateDependencyShadow(
      sig.dominantProjectId,
      sig.singleClientDependencyRatio,
      data.projects
    )

    // ── Growth: service area columns ──────────────────────────────
    updateServiceColumns(sig.serviceAreaCount)

    // ── Growth: crew ridges ───────────────────────────────────────
    if (sig.activeCrewCount !== prevCrewCountRef.current) {
      updateCrewRidges(sig.activeCrewCount, data.projects)
      prevCrewCountRef.current = sig.activeCrewCount
    }

    // ── Growth: hub feature plateaus ───────────────────────────────
    if (sig.recentFeatureLaunches !== prevFeatureLaunchesRef.current) {
      updateFeaturePlateaus(sig.recentFeatureLaunches)
      prevFeatureLaunchesRef.current = sig.recentFeatureLaunches
    }

    lastDataRef.current = data
  }

  // ── Main effect ────────────────────────────────────────────────────────────

  useEffect(() => {
    // Build persistent objects
    buildRiverPulsePlane()
    buildPayrollLight()

    let lastTime = performance.now()

    function onFrame() {
      const now = performance.now()
      const dt  = Math.min(0.1, (now - lastTime) / 1000)
      lastTime  = now
      elapsedRef.current += dt

      tickTweens(dt)
      animateSolarPulse(elapsedRef.current)
      animateSubStreams(elapsedRef.current)
    }

    // Register on nw:frame event from WorldEngine
    const handler = () => onFrame()
    frameHandlerRef.current = handler
    window.addEventListener('nw:frame', handler)

    // Subscribe to DataBridge
    const unsub = subscribeWorldData((data) => {
      applyData(data)
    })

    // Cleanup
    return () => {
      window.removeEventListener('nw:frame', handler)
      unsub()

      // Dispose all scene objects
      for (const [, entry] of formationsRef.current) {
        disposeObj(scene, entry.mesh)
      }
      formationsRef.current.clear()

      disposeObj(scene, riverPulseMeshRef.current)
      riverPulseMeshRef.current = null

      for (const { ring } of subscriberRingsRef.current) {
        disposeObj(scene, ring)
      }
      subscriberRingsRef.current = []

      disposeObj(scene, solarPulseRef.current)
      solarPulseRef.current = null

      if (payrollDimRef.current) {
        scene.remove(payrollDimRef.current)
        payrollDimRef.current = null
      }

      disposeObj(scene, overheadErosionRef.current)
      overheadErosionRef.current = null

      disposeObj(scene, subCostStreamRef.current)
      subCostStreamRef.current = null

      for (const [, mesh] of arStalactitesRef.current) {
        disposeObj(scene, mesh)
      }
      arStalactitesRef.current.clear()

      disposeObj(scene, depShadowRef.current)
      depShadowRef.current = null
      if (depLightRef.current) {
        scene.remove(depLightRef.current)
        depLightRef.current = null
      }

      for (const c of serviceColumnsRef.current) disposeObj(scene, c)
      serviceColumnsRef.current = []

      for (const p of featurePlateausRef.current) disposeObj(scene, p)
      featurePlateausRef.current = []

      for (const r of crewRidgesRef.current) {
        scene.remove(r)
        r.geometry.dispose()
        const mat = r.material as THREE.Material | undefined
        if (mat) mat.dispose()
      }
      crewRidgesRef.current = []
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene])

  return null
}
