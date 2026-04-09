/**
 * ActionableInsightPanel.tsx — NW33: Clickable agent insight panel.
 *
 * When an agent completes a task cycle and returns with a data cube,
 * the cube is clickable. On click, this panel opens and shows:
 *
 *  1. WHAT HAPPENED   — full narrative of the agent interaction
 *  2. ACTIONABLE STEPS — clickable buttons that navigate to relevant panels
 *  3. IMPACT ASSESSMENT — what happens if you do vs don't act
 *
 * TRIGGER:
 *   Any component can dispatch: window.dispatchEvent(new CustomEvent('nw:cube-clicked', { detail: CubeInsightPayload }))
 *
 * PANEL NAVIGATION:
 *   Actions dispatch 'nw:panel-navigate' with { panel: string, context?: string }
 *   so the host app can handle routing to BLUEPRINT / SPARK / OHM / LEDGER / VAULT.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { getWorldData } from './DataBridge'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface CubeInsightPayload {
  /** Agent that generated this insight: 'OHM' | 'BLUEPRINT' | 'LEDGER' | 'SPARK' | 'CHRONO' | 'VAULT' | 'NEXUS' */
  agentId: string
  /** Project ID this insight is about (optional) */
  projectId?: string
  /** Project name for display */
  projectName?: string
  /** Full narrative text — "OHM visited Beauty Salon…" */
  narrative: string
  /** Structured insight data points */
  insights?: string[]
  /** Actionable steps tailored to this interaction */
  actions?: InsightAction[]
  /** Impact data for do vs don't act */
  impact?: {
    actWithin: string
    doActOutcome: string
    dontActOutcome: string
  }
  /** Timestamp of agent task completion */
  timestamp?: string
}

export interface InsightAction {
  id: string
  label: string
  description: string
  icon: string
  /** Target panel in PowerOn Hub */
  panel: string
  /** Optional context string to pass to the panel */
  context?: string
  /** Color accent for the button */
  color: string
  /** Whether this action is urgent */
  urgent?: boolean
}

// ── Agent color map ────────────────────────────────────────────────────────────

const AGENT_COLORS: Record<string, string> = {
  OHM:       '#ff6b35',
  BLUEPRINT: '#00c8ff',
  LEDGER:    '#00ff88',
  SPARK:     '#ffcc00',
  CHRONO:    '#cc88ff',
  VAULT:     '#ff4466',
  ATLAS:     '#44ddcc',
  NEXUS:     '#ffffff',
  SCOUT:     '#88ccff',
  ECHO:      '#aaffcc',
}

const AGENT_ICONS: Record<string, string> = {
  OHM:       '⚡',
  BLUEPRINT: '📐',
  LEDGER:    '💰',
  SPARK:     '🔥',
  CHRONO:    '🕐',
  VAULT:     '🏦',
  ATLAS:     '🗺',
  NEXUS:     '🧠',
  SCOUT:     '🔭',
  ECHO:      '📡',
}

// ── Default actions builder ────────────────────────────────────────────────────

