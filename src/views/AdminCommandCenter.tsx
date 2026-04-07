// @ts-nocheck
/**
 * AdminCommandCenter.tsx — B37 | Admin Command Center
 *
 * Full-screen admin panel with 11 sub-tabs.
 * B36: Tabs 1–3 implemented. B37: Tabs 4–5 (Economics + Improvement Log).
 *
 * Admin-only: gated in V15rLayout sidebar (email matches VITE_ADMIN_EMAIL).
 */

import { useState, useEffect, useCallback } from 'react'
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, Tooltip,
  FunnelChart, Funnel, LabelList, Cell,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  AreaChart, Area, Legend,
} from 'recharts'
import { callClaude, extractText } from '@/services/claudeProxy'
import { getBackupData } from '@/services/backupDataService'
import { supabase } from '@/lib/supabase'

// ─── Tab definitions ──────────────────────────────────────────────────────────
const TABS = [
  { id: 'vision',   label: '1 · Vision Timeline' },
  { id: 'backend',  label: '2 · Backend Analysis' },
  { id: 'beta',     label: '3 · Beta Metrics' },
  { id: 'economics',  label: '4 · Economics' },
  { id: 'improvelog', label: '5 · Improvement Log' },
  { id: 't6',       label: '6' },
  { id: 't7',       label: '7' },
  { id: 't8',       label: '8' },
  { id: 't9',       label: '9' },
  { id: 't10',      label: '10' },
  { id: 't11',      label: '11' },
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

// ─── Coming Soon placeholder for tabs 4–11 ────────────────────────────────────
function PlaceholderTab({ num }: { num: number }) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 320,
      gap: 12,
    }}>
      <div style={{ fontSize: 40, opacity: 0.3 }}>⚙</div>
      <p style={{ fontSize: 15, fontWeight: 700, color: '#374151' }}>Tab {num} — Coming Soon</p>
      <p style={{ fontSize: 13, color: '#4b5563', textAlign: 'center', maxWidth: 340 }}>
        This panel is reserved for a future build session.
      </p>
    </div>
  )
}

// ─── Root: AdminCommandCenter ─────────────────────────────────────────────────
export default function AdminCommandCenter() {
  const [activeTab, setActiveTab] = useState('vision')

  function renderTab() {
    switch (activeTab) {
      case 'vision':  return <Tab1VisionTimeline />
      case 'backend': return <Tab2BackendAnalysis />
      case 'beta':    return <Tab3BetaMetrics />
      case 'economics':  return <Tab4Economics />
      case 'improvelog': return <Tab5ImprovementLog />
      case 't6':      return <PlaceholderTab num={6} />
      case 't7':      return <PlaceholderTab num={7} />
      case 't8':      return <PlaceholderTab num={8} />
      case 't9':      return <PlaceholderTab num={9} />
      case 't10':     return <PlaceholderTab num={10} />
      case 't11':     return <PlaceholderTab num={11} />
      default:        return <Tab1VisionTimeline />
    }
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      minHeight: '100vh',
      backgroundColor: '#0a0f1a',
      color: '#e2e8f0',
    }}>
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
          }}>B37</span>
        </div>
        {/* Tab bar */}
        <div style={{ display: 'flex', gap: 2, overflowX: 'auto', paddingBottom: 1 }}>
          {TABS.map(tab => {
            const isActive = activeTab === tab.id
            const isPlaceholder = tab.id.startsWith('t') && tab.id.length <= 3 && !['t4'].includes(tab.id) ? false : tab.id.startsWith('t') && parseInt(tab.id.slice(1)) >= 4
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
                  color: isActive ? '#93c5fd' : isPlaceholder ? '#374151' : '#6b7280',
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
        overflowY: 'auto',
        padding: '24px',
      }}>
        {renderTab()}
      </div>
    </div>
  )
}
