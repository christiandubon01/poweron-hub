/**
 * GoalTimelineLayer.tsx — NW78: 3D Goal Timeline.
 *
 * A glowing 3D rail extending into the scene along the Z-axis showing personal
 * and business goals as 3D marker objects positioned at their target dates.
 *
 * Features:
 *  - Glowing rail: 24-month lane extending forward into the scene
 *  - Month markers: vertical lines + labels ("Apr 2026", "May 2026", …)
 *  - TODAY marker: bright gold pulsing vertical bar at month 0
 *  - Goal markers by category:
 *      revenue       → gold diamond    (OctahedronGeometry)
 *      business      → teal cube       (BoxGeometry)
 *      personal      → amber sphere    (SphereGeometry)
 *      certification → purple faceted  (IcosahedronGeometry)
 *  - Completed: solid emissive glow + checkmark particle burst
 *  - Upcoming: semi-transparent, gentle sine pulse
 *  - Overdue: red tint, sinks below rail
 *  - Click goal → detail panel (progress slider, action items, NEXUS recommendation)
 *  - Add goal form: dispatches 'nw:goal-add' with name, category, target_date, description
 *  - Progress rail below main rail, gap plane glows red when overdue goals exist
 *  - Default goals pre-loaded for Christian (PowerOn Solutions)
 *  - All data persisted to localStorage
 *
 * Events received:   nw:goal-add { name, category, target_date, description, ... }
 * Events dispatched: nw:goal-add { ...full TimelineGoal }
 */

import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
} from 'react'
import * as THREE from 'three'
import { useWorldContext } from './WorldContext'
import { makeLabel, disposeLabel, type NWLabel } from './utils/makeLabel'

// ─── Types ─────────────────────────────────────────────────────────────────────

export type GoalCategory = 'revenue' | 'business' | 'personal' | 'certification'

export interface TimelineGoal {
  id:           string
  name:         string
  category:     GoalCategory
  target_date:  string        // 'YYYY-MM'
  description:  string
  progress:     number        // 0–100
  completed:    boolean
  action_items: string[]
  created_at:   number        // ms timestamp
}

interface GoalSceneObj {
  goalId:    string
  mesh:      THREE.Mesh
  light:     THREE.PointLight
  label:     NWLabel
  connector: THREE.Line
  baseY:     number
  goalZ:     number
}

interface AddFormState {
  name:        string
  category:    GoalCategory
  target_date: string
  description: string
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const LS_KEY           = 'nw78_goal_timeline'
const RAIL_X           = 0
const RAIL_Y           = 2.2
const PROGRESS_RAIL_Y  = 0.8
const MARKER_Y         = RAIL_Y + 3.8
const TOTAL_MONTHS     = 24
const MONTH_UNIT       = 11       // world units per month
const RAIL_START_Z     = 6        // z position of TODAY (month 0)
const TOTAL_LENGTH     = TOTAL_MONTHS * MONTH_UNIT  // 264 world units
const MARKER_SIZE      = 1.0
const ROTATE_SPEED     = 0.5      // rad/sec

const CATEGORY_X: Record<GoalCategory, number> = {
  revenue:        -5,
  business:       -2.5,
  personal:        2.5,
  certification:   5,
}

const CATEGORY_COLOR: Record<GoalCategory, number> = {
  revenue:       0xf59e0b,
  business:      0x14b8a6,
  personal:      0xfb923c,
  certification: 0xa855f7,
}

const CATEGORY_COLOR_HEX: Record<GoalCategory, string> = {
  revenue:       '#f59e0b',
  business:      '#14b8a6',
  personal:      '#fb923c',
  certification: '#a855f7',
}

const CATEGORY_ICON: Record<GoalCategory, string> = {
  revenue:       '💰',
  business:      '🏗️',
  personal:      '🌟',
  certification: '🎓',
}

const CATEGORY_LABEL: Record<GoalCategory, string> = {
  revenue:       'Revenue Goal',
  business:      'Business Goal',
  personal:      'Personal Goal',
  certification: 'Certification',
}

const GLASS_BG     = 'rgba(4,6,18,0.94)'
const GLASS_BORDER = 'rgba(255,255,255,0.12)'

// ─── Default goals for Christian (PowerOn Solutions) ───────────────────────────

function buildDefaultGoals(): TimelineGoal[] {
  const now = new Date()
  const ym  = (offsetMonths: number): string => {
    const d = new Date(now.getFullYear(), now.getMonth() + offsetMonths, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }
  return [
    {
      id:           'dg-1',
      name:         'First $50K Month',
      category:     'revenue',
      target_date:  ym(8),
      description:  'Achieve a single calendar month with $50,000+ in collected revenue. Requires consistent crew utilization, pipeline closure, and AR follow-through.',
      progress:     0,
      completed:    false,
      action_items: [
        'Close 2 additional open estimates this month',
        'Chase all AR over 30 days immediately',
        'Book a recurring maintenance client for MRR',
      ],
      created_at: Date.now(),
    },
    {
      id:           'dg-2',
      name:         '3 Crews Running',
      category:     'business',
      target_date:  ym(12),
      description:  'Expand to 3 fully operational field crews. Requires hiring, licensing checks, training protocols, and a second service truck.',
      progress:     0,
      completed:    false,
      action_items: [
        'Post licensed electrician job listing',
        'Budget for 2nd service truck purchase/lease',
        'Build written crew training protocol',
      ],
      created_at: Date.now(),
    },
    {
      id:           'dg-3',
      name:         'Trademark Filed',
      category:     'business',
      target_date:  ym(3),
      description:  'File "Power On Solutions" trademark with USPTO under Class 37 (electrical construction). Protect the brand before scaling.',
      progress:     0,
      completed:    false,
      action_items: [
        'Consult an IP attorney or use LegalZoom IP',
        'Search mark conflicts in USPTO TESS under Class 37',
        'Prepare and submit TEAS Plus application',
      ],
      created_at: Date.now(),
    },
    {
      id:           'dg-4',
      name:         'PowerOn Hub Beta Users',
      category:     'business',
      target_date:  ym(5),
      description:  'Onboard first 5 beta electrical contractor users to PowerOn Hub platform. Validate product-market fit before public launch.',
      progress:     0,
      completed:    false,
      action_items: [
        'Identify 10 contractor contacts via NECA network',
        'Build streamlined onboarding flow',
        'Set up feedback survey in the app',
      ],
      created_at: Date.now(),
    },
    {
      id:           'dg-5',
      name:         'Solar Certification',
      category:     'certification',
      target_date:  ym(6),
      description:  'Complete NABCEP PV Associate certification to qualify for solar project pipeline and unlock higher-margin contracts.',
      progress:     0,
      completed:    false,
      action_items: [
        'Register for NABCEP accredited prep course',
        'Schedule exam date at local testing center',
        'Study NEC Article 690 (Solar PV Systems)',
      ],
      created_at: Date.now(),
    },
    {
      id:           'dg-6',
      name:         'Complete Reading List',
      category:     'personal',
      target_date:  ym(3),
      description:  'Finish 12-book business reading list: E-Myth Revisited, Never Split the Difference, 4-Hour Work Week, Built to Sell, and others.',
      progress:     0,
      completed:    false,
      action_items: [
        'Dedicate 30 min every morning before first job',
        'Complete E-Myth Revisited first — it\'s the foundation',
        'Write a one-page action summary after each book',
      ],
      created_at: Date.now(),
    },
  ]
}

// ─── localStorage ───────────────────────────────────────────────────────────────

function loadGoals(): TimelineGoal[] {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as TimelineGoal[]
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    }
  } catch { /* ignore */ }
  return buildDefaultGoals()
}

