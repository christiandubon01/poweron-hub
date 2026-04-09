/**
 * ResonancePredictor.tsx — NW41: AI-driven predictive resonance optimization.
 *
 * ACTIVATION:
 *   Rendered inside the ResonanceBreakdownPanel (ResonanceOrb.tsx).
 *   "OPTIMIZE RESONANCE" button sends current resonance + DataBridge data to
 *   Claude API (callNexus) and returns top 3 timing optimizations.
 *
 * OPTIMIZATION CARDS:
 *   Each card shows factor, current score, projected score, change narrative.
 *   "SHOW EFFECT" — animates the world toward the new state over 3 seconds:
 *     • Dispatches nw:resonance-show-effect with factor + projectedScore
 *     • NEXUS voice narrates
 *     • If multiple optimizations push from COHERENT → GROWTH: dramatic orb transform
 *   "APPLY" — saves to Supabase neural_world_settings.resonance_optimizations
 *     and dispatches nw:resonance-apply to mark tuning fork icon at node.
 *
 * HEAT MAP:
 *   Toggle "SHOW HEAT MAP" in orb panel:
 *     • Dispatches nw:resonance-heat-map with per-factor zone data
 *     • ResonanceHeatMapLayer (Three.js plane overlays) renders warm/cool/neutral zones
 *
 * Optimization JSON:
 *   { factor, current, projected, change, from, to, narrative }
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import * as THREE from 'three'
import { callNexus } from '@/services/claudeProxy'
import { supabase } from '@/lib/supabase'
import {
  type ResonanceResult,
  type ResonanceState,
  RESONANCE_STATE_COLOR,
  computeResonance,
} from './ResonanceEngine'
import {
  subscribeWorldData,
  type NWWorldData,
} from './DataBridge'
import { useWorldContext } from './WorldContext'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ResonanceOptimization {
  factor: string        // e.g. "cash_flow_timing"
  current: number       // 0.0–1.0
  projected: number     // 0.0–1.0
  change: string        // e.g. "billing_date"
  from: string          // e.g. "15th"
  to: string            // e.g. "1st"
  narrative: string     // NEXUS voice narration
}

// ── Constants ─────────────────────────────────────────────────────────────────

const FACTOR_LABELS: Record<string, string> = {
  cashFlowTiming:       'Cash Flow Timing',
  capacityUtil:         'Capacity Utilization',
  leadConversionRhythm: 'Lead Conversion Rhythm',
  projectPhaseRate:     'Project Phase Rate',
  agentWorkload:        'Agent Workload Balance',
  revenueDiversity:     'Revenue Diversity',
  bandwidthBalance:     'Bandwidth Balance',
}

// ── Build resonance prompt for Claude ────────────────────────────────────────

function buildResonancePrompt(result: ResonanceResult, data: NWWorldData): string {
  const factorLines = result.factors.map(f =>
    `  - ${f.label} (${f.id}): score ${(f.score * 100).toFixed(0)}% — ${f.explanation}`
  ).join('\n')

  const projectLines = data.projects.slice(0, 10).map(p =>
    `  - ${p.name}: ${p.status}, $${p.contract_value.toLocaleString()}, ` +
    `${p.phase_completion}% complete, type: ${p.type ?? 'general'}`
  ).join('\n')

  const invoiceLines = data.invoices.slice(0, 8).map(inv =>
    `  - $${inv.amount}: ${inv.status}` +
    (inv.paid_at ? `, paid ${inv.paid_at.slice(0, 10)}` : '') +
    (inv.due_date ? `, due ${inv.due_date.slice(0, 10)}` : '')
  ).join('\n')

  const overhead = data.accountingSignals.overheadMonthly
  const dependency = (data.accountingSignals.singleClientDependencyRatio * 100).toFixed(0)

  return (
    `You are NEXUS, the business intelligence engine for Power On Solutions LLC, a California electrical contractor. ` +
    `Analyze the current resonance alignment data and return exactly 3 timing optimization recommendations as JSON.\n\n` +

    `CURRENT RESONANCE STATE: ${result.state} (${(result.score * 100).toFixed(0)}%)\n\n` +

    `ALIGNMENT FACTORS:\n${factorLines}\n\n` +

    `PROJECTS (recent):\n${projectLines || '  (none)'}\n\n` +

    `INVOICES (recent):\n${invoiceLines || '  (none)'}\n\n` +

    `ACCOUNTING:\n` +
    `  - Monthly overhead: $${overhead.toLocaleString()}\n` +
    `  - Single client dependency: ${dependency}%\n` +
    `  - Active crew: ${data.accountingSignals.activeCrewCount}\n` +
    `  - Recent paid (30d): $${data.accountingSignals.recentPaidAmount.toLocaleString()}\n\n` +

    `Return a JSON array of exactly 3 optimization objects. ` +
    `Each object MUST have these exact keys:\n` +
    `  factor (one of: cashFlowTiming, capacityUtil, leadConversionRhythm, projectPhaseRate, agentWorkload, revenueDiversity, bandwidthBalance)\n` +
    `  current (the current factor score 0.0–1.0, matching the data above)\n` +
    `  projected (the score after implementing the change, 0.0–1.0, must be higher)\n` +
    `  change (what needs to change, e.g. "billing_date", "outreach_schedule", "purchase_timing")\n` +
    `  from (current state, e.g. "15th of month", "random days", "as needed")\n` +
    `  to (target state, e.g. "1st of month", "Mondays and Wednesdays", "Tuesday batches")\n` +
    `  narrative (1–2 sentence NEXUS voice narration for when showing the effect, use river/rhythm metaphor)\n\n` +
    `Focus on timing changes that would improve alignment. ` +
    `Return ONLY the JSON array — no markdown, no extra text.`
  )
}

// ── Parse Claude response ─────────────────────────────────────────────────────

function parseOptimizations(text: string): ResonanceOptimization[] {
  // Try to find a JSON array in the response
  const jsonMatch = text.match(/\[[\s\S]*\]/)
  if (!jsonMatch) return []

  try {
    const parsed = JSON.parse(jsonMatch[0])
    if (!Array.isArray(parsed)) return []

    return parsed
      .slice(0, 3)
      .filter((item): item is ResonanceOptimization =>
        typeof item === 'object' &&
        item !== null &&
        typeof item.factor === 'string' &&
        typeof item.current === 'number' &&
        typeof item.projected === 'number' &&
        typeof item.change === 'string' &&
        typeof item.from === 'string' &&
        typeof item.to === 'string' &&
        typeof item.narrative === 'string'
      )
  } catch {
    return []
  }
}

// ── ElevenLabs voice synthesis (best-effort) ─────────────────────────────────

async function speakText(text: string): Promise<void> {
  try {
    const { synthesizeWithElevenLabs } = await import('@/api/voice/elevenLabs')
    await synthesizeWithElevenLabs({ text, voice_id: 'EXAVITQu4vr4xnSDxMaL' })
  } catch {
    // ElevenLabs may not be available — silent fallback
  }
}

// ── Main Component ────────────────────────────────────────────────────────────

interface ResonancePredictorProps {
  result: ResonanceResult
  stateColor: string
}

export function ResonancePredictor({ result, stateColor }: ResonancePredictorProps) {
  const [loading, setLoading] = useState(false)
  const [optimizations, setOptimizations] = useState<ResonanceOptimization[]>([])
  const [error, setError] = useState<string | null>(null)
  const [showingEffect, setShowingEffect] = useState<string | null>(null) // factor id
  const [appliedFactors, setAppliedFactors] = useState<Set<string>>(new Set())
  const [applyingFactor, setApplyingFactor] = useState<string | null>(null)
  const worldDataRef = useRef<NWWorldData | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Subscribe to world data
  useEffect(() => {
    const unsub = subscribeWorldData((data: NWWorldData) => {
      worldDataRef.current = data
    })
    return unsub
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  const handleOptimize = useCallback(async () => {
    if (loading) return
    setLoading(true)
    setError(null)
    setOptimizations([])

    abortRef.current?.abort()
    abortRef.current = new AbortController()

    try {
      const data = worldDataRef.current
      const prompt = buildResonancePrompt(result, data ?? {
        projects: [], invoices: [], fieldLogs: [], rfis: [],
        solarIncome: 0, crewMembers: [], hubEvents: [],
        accountingSignals: {
          overheadMonthly: 0, singleClientDependencyRatio: 0,
          dominantProjectId: null, arOver30Days: [], serviceAreaCount: 0,
          activeCrewCount: 0, recentPaidAmount: 0, recentPayrollHours: 0,
          hubSubscriberCount: 0, recentFeatureLaunches: 0,
        },
        clientTerritories: [], lastFetched: 0,
      })

      const response = await callNexus({
        query: prompt,
        agentMode: 'NEXUS',
        sessionContext: 'Neural World — Resonance Predictor. Return raw JSON array only.',
      })

      const rawText = response.speak ?? ''
      const opts = parseOptimizations(rawText)

      if (opts.length === 0) {
        setError('NEXUS could not generate optimizations. Check API connection.')
      } else {
        setOptimizations(opts)
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      setError('NEXUS unavailable — check API configuration.')
      console.warn('[ResonancePredictor] callNexus error:', err)
    } finally {
      setLoading(false)
    }
  }, [loading, result])

  const handleShowEffect = useCallback(async (opt: ResonanceOptimization) => {
    if (showingEffect) return
    setShowingEffect(opt.factor)

    // Dispatch show-effect event to world
    window.dispatchEvent(new CustomEvent('nw:resonance-show-effect', {
      detail: {
        factor: opt.factor,
        currentScore: opt.current,
        projectedScore: opt.projected,
        durationMs: 3000,
      },
    }))

    // NEXUS voice narration
    void speakText(opt.narrative)

    // Check if multiple optimizations would push from COHERENT → GROWTH
    const allProjectedScore = computeSimulatedScore(result, optimizations)
    const wouldTransition = result.state === 'COHERENT' && allProjectedScore >= 0.70

    if (wouldTransition) {
      // Dispatch dramatic orb transformation after 1.5s
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('nw:resonance-state-transform', {
          detail: { fromState: 'COHERENT', toState: 'GROWTH', durationMs: 2000 },
        }))
      }, 1500)
    }

    // Clear after animation
    setTimeout(() => {
      setShowingEffect(null)
    }, 3500)
  }, [showingEffect, result, optimizations])

  const handleApply = useCallback(async (opt: ResonanceOptimization) => {
    if (applyingFactor) return
    setApplyingFactor(opt.factor)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const { data: profile } = await (supabase as any)
        .from('profiles')
        .select('org_id')
        .eq('id', user.id)
        .maybeSingle()
      const orgId: string | null = profile?.org_id ?? null
      if (!orgId) throw new Error('No org_id')

      // Fetch existing optimizations
      const { data: existing } = await (supabase as any)
        .from('neural_world_settings')
        .select('resonance_optimizations')
        .eq('org_id', orgId)
        .maybeSingle()

      const existingOpts: ResonanceOptimization[] = existing?.resonance_optimizations ?? []

      // Upsert — replace same factor if already exists
      const newOpts = [
        ...existingOpts.filter((o: ResonanceOptimization) => o.factor !== opt.factor),
        { ...opt, appliedAt: new Date().toISOString() },
      ]

      await (supabase as any)
        .from('neural_world_settings')
        .upsert(
          { org_id: orgId, resonance_optimizations: newOpts },
          { onConflict: 'org_id' }
        )

      // Dispatch apply event so tuning fork marker appears at node
      window.dispatchEvent(new CustomEvent('nw:resonance-apply', {
        detail: { factor: opt.factor, narrative: opt.narrative, change: opt.change },
      }))

      setAppliedFactors(prev => new Set([...prev, opt.factor]))
    } catch (err) {
      console.warn('[ResonancePredictor] apply error:', err)
    } finally {
      setApplyingFactor(null)
    }
  }, [applyingFactor])

  if (optimizations.length === 0 && !loading && !error) {
    return (
      <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
        <button
          onClick={handleOptimize}
          style={{
            width: '100%',
            background: `linear-gradient(135deg, rgba(0,229,204,0.12), rgba(0,229,204,0.06))`,
            border: `1px solid rgba(0,229,204,0.4)`,
            borderRadius: 6,
            color: '#00e5cc',
            fontSize: 10,
            letterSpacing: 2,
            fontFamily: 'monospace',
            fontWeight: 700,
            padding: '9px 12px',
            cursor: 'pointer',
            textAlign: 'center',
            transition: 'all 0.2s',
          }}
          onMouseEnter={e => {
            ;(e.currentTarget as HTMLButtonElement).style.background =
              'linear-gradient(135deg, rgba(0,229,204,0.22), rgba(0,229,204,0.12))'
          }}
          onMouseLeave={e => {
            ;(e.currentTarget as HTMLButtonElement).style.background =
              'linear-gradient(135deg, rgba(0,229,204,0.12), rgba(0,229,204,0.06))'
          }}
        >
          ⟡ OPTIMIZE RESONANCE
        </button>
      </div>
    )
  }

  if (loading) {
    return (
      <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          color: 'rgba(0,229,204,0.7)',
          fontSize: 8.5,
          letterSpacing: 1.5,
          fontFamily: 'monospace',
        }}>
          <NexusPulse />
          NEXUS ANALYZING TIMING PATTERNS...
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
        <div style={{ color: '#ff4444', fontSize: 8, letterSpacing: 1, fontFamily: 'monospace', marginBottom: 8 }}>
          {error}
        </div>
        <button
          onClick={handleOptimize}
          style={{
            background: 'none',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 4,
            color: 'rgba(255,255,255,0.45)',
            fontSize: 9,
            letterSpacing: 1,
            fontFamily: 'monospace',
            padding: '4px 10px',
            cursor: 'pointer',
          }}
        >
          RETRY
        </button>
      </div>
    )
  }

  return (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
      <div style={{
        color: 'rgba(0,229,204,0.6)',
        fontSize: 7.5,
        letterSpacing: 2,
        fontFamily: 'monospace',
        marginBottom: 10,
      }}>
        TOP TIMING OPTIMIZATIONS
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {optimizations.map((opt, i) => (
          <OptimizationCard
            key={opt.factor + i}
            opt={opt}
            index={i}
            stateColor={stateColor}
            isShowingEffect={showingEffect === opt.factor}
            isApplied={appliedFactors.has(opt.factor)}
            isApplying={applyingFactor === opt.factor}
            onShowEffect={() => handleShowEffect(opt)}
            onApply={() => handleApply(opt)}
          />
        ))}
      </div>
    </div>
  )
}

// ── Optimization Card ─────────────────────────────────────────────────────────

function OptimizationCard({
  opt,
  index,
  stateColor,
  isShowingEffect,
  isApplied,
  isApplying,
  onShowEffect,
  onApply,
}: {
  opt: ResonanceOptimization
  index: number
  stateColor: string
  isShowingEffect: boolean
  isApplied: boolean
  isApplying: boolean
  onShowEffect: () => void
  onApply: () => void
}) {
  const gain = opt.projected - opt.current
  const gainPct = (gain * 100).toFixed(0)
  const factorLabel = FACTOR_LABELS[opt.factor] ?? opt.factor
  const gainColor = gain >= 0.2 ? '#00cc66' : gain >= 0.1 ? '#ffd700' : '#aaa'

  return (
    <div style={{
      background: 'rgba(0,229,204,0.04)',
      border: `1px solid rgba(0,229,204,0.15)`,
      borderRadius: 7,
      padding: '10px 11px',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Rank badge */}
      <div style={{
        position: 'absolute',
        top: 8,
        right: 10,
        color: 'rgba(0,229,204,0.3)',
        fontSize: 16,
        fontFamily: 'monospace',
        fontWeight: 700,
        lineHeight: 1,
      }}>
        {index + 1}
      </div>

      {/* Factor label */}
      <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 8.5, letterSpacing: 1.5, fontFamily: 'monospace', marginBottom: 5 }}>
        {factorLabel.toUpperCase()}
      </div>

      {/* Score progression bar */}
      <ScoreProgressBar current={opt.current} projected={opt.projected} />

      {/* Change description */}
      <div style={{
        marginTop: 6,
        marginBottom: 6,
        color: 'rgba(255,255,255,0.45)',
        fontSize: 8,
        letterSpacing: 0.5,
        fontFamily: 'monospace',
        lineHeight: 1.6,
      }}>
        <span style={{ color: 'rgba(255,255,255,0.65)' }}>{opt.change.replace(/_/g, ' ')}</span>
        {' '}· {opt.from} → <span style={{ color: gainColor }}>{opt.to}</span>
        <span style={{ color: gainColor, marginLeft: 6, fontWeight: 700 }}>+{gainPct}%</span>
      </div>

      {/* Narrative */}
      <div style={{
        color: 'rgba(255,255,255,0.3)',
        fontSize: 7.5,
        letterSpacing: 0.4,
        fontFamily: 'monospace',
        lineHeight: 1.5,
        marginBottom: 8,
        borderLeft: '2px solid rgba(0,229,204,0.2)',
        paddingLeft: 6,
      }}>
        "{opt.narrative}"
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={onShowEffect}
          disabled={isShowingEffect}
          style={{
            flex: 1,
            background: isShowingEffect
              ? 'rgba(0,229,204,0.2)'
              : 'rgba(0,229,204,0.08)',
            border: `1px solid rgba(0,229,204,${isShowingEffect ? '0.5' : '0.25'})`,
            borderRadius: 4,
            color: isShowingEffect ? '#00e5cc' : 'rgba(0,229,204,0.7)',
            fontSize: 8,
            letterSpacing: 1.5,
            fontFamily: 'monospace',
            padding: '5px 0',
            cursor: isShowingEffect ? 'default' : 'pointer',
            transition: 'all 0.2s',
          }}
        >
          {isShowingEffect ? '◈ PLAYING...' : '▶ SHOW EFFECT'}
        </button>

        <button
          onClick={onApply}
          disabled={isApplied || !!isApplying}
          style={{
            flex: 1,
            background: isApplied
              ? 'rgba(0,204,102,0.12)'
              : 'rgba(255,255,255,0.04)',
            border: `1px solid ${isApplied ? 'rgba(0,204,102,0.4)' : 'rgba(255,255,255,0.12)'}`,
            borderRadius: 4,
            color: isApplied
              ? '#00cc66'
              : isApplying
              ? 'rgba(255,255,255,0.3)'
              : 'rgba(255,255,255,0.5)',
            fontSize: 8,
            letterSpacing: 1.5,
            fontFamily: 'monospace',
            padding: '5px 0',
            cursor: (isApplied || !!isApplying) ? 'default' : 'pointer',
            transition: 'all 0.2s',
          }}
        >
          {isApplied ? '✓ APPLIED' : isApplying ? 'SAVING...' : '⋈ APPLY'}
        </button>
      </div>
    </div>
  )
}

