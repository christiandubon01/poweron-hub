/**
 * SimulationLayer.tsx — NW19: Enterprise simulation — org pyramids, AI agent placement,
 * role toggles, and business cycle integration.
 *
 * 5 presets (SOLO → TEAM_100) render org pyramids with human/AI role nodes.
 * Amber BoxGeometry = human roles. Teal wireframe BoxGeometry = AI agents.
 * toggleRole() swaps a role from human to AI or back, fires nw:sim-role-toggled.
 * getAggregateStats() returns live human/AI counts, monthly cost, coverage %.
 * setVisible() for LAYERS panel toggle.
 */

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useWorldContext } from '../WorldContext'

// ── Preset definitions ────────────────────────────────────────────────────────

export type SimPreset = 'SOLO' | 'TEAM_5' | 'TEAM_20' | 'TEAM_50' | 'TEAM_100'

interface RoleDef {
  id: string
  label: string
  count: number          // how many of this role in preset
  humanCostPerMonth: number
  aiCostPerMonth: number
  coverage: number       // coverage hours per month (human=160, AI=720)
  isAI: boolean          // toggleable at runtime
}

export interface SimStats {
  humanCount: number
  aiCount: number
  totalCostPerMonth: number
  coveragePercent: number  // 0–100
  preset: SimPreset
}

type PresetRoles = Record<SimPreset, RoleDef[]>

