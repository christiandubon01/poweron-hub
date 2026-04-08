/**
 * DiveModePanel.tsx — NW13 Dive Mode: client territory deep-dive overlay.
 *
 * Triggered when player flies close to a customer territory (nw:territory-approach).
 * Dismissed when player moves away (nw:territory-leave).
 *
 * Renders four floating panels:
 *  1. Timeline River     — project history as a horizontal flow of events
 *  2. Opportunity Tree   — tree of upsell/renewal nodes; hover triggers NEXUS
 *  3. Risk Fault Lines   — open RFIs, overdue invoices, dormancy risk
 *  4. Referral Web       — constellation: other clients this client referred (mock)
 *
 * NEXUS voice trigger:
 *   Hovering over an Opportunity Tree node calls callNexus() with client context
 *   and opportunity type, then plays the response via ElevenLabs synthesizeWithElevenLabs().
 *
 * Styling: dark terminal aesthetic matching CommandHUD. Positioned in corner quadrants.
 */

import React, {
  useEffect,
  useState,
  useCallback,
  useRef,
} from 'react'
import { getWorldData, type NWClientTerritory } from './DataBridge'
import { callNexus } from '@/services/claudeProxy'
import { synthesizeWithElevenLabs, DEFAULT_VOICE_ID } from '@/api/voice/elevenLabs'
import type { NexusRequest } from '@/agents/nexusPromptEngine'

// ── Styles ────────────────────────────────────────────────────────────────────

const PANEL_BG    = 'rgba(4,8,16,0.88)'
const PANEL_BDR   = 'rgba(0,229,204,0.22)'
const ACCENT      = '#00e5cc'
const DIM         = '#446655'
const WARN_COLOR  = '#ff8833'
const RISK_COLOR  = '#ff4444'
const TEXT_MAIN   = '#cceedd'
const TEXT_DIM    = '#557766'
const FONT        = 'monospace'

const panelBase: React.CSSProperties = {
  position:   'absolute',
  background: PANEL_BG,
  border:     `1px solid ${PANEL_BDR}`,
  borderRadius: 4,
  padding:    '10px 14px',
  fontFamily: FONT,
  color:      TEXT_MAIN,
  pointerEvents: 'all',
  backdropFilter: 'blur(4px)',
  minWidth:   220,
  maxWidth:   280,
}

// ── Opportunity node type ────────────────────────────────────────────────────

interface OpportunityNode {
  id: string
  label: string
  type: 'upsell' | 'renewal' | 'referral' | 'new_service'
  description: string
  value: number
}

function buildOpportunityNodes(t: NWClientTerritory): OpportunityNode[] {
  const nodes: OpportunityNode[] = []

  if (t.activeProjectCount > 0) {
    nodes.push({
      id: 'add_phase',
      label: 'Phase Expansion',
      type: 'upsell',
      description: `Add scope to active project for ${t.clientName}`,
      value: Math.round(t.lifetimeValue * 0.15),
    })
  }

  if (t.projectCount >= 2 && t.daysSinceContact < 180) {
    nodes.push({
      id: 'maintenance',
      label: 'Maintenance Contract',
      type: 'renewal',
      description: 'Annual service agreement opportunity',
      value: 1800,
    })
  }

  if (t.paidRatio >= 0.9 && t.projectCount >= 1) {
    nodes.push({
      id: 'referral',
      label: 'Referral Ask',
      type: 'referral',
      description: 'Request neighbor/peer referral from satisfied client',
      value: 5000,
    })
  }

  if (t.terrain !== 'flat_barren') {
    nodes.push({
      id: 'new_service',
      label: 'New Service Pitch',
      type: 'new_service',
      description: 'Solar/EV charger/panel upgrade upsell opportunity',
      value: Math.round(t.lifetimeValue * 0.3),
    })
  }

  return nodes
}

// ── Timeline event type ───────────────────────────────────────────────────────

interface TimelineEvent {
  label: string
  date: string
  color: string
  icon: string
}

function buildTimeline(t: NWClientTerritory): TimelineEvent[] {
  const events: TimelineEvent[] = []

  if (t.lastContactAt) {
    events.push({
      label: `Last project contact`,
      date: new Date(t.lastContactAt).toLocaleDateString(),
      color: ACCENT,
      icon: '◈',
    })
  }

  if (t.projectCount > 0) {
    events.push({
      label: `${t.projectCount} project${t.projectCount > 1 ? 's' : ''} on record`,
      date: 'History',
      color: TEXT_MAIN,
      icon: '▸',
    })
  }

  if (t.openRfiCount > 0) {
    events.push({
      label: `${t.openRfiCount} open RFI${t.openRfiCount > 1 ? 's' : ''}`,
      date: 'Active',
      color: WARN_COLOR,
      icon: '⚠',
    })
  }

  if (t.activeProjectCount > 0) {
    events.push({
      label: `${t.activeProjectCount} active project${t.activeProjectCount > 1 ? 's' : ''}`,
      date: 'Now',
      color: '#55ff88',
      icon: '●',
    })
  }

  if (t.daysSinceContact > 180) {
    events.push({
      label: 'No contact in 6+ months',
      date: `${t.daysSinceContact}d ago`,
      color: RISK_COLOR,
      icon: '◌',
    })
  }

  return events
}