function buildDefaultActions(agentId: string, projectId?: string, projectName?: string): InsightAction[] {
  const proj = projectName ?? 'this project'
  const actions: InsightAction[] = []

  if (agentId === 'OHM' || agentId === 'BLUEPRINT') {
    actions.push({
      id: 'update-progress',
      label: 'Update project progress',
      description: `Open BLUEPRINT for ${proj}`,
      icon: '📐',
      panel: 'blueprint-ai',
      context: projectId,
      color: '#00c8ff',
    })
    actions.push({
      id: 'reach-ahj',
      label: 'Reach out to AHJ or CSLB',
      description: 'Open OHM compliance panel with pre-filled context',
      icon: '⚡',
      panel: 'guardian',
      context: projectId,
      color: '#ff6b35',
      urgent: true,
    })
  }

  if (agentId === 'LEDGER' || agentId === 'VAULT') {
    actions.push({
      id: 'collect-payment',
      label: 'Collect payment',
      description: `Open LEDGER AR view for ${proj}`,
      icon: '💰',
      panel: 'debt-killer',
      context: projectId,
      color: '#00ff88',
      urgent: true,
    })
    actions.push({
      id: 'lien',
      label: 'Put a lien on project',
      description: 'Open lien template and filing guide',
      icon: '📋',
      panel: 'blueprint-ai',
      context: 'lien-template',
      color: '#ff4466',
    })
    actions.push({
      id: 'payment-projection',
      label: 'Payment projection plan',
      description: 'Open VAULT financial projection',
      icon: '📊',
      panel: 'debt-killer',
      context: 'projection',
      color: '#cc88ff',
    })
  }

  if (agentId === 'SPARK') {
    actions.push({
      id: 'follow-up',
      label: 'Follow up with customer',
      description: 'Open SPARK lead/contact view',
      icon: '🔥',
      panel: 'spark-live-call',
      context: projectId,
      color: '#ffcc00',
    })
  }

  if (agentId === 'CHRONO' || agentId === 'BLUEPRINT') {
    actions.push({
      id: 'schedule',
      label: 'Schedule crew visit',
      description: 'Open CHRONO scheduling panel',
      icon: '🕐',
      panel: 'crew-portal',
      context: projectId,
      color: '#cc88ff',
    })
  }

  // Generic actions always available
  if (!actions.find(a => a.id === 'follow-up')) {
    actions.push({
      id: 'follow-up',
      label: 'Follow up with customer',
      description: 'Open SPARK lead/contact view',
      icon: '🔥',
      panel: 'spark-live-call',
      context: projectId,
      color: '#ffcc00',
    })
  }
  if (!actions.find(a => a.id === 'collect-payment')) {
    actions.push({
      id: 'collect-payment',
      label: 'Collect payment',
      description: `Open LEDGER AR view`,
      icon: '💰',
      panel: 'debt-killer',
      context: projectId,
      color: '#00ff88',
    })
  }

  return actions
}

// ── Default impact builder ─────────────────────────────────────────────────────

function buildDefaultImpact(agentId: string, projectName?: string): CubeInsightPayload['impact'] {
  const proj = projectName ?? 'this project'
  if (agentId === 'OHM') {
    return {
      actWithin: '7 days',
      doActOutcome: `Resolving open items moves ${proj} to next phase. Mountain turns light green.`,
      dontActOutcome: `Unresolved past 14 days: OHM flags as critical. Mountain stays red. AR stalactite begins growing.`,
    }
  }
  if (agentId === 'LEDGER') {
    return {
      actWithin: '5 days',
      doActOutcome: `Invoice collected. Revenue fog clears green. LEDGER returns to idle flight.`,
      dontActOutcome: `AR ages past 30 days. Stalactite grows in LEDGER domain. Risk surface layer activates.`,
    }
  }
  if (agentId === 'SPARK') {
    return {
      actWithin: '48 hours',
      doActOutcome: `Lead stays warm. Follow-up scheduled. Opportunity node brightens in territory view.`,
      dontActOutcome: `Lead goes cold after 72 hours. Territory node dims. Pipeline score drops.`,
    }
  }
  return {
    actWithin: '7 days',
    doActOutcome: `Action taken moves project forward. Neural World metrics improve.`,
    dontActOutcome: `Inaction causes stagnation. Agent flags increase. Fog density rises.`,
  }
}

// ── Sample payload generator (used when no payload provided) ──────────────────

function buildSamplePayload(): CubeInsightPayload {
  const data = getWorldData()
  const projects = data?.projects ?? []
  const inProgress = projects.filter(p => p.status === 'in_progress')
  const proj = inProgress[0] ?? projects[0]

  if (!proj) {
    return {
      agentId: 'OHM',
      narrative: 'OHM completed a compliance scan. No active projects found in the system. Add projects to begin generating actionable insights.',
      insights: ['No active projects detected', 'System ready for data entry'],
      timestamp: new Date().toISOString(),
    }
  }

  const rfis = data?.rfis?.filter(r => r.project_id === proj.id && r.status === 'open') ?? []
  const openInvoices = data?.invoices?.filter(i => i.project_id === proj.id && i.status !== 'paid') ?? []

  return {
    agentId: 'OHM',
    projectId: proj.id,
    projectName: proj.name,
    narrative: `OHM visited ${proj.name}. Found ${rfis.length} open compliance item${rfis.length !== 1 ? 's' : ''}.` +
      (openInvoices.length > 0 ? ` ${openInvoices.length} open invoice${openInvoices.length !== 1 ? 's' : ''} pending collection.` : '') +
      ` Project health score: ${proj.health_score}/100. Phase completion: ${proj.phase_completion}%.`,
    insights: [
      `${rfis.length} open RFI${rfis.length !== 1 ? 's' : ''} requiring resolution`,
      `Health score: ${proj.health_score}/100`,
      `Phase completion: ${proj.phase_completion}%`,
      openInvoices.length > 0 ? `$${openInvoices.reduce((s, i) => s + i.amount, 0).toLocaleString()} in open invoices` : 'Invoicing up to date',
    ],
    timestamp: new Date().toISOString(),
  }
}

