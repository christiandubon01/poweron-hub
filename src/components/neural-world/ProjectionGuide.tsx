/**
 * ProjectionGuide.tsx — NW34: Interactive projection guide.
 *
 * Orchestrates the full 5-step projection workflow:
 *   STEP 1 — Scenario Input (ProjectionScenarioInput)
 *   STEP 2 — World Reshape (dispatches nw:what-if-apply with projection data)
 *   STEP 3 — Guided Domain Walkthrough (ProjectionNarrator)
 *   STEP 4 — Iterate (recalculate with changed inputs)
 *   STEP 5 — Save and Compare (Supabase neural_world_settings.saved_projections)
 *
 * HUD button: "PROJECTION GUIDE" (compass+path icon) near Strategy brain button.
 * PROJECTION MODE badge: amber banner top-center showing scenario summary.
 *
 * Emits:
 *   nw:what-if-apply  — world reshape with projection changes
 *   nw:what-if-exit   — returns to real data
 *   nw:projection-narrate — triggers ProjectionNarrator walkthrough
 *
 * Listens:
 *   nw:projection-calculate — from ProjectionScenarioInput to trigger calculation
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { getWorldData } from './DataBridge'
import { callClaude, extractText } from '@/services/claudeProxy'
import ProjectionScenarioInput, { type ProjectionInputs, DEFAULT_INPUTS } from './ProjectionScenarioInput'
import ProjectionNarrator, { type NarratorStep, type ProjectionSummary } from './ProjectionNarrator'
import type { WhatIfChanges } from './WhatIfSimulator'

// ── Types ──────────────────────────────────────────────────────────────────────

interface HumanWorkerChange {
  worker_id: string
  action: 'add' | 'remove'
  type: 'office' | 'field'
}

interface ProjectionResponse extends WhatIfChanges {
  human_worker_changes: HumanWorkerChange[]
  narrator_steps: NarratorStep[]
  summary: ProjectionSummary
}

interface SavedProjection {
  id: string
  name: string
  timestamp: string
  inputs: ProjectionInputs
  result: ProjectionResponse
  scenario_label: string
}

// ── System Prompt ──────────────────────────────────────────────────────────────

function buildProjectionSystemPrompt(contextJson: string): string {
  return `You are the PowerOn Neural World PROJECTION ENGINE. The user is building a structured business projection scenario for their electrical contracting business.

Current business data:
${contextJson}

Analyze the scenario inputs and return ONLY a JSON object (no markdown, no extra text) with this exact structure:
{
  "terrain_changes": [{"node": "string", "from": "any", "to": "any", "effect": "string"}],
  "mountain_changes": [{"project": "string", "height_multiplier": number}],
  "river_changes": {"width_multiplier": number, "color_shift": "greener|bluer|redder|neutral"},
  "fog_changes": {
    "bandwidth": {"density_change": number},
    "revenue": {"density_change": number},
    "security": {"density_change": number},
    "improvement": {"density_change": number}
  },
  "agent_changes": [{"agent": "string", "flight_frequency": number}],
  "human_worker_changes": [{"worker_id": "string", "action": "add|remove", "type": "office|field"}],
  "financial_impact": {
    "monthly_revenue_delta": number,
    "monthly_cost_delta": number,
    "net_delta": number
  },
  "narrative": "2-3 sentences overall summary of this projection",
  "narrator_steps": [
    {
      "domain": "Lead Acquisition",
      "target_id": "SPARK",
      "text": "8-10 second narration for NEXUS to speak about this domain's changes",
      "duration_ms": 9000
    }
  ],
  "summary": {
    "monthly_revenue": number,
    "monthly_cost": number,
    "net_monthly": number,
    "roi_months": number,
    "risks": ["risk 1", "risk 2", "risk 3"],
    "opportunities": ["opp 1", "opp 2", "opp 3"],
    "scenario_label": "Brief scenario description"
  }
}

Rules:
- Only include narrator_steps for domains actually affected by the inputs
- narrator_steps should be 2-6 steps covering most-impacted domains
- target_id must be one of: SPARK, VAULT, LEDGER, OHM, BLUEPRINT, NEXUS, MTZ_PLATEAU, MRR_MOUNTAIN, IP_FORTRESS
- Each narrator text should be 1-2 sentences, conversational, NEXUS-style (calm, analytical)
- height_multiplier: 1.0=unchanged, >1=more activity, <1=less
- fog density_change: negative=clearer, positive=more uncertainty
- flight_frequency: 1.0=normal, >1=more active
- river: >1=better cash flow
- financial numbers are monthly USD deltas from current state
- summary.monthly_revenue = current_revenue + revenue_delta, monthly_cost = current_cost + cost_delta
- Be conservative and realistic for an electrical contractor`
}

function buildScenarioLabel(inputs: ProjectionInputs): string {
  const parts: string[] = []
  if (inputs.field_add_crew > 0) parts.push(`+${inputs.field_add_crew} crew`)
  if (inputs.field_hire_office_manager) parts.push('office mgr')
  if (inputs.field_rmo_activates) parts.push('RMO active')
  if (inputs.sw_outsource_dev_count > 0) parts.push(`${inputs.sw_outsource_dev_count} devs @$${inputs.sw_outsource_hourly_rate}/hr`)
  if (inputs.inv_mode === 'angel' && inputs.inv_angel_amount > 0) parts.push(`$${(inputs.inv_angel_amount/1000).toFixed(0)}k angel`)
  if (inputs.inv_mode === 'rbf' && inputs.inv_rbf_monthly > 0) parts.push('RBF')
  if (inputs.custom_text.trim()) parts.push('custom')
  return parts.length > 0 ? parts.join(' · ') : 'Baseline'
}

// ── Projection Guide Button (exported for CommandHUD) ─────────────────────────

interface ButtonProps {
  open: boolean
  active: boolean
  onClick: () => void
}

export function ProjectionGuideButton({ open, active, onClick }: ButtonProps) {
  return (
    <button
      onClick={onClick}
      title="Projection Guide"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        padding: '4px 10px',
        borderRadius: 4,
        border: active
          ? '1px solid rgba(255,180,50,0.85)'
          : open
          ? '1px solid rgba(255,180,50,0.55)'
          : '1px solid rgba(255,255,255,0.15)',
        background: active
          ? 'rgba(255,180,50,0.2)'
          : open
          ? 'rgba(255,180,50,0.1)'
          : 'rgba(0,0,0,0.5)',
        color: active || open ? '#ffb432' : 'rgba(255,255,255,0.55)',
        cursor: 'pointer',
        fontSize: 9,
        fontFamily: 'monospace',
        letterSpacing: 1,
        backdropFilter: 'blur(6px)',
        transition: 'all 0.15s',
        width: 'fit-content',
      }}
    >
      <span style={{ fontSize: 12 }}>🧭</span>
      PROJECTION GUIDE
      {active && (
        <span style={{
          width: 5,
          height: 5,
          borderRadius: '50%',
          background: '#ffb432',
          boxShadow: '0 0 6px #ffb432',
          animation: 'nw-blink 1.4s ease infinite',
        }} />
      )}
    </button>
  )
}

// ── Compare Panel ──────────────────────────────────────────────────────────────

function ComparePanel({
  projections,
  onClose,
  onDelete,
}: {
  projections: SavedProjection[]
  onClose: () => void
  onDelete: (id: string) => void
}) {
  const visible3 = projections.slice(0, 3)
  const colWidth = visible3.length > 0 ? `${Math.floor(100 / visible3.length)}%` : '33%'

  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      zIndex: 45,
      background: 'rgba(4,8,16,0.9)',
      backdropFilter: 'blur(16px)',
      display: 'flex',
      flexDirection: 'column',
      animation: 'nw-fade-in 0.3s ease',
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 20px',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}>
        <span style={{ fontSize: 16 }}>⚡</span>
        <div style={{
          color: '#ffb432',
          fontFamily: 'monospace',
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: 2,
          flex: 1,
        }}>
          PROJECTION COMPARE
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 4,
            color: 'rgba(255,255,255,0.5)',
            cursor: 'pointer',
            fontSize: 12,
            padding: '3px 8px',
            fontFamily: 'monospace',
          }}
        >
          ✕ CLOSE
        </button>
      </div>

      {visible3.length === 0 ? (
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'rgba(255,255,255,0.3)',
          fontFamily: 'monospace',
          fontSize: 13,
        }}>
          No saved projections. Save a projection first.
        </div>
      ) : (
        <div style={{
          flex: 1,
          display: 'flex',
          overflow: 'hidden',
        }}>
          {visible3.map((proj, i) => (
            <div
              key={proj.id}
              style={{
                width: colWidth,
                borderRight: i < visible3.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none',
                display: 'flex',
                flexDirection: 'column',
                padding: '16px',
                overflow: 'hidden',
              }}
            >
              {/* Projection label */}
              <div style={{
                color: '#ffb432',
                fontFamily: 'monospace',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 1.5,
                marginBottom: 4,
              }}>
                PROJECTION {i + 1}
              </div>
              <div style={{
                color: 'rgba(255,255,255,0.55)',
                fontFamily: 'monospace',
                fontSize: 10,
                marginBottom: 2,
              }}>
                {proj.name}
              </div>
              <div style={{
                color: 'rgba(255,255,255,0.25)',
                fontFamily: 'monospace',
                fontSize: 9,
                marginBottom: 14,
              }}>
                {new Date(proj.timestamp).toLocaleDateString()}
              </div>

              {/* Mini metrics */}
              {proj.result.summary && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
                  {[
                    { label: 'MONTHLY REVENUE', value: `$${proj.result.summary.monthly_revenue.toLocaleString()}`, color: '#00ff88' },
                    { label: 'MONTHLY COST', value: `$${proj.result.summary.monthly_cost.toLocaleString()}`, color: '#ff6644' },
                    { label: 'NET IMPACT', value: `${proj.result.summary.net_monthly >= 0 ? '+' : ''}$${proj.result.summary.net_monthly.toLocaleString()}`, color: proj.result.summary.net_monthly >= 0 ? '#00ff88' : '#ff4444' },
                    { label: 'ROI', value: proj.result.summary.roi_months > 0 ? `${proj.result.summary.roi_months}mo` : '—', color: '#ffb432' },
                  ].map(m => (
                    <div key={m.label} style={{
                      background: 'rgba(255,255,255,0.04)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 5,
                      padding: '7px 10px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}>
                      <span style={{ color: 'rgba(255,255,255,0.35)', fontFamily: 'monospace', fontSize: 9, letterSpacing: 0.8 }}>{m.label}</span>
                      <span style={{ color: m.color, fontFamily: 'monospace', fontSize: 13, fontWeight: 700 }}>{m.value}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Scenario label */}
              <div style={{
                background: 'rgba(255,180,50,0.06)',
                border: '1px solid rgba(255,180,50,0.18)',
                borderRadius: 5,
                padding: '6px 10px',
                color: 'rgba(255,180,50,0.7)',
                fontFamily: 'monospace',
                fontSize: 9,
                lineHeight: 1.5,
                marginBottom: 12,
                flex: 1,
              }}>
                {proj.scenario_label}
              </div>

              {/* Delete button */}
              <button
                onClick={() => onDelete(proj.id)}
                style={{
                  padding: '6px',
                  background: 'rgba(255,50,50,0.08)',
                  border: '1px solid rgba(255,50,50,0.3)',
                  borderRadius: 4,
                  color: 'rgba(255,100,100,0.7)',
                  cursor: 'pointer',
                  fontFamily: 'monospace',
                  fontSize: 10,
                  letterSpacing: 1,
                  transition: 'all 0.15s',
                }}
              >
                🗑 DELETE
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

interface Props {
  open: boolean
  onClose: () => void
}

export default function ProjectionGuide({ open, onClose }: Props) {
  const [inputPanelOpen, setInputPanelOpen]     = useState(false)
  const [projectionActive, setProjectionActive] = useState(false)
  const [isCalculating, setIsCalculating]       = useState(false)
  const [hasResults, setHasResults]             = useState(false)
  const [scenarioLabel, setScenarioLabel]       = useState('')
  const [savedProjections, setSavedProjections] = useState<SavedProjection[]>([])
  const [compareOpen, setCompareOpen]           = useState(false)
  const [saveStatus, setSaveStatus]             = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [currentResult, setCurrentResult]       = useState<ProjectionResponse | null>(null)
  const [currentInputs, setCurrentInputs]       = useState<ProjectionInputs>({ ...DEFAULT_INPUTS })

  const abortRef = useRef<AbortController | null>(null)

  // Open input panel when guide opens
  useEffect(() => {
    if (open) {
      setInputPanelOpen(true)
    } else {
      setInputPanelOpen(false)
    }
  }, [open])

  // Load saved projections from Supabase
  useEffect(() => {
    loadSavedProjections()
  }, [])

  const loadSavedProjections = useCallback(async () => {
    try {
      const { data: { user } } = await (supabase as any).auth.getUser()
      if (!user) return
      const { data: profile } = await (supabase as any)
        .from('profiles')
        .select('org_id')
        .eq('id', user.id)
        .maybeSingle()
      const orgId = profile?.org_id
      if (!orgId) return
      const { data } = await (supabase as any)
        .from('neural_world_settings')
        .select('saved_projections')
        .eq('org_id', orgId)
        .maybeSingle()
      if (data?.saved_projections) {
        setSavedProjections(data.saved_projections)
      }
    } catch {
      // Non-blocking
    }
  }, [])

  // Listen for calculate event from ProjectionScenarioInput
  useEffect(() => {
    function onCalculate(e: Event) {
      const ev = e as CustomEvent<{ inputs: ProjectionInputs }>
      if (!ev.detail?.inputs) return
      setCurrentInputs(ev.detail.inputs)
      runProjection(ev.detail.inputs)
    }
    window.addEventListener('nw:projection-calculate', onCalculate)
    return () => window.removeEventListener('nw:projection-calculate', onCalculate)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Listen for exit projection event
  useEffect(() => {
    function onExit() {
      setProjectionActive(false)
      setHasResults(false)
      setScenarioLabel('')
      setCurrentResult(null)
    }
    window.addEventListener('nw:what-if-exit', onExit)
    return () => window.removeEventListener('nw:what-if-exit', onExit)
  }, [])

  const runProjection = useCallback(async (inputs: ProjectionInputs) => {
    abortRef.current?.abort()
    abortRef.current = new AbortController()

    setIsCalculating(true)

    try {
      const data = getWorldData()
      const contextSummary = {
        project_count: data.projects.length,
        active_projects: data.projects.filter(p => p.status === 'in_progress').length,
        total_contract_value: data.projects.reduce((s, p) => s + p.contract_value, 0),
        open_invoices: data.invoices.filter(i => i.status !== 'paid').length,
        open_invoice_amount: data.invoices.filter(i => i.status !== 'paid').reduce((s, i) => s + i.amount, 0),
        crew_count: data.crewMembers.filter(c => c.active).length,
        subscriber_count: data.accountingSignals.hubSubscriberCount,
        monthly_overhead: data.accountingSignals.overheadMonthly,
        recent_paid: data.accountingSignals.recentPaidAmount,
      }

      const systemPrompt = buildProjectionSystemPrompt(JSON.stringify(contextSummary, null, 2))
      const userMessage = `Projection scenario inputs:
${JSON.stringify(inputs, null, 2)}`

      const response = await callClaude({
        messages: [{ role: 'user', content: userMessage }],
        system: systemPrompt,
        max_tokens: 2400,
        signal: abortRef.current.signal,
      })

      const text = extractText(response)
      let result: ProjectionResponse

      try {
        // Strip markdown code fences if present
        const clean = text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()
        result = JSON.parse(clean) as ProjectionResponse
      } catch {
        console.error('[ProjectionGuide] Failed to parse response:', text)
        throw new Error('Invalid response from Claude')
      }

      setCurrentResult(result)

      const label = buildScenarioLabel(inputs)
      setScenarioLabel(label)
      if (result.summary) {
        result.summary.scenario_label = label
      }

      // Dispatch world reshape
      window.dispatchEvent(new CustomEvent('nw:what-if-apply', {
        detail: {
          changes: result,
          scenario: label,
          stacked: false,
        },
      }))

      setProjectionActive(true)
      setHasResults(true)

      // Close input panel briefly so world is visible
      setTimeout(() => {
        setInputPanelOpen(false)
      }, 400)

      // Start NEXUS narration after world reshape animation (3s)
      setTimeout(() => {
        if (result.narrator_steps?.length) {
          window.dispatchEvent(new CustomEvent('nw:projection-narrate', {
            detail: {
              steps: result.narrator_steps,
              summary: result.summary,
            },
          }))
        }
      }, 3200)

    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      console.error('[ProjectionGuide] Error:', err)
    } finally {
      setIsCalculating(false)
    }
  }, [])

  const handleSaveProjection = useCallback(async () => {
    if (!currentResult) return
    setSaveStatus('saving')

    const projection: SavedProjection = {
      id: `proj_${Date.now()}`,
      name: scenarioLabel || 'Unnamed Projection',
      timestamp: new Date().toISOString(),
      inputs: currentInputs,
      result: currentResult,
      scenario_label: scenarioLabel,
    }

    try {
      const { data: { user } } = await (supabase as any).auth.getUser()
      if (!user) throw new Error('Not authenticated')
      const { data: profile } = await (supabase as any)
        .from('profiles')
        .select('org_id')
        .eq('id', user.id)
        .maybeSingle()
      const orgId = profile?.org_id
      if (!orgId) throw new Error('No org')

      const updated = [...savedProjections, projection].slice(-3) // max 3
      await (supabase as any)
        .from('neural_world_settings')
        .upsert(
          { org_id: orgId, saved_projections: updated },
          { onConflict: 'org_id' }
        )
      setSavedProjections(updated)
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2500)
    } catch {
      setSaveStatus('error')
      setTimeout(() => setSaveStatus('idle'), 3000)
    }
  }, [currentResult, currentInputs, scenarioLabel, savedProjections])

  const handleDeleteProjection = useCallback(async (id: string) => {
    const updated = savedProjections.filter(p => p.id !== id)
    setSavedProjections(updated)

    try {
      const { data: { user } } = await (supabase as any).auth.getUser()
      if (!user) return
      const { data: profile } = await (supabase as any)
        .from('profiles')
        .select('org_id')
        .eq('id', user.id)
        .maybeSingle()
      const orgId = profile?.org_id
      if (!orgId) return
      await (supabase as any)
        .from('neural_world_settings')
        .upsert(
          { org_id: orgId, saved_projections: updated },
          { onConflict: 'org_id' }
        )
    } catch {
      // Non-blocking
    }
  }, [savedProjections])

  const handleExitProjection = useCallback(() => {
    window.dispatchEvent(new CustomEvent('nw:what-if-exit'))
    setProjectionActive(false)
    setHasResults(false)
    setScenarioLabel('')
    setCurrentResult(null)
    onClose()
  }, [onClose])

  if (!open && !projectionActive) return null

  return (
    <>
      {/* ── PROJECTION MODE BADGE (top-center amber banner) ── */}
      {projectionActive && scenarioLabel && (
        <div style={{
          position: 'absolute',
          top: 14,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 35,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 16px',
          background: 'rgba(255,180,50,0.15)',
          border: '1px solid rgba(255,180,50,0.5)',
          borderRadius: 20,
          backdropFilter: 'blur(10px)',
          pointerEvents: 'auto',
          animation: 'nw-fade-in 0.4s ease',
        }}>
          <span style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: '#ffb432',
            boxShadow: '0 0 8px #ffb432',
            animation: 'nw-blink 1.4s ease infinite',
            flexShrink: 0,
          }} />
          <span style={{
            color: '#ffb432',
            fontFamily: 'monospace',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 1.5,
          }}>
            PROJECTION MODE
          </span>
          <span style={{
            color: 'rgba(255,255,255,0.55)',
            fontFamily: 'monospace',
            fontSize: 9,
            letterSpacing: 0.5,
            maxWidth: 280,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            · {scenarioLabel}
          </span>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 5, marginLeft: 4 }}>
            <button
              onClick={() => setInputPanelOpen(p => !p)}
              style={{
                padding: '3px 9px',
                background: inputPanelOpen ? 'rgba(255,180,50,0.2)' : 'rgba(255,255,255,0.06)',
                border: `1px solid rgba(255,180,50,${inputPanelOpen ? '0.6' : '0.25'})`,
                borderRadius: 4,
                color: inputPanelOpen ? '#ffb432' : 'rgba(255,255,255,0.5)',
                cursor: 'pointer',
                fontFamily: 'monospace',
                fontSize: 9,
                letterSpacing: 0.8,
              }}
            >
              INPUTS
            </button>

            {hasResults && (
              <>
                <button
                  onClick={handleSaveProjection}
                  disabled={saveStatus === 'saving'}
                  style={{
                    padding: '3px 9px',
                    background: 'rgba(0,255,136,0.08)',
                    border: '1px solid rgba(0,255,136,0.3)',
                    borderRadius: 4,
                    color: saveStatus === 'saved' ? '#00ff88' : 'rgba(0,255,136,0.7)',
                    cursor: saveStatus === 'saving' ? 'not-allowed' : 'pointer',
                    fontFamily: 'monospace',
                    fontSize: 9,
                    letterSpacing: 0.8,
                  }}
                >
                  {saveStatus === 'saving' ? '◌ SAVING…' : saveStatus === 'saved' ? '✓ SAVED' : '↓ SAVE'}
                </button>

                {savedProjections.length > 0 && (
                  <button
                    onClick={() => setCompareOpen(true)}
                    style={{
                      padding: '3px 9px',
                      background: 'rgba(80,180,255,0.08)',
                      border: '1px solid rgba(80,180,255,0.3)',
                      borderRadius: 4,
                      color: 'rgba(80,180,255,0.7)',
                      cursor: 'pointer',
                      fontFamily: 'monospace',
                      fontSize: 9,
                      letterSpacing: 0.8,
                    }}
                  >
                    ⇄ COMPARE ({savedProjections.length})
                  </button>
                )}
              </>
            )}

            <button
              onClick={handleExitProjection}
              style={{
                padding: '3px 9px',
                background: 'rgba(255,100,100,0.08)',
                border: '1px solid rgba(255,100,100,0.3)',
                borderRadius: 4,
                color: 'rgba(255,100,100,0.7)',
                cursor: 'pointer',
                fontFamily: 'monospace',
                fontSize: 9,
                letterSpacing: 0.8,
              }}
            >
              EXIT
            </button>
          </div>
        </div>
      )}

      {/* Loading overlay (during calculation) */}
      {isCalculating && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 42,
          textAlign: 'center',
          pointerEvents: 'none',
          animation: 'nw-fade-in 0.3s ease',
        }}>
          <div style={{
            background: 'rgba(4,8,16,0.85)',
            backdropFilter: 'blur(16px)',
            border: '1px solid rgba(255,180,50,0.4)',
            borderRadius: 12,
            padding: '24px 36px',
          }}>
            {/* Progress bar */}
            <div style={{
              width: 200,
              height: 3,
              background: 'rgba(255,255,255,0.1)',
              borderRadius: 3,
              overflow: 'hidden',
              marginBottom: 12,
            }}>
              <div style={{
                height: '100%',
                width: '60%',
                background: 'linear-gradient(90deg, #ffb432, #ff6644)',
                borderRadius: 3,
                animation: 'nw-progress-pulse 1.2s ease-in-out infinite',
              }} />
            </div>
            <div style={{
              color: '#ffb432',
              fontFamily: 'monospace',
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 2,
              marginBottom: 4,
            }}>
              CALCULATING PROJECTION
            </div>
            <div style={{
              color: 'rgba(255,255,255,0.35)',
              fontFamily: 'monospace',
              fontSize: 9,
              letterSpacing: 1,
            }}>
              NEXUS IS MODELING YOUR SCENARIO…
            </div>
          </div>
        </div>
      )}

      {/* ── Scenario Input Panel ── */}
      <ProjectionScenarioInput
        open={inputPanelOpen}
        onClose={() => setInputPanelOpen(false)}
        hasResults={hasResults}
        isCalculating={isCalculating}
      />

      {/* ── Narrator (persistent, listens for nw:projection-narrate) ── */}
      <ProjectionNarrator />

      {/* ── Compare Panel (full overlay) ── */}
      {compareOpen && (
        <ComparePanel
          projections={savedProjections}
          onClose={() => setCompareOpen(false)}
          onDelete={handleDeleteProjection}
        />
      )}

      {/* ── CSS keyframes (injected once) ── */}
      <style>{`
        @keyframes nw-progress-pulse {
          0%   { transform: translateX(-100%); }
          50%  { transform: translateX(50%); }
          100% { transform: translateX(200%); }
        }
        @keyframes nw-slide-up {
          from { opacity: 0; transform: translateX(-50%) translateY(20px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        @keyframes nw-fade-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
      `}</style>
    </>
  )
}