// ── Risk items ────────────────────────────────────────────────────────────────

interface RiskItem {
  label: string
  severity: 'low' | 'medium' | 'high'
}

function buildRisks(t: NWClientTerritory): RiskItem[] {
  const risks: RiskItem[] = []

  if (t.paidRatio < 0.5) risks.push({ label: 'Payment history: poor (<50% collected)', severity: 'high' })
  else if (t.paidRatio < 0.75) risks.push({ label: 'Payment history: partial (50–75%)', severity: 'medium' })

  if (t.openRfiCount >= 3) risks.push({ label: `${t.openRfiCount} open RFIs unresolved`, severity: 'high' })
  else if (t.openRfiCount >= 1) risks.push({ label: `${t.openRfiCount} open RFI(s)`, severity: 'medium' })

  if (t.daysSinceContact > 365) risks.push({ label: 'Dormant: 12+ months no contact', severity: 'high' })
  else if (t.daysSinceContact > 180) risks.push({ label: `No contact in ${t.daysSinceContact} days`, severity: 'medium' })

  if (t.projectCount === 1 && t.lifetimeValue < 2000) {
    risks.push({ label: 'Single low-value engagement', severity: 'low' })
  }

  if (risks.length === 0) risks.push({ label: 'No significant risks detected', severity: 'low' })

  return risks
}

const SEVERITY_COLORS: Record<string, string> = {
  high:   RISK_COLOR,
  medium: WARN_COLOR,
  low:    '#88aa88',
}

// ── Panel header ─────────────────────────────────────────────────────────────

function PanelHeader({ title }: { title: string }) {
  return (
    <div style={{
      fontSize: 9,
      letterSpacing: 2,
      color: ACCENT,
      marginBottom: 8,
      borderBottom: `1px solid ${PANEL_BDR}`,
      paddingBottom: 4,
      fontWeight: 700,
    }}>
      {title}
    </div>
  )
}

// ── Timeline River Panel ──────────────────────────────────────────────────────

function TimelineRiverPanel({ territory }: { territory: NWClientTerritory }) {
  const events = buildTimeline(territory)
  return (
    <div style={{ ...panelBase, top: 80, left: 20 }}>
      <PanelHeader title="▶  TIMELINE RIVER" />
      {events.length === 0 && (
        <div style={{ color: TEXT_DIM, fontSize: 10 }}>No events recorded.</div>
      )}
      {events.map((ev, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 5, alignItems: 'flex-start' }}>
          <span style={{ color: ev.color, fontSize: 13, lineHeight: 1.2, flexShrink: 0 }}>{ev.icon}</span>
          <div>
            <div style={{ fontSize: 10, color: ev.color }}>{ev.label}</div>
            <div style={{ fontSize: 9, color: TEXT_DIM }}>{ev.date}</div>
          </div>
        </div>
      ))}
      <div style={{ marginTop: 8, fontSize: 9, color: TEXT_DIM }}>
        LTV: ${territory.lifetimeValue.toLocaleString()} &nbsp;|&nbsp;
        Paid: {Math.round(territory.paidRatio * 100)}%
      </div>
    </div>
  )
}

// ── Opportunity Tree Panel ────────────────────────────────────────────────────

function OpportunityTreePanel({
  territory,
  onNodeHover,
  nexusBusy,
}: {
  territory: NWClientTerritory
  onNodeHover: (node: OpportunityNode) => void
  nexusBusy: boolean
}) {
  const nodes = buildOpportunityNodes(territory)

  const typeColors: Record<string, string> = {
    upsell: '#55aaff',
    renewal: '#55ff88',
    referral: '#ffdd55',
    new_service: '#cc55ff',
  }

  return (
    <div style={{ ...panelBase, top: 80, right: 20 }}>
      <PanelHeader title="◈  OPPORTUNITY TREE" />
      {nodes.length === 0 && (
        <div style={{ color: TEXT_DIM, fontSize: 10 }}>No opportunities identified.</div>
      )}
      {nodes.map((node) => (
        <div
          key={node.id}
          onMouseEnter={() => !nexusBusy && onNodeHover(node)}
          style={{
            marginBottom: 8,
            padding: '5px 7px',
            borderLeft: `2px solid ${typeColors[node.type] || ACCENT}`,
            cursor: nexusBusy ? 'wait' : 'pointer',
            background: 'rgba(0,229,204,0.04)',
            borderRadius: 2,
            transition: 'background 0.15s',
          }}
        >
          <div style={{ fontSize: 10, color: typeColors[node.type] || ACCENT, fontWeight: 700 }}>
            {node.label}
          </div>
          <div style={{ fontSize: 9, color: TEXT_DIM, marginTop: 2 }}>{node.description}</div>
          <div style={{ fontSize: 9, color: '#88bbaa', marginTop: 2 }}>
            Est. ~${node.value.toLocaleString()}
          </div>
        </div>
      ))}
      <div style={{ marginTop: 6, fontSize: 8, color: TEXT_DIM }}>
        {nexusBusy ? '⟳ NEXUS processing…' : 'Hover node → NEXUS analysis'}
      </div>
    </div>
  )
}