function saveGoals(goals: TimelineGoal[]): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(goals)) } catch { /* ignore */ }
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

/** Months from now to the given 'YYYY-MM' target date. Negative = past. */
function monthsFromNow(targetDate: string): number {
  const parts = targetDate.split('-')
  const y     = parseInt(parts[0], 10)
  const m     = parseInt(parts[1], 10)
  const now   = new Date()
  return (y - now.getFullYear()) * 12 + (m - (now.getMonth() + 1))
}

/** World Z coordinate for a goal's target date along the timeline. */
function goalZPos(targetDate: string): number {
  const months  = monthsFromNow(targetDate)
  const clamped = Math.max(-2, Math.min(TOTAL_MONTHS + 2, months))
  return RAIL_START_Z - clamped * MONTH_UNIT
}

function isOverdue(goal: TimelineGoal): boolean {
  return monthsFromNow(goal.target_date) < 0 && goal.progress < 100 && !goal.completed
}

function createGoalGeo(category: GoalCategory): THREE.BufferGeometry {
  switch (category) {
    case 'revenue':       return new THREE.OctahedronGeometry(MARKER_SIZE, 0)
    case 'business':      return new THREE.BoxGeometry(MARKER_SIZE * 1.4, MARKER_SIZE * 1.4, MARKER_SIZE * 1.4)
    case 'personal':      return new THREE.SphereGeometry(MARKER_SIZE * 0.9, 14, 10)
    case 'certification': return new THREE.IcosahedronGeometry(MARKER_SIZE, 1)
  }
}