// ── Score Progress Bar ────────────────────────────────────────────────────────

function ScoreProgressBar({ current, projected }: { current: number; projected: number }) {
  const currentPct = current * 100
  const projectedPct = projected * 100

  const currentColor = current >= 0.7 ? '#00cc66' : current >= 0.4 ? '#ffd700' : '#ff4444'
  const projectedColor = projected >= 0.7 ? '#00cc66' : projected >= 0.4 ? '#ffd700' : '#ff4444'

  return (
    <div style={{ position: 'relative', height: 16, marginBottom: 2 }}>
      {/* Background track */}
      <div style={{
        position: 'absolute',
        left: 0, right: 0, top: 6,
        height: 4,
        borderRadius: 2,
        background: 'rgba(255,255,255,0.07)',
      }} />

      {/* Current score fill */}
      <div style={{
        position: 'absolute',
        left: 0,
        top: 6,
        width: `${currentPct}%`,
        height: 4,
        borderRadius: 2,
        background: currentColor,
        opacity: 0.55,
        transition: 'width 0.5s ease',
      }} />

      {/* Projected score fill (overlay, slightly taller) */}
      <div style={{
        position: 'absolute',
        left: 0,
        top: 5,
        width: `${projectedPct}%`,
        height: 6,
        borderRadius: 3,
        background: `linear-gradient(90deg, ${currentColor}44, ${projectedColor})`,
        transition: 'width 0.5s ease',
      }} />

      {/* Current score label */}
      <div style={{
        position: 'absolute',
        left: `${Math.min(currentPct, 85)}%`,
        top: 0,
        transform: 'translateX(-50%)',
        color: currentColor,
        fontSize: 7,
        fontFamily: 'monospace',
        opacity: 0.7,
      }}>
        {currentPct.toFixed(0)}
      </div>

      {/* Projected score label */}
      <div style={{
        position: 'absolute',
        left: `${Math.min(projectedPct, 96)}%`,
        top: 0,
        transform: 'translateX(-50%)',
        color: projectedColor,
        fontSize: 7,
        fontFamily: 'monospace',
        fontWeight: 700,
      }}>
        {projectedPct.toFixed(0)}
      </div>
    </div>
  )
}

