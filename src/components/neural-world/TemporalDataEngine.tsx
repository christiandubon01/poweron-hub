/**
 * TemporalDataEngine.tsx — NW39: Timeline index engine for Neural World.
 *
 * Reads ALL Supabase data with timestamps and builds point-in-time snapshots.
 * For any given Date, computes what the world looked like (past) or will look
 * like (future projection).
 *
 * PAST MODE  — filter/rewind all data to reflect state as of that date.
 * FUTURE MODE — linear extrapolation from current trends + saved projections.
 *
 * Exports:
 *   TemporalSnapshot     — fully typed point-in-time world state
 *   TemporalMode         — 'past' | 'present' | 'future'
 *   buildTemporalSnapshot(data, targetDate) → TemporalSnapshot
 *   TemporalContext      — React context carrying current snapshot + controls
 *   TemporalProvider     — context provider
 *   useTemporalEngine    — consumer hook
 */

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useRef,
} from 'react'
import type {
  NWWorldData,
  NWProject,
  NWInvoice,
  NWFieldLog,
  NWCrewMember,
  NWHubEvent,
} from './DataBridge'

// ── Types ─────────────────────────────────────────────────────────────────────

export type TemporalMode = 'past' | 'present' | 'future'

/** A project as it appeared at a specific historical or projected date */
export interface TemporalProject {
  id: string
  name: string
  contract_value: number
  health_score: number
  phase_completion: number
  material_cost: number
  status: NWProject['status']
  /** Ghost in future mode */
  isProjected: boolean
  /** Height multiplier 0–1 derived from phase completion at that date */
  heightMultiplier: number
  /** Geological material signal: 0=diamond/obsidian early, 1=gold/platinum late */
  materialMaturity: number
}

/** An invoice as it appeared at a specific date */
export interface TemporalInvoice {
  id: string
  project_id: string | null
  amount: number
  status: string
  /** True if the invoice was unpaid at the viewed date (stalactite visible) */
  unpaidAtDate: boolean
  isProjected: boolean
}

/** River state at a specific date */
export interface TemporalRiver {
  /** Width multiplier 0.2–2.0 relative to current */
  widthMultiplier: number
  /** Revenue collected as of this date in $$ */
  revenueCollected: number
  /** Ghost opacity for future */
  opacity: number
  color: string
}

/** Fog density per domain at the viewed date */
export interface TemporalFog {
  bandwidth: number    // 0–1
  revenue: number
  security: number
  improvement: number
}

/** Subscription tower / hub event state */
export interface TemporalTower {
  id: string
  event_type: string
  existedAtDate: boolean
  isProjected: boolean
}

/** Crew state at a specific date */
export interface TemporalCrew {
  id: string
  name: string
  activeAtDate: boolean
  isProjected: boolean
}