const PRESET_ROLES: PresetRoles = {
  SOLO: [
    { id: 'owner',      label: 'Owner',       count: 1, humanCostPerMonth: 8000, aiCostPerMonth: 200,  coverage: 160, isAI: false },
    { id: 'estimator',  label: 'Estimator',   count: 1, humanCostPerMonth: 6000, aiCostPerMonth: 150,  coverage: 160, isAI: false },
    { id: 'field_sup',  label: 'Field Super', count: 1, humanCostPerMonth: 7000, aiCostPerMonth: 0,    coverage: 160, isAI: false },
  ],
  TEAM_5: [
    { id: 'owner',      label: 'Owner',       count: 1, humanCostPerMonth: 8000,  aiCostPerMonth: 200,  coverage: 160, isAI: false },
    { id: 'estimator',  label: 'Estimator',   count: 1, humanCostPerMonth: 6000,  aiCostPerMonth: 150,  coverage: 160, isAI: false },
    { id: 'pm',         label: 'Proj Mgr',    count: 1, humanCostPerMonth: 7500,  aiCostPerMonth: 180,  coverage: 160, isAI: false },
    { id: 'electrician',label: 'Electrician', count: 2, humanCostPerMonth: 5500,  aiCostPerMonth: 0,    coverage: 160, isAI: false },
  ],
  TEAM_20: [
    { id: 'owner',      label: 'Owner',       count: 1,  humanCostPerMonth: 8000,  aiCostPerMonth: 200,  coverage: 160, isAI: false },
    { id: 'estimator',  label: 'Estimator',   count: 2,  humanCostPerMonth: 6000,  aiCostPerMonth: 150,  coverage: 160, isAI: false },
    { id: 'pm',         label: 'Proj Mgr',    count: 2,  humanCostPerMonth: 7500,  aiCostPerMonth: 180,  coverage: 160, isAI: false },
    { id: 'field_sup',  label: 'Field Super', count: 2,  humanCostPerMonth: 7000,  aiCostPerMonth: 0,    coverage: 160, isAI: false },
    { id: 'electrician',label: 'Electrician', count: 8,  humanCostPerMonth: 5500,  aiCostPerMonth: 0,    coverage: 160, isAI: false },
    { id: 'apprentice', label: 'Apprentice',  count: 3,  humanCostPerMonth: 3800,  aiCostPerMonth: 0,    coverage: 160, isAI: false },
    { id: 'admin',      label: 'Admin',       count: 2,  humanCostPerMonth: 4500,  aiCostPerMonth: 120,  coverage: 160, isAI: false },
  ],
  TEAM_50: [
    { id: 'owner',      label: 'Owner',       count: 1,  humanCostPerMonth: 12000, aiCostPerMonth: 200,  coverage: 160, isAI: false },
    { id: 'coo',        label: 'COO',         count: 1,  humanCostPerMonth: 10000, aiCostPerMonth: 250,  coverage: 160, isAI: false },
    { id: 'estimator',  label: 'Estimator',   count: 4,  humanCostPerMonth: 6000,  aiCostPerMonth: 150,  coverage: 160, isAI: false },
    { id: 'pm',         label: 'Proj Mgr',    count: 5,  humanCostPerMonth: 7500,  aiCostPerMonth: 180,  coverage: 160, isAI: false },
    { id: 'field_sup',  label: 'Field Super', count: 5,  humanCostPerMonth: 7000,  aiCostPerMonth: 0,    coverage: 160, isAI: false },
    { id: 'electrician',label: 'Electrician', count: 20, humanCostPerMonth: 5500,  aiCostPerMonth: 0,    coverage: 160, isAI: false },
    { id: 'apprentice', label: 'Apprentice',  count: 8,  humanCostPerMonth: 3800,  aiCostPerMonth: 0,    coverage: 160, isAI: false },
    { id: 'admin',      label: 'Admin',       count: 4,  humanCostPerMonth: 4500,  aiCostPerMonth: 120,  coverage: 160, isAI: false },
    { id: 'scheduler',  label: 'Scheduler',   count: 2,  humanCostPerMonth: 5000,  aiCostPerMonth: 100,  coverage: 160, isAI: false },
  ],
  TEAM_100: [
    { id: 'owner',        label: 'Owner',         count: 1,  humanCostPerMonth: 15000, aiCostPerMonth: 200,  coverage: 160, isAI: false },
    { id: 'coo',          label: 'COO',           count: 1,  humanCostPerMonth: 12000, aiCostPerMonth: 250,  coverage: 160, isAI: false },
    { id: 'cfo',          label: 'CFO',           count: 1,  humanCostPerMonth: 12000, aiCostPerMonth: 300,  coverage: 160, isAI: false },
    { id: 'estimator',    label: 'Estimator',     count: 8,  humanCostPerMonth: 6000,  aiCostPerMonth: 150,  coverage: 160, isAI: false },
    { id: 'pm',           label: 'Proj Mgr',      count: 10, humanCostPerMonth: 7500,  aiCostPerMonth: 180,  coverage: 160, isAI: false },
    { id: 'field_sup',    label: 'Field Super',   count: 10, humanCostPerMonth: 7000,  aiCostPerMonth: 0,    coverage: 160, isAI: false },
    { id: 'electrician',  label: 'Electrician',   count: 40, humanCostPerMonth: 5500,  aiCostPerMonth: 0,    coverage: 160, isAI: false },
    { id: 'apprentice',   label: 'Apprentice',    count: 15, humanCostPerMonth: 3800,  aiCostPerMonth: 0,    coverage: 160, isAI: false },
    { id: 'admin',        label: 'Admin',         count: 8,  humanCostPerMonth: 4500,  aiCostPerMonth: 120,  coverage: 160, isAI: false },
    { id: 'scheduler',    label: 'Scheduler',     count: 4,  humanCostPerMonth: 5000,  aiCostPerMonth: 100,  coverage: 160, isAI: false },
    { id: 'safety',       label: 'Safety Officer',count: 2,  humanCostPerMonth: 6500,  aiCostPerMonth: 80,   coverage: 160, isAI: false },
  ],
}

// ── SimulationLayerManager ────────────────────────────────────────────────────

export class SimulationLayerManager {
  private scene: THREE.Scene
  private group: THREE.Group
  private roleStates: Map<string, boolean>  // roleId → isAI
  private roleMeshes: Map<string, THREE.Mesh[]>
  private aiOrbMeshes: THREE.Mesh[]
  private bottleneckLights: THREE.PointLight[]
  private currentPreset: SimPreset
  private roles: RoleDef[]
  private frameHandle = 0
  private clock = new THREE.Clock()

  // Materials
  private humanMat: THREE.MeshStandardMaterial
  private aiMat: THREE.MeshStandardMaterial
  private aiWireMat: THREE.MeshBasicMaterial
  private orbMat: THREE.MeshStandardMaterial