// ── Nexus Pulse indicator ─────────────────────────────────────────────────────

function NexusPulse() {
  const [active, setActive] = useState(true)
  useEffect(() => {
    const id = setInterval(() => setActive(v => !v), 400)
    return () => clearInterval(id)
  }, [])

  return (
    <div style={{
      width: 8,
      height: 8,
      borderRadius: '50%',
      background: active ? '#00e5cc' : 'rgba(0,229,204,0.2)',
      transition: 'background 0.2s',
      flexShrink: 0,
    }} />
  )
}

// ── Simulated score helper ────────────────────────────────────────────────────

function computeSimulatedScore(
  result: ResonanceResult,
  optimizations: ResonanceOptimization[],
): number {
  const FACTOR_WEIGHTS: Record<string, number> = {
    cashFlowTiming:       0.20,
    capacityUtil:         0.15,
    leadConversionRhythm: 0.10,
    projectPhaseRate:     0.20,
    agentWorkload:        0.10,
    revenueDiversity:     0.15,
    bandwidthBalance:     0.10,
  }

  // Build a map of projected scores for optimized factors
  const projectedMap: Record<string, number> = {}
  optimizations.forEach(opt => {
    projectedMap[opt.factor] = opt.projected
  })

  let totalWeight = 0
  let weightedSum = 0
  result.factors.forEach(f => {
    const w = FACTOR_WEIGHTS[f.id] ?? 0.1
    const score = projectedMap[f.id] ?? f.score
    weightedSum += score * w
    totalWeight += w
  })

  return totalWeight > 0 ? Math.max(0, Math.min(1, weightedSum / totalWeight)) : 0
}