/** Full point-in-time world snapshot */
export interface TemporalSnapshot {
  mode: TemporalMode
  viewDate: Date
  presentDate: Date
  projects: TemporalProject[]
  invoices: TemporalInvoice[]
  river: TemporalRiver
  fog: TemporalFog
  towers: TemporalTower[]
  crew: TemporalCrew[]
  /** Total revenue collected as of this date */
  totalRevenueAtDate: number
  /** Number of active projects at this date */
  activeProjectCount: number
  /** Months offset from present (negative = past, 0 = present, positive = future) */
  monthsOffset: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function monthsBetween(a: Date, b: Date): number {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth())
    + (b.getDate() - a.getDate()) / 30
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

/** Simple deterministic seed from a string → 0–1 */
function seedRand(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return Math.abs(h % 1000) / 1000
}

// ── Core snapshot builder ────────────────────────────────────────────────────

/**
 * Build a TemporalSnapshot for `targetDate` given current world data.
 *
 * @param data      Current NWWorldData from DataBridge
 * @param targetDate  The date to view (past or future)
 * @param presentDate Today's date
 * @param savedProjectionMultipliers  Optional revenue/project growth rates from ProjectionGuide
 */
export function buildTemporalSnapshot(
  data: NWWorldData,
  targetDate: Date,
  presentDate: Date,
  savedProjectionMultipliers?: { revenueGrowthPerMonth: number; projectGrowthPerMonth: number }
): TemporalSnapshot {

  const offsetMonths = monthsBetween(presentDate, targetDate)
  const mode: TemporalMode =
    Math.abs(offsetMonths) < 0.01 ? 'present'
    : offsetMonths < 0 ? 'past'
    : 'future'

  // ── PAST MODE ──────────────────────────────────────────────────────────────
  if (mode === 'past' || mode === 'present') {
    const targetMs = targetDate.getTime()

    // Projects that existed at targetDate
    const historicProjects: TemporalProject[] = data.projects
      .filter(p => {
        if (!p.created_at) return true  // no timestamp → always visible
        return new Date(p.created_at).getTime() <= targetMs
      })
      .map(p => {
        // Phase completion at that date: derive from field_logs logged before targetDate
        const logsForProject = data.fieldLogs.filter(fl =>
          fl.project_id === p.id && fl.log_date &&
          new Date(fl.log_date).getTime() <= targetMs
        )
        const totalHoursLogged = logsForProject.reduce((s, fl) => s + fl.hours, 0)
        // Assume full phase at current phase_completion is reached by all logs
        const currentTotalLogs = data.fieldLogs
          .filter(fl => fl.project_id === p.id)
          .reduce((s, fl) => s + fl.hours, 0)
        const phaseAtDate = currentTotalLogs > 0
          ? clamp((totalHoursLogged / currentTotalLogs) * p.phase_completion, 0, 100)
          : p.phase_completion

        // Material maturity: 0 = early (diamond/obsidian), 1 = late (gold/platinum)
        const materialMaturity = clamp(phaseAtDate / 100, 0, 1)

        // Height reflects contract value (same as today) but scaled by phase
        const heightMultiplier = clamp(0.2 + (phaseAtDate / 100) * 0.8, 0.2, 1.0)

        return {
          id: p.id,
          name: p.name,
          contract_value: p.contract_value,
          health_score: p.health_score,
          phase_completion: phaseAtDate,
          material_cost: p.material_cost,
          status: p.status,
          isProjected: false,
          heightMultiplier,
          materialMaturity,
        }
      })

    // Invoices: unpaid at targetDate = created before target AND (not paid OR paid after target)
    const historicInvoices: TemporalInvoice[] = data.invoices
      .filter(inv => {
        if (!inv.created_at) return true
        return new Date(inv.created_at).getTime() <= targetMs
      })
      .map(inv => {
        const paidBeforeTarget = inv.paid_at
          ? new Date(inv.paid_at).getTime() <= targetMs
          : false
        const unpaidAtDate = inv.status !== 'cancelled' && !paidBeforeTarget
        return {
          id: inv.id,
          project_id: inv.project_id,
          amount: inv.amount,
          status: paidBeforeTarget ? 'paid' : inv.status,
          unpaidAtDate,
          isProjected: false,
        }
      })

    // Revenue collected as of targetDate: sum of paid_at <= target
    const totalRevenueAtDate = data.invoices
      .filter(inv => inv.paid_at && new Date(inv.paid_at).getTime() <= targetMs)
      .reduce((s, inv) => s + inv.amount, 0)

    // River: width based on revenue
    const currentRevenue = data.invoices
      .filter(inv => inv.paid_at)
      .reduce((s, inv) => s + inv.amount, 0)
    const riverWidthMultiplier = currentRevenue > 0
      ? clamp(totalRevenueAtDate / currentRevenue, 0.2, 1.5)
      : 0.3

    // Fog: derive from project count and unpaid invoice ratio
    const unpaidRatioAtDate = historicInvoices.filter(i => i.unpaidAtDate).length /
      Math.max(historicInvoices.length, 1)
    const projectCountRatio = historicProjects.length / Math.max(data.projects.length, 1)

    // Towers (hub events / subscribers) that existed at targetDate
    const historicTowers: TemporalTower[] = data.hubEvents
      .filter(ev => {
        if (!ev.created_at) return true
        return new Date(ev.created_at).getTime() <= targetMs
      })
      .map(ev => ({
        id: ev.id,
        event_type: ev.event_type,
        existedAtDate: true,
        isProjected: false,
      }))

    // Crew at targetDate
    const historicCrew: TemporalCrew[] = data.crewMembers
      .filter(c => {
        if (!c.created_at) return true
        return new Date(c.created_at).getTime() <= targetMs
      })
      .map(c => ({
        id: c.id,
        name: c.name,
        activeAtDate: c.active,
        isProjected: false,
      }))

    return {
      mode,
      viewDate: targetDate,
      presentDate,
      projects: historicProjects,
      invoices: historicInvoices,
      river: {
        widthMultiplier: riverWidthMultiplier,
        revenueCollected: totalRevenueAtDate,
        opacity: 1,
        color: `rgba(${Math.round(20 + riverWidthMultiplier * 40)}, ${Math.round(80 + riverWidthMultiplier * 100)}, ${Math.round(180 + riverWidthMultiplier * 60)}, 1)`,
      },
      fog: {
        bandwidth: clamp(0.3 + unpaidRatioAtDate * 0.4, 0.1, 0.9),
        revenue: clamp(0.2 + (1 - riverWidthMultiplier) * 0.5, 0.1, 0.9),
        security: clamp(0.2 + (1 - projectCountRatio) * 0.3, 0.1, 0.9),
        improvement: clamp(0.3 + (1 - projectCountRatio) * 0.4, 0.1, 0.9),
      },
      towers: historicTowers,
      crew: historicCrew,
      totalRevenueAtDate,
      activeProjectCount: historicProjects.filter(p =>
        p.status === 'in_progress' || p.status === 'approved'
      ).length,
      monthsOffset: offsetMonths,
    }
  }

  // ── FUTURE MODE ────────────────────────────────────────────────────────────
  {
    const monthsAhead = offsetMonths  // positive

    // Growth rates: use saved projection multipliers if available, else linear
    const revenueGrowthPerMonth = savedProjectionMultipliers?.revenueGrowthPerMonth ?? 0.05  // 5%/mo default
    const projectGrowthPerMonth = savedProjectionMultipliers?.projectGrowthPerMonth ?? 0.03  // 3%/mo default

    const revenueGrowthFactor = Math.pow(1 + revenueGrowthPerMonth, monthsAhead)
    const projectGrowthFactor = 1 + projectGrowthPerMonth * monthsAhead

    // Current revenue baseline
    const currentRevenue = data.invoices
      .filter(inv => inv.paid_at)
      .reduce((s, inv) => s + inv.amount, 0)
    const projectedRevenue = currentRevenue * revenueGrowthFactor

    // Existing projects as ghosts, plus projected new ones
    const futureProjects: TemporalProject[] = data.projects.map(p => {
      // Projected phase completion: extrapolate current trend
      const currentRate = p.phase_completion  // % complete now
      const projectedPhase = clamp(currentRate + (monthsAhead / 3) * (100 - currentRate) * 0.2, 0, 100)
      const materialMaturity = clamp(projectedPhase / 100, 0, 1)
      const heightMultiplier = clamp(0.2 + (projectedPhase / 100) * 0.8, 0.2, 1.0)
      return {
        id: p.id,
        name: p.name,
        contract_value: p.contract_value * (1 + 0.02 * monthsAhead),
        health_score: p.health_score,
        phase_completion: projectedPhase,
        material_cost: p.material_cost,
        status: p.status,
        isProjected: false,  // existing projects shown solid
        heightMultiplier,
        materialMaturity,
      }
    })

    // Add ghost projected new projects
    const newProjectCount = Math.round((projectGrowthFactor - 1) * Math.max(data.projects.length, 2))
    for (let i = 0; i < Math.min(newProjectCount, 5); i++) {
      const seed = seedRand(`projected-${i}-${monthsAhead}`)
      const avgValue = data.projects.length > 0
        ? data.projects.reduce((s, p) => s + p.contract_value, 0) / data.projects.length
        : 50000
      futureProjects.push({
        id: `projected-${i}`,
        name: `PROJECTED ${i + 1}`,
        contract_value: avgValue * (0.7 + seed * 0.6),
        health_score: 80 + seed * 20,
        phase_completion: seed * 30,
        material_cost: avgValue * 0.3,
        status: 'pending',
        isProjected: true,
        heightMultiplier: 0.2 + seed * 0.4,
        materialMaturity: seed * 0.3,
      })
    }

    // Future invoices: existing unpaid (still unpaid) + projected new
    const currentUnpaid = data.invoices.filter(inv =>
      inv.status !== 'paid' && inv.status !== 'cancelled'
    )
    const futureInvoices: TemporalInvoice[] = currentUnpaid.map(inv => ({
      id: inv.id,
      project_id: inv.project_id,
      amount: inv.amount,
      status: inv.status,
      unpaidAtDate: true,
      isProjected: false,
    }))

    // River: projected based on revenue growth
    const currentBaseRevenue = data.invoices.filter(inv => inv.paid_at).reduce((s, inv) => s + inv.amount, 0)
    const riverWidthMultiplier = clamp((projectedRevenue / Math.max(currentBaseRevenue, 1)) * 0.8, 0.2, 3.0)

    // Projected fog: assume improvement over time
    const improvementFactor = clamp(monthsAhead / 24, 0, 0.5)

    return {
      mode: 'future',
      viewDate: targetDate,
      presentDate,
      projects: futureProjects,
      invoices: futureInvoices,
      river: {
        widthMultiplier: riverWidthMultiplier,
        revenueCollected: projectedRevenue,
        opacity: 0.6,
        color: `rgba(40, ${Math.round(120 + improvementFactor * 100)}, ${Math.round(200 + improvementFactor * 55)}, 0.7)`,
      },
      fog: {
        bandwidth: clamp(0.4 - improvementFactor * 0.2, 0.1, 0.9),
        revenue: clamp(0.5 - improvementFactor * 0.3, 0.1, 0.9),
        security: clamp(0.4 - improvementFactor * 0.2, 0.1, 0.9),
        improvement: clamp(0.6 - improvementFactor * 0.4, 0.1, 0.9),
      },
      towers: data.hubEvents.map(ev => ({
        id: ev.id,
        event_type: ev.event_type,
        existedAtDate: true,
        isProjected: false,
      })),
      crew: data.crewMembers.map(c => ({
        id: c.id,
        name: c.name,
        activeAtDate: c.active,
        isProjected: false,
      })),
      totalRevenueAtDate: projectedRevenue,
      activeProjectCount: futureProjects.filter(p =>
        p.status === 'in_progress' || p.status === 'approved' || p.isProjected
      ).length,
      monthsOffset: offsetMonths,
    }
  }
}

// ── React Context ─────────────────────────────────────────────────────────────

interface TemporalEngineState {
  /** Currently viewed date */
  viewDate: Date
  /** Current snapshot (null if data not loaded) */
  snapshot: TemporalSnapshot | null
  /** Whether temporal mode is active (slider visible) */
  active: boolean
  /** Playback state */
  isPlaying: boolean
  playSpeed: 1 | 2
  /** Shift key held = comparison mode */
  comparisonMode: boolean
  /** Saved projection multipliers from NW34 */
  projectionMultipliers?: { revenueGrowthPerMonth: number; projectGrowthPerMonth: number }
}

interface TemporalEngineActions {
  setViewDate: (d: Date) => void
  snapToPresent: () => void
  setActive: (v: boolean) => void
  togglePlay: () => void
  setPlaySpeed: (s: 1 | 2) => void
  setComparisonMode: (v: boolean) => void
}

type TemporalContextValue = TemporalEngineState & TemporalEngineActions & {
  worldData: NWWorldData | null
}

const TemporalContext = createContext<TemporalContextValue | null>(null)

// ── Provider ──────────────────────────────────────────────────────────────────

interface TemporalProviderProps {
  worldData: NWWorldData | null
  children: React.ReactNode
}

export function TemporalProvider({ worldData, children }: TemporalProviderProps) {
  const presentDate = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  }, [])

  const [viewDate, setViewDateRaw] = useState<Date>(presentDate)
  const [active, setActive] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playSpeed, setPlaySpeed] = useState<1 | 2>(1)
  const [comparisonMode, setComparisonMode] = useState(false)

  const playTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const setViewDate = useCallback((d: Date) => {
    setViewDateRaw(d)
    // Dispatch event for layers to react
    window.dispatchEvent(new CustomEvent('nw:temporal-change', {
      detail: {
        viewDate: d.toISOString(),
        mode: d.getTime() < presentDate.getTime() - 86400000 ? 'past'
          : d.getTime() > presentDate.getTime() + 86400000 ? 'future'
          : 'present',
        monthsOffset: monthsBetween(presentDate, d),
      }
    }))
  }, [presentDate])

  const snapToPresent = useCallback(() => {
    setIsPlaying(false)
    if (playTimerRef.current) clearInterval(playTimerRef.current)
    setViewDate(presentDate)
  }, [presentDate, setViewDate])

  // Playback: auto-advance from current position toward present
  const togglePlay = useCallback(() => {
    if (isPlaying) {
      setIsPlaying(false)
      if (playTimerRef.current) clearInterval(playTimerRef.current)
      return
    }
    setIsPlaying(true)
    const msPerTick = (3000 / playSpeed)  // 3 seconds per month at 1x
    playTimerRef.current = setInterval(() => {
      setViewDateRaw(prev => {
        const next = new Date(prev)
        next.setMonth(next.getMonth() + 1)
        if (next.getTime() >= presentDate.getTime()) {
          setIsPlaying(false)
          if (playTimerRef.current) clearInterval(playTimerRef.current)
          return presentDate
        }
        setViewDate(next)
        return next
      })
    }, msPerTick)
  }, [isPlaying, playSpeed, presentDate, setViewDate])

  const snapshot = useMemo((): TemporalSnapshot | null => {
    if (!worldData) return null
    return buildTemporalSnapshot(worldData, viewDate, presentDate)
  }, [worldData, viewDate, presentDate])

  const value: TemporalContextValue = {
    viewDate,
    snapshot,
    active,
    isPlaying,
    playSpeed,
    comparisonMode,
    setViewDate,
    snapToPresent,
    setActive,
    togglePlay,
    setPlaySpeed: (s) => setPlaySpeed(s),
    setComparisonMode,
    worldData,
  }

  return (
    <TemporalContext.Provider value={value}>
      {children}
    </TemporalContext.Provider>
  )
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useTemporalEngine(): TemporalContextValue {
  const ctx = useContext(TemporalContext)
  if (!ctx) throw new Error('useTemporalEngine must be used within TemporalProvider')
  return ctx
}

// ── Standalone helper (no context needed) ────────────────────────────────────

/**
 * Compute the present date clamped to midnight.
 */
export function getPresentDate(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

/**
 * Format a date for the HUD label.
 * e.g. "APR 2026" or "OCT 2025"
 */
export function formatTemporalLabel(d: Date): string {
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']
  return `${months[d.getMonth()]} ${d.getFullYear()}`
}

/**
 * Add N months to a date, returning a new Date.
 */
export function addMonths(d: Date, n: number): Date {
  const result = new Date(d)
  result.setMonth(result.getMonth() + n)
  return result
}
