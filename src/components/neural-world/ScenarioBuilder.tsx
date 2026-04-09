/**
 * ScenarioBuilder.tsx — NW6/NW22: Interactive scenario panel for Neural World.
 *
 * NW22 additions:
 * - 5 operation types: SERVICE | PROJECT | SOLAR | COMMERCIAL | BALANCED
 * - 5 size presets: SOLO | TEAM_5 | TEAM_20 | TEAM_50 | TEAM_100
 * - Multiplier table drives terrain overrides — no hardcoded per-combination values
 * - 2-second animated transitions when switching scenarios
 * - Badge label: "SCENARIO: SOLAR x TEAM_20"
 * - onSelectionChange callback for parent badge updates
 *
 * - Collapsible panel on the left side of the canvas.
 * - Toggle button to open/close panel.
 * - In scenario mode terrain becomes interactive (sliders rescale mountain heights).
 * - Dispatches 'nw:scenario-override' events for Three.js layers to respond.
 * - Dispatches 'nw:scenario-activate' events for mode changes.
 * - Saves named snapshots to Supabase neural_world_settings.scenarios array.
 * - Compare mode: signals NeuralWorldView to split canvas 50/50.
 * - Scenario data is projection only — never overwrites real Supabase data.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react'
import { subscribeWorldData, type NWProject } from './DataBridge'
import { supabase } from '@/lib/supabase'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ScenarioOverrides {
  [projectId: string]: number   // heightMultiplier: 0.0 – 3.0 (1.0 = no change)
}

export interface ScenarioSnapshot {
  id: string
  name: string
  createdAt: string
  overrides: ScenarioOverrides
}

export interface ScenarioBuildingProps {
  /** Called when scenario mode activates/deactivates */
  onScenarioModeChange: (active: boolean) => void
  /** Called when compare mode activates/deactivates */
  onCompareModeChange: (active: boolean) => void
  /** NW22: Called when op type or size changes — provides badge label */
  onSelectionChange?: (label: string) => void
}

// ── NW22: Operation type definitions ──────────────────────────────────────────

export type OpType = 'SERVICE' | 'PROJECT' | 'SOLAR' | 'COMMERCIAL' | 'BALANCED'
export type SizePreset = 'SOLO' | 'TEAM_5' | 'TEAM_20' | 'TEAM_50' | 'TEAM_100'

interface OpTypeProfile {
  id: OpType
  label: string
  icon: string
  description: string
  /** Multiplier applied to service-category projects */
  serviceM: number
  /** Multiplier applied to project-category projects */
  projectM: number
  /** Multiplier applied to solar-category projects */
  solarM: number
  /** Extra metadata dispatched via event (informational) */
  invoiceFreqFactor: number
  materialDepthFactor: number
  crewRidgeFactor: number
}

const OP_PROFILES: Record<OpType, OpTypeProfile> = {
  SERVICE: {
    id: 'SERVICE',
    label: 'SERVICE',
    icon: '⚙',
    description: '70% service / 30% projects — fast cycles, low material',
    serviceM: 1.3,
    projectM: 0.65,
    solarM: 0.5,
    invoiceFreqFactor: 1.8,
    materialDepthFactor: 0.4,
    crewRidgeFactor: 0.7,
  },
  PROJECT: {
    id: 'PROJECT',
    label: 'PROJECT',
    icon: '▲',
    description: '30% service / 70% projects — tall peaks, deep materials',
    serviceM: 0.55,
    projectM: 1.6,
    solarM: 0.85,
    invoiceFreqFactor: 0.6,
    materialDepthFactor: 1.7,
    crewRidgeFactor: 1.4,
  },
  SOLAR: {
    id: 'SOLAR',
    label: 'SOLAR',
    icon: '☀',
    description: 'Solar specialist — MTZ expands, Enphase/RMO income',
    serviceM: 0.7,
    projectM: 0.9,
    solarM: 2.3,
    invoiceFreqFactor: 0.9,
    materialDepthFactor: 1.2,
    crewRidgeFactor: 1.0,
  },
  COMMERCIAL: {
    id: 'COMMERCIAL',
    label: 'COMMERCIAL',
    icon: '🏢',
    description: 'Commercial TI — massive peaks, deep compliance, long timeline',
    serviceM: 0.35,
    projectM: 2.6,
    solarM: 0.3,
    invoiceFreqFactor: 0.35,
    materialDepthFactor: 2.2,
    crewRidgeFactor: 1.9,
  },
  BALANCED: {
    id: 'BALANCED',
    label: 'BALANCED',
    icon: '◈',
    description: 'Balanced — reflects actual data ratios',
    serviceM: 1.0,
    projectM: 1.0,
    solarM: 1.0,
    invoiceFreqFactor: 1.0,
    materialDepthFactor: 1.0,
    crewRidgeFactor: 1.0,
  },
}

