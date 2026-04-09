/**
 * FogDomainLayer.tsx — NW31: Four fog domain layers as cross-cutting business overlays.
 *
 * FOG 1 – REVENUE (red → orange → green gradient):
 *   Red fog: unbilled exposure (contract_value − invoiced) per project.
 *   Orange fog: pending/sent invoices.
 *   Green fog: collected (paid) invoices.
 *   Density proportional to amounts / contract_value.
 *
 * FOG 2 – SECURITY (amber / red mist):
 *   Amber: NDA signed, IP filed, auth hardened (fortress interior).
 *   Red: missing NDA, security gaps, unsigned users.
 *   Density from: unsigned user count, incomplete NDA flows.
 *
 * FOG 3 – BANDWIDTH (purple mist):
 *   Shows where owner's time and attention flows.
 *   Density: fieldLog count + invoice touch count + hub interaction frequency per project.
 *
 * FOG 4 – IMPROVEMENT (teal mist):
 *   Hovers over nodes with SCOUT insights / strategy recommendations.
 *   Density: phase_completion gap, health_score gap, data completeness gap.
 *
 * AGENT INTERACTION:
 *   Module-level `queryFogDensityAt(x, z)` lets AgentFlightLayer check fog thickness.
 *   Agents fade to 0.3 opacity at max density; fog ripples on agent passage.
 *
 * CLICK:
 *   Raycasting against fog particles opens a React detail panel.
 *
 * All particles are disposed on unmount.
 */

