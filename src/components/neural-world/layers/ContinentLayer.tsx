/**
 * ContinentLayer.tsx — NW8 continent-specific world elements.
 *
 * Handles:
 * 1. Central river plasma flow particles (x=-20..20, z=-200..200)
 * 2. MTZ Solar island — floating platform at z=-150, x=0, y=0
 * 3. Bridge (GeometryBox) connecting island to founders valley — toggles
 *    on/off matching Solar Income panel state via shared Supabase flag
 *    (listens to 'nw:solar-income-toggle' window event and Supabase poll)
 * 4. Revenue health dispatch — reads invoice/project data and fires
 *    'nw:revenue-health' so WorldEngine can modulate dual sun intensities
 *
 * NW8 scope: West continent x=-200..-20, East x=20..200,
 * Central channel x=-20..20, MTZ island at z=-150 x=0 offshore south.
 */

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useWorldContext } from '../WorldContext'
import { subscribeWorldData, type NWWorldData } from '../DataBridge'
import { supabase } from '@/lib/supabase'
import { registerParticles, unregisterParticles } from '../ParticleManager'

// ── Constants ──────────────────────────────────────────────────────────────────

const PLASMA_COUNT_REQUESTED = 400
const RIVER_HALF_WIDTH = 18   // x: -18..18
const RIVER_DEPTH = 380        // z: -190..190
const ISLAND_RADIUS = 15
const ISLAND_Y = 0             // ground level (floating = visually at y=0 on water)
const ISLAND_Z = -150
const ISLAND_X = 0
const BRIDGE_LENGTH = 125       // from z=-25 to z=-150
const BRIDGE_Z_START = -25
const BRIDGE_Z_CENTER = BRIDGE_Z_START - BRIDGE_LENGTH / 2  // midpoint z

// ── Component ──────────────────────────────────────────────────────────────────

