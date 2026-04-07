// @ts-nocheck
/**
 * AdminCommandCenter.tsx — B40 | Admin Command Center
 *
 * Full-screen admin panel with 11 sub-tabs.
 * B36: Tabs 1–3. B37: Tabs 4–5. B38: Tabs 6–7. B39: Tabs 8–9. B40: Tabs 10–11 + NEXUS panel.
 * Tab 10: Compliance Overview (checklist + AI insight).
 * Tab 11: Pending Actions / Sessions Queue / NEXUS Voice Interview Mode.
 * NEXUS: Collapsible right-side orb + chat panel with full Command Center context.
 *
 * Admin-only: gated in V15rLayout sidebar (email matches VITE_ADMIN_EMAIL).
 */

import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, Tooltip,
  FunnelChart, Funnel, LabelList, Cell,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  AreaChart, Area, Legend,
} from 'recharts'
import { callClaude, extractText } from '@/services/claudeProxy'
import { getBackupData, getKPIs, num } from '@/services/backupDataService'
import { supabase } from '@/lib/supabase'
import { NexusPresenceOrb } from '@/components/nexus/NexusPresenceOrb'
import { takeDailySnapshotIfNeeded, fetchRecentSnapshots } from '@/services/dailySnapshotService'
import CommandCenterNeuralMap from './CommandCenterNeuralMap'

