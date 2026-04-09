/**
 * WhatIfSimulator.tsx — NW33: What-if scenario simulator + vision input.
 *
 * Button in HUD: "WHAT IF" (lightning bolt ⚡ icon).
 * Opens an input panel where the user types a natural language scenario.
 *
 * Flow:
 *  1. User types scenario: "What if I add a second crew?"
 *  2. System sends to Claude API with full DataBridge context + special what-if system prompt.
 *  3. Claude returns structured JSON with terrain/mountain/river/fog/agent/financial changes.
 *  4. World ANIMATES over 3s by dispatching 'nw:what-if-apply' event with the changes.
 *  5. WHAT-IF MODE badge shown at top center: "WHAT IF: [scenario]" in amber.
 *  6. "EXIT WHAT-IF" button returns to real data with reverse animation.
 *  7. Multiple what-ifs can stack ("What if I add a crew AND raise minimums?").
 *
 * VISION INPUT:
 *  "I ENVISION…" free-text section simulates a new feature/tool integration
 *  and shows how it would affect the Neural World (agent frequencies, fog density, etc.)
 *
 * Emits:
 *   nw:what-if-apply   — { changes: WhatIfChanges, scenario: string, stacked: boolean }
 *   nw:what-if-exit    — {} — triggers reverse animation back to real data
 */

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { getWorldData } from './DataBridge'
import { callClaude } from '@/services/claudeProxy'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface WhatIfTerrainChange {
  node: string
  from: number | string
  to: number | string
  effect: string
}

export interface WhatIfMountainChange {
  project: string
  height_multiplier: number
}

export interface WhatIfRiverChange {
  width_multiplier: number
  color_shift: string
}

export interface WhatIfFogChange {
  density_change: number
}

export interface WhatIfAgentChange {
  agent: string
  flight_frequency: number
}

export interface WhatIfChanges {
  terrain_changes: WhatIfTerrainChange[]
  mountain_changes: WhatIfMountainChange[]
  river_changes: WhatIfRiverChange
  fog_changes: Record<string, WhatIfFogChange>
  agent_changes: WhatIfAgentChange[]
  financial_impact: {
    monthly_revenue_delta: number
    monthly_cost_delta: number
    net_delta: number
  }
  narrative: string
  is_vision?: boolean
}

interface StackedScenario {
  scenario: string
  changes: WhatIfChanges
  timestamp: string
  isVision?: boolean
}

// ── System prompt for What-If ──────────────────────────────────────────────────

function buildWhatIfSystemPrompt(contextJson: string): string {
  return `You are the PowerOn Neural World simulation engine. The user is exploring what-if scenarios for their electrical contracting business.

Current business data:
${contextJson}

When given a "What if..." scenario, respond ONLY with a JSON object in this exact structure (no markdown, no extra text):
{
  "terrain_changes": [{"node": "string", "from": "any", "to": "any", "effect": "string"}],
  "mountain_changes": [{"project": "string", "height_multiplier": number}],
  "river_changes": {"width_multiplier": number, "color_shift": "string (greener|bluer|redder|neutral)"},
  "fog_changes": {
    "bandwidth": {"density_change": number},
    "revenue": {"density_change": number},
    "security": {"density_change": number},
    "improvement": {"density_change": number}
  },
  "agent_changes": [{"agent": "string", "flight_frequency": number}],
  "financial_impact": {
    "monthly_revenue_delta": number,
    "monthly_cost_delta": number,
    "net_delta": number
  },
  "narrative": "2-3 sentence plain English explanation of the scenario's impact"
}

Rules:
- height_multiplier: 1.0 = no change, >1 = taller mountain (more revenue/activity), <1 = shorter
- fog density_change: negative = less fog (clearer/better), positive = more fog (more uncertainty)
- flight_frequency: 1.0 = normal, >1 = more active agent, <1 = less active
- river width_multiplier: >1 = better cash flow
- financial_impact numbers are monthly USD deltas
- Be realistic and specific to the electrical contractor context
- Keep terrain_changes to 1-3 entries, mountain_changes to 0-3 entries
- narrative must be 2-3 sentences, plain English, no jargon`
}