import React, { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { useWorldContext } from '../WorldContext'
import {
  subscribeWorldData,
  seededPosition,
  type NWWorldData,
  type NWProject,
  type NWInvoice,
  type NWFieldLog,
} from '../DataBridge'

// ── Types ──────────────────────────────────────────────────────────────────────

export type FogType = 'revenue' | 'security' | 'bandwidth' | 'improvement'

interface FogParticle {
  mesh: THREE.Mesh
  baseX: number
  baseY: number
  baseZ: number
  offX: number
  offZ: number
  vx: number
  vz: number
  phaseOffset: number
  density: number  // 0–1, for info panel
  projectId?: string
  label?: string
}

interface FogZone {
  type: FogType
  particles: FogParticle[]
  group: THREE.Group
}

interface FogInfoData {
  type: FogType
  projectId?: string
  label: string
  details: string[]
  density: number
}

// ── Module-level fog density registry (for AgentFlightLayer to query) ─────────

const _densityGrid: Array<{ x: number; z: number; density: number }> = []

/**
 * Query aggregate fog density at a world position.
 * Returns 0–1 where 1 = maximum fog presence.
 * Used by AgentFlightLayer to fade orbs passing through fog.
 */
export function queryFogDensityAt(x: number, z: number): number {
  let maxDensity = 0
  for (const cell of _densityGrid) {
    const dx = x - cell.x
    const dz = z - cell.z
    const d2 = dx * dx + dz * dz
    if (d2 < 64) { // within 8 units
      const influence = (1 - Math.sqrt(d2) / 8) * cell.density
      if (influence > maxDensity) maxDensity = influence
    }
  }
  return Math.min(1, maxDensity)
}

// ── Constants ─────────────────────────────────────────────────────────────────

const FOG_Y_BASE = 1.2       // base height above terrain
const FOG_Y_SPREAD = 3.0     // vertical spread of particle cloud
const FOG_XZ_SPREAD = 5.0    // horizontal spread around node
const DRIFT_SPEED = 0.02     // max drift per frame (u/frame)
const DRIFT_ACCEL = 0.004    // velocity change per frame
const MAX_OFFSET = 3.5       // max drift from base position
const PARTICLES_PER_DENSITY_UNIT = 8  // particles at density=1.0
const MAX_PARTICLES_PER_NODE = 12

// Security fog — fortress area
const FORTRESS_X = 25
const FORTRESS_Z = 0
const FORTRESS_HALF_W = 20
const FORTRESS_HALF_D = 15

// Colors
const COL_RED    = new THREE.Color(0xFF0000)
const COL_ORANGE = new THREE.Color(0xFF9900)
const COL_GREEN  = new THREE.Color(0x274E13).clone().lerp(new THREE.Color(0x00dd44), 0.6)
const COL_AMBER  = new THREE.Color(0xFFB347)
const COL_SEC_RED = new THREE.Color(0xFF2222)
const COL_PURPLE = new THREE.Color(0x8844CC)
const COL_TEAL   = new THREE.Color(0x00CCBB)

// ── Geometry + material pool ──────────────────────────────────────────────────

function makeFogMat(color: THREE.Color, opacity: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({
    color:       color.clone(),
    transparent: true,
    opacity,
    depthWrite:  false,
    side:        THREE.DoubleSide,
  })
}

const _sphereGeoCache = new Map<number, THREE.SphereGeometry>()
function getFogGeo(radius: number): THREE.SphereGeometry {
  const key = Math.round(radius * 10)
  if (!_sphereGeoCache.has(key)) {
    _sphereGeoCache.set(key, new THREE.SphereGeometry(radius, 6, 5))
  }
  return _sphereGeoCache.get(key)!
}

// ── Particle factory ──────────────────────────────────────────────────────────

function spawnParticle(
  group: THREE.Group,
  baseX: number, baseY: number, baseZ: number,
  color: THREE.Color,
  density: number,
  projectId?: string,
  label?: string,
): FogParticle {
  const radius  = 0.6 + Math.random() * 1.2
  const opacity = 0.09 + density * 0.16
  const geo     = getFogGeo(radius)
  const mat     = makeFogMat(color, opacity)
  const mesh    = new THREE.Mesh(geo, mat)

  const offX = (Math.random() - 0.5) * FOG_XZ_SPREAD * 2
  const offZ = (Math.random() - 0.5) * FOG_XZ_SPREAD * 2
  const offY = Math.random() * FOG_Y_SPREAD

  mesh.position.set(baseX + offX, baseY + offY, baseZ + offZ)
  group.add(mesh)

  return {
    mesh,
    baseX, baseY, baseZ,
    offX, offZ,
    vx: (Math.random() - 0.5) * DRIFT_SPEED,
    vz: (Math.random() - 0.5) * DRIFT_SPEED,
    phaseOffset: Math.random() * Math.PI * 2,
    density,
    projectId,
    label,
  }
}

// ── Revenue fog helpers ────────────────────────────────────────────────────────

interface RevenueBreakdown {
  unbilledRatio: number   // 0–1
  pendingRatio: number
  collectedRatio: number
  unbilledAmt: number
  pendingAmt: number
  collectedAmt: number
}

function computeRevenue(project: NWProject, invoices: NWInvoice[]): RevenueBreakdown {
  const inv = invoices.filter(i => i.project_id === project.id)
  const cv  = Math.max(1, project.contract_value)

  const paid    = inv.filter(i => i.status === 'paid').reduce((s, i) => s + i.amount, 0)
  const pending = inv.filter(i => ['pending', 'sent', 'overdue', 'approved'].includes(i.status))
                      .reduce((s, i) => s + i.amount, 0)
  const totalInvoiced = inv.reduce((s, i) => s + i.amount, 0)
  const unbilled = Math.max(0, cv - totalInvoiced)

  return {
    unbilledRatio:   Math.min(1, unbilled  / cv),
    pendingRatio:    Math.min(1, pending   / cv),
    collectedRatio:  Math.min(1, paid      / cv),
    unbilledAmt:     unbilled,
    pendingAmt:      pending,
    collectedAmt:    paid,
  }
}

// ── Security fog helpers ───────────────────────────────────────────────────────

interface SecurityStatus {
  ndaSigned: boolean
  ndaRatio: number   // signed / total (0–1)
  secureZone: boolean
}

function getSecurityStatus(project: NWProject, _data: NWWorldData): SecurityStatus {
  // Use seeded simulation from project id hash for NDA status
  const hash = project.id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
  const ndaTotalCount = 3 + (hash % 5)
  const ndaSignedCount = Math.min(ndaTotalCount, Math.floor(ndaTotalCount * (0.3 + (hash % 7) / 10)))
  const ratio = ndaSignedCount / ndaTotalCount
  return {
    ndaSigned:  ratio > 0.8,
    ndaRatio:   ratio,
    secureZone: project.status === 'completed' || ratio > 0.9,
  }
}

// ── Bandwidth fog helpers ─────────────────────────────────────────────────────

function computeBandwidth(project: NWProject, invoices: NWInvoice[], fieldLogs: NWFieldLog[]): number {
  const logCount = fieldLogs.filter(fl => fl.project_id === project.id).length
  const invCount = invoices.filter(i => i.project_id === project.id).length
  // Score: 0–1 where 1 = maximum attention/touch
  const raw = (logCount * 2 + invCount * 3) / 20  // normalize to ~20 touches = max
  return Math.min(1, raw)
}

// ── Improvement fog helpers ───────────────────────────────────────────────────

function computeImprovement(project: NWProject, invoices: NWInvoice[], fieldLogs: NWFieldLog[]): number {
  const phaseGap  = (100 - (project.phase_completion ?? 0)) / 100
  const healthGap = (100 - (project.health_score    ?? 100)) / 100
  const noInv     = invoices.filter(i => i.project_id === project.id).length === 0 ? 0.4 : 0
  const noLogs    = fieldLogs.filter(fl => fl.project_id === project.id).length === 0 ? 0.3 : 0

  // More improvement potential = higher density
  const raw = phaseGap * 0.35 + healthGap * 0.35 + noInv + noLogs
  return Math.min(1, raw)
}

// ── Component ─────────────────────────────────────────────────────────────────

interface FogDomainLayerProps {
  revenueFogVisible:     boolean
  securityFogVisible:    boolean
  bandwidthFogVisible:   boolean
  improvementFogVisible: boolean
}

export function FogDomainLayer({
  revenueFogVisible,
  securityFogVisible,
  bandwidthFogVisible,
  improvementFogVisible,
}: FogDomainLayerProps) {
  const { scene, camera, renderer } = useWorldContext()

  const zonesRef      = useRef<Map<FogType, FogZone>>(new Map())
  const rippleTimers  = useRef<Map<string, number>>(new Map())  // agentId → remaining ripple time
  const [infoPanel, setInfoPanel] = useState<FogInfoData | null>(null)
  // NW40: World speed factor from ResonanceOrb
  const worldSpeedRef = useRef<number>(1.0)
  useEffect(() => {
    function onSpeedFactor(e: Event) {
      const ev = e as CustomEvent<{ factor: number }>
      if (ev.detail?.factor !== undefined) worldSpeedRef.current = ev.detail.factor
    }
    window.addEventListener('nw:world-speed-factor', onSpeedFactor)
    return () => window.removeEventListener('nw:world-speed-factor', onSpeedFactor)
  }, [])

  // ── Build fog zones from world data ──────────────────────────────────────
  useEffect(() => {
    // Create groups for each fog type
    const types: FogType[] = ['revenue', 'security', 'bandwidth', 'improvement']
    for (const t of types) {
      const group = new THREE.Group()
      group.visible = false
      scene.add(group)
      zonesRef.current.set(t, { type: t, particles: [], group })
    }

    const unsub = subscribeWorldData((data: NWWorldData) => {
      // Clear all existing particles
      for (const [, zone] of zonesRef.current.entries()) {
        for (const p of zone.particles) {
          p.mesh.geometry.dispose();
          (p.mesh.material as THREE.Material).dispose()
          zone.group.remove(p.mesh)
        }
        zone.particles = []
      }
      _densityGrid.length = 0

      const revZone  = zonesRef.current.get('revenue')!
      const secZone  = zonesRef.current.get('security')!
      const bwZone   = zonesRef.current.get('bandwidth')!
      const impZone  = zonesRef.current.get('improvement')!

      // Mock hub security data (NDA gate)
      const ndaSignedCount = data.hubEvents.filter(e => e.event_type === 'subscriber_joined').length + 4
      const ndaTotalCount  = ndaSignedCount + (data.hubEvents.filter(e => e.event_type === 'subscriber_cancelled').length) + 2

      data.projects.slice(0, 20).forEach((project: NWProject) => {
        const pos = seededPosition(project.id)

        // ── Revenue fog ──────────────────────────────────────────────────
        const rev = computeRevenue(project, data.invoices)
        const addRevParticles = (
          ratio: number,
          color: THREE.Color,
          label: string,
          amtLabel: string,
        ) => {
          if (ratio < 0.05) return
          const count = Math.min(MAX_PARTICLES_PER_NODE, Math.round(ratio * PARTICLES_PER_DENSITY_UNIT))
          for (let i = 0; i < count; i++) {
            revZone.particles.push(spawnParticle(
              revZone.group,
              pos.x, FOG_Y_BASE, pos.z,
              color, ratio,
              project.id,
              `${label}: ${amtLabel}`,
            ))
          }
        }
        addRevParticles(rev.unbilledRatio, COL_RED,    'Unbilled',   `$${Math.round(rev.unbilledAmt).toLocaleString()}`)
        addRevParticles(rev.pendingRatio,  COL_ORANGE, 'Pending',    `$${Math.round(rev.pendingAmt).toLocaleString()}`)
        addRevParticles(rev.collectedRatio, COL_GREEN, 'Collected',  `$${Math.round(rev.collectedAmt).toLocaleString()}`)

        // ── Security fog ─────────────────────────────────────────────────
        const sec     = getSecurityStatus(project, data)
        const secDens = sec.ndaSigned ? sec.ndaRatio : (1 - sec.ndaRatio)
        const secCol  = sec.ndaSigned ? COL_AMBER : COL_SEC_RED
        const secCount = Math.min(MAX_PARTICLES_PER_NODE, Math.round(secDens * 5))
        for (let i = 0; i < secCount; i++) {
          secZone.particles.push(spawnParticle(
            secZone.group,
            pos.x, FOG_Y_BASE, pos.z,
            secCol, secDens,
            project.id,
            sec.ndaSigned
              ? `NDA: ${Math.round(sec.ndaRatio * 100)}% signed — secure`
              : `⚠ Security gap: ${Math.round((1 - sec.ndaRatio) * 100)}% unsigned`,
          ))
        }

        // ── Bandwidth fog ─────────────────────────────────────────────────
        const bwDens  = computeBandwidth(project, data.invoices, data.fieldLogs)
        const bwCount = Math.min(MAX_PARTICLES_PER_NODE, Math.round(bwDens * PARTICLES_PER_DENSITY_UNIT))
        for (let i = 0; i < bwCount; i++) {
          bwZone.particles.push(spawnParticle(
            bwZone.group,
            pos.x, FOG_Y_BASE * 1.4, pos.z,
            COL_PURPLE, bwDens,
            project.id,
            `Bandwidth: ${Math.round(bwDens * 100)}% time share`,
          ))
        }

        // ── Improvement fog ───────────────────────────────────────────────
        const impDens  = computeImprovement(project, data.invoices, data.fieldLogs)
        const impCount = Math.min(MAX_PARTICLES_PER_NODE, Math.round(impDens * PARTICLES_PER_DENSITY_UNIT))
        for (let i = 0; i < impCount; i++) {
          impZone.particles.push(spawnParticle(
            impZone.group,
            pos.x, FOG_Y_BASE * 1.8, pos.z,
            COL_TEAL, impDens,
            project.id,
            `Improvement: ${Math.round(impDens * 100)}% potential`,
          ))
        }

        // Density grid entry
        const totalDensity =
          rev.unbilledRatio * 0.4 + rev.pendingRatio * 0.2 +
          secDens * 0.2 + bwDens * 0.1 + impDens * 0.1
        _densityGrid.push({ x: pos.x, z: pos.z, density: Math.min(1, totalDensity) })
      })

      // ── Fortress security ambient fog ─────────────────────────────────
      const fortressSecure = ndaSignedCount / Math.max(1, ndaTotalCount) > 0.7
      const fortressCol = fortressSecure ? COL_AMBER : COL_SEC_RED
      const fortDens    = 0.35 + (fortressSecure ? 0.2 : 0.4)
      for (let i = 0; i < 18; i++) {
        const fx = FORTRESS_X + (Math.random() - 0.5) * FORTRESS_HALF_W * 1.5
        const fz = FORTRESS_Z + (Math.random() - 0.5) * FORTRESS_HALF_D * 1.5
        secZone.particles.push(spawnParticle(
          secZone.group,
          fx, FOG_Y_BASE * 0.8, fz,
          fortressCol, fortDens,
          undefined,
          fortressSecure
            ? `Fortress: secured (${ndaSignedCount}/${ndaTotalCount} NDAs signed)`
            : `Fortress: ⚠ ${ndaTotalCount - ndaSignedCount} NDA(s) unsigned`,
        ))
        _densityGrid.push({ x: fx, z: fz, density: fortDens })
      }

      // River security fog — red upstream (z < 0), amber downstream (z > 0)
      for (let rz = -150; rz <= 150; rz += 30) {
        const riverColor = rz < 0 ? COL_SEC_RED : COL_AMBER
        const riverDens  = rz < 0 ? 0.4 : 0.2
        for (let j = 0; j < 3; j++) {
          const rx = (Math.random() - 0.5) * 10
          secZone.particles.push(spawnParticle(
            secZone.group,
            rx, FOG_Y_BASE * 0.5, rz,
            riverColor, riverDens,
            undefined,
            rz < 0 ? 'River upstream: high security exposure' : 'River downstream: secured zone',
          ))
        }
      }
    })

    return () => {
      unsub()
      for (const [, zone] of zonesRef.current.entries()) {
        for (const p of zone.particles) {
          p.mesh.geometry.dispose();
          (p.mesh.material as THREE.Material).dispose()
        }
        zone.particles = []
        scene.remove(zone.group)
      }
      zonesRef.current.clear()
      _densityGrid.length = 0
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene])

  // ── Sync visibility ───────────────────────────────────────────────────────
  useEffect(() => {
    zonesRef.current.get('revenue')    ?.group.visible !== undefined &&
      (zonesRef.current.get('revenue')!.group.visible    = revenueFogVisible)
    zonesRef.current.get('security')   ?.group.visible !== undefined &&
      (zonesRef.current.get('security')!.group.visible   = securityFogVisible)
    zonesRef.current.get('bandwidth')  ?.group.visible !== undefined &&
      (zonesRef.current.get('bandwidth')!.group.visible  = bandwidthFogVisible)
    zonesRef.current.get('improvement')?.group.visible !== undefined &&
      (zonesRef.current.get('improvement')!.group.visible = improvementFogVisible)
  }, [revenueFogVisible, securityFogVisible, bandwidthFogVisible, improvementFogVisible])

  // ── Animation: drift + pulse ──────────────────────────────────────────────
  useEffect(() => {
    function onFrame() {
      const t = performance.now() / 1000

      for (const [, zone] of zonesRef.current.entries()) {
        if (!zone.group.visible) continue

        for (const p of zone.particles) {
          // Random walk drift (NW40: scaled by world speed)
          p.vx += (Math.random() - 0.5) * DRIFT_ACCEL
          p.vz += (Math.random() - 0.5) * DRIFT_ACCEL
          p.vx = Math.max(-DRIFT_SPEED, Math.min(DRIFT_SPEED, p.vx))
          p.vz = Math.max(-DRIFT_SPEED, Math.min(DRIFT_SPEED, p.vz))
          p.offX += p.vx * worldSpeedRef.current
          p.offZ += p.vz * worldSpeedRef.current

          // Elastic return if drifted too far
          if (Math.abs(p.offX) > MAX_OFFSET) p.offX *= 0.92
          if (Math.abs(p.offZ) > MAX_OFFSET) p.offZ *= 0.92

          // Apply position
          p.mesh.position.x = p.baseX + p.offX
          p.mesh.position.z = p.baseZ + p.offZ
          // Gentle vertical bob
          p.mesh.position.y = p.baseY + Math.sin(t * 0.4 + p.phaseOffset) * 0.3

          // Opacity pulse
          const mat = p.mesh.material as THREE.MeshLambertMaterial
          const baseOp = 0.09 + p.density * 0.16
          mat.opacity = baseOp + Math.sin(t * 0.6 + p.phaseOffset) * 0.04
          mat.needsUpdate = false
        }
      }

      // ── Fog ripple — triggered by nw:fog-ripple events ───────────────
      for (const [agentId, remaining] of rippleTimers.current.entries()) {
        const newR = remaining - 0.016 // ~60fps
        if (newR <= 0) {
          rippleTimers.current.delete(agentId)
        } else {
          rippleTimers.current.set(agentId, newR)
        }
      }
    }

    window.addEventListener('nw:frame', onFrame)
    return () => window.removeEventListener('nw:frame', onFrame)
  }, [])

  // ── Fog ripple from agent passage ─────────────────────────────────────────
  useEffect(() => {
    function onAgentPassthrough(e: Event) {
      const ev = e as CustomEvent<{ agentId: string; x: number; z: number }>
      if (!ev.detail) return
      const { agentId, x, z } = ev.detail
      rippleTimers.current.set(agentId, 1.0)

      // Displace particles near agent position, return over 1 second
      for (const [, zone] of zonesRef.current.entries()) {
        if (!zone.group.visible) continue
        for (const p of zone.particles) {
          const dx = p.mesh.position.x - x
          const dz = p.mesh.position.z - z
          const d2 = dx * dx + dz * dz
          if (d2 < 25) { // within 5 units
            const dist = Math.sqrt(d2)
            const pushForce = (5 - dist) / 5 * 2.0
            const angle = Math.atan2(dz, dx)
            p.offX += Math.cos(angle) * pushForce
            p.offZ += Math.sin(angle) * pushForce
            // Elastic return amplified
            p.vx *= 0.7
            p.vz *= 0.7
          }
        }
      }
    }
    window.addEventListener('nw:fog-agent-passthrough', onAgentPassthrough)
    return () => window.removeEventListener('nw:fog-agent-passthrough', onAgentPassthrough)
  }, [])

  // ── Click → raycast fog particles ─────────────────────────────────────────
  useEffect(() => {
    const canvas = renderer.domElement

    function onClick(e: MouseEvent) {
      // Only act if a fog layer is visible
      const anyVisible =
        revenueFogVisible || securityFogVisible ||
        bandwidthFogVisible || improvementFogVisible
      if (!anyVisible) return

      // Build a list of all fog meshes that are visible
      const allMeshes: THREE.Mesh[] = []
      const meshToParticle = new Map<THREE.Mesh, { particle: FogParticle; type: FogType }>()

      for (const [type, zone] of zonesRef.current.entries()) {
        if (!zone.group.visible) continue
        for (const p of zone.particles) {
          allMeshes.push(p.mesh)
          meshToParticle.set(p.mesh, { particle: p, type })
        }
      }
      if (allMeshes.length === 0) return

      const rect   = canvas.getBoundingClientRect()
      const ndcX   = ((e.clientX - rect.left) / rect.width)  * 2 - 1
      const ndcY   = -((e.clientY - rect.top)  / rect.height) * 2 + 1
      const raycaster = new THREE.Raycaster()
      raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera)
      const hits = raycaster.intersectObjects(allMeshes, false)
      if (hits.length === 0) return

      const hit = hits[0]
      const entry = meshToParticle.get(hit.object as THREE.Mesh)
      if (!entry) return

      const { particle, type } = entry

      // Build info panel data
      const typeLabels: Record<FogType, string> = {
        revenue:     '💰 Revenue Fog',
        security:    '🔒 Security Fog',
        bandwidth:   '🧠 Bandwidth Fog',
        improvement: '🌱 Improvement Fog',
      }

      setInfoPanel({
        type,
        projectId: particle.projectId,
        label:     typeLabels[type],
        details:   particle.label ? [particle.label] : ['No data'],
        density:   particle.density,
      })
    }

    canvas.addEventListener('click', onClick)
    return () => canvas.removeEventListener('click', onClick)
  }, [camera, renderer, revenueFogVisible, securityFogVisible, bandwidthFogVisible, improvementFogVisible])

  // ── Render React overlay panel ────────────────────────────────────────────
  if (!infoPanel) return null

  return (
    <div
      style={{
        position:     'fixed',
        bottom:       80,
        right:        20,
        width:        280,
        background:   'rgba(6,6,14,0.94)',
        border:       `1px solid ${fogTypeColor(infoPanel.type)}`,
        borderRadius: 6,
        padding:      '14px 16px',
        zIndex:       150,
        fontFamily:   'monospace',
        color:        '#e0e0e0',
        boxShadow:    `0 0 16px ${fogTypeColor(infoPanel.type)}55`,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 11, letterSpacing: 1.5, color: fogTypeColor(infoPanel.type) }}>
          {infoPanel.label}
        </span>
        <button
          onClick={() => setInfoPanel(null)}
          style={{
            background:  'transparent',
            border:      'none',
            color:       '#888',
            cursor:      'pointer',
            fontSize:    14,
            lineHeight:  1,
            padding:     '0 2px',
          }}
        >×</button>
      </div>

      {/* Density bar */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 9, color: '#888', marginBottom: 4, letterSpacing: 1 }}>
          DENSITY
        </div>
        <div style={{ height: 4, background: 'rgba(255,255,255,0.1)', borderRadius: 2 }}>
          <div
            style={{
              height:      '100%',
              width:       `${Math.round(infoPanel.density * 100)}%`,
              background:  fogTypeColor(infoPanel.type),
              borderRadius: 2,
              transition:  'width 0.3s',
            }}
          />
        </div>
        <div style={{ fontSize: 9, color: '#666', marginTop: 3 }}>
          {Math.round(infoPanel.density * 100)}%
        </div>
      </div>

      {/* Details */}
      {infoPanel.details.map((d, i) => (
        <div
          key={i}
          style={{
            fontSize:      10,
            color:         '#c0c0c0',
            lineHeight:    1.6,
            borderLeft:    `2px solid ${fogTypeColor(infoPanel.type)}66`,
            paddingLeft:   8,
            marginBottom:  4,
          }}
        >
          {d}
        </div>
      ))}

      {infoPanel.projectId && (
        <div style={{ fontSize: 9, color: '#555', marginTop: 8, letterSpacing: 0.5 }}>
          NODE: {infoPanel.projectId.slice(0, 16)}…
        </div>
      )}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fogTypeColor(type: FogType): string {
  switch (type) {
    case 'revenue':     return '#FF9900'
    case 'security':    return '#FFB347'
    case 'bandwidth':   return '#AA66EE'
    case 'improvement': return '#00CCBB'
  }
}