interface SizePresetDef {
  id: SizePreset
  label: string
  scale: number  // overall height scale multiplier
}

const SIZE_PRESETS: SizePresetDef[] = [
  { id: 'SOLO',     label: 'SOLO', scale: 0.55 },
  { id: 'TEAM_5',   label: '5',    scale: 0.82 },
  { id: 'TEAM_20',  label: '20',   scale: 1.15 },
  { id: 'TEAM_50',  label: '50',   scale: 1.70 },
  { id: 'TEAM_100', label: '100',  scale: 2.50 },
]

/** Derive project "kind" from NWProject.type field for multiplier selection */
function getProjectKind(p: NWProject): 'service' | 'project' | 'solar' {
  const t = (p.type ?? '').toLowerCase()
  const name = p.name.toLowerCase()
  if (
    t.includes('solar') || t.includes('pv') || t.includes('photovoltaic') ||
    name.includes('solar') || name.includes('enphase') || name.includes('rmo')
  ) return 'solar'
  if (
    t.includes('service') || t.includes('maintenance') || t.includes('repair') ||
    t.includes('troubleshoot') || t.includes('callback') ||
    name.includes('service') || name.includes('cb ') || name.includes('maint')
  ) return 'service'
  return 'project'
}

/**
 * Compute target overrides for a given op type + size + project list.
 * Uses multiplier tables — NOT hardcoded per combination.
 */
function computeTargetOverrides(
  projects: NWProject[],
  opType: OpType,
  sizePreset: SizePreset,
): ScenarioOverrides {
  const profile = OP_PROFILES[opType]
  const sizeDef  = SIZE_PRESETS.find(s => s.id === sizePreset) ?? SIZE_PRESETS[2]
  const result: ScenarioOverrides = {}

  for (const p of projects) {
    const kind = getProjectKind(p)
    let kindM: number
    if (kind === 'solar')   kindM = profile.solarM
    else if (kind === 'service') kindM = profile.serviceM
    else                    kindM = profile.projectM

    // Clamp to valid range [0.05, 3.0]
    const raw = kindM * sizeDef.scale
    result[p.id] = Math.max(0.05, Math.min(3.0, raw))
  }
  return result
}

/** Build the badge label string */
function buildSelectionLabel(opType: OpType, sizePreset: SizePreset): string {
  const sizeDef = SIZE_PRESETS.find(s => s.id === sizePreset)
  return `${opType} × ${sizeDef ? 'TEAM_' + sizeDef.label : sizePreset}`
    .replace('TEAM_SOLO', 'SOLO')
}

// ── Event helpers ──────────────────────────────────────────────────────────────

/** Fire scenario override event — all listening Three.js layers respond in realtime */
export function dispatchScenarioOverride(overrides: ScenarioOverrides) {
  window.dispatchEvent(
    new CustomEvent<{ overrides: ScenarioOverrides }>('nw:scenario-override', {
      detail: { overrides },
    })
  )
}

/** Fire scenario activate/deactivate event */
export function dispatchScenarioActivate(active: boolean) {
  window.dispatchEvent(
    new CustomEvent<{ active: boolean }>('nw:scenario-activate', {
      detail: { active },
    })
  )
}