function buildVisionSystemPrompt(contextJson: string): string {
  return `You are the PowerOn Neural World simulation engine. The user is envisioning a new feature, tool, or platform capability they want to add to their business.

Current business data:
${contextJson}

When given an "I envision..." description, simulate how that integration would affect the Neural World. Respond ONLY with a JSON object:
{
  "terrain_changes": [{"node": "string", "from": "any", "to": "any", "effect": "string"}],
  "mountain_changes": [],
  "river_changes": {"width_multiplier": number, "color_shift": "string"},
  "fog_changes": {
    "bandwidth": {"density_change": number},
    "revenue": {"density_change": number},
    "security": {"density_change": number},
    "improvement": {"density_change": number}
  },
  "agent_changes": [{"agent": "string", "flight_frequency": number}],
  "financial_impact": {
    "monthly_revenue_delta": number,
    "monthly_cost_delta": number,
    "net_delta": number
  },
  "narrative": "2-3 sentence description of how this feature would change the business environment",
  "is_vision": true
}

Rules:
- Focus on operational changes: which agents fly more/less, which fog clears, what financial uplift
- fog density_change: negative = less fog (feature solves the problem), positive = new complexity
- Be specific about WHY each agent's behavior would change
- Show the long-term positive impact where realistic`
}

// ── Suggestion chips ───────────────────────────────────────────────────────────

const SCENARIO_CHIPS = [
  'What if I add a second crew?',
  'What if I raise service minimums to $400?',
  'What if I close the current project?',
  'What if I get 20 more subscribers?',
  'What if I hire an office manager?',
  'What if I add a solar service line?',
]

const VISION_CHIPS = [
  'automated invoice follow-up system',
  'AI-powered estimate generator',
  'real-time material price tracking',
  'crew GPS + time tracking integration',
]

// ── Props ──────────────────────────────────────────────────────────────────────

