// @ts-nocheck
/**
 * AdminCommandCenter.tsx — B36 | Admin Command Center
 *
 * Full-screen admin panel with 11 sub-tabs.
 * This session: Tabs 1–3 implemented. Tabs 4–11 are placeholder panels.
 *
 * Admin-only: gated in V15rLayout sidebar (email matches VITE_ADMIN_EMAIL).
 */

import { useState, useEffect, useCallback } from 'react'
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, Tooltip,
  FunnelChart, Funnel, LabelList, Cell,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts'
import { callClaude, extractText } from '@/services/claudeProxy'
import { getBackupData } from '@/services/backupDataService'
import { supabase } from '@/lib/supabase'

// ─── Tab definitions ──────────────────────────────────────────────────────────
const TABS = [
  { id: 'vision',   label: '1 · Vision Timeline' },
  { id: 'backend',  label: '2 · Backend Analysis' },
  { id: 'beta',     label: '3 · Beta Metrics' },
  { id: 't4',       label: '4' },
  { id: 't5',       label: '5' },
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
      case 't4':      return <PlaceholderTab num={4} />
      case 't5':      return <PlaceholderTab num={5} />
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
          }}>B36</span>
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