/** NW22: Dispatch operation-type metadata for layers that want to react */
function dispatchOpTypeSignal(profile: OpTypeProfile, sizeDef: SizePresetDef) {
  window.dispatchEvent(
    new CustomEvent('nw:scenario-op-type', {
      detail: {
        opType: profile.id,
        sizePreset: sizeDef.id,
        invoiceFreqFactor: profile.invoiceFreqFactor,
        materialDepthFactor: profile.materialDepthFactor,
        crewRidgeFactor: profile.crewRidgeFactor,
        sizeScale: sizeDef.scale,
      },
    })
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function multiplierToPercent(m: number): number {
  return Math.round((m - 1.0) * 100)
}

/** Compute average health delta from overrides (used for sky shift signal) */
function computeHealthDelta(overrides: ScenarioOverrides): number {
  const values = Object.values(overrides)
  if (values.length === 0) return 0
  const avg = values.reduce((s, v) => s + v, 0) / values.length
  return avg - 1.0   // 0 = no change, + = healthier, - = unhealthier
}

/** Linearly interpolate between two override maps over t ∈ [0, 1] */
function lerpOverrides(
  from: ScenarioOverrides,
  to: ScenarioOverrides,
  t: number,
): ScenarioOverrides {
  const result: ScenarioOverrides = {}
  const keys = new Set([...Object.keys(from), ...Object.keys(to)])
  for (const k of keys) {
    const a = from[k] ?? 1.0
    const b = to[k]   ?? 1.0
    result[k] = a + (b - a) * t
  }
  return result
}

// ── Style helpers ──────────────────────────────────────────────────────────────

const AMBER  = '#f59e0b'
const TEAL   = '#00e5cc'
const RED    = '#ef4444'
const PANEL_BG = 'rgba(8, 12, 18, 0.94)'
const BORDER = 'rgba(245, 158, 11, 0.3)'

function btnStyle(active: boolean, accent: string): React.CSSProperties {
  return {
    background: active ? `${accent}22` : 'rgba(255,255,255,0.04)',
    border: `1px solid ${active ? accent : 'rgba(255,255,255,0.12)'}`,
    color: active ? accent : 'rgba(255,255,255,0.5)',
    padding: '5px 12px',
    borderRadius: 3,
    fontSize: 10,
    letterSpacing: 1.2,
    cursor: 'pointer',
    fontFamily: 'monospace',
    transition: 'all 0.15s ease',
    whiteSpace: 'nowrap' as const,
  }
}

// ── Transition duration (ms) ──────────────────────────────────────────────────
const TRANSITION_MS = 2000

// ── Component ──────────────────────────────────────────────────────────────────

export function ScenarioBuilder({
  onScenarioModeChange,
  onCompareModeChange,
  onSelectionChange,
}: ScenarioBuildingProps) {
  const [panelOpen,      setPanelOpen]      = useState(false)
  const [scenarioActive, setScenarioActive] = useState(false)
  const [compareMode,    setCompareMode]    = useState(false)
  const [projects,       setProjects]       = useState<NWProject[]>([])
  const [overrides,      setOverrides]      = useState<ScenarioOverrides>({})
  const [savedScenarios, setSavedScenarios] = useState<ScenarioSnapshot[]>([])
  const [saveName,       setSaveName]       = useState('')
  const [saving,         setSaving]         = useState(false)
  const [selectedLoad,   setSelectedLoad]   = useState('')
  const [orgId,          setOrgId]          = useState<string | null>(null)
  const [loadError,      setLoadError]      = useState('')

  // NW22: operation type + size preset state
  const [opType,      setOpType]      = useState<OpType>('BALANCED')
  const [sizePreset,  setSizePreset]  = useState<SizePreset>('TEAM_20')
  const [transitioning, setTransitioning] = useState(false)

  const overridesRef       = useRef<ScenarioOverrides>(overrides)
  const projectsRef        = useRef<NWProject[]>(projects)
  const animFrameRef       = useRef<number>(0)
  const animStartRef       = useRef<number>(0)
  const animFromRef        = useRef<ScenarioOverrides>({})
  const animToRef          = useRef<ScenarioOverrides>({})

  overridesRef.current = overrides
  projectsRef.current  = projects

  // ── NW22: Animate overrides from current → target over TRANSITION_MS ──────

  const startTransition = useCallback((targetOverrides: ScenarioOverrides) => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)

    animFromRef.current = { ...overridesRef.current }
    animToRef.current   = targetOverrides
    animStartRef.current = performance.now()
    setTransitioning(true)

    function step(now: number) {
      const elapsed = now - animStartRef.current
      const t = Math.min(elapsed / TRANSITION_MS, 1.0)
      // Ease out cubic
      const eased = 1 - Math.pow(1 - t, 3)
      const interpolated = lerpOverrides(animFromRef.current, animToRef.current, eased)
      setOverrides(interpolated)
      dispatchScenarioOverride(interpolated)
      const delta = computeHealthDelta(interpolated)
      window.dispatchEvent(new CustomEvent('nw:scenario-health', { detail: { delta } }))

      if (t < 1.0) {
        animFrameRef.current = requestAnimationFrame(step)
      } else {
        setTransitioning(false)
        animFrameRef.current = 0
      }
    }
    animFrameRef.current = requestAnimationFrame(step)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Cleanup animation on unmount ─────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    }
  }, [])

  // ── NW22: Notify parent of selection label ────────────────────────────────

  useEffect(() => {
    const label = buildSelectionLabel(opType, sizePreset)
    onSelectionChange?.(label)
  }, [opType, sizePreset, onSelectionChange])

  // ── Load org + saved scenarios from Supabase ────────────────────────────────

  const loadSupabaseScenarios = useCallback(async () => {
    try {
      const { data: { user } } = await (supabase as any).auth.getUser()
      if (!user) return

      const { data: profile } = await (supabase as any)
        .from('profiles')
        .select('org_id')
        .eq('id', user.id)
        .maybeSingle()

      const oid: string | null = profile?.org_id ?? null
      if (!oid) return
      setOrgId(oid)

      const { data: settings } = await (supabase as any)
        .from('neural_world_settings')
        .select('scenarios')
        .eq('org_id', oid)
        .maybeSingle()

      if (!settings) return

      const raw = settings.scenarios
      if (Array.isArray(raw)) {
        setSavedScenarios(raw as ScenarioSnapshot[])
      }
    } catch (err) {
      console.warn('[ScenarioBuilder] loadSupabaseScenarios error:', err)
    }
  }, [])

  useEffect(() => {
    loadSupabaseScenarios()
  }, [loadSupabaseScenarios])

  // ── Subscribe to world data for project list ───────────────────────────────

  useEffect(() => {
    const unsub = subscribeWorldData((data) => {
      setProjects(data.projects)
      // Initialize overrides for any new projects at 1.0
      setOverrides(prev => {
        const next = { ...prev }
        for (const p of data.projects) {
          if (!(p.id in next)) next[p.id] = 1.0
        }
        return next
      })
    })
    return unsub
  }, [])

  // ── Dispatch override events whenever overrides change (in scenario mode) ──

  useEffect(() => {
    if (scenarioActive && !transitioning) {
      // Already dispatched during animation; only dispatch here for manual slider changes
      dispatchScenarioOverride(overrides)
      const delta = computeHealthDelta(overrides)
      window.dispatchEvent(
        new CustomEvent('nw:scenario-health', { detail: { delta } })
      )
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overrides, scenarioActive])

  // ── NW22: Apply preset when op type or size changes (if scenario active) ──

  const applyPreset = useCallback((newOpType: OpType, newSizePreset: SizePreset) => {
    if (!scenarioActive) return
    const targetOverrides = computeTargetOverrides(
      projectsRef.current,
      newOpType,
      newSizePreset,
    )
    startTransition(targetOverrides)

    // Dispatch op-type signal for layers
    const profile  = OP_PROFILES[newOpType]
    const sizeDef  = SIZE_PRESETS.find(s => s.id === newSizePreset) ?? SIZE_PRESETS[2]
    dispatchOpTypeSignal(profile, sizeDef)
  }, [scenarioActive, startTransition])

  function handleOpTypeChange(type: OpType) {
    setOpType(type)
    applyPreset(type, sizePreset)
  }

  function handleSizePresetChange(size: SizePreset) {
    setSizePreset(size)
    applyPreset(opType, size)
  }

  // ── Toggle scenario mode ───────────────────────────────────────────────────

  function toggleScenarioMode() {
    const next = !scenarioActive
    setScenarioActive(next)
    onScenarioModeChange(next)
    dispatchScenarioActivate(next)

    if (next) {
      // Activate: compute and animate to current preset
      const targetOverrides = computeTargetOverrides(projects, opType, sizePreset)
      startTransition(targetOverrides)
      const profile = OP_PROFILES[opType]
      const sizeDef = SIZE_PRESETS.find(s => s.id === sizePreset) ?? SIZE_PRESETS[2]
      dispatchOpTypeSignal(profile, sizeDef)
    } else {
      // Deactivate: animate back to 1.0 baseline
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
      const reset: ScenarioOverrides = {}
      for (const p of projects) reset[p.id] = 1.0
      startTransition(reset)
      if (compareMode) {
        setCompareMode(false)
        onCompareModeChange(false)
      }
    }
  }

  // ── Toggle compare mode ────────────────────────────────────────────────────

  function toggleCompareMode() {
    if (!scenarioActive) return
    const next = !compareMode
    setCompareMode(next)
    onCompareModeChange(next)
  }

  // ── Update single override (manual slider) ─────────────────────────────────

  function updateOverride(projectId: string, multiplier: number) {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current)
      animFrameRef.current = 0
      setTransitioning(false)
    }
    setOverrides(prev => ({ ...prev, [projectId]: Math.max(0.05, Math.min(3.0, multiplier)) }))
  }

  // ── Reset all overrides to 1.0 ─────────────────────────────────────────────

  function resetAllOverrides() {
    const reset: ScenarioOverrides = {}
    for (const p of projects) reset[p.id] = 1.0
    startTransition(reset)
  }

  // ── Save scenario to Supabase ──────────────────────────────────────────────

  async function saveScenario() {
    if (!saveName.trim() || !orgId) return
    setSaving(true)
    try {
      const newSnapshot: ScenarioSnapshot = {
        id: `sc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: saveName.trim(),
        createdAt: new Date().toISOString(),
        overrides: { ...overrides },
      }

      const updatedList = [...savedScenarios, newSnapshot]

      await (supabase as any)
        .from('neural_world_settings')
        .upsert(
          { org_id: orgId, scenarios: updatedList },
          { onConflict: 'org_id' }
        )

      setSavedScenarios(updatedList)
      setSaveName('')
    } catch (err) {
      console.warn('[ScenarioBuilder] saveScenario error:', err)
    } finally {
      setSaving(false)
    }
  }

  // ── Load scenario from dropdown ────────────────────────────────────────────

  function loadScenario() {
    const snap = savedScenarios.find(s => s.id === selectedLoad)
    if (!snap) { setLoadError('Scenario not found'); return }
    setLoadError('')

    // Merge overrides, keeping 1.0 for any projects not in snapshot
    const merged: ScenarioOverrides = {}
    for (const p of projects) merged[p.id] = snap.overrides[p.id] ?? 1.0

    if (!scenarioActive) {
      setScenarioActive(true)
      onScenarioModeChange(true)
      dispatchScenarioActivate(true)
    }
    startTransition(merged)
  }

  // ── Delete scenario ────────────────────────────────────────────────────────

  async function deleteScenario(id: string) {
    if (!orgId) return
    try {
      const updatedList = savedScenarios.filter(s => s.id !== id)
      await (supabase as any)
        .from('neural_world_settings')
        .upsert(
          { org_id: orgId, scenarios: updatedList },
          { onConflict: 'org_id' }
        )
      setSavedScenarios(updatedList)
      if (selectedLoad === id) setSelectedLoad('')
    } catch (err) {
      console.warn('[ScenarioBuilder] deleteScenario error:', err)
    }
  }

  // ── Compute overall health delta for display ───────────────────────────────

  const healthDelta = computeHealthDelta(overrides)
  const healthLabel =
    healthDelta > 0.1 ? `+${Math.round(healthDelta * 100)}% projected growth` :
    healthDelta < -0.1 ? `${Math.round(healthDelta * 100)}% projected contraction` :
    'Baseline — no change'

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Toggle button — always visible */}
      <button
        onClick={() => setPanelOpen(v => !v)}
        style={{
          position: 'absolute',
          left: panelOpen ? 296 : 12,
          top: 16,
          zIndex: 20,
          background: scenarioActive ? `${AMBER}22` : 'rgba(8,12,18,0.88)',
          border: `1px solid ${scenarioActive ? AMBER : 'rgba(255,255,255,0.15)'}`,
          color: scenarioActive ? AMBER : 'rgba(255,255,255,0.6)',
          padding: '6px 10px',
          borderRadius: 4,
          fontSize: 11,
          letterSpacing: 1.5,
          cursor: 'pointer',
          fontFamily: 'monospace',
          transition: 'left 0.25s ease, all 0.15s ease',
          lineHeight: 1,
        }}
        title={panelOpen ? 'Close scenario panel' : 'Open scenario builder'}
      >
        {panelOpen ? '◀ CLOSE' : '◈ SCENARIO'}
      </button>

      {/* Panel */}
      <div
        style={{
          position: 'absolute',
          left: panelOpen ? 0 : -290,
          top: 0,
          bottom: 0,
          width: 286,
          zIndex: 15,
          background: PANEL_BG,
          borderRight: `1px solid ${BORDER}`,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          transition: 'left 0.25s ease',
          pointerEvents: panelOpen ? 'auto' : 'none',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '14px 14px 10px',
          borderBottom: `1px solid ${BORDER}`,
        }}>
          <div style={{
            fontSize: 11,
            letterSpacing: 2,
            color: AMBER,
            fontFamily: 'monospace',
            marginBottom: 8,
          }}>
            ◈ NEURAL WORLD SCENARIO BUILDER
          </div>

          {/* Scenario mode toggle */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              onClick={toggleScenarioMode}
              style={btnStyle(scenarioActive, AMBER)}
            >
              {scenarioActive ? '⬛ DEACTIVATE' : '▶ ACTIVATE SCENARIO'}
            </button>
            <button
              onClick={toggleCompareMode}
              disabled={!scenarioActive}
              style={{
                ...btnStyle(compareMode, '#60a5fa'),
                opacity: scenarioActive ? 1 : 0.35,
                cursor: scenarioActive ? 'pointer' : 'not-allowed',
              }}
            >
              ⊞ COMPARE {compareMode ? 'ON' : 'OFF'}
            </button>
          </div>

          {scenarioActive && (
            <div style={{
              marginTop: 8,
              fontSize: 10,
              color: healthDelta > 0.05 ? '#4ade80' : healthDelta < -0.05 ? '#f87171' : 'rgba(255,255,255,0.4)',
              fontFamily: 'monospace',
              letterSpacing: 0.5,
            }}>
              {transitioning ? '⟳ TRANSITIONING…' : healthLabel}
            </div>
          )}
        </div>

        {/* NW22: Operation Type + Size Selectors */}
        <div style={{
          padding: '10px 14px 8px',
          borderBottom: `1px solid rgba(245,158,11,0.15)`,
        }}>
          {/* Operation Type row */}
          <div style={{
            fontSize: 8,
            color: 'rgba(255,255,255,0.35)',
            letterSpacing: 1.5,
            fontFamily: 'monospace',
            marginBottom: 5,
          }}>
            OPERATION TYPE
          </div>
          <div style={{ display: 'flex', gap: 3, marginBottom: 8 }}>
            {(Object.keys(OP_PROFILES) as OpType[]).map(ot => {
              const p = OP_PROFILES[ot]
              const active = opType === ot
              return (
                <button
                  key={ot}
                  onClick={() => handleOpTypeChange(ot)}
                  title={p.description}
                  style={{
                    flex: 1,
                    padding: '4px 2px',
                    fontSize: 7.5,
                    letterSpacing: 0.3,
                    fontFamily: 'monospace',
                    borderRadius: 3,
                    border: `1px solid ${active ? AMBER : 'rgba(255,255,255,0.1)'}`,
                    background: active ? `${AMBER}22` : 'rgba(255,255,255,0.03)',
                    color: active ? AMBER : 'rgba(255,255,255,0.45)',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                    textAlign: 'center' as const,
                    lineHeight: 1.4,
                  }}
                >
                  <div style={{ fontSize: 10 }}>{p.icon}</div>
                  <div>{p.label}</div>
                </button>
              )
            })}
          </div>

          {/* Size Preset row */}
          <div style={{
            fontSize: 8,
            color: 'rgba(255,255,255,0.35)',
            letterSpacing: 1.5,
            fontFamily: 'monospace',
            marginBottom: 5,
          }}>
            TEAM SIZE
          </div>
          <div style={{ display: 'flex', gap: 3 }}>
            {SIZE_PRESETS.map(sp => {
              const active = sizePreset === sp.id
              return (
                <button
                  key={sp.id}
                  onClick={() => handleSizePresetChange(sp.id)}
                  style={{
                    flex: 1,
                    padding: '4px 2px',
                    fontSize: 8,
                    letterSpacing: 0.3,
                    fontFamily: 'monospace',
                    borderRadius: 3,
                    border: `1px solid ${active ? TEAL : 'rgba(255,255,255,0.1)'}`,
                    background: active ? `${TEAL}22` : 'rgba(255,255,255,0.03)',
                    color: active ? TEAL : 'rgba(255,255,255,0.45)',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                    textAlign: 'center' as const,
                  }}
                >
                  {sp.label}
                </button>
              )
            })}
          </div>

          {/* Current selection display */}
          {scenarioActive && (
            <div style={{
              marginTop: 6,
              fontSize: 9,
              color: AMBER,
              fontFamily: 'monospace',
              letterSpacing: 0.8,
              textAlign: 'center',
              background: `${AMBER}11`,
              borderRadius: 3,
              padding: '3px 0',
            }}>
              {OP_PROFILES[opType].description}
            </div>
          )}
        </div>

        {/* Mountain sliders — scrollable */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '10px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}>
          {projects.length === 0 && (
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace', padding: '20px 0' }}>
              No project terrain loaded yet…
            </div>
          )}

          {projects.length > 0 && (
            <div style={{
              fontSize: 8,
              color: 'rgba(255,255,255,0.25)',
              fontFamily: 'monospace',
              letterSpacing: 0.5,
            }}>
              FINE TUNE — drag to override
            </div>
          )}

          {projects.map(p => {
            const m = overrides[p.id] ?? 1.0
            const pct = multiplierToPercent(m)
            const changed = Math.abs(m - 1.0) > 0.02
            const kind = getProjectKind(p)
            const kindColor = kind === 'solar' ? '#ffe060' : kind === 'service' ? TEAL : '#60a5fa'

            return (
              <div key={p.id} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                opacity: scenarioActive ? 1 : 0.4,
                pointerEvents: scenarioActive ? 'auto' : 'none',
              }}>
                {/* Vertical slider */}
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  flexShrink: 0,
                  width: 24,
                }}>
                  <input
                    type="range"
                    min={5}
                    max={300}
                    step={5}
                    value={Math.round(m * 100)}
                    onChange={e => updateOverride(p.id, Number(e.target.value) / 100)}
                    style={{
                      writingMode: 'vertical-lr' as React.CSSProperties['writingMode'],
                      direction: 'rtl' as React.CSSProperties['direction'],
                      width: 8,
                      height: 80,
                      cursor: 'ns-resize',
                      accentColor: changed ? AMBER : TEAL,
                      background: 'transparent',
                    }}
                    disabled={!scenarioActive || transitioning}
                    title={`${p.name}: ${pct >= 0 ? '+' : ''}${pct}%`}
                  />
                </div>

                {/* Project info + value */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 1 }}>
                    <span style={{
                      fontSize: 7,
                      color: kindColor,
                      fontFamily: 'monospace',
                      letterSpacing: 0.3,
                      flexShrink: 0,
                    }}>
                      {kind === 'solar' ? '☀' : kind === 'service' ? '⚙' : '▲'}
                    </span>
                    <div style={{
                      fontSize: 9,
                      color: changed ? AMBER : 'rgba(255,255,255,0.55)',
                      fontFamily: 'monospace',
                      letterSpacing: 0.5,
                      textOverflow: 'ellipsis',
                      overflow: 'hidden',
                      whiteSpace: 'nowrap',
                      maxWidth: 140,
                    }}>
                      {p.name}
                    </div>
                  </div>
                  <div style={{
                    fontSize: 10,
                    color: changed
                      ? pct > 0 ? '#4ade80' : '#f87171'
                      : 'rgba(255,255,255,0.3)',
                    fontFamily: 'monospace',
                    marginTop: 2,
                  }}>
                    {pct >= 0 ? '+' : ''}{pct}%
                    <span style={{ marginLeft: 4, fontSize: 9, color: 'rgba(255,255,255,0.2)' }}>
                      ×{m.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            )
          })}

          {/* Reset button */}
          {scenarioActive && projects.length > 0 && (
            <button
              onClick={resetAllOverrides}
              disabled={transitioning}
              style={{
                marginTop: 4,
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.12)',
                color: 'rgba(255,255,255,0.4)',
                padding: '5px 10px',
                borderRadius: 3,
                fontSize: 9,
                letterSpacing: 1.2,
                cursor: transitioning ? 'not-allowed' : 'pointer',
                fontFamily: 'monospace',
                opacity: transitioning ? 0.4 : 1,
              }}
            >
              ↺ RESET ALL TO BASELINE
            </button>
          )}
        </div>

        {/* Save section */}
        <div style={{
          padding: '10px 14px',
          borderTop: `1px solid ${BORDER}`,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', letterSpacing: 1, fontFamily: 'monospace' }}>
            SNAPSHOT
          </div>

          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="text"
              placeholder="Scenario name…"
              value={saveName}
              onChange={e => setSaveName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && saveScenario()}
              style={{
                flex: 1,
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 3,
                color: 'rgba(255,255,255,0.8)',
                padding: '4px 8px',
                fontSize: 10,
                fontFamily: 'monospace',
                outline: 'none',
              }}
              disabled={!scenarioActive || saving}
            />
            <button
              onClick={saveScenario}
              disabled={!scenarioActive || !saveName.trim() || saving || !orgId}
              style={{
                background: scenarioActive && saveName.trim() ? `${AMBER}22` : 'rgba(255,255,255,0.03)',
                border: `1px solid ${scenarioActive && saveName.trim() ? AMBER : 'rgba(255,255,255,0.08)'}`,
                color: scenarioActive && saveName.trim() ? AMBER : 'rgba(255,255,255,0.2)',
                padding: '4px 10px',
                borderRadius: 3,
                fontSize: 10,
                letterSpacing: 1,
                cursor: scenarioActive && saveName.trim() && !saving ? 'pointer' : 'not-allowed',
                fontFamily: 'monospace',
                whiteSpace: 'nowrap',
              }}
            >
              {saving ? '…' : '💾 SAVE'}
            </button>
          </div>

          {/* Load section */}
          {savedScenarios.length > 0 && (
            <>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', letterSpacing: 1, fontFamily: 'monospace', marginTop: 4 }}>
                LOAD SCENARIO
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <select
                  value={selectedLoad}
                  onChange={e => setSelectedLoad(e.target.value)}
                  style={{
                    flex: 1,
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: 3,
                    color: 'rgba(255,255,255,0.8)',
                    padding: '4px 6px',
                    fontSize: 10,
                    fontFamily: 'monospace',
                    outline: 'none',
                  }}
                >
                  <option value="">— select —</option>
                  {savedScenarios.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <button
                  onClick={loadScenario}
                  disabled={!selectedLoad}
                  style={btnStyle(!!selectedLoad, TEAL)}
                >
                  LOAD
                </button>
                <button
                  onClick={() => selectedLoad && deleteScenario(selectedLoad)}
                  disabled={!selectedLoad}
                  style={{
                    ...btnStyle(!!selectedLoad, RED),
                    padding: '4px 8px',
                  }}
                >
                  ✕
                </button>
              </div>
              {loadError && (
                <div style={{ fontSize: 9, color: RED, fontFamily: 'monospace' }}>{loadError}</div>
              )}
            </>
          )}

          {/* Saved list summary */}
          {savedScenarios.length > 0 && (
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace', marginTop: 2 }}>
              {savedScenarios.length} snapshot{savedScenarios.length !== 1 ? 's' : ''} saved
            </div>
          )}

          {/* No Supabase auth hint */}
          {!orgId && (
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace' }}>
              Sign in to save/load snapshots
            </div>
          )}

          {/* Safety note */}
          <div style={{
            fontSize: 8,
            color: 'rgba(255,255,255,0.12)',
            fontFamily: 'monospace',
            letterSpacing: 0.3,
            lineHeight: 1.5,
            marginTop: 2,
          }}>
            ⚠ SCENARIO DATA IS PROJECTION ONLY<br/>
            Real Supabase data is never modified
          </div>
        </div>
      </div>
    </>
  )
}

export default ScenarioBuilder