export function ContinentLayer() {
  const { scene } = useWorldContext()

  // Plasma river particles
  const plasmaRef = useRef<THREE.Points | null>(null)
  const plasmaPositionsRef = useRef<Float32Array | null>(null)
  const plasmaVelocitiesRef = useRef<Float32Array | null>(null)
  // NW15: actual allowed count from ParticleManager
  const plasmaCountRef = useRef<number>(PLASMA_COUNT_REQUESTED)

  // MTZ Solar island
  const islandRef = useRef<THREE.Mesh | null>(null)
  const islandGlowRef = useRef<THREE.PointLight | null>(null)

  // Bridge
  const bridgeRef = useRef<THREE.Mesh | null>(null)
  const bridgeActiveRef = useRef<boolean>(false)

  const frameHandlerRef = useRef<(() => void) | null>(null)
  const elapsedRef = useRef(0)

  // ── Build plasma river ───────────────────────────────────────────────────

  function buildPlasma() {
    if (plasmaRef.current) {
      scene.remove(plasmaRef.current)
      plasmaRef.current.geometry.dispose()
      ;(plasmaRef.current.material as THREE.Material).dispose()
      plasmaRef.current = null
    }

    // NW15: Register with ParticleManager (respects global 5000-particle cap)
    const PLASMA_COUNT = registerParticles('continent-plasma', 'Plasma River', PLASMA_COUNT_REQUESTED)
    plasmaCountRef.current = PLASMA_COUNT

    const positions = new Float32Array(PLASMA_COUNT * 3)
    const colors = new Float32Array(PLASMA_COUNT * 3)
    const velocities = new Float32Array(PLASMA_COUNT)  // z velocity per particle

    for (let i = 0; i < PLASMA_COUNT; i++) {
      positions[i * 3]     = (Math.random() - 0.5) * RIVER_HALF_WIDTH * 2
      positions[i * 3 + 1] = 0.1 + Math.random() * 0.6
      positions[i * 3 + 2] = (Math.random() - 0.5) * RIVER_DEPTH

      // Plasma color: mix of teal-cyan and electric blue
      const isTeal = Math.random() > 0.4
      colors[i * 3]     = isTeal ? 0.0 : 0.1
      colors[i * 3 + 1] = isTeal ? 0.85 : 0.4
      colors[i * 3 + 2] = isTeal ? 0.95 : 1.0

      // Flow northward (positive z direction) at varying speeds
      velocities[i] = 4 + Math.random() * 8
    }

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))

    const mat = new THREE.PointsMaterial({
      size: 0.35,
      vertexColors: true,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
    })

    const plasma = new THREE.Points(geo, mat)
    scene.add(plasma)
    plasmaRef.current = plasma
    plasmaPositionsRef.current = positions
    plasmaVelocitiesRef.current = velocities
  }

  // ── Build MTZ Solar island ────────────────────────────────────────────────

  function buildIsland() {
    if (islandRef.current) {
      scene.remove(islandRef.current)
      islandRef.current.geometry.dispose()
      ;(islandRef.current.material as THREE.Material).dispose()
      islandRef.current = null
    }
    if (islandGlowRef.current) {
      scene.remove(islandGlowRef.current)
      islandGlowRef.current = null
    }

    // Island platform — low cylinder (disc)
    const islandGeo = new THREE.CylinderGeometry(ISLAND_RADIUS, ISLAND_RADIUS * 1.1, 1.2, 24)
    const islandMat = new THREE.MeshLambertMaterial({
      color: 0x1a1000,
      emissive: new THREE.Color(0xffa500).multiplyScalar(0.08),
    })
    const island = new THREE.Mesh(islandGeo, islandMat)
    island.position.set(ISLAND_X, ISLAND_Y + 0.6, ISLAND_Z)
    island.castShadow = true
    island.receiveShadow = true
    scene.add(island)
    islandRef.current = island

    // Solar panel array (flat boxes on island surface)
    const panelPositions = [
      [-6, 0, -4], [0, 0, -4], [6, 0, -4],
      [-6, 0, 0],  [0, 0, 0],  [6, 0, 0],
      [-6, 0, 4],  [0, 0, 4],  [6, 0, 4],
    ]
    for (const [px, , pz] of panelPositions) {
      const panelGeo = new THREE.BoxGeometry(4.5, 0.12, 2.8)
      const panelMat = new THREE.MeshLambertMaterial({
        color: 0x0a2040,
        emissive: new THREE.Color(0x00aaff).multiplyScalar(0.12),
      })
      const panel = new THREE.Mesh(panelGeo, panelMat)
      panel.position.set(
        ISLAND_X + px,
        ISLAND_Y + 1.26,
        ISLAND_Z + pz
      )
      panel.rotation.x = -0.15  // slight tilt toward sun
      scene.add(panel)
    }

    // Ambient glow point light for island
    const glow = new THREE.PointLight(0xffa030, 1.2, 40)
    glow.position.set(ISLAND_X, ISLAND_Y + 4, ISLAND_Z)
    scene.add(glow)
    islandGlowRef.current = glow
  }

  // ── Build / remove bridge ─────────────────────────────────────────────────

  function setBridgeVisible(visible: boolean) {
    bridgeActiveRef.current = visible

    if (visible && !bridgeRef.current) {
      // Create bridge — elongated box from z=-25 to island
      const bridgeGeo = new THREE.BoxGeometry(4, 0.4, BRIDGE_LENGTH)
      const bridgeMat = new THREE.MeshLambertMaterial({
        color: 0x2a1800,
        emissive: new THREE.Color(0xff8800).multiplyScalar(0.06),
      })
      const bridge = new THREE.Mesh(bridgeGeo, bridgeMat)
      bridge.position.set(ISLAND_X, ISLAND_Y + 0.2, BRIDGE_Z_CENTER)
      bridge.castShadow = true
      bridge.receiveShadow = true
      scene.add(bridge)
      bridgeRef.current = bridge
    } else if (!visible && bridgeRef.current) {
      scene.remove(bridgeRef.current)
      bridgeRef.current.geometry.dispose()
      ;(bridgeRef.current.material as THREE.Material).dispose()
      bridgeRef.current = null
    }
  }

  // ── Animate plasma flow ───────────────────────────────────────────────────

  function setupFrameHandler() {
    if (frameHandlerRef.current) {
      window.removeEventListener('nw:frame', frameHandlerRef.current)
    }

    const handler = () => {
      const dt = 0.016  // approximate delta
      elapsedRef.current += dt

      const plasma = plasmaRef.current
      const positions = plasmaPositionsRef.current
      const velocities = plasmaVelocitiesRef.current
      if (!plasma || !positions || !velocities) return

      const pCount = plasmaCountRef.current
      for (let i = 0; i < pCount; i++) {
        // Move particle northward
        positions[i * 3 + 2] += velocities[i] * dt

        // Recycle particle when it exits north boundary
        if (positions[i * 3 + 2] > RIVER_DEPTH / 2) {
          positions[i * 3 + 2] = -RIVER_DEPTH / 2
          positions[i * 3]     = (Math.random() - 0.5) * RIVER_HALF_WIDTH * 2
          positions[i * 3 + 1] = 0.1 + Math.random() * 0.6
        }

        // Slight lateral drift
        positions[i * 3] += (Math.random() - 0.5) * 0.08
        positions[i * 3] = Math.max(-RIVER_HALF_WIDTH, Math.min(RIVER_HALF_WIDTH, positions[i * 3]))
      }

      ;(plasma.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true

      // Pulse island glow
      if (islandGlowRef.current) {
        islandGlowRef.current.intensity = 0.8 + Math.sin(elapsedRef.current * 1.5) * 0.4
      }
    }

    window.addEventListener('nw:frame', handler)
    frameHandlerRef.current = handler
  }

  // ── Revenue health computation ────────────────────────────────────────────

  function computeAndDispatchHealth(data: NWWorldData) {
    const { projects, invoices } = data
    if (projects.length === 0 && invoices.length === 0) return

    // Solutions health: ratio of paid invoices to total contract value of active projects
    const activeProjects = projects.filter(p =>
      p.status === 'in_progress' || p.status === 'approved'
    )
    const totalContractValue = activeProjects.reduce((sum, p) => sum + p.contract_value, 0)
    const paidAmount = invoices
      .filter(inv => inv.status === 'paid')
      .reduce((sum, inv) => sum + inv.amount, 0)

    const solutionsHealth = totalContractValue > 0
      ? Math.min(1, paidAmount / (totalContractValue * 0.8))
      : 0.5

    // Hub health: use average project health_score as proxy
    const avgHealth = projects.length > 0
      ? projects.reduce((sum, p) => sum + p.health_score, 0) / projects.length / 100
      : 0.75

    window.dispatchEvent(new CustomEvent('nw:revenue-health', {
      detail: {
        solutionsHealth: Math.max(0.1, solutionsHealth),
        hubHealth: Math.max(0.1, avgHealth),
      },
    }))
  }

  // ── Supabase solar bridge flag poll ──────────────────────────────────────

  async function checkSolarFlag() {
    try {
      const { data: { user } } = await (supabase as any).auth.getUser()
      if (!user) return

      const { data: profile } = await (supabase as any)
        .from('profiles')
        .select('org_id')
        .eq('id', user.id)
        .maybeSingle()

      const orgId: string | null = profile?.org_id ?? null
      if (!orgId) return

      const { data: settings } = await (supabase as any)
        .from('neural_world_settings')
        .select('solar_bridge')
        .eq('org_id', orgId)
        .maybeSingle()

      if (settings && typeof settings.solar_bridge === 'boolean') {
        setBridgeVisible(settings.solar_bridge)
      }
    } catch {
      // Non-blocking — solar flag is optional
    }
  }

  // ── Mount / unmount ───────────────────────────────────────────────────────

  useEffect(() => {
    buildPlasma()
    buildIsland()
    setupFrameHandler()

    // Poll solar bridge flag from Supabase on mount
    checkSolarFlag()

    // Listen for solar income toggle events from UI panels
    function onSolarToggle(e: Event) {
      const ev = e as CustomEvent<{ active: boolean }>
      if (typeof ev.detail?.active === 'boolean') {
        setBridgeVisible(ev.detail.active)
      }
    }
    window.addEventListener('nw:solar-income-toggle', onSolarToggle)

    // Subscribe to DataBridge for revenue health dispatch
    const unsub = subscribeWorldData((data: NWWorldData) => {
      computeAndDispatchHealth(data)
    })

    return () => {
      // Plasma
      if (plasmaRef.current) {
        scene.remove(plasmaRef.current)
        plasmaRef.current.geometry.dispose()
        ;(plasmaRef.current.material as THREE.Material).dispose()
        plasmaRef.current = null
      }
      // Island
      if (islandRef.current) {
        scene.remove(islandRef.current)
        islandRef.current.geometry.dispose()
        ;(islandRef.current.material as THREE.Material).dispose()
        islandRef.current = null
      }
      if (islandGlowRef.current) {
        scene.remove(islandGlowRef.current)
        islandGlowRef.current = null
      }
      // Bridge
      if (bridgeRef.current) {
        scene.remove(bridgeRef.current)
        bridgeRef.current.geometry.dispose()
        ;(bridgeRef.current.material as THREE.Material).dispose()
        bridgeRef.current = null
      }
      // Frame handler
      if (frameHandlerRef.current) {
        window.removeEventListener('nw:frame', frameHandlerRef.current)
        frameHandlerRef.current = null
      }
      window.removeEventListener('nw:solar-income-toggle', onSolarToggle)
      // NW15: unregister particles from global cap
      unregisterParticles('continent-plasma')
      unsub()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene])

  return null
}
