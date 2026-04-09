/**
 * HumanWorkerLayer.tsx — B75: Human Workers V2.
 *
 * Upgrades human worker visuals to Katsuro-based humanoid models (AMBER/GOLD),
 * with clock-in/out animations, remote holographic presence, and role badges.
 *
 * Previous version (NW28b) used amber orbs. This version uses 3D humanoid figures
 * that are visually distinct from AI agents (teal, flying, particle trails).
 *
 * HUMAN WORKERS: AMBER/GOLD, walk on ground, gentle bob, role badge, warm glow.
 * AI AGENTS:     TEAL, fly/hover, particle trails, teal glow.
 *
 * Clock-in:  Worker walks in from world edge toward domain (3–4s).
 * Clock-out: Worker walks to nearest world edge and fades out.
 * Remote:    Holographic projection at domain — semi-transparent, scan-line, flicker.
 * Hypothetical: Ghost white wireframe outline.
 *
 * Data sources: crew_assignments + field_logs via DataBridge events.
 * employee_type: 'w2' | '1099' | 'hypothetical'.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import { useWorldContext } from '../WorldContext'
import {
  HumanWorkerModelInstance,
  type HumanWorkerModelConfig,
  type EmployeeType,
  type WorkerPresence,
} from '../HumanWorkerModel'

// ── Domain positions (matching AgentFlightLayer) ──────────────────────────────

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

// ── Project mountain positions (workers walk between these) ───────────────────

const PROJECT_NODES: Array<{ x: number; z: number }> = [
  { x: -110, z:  20 },
  { x: -140, z: -30 },
  { x:  -90, z: -50 },
  { x:  -60, z:  40 },
  { x: -120, z:  60 },
  { x: -150, z: -80 },
  { x: -100, z:  80 },
  { x: -170, z:  10 },
]

const EAST_PROJECT_NODES: Array<{ x: number; z: number }> = [
  { x:  80, z: -80 },
  { x: 100, z: -40 },
  { x: 120, z:  20 },
  { x: 140, z:  60 },
  { x: 160, z: -100 },
  { x: 180, z:  40 },
]

// ── Role → presence mapping ───────────────────────────────────────────────────

function getPresence(role: string): WorkerPresence {
  const r = role.toLowerCase()
  if (r.includes('director') || r.includes('executive') || r.includes('c-suite') ||
      r.includes('ceo') || r.includes('coo') || r.includes('cfo') ||
      r.includes('admin') || r.includes('office') || r.includes('estimator') ||
      r.includes('scheduler') || r.includes('developer')) {
    return 'remote'
  }
  return 'onsite'
}

// ── Role → foreman flag ───────────────────────────────────────────────────────

function getIsForeman(role: string): boolean {
  const r = role.toLowerCase()
  return r.includes('foreman') || r.includes('supervisor') || r.includes('ops manager') ||
         r.includes('field manager') || r.includes('manager') || r.includes('lead electrician')
}

// ── Worker definitions per preset ────────────────────────────────────────────

interface WorkerDef {
  id: string
  name: string
  role: string
  homeDomainId: string
  isManager: boolean
  radiusMul: number
  shiftStartHour: number
  salaryEstimate: number
  hoursPerWeek: number
  employeeType?: EmployeeType
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
    { id: 'admin',      name: 'Office Admin',      role: 'Admin',            homeDomainId: 'revenue',              isManager: false, radiusMul: 0.9,  shiftStartHour: 8,  salaryEstimate: 52000, hoursPerWeek: 40 },
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
    { id: 'admin1',     name: 'Office Admin',      role: 'Admin',            homeDomainId: 'revenue',              isManager: false, radiusMul: 0.9,  shiftStartHour: 8,  salaryEstimate: 52000, hoursPerWeek: 40 },
    { id: 'admin2',     name: 'Admin Assistant',   role: 'Admin',            homeDomainId: 'revenue',              isManager: false, radiusMul: 0.9,  shiftStartHour: 8,  salaryEstimate: 46000, hoursPerWeek: 40 },
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

// ── HUD panel info ─────────────────────────────────────────────────────────────

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
  presence: WorkerPresence
  employeeType: EmployeeType
}

// ── Props ──────────────────────────────────────────────────────────────────────

interface HumanWorkerLayerProps {
  visible: boolean
}

// ── Component ──────────────────────────────────────────────────────────────────

export function HumanWorkerLayer({ visible }: HumanWorkerLayerProps) {
  const { scene, camera } = useWorldContext()

  const visibleRef      = useRef(visible)
  const workersRef      = useRef<Map<string, HumanWorkerModelInstance>>(new Map())
  const devWorkersRef   = useRef<Map<string, HumanWorkerModelInstance>>(new Map())
  const taskCountRef    = useRef<Map<string, number>>(new Map())
  const frameRef        = useRef<number | null>(null)

  // Clock-in / clock-out timers per worker (simulated shift schedule)
  // Key = worker id, value = next clock-out time in elapsed seconds
  const clockOutTimerRef = useRef<Map<string, number>>(new Map())

  // Pending re-spawn queue for clocked-out workers
  const pendingRespawnRef = useRef<Map<string, number>>(new Map())

  const clockRef = useRef(0)

  // Current preset
  const presetRef = useRef<PresetKey>('SOLO')

  // React state for HUD
  const [workerPanel, setWorkerPanel]           = useState<WorkerPanelInfo | null>(null)
  const [revenueChainActive, setRevenueChainActive] = useState(false)
  const [revenueChainStep, setRevenueChainStep] = useState(0)
  const revenueChainRef = useRef<ReturnType<typeof setTimeout>[]>([])

  // Sync visible ref
  useEffect(() => {
    visibleRef.current = visible
  }, [visible])

  // ── Build/rebuild workers for a preset ───────────────────────────────────────

  const buildWorkers = useCallback((preset: PresetKey) => {
    // Dispose existing
    workersRef.current.forEach(w => w.dispose())
    workersRef.current.clear()
    devWorkersRef.current.forEach(w => w.dispose())
    devWorkersRef.current.clear()
    taskCountRef.current.clear()
    clockOutTimerRef.current.clear()
    pendingRespawnRef.current.clear()

    const defs = PRESET_WORKERS[preset] ?? PRESET_WORKERS['SOLO']

    for (const def of defs) {
      spawnWorkerFromDef(def, 'west')
    }

    for (const def of EAST_DEV_WORKERS) {
      spawnWorkerFromDef(def, 'east')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene])

  function spawnWorkerFromDef(def: WorkerDef, side: 'west' | 'east'): void {
    const domainPos = DOMAIN_POS[def.homeDomainId] ?? { x: side === 'east' ? 100 : -150, z: 0 }
    const jitter = { x: (Math.random() - 0.5) * 10, z: (Math.random() - 0.5) * 10 }
    const presence = getPresence(def.role)
    const isForeman = getIsForeman(def.role)
    const employeeType: EmployeeType = def.employeeType ?? 'w2'

    // Assign project positions based on side
    const projectNodes = side === 'east' ? EAST_PROJECT_NODES : PROJECT_NODES
    // Workers with multiple projects walk between them (sample 2–3 nodes)
    const numProjects = isForeman ? 4 : (Math.random() < 0.5 ? 2 : 1)
    const shuffled = [...projectNodes].sort(() => Math.random() - 0.5)
    const projectPositions = numProjects > 1 ? shuffled.slice(0, numProjects) : undefined

    const cfg: HumanWorkerModelConfig = {
      id:               def.id,
      name:             def.name,
      role:             def.role,
      employeeType,
      presence,
      domainX:          domainPos.x + jitter.x,
      domainZ:          domainPos.z + jitter.z,
      projectPositions,
      isForeman,
    }

    const worker = new HumanWorkerModelInstance(scene, cfg)
    worker.visible = visibleRef.current

    if (side === 'east') {
      devWorkersRef.current.set(def.id, worker)
    } else {
      workersRef.current.set(def.id, worker)
    }

    taskCountRef.current.set(def.id, 0)

    // Schedule clock-out: base on shiftStartHour + 8h in sim time
    // Sim: 1 real-second ≈ 1 sim-second, shift lasts 80–120s for visual variety
    const clockOutDelay = 80 + Math.random() * 40
    clockOutTimerRef.current.set(def.id, clockRef.current + clockOutDelay)
  }

  // ── Main setup effect ─────────────────────────────────────────────────────────

  useEffect(() => {
    buildWorkers(presetRef.current)

    // Listen for preset changes
    function onPreset(e: Event) {
      const ev = e as CustomEvent<{ preset: PresetKey }>
      if (ev.detail?.preset) {
        presetRef.current = ev.detail.preset
        buildWorkers(ev.detail.preset)
      }
    }
    window.addEventListener('nw:sim-preset', onPreset)

    // Listen for real crew member clock-in events from DataBridge
    function onClockIn(e: Event) {
      const ev = e as CustomEvent<{ id: string; name: string; role: string; domain?: string; employeeType?: string; isRemote?: boolean }>
      if (!ev.detail?.id) return
      const d = ev.detail
      // If worker exists already, ignore
      if (workersRef.current.has(d.id)) return
      const domainId = d.domain ?? 'project-installation'
      const domainPos = DOMAIN_POS[domainId] ?? { x: -130, z: -70 }
      const presence: WorkerPresence = d.isRemote ? 'remote' : getPresence(d.role ?? '')
      const eType: EmployeeType = (d.employeeType as EmployeeType) ?? 'w2'
      const cfg: HumanWorkerModelConfig = {
        id: d.id, name: d.name ?? 'Worker', role: d.role ?? 'Field Crew',
        employeeType: eType, presence,
        domainX: domainPos.x + (Math.random() - 0.5) * 8,
        domainZ: domainPos.z + (Math.random() - 0.5) * 8,
        isForeman: getIsForeman(d.role ?? ''),
        projectPositions: PROJECT_NODES.slice(0, 2),
      }
      const worker = new HumanWorkerModelInstance(scene, cfg)
      worker.visible = visibleRef.current
      workersRef.current.set(d.id, worker)
      taskCountRef.current.set(d.id, 0)
      clockOutTimerRef.current.set(d.id, clockRef.current + 90 + Math.random() * 30)
    }
    window.addEventListener('nw:worker-clock-in', onClockIn)

    // Listen for real clock-out events
    function onClockOut(e: Event) {
      const ev = e as CustomEvent<{ id: string }>
      if (!ev.detail?.id) return
      const worker = workersRef.current.get(ev.detail.id)
      if (worker) {
        worker.clockOut()
        clockOutTimerRef.current.delete(ev.detail.id)
      }
    }
    window.addEventListener('nw:worker-clock-out', onClockOut)

    // Listen for active field_log updates (brighten remote workers)
    function onFieldLogActive(e: Event) {
      const ev = e as CustomEvent<{ workerId: string; active: boolean }>
      if (!ev.detail?.workerId) return
      const worker = workersRef.current.get(ev.detail.workerId) ??
                     devWorkersRef.current.get(ev.detail.workerId)
      worker?.setActivelyWorking(ev.detail.active)
    }
    window.addEventListener('nw:field-log-active', onFieldLogActive)

    // ── Animation loop ─────────────────────────────────────────────────────────
    let lastTime = performance.now() / 1000

    function animate() {
      frameRef.current = requestAnimationFrame(animate)
      const now = performance.now() / 1000
      const dt  = Math.min(now - lastTime, 0.1)
      lastTime  = now
      clockRef.current += dt

      const vis = visibleRef.current

      // Tick west workers + manage clock-out/respawn
      workersRef.current.forEach((worker, id) => {
        worker.visible = vis

        if (!vis) return

        worker.tick(dt, camera)

        // Increment task count when walking (proxy for task activity)
        if (worker.state === 'WALKING') {
          const prev = taskCountRef.current.get(id) ?? 0
          taskCountRef.current.set(id, prev)  // count only increments on arrivals
        }

        // Simulated clock-out
        const coTimer = clockOutTimerRef.current.get(id)
        if (coTimer !== undefined && clockRef.current >= coTimer) {
          clockOutTimerRef.current.delete(id)
          worker.clockOut()
          // Schedule respawn after clock-out walk (estimated 5s) + 10–20s break
          pendingRespawnRef.current.set(id, clockRef.current + 15 + Math.random() * 10)
        }

        // Remove workers that finished their exit walk
        if (worker.state === 'REMOVED') {
          worker.dispose()
          workersRef.current.delete(id)
        }
      })

      // Respawn workers after break
      pendingRespawnRef.current.forEach((respawnAt, id) => {
        if (clockRef.current >= respawnAt) {
          pendingRespawnRef.current.delete(id)
          // Rebuild from current preset
          const defs = PRESET_WORKERS[presetRef.current] ?? []
          const def = defs.find(d => d.id === id)
          if (def && !workersRef.current.has(id)) {
            spawnWorkerFromDef(def, 'west')
          }
        }
      })

      // Tick east developer workers
      devWorkersRef.current.forEach((worker, id) => {
        worker.visible = vis
        if (!vis) return
        worker.tick(dt, camera)
        if (worker.state === 'REMOVED') {
          worker.dispose()
          devWorkersRef.current.delete(id)
        }
        // Respawn east workers too
        const coTimer = clockOutTimerRef.current.get(id)
        if (coTimer !== undefined && clockRef.current >= coTimer) {
          clockOutTimerRef.current.delete(id)
          worker.clockOut()
          pendingRespawnRef.current.set(id, clockRef.current + 15 + Math.random() * 10)
        }
      })

      // Respawn east workers
      pendingRespawnRef.current.forEach((respawnAt, id) => {
        if (clockRef.current >= respawnAt && !devWorkersRef.current.has(id)) {
          const def = EAST_DEV_WORKERS.find(d => d.id === id)
          if (def) {
            pendingRespawnRef.current.delete(id)
            spawnWorkerFromDef(def, 'east')
          }
        }
      })
    }

    animate()

    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      window.removeEventListener('nw:sim-preset', onPreset)
      window.removeEventListener('nw:worker-clock-in', onClockIn)
      window.removeEventListener('nw:worker-clock-out', onClockOut)
      window.removeEventListener('nw:field-log-active', onFieldLogActive)
      workersRef.current.forEach(w => w.dispose())
      workersRef.current.clear()
      devWorkersRef.current.forEach(w => w.dispose())
      devWorkersRef.current.clear()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, camera, buildWorkers])

  // ── Click detection ────────────────────────────────────────────────────────────

  const handleClick = useCallback((e: MouseEvent) => {
    if (!visibleRef.current) return

    const rect = (e.target as HTMLElement).getBoundingClientRect?.() ??
                 { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    )

    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(mouse, camera)

    const orbMeshes: Array<{ mesh: THREE.Object3D; id: string }> = []
    workersRef.current.forEach((w, id) => {
      w.group.traverse(child => {
        if (child instanceof THREE.Mesh) orbMeshes.push({ mesh: child, id })
      })
    })

    const intersects = raycaster.intersectObjects(orbMeshes.map(o => o.mesh), false)

    if (intersects.length > 0) {
      const hit   = intersects[0].object
      const found = orbMeshes.find(o => o.mesh === hit)
      if (found) {
        const allDefs = [...(PRESET_WORKERS[presetRef.current] ?? []), ...EAST_DEV_WORKERS]
        const def = allDefs.find(d => d.id === found.id)
        if (def) {
          const worldPos = new THREE.Vector3()
          workersRef.current.get(found.id)?.group.getWorldPosition(worldPos)
          const projected = worldPos.clone().project(camera)
          const sx = (projected.x + 1) / 2 * window.innerWidth
          const sy = (1 - (projected.y + 1) / 2) * window.innerHeight
          const worker = workersRef.current.get(found.id)

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
            presence:       worker?.cfg.presence ?? 'onsite',
            employeeType:   worker?.cfg.employeeType ?? 'w2',
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

  // ── Revenue Chain ──────────────────────────────────────────────────────────────

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
      revenueChainRef.current.forEach(t => clearTimeout(t))
      revenueChainRef.current = []
      setRevenueChainActive(false)
      setRevenueChainStep(0)
      return
    }
    setRevenueChainActive(true)
    setRevenueChainStep(0)
    window.dispatchEvent(new CustomEvent('nw:revenue-chain-start'))

    REVENUE_CHAIN_STEPS.forEach((_, i) => {
      const t = setTimeout(() => {
        setRevenueChainStep(i + 1)
        window.dispatchEvent(new CustomEvent('nw:revenue-chain-step', { detail: { step: i } }))
        if (i === REVENUE_CHAIN_STEPS.length - 1) {
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

  // ── Employment type badge ──────────────────────────────────────────────────────

  const empTypeBadge = (t: EmployeeType) => {
    if (t === 'w2')          return { label: 'W-2',          color: '#FF9040' }
    if (t === '1099')        return { label: '1099',         color: '#FFD700' }
    if (t === 'hypothetical') return { label: 'Hypothetical', color: 'rgba(255,255,255,0.5)' }
    return { label: 'Unknown', color: '#aaa' }
  }

  return (
    <>
      {/* ── Worker HUD panel ──────────────────────────────────────────────── */}
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
              {workerPanel.presence === 'remote' && (
                <span style={{ marginLeft: 8, color: 'rgba(255,144,64,0.65)', fontSize: 11 }}>
                  [REMOTE]
                </span>
              )}
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
            <span>Emp. Type</span>
            <span style={{ color: empTypeBadge(workerPanel.employeeType).color }}>
              {empTypeBadge(workerPanel.employeeType).label}
            </span>
          </div>

          {/* AI toggle panel */}
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

      {/* ── Revenue Chain overlay ─────────────────────────────────────────── */}
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

      {/* ── SHOW REVENUE CHAIN button ─────────────────────────────────────── */}
      <div style={{ position: 'fixed', bottom: 20, right: 20, zIndex: 1100 }}>
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
