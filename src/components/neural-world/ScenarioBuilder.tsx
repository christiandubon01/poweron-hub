/**
 * ScenarioBuilder.tsx — NW6: Interactive scenario panel for Neural World.
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

// ── Helpers ────────────────────────────────────────────────────────────────────

function multiplierToPercent(m: number): number {
  return Math.round((m - 1.0) * 100)
}

function percentToMultiplier(p: number): number {
  return 1.0 + p / 100
}

/** Compute average health delta from overrides (used for sky shift signal) */
function computeHealthDelta(overrides: ScenarioOverrides): number {
  const values = Object.values(overrides)
  if (values.length === 0) return 0
  const avg = values.reduce((s, v) => s + v, 0) / values.length
  return avg - 1.0   // 0 = no change, + = healthier, - = unhealthier
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

// ── Component ──────────────────────────────────────────────────────────────────

export function ScenarioBuilder({ onScenarioModeChange, onCompareModeChange }: ScenarioBuildingProps) {
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

  const overridesRef = useRef<ScenarioOverrides>(overrides)
  overridesRef.current = overrides

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
    if (scenarioActive) {
      dispatchScenarioOverride(overrides)
      // Dispatch health delta for sky shift
      const delta = computeHealthDelta(overrides)
      window.dispatchEvent(
        new CustomEvent('nw:scenario-health', { detail: { delta } })
      )
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overrides, scenarioActive])

  // ── Toggle scenario mode ───────────────────────────────────────────────────

  function toggleScenarioMode() {
    const next = !scenarioActive
    setScenarioActive(next)
    onScenarioModeChange(next)
    dispatchScenarioActivate(next)

    if (!next) {
      // Reset all overrides to 1.0 when deactivating
      const reset: ScenarioOverrides = {}
      for (const p of projects) reset[p.id] = 1.0
      setOverrides(reset)
      dispatchScenarioOverride(reset)
      // If compare mode was on, turn it off
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

  // ── Update single override ─────────────────────────────────────────────────

  function updateOverride(projectId: string, multiplier: number) {
    setOverrides(prev => ({ ...prev, [projectId]: Math.max(0.05, Math.min(3.0, multiplier)) }))
  }

  // ── Reset all overrides to 1.0 ─────────────────────────────────────────────

  function resetAllOverrides() {
    const reset: ScenarioOverrides = {}
    for (const p of projects) reset[p.id] = 1.0
    setOverrides(reset)
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
    setOverrides(merged)

    if (!scenarioActive) {
      setScenarioActive(true)
      onScenarioModeChange(true)
      dispatchScenarioActivate(true)
    }
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
              {healthLabel}
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

          {projects.map(p => {
            const m = overrides[p.id] ?? 1.0
            const pct = multiplierToPercent(m)
            const changed = Math.abs(m - 1.0) > 0.02

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
                    disabled={!scenarioActive}
                    title={`${p.name}: ${pct >= 0 ? '+' : ''}${pct}%`}
                  />
                </div>

                {/* Project info + value */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 9,
                    color: changed ? AMBER : 'rgba(255,255,255,0.55)',
                    fontFamily: 'monospace',
                    letterSpacing: 0.5,
                    textOverflow: 'ellipsis',
                    overflow: 'hidden',
                    whiteSpace: 'nowrap',
                    maxWidth: 160,
                  }}>
                    {p.name}
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
              style={{
                marginTop: 4,
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.12)',
                color: 'rgba(255,255,255,0.4)',
                padding: '5px 10px',
                borderRadius: 3,
                fontSize: 9,
                letterSpacing: 1.2,
                cursor: 'pointer',
                fontFamily: 'monospace',
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
