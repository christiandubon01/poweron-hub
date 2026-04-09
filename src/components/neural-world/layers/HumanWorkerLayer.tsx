/**
 * HumanWorkerLayer.tsx — NW28b: Human worker amber orbs alongside AI agent teal orbs.
 *
 * Features:
 *   - Ground-level amber orbs per simulation preset (SOLO → TEAM_100)
 *   - Each role assigned a home domain on the West Continent
 *   - Workers walk from home domain to task nodes and back
 *   - Manager orbs: larger, crown marker, patrol/observe behavior
 *   - Click any worker → HUD-style toggle panel (bottom of screen, near orb)
 *   - AI vs Human toggle: amber dissolves, teal fades in at same position
 *   - SHOW REVENUE CHAIN button (HUD bottom-right)
 *   - East Continent developer orbs for PowerOn Hub feature buildings
 *   - Real employee data from nw:crew-members event
 */

import React, { useEffect, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import { useWorldContext } from '../WorldContext'
import { HumanWorkerOrbInstance, type HumanWorkerConfig } from '../HumanWorkerOrb'

// ── Domain positions (mirroring AgentFlightLayer domain coords) ───────────────

const DOMAIN_POS: Record<string, { x: number; z: number }> = {
  'lead-acquisition':     { x: -175, z: -120 },
  'closing':              { x: -150, z:   60 },
  'project-installation': { x: -130, z:  -70 },
  'compliance':           { x: -165, z: -110 },
  'material-takeoff':     { x: -172, z:   90 },
  'progress-tracking':    { x: -105, z:    0 },
  'revenue':              { x:  -35, z:   25 },
  // East continent feature buildings
  'feature-dashboard':    { x:   80, z:  -80 },
  'feature-agents':       { x:  100, z:  -40 },
  'feature-estimating':   { x:  120, z:   20 },
  'feature-fieldlogs':    { x:  140, z:   60 },
  'feature-neural':       { x:  160, z: -100 },
  'feature-voice':        { x:  180, z:   40 },
}

// ── Task nodes workers walk to ────────────────────────────────────────────────

const TASK_NODES: THREE.Vector3[] = [
  new THREE.Vector3(-110, 1,  20),
  new THREE.Vector3(-140, 1, -30),
  new THREE.Vector3( -90, 1, -50),
  new THREE.Vector3( -60, 1,  40),
  new THREE.Vector3(-120, 1,  60),
  new THREE.Vector3(-150, 1, -80),
  new THREE.Vector3(-100, 1,  80),
  new THREE.Vector3(-170, 1,  10),
]

// ── East continent feature nodes ──────────────────────────────────────────────

const EAST_TASK_NODES: THREE.Vector3[] = [
  new THREE.Vector3(  80, 1, -80),
  new THREE.Vector3( 100, 1, -40),
  new THREE.Vector3( 120, 1,  20),
  new THREE.Vector3( 140, 1,  60),
  new THREE.Vector3( 160, 1, -100),
  new THREE.Vector3( 180, 1,  40),
]

// ── Worker role definitions per preset ───────────────────────────────────────

interface WorkerDef {
  id: string
  name: string
  role: string
  homeDomainId: string
  isManager: boolean
  radiusMul: number          // 1.0 = normal, 1.25 = manager
  shiftStartHour: number
  salaryEstimate: number
  hoursPerWeek: number
}

type PresetKey = 'SOLO' | 'TEAM_5' | 'TEAM_20' | 'TEAM_50' | 'TEAM_100'

const PRESET_WORKERS: Record<PresetKey, WorkerDef[]> = {
  SOLO: [
    { id: 'owner', name: 'Owner', role: 'Owner', homeDomainId: 'closing', isManager: false, radiusMul: 1.0, shiftStartHour: 7, salaryEstimate: 96000, hoursPerWeek: 60 },
  ],
  TEAM_5: [
    { id: 'owner',      name: 'Owner',            role: 'Owner',            homeDomainId: 'closing',              isManager: true,  radiusMul: 1.25, shiftStartHour: 7,  salaryEstimate: 96000, hoursPerWeek: 60 },
    { id: 'lead-elec',  name: 'Lead Electrician', role: 'Lead Electrician', homeDomainId: 'project-installation', isManager: false, radiusMul: 1.0,  shiftStartHour: 6,  salaryEstimate: 72000, hoursPerWeek: 40 },
    { id: 'apprentice', name: 'Apprentice',        role: 'Apprentice',       homeDomainId: 'project-installation', isManager: false, radiusMul: 0.8,  shiftStartHour: 6,  salaryEstimate: 42000, hoursPerWeek: 40 },
    { id: 'admin',      name: 'Office Admin',      role: 'Office Admin',     homeDomainId: 'revenue',              isManager: false, radiusMul: 0.9,  shiftStartHour: 8,  salaryEstimate: 52000, hoursPerWeek: 40 },
    { id: 'estimator',  name: 'Estimator',         role: 'Estimator',        homeDomainId: 'closing',              isManager: false, radiusMul: 1.0,  shiftStartHour: 8,  salaryEstimate: 70000, hoursPerWeek: 40 },
  ],
  TEAM_20: [
    { id: 'exec',       name: 'Executive',         role: 'Executive',        homeDomainId: 'closing',              isManager: true,  radiusMul: 1.3,  shiftStartHour: 7,  salaryEstimate: 120000,hoursPerWeek: 50 },
    { id: 'mgr1',       name: 'Ops Manager',       role: 'Ops Manager',      homeDomainId: 'progress-tracking',    isManager: true,  radiusMul: 1.2,  shiftStartHour: 7,  salaryEstimate: 90000, hoursPerWeek: 45 },
    { id: 'mgr2',       name: 'Field Manager',     role: 'Field Manager',    homeDomainId: 'project-installation', isManager: true,  radiusMul: 1.2,  shiftStartHour: 6,  salaryEstimate: 88000, hoursPerWeek: 45 },
    { id: 'sup1',       name: 'Supervisor A',      role: 'Supervisor',       homeDomainId: 'project-installation', isManager: true,  radiusMul: 1.1,  shiftStartHour: 6,  salaryEstimate: 80000, hoursPerWeek: 45 },
    { id: 'sup2',       name: 'Supervisor B',      role: 'Supervisor',       homeDomainId: 'compliance',           isManager: true,  radiusMul: 1.1,  shiftStartHour: 6,  salaryEstimate: 80000, hoursPerWeek: 45 },
    { id: 'elec1',      name: 'Electrician A',     role: 'Electrician',      homeDomainId: 'project-installation', isManager: false, radiusMul: 1.0,  shiftStartHour: 6,  salaryEstimate: 66000, hoursPerWeek: 40 },
    { id: 'elec2',      name: 'Electrician B',     role: 'Electrician',      homeDomainId: 'project-installation', isManager: false, radiusMul: 1.0,  shiftStartHour: 6,  salaryEstimate: 66000, hoursPerWeek: 40 },
    { id: 'elec3',      name: 'Electrician C',     role: 'Electrician',      homeDomainId: 'project-installation', isManager: false, radiusMul: 1.0,  shiftStartHour: 6,  salaryEstimate: 66000, hoursPerWeek: 40 },
    { id: 'appr1',      name: 'Apprentice A',      role: 'Apprentice',       homeDomainId: 'project-installation', isManager: false, radiusMul: 0.8,  shiftStartHour: 6,  salaryEstimate: 42000, hoursPerWeek: 40 },
    { id: 'appr2',      name: 'Apprentice B',      role: 'Apprentice',       homeDomainId: 'project-installation', isManager: false, radiusMul: 0.8,  shiftStartHour: 6,  salaryEstimate: 42000, hoursPerWeek: 40 },
    { id: 'admin1',     name: 'Office Admin',      role: 'Office Admin',     homeDomainId: 'revenue',              isManager: false, radiusMul: 0.9,  shiftStartHour: 8,  salaryEstimate: 52000, hoursPerWeek: 40 },
    { id: 'admin2',     name: 'Admin Assistant',   role: 'Admin Asst',       homeDomainId: 'revenue',              isManager: false, radiusMul: 0.9,  shiftStartHour: 8,  salaryEstimate: 46000, hoursPerWeek: 40 },
    { id: 'est1',       name: 'Estimator A',       role: 'Estimator',        homeDomainId: 'closing',              isManager: false, radiusMul: 1.0,  shiftStartHour: 7,  salaryEstimate: 70000, hoursPerWeek: 40 },
    { id: 'est2',       name: 'Estimator B',       role: 'Estimator',        homeDomainId: 'closing',              isManager: false, radiusMul: 1.0,  shiftStartHour: 7,  salaryEstimate: 70000, hoursPerWeek: 40 },
    { id: 'elec4',      name: 'Electrician D',     role: 'Electrician',      homeDomainId: 'project-installation', isManager: false, radiusMul: 1.0,  shiftStartHour: 6,  salaryEstimate: 66000, hoursPerWeek: 40 },
    { id: 'elec5',      name: 'Electrician E',     role: 'Electrician',      homeDomainId: 'project-installation', isManager: false, radiusMul: 1.0,  shiftStartHour: 6,  salaryEstimate: 66000, hoursPerWeek: 40 },
    { id: 'elec6',      name: 'Electrician F',     role: 'Electrician',      homeDomainId: 'project-installation', isManager: false, radiusMul: 1.0,  shiftStartHour: 14, salaryEstimate: 66000, hoursPerWeek: 40 },
    { id: 'appr3',      name: 'Apprentice C',      role: 'Apprentice',       homeDomainId: 'project-installation', isManager: false, radiusMul: 0.8,  shiftStartHour: 14, salaryEstimate: 42000, hoursPerWeek: 40 },
    { id: 'sched',      name: 'Scheduler',         role: 'Scheduler',        homeDomainId: 'progress-tracking',    isManager: false, radiusMul: 0.9,  shiftStartHour: 8,  salaryEstimate: 56000, hoursPerWeek: 40 },
  ],
  TEAM_50: [
    { id: 'ceo',   name: 'CEO',         role: 'C-Suite',    homeDomainId: 'closing',           isManager: true, radiusMul: 1.4, shiftStartHour: 8, salaryEstimate: 150000, hoursPerWeek: 50 },
    { id: 'coo',   name: 'COO',         role: 'C-Suite',    homeDomainId: 'progress-tracking', isManager: true, radiusMul: 1.3, shiftStartHour: 8, salaryEstimate: 130000, hoursPerWeek: 50 },
    { id: 'cfo',   name: 'CFO',         role: 'C-Suite',    homeDomainId: 'revenue',           isManager: true, radiusMul: 1.3, shiftStartHour: 8, salaryEstimate: 130000, hoursPerWeek: 50 },
    ...Array.from({ length: 6 }, (_, i) => ({
      id: `dir${i}`, name: `Director ${String.fromCharCode(65 + i)}`, role: 'Director',
      homeDomainId: ['closing','project-installation','compliance','revenue','material-takeoff','progress-tracking'][i % 6],
      isManager: true, radiusMul: 1.2, shiftStartHour: 7, salaryEstimate: 100000, hoursPerWeek: 45,
    })),
    ...Array.from({ length: 11 }, (_, i) => ({
      id: `mgr${i}`, name: `Manager ${i + 1}`, role: 'Manager',
      homeDomainId: ['project-installation','closing','compliance','revenue','progress-tracking','material-takeoff','project-installation','closing','compliance','revenue','progress-tracking'][i],
      isManager: true, radiusMul: 1.1, shiftStartHour: i < 6 ? 6 : 14, salaryEstimate: 85000, hoursPerWeek: 45,
    })),
    ...Array.from({ length: 10 }, (_, i) => ({
      id: `lead${i}`, name: `Lead ${i + 1}`, role: 'Lead',
      homeDomainId: i % 2 === 0 ? 'project-installation' : 'compliance',
      isManager: false, radiusMul: 1.0, shiftStartHour: i < 5 ? 6 : 14, salaryEstimate: 75000, hoursPerWeek: 40,
    })),
    ...Array.from({ length: 20 }, (_, i) => ({
      id: `staff${i}`, name: `Staff ${i + 1}`, role: i < 10 ? 'Electrician' : 'Admin',
      homeDomainId: i < 10 ? 'project-installation' : 'revenue',
      isManager: false, radiusMul: i < 10 ? 1.0 : 0.9, shiftStartHour: i < 10 ? (i < 5 ? 6 : 14) : 8, salaryEstimate: i < 10 ? 66000 : 50000, hoursPerWeek: 40,
    })),
  ],
  TEAM_100: [
    { id: 'ceo',  name: 'CEO',  role: 'C-Suite', homeDomainId: 'closing',           isManager: true, radiusMul: 1.5, shiftStartHour: 8, salaryEstimate: 180000, hoursPerWeek: 50 },
    { id: 'coo',  name: 'COO',  role: 'C-Suite', homeDomainId: 'progress-tracking', isManager: true, radiusMul: 1.4, shiftStartHour: 8, salaryEstimate: 150000, hoursPerWeek: 50 },
    { id: 'cfo',  name: 'CFO',  role: 'C-Suite', homeDomainId: 'revenue',           isManager: true, radiusMul: 1.4, shiftStartHour: 8, salaryEstimate: 150000, hoursPerWeek: 50 },
    ...Array.from({ length: 6 }, (_, i) => ({
      id: `dir${i}`, name: `Director ${String.fromCharCode(65 + i)}`, role: 'Director',
      homeDomainId: ['closing','project-installation','compliance','revenue','material-takeoff','progress-tracking'][i % 6],
      isManager: true, radiusMul: 1.2, shiftStartHour: 7, salaryEstimate: 110000, hoursPerWeek: 45,
    })),
    ...Array.from({ length: 11 }, (_, i) => ({
      id: `mgr${i}`, name: `Manager ${i + 1}`, role: 'Manager',
      homeDomainId: ['project-installation','closing','compliance','revenue','progress-tracking','material-takeoff','project-installation','closing','compliance','revenue','progress-tracking'][i],
      isManager: true, radiusMul: 1.1, shiftStartHour: i < 6 ? 6 : 14, salaryEstimate: 90000, hoursPerWeek: 45,
    })),
    ...Array.from({ length: 10 }, (_, i) => ({
      id: `lead${i}`, name: `Lead Elec ${i + 1}`, role: 'Lead Electrician',
      homeDomainId: i % 2 === 0 ? 'project-installation' : 'compliance',
      isManager: false, radiusMul: 1.0, shiftStartHour: i < 5 ? 6 : 14, salaryEstimate: 78000, hoursPerWeek: 40,
    })),
    ...Array.from({ length: 40 }, (_, i) => ({
      id: `elec${i}`, name: `Electrician ${i + 1}`, role: 'Electrician',
      homeDomainId: 'project-installation',
      isManager: false, radiusMul: 1.0, shiftStartHour: i < 20 ? 6 : 14, salaryEstimate: 66000, hoursPerWeek: 40,
    })),
    ...Array.from({ length: 15 }, (_, i) => ({
      id: `appr${i}`, name: `Apprentice ${i + 1}`, role: 'Apprentice',
      homeDomainId: 'project-installation',
      isManager: false, radiusMul: 0.8, shiftStartHour: i < 8 ? 6 : 14, salaryEstimate: 42000, hoursPerWeek: 40,
    })),
    ...Array.from({ length: 8 }, (_, i) => ({
      id: `admin${i}`, name: `Admin ${i + 1}`, role: 'Admin',
      homeDomainId: 'revenue',
      isManager: false, radiusMul: 0.9, shiftStartHour: 8, salaryEstimate: 50000, hoursPerWeek: 40,
    })),
    ...Array.from({ length: 4 }, (_, i) => ({
      id: `sched${i}`, name: `Scheduler ${i + 1}`, role: 'Scheduler',
      homeDomainId: 'progress-tracking',
      isManager: false, radiusMul: 0.9, shiftStartHour: 8, salaryEstimate: 56000, hoursPerWeek: 40,
    })),
    ...Array.from({ length: 2 }, (_, i) => ({
      id: `safety${i}`, name: `Safety ${i + 1}`, role: 'Safety Officer',
      homeDomainId: 'compliance',
      isManager: false, radiusMul: 0.9, shiftStartHour: 6, salaryEstimate: 72000, hoursPerWeek: 40,
    })),
  ],
}

// ── East Continent developer workers ──────────────────────────────────────────

const EAST_DEV_WORKERS: WorkerDef[] = [
  { id: 'dev-frontend', name: 'Frontend Dev', role: 'Developer', homeDomainId: 'feature-dashboard', isManager: false, radiusMul: 1.0, shiftStartHour: 9, salaryEstimate: 90000, hoursPerWeek: 40 },
  { id: 'dev-backend',  name: 'Backend Dev',  role: 'Developer', homeDomainId: 'feature-agents',    isManager: false, radiusMul: 1.0, shiftStartHour: 9, salaryEstimate: 95000, hoursPerWeek: 40 },
  { id: 'dev-fullstack',name: 'Full Stack',   role: 'Developer', homeDomainId: 'feature-estimating',isManager: false, radiusMul: 1.0, shiftStartHour: 9, salaryEstimate: 92000, hoursPerWeek: 40 },
]

// ── Constants ─────────────────────────────────────────────────────────────────

const AMBER           = 0xFF9040
const TASK_INTERVAL   = 20   // seconds between task dispatches
const MANAGER_PATROL_INTERVAL = 8  // seconds between manager moves

// ── HUD panel info ────────────────────────────────────────────────────────────

interface WorkerPanelInfo {
  workerId: string
  name: string
  role: string
  salaryEstimate: number
  hoursPerWeek: number
  tasksToday: number
  isAI: boolean
  screenX: number
  screenY: number
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface HumanWorkerLayerProps {
  visible: boolean
}

// ── Component ─────────────────────────────────────────────────────────────────

export function HumanWorkerLayer({ visible }: HumanWorkerLayerProps) {
  const { scene, camera } = useWorldContext()

  const visibleRef    = useRef(visible)
  const workersRef    = useRef<Map<string, HumanWorkerOrbInstance>>(new Map())
  const devWorkersRef = useRef<Map<string, HumanWorkerOrbInstance>>(new Map())
  const clockRef      = useRef(0)
  const taskTimerRef  = useRef<Map<string, number>>(new Map())
  const managerTimerRef = useRef<Map<string, number>>(new Map())
  const domainIdxRef  = useRef<Map<string, number>>(new Map())
  const taskCountRef  = useRef<Map<string, number>>(new Map())
  const frameRef      = useRef<number | null>(null)

  // React state for HUD panels
  const [workerPanel, setWorkerPanel] = useState<WorkerPanelInfo | null>(null)
  const [revenueChainActive, setRevenueChainActive] = useState(false)
  const [revenueChainStep, setRevenueChainStep] = useState(0)
  const revenueChainRef = useRef<ReturnType<typeof setTimeout>[]>([])

  // Current preset (default SOLO, updated via nw:sim-preset events)
  const presetRef = useRef<PresetKey>('SOLO')

  // Sync visible ref
  useEffect(() => {
    visibleRef.current = visible
  }, [visible])

  // ── Main setup effect ───────────────────────────────────────────────────────
  useEffect(() => {
    function buildWorkers(preset: PresetKey): void {
      // Dispose existing workers
      workersRef.current.forEach(w => w.dispose())
      workersRef.current.clear()
      devWorkersRef.current.forEach(w => w.dispose())
      devWorkersRef.current.clear()
      taskTimerRef.current.clear()
      managerTimerRef.current.clear()
      domainIdxRef.current.clear()
      taskCountRef.current.clear()

      const defs = PRESET_WORKERS[preset] ?? PRESET_WORKERS['SOLO']
      for (const def of defs) {
        const domainPos = DOMAIN_POS[def.homeDomainId] ?? { x: -150, z: 0 }
        const cfg: HumanWorkerConfig = {
          id:                 def.id,
          name:               def.name,
          role:               def.role,
          color:              AMBER,
          radius:             0.8 * def.radiusMul,
          homeX:              domainPos.x + (Math.random() - 0.5) * 10,
          homeZ:              domainPos.z + (Math.random() - 0.5) * 10,
          homeDomainId:       def.homeDomainId,
          isManager:          def.isManager,
          shiftStartHour:     def.shiftStartHour,
          shiftDurationHours: 8,
        }
        const worker = new HumanWorkerOrbInstance(scene, cfg)
        workersRef.current.set(def.id, worker)
        taskTimerRef.current.set(def.id, Math.random() * TASK_INTERVAL)
        if (def.isManager) {
          managerTimerRef.current.set(def.id, Math.random() * MANAGER_PATROL_INTERVAL)
          domainIdxRef.current.set(def.id, 0)
        }
        taskCountRef.current.set(def.id, 0)
      }

      // East continent developer workers
      for (const def of EAST_DEV_WORKERS) {
        const domainPos = DOMAIN_POS[def.homeDomainId] ?? { x: 100, z: 0 }
        const cfg: HumanWorkerConfig = {
          id:                 def.id,
          name:               def.name,
          role:               def.role,
          color:              AMBER,
          radius:             0.8 * def.radiusMul,
          homeX:              domainPos.x + (Math.random() - 0.5) * 8,
          homeZ:              domainPos.z + (Math.random() - 0.5) * 8,
          homeDomainId:       def.homeDomainId,
          isManager:          def.isManager,
          shiftStartHour:     def.shiftStartHour,
          shiftDurationHours: 8,
        }
        const dev = new HumanWorkerOrbInstance(scene, cfg)
        devWorkersRef.current.set(def.id, dev)
        taskTimerRef.current.set(def.id, Math.random() * TASK_INTERVAL)
        taskCountRef.current.set(def.id, 0)
      }
    }

    // Build initial preset
    buildWorkers(presetRef.current)

    // Listen for preset changes from SimulationHUD
    function onPreset(e: Event) {
      const ev = e as CustomEvent<{ preset: PresetKey }>
      if (ev.detail?.preset) {
        presetRef.current = ev.detail.preset
        buildWorkers(ev.detail.preset)
      }
    }
    window.addEventListener('nw:sim-preset', onPreset)

    // Listen for real crew member data
    function onCrewMembers(e: Event) {
      const ev = e as CustomEvent<{ members: Array<{ id: string; name: string; role: string; domain?: string }> }>
      if (!ev.detail?.members?.length) return
      // Override names/domains for existing workers where possible
      for (const m of ev.detail.members) {
        const worker = workersRef.current.get(m.id)
        if (worker) {
          // We can't rename directly on the existing instance — just dispatch to nearest node
          void worker
        }
      }
    }
    window.addEventListener('nw:crew-members', onCrewMembers)

    // ── Animation loop ────────────────────────────────────────────────────
    let lastTime = performance.now() / 1000

    function animate() {
      frameRef.current = requestAnimationFrame(animate)
      const now = performance.now() / 1000
      const dt  = Math.min(now - lastTime, 0.1)
      lastTime  = now
      clockRef.current += dt

      const vis = visibleRef.current

      // ── Tick west continent workers ──────────────────────────────────
      workersRef.current.forEach((worker, id) => {
        worker.visible = vis
        worker.tick(dt, clockRef.current, camera)

        if (!vis) return

        if (worker.state === 'IDLE' && worker.onShift) {
          // Dispatch workers to task nodes
          const t = (taskTimerRef.current.get(id) ?? 0) - dt
          taskTimerRef.current.set(id, t)

          if (t <= 0) {
            const def = (PRESET_WORKERS[presetRef.current] ?? []).find(d => d.id === id)
            const isMgr = def?.isManager ?? false
            taskTimerRef.current.set(id, TASK_INTERVAL + Math.random() * 10)

            if (isMgr) {
              // Manager: walk to next domain observation point
              const domainKeys = Object.keys(DOMAIN_POS)
              const idx = (domainIdxRef.current.get(id) ?? 0) % domainKeys.length
              domainIdxRef.current.set(id, idx + 1)
              const dp = DOMAIN_POS[domainKeys[idx]]
              if (dp) {
                const target = new THREE.Vector3(dp.x + (Math.random()-0.5)*8, 1, dp.z + (Math.random()-0.5)*8)
                worker.queueTask(target)
              }
            } else {
              // Worker: walk to random task node
              const node = TASK_NODES[Math.floor(Math.random() * TASK_NODES.length)]
              if (node) worker.queueTask(node)
              // Increment task count
              const count = (taskCountRef.current.get(id) ?? 0) + 1
              taskCountRef.current.set(id, count)
            }
          }
        }
      })

      // ── Tick east continent developer workers ─────────────────────────
      devWorkersRef.current.forEach((worker, id) => {
        worker.visible = vis
        worker.tick(dt, clockRef.current, camera)

        if (!vis) return

        if (worker.state === 'IDLE' && worker.onShift) {
          const t = (taskTimerRef.current.get(id) ?? 0) - dt
          taskTimerRef.current.set(id, t)
          if (t <= 0) {
            taskTimerRef.current.set(id, 25 + Math.random() * 15)  // sprint cycle ~25–40s
            // Sprint: visit 3-4 feature nodes
            const shuffled = [...EAST_TASK_NODES].sort(() => Math.random() - 0.5)
            const circuit = shuffled.slice(0, 3 + Math.floor(Math.random() * 2))
            for (const node of circuit) {
              worker.queueTask(node)
            }
          }
        }
      })
    }

    animate()

    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      window.removeEventListener('nw:sim-preset', onPreset)
      window.removeEventListener('nw:crew-members', onCrewMembers)
      workersRef.current.forEach(w => w.dispose())
      workersRef.current.clear()
      devWorkersRef.current.forEach(w => w.dispose())
      devWorkersRef.current.clear()
    }
  }, [scene, camera])

  // ── Click detection for worker panel ─────────────────────────────────────
  const handleClick = useCallback((e: MouseEvent) => {
    if (!visibleRef.current) return

    const rect = (e.target as HTMLElement).getBoundingClientRect?.() ?? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    )

    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(mouse, camera)

    // Collect all orb meshes with metadata
    const orbMeshes: Array<{ mesh: THREE.Object3D; id: string; isEast: boolean }> = []
    workersRef.current.forEach((w, id) => {
      w.group.traverse(child => {
        if (child instanceof THREE.Mesh) {
          orbMeshes.push({ mesh: child, id, isEast: false })
        }
      })
    })

    const objects = orbMeshes.map(o => o.mesh)
    const intersects = raycaster.intersectObjects(objects, false)

    if (intersects.length > 0) {
      const hit = intersects[0].object
      const found = orbMeshes.find(o => o.mesh === hit)
      if (found) {
        const def = [...(PRESET_WORKERS[presetRef.current] ?? []), ...EAST_DEV_WORKERS].find(d => d.id === found.id)
        if (def) {
          // Project orb position to screen
          const worldPos = new THREE.Vector3()
          workersRef.current.get(found.id)?.group.getWorldPosition(worldPos)

          const projected = worldPos.clone().project(camera)
          const sx = (projected.x + 1) / 2 * window.innerWidth
          const sy = (1 - (projected.y + 1) / 2) * window.innerHeight

          setWorkerPanel({
            workerId:       found.id,
            name:           def.name,
            role:           def.role,
            salaryEstimate: def.salaryEstimate,
            hoursPerWeek:   def.hoursPerWeek,
            tasksToday:     taskCountRef.current.get(found.id) ?? 0,
            isAI:           false,
            screenX:        sx,
            screenY:        sy,
          })
        }
      }
    } else {
      setWorkerPanel(null)
    }
  }, [camera])

  useEffect(() => {
    window.addEventListener('click', handleClick)
    return () => window.removeEventListener('click', handleClick)
  }, [handleClick])

  // ── Revenue Chain ─────────────────────────────────────────────────────────

  const REVENUE_CHAIN_STEPS = [
    'SPARK (AI) captures lead → Lead Acquisition domain',
    'Receptionist picks up lead → walks to Closing',
    'VAULT delivers estimate cube → Closing',
    'Estimator combines lead + estimate → proposal',
    'Estimator walks proposal to client territory',
    'Contract signed! BLUEPRINT creates project',
    'Lead Electrician works project mountain',
    'OHM collects compliance overhead',
    'Work complete! LEDGER generates invoice',
    'Office Admin collects payment → Revenue river',
    'NEXUS sweeps all domains → Fortress briefing',
  ]

  const startRevenueChain = useCallback(() => {
    if (revenueChainActive) {
      // Stop chain
      revenueChainRef.current.forEach(t => clearTimeout(t))
      revenueChainRef.current = []
      setRevenueChainActive(false)
      setRevenueChainStep(0)
      return
    }
    setRevenueChainActive(true)
    setRevenueChainStep(0)
    // Dispatch event for 3D chain visualization in HandoffChain
    window.dispatchEvent(new CustomEvent('nw:revenue-chain-start'))

    // Step through each stage every ~4 seconds
    REVENUE_CHAIN_STEPS.forEach((_, i) => {
      const t = setTimeout(() => {
        setRevenueChainStep(i + 1)
        window.dispatchEvent(new CustomEvent('nw:revenue-chain-step', { detail: { step: i } }))
        if (i === REVENUE_CHAIN_STEPS.length - 1) {
          // Chain complete
          const t2 = setTimeout(() => {
            setRevenueChainActive(false)
            setRevenueChainStep(0)
            window.dispatchEvent(new CustomEvent('nw:revenue-chain-end'))
          }, 3000)
          revenueChainRef.current.push(t2)
        }
      }, i * 4000)
      revenueChainRef.current.push(t)
    })
  }, [revenueChainActive])

  // ESC to stop revenue chain
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && revenueChainActive) {
        revenueChainRef.current.forEach(t => clearTimeout(t))
        revenueChainRef.current = []
        setRevenueChainActive(false)
        setRevenueChainStep(0)
        window.dispatchEvent(new CustomEvent('nw:revenue-chain-end'))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [revenueChainActive])

  if (!visible) return null

  return (
    <>
      {/* ── Worker toggle panel (HUD-style, near orb, bottom of screen) ─── */}
      {workerPanel && (
        <div
          style={{
            position: 'fixed',
            left:     Math.min(workerPanel.screenX, window.innerWidth - 340),
            top:      Math.max(workerPanel.screenY - 200, window.innerHeight - 260),
            width:    320,
            background: 'rgba(6,6,14,0.88)',
            border:   '1px solid rgba(255,144,64,0.5)',
            borderRadius: 8,
            padding:  16,
            zIndex:   1200,
            backdropFilter: 'blur(8px)',
            fontFamily: 'monospace',
            animation: 'fadeIn 0.2s ease',
            pointerEvents: 'auto',
          }}
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ color: '#FF9040', fontSize: 13, letterSpacing: 1, fontWeight: 700 }}>
              {workerPanel.isAI ? '◉ AI AGENT' : '◉ HUMAN WORKER'}
            </div>
            <button
              onClick={() => setWorkerPanel(null)}
              style={{ background: 'none', border: 'none', color: 'rgba(255,144,64,0.6)', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}
            >×</button>
          </div>

          {/* Worker info */}
          <div style={{ color: '#fff', fontSize: 14, marginBottom: 4 }}>{workerPanel.name}</div>
          <div style={{ color: 'rgba(255,144,64,0.7)', fontSize: 12, marginBottom: 10 }}>{workerPanel.role}</div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 11, color: 'rgba(255,255,255,0.7)', marginBottom: 12 }}>
            <span>Salary Est.</span><span style={{ color: '#FF9040' }}>${(workerPanel.salaryEstimate / 1000).toFixed(0)}k/yr</span>
            <span>Hours/Week</span><span style={{ color: '#FF9040' }}>{workerPanel.hoursPerWeek}h</span>
            <span>Tasks Today</span><span style={{ color: '#FF9040' }}>{workerPanel.tasksToday}</span>
            <span>Coverage</span><span style={{ color: '#FF9040' }}>40h/wk</span>
          </div>

          {/* AI Agent toggle info */}
          {!workerPanel.isAI && (
            <div style={{ borderTop: '1px solid rgba(255,144,64,0.2)', paddingTop: 10 }}>
              <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, marginBottom: 8 }}>
                Replace with AI Agent?
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 11, color: 'rgba(255,255,255,0.7)', marginBottom: 10 }}>
                <span>Agent Cost</span><span style={{ color: '#00E5CC' }}>~$150–300/mo</span>
                <span>Coverage</span><span style={{ color: '#00E5CC' }}>24/7 (720h/mo)</span>
                <span>Task Volume</span><span style={{ color: '#00E5CC' }}>3–5× higher</span>
              </div>
              <button
                onClick={() => {
                  setWorkerPanel(prev => prev ? { ...prev, isAI: true } : null)
                  window.dispatchEvent(new CustomEvent('nw:worker-toggled-ai', { detail: { workerId: workerPanel.workerId } }))
                }}
                style={{
                  width: '100%',
                  background: 'rgba(0,229,204,0.15)',
                  border: '1px solid rgba(0,229,204,0.5)',
                  borderRadius: 4,
                  color: '#00E5CC',
                  padding: '6px 0',
                  cursor: 'pointer',
                  fontSize: 11,
                  letterSpacing: 1,
                }}
              >
                ◉ SWITCH TO AI AGENT
              </button>
            </div>
          )}

          {workerPanel.isAI && (
            <div style={{ borderTop: '1px solid rgba(0,229,204,0.2)', paddingTop: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 11, color: 'rgba(255,255,255,0.7)', marginBottom: 10 }}>
                <span>Agent Name</span><span style={{ color: '#00E5CC' }}>AI-{workerPanel.role.substring(0,4).toUpperCase()}</span>
                <span>Cost/Mo</span><span style={{ color: '#00E5CC' }}>$200/mo</span>
                <span>Coverage</span><span style={{ color: '#00E5CC' }}>24/7</span>
                <span>Tasks Vol.</span><span style={{ color: '#00E5CC' }}>High</span>
              </div>
              <button
                onClick={() => {
                  setWorkerPanel(prev => prev ? { ...prev, isAI: false } : null)
                  window.dispatchEvent(new CustomEvent('nw:worker-toggled-human', { detail: { workerId: workerPanel.workerId } }))
                }}
                style={{
                  width: '100%',
                  background: 'rgba(255,144,64,0.15)',
                  border: '1px solid rgba(255,144,64,0.5)',
                  borderRadius: 4,
                  color: '#FF9040',
                  padding: '6px 0',
                  cursor: 'pointer',
                  fontSize: 11,
                  letterSpacing: 1,
                }}
              >
                ◉ SWITCH TO HUMAN
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Revenue Chain active overlay ──────────────────────────────────── */}
      {revenueChainActive && (
        <div style={{
          position: 'fixed',
          bottom: 80,
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(6,6,14,0.92)',
          border: '1px solid rgba(255,215,0,0.5)',
          borderRadius: 8,
          padding: '12px 20px',
          zIndex: 1150,
          fontFamily: 'monospace',
          minWidth: 420,
          backdropFilter: 'blur(8px)',
          pointerEvents: 'none',
        }}>
          <div style={{ color: '#FFD700', fontSize: 12, letterSpacing: 2, marginBottom: 8 }}>
            ◈ REVENUE CHAIN — STEP {revenueChainStep}/{REVENUE_CHAIN_STEPS.length}
          </div>
          <div style={{ color: '#fff', fontSize: 13 }}>
            {REVENUE_CHAIN_STEPS[revenueChainStep - 1] ?? 'Initializing chain…'}
          </div>
          {/* Progress bar */}
          <div style={{ marginTop: 8, height: 2, background: 'rgba(255,215,0,0.2)', borderRadius: 1 }}>
            <div style={{
              height: '100%',
              width: `${(revenueChainStep / REVENUE_CHAIN_STEPS.length) * 100}%`,
              background: '#FFD700',
              borderRadius: 1,
              transition: 'width 0.4s ease',
            }} />
          </div>
          <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, marginTop: 6, textAlign: 'right' }}>
            ESC to skip
          </div>
        </div>
      )}

      {/* ── SHOW REVENUE CHAIN button (HUD bottom-right) ─────────────────── */}
      <div style={{
        position: 'fixed',
        bottom: 20,
        right: 20,
        zIndex: 1100,
      }}>
        <button
          onClick={startRevenueChain}
          style={{
            background: revenueChainActive ? 'rgba(255,215,0,0.25)' : 'rgba(6,6,14,0.85)',
            border: `1px solid ${revenueChainActive ? 'rgba(255,215,0,0.8)' : 'rgba(255,144,64,0.5)'}`,
            borderRadius: 6,
            color: revenueChainActive ? '#FFD700' : '#FF9040',
            padding: '7px 14px',
            cursor: 'pointer',
            fontSize: 11,
            letterSpacing: 1.5,
            fontFamily: 'monospace',
            backdropFilter: 'blur(8px)',
            transition: 'all 0.2s ease',
          }}
        >
          {revenueChainActive ? '■ STOP CHAIN' : '▶ REVENUE CHAIN'}
        </button>
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </>
  )
}