interface WhatIfSimulatorProps {
  open: boolean
  onClose: () => void
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function WhatIfSimulator({ open, onClose }: WhatIfSimulatorProps) {
  const [visible, setVisible]       = useState(false)
  const [animIn, setAnimIn]         = useState(false)
  const [activeTab, setActiveTab]   = useState<'whatif' | 'vision'>('whatif')
  const [input, setInput]           = useState('')
  const [visionInput, setVisionInput] = useState('')
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [stackedScenarios, setStackedScenarios] = useState<StackedScenario[]>([])
  const [whatIfActive, setWhatIfActive] = useState(false)
  const [lastResult, setLastResult] = useState<WhatIfChanges | null>(null)
  const [animPhase, setAnimPhase]   = useState<'idle' | 'simulating' | 'done'>('idle')
  const inputRef  = useRef<HTMLTextAreaElement>(null)
  const abortRef  = useRef<AbortController | null>(null)

  // Animate in/out
  useEffect(() => {
    if (open) {
      setVisible(true)
      requestAnimationFrame(() => setAnimIn(true))
      setTimeout(() => inputRef.current?.focus(), 350)
    } else {
      setAnimIn(false)
      const t = setTimeout(() => setVisible(false), 320)
      return () => clearTimeout(t)
    }
  }, [open])

  // Cleanup abort on unmount
  useEffect(() => {
    return () => { abortRef.current?.abort() }
  }, [])

  const buildContextJson = useCallback((): string => {
    const data = getWorldData()
    if (!data) return '{}'
    const summary = {
      project_count: data.projects.length,
      active_projects: data.projects.filter(p => p.status === 'in_progress').length,
      total_contract_value: data.projects.reduce((s, p) => s + p.contract_value, 0),
      open_invoices: data.invoices.filter(i => i.status !== 'paid').length,
      open_invoice_amount: data.invoices.filter(i => i.status !== 'paid').reduce((s, i) => s + i.amount, 0),
      crew_count: data.crewMembers.filter(c => c.active).length,
      open_rfis: data.rfis.filter(r => r.status === 'open').length,
      subscriber_count: data.accountingSignals.hubSubscriberCount,
      monthly_overhead: data.accountingSignals.overheadMonthly,
      recent_paid: data.accountingSignals.recentPaidAmount,
      avg_health_score: data.projects.length > 0
        ? Math.round(data.projects.reduce((s, p) => s + p.health_score, 0) / data.projects.length)
        : 0,
    }
    return JSON.stringify(summary, null, 2)
  }, [])

  const runSimulation = useCallback(async (scenarioText: string, isVision: boolean) => {
    if (!scenarioText.trim()) return

    abortRef.current?.abort()
    abortRef.current = new AbortController()

    setLoading(true)
    setError(null)
    setAnimPhase('simulating')

    try {
      const ctx = buildContextJson()
      const systemPrompt = isVision
        ? buildVisionSystemPrompt(ctx)
        : buildWhatIfSystemPrompt(ctx)

      const userMessage = isVision
        ? `I envision: ${scenarioText.trim()}`
        : scenarioText.trim().startsWith('What if') || scenarioText.trim().startsWith('what if')
          ? scenarioText.trim()
          : `What if ${scenarioText.trim()}?`

      const response = await callClaude({
        messages: [{ role: 'user', content: userMessage }],
        system: systemPrompt,
        max_tokens: 1200,
        signal: abortRef.current.signal,
      })

      const rawText = response.content?.[0]?.text ?? ''

      // Extract JSON from response (may be wrapped in code blocks)
      const jsonMatch = rawText.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        throw new Error('No valid JSON in response')
      }

      const changes: WhatIfChanges = JSON.parse(jsonMatch[0])
      changes.is_vision = isVision

      setLastResult(changes)
      setAnimPhase('done')

      // Add to stacked scenarios
      const entry: StackedScenario = {
        scenario: userMessage,
        changes,
        timestamp: new Date().toLocaleTimeString(),
        isVision,
      }
      setStackedScenarios(prev => [...prev, entry])
      setWhatIfActive(true)

      // Dispatch world animation event
      window.dispatchEvent(new CustomEvent('nw:what-if-apply', {
        detail: {
          changes,
          scenario: userMessage,
          stacked: stackedScenarios.length > 0,
          isVision,
        },
      }))

      // Clear input
      if (isVision) setVisionInput('')
      else setInput('')

    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return
      console.error('[WhatIfSimulator] Simulation error:', err)
      setError(err instanceof Error ? err.message : 'Simulation failed. Check API configuration.')
      setAnimPhase('idle')
    } finally {
      setLoading(false)
    }
  }, [buildContextJson, stackedScenarios.length])