  constructor(scene: THREE.Scene) {
    this.scene = scene
    this.group = new THREE.Group()
    this.group.visible = false
    scene.add(this.group)

    this.roleStates = new Map()
    this.roleMeshes = new Map()
    this.aiOrbMeshes = []
    this.bottleneckLights = []
    this.currentPreset = 'SOLO'
    this.roles = []

    // Shared materials
    this.humanMat = new THREE.MeshStandardMaterial({
      color: 0xffa040,   // amber
      emissive: 0x7a3010,
      emissiveIntensity: 0.4,
      roughness: 0.4,
      metalness: 0.5,
    })
    this.aiMat = new THREE.MeshStandardMaterial({
      color: 0x00e5cc,   // teal
      emissive: 0x008866,
      emissiveIntensity: 0.5,
      roughness: 0.2,
      metalness: 0.7,
      wireframe: false,
    })
    this.aiWireMat = new THREE.MeshBasicMaterial({
      color: 0x00e5cc,
      wireframe: true,
    })
    this.orbMat = new THREE.MeshStandardMaterial({
      color: 0x00ffcc,
      emissive: 0x00cc88,
      emissiveIntensity: 2.0,
      roughness: 0.05,
      metalness: 0.2,
    })

    this.loadPreset('SOLO')
  }

  setVisible(v: boolean) {
    this.group.visible = v
    if (v) this.startAnimation()
    else this.stopAnimation()
  }

  loadPreset(preset: SimPreset) {
    this.currentPreset = preset
    // Deep clone so toggle state is per-load
    this.roles = PRESET_ROLES[preset].map(r => ({ ...r }))
    this.roleStates.clear()
    this.roles.forEach(r => this.roleStates.set(r.id, r.isAI))
    this.rebuild()
    this.dispatchStats()
  }

  toggleRole(roleId: string) {
    const current = this.roleStates.get(roleId) ?? false
    const next = !current
    this.roleStates.set(roleId, next)
    const role = this.roles.find(r => r.id === roleId)
    if (role) role.isAI = next

    // Update mesh colors for this role
    const meshes = this.roleMeshes.get(roleId) ?? []
    meshes.forEach(m => {
      if (next) {
        m.material = this.aiMat
      } else {
        m.material = this.humanMat
      }
    })

    window.dispatchEvent(new CustomEvent('nw:sim-role-toggled', {
      detail: { roleId, isAI: next }
    }))
    this.dispatchStats()
  }

  getAggregateStats(): SimStats {
    let humanCount = 0
    let aiCount = 0
    let totalCost = 0
    let totalCoverageHours = 0
    let maxCoverageHours = 0

    this.roles.forEach(role => {
      const isAI = this.roleStates.get(role.id) ?? false
      const n = role.count
      if (isAI) {
        aiCount += n
        totalCost += role.aiCostPerMonth * n
        totalCoverageHours += 720 * n   // AI = 24/7 = ~720 hrs/month
      } else {
        humanCount += n
        totalCost += role.humanCostPerMonth * n
        totalCoverageHours += role.coverage * n
      }
      maxCoverageHours += 720 * n  // max if all AI
    })

    const coveragePercent = maxCoverageHours > 0
      ? Math.round((totalCoverageHours / maxCoverageHours) * 100)
      : 0

    return {
      humanCount,
      aiCount,
      totalCostPerMonth: Math.round(totalCost),
      coveragePercent,
      preset: this.currentPreset,
    }
  }

  getRoles(): RoleDef[] {
    return this.roles.map(r => ({
      ...r,
      isAI: this.roleStates.get(r.id) ?? r.isAI,
    }))
  }

  private dispatchStats() {
    window.dispatchEvent(new CustomEvent('nw:sim-stats', {
      detail: this.getAggregateStats()
    }))
  }

  private clearGroup() {
    while (this.group.children.length > 0) {
      const child = this.group.children[0]
      this.group.remove(child)
      if (child instanceof THREE.Mesh) {
        if (child.geometry) child.geometry.dispose()
      } else if (child instanceof THREE.PointLight) {
        // lights don't need dispose
      }
    }
    this.roleMeshes.clear()
    this.aiOrbMeshes = []
    this.bottleneckLights = []
  }

  private rebuild() {
    this.clearGroup()

    const preset = this.currentPreset
    const CENTER_X = -60   // west continent: enterprise simulation zone
    const CENTER_Z = -30

    if (preset === 'SOLO') {
      this.buildSolo(CENTER_X, CENTER_Z)
    } else if (preset === 'TEAM_5') {
      this.buildTeam(CENTER_X, CENTER_Z, 5)
    } else if (preset === 'TEAM_20') {
      this.buildTeam(CENTER_X, CENTER_Z, 20)
    } else if (preset === 'TEAM_50') {
      this.buildTeam(CENTER_X, CENTER_Z, 50)
    } else if (preset === 'TEAM_100') {
      this.buildEnterpriseBuilding(CENTER_X, CENTER_Z)
    }
  }

