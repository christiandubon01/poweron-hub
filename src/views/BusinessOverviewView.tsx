// @ts-nocheck
/**
 * BusinessOverviewView.tsx — B68 | Business Overview Split View
 *
 * Full-width two-column split view:
 *   LEFT  — Power On Solutions LLC (Electrical Pipeline)
 *   RIGHT — PowerOn Hub (Software Pipeline — Projection Mode)
 *
 * Combined summary row at top.
 * RMO Deal panel at bottom, full width.
 */

import React, { useState, useEffect, useMemo, useRef } from 'react'
import {
  getBackupData,
  getKPIs,
  health,
  num,
  fmtK,
  getProjectFinancials,
  resolveProjectBucket,
  fmt,
  type BackupData,
  type BackupProject,
} from '@/services/backupDataService'
import CFOTChart from '@/components/v15r/charts/CFOTChart'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { callClaude, extractText } from '@/services/claudeProxy'

// ── Tier pricing ───────────────────────────────────────────────────────────────
const TIER_PRICES: Record<string, number> = {
  Solo: 29,
  Growth: 79,
  Pro: 149,
  'Pro+': 249,
}

// ── Default projection factors ─────────────────────────────────────────────────
const DEFAULT_FACTORS = {
  betaUsers: 80,
  convRate: 12,
  avgTier: 'Growth',
  churnRate: 5,
  dataLicensingMonth: 18,
  rmoActive: false,
  investmentFactor: 0,
}

// ── Projection calculation ─────────────────────────────────────────────────────
function calcProjections(f: typeof DEFAULT_FACTORS) {
  const tierPrice = TIER_PRICES[f.avgTier] ?? 79
  const startingMRR = f.betaUsers * (f.convRate / 100) * tierPrice
  const monthlyChurn = f.churnRate / 100
  // Add data licensing at activation month (~$1,200/mo placeholder)
  const DATA_LICENSE_MRR = 1200
  // Add RMO monthly revenue (~$3,500/mo placeholder)
  const RMO_MRR = 3500

  function mrrAt(month: number): number {
    if (month < 6) return 0
    const base = startingMRR * Math.pow(1 - monthlyChurn, month - 6)
    const dlRevenue = month >= f.dataLicensingMonth ? DATA_LICENSE_MRR : 0
    const rmoRevenue = f.rmoActive ? RMO_MRR : 0
    return base + dlRevenue + rmoRevenue
  }

  const mrr6  = mrrAt(6)
  const mrr12 = mrrAt(12)
  const mrr18 = mrrAt(18)
  const mrr24 = mrrAt(24)
  const arr24 = mrr24 * 12

  // Break-even: month where cumulative MRR > 0 (simplistic: month 6 + when base MRR covers some baseline)
  const MONTHLY_COSTS_BASELINE = 500
  let breakEvenMonth = 0
  for (let m = 6; m <= 48; m++) {
    if (mrrAt(m) >= MONTHLY_COSTS_BASELINE) {
      breakEvenMonth = m
      break
    }
  }

  return {
    mrr6, mrr12, mrr18, mrr24,
    arr24,
    val8x:  arr24 * 8,
    val15x: arr24 * 15,
    breakEvenMonth,
  }
}

// ── Magnitude calculator: how much does each factor move 24-month ARR? ─────────
function calcMagnitudes(baseFactors: typeof DEFAULT_FACTORS) {
  const baseARR = calcProjections(baseFactors).arr24

  function deltaARR(overrides: Partial<typeof DEFAULT_FACTORS>): number {
    const mod = { ...baseFactors, ...overrides }
    return Math.abs(calcProjections(mod).arr24 - baseARR)
  }

  const deltas: Record<string, number> = {
    betaUsers:           deltaARR({ betaUsers: Math.max(1, baseFactors.betaUsers * 1.2) }),
    convRate:            deltaARR({ convRate: Math.min(100, baseFactors.convRate * 1.2) }),
    avgTier:             (() => {
      const keys = Object.keys(TIER_PRICES)
      const idx = keys.indexOf(baseFactors.avgTier)
      const nextTier = keys[Math.min(idx + 1, keys.length - 1)]
      return deltaARR({ avgTier: nextTier })
    })(),
    churnRate:           deltaARR({ churnRate: Math.max(0, baseFactors.churnRate - 1) }),
    dataLicensingMonth:  deltaARR({ dataLicensingMonth: Math.max(6, baseFactors.dataLicensingMonth - 3) }),
    rmoActive:           deltaARR({ rmoActive: !baseFactors.rmoActive }),
    investmentFactor:    baseFactors.investmentFactor > 0 ? baseFactors.investmentFactor * 0.02 : 0,
  }

  const maxDelta = Math.max(...Object.values(deltas), 1)
  const magnitudes: Record<string, number> = {}
  for (const k of Object.keys(deltas)) {
    magnitudes[k] = Math.min(1, deltas[k] / maxDelta)
  }
  return magnitudes
}