  const handleExit = useCallback(() => {
    setWhatIfActive(false)
    setStackedScenarios([])
    setLastResult(null)
    setAnimPhase('idle')
    window.dispatchEvent(new CustomEvent('nw:what-if-exit', { detail: {} }))
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>, isVision: boolean) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      runSimulation(isVision ? visionInput : input, isVision)
    }
  }, [input, visionInput, runSimulation])

  if (!visible) return null

  return (
    <>
      {/* ── WHAT-IF MODE BADGE (top center, always visible when active) ── */}
      {whatIfActive && stackedScenarios.length > 0 && (
        <div style={{
          position: 'absolute',
          top: 14,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 70,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 14px',
          background: 'rgba(255,160,0,0.15)',
          border: '1px solid rgba(255,160,0,0.5)',
          borderRadius: 20,
          backdropFilter: 'blur(8px)',
          maxWidth: '60vw',
          boxShadow: '0 0 20px rgba(255,160,0,0.2)',
          pointerEvents: 'all',
        }}>
          <span style={{ color: '#ffa000', fontSize: 13 }}>⚡</span>
          <span style={{
            color: '#ffa000',
            fontSize: 10,
            fontFamily: 'monospace',
            fontWeight: 700,
            letterSpacing: 1,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: 300,
          }}>
            WHAT IF: {stackedScenarios[stackedScenarios.length - 1]?.scenario}
          </span>
          {stackedScenarios.length > 1 && (
            <span style={{
              color: 'rgba(255,160,0,0.6)',
              fontSize: 9,
              fontFamily: 'monospace',
              background: 'rgba(255,160,0,0.15)',
              borderRadius: 10,
              padding: '1px 5px',
            }}>
              +{stackedScenarios.length - 1}
            </span>
          )}
          <button
            onClick={handleExit}
            style={{
              background: 'rgba(255,100,0,0.2)',
              border: '1px solid rgba(255,100,0,0.5)',
              borderRadius: 10,
              color: '#ff6400',
              fontSize: 9,
              fontFamily: 'monospace',
              letterSpacing: 1,
              padding: '2px 8px',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              marginLeft: 4,
              transition: 'all 0.15s',
            }}
          >
            EXIT WHAT-IF
          </button>
        </div>
      )}

      {/* ── PANEL ── */}
      <div
        onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 60,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: animIn ? 'rgba(0,0,0,0.50)' : 'rgba(0,0,0,0)',
          backdropFilter: animIn ? 'blur(4px)' : 'blur(0px)',
          transition: 'background 0.3s, backdrop-filter 0.3s',
          pointerEvents: 'all',
        }}
      >
        <div
          style={{
            width: 500,
            maxHeight: '85vh',
            display: 'flex',
            flexDirection: 'column',
            background: 'rgba(6,12,24,0.97)',
            border: '1px solid rgba(255,160,0,0.35)',
            borderRadius: 12,
            boxShadow: '0 0 50px rgba(255,160,0,0.15), 0 8px 32px rgba(0,0,0,0.7)',
            overflow: 'hidden',
            opacity: animIn ? 1 : 0,
            transform: animIn ? 'translateY(0) scale(1)' : 'translateY(24px) scale(0.97)',
            transition: 'opacity 0.28s, transform 0.28s',
            fontFamily: 'monospace',
          }}
        >
          {/* ── HEADER ── */}
          <div style={{
            padding: '14px 18px 12px',
            borderBottom: '1px solid rgba(255,160,0,0.2)',
            background: 'linear-gradient(135deg, rgba(255,160,0,0.08) 0%, transparent 60%)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexShrink: 0,
          }}>
            <div style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              background: 'rgba(255,160,0,0.15)',
              border: '1px solid rgba(255,160,0,0.4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 18,
              flexShrink: 0,
            }}>
              ⚡
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ color: '#ffa000', fontSize: 13, fontWeight: 700, letterSpacing: 2 }}>
                WHAT-IF SIMULATOR
              </div>
              <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, marginTop: 2 }}>
                Simulate scenarios · Reshape the Neural World
              </div>
            </div>
            <button
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                color: 'rgba(255,255,255,0.4)',
                fontSize: 18,
                cursor: 'pointer',
                padding: 4,
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>

          {/* ── TAB SWITCHER ── */}
          <div style={{
            display: 'flex',
            padding: '0 18px',
            gap: 4,
            borderBottom: '1px solid rgba(255,255,255,0.08)',
            flexShrink: 0,
            background: 'rgba(0,0,0,0.2)',
          }}>
            <button
              onClick={() => setActiveTab('whatif')}
              style={{
                background: 'none',
                border: 'none',
                borderBottom: activeTab === 'whatif' ? '2px solid #ffa000' : '2px solid transparent',
                color: activeTab === 'whatif' ? '#ffa000' : 'rgba(255,255,255,0.35)',
                fontSize: 9,
                fontFamily: 'monospace',
                letterSpacing: 1.5,
                padding: '8px 10px 6px',
                cursor: 'pointer',
                textTransform: 'uppercase',
                transition: 'color 0.15s, border-color 0.15s',
              }}
            >
              ⚡ WHAT IF…
            </button>
            <button
              onClick={() => setActiveTab('vision')}
              style={{
                background: 'none',
                border: 'none',
                borderBottom: activeTab === 'vision' ? '2px solid #00ccff' : '2px solid transparent',
                color: activeTab === 'vision' ? '#00ccff' : 'rgba(255,255,255,0.35)',
                fontSize: 9,
                fontFamily: 'monospace',
                letterSpacing: 1.5,
                padding: '8px 10px 6px',
                cursor: 'pointer',
                textTransform: 'uppercase',
                transition: 'color 0.15s, border-color 0.15s',
              }}
            >
              🌟 I ENVISION…
            </button>
          </div>

          {/* ── BODY ── */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px' }}>

            {/* ── WHAT IF TAB ── */}
            {activeTab === 'whatif' && (
              <div>
                <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 10, letterSpacing: 1, marginBottom: 8 }}>
                  TYPE A SCENARIO — PRESS ENTER TO SIMULATE
                </div>
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => handleKeyDown(e, false)}
                  placeholder="What if I add a second crew?"
                  rows={3}
                  disabled={loading}
                  style={{
                    width: '100%',
                    background: 'rgba(255,160,0,0.06)',
                    border: '1px solid rgba(255,160,0,0.3)',
                    borderRadius: 8,
                    color: 'rgba(255,255,255,0.85)',
                    fontSize: 13,
                    fontFamily: 'monospace',
                    padding: '10px 12px',
                    resize: 'none',
                    outline: 'none',
                    lineHeight: 1.6,
                    boxSizing: 'border-box',
                    transition: 'border-color 0.15s',
                    opacity: loading ? 0.6 : 1,
                  }}
                />

                {/* Suggestion chips */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                  {SCENARIO_CHIPS.map((chip, i) => (
                    <button
                      key={i}
                      onClick={() => setInput(chip)}
                      style={{
                        background: 'rgba(255,160,0,0.08)',
                        border: '1px solid rgba(255,160,0,0.25)',
                        borderRadius: 12,
                        color: 'rgba(255,160,0,0.8)',
                        fontSize: 9,
                        fontFamily: 'monospace',
                        padding: '4px 10px',
                        cursor: 'pointer',
                        letterSpacing: 0.5,
                        transition: 'all 0.12s',
                      }}
                    >
                      {chip}
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => runSimulation(input, false)}
                  disabled={loading || !input.trim()}
                  style={{
                    marginTop: 12,
                    width: '100%',
                    padding: '10px 0',
                    background: loading
                      ? 'rgba(255,160,0,0.08)'
                      : input.trim()
                        ? 'rgba(255,160,0,0.2)'
                        : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${loading ? 'rgba(255,160,0,0.3)' : input.trim() ? 'rgba(255,160,0,0.6)' : 'rgba(255,255,255,0.1)'}`,
                    borderRadius: 6,
                    color: input.trim() ? '#ffa000' : 'rgba(255,255,255,0.25)',
                    fontSize: 12,
                    fontFamily: 'monospace',
                    letterSpacing: 1.5,
                    cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
                    fontWeight: 700,
                    transition: 'all 0.15s',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                  }}
                >
                  {loading ? (
                    <>
                      <span style={{ display: 'inline-block', animation: 'nw-spin 1s linear infinite' }}>◌</span>
                      SIMULATING SCENARIO…
                    </>
                  ) : (
                    '⚡ SIMULATE'
                  )}
                </button>

                {/* Stack info */}
                {whatIfActive && stackedScenarios.length > 0 && (
                  <div style={{
                    marginTop: 8,
                    padding: '6px 10px',
                    background: 'rgba(255,160,0,0.06)',
                    border: '1px solid rgba(255,160,0,0.2)',
                    borderRadius: 6,
                    fontSize: 9,
                    color: 'rgba(255,160,0,0.7)',
                    letterSpacing: 0.5,
                  }}>
                    ⚡ {stackedScenarios.length} scenario{stackedScenarios.length !== 1 ? 's' : ''} stacked.
                    Type another to combine effects.
                  </div>
                )}
              </div>
            )}

            {/* ── VISION TAB ── */}
            {activeTab === 'vision' && (
              <div>
                <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 10, letterSpacing: 1, marginBottom: 4 }}>
                  DESCRIBE A FEATURE OR TOOL YOU WANT TO BUILD
                </div>
                <p style={{
                  color: 'rgba(255,255,255,0.3)',
                  fontSize: 10,
                  lineHeight: 1.6,
                  margin: '0 0 10px',
                }}>
                  The system will simulate how that integration affects agent behavior,
                  fog density, and financial flow in the Neural World.
                </p>
                <textarea
                  value={visionInput}
                  onChange={(e) => setVisionInput(e.target.value)}
                  onKeyDown={(e) => handleKeyDown(e, true)}
                  placeholder="an automated invoice follow-up system"
                  rows={3}
                  disabled={loading}
                  style={{
                    width: '100%',
                    background: 'rgba(0,200,255,0.05)',
                    border: '1px solid rgba(0,200,255,0.25)',
                    borderRadius: 8,
                    color: 'rgba(255,255,255,0.85)',
                    fontSize: 13,
                    fontFamily: 'monospace',
                    padding: '10px 12px',
                    resize: 'none',
                    outline: 'none',
                    lineHeight: 1.6,
                    boxSizing: 'border-box',
                    opacity: loading ? 0.6 : 1,
                  }}
                />

                {/* Vision suggestion chips */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                  {VISION_CHIPS.map((chip, i) => (
                    <button
                      key={i}
                      onClick={() => setVisionInput(chip)}
                      style={{
                        background: 'rgba(0,200,255,0.06)',
                        border: '1px solid rgba(0,200,255,0.2)',
                        borderRadius: 12,
                        color: 'rgba(0,200,255,0.75)',
                        fontSize: 9,
                        fontFamily: 'monospace',
                        padding: '4px 10px',
                        cursor: 'pointer',
                        letterSpacing: 0.5,
                      }}
                    >
                      {chip}
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => runSimulation(visionInput, true)}
                  disabled={loading || !visionInput.trim()}
                  style={{
                    marginTop: 12,
                    width: '100%',
                    padding: '10px 0',
                    background: loading ? 'rgba(0,200,255,0.05)' : visionInput.trim() ? 'rgba(0,200,255,0.15)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${loading ? 'rgba(0,200,255,0.2)' : visionInput.trim() ? 'rgba(0,200,255,0.5)' : 'rgba(255,255,255,0.1)'}`,
                    borderRadius: 6,
                    color: visionInput.trim() ? '#00ccff' : 'rgba(255,255,255,0.25)',
                    fontSize: 12,
                    fontFamily: 'monospace',
                    letterSpacing: 1.5,
                    cursor: loading || !visionInput.trim() ? 'not-allowed' : 'pointer',
                    fontWeight: 700,
                    transition: 'all 0.15s',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                  }}
                >
                  {loading ? (
                    <>
                      <span style={{ display: 'inline-block', animation: 'nw-spin 1s linear infinite' }}>◌</span>
                      SIMULATING VISION…
                    </>
                  ) : (
                    '🌟 SIMULATE VISION'
                  )}
                </button>
              </div>
            )}

            {/* ── ERROR ── */}
            {error && (
              <div style={{
                marginTop: 10,
                padding: '8px 12px',
                background: 'rgba(255,60,60,0.08)',
                border: '1px solid rgba(255,60,60,0.3)',
                borderRadius: 6,
                color: '#ff6666',
                fontSize: 10,
                letterSpacing: 0.5,
                lineHeight: 1.5,
              }}>
                ⚠ {error}
              </div>
            )}

            {/* ── RESULT CARD ── */}
            {lastResult && animPhase === 'done' && (
              <div style={{
                marginTop: 14,
                padding: '12px 14px',
                background: lastResult.is_vision
                  ? 'rgba(0,200,255,0.06)'
                  : 'rgba(255,160,0,0.06)',
                border: `1px solid ${lastResult.is_vision ? 'rgba(0,200,255,0.25)' : 'rgba(255,160,0,0.25)'}`,
                borderRadius: 8,
              }}>
                <div style={{
                  color: lastResult.is_vision ? '#00ccff' : '#ffa000',
                  fontSize: 9,
                  letterSpacing: 1.5,
                  marginBottom: 8,
                  fontWeight: 700,
                }}>
                  {lastResult.is_vision ? '🌟 VISION SIMULATION RESULT' : '⚡ SIMULATION RESULT'}
                </div>

                {/* Narrative */}
                <p style={{
                  color: 'rgba(255,255,255,0.8)',
                  fontSize: 12,
                  lineHeight: 1.65,
                  margin: '0 0 10px',
                }}>
                  {lastResult.narrative}
                </p>

                {/* Financial impact */}
                {lastResult.financial_impact && (
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr 1fr',
                    gap: 6,
                    marginBottom: 10,
                  }}>
                    {[
                      { label: 'REVENUE Δ/mo', value: lastResult.financial_impact.monthly_revenue_delta, positive: true },
                      { label: 'COST Δ/mo', value: lastResult.financial_impact.monthly_cost_delta, positive: false },
                      { label: 'NET Δ/mo', value: lastResult.financial_impact.net_delta, positive: lastResult.financial_impact.net_delta >= 0 },
                    ].map(({ label, value, positive }) => (
                      <div key={label} style={{
                        padding: '6px 8px',
                        background: value === 0 ? 'rgba(255,255,255,0.04)' : positive === (value > 0) ? 'rgba(0,255,136,0.06)' : 'rgba(255,60,60,0.06)',
                        border: `1px solid ${value === 0 ? 'rgba(255,255,255,0.1)' : positive === (value > 0) ? 'rgba(0,255,136,0.2)' : 'rgba(255,60,60,0.2)'}`,
                        borderRadius: 6,
                        textAlign: 'center',
                      }}>
                        <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 8, letterSpacing: 1, marginBottom: 2 }}>{label}</div>
                        <div style={{
                          color: value === 0 ? 'rgba(255,255,255,0.4)' : (positive === (value > 0)) ? '#00ff88' : '#ff6666',
                          fontSize: 13,
                          fontWeight: 700,
                        }}>
                          {value >= 0 ? '+' : ''}{value >= 1000 || value <= -1000
                            ? `$${Math.abs(value / 1000).toFixed(1)}k`
                            : `$${Math.abs(value)}`}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* World changes summary */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {lastResult.agent_changes.map((ac, i) => (
                    <div key={i} style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 10,
                      color: 'rgba(255,255,255,0.55)',
                    }}>
                      <span style={{ color: '#ffcc00' }}>◆</span>
                      <span style={{ color: 'rgba(255,255,255,0.7)', fontWeight: 700 }}>{ac.agent}</span>
                      <span>flight ×{ac.flight_frequency.toFixed(1)}</span>
                    </div>
                  ))}
                  {Object.entries(lastResult.fog_changes).map(([domain, fc]) => (
                    (fc as WhatIfFogChange).density_change !== 0 && (
                      <div key={domain} style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: 10,
                        color: 'rgba(255,255,255,0.55)',
                      }}>
                        <span style={{ color: (fc as WhatIfFogChange).density_change < 0 ? '#00ff88' : '#ff9944' }}>◎</span>
                        <span style={{ color: 'rgba(255,255,255,0.7)', fontWeight: 700, textTransform: 'capitalize' }}>{domain} fog</span>
                        <span>{(fc as WhatIfFogChange).density_change < 0 ? 'clears' : 'thickens'} {Math.abs((fc as WhatIfFogChange).density_change * 100).toFixed(0)}%</span>
                      </div>
                    )
                  ))}
                </div>
              </div>
            )}

            {/* ── STACKED SCENARIOS LIST ── */}
            {stackedScenarios.length > 1 && (
              <div style={{ marginTop: 14 }}>
                <div style={{ color: 'rgba(255,255,255,0.25)', fontSize: 9, letterSpacing: 1.5, marginBottom: 6 }}>
                  STACKED SCENARIOS
                </div>
                {stackedScenarios.slice(0, -1).map((s, i) => (
                  <div key={i} style={{
                    padding: '6px 10px',
                    marginBottom: 4,
                    background: 'rgba(255,160,0,0.04)',
                    border: '1px solid rgba(255,160,0,0.15)',
                    borderRadius: 6,
                    fontSize: 10,
                    color: 'rgba(255,255,255,0.45)',
                    display: 'flex',
                    justifyContent: 'space-between',
                  }}>
                    <span>{s.scenario}</span>
                    <span style={{ color: 'rgba(255,160,0,0.4)', flexShrink: 0, marginLeft: 8 }}>{s.timestamp}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── FOOTER ── */}
          <div style={{
            padding: '10px 18px',
            borderTop: '1px solid rgba(255,255,255,0.06)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
            background: 'rgba(0,0,0,0.3)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: 'rgba(255,255,255,0.18)', fontSize: 9, letterSpacing: 1 }}>
                NEURAL WORLD SIMULATION ENGINE
              </span>
              {whatIfActive && (
                <button
                  onClick={handleExit}
                  style={{
                    background: 'rgba(255,100,0,0.12)',
                    border: '1px solid rgba(255,100,0,0.35)',
                    borderRadius: 4,
                    color: '#ff6400',
                    fontSize: 9,
                    fontFamily: 'monospace',
                    letterSpacing: 1,
                    padding: '3px 8px',
                    cursor: 'pointer',
                  }}
                >
                  EXIT WHAT-IF
                </button>
              )}
            </div>
            <button
              onClick={onClose}
              style={{
                background: 'none',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 4,
                color: 'rgba(255,255,255,0.4)',
                fontSize: 9,
                fontFamily: 'monospace',
                letterSpacing: 1,
                padding: '4px 10px',
                cursor: 'pointer',
              }}
            >
              CLOSE
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

// ── Exported HUD button ────────────────────────────────────────────────────────

interface WhatIfButtonProps {
  open: boolean
  active: boolean
  onClick: () => void
}

export function WhatIfButton({ open, active, onClick }: WhatIfButtonProps) {
  return (
    <button
      onClick={onClick}
      title="What-If Simulator"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        padding: '5px 10px',
        borderRadius: 8,
        border: open
          ? '1px solid rgba(255,160,0,0.9)'
          : active
            ? '1px solid rgba(255,160,0,0.7)'
            : '1px solid rgba(255,160,0,0.4)',
        background: open
          ? 'rgba(255,160,0,0.2)'
          : active
            ? 'rgba(255,160,0,0.12)'
            : 'rgba(0,0,0,0.55)',
        color: open || active ? '#ffa000' : 'rgba(255,160,0,0.75)',
        fontSize: 10,
        fontFamily: 'monospace',
        letterSpacing: 1.5,
        cursor: 'pointer',
        backdropFilter: 'blur(6px)',
        transition: 'all 0.18s',
        boxShadow: open ? '0 0 14px rgba(255,160,0,0.3)' : active ? '0 0 8px rgba(255,160,0,0.2)' : 'none',
        flexShrink: 0,
        fontWeight: 700,
      }}
    >
      <span style={{ fontSize: 13 }}>⚡</span>
      WHAT IF
    </button>
  )
}