/** Formatted month label for a given month offset from today. */
function monthLabel(offsetMonths: number): string {
  const now = new Date()
  const d   = new Date(now.getFullYear(), now.getMonth() + offsetMonths, 1)
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

/** NEXUS recommendation based on goal state. */
function nexusRec(goal: TimelineGoal): string {
  const mo = monthsFromNow(goal.target_date)
  if (goal.completed) {
    return `Goal achieved. Document what worked — apply the same system to your next milestone before momentum fades.`
  }
  if (isOverdue(goal)) {
    return `This goal is past due at ${goal.progress}%. Reassess the timeline or break it into weekly sprints. NEXUS recommends a 30-min review session this week to decide: push, pivot, or drop.`
  }
  if (mo <= 1) {
    return `${mo <= 0 ? 'Final month' : '1 month out'} — execution only. Lock the top action item and move daily. No new planning.`
  }
  if (goal.progress < 20) {
    return `Only ${goal.progress}% complete with ${mo} months left. Start with the first action item today. Momentum compounds — one step per day beats a perfect plan.`
  }
  if (goal.progress >= 75) {
    return `Strong at ${goal.progress}%. You're in the home stretch — clear calendar blockers and close it out.`
  }
  return `${goal.progress}% complete, ${mo} months to target. Work the action items in order. Consistent weekly progress beats sprints.`
}

// ─── Particle burst on goal completion ─────────────────────────────────────────

function burstGoalParticles(scn: THREE.Scene, pos: THREE.Vector3, color: number): void {
  const N    = 20
  const geo  = new THREE.SphereGeometry(0.09, 4, 4)
  const mat  = new THREE.MeshBasicMaterial({ color, transparent: true })
  const ptcls: Array<{ mesh: THREE.Mesh; vx: number; vy: number; vz: number }> = []

  for (let i = 0; i < N; i++) {
    const m = new THREE.Mesh(geo, (mat as THREE.MeshBasicMaterial).clone())
    m.position.copy(pos)
    scn.add(m)
    ptcls.push({
      mesh: m,
      vx:   (Math.random() - 0.5) * 7,
      vy:   Math.random() * 5 + 2,
      vz:   (Math.random() - 0.5) * 7,
    })
  }

  const DURATION  = 0.85
  const startTime = performance.now()

  function tick() {
    const elapsed = (performance.now() - startTime) / 1000
    if (elapsed > DURATION) {
      ptcls.forEach(p => {
        scn.remove(p.mesh)
        p.mesh.geometry.dispose()
        ;(p.mesh.material as THREE.Material).dispose()
      })
      geo.dispose()
      mat.dispose()
      return
    }
    const pct = elapsed / DURATION
    ptcls.forEach(p => {
      p.mesh.position.x += p.vx * 0.016
      p.mesh.position.y += (p.vy - 9.8 * elapsed) * 0.016
      p.mesh.position.z += p.vz * 0.016
      ;(p.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - pct
    })
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

// ─── GoalTimelineLayer ──────────────────────────────────────────────────────────

export const GoalTimelineLayer: React.FC = () => {
  const { scene, camera, renderer } = useWorldContext()

  // ── React state ─────────────────────────────────────────────────────────────
  const [goals,         setGoals]         = useState<TimelineGoal[]>(loadGoals)
  const [selectedGoal,  setSelectedGoal]  = useState<TimelineGoal | null>(null)
  const [showAddForm,   setShowAddForm]   = useState(false)
  const [addForm,       setAddForm]       = useState<AddFormState>({
    name:        '',
    category:    'revenue',
    target_date: '',
    description: '',
  })

  // Local slider value (avoids scene rebuild on every tick)
  const [sliderVal, setSliderVal] = useState<number | null>(null)

  // ── Three.js object refs ─────────────────────────────────────────────────────
  const staticObjsRef   = useRef<THREE.Object3D[]>([])
  const staticLabelsRef = useRef<NWLabel[]>([])
  const goalObjsRef     = useRef<GoalSceneObj[]>([])
  const progressRailRef = useRef<THREE.Mesh | null>(null)
  const gapPlaneRef     = useRef<THREE.Mesh | null>(null)
  const todayMarkerRef  = useRef<THREE.Mesh | null>(null)
  const rafRef          = useRef<number>(0)

  // Stable refs for use inside closures
  const goalsRef        = useRef<TimelineGoal[]>(goals)
  const showAddRef      = useRef(showAddForm)

  useEffect(() => { goalsRef.current    = goals },       [goals])
  useEffect(() => { showAddRef.current  = showAddForm }, [showAddForm])

  // ── Dispose helpers ──────────────────────────────────────────────────────────
  function disposeMesh(obj: THREE.Object3D): void {
    const m = obj as THREE.Mesh
    if (m.geometry) m.geometry.dispose()
    if (m.material) {
      const mat = m.material
      if (Array.isArray(mat)) mat.forEach(x => x.dispose())
      else (mat as THREE.Material).dispose()
    }
  }

  function clearTimeline(): void {
    cancelAnimationFrame(rafRef.current)

    staticObjsRef.current.forEach(o => { scene.remove(o); disposeMesh(o) })
    staticObjsRef.current = []

    staticLabelsRef.current.forEach(l => { scene.remove(l); disposeLabel(l) })
    staticLabelsRef.current = []

    goalObjsRef.current.forEach(go => {
      scene.remove(go.mesh);      disposeMesh(go.mesh)
      scene.remove(go.light)
      scene.remove(go.label);     disposeLabel(go.label)
      scene.remove(go.connector)
      if (go.connector.geometry) go.connector.geometry.dispose()
      const cmat = go.connector.material
      if (Array.isArray(cmat)) cmat.forEach(x => x.dispose())
      else (cmat as THREE.Material).dispose()
    })
    goalObjsRef.current = []

    if (progressRailRef.current) {
      scene.remove(progressRailRef.current)
      disposeMesh(progressRailRef.current)
      progressRailRef.current = null
    }
    if (gapPlaneRef.current) {
      scene.remove(gapPlaneRef.current)
      disposeMesh(gapPlaneRef.current)
      gapPlaneRef.current = null
    }
    if (todayMarkerRef.current) {
      scene.remove(todayMarkerRef.current)
      disposeMesh(todayMarkerRef.current)
      todayMarkerRef.current = null
    }
  }

  // ── Build timeline scene ─────────────────────────────────────────────────────
  function buildTimeline(currentGoals: TimelineGoal[]): void {
    clearTimeline()

    // ── Main rail ──────────────────────────────────────────────────────────────
    const railGeo = new THREE.BoxGeometry(0.22, 0.22, TOTAL_LENGTH)
    const railMat = new THREE.MeshStandardMaterial({
      color:             0x3b82f6,
      emissive:          0x1d4ed8,
      emissiveIntensity: 1.3,
      metalness:         0.85,
      roughness:         0.1,
      transparent:       true,
      opacity:           0.9,
    })
    const rail = new THREE.Mesh(railGeo, railMat)
    rail.position.set(RAIL_X, RAIL_Y, RAIL_START_Z - TOTAL_LENGTH / 2)
    scene.add(rail)
    staticObjsRef.current.push(rail)

    // Rail glow halo
    const railGlowGeo = new THREE.BoxGeometry(0.7, 0.7, TOTAL_LENGTH)
    const railGlowMat = new THREE.MeshBasicMaterial({
      color: 0x60a5fa, transparent: true, opacity: 0.06,
    })
    const railGlow = new THREE.Mesh(railGlowGeo, railGlowMat)
    railGlow.position.copy(rail.position)
    scene.add(railGlow)
    staticObjsRef.current.push(railGlow)

    // ── Month markers ──────────────────────────────────────────────────────────
    for (let m = 1; m <= TOTAL_MONTHS; m++) {
      const mz      = RAIL_START_Z - m * MONTH_UNIT
      const isQuart = m % 3 === 0
      const alpha   = isQuart ? 0.5 : 0.2

      const mGeo = new THREE.BoxGeometry(0.07, isQuart ? 3.5 : 2.5, 0.07)
      const mMat = new THREE.MeshBasicMaterial({
        color: isQuart ? 0x94a3b8 : 0x475569, transparent: true, opacity: alpha,
      })
      const mMarker = new THREE.Mesh(mGeo, mMat)
      mMarker.position.set(RAIL_X, RAIL_Y + (isQuart ? 1.2 : 0.8), mz)
      scene.add(mMarker)
      staticObjsRef.current.push(mMarker)

      // Label every month for nearby, every quarter further out
      if (isQuart || m <= 6) {
        const lbl = makeLabel(
          monthLabel(m),
          isQuart ? '#94a3b8' : '#64748b',
          { labelType: 'agent', fontSize: isQuart ? 19 : 16 },
        )
        lbl.position.set(RAIL_X, RAIL_Y + (isQuart ? 4 : 3.2), mz)
        scene.add(lbl)
        staticLabelsRef.current.push(lbl)
      }
    }

    // ── TODAY marker ───────────────────────────────────────────────────────────
    const todayGeo = new THREE.BoxGeometry(0.16, 6.5, 0.16)
    const todayMat = new THREE.MeshStandardMaterial({
      color:             0xffd700,
      emissive:          0xffd700,
      emissiveIntensity: 2.2,
      metalness:         0.5,
      roughness:         0.1,
    })
    const todayMesh = new THREE.Mesh(todayGeo, todayMat)
    todayMesh.position.set(RAIL_X, RAIL_Y + 1.8, RAIL_START_Z)
    scene.add(todayMesh)
    todayMarkerRef.current = todayMesh

    // TODAY ground ring
    const ringGeo = new THREE.RingGeometry(0.5, 1.6, 36)
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffd700, transparent: true, opacity: 0.22, side: THREE.DoubleSide,
    })
    const ring = new THREE.Mesh(ringGeo, ringMat)
    ring.rotation.x = -Math.PI / 2
    ring.position.set(RAIL_X, 0.06, RAIL_START_Z)
    scene.add(ring)
    staticObjsRef.current.push(ring)

    // TODAY label
    const todayLbl = makeLabel('● TODAY', '#ffd700', { labelType: 'agent', fontSize: 20 })
    todayLbl.position.set(RAIL_X, RAIL_Y + 5.8, RAIL_START_Z)
    scene.add(todayLbl)
    staticLabelsRef.current.push(todayLbl)

    // ── Progress rail ──────────────────────────────────────────────────────────
    const avgProgress    = currentGoals.length > 0
      ? currentGoals.reduce((s, g) => s + g.progress, 0) / currentGoals.length
      : 0
    const hasOverdue     = currentGoals.some(isOverdue)
    const progressLength = Math.max(0.4, (avgProgress / 100) * TOTAL_LENGTH)

    const progGeo = new THREE.BoxGeometry(0.22, 0.15, progressLength)
    const progMat = new THREE.MeshStandardMaterial({
      color:             hasOverdue ? 0xef4444 : 0x22c55e,
      emissive:          hasOverdue ? 0xb91c1c : 0x15803d,
      emissiveIntensity: 1.1,
      metalness:         0.7,
      roughness:         0.2,
      transparent:       true,
      opacity:           0.88,
    })
    const progressRail = new THREE.Mesh(progGeo, progMat)
    progressRail.position.set(RAIL_X, PROGRESS_RAIL_Y, RAIL_START_Z - progressLength / 2)
    scene.add(progressRail)
    progressRailRef.current = progressRail

    // Progress rail label
    if (avgProgress > 0) {
      const pLbl = makeLabel(
        `${Math.round(avgProgress)}% AVG`,
        hasOverdue ? '#ef4444' : '#22c55e',
        { labelType: 'agent', fontSize: 15 },
      )
      pLbl.position.set(RAIL_X, PROGRESS_RAIL_Y + 1.4, RAIL_START_Z - progressLength)
      scene.add(pLbl)
      staticLabelsRef.current.push(pLbl)
    }

    // ── Gap plane (overdue indicator) ──────────────────────────────────────────
    if (hasOverdue) {
      const gapHeight = RAIL_Y - PROGRESS_RAIL_Y - 0.1
      const gapGeo    = new THREE.PlaneGeometry(0.6, gapHeight)
      const gapMat    = new THREE.MeshBasicMaterial({
        color: 0xef4444, transparent: true, opacity: 0.09, side: THREE.DoubleSide,
      })
      const gapPlane = new THREE.Mesh(gapGeo, gapMat)
      gapPlane.rotation.y = Math.PI / 2
      gapPlane.position.set(
        RAIL_X,
        (RAIL_Y + PROGRESS_RAIL_Y) / 2,
        RAIL_START_Z - progressLength * 0.6,
      )
      scene.add(gapPlane)
      gapPlaneRef.current = gapPlane
    }

    // ── Goal markers ───────────────────────────────────────────────────────────
    const newGoalObjs: GoalSceneObj[] = []

    currentGoals.forEach((goal) => {
      const catColor    = CATEGORY_COLOR[goal.category]
      const catColorHex = CATEGORY_COLOR_HEX[goal.category]
      const goalZ       = goalZPos(goal.target_date)
      const catX        = CATEGORY_X[goal.category]
      const overdue     = isOverdue(goal)
      const baseY       = overdue ? MARKER_Y - 1.8 : MARKER_Y

      // Marker mesh
      const geo = createGoalGeo(goal.category)
      const mat = new THREE.MeshStandardMaterial({
        color:             overdue ? 0xef4444 : catColor,
        emissive:          overdue ? 0xb91c1c : catColor,
        emissiveIntensity: goal.completed ? 1.8 : overdue ? 0.45 : 0.65,
        metalness:         0.8,
        roughness:         0.15,
        transparent:       !goal.completed,
        opacity:           goal.completed ? 1.0 : 0.72,
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.set(catX, baseY, goalZ)
      mesh.userData.goalId = goal.id
      scene.add(mesh)

      // Point light at marker
      const light = new THREE.PointLight(overdue ? 0xef4444 : catColor, 0.85, 11)
      light.position.set(catX, baseY, goalZ)
      scene.add(light)

      // Connector line: rail position → marker
      const connPoints = [
        new THREE.Vector3(RAIL_X, RAIL_Y,  goalZ),
        new THREE.Vector3(catX,   baseY,   goalZ),
      ]
      const connGeo = new THREE.BufferGeometry().setFromPoints(connPoints)
      const connMat = new THREE.LineBasicMaterial({
        color: overdue ? 0xef4444 : catColor, transparent: true, opacity: 0.35,
      })
      const connector = new THREE.Line(connGeo, connMat)
      scene.add(connector)

      // Label
      const labelText = goal.completed
        ? `✓ ${goal.name}`
        : `${CATEGORY_ICON[goal.category]} ${goal.name}`
      const label = makeLabel(
        labelText,
        goal.completed ? '#22c55e' : catColorHex,
        { labelType: 'project' },
      )
      label.position.set(catX, baseY + 2.4, goalZ)
      scene.add(label)

      newGoalObjs.push({ goalId: goal.id, mesh, light, label, connector, baseY, goalZ })
    })

    goalObjsRef.current = newGoalObjs

    // ── Animation loop ─────────────────────────────────────────────────────────
    let lastTime = performance.now()

    function animate(): void {
      rafRef.current = requestAnimationFrame(animate)
      const now = performance.now()
      const dt  = Math.min((now - lastTime) / 1000, 0.1)
      lastTime  = now
      const t   = now / 1000

      // Pulse TODAY marker
      if (todayMarkerRef.current) {
        const pulse = 1 + Math.sin(t * 2.8) * 0.11
        todayMarkerRef.current.scale.x = pulse
        todayMarkerRef.current.scale.z = pulse
        ;(todayMarkerRef.current.material as THREE.MeshStandardMaterial).emissiveIntensity =
          1.9 + Math.sin(t * 3.1) * 0.45
      }

      // Animate goal markers
      goalObjsRef.current.forEach((go) => {
        const goal = goalsRef.current.find(g => g.id === go.goalId)
        if (!goal) return

        // Rotate
        go.mesh.rotation.y += ROTATE_SPEED * dt
        go.mesh.rotation.x += ROTATE_SPEED * 0.18 * dt

        // Bob / sink
        const overdue = isOverdue(goal)
        if (overdue) {
          go.mesh.position.y = go.baseY + Math.sin(t * 0.75) * 0.38 - 0.45
        } else {
          go.mesh.position.y = go.baseY + Math.sin(t * 1.1 + go.goalZ * 0.09) * 0.32
        }
        go.light.position.y = go.mesh.position.y

        // Pulse opacity for upcoming goals
        if (!goal.completed && !overdue) {
          const mMat = go.mesh.material as THREE.MeshStandardMaterial
          mMat.opacity = 0.62 + Math.sin(t * 1.4 + go.goalZ * 0.04) * 0.19
        }

        // Update label frustum visibility
        const wp = new THREE.Vector3()
        go.label.getWorldPosition(wp)
        go.label.updateVisibility(camera, wp)
      })

      // Update static labels
      staticLabelsRef.current.forEach(l => {
        const wp = new THREE.Vector3()
        l.getWorldPosition(wp)
        l.updateVisibility(camera, wp)
      })
    }

    animate()
  }

  // ── Click detection via raycasting ──────────────────────────────────────────
  const handleCanvasClick = useCallback((e: MouseEvent) => {
    if (showAddRef.current) return

    const rect = renderer.domElement.getBoundingClientRect()
    const ndc  = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width)  * 2 - 1,
      -((e.clientY - rect.top)  / rect.height) * 2 + 1,
    )
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(ndc, camera)

    const meshes = goalObjsRef.current.map(go => go.mesh)
    const hits   = raycaster.intersectObjects(meshes, false)

    if (hits.length > 0) {
      const hitId  = (hits[0].object as THREE.Mesh).userData.goalId as string
      const target = goalsRef.current.find(g => g.id === hitId) ?? null
      setSelectedGoal(target)
      setSliderVal(null)
    }
  }, [renderer, camera])

  // ── Add goal ─────────────────────────────────────────────────────────────────
  const handleAddGoal = useCallback(() => {
    if (!addForm.name.trim() || !addForm.target_date) return

    const newGoal: TimelineGoal = {
      id:           `goal-${Date.now()}`,
      name:         addForm.name.trim(),
      category:     addForm.category,
      target_date:  addForm.target_date,
      description:  addForm.description.trim() || addForm.name.trim(),
      progress:     0,
      completed:    false,
      action_items: [],
      created_at:   Date.now(),
    }

    const updated = [...goalsRef.current, newGoal]
    saveGoals(updated)
    setGoals(updated)
    setShowAddForm(false)
    setAddForm({ name: '', category: 'revenue', target_date: '', description: '' })

    window.dispatchEvent(new CustomEvent('nw:goal-add', { detail: newGoal }))
  }, [addForm])

  // ── Progress commit (on slider release) ──────────────────────────────────────
  const commitProgress = useCallback((goalId: string, value: number) => {
    const updated = goalsRef.current.map(g =>
      g.id === goalId
        ? { ...g, progress: value, completed: value >= 100 }
        : g,
    )
    saveGoals(updated)
    setGoals(updated)
    setSliderVal(null)

    const updatedGoal = updated.find(g => g.id === goalId)
    if (value >= 100 && updatedGoal) {
      const go = goalObjsRef.current.find(o => o.goalId === goalId)
      if (go) burstGoalParticles(scene, go.mesh.position.clone(), CATEGORY_COLOR[updatedGoal.category])
    }
    // Keep panel open with updated data
    setSelectedGoal(updated.find(g => g.id === goalId) ?? null)
  }, [scene])

  // ── Effects ──────────────────────────────────────────────────────────────────

  // Rebuild timeline when goals array changes
  useEffect(() => {
    buildTimeline(goals)
    return () => { clearTimeline() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goals])

  // Attach click listener to renderer canvas
  useEffect(() => {
    const el = renderer.domElement
    el.addEventListener('click', handleCanvasClick)
    return () => { el.removeEventListener('click', handleCanvasClick) }
  }, [renderer, handleCanvasClick])

  // Listen for external nw:goal-add events (from CommandHUD / other layers)
  useEffect(() => {
    function onGoalAdd(e: Event) {
      const d = (e as CustomEvent<Partial<TimelineGoal>>).detail
      if (!d?.name || !d?.target_date || !d?.category) return
      const newGoal: TimelineGoal = {
        id:           d.id ?? `goal-ext-${Date.now()}`,
        name:         d.name,
        category:     d.category as GoalCategory,
        target_date:  d.target_date,
        description:  d.description ?? d.name,
        progress:     d.progress ?? 0,
        completed:    d.completed ?? false,
        action_items: d.action_items ?? [],
        created_at:   d.created_at ?? Date.now(),
      }
      if (goalsRef.current.find(g => g.id === newGoal.id)) return  // already present
      const updated = [...goalsRef.current, newGoal]
      saveGoals(updated)
      setGoals(updated)
    }
    window.addEventListener('nw:goal-add', onGoalAdd)
    return () => { window.removeEventListener('nw:goal-add', onGoalAdd) }
  }, [])

  // ── UI helpers ───────────────────────────────────────────────────────────────

  const overlayBg: React.CSSProperties = {
    position:       'fixed',
    inset:          0,
    zIndex:         130,
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'center',
    background:     'rgba(0,0,0,0.62)',
    backdropFilter: 'blur(7px)',
    animation:      'gtlFadeIn 0.22s ease',
  }

  const cardBase: React.CSSProperties = {
    background:     GLASS_BG,
    border:         `1px solid ${GLASS_BORDER}`,
    borderRadius:   14,
    padding:        '28px 32px',
    width:          430,
    maxWidth:       '94vw',
    backdropFilter: 'blur(24px)',
    position:       'relative',
    maxHeight:      '90vh',
    overflowY:      'auto',
  }

  const labelStyle: React.CSSProperties = {
    color:         'rgba(255,255,255,0.5)',
    fontSize:      11,
    fontFamily:    'monospace',
    letterSpacing: 1.5,
    display:       'block',
    marginBottom:  6,
  }

  const inputStyle: React.CSSProperties = {
    width:       '100%',
    background:  'rgba(255,255,255,0.05)',
    border:      '1px solid rgba(255,255,255,0.12)',
    borderRadius: 7,
    color:       '#fff',
    fontSize:    14,
    fontFamily:  'monospace',
    padding:     '10px 12px',
    outline:     'none',
    boxSizing:   'border-box',
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <>
      <style>{`
        @keyframes gtlFadeIn {
          from { opacity: 0; transform: scale(0.97) }
          to   { opacity: 1; transform: scale(1) }
        }
        @keyframes gtlPulse {
          0%, 100% { opacity: 0.7 }
          50%       { opacity: 1 }
        }
      `}</style>

      {/* ══════════════════════════════ Goal Detail Panel ══════════════════════ */}
      {selectedGoal && (
        <div
          style={overlayBg}
          onClick={e => { if (e.target === e.currentTarget) { setSelectedGoal(null); setSliderVal(null) } }}
        >
          <div style={{
            ...cardBase,
            borderColor: CATEGORY_COLOR_HEX[selectedGoal.category] + '55',
            boxShadow:   `0 0 50px ${CATEGORY_COLOR_HEX[selectedGoal.category]}18`,
          }}>
            {/* Accent top strip */}
            <div style={{
              position:     'absolute',
              top:          0, left: 0, right: 0,
              height:       3,
              background:   `linear-gradient(to right, ${CATEGORY_COLOR_HEX[selectedGoal.category]}, transparent)`,
              borderRadius: '14px 14px 0 0',
            }} />

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 18, gap: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                  <span style={{ fontSize: 22 }}>{CATEGORY_ICON[selectedGoal.category]}</span>
                  <div>
                    <div style={{
                      color:         CATEGORY_COLOR_HEX[selectedGoal.category],
                      fontSize:      10,
                      fontFamily:    'monospace',
                      letterSpacing: 2,
                      fontWeight:    700,
                    }}>
                      {CATEGORY_LABEL[selectedGoal.category].toUpperCase()}
                      {isOverdue(selectedGoal) && (
                        <span style={{ color: '#ef4444', marginLeft: 10 }}>⚠ OVERDUE</span>
                      )}
                      {selectedGoal.completed && (
                        <span style={{ color: '#22c55e', marginLeft: 10 }}>✓ COMPLETE</span>
                      )}
                    </div>
                    <div style={{
                      color: '#fff', fontSize: 17, fontFamily: 'monospace', fontWeight: 700, marginTop: 3,
                    }}>
                      {selectedGoal.name}
                    </div>
                  </div>
                </div>
                <p style={{
                  color:      'rgba(255,255,255,0.58)',
                  fontSize:   13,
                  fontFamily: 'sans-serif',
                  lineHeight: 1.55,
                  margin:     0,
                }}>
                  {selectedGoal.description}
                </p>
              </div>
              <button
                type="button"
                onClick={() => { setSelectedGoal(null); setSliderVal(null) }}
                style={{
                  background: 'transparent', border: 'none',
                  color: 'rgba(255,255,255,0.32)', fontSize: 19,
                  cursor: 'pointer', padding: '0 0 0 8px', flexShrink: 0,
                }}
              >✕</button>
            </div>

            {/* Target date row */}
            <div style={{
              display:        'flex',
              alignItems:     'center',
              justifyContent: 'space-between',
              background:     'rgba(255,255,255,0.04)',
              border:         '1px solid rgba(255,255,255,0.08)',
              borderRadius:   7,
              padding:        '9px 14px',
              marginBottom:   16,
            }}>
              <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, fontFamily: 'monospace', letterSpacing: 1 }}>
                TARGET DATE
              </span>
              <span style={{ color: '#fff', fontSize: 14, fontFamily: 'monospace', fontWeight: 600 }}>
                {monthLabel(monthsFromNow(selectedGoal.target_date))}
                <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, marginLeft: 8 }}>
                  {(() => {
                    const mo = monthsFromNow(selectedGoal.target_date)
                    if (mo > 0)  return `(${mo} mo away)`
                    if (mo === 0) return '(this month)'
                    return `(${Math.abs(mo)} mo ago)`
                  })()}
                </span>
              </span>
            </div>

            {/* Progress */}
            <div style={{ marginBottom: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
                <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11, fontFamily: 'monospace', letterSpacing: 1 }}>
                  PROGRESS
                </span>
                <span style={{
                  color:      (sliderVal ?? selectedGoal.progress) >= 75 ? '#22c55e'
                            : (sliderVal ?? selectedGoal.progress) >= 35 ? '#f59e0b'
                            : '#ef4444',
                  fontSize:   17,
                  fontFamily: 'monospace',
                  fontWeight: 700,
                }}>
                  {sliderVal ?? selectedGoal.progress}%
                </span>
              </div>
              <div style={{
                width: '100%', height: 8, background: 'rgba(255,255,255,0.08)',
                borderRadius: 5, overflow: 'hidden', marginBottom: 10,
              }}>
                <div style={{
                  width:        `${sliderVal ?? selectedGoal.progress}%`,
                  height:       '100%',
                  background:   `linear-gradient(to right, ${CATEGORY_COLOR_HEX[selectedGoal.category]}88, ${CATEGORY_COLOR_HEX[selectedGoal.category]})`,
                  borderRadius: 5,
                  transition:   'width 0.25s ease',
                  boxShadow:    `0 0 8px ${CATEGORY_COLOR_HEX[selectedGoal.category]}55`,
                }} />
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={sliderVal ?? selectedGoal.progress}
                onChange={e => setSliderVal(Number(e.target.value))}
                onMouseUp={e => commitProgress(selectedGoal.id, Number((e.target as HTMLInputElement).value))}
                onTouchEnd={e => {
                  const inp = (e.target as HTMLInputElement)
                  commitProgress(selectedGoal.id, Number(inp.value))
                }}
                style={{ width: '100%', cursor: 'pointer', accentColor: CATEGORY_COLOR_HEX[selectedGoal.category] }}
              />
            </div>

            {/* Action items */}
            {selectedGoal.action_items.length > 0 && (
              <div style={{ marginBottom: 18 }}>
                <div style={{ color: 'rgba(255,255,255,0.48)', fontSize: 11, fontFamily: 'monospace', letterSpacing: 1.5, marginBottom: 8 }}>
                  ACTION ITEMS
                </div>
                {selectedGoal.action_items.map((item, idx) => (
                  <div key={idx} style={{
                    display:     'flex',
                    alignItems:  'flex-start',
                    gap:         8,
                    padding:     '7px 0',
                    borderBottom:'1px solid rgba(255,255,255,0.05)',
                    fontSize:    13,
                    color:       'rgba(255,255,255,0.78)',
                    fontFamily:  'sans-serif',
                  }}>
                    <span style={{
                      color:     CATEGORY_COLOR_HEX[selectedGoal.category],
                      fontSize:  10,
                      marginTop: 3,
                      flexShrink: 0,
                    }}>▸</span>
                    {item}
                  </div>
                ))}
              </div>
            )}

            {/* NEXUS recommendation */}
            <div style={{
              background:   'rgba(99,102,241,0.07)',
              border:       '1px solid rgba(99,102,241,0.22)',
              borderRadius: 9,
              padding:      '12px 16px',
              marginBottom: 18,
            }}>
              <div style={{
                color:         '#818cf8',
                fontSize:      10,
                fontFamily:    'monospace',
                letterSpacing: 2,
                fontWeight:    700,
                marginBottom:  7,
              }}>
                ◈ NEXUS RECOMMENDATION
              </div>
              <p style={{
                color:      'rgba(255,255,255,0.82)',
                fontSize:   13,
                fontFamily: 'sans-serif',
                lineHeight: 1.65,
                margin:     0,
              }}>
                {nexusRec(selectedGoal)}
              </p>
            </div>

            {/* Close button */}
            <button
              type="button"
              onClick={() => { setSelectedGoal(null); setSliderVal(null) }}
              style={{
                width:         '100%',
                background:    'rgba(255,255,255,0.04)',
                border:        '1px solid rgba(255,255,255,0.10)',
                borderRadius:  8,
                color:         'rgba(255,255,255,0.42)',
                fontSize:      13,
                fontFamily:    'monospace',
                letterSpacing: 1,
                padding:       '11px 0',
                cursor:        'pointer',
              }}
            >
              CLOSE
            </button>
          </div>
        </div>
      )}

      {/* ══════════════════════════════ Add Goal Form ══════════════════════════ */}
      {showAddForm && (
        <div
          style={overlayBg}
          onClick={e => { if (e.target === e.currentTarget) setShowAddForm(false) }}
        >
          <div style={cardBase}>
            <div style={{
              color: '#fff', fontSize: 16, fontFamily: 'monospace',
              fontWeight: 700, letterSpacing: 1.5, marginBottom: 22,
            }}>
              + ADD GOAL TO TIMELINE
            </div>

            {/* Name */}
            <label style={{ display: 'block', marginBottom: 16 }}>
              <span style={labelStyle}>GOAL NAME</span>
              <input
                type="text"
                value={addForm.name}
                onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g., First $100K month"
                style={inputStyle}
              />
            </label>

            {/* Category */}
            <label style={{ display: 'block', marginBottom: 16 }}>
              <span style={labelStyle}>CATEGORY</span>
              <select
                value={addForm.category}
                onChange={e => setAddForm(f => ({ ...f, category: e.target.value as GoalCategory }))}
                style={{ ...inputStyle, cursor: 'pointer', appearance: 'none' }}
              >
                <option value="revenue">💰  Revenue Goal</option>
                <option value="business">🏗️  Business Goal</option>
                <option value="personal">🌟  Personal Goal</option>
                <option value="certification">🎓  Certification</option>
              </select>
            </label>

            {/* Target date */}
            <label style={{ display: 'block', marginBottom: 16 }}>
              <span style={labelStyle}>TARGET DATE</span>
              <input
                type="month"
                value={addForm.target_date}
                onChange={e => setAddForm(f => ({ ...f, target_date: e.target.value }))}
                style={{ ...inputStyle, colorScheme: 'dark' }}
              />
            </label>

            {/* Description */}
            <label style={{ display: 'block', marginBottom: 22 }}>
              <span style={labelStyle}>DESCRIPTION (optional)</span>
              <textarea
                value={addForm.description}
                onChange={e => setAddForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Why this goal matters..."
                rows={3}
                style={{
                  ...inputStyle,
                  fontFamily: 'sans-serif',
                  resize:     'vertical',
                  lineHeight: 1.5,
                }}
              />
            </label>

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                onClick={handleAddGoal}
                disabled={!addForm.name.trim() || !addForm.target_date}
                style={{
                  flex:          1,
                  background:    'rgba(99,102,241,0.15)',
                  border:        '1px solid rgba(99,102,241,0.5)',
                  borderRadius:  8,
                  color:         '#a5b4fc',
                  fontSize:      13,
                  fontFamily:    'monospace',
                  fontWeight:    700,
                  letterSpacing: 1.5,
                  padding:       '12px 0',
                  cursor:        !addForm.name.trim() || !addForm.target_date ? 'not-allowed' : 'pointer',
                  opacity:       !addForm.name.trim() || !addForm.target_date ? 0.45 : 1,
                }}
              >
                PLACE ON TIMELINE
              </button>
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                style={{
                  background:   'rgba(255,255,255,0.04)',
                  border:       '1px solid rgba(255,255,255,0.10)',
                  borderRadius: 8,
                  color:        'rgba(255,255,255,0.38)',
                  fontSize:     13,
                  fontFamily:   'monospace',
                  padding:      '12px 18px',
                  cursor:       'pointer',
                }}
              >
                CANCEL
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════ HUD: Legend + Add Button ═══════════════ */}

      {/* Category legend */}
      <div style={{
        position:       'absolute',
        bottom:         90,
        left:           '50%',
        transform:      'translateX(-50%)',
        zIndex:         45,
        display:        'flex',
        gap:            14,
        background:     'rgba(4,6,18,0.88)',
        border:         '1px solid rgba(255,255,255,0.07)',
        borderRadius:   9,
        padding:        '7px 16px',
        backdropFilter: 'blur(12px)',
        pointerEvents:  'none',
      }}>
        {(Object.entries(CATEGORY_ICON) as Array<[GoalCategory, string]>).map(([cat, icon]) => (
          <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ fontSize: 13 }}>{icon}</span>
            <span style={{
              color:         CATEGORY_COLOR_HEX[cat],
              fontSize:      10,
              fontFamily:    'monospace',
              letterSpacing: 1,
            }}>
              {cat.toUpperCase()}
            </span>
          </div>
        ))}
        <div style={{ width: 1, background: 'rgba(255,255,255,0.1)', margin: '0 2px' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ fontSize: 11, color: '#ffd700' }}>|</span>
          <span style={{ color: '#ffd700', fontSize: 10, fontFamily: 'monospace', letterSpacing: 1 }}>TODAY</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 10, height: 3, background: '#22c55e', display: 'inline-block', borderRadius: 2 }} />
          <span style={{ color: '#22c55e', fontSize: 10, fontFamily: 'monospace', letterSpacing: 1 }}>PROGRESS</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 10, height: 3, background: '#ef4444', display: 'inline-block', borderRadius: 2 }} />
          <span style={{ color: '#ef4444', fontSize: 10, fontFamily: 'monospace', letterSpacing: 1 }}>OVERDUE</span>
        </div>
      </div>

      {/* Add Goal button */}
      <button
        type="button"
        onClick={() => setShowAddForm(true)}
        style={{
          position:       'absolute',
          bottom:         90,
          right:          16,
          zIndex:         45,
          display:        'flex',
          alignItems:     'center',
          gap:            6,
          background:     'rgba(99,102,241,0.12)',
          border:         '1px solid rgba(99,102,241,0.38)',
          borderRadius:   8,
          color:          '#a5b4fc',
          fontSize:       11,
          fontFamily:     'monospace',
          fontWeight:     700,
          letterSpacing:  1.5,
          padding:        '8px 15px',
          cursor:         'pointer',
          backdropFilter: 'blur(12px)',
          transition:     'all 0.15s',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(99,102,241,0.22)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'rgba(99,102,241,0.12)')}
      >
        <span style={{ fontSize: 15, lineHeight: 1 }}>+</span>
        ADD GOAL
      </button>
    </>
  )
}

export default GoalTimelineLayer