  private buildSolo(cx: number, cz: number) {
    // Single role pyramid — 3 roles stacked
    const geo = new THREE.BoxGeometry(1.5, 1.5, 1.5)
    const yPositions = [2, 4, 6]
    this.roles.forEach((role, i) => {
      const isAI = this.roleStates.get(role.id) ?? false
      const mat = isAI ? this.aiMat : this.humanMat
      const mesh = new THREE.Mesh(geo.clone(), mat)
      mesh.position.set(cx, yPositions[i] ?? 2, cz)
      this.group.add(mesh)
      const existing = this.roleMeshes.get(role.id) ?? []
      existing.push(mesh)
      this.roleMeshes.set(role.id, existing)
    })

    // SOLO bottleneck red light
    const light = new THREE.PointLight(0xff3300, 1.5, 20)
    light.position.set(cx, 8, cz)
    this.group.add(light)
    this.bottleneckLights.push(light)

    // Label post
    this.addLabelPost(cx, 1, cz, 'SOLO OPS')
  }

  private buildTeam(cx: number, cz: number, size: number) {
    // Org pyramid: roles arranged in a diamond pattern
    const cols = Math.ceil(Math.sqrt(size))
    const geo = new THREE.BoxGeometry(1.2, 1.2, 1.2)
    let roleIdx = 0
    this.roles.forEach((role) => {
      const n = role.count
      const isAI = this.roleStates.get(role.id) ?? false
      const mat = isAI ? this.aiMat : this.humanMat
      const meshes: THREE.Mesh[] = []
      for (let j = 0; j < n; j++) {
        const col = (roleIdx + j) % cols
        const row = Math.floor((roleIdx + j) / cols)
        const x = cx + (col - cols / 2) * 3
        const z = cz + (row - this.roles.length / 2) * 3
        const y = 1.5 + row * 0.3
        const mesh = new THREE.Mesh(geo.clone(), mat)
        mesh.position.set(x, y, z)
        this.group.add(mesh)
        meshes.push(mesh)
      }
      roleIdx += n
      const existing = this.roleMeshes.get(role.id) ?? []
      this.roleMeshes.set(role.id, [...existing, ...meshes])

      // AI orbs for AI roles
      if (isAI) {
        meshes.forEach(m => this.addAIOrb(m.position.x, m.position.y + 1.5, m.position.z))
      }
    })
  }

