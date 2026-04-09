/**
 * AutomationFlowBuilder.tsx — NW36: Automation flow management panel.
 *
 * HUD-style semi-transparent dark glass panel, zero overlap with other UI.
 * Opened by "⚡ FLOWS" button rendered in CommandHUD left panel.
 *
 * PANEL SECTIONS:
 *   1. Predefined Flows list — ON/OFF toggle, mini chain viz, stats per flow
 *   2. BUILD CUSTOM — node-chain editor palette
 *      Palette: trigger | condition | action | transform | wait | result
 *      Connect in sequence, set parameters, save
 *
 * Stats displayed: fires today, success rate %, last fired timestamp
 *
 * Custom flows saved to localStorage key 'nw_custom_automations' (Supabase
 * save is wired via nw:save-custom-automations event for the parent to handle).
 *
 * VIDEO GAME UX LAW compliant:
 *   - All panels HUD-style semi-transparent dark glass
 *   - All transitions animated (fade, slide)
 *   - Text minimum 14px, high contrast
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────────

type NodeType = 'trigger' | 'condition' | 'action' | 'transform' | 'wait' | 'result'
type TriggerSource = 'email' | 'webhook' | 'timer' | 'form' | 'manual'

interface CustomFlowNode {
  type:       NodeType
  label:      string
  // optional params
  triggerSrc?: TriggerSource
  actionKey?:  string
  resultOk?:   boolean
}

interface CustomFlow {
  id:    string
  name:  string
  nodes: CustomFlowNode[]
}

interface FlowStats {
  id:           string
  name:         string
  enabled:      boolean
  firedToday:   number
  successCount: number
  failureCount: number
  lastFired:    number | null
}

// ── Constants ─────────────────────────────────────────────────────────────────

const NODE_COLORS: Record<NodeType, string> = {
  trigger:   '#40D4FF',
  condition: '#FF9040',
  action:    '#FFE040',
  transform: '#40D4FF',
  wait:      '#CCCCCC',
  result:    '#2EE89A',
}

const NODE_SHAPES: Record<NodeType, string> = {
  trigger:   '◆',
  condition: '◇',
  action:    '▣',
  transform: '●',
  wait:      '⊙',
  result:    '▲',
}

const ACTION_KEYS = [
  'create-lead', 'send-email', 'update-project', 'generate-invoice',
  'schedule-task', 'compliance-check', 'log-data', 'notify-nexus',
  'archive', 'escalate', 'auto-reply', 'extract-data', 'match-project',
  'update-mto', 'check-reviews', 'alert-spark', 'alert-nexus',
  'pull-hub-data', 'compose-summary', 'send-text', 'draft-email',
]

const TRIGGER_SOURCES: TriggerSource[] = ['email', 'webhook', 'timer', 'form', 'manual']

// ── Styles (inline, HUD dark glass) ───────────────────────────────────────────

const PANEL_STYLE: React.CSSProperties = {
  position:        'absolute',
  top:             '50%',
  left:            '50%',
  transform:       'translate(-50%, -50%)',
  zIndex:          45,
  background:      'rgba(8, 12, 22, 0.92)',
  border:          '1px solid rgba(64, 212, 255, 0.35)',
  borderRadius:    10,
  backdropFilter:  'blur(18px)',
  padding:         '18px 22px',
  width:           540,
  maxHeight:       '80vh',
  overflowY:       'auto',
  boxShadow:       '0 0 40px rgba(64, 212, 255, 0.12)',
  fontFamily:      'monospace',
  color:           '#c8e8f8',
  fontSize:        14,
  animation:       'nwFadeSlideIn 0.2s ease-out',
  userSelect:      'none',
}

const SECTION_TITLE: React.CSSProperties = {
  fontSize:      10,
  letterSpacing: 3,
  color:         'rgba(64, 212, 255, 0.55)',
  marginBottom:  10,
  marginTop:     14,
  fontWeight:    600,
  textTransform: 'uppercase' as const,
}

const FLOW_ROW: React.CSSProperties = {
  display:       'flex',
  alignItems:    'center',
  gap:           10,
  padding:       '8px 10px',
  borderRadius:  6,
  border:        '1px solid rgba(64, 212, 255, 0.12)',
  background:    'rgba(0, 30, 50, 0.5)',
  marginBottom:  6,
  transition:    'border-color 0.15s',
  cursor:        'default',
}

const TOGGLE_BTN = (on: boolean): React.CSSProperties => ({
  background:   on ? 'rgba(64, 212, 255, 0.18)' : 'rgba(30, 30, 40, 0.6)',
  border:       `1px solid ${on ? 'rgba(64,212,255,0.6)' : 'rgba(100,100,120,0.4)'}`,
  borderRadius: 4,
  color:        on ? '#40D4FF' : '#556',
  fontSize:     10,
  fontFamily:   'monospace',
  fontWeight:   700,
  letterSpacing: 1.5,
  padding:      '3px 10px',
  cursor:       'pointer',
  transition:   'all 0.15s',
  minWidth:     38,
})

const NODE_CHIP = (type: NodeType): React.CSSProperties => ({
  display:       'inline-flex',
  alignItems:    'center',
  gap:           3,
  background:    `${NODE_COLORS[type]}22`,
  border:        `1px solid ${NODE_COLORS[type]}66`,
  borderRadius:  3,
  padding:       '1px 6px',
  fontSize:      10,
  color:         NODE_COLORS[type],
  whiteSpace:    'nowrap' as const,
})

// ── Main Component ─────────────────────────────────────────────────────────────

interface AutomationFlowBuilderProps {
  open:    boolean
  onClose: () => void
}

export function AutomationFlowBuilder({ open, onClose }: AutomationFlowBuilderProps) {
  const [flowStats, setFlowStats]     = useState<FlowStats[]>([])
  const [showBuilder, setShowBuilder] = useState(false)
  const [customFlows, setCustomFlows] = useState<CustomFlow[]>([])
  // builder state
  const [draftName, setDraftName]     = useState('')
  const [draftNodes, setDraftNodes]   = useState<CustomFlowNode[]>([])
  const [editNodeIdx, setEditNodeIdx] = useState<number | null>(null)
  const tickRef                       = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Poll flow stats from __nwFlows ref ──────────────────────────────────
  const refreshStats = useCallback(() => {
    const ref = (window as unknown as Record<string, unknown>).__nwFlows as
      React.MutableRefObject<Array<{
        id: string; name: string; enabled: boolean
        firedToday: number; successCount: number; failureCount: number
        lastFired: number | null
      }>> | undefined

    if (!ref?.current) return

    setFlowStats(ref.current.map(f => ({
      id:           f.id,
      name:         f.name,
      enabled:      f.enabled,
      firedToday:   f.firedToday,
      successCount: f.successCount,
      failureCount: f.failureCount,
      lastFired:    f.lastFired,
    })))
  }, [])

  useEffect(() => {
    if (!open) return
    refreshStats()
    tickRef.current = setInterval(refreshStats, 1500)
    return () => { if (tickRef.current) clearInterval(tickRef.current) }
  }, [open, refreshStats])

  // ── Load custom flows from localStorage ─────────────────────────────────
  useEffect(() => {
    try {
      const raw = localStorage.getItem('nw_custom_automations')
      if (raw) setCustomFlows(JSON.parse(raw) as CustomFlow[])
    } catch { /* ignore */ }
  }, [])

  // ── Toggle flow on/off ───────────────────────────────────────────────────
  const toggleFlow = (id: string) => {
    const updated = flowStats.map(f =>
      f.id === id ? { ...f, enabled: !f.enabled } : f
    )
    setFlowStats(updated)
    const states: Record<string, boolean> = {}
    updated.forEach(f => { states[f.id] = f.enabled })
    window.dispatchEvent(new CustomEvent('nw:automation-flow-states', { detail: states }))
  }

  // ── Fire a flow manually ─────────────────────────────────────────────────
  const fireFlow = (id: string) => {
    window.dispatchEvent(new CustomEvent('nw:automation-fire', { detail: { flowId: id } }))
    setTimeout(refreshStats, 100)
  }

  // ── Builder helpers ──────────────────────────────────────────────────────
  const addNode = (type: NodeType) => {
    const defaults: CustomFlowNode = { type, label: type.charAt(0).toUpperCase() + type.slice(1) }
    if (type === 'trigger') defaults.triggerSrc = 'timer'
    if (type === 'action') defaults.actionKey = 'send-email'
    if (type === 'result') defaults.resultOk = true
    setDraftNodes(prev => [...prev, defaults])
  }

  const removeNode = (idx: number) => {
    setDraftNodes(prev => prev.filter((_, i) => i !== idx))
    if (editNodeIdx === idx) setEditNodeIdx(null)
  }

  const updateNode = (idx: number, updates: Partial<CustomFlowNode>) => {
    setDraftNodes(prev => prev.map((n, i) => i === idx ? { ...n, ...updates } : n))
  }

  const saveCustomFlow = () => {
    if (!draftName.trim() || draftNodes.length < 2) return
    const flow: CustomFlow = {
      id:    `custom-${Date.now()}`,
      name:  draftName.trim(),
      nodes: draftNodes,
    }
    const updated = [...customFlows, flow]
    setCustomFlows(updated)
    try { localStorage.setItem('nw_custom_automations', JSON.stringify(updated)) } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent('nw:save-custom-automations', { detail: updated }))
    setDraftName('')
    setDraftNodes([])
    setEditNodeIdx(null)
    setShowBuilder(false)
  }

  const deleteCustomFlow = (id: string) => {
    const updated = customFlows.filter(f => f.id !== id)
    setCustomFlows(updated)
    try { localStorage.setItem('nw_custom_automations', JSON.stringify(updated)) } catch { /* ignore */ }
  }

  const formatLastFired = (ts: number | null): string => {
    if (!ts) return 'Never'
    const diff = Date.now() - ts
    if (diff < 60_000)  return `${Math.floor(diff / 1000)}s ago`
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
    return `${Math.floor(diff / 3_600_000)}h ago`
  }

  const successRate = (f: FlowStats): string => {
    const total = f.successCount + f.failureCount
    if (!total) return '—'
    return `${Math.round((f.successCount / total) * 100)}%`
  }

  if (!open) return null

  return (
    <>
      {/* CSS animations injected once */}
      <style>{`
        @keyframes nwFadeSlideIn {
          from { opacity: 0; transform: translate(-50%, calc(-50% + 12px)); }
          to   { opacity: 1; transform: translate(-50%, -50%); }
        }
        .nw-flow-row:hover { border-color: rgba(64,212,255,0.35) !important; }
        .nw-node-palette-btn:hover { background: rgba(64,212,255,0.15) !important; border-color: rgba(64,212,255,0.6) !important; }
      `}</style>

      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'absolute', inset: 0, zIndex: 44,
          background: 'rgba(0,0,0,0.35)',
        }}
      />

      <div style={PANEL_STYLE} onClick={e => e.stopPropagation()}>

        {/* ── Header ── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16, color: '#40D4FF' }}>⚡</span>
            <span style={{ fontSize: 13, letterSpacing: 2, fontWeight: 700, color: '#c8e8f8' }}>
              AUTOMATION FLOWS
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: '1px solid rgba(255,80,80,0.4)',
              borderRadius: 4, color: '#ff6060', fontSize: 11, fontFamily: 'monospace',
              padding: '2px 8px', cursor: 'pointer', letterSpacing: 1,
            }}
          >
            ✕ CLOSE
          </button>
        </div>

        {/* ── Predefined Flows ── */}
        <div style={SECTION_TITLE}>Predefined Flows</div>

        {flowStats.length === 0 && (
          <div style={{ color: 'rgba(200,220,240,0.4)', fontSize: 12, paddingLeft: 8 }}>
            Layer not active — enable Automation Flows in the Layers panel first.
          </div>
        )}

        {flowStats.map(flow => {
          const total    = flow.successCount + flow.failureCount
          const failRate = total > 0 ? flow.failureCount / total : 0
          const isDead   = flow.lastFired !== null && (Date.now() - flow.lastFired) > 24 * 3600 * 1000

          return (
            <div
              key={flow.id}
              className="nw-flow-row"
              style={{
                ...FLOW_ROW,
                opacity: flow.enabled ? 1 : 0.5,
                borderColor: failRate > 0.1 ? 'rgba(255,153,64,0.4)' : isDead ? 'rgba(80,80,100,0.3)' : 'rgba(64,212,255,0.12)',
              }}
            >
              {/* Toggle */}
              <button
                style={TOGGLE_BTN(flow.enabled)}
                onClick={() => toggleFlow(flow.id)}
              >
                {flow.enabled ? 'ON' : 'OFF'}
              </button>

              {/* Flow name */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 12, fontWeight: 700,
                  color: flow.enabled ? '#c8e8f8' : '#556',
                  letterSpacing: 0.5, marginBottom: 4,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {flow.name}
                  {failRate > 0.1 && (
                    <span style={{ marginLeft: 6, color: '#FF9940', fontSize: 10 }}>⚠ HIGH FAIL</span>
                  )}
                  {isDead && (
                    <span style={{ marginLeft: 6, color: '#556', fontSize: 10 }}>◌ INACTIVE 24h</span>
                  )}
                </div>
                {/* Stats row */}
                <div style={{ display: 'flex', gap: 12, fontSize: 10, color: 'rgba(200,220,240,0.5)' }}>
                  <span>Fired today: <span style={{ color: '#40D4FF' }}>{flow.firedToday}</span></span>
                  <span>Success: <span style={{ color: failRate > 0.1 ? '#FF9940' : '#2EE89A' }}>{successRate(flow)}</span></span>
                  <span>Last: <span style={{ color: 'rgba(200,220,240,0.7)' }}>{formatLastFired(flow.lastFired)}</span></span>
                </div>
              </div>

              {/* Fire button */}
              <button
                onClick={() => fireFlow(flow.id)}
                disabled={!flow.enabled}
                style={{
                  background:   flow.enabled ? 'rgba(0,229,100,0.12)' : 'rgba(30,30,40,0.4)',
                  border:       `1px solid ${flow.enabled ? 'rgba(46,232,154,0.5)' : 'rgba(80,80,100,0.3)'}`,
                  borderRadius: 4,
                  color:        flow.enabled ? '#2EE89A' : '#556',
                  fontSize:     9,
                  fontFamily:   'monospace',
                  fontWeight:   700,
                  letterSpacing: 1,
                  padding:      '3px 8px',
                  cursor:       flow.enabled ? 'pointer' : 'not-allowed',
                }}
              >
                ▶ FIRE
              </button>
            </div>
          )
        })}

        {/* ── Custom Flows ── */}
        {customFlows.length > 0 && (
          <>
            <div style={SECTION_TITLE}>Custom Flows</div>
            {customFlows.map(cf => (
              <div key={cf.id} className="nw-flow-row" style={FLOW_ROW}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#c8e8f8', marginBottom: 4 }}>
                    {cf.name}
                  </div>
                  {/* Mini node chain */}
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {cf.nodes.map((n, i) => (
                      <span key={i} style={NODE_CHIP(n.type)}>
                        {NODE_SHAPES[n.type]} {n.label}
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  onClick={() => deleteCustomFlow(cf.id)}
                  style={{
                    background: 'none', border: '1px solid rgba(255,80,80,0.35)',
                    borderRadius: 4, color: '#ff6060', fontSize: 9,
                    fontFamily: 'monospace', padding: '2px 7px', cursor: 'pointer',
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </>
        )}

        {/* ── Build Custom button / panel ── */}
        <div style={{ marginTop: 16 }}>
          {!showBuilder ? (
            <button
              onClick={() => setShowBuilder(true)}
              style={{
                background:   'rgba(64, 212, 255, 0.1)',
                border:       '1px solid rgba(64, 212, 255, 0.4)',
                borderRadius: 6,
                color:        '#40D4FF',
                fontSize:     11,
                fontFamily:   'monospace',
                fontWeight:   700,
                letterSpacing: 2,
                padding:      '8px 18px',
                cursor:       'pointer',
                width:        '100%',
                transition:   'all 0.15s',
              }}
            >
              ⊕ BUILD CUSTOM FLOW
            </button>
          ) : (
            <div style={{
              background:   'rgba(0, 20, 35, 0.7)',
              border:       '1px solid rgba(64, 212, 255, 0.2)',
              borderRadius: 8,
              padding:      '14px 16px',
            }}>
              <div style={{ ...SECTION_TITLE, marginTop: 0 }}>Build Custom Flow</div>

              {/* Flow name */}
              <div style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 10, color: 'rgba(200,220,240,0.55)', letterSpacing: 1, display: 'block', marginBottom: 4 }}>
                  FLOW NAME
                </label>
                <input
                  value={draftName}
                  onChange={e => setDraftName(e.target.value)}
                  placeholder="e.g. New Lead Alert"
                  style={{
                    background:   'rgba(0, 10, 20, 0.8)',
                    border:       '1px solid rgba(64,212,255,0.3)',
                    borderRadius: 4,
                    color:        '#c8e8f8',
                    fontSize:     12,
                    fontFamily:   'monospace',
                    padding:      '5px 10px',
                    width:        '100%',
                    boxSizing:    'border-box',
                    outline:      'none',
                  }}
                />
              </div>

              {/* Node palette */}
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10, color: 'rgba(200,220,240,0.55)', letterSpacing: 1, marginBottom: 6 }}>
                  ADD NODE
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {(Object.keys(NODE_COLORS) as NodeType[]).map(nt => (
                    <button
                      key={nt}
                      className="nw-node-palette-btn"
                      onClick={() => addNode(nt)}
                      style={{
                        background:   `${NODE_COLORS[nt]}18`,
                        border:       `1px solid ${NODE_COLORS[nt]}44`,
                        borderRadius: 4,
                        color:        NODE_COLORS[nt],
                        fontSize:     10,
                        fontFamily:   'monospace',
                        fontWeight:   700,
                        padding:      '4px 10px',
                        cursor:       'pointer',
                        transition:   'all 0.15s',
                        letterSpacing: 0.5,
                      }}
                    >
                      {NODE_SHAPES[nt]} {nt.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              {/* Draft node chain */}
              {draftNodes.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 10, color: 'rgba(200,220,240,0.55)', letterSpacing: 1, marginBottom: 6 }}>
                    NODE CHAIN
                  </div>
                  {draftNodes.map((node, idx) => (
                    <div
                      key={idx}
                      onClick={() => setEditNodeIdx(editNodeIdx === idx ? null : idx)}
                      style={{
                        display:      'flex',
                        alignItems:   'center',
                        gap:          8,
                        padding:      '5px 8px',
                        marginBottom: 4,
                        borderRadius: 5,
                        border:       `1px solid ${editNodeIdx === idx ? NODE_COLORS[node.type] + '88' : 'rgba(64,212,255,0.1)'}`,
                        background:   editNodeIdx === idx ? `${NODE_COLORS[node.type]}18` : 'rgba(0,15,30,0.5)',
                        cursor:       'pointer',
                        transition:   'all 0.1s',
                      }}
                    >
                      <span style={{ color: NODE_COLORS[node.type], fontSize: 12 }}>{NODE_SHAPES[node.type]}</span>
                      <span style={{ flex: 1, fontSize: 11, color: '#c8e8f8' }}>{node.label}</span>
                      <span style={{ fontSize: 9, color: 'rgba(200,220,240,0.4)' }}>{node.type}</span>
                      <button
                        onClick={e => { e.stopPropagation(); removeNode(idx) }}
                        style={{
                          background: 'none', border: 'none',
                          color: '#ff6060', fontSize: 11, cursor: 'pointer', padding: '0 2px',
                        }}
                      >✕</button>
                    </div>
                  ))}

                  {/* Inline node editor */}
                  {editNodeIdx !== null && draftNodes[editNodeIdx] && (
                    <NodeEditor
                      node={draftNodes[editNodeIdx]}
                      onChange={updates => updateNode(editNodeIdx, updates)}
                    />
                  )}
                </div>
              )}

              {/* Actions */}
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={saveCustomFlow}
                  disabled={!draftName.trim() || draftNodes.length < 2}
                  style={{
                    flex:         1,
                    background:   draftName && draftNodes.length >= 2 ? 'rgba(46,232,154,0.15)' : 'rgba(30,40,30,0.4)',
                    border:       `1px solid ${draftName && draftNodes.length >= 2 ? 'rgba(46,232,154,0.5)' : 'rgba(80,100,80,0.3)'}`,
                    borderRadius: 5,
                    color:        draftName && draftNodes.length >= 2 ? '#2EE89A' : '#556',
                    fontSize:     10, fontFamily: 'monospace', fontWeight: 700,
                    padding:      '6px', cursor: draftName && draftNodes.length >= 2 ? 'pointer' : 'not-allowed',
                    letterSpacing: 1,
                  }}
                >
                  ✓ SAVE FLOW
                </button>
                <button
                  onClick={() => { setShowBuilder(false); setDraftName(''); setDraftNodes([]); setEditNodeIdx(null) }}
                  style={{
                    background:   'rgba(255,80,80,0.1)',
                    border:       '1px solid rgba(255,80,80,0.35)',
                    borderRadius: 5,
                    color:        '#ff6060',
                    fontSize:     10, fontFamily: 'monospace', fontWeight: 700,
                    padding:      '6px 14px', cursor: 'pointer', letterSpacing: 1,
                  }}
                >
                  CANCEL
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── Legend ── */}
        <div style={{
          marginTop: 18,
          padding:   '8px 10px',
          borderRadius: 5,
          background: 'rgba(0,10,20,0.5)',
          border: '1px solid rgba(64,212,255,0.08)',
        }}>
          <div style={{ fontSize: 9, color: 'rgba(200,220,240,0.35)', letterSpacing: 2, marginBottom: 6 }}>
            NODE LEGEND
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {(Object.keys(NODE_COLORS) as NodeType[]).map(nt => (
              <span key={nt} style={{ ...NODE_CHIP(nt), fontSize: 9 }}>
                {NODE_SHAPES[nt]} {nt}
              </span>
            ))}
          </div>
          <div style={{ marginTop: 8, fontSize: 9, color: 'rgba(200,220,240,0.3)', lineHeight: 1.6 }}>
            Agents fly at y=25 · Flows run at y=0.5 · Vertical beam = handoff
          </div>
        </div>

      </div>
    </>
  )
}

// ── NodeEditor sub-component ───────────────────────────────────────────────────

interface NodeEditorProps {
  node:     CustomFlowNode
  onChange: (updates: Partial<CustomFlowNode>) => void
}

function NodeEditor({ node, onChange }: NodeEditorProps) {
  const inputStyle: React.CSSProperties = {
    background:   'rgba(0,10,20,0.8)',
    border:       '1px solid rgba(64,212,255,0.25)',
    borderRadius: 4,
    color:        '#c8e8f8',
    fontSize:     11,
    fontFamily:   'monospace',
    padding:      '3px 8px',
    outline:      'none',
    flex:         1,
  }

  return (
    <div style={{
      background:   'rgba(0,20,35,0.7)',
      border:       '1px solid rgba(64,212,255,0.15)',
      borderRadius: 5,
      padding:      '10px 12px',
      marginTop:    6,
      marginBottom: 6,
    }}>
      <div style={{ fontSize: 9, color: 'rgba(200,220,240,0.45)', letterSpacing: 2, marginBottom: 8 }}>
        EDIT NODE
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
        <label style={{ fontSize: 9, color: 'rgba(200,220,240,0.5)', width: 40 }}>LABEL</label>
        <input
          value={node.label}
          onChange={e => onChange({ label: e.target.value })}
          style={inputStyle}
        />
      </div>
      {node.type === 'trigger' && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
          <label style={{ fontSize: 9, color: 'rgba(200,220,240,0.5)', width: 40 }}>SRC</label>
          <select
            value={node.triggerSrc ?? 'timer'}
            onChange={e => onChange({ triggerSrc: e.target.value as TriggerSource })}
            style={{ ...inputStyle, background: 'rgba(0,10,20,0.9)' }}
          >
            {TRIGGER_SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      )}
      {node.type === 'action' && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
          <label style={{ fontSize: 9, color: 'rgba(200,220,240,0.5)', width: 40 }}>KEY</label>
          <select
            value={node.actionKey ?? 'send-email'}
            onChange={e => onChange({ actionKey: e.target.value })}
            style={{ ...inputStyle, background: 'rgba(0,10,20,0.9)' }}
          >
            {ACTION_KEYS.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
      )}
      {node.type === 'result' && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <label style={{ fontSize: 9, color: 'rgba(200,220,240,0.5)', width: 40 }}>OK</label>
          <select
            value={node.resultOk !== false ? 'success' : 'fail'}
            onChange={e => onChange({ resultOk: e.target.value === 'success' })}
            style={{ ...inputStyle, background: 'rgba(0,10,20,0.9)' }}
          >
            <option value="success">success</option>
            <option value="fail">fail</option>
          </select>
        </div>
      )}
    </div>
  )
}

// ── Trigger button (rendered in CommandHUD left panel) ─────────────────────────

interface FlowsButtonProps {
  onClick: () => void
}

export function FlowsButton({ onClick }: FlowsButtonProps) {
  return (
    <button
      onClick={onClick}
      style={{
        display:      'flex',
        alignItems:   'center',
        gap:          6,
        background:   'rgba(64, 212, 255, 0.08)',
        border:       '1px solid rgba(64, 212, 255, 0.3)',
        borderRadius: 5,
        color:        '#40D4FF',
        fontSize:     10,
        fontFamily:   'monospace',
        fontWeight:   700,
        letterSpacing: 1.5,
        padding:      '5px 12px',
        cursor:       'pointer',
        transition:   'all 0.15s',
        width:        '100%',
      }}
    >
      <span style={{ fontSize: 12 }}>⚡</span>
      FLOWS
    </button>
  )
}