// ── Risk Fault Lines Panel ────────────────────────────────────────────────────

function RiskFaultLinesPanel({ territory }: { territory: NWClientTerritory }) {
  const risks = buildRisks(territory)
  return (
    <div style={{ ...panelBase, bottom: 80, left: 20 }}>
      <PanelHeader title="⚡  RISK FAULT LINES" />
      {risks.map((r, i) => (
        <div key={i} style={{ display: 'flex', gap: 7, marginBottom: 5, alignItems: 'center' }}>
          <span style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: SEVERITY_COLORS[r.severity],
            display: 'inline-block',
            flexShrink: 0,
          }} />
          <span style={{ fontSize: 10, color: SEVERITY_COLORS[r.severity] }}>{r.label}</span>
        </div>
      ))}
      <div style={{ marginTop: 8, fontSize: 9, color: TEXT_DIM }}>
        RFIs: {territory.openRfiCount} &nbsp;|&nbsp;
        Terrain: {territory.terrain.replace('_', ' ')}
      </div>
    </div>
  )
}

// ── Referral Web Panel ────────────────────────────────────────────────────────

function ReferralWebPanel({ territory }: { territory: NWClientTerritory }) {
  // Constellation view — mock referral connections based on client key hash
  const hash   = territory.clientKey.split('').reduce((h, c) => h ^ c.charCodeAt(0), 17)
  const refCount = Math.abs(hash % 4)    // 0–3 referral connections
  const refNames = ['Nguyen', 'Martinez', 'Smith', 'Patel', 'Chen', 'Anderson']

  return (
    <div style={{ ...panelBase, bottom: 80, right: 20 }}>
      <PanelHeader title="✦  REFERRAL WEB" />
      {/* Simple constellation dots */}
      <svg
        width={200}
        height={100}
        style={{ display: 'block', margin: '0 auto 8px' }}
      >
        {/* Center node — the client */}
        <circle cx={100} cy={50} r={6} fill={ACCENT} opacity={0.9} />
        <text x={100} y={68} textAnchor="middle" fontSize={8} fill={ACCENT}>
          {territory.clientName.split(' ')[0]}
        </text>

        {/* Referral nodes */}
        {Array.from({ length: refCount }).map((_, i) => {
          const angle  = (i / Math.max(refCount, 1)) * Math.PI * 2 - Math.PI / 2
          const r      = 42
          const nx     = 100 + Math.cos(angle) * r
          const ny     = 50  + Math.sin(angle) * r
          const name   = refNames[(hash + i * 7) % refNames.length]
          return (
            <g key={i}>
              <line
                x1={100} y1={50} x2={nx} y2={ny}
                stroke={DIM} strokeWidth={0.8} strokeDasharray="3,2"
                opacity={0.6}
              />
              <circle cx={nx} cy={ny} r={4} fill="#334455" stroke={DIM} strokeWidth={1} />
              <text x={nx} y={ny + 12} textAnchor="middle" fontSize={7} fill={TEXT_DIM}>{name}</text>
            </g>
          )
        })}
        {refCount === 0 && (
          <text x={100} y={54} textAnchor="middle" fontSize={9} fill={TEXT_DIM}>
            No referrals yet
          </text>
        )}
      </svg>
      <div style={{ fontSize: 9, color: TEXT_DIM, textAlign: 'center' }}>
        {refCount} referred connection{refCount !== 1 ? 's' : ''} detected
      </div>
    </div>
  )
}

// ── NEXUS voice response banner ───────────────────────────────────────────────