  private buildEnterpriseBuilding(cx: number, cz: number) {
    // TEAM_100: multi-floor building with stacked floor plates
    const floors = 6
    const floorH = 4
    const floorGeo = new THREE.BoxGeometry(18, 0.4, 14)
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x0a0a22, roughness: 0.8 })

    for (let f = 0; f < floors; f++) {
      const floorMesh = new THREE.Mesh(floorGeo.clone(), floorMat)
      floorMesh.position.set(cx, f * floorH, cz)
      this.group.add(floorMesh)
    }

    // Distribute roles across floors
    let roleIdx = 0
    this.roles.forEach((role) => {
      const n = role.count
      const isAI = this.roleStates.get(role.id) ?? false
      const mat = isAI ? this.aiMat : this.humanMat
      const geo = new THREE.BoxGeometry(1.0, 1.0, 1.0)
      const meshes: THREE.Mesh[] = []
      for (let j = 0; j < n; j++) {
        const floor = (roleIdx + j) % floors
        const slotInFloor = Math.floor((roleIdx + j) / floors)
        const cols = 8
        const col = slotInFloor % cols
        const row2 = Math.floor(slotInFloor / cols)
        const x = cx - 7 + col * 2
        const y = floor * floorH + 1.2
        const z = cz - 5 + row2 * 2.5
        const mesh = new THREE.Mesh(geo.clone(), mat)
        mesh.position.set(x, y, z)
        this.group.add(mesh)
        meshes.push(mesh)
        if (isAI) this.addAIOrb(x, y + 1.2, z)
      }
      roleIdx += n
      const existing = this.roleMeshes.get(role.id) ?? []
      this.roleMeshes.set(role.id, [...existing, ...meshes])
    })

    // Coverage bars: 8hr (human) vs 24/7 (AI) - vertical bars beside building
    this.addCoverageBars(cx + 11, cz)
  }

  private addAIOrb(x: number, y: number, z: number) {
    const geo = new THREE.SphereGeometry(0.35, 10, 8)
    const orb = new THREE.Mesh(geo, this.orbMat.clone())
    orb.position.set(x, y, z)
    this.group.add(orb)
    this.aiOrbMeshes.push(orb)
  }

  private addLabelPost(x: number, y: number, z: number, _label: string) {
    // Vertical pole to mark position
    const geo = new THREE.CylinderGeometry(0.08, 0.08, 3, 6)
    const mat = new THREE.MeshStandardMaterial({ color: 0x00e5cc, emissive: 0x007766, emissiveIntensity: 0.5 })
    const pole = new THREE.Mesh(geo, mat)
    pole.position.set(x, y + 1.5, z)
    this.group.add(pole)
  }

  private addCoverageBars(x: number, z: number) {
    // Blue bar = 24/7 coverage height 6, amber = 8hr coverage height ~1.78
    const fullH = 6
    const humanH = fullH * (160 / 720)  // ~1.33
    const barGeo1 = new THREE.BoxGeometry(0.8, fullH, 0.8)
    const barGeo2 = new THREE.BoxGeometry(0.8, humanH, 0.8)
    const aiBarMat = new THREE.MeshStandardMaterial({ color: 0x00e5cc, emissive: 0x005544, emissiveIntensity: 0.6, transparent: true, opacity: 0.8 })
    const huBarMat = new THREE.MeshStandardMaterial({ color: 0xffa040, emissive: 0x7a3010, emissiveIntensity: 0.4, transparent: true, opacity: 0.8 })
    const aiBar = new THREE.Mesh(barGeo1, aiBarMat)
    aiBar.position.set(x, fullH / 2, z)
    this.group.add(aiBar)
    const huBar = new THREE.Mesh(barGeo2, huBarMat)
    huBar.position.set(x + 1.5, humanH / 2, z)
    this.group.add(huBar)
  }

  private startAnimation() {
    const animate = () => {
      const t = this.clock.getElapsedTime()
      // Animate AI orbs: hover bob + slow rotation
      this.aiOrbMeshes.forEach((orb, i) => {
        orb.position.y += Math.sin(t * 2 + i * 0.7) * 0.003
        orb.rotation.y = t * 0.5 + i * 0.3
      })
      // Animate bottleneck lights: flicker
      this.bottleneckLights.forEach((light, i) => {
        light.intensity = 1.5 + Math.sin(t * 3 + i) * 0.5
      })
      this.frameHandle = requestAnimationFrame(animate)
    }
    this.frameHandle = requestAnimationFrame(animate)
  }

  private stopAnimation() {
    if (this.frameHandle) cancelAnimationFrame(this.frameHandle)
  }

  dispose() {
    this.stopAnimation()
    this.clearGroup()
    this.scene.remove(this.group)
    this.humanMat.dispose()
    this.aiMat.dispose()
    this.aiWireMat.dispose()
    this.orbMat.dispose()
  }
}

// ── SimulationLayer component ─────────────────────────────────────────────────

interface SimulationLayerProps {
  visible: boolean
  preset?: SimPreset
}

// Global manager singleton (shared between component and SimulationHUD)
let _simManager: SimulationLayerManager | null = null

export function getSimulationManager(): SimulationLayerManager | null {
  return _simManager
}

export function SimulationLayer({ visible, preset = 'SOLO' }: SimulationLayerProps) {
  const { scene } = useWorldContext()
  const managerRef = useRef<SimulationLayerManager | null>(null)

  useEffect(() => {
    const mgr = new SimulationLayerManager(scene)
    managerRef.current = mgr
    _simManager = mgr
    mgr.loadPreset(preset)
    return () => {
      mgr.dispose()
      if (_simManager === mgr) _simManager = null
    }
  }, [scene]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    managerRef.current?.setVisible(visible)
  }, [visible])

  useEffect(() => {
    managerRef.current?.loadPreset(preset)
  }, [preset])

  return null
}