// ─── Tab definitions ──────────────────────────────────────────────────────────
const TABS = [
  { id: 'vision',      label: '1 · Vision Timeline' },
  { id: 'backend',     label: '2 · Backend Analysis' },
  { id: 'beta',        label: '3 · Beta Metrics' },
  { id: 'economics',   label: '4 · Economics' },
  { id: 'improvelog',  label: '5 · Improvement Log' },
  { id: 't6',          label: '6 · Summary + Checklist' },
  { id: 't7',          label: '7 · Scripts + Positioning' },
  { id: 't8',          label: '8 · AI Agents' },
  { id: 't9',          label: '9 · Industries' },
  { id: 't10',         label: '10 · Compliance' },
  { id: 't11',         label: '11 · Actions + Queue' },
  { id: 't12',         label: '12 · Split View' },
  { id: 't13',         label: '13 · Unified Command' },
  { id: 'neural_map',  label: '🧠 Neural Map' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function fetchInsight(systemPrompt: string, userPrompt: string): Promise<string> {
  try {
    const res = await callClaude({
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      max_tokens: 512,
    })
    return extractText(res)
  } catch (e) {
    return `Unable to load insight: ${e instanceof Error ? e.message : 'unknown error'}`
  }
}

function getSummaryContext() {
  try {
    const d = getBackupData()
    if (!d) return 'No local data found.'
    const projects = d.projects?.length ?? 0
    const serviceLogs = d.serviceLogs?.length ?? 0
    const logs = d.logs?.length ?? 0
    const leads = d.gcContacts?.length ?? 0
    return `Projects: ${projects}, Service Logs: ${serviceLogs}, Field Logs: ${logs}, Leads: ${leads}`
  } catch {
    return 'Context unavailable'
  }
}

// ─── Shared components ────────────────────────────────────────────────────────
function InsightCard({
  title,
  accent,
  insight,
  loading,
  onRegenerate,
}: {
  title: string
  accent: string
  insight: string
  loading: boolean
  onRegenerate: () => void
}) {
  return (
    <div
      style={{
        marginTop: 12,
        padding: '14px 16px',
        borderRadius: 10,
        backgroundColor: '#111827',
        border: `1px solid ${accent}44`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: accent, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          ⚡ AI Insight
        </span>
        <button
          onClick={onRegenerate}
          disabled={loading}
          style={{
            fontSize: 11,
            fontWeight: 600,
            padding: '3px 10px',
            borderRadius: 6,
            border: `1px solid ${accent}66`,
            backgroundColor: 'transparent',
            color: accent,
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? 'Thinking…' : '↺ Regenerate'}
        </button>
      </div>
      <p style={{ fontSize: 13, lineHeight: 1.65, color: '#d1d5db', whiteSpace: 'pre-wrap' }}>
        {loading ? 'Generating insight…' : insight || 'Click Regenerate to load insight.'}
      </p>
    </div>
  )
}

// ─── TAB 1 — Vision Timeline ──────────────────────────────────────────────────
const MILESTONES = [
  { date: 'Mar 2026', label: 'First HTML file\n(12,388 lines)' },
  { date: 'Apr 2026', label: 'V2 React rebuild' },
  { date: 'Apr 2026', label: 'V3 deployment' },
  { date: 'Apr 2026', label: 'IP filed' },
  { date: 'May 2026', label: 'Beta launch' },
  { date: 'Q3 2026',  label: 'First MRR' },
  { date: 'Q4 2026',  label: '50 orgs' },
  { date: '2027',     label: 'Data licensing' },
  { date: '2027+',    label: 'Ecosystem' },
]

const V3_DIMENSIONS = [
  { subject: 'Stability',        A: 80 },
  { subject: 'AI Logic',         A: 75 },
  { subject: 'Numbers Accuracy', A: 85 },
  { subject: 'Security',         A: 70 },
  { subject: 'Features',         A: 65 },
  { subject: 'Visual Polish',    A: 72 },
  { subject: 'Beta Ops',         A: 60 },
  { subject: 'Revenue',          A: 10 },
]

const BETA_MILESTONES = [
  { label: '6 invited',               value: 6,   target: 6   },
  { label: '50 orgs',                 value: 6,   target: 50  },
  { label: '200 users',               value: 0,   target: 200 },
  { label: '550 users',               value: 0,   target: 550 },
  { label: 'Data licensing threshold',value: 0,   target: 1   },
]

function HorizontalTimeline() {
  return (
    <div style={{ overflowX: 'auto', paddingBottom: 8 }}>
      <div style={{ display: 'flex', gap: 0, minWidth: 900, position: 'relative' }}>
        {/* line */}
        <div style={{
          position: 'absolute',
          top: 20,
          left: 24,
          right: 24,
          height: 2,
          backgroundColor: '#7c3aed44',
        }} />
        {MILESTONES.map((m, i) => (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
            <div style={{
              width: 12,
              height: 12,
              borderRadius: '50%',
              backgroundColor: '#7c3aed',
              border: '2px solid #a78bfa',
              marginBottom: 10,
              zIndex: 1,
              flexShrink: 0,
              marginTop: 14,
            }} />
            <span style={{ fontSize: 9, fontWeight: 700, color: '#a78bfa', marginBottom: 3, textAlign: 'center' }}>{m.date}</span>
            <span style={{ fontSize: 9, color: '#c4b5fd', textAlign: 'center', lineHeight: 1.4, whiteSpace: 'pre-line' }}>{m.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ProgressBar({ value, target, label }: { value: number; target: number; label: string }) {
  const pct = target === 0 ? 0 : Math.min(100, Math.round((value / target) * 100))
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: '#d1d5db' }}>{label}</span>
        <span style={{ fontSize: 12, color: '#fbbf24', fontWeight: 700 }}>{value} / {target}</span>
      </div>
      <div style={{ height: 6, backgroundColor: '#374151', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, backgroundColor: '#fbbf24', borderRadius: 4, transition: 'width 0.5s' }} />
      </div>
    </div>
  )
}

function Tab1VisionTimeline() {
  const [p1Insight, setP1Insight] = useState('')
  const [p1Loading, setP1Loading] = useState(false)
  const [p2Insight, setP2Insight] = useState('')
  const [p2Loading, setP2Loading] = useState(false)
  const [p3Insight, setP3Insight] = useState('')
  const [p3Loading, setP3Loading] = useState(false)

  const ctx = getSummaryContext()

  const loadP1 = useCallback(async () => {
    setP1Loading(true)
    const text = await fetchInsight(
      'You are a strategic advisor for Power On Hub, an electrical contractor operations platform. Be concise, direct, and inspiring.',
      `Context: ${ctx}\nDescribe the full journey arc from the original 12,388-line HTML file in March 2026 through V3 React deployment through the V7+ data licensing platform vision. What was built, why it matters, and what the trajectory looks like from origin to horizon. 3-4 sentences.`
    )
    setP1Insight(text)
    setP1Loading(false)
  }, [ctx])

  const loadP2 = useCallback(async () => {
    setP2Loading(true)
    const text = await fetchInsight(
      'You are a CTO-level advisor for Power On Hub. Be specific and actionable.',
      `Context: ${ctx}\nV3 platform radar scores: ${JSON.stringify(V3_DIMENSIONS)}. Describe what the gap between current V3 state and the full vision looks like. What matters most to close first? 3-4 sentences.`
    )
    setP2Insight(text)
    setP2Loading(false)
  }, [ctx])

  const loadP3 = useCallback(async () => {
    setP3Loading(true)
    const text = await fetchInsight(
      'You are a growth advisor for Power On Hub at beta stage. Be concrete and timeline-focused.',
      `Context: ${ctx}\nBeta stage: 6 invites sent, currently at early beta with no MRR yet. What needs to happen in the next 30/60/90 days to move through beta to first revenue? 3-4 sentences.`
    )
    setP3Insight(text)
    setP3Loading(false)
  }, [ctx])

  useEffect(() => {
    loadP1()
    loadP2()
    loadP3()
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Perspective 1 — Origin to Horizon */}
      <div style={{ backgroundColor: '#0f172a', border: '1px solid #7c3aed55', borderRadius: 12, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <div style={{ width: 4, height: 24, backgroundColor: '#7c3aed', borderRadius: 2 }} />
          <div>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: '#e9d5ff', margin: 0 }}>From Spreadsheets to Platform</h3>
            <p style={{ fontSize: 11, color: '#a78bfa', margin: 0 }}>Origin to Horizon — Full arc view</p>
          </div>
        </div>
        <HorizontalTimeline />
        <InsightCard title="P1" accent="#7c3aed" insight={p1Insight} loading={p1Loading} onRegenerate={loadP1} />
      </div>

      {/* Perspective 2 — V3 to Horizon */}
      <div style={{ backgroundColor: '#0f172a', border: '1px solid #16a34a55', borderRadius: 12, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{ width: 4, height: 24, backgroundColor: '#16a34a', borderRadius: 2 }} />
          <div>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: '#bbf7d0', margin: 0 }}>Current Deployment to Full Vision</h3>
            <p style={{ fontSize: 11, color: '#4ade80', margin: 0 }}>V3 across 8 dimensions vs. horizon</p>
          </div>
        </div>
        <div style={{ height: 280 }}>
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={V3_DIMENSIONS} cx="50%" cy="50%" outerRadius="70%">
              <PolarGrid stroke="#1e3a2f" />
              <PolarAngleAxis dataKey="subject" tick={{ fill: '#86efac', fontSize: 11 }} />
              <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fill: '#4b5563', fontSize: 9 }} />
              <Radar name="V3 Today" dataKey="A" stroke="#16a34a" fill="#16a34a" fillOpacity={0.3} />
              <Tooltip contentStyle={{ backgroundColor: '#111827', border: '1px solid #16a34a44', borderRadius: 8 }} itemStyle={{ color: '#86efac' }} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
        <InsightCard title="P2" accent="#16a34a" insight={p2Insight} loading={p2Loading} onRegenerate={loadP2} />
      </div>

      {/* Perspective 3 — Beta Stage to Horizon */}
      <div style={{ backgroundColor: '#0f172a', border: '1px solid #ca8a0455', borderRadius: 12, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{ width: 4, height: 24, backgroundColor: '#ca8a04', borderRadius: 2 }} />
          <div>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: '#fef3c7', margin: 0 }}>Beta Position vs Full Platform</h3>
            <p style={{ fontSize: 11, color: '#fbbf24', margin: 0 }}>Beta milestones progress</p>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {BETA_MILESTONES.map((m, i) => (
            <ProgressBar key={i} value={m.value} target={m.target} label={m.label} />
          ))}
        </div>
        <InsightCard title="P3" accent="#ca8a04" insight={p3Insight} loading={p3Loading} onRegenerate={loadP3} />
      </div>

      {/* Perspective 4 — Daily Progress (Feature F6 B42) */}
      <DailyProgressSection />

    </div>
  )
}

// ─── Daily Progress Section (F6) ─────────────────────────────────────────────
function DailyProgressSection() {
  const [snapshots, setSnapshots] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<any | null>(null)
  const [deltaInsight, setDeltaInsight] = useState('')
  const [deltaLoading, setDeltaLoading] = useState(false)

  useEffect(() => {
    // Trigger today's snapshot (no-op if already done today)
    takeDailySnapshotIfNeeded().catch(() => {})
    // Load last 30
    fetchRecentSnapshots(30).then((rows) => {
      setSnapshots(rows)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const today = snapshots[0] ?? null
  const todayMetrics = today?.metrics_json ?? null

  const handleDeltaInsight = useCallback(async () => {
    if (!selected || !todayMetrics) return
    setDeltaLoading(true)
    const text = await fetchInsight(
      'You are a platform health analyst for Power On Hub. Be specific about changes and what they mean.',
      `Today's metrics: ${JSON.stringify(todayMetrics)}.\nSnapshot from ${selected.snapshot_date}: ${JSON.stringify(selected.metrics_json)}.\nAnalyze the delta between these two days. What changed, what's trending, and what should the owner focus on based on these numbers? 3-4 sentences.`
    )
    setDeltaInsight(text)
    setDeltaLoading(false)
  }, [selected, todayMetrics])

  // Mini bar dimensions
  const BAR_W = 20
  const BAR_MAX_H = 48
  const MAX_AGENTS = snapshots.reduce((mx, s) => Math.max(mx, s.metrics_json?.agentActivityCount ?? 0), 1)

  return (
    <div style={{ backgroundColor: '#0f172a', border: '1px solid #0e7490aa', borderRadius: 12, padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <div style={{ width: 4, height: 24, backgroundColor: '#0e7490', borderRadius: 2 }} />
        <div>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: '#a5f3fc', margin: 0 }}>Daily Progress</h3>
          <p style={{ fontSize: 11, color: '#22d3ee', margin: 0 }}>Last 30 days — click a day to compare</p>
        </div>
        {loading && <span style={{ marginLeft: 'auto', fontSize: 11, color: '#6b7280' }}>Loading…</span>}
      </div>

      {/* Mini timeline bars */}
      {!loading && snapshots.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, overflowX: 'auto', paddingBottom: 8, marginBottom: 16 }}>
          {[...snapshots].reverse().map((snap, i) => {
            const h = Math.max(4, Math.round(((snap.metrics_json?.agentActivityCount ?? 0) / MAX_AGENTS) * BAR_MAX_H))
            const isToday = snap.snapshot_date === snapshots[0]?.snapshot_date
            const isSel = selected?.id === snap.id
            return (
              <button
                key={snap.id}
                title={snap.snapshot_date}
                onClick={() => setSelected(isSel ? null : snap)}
                style={{
                  width: BAR_W,
                  height: BAR_MAX_H + 18,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                  gap: 2,
                }}
              >
                <div style={{
                  width: BAR_W - 4,
                  height: h,
                  borderRadius: 3,
                  backgroundColor: isSel ? '#f59e0b' : isToday ? '#0e7490' : '#164e63',
                  border: isSel ? '1px solid #f59e0b' : isToday ? '1px solid #22d3ee' : '1px solid #0e7490',
                  transition: 'background-color 0.15s',
                }} />
                <span style={{ fontSize: 7, color: '#6b7280', transform: 'rotate(-45deg)', transformOrigin: 'right center', whiteSpace: 'nowrap' }}>
                  {snap.snapshot_date.slice(5)}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {!loading && snapshots.length === 0 && (
        <p style={{ fontSize: 12, color: '#6b7280', fontStyle: 'italic' }}>No snapshots yet — first snapshot will be taken automatically on next admin visit.</p>
      )}

      {/* Side-by-side comparison */}
      {selected && todayMetrics && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          {/* Today */}
          <div style={{ backgroundColor: '#082f49', border: '1px solid #0e749088', borderRadius: 8, padding: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#22d3ee', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Today · {snapshots[0]?.snapshot_date ?? '—'}</div>
            <MetricRow label="Agent Activity" value={todayMetrics.agentActivityCount ?? 0} />
            <MetricRow label="Beta Users" value={todayMetrics.betaUserCount ?? 0} />
            <MetricRow label="Improvement Log" value={todayMetrics.improvementLogCount ?? 0} />
            <MetricRow label="Goal Paths" value={(todayMetrics.goalPathStates ?? []).filter((g: any) => g.active).length} suffix="active" />
          </div>
          {/* Selected day */}
          <div style={{ backgroundColor: '#1c1008', border: '1px solid #f59e0b88', borderRadius: 8, padding: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Selected · {selected.snapshot_date}</div>
            <MetricRow label="Agent Activity" value={selected.metrics_json?.agentActivityCount ?? 0} compare={todayMetrics.agentActivityCount} />
            <MetricRow label="Beta Users" value={selected.metrics_json?.betaUserCount ?? 0} compare={todayMetrics.betaUserCount} />
            <MetricRow label="Improvement Log" value={selected.metrics_json?.improvementLogCount ?? 0} compare={todayMetrics.improvementLogCount} />
            <MetricRow label="Goal Paths" value={(selected.metrics_json?.goalPathStates ?? []).filter((g: any) => g.active).length} compare={(todayMetrics.goalPathStates ?? []).filter((g: any) => g.active).length} suffix="active" />
          </div>
        </div>
      )}

      {/* AI Delta Insight */}
      {selected && (
        <div style={{ marginTop: 4 }}>
          <button
            onClick={handleDeltaInsight}
            disabled={deltaLoading}
            style={{
              fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 8,
              border: '1px solid #0e749088', backgroundColor: '#082f49',
              color: '#22d3ee', cursor: deltaLoading ? 'not-allowed' : 'pointer',
              opacity: deltaLoading ? 0.6 : 1,
            }}
          >
            {deltaLoading ? '⚡ Analyzing delta…' : '⚡ AI Delta Analysis'}
          </button>
          {deltaInsight && (
            <p style={{ fontSize: 12, lineHeight: 1.65, color: '#d1d5db', marginTop: 10, whiteSpace: 'pre-wrap' }}>
              {deltaInsight}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function MetricRow({ label, value, compare, suffix }: { label: string; value: number; compare?: number; suffix?: string }) {
  const delta = compare !== undefined ? value - compare : null
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
      <span style={{ fontSize: 11, color: '#9ca3af' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>
        {value.toLocaleString()}{suffix ? ` ${suffix}` : ''}
        {delta !== null && delta !== 0 && (
          <span style={{ fontSize: 10, marginLeft: 4, color: delta > 0 ? '#4ade80' : '#f87171' }}>
            {delta > 0 ? `+${delta}` : delta}
          </span>
        )}
      </span>
    </div>
  )
}

// ─── TAB 2 — Backend Analysis ─────────────────────────────────────────────────
const SUPABASE_TABLES = [
  'projects', 'service_logs', 'leads', 'invoices',
  'signed_agreements', 'audit_decisions', 'snapshots',
  'beta_invites', 'orgs', 'voice_journal_entries',
]

function MetricCard({ label, count, error }: { label: string; count: number | null; error?: string }) {
  return (
    <div style={{
      backgroundColor: '#111827',
      border: `1px solid ${error ? '#ef444444' : '#1e3a5f'}`,
      borderRadius: 8,
      padding: '12px 14px',
    }}>
      <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>{label}</div>
      {error ? (
        <div style={{ fontSize: 11, color: '#f87171' }}>Error: {error}</div>
      ) : (
        <div style={{ fontSize: 22, fontWeight: 800, color: '#e2e8f0' }}>
          {count === null ? '…' : count.toLocaleString()}
        </div>
      )}
    </div>
  )
}

function Tab2BackendAnalysis() {
  const [tableCounts, setTableCounts] = useState<Record<string, { count: number | null; error?: string }>>({})
  const [loadingTables, setLoadingTables] = useState(true)
  const [agentActivity, setAgentActivity] = useState<any[]>([])
  const [systemFlags, setSystemFlags] = useState<{ key: string; value: string; severity: 'warn' | 'error' | 'info' }[]>([])
  const [aiInsight, setAiInsight] = useState('')
  const [aiLoading, setAiLoading] = useState(false)

  // Section A — Supabase health
  useEffect(() => {
    async function fetchCounts() {
      setLoadingTables(true)
      const results: Record<string, { count: number | null; error?: string }> = {}
      await Promise.all(
        SUPABASE_TABLES.map(async (table) => {
          try {
            const { count, error } = await (supabase as any)
              .from(table)
              .select('*', { count: 'exact', head: true })
            if (error) {
              results[table] = { count: null, error: error.code === '42P01' ? 'table not found' : (error.message || 'query error') }
            } else {
              results[table] = { count: count ?? 0 }
            }
          } catch (e: any) {
            results[table] = { count: null, error: e.message || 'fetch failed' }
          }
        })
      )
      setTableCounts(results)
      setLoadingTables(false)
    }
    fetchCounts()
  }, [])

  // Section B — Agent activity from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem('poweron_agent_bus_history')
      if (!raw) { setAgentActivity([]); return }
      const events = JSON.parse(raw)
      if (!Array.isArray(events)) { setAgentActivity([]); return }
      const today = new Date().toDateString()
      const todayEvents = events.filter((e: any) => {
        try { return new Date(e.timestamp).toDateString() === today } catch { return false }
      })
      // Group by agent
      const byAgent: Record<string, { count: number; lastAction: string }> = {}
      for (const ev of todayEvents) {
        const agent = ev.agent || ev.target || 'UNKNOWN'
        if (!byAgent[agent]) byAgent[agent] = { count: 0, lastAction: '' }
        byAgent[agent].count++
        byAgent[agent].lastAction = ev.action || ev.type || ''
      }
      setAgentActivity(Object.entries(byAgent).map(([agent, v]) => ({ agent, ...v })))
    } catch {
      setAgentActivity([])
    }
  }, [])

  // Section C — System flags from localStorage
  useEffect(() => {
    try {
      const flags: { key: string; value: string; severity: 'warn' | 'error' | 'info' }[] = []
      const errorKeywords = ['error', 'fail', 'crash', 'warn', 'flag', 'alert']
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i) || ''
        if (errorKeywords.some(kw => key.toLowerCase().includes(kw))) {
          const val = localStorage.getItem(key) || ''
          const severity = key.toLowerCase().includes('error') || key.toLowerCase().includes('crash') ? 'error'
            : key.toLowerCase().includes('warn') || key.toLowerCase().includes('alert') ? 'warn'
            : 'info'
          flags.push({ key, value: val.slice(0, 80), severity })
        }
      }
      setSystemFlags(flags)
    } catch {
      setSystemFlags([])
    }
  }, [])

  const loadAiInsight = useCallback(async () => {
    setAiLoading(true)
    const ctx = getSummaryContext()
    const tablesSummary = Object.entries(tableCounts)
      .map(([t, v]) => `${t}: ${v.error ? 'ERROR' : v.count}`)
      .join(', ')
    const text = await fetchInsight(
      'You are a senior full-stack engineer and business analyst reviewing the PowerOn Hub platform health.',
      `Platform context: ${ctx}.\nSupabase table counts: ${tablesSummary}.\nAgent activity today: ${agentActivity.length} agents active.\nSystem flags: ${systemFlags.length} found.\n\nIn 2-3 sentences: what is working, what needs attention, what is being flagged.\n\nThen list 10 improvement steps ordered by impact. Include not just code fixes but also user acquisition actions, business actions, legal actions, financial actions. Format as a numbered list.`
    )
    setAiInsight(text)
    setAiLoading(false)
  }, [tableCounts, agentActivity, systemFlags])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* Section A — Supabase Health */}
      <section>
        <h3 style={{ fontSize: 13, fontWeight: 700, color: '#60a5fa', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
          A · Supabase Health
        </h3>
        {loadingTables ? (
          <p style={{ color: '#6b7280', fontSize: 13 }}>Querying tables…</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
            {SUPABASE_TABLES.map(t => (
              <MetricCard key={t} label={t} count={tableCounts[t]?.count ?? null} error={tableCounts[t]?.error} />
            ))}
          </div>
        )}
      </section>

      {/* Section B — Agent Activity */}
      <section>
        <h3 style={{ fontSize: 13, fontWeight: 700, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
          B · Agent Activity Today
        </h3>
        {agentActivity.length === 0 ? (
          <div style={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: 8, padding: '16px', fontSize: 13, color: '#6b7280' }}>
            No agent activity logged yet — activity appears after NEXUS interactions.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {agentActivity.map((a, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                backgroundColor: '#111827', border: '1px solid #1e2d3d',
                borderRadius: 8, padding: '10px 14px',
              }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#a78bfa', minWidth: 80 }}>{a.agent}</span>
                <span style={{ fontSize: 12, color: '#9ca3af' }}>{a.count}x today</span>
                {a.lastAction && <span style={{ fontSize: 11, color: '#4b5563' }}>last: {a.lastAction}</span>}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Section C — System Flags */}
      <section>
        <h3 style={{ fontSize: 13, fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
          C · System Flags
        </h3>
        {systemFlags.length === 0 ? (
          <div style={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: 8, padding: '16px', fontSize: 13, color: '#6b7280' }}>
            No active flags detected in localStorage.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {systemFlags.map((f, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'flex-start', gap: 10,
                backgroundColor: '#111827',
                border: `1px solid ${f.severity === 'error' ? '#ef444444' : f.severity === 'warn' ? '#f59e0b44' : '#374151'}`,
                borderRadius: 8, padding: '10px 14px',
              }}>
                <span style={{
                  fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                  backgroundColor: f.severity === 'error' ? '#ef4444' : f.severity === 'warn' ? '#f59e0b' : '#374151',
                  color: '#fff', flexShrink: 0, marginTop: 2,
                }}>
                  {f.severity.toUpperCase()}
                </span>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#e2e8f0', marginBottom: 2 }}>{f.key}</div>
                  <div style={{ fontSize: 10, color: '#6b7280' }}>{f.value}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Section D — AI Insight + 10-Step Horizon */}
      <section>
        <h3 style={{ fontSize: 13, fontWeight: 700, color: '#34d399', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
          D · AI Insight + 10-Step Improvement Horizon
        </h3>
        <InsightCard
          title="D"
          accent="#34d399"
          insight={aiInsight}
          loading={aiLoading}
          onRegenerate={loadAiInsight}
        />
        {!aiInsight && !aiLoading && (
          <button
            onClick={loadAiInsight}
            style={{
              marginTop: 10,
              fontSize: 13, fontWeight: 600,
              padding: '8px 18px', borderRadius: 8,
              border: '1px solid #34d39966',
              backgroundColor: '#0f2a22',
              color: '#34d399', cursor: 'pointer',
            }}
          >
            Generate Insight
          </button>
        )}
      </section>

    </div>
  )
}

// ─── TAB 3 — Beta Metrics ─────────────────────────────────────────────────────
const FUNNEL_COLORS = ['#3b82f6', '#6366f1', '#8b5cf6', '#a855f7']

interface BetaUser {
  id: string
  email: string
  invited_at: string
  nda_signed: boolean
  industry: string
  last_active: string | null
  feedback_count: number
  status: 'active' | 'invited' | 'dropped'
}

function FlaggedUserCard({
  user,
  reason,
  action,
}: {
  user: BetaUser
  reason: string
  action: string
}) {
  const [copied, setCopied] = useState(false)
  const msg = `Hi! Just checking in — ${reason.toLowerCase()}. ${action}. Let me know if you have any questions!`
  return (
    <div style={{
      backgroundColor: '#111827',
      border: '1px solid #ef444433',
      borderRadius: 8,
      padding: '12px 14px',
      marginBottom: 8,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{user.email}</div>
          <div style={{ fontSize: 11, color: '#f87171', marginTop: 2 }}>⚠ {reason}</div>
          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>Recommended: {action}</div>
        </div>
        <button
          onClick={() => {
            try { navigator.clipboard.writeText(msg) } catch { /* ignore */ }
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
          }}
          style={{
            fontSize: 11, fontWeight: 600, padding: '4px 12px', borderRadius: 6,
            border: '1px solid #374151', backgroundColor: copied ? '#166534' : '#1f2937',
            color: copied ? '#86efac' : '#d1d5db', cursor: 'pointer',
          }}
        >
          {copied ? 'Copied!' : '📋 Copy follow-up'}
        </button>
      </div>
    </div>
  )
}

function Tab3BetaMetrics() {
  const [invites, setInvites] = useState<BetaUser[]>([])
  const [loading, setLoading] = useState(true)
  const [aiInsight, setAiInsight] = useState('')
  const [aiLoading, setAiLoading] = useState(false)

  useEffect(() => {
    async function fetchBetaData() {
      setLoading(true)
      try {
        // Fetch beta_invites
        const { data: inviteRows, error: inviteErr } = await (supabase as any)
          .from('beta_invites')
          .select('id, email, created_at, industry, status')
        if (inviteErr) throw inviteErr

        // Fetch signed_agreements
        const { data: ndaRows } = await (supabase as any)
          .from('signed_agreements')
          .select('user_id, email, created_at')

        const ndaEmails = new Set((ndaRows || []).map((r: any) => (r.email || '').toLowerCase()))

        // Fetch audit_decisions for feedback count
        const { data: feedbackRows } = await (supabase as any)
          .from('audit_decisions')
          .select('user_email')

        const feedbackByEmail: Record<string, number> = {}
        for (const r of (feedbackRows || [])) {
          const e = (r.user_email || '').toLowerCase()
          feedbackByEmail[e] = (feedbackByEmail[e] || 0) + 1
        }

        const users: BetaUser[] = (inviteRows || []).map((r: any) => {
          const email = (r.email || '').toLowerCase()
          const ndaSigned = ndaEmails.has(email)
          return {
            id: r.id,
            email: r.email,
            invited_at: r.created_at,
            nda_signed: ndaSigned,
            industry: r.industry || '—',
            last_active: null,
            feedback_count: feedbackByEmail[email] || 0,
            status: ndaSigned ? 'active' : 'invited',
          }
        })
        setInvites(users)
      } catch (e) {
        console.warn('[Tab3] fetch failed:', e)
        setInvites([])
      }
      setLoading(false)
    }
    fetchBetaData()
  }, [])

  const funnelData = [
    { name: 'Invites Sent',    value: invites.length, fill: FUNNEL_COLORS[0] },
    { name: 'NDAs Signed',     value: invites.filter(u => u.nda_signed).length, fill: FUNNEL_COLORS[1] },
    { name: 'Active Sessions', value: invites.filter(u => u.feedback_count > 0).length, fill: FUNNEL_COLORS[2] },
    { name: 'Feedback Given',  value: invites.filter(u => u.feedback_count > 0).length, fill: FUNNEL_COLORS[3] },
  ]

  // Dropoff analysis
  const flaggedUsers = invites.filter(u => {
    if (!u.nda_signed) return true
    // NDA signed but no activity — we don't have exact sessions, approximate via feedback
    if (u.nda_signed && u.feedback_count === 0) return true
    return false
  })

  const loadAiInsight = useCallback(async () => {
    setAiLoading(true)
    const text = await fetchInsight(
      'You are a product-market fit advisor for Power On Hub at beta stage.',
      `Beta funnel: ${JSON.stringify(funnelData)}. Total invites: ${invites.length}, NDAs signed: ${invites.filter(u => u.nda_signed).length}, feedback given: ${invites.filter(u => u.feedback_count > 0).length}. Flagged users: ${flaggedUsers.length}. What does this beta data tell us about product-market fit? What should be fixed before expanding to more users? 3-4 sentences.`
    )
    setAiInsight(text)
    setAiLoading(false)
  }, [invites, funnelData, flaggedUsers])

  const now = Date.now()
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* Funnel chart */}
      <section>
        <h3 style={{ fontSize: 13, fontWeight: 700, color: '#60a5fa', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
          User Funnel
        </h3>
        <div style={{ height: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={funnelData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2d3d" />
              <XAxis type="number" tick={{ fill: '#6b7280', fontSize: 11 }} />
              <YAxis dataKey="name" type="category" tick={{ fill: '#d1d5db', fontSize: 12 }} width={130} />
              <Tooltip contentStyle={{ backgroundColor: '#111827', border: '1px solid #1e3a5f', borderRadius: 8 }} />
              <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                {funnelData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Beta user table */}
      <section>
        <h3 style={{ fontSize: 13, fontWeight: 700, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
          Beta User Detail
        </h3>
        {loading ? (
          <p style={{ color: '#6b7280', fontSize: 13 }}>Loading beta users…</p>
        ) : invites.length === 0 ? (
          <p style={{ color: '#6b7280', fontSize: 13 }}>No beta invites found in database.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #1e2d3d' }}>
                  {['Email', 'Invited', 'NDA', 'Industry', 'Last Active', 'Feedback', 'Status'].map(h => (
                    <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: '#6b7280', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invites.map((u) => (
                  <tr key={u.id} style={{ borderBottom: '1px solid #111827' }}>
                    <td style={{ padding: '8px 10px', color: '#e2e8f0' }}>{u.email}</td>
                    <td style={{ padding: '8px 10px', color: '#9ca3af' }}>
                      {u.invited_at ? new Date(u.invited_at).toLocaleDateString() : '—'}
                    </td>
                    <td style={{ padding: '8px 10px', color: u.nda_signed ? '#86efac' : '#f87171', fontWeight: 700 }}>
                      {u.nda_signed ? 'Yes' : 'No'}
                    </td>
                    <td style={{ padding: '8px 10px', color: '#9ca3af' }}>{u.industry}</td>
                    <td style={{ padding: '8px 10px', color: '#9ca3af' }}>{u.last_active || '—'}</td>
                    <td style={{ padding: '8px 10px', color: '#9ca3af' }}>{u.feedback_count}</td>
                    <td style={{ padding: '8px 10px' }}>
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                        backgroundColor: u.status === 'active' ? '#14532d' : '#1e2d3d',
                        color: u.status === 'active' ? '#86efac' : '#9ca3af',
                      }}>
                        {u.status.toUpperCase()}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Dropoff analysis */}
      <section>
        <h3 style={{ fontSize: 13, fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
          Dropoff Analysis
        </h3>
        {loading ? (
          <p style={{ color: '#6b7280', fontSize: 13 }}>Loading…</p>
        ) : flaggedUsers.length === 0 ? (
          <div style={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: 8, padding: 16, fontSize: 13, color: '#86efac' }}>
            ✓ No dropoff flags detected.
          </div>
        ) : (
          <div>
            {flaggedUsers.map((u) => {
              const reason = !u.nda_signed
                ? 'Invited but NDA not signed'
                : 'NDA signed but no activity recorded'
              const action = !u.nda_signed
                ? 'Send NDA reminder and check if invite link works'
                : 'Re-engage with a demo walkthrough or check-in call'
              return (
                <FlaggedUserCard key={u.id} user={u} reason={reason} action={action} />
              )
            })}
          </div>
        )}
      </section>

      {/* AI Insight */}
      <section>
        <h3 style={{ fontSize: 13, fontWeight: 700, color: '#34d399', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
          AI Insight — Beta PMF Analysis
        </h3>
        <InsightCard
          title="Beta PMF"
          accent="#34d399"
          insight={aiInsight}
          loading={aiLoading}
          onRegenerate={loadAiInsight}
        />
        {!aiInsight && !aiLoading && (
          <button
            onClick={loadAiInsight}
            style={{
              marginTop: 10,
              fontSize: 13, fontWeight: 600,
              padding: '8px 18px', borderRadius: 8,
              border: '1px solid #34d39966',
              backgroundColor: '#0f2a22',
              color: '#34d399', cursor: 'pointer',
            }}
          >
            Generate Beta Insight
          </button>
        )}
      </section>

    </div>
  )
}

// ─── TAB 4 — Economics ────────────────────────────────────────────────────────

const TIER_PRICES: Record<string, number> = { Solo: 49, Growth: 99, Pro: 199 }
const COST_STORAGE_KEY = 'poweron_economics_costs'

type CostItem = { id: string; name: string; amount: number }

const DEFAULT_COSTS: CostItem[] = [
  { id: 'anthropic', name: 'Anthropic API', amount: 120 },
  { id: 'elevenlabs', name: 'ElevenLabs', amount: 22 },
  { id: 'supabase', name: 'Supabase', amount: 25 },
  { id: 'netlify', name: 'Netlify', amount: 19 },
  { id: 'resend', name: 'Resend', amount: 20 },
  { id: 'upstash', name: 'Upstash Redis', amount: 10 },
]

function Tab4Economics() {
  const [costs, setCosts] = useState<CostItem[]>(() => {
    try {
      const raw = localStorage.getItem(COST_STORAGE_KEY)
      if (raw) return JSON.parse(raw)
    } catch {}
    return DEFAULT_COSTS
  })
  const [activeUsers, setActiveUsers] = useState<number>(6)
  const [aiInsight, setAiInsight] = useState('')
  const [aiLoading, setAiLoading] = useState(false)

  useEffect(() => {
    try { localStorage.setItem(COST_STORAGE_KEY, JSON.stringify(costs)) } catch {}
  }, [costs])

  useEffect(() => {
    async function fetchUsers() {
      try {
        const { count } = await (supabase as any)
          .from('beta_invites')
          .select('*', { count: 'exact', head: true })
        if (count != null) setActiveUsers(count)
      } catch {}
    }
    fetchUsers()
  }, [])

  const totalMonthlyCost = costs.reduce((sum, c) => sum + (Number(c.amount) || 0), 0)
  const costPerUser = activeUsers > 0 ? totalMonthlyCost / activeUsers : totalMonthlyCost

  const breakEven = Object.entries(TIER_PRICES).map(([tier, price]) => ({
    tier,
    price,
    users: price > 0 ? Math.ceil(totalMonthlyCost / price) : Infinity,
  }))

  function updateCost(id: string, field: 'name' | 'amount', value: string) {
    setCosts(prev => prev.map(c =>
      c.id === id ? { ...c, [field]: field === 'amount' ? parseFloat(value) || 0 : value } : c
    ))
  }

  function addCost() {
    setCosts(prev => [...prev, { id: Date.now().toString(), name: 'New Cost', amount: 0 }])
  }

  function removeCost(id: string) {
    setCosts(prev => prev.filter(c => c.id !== id))
  }

  function projectScenario(months: number, rate: number) {
    const users = Math.round(activeUsers * Math.pow(1 + rate, months))
    const mrr = users * TIER_PRICES.Growth
    const costVal = Math.round(totalMonthlyCost * (1 + 0.05 * Math.floor(months / 3)))
    const margin = mrr - costVal
    return { users, mrr, cost: costVal, margin }
  }

  const projectionData = [0, 1, 2, 3, 4, 5, 6, 9, 12].map(m => ({
    month: m === 0 ? 'Now' : `M${m}`,
    Conservative: projectScenario(m, 0.10).mrr,
    Moderate: projectScenario(m, 0.20).mrr,
    Aggressive: projectScenario(m, 0.35).mrr,
    Costs: Math.round(totalMonthlyCost * (1 + 0.05 * Math.floor(m / 3))),
  }))

  const projectionSummary = [3, 6, 12].map(m => ({
    months: m,
    conservative: projectScenario(m, 0.10),
    moderate: projectScenario(m, 0.20),
    aggressive: projectScenario(m, 0.35),
  }))

  const anthropicCost = costs.find(c => c.id === 'anthropic')?.amount || 0
  const modMrr6m = projectScenario(6, 0.20).mrr
  const anthropicPct6m = modMrr6m > 0 ? (anthropicCost / modMrr6m) * 100 : 100

  const loadAiInsight = useCallback(async () => {
    setAiLoading(true)
    const costsList = costs.map(c => `${c.name}: $${c.amount}/mo`).join(', ')
    const beSummary = breakEven.map(b => `${b.tier} ($${b.price}/mo) needs ${b.users} users`).join('; ')
    const text = await fetchInsight(
      'You are a SaaS financial advisor for Power On Hub, an electrical contractor operations platform at early beta. Be specific and practical.',
      `Monthly costs: ${costsList}. Total: $${totalMonthlyCost}/mo. Active users: ${activeUsers}. Cost per user: $${costPerUser.toFixed(2)}/mo. Break-even: ${beSummary}.\n\nAnalyze: 1) Current burn rate and break-even timeline, 2) Which tier mix maximizes margin at scale, 3) Cost categories to watch most as you scale. Flag if Anthropic costs exceed 30% of revenue at any projection point. Be concise. 3-4 paragraphs.`
    )
    setAiInsight(text)
    setAiLoading(false)
  }, [costs, activeUsers, totalMonthlyCost, costPerUser, breakEven])

  const inputStyle: React.CSSProperties = {
    backgroundColor: 'transparent', border: 'none', color: '#e2e8f0',
    fontSize: 13, outline: 'none', minWidth: 0, flex: 1,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* Section A — Monthly Costs */}
      <section>
        <h3 style={{ fontSize: 13, fontWeight: 700, color: '#60a5fa', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
          A · Current Monthly Costs
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {costs.map(c => (
            <div key={c.id} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              backgroundColor: '#111827', border: '1px solid #1e2d3d', borderRadius: 8, padding: '10px 14px',
            }}>
              <input value={c.name} onChange={e => updateCost(c.id, 'name', e.target.value)} style={inputStyle} />
              <span style={{ color: '#6b7280', fontSize: 13, flexShrink: 0 }}>$</span>
              <input
                type="number"
                value={c.amount}
                onChange={e => updateCost(c.id, 'amount', e.target.value)}
                style={{
                  width: 80, backgroundColor: '#0f172a', border: '1px solid #374151', borderRadius: 6,
                  color: '#fbbf24', fontSize: 13, fontWeight: 700, padding: '4px 8px', outline: 'none',
                  textAlign: 'right',
                }}
              />
              <span style={{ color: '#6b7280', fontSize: 12, flexShrink: 0 }}>/mo</span>
              <button onClick={() => removeCost(c.id)} style={{
                background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer',
                fontSize: 18, flexShrink: 0, lineHeight: 1,
              }}>×</button>
            </div>
          ))}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            backgroundColor: '#1e2d3d', border: '1px solid #2d4a6b', borderRadius: 8, padding: '12px 14px', marginTop: 4,
          }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#93c5fd' }}>Total</span>
            <span style={{ fontSize: 18, fontWeight: 800, color: '#60a5fa' }}>${totalMonthlyCost.toLocaleString()}/mo</span>
          </div>
          <button onClick={addCost} style={{
            marginTop: 4, fontSize: 12, fontWeight: 600, padding: '8px 16px', borderRadius: 8,
            border: '1px solid #374151', backgroundColor: '#111827', color: '#9ca3af',
            cursor: 'pointer', alignSelf: 'flex-start',
          }}>
            + Add Cost
          </button>
        </div>
      </section>

      {/* Section B — Per-User Cost Calculator */}
      <section>
        <h3 style={{ fontSize: 13, fontWeight: 700, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
          B · Per-User Cost Calculator
        </h3>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ backgroundColor: '#111827', border: '1px solid #1e2d3d', borderRadius: 10, padding: '14px 18px', minWidth: 160 }}>
            <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', marginBottom: 6 }}>Active Users</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: '#e2e8f0' }}>{activeUsers}</div>
          </div>
          <div style={{ backgroundColor: '#111827', border: '1px solid #1e2d3d', borderRadius: 10, padding: '14px 18px', minWidth: 180 }}>
            <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', marginBottom: 6 }}>Cost Per User/Mo</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: '#fbbf24' }}>${costPerUser.toFixed(2)}</div>
          </div>
          <div style={{ backgroundColor: '#0f172a', border: '1px solid #3730a333', borderRadius: 10, padding: '14px 18px', flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', marginBottom: 10, letterSpacing: '0.06em' }}>Break-Even Point</div>
            {breakEven.map(b => (
              <div key={b.tier} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 12, color: '#c4b5fd' }}>{b.tier} (${b.price}/mo)</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#a78bfa' }}>
                  {isFinite(b.users) ? `${b.users} users` : '—'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Section C — Projections */}
      <section>
        <h3 style={{ fontSize: 13, fontWeight: 700, color: '#34d399', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
          C · Projections at 3 / 6 / 12 Months
        </h3>
        <div style={{ overflowX: 'auto', marginBottom: 16 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #1e2d3d' }}>
                <th style={{ padding: '8px 10px', textAlign: 'left', color: '#6b7280', fontSize: 11 }}></th>
                {['Conservative (10%/mo)', 'Moderate (20%/mo)', 'Aggressive (35%/mo)'].map(h => (
                  <th key={h} style={{ padding: '8px 10px', textAlign: 'right', color: '#6b7280', fontSize: 11, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {projectionSummary.map(row => (
                <>
                  <tr key={`h${row.months}`}>
                    <td colSpan={4} style={{ padding: '8px 10px 2px', fontSize: 11, fontWeight: 700, color: '#4b5563', textTransform: 'uppercase' }}>
                      {row.months} Months
                    </td>
                  </tr>
                  {[
                    { label: 'Users', keys: ['users'], color: '#d1d5db' },
                    { label: 'MRR', keys: ['mrr'], color: '#86efac', prefix: '$', format: true },
                    { label: 'Costs', keys: ['cost'], color: '#f87171', prefix: '$', format: true },
                    { label: 'Net Margin', keys: ['margin'], isMargin: true, prefix: '$', format: true },
                  ].map(rowDef => (
                    <tr key={`${row.months}-${rowDef.label}`} style={{ borderBottom: '1px solid #111827' }}>
                      <td style={{ padding: '4px 10px', color: '#9ca3af', fontSize: 11 }}>{rowDef.label}</td>
                      {(['conservative', 'moderate', 'aggressive'] as const).map(s => {
                        const val = (row[s] as any)[rowDef.keys[0]]
                        const isNeg = rowDef.isMargin && val < 0
                        return (
                          <td key={s} style={{
                            padding: '4px 10px', textAlign: 'right', fontWeight: rowDef.isMargin ? 700 : 400,
                            color: rowDef.isMargin ? (isNeg ? '#f87171' : '#34d399') : rowDef.color,
                          }}>
                            {rowDef.prefix}{rowDef.format ? Number(val).toLocaleString() : val}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ height: 240 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={projectionData}>
              <defs>
                <linearGradient id="gcBlue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="gcPurple" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="gcGreen" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#34d399" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#34d399" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2d3d" />
              <XAxis dataKey="month" tick={{ fill: '#6b7280', fontSize: 11 }} />
              <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
              <Tooltip
                contentStyle={{ backgroundColor: '#111827', border: '1px solid #1e3a5f', borderRadius: 8 }}
                formatter={(v: any) => [`$${Number(v).toLocaleString()}`, '']}
              />
              <Legend wrapperStyle={{ fontSize: 11, color: '#9ca3af' }} />
              <Area type="monotone" dataKey="Conservative" stroke="#3b82f6" fill="url(#gcBlue)" strokeWidth={2} />
              <Area type="monotone" dataKey="Moderate" stroke="#8b5cf6" fill="url(#gcPurple)" strokeWidth={2} />
              <Area type="monotone" dataKey="Aggressive" stroke="#34d399" fill="url(#gcGreen)" strokeWidth={2} />
              <Area type="monotone" dataKey="Costs" stroke="#ef4444" fill="none" strokeDasharray="4 4" strokeWidth={1.5} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        {anthropicPct6m > 30 && (
          <div style={{
            marginTop: 12, padding: '10px 14px', backgroundColor: '#7f1d1d22',
            border: '1px solid #ef444466', borderRadius: 8, fontSize: 12, color: '#fca5a5',
          }}>
            ⚠ Warning: Anthropic API costs may exceed 30% of projected 6-month MRR (moderate scenario).
            Consider rate-limiting, response caching, or prompt compression strategies.
          </div>
        )}
      </section>

      {/* Section D — AI Economics Insight */}
      <section>
        <h3 style={{ fontSize: 13, fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
          D · AI Economics Insight
        </h3>
        <InsightCard
          title="Economics"
          accent="#f59e0b"
          insight={aiInsight}
          loading={aiLoading}
          onRegenerate={loadAiInsight}
        />
        {!aiInsight && !aiLoading && (
          <button
            onClick={loadAiInsight}
            style={{
              marginTop: 10, fontSize: 13, fontWeight: 600, padding: '8px 18px', borderRadius: 8,
              border: '1px solid #f59e0b66', backgroundColor: '#1c1307', color: '#f59e0b', cursor: 'pointer',
            }}
          >
            Generate Economics Insight
          </button>
        )}
      </section>

    </div>
  )
}

// ─── TAB 5 — Improvement Log ──────────────────────────────────────────────────

type ImprovementEntry = {
  id: string
  title: string
  category: string
  priority: 'High' | 'Med' | 'Low'
  notes: string
  estimated_hours: number
  source: 'auto' | 'manual'
  admin_added: boolean
  created_at: string
}

const IMPROVEMENT_CATEGORIES = ['Bug', 'Feature', 'UX', 'Performance', 'Business', 'Legal', 'Security']
const IMPROVEMENT_PRIORITIES = ['High', 'Med', 'Low']

const PRIORITY_COLORS: Record<string, string> = { High: '#ef4444', Med: '#f59e0b', Low: '#6b7280' }
const CATEGORY_COLORS: Record<string, string> = {
  Bug: '#ef4444', Feature: '#3b82f6', UX: '#8b5cf6', Performance: '#f59e0b',
  Business: '#34d399', Legal: '#a78bfa', Security: '#f87171',
}

function Tab5ImprovementLog() {
  const [entries, setEntries] = useState<ImprovementEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [formTitle, setFormTitle] = useState('')
  const [formCategory, setFormCategory] = useState('Bug')
  const [formPriority, setFormPriority] = useState<'High' | 'Med' | 'Low'>('Med')
  const [formNotes, setFormNotes] = useState('')
  const [formHours, setFormHours] = useState('')
  const [formError, setFormError] = useState('')
  const [formSuccess, setFormSuccess] = useState(false)
  const [filterSource, setFilterSource] = useState('All')
  const [filterCategory, setFilterCategory] = useState('All')
  const [filterPriority, setFilterPriority] = useState('All')
  const [dateStart, setDateStart] = useState('2026-04-06')
  const [dateEnd, setDateEnd] = useState(new Date().toISOString().split('T')[0])
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [aiInsight, setAiInsight] = useState('')
  const [aiLoading, setAiLoading] = useState(false)

  async function fetchEntries() {
    setLoading(true)
    try {
      const { data: auditRows } = await (supabase as any)
        .from('audit_decisions')
        .select('id, decision, notes, created_at, action_type')
        .order('created_at', { ascending: false })
        .limit(200)

      const autoEntries: ImprovementEntry[] = (auditRows || []).map((r: any) => ({
        id: `auto_${r.id}`,
        title: r.action_type
          ? `${r.action_type}: ${(r.notes || '').slice(0, 60)}`
          : (r.notes || 'Audit decision').slice(0, 80),
        category: r.action_type?.toLowerCase().includes('bug') ? 'Bug'
          : r.action_type?.toLowerCase().includes('ux') ? 'UX'
          : r.action_type?.toLowerCase().includes('security') ? 'Security'
          : 'Feature',
        priority: r.decision === 'dismiss' ? 'Low' : 'Med',
        notes: r.notes || '',
        estimated_hours: 0,
        source: 'auto' as const,
        admin_added: false,
        created_at: r.created_at || new Date().toISOString(),
      }))

      const { data: manualRows } = await (supabase as any)
        .from('improvement_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)

      const manualEntries: ImprovementEntry[] = (manualRows || []).map((r: any) => ({
        id: r.id,
        title: r.title || '',
        category: r.category || 'Bug',
        priority: r.priority || 'Med',
        notes: r.notes || '',
        estimated_hours: r.estimated_hours || 0,
        source: 'manual' as const,
        admin_added: true,
        created_at: r.created_at || new Date().toISOString(),
      }))

      setEntries([...manualEntries, ...autoEntries])
    } catch (e) {
      console.warn('[Tab5] fetch failed:', e)
    }
    setLoading(false)
  }

  useEffect(() => { fetchEntries() }, [])

  async function handleSubmit() {
    if (!formTitle.trim()) { setFormError('Title is required.'); return }
    setSubmitting(true); setFormError('')
    try {
      const { error } = await (supabase as any)
        .from('improvement_log')
        .insert({
          title: formTitle.trim(),
          category: formCategory,
          priority: formPriority,
          notes: formNotes.trim(),
          estimated_hours: parseFloat(formHours) || 0,
          source: 'manual',
          admin_added: true,
        })
      if (error) throw error
      setFormTitle(''); setFormNotes(''); setFormHours('')
      setFormSuccess(true)
      setTimeout(() => setFormSuccess(false), 3000)
      await fetchEntries()
    } catch (e: any) {
      setFormError(e?.message || 'Insert failed — run migration 054 in Supabase SQL editor first.')
    }
    setSubmitting(false)
  }

  function toggleExpand(id: string) {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function applyPreset(preset: string) {
    const now = new Date()
    const end = now.toISOString().split('T')[0]
    let start = '2026-04-06'
    const d = new Date(now)
    if (preset === 'today') { start = end }
    else if (preset === 'week') { d.setDate(d.getDate() - 7); start = d.toISOString().split('T')[0] }
    else if (preset === 'month') { d.setDate(1); start = d.toISOString().split('T')[0] }
    else if (preset === '30d') { d.setDate(d.getDate() - 30); start = d.toISOString().split('T')[0] }
    else if (preset === '60d') { d.setDate(d.getDate() - 60); start = d.toISOString().split('T')[0] }
    else if (preset === '90d') { d.setDate(d.getDate() - 90); start = d.toISOString().split('T')[0] }
    setDateStart(start); setDateEnd(end)
  }

  const filtered = entries.filter(e => {
    if (filterSource === 'Auto-populated' && e.source !== 'auto') return false
    if (filterSource === 'Manual' && e.source !== 'manual') return false
    if (filterCategory !== 'All' && e.category !== filterCategory) return false
    if (filterPriority !== 'All' && e.priority !== filterPriority) return false
    const d = e.created_at.split('T')[0]
    if (d < dateStart || d > dateEnd) return false
    return true
  })

  function exportJSON() {
    const blob = new Blob([JSON.stringify(filtered, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url
    a.download = `improvement_log_${dateStart}_${dateEnd}.json`
    a.click(); URL.revokeObjectURL(url)
  }

  function exportCSV() {
    const cols = ['id', 'title', 'category', 'priority', 'notes', 'estimated_hours', 'source', 'admin_added', 'created_at']
    const rows = filtered.map(e => cols.map(c => JSON.stringify((e as any)[c] ?? '')).join(','))
    const blob = new Blob([[cols.join(','), ...rows].join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url
    a.download = `improvement_log_${dateStart}_${dateEnd}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  const loadAiInsight = useCallback(async () => {
    setAiLoading(true)
    const summary = filtered.slice(0, 50).map(e =>
      `[${e.priority}][${e.category}] ${e.title}${e.notes ? ': ' + e.notes.slice(0, 60) : ''}`
    ).join('\n')
    const text = await fetchInsight(
      'You are a product development advisor for Power On Hub, an electrical contractor operations platform at beta stage. Be direct and actionable.',
      `Improvement log (${filtered.length} entries, max 50 shown):\n${summary}\n\nProvide:\n1. Top 3 patterns emerging from this log\n2. What to prioritize THIS WEEK (2-3 items max)\n3. What can wait\n4. What requires EXTERNAL action (attorney, outside developer, user call, financial advisor)\n\nBe concise and specific.`
    )
    setAiInsight(text)
    setAiLoading(false)
  }, [filtered])

  const fieldStyle: React.CSSProperties = {
    backgroundColor: '#0f172a', border: '1px solid #374151', borderRadius: 6,
    color: '#e2e8f0', fontSize: 13, padding: '7px 10px', outline: 'none', width: '100%',
    boxSizing: 'border-box',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* Section A — Manual Entry Form */}
      <section>
        <h3 style={{ fontSize: 13, fontWeight: 700, color: '#60a5fa', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
          A · Add Manual Entry
        </h3>
        <div style={{ backgroundColor: '#0f172a', border: '1px solid #1e2d3d', borderRadius: 12, padding: 18 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 11, color: '#6b7280', display: 'block', marginBottom: 4 }}>Title *</label>
              <input value={formTitle} onChange={e => setFormTitle(e.target.value)}
                placeholder="Brief description of the issue or improvement"
                style={fieldStyle} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: '#6b7280', display: 'block', marginBottom: 4 }}>Category</label>
              <select value={formCategory} onChange={e => setFormCategory(e.target.value)} style={{ ...fieldStyle, cursor: 'pointer' }}>
                {IMPROVEMENT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: '#6b7280', display: 'block', marginBottom: 4 }}>Priority</label>
              <select value={formPriority} onChange={e => setFormPriority(e.target.value as any)} style={{ ...fieldStyle, cursor: 'pointer' }}>
                {IMPROVEMENT_PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 11, color: '#6b7280', display: 'block', marginBottom: 4 }}>Notes</label>
              <textarea value={formNotes} onChange={e => setFormNotes(e.target.value)}
                placeholder="Additional context, steps to reproduce, or business impact..."
                rows={3} style={{ ...fieldStyle, resize: 'vertical' }} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: '#6b7280', display: 'block', marginBottom: 4 }}>Estimated Effort (Hours)</label>
              <input type="number" value={formHours} onChange={e => setFormHours(e.target.value)}
                placeholder="0" style={fieldStyle} />
            </div>
          </div>
          {formError && <p style={{ fontSize: 12, color: '#f87171', marginBottom: 8 }}>{formError}</p>}
          {formSuccess && <p style={{ fontSize: 12, color: '#86efac', marginBottom: 8 }}>✓ Entry added successfully.</p>}
          <button onClick={handleSubmit} disabled={submitting} style={{
            fontSize: 13, fontWeight: 600, padding: '8px 20px', borderRadius: 8,
            border: '1px solid #3b82f666', backgroundColor: '#1e2d3d', color: '#60a5fa',
            cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.6 : 1,
          }}>
            {submitting ? 'Saving…' : 'Submit Entry'}
          </button>
        </div>
      </section>

      {/* Section B — Filters & Export */}
      <section>
        <h3 style={{ fontSize: 13, fontWeight: 700, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
          B · Filters & Export
        </h3>
        <div style={{ backgroundColor: '#0f172a', border: '1px solid #1e2d3d', borderRadius: 12, padding: 16 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            <select value={filterSource} onChange={e => setFilterSource(e.target.value)}
              style={{ ...fieldStyle, width: 'auto', minWidth: 140, cursor: 'pointer' }}>
              {['All', 'Auto-populated', 'Manual'].map(s => <option key={s}>{s}</option>)}
            </select>
            <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
              style={{ ...fieldStyle, width: 'auto', minWidth: 130, cursor: 'pointer' }}>
              <option value="All">All Categories</option>
              {IMPROVEMENT_CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>
            <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)}
              style={{ ...fieldStyle, width: 'auto', minWidth: 120, cursor: 'pointer' }}>
              <option value="All">All Priorities</option>
              {IMPROVEMENT_PRIORITIES.map(p => <option key={p}>{p}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
            <input type="date" value={dateStart} min="2026-04-06" onChange={e => setDateStart(e.target.value)}
              style={{ ...fieldStyle, width: 'auto' }} />
            <span style={{ color: '#6b7280', fontSize: 12 }}>to</span>
            <input type="date" value={dateEnd} min="2026-04-06" onChange={e => setDateEnd(e.target.value)}
              style={{ ...fieldStyle, width: 'auto' }} />
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
            {[['today', 'Today'], ['week', 'This Week'], ['month', 'This Month'], ['30d', 'Last 30d'], ['60d', 'Last 60d'], ['90d', 'Last 90d']].map(([k, l]) => (
              <button key={k} onClick={() => applyPreset(k)} style={{
                fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 6,
                border: '1px solid #374151', backgroundColor: '#111827', color: '#9ca3af', cursor: 'pointer',
              }}>{l}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={exportJSON} style={{
              fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 7,
              border: '1px solid #374151', backgroundColor: '#111827', color: '#d1d5db', cursor: 'pointer',
            }}>↓ Export JSON</button>
            <button onClick={exportCSV} style={{
              fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 7,
              border: '1px solid #374151', backgroundColor: '#111827', color: '#d1d5db', cursor: 'pointer',
            }}>↓ Export CSV</button>
            <span style={{ fontSize: 12, color: '#4b5563' }}>{filtered.length} entries shown</span>
          </div>
        </div>
      </section>

      {/* Section C — Log Entries */}
      <section>
        <h3 style={{ fontSize: 13, fontWeight: 700, color: '#34d399', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
          C · Log Entries
        </h3>
        {loading ? (
          <p style={{ color: '#6b7280', fontSize: 13 }}>Loading entries…</p>
        ) : filtered.length === 0 ? (
          <div style={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: 8, padding: 16, fontSize: 13, color: '#6b7280' }}>
            No entries match current filters. Add a manual entry above or broaden date range.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtered.map(e => {
              const isExpanded = expandedIds.has(e.id)
              const catColor = CATEGORY_COLORS[e.category] || '#374151'
              const priColor = PRIORITY_COLORS[e.priority] || '#6b7280'
              return (
                <div key={e.id} style={{ backgroundColor: '#111827', border: '1px solid #1e2d3d', borderRadius: 10, padding: '12px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{
                      fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, flexShrink: 0, marginTop: 1,
                      backgroundColor: e.source === 'manual' ? '#1e3a5f' : '#1a2e1a',
                      color: e.source === 'manual' ? '#60a5fa' : '#86efac',
                    }}>{e.source === 'manual' ? 'MANUAL' : 'AUTO'}</span>
                    <span style={{
                      fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, flexShrink: 0, marginTop: 1,
                      backgroundColor: catColor + '22', color: catColor, border: `1px solid ${catColor}44`,
                    }}>{e.category.toUpperCase()}</span>
                    <span style={{
                      fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, flexShrink: 0, marginTop: 1,
                      backgroundColor: priColor + '22', color: priColor,
                    }}>{e.priority.toUpperCase()}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', flex: 1, minWidth: 0 }}>{e.title}</span>
                    <span style={{ fontSize: 10, color: '#4b5563', flexShrink: 0, alignSelf: 'center' }}>
                      {new Date(e.created_at).toLocaleDateString()}
                    </span>
                    {e.notes && (
                      <button onClick={() => toggleExpand(e.id)} style={{
                        fontSize: 11, color: '#6b7280', background: 'none', border: 'none',
                        cursor: 'pointer', flexShrink: 0, padding: '0 4px',
                      }}>{isExpanded ? '▲' : '▼'}</button>
                    )}
                  </div>
                  {e.notes && (
                    <div style={{ marginTop: 6, paddingLeft: 4 }}>
                      <p style={{
                        fontSize: 12, color: '#6b7280', margin: 0,
                        overflow: isExpanded ? 'visible' : 'hidden',
                        textOverflow: isExpanded ? 'unset' : 'ellipsis',
                        whiteSpace: isExpanded ? 'pre-wrap' : 'nowrap',
                      }}>{e.notes}</p>
                    </div>
                  )}
                  {isExpanded && e.estimated_hours > 0 && (
                    <div style={{ marginTop: 6, fontSize: 11, color: '#4b5563' }}>
                      Estimated effort: {e.estimated_hours}h
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* Section D — AI Improvement Insight */}
      <section>
        <h3 style={{ fontSize: 13, fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
          D · AI Improvement Insight
        </h3>
        <InsightCard
          title="Improvement"
          accent="#f59e0b"
          insight={aiInsight}
          loading={aiLoading}
          onRegenerate={loadAiInsight}
        />
        {!aiInsight && !aiLoading && (
          <button onClick={loadAiInsight} style={{
            marginTop: 10, fontSize: 13, fontWeight: 600, padding: '8px 18px', borderRadius: 8,
            border: '1px solid #f59e0b66', backgroundColor: '#1c1307', color: '#f59e0b', cursor: 'pointer',
          }}>
            Generate Improvement Insight
          </button>
        )}
      </section>

    </div>
  )
}

// ─── TAB 6 — Summary + Checklist ─────────────────────────────────────────────

type ChecklistItem = {
  id: string
  title: string
  category: string
  dueDate: string
  notes: string
  checked: boolean
}

const CHECKLIST_DISMISS_KEY = 'poweron_voice_reminder_dismissed'
const CHECKLIST_CATEGORIES = ['Feature', 'Business', 'Bug', 'UX', 'Performance', 'Legal', 'Security', 'General']

const DEFAULT_CHECKLIST_ITEMS: ChecklistItem[] = [
  { id: '1', title: 'Follow up with all 6 beta invitees — confirm NDA + onboarding', category: 'Business', dueDate: '2026-04-10', notes: '', checked: false },
  { id: '2', title: 'Deploy Tab 6 Summary + Checklist to production', category: 'Feature', dueDate: '2026-04-07', notes: '', checked: false },
  { id: '3', title: 'Deploy Tab 7 Scripts + Positioning to production', category: 'Feature', dueDate: '2026-04-07', notes: '', checked: false },
  { id: '4', title: 'File provisional patent application', category: 'Legal', dueDate: '2026-04-15', notes: '', checked: false },
  { id: '5', title: 'Set up Resend for automated beta invite emails', category: 'Feature', dueDate: '2026-04-12', notes: '', checked: false },
  { id: '6', title: 'Run NEXUS voice demo for first beta user', category: 'Business', dueDate: '2026-04-14', notes: '', checked: false },
  { id: '7', title: 'Export lender one-pager with live pipeline numbers', category: 'Business', dueDate: '2026-04-20', notes: '', checked: false },
  { id: '8', title: 'Review and respond to all Voice Hub captures older than 48h', category: 'General', dueDate: '2026-04-08', notes: '', checked: false },
]

const CATEGORY_CHIP_COLORS: Record<string, string> = {
  Feature: '#3b82f6', Business: '#34d399', Bug: '#ef4444', UX: '#8b5cf6',
  Performance: '#f59e0b', Legal: '#a78bfa', Security: '#f87171', General: '#6b7280',
}

function getWeekLabel(date: Date): string {
  const start = new Date(date)
  const day = start.getDay()
  const diff = start.getDate() - day + (day === 0 ? -6 : 1)
  start.setDate(diff)
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  return `Week of ${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
}

function getMonthLabel(date: Date): string {
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long' })
}

function Tab6SummaryChecklist() {
  const [summary, setSummary] = useState('')
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [items, setItems] = useState<ChecklistItem[]>(DEFAULT_CHECKLIST_ITEMS)
  const [completions, setCompletions] = useState<any[]>([])
  const [completionsLoading, setCompletionsLoading] = useState(true)
  const [filterStart, setFilterStart] = useState('2026-04-06')
  const [filterEnd, setFilterEnd] = useState(new Date().toISOString().split('T')[0])
  const [voiceCaptures, setVoiceCaptures] = useState<number>(0)
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(CHECKLIST_DISMISS_KEY) === '1' } catch { return false }
  })

  // Load voice captures older than 24h
  useEffect(() => {
    async function fetchVoice() {
      try {
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
        const { count } = await (supabase as any)
          .from('voice_journal_entries')
          .select('*', { count: 'exact', head: true })
          .lt('created_at', cutoff)
          .eq('reviewed', false)
        setVoiceCaptures(count ?? 0)
      } catch { setVoiceCaptures(0) }
    }
    fetchVoice()
  }, [])

  // Load completions from Supabase
  useEffect(() => { fetchCompletions() }, [])

  async function fetchCompletions() {
    setCompletionsLoading(true)
    try {
      const { data } = await (supabase as any)
        .from('checklist_completions')
        .select('*')
        .order('completed_at', { ascending: false })
        .limit(500)
      setCompletions(data ?? [])
    } catch { setCompletions([]) }
    setCompletionsLoading(false)
  }

  async function handleCheck(id: string) {
    const item = items.find(i => i.id === id)
    if (!item || item.checked) return
    const now = new Date()
    setItems(prev => prev.map(i => i.id === id ? { ...i, checked: true } : i))
    try {
      await (supabase as any).from('checklist_completions').insert({
        title: item.title,
        category: item.category,
        notes: item.notes,
        completed_at: now.toISOString(),
        week_label: getWeekLabel(now),
        month_label: getMonthLabel(now),
      })
      await fetchCompletions()
    } catch (e) { console.warn('[Tab6] checklist completion insert failed:', e) }
  }

  function handleNotesChange(id: string, notes: string) {
    setItems(prev => prev.map(i => i.id === id ? { ...i, notes } : i))
  }

  async function generateSummary() {
    setSummaryLoading(true)
    const ctx = getSummaryContext()
    const pendingCount = items.filter(i => !i.checked).length
    const completedCount = completions.length
    const text = await fetchInsight(
      'You are a senior business advisor for Power On Hub, an electrical contractor operations AI platform. Be executive-level: precise, forward-looking, and actionable. No fluff.',
      `Platform context: ${ctx}
Beta status: 6 invitees, early beta, no MRR yet. IP filed. 15 agents live. 6 industries scoped.
Checklist: ${pendingCount} open items, ${completedCount} completed since April 6 2026.

Generate:
1. EXECUTIVE SUMMARY (2-3 sentences): Where does the platform stand today?
2. WHAT IS WORKING (2-3 bullets): strongest signals
3. NEEDS ATTENTION (2-3 bullets): highest-risk gaps right now
4. THIS WEEK (3 items): most critical actions
5. THIS MONTH (3 items): key milestones to hit
6. NEXT 90 DAYS (3 items): the build/GTM moves that change trajectory
7. PROJECTED OUTCOME: If all 90-day steps complete, describe platform state in one sentence.

Format as plain text with these exact section labels.`
    )
    setSummary(text)
    setSummaryLoading(false)
  }

  useEffect(() => { generateSummary() }, [])

  const filteredCompletions = completions.filter(c => {
    const d = (c.completed_at || '').split('T')[0]
    return d >= filterStart && d <= filterEnd
  })

  function exportCompletionsCSV() {
    const cols = ['id', 'title', 'category', 'notes', 'completed_at', 'week_label', 'month_label']
    const rows = filteredCompletions.map(c => cols.map(k => JSON.stringify(c[k] ?? '')).join(','))
    const blob = new Blob([[cols.join(','), ...rows].join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url
    a.download = `checklist_completions_${filterStart}_${filterEnd}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  function exportCompletionsPDF() {
    const win = window.open('', '_blank')
    if (!win) return
    const rows = filteredCompletions.map(c =>
      `<tr><td>${c.title}</td><td>${c.category}</td><td>${c.completed_at ? new Date(c.completed_at).toLocaleString() : ''}</td><td>${c.notes || ''}</td></tr>`
    ).join('')
    win.document.write(`<html><head><title>Checklist Completions</title><style>
      body{font-family:sans-serif;font-size:12px;padding:20px}
      table{width:100%;border-collapse:collapse}
      th,td{border:1px solid #ccc;padding:6px 10px;text-align:left}
      th{background:#f3f4f6;font-weight:700}
      h2{margin-bottom:4px}p{margin:0 0 16px;color:#666}
    </style></head><body>
      <h2>Checklist Completions</h2>
      <p>Period: ${filterStart} → ${filterEnd} · ${filteredCompletions.length} items</p>
      <table><thead><tr><th>Title</th><th>Category</th><th>Completed At</th><th>Notes</th></tr></thead>
      <tbody>${rows}</tbody></table>
    </body></html>`)
    win.document.close()
    win.print()
  }

  const activeItems = items.filter(i => !i.checked)
  const checkedLocally = items.filter(i => i.checked)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Voice Hub reminder banner */}
      {!dismissed && voiceCaptures > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          backgroundColor: '#1c1f2e', border: '1px solid #4f46e5', borderRadius: 10,
          padding: '12px 16px', gap: 12,
        }}>
          <span style={{ fontSize: 13, color: '#c7d2fe' }}>
            🎙 You have <strong style={{ color: '#a5b4fc' }}>{voiceCaptures} voice capture{voiceCaptures !== 1 ? 's' : ''}</strong> from the last 24 hours that may contain improvement ideas. Review them in Voice Hub.
          </span>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button
              style={{ fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 6, border: '1px solid #6366f1', backgroundColor: '#4f46e5', color: '#fff', cursor: 'pointer' }}
              onClick={() => { /* navigate to voice hub — handled by sidebar */ }}
            >
              Go to Voice Hub
            </button>
            <button
              style={{ fontSize: 11, color: '#6b7280', background: 'transparent', border: 'none', cursor: 'pointer', padding: '5px 8px' }}
              onClick={() => {
                setDismissed(true)
                try { localStorage.setItem(CHECKLIST_DISMISS_KEY, '1') } catch {}
              }}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* AI Summary */}
      <div style={{ backgroundColor: '#0f172a', border: '1px solid #3b82f655', borderRadius: 12, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 4, height: 24, backgroundColor: '#3b82f6', borderRadius: 2 }} />
            <div>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: '#bfdbfe', margin: 0 }}>Platform Summary</h3>
              <p style={{ fontSize: 11, color: '#60a5fa', margin: 0 }}>AI-generated cross-tab executive brief</p>
            </div>
          </div>
          <button
            onClick={generateSummary}
            disabled={summaryLoading}
            style={{
              fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 8,
              border: '1px solid #3b82f666', backgroundColor: 'transparent', color: '#60a5fa',
              cursor: summaryLoading ? 'not-allowed' : 'pointer', opacity: summaryLoading ? 0.6 : 1,
            }}
          >
            {summaryLoading ? 'Generating…' : '↺ Regenerate'}
          </button>
        </div>
        <div style={{
          fontSize: 13, lineHeight: 1.75, color: '#d1d5db', whiteSpace: 'pre-wrap',
          backgroundColor: '#111827', borderRadius: 8, padding: '14px 16px', minHeight: 80,
        }}>
          {summaryLoading ? '⏳ Generating executive summary…' : (summary || 'Click Regenerate to generate summary.')}
        </div>
      </div>

      {/* Active checklist */}
      <div style={{ backgroundColor: '#0f172a', border: '1px solid #16a34a55', borderRadius: 12, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{ width: 4, height: 24, backgroundColor: '#16a34a', borderRadius: 2 }} />
          <div>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: '#bbf7d0', margin: 0 }}>Actionable Checklist</h3>
            <p style={{ fontSize: 11, color: '#4ade80', margin: 0 }}>{activeItems.length} open · Check to log completion permanently</p>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {activeItems.map(item => (
            <div key={item.id} style={{
              backgroundColor: '#111827', border: '1px solid #1e3a2f', borderRadius: 8, padding: '12px 14px',
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <input
                  type="checkbox"
                  checked={item.checked}
                  onChange={() => handleCheck(item.id)}
                  style={{ marginTop: 2, width: 16, height: 16, cursor: 'pointer', accentColor: '#16a34a' }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{item.title}</span>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
                      backgroundColor: (CATEGORY_CHIP_COLORS[item.category] || '#6b7280') + '22',
                      color: CATEGORY_CHIP_COLORS[item.category] || '#6b7280',
                      border: `1px solid ${(CATEGORY_CHIP_COLORS[item.category] || '#6b7280')}44`,
                    }}>
                      {item.category}
                    </span>
                    {item.dueDate && (
                      <span style={{ fontSize: 11, color: '#9ca3af' }}>Due: {item.dueDate}</span>
                    )}
                  </div>
                  <input
                    type="text"
                    value={item.notes}
                    placeholder="Add notes…"
                    onChange={e => handleNotesChange(item.id, e.target.value)}
                    style={{
                      width: '100%', fontSize: 12, color: '#9ca3af', backgroundColor: '#0f172a',
                      border: '1px solid #1e2d3d', borderRadius: 5, padding: '4px 8px',
                      outline: 'none', boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Completed items */}
      <div style={{ backgroundColor: '#0f172a', border: '1px solid #374151', borderRadius: 12, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 4, height: 24, backgroundColor: '#6b7280', borderRadius: 2 }} />
            <div>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: '#d1d5db', margin: 0 }}>Completed Items</h3>
              <p style={{ fontSize: 11, color: '#6b7280', margin: 0 }}>Permanent record from April 6 2026 · never deleted</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input type="date" value={filterStart} onChange={e => setFilterStart(e.target.value)}
              style={{ fontSize: 12, backgroundColor: '#111827', color: '#d1d5db', border: '1px solid #374151', borderRadius: 5, padding: '4px 8px' }} />
            <span style={{ fontSize: 12, color: '#6b7280' }}>→</span>
            <input type="date" value={filterEnd} onChange={e => setFilterEnd(e.target.value)}
              style={{ fontSize: 12, backgroundColor: '#111827', color: '#d1d5db', border: '1px solid #374151', borderRadius: 5, padding: '4px 8px' }} />
            <button onClick={exportCompletionsCSV}
              style={{ fontSize: 11, fontWeight: 600, padding: '4px 12px', borderRadius: 6, border: '1px solid #374151', backgroundColor: '#1f2937', color: '#9ca3af', cursor: 'pointer' }}>
              CSV
            </button>
            <button onClick={exportCompletionsPDF}
              style={{ fontSize: 11, fontWeight: 600, padding: '4px 12px', borderRadius: 6, border: '1px solid #374151', backgroundColor: '#1f2937', color: '#9ca3af', cursor: 'pointer' }}>
              PDF
            </button>
          </div>
        </div>
        {completionsLoading ? (
          <p style={{ fontSize: 13, color: '#6b7280' }}>Loading completions…</p>
        ) : filteredCompletions.length === 0 ? (
          <p style={{ fontSize: 13, color: '#4b5563' }}>No completions in this date range yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filteredCompletions.map(c => (
              <div key={c.id} style={{
                backgroundColor: '#111827', border: '1px solid #1a2a1e', borderRadius: 8, padding: '10px 14px',
                display: 'flex', alignItems: 'center', gap: 12,
              }}>
                <span style={{ fontSize: 14, color: '#4ade80' }}>✓</span>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, color: '#d1d5db', fontWeight: 600 }}>{c.title}</span>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
                      backgroundColor: (CATEGORY_CHIP_COLORS[c.category] || '#6b7280') + '22',
                      color: CATEGORY_CHIP_COLORS[c.category] || '#6b7280',
                    }}>{c.category}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 12, marginTop: 2 }}>
                    <span style={{ fontSize: 11, color: '#6b7280' }}>
                      {c.completed_at ? new Date(c.completed_at).toLocaleString() : ''}
                    </span>
                    {c.week_label && <span style={{ fontSize: 11, color: '#4b5563' }}>{c.week_label}</span>}
                    {c.notes && <span style={{ fontSize: 11, color: '#9ca3af' }}>{c.notes}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── B42 Feature 5 — Values Profile ────────────────────────────────── */}
      <ValuesProfilePanel />

    </div>
  )
}

// ─── B42 Feature 5 — Values Profile Panel ────────────────────────────────────
const VALUES_STORAGE_KEY_CC = 'poweron_values_profile'

function ValuesProfilePanel() {
  const [profile, setProfile] = React.useState({
    communityImpact:        'Medium' as 'Low' | 'Medium' | 'High',
    relationshipOverTx:     true,
    longTermTrust:          true,
    physicalSustainability: 'Medium' as 'Low' | 'Medium' | 'High',
    customValues:           [] as string[],
  })
  const [newCustomValue, setNewCustomValue] = React.useState('')
  const [saved, setSaved] = React.useState(false)

  React.useEffect(() => {
    try { const stored = localStorage.getItem(VALUES_STORAGE_KEY_CC); if (stored) setProfile(JSON.parse(stored)) } catch {}
  }, [])

  const save = () => {
    try { localStorage.setItem(VALUES_STORAGE_KEY_CC, JSON.stringify(profile)); setSaved(true); setTimeout(() => setSaved(false), 2200) } catch {}
  }
  const addCustom = () => {
    if (!newCustomValue.trim() || profile.customValues.length >= 10) return
    setProfile((p) => ({ ...p, customValues: [...p.customValues, newCustomValue.trim()] })); setNewCustomValue('')
  }
  const removeCustom = (i: number) => setProfile((p) => ({ ...p, customValues: p.customValues.filter((_, idx) => idx !== i) }))

  const tglStyle = (on: boolean, color = '#7c3aed') => ({ width: 34, height: 18, borderRadius: 9, background: on ? color : 'rgba(255,255,255,0.12)', cursor: 'pointer', position: 'relative' as const, transition: 'background 0.2s', flexShrink: 0 })
  const knobStyle = (on: boolean) => ({ position: 'absolute' as const, top: 3, left: on ? 18 : 3, width: 12, height: 12, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' })
  const optBtn = (active: boolean, clr: string) => ({ flex: 1, padding: '5px 0', borderRadius: 5, fontSize: 10, fontWeight: 700, border: `1px solid ${active ? clr : 'rgba(255,255,255,0.1)'}`, background: active ? clr + '28' : 'transparent', color: active ? clr : '#6b7280', cursor: 'pointer' })

  return (
    <div style={{ backgroundColor: '#0f172a', border: '1px solid rgba(124,58,237,0.3)', borderRadius: 12, padding: 20, marginTop: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <div style={{ width: 4, height: 24, backgroundColor: '#7c3aed', borderRadius: 2 }} />
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#a78bfa', letterSpacing: '0.06em', textTransform: 'uppercase' }}>B42 · Feature 5</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#e2e8f0', marginTop: 1 }}>Values Profile</div>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 1 }}>Read by Claude before all 3× Better step analyses. Conflicts flagged with ⚠️.</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div>
          <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 5 }}>Community Impact Priority</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['Low','Medium','High'] as const).map((opt) => <button key={opt} onClick={() => setProfile((p) => ({ ...p, communityImpact: opt }))} style={optBtn(profile.communityImpact === opt, '#7c3aed')}>{opt}</button>)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 5 }}>Physical &amp; Mental Sustainability</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['Low','Medium','High'] as const).map((opt) => <button key={opt} onClick={() => setProfile((p) => ({ ...p, physicalSustainability: opt }))} style={optBtn(profile.physicalSustainability === opt, '#06b6d4')}>{opt}</button>)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>Relationship Over Transaction</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={tglStyle(profile.relationshipOverTx)} onClick={() => setProfile((p) => ({ ...p, relationshipOverTx: !p.relationshipOverTx }))}><div style={knobStyle(profile.relationshipOverTx)} /></div>
            <span style={{ fontSize: 11, color: profile.relationshipOverTx ? '#a78bfa' : '#6b7280' }}>{profile.relationshipOverTx ? 'Yes — relationships first' : 'No — transactional OK'}</span>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>Long-term Trust Over Short-term Collection</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={tglStyle(profile.longTermTrust)} onClick={() => setProfile((p) => ({ ...p, longTermTrust: !p.longTermTrust }))}><div style={knobStyle(profile.longTermTrust)} /></div>
            <span style={{ fontSize: 11, color: profile.longTermTrust ? '#a78bfa' : '#6b7280' }}>{profile.longTermTrust ? 'Yes — trust first' : 'No — collect first'}</span>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>Custom Values ({profile.customValues.length}/10)</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {profile.customValues.map((v, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 12, background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.3)', color: '#a78bfa', fontSize: 11 }}>
              {v}
              <button onClick={() => removeCustom(i)} style={{ background: 'none', border: 'none', color: '#7c3aed', cursor: 'pointer', padding: 0, lineHeight: 1, fontSize: 13 }}>×</button>
            </div>
          ))}
        </div>
        {profile.customValues.length < 10 && (
          <div style={{ display: 'flex', gap: 6 }}>
            <input value={newCustomValue} onChange={(e) => setNewCustomValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addCustom()} placeholder="Add a custom value…" style={{ flex: 1, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 5, color: '#e2e8f0', fontSize: 11, padding: '5px 8px' }} />
            <button onClick={addCustom} style={{ padding: '5px 14px', borderRadius: 5, background: 'rgba(124,58,237,0.2)', border: '1px solid rgba(124,58,237,0.4)', color: '#a78bfa', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>Add</button>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
        <button onClick={save} style={{ padding: '7px 18px', borderRadius: 6, background: saved ? '#00ff8820' : '#7c3aed', border: saved ? '1px solid #00ff8855' : 'none', color: saved ? '#00ff88' : '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer', letterSpacing: '0.04em', transition: 'all 0.2s' }}>{saved ? '✓ Saved' : 'Save Values Profile'}</button>
      </div>
    </div>
  )
}

// ─── TAB 7 — Scripts + Positioning ────────────────────────────────────────────

type AudienceSection = {
  id: string
  label: string
  icon: string
  accentColor: string
  whatToSay: string
  whatNotToSay: string
  dataToShow: string[]
  readyItems: string[]
  diveDeeper: {
    whyThisAudience: string
    whatTheyCareAbout: string
    objectionsToExpect: string[]
    howToHandle: string[]
  }
}

const AUDIENCE_SECTIONS: AudienceSection[] = [
  {
    id: 'contractors',
    label: 'Independent Contractors',
    icon: '🔧',
    accentColor: '#f59e0b',
    whatToSay: 'You are running a business with no operations team. This AI is your operations team. It knows your jobs, your money, and your compliance — and it talks to you.',
    whatNotToSay: 'Nothing about data licensing, enterprise features, API, or platform vision.',
    dataToShow: ['Pipeline', 'NEXUS voice demo', 'Proactive alerts example'],
    readyItems: ['Phone with app open', 'NEXUS answering a real question about their type of work'],
    diveDeeper: {
      whyThisAudience: 'Independent contractors have zero overhead budget and zero operations staff. Every hour spent on admin is an hour not billed. They feel this pain acutely every day. They are the fastest path to product-market fit because the value proposition is immediate and personal — not organizational or strategic.',
      whatTheyCareAbout: 'Time savings on invoicing, knowing what they are owed right now, not missing a compliance deadline, and looking professional in front of GCs. They do not care about data moats or V7 licensing plays.',
      objectionsToExpect: [
        'I already use QuickBooks / ServiceTitan / Jobber',
        'I don\'t have time to learn another app',
        'Sounds expensive — I run lean',
      ],
      howToHandle: [
        'Those tools don\'t talk to you. NEXUS does. Show the voice demo immediately.',
        'The onboarding is a 15-minute walkthrough. Show them the first screen — it\'s their actual pipeline.',
        'Start with the Solo tier. At $49/mo you save more in one avoided invoice mistake.',
      ],
    },
  },
  {
    id: 'small-org',
    label: 'Small Organizations (2–10 Crew)',
    icon: '👥',
    accentColor: '#34d399',
    whatToSay: 'Your crew can log from the field with their own login. You see everything they do. No more chasing updates.',
    whatNotToSay: 'Nothing about multi-tenant architecture or complex enterprise flows.',
    dataToShow: ['Crew portal', 'Role-based access', 'Field log', 'Project health'],
    readyItems: ['Live demo of crew portal with sample field log entry', 'Show real-time owner visibility of field activity'],
    diveDeeper: {
      whyThisAudience: 'Small organizations have a coordination problem. The owner is doing admin, sales, field oversight, and collections simultaneously. Field staff are not logging consistently. The pain is miscommunication between field and office, and owners making decisions without real data.',
      whatTheyCareAbout: 'Real-time visibility on what the crew is doing. Reducing the back-and-forth texts. Knowing the project health without calling the foreman. Keeping the crew accountable without micromanaging.',
      objectionsToExpect: [
        'My guys won\'t use it',
        'We already use group text / WhatsApp',
        'I don\'t want to pay per seat',
      ],
      howToHandle: [
        'The crew login takes 30 seconds. Show them the field log UI — it\'s 3 taps. Easier than texting.',
        'Group text has no history, no structure, and no visibility for the owner. Show the log vs the text.',
        'Pricing is per org, not per seat at the entry tiers. Show the Growth plan.',
      ],
    },
  },
  {
    id: 'teams',
    label: 'Teams (10+ Crew)',
    icon: '🏗️',
    accentColor: '#60a5fa',
    whatToSay: 'Role-based access means every person sees only their lane. The owner sees everything. Full audit trail.',
    whatNotToSay: 'Do not promise features not yet built (RELAY, NEGOTIATE).',
    dataToShow: ['Multi-user org diagram', 'Audit trail', 'n8n automation overview'],
    readyItems: ['Role hierarchy diagram printed or on screen', 'n8n automation example running live'],
    diveDeeper: {
      whyThisAudience: 'Larger teams need governance. Owners of 10+ person crews are dealing with inconsistent data entry, liability from undocumented decisions, and project managers who need autonomy without unchecked access. This audience sees the platform as an operational control layer.',
      whatTheyCareAbout: 'Who did what and when. Audit trails for liability. Role separation so crew doesn\'t see financials. Automation that reduces coordinator overhead.',
      objectionsToExpect: [
        'We have a system — it\'s painful to switch',
        'How do I know my data is secure?',
        'What happens if the AI makes a mistake?',
      ],
      howToHandle: [
        'Migration is one JSON import. The system reads your existing data shape. Show the import flow.',
        'All data is in your Supabase instance with RLS. You own the database. Show the architecture slide.',
        'NEXUS surfaces recommendations. You make the decision. The AI doesn\'t execute — it advises.',
      ],
    },
  },
  {
    id: 'developers',
    label: 'App Developers',
    icon: '💻',
    accentColor: '#a78bfa',
    whatToSay: 'The platform is built API-first. When the developer ecosystem opens, revenue share is on the table.',
    whatNotToSay: 'Do not give architecture details. No source code discussion.',
    dataToShow: ['Agent system map', 'The 15-agent hierarchy', 'The data layer vision'],
    readyItems: ['Agent hierarchy diagram', 'One-pager on developer ecosystem timeline'],
    diveDeeper: {
      whyThisAudience: 'Developers building vertical SaaS tools for trades are looking for platforms to integrate with or build on top of. They care about APIs, SDKs, and revenue share. They are evaluating whether this is a credible platform or a toy. The agent architecture and data moat story are the proof points.',
      whatTheyCareAbout: 'API stability, documentation, revenue share structure, data access, and whether the founding team can execute. They will probe on architecture decisions.',
      objectionsToExpect: [
        'Is the API public yet?',
        'What\'s the revenue share model?',
        'Why would I build on this vs. building my own?',
      ],
      howToHandle: [
        'Developer API opens with the V5 milestone. Early partners get preferred rate access and co-marketing.',
        'Revenue share details are in negotiation for early partners — express interest now and you\'re in that conversation.',
        'The data moat compounds with every org. Building on PowerOn gives you access to aggregated trade benchmarks at V7.',
      ],
    },
  },
  {
    id: 'lenders',
    label: 'Lenders',
    icon: '🏦',
    accentColor: '#f472b6',
    whatToSay: 'This borrower has real-time pipeline visibility, AR aging tracking, and documented project completion rates. This is not a tradesperson with a spreadsheet.',
    whatNotToSay: 'Do not over-promise on data maturity. Stick to what is live.',
    dataToShow: ['Pipeline', 'Paid', 'Exposure', 'Project health scores', 'CFOT chart'],
    readyItems: ['Printed or exported one-pager with current real numbers'],
    diveDeeper: {
      whyThisAudience: 'Lenders are underwriting risk. Their core problem with contractors is lack of verifiable operational data. A contractor with organized, timestamped, structured operational data is a fundamentally lower risk profile than one with bank statements and a stack of invoices. PowerOn is the credentialing layer for contractor lending.',
      whatTheyCareAbout: 'Revenue velocity, AR aging, project completion rates, cash flow predictability, and consistency of data over time. They want to see trend data, not a snapshot.',
      objectionsToExpect: [
        'How do we know the data isn\'t manipulated?',
        'What\'s the data history period?',
        'Is this auditable?',
      ],
      howToHandle: [
        'All entries are timestamped in Supabase with an audit trail. No backdating. Show the audit log.',
        'Data history starts from first app use. Show the date range on the export.',
        'Every action is logged with a decision record. The audit decisions table is immutable.',
      ],
    },
  },
  {
    id: 'investors',
    label: 'Investors / Angels',
    icon: '📈',
    accentColor: '#fb923c',
    whatToSay: 'Built by a practitioner. IP filed. 15 agents live. 6 industries. Data moat compounds with every org. V7 data licensing is the exit play.',
    whatNotToSay: 'Do not discuss current revenue (zero). Frame around trajectory and moat.',
    dataToShow: ['Blueprint V3 document — Investors tab', 'Scenario sliders live'],
    readyItems: ['Blueprint V3 investor deck open', 'Live scenario sliders showing growth projections'],
    diveDeeper: {
      whyThisAudience: 'Angel investors and early-stage VCs are pattern-matching on founder-market fit, defensibility, and path to scale. The PowerOn story checks all three: a practitioner-founder with 10+ years in the trade, IP filed before beta, a 15-agent architecture that compounds in value with data, and a V7 data licensing exit that is not dependent on consumer scale.',
      whatTheyCareAbout: 'Defensibility (why can\'t a large player replicate this), TAM, exit path, and whether the founder can execute. They will probe on competition and on why now.',
      objectionsToExpect: [
        'ServiceTitan already does this',
        'Why won\'t a large CRM just add this feature?',
        'What\'s the realistic exit path?',
      ],
      howToHandle: [
        'ServiceTitan is a $10B scheduling tool. It doesn\'t have a voice AI operations brain or a data licensing play. Show the NEXUS demo.',
        'The moat is the data, not the features. Aggregated trade operational benchmarks take years of org-level data to build. Features are replicable; a compound data asset is not.',
        'V7 data licensing to lenders and insurers at 200+ orgs. A strategic acquisition by a fintech or insurtech player is the most likely path. Show the Blueprint V3 scenario sliders.',
      ],
    },
  },
  {
    id: 'banks',
    label: 'Banks / Lending Departments',
    icon: '🏛️',
    accentColor: '#38bdf8',
    whatToSay: 'The platform produces the operational data that predicts repayment risk — AR aging, completion rates, revenue velocity. Available as a data licensing contract at 200+ orgs.',
    whatNotToSay: 'Do not discuss individual borrower data without consent. Frame as aggregate + per-org licensed access.',
    dataToShow: ['Blueprint V3 Banks tab'],
    readyItems: ['Blueprint V3 document open to Banks tab', 'Data licensing term sheet draft if available'],
    diveDeeper: {
      whyThisAudience: 'Bank lending departments evaluating commercial contractor portfolios have a chronic data problem: borrowers in the trades are cash-flow volatile, and traditional financial statements lag reality by 30-90 days. PowerOn\'s real-time operational data closes that gap and becomes a risk pricing input.',
      whatTheyCareAbout: 'Regulatory compliance of data sourcing, accuracy of predictive signals, data licensing cost vs. risk reduction value, and whether this is a one-off tool or a scalable data partnership.',
      objectionsToExpect: [
        'We can\'t use unregulated third-party data for underwriting',
        'How many orgs are on the platform right now?',
        'What\'s the cost of a data licensing contract?',
      ],
      howToHandle: [
        'The data is opt-in by the borrower as part of their loan application. It supplements — not replaces — traditional underwriting. Show the consent architecture.',
        'Currently in private beta with 6 organizations. The licensing threshold activates at 200 orgs — we\'re in early conversations now to structure the partnership terms ahead of that milestone.',
        'Data licensing contracts are structured per-org per-month with volume tiers. Term sheet available for review under NDA.',
      ],
    },
  },
]

const OFFER_ANALYSIS = {
  currentValue: 'Pre-revenue, IP filed, working product',
  atFirstMRR: '$0.2M',
  at50Orgs: '$2–5M',
  atV7Platform: '$20–50M+',
  advice: 'Do not take pre-revenue offers below $500K. The trajectory is too steep to sell early.',
}

function AudienceCard({ section }: { section: AudienceSection }) {
  const [open, setOpen] = useState(false)
  const [diveOpen, setDiveOpen] = useState(false)

  return (
    <div style={{
      backgroundColor: '#0f172a', border: `1px solid ${section.accentColor}33`,
      borderRadius: 12, overflow: 'hidden',
    }}>
      {/* Header */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 12,
          padding: '14px 18px', background: 'transparent', border: 'none',
          cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span style={{ fontSize: 20 }}>{section.icon}</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: section.accentColor, flex: 1 }}>{section.label}</span>
        <span style={{ fontSize: 16, color: '#6b7280', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▾</span>
      </button>

      {open && (
        <div style={{ padding: '0 18px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* What to say */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: section.accentColor, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>✅ What to Say</div>
            <p style={{ fontSize: 13, color: '#e2e8f0', lineHeight: 1.65, margin: 0, backgroundColor: '#111827', padding: '10px 14px', borderRadius: 8, borderLeft: `3px solid ${section.accentColor}` }}>
              "{section.whatToSay}"
            </p>
          </div>

          {/* What not to say */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#ef4444', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>🚫 What Not to Say</div>
            <p style={{ fontSize: 13, color: '#fca5a5', lineHeight: 1.65, margin: 0, backgroundColor: '#1a0a0a', padding: '10px 14px', borderRadius: 8, borderLeft: '3px solid #ef4444' }}>
              {section.whatNotToSay}
            </p>
          </div>

          {/* Two-column: data to show + have ready */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#60a5fa', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>📊 Data to Show</div>
              <ul style={{ margin: 0, paddingLeft: 16 }}>
                {section.dataToShow.map((d, i) => (
                  <li key={i} style={{ fontSize: 12, color: '#9ca3af', lineHeight: 1.7 }}>{d}</li>
                ))}
              </ul>
            </div>
            {section.readyItems.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#34d399', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>🎯 Have Ready</div>
                <ul style={{ margin: 0, paddingLeft: 16 }}>
                  {section.readyItems.map((r, i) => (
                    <li key={i} style={{ fontSize: 12, color: '#9ca3af', lineHeight: 1.7 }}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Dive Deeper */}
          <div>
            <button
              onClick={() => setDiveOpen(d => !d)}
              style={{
                fontSize: 12, fontWeight: 600, padding: '7px 14px', borderRadius: 8,
                border: `1px solid ${section.accentColor}55`, backgroundColor: 'transparent',
                color: section.accentColor, cursor: 'pointer',
              }}
            >
              {diveOpen ? '▲ Collapse Full Reasoning' : '▼ Dive Deeper — Full Reasoning'}
            </button>
            {diveOpen && (
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>

                <div style={{ backgroundColor: '#111827', borderRadius: 8, padding: '12px 14px' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>Why This Audience</div>
                  <p style={{ fontSize: 12, color: '#d1d5db', lineHeight: 1.7, margin: 0 }}>{section.diveDeeper.whyThisAudience}</p>
                </div>

                <div style={{ backgroundColor: '#111827', borderRadius: 8, padding: '12px 14px' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#fbbf24', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>What They Care About</div>
                  <p style={{ fontSize: 12, color: '#d1d5db', lineHeight: 1.7, margin: 0 }}>{section.diveDeeper.whatTheyCareAbout}</p>
                </div>

                <div style={{ backgroundColor: '#111827', borderRadius: 8, padding: '12px 14px' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#f87171', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>Objections to Expect</div>
                  {section.diveDeeper.objectionsToExpect.map((obj, i) => (
                    <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
                      <div style={{ flex: 1 }}>
                        <p style={{ fontSize: 12, color: '#fca5a5', margin: '0 0 3px', fontStyle: 'italic' }}>"{obj}"</p>
                        <p style={{ fontSize: 12, color: '#86efac', margin: 0, lineHeight: 1.6 }}>→ {section.diveDeeper.howToHandle[i]}</p>
                      </div>
                    </div>
                  ))}
                </div>

              </div>
            )}
          </div>

        </div>
      )}
    </div>
  )
}

function Tab7ScriptsPositioning() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Header */}
      <div style={{ backgroundColor: '#0f172a', border: '1px solid #7c3aed55', borderRadius: 12, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <div style={{ width: 4, height: 24, backgroundColor: '#7c3aed', borderRadius: 2 }} />
          <div>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: '#e9d5ff', margin: 0 }}>Scripts + Positioning</h3>
            <p style={{ fontSize: 11, color: '#a78bfa', margin: 0 }}>Audience-specific messaging, objections, and data to show</p>
          </div>
        </div>
        <p style={{ fontSize: 13, color: '#9ca3af', lineHeight: 1.6, margin: 0 }}>
          Expand each audience section to see the exact script, what to avoid, which data to show, and the full reasoning behind each positioning approach.
        </p>
      </div>

      {/* Audience sections */}
      {AUDIENCE_SECTIONS.map(section => (
        <AudienceCard key={section.id} section={section} />
      ))}

      {/* Offer analysis */}
      <div style={{ backgroundColor: '#0f172a', border: '1px solid #f59e0b55', borderRadius: 12, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{ width: 4, height: 24, backgroundColor: '#f59e0b', borderRadius: 2 }} />
          <div>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: '#fef3c7', margin: 0 }}>Offer Analysis</h3>
            <p style={{ fontSize: 11, color: '#fbbf24', margin: 0 }}>If you receive an offer before hitting milestones</p>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
          {[
            { label: 'Current Estimated Value', value: OFFER_ANALYSIS.currentValue, color: '#9ca3af' },
            { label: 'At First MRR', value: OFFER_ANALYSIS.atFirstMRR, color: '#34d399' },
            { label: 'At 50 Orgs + Data Licensing', value: OFFER_ANALYSIS.at50Orgs, color: '#60a5fa' },
            { label: 'At V7 Full Platform', value: OFFER_ANALYSIS.atV7Platform, color: '#f59e0b' },
          ].map((item, i) => (
            <div key={i} style={{ backgroundColor: '#111827', border: `1px solid ${item.color}33`, borderRadius: 8, padding: '12px 14px' }}>
              <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>{item.label}</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: item.color }}>{item.value}</div>
            </div>
          ))}
        </div>
        <div style={{ backgroundColor: '#1c1307', border: '1px solid #f59e0b44', borderRadius: 8, padding: '12px 16px' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#fbbf24' }}>⚠ Advisory: </span>
          <span style={{ fontSize: 13, color: '#fde68a', lineHeight: 1.65 }}>{OFFER_ANALYSIS.advice}</span>
        </div>
      </div>

    </div>
  )
}

// ─── TAB 8 — AI Agent Organization ───────────────────────────────────────────

const CURRENT_AGENTS = [
  { name: 'NEXUS',    role: 'Orchestration / Query Routing',    efficiency: 92, quality: 88, lastActive: '2026-04-07', wiring: 'full' },
  { name: 'GUARDIAN', role: 'Project Health Monitor',           efficiency: 78, quality: 82, lastActive: '2026-04-06', wiring: 'full' },
  { name: 'SPARK',    role: 'Live Call Intelligence',           efficiency: 85, quality: 90, lastActive: '2026-04-07', wiring: 'full' },
  { name: 'HUNTER',   role: 'Lead Hunting / Pipeline Intel',    efficiency: 20, quality: 45, lastActive: '—',          wiring: 'planned' },
  { name: 'VAULT',    role: 'Financial Vault / Payment Track',  efficiency: 70, quality: 75, lastActive: '2026-04-05', wiring: 'partial' },
  { name: 'OHM',      role: 'NEC Code Compliance Advisor',      efficiency: 80, quality: 87, lastActive: '2026-04-06', wiring: 'partial' },
  { name: 'LEDGER',   role: 'Billing / Unbilled Work Tracking', efficiency: 74, quality: 80, lastActive: '2026-04-06', wiring: 'partial' },
  { name: 'BLUEPRINT',role: 'Blueprint Doc Analysis AI',        efficiency: 68, quality: 83, lastActive: '2026-04-04', wiring: 'partial' },
  { name: 'CHRONO',   role: 'Scheduling / Calendar Intel',      efficiency: 60, quality: 72, lastActive: '2026-04-03', wiring: 'partial' },
  { name: 'ATLAS',    role: 'Map / Location Intelligence',      efficiency: 35, quality: 55, lastActive: '2026-04-01', wiring: 'planned' },
  { name: 'ECHO',     role: 'Context Window / Memory',          efficiency: 88, quality: 91, lastActive: '2026-04-07', wiring: 'full' },
  { name: 'FORGE',    role: 'Estimating / Material Takeoff',    efficiency: 72, quality: 78, lastActive: '2026-04-05', wiring: 'partial' },
  { name: 'SENTINEL', role: 'Collections Queue Monitor',        efficiency: 65, quality: 70, lastActive: '2026-04-04', wiring: 'partial' },
  { name: 'HERALD',   role: 'Notifications / Alerts Delivery',  efficiency: 55, quality: 68, lastActive: '2026-04-02', wiring: 'planned' },
  { name: 'CREW',     role: 'Crew / Team Coordination',         efficiency: 62, quality: 74, lastActive: '2026-04-05', wiring: 'partial' },
]

const NEW_AGENT_SUGGESTIONS = [
  {
    name: 'IRIS',
    role: 'Visual Inspection AI',
    problem: 'Contractors photo job sites daily but no AI analyzes photos for defects, permit compliance, or safety issues.',
    tier: 'Intelligence',
    vVersion: 'V4',
    revenueImpact: 'High — reduces rework cost, premium feature upsell',
    detail: 'IRIS would process field photos through vision models, flagging code violations, safety hazards, or missed work items. Integrates with GUARDIAN for automatic alert creation and BLUEPRINT for project-context matching.',
  },
  {
    name: 'PERMIT',
    role: 'Permit Tracking & Compliance',
    problem: 'Permit status is manually tracked in spreadsheets. Missed inspections cause project delays and fines.',
    tier: 'Business',
    vVersion: 'V4',
    revenueImpact: 'Medium — compliance value prevents costly delays',
    detail: 'PERMIT watches permit status across jurisdiction portals, sends inspection reminders, and flags expiring permits. Connects with CHRONO for scheduling and GUARDIAN for violation alerts.',
  },
  {
    name: 'SAGE',
    role: 'Tax & Financial Advisory',
    problem: 'Contractor owners miss quarterly tax events, depreciation opportunities, and deductible categories.',
    tier: 'Business',
    vVersion: 'V5',
    revenueImpact: 'High — direct ROI visible to owner',
    detail: 'SAGE analyzes expense patterns, flags likely deductions, and estimates quarterly tax liability in real time. Coordinates with LEDGER and VAULT for full financial picture.',
  },
  {
    name: 'PULSE',
    role: 'Real-Time Job Cost Tracker',
    problem: 'Job cost vs. estimate variance is only visible at project close — no mid-project warning system.',
    tier: 'Intelligence',
    vVersion: 'V4',
    revenueImpact: 'High — directly protects margins on every job',
    detail: 'PULSE monitors labor hours, material purchases, and change order history to project final cost vs. original estimate. Fires alerts when jobs trend 10%+ over estimate.',
  },
  {
    name: 'ORACLE',
    role: 'Predictive Analytics Engine',
    problem: 'No forward-looking revenue forecasting based on pipeline + historical close rates.',
    tier: 'Intelligence',
    vVersion: 'V5',
    revenueImpact: 'High — investor-grade feature for enterprise tier',
    detail: 'ORACLE uses historical win rates, seasonal patterns, and current pipeline to project 90-day revenue. Generates weekly forecast cards and trend alerts.',
  },
  {
    name: 'CODEX',
    role: 'Building Code Library Agent',
    problem: 'OHM covers NEC but not local amendments, energy codes, or ADA requirements across jurisdictions.',
    tier: 'Intelligence',
    vVersion: 'V5',
    revenueImpact: 'Medium — compliance depth differentiator',
    detail: 'CODEX maintains a jurisdiction-aware code library, answering questions about local amendments, energy codes, and fire code requirements. NEXUS routes non-NEC code queries here.',
  },
  {
    name: 'RELAY',
    role: 'Client Communication Automation',
    problem: 'Client updates are manual — no automated job status emails, estimate follow-ups, or invoice reminders.',
    tier: 'Business',
    vVersion: 'V4',
    revenueImpact: 'High — reduces admin hours, improves collections',
    detail: 'RELAY drafts and schedules client-facing communication — job start/completion notices, estimate follow-ups, invoice reminders, and satisfaction check-ins — using SPARK and HERALD data.',
  },
  {
    name: 'SCOUT',
    role: 'Competitive Intelligence',
    problem: 'No visibility into competitor pricing, service area changes, or review patterns.',
    tier: 'Intelligence',
    vVersion: 'V6',
    revenueImpact: 'Medium — positioning and pricing decisions',
    detail: 'SCOUT monitors public review platforms and bidding history to identify competitor rate changes and service area expansion, feeding into pricing strategy recommendations.',
  },
  {
    name: 'TITAN',
    role: 'Enterprise Multi-Org Management',
    problem: 'No tools for managing multiple org accounts from a single admin seat.',
    tier: 'Business',
    vVersion: 'V6',
    revenueImpact: 'Very High — unlocks franchise and multi-location enterprise tier',
    detail: 'TITAN provides aggregated dashboards, cross-org benchmarking, and bulk policy management for enterprise customers running 3+ locations. Prerequisite for $500+/mo tier.',
  },
  {
    name: 'EMBER',
    role: 'Invoice Automation Agent',
    problem: 'Invoicing is a manual process; contractors lose revenue to slow billing cycles.',
    tier: 'Business',
    vVersion: 'V4',
    revenueImpact: 'High — accelerates cash collection directly',
    detail: 'EMBER auto-generates invoices from completed work logs, matches against estimates, applies correct line items, and pushes to QuickBooks or Stripe. Coordinates with LEDGER.',
  },
  {
    name: 'FLEET',
    role: 'Vehicle & Equipment Tracking',
    problem: 'Fuel costs, maintenance schedules, and vehicle utilization are untracked beyond basic mileage.',
    tier: 'Business',
    vVersion: 'V5',
    revenueImpact: 'Medium — overhead reduction and fleet ROI',
    detail: 'FLEET tracks vehicle costs, maintenance due dates, and job site routing efficiency. Connects vehicle overhead to specific jobs for accurate cost allocation.',
  },
  {
    name: 'LINK',
    role: 'Supplier & Vendor Coordination',
    problem: 'Material ordering is manual with no vendor comparison, backorder alerts, or bulk discount tracking.',
    tier: 'Business',
    vVersion: 'V5',
    revenueImpact: 'Medium — direct cost reduction on materials',
    detail: 'LINK connects to distributor APIs to compare pricing, check availability, and flag substitutes when items are backordered. Works with FORGE for MTO-driven purchasing.',
  },
  {
    name: 'BADGE',
    role: 'Licensing & Certification Tracker',
    problem: 'License expiration, continuing education deadlines, and worker certifications are tracked manually.',
    tier: 'Business',
    vVersion: 'V4',
    revenueImpact: 'Low-Medium — compliance protection, crew management feature',
    detail: 'BADGE tracks license renewal dates, CE requirements, OSHA certifications, and insurance certificates for both the company and individual crew members. Fires reminders 60/30/7 days out.',
  },
  {
    name: 'MATRIX',
    role: 'Cross-Industry Benchmarking',
    problem: 'No benchmarking against industry averages for labor rates, close rates, or project margins.',
    tier: 'Intelligence',
    vVersion: 'V6',
    revenueImpact: 'High — data licensing foundation, investor narrative',
    detail: 'MATRIX aggregates anonymized performance data across the PowerOn Hub customer base to generate industry benchmarks. Powers the data licensing revenue stream at scale.',
  },
  {
    name: 'MIRROR',
    role: 'AI-Powered Audit & Replay',
    problem: 'When business decisions go wrong there is no tool to replay the data state at that moment.',
    tier: 'Intelligence',
    vVersion: 'V7',
    revenueImpact: 'Medium — enterprise compliance and accountability tier',
    detail: 'MIRROR captures decision snapshots — what data was visible, what AI said, what action was taken — enabling time-travel replay of business decisions for auditing and learning.',
  },
]

const N8N_IMPROVEMENTS = [
  {
    title: 'Lead Capture → SPARK Pipeline',
    current: 'Manual form submission triggers; no deduplication',
    improvement: 'Add webhook dedup layer + auto-route new leads to SPARK queue with context pre-loaded',
    effort: 'Now',
  },
  {
    title: 'Invoice Sent → Collections Watch',
    current: 'Collections queue is manually updated',
    improvement: 'Trigger: invoice sent → start 7-day watch → auto-escalate to SENTINEL if unpaid',
    effort: 'Now',
  },
  {
    title: 'Job Completion → Auto-Invoice',
    current: 'Manual invoice creation after work log close',
    improvement: 'GUARDIAN task_completed event → n8n → EMBER draft invoice → review queue',
    effort: 'V4+',
  },
  {
    title: 'Weekly Snapshot → Supabase',
    current: 'Snapshot sync is manual / on-demand',
    improvement: 'Cron every Sunday midnight → snapshot all org data → push to weekly_snapshots table',
    effort: 'Now',
  },
  {
    title: 'New User Onboarding Sequence',
    current: 'No automated onboarding flow',
    improvement: '5-email drip over 14 days triggered on first login → feature highlights, tip cards',
    effort: 'Now',
  },
]

const NEXT_3_N8N = [
  {
    name: 'Collections Escalation Workflow',
    desc: 'Auto-watch invoices older than 7 days → reminder SMS/email at 14d → flag in SENTINEL at 30d',
    impact: 'Directly improves cash collection rate',
  },
  {
    name: 'Weekly Business Health Digest',
    desc: 'Every Monday 7AM → pull KPIs from Supabase → format digest card → push to GUARDIAN + email to owner',
    impact: 'Reduces manual review time, surfaces hidden patterns',
  },
  {
    name: 'New Org Welcome Sequence',
    desc: 'On org_created event → send welcome email → create onboarding checklist → fire GUARDIAN starter rules',
    impact: 'Reduces time-to-value for new beta customers',
  },
]

function EfficiencyBar({ score, max = 100 }: { score: number; max?: number }) {
  const pct = Math.round((score / max) * 100)
  const color = score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : score >= 40 ? '#f97316' : '#ef4444'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 6, backgroundColor: '#1f2937', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, backgroundColor: color, borderRadius: 4, transition: 'width 0.4s' }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 700, color, minWidth: 28, textAlign: 'right' }}>{score}</span>
    </div>
  )
}

function WiringBadge({ status }: { status: string }) {
  const config = {
    full:    { color: '#10b981', bg: '#10b98120', label: 'FULL' },
    partial: { color: '#f59e0b', bg: '#f59e0b20', label: 'PARTIAL' },
    planned: { color: '#6b7280', bg: '#6b728020', label: 'PLANNED' },
  }[status] ?? { color: '#6b7280', bg: '#6b728020', label: status.toUpperCase() }
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
      backgroundColor: config.bg, color: config.color, letterSpacing: '0.06em',
    }}>
      {config.label}
    </span>
  )
}

function NewAgentCard({ agent }: { agent: typeof NEW_AGENT_SUGGESTIONS[0] }) {
  const [expanded, setExpanded] = useState(false)
  const [diveOpen, setDiveOpen] = useState(false)
  const vColors: Record<string, string> = { V4: '#60a5fa', V5: '#a78bfa', V6: '#f59e0b', V7: '#f87171' }
  const vColor = vColors[agent.vVersion] ?? '#9ca3af'

  return (
    <div style={{
      backgroundColor: '#0f172a',
      border: '1px solid #1e2d3d',
      borderRadius: 10,
      overflow: 'hidden',
    }}>
      <div
        style={{ padding: '14px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12 }}
        onClick={() => setExpanded(e => !e)}
      >
        <div style={{
          width: 36, height: 36, borderRadius: 8, backgroundColor: '#111827',
          border: '1px solid #374151', display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontSize: 14, flexShrink: 0,
        }}>⚡</div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>{agent.name}</span>
            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, backgroundColor: `${vColor}20`, color: vColor }}>{agent.vVersion}</span>
            <span style={{ fontSize: 10, color: '#6b7280', fontWeight: 600 }}>{agent.tier}</span>
          </div>
          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{agent.role}</div>
        </div>
        <span style={{ color: '#4b5563', fontSize: 16 }}>{expanded ? '▲' : '▼'}</span>
      </div>
      {expanded && (
        <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ backgroundColor: '#111827', borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>Problem It Solves</div>
            <p style={{ fontSize: 12, color: '#d1d5db', lineHeight: 1.65, margin: 0 }}>{agent.problem}</p>
          </div>
          <div style={{ backgroundColor: '#111827', borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#10b981', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>Revenue Impact</div>
            <p style={{ fontSize: 12, color: '#d1d5db', lineHeight: 1.65, margin: 0 }}>{agent.revenueImpact}</p>
          </div>
          <button
            onClick={() => setDiveOpen(d => !d)}
            style={{
              alignSelf: 'flex-start', fontSize: 11, fontWeight: 600, padding: '6px 12px',
              borderRadius: 7, border: `1px solid ${vColor}55`, backgroundColor: 'transparent',
              color: vColor, cursor: 'pointer',
            }}
          >
            {diveOpen ? '▲ Collapse' : '▼ Dive Deeper'}
          </button>
          {diveOpen && (
            <div style={{ backgroundColor: '#0a0f1a', borderRadius: 8, padding: '12px 14px', border: `1px solid ${vColor}33` }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: vColor, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>Full Build Detail</div>
              <p style={{ fontSize: 12, color: '#d1d5db', lineHeight: 1.7, margin: 0 }}>{agent.detail}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Tab8AIAgentOrganization() {
  const [sortField, setSortField] = useState<'efficiency' | 'quality' | 'name'>('efficiency')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [improvementInsight, setImprovementInsight] = useState('')
  const [improvementLoading, setImprovementLoading] = useState(false)
  const [founderInsight, setFounderInsight] = useState('')
  const [founderLoading, setFounderLoading] = useState(false)

  const sorted = [...CURRENT_AGENTS].sort((a, b) => {
    const av = sortField === 'name' ? a.name : a[sortField]
    const bv = sortField === 'name' ? b.name : b[sortField]
    if (av < bv) return sortDir === 'asc' ? -1 : 1
    if (av > bv) return sortDir === 'asc' ? 1 : -1
    return 0
  })

  function toggleSort(field: typeof sortField) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('desc') }
  }

  async function loadImprovementInsight() {
    setImprovementLoading(true)
    const agentList = CURRENT_AGENTS.map(a => `${a.name} (${a.role}, wiring: ${a.wiring}, efficiency: ${a.efficiency}%)`).join('\n')
    const result = await fetchInsight(
      'You are an AI systems architect analyzing agents for a contractor operations platform called PowerOn Hub.',
      `Analyze these 15 agents and for each identify: (1) a key skill currently missing, (2) data it should be reading that it isn't, (3) one agent it should coordinate with more. Format as a concise markdown-like list. Keep each agent to 2-3 lines.\n\nAgents:\n${agentList}`,
    )
    setImprovementInsight(result)
    setImprovementLoading(false)
  }

  async function loadFounderInsight() {
    setFounderLoading(true)
    const ctx = getSummaryContext()
    const result = await fetchInsight(
      'You are an experienced founder who has successfully scaled a contractor AI platform to $10M ARR and is now advising the early-stage PowerOn Hub team. Speak candidly.',
      `Context: ${ctx}. We have 15 agents, V3 deployed, 6 beta orgs, aiming for 50 orgs by Q4 2026 and data licensing by 2027. From your vantage point: what would you prioritize differently right now? What would you automate immediately? What would you NOT build yet? What one partnership would you pursue first? Be specific and direct.`,
    )
    setFounderInsight(result)
    setFounderLoading(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* Header */}
      <div style={{ backgroundColor: '#0f172a', border: '1px solid #3b82f655', borderRadius: 12, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <div style={{ width: 4, height: 24, backgroundColor: '#3b82f6', borderRadius: 2 }} />
          <h3 style={{ fontSize: 15, fontWeight: 700, color: '#bfdbfe', margin: 0 }}>AI Agent Organization</h3>
        </div>
        <p style={{ fontSize: 13, color: '#9ca3af', lineHeight: 1.6, margin: 0 }}>
          Full inventory of current agents, improvement analysis, new agent roadmap, n8n process optimization, and founder-perspective strategy.
        </p>
      </div>

      {/* SECTION A — Efficiency Map */}
      <div style={{ backgroundColor: '#0f172a', border: '1px solid #1e2d3d', borderRadius: 12, padding: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#60a5fa', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Section A</div>
        <h4 style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', margin: '0 0 12px' }}>Current 15 Agent Efficiency Map</h4>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #1e2d3d' }}>
                {[
                  { key: 'name',       label: 'Agent' },
                  { key: 'role',       label: 'Role' },
                  { key: 'efficiency', label: 'Efficiency' },
                  { key: 'quality',    label: 'Output Quality' },
                  { key: 'lastActive', label: 'Last Active' },
                  { key: 'wiring',     label: 'Wiring' },
                ].map(col => (
                  <th
                    key={col.key}
                    onClick={() => ['name', 'efficiency', 'quality'].includes(col.key) ? toggleSort(col.key as any) : null}
                    style={{
                      textAlign: 'left', padding: '8px 10px', color: '#6b7280', fontWeight: 600,
                      cursor: ['name', 'efficiency', 'quality'].includes(col.key) ? 'pointer' : 'default',
                      userSelect: 'none',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {col.label}{sortField === col.key ? (sortDir === 'desc' ? ' ▼' : ' ▲') : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((agent, i) => (
                <tr key={agent.name} style={{ borderBottom: '1px solid #111827', backgroundColor: i % 2 === 0 ? 'transparent' : '#080d14' }}>
                  <td style={{ padding: '10px 10px', fontWeight: 700, color: '#e2e8f0', whiteSpace: 'nowrap' }}>{agent.name}</td>
                  <td style={{ padding: '10px 10px', color: '#9ca3af', fontSize: 11 }}>{agent.role}</td>
                  <td style={{ padding: '10px 10px', minWidth: 120 }}><EfficiencyBar score={agent.efficiency} /></td>
                  <td style={{ padding: '10px 10px', minWidth: 120 }}><EfficiencyBar score={agent.quality} /></td>
                  <td style={{ padding: '10px 10px', color: '#6b7280', fontSize: 11, whiteSpace: 'nowrap' }}>{agent.lastActive}</td>
                  <td style={{ padding: '10px 10px' }}><WiringBadge status={agent.wiring} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* SECTION B — Improvement Analysis */}
      <div style={{ backgroundColor: '#0f172a', border: '1px solid #1e2d3d', borderRadius: 12, padding: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Section B</div>
        <h4 style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', margin: '0 0 8px' }}>Agent Improvement Analysis</h4>
        <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 12px', lineHeight: 1.6 }}>
          Claude analyzes all 15 agents — missing skills, unread data sources, and coordination gaps.
        </p>
        {!improvementInsight && !improvementLoading && (
          <button
            onClick={loadImprovementInsight}
            style={{
              fontSize: 12, fontWeight: 600, padding: '8px 16px', borderRadius: 8,
              border: '1px solid #a78bfa55', backgroundColor: 'transparent',
              color: '#a78bfa', cursor: 'pointer',
            }}
          >
            ⚡ Run Agent Analysis
          </button>
        )}
        {(improvementInsight || improvementLoading) && (
          <InsightCard
            title="Agent Improvement Analysis"
            accent="#a78bfa"
            insight={improvementInsight}
            loading={improvementLoading}
            onRegenerate={loadImprovementInsight}
          />
        )}
      </div>

      {/* SECTION C — 15 New Agent Suggestions */}
      <div style={{ backgroundColor: '#0f172a', border: '1px solid #1e2d3d', borderRadius: 12, padding: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#10b981', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Section C</div>
        <h4 style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', margin: '0 0 4px' }}>15 New Agent Suggestions</h4>
        <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 16px', lineHeight: 1.6 }}>
          Agents beyond the current 15 — V4 through V7 scope. Click to expand, Dive Deeper for full build reasoning.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {NEW_AGENT_SUGGESTIONS.map(agent => (
            <NewAgentCard key={agent.name} agent={agent} />
          ))}
        </div>
      </div>

      {/* SECTION D — n8n Process Improvement */}
      <div style={{ backgroundColor: '#0f172a', border: '1px solid #1e2d3d', borderRadius: 12, padding: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Section D</div>
        <h4 style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', margin: '0 0 16px' }}>n8n Process Improvement</h4>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
          {N8N_IMPROVEMENTS.map((item, i) => (
            <div key={i} style={{ backgroundColor: '#111827', borderRadius: 8, padding: '12px 14px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <span style={{
                fontSize: 9, fontWeight: 700, padding: '3px 7px', borderRadius: 4, flexShrink: 0, marginTop: 2,
                backgroundColor: item.effort === 'Now' ? '#10b98120' : '#3b82f620',
                color: item.effort === 'Now' ? '#10b981' : '#60a5fa',
              }}>{item.effort}</span>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0', marginBottom: 3 }}>{item.title}</div>
                <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 3 }}>Current: {item.current}</div>
                <div style={{ fontSize: 11, color: '#d1d5db' }}>{item.improvement}</div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ borderTop: '1px solid #1e2d3d', paddingTop: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 12 }}>
            Recommended Next 3 n8n Workflows to Build
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
            {NEXT_3_N8N.map((w, i) => (
              <div key={i} style={{ backgroundColor: '#111827', borderRadius: 8, padding: '12px 14px', border: '1px solid #f59e0b22' }}>
                <div style={{ fontSize: 10, color: '#f59e0b', fontWeight: 700, marginBottom: 6 }}>#{i + 1}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#fde68a', marginBottom: 6 }}>{w.name}</div>
                <div style={{ fontSize: 11, color: '#9ca3af', lineHeight: 1.6, marginBottom: 6 }}>{w.desc}</div>
                <div style={{ fontSize: 11, color: '#10b981', fontStyle: 'italic' }}>Impact: {w.impact}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* SECTION E — Experienced Founder Lens */}
      <div style={{ backgroundColor: '#0f172a', border: '1px solid #ef444455', borderRadius: 12, padding: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#f87171', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Section E — Forward-Looking Strategic Perspective</div>
        <h4 style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', margin: '0 0 4px' }}>The Experienced Founder Lens</h4>
        <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 12px', lineHeight: 1.6 }}>
          Perspective from someone who has successfully scaled a contractor AI platform. What they would prioritize, automate, avoid, and pursue first.
          <span style={{ color: '#ef4444', fontStyle: 'italic' }}> This section reflects forward-looking strategic opinion, not current state facts.</span>
        </p>
        {!founderInsight && !founderLoading && (
          <button
            onClick={loadFounderInsight}
            style={{
              fontSize: 12, fontWeight: 600, padding: '8px 16px', borderRadius: 8,
              border: '1px solid #f8717155', backgroundColor: 'transparent',
              color: '#f87171', cursor: 'pointer',
            }}
          >
            ⚡ Generate Founder Perspective
          </button>
        )}
        {(founderInsight || founderLoading) && (
          <InsightCard
            title="Experienced Founder Lens"
            accent="#f87171"
            insight={founderInsight}
            loading={founderLoading}
            onRegenerate={loadFounderInsight}
          />
        )}
      </div>

    </div>
  )
}

// ─── TAB 9 — Industry Analysis ────────────────────────────────────────────────

const CURRENT_INDUSTRIES = [
  {
    name: 'Electrical',
    icon: '⚡',
    completeness: 95,
    marketSize: '$28B',
    missingFeatures: ['Permit auto-filing integration', 'NEC code version selector', 'Utility interconnect workflow'],
    revenueAt50: '$47,500/mo',
    color: '#f59e0b',
  },
  {
    name: 'Plumbing',
    icon: '🔧',
    completeness: 55,
    marketSize: '$14B',
    missingFeatures: ['Fixture-specific estimating line items', 'Inspection schedule integration', 'Water pressure/flow calculation tools'],
    revenueAt50: '$23,750/mo',
    color: '#60a5fa',
  },
  {
    name: 'General Contractor',
    icon: '🏗️',
    completeness: 45,
    marketSize: '$45B',
    missingFeatures: ['Subcontractor bid management', 'Multi-phase project coordination', 'Lien waiver + retainage tracking'],
    revenueAt50: '$42,500/mo',
    color: '#a78bfa',
  },
  {
    name: 'Medical Billing',
    icon: '🏥',
    completeness: 30,
    marketSize: '$5.5B',
    missingFeatures: ['CPT/ICD code database', 'Payer rule engine', 'ERA/EOB parsing and posting'],
    revenueAt50: '$35,000/mo',
    color: '#34d399',
  },
  {
    name: 'Mechanic / Auto',
    icon: '🔩',
    completeness: 40,
    marketSize: '$8.5B',
    missingFeatures: ['VIN lookup + parts catalog', 'Labor time guide integration', 'Multi-vehicle service history'],
    revenueAt50: '$20,000/mo',
    color: '#f87171',
  },
  {
    name: 'Electrical Supplier',
    icon: '📦',
    completeness: 35,
    marketSize: '$12B',
    missingFeatures: ['Inventory / PO management', 'Distributor API integrations', 'Territory rep tracking + deal tracking'],
    revenueAt50: '$27,500/mo',
    color: '#fb923c',
  },
]

const NEW_INDUSTRIES = [
  {
    name: 'HVAC',
    icon: '❄️',
    fitScore: 9,
    buildEffort: 'Low — ~75% feature overlap with Electrical template',
    marketSize: '$18B',
    features: ['Tonnage / BTU estimating calculator', 'Equipment model lookup + warranty tracking', 'Seasonal maintenance scheduling'],
    vVersion: 'V4',
    color: '#60a5fa',
    rationale: 'HVAC contractors have near-identical business workflows to electrical: licensed technicians, permit-required installs, material MTO, service calls. Highest ROI new vertical.',
  },
  {
    name: 'Roofing',
    icon: '🏠',
    fitScore: 8,
    buildEffort: 'Low-Medium — squares/pitch calculation layer needed',
    marketSize: '$22B',
    features: ['Roof area / pitch-to-squares calculator', 'Material waste factor by roof type', 'Storm damage claim workflow'],
    vVersion: 'V4',
    color: '#a78bfa',
    rationale: 'Roofing has strong seasonal demand patterns and insurance-driven sales cycles. Storm season = high volume + high urgency for ops tools.',
  },
  {
    name: 'Landscaping / Irrigation',
    icon: '🌿',
    fitScore: 7,
    buildEffort: 'Medium — zone-based estimating model required',
    marketSize: '$11B',
    features: ['Zone map + irrigation head calculator', 'Recurring maintenance contract billing', 'Seasonal crew scaling tools'],
    vVersion: 'V5',
    color: '#10b981',
    rationale: 'Irrigation aligns well with our n8n automation + recurring billing model. Landscaping contracts create predictable MRR anchor for the platform.',
  },
  {
    name: 'Solar Installation',
    icon: '☀️',
    fitScore: 8,
    buildEffort: 'Medium — the RMO/Income Calc is already built for this',
    marketSize: '$35B',
    features: ['Site assessment + shading analysis', 'Utility incentive + rebate tracker', 'Net metering & interconnect workflow'],
    vVersion: 'V4',
    color: '#f59e0b',
    rationale: 'PowerOn Hub already has a partial Solar RMO calculator. Solar installation has the highest market size of any new vertical and strong permit + utility workflow overlap with Electrical.',
  },
  {
    name: 'Pool Service',
    icon: '🏊',
    fitScore: 6,
    buildEffort: 'Low — maps well to recurring service model',
    marketSize: '$6B',
    features: ['Chemical dosing calculator', 'Route optimization for weekly service', 'Equipment lifecycle + repair log'],
    vVersion: 'V5',
    color: '#38bdf8',
    rationale: 'Pool service is subscription-based (weekly visits), which maps directly to our recurring service log model. Route optimization adds AI differentiator.',
  },
  {
    name: 'Pest Control',
    icon: '🐛',
    fitScore: 6,
    buildEffort: 'Low-Medium — chemical log + EPA compliance layer',
    marketSize: '$9B',
    features: ['Chemical application log (EPA compliance)', 'Recurring treatment schedule manager', 'Infestation photo documentation'],
    vVersion: 'V5',
    color: '#86efac',
    rationale: 'Recurring revenue model + licensed applicator tracking aligns with our compliance and crew management features.',
  },
  {
    name: 'Security Systems',
    icon: '🔐',
    fitScore: 7,
    buildEffort: 'Medium — monitoring contract + UL certification workflows',
    marketSize: '$16B',
    features: ['Panel and zone configuration log', 'UL certification + license tracking', 'Monitoring contract RMR tracking'],
    vVersion: 'V5',
    color: '#c084fc',
    rationale: 'Security integrators are licensed contractors with similar permit and inspection workflows. RMR (recurring monthly revenue) per account creates strong LTV story.',
  },
  {
    name: 'Fire Protection',
    icon: '🔥',
    fitScore: 7,
    buildEffort: 'Medium — NFPA code compliance layer + AHJ tracking',
    marketSize: '$7B',
    features: ['NFPA inspection checklist builder', 'AHJ (Authority Having Jurisdiction) contact tracker', 'Deficiency report + corrective action log'],
    vVersion: 'V5',
    color: '#f87171',
    rationale: 'Fire protection aligns with GUARDIAN\'s compliance monitoring capabilities. Highly regulated, high liability — contractors pay for tools that reduce citation risk.',
  },
  {
    name: 'Painting / Coating',
    icon: '🖌️',
    fitScore: 5,
    buildEffort: 'Low — simple surface area estimating model',
    marketSize: '$4.5B',
    features: ['Surface area estimating by room/surface type', 'Paint quantity calculator with waste factor', 'Color spec + product tracking per project'],
    vVersion: 'V6',
    color: '#fbbf24',
    rationale: 'Lower barrier to entry than technical trades. Useful for smaller operators who lack estimating tools but have less willingness to pay for premium features.',
  },
  {
    name: 'Janitorial / Facilities',
    icon: '🧹',
    fitScore: 4,
    buildEffort: 'Medium — contract-based, multiple-site scheduling model',
    marketSize: '$25B',
    features: ['Facility schedule + checklist builder', 'Supplies ordering + reorder tracking', 'Client site contact management'],
    vVersion: 'V6',
    color: '#9ca3af',
    rationale: 'Large market but lowest technical overlap. Janitorial operators don\'t require permits, inspections, or material takeoffs — core platform features would feel irrelevant.',
  },
]

const NON_FIT_MARKETS = [
  {
    market: 'Healthcare Providers (clinics, hospitals)',
    disqualifiers: ['HIPAA compliance requires certified PHI handling — far beyond current architecture', 'Clinical workflow complexity not addressable by a single operator platform', 'Would require $500K+ in legal/compliance infrastructure'],
  },
  {
    market: 'Real Estate Brokerage',
    disqualifiers: ['MLS integration requires licensed data partnerships', 'Transaction-based model incompatible with our per-org subscription', 'CRM and contract management are a completely different software category'],
  },
  {
    market: 'Restaurant / Food Service',
    disqualifiers: ['No permit, labor licensing, or material estimating overlap', 'POS systems and health code workflows are entirely different problem set', 'Extremely price-sensitive market — low willingness to pay for AI ops tools'],
  },
  {
    market: 'Manufacturing / Industrial',
    disqualifiers: ['ERP-level supply chain complexity exceeds platform scope', 'Multi-site operations require enterprise infrastructure beyond V7 roadmap', 'Requires deep CAD/BOM integration that conflicts with field-service architecture'],
  },
  {
    market: 'Professional Services (law, accounting)',
    disqualifiers: ['Billable time tracking + client matter management is a fully separate category (Clio, PracticePanther)', 'No material, permit, or field labor concept — zero feature overlap', 'High regulatory sensitivity (bar, CPA licensing) creates compliance liability'],
  },
]

const EXPANSION_ROADMAP = [
  { version: 'V4 (Q3 2026)', industries: ['HVAC', 'Roofing', 'Solar Installation'], rationale: 'Highest feature overlap, largest market sizes, fastest time-to-template' },
  { version: 'V5 (Q1 2027)', industries: ['Pool Service', 'Pest Control', 'Security Systems', 'Fire Protection', 'Landscaping'], rationale: 'Recurring revenue models + compliance workflows already in platform' },
  { version: 'V6 (Q3 2027)', industries: ['Painting/Coating', 'Janitorial/Facilities', 'GC (full)', 'Electrical Supplier (full)'], rationale: 'Lower-overlap verticals after platform has hardened multi-industry routing' },
  { version: 'V7 (2028)', industries: ['Medical Billing (rebuilt)', 'International markets', 'Franchise/multi-location'], rationale: 'Requires TITAN agent, compliance layers, and data licensing infrastructure' },
]

function FitScoreBar({ score }: { score: number }) {
  const color = score >= 8 ? '#10b981' : score >= 6 ? '#f59e0b' : '#ef4444'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ flex: 1, height: 5, backgroundColor: '#1f2937', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${score * 10}%`, backgroundColor: color, borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 700, color, minWidth: 20 }}>{score}/10</span>
    </div>
  )
}

function Tab9IndustryAnalysis() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* Header */}
      <div style={{ backgroundColor: '#0f172a', border: '1px solid #10b98155', borderRadius: 12, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <div style={{ width: 4, height: 24, backgroundColor: '#10b981', borderRadius: 2 }} />
          <h3 style={{ fontSize: 15, fontWeight: 700, color: '#a7f3d0', margin: 0 }}>Industry Analysis</h3>
        </div>
        <p style={{ fontSize: 13, color: '#9ca3af', lineHeight: 1.6, margin: 0 }}>
          Current 6 industry verticals vs. 10 new opportunities, honest analysis of where the platform doesn't fit, and a V4–V7 expansion roadmap.
        </p>
      </div>

      {/* SECTION A — Current Industries */}
      <div style={{ backgroundColor: '#0f172a', border: '1px solid #1e2d3d', borderRadius: 12, padding: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#10b981', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Section A</div>
        <h4 style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', margin: '0 0 16px' }}>Current 6 Industries vs. Horizon</h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {CURRENT_INDUSTRIES.map((ind, i) => (
            <div key={i} style={{ backgroundColor: '#111827', borderRadius: 10, padding: '14px 16px', border: `1px solid ${ind.color}22` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <span style={{ fontSize: 18 }}>{ind.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>{ind.name}</div>
                  <div style={{ fontSize: 11, color: '#6b7280' }}>Market size: {ind.marketSize}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 2 }}>Template Completeness</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: ind.color }}>{ind.completeness}%</div>
                </div>
              </div>
              <div style={{ height: 4, backgroundColor: '#1f2937', borderRadius: 3, marginBottom: 10, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${ind.completeness}%`, backgroundColor: ind.color, borderRadius: 3 }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'start' }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#f87171', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Top 3 Missing Features</div>
                  {ind.missingFeatures.map((f, j) => (
                    <div key={j} style={{ fontSize: 11, color: '#9ca3af', lineHeight: 1.7, display: 'flex', gap: 6 }}>
                      <span style={{ color: '#374151' }}>•</span>{f}
                    </div>
                  ))}
                </div>
                <div style={{ backgroundColor: '#0a0f1a', borderRadius: 8, padding: '8px 12px', textAlign: 'center', minWidth: 120 }}>
                  <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 2 }}>Revenue @ 50 orgs</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: ind.color }}>{ind.revenueAt50}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* SECTION B — New Industry Opportunities */}
      <div style={{ backgroundColor: '#0f172a', border: '1px solid #1e2d3d', borderRadius: 12, padding: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#60a5fa', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Section B</div>
        <h4 style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', margin: '0 0 4px' }}>10 New Industry Opportunities</h4>
        <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 16px', lineHeight: 1.6 }}>
          Where the PowerOn Hub architecture fits beyond the current 6 verticals.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
          {NEW_INDUSTRIES.map((ind, i) => {
            const vColors: Record<string, string> = { V4: '#60a5fa', V5: '#a78bfa', V6: '#f59e0b', V7: '#f87171' }
            const vColor = vColors[ind.vVersion] ?? '#9ca3af'
            return (
              <div key={i} style={{ backgroundColor: '#111827', borderRadius: 10, padding: '14px 16px', border: `1px solid ${ind.color}22`, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 18 }}>{ind.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>{ind.name}</span>
                      <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 5px', borderRadius: 3, backgroundColor: `${vColor}20`, color: vColor }}>{ind.vVersion}</span>
                    </div>
                    <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>Market: {ind.marketSize}</div>
                  </div>
                </div>
                <FitScoreBar score={ind.fitScore} />
                <div style={{ fontSize: 11, color: '#6b7280' }}>Build effort: {ind.buildEffort}</div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#60a5fa', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>First 3 Features Needed</div>
                  {ind.features.map((f, j) => (
                    <div key={j} style={{ fontSize: 11, color: '#9ca3af', lineHeight: 1.7, display: 'flex', gap: 6 }}>
                      <span style={{ color: '#374151' }}>•</span>{f}
                    </div>
                  ))}
                </div>
                <div style={{ backgroundColor: '#0a0f1a', borderRadius: 6, padding: '8px 10px', fontSize: 11, color: '#d1d5db', lineHeight: 1.6, fontStyle: 'italic' }}>
                  {ind.rationale}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* SECTION C — Markets Where Platform Does NOT Fit */}
      <div style={{ backgroundColor: '#0f172a', border: '1px solid #ef444455', borderRadius: 12, padding: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#f87171', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Section C</div>
        <h4 style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', margin: '0 0 4px' }}>Markets Where the Platform Does NOT Fit</h4>
        <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 16px', lineHeight: 1.6 }}>
          Honest analysis of where attempting to expand would require rebuilding the platform rather than extending it.
          <span style={{ color: '#ef4444', fontStyle: 'italic' }}> This section builds investor credibility by demonstrating awareness of platform limits.</span>
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {NON_FIT_MARKETS.map((m, i) => (
            <div key={i} style={{ backgroundColor: '#1a0a0a', borderRadius: 8, padding: '12px 14px', border: '1px solid #ef444422' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#fca5a5', marginBottom: 6, display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, backgroundColor: '#ef444420', color: '#f87171' }}>NO FIT</span>
                {m.market}
              </div>
              {m.disqualifiers.map((d, j) => (
                <div key={j} style={{ fontSize: 11, color: '#9ca3af', lineHeight: 1.7, display: 'flex', gap: 6 }}>
                  <span style={{ color: '#ef4444' }}>✕</span>{d}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* SECTION D — Expansion Roadmap */}
      <div style={{ backgroundColor: '#0f172a', border: '1px solid #1e2d3d', borderRadius: 12, padding: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Section D</div>
        <h4 style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', margin: '0 0 4px' }}>Industry Expansion Roadmap</h4>
        <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 16px', lineHeight: 1.6 }}>
          Recommended sequence based on effort, market size, and feature overlap — overlaid on V4–V7 timeline.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {EXPANSION_ROADMAP.map((phase, i) => {
            const colors = ['#60a5fa', '#a78bfa', '#f59e0b', '#f87171']
            const color = colors[i] ?? '#9ca3af'
            return (
              <div key={i} style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                <div style={{
                  minWidth: 110, padding: '6px 10px', borderRadius: 7, backgroundColor: `${color}15`,
                  border: `1px solid ${color}33`, textAlign: 'center', flexShrink: 0,
                }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color }}>{phase.version.split(' ')[0]}</div>
                  <div style={{ fontSize: 9, color: '#6b7280' }}>{phase.version.split(' ').slice(1).join(' ')}</div>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                    {phase.industries.map((ind, j) => (
                      <span key={j} style={{
                        fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 5,
                        backgroundColor: '#111827', color: '#d1d5db', border: '1px solid #374151',
                      }}>{ind}</span>
                    ))}
                  </div>
                  <div style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.6 }}>{phase.rationale}</div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

    </div>
  )
}

// ─── TAB 10 — Compliance Overview ─────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  'Pending':     '#f59e0b',
  'In Progress': '#3b82f6',
  'Filed':       '#8b5cf6',
  'Active':      '#10b981',
  'Partial':     '#f97316',
  'Complete':    '#22c55e',
}

const DEFAULT_COMPLIANCE_ITEMS = [
  { category: 'Legal',    title: 'Attorney review of NDA',                        status: 'Pending',     due_date: null, notes: '', last_reviewed: null, checked: false, id: 'c1', sort_order: 1 },
  { category: 'Legal',    title: 'Attorney review of ToS',                        status: 'Pending',     due_date: null, notes: '', last_reviewed: null, checked: false, id: 'c2', sort_order: 2 },
  { category: 'Legal',    title: 'Attorney review of Privacy Policy',             status: 'Pending',     due_date: null, notes: '', last_reviewed: null, checked: false, id: 'c3', sort_order: 3 },
  { category: 'Business', title: 'CDTFA Seller Permit',                           status: 'In Progress', due_date: null, notes: '', last_reviewed: null, checked: false, id: 'c4', sort_order: 4 },
  { category: 'Business', title: 'USPTO Trademark #99745330',                     status: 'Filed',       due_date: null, notes: '', last_reviewed: null, checked: false, id: 'c5', sort_order: 5 },
  { category: 'Business', title: 'Copyright #1-15135532761',                      status: 'Filed',       due_date: null, notes: '', last_reviewed: null, checked: false, id: 'c6', sort_order: 6 },
  { category: 'Business', title: 'C-10 License #1151468',                         status: 'Active',      due_date: null, notes: '', last_reviewed: null, checked: false, id: 'c7', sort_order: 7 },
  { category: 'Business', title: 'GL Insurance (NEXT Insurance)',                 status: 'Active',      due_date: null, notes: '', last_reviewed: null, checked: false, id: 'c8', sort_order: 8 },
  { category: 'Business', title: 'Contractor Bond',                               status: 'Active',      due_date: null, notes: '', last_reviewed: null, checked: false, id: 'c9', sort_order: 9 },
  { category: 'Tech',     title: 'RLS policies audited on all Supabase tables',   status: 'Partial',     due_date: null, notes: '', last_reviewed: null, checked: false, id: 'c10', sort_order: 10 },
  { category: 'Tech',     title: 'No API keys in frontend bundle',                status: 'Active',      due_date: null, notes: '', last_reviewed: null, checked: false, id: 'c11', sort_order: 11 },
  { category: 'Tech',     title: 'Breach testing completed',                      status: 'Pending',     due_date: null, notes: '', last_reviewed: null, checked: false, id: 'c12', sort_order: 12 },
  { category: 'Tech',     title: 'Pre-commit security hook active',               status: 'Active',      due_date: null, notes: '', last_reviewed: null, checked: false, id: 'c13', sort_order: 13 },
  { category: 'Beta',     title: 'Beta invite NDA flow tested end-to-end',        status: 'Partial',     due_date: null, notes: '', last_reviewed: null, checked: false, id: 'c14', sort_order: 14 },
  { category: 'Beta',     title: 'Attorney reviewed NDA before external use',     status: 'Pending',     due_date: null, notes: '', last_reviewed: null, checked: false, id: 'c15', sort_order: 15 },
]

function Tab10Compliance() {
  const [items, setItems] = useState(DEFAULT_COMPLIANCE_ITEMS)
  const [loadingDb, setLoadingDb] = useState(true)
  const [insight, setInsight] = useState('')
  const [insightLoading, setInsightLoading] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)

  // Load from Supabase
  useEffect(() => {
    async function load() {
      try {
        const { data, error } = await supabase
          .from('compliance_items')
          .select('*')
          .order('sort_order', { ascending: true })
        if (!error && data && data.length > 0) {
          setItems(data)
        }
      } catch {
        // fall through to default items
      } finally {
        setLoadingDb(false)
      }
    }
    load()
  }, [])

  // Toggle checked
  async function toggleChecked(item: any) {
    const newVal = !item.checked
    const now = new Date().toISOString()
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, checked: newVal, checked_at: newVal ? now : null } : i))
    setSavingId(item.id)
    try {
      if (item.id && !item.id.startsWith('c')) {
        // Real UUID — update Supabase
        await supabase
          .from('compliance_items')
          .update({ checked: newVal, checked_at: newVal ? now : null, updated_at: now })
          .eq('id', item.id)
      } else {
        // Local default — upsert by title
        await supabase
          .from('compliance_items')
          .upsert({ ...item, id: undefined, checked: newVal, checked_at: newVal ? now : null, updated_at: now }, { onConflict: 'title' })
      }
    } catch {
      // silent fail — state already updated optimistically
    } finally {
      setSavingId(null)
    }
  }

  // Load AI insight
  async function loadInsight() {
    setInsightLoading(true)
    const pending = items.filter(i => i.status === 'Pending' || i.status === 'Partial')
    const overdue = items.filter(i => i.due_date && new Date(i.due_date) < new Date())
    const prompt = `
You are a legal and business compliance advisor for Power On Solutions, LLC — a California electrical contractor.
Current compliance checklist summary:
- Total items: ${items.length}
- Pending: ${items.filter(i => i.status === 'Pending').length}
- In Progress: ${items.filter(i => i.status === 'In Progress').length}
- Partial: ${items.filter(i => i.status === 'Partial').length}
- Active/Filed/Complete: ${items.filter(i => ['Active', 'Filed', 'Complete'].includes(i.status)).length}
- Overdue: ${overdue.length}

Items needing attention:
${pending.map(i => `- [${i.category}] ${i.title} (${i.status})`).join('\n')}

Flag any immediate risks, suggest a priority order for the next 30 days, and note what the platform cannot beta-launch without. 3-4 sentences, direct and actionable.`
    const text = await fetchInsight(
      'You are a legal and business compliance advisor for a California electrical contractor SaaS platform.',
      prompt
    )
    setInsight(text)
    setInsightLoading(false)
  }

  useEffect(() => { loadInsight() }, [])

  const categories = ['Legal', 'Business', 'Tech', 'Beta']

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Header card */}
      <div style={{ backgroundColor: '#0f172a', border: '1px solid #22c55e44', borderRadius: 12, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 4, height: 24, backgroundColor: '#22c55e', borderRadius: 2 }} />
            <div>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: '#dcfce7', margin: 0 }}>Compliance Overview</h3>
              <p style={{ fontSize: 11, color: '#4ade80', margin: 0 }}>Legal, Business, Tech, Beta — track every requirement before launch</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {['Pending', 'Partial', 'In Progress', 'Filed', 'Active'].map(s => (
              <div key={s} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 5, backgroundColor: `${STATUS_COLORS[s]}20`, color: STATUS_COLORS[s], fontWeight: 700 }}>
                {items.filter(i => i.status === s).length} {s}
              </div>
            ))}
          </div>
        </div>
        <InsightCard title="Compliance AI" accent="#22c55e" insight={insight} loading={insightLoading} onRegenerate={loadInsight} />
      </div>

      {/* Checklist grouped by category */}
      {categories.map(cat => {
        const catItems = items.filter(i => i.category === cat)
        if (catItems.length === 0) return null
        const catColor = cat === 'Legal' ? '#f59e0b' : cat === 'Business' ? '#3b82f6' : cat === 'Tech' ? '#8b5cf6' : '#10b981'
        return (
          <div key={cat} style={{ backgroundColor: '#0f172a', border: `1px solid ${catColor}33`, borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: catColor, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
              {cat}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {catItems.map(item => {
                const sc = STATUS_COLORS[item.status] ?? '#6b7280'
                const isSaving = savingId === item.id
                return (
                  <div
                    key={item.id}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 12,
                      padding: '10px 14px',
                      borderRadius: 8,
                      backgroundColor: item.checked ? '#0a1a0a' : '#111827',
                      border: `1px solid ${item.checked ? '#22c55e33' : '#1f2937'}`,
                      opacity: isSaving ? 0.7 : 1,
                      transition: 'all 0.15s',
                    }}
                  >
                    {/* Checkbox */}
                    <button
                      onClick={() => toggleChecked(item)}
                      disabled={isSaving}
                      style={{
                        width: 20, height: 20, borderRadius: 5, flexShrink: 0, marginTop: 1,
                        border: `2px solid ${item.checked ? '#22c55e' : '#374151'}`,
                        backgroundColor: item.checked ? '#22c55e' : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer', padding: 0, transition: 'all 0.15s',
                      }}
                    >
                      {item.checked && <span style={{ color: '#fff', fontSize: 12, lineHeight: 1 }}>✓</span>}
                    </button>

                    {/* Title + notes */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: item.checked ? '#4b5563' : '#e2e8f0', textDecoration: item.checked ? 'line-through' : 'none' }}>
                        {item.title}
                      </div>
                      {item.notes && (
                        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 3, lineHeight: 1.5 }}>{item.notes}</div>
                      )}
                      {item.last_reviewed && (
                        <div style={{ fontSize: 10, color: '#4b5563', marginTop: 2 }}>
                          Last reviewed: {new Date(item.last_reviewed).toLocaleDateString()}
                        </div>
                      )}
                    </div>

                    {/* Status chip */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 5,
                        backgroundColor: `${sc}20`, color: sc, whiteSpace: 'nowrap',
                      }}>
                        {item.status}
                      </span>
                      {item.due_date && (
                        <span style={{
                          fontSize: 10, color: new Date(item.due_date) < new Date() ? '#ef4444' : '#6b7280',
                        }}>
                          Due {new Date(item.due_date).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}

    </div>
  )
}

// ─── TAB 11 — Pending Actions + Sessions Queue ────────────────────────────────

const SESSION_DEFAULTS = [
  { session_id: 'B21', session_name: 'Core Layout + Navigation', description: 'V15r layout, sidebar nav, route structure', commit_hash: null, deployed_at: '2026-03-15', improvements_projected: 'Foundation established. Nav renders on all devices.' },
  { session_id: 'B22', session_name: 'Backend Sync + State', description: 'Supabase sync, Zustand store, backup service', commit_hash: null, deployed_at: '2026-03-16', improvements_projected: 'State persists across sessions. Multi-device sync working.' },
  { session_id: 'B23', session_name: 'Estimate Engine V2', description: 'Labor + material estimate builder with PDF export', commit_hash: null, deployed_at: '2026-03-17', improvements_projected: 'Estimate accuracy improved ~15%. PDF export live.' },
  { session_id: 'B24', session_name: 'Service Log + Collections', description: 'Service call tracker, collections queue, aging', commit_hash: null, deployed_at: '2026-03-18', improvements_projected: 'Collections workflow live. Aging buckets visible.' },
  { session_id: 'B25', session_name: 'GUARDIAN Agent', description: 'Proactive alert engine, rule evaluator, violation tracker', commit_hash: null, deployed_at: '2026-03-20', improvements_projected: 'Real-time risk alerts active. 12 rules live.' },
  { session_id: 'B26', session_name: 'SPARK Live Call', description: 'Call script engine, stage progression, outcome capture', commit_hash: null, deployed_at: '2026-03-21', improvements_projected: 'Live call guidance operational. Win-rate tracking started.' },
  { session_id: 'B27', session_name: 'Voice Hub + ECHO Memory', description: 'Voice journaling V2, ECHO context, transcription', commit_hash: null, deployed_at: '2026-03-22', improvements_projected: 'Voice notes saved to memory. NEXUS context window expanded.' },
  { session_id: 'B28', session_name: 'Economics Dashboard', description: 'P&L model, overhead calculator, MRR projections', commit_hash: null, deployed_at: '2026-03-24', improvements_projected: 'Full economics model live. Cash runway visible at a glance.' },
  { session_id: 'B29', session_name: 'Beta Ops + NDA Flow', description: 'Beta invite system, NDA signing, role gating', commit_hash: null, deployed_at: '2026-03-26', improvements_projected: 'Beta invite + NDA flow end-to-end. First external user onboarded.' },
  { session_id: 'B30', session_name: 'Numbers Audit + Accuracy Pass', description: 'Full financial audit, formula corrections, data integrity', commit_hash: null, deployed_at: '2026-03-28', improvements_projected: 'All financial figures verified. Data integrity score: 94%.' },
]

function Tab11ActionsQueue({ activeTabId }: { activeTabId: string }) {
  const [sessions, setSessions] = useState<any[]>([])
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [scoreInsight, setScoreInsight] = useState('')
  const [scoreLoading, setScoreLoading] = useState(false)

  // Voice interview state
  const [interviewActive, setInterviewActive] = useState(false)
  const [interviewMessages, setInterviewMessages] = useState<Array<{ role: 'nexus' | 'user', text: string }>>([])
  const [interviewInput, setInterviewInput] = useState('')
  const [interviewLoading, setInterviewLoading] = useState(false)
  const [interviewSummary, setInterviewSummary] = useState('')
  const [summaryLoading, setSummaryLoading] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  // Load sessions from Supabase
  useEffect(() => {
    async function load() {
      try {
        const { data, error } = await supabase
          .from('sessions_history')
          .select('*')
          .order('deployed_at', { ascending: false })
          .limit(10)
        if (!error && data && data.length > 0) {
          setSessions(data.reverse())
        } else {
          setSessions(SESSION_DEFAULTS)
        }
      } catch {
        setSessions(SESSION_DEFAULTS)
      } finally {
        setLoadingSessions(false)
      }
    }
    load()
  }, [])

  // Load score projection insight
  async function loadScoreInsight() {
    setScoreLoading(true)
    const sessionList = sessions.map(s => `${s.session_id}: ${s.session_name}`).join(', ')
    const text = await fetchInsight(
      'You are a platform evolution advisor for Power On Hub, a contractor OS SaaS.',
      `Given sessions B21–B40 with the following names and purposes: ${sessionList}. Estimate the projected platform state improvement score from B20 baseline (score ~45/100) to the current B40 state. Break down by dimension: Stability, AI Logic, Numbers Accuracy, Security, Features, Visual Polish, Beta Ops, Revenue readiness. Give an overall score and 2-3 sentences on what changed most significantly. Be specific and cite session names.`
    )
    setScoreInsight(text)
    setScoreLoading(false)
  }

  useEffect(() => {
    if (sessions.length > 0) loadScoreInsight()
  }, [sessions.length])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [interviewMessages])

  // Start interview
  function startInterview() {
    setInterviewActive(true)
    setInterviewMessages([{
      role: 'nexus',
      text: `You just reviewed Tab ${activeTabId?.replace('t', '') || ''}. Let's debrief. What did you notice in the data today?`,
    }])
    setInterviewSummary('')
  }

  // Send interview message
  async function sendInterviewMessage() {
    if (!interviewInput.trim() || interviewLoading) return
    const userMsg = interviewInput.trim()
    setInterviewInput('')
    const newMessages = [...interviewMessages, { role: 'user' as const, text: userMsg }]
    setInterviewMessages(newMessages)
    setInterviewLoading(true)

    // Build follow-up question
    const history = newMessages.map(m => `${m.role === 'nexus' ? 'NEXUS' : 'Owner'}: ${m.text}`).join('\n')
    const followUp = await fetchInsight(
      'You are NEXUS, the AI advisor for Power On Solutions. You are conducting a structured debrief interview with the owner after they reviewed their platform dashboard. Ask one focused follow-up question based on their last answer. Be concise, direct, and curious. Do not give advice yet — only ask questions to understand their thinking.',
      `Interview so far:\n${history}\n\nAsk one follow-up question.`
    )
    setInterviewMessages(prev => [...prev, { role: 'nexus', text: followUp }])
    setInterviewLoading(false)
  }

  // End interview + generate summary
  async function endInterview() {
    setSummaryLoading(true)
    const history = interviewMessages.map(m => `${m.role === 'nexus' ? 'NEXUS' : 'Owner'}: ${m.text}`).join('\n')
    const summary = await fetchInsight(
      'You are NEXUS. Generate a structured debrief summary from a review interview.',
      `Interview transcript:\n${history}\n\nGenerate a structured summary with 3 sections: (1) Key Observations from the owner, (2) Decisions the owner indicated they are considering, (3) Recommended next actions. Be specific and reference what the owner said directly.`
    )
    setInterviewSummary(summary)
    setSummaryLoading(false)

    // Save to improvement_log
    try {
      await supabase.from('improvement_log').insert({
        title: `Voice Interview Debrief — ${new Date().toLocaleDateString()}`,
        category: 'Review',
        priority: 'Med',
        notes: summary,
        source: 'voice_interview',
        admin_added: true,
      })
    } catch {
      // silent fail
    }
  }

  // Save current B40 session to Supabase
  async function saveCurrentSession() {
    try {
      await supabase.from('sessions_history').upsert({
        session_id: 'B40',
        session_name: 'Compliance + Actions + NEXUS Integration',
        description: 'Tab 10 Compliance Overview, Tab 11 Sessions Queue, NEXUS panel added to Command Center',
        deployed_at: new Date().toISOString(),
        improvements_projected: 'Full compliance tracking live. Sessions queue tied to Supabase. NEXUS chat integrated into Command Center.',
      }, { onConflict: 'session_id' })
    } catch {
      // silent
    }
  }

  useEffect(() => { saveCurrentSession() }, [])

  const DAILY_TASKS = [
    { time: '10 min', label: 'Check NEXUS alerts', icon: '⚡' },
    { time: '', label: 'Review any flagged items in GUARDIAN', icon: '🛡️' },
    { time: '', label: 'Check Voice Hub for unreviewed captures', icon: '🎙️' },
  ]
  const WEEKLY_TASKS = [
    { time: '30 min', label: 'Review Improvement Log', icon: '📋' },
    { time: '', label: 'Export weekly feedback + update log from Voice Hub notes', icon: '📤' },
    { time: '', label: 'Check beta user activity', icon: '👥' },
    { time: '', label: 'Export milestone backup to vault', icon: '💾' },
  ]
  const MONTHLY_TASKS = [
    { time: '2 hours', label: 'Full platform audit', icon: '🔍' },
    { time: '', label: 'Economics review', icon: '💹' },
    { time: '', label: 'Beta council call', icon: '📞' },
    { time: '', label: 'Update Blueprint V3 document', icon: '📄' },
    { time: '', label: 'Review compliance checklist', icon: '✅' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* SECTION A — Owner Schedule */}
      <div style={{ backgroundColor: '#0f172a', border: '1px solid #3b82f644', borderRadius: 12, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{ width: 4, height: 24, backgroundColor: '#3b82f6', borderRadius: 2 }} />
          <div>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: '#dbeafe', margin: 0 }}>Section A — Owner Operating Rhythm</h3>
            <p style={{ fontSize: 11, color: '#60a5fa', margin: 0 }}>AI-structured routine based on current platform stage</p>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          {[
            { label: 'Daily', time: '10 min', color: '#22c55e', tasks: DAILY_TASKS },
            { label: 'Weekly', time: '30 min', color: '#3b82f6', tasks: WEEKLY_TASKS },
            { label: 'Monthly', time: '2 hours', color: '#a78bfa', tasks: MONTHLY_TASKS },
          ].map(block => (
            <div key={block.label} style={{ backgroundColor: '#111827', borderRadius: 10, padding: '14px 16px', border: `1px solid ${block.color}22` }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: block.color }}>{block.label}</span>
                <span style={{ fontSize: 10, color: '#4b5563', backgroundColor: '#0a0f1a', padding: '2px 8px', borderRadius: 4 }}>{block.time}</span>
              </div>
              {block.tasks.map((task, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 13, flexShrink: 0, marginTop: 1 }}>{task.icon}</span>
                  <span style={{ fontSize: 12, color: '#9ca3af', lineHeight: 1.5 }}>{task.label}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* SECTION B — Sessions Queue */}
      <div style={{ backgroundColor: '#0f172a', border: '1px solid #7c3aed44', borderRadius: 12, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <div style={{ width: 4, height: 24, backgroundColor: '#7c3aed', borderRadius: 2 }} />
          <div style={{ flex: 1 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: '#ede9fe', margin: 0 }}>Section B — Last 10 Sessions</h3>
            <p style={{ fontSize: 11, color: '#a78bfa', margin: 0 }}>Build sessions B21–B40 — what shipped and what it improved</p>
          </div>
          {loadingSessions && <span style={{ fontSize: 11, color: '#4b5563' }}>Loading…</span>}
        </div>

        {/* Score insight */}
        <InsightCard title="B20→B40 Score" accent="#7c3aed" insight={scoreInsight} loading={scoreLoading} onRegenerate={loadScoreInsight} />

        {/* Timeline */}
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {sessions.map((s, i) => {
            const isLatest = i === sessions.length - 1
            return (
              <div key={s.session_id ?? i} style={{
                display: 'flex', gap: 14, alignItems: 'flex-start',
                padding: '12px 14px', borderRadius: 10,
                backgroundColor: isLatest ? '#1a0d2e' : '#111827',
                border: isLatest ? '1px solid #7c3aed55' : '1px solid #1f2937',
              }}>
                {/* Marker */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    backgroundColor: isLatest ? '#7c3aed' : '#1f2937',
                    border: `2px solid ${isLatest ? '#a78bfa' : '#374151'}`,
                    fontSize: 10, fontWeight: 800, color: isLatest ? '#fff' : '#6b7280',
                  }}>
                    {s.session_id}
                  </div>
                  {i < sessions.length - 1 && (
                    <div style={{ width: 2, height: 16, backgroundColor: '#1f2937', borderRadius: 1 }} />
                  )}
                </div>
                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: isLatest ? '#c4b5fd' : '#e2e8f0', marginBottom: 2 }}>
                    {s.session_name}
                  </div>
                  {s.description && (
                    <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4, lineHeight: 1.5 }}>{s.description}</div>
                  )}
                  {s.improvements_projected && (
                    <div style={{ fontSize: 11, color: '#4ade80', lineHeight: 1.5 }}>↑ {s.improvements_projected}</div>
                  )}
                </div>
                {/* Meta */}
                <div style={{ flexShrink: 0, textAlign: 'right' }}>
                  {s.deployed_at && (
                    <div style={{ fontSize: 10, color: '#4b5563', marginBottom: 3 }}>
                      {new Date(s.deployed_at).toLocaleDateString()}
                    </div>
                  )}
                  {s.commit_hash && (
                    <div style={{ fontSize: 9, fontFamily: 'monospace', color: '#374151', backgroundColor: '#0a0f1a', padding: '2px 6px', borderRadius: 4 }}>
                      {s.commit_hash.slice(0, 8)}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* SECTION C — NEXUS Voice Interview Mode */}
      <div style={{ backgroundColor: '#0f172a', border: '1px solid #06b6d444', borderRadius: 12, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{ width: 4, height: 24, backgroundColor: '#06b6d4', borderRadius: 2 }} />
          <div style={{ flex: 1 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: '#cffafe', margin: 0 }}>Section C — NEXUS Review Interview</h3>
            <p style={{ fontSize: 11, color: '#22d3ee', margin: 0 }}>
              After reviewing any tab, start a voice debrief. NEXUS asks questions, listens, and generates a structured summary saved to your Improvement Log.
            </p>
          </div>
          {!interviewActive && (
            <button
              onClick={startInterview}
              style={{
                padding: '8px 16px', borderRadius: 8, border: '1px solid #06b6d4',
                backgroundColor: '#06b6d420', color: '#22d3ee', fontSize: 12, fontWeight: 700,
                cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              ▶ Start Review Interview
            </button>
          )}
        </div>

        {interviewActive && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Chat thread */}
            <div style={{
              backgroundColor: '#0a0f1a', borderRadius: 10, padding: 16,
              maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10,
            }}>
              {interviewMessages.map((msg, i) => (
                <div key={i} style={{
                  display: 'flex', gap: 10,
                  flexDirection: msg.role === 'nexus' ? 'row' : 'row-reverse',
                }}>
                  <div style={{
                    width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                    backgroundColor: msg.role === 'nexus' ? '#06b6d420' : '#1f2937',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 700, color: msg.role === 'nexus' ? '#22d3ee' : '#9ca3af',
                  }}>
                    {msg.role === 'nexus' ? 'N' : 'Y'}
                  </div>
                  <div style={{
                    maxWidth: '75%', padding: '8px 12px', borderRadius: msg.role === 'nexus' ? '4px 12px 12px 12px' : '12px 4px 12px 12px',
                    backgroundColor: msg.role === 'nexus' ? '#0e1f2e' : '#1a2535',
                    border: `1px solid ${msg.role === 'nexus' ? '#06b6d430' : '#374151'}`,
                    fontSize: 13, color: msg.role === 'nexus' ? '#a5f3fc' : '#d1d5db', lineHeight: 1.55,
                  }}>
                    {msg.text}
                  </div>
                </div>
              ))}
              {interviewLoading && (
                <div style={{ fontSize: 12, color: '#22d3ee', fontStyle: 'italic', paddingLeft: 36 }}>NEXUS is thinking…</div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input row */}
            {!interviewSummary && (
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={interviewInput}
                  onChange={e => setInterviewInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendInterviewMessage() } }}
                  placeholder="Type your answer… (Enter to send)"
                  style={{
                    flex: 1, padding: '9px 14px', borderRadius: 8,
                    border: '1px solid #1e3a4a', backgroundColor: '#0a0f1a',
                    color: '#e2e8f0', fontSize: 13, outline: 'none',
                  }}
                />
                <button
                  onClick={sendInterviewMessage}
                  disabled={interviewLoading || !interviewInput.trim()}
                  style={{
                    padding: '9px 16px', borderRadius: 8, border: '1px solid #06b6d4',
                    backgroundColor: '#06b6d420', color: '#22d3ee', fontSize: 12, fontWeight: 700,
                    cursor: interviewLoading ? 'not-allowed' : 'pointer', opacity: interviewLoading ? 0.5 : 1,
                  }}
                >
                  Send
                </button>
                <button
                  onClick={endInterview}
                  disabled={summaryLoading || interviewMessages.length < 3}
                  style={{
                    padding: '9px 16px', borderRadius: 8, border: '1px solid #374151',
                    backgroundColor: 'transparent', color: '#6b7280', fontSize: 12, fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {summaryLoading ? 'Summarizing…' : 'End + Save'}
                </button>
              </div>
            )}

            {/* Summary */}
            {interviewSummary && (
              <div style={{ backgroundColor: '#0d1a0d', border: '1px solid #22c55e44', borderRadius: 10, padding: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#4ade80', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                  ✓ Interview Summary — Saved to Improvement Log
                </div>
                <p style={{ fontSize: 13, color: '#d1d5db', lineHeight: 1.65, margin: 0, whiteSpace: 'pre-wrap' }}>{interviewSummary}</p>
                <button
                  onClick={() => { setInterviewActive(false); setInterviewMessages([]); setInterviewSummary('') }}
                  style={{
                    marginTop: 12, padding: '7px 14px', borderRadius: 7, border: '1px solid #374151',
                    backgroundColor: 'transparent', color: '#6b7280', fontSize: 11, cursor: 'pointer',
                  }}
                >
                  Start New Interview
                </button>
              </div>
            )}
          </div>
        )}

        {!interviewActive && (
          <p style={{ fontSize: 12, color: '#374151', fontStyle: 'italic', margin: 0 }}>
            Click "Start Review Interview" after reviewing any tab. NEXUS will guide you through a structured debrief and save your notes automatically.
          </p>
        )}
      </div>

    </div>
  )
}

// ─── NEXUS Command Center Panel ───────────────────────────────────────────────

// ─── TAB 12 + 13 — Shared static data ────────────────────────────────────────
const HUB_BUILD_MILESTONES = [
  { date: 'Apr 7, 2026', title: 'AI Visual Suite deployed',
    note: 'B46 · 18 files · 43 visual modes · QuantumFoam as NEXUS default' },
  { date: 'Apr 7, 2026', title: 'B42–B45 wave complete',
    note: 'Neural Map glow, Orb Lab fixed, Vision Timeline, PIN fix' },
  { date: 'Apr 5, 2026', title: 'V3 deployed to production',
    note: 'Commit 449c20d · 14 new views · 12 new agents · NEXUS Prompt Engine live' },
  { date: 'Apr 5, 2026', title: 'IP protection filed',
    note: 'USPTO Serial #99745330 · Copyright #1-15135532761' },
  { date: 'Apr 5, 2026', title: 'DaSparkyHub Session 1 live',
    note: 'Katsuro Raijin · Text + voice · Deployed to Netlify' },
  { date: 'Apr 4, 2026', title: 'Commercial model locked',
    note: 'Solo $49 / Growth $129 / Pro $299 / Pro+ $499 / Enterprise $800+' },
  { date: 'Mar 2026', title: 'V3 full architecture built',
    note: 'GUARDIAN, Crew Portal, HR Docs, Demo Mode, Blueprint AI' },
  { date: 'Mar 2026', title: 'V2 React+Vite5+TS rebuild complete',
    note: '19 panels · Supabase · ElevenLabs · Bundle 893kb→347kb' },
  { date: 'Mar 2026', title: 'RMO deal negotiated',
    note: 'MTZ Solar · 10-job cap · Dual-role separation clause' },
  { date: 'Mar 2026', title: 'HTML monolith — the origin',
    note: '12,388 lines · 14 Excel refs · 2,189 formulas · V7→V8→V14+' },
]

const HUB_PLATFORM_STATS = [
  { label: 'Total Panels',       value: '28+' },
  { label: 'AI Agents',          value: '15' },
  { label: 'Admin Tabs',         value: '13' },
  { label: 'ElevenLabs Voices',  value: '3' },
  { label: 'Supabase Tables',    value: '40+' },
  { label: 'Beta Contacts',      value: '5' },
  { label: 'IP Filings',         value: '2' },
  { label: 'Visual Modes',       value: '43' },
  { label: 'Production Deploys', value: '6+' },
  { label: 'Lines of Code',      value: '25,000+' },
  { label: 'Launch Status',      value: 'Pre-Beta' },
]

const HUB_AGENTS = [
  'NEXUS', 'GUARDIAN', 'SPARK', 'CHRONO', 'HUNTER',
  'SENTINEL', 'SCOUT', 'VAULT', 'MIRROR', 'SIGNAL',
  'BRIDGE', 'LEDGER', 'OHM', 'BLUEPRINT', 'MIRO',
]

const HUB_TIERS = [
  { label: 'Solo',       price: '$49' },
  { label: 'Growth',     price: '$129' },
  { label: 'Pro',        price: '$299' },
  { label: 'Pro+',       price: '$499' },
  { label: 'Enterprise', price: '$800+' },
]

function cFmt(v: number): string {
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function useElectricalData() {
  const d = getBackupData()
  if (!d) return { kpis: null, openProjects: [] as any[], lastLog: null as any, serviceNet: 0, activeCrew: 0 }
  const kpis = getKPIs(d)
  const projects = d.projects || []
  const openProjects = projects.filter((p: any) => {
    const s = (p.status || '').toLowerCase()
    return s === 'active' || s === 'coming'
  })
  const serviceLogs = d.serviceLogs || []
  const serviceNet = serviceLogs.reduce((s: number, l: any) => s + num(l.collected) - num(l.opCost), 0)
  const activeCrew = (d.employees || []).length
  const allLogs = [...(d.logs || [])].sort((a: any, b: any) => String(b.date || '').localeCompare(String(a.date || '')))
  const lastLog = allLogs[0] || null
  return { kpis, openProjects, lastLog, serviceNet, activeCrew }
}

// ─── TAB 12 — Split View ──────────────────────────────────────────────────────
function Tab12SplitView() {
  const { kpis, openProjects, lastLog, serviceNet, activeCrew } = useElectricalData()

  const colStyle: React.CSSProperties = {
    flex: 1,
    overflowY: 'auto',
    padding: '20px 22px',
    minWidth: 0,
  }

  const colHeaderStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'flex-start',
    marginBottom: 16,
    paddingBottom: 12,
    borderBottom: '1px solid rgba(255,255,255,0.08)',
  }

  const secHdr: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.4)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    marginBottom: 8,
    marginTop: 16,
  }

  function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
    return (
      <div style={{
        backgroundColor: '#0d1321',
        border: '1px solid rgba(255,255,255,0.07)',
        borderRadius: 8,
        padding: '10px 14px',
        marginBottom: 7,
      }}>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 3 }}>{label}</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#00ff9f', lineHeight: 1.2 }}>{value}</div>
        {sub && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>{sub}</div>}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {/* LEFT — Power On Solutions LLC */}
      <div style={colStyle}>
        <div style={colHeaderStyle}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#e2e8f0' }}>⚡ POWER ON SOLUTIONS LLC</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5 }}>
              <span style={{ fontSize: 10, fontWeight: 700, backgroundColor: '#1e3a5f', color: '#93c5fd', padding: '2px 7px', borderRadius: 4 }}>C-10 #1151468</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#00ff9f', fontWeight: 700 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: '#00ff9f', display: 'inline-block' }} />
                ACTIVE
              </span>
            </div>
          </div>
        </div>

        {kpis ? (
          <>
            <StatCard label="Pipeline" value={cFmt(kpis.pipeline)} />
            <StatCard label="Paid" value={cFmt(kpis.paid)} />
            <StatCard label="Exposure" value={cFmt(kpis.exposure)} />
            <StatCard label="SVC Unbilled" value={cFmt(kpis.svcUnbilled)} />
          </>
        ) : (
          <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13 }}>No backup data found.</div>
        )}

        <div style={secHdr}>Open Projects ({openProjects.length})</div>
        {openProjects.length === 0 ? (
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', padding: '4px 0' }}>No open projects</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {openProjects.map((p: any) => (
              <div key={p.id} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                backgroundColor: '#0d1321',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 6, padding: '7px 12px', fontSize: 12,
              }}>
                <span style={{ flex: 1, color: '#d1d5db', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 3, flexShrink: 0,
                  backgroundColor: p.status === 'active' ? '#14532d' : '#1e2d3d',
                  color: p.status === 'active' ? '#86efac' : '#93c5fd',
                }}>
                  {(p.status || 'active').toUpperCase()}
                </span>
                <span style={{ fontSize: 11, color: '#ffd700', fontWeight: 700, flexShrink: 0 }}>{cFmt(p.contract || 0)}</span>
              </div>
            ))}
          </div>
        )}

        <div style={{ marginTop: 12 }}>
          <StatCard label="Open RFIs" value={String(kpis?.openRfis ?? 0)} />
          <StatCard label="Service Net" value={cFmt(serviceNet)} />
          <StatCard label="Active Crew" value={String(activeCrew)} />
        </div>

        <div style={secHdr}>Last Field Log</div>
        {lastLog ? (
          <div style={{ backgroundColor: '#0d1321', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, padding: '10px 14px' }}>
            <div style={{ fontSize: 11, color: '#ffd700', fontWeight: 700, marginBottom: 3 }}>{lastLog.date}</div>
            <div style={{ fontSize: 12, color: '#d1d5db', lineHeight: 1.5 }}>{(lastLog.notes || '').split('\n')[0] || '(no notes)'}</div>
          </div>
        ) : (
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>No field logs recorded</div>
        )}
      </div>

      {/* Divider */}
      <div style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.08)', flexShrink: 0 }} />

      {/* RIGHT — PowerOn Hub */}
      <div style={colStyle}>
        <div style={colHeaderStyle}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#e2e8f0' }}>🧠 POWERON HUB</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5 }}>
              <span style={{ fontSize: 10, fontWeight: 700, backgroundColor: '#2d1e5f', color: '#c4b5fd', padding: '2px 7px', borderRadius: 4 }}>V3 · PRODUCTION</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#00ff9f', fontWeight: 700 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: '#00ff9f', display: 'inline-block' }} />
                LIVE
              </span>
            </div>
          </div>
        </div>

        {/* Section A — Build Timeline */}
        <div style={{ ...secHdr, marginTop: 0 }}>Build Timeline</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {HUB_BUILD_MILESTONES.map((m, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#00ff9f', flexShrink: 0, marginTop: 4 }} />
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>{m.date}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0' }}>{m.title}</span>
                </div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 1 }}>{m.note}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Section B — Platform Stats */}
        <div style={secHdr}>Platform Stats</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
          {HUB_PLATFORM_STATS.map((s, i) => (
            <div key={i} style={{ backgroundColor: '#0d1321', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 7, padding: '8px 10px' }}>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>{s.label}</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#00ff9f' }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Section C — Agent Roster */}
        <div style={secHdr}>Agent Roster</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {HUB_AGENTS.map((agent, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 5,
              backgroundColor: '#0d1321', border: '1px solid rgba(0,255,159,0.2)',
              borderRadius: 20, padding: '4px 10px', fontSize: 11, fontWeight: 700, color: '#e2e8f0',
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#00ff9f', display: 'inline-block' }} />
              {agent}
            </div>
          ))}
        </div>

        {/* Section D — Commercial Model */}
        <div style={secHdr}>Commercial Model</div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
          {HUB_TIERS.map((t, i) => (
            <div key={i} style={{
              flex: 1, minWidth: 64,
              backgroundColor: '#0d1321', border: '1px solid rgba(255,215,0,0.2)',
              borderRadius: 8, padding: '10px 8px', textAlign: 'center',
            }}>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontWeight: 600, marginBottom: 4 }}>{t.label}</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#ffd700' }}>{t.price}</div>
            </div>
          ))}
        </div>
        <div style={{ backgroundColor: '#0d1321', border: '1px solid rgba(255,215,0,0.18)', borderRadius: 8, padding: '12px 14px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#ffd700', marginBottom: 3 }}>Prove It Tier</div>
          <div style={{ fontSize: 12, color: '#d1d5db' }}>$0 base · 90 days · 5% platform-attributed revenue share</div>
        </div>
      </div>
    </div>
  )
}

// ─── TAB 13 — Unified Command ─────────────────────────────────────────────────
function Tab13UnifiedCommand() {
  const { kpis, openProjects, serviceNet, activeCrew } = useElectricalData()
  const d = getBackupData()
  const recentLogs = [...(d?.logs || [])].sort((a: any, b: any) => String(b.date || '').localeCompare(String(a.date || ''))).slice(0, 3)
  const last3 = HUB_BUILD_MILESTONES.slice(0, 3)

  const secHdr: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.4)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    marginBottom: 8,
    marginTop: 14,
  }

  const cCard: React.CSSProperties = {
    backgroundColor: '#0d1321',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 8,
    padding: '10px 14px',
    marginBottom: 7,
  }

  const swimStyle: React.CSSProperties = {
    flex: 1,
    overflowY: 'auto',
    padding: '18px 20px',
    minWidth: 0,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* SECTION 1 — Operator Identity Header */}
      <div style={{ backgroundColor: '#0d1321', borderBottom: '1px solid rgba(255,255,255,0.08)', padding: '14px 24px', flexShrink: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: '#e2e8f0', marginBottom: 2 }}>
          Christian Dubon · Managing Member &amp; Platform Founder
        </div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 10 }}>
          Power On Solutions LLC · C-10 #1151468 · PowerOn Hub V3 Production
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[
            { icon: '⚡', label: 'Electrical: ACTIVE', color: '#00ff9f', bg: '#0a2010' },
            { icon: '🧠', label: 'Platform: LIVE',     color: '#a78bfa', bg: '#1a1030' },
            { icon: '📋', label: 'IP: FILED',          color: '#ffd700', bg: '#1a1400' },
            { icon: '👥', label: 'Beta: FORMING',      color: '#93c5fd', bg: '#0a1830' },
          ].map((b, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 5,
              backgroundColor: b.bg, border: `1px solid ${b.color}44`,
              borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 700, color: b.color,
            }}>
              {b.icon} {b.label}
            </div>
          ))}
        </div>
      </div>

      {/* SECTION 2 — Cross-entity KPI Row */}
      <div style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', padding: '14px 24px', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 10 }}>
          {[
            { label: 'Pipeline Activity',  value: kpis ? cFmt(kpis.pipeline) : '—',             big: true },
            { label: 'Platform Build',     value: 'V3 Live · 45 days · $0 external capital',    big: false },
            { label: 'Active Operations',  value: kpis ? `${kpis.activeProjects} + 1 platform` : '— + 1 platform', big: false },
            { label: 'Agents Deployed',    value: '15 AI agents',                                big: false },
            { label: 'IP Protected',       value: '2 filings · April 2026',                      big: false },
          ].map((c, i) => (
            <div key={i} style={{ flex: 1, backgroundColor: '#0d1321', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, padding: '10px 12px', minWidth: 0 }}>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{c.label}</div>
              <div style={{ fontSize: c.big ? 20 : 12, fontWeight: 700, color: '#00ff9f', lineHeight: 1.3, wordBreak: 'break-word' }}>{c.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* SECTION 3 — Two Swimlanes */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>

        {/* LEFT SWIMLANE — Electrical Operations */}
        <div style={swimStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, paddingBottom: 10, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: '#e2e8f0' }}>⚡ ELECTRICAL OPERATIONS</span>
          </div>

          <div style={{ ...secHdr, marginTop: 0 }}>Financial Snapshot</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
            {kpis ? [
              { label: 'Pipeline',    value: cFmt(kpis.pipeline) },
              { label: 'Paid',        value: cFmt(kpis.paid) },
              { label: 'Exposure',    value: cFmt(kpis.exposure) },
              { label: 'Unbilled',    value: cFmt(kpis.svcUnbilled) },
              { label: 'Service Net', value: cFmt(serviceNet) },
            ].map((s, i) => (
              <div key={i} style={cCard}>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>{s.label}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#00ff9f' }}>{s.value}</div>
              </div>
            )) : <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', gridColumn: '1 / -1' }}>No data loaded.</div>}
          </div>

          <div style={secHdr}>Open Projects</div>
          {openProjects.slice(0, 8).map((p: any) => (
            <div key={p.id} style={{ ...cCard, display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px' }}>
              <span style={{ flex: 1, fontSize: 12, color: '#d1d5db', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
              <span style={{ fontSize: 11, color: '#ffd700', fontWeight: 700, flexShrink: 0 }}>{cFmt(p.contract || 0)}</span>
              <span style={{ fontSize: 10, flexShrink: 0, color: p.status === 'active' ? '#86efac' : '#93c5fd' }}>{(p.status || 'active').toUpperCase()}</span>
            </div>
          ))}
          {openProjects.length === 0 && <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', padding: '4px 0' }}>No open projects</div>}

          <div style={secHdr}>Recent Field Logs</div>
          {recentLogs.length === 0
            ? <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>No logs</div>
            : recentLogs.map((l: any, i: number) => (
              <div key={i} style={cCard}>
                <div style={{ fontSize: 10, color: '#ffd700', fontWeight: 700, marginBottom: 2 }}>{l.date}</div>
                <div style={{ fontSize: 12, color: '#d1d5db' }}>{(l.notes || '').split('\n')[0] || '(no notes)'}</div>
              </div>
            ))
          }

          <div style={secHdr}>Quick Stats</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {[
              { label: 'Open RFIs',   value: String(kpis?.openRfis ?? 0) },
              { label: 'Active Crew', value: String(activeCrew) },
              { label: 'Last Sync',   value: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) },
            ].map((s, i) => (
              <div key={i} style={{ flex: 1, backgroundColor: '#0d1321', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 7, padding: '8px 10px', textAlign: 'center' }}>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>{s.label}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#00ff9f' }}>{s.value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Divider */}
        <div style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.08)', flexShrink: 0 }} />

        {/* RIGHT SWIMLANE — Platform Operations */}
        <div style={swimStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, paddingBottom: 10, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: '#e2e8f0' }}>🧠 PLATFORM OPERATIONS</span>
          </div>

          <div style={{ ...secHdr, marginTop: 0 }}>Current Sprint</div>
          <div style={{ ...cCard, border: '1px solid rgba(0,255,159,0.25)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, backgroundColor: '#0a2010', color: '#00ff9f' }}>B47 RUNNING</span>
              <span style={{ fontSize: 11, color: '#e2e8f0', fontWeight: 600 }}>Command Center dual view</span>
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>Status: In Progress</div>
          </div>

          <div style={secHdr}>Next in Queue</div>
          <div style={cCard}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#ffd700' }}>B48+ · Post-audit wave · Beta prep</div>
          </div>

          <div style={secHdr}>Build Velocity</div>
          <div style={cCard}>
            <div style={{ fontSize: 12, color: '#d1d5db', marginBottom: 4 }}>6+ production deploys since March 2026</div>
            <div style={{ fontSize: 12, color: '#d1d5db' }}>18 files changed in B46 alone</div>
          </div>

          <div style={secHdr}>Beta Pipeline</div>
          <div style={cCard}>
            <div style={{ fontSize: 12, color: '#d1d5db', marginBottom: 4 }}>5 contacts identified</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>Launch sequence: pending attorney NDA review</div>
          </div>

          <div style={secHdr}>Revenue Model</div>
          <div style={{ display: 'flex', gap: 5, marginBottom: 8, flexWrap: 'wrap' }}>
            {HUB_TIERS.map((t, i) => (
              <div key={i} style={{
                flex: 1, minWidth: 58,
                backgroundColor: i === 2 ? '#1a1000' : '#0d1321',
                border: `1px solid ${i === 2 ? '#ffd700' : 'rgba(255,255,255,0.07)'}`,
                borderRadius: 7, padding: '7px 6px', textAlign: 'center',
              }}>
                <div style={{ fontSize: 9, color: i === 2 ? '#ffd700' : 'rgba(255,255,255,0.4)', fontWeight: 600, marginBottom: 2 }}>{t.label}</div>
                <div style={{ fontSize: 13, fontWeight: 800, color: i === 2 ? '#ffd700' : '#e2e8f0' }}>{t.price}</div>
              </div>
            ))}
          </div>

          <div style={secHdr}>Recent Milestones</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {last3.map((m, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#00ff9f', flexShrink: 0, marginTop: 4 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>{m.date}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0' }}>{m.title}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 1 }}>{m.note}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

const NEXUS_CONTEXT_BY_TAB: Record<string, string> = {
  vision:     'The user is viewing the Vision Timeline tab, which shows the journey from the original HTML file to V3 deployment, platform radar scores, and beta milestone progress.',
  backend:    'The user is viewing the Backend Analysis tab, which shows Supabase table health, API response times, RLS coverage, and storage metrics.',
  beta:       'The user is viewing the Beta Metrics tab, which shows beta invitee list, NDA signing status, engagement metrics, and feedback collected from beta users.',
  economics:  'The user is viewing the Economics tab, which shows the P&L model, overhead breakdown, MRR projections, and cash runway calculations.',
  improvelog: 'The user is viewing the Improvement Log tab, which tracks bugs, feature requests, and platform improvements logged by the admin.',
  t6:         'The user is viewing the Summary + Checklist tab, which shows a launch readiness summary and a weekly/monthly operational checklist.',
  t7:         'The user is viewing the Scripts + Positioning tab, which contains sales scripts, elevator pitches, and competitive positioning for Power On Hub.',
  t8:         'The user is viewing the AI Agents tab, which maps all active agents (NEXUS, GUARDIAN, SPARK, ECHO, etc.) and their current activation status.',
  t9:         'The user is viewing the Industry Analysis tab, which evaluates the platform fit across 16 trade verticals and shows expansion roadmap opportunities.',
  t10:        'The user is viewing the Compliance Overview tab, which tracks legal, business, tech, and beta compliance items including licenses, IP filings, and security requirements.',
  t11:        'The user is viewing the Pending Actions + Sessions Queue tab, which shows the owner operating rhythm, last 10 build sessions (B21–B40), and the NEXUS voice interview debrief tool.',
  t12:        'The user is viewing the Split View tab, which shows Power On Solutions LLC electrical KPIs (pipeline, paid, exposure, projects) side by side with the PowerOn Hub build timeline, platform stats, agent roster, and commercial model.',
  t13:        'The user is viewing the Unified Command tab, which combines the operator identity header, cross-entity KPI row, and dual swimlanes for electrical operations and platform operations in a single command view.',
}

function NexusCommandPanel({ activeTabId }: { activeTabId: string }) {
  const [collapsed, setCollapsed] = useState(false)
  const [orbExpanded, setOrbExpanded] = useState(true)
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'nexus', text: string }>>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Greeting when first opened
  useEffect(() => {
    if (messages.length === 0) {
      const ctx = NEXUS_CONTEXT_BY_TAB[activeTabId] ?? 'the Admin Command Center'
      setMessages([{
        role: 'nexus',
        text: `I'm in context. ${ctx} What would you like to know?`,
      }])
    }
  }, [])

  // Update greeting if tab changes and chat is empty
  useEffect(() => {
    if (messages.length === 1 && messages[0].role === 'nexus') {
      const ctx = NEXUS_CONTEXT_BY_TAB[activeTabId] ?? 'the Admin Command Center'
      setMessages([{ role: 'nexus', text: `I'm in context. ${ctx} What would you like to know?` }])
    }
  }, [activeTabId])

  async function send() {
    if (!input.trim() || loading) return
    const userMsg = input.trim()
    setInput('')
    const newMessages = [...messages, { role: 'user' as const, text: userMsg }]
    setMessages(newMessages)
    setLoading(true)

    const tabContext = NEXUS_CONTEXT_BY_TAB[activeTabId] ?? 'the Admin Command Center'
    const history = newMessages.slice(-8).map(m => `${m.role === 'nexus' ? 'NEXUS' : 'Owner'}: ${m.text}`).join('\n')
    const response = await fetchInsight(
      `You are NEXUS, the AI advisor embedded inside the Admin Command Center for Power On Solutions, LLC — a California electrical contractor SaaS platform. You have full read access to all visible data in the current tab. Context: ${tabContext}. Answer concisely and specifically. Reference actual data and metrics when relevant. If asked about compliance, economics, sessions, or beta status — use your knowledge of the platform's current state.`,
      `Conversation so far:\n${history}\n\nRespond to the owner's last message.`
    )

    // Save to ECHO memory
    try {
      await supabase.from('improvement_log').insert({
        title: `NEXUS Command Center — ${new Date().toLocaleDateString()}`,
        category: 'AI Conversation',
        priority: 'Low',
        notes: `Tab: ${activeTabId}\nQ: ${userMsg}\nA: ${response}`,
        source: 'auto',
        admin_added: false,
      })
    } catch {
      // silent
    }

    setMessages(prev => [...prev, { role: 'nexus', text: response }])
    setLoading(false)
  }

  if (collapsed) {
    return (
      <div style={{ flexShrink: 0 }}>
        <button
          onClick={() => setCollapsed(false)}
          style={{
            width: 40, height: 40, borderRadius: '50%', border: '1px solid #1e3a2f',
            backgroundColor: '#0a1a12', color: '#2EE89A', fontSize: 18, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 12px rgba(46,232,154,0.15)',
          }}
          title="Expand NEXUS"
        >
          ⬡
        </button>
      </div>
    )
  }

  return (
    <div style={{
      flexShrink: 0,
      width: orbExpanded ? 640 : 420,
      display: 'flex',
      flexDirection: 'column',
      backgroundColor: '#0a0f1a',
      borderLeft: '1px solid #1e2d3d',
      height: '100%',
      transition: 'width 0.2s',
    }}>
      {/* NEXUS panel header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
        borderBottom: '1px solid #1e2d3d', flexShrink: 0, backgroundColor: '#0d1321',
      }}>
        <div style={{
          width: 8, height: 8, borderRadius: '50%', backgroundColor: '#2EE89A',
          boxShadow: '0 0 6px rgba(46,232,154,0.6)',
        }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: '#4ade80', flex: 1 }}>NEXUS</span>
        <button
          onClick={() => setOrbExpanded(e => !e)}
          style={{
            fontSize: 10, padding: '3px 8px', borderRadius: 5, border: '1px solid #1e3a2f',
            backgroundColor: 'transparent', color: '#4b5563', cursor: 'pointer',
          }}
        >
          {orbExpanded ? '◀ Hide Orb' : '▶ Show Orb'}
        </button>
        <button
          onClick={() => setCollapsed(true)}
          style={{
            fontSize: 14, padding: '3px 8px', borderRadius: 5, border: '1px solid #1e2d3d',
            backgroundColor: 'transparent', color: '#4b5563', cursor: 'pointer',
          }}
        >
          ✕
        </button>
      </div>

      {/* Orb + Chat split */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {orbExpanded && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '12px 0', borderBottom: '1px solid #0e1a0e', flexShrink: 0,
          }}>
            <NexusPresenceOrb
              state={loading ? 'processing' : 'inactive'}
              size={200}
            />
          </div>
        )}

        {/* Chat thread */}
        <div style={{
          flex: 1, overflowY: 'auto', padding: '12px 14px',
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          {messages.map((msg, i) => (
            <div key={i} style={{
              display: 'flex', gap: 8,
              flexDirection: msg.role === 'nexus' ? 'row' : 'row-reverse',
            }}>
              <div style={{
                width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                backgroundColor: msg.role === 'nexus' ? '#0e1a12' : '#1f2937',
                border: `1px solid ${msg.role === 'nexus' ? '#2EE89A44' : '#374151'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: 700, color: msg.role === 'nexus' ? '#2EE89A' : '#9ca3af',
              }}>
                {msg.role === 'nexus' ? 'N' : 'Y'}
              </div>
              <div style={{
                maxWidth: '80%', padding: '8px 12px',
                borderRadius: msg.role === 'nexus' ? '4px 10px 10px 10px' : '10px 4px 10px 10px',
                backgroundColor: msg.role === 'nexus' ? '#0d1a12' : '#1a2535',
                border: `1px solid ${msg.role === 'nexus' ? '#2EE89A22' : '#374151'}`,
                fontSize: 12, color: msg.role === 'nexus' ? '#a7f3d0' : '#d1d5db', lineHeight: 1.6,
              }}>
                {msg.text}
              </div>
            </div>
          ))}
          {loading && (
            <div style={{ fontSize: 11, color: '#2EE89A', fontStyle: 'italic', paddingLeft: 32 }}>NEXUS thinking…</div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input */}
        <div style={{
          display: 'flex', gap: 8, padding: '10px 14px',
          borderTop: '1px solid #1e2d3d', flexShrink: 0,
        }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            placeholder="Ask NEXUS about this data…"
            style={{
              flex: 1, padding: '8px 12px', borderRadius: 7,
              border: '1px solid #1e3a2f', backgroundColor: '#060d0a',
              color: '#d1d5db', fontSize: 12, outline: 'none',
            }}
          />
          <button
            onClick={send}
            disabled={loading || !input.trim()}
            style={{
              padding: '8px 14px', borderRadius: 7, border: '1px solid #2EE89A44',
              backgroundColor: '#0e1a12', color: '#2EE89A', fontSize: 12, fontWeight: 700,
              cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.5 : 1,
            }}
          >
            ↑
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Root: AdminCommandCenter ─────────────────────────────────────────────────
export default function AdminCommandCenter() {
  const [activeTab, setActiveTab] = useState('vision')
  const [nexusOpen, setNexusOpen] = useState(false)

  function renderTab() {
    switch (activeTab) {
      case 'vision':      return <Tab1VisionTimeline />
      case 'backend':     return <Tab2BackendAnalysis />
      case 'beta':        return <Tab3BetaMetrics />
      case 'economics':   return <Tab4Economics />
      case 'improvelog':  return <Tab5ImprovementLog />
      case 't6':          return <Tab6SummaryChecklist />
      case 't7':          return <Tab7ScriptsPositioning />
      case 't8':          return <Tab8AIAgentOrganization />
      case 't9':          return <Tab9IndustryAnalysis />
      case 't10':         return <Tab10Compliance />
      case 't11':         return <Tab11ActionsQueue activeTabId={activeTab} />
      case 't12':         return <Tab12SplitView />
      case 't13':         return <Tab13UnifiedCommand />
      case 'neural_map':  return <CommandCenterNeuralMap />
      default:            return <Tab1VisionTimeline />
    }
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'row',
      height: '100%',
      minHeight: '100vh',
      backgroundColor: '#0a0f1a',
      color: '#e2e8f0',
    }}>
      {/* Main area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
        {/* Header */}
        <div style={{
          borderBottom: '1px solid #1e2d3d',
          padding: '12px 24px 0',
          backgroundColor: '#0d1321',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <span style={{ fontSize: 16 }}>⌘</span>
            <h1 style={{ fontSize: 16, fontWeight: 800, color: '#e2e8f0', margin: 0 }}>Admin Command Center</h1>
            <span style={{
              fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
              backgroundColor: '#ca8a04', color: '#fff', letterSpacing: '0.05em',
            }}>B40</span>
            <div style={{ flex: 1 }} />
            {/* NEXUS toggle button */}
            <button
              onClick={() => setNexusOpen(o => !o)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px',
                borderRadius: 7, border: '1px solid #1e3a2f',
                backgroundColor: nexusOpen ? '#0e1a12' : 'transparent',
                color: nexusOpen ? '#2EE89A' : '#4b5563', fontSize: 11, fontWeight: 700,
                cursor: 'pointer', transition: 'all 0.15s',
              }}
            >
              <span style={{
                width: 7, height: 7, borderRadius: '50%', backgroundColor: nexusOpen ? '#2EE89A' : '#374151',
                boxShadow: nexusOpen ? '0 0 6px rgba(46,232,154,0.6)' : 'none',
                display: 'inline-block',
              }} />
              NEXUS
            </button>
          </div>
          {/* Tab bar */}
          <div style={{ display: 'flex', gap: 2, overflowX: 'auto', paddingBottom: 1 }}>
            {TABS.map(tab => {
              const isActive = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    padding: '8px 14px',
                    fontSize: 12,
                    fontWeight: isActive ? 700 : 500,
                    borderRadius: '6px 6px 0 0',
                    border: 'none',
                    borderBottom: isActive ? '2px solid #3b82f6' : '2px solid transparent',
                    backgroundColor: isActive ? '#1e2d3d' : 'transparent',
                    color: isActive ? '#93c5fd' : '#6b7280',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    transition: 'all 0.15s',
                  }}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Content area */}
        <div style={{
          flex: 1,
          overflowY: (activeTab === 'neural_map' || activeTab === 't12' || activeTab === 't13') ? 'hidden' : 'auto',
          overflow: (activeTab === 'neural_map' || activeTab === 't12' || activeTab === 't13') ? 'hidden' : undefined,
          padding: (activeTab === 'neural_map' || activeTab === 't12' || activeTab === 't13') ? '0' : '24px',
          display: (activeTab === 'neural_map' || activeTab === 't12' || activeTab === 't13') ? 'flex' : undefined,
          flexDirection: (activeTab === 'neural_map' || activeTab === 't12' || activeTab === 't13') ? 'column' : undefined,
          minHeight: 0,
        }}>
          {renderTab()}
        </div>
      </div>

      {/* NEXUS side panel */}
      {nexusOpen && (
        <NexusCommandPanel activeTabId={activeTab} />
      )}
    </div>
  )
}