function NexusBanner({ text, visible }: { text: string; visible: boolean }) {
  if (!visible) return null
  return (
    <div style={{
      position: 'absolute',
      bottom: 20,
      left: '50%',
      transform: 'translateX(-50%)',
      background: 'rgba(0,20,30,0.92)',
      border: `1px solid ${ACCENT}`,
      borderRadius: 4,
      padding: '8px 16px',
      maxWidth: 480,
      fontFamily: FONT,
      fontSize: 11,
      color: ACCENT,
      letterSpacing: 0.5,
      pointerEvents: 'none',
      zIndex: 30,
      textAlign: 'center',
    }}>
      ⬡ NEXUS: {text}
    </div>
  )
}

// ── Main DiveModePanel component ──────────────────────────────────────────────

export function DiveModePanel() {
  const [visible,          setVisible]         = useState(false)
  const [territory,        setTerritory]        = useState<NWClientTerritory | null>(null)
  const [nexusBusy,        setNexusBusy]        = useState(false)
  const [nexusResponseText, setNexusResponseText] = useState('')
  const [nexusBannerVisible, setNexusBannerVisible] = useState(false)
  const nexusBannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Listen for territory approach/leave events
  useEffect(() => {
    function onApproach(e: Event) {
      const { clientKey } = (e as CustomEvent).detail as { clientKey: string }
      const data   = getWorldData()
      const found  = data.clientTerritories.find(t => t.clientKey === clientKey)
      if (found) {
        setTerritory(found)
        setVisible(true)
      }
    }

    function onLeave() {
      setVisible(false)
      setTerritory(null)
      setNexusBusy(false)
      setNexusBannerVisible(false)
    }

    window.addEventListener('nw:territory-approach', onApproach)
    window.addEventListener('nw:territory-leave', onLeave)
    return () => {
      window.removeEventListener('nw:territory-approach', onApproach)
      window.removeEventListener('nw:territory-leave', onLeave)
    }
  }, [])

  // Cleanup banner timer on unmount
  useEffect(() => {
    return () => {
      if (nexusBannerTimerRef.current) clearTimeout(nexusBannerTimerRef.current)
    }
  }, [])

  const handleOpportunityHover = useCallback(async (node: OpportunityNode) => {
    if (!territory || nexusBusy) return
    setNexusBusy(true)

    try {
      const request: NexusRequest = {
        query: `Client: ${territory.clientName}. Opportunity type: ${node.type}. Description: ${node.description}. ` +
               `Client lifetime value: $${territory.lifetimeValue.toLocaleString()}. ` +
               `Projects: ${territory.projectCount}. Paid ratio: ${Math.round(territory.paidRatio * 100)}%. ` +
               `Days since contact: ${territory.daysSinceContact}. ` +
               `What is the best action to pursue this ${node.label} opportunity?`,
        agentMode: 'NEXUS',
        sessionContext:
          'Context: Neural World dive mode — client territory intelligence. ' +
          'Respond in 1–2 sentences with a direct, actionable recommendation for the field operator.',
      }

      const response = await callNexus(request)
      const speakText = response.speak ?? 'No recommendation available.'

      setNexusResponseText(speakText)
      setNexusBannerVisible(true)

      // Auto-hide banner after 7 seconds
      if (nexusBannerTimerRef.current) clearTimeout(nexusBannerTimerRef.current)
      nexusBannerTimerRef.current = setTimeout(() => setNexusBannerVisible(false), 7000)

      // ElevenLabs voice synthesis — non-fatal if unavailable
      try {
        await synthesizeWithElevenLabs({ text: speakText, voice_id: DEFAULT_VOICE_ID })
      } catch {
        // ElevenLabs may not be available in all environments — silent fallback
      }
    } catch (err) {
      console.warn('[DiveModePanel] NEXUS call failed:', err)
      setNexusResponseText('NEXUS unavailable — check API configuration.')
      setNexusBannerVisible(true)
    } finally {
      setNexusBusy(false)
    }
  }, [territory, nexusBusy])

  if (!visible || !territory) return null

  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      pointerEvents: 'none',
      zIndex: 20,
    }}>
      {/* Dive Mode badge */}
      <div style={{
        position: 'absolute',
        top: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(0,20,30,0.85)',
        border: `1px solid ${ACCENT}`,
        borderRadius: 4,
        padding: '4px 16px',
        fontFamily: FONT,
        fontSize: 9,
        color: ACCENT,
        letterSpacing: 2.5,
        fontWeight: 700,
        pointerEvents: 'none',
      }}>
        ◈ DIVE MODE — {territory.clientName.toUpperCase()}
      </div>

      {/* Four floating panels */}
      <TimelineRiverPanel territory={territory} />

      <OpportunityTreePanel
        territory={territory}
        onNodeHover={handleOpportunityHover}
        nexusBusy={nexusBusy}
      />

      <RiskFaultLinesPanel territory={territory} />

      <ReferralWebPanel territory={territory} />

      {/* NEXUS response banner */}
      <NexusBanner text={nexusResponseText} visible={nexusBannerVisible} />
    </div>
  )
}