// ── Formatting helpers ─────────────────────────────────────────────────────────
const fmtDollar = (v: number) =>
  v >= 1_000_000
    ? `$${(v / 1_000_000).toFixed(2)}M`
    : v >= 1_000
    ? `$${(v / 1_000).toFixed(0)}k`
    : `$${v.toFixed(0)}`

// ── Inline icon stubs ──────────────────────────────────────────────────────────
const Icon = {
  Zap: ({ size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  ),
  TrendingUp: ({ size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" />
    </svg>
  ),
  DollarSign: ({ size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  ),
  AlertTriangle: ({ size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  Save: ({ size = 14 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" />
    </svg>
  ),
  Upload: ({ size = 14 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 16 12 12 8 16" /><line x1="12" y1="12" x2="12" y2="21" /><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
    </svg>
  ),
  Brain: ({ size = 14 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.46 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.44-4.14Z" /><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.46 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.44-4.14Z" />
    </svg>
  ),
  Plus: ({ size = 14 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
  Trash: ({ size = 14 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  ),
}

// ── Color helpers ──────────────────────────────────────────────────────────────
function healthColor(score: number) {
  if (score >= 70) return '#22c55e'
  if (score >= 50) return '#f59e0b'
  if (score >= 30) return '#f97316'
  return '#ef4444'
}

function statusBadge(status: string) {
  const s = (status || '').toLowerCase()
  if (s === 'active')    return { bg: 'rgba(34,197,94,0.12)', color: '#22c55e', label: 'Active' }
  if (s === 'coming')    return { bg: 'rgba(59,130,246,0.12)', color: '#60a5fa', label: 'Coming' }
  if (s === 'completed') return { bg: 'rgba(100,116,139,0.12)', color: '#94a3b8', label: 'Done' }
  return { bg: 'rgba(100,116,139,0.1)', color: '#6b7280', label: status }
}

// ── Panel header style ─────────────────────────────────────────────────────────
const PANEL_STYLE: React.CSSProperties = {
  backgroundColor: '#0d1117',
  border: '1px solid rgba(255,255,255,0.07)',
  borderRadius: 12,
  padding: 20,
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  flex: 1,
  minWidth: 0,
}

const SECTION_TITLE: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: '#4b5563',
  marginBottom: 8,
}

// ── Metric card ────────────────────────────────────────────────────────────────
function MetricCard({ label, value, color = '#d1d5db', sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div style={{
      backgroundColor: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: 8,
      padding: '10px 14px',
      flex: 1,
      minWidth: 0,
    }}>
      <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color, fontFamily: 'ui-monospace, monospace' }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: '#4b5563', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

// ── Magnitude bar ──────────────────────────────────────────────────────────────
function MagnitudeBar({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  const color = pct >= 70 ? '#22c55e' : pct >= 40 ? '#f59e0b' : '#60a5fa'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, maxWidth: 80 }}>
      <div style={{ flex: 1, height: 4, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', backgroundColor: color, borderRadius: 2, transition: 'width 0.4s' }} />
      </div>
      <span style={{ fontSize: 9, color: '#4b5563', minWidth: 24, textAlign: 'right' }}>{pct}%</span>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────────
//  MAIN VIEW
// ────────────────────────────────────────────────────────────────────────────────
export default function BusinessOverviewView() {
  const { profile } = useAuth()
  const userId = profile?.id ?? 'anonymous'

  // ── Local/backup data ──────────────────────────────────────────────────────
  const backup = useMemo<BackupData | null>(() => getBackupData(), [])
  const kpis = useMemo(() => (backup ? getKPIs(backup) : null), [backup])

  // Last 5 active+coming projects
  const recentProjects = useMemo<BackupProject[]>(() => {
    if (!backup) return []
    const all = (backup.projects || []).filter(p => {
      const b = resolveProjectBucket(p)
      return b === 'active' || b === 'coming'
    })
    return all.slice(-5).reverse()
  }, [backup])

  // Weekly data for CFOT chart
  const weeklyData = useMemo(() => (backup?.weeklyData || []).filter(w => !w._empty), [backup])

  // Service net (svc collected - svc quoted balance)
  const serviceNet = useMemo(() => {
    if (!backup) return 0
    const logs = backup.serviceLogs || []
    return logs.reduce((s, l) => s + num(l.collected), 0)
  }, [backup])

  // ── Software projection factors ────────────────────────────────────────────
  const [factors, setFactors] = useState(DEFAULT_FACTORS)
  const [factorsSaved, setFactorsSaved] = useState(false)
  const [savingFactors, setSavingFactors] = useState(false)

  // Software revenue sources — each can be toggled Active
  const [swActivated, setSwActivated] = useState({
    saas: false,
    dataLicensing: false,
    rmo: false,
  })

  // Revenue log entries per source (when activated)
  const [swLogs, setSwLogs] = useState<Record<string, Array<{ date: string; amount: string; source: string; notes: string }>>>({
    saas: [],
    dataLicensing: [],
    rmo: [],
  })

  // ── RMO panel state ────────────────────────────────────────────────────────
  const [rmoDealTerms, setRmoDealTerms] = useState('')
  const [rmoDocName, setRmoDocName] = useState<string | null>(null)
  const [rmoDocUploading, setRmoDocUploading] = useState(false)
  const [rmoAnalysis, setRmoAnalysis] = useState<string | null>(null)
  const [rmoAnalyzing, setRmoAnalyzing] = useState(false)
  const rmoFileRef = useRef<HTMLInputElement>(null)

  // ── Load saved projection factors from Supabase ────────────────────────────
  useEffect(() => {
    if (!userId || userId === 'anonymous') return
    supabase
      .from('business_projections' as never)
      .select('*')
      .eq('user_id', userId)
      .then(({ data, error }: any) => {
        if (error || !data) return
        const obj: Record<string, any> = {}
        for (const row of data) {
          obj[row.key] = row.value
        }
        if (Object.keys(obj).length > 0) {
          setFactors(prev => ({
            ...prev,
            betaUsers:          obj.betaUsers       != null ? Number(obj.betaUsers)       : prev.betaUsers,
            convRate:           obj.convRate         != null ? Number(obj.convRate)         : prev.convRate,
            avgTier:            obj.avgTier          ?? prev.avgTier,
            churnRate:          obj.churnRate        != null ? Number(obj.churnRate)        : prev.churnRate,
            dataLicensingMonth: obj.dataLicensingMonth != null ? Number(obj.dataLicensingMonth) : prev.dataLicensingMonth,
            rmoActive:          obj.rmoActive        != null ? obj.rmoActive === 'true' || obj.rmoActive === true : prev.rmoActive,
            investmentFactor:   obj.investmentFactor != null ? Number(obj.investmentFactor) : prev.investmentFactor,
          }))
        }
        if (obj.rmoDealTerms) setRmoDealTerms(obj.rmoDealTerms)
        if (obj.rmoDocName) setRmoDocName(obj.rmoDocName)
      })
      .catch(() => {/* offline — ok */})
  }, [userId])

  // ── Save projection factors ────────────────────────────────────────────────
  async function saveFactors() {
    if (userId === 'anonymous') return
    setSavingFactors(true)
    const entries = Object.entries({
      ...factors,
      rmoDealTerms,
      rmoDocName: rmoDocName ?? '',
    })
    const rows = entries.map(([key, value]) => ({
      user_id: userId,
      key,
      value: String(value),
      updated_at: new Date().toISOString(),
    }))
    for (const row of rows) {
      await supabase
        .from('business_projections' as never)
        .upsert(row, { onConflict: 'user_id,key' })
        .catch(() => {/* offline — ok */})
    }
    setSavingFactors(false)
    setFactorsSaved(true)
    setTimeout(() => setFactorsSaved(false), 3000)
  }

  // ── Projections ────────────────────────────────────────────────────────────
  const proj = useMemo(() => calcProjections(factors), [factors])
  const magnitudes = useMemo(() => calcMagnitudes(factors), [factors])

  // ── Combined row values ────────────────────────────────────────────────────
  const electricalPipeline = kpis?.pipeline ?? 0
  const electricalCollected = kpis?.paid ?? 0
  const combinedPipeline = electricalPipeline + proj.arr24
  const combinedARR = proj.arr24
  const combinedCollected = electricalCollected

  // ── Revenue log helpers ────────────────────────────────────────────────────
  function addLogEntry(source: string) {
    setSwLogs(prev => ({
      ...prev,
      [source]: [...(prev[source] || []), { date: new Date().toISOString().slice(0, 10), amount: '', source: '', notes: '' }],
    }))
  }
  function updateLogEntry(source: string, idx: number, field: string, val: string) {
    setSwLogs(prev => {
      const entries = [...(prev[source] || [])]
      entries[idx] = { ...entries[idx], [field]: val }
      return { ...prev, [source]: entries }
    })
  }
  function removeLogEntry(source: string, idx: number) {
    setSwLogs(prev => {
      const entries = [...(prev[source] || [])]
      entries.splice(idx, 1)
      return { ...prev, [source]: entries }
    })
  }

  // ── RMO doc upload ─────────────────────────────────────────────────────────
  async function handleRmoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setRmoDocUploading(true)
    const path = `rmo-docs/${userId}/${Date.now()}_${file.name}`
    const { error } = await supabase.storage.from('blueprints').upload(path, file)
    if (!error) {
      setRmoDocName(file.name)
    }
    setRmoDocUploading(false)
  }

  // ── NEXUS AI analysis for RMO ──────────────────────────────────────────────
  async function runNexusRmoAnalysis() {
    if (!rmoDealTerms && !rmoDocName) return
    setRmoAnalyzing(true)
    setRmoAnalysis(null)
    try {
      const solarIncome = kpis ? `Pipeline: ${fmtDollar(kpis.pipeline)}, Collected: ${fmtDollar(kpis.paid)}` : 'No data'
      const prompt = `You are NEXUS, the AI advisor for Power On Solutions. Analyze the following RMO (Remote Monitoring Operations) deal for MTZ Solar Enterprise.

DEAL TERMS:
${rmoDealTerms || '(No deal terms entered)'}

${rmoDocName ? `DOCUMENT ATTACHED: ${rmoDocName}` : ''}

CURRENT BUSINESS CONTEXT:
${solarIncome}
Projected SaaS ARR (24mo): ${fmtDollar(proj.arr24)}

Please return a structured analysis with:
1. KEY RISKS IDENTIFIED (bullet points)
2. CLAUSES TO REVIEW WITH ATTORNEY (bullet points)
3. INCOME SCENARIOS (3 scenarios: conservative, moderate, optimistic)
4. QUESTIONS YOU MAY HAVE OVERLOOKED (bullet points)

Be concise and actionable. Format with clear section headers.`

      const raw = await callClaude([{ role: 'user', content: prompt }])
      setRmoAnalysis(extractText(raw))
    } catch (err: any) {
      setRmoAnalysis(`Error: ${err?.message ?? 'Failed to connect to NEXUS'}`)
    }
    setRmoAnalyzing(false)
  }

  // ────────────────────────────────────────────────────────────────────────────
  //  RENDER
  // ────────────────────────────────────────────────────────────────────────────
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 16,
      padding: '20px 20px 40px',
      backgroundColor: '#080b10',
      minHeight: '100%',
      fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      color: '#d1d5db',
    }}>

      {/* ── COMBINED HEADER ROW ─────────────────────────────────────────────── */}
      <div style={{
        display: 'flex',
        gap: 12,
        backgroundColor: '#0d1117',
        border: '1px solid rgba(255,255,255,0.07)',
        borderRadius: 12,
        padding: '14px 20px',
        alignItems: 'center',
        flexWrap: 'wrap',
      }}>
        <div style={{ flex: 1, minWidth: 120 }}>
          <div style={{ fontSize: 10, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Combined Pipeline</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#22c55e', fontFamily: 'ui-monospace, monospace' }}>{fmtDollar(combinedPipeline)}</div>
          <div style={{ fontSize: 10, color: '#374151' }}>Electrical + Software (Projected ARR)</div>
        </div>
        <div style={{ width: 1, height: 40, backgroundColor: 'rgba(255,255,255,0.07)' }} />
        <div style={{ flex: 1, minWidth: 120 }}>
          <div style={{ fontSize: 10, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Combined Projected ARR</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#60a5fa', fontFamily: 'ui-monospace, monospace' }}>{fmtDollar(combinedARR)}</div>
          <div style={{ fontSize: 10, color: '#374151' }}>Software @ 24 months</div>
        </div>
        <div style={{ width: 1, height: 40, backgroundColor: 'rgba(255,255,255,0.07)' }} />
        <div style={{ flex: 1, minWidth: 120 }}>
          <div style={{ fontSize: 10, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Combined Actual Collected</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#a3e635', fontFamily: 'ui-monospace, monospace' }}>{fmtDollar(combinedCollected)}</div>
          <div style={{ fontSize: 10, color: '#374151' }}>Electrical only (real payments)</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, backgroundColor: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.2)', borderRadius: 8, padding: '4px 12px' }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#16a34a', boxShadow: '0 0 6px #16a34a' }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: '#16a34a', letterSpacing: '0.08em' }}>BUSINESS OVERVIEW</span>
          </div>
        </div>
      </div>

      {/* ── TWO-COLUMN SPLIT ────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>

        {/* ────────────────────────── LEFT PANEL (ELECTRICAL) ─────────────── */}
        <div style={{ ...PANEL_STYLE, minWidth: 320 }}>
          {/* Title */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon.Zap size={14} />
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#fbbf24' }}>
              POWER ON SOLUTIONS LLC — ELECTRICAL PIPELINE
            </span>
          </div>

          {/* Metrics row */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <MetricCard label="Pipeline"    value={fmtDollar(kpis?.pipeline ?? 0)}    color="#22c55e" />
            <MetricCard label="Collected"   value={fmtDollar(kpis?.paid ?? 0)}         color="#a3e635" />
            <MetricCard label="Exposure"    value={fmtDollar(kpis?.exposure ?? 0)}     color="#f97316" />
            <MetricCard label="Open RFIs"   value={String(kpis?.openRfis ?? 0)}        color="#f59e0b" />
            <MetricCard label="Service Net" value={fmtDollar(serviceNet)}              color="#60a5fa" />
          </div>

          {/* Last 5 projects */}
          <div>
            <div style={SECTION_TITLE}>Last 5 Active / Coming Projects</div>
            {recentProjects.length === 0 ? (
              <div style={{ fontSize: 12, color: '#4b5563', padding: '12px 0' }}>No active or coming projects found.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {recentProjects.map(p => {
                  const fin = backup ? getProjectFinancials(p, backup) : null
                  const h   = backup ? health(p, backup) : null
                  const badge = statusBadge(p.status)
                  const collPct = fin && fin.contract > 0 ? Math.round((fin.paid / fin.contract) * 100) : 0
                  return (
                    <div key={p.id} style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      backgroundColor: 'rgba(255,255,255,0.02)',
                      border: '1px solid rgba(255,255,255,0.05)',
                      borderRadius: 8,
                      padding: '8px 12px',
                    }}>
                      {/* Status badge */}
                      <span style={{ fontSize: 9, fontWeight: 700, backgroundColor: badge.bg, color: badge.color, padding: '2px 7px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.06em', minWidth: 44, textAlign: 'center' }}>
                        {badge.label}
                      </span>
                      {/* Name */}
                      <span style={{ flex: 1, fontSize: 12, color: '#d1d5db', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.name}
                      </span>
                      {/* Contract */}
                      <span style={{ fontSize: 11, color: '#9ca3af', minWidth: 60, textAlign: 'right' }}>
                        {fmtDollar(fin?.contract ?? num(p.contract))}
                      </span>
                      {/* Health score */}
                      {h && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 42 }}>
                          <div style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: healthColor(h.sc) }} />
                          <span style={{ fontSize: 10, color: healthColor(h.sc), fontWeight: 700 }}>{h.sc}</span>
                        </div>
                      )}
                      {/* Collection status */}
                      <span style={{ fontSize: 10, color: collPct >= 90 ? '#22c55e' : collPct >= 50 ? '#f59e0b' : '#ef4444', minWidth: 32, textAlign: 'right' }}>
                        {collPct}%
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* CFOT Chart */}
          <div>
            <div style={SECTION_TITLE}>Cash Flow Over Time</div>
            {weeklyData.length > 0 && backup ? (
              <div style={{ height: 200 }}>
                <CFOTChart data={weeklyData} backup={backup} />
              </div>
            ) : (
              <div style={{ height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4b5563', fontSize: 12 }}>
                No weekly cash flow data available.
              </div>
            )}
          </div>
        </div>

        {/* ─────────────────────── RIGHT PANEL (SOFTWARE) ──────────────────── */}
        <div style={{ ...PANEL_STYLE, minWidth: 320 }}>
          {/* Title + projection mode badge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Icon.TrendingUp size={14} />
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#818cf8' }}>
              POWERON HUB — SOFTWARE PIPELINE
            </span>
            <span style={{ fontSize: 9, fontWeight: 700, backgroundColor: 'rgba(139,92,246,0.12)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.2)', borderRadius: 20, padding: '2px 9px', letterSpacing: '0.1em' }}>
              PROJECTION MODE
            </span>
          </div>

          {/* Projection factors */}
          <div>
            <div style={SECTION_TITLE}>Projection Factors</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

              {/* Beta Users */}
              <FactorRow
                label="Beta users at month 6"
                magnitude={magnitudes.betaUsers}
                input={
                  <input
                    type="number"
                    value={factors.betaUsers}
                    min={0}
                    onChange={e => setFactors(f => ({ ...f, betaUsers: Number(e.target.value) }))}
                    style={inputStyle}
                  />
                }
              />

              {/* Conversion Rate */}
              <FactorRow
                label="Conversion rate to paid %"
                magnitude={magnitudes.convRate}
                input={
                  <input
                    type="number"
                    value={factors.convRate}
                    min={0}
                    max={100}
                    step={0.5}
                    onChange={e => setFactors(f => ({ ...f, convRate: Number(e.target.value) }))}
                    style={inputStyle}
                  />
                }
              />

              {/* Average Tier */}
              <FactorRow
                label="Average tier selected"
                magnitude={magnitudes.avgTier}
                input={
                  <select
                    value={factors.avgTier}
                    onChange={e => setFactors(f => ({ ...f, avgTier: e.target.value }))}
                    style={{ ...inputStyle, cursor: 'pointer' }}
                  >
                    {Object.entries(TIER_PRICES).map(([tier, price]) => (
                      <option key={tier} value={tier}>{tier} (${price}/mo)</option>
                    ))}
                  </select>
                }
              />

              {/* Monthly Churn */}
              <FactorRow
                label="Monthly churn rate %"
                magnitude={magnitudes.churnRate}
                input={
                  <input
                    type="number"
                    value={factors.churnRate}
                    min={0}
                    max={100}
                    step={0.5}
                    onChange={e => setFactors(f => ({ ...f, churnRate: Number(e.target.value) }))}
                    style={inputStyle}
                  />
                }
              />

              {/* Data Licensing Month */}
              <FactorRow
                label="Data licensing activation month"
                magnitude={magnitudes.dataLicensingMonth}
                input={
                  <input
                    type="number"
                    value={factors.dataLicensingMonth}
                    min={6}
                    max={48}
                    onChange={e => setFactors(f => ({ ...f, dataLicensingMonth: Number(e.target.value) }))}
                    style={inputStyle}
                  />
                }
              />

              {/* RMO Toggle */}
              <FactorRow
                label="RMO activation"
                magnitude={magnitudes.rmoActive}
                input={
                  <button
                    onClick={() => setFactors(f => ({ ...f, rmoActive: !f.rmoActive }))}
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '4px 10px',
                      borderRadius: 6,
                      border: 'none',
                      cursor: 'pointer',
                      backgroundColor: factors.rmoActive ? 'rgba(22,163,74,0.2)' : 'rgba(100,116,139,0.15)',
                      color: factors.rmoActive ? '#22c55e' : '#6b7280',
                      transition: 'all 0.2s',
                      letterSpacing: '0.05em',
                    }}
                  >
                    {factors.rmoActive ? 'ACTIVE' : 'PENDING'}
                  </button>
                }
              />

              {/* Investment Factor */}
              <FactorRow
                label="Investment / loan injection ($)"
                magnitude={magnitudes.investmentFactor}
                input={
                  <input
                    type="number"
                    value={factors.investmentFactor}
                    min={0}
                    step={1000}
                    onChange={e => setFactors(f => ({ ...f, investmentFactor: Number(e.target.value) }))}
                    style={inputStyle}
                  />
                }
              />
            </div>
          </div>

          {/* Save button */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              onClick={saveFactors}
              disabled={savingFactors}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 11, fontWeight: 700, padding: '6px 14px',
                borderRadius: 8, border: 'none', cursor: 'pointer',
                backgroundColor: factorsSaved ? 'rgba(22,163,74,0.2)' : 'rgba(99,102,241,0.2)',
                color: factorsSaved ? '#22c55e' : '#818cf8',
                transition: 'all 0.2s',
              }}
            >
              <Icon.Save size={13} />
              {savingFactors ? 'Saving…' : factorsSaved ? 'Saved ✓' : 'Save Factors'}
            </button>
          </div>

          {/* Computed outputs */}
          <div>
            <div style={SECTION_TITLE}>Computed Projections</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <MetricCard label="MRR @ Mo. 6"  value={fmtDollar(proj.mrr6)}  color="#818cf8" />
              <MetricCard label="MRR @ Mo. 12" value={fmtDollar(proj.mrr12)} color="#818cf8" />
              <MetricCard label="MRR @ Mo. 18" value={fmtDollar(proj.mrr18)} color="#a78bfa" />
              <MetricCard label="MRR @ Mo. 24" value={fmtDollar(proj.mrr24)} color="#c4b5fd" />
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              <MetricCard label="ARR @ 24 Mo."   value={fmtDollar(proj.arr24)}  color="#60a5fa" sub="Annual Recurring Revenue" />
              <MetricCard label="Valuation @ 8x"  value={fmtDollar(proj.val8x)}  color="#34d399" sub="8× ARR multiple" />
              <MetricCard label="Valuation @ 15x" value={fmtDollar(proj.val15x)} color="#6ee7b7" sub="15× ARR multiple" />
              <MetricCard label="Break-Even Mo."  value={proj.breakEvenMonth > 0 ? `Mo. ${proj.breakEvenMonth}` : 'N/A'} color="#fbbf24" sub="First cash-positive month" />
            </div>
          </div>

          {/* Revenue source activation toggles */}
          <div>
            <div style={SECTION_TITLE}>Revenue Sources — Activate to Log Real Revenue</div>
            {[
              { key: 'saas', label: 'SaaS Subscriptions' },
              { key: 'dataLicensing', label: 'Data Licensing' },
              { key: 'rmo', label: 'RMO Deal Revenue' },
            ].map(({ key, label }) => (
              <div key={key} style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                  <button
                    onClick={() => setSwActivated(prev => ({ ...prev, [key]: !prev[key] }))}
                    style={{
                      fontSize: 10, fontWeight: 700, padding: '3px 10px',
                      borderRadius: 20, border: 'none', cursor: 'pointer',
                      backgroundColor: swActivated[key] ? 'rgba(22,163,74,0.15)' : 'rgba(100,116,139,0.1)',
                      color: swActivated[key] ? '#22c55e' : '#6b7280',
                      letterSpacing: '0.08em',
                    }}
                  >
                    {swActivated[key] ? '● ACTIVE' : '○ PENDING'}
                  </button>
                  <span style={{ fontSize: 12, color: '#9ca3af' }}>{label}</span>
                  {swActivated[key] && (
                    <button
                      onClick={() => addLogEntry(key)}
                      style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#818cf8', background: 'none', border: 'none', cursor: 'pointer', marginLeft: 'auto' }}
                    >
                      <Icon.Plus size={12} /> Add Entry
                    </button>
                  )}
                </div>
                {swActivated[key] && swLogs[key]?.map((entry, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                    <input type="date"   value={entry.date}   onChange={e => updateLogEntry(key, idx, 'date',   e.target.value)} style={{ ...inputStyle, maxWidth: 120 }} />
                    <input type="number" value={entry.amount} onChange={e => updateLogEntry(key, idx, 'amount', e.target.value)} placeholder="$Amount" style={{ ...inputStyle, maxWidth: 90 }} />
                    <input type="text"   value={entry.source} onChange={e => updateLogEntry(key, idx, 'source', e.target.value)} placeholder="Source label" style={{ ...inputStyle, maxWidth: 120 }} />
                    <input type="text"   value={entry.notes}  onChange={e => updateLogEntry(key, idx, 'notes',  e.target.value)} placeholder="Notes" style={{ ...inputStyle, flex: 1 }} />
                    <button onClick={() => removeLogEntry(key, idx)} style={{ color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer' }}><Icon.Trash size={12} /></button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── RMO PANEL ────────────────────────────────────────────────────────── */}
      <div style={{
        backgroundColor: '#0d1117',
        border: '1px solid rgba(234,179,8,0.15)',
        borderRadius: 12,
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#fbbf24' }}>
            RMO DEAL — MTZ SOLAR ENTERPRISE
          </span>
          <span style={{ fontSize: 9, fontWeight: 700, backgroundColor: 'rgba(234,179,8,0.1)', color: '#fbbf24', border: '1px solid rgba(234,179,8,0.2)', borderRadius: 20, padding: '2px 9px', letterSpacing: '0.1em' }}>
            PENDING ACTIVATION
          </span>
        </div>

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {/* Deal terms */}
          <div style={{ flex: 2, minWidth: 220 }}>
            <div style={SECTION_TITLE}>Deal Terms Summary</div>
            <textarea
              value={rmoDealTerms}
              onChange={e => setRmoDealTerms(e.target.value)}
              placeholder="Enter RMO deal terms, revenue share structure, service obligations, exclusivity clauses, term length, renewal options…"
              style={{
                width: '100%',
                minHeight: 120,
                backgroundColor: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 8,
                color: '#d1d5db',
                fontSize: 12,
                padding: '10px 12px',
                resize: 'vertical',
                boxSizing: 'border-box',
                outline: 'none',
                fontFamily: 'inherit',
              }}
            />
          </div>

          {/* Document upload */}
          <div style={{ flex: 1, minWidth: 160 }}>
            <div style={SECTION_TITLE}>Document Upload (PDF)</div>
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(255,255,255,0.02)',
              border: '1px dashed rgba(255,255,255,0.1)',
              borderRadius: 8,
              padding: '20px 12px',
              cursor: 'pointer',
              gap: 8,
            }}
              onClick={() => rmoFileRef.current?.click()}
            >
              <Icon.Upload size={18} />
              {rmoDocUploading ? (
                <span style={{ fontSize: 11, color: '#9ca3af' }}>Uploading…</span>
              ) : rmoDocName ? (
                <span style={{ fontSize: 11, color: '#22c55e', textAlign: 'center' }}>{rmoDocName}</span>
              ) : (
                <span style={{ fontSize: 11, color: '#6b7280', textAlign: 'center' }}>Click to upload<br />RMO document (PDF)</span>
              )}
            </div>
            <input
              ref={rmoFileRef}
              type="file"
              accept=".pdf"
              style={{ display: 'none' }}
              onChange={handleRmoUpload}
            />
          </div>
        </div>

        {/* NEXUS analysis button */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <button
            onClick={saveFactors}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              fontSize: 11, fontWeight: 700, padding: '7px 14px',
              borderRadius: 8, border: 'none', cursor: 'pointer',
              backgroundColor: 'rgba(99,102,241,0.15)',
              color: '#818cf8',
            }}
          >
            <Icon.Save size={12} /> Save Deal Terms
          </button>

          <button
            onClick={runNexusRmoAnalysis}
            disabled={rmoAnalyzing}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              fontSize: 11, fontWeight: 700, padding: '7px 16px',
              borderRadius: 8, border: 'none', cursor: rmoAnalyzing ? 'default' : 'pointer',
              backgroundColor: rmoAnalyzing ? 'rgba(100,116,139,0.1)' : 'rgba(234,179,8,0.12)',
              color: rmoAnalyzing ? '#6b7280' : '#fbbf24',
              transition: 'all 0.2s',
            }}
          >
            <Icon.Brain size={12} />
            {rmoAnalyzing ? 'NEXUS Analyzing…' : 'Admin NEXUS AI Analysis'}
          </button>
        </div>

        {/* NEXUS analysis output */}
        {rmoAnalysis && (
          <div style={{
            backgroundColor: 'rgba(234,179,8,0.05)',
            border: '1px solid rgba(234,179,8,0.12)',
            borderRadius: 8,
            padding: '14px 16px',
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#fbbf24', letterSpacing: '0.1em', marginBottom: 10, textTransform: 'uppercase' }}>
              NEXUS Analysis — MTZ Solar RMO Deal
            </div>
            <pre style={{ fontSize: 12, color: '#d1d5db', whiteSpace: 'pre-wrap', lineHeight: 1.6, margin: 0, fontFamily: 'inherit' }}>
              {rmoAnalysis}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}

// ── FactorRow helper component ──────────────────────────────────────────────────
function FactorRow({ label, magnitude, input }: { label: string; magnitude: number; input: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 160 }}>
        <div style={{ fontSize: 11, color: '#9ca3af' }}>{label}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {input}
        <MagnitudeBar value={magnitude} />
      </div>
    </div>
  )
}

// ── Shared input style ──────────────────────────────────────────────────────────
const inputStyle: React.CSSProperties = {
  backgroundColor: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 6,
  color: '#d1d5db',
  fontSize: 12,
  padding: '5px 9px',
  outline: 'none',
  width: 80,
  fontFamily: 'ui-monospace, monospace',
}