// ── Heat Map Toggle Button ────────────────────────────────────────────────────

interface ResonanceHeatMapToggleProps {
  result: ResonanceResult
  stateColor: string
}

export function ResonanceHeatMapToggle({ result, stateColor }: ResonanceHeatMapToggleProps) {
  const [heatMapActive, setHeatMapActive] = useState(false)

  const toggleHeatMap = useCallback(() => {
    const next = !heatMapActive
    setHeatMapActive(next)

    if (next) {
      // Build zone data for each factor
      const zoneData = result.factors.map(f => ({
        factorId: f.id,
        factorLabel: f.label,
        score: f.score,
        // Positive contribution (score >= 0.6): warm gold
        // Dragging down (score < 0.4): cool blue/gray
        // Neutral (0.4–0.6): dark
        tone: f.score >= 0.6 ? 'warm' : f.score < 0.4 ? 'cool' : 'neutral',
      }))

      window.dispatchEvent(new CustomEvent('nw:resonance-heat-map', {
        detail: { active: true, zones: zoneData },
      }))
    } else {
      window.dispatchEvent(new CustomEvent('nw:resonance-heat-map', {
        detail: { active: false, zones: [] },
      }))
    }
  }, [heatMapActive, result])

  return (
    <button
      onClick={toggleHeatMap}
      style={{
        background: heatMapActive
          ? 'rgba(255,215,0,0.12)'
          : 'rgba(255,255,255,0.04)',
        border: `1px solid ${heatMapActive ? 'rgba(255,215,0,0.35)' : 'rgba(255,255,255,0.12)'}`,
        borderRadius: 4,
        color: heatMapActive ? '#ffd700' : 'rgba(255,255,255,0.4)',
        fontSize: 8,
        letterSpacing: 1.5,
        fontFamily: 'monospace',
        padding: '5px 10px',
        cursor: 'pointer',
        transition: 'all 0.2s',
        display: 'flex',
        alignItems: 'center',
        gap: 5,
      }}
    >
      <span style={{ fontSize: 10 }}>◉</span>
      {heatMapActive ? 'HIDE HEAT MAP' : 'SHOW HEAT MAP'}
    </button>
  )
}