// ── Props ──────────────────────────────────────────────────────────────────────

interface ActionableInsightPanelProps {
  open: boolean
  payload: CubeInsightPayload | null
  onClose: () => void
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function ActionableInsightPanel({ open, payload: externalPayload, onClose }: ActionableInsightPanelProps) {
  const [visible, setVisible] = useState(false)
  const [animIn, setAnimIn]   = useState(false)
  const [activeSection, setActiveSection] = useState<'narrative' | 'actions' | 'impact'>('narrative')
  const [navFeedback, setNavFeedback]     = useState<string | null>(null)
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const payload = externalPayload ?? (open ? buildSamplePayload() : null)

  // Animate in/out
  useEffect(() => {
    if (open) {
      setVisible(true)
      requestAnimationFrame(() => setAnimIn(true))
    } else {
      setAnimIn(false)
      const t = setTimeout(() => setVisible(false), 320)
      return () => clearTimeout(t)
    }
  }, [open])

  // Reset section when new payload arrives
  useEffect(() => {
    if (open) setActiveSection('narrative')
  }, [open, externalPayload])

  const handleNavigate = useCallback((action: InsightAction) => {
    // Dispatch panel navigation event for the host app to handle
    window.dispatchEvent(new CustomEvent('nw:panel-navigate', {
      detail: { panel: action.panel, context: action.context, projectId: payload?.projectId },
    }))
    setNavFeedback(`Opening ${action.label}…`)
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
    feedbackTimerRef.current = setTimeout(() => setNavFeedback(null), 2500)
  }, [payload])

  if (!visible || !payload) return null

  const agentColor = AGENT_COLORS[payload.agentId] ?? '#ffffff'
  const agentIcon  = AGENT_ICONS[payload.agentId]  ?? '◆'
  const actions    = payload.actions ?? buildDefaultActions(payload.agentId, payload.projectId, payload.projectName)
  const impact     = payload.impact  ?? buildDefaultImpact(payload.agentId, payload.projectName)
  const ts         = payload.timestamp ? new Date(payload.timestamp).toLocaleTimeString() : null

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: animIn ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0)',
        backdropFilter: animIn ? 'blur(4px)' : 'blur(0px)',
        transition: 'background 0.3s, backdrop-filter 0.3s',
        pointerEvents: 'all',
      }}
    >
      <div
        style={{
          width: 480,
          maxHeight: '82vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'rgba(6,14,28,0.97)',
          border: `1px solid ${agentColor}44`,
          borderRadius: 12,
          boxShadow: `0 0 40px ${agentColor}22, 0 8px 32px rgba(0,0,0,0.6)`,
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
          borderBottom: `1px solid ${agentColor}30`,
          background: `linear-gradient(135deg, ${agentColor}10 0%, transparent 60%)`,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexShrink: 0,
        }}>
          <div style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            background: `${agentColor}20`,
            border: `1px solid ${agentColor}50`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 18,
            flexShrink: 0,
          }}>
            {agentIcon}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: agentColor, fontSize: 13, fontWeight: 700, letterSpacing: 1.5 }}>
                {payload.agentId}
              </span>
              <span style={{
                fontSize: 9,
                color: `${agentColor}80`,
                background: `${agentColor}18`,
                border: `1px solid ${agentColor}30`,
                borderRadius: 3,
                padding: '1px 5px',
                letterSpacing: 1,
              }}>
                INSIGHT
              </span>
            </div>
            {payload.projectName && (
              <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 10, marginTop: 2, letterSpacing: 0.5 }}>
                {payload.projectName}
                {ts && <span style={{ opacity: 0.5 }}> · {ts}</span>}
              </div>
            )}
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
              flexShrink: 0,
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
          borderBottom: `1px solid rgba(255,255,255,0.08)`,
          flexShrink: 0,
          background: 'rgba(0,0,0,0.2)',
        }}>
          {(['narrative', 'actions', 'impact'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveSection(tab)}
              style={{
                background: 'none',
                border: 'none',
                borderBottom: activeSection === tab ? `2px solid ${agentColor}` : '2px solid transparent',
                color: activeSection === tab ? agentColor : 'rgba(255,255,255,0.4)',
                fontSize: 9,
                fontFamily: 'monospace',
                letterSpacing: 1.5,
                padding: '8px 10px 6px',
                cursor: 'pointer',
                textTransform: 'uppercase',
                transition: 'color 0.15s, border-color 0.15s',
              }}
            >
              {tab === 'narrative' ? '① WHAT HAPPENED' : tab === 'actions' ? '② ACT NOW' : '③ IMPACT'}
            </button>
          ))}
        </div>

        {/* ── BODY ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px' }}>

          {/* ── SECTION: WHAT HAPPENED ── */}
          {activeSection === 'narrative' && (
            <div>
              <p style={{
                color: 'rgba(255,255,255,0.85)',
                fontSize: 13,
                lineHeight: 1.65,
                margin: '0 0 14px',
              }}>
                {payload.narrative}
              </p>
              {payload.insights && payload.insights.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {payload.insights.map((item, i) => (
                    <div key={i} style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 8,
                      padding: '7px 10px',
                      background: `${agentColor}08`,
                      border: `1px solid ${agentColor}20`,
                      borderRadius: 6,
                      fontSize: 11,
                      color: 'rgba(255,255,255,0.7)',
                      lineHeight: 1.5,
                    }}>
                      <span style={{ color: agentColor, opacity: 0.7, flexShrink: 0, marginTop: 1 }}>◆</span>
                      {item}
                    </div>
                  ))}
                </div>
              )}
              <button
                onClick={() => setActiveSection('actions')}
                style={{
                  marginTop: 16,
                  width: '100%',
                  padding: '9px 0',
                  background: `${agentColor}18`,
                  border: `1px solid ${agentColor}40`,
                  borderRadius: 6,
                  color: agentColor,
                  fontSize: 11,
                  fontFamily: 'monospace',
                  letterSpacing: 1,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                SEE RECOMMENDED ACTIONS →
              </button>
            </div>
          )}

          {/* ── SECTION: ACTIONABLE STEPS ── */}
          {activeSection === 'actions' && (
            <div>
              <div style={{
                color: 'rgba(255,255,255,0.4)',
                fontSize: 9,
                letterSpacing: 1.5,
                marginBottom: 12,
              }}>
                SELECT AN ACTION TO TAKE
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {actions.map(action => (
                  <button
                    key={action.id}
                    onClick={() => handleNavigate(action)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '10px 12px',
                      background: `${action.color}10`,
                      border: `1px solid ${action.color}${action.urgent ? '60' : '30'}`,
                      borderRadius: 8,
                      cursor: 'pointer',
                      textAlign: 'left',
                      width: '100%',
                      transition: 'all 0.15s',
                      boxShadow: action.urgent ? `0 0 8px ${action.color}20` : 'none',
                    }}
                  >
                    <span style={{
                      fontSize: 18,
                      flexShrink: 0,
                      width: 28,
                      textAlign: 'center',
                    }}>
                      {action.icon}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}>
                        <span style={{ color: action.color, fontSize: 12, fontWeight: 700, letterSpacing: 0.5 }}>
                          {action.label}
                        </span>
                        {action.urgent && (
                          <span style={{
                            fontSize: 8,
                            background: `${action.color}30`,
                            border: `1px solid ${action.color}60`,
                            color: action.color,
                            borderRadius: 3,
                            padding: '1px 4px',
                            letterSpacing: 1,
                          }}>
                            URGENT
                          </span>
                        )}
                      </div>
                      <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, marginTop: 2 }}>
                        {action.description}
                      </div>
                    </div>
                    <span style={{ color: `${action.color}80`, fontSize: 14, flexShrink: 0 }}>→</span>
                  </button>
                ))}
              </div>
              {navFeedback && (
                <div style={{
                  marginTop: 12,
                  padding: '8px 12px',
                  background: 'rgba(0,255,136,0.1)',
                  border: '1px solid rgba(0,255,136,0.3)',
                  borderRadius: 6,
                  color: '#00ff88',
                  fontSize: 11,
                  letterSpacing: 0.5,
                  animation: 'fadeIn 0.2s ease',
                }}>
                  ✓ {navFeedback}
                </div>
              )}
            </div>
          )}

          {/* ── SECTION: IMPACT ASSESSMENT ── */}
          {activeSection === 'impact' && impact && (
            <div>
              <div style={{
                color: 'rgba(255,255,255,0.4)',
                fontSize: 9,
                letterSpacing: 1.5,
                marginBottom: 12,
              }}>
                WHAT HAPPENS IF YOU ACT vs DON'T
              </div>

              <div style={{
                padding: '10px 12px',
                background: 'rgba(0,255,136,0.06)',
                border: '1px solid rgba(0,255,136,0.25)',
                borderRadius: 8,
                marginBottom: 10,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <span style={{ fontSize: 14 }}>✅</span>
                  <span style={{
                    color: '#00ff88',
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: 1,
                  }}>
                    IF YOU ACT WITHIN {impact.actWithin.toUpperCase()}
                  </span>
                </div>
                <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12, lineHeight: 1.6, margin: 0 }}>
                  {impact.doActOutcome}
                </p>
              </div>

              <div style={{
                padding: '10px 12px',
                background: 'rgba(255,60,60,0.06)',
                border: '1px solid rgba(255,60,60,0.25)',
                borderRadius: 8,
                marginBottom: 16,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <span style={{ fontSize: 14 }}>⚠️</span>
                  <span style={{
                    color: '#ff4444',
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: 1,
                  }}>
                    IF YOU DON'T ACT
                  </span>
                </div>
                <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12, lineHeight: 1.6, margin: 0 }}>
                  {impact.dontActOutcome}
                </p>
              </div>

              <button
                onClick={() => setActiveSection('actions')}
                style={{
                  width: '100%',
                  padding: '10px 0',
                  background: `${agentColor}20`,
                  border: `1px solid ${agentColor}50`,
                  borderRadius: 6,
                  color: agentColor,
                  fontSize: 11,
                  fontFamily: 'monospace',
                  letterSpacing: 1,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  fontWeight: 700,
                }}
              >
                ⚡ TAKE ACTION NOW
              </button>
            </div>
          )}
        </div>

        {/* ── FOOTER ── */}
        <div style={{
          padding: '10px 18px',
          borderTop: `1px solid rgba(255,255,255,0.06)`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
          background: 'rgba(0,0,0,0.3)',
        }}>
          <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 9, letterSpacing: 1 }}>
            {payload.agentId} · NEURAL WORLD INSIGHT ENGINE
          </span>
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
            DISMISS
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Exported trigger button ────────────────────────────────────────────────────

interface InsightButtonProps {
  active: boolean
  hasNew: boolean
  onClick: () => void
}

export function InsightTriggerButton({ active, hasNew, onClick }: InsightButtonProps) {
  return (
    <button
      onClick={onClick}
      title="Agent Insights"
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 36,
        height: 36,
        borderRadius: 8,
        border: active
          ? '1px solid rgba(255,107,53,0.9)'
          : '1px solid rgba(255,107,53,0.4)',
        background: active
          ? 'rgba(255,107,53,0.25)'
          : 'rgba(0,0,0,0.55)',
        color: active ? '#ff6b35' : 'rgba(255,107,53,0.75)',
        fontSize: 17,
        cursor: 'pointer',
        backdropFilter: 'blur(6px)',
        transition: 'all 0.18s',
        boxShadow: active ? '0 0 14px rgba(255,107,53,0.35)' : 'none',
        flexShrink: 0,
      }}
    >
      ◆
      {hasNew && (
        <span style={{
          position: 'absolute',
          top: 5,
          right: 5,
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: '#ff4466',
          boxShadow: '0 0 6px #ff4466',
          animation: 'nw-blink 1.2s ease infinite',
        }} />
      )}
    </button>
  )
}