// ── Heat Map Layer (Three.js) ─────────────────────────────────────────────────
// Listens to nw:resonance-heat-map and paints ground plane zone overlays.
// The heat map uses semi-transparent PlaneGeometry meshes placed at y=0.3
// above ground level, one per resonance zone, color-coded by contribution.

interface HeatMapZone {
  factorId: string
  factorLabel: string
  score: number
  tone: 'warm' | 'cool' | 'neutral'
}

// Positions for each factor zone in world space (aligned to major world landmarks)
const ZONE_POSITIONS: Record<string, { x: number; z: number; radius: number }> = {
  cashFlowTiming:       { x:  0,   z: -20, radius: 18 },
  capacityUtil:         { x: -25,  z:  10, radius: 16 },
  leadConversionRhythm: { x:  25,  z:  5,  radius: 14 },
  projectPhaseRate:     { x:  10,  z:  20, radius: 18 },
  agentWorkload:        { x: -10,  z: -5,  radius: 12 },
  revenueDiversity:     { x: -30,  z: -15, radius: 14 },
  bandwidthBalance:     { x:  30,  z: -10, radius: 14 },
}

const WARM_COLOR = new THREE.Color(1.0, 0.85, 0.1)   // gold
const COOL_COLOR = new THREE.Color(0.2, 0.4, 0.9)    // blue-gray
const NEUT_COLOR = new THREE.Color(0.1, 0.1, 0.12)   // dark

interface ResonanceHeatMapLayerProps {
  visible: boolean
}

export function ResonanceHeatMapLayer({ visible }: ResonanceHeatMapLayerProps) {
  const { scene } = useWorldContext()
  const planesRef = useRef<THREE.Mesh[]>([])
  const activeRef = useRef(false)
  const visibleRef = useRef(visible)

  useEffect(() => { visibleRef.current = visible }, [visible])

  // Listen for heat map toggle events
  useEffect(() => {
    function onHeatMap(e: Event) {
      const ev = e as CustomEvent<{ active: boolean; zones: HeatMapZone[] }>
      if (!ev.detail) return

      // Clear existing planes
      planesRef.current.forEach(mesh => {
        scene.remove(mesh)
        mesh.geometry.dispose()
        ;(mesh.material as THREE.Material).dispose()
      })
      planesRef.current = []

      activeRef.current = ev.detail.active

      if (!ev.detail.active || !visibleRef.current) return

      // Build new planes for each zone
      ev.detail.zones.forEach(zone => {
        const pos = ZONE_POSITIONS[zone.factorId]
        if (!pos) return
        if (zone.tone === 'neutral') return  // neutral zones have no glow

        const baseColor = zone.tone === 'warm' ? WARM_COLOR.clone() : COOL_COLOR.clone()
        const intensity = zone.tone === 'warm'
          ? 0.15 + zone.score * 0.35
          : 0.15 + (1 - zone.score) * 0.25

        const geo = new THREE.CircleGeometry(pos.radius, 32)
        const mat = new THREE.MeshBasicMaterial({
          color: baseColor,
          transparent: true,
          opacity: intensity,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
        const mesh = new THREE.Mesh(geo, mat)
        mesh.rotation.x = -Math.PI / 2
        mesh.position.set(pos.x, 0.3, pos.z)
        scene.add(mesh)
        planesRef.current.push(mesh)

        // Glow ring border
        const ringGeo = new THREE.RingGeometry(pos.radius * 0.92, pos.radius, 48)
        const ringMat = new THREE.MeshBasicMaterial({
          color: baseColor,
          transparent: true,
          opacity: intensity * 1.6,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
        const ring = new THREE.Mesh(ringGeo, ringMat)
        ring.rotation.x = -Math.PI / 2
        ring.position.set(pos.x, 0.35, pos.z)
        scene.add(ring)
        planesRef.current.push(ring)
      })
    }

    window.addEventListener('nw:resonance-heat-map', onHeatMap)
    return () => window.removeEventListener('nw:resonance-heat-map', onHeatMap)
  }, [scene])

  // Animate heat map planes (gentle pulse)
  useEffect(() => {
    let t = 0
    const DT = 1 / 60

    function onFrame() {
      if (!activeRef.current || planesRef.current.length === 0) return
      t += DT
      planesRef.current.forEach((mesh, i) => {
        const mat = mesh.material as THREE.MeshBasicMaterial
        const baseOpacity = (i % 2 === 0) ? 0.25 : 0.4
        mat.opacity = baseOpacity + Math.sin(t * 1.2 + i * 0.7) * 0.06
      })
    }

    window.addEventListener('nw:frame', onFrame)
    return () => window.removeEventListener('nw:frame', onFrame)
  }, [])

  // Visibility changes: show/hide all planes
  useEffect(() => {
    planesRef.current.forEach(mesh => {
      mesh.visible = visible
    })
  }, [visible])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      planesRef.current.forEach(mesh => {
        scene.remove(mesh)
        mesh.geometry.dispose()
        ;(mesh.material as THREE.Material).dispose()
      })
      planesRef.current = []
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene])

  return null  // Three.js only — no DOM output
}

// ── Show Effect Orb Animator ──────────────────────────────────────────────────
// Listens to nw:resonance-show-effect and smoothly transitions the orb color
// and the world toward the projected resonance state over 3 seconds.
// Also listens to nw:resonance-state-transform for dramatic COHERENT → GROWTH.

export function ResonanceEffectAnimator() {
  const animatingRef = useRef(false)

  useEffect(() => {
    function onShowEffect(e: Event) {
      const ev = e as CustomEvent<{
        factor: string
        currentScore: number
        projectedScore: number
        durationMs: number
      }>
      if (!ev.detail || animatingRef.current) return

      const { projectedScore, durationMs } = ev.detail
      const start = performance.now()
      animatingRef.current = true

      // Calculate what world speed the projected score would produce
      // Use projectedScore to determine new resonance state color hints
      function tick() {
        const elapsed = performance.now() - start
        const t = Math.min(elapsed / durationMs, 1)
        // Ease-in-out
        const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t

        // Dispatch progress to orb for visual interpolation
        window.dispatchEvent(new CustomEvent('nw:resonance-effect-progress', {
          detail: { t: eased, projectedScore },
        }))

        if (t < 1) {
          requestAnimationFrame(tick)
        } else {
          animatingRef.current = false
          // Dispatch completion
          window.dispatchEvent(new CustomEvent('nw:resonance-effect-complete', {
            detail: { projectedScore },
          }))
        }
      }

      requestAnimationFrame(tick)
    }

    function onStateTransform(e: Event) {
      const ev = e as CustomEvent<{
        fromState: ResonanceState
        toState: ResonanceState
        durationMs: number
      }>
      if (!ev.detail) return
      const { toState, durationMs } = ev.detail

      const start = performance.now()
      const toColor = RESONANCE_STATE_COLOR[toState]

      function tick() {
        const elapsed = performance.now() - start
        const t = Math.min(elapsed / durationMs, 1)
        const eased = t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1

        window.dispatchEvent(new CustomEvent('nw:resonance-transform-progress', {
          detail: { t: eased, toState, toColor },
        }))

        if (t < 1) {
          requestAnimationFrame(tick)
        }
      }

      requestAnimationFrame(tick)
    }

    window.addEventListener('nw:resonance-show-effect', onShowEffect)
    window.addEventListener('nw:resonance-state-transform', onStateTransform)

    return () => {
      window.removeEventListener('nw:resonance-show-effect', onShowEffect)
      window.removeEventListener('nw:resonance-state-transform', onStateTransform)
    }
  }, [])

  return null
}

// ── Tuning Fork Marker ────────────────────────────────────────────────────────
// Listens to nw:resonance-apply and renders a floating tuning fork icon
// above the relevant zone in the world.

interface TuningForkMarker {
  factor: string
  narrative: string
  change: string
  x: number
  z: number
}

export function ResonanceTuningForkLayer({ visible }: { visible: boolean }) {
  const [markers, setMarkers] = useState<TuningForkMarker[]>([])

  // Listen for apply events
  useEffect(() => {
    function onApply(e: Event) {
      const ev = e as CustomEvent<{ factor: string; narrative: string; change: string }>
      if (!ev.detail) return
      const pos = ZONE_POSITIONS[ev.detail.factor]
      if (!pos) return

      setMarkers(prev => {
        const filtered = prev.filter(m => m.factor !== ev.detail.factor)
        return [...filtered, {
          factor: ev.detail.factor,
          narrative: ev.detail.narrative,
          change: ev.detail.change,
          x: pos.x,
          z: pos.z,
        }]
      })
    }

    // Also load persisted markers from Supabase on mount
    void loadPersistedMarkers()

    window.addEventListener('nw:resonance-apply', onApply)
    return () => window.removeEventListener('nw:resonance-apply', onApply)
  }, [])

  // This component renders a DOM overlay — actual world-space positioning
  // is approximated via the world's projection.
  // For simplicity we show markers as a compact floating panel.
  if (!visible || markers.length === 0) return null

  return (
    <div style={{
      position: 'absolute',
      top: 16,
      right: 16,
      zIndex: 22,
      display: 'flex',
      flexDirection: 'column',
      gap: 5,
      pointerEvents: 'none',
    }}>
      {markers.map(m => {
        const factorLabel = FACTOR_LABELS[m.factor] ?? m.factor
        return (
          <div key={m.factor} style={{
            background: 'rgba(4,4,14,0.88)',
            border: '1px solid rgba(255,215,0,0.3)',
            borderRadius: 5,
            padding: '5px 9px',
            fontFamily: 'monospace',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            maxWidth: 200,
            backdropFilter: 'blur(6px)',
          }}>
            <span style={{ fontSize: 12, color: '#ffd700' }}>𝌇</span>
            <div>
              <div style={{ color: 'rgba(255,215,0,0.8)', fontSize: 7.5, letterSpacing: 1.2, fontWeight: 700 }}>
                {factorLabel.toUpperCase()}
              </div>
              <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 7, letterSpacing: 0.5 }}>
                {m.change.replace(/_/g, ' ')}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

async function loadPersistedMarkers(): Promise<TuningForkMarker[]> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return []
    const { data: profile } = await (supabase as any)
      .from('profiles')
      .select('org_id')
      .eq('id', user.id)
      .maybeSingle()
    const orgId = profile?.org_id
    if (!orgId) return []

    const { data } = await (supabase as any)
      .from('neural_world_settings')
      .select('resonance_optimizations')
      .eq('org_id', orgId)
      .maybeSingle()

    const opts: ResonanceOptimization[] = data?.resonance_optimizations ?? []
    const result: TuningForkMarker[] = []
    opts.forEach((opt: ResonanceOptimization) => {
      const pos = ZONE_POSITIONS[opt.factor]
      if (pos) {
        result.push({
          factor: opt.factor,
          narrative: opt.narrative,
          change: opt.change,
          x: pos.x,
          z: pos.z,
        })
      }
    })

    // Dispatch each loaded marker
    result.forEach(m => {
      window.dispatchEvent(new CustomEvent('nw:resonance-apply', {
        detail: { factor: m.factor, narrative: m.narrative, change: m.change },
      }))
    })

    return result
  } catch {
    return []
  }
}
