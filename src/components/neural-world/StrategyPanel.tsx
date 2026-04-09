/**
 * StrategyPanel.tsx — NW25: AI Strategy Intelligence Panel
 *
 * Collapsible right-side panel triggered by a brain icon button in HUD.
 * Width: 380px, full height, scrollable, dark glassmorphism background.
 *
 * 6 strategy tabs:
 *   1. EXPANSION      — best zip codes, crew size, hire timing, service area growth
 *   2. REVENUE OPT    — pricing patterns, invoice aging, material/labor efficiency
 *   3. DATA COLLECT   — completeness % per data category, what AI needs more of
 *   4. MARKET OWN     — competitor gap, client concentration, referral strength
 *   5. CUST RETENTION — churn prediction, feature usage, at-risk alerts, upsell
 *   6. FEEDBACK LOOPS — animated SPARK→BLUEPRINT→LEDGER→PULSE→NEXUS circle
 *
 * All recommendations derived from live DataBridge data.
 */

import React, { useState, useEffect, useRef } from 'react'
import { subscribeWorldData, type NWWorldData } from './DataBridge'

// ── Types ──────────────────────────────────────────────────────────────────────

type StrategyTab =
  | 'expansion'
  | 'revenue'
  | 'data'
  | 'market'
  | 'retention'
  | 'feedback'

interface TabDef {
  id: StrategyTab
  label: string
  icon: string
  color: string
}

const TABS: TabDef[] = [
  { id: 'expansion',  label: 'EXPANSION',   icon: '⬆', color: '#00ff88' },
  { id: 'revenue',    label: 'REVENUE OPT', icon: '💰', color: '#ffcc44' },
  { id: 'data',       label: 'DATA',        icon: '📡', color: '#44aaff' },
  { id: 'market',     label: 'MARKET OWN',  icon: '🏆', color: '#ff6644' },
  { id: 'retention',  label: 'RETENTION',   icon: '🔗', color: '#cc88ff' },
  { id: 'feedback',   label: 'LOOPS',       icon: '🔄', color: '#00e5cc' },
]

// ── Brain icon button (exported for CommandHUD integration) ────────────────────

interface BrainButtonProps {
  open: boolean
  onClick: () => void
}

export function StrategyBrainButton({ open, onClick }: BrainButtonProps) {
  return (
    <button
      onClick={onClick}
      title="AI Strategy Panel"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 36,
        height: 36,
        borderRadius: 8,
        border: open
          ? '1px solid rgba(160,80,255,0.9)'
          : '1px solid rgba(160,80,255,0.4)',
        background: open
          ? 'rgba(120,40,220,0.3)'
          : 'rgba(0,0,0,0.55)',
        color: open ? '#c080ff' : 'rgba(160,80,255,0.75)',
        fontSize: 18,
        cursor: 'pointer',
        backdropFilter: 'blur(6px)',
        transition: 'all 0.18s',
        boxShadow: open ? '0 0 14px rgba(160,80,255,0.35)' : 'none',
        flexShrink: 0,
      }}
    >
      🧠
    </button>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt$(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}k`
  return `$${n.toFixed(0)}`
}

function fmtPct(n: number): string { return `${Math.round(n * 100)}%` }

// ── Section block components ───────────────────────────────────────────────────

function SectionBlock({
  label,
  children,
  accent,
}: {
  label: string
  children: React.ReactNode
  accent: string
}) {
  return (
    <div style={{
      marginBottom: 12,
      borderRadius: 6,
      border: `1px solid ${accent}33`,
      background: `${accent}08`,
      padding: '10px 12px',
    }}>
      <div style={{
        fontSize: 9,
        fontFamily: 'monospace',
        letterSpacing: 2,
        color: accent,
        opacity: 0.85,
        marginBottom: 6,
        textTransform: 'uppercase',
      }}>
        {label}
      </div>
      {children}
    </div>
  )
}

function MetricRow({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', fontFamily: 'monospace' }}>{label}</span>
      <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.9)', fontFamily: 'monospace', fontWeight: 700 }}>
        {value}
        {sub && <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', marginLeft: 5, fontWeight: 400 }}>{sub}</span>}
      </span>
    </div>
  )
}

function RecommendationCard({
  text,
  impact,
  accent,
}: { text: string; impact: string; accent: string }) {
  return (
    <div style={{
      borderRadius: 5,
      background: `${accent}14`,
      border: `1px solid ${accent}44`,
      padding: '8px 10px',
      marginBottom: 7,
    }}>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.8)', lineHeight: 1.5, fontFamily: 'sans-serif', marginBottom: 5 }}>
        {text}
      </div>
      <div style={{ fontSize: 10, color: accent, fontFamily: 'monospace', letterSpacing: 0.5, fontWeight: 700 }}>
        ↑ {impact}
      </div>
    </div>
  )
}

function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{ height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.08)', overflow: 'hidden', marginTop: 3 }}>
      <div style={{
        height: '100%',
        width: `${Math.min(100, Math.max(0, pct))}%`,
        background: color,
        borderRadius: 3,
        transition: 'width 0.6s ease',
      }} />
    </div>
  )
}

// ── Tab content panels ─────────────────────────────────────────────────────────

function ExpansionTab({ data }: { data: NWWorldData }) {
  const { projects, fieldLogs, accountingSignals, clientTerritories } = data
  const accent = '#00ff88'

  const activeProjects = projects.filter(p =>
    p.status === 'in_progress' || p.status === 'approved' || p.status === 'pending'
  )
  const totalContractValue = projects.reduce((s, p) => s + p.contract_value, 0)
  const avgContractValue = projects.length > 0
    ? totalContractValue / projects.length
    : 0
  const activeCrewCount = accountingSignals.activeCrewCount
  const serviceAreaCount = accountingSignals.serviceAreaCount

  // Crew utilisation proxy: hours in last 7 days vs crew × 40h/wk
  const recentHours = accountingSignals.recentPayrollHours
  const capacityHours = activeCrewCount * 40
  const crewUtilPct = capacityHours > 0
    ? Math.min(1, recentHours / capacityHours)
    : 0

  // Best growth territory: client with highest lifetime value and low active projects
  const growthTarget = clientTerritories.find(t =>
    t.lifetimeValue > 0 && t.activeProjectCount === 0 && t.daysSinceContact < 180
  ) ?? clientTerritories[0]

  const shouldHire = crewUtilPct > 0.82 && activeProjects.length >= 3
  const openNewArea = serviceAreaCount < 5 && totalContractValue > 50000

  return (
    <div>
      <SectionBlock label="CURRENT STATE" accent={accent}>
        <MetricRow label="Active Projects" value={String(activeProjects.length)} />
        <MetricRow label="Service Areas" value={String(serviceAreaCount)} />
        <MetricRow label="Active Crew" value={String(activeCrewCount)} />
        <MetricRow label="Crew Utilization" value={fmtPct(crewUtilPct)} sub="last 7d" />
        <MetricRow label="Avg Contract Value" value={fmt$(avgContractValue)} />
        {growthTarget && (
          <MetricRow
            label="Top Dormant Client"
            value={growthTarget.clientName}
            sub={`${growthTarget.daysSinceContact}d inactive`}
          />
        )}
      </SectionBlock>

      <SectionBlock label="AI RECOMMENDATION" accent={accent}>
        {shouldHire ? (
          <RecommendationCard
            text={`Crew utilization at ${fmtPct(crewUtilPct)} — at capacity. Add 1 crew member to support ${activeProjects.length} active projects.`}
            impact="Estimated 20–30% throughput increase"
            accent={accent}
          />
        ) : (
          <RecommendationCard
            text={`Crew utilization at ${fmtPct(crewUtilPct)}. Capacity is healthy — no immediate hire needed.`}
            impact="Retain margin on existing pipeline"
            accent={accent}
          />
        )}
        {growthTarget && (
          <RecommendationCard
            text={`Re-engage ${growthTarget.clientName} (inactive ${growthTarget.daysSinceContact}d). They represent ${fmt$(growthTarget.lifetimeValue)} lifetime value.`}
            impact={`+${fmt$(growthTarget.lifetimeValue * 0.15)} projected next project`}
            accent={accent}
          />
        )}
        {openNewArea && (
          <RecommendationCard
            text={`Pipeline strength (${fmt$(totalContractValue)}) supports opening a new service area. Analyze underserved zip codes adjacent to current territories.`}
            impact="+1 service area = +15–25% revenue potential"
            accent={accent}
          />
        )}
      </SectionBlock>

      <SectionBlock label="PROJECTED IMPACT" accent={accent}>
        <MetricRow
          label="Hire 1 Crew"
          value={fmt$(avgContractValue * 0.25 * 12)}
          sub="additional annual capacity"
        />
        <MetricRow
          label="Re-engage Dormant"
          value={fmt$(totalContractValue * 0.08)}
          sub="estimated reactivation revenue"
        />
        <MetricRow
          label="New Service Area"
          value={fmt$(totalContractValue * 0.20)}
          sub="growth potential"
        />
      </SectionBlock>
    </div>
  )
}

function RevenueTab({ data }: { data: NWWorldData }) {
  const { projects, invoices, accountingSignals } = data
  const accent = '#ffcc44'

  const totalRevenue = invoices
    .filter(inv => inv.status === 'paid')
    .reduce((s, inv) => s + inv.amount, 0)

  const overdueInvoices = accountingSignals.arOver30Days
  const overdueAmount = overdueInvoices.reduce((s, inv) => s + inv.amount, 0)
  const recentPaid = accountingSignals.recentPaidAmount

  // Material cost ratio
  const totalContractValue = projects.reduce((s, p) => s + p.contract_value, 0)
  const totalMaterialCost = projects.reduce((s, p) => s + p.material_cost, 0)
  const materialRatio = totalContractValue > 0
    ? totalMaterialCost / totalContractValue
    : 0

  // Labor efficiency: hours per dollar of contract value
  const totalHours = data.fieldLogs.reduce((s, fl) => s + fl.hours, 0)
  const laborEfficiency = totalHours > 0 && totalContractValue > 0
    ? totalContractValue / totalHours
    : 0

  // Avg invoice aging for overdue invoices
  const now = Date.now()
  const avgAgingDays = overdueInvoices.length > 0
    ? Math.round(
        overdueInvoices.reduce((s, inv) => {
          const created = inv.created_at ? new Date(inv.created_at).getTime() : now
          return s + (now - created) / (24 * 60 * 60 * 1000)
        }, 0) / overdueInvoices.length
      )
    : 0

  const highMaterialFlag = materialRatio > 0.45
  const slowCollections = overdueAmount > totalContractValue * 0.1

  return (
    <div>
      <SectionBlock label="CURRENT STATE" accent={accent}>
        <MetricRow label="Total Paid Revenue" value={fmt$(totalRevenue)} />
        <MetricRow label="Overdue AR (>30d)" value={fmt$(overdueAmount)} sub={`${overdueInvoices.length} invoices`} />
        <MetricRow label="Avg Overdue Age" value={avgAgingDays > 0 ? `${avgAgingDays}d` : '—'} />
        <MetricRow label="Material Cost Ratio" value={fmtPct(materialRatio)} sub="of contract value" />
        <MetricRow label="Revenue/Labor Hr" value={laborEfficiency > 0 ? fmt$(laborEfficiency) : '—'} />
        <MetricRow label="Recent Paid (30d)" value={fmt$(recentPaid)} />
      </SectionBlock>

      <SectionBlock label="AI RECOMMENDATION" accent={accent}>
        {slowCollections && (
          <RecommendationCard
            text={`${fmt$(overdueAmount)} in AR overdue >30 days. Trigger collection follow-up on ${overdueInvoices.length} invoices. Avg age: ${avgAgingDays} days.`}
            impact={`Recover ${fmt$(overdueAmount * 0.7)} within 30d`}
            accent={accent}
          />
        )}
        {highMaterialFlag && (
          <RecommendationCard
            text={`Material cost ratio at ${fmtPct(materialRatio)} — above healthy 40% threshold. Review supplier pricing or increase markup on material-heavy service types.`}
            impact="+3–5% net margin improvement"
            accent={accent}
          />
        )}
        {laborEfficiency > 0 && laborEfficiency < 75 && (
          <RecommendationCard
            text={`Revenue per labor hour at ${fmt$(laborEfficiency)}/hr. Target is $75+. Raise rates on electrical service calls or scope more firmly on fixed-price estimates.`}
            impact="+$15–25 per billed hour"
            accent={accent}
          />
        )}
        {!slowCollections && !highMaterialFlag && laborEfficiency >= 75 && (
          <RecommendationCard
            text="Revenue metrics look healthy. Focus on increasing average project size by upselling panel upgrades and solar add-ons to existing clients."
            impact="+20% revenue per client relationship"
            accent={accent}
          />
        )}
      </SectionBlock>

      <SectionBlock label="PROJECTED IMPACT" accent={accent}>
        <MetricRow
          label="Collect Overdue AR"
          value={fmt$(overdueAmount * 0.7)}
          sub="conservative recovery est."
        />
        <MetricRow
          label="Reduce Material Ratio 5%"
          value={fmt$(totalContractValue * 0.05)}
          sub="margin improvement"
        />
        <MetricRow
          label="Raise Labor Rate $15"
          value={fmt$(totalHours * 15)}
          sub="annualized uplift"
        />
      </SectionBlock>
    </div>
  )
}

function DataCollectionTab({ data }: { data: NWWorldData }) {
  const accent = '#44aaff'

  const { projects, invoices, fieldLogs, rfis, crewMembers, hubEvents } = data

  // Data completeness per category
  const categories = [
    {
      label: 'Project Records',
      desc: 'Projects with full data (name, status, contract value)',
      pct: projects.length > 0
        ? projects.filter(p => p.name && p.contract_value > 0 && p.status).length / projects.length
        : 0,
      count: projects.length,
      target: 'All projects fully populated',
    },
    {
      label: 'Field Log Frequency',
      desc: 'Daily logs submitted vs expected work days',
      pct: Math.min(1, data.accountingSignals.recentPayrollHours / (data.accountingSignals.activeCrewCount * 40 || 1)),
      count: fieldLogs.length,
      target: '≥ 8h logged per crew per week',
    },
    {
      label: 'Invoice Tracking',
      desc: 'Invoices with paid_at dates filled in',
      pct: invoices.length > 0
        ? invoices.filter(inv => inv.status === 'paid' && inv.paid_at).length / Math.max(1, invoices.filter(inv => inv.status === 'paid').length)
        : 0,
      count: invoices.length,
      target: '100% of paid invoices have paid_at',
    },
    {
      label: 'RFI Documentation',
      desc: 'RFIs created for projects with blockers',
      pct: rfis.length > 0
        ? rfis.filter(r => r.project_id).length / rfis.length
        : rfis.length === 0 ? 0.5 : 0,
      count: rfis.length,
      target: 'All open RFIs linked to projects',
    },
    {
      label: 'Crew Records',
      desc: 'Active crew members in system',
      pct: crewMembers.length > 0 ? 1.0 : 0.1,
      count: crewMembers.length,
      target: 'All field crew in crew_members table',
    },
    {
      label: 'Hub Event Tracking',
      desc: 'Platform events logged (subscribers, features)',
      pct: hubEvents.length > 0 ? Math.min(1, hubEvents.length / 10) : 0,
      count: hubEvents.length,
      target: 'Log all subscriber & feature events',
    },
    {
      label: 'Client Territory Data',
      desc: 'Clients with client_id for territory grouping',
      pct: projects.length > 0
        ? projects.filter(p => p.client_id).length / projects.length
        : 0,
      count: projects.filter(p => p.client_id).length,
      target: 'All projects linked to client records',
    },
  ]

  const overallCompleteness = categories.length > 0
    ? categories.reduce((s, c) => s + c.pct, 0) / categories.length
    : 0

  return (
    <div>
      <SectionBlock label="OVERALL COMPLETENESS" accent={accent}>
        <div style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', fontFamily: 'monospace' }}>Data Health Score</span>
            <span style={{ fontSize: 16, color: accent, fontFamily: 'monospace', fontWeight: 700 }}>
              {Math.round(overallCompleteness * 100)}%
            </span>
          </div>
          <ProgressBar pct={overallCompleteness * 100} color={accent} />
        </div>
      </SectionBlock>

      <SectionBlock label="CATEGORY BREAKDOWN" accent={accent}>
        {categories.map(cat => (
          <div key={cat.label} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 2 }}>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)', fontFamily: 'monospace' }}>{cat.label}</span>
              <span style={{
                fontSize: 11,
                fontFamily: 'monospace',
                fontWeight: 700,
                color: cat.pct >= 0.8 ? '#00ff88' : cat.pct >= 0.5 ? '#ffcc44' : '#ff4444',
              }}>
                {Math.round(cat.pct * 100)}%
              </span>
            </div>
            <ProgressBar
              pct={cat.pct * 100}
              color={cat.pct >= 0.8 ? '#00ff88' : cat.pct >= 0.5 ? '#ffcc44' : '#ff4444'}
            />
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', fontFamily: 'monospace', marginTop: 2 }}>
              {cat.count} records · {cat.target}
            </div>
          </div>
        ))}
      </SectionBlock>

      <SectionBlock label="AI RECOMMENDATION" accent={accent}>
        {categories.filter(c => c.pct < 0.6).map(cat => (
          <RecommendationCard
            key={cat.label}
            text={`"${cat.label}" is at ${Math.round(cat.pct * 100)}% — below threshold. Goal: ${cat.target}`}
            impact={`+${Math.round((0.8 - cat.pct) * 100)} pt completeness gain`}
            accent={accent}
          />
        ))}
        {categories.filter(c => c.pct < 0.6).length === 0 && (
          <RecommendationCard
            text="Data collection is strong across all categories. Keep maintaining daily field logs and ensure all new projects are created with full client linking."
            impact="Sustained AI recommendation accuracy"
            accent={accent}
          />
        )}
      </SectionBlock>
    </div>
  )
}

function MarketOwnershipTab({ data }: { data: NWWorldData }) {
  const { projects, accountingSignals, clientTerritories } = data
  const accent = '#ff6644'

  const totalContractValue = projects.reduce((s, p) => s + p.contract_value, 0)
  const depRatio = accountingSignals.singleClientDependencyRatio
  const dominantProject = accountingSignals.dominantProjectId
    ? projects.find(p => p.id === accountingSignals.dominantProjectId)
    : null

  const serviceAreaCount = accountingSignals.serviceAreaCount
  const clientCount = clientTerritories.length

  // Concentration risk
  const concentrationHigh = depRatio > 0.4
  const diversificationScore = 1 - depRatio

  // Dormant client count (no contact > 180d)
  const dormantClients = clientTerritories.filter(t => t.daysSinceContact > 180)

  // Storm territory count — clients with weather: storm
  const stormClients = clientTerritories.filter(t => t.weather === 'storm')

  // Referral proxy: clients with multiple projects (repeat business)
  const repeatClients = clientTerritories.filter(t => t.projectCount >= 2)
  const referralStrength = clientCount > 0
    ? repeatClients.length / clientCount
    : 0

  return (
    <div>
      <SectionBlock label="CURRENT STATE" accent={accent}>
        <MetricRow label="Total Clients" value={String(clientCount)} />
        <MetricRow label="Service Areas" value={String(serviceAreaCount)} />
        <MetricRow label="Repeat Clients" value={String(repeatClients.length)} sub={fmtPct(referralStrength)} />
        <MetricRow label="Dormant Clients (>180d)" value={String(dormantClients.length)} />
        <MetricRow label="At-Risk Clients" value={String(stormClients.length)} sub="storm weather" />
        <MetricRow
          label="Client Concentration"
          value={fmtPct(depRatio)}
          sub={dominantProject ? `top: ${dominantProject.name.slice(0, 16)}` : ''}
        />
        <div style={{ marginTop: 4 }}>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace', marginBottom: 3 }}>
            DIVERSIFICATION SCORE
          </div>
          <ProgressBar
            pct={diversificationScore * 100}
            color={diversificationScore > 0.7 ? '#00ff88' : diversificationScore > 0.5 ? '#ffcc44' : '#ff4444'}
          />
        </div>
      </SectionBlock>

      <SectionBlock label="AI RECOMMENDATION" accent={accent}>
        {concentrationHigh && dominantProject && (
          <RecommendationCard
            text={`${fmtPct(depRatio)} of revenue from one project/client ("${dominantProject.name.slice(0, 20)}"). Diversify — aim for no single client >25% of revenue.`}
            impact="Reduce business risk by 40%"
            accent={accent}
          />
        )}
        {dormantClients.length > 0 && (
          <RecommendationCard
            text={`${dormantClients.length} client(s) dormant >180 days. These are warm leads — reach out with maintenance or upgrade offers before competitors do.`}
            impact={`+${fmt$(dormantClients.reduce((s, t) => s + t.lifetimeValue * 0.1, 0))} reactivation potential`}
            accent={accent}
          />
        )}
        {referralStrength < 0.3 && clientCount > 2 && (
          <RecommendationCard
            text={`Only ${fmtPct(referralStrength)} of clients are repeat customers. Build a referral incentive program or a loyalty check-in process.`}
            impact="+10–15% revenue from existing relationships"
            accent={accent}
          />
        )}
        {!concentrationHigh && dormantClients.length === 0 && referralStrength >= 0.3 && (
          <RecommendationCard
            text="Market position is strong. Continue expanding into adjacent service areas with your current crew capacity."
            impact="+1 service area = +15–25% TAM"
            accent={accent}
          />
        )}
      </SectionBlock>

      <SectionBlock label="PROJECTED IMPACT" accent={accent}>
        <MetricRow
          label="Reduce Concentration"
          value={fmt$(totalContractValue * 0.12)}
          sub="risk-adjusted revenue gain"
        />
        <MetricRow
          label="Reactivate Dormant"
          value={fmt$(dormantClients.reduce((s, t) => s + t.lifetimeValue * 0.1, 0))}
          sub="projected reactivation"
        />
        <MetricRow
          label="Referral Program"
          value={fmt$(totalContractValue * 0.1)}
          sub="15% lift on repeat rate"
        />
      </SectionBlock>
    </div>
  )
}

function RetentionTab({ data }: { data: NWWorldData }) {
  const { clientTerritories, accountingSignals, hubEvents } = data
  const accent = '#cc88ff'

  const hubSubscriberCount = accountingSignals.hubSubscriberCount
  const recentFeatureLaunches = accountingSignals.recentFeatureLaunches

  // At-risk: dormant + low contact frequency
  const atRiskClients = clientTerritories.filter(
    t => t.daysSinceContact > 90 && t.contactFrequency < 0.4 && t.lifetimeValue > 1000
  )

  // Churn risk from weather
  const stormClients = clientTerritories.filter(t => t.weather === 'storm')
  const overcastClients = clientTerritories.filter(t => t.weather === 'overcast')

  // Upsell opportunities: completed projects with high lifetime value and clear weather
  const upsellOpps = clientTerritories.filter(
    t => t.weather === 'clear' && t.lifetimeValue > 10000 && t.activeProjectCount === 0
  )

  // Subscriber churn from events
  const recentCancels = hubEvents.filter(e => {
    if (e.event_type !== 'subscriber_cancelled') return false
    if (!e.created_at) return false
    return (Date.now() - new Date(e.created_at).getTime()) < 30 * 24 * 60 * 60 * 1000
  }).length

  // Engagement proxy: active projects / total clients
  const totalClients = clientTerritories.length
  const activeClients = clientTerritories.filter(t => t.activeProjectCount > 0).length
  const engagementRate = totalClients > 0 ? activeClients / totalClients : 0

  return (
    <div>
      <SectionBlock label="CURRENT STATE" accent={accent}>
        <MetricRow label="Hub Subscribers" value={String(hubSubscriberCount)} />
        <MetricRow label="Recent Cancels (30d)" value={String(recentCancels)} />
        <MetricRow label="Recent Feature Launches" value={String(recentFeatureLaunches)} />
        <MetricRow label="Client Engagement" value={fmtPct(engagementRate)} sub={`${activeClients} active`} />
        <MetricRow label="At-Risk Clients" value={String(atRiskClients.length)} sub=">90d inactive" />
        <MetricRow label="Storm Clients" value={String(stormClients.length)} sub="payment/RFI issues" />
        <MetricRow label="Upsell Candidates" value={String(upsellOpps.length)} sub="healthy + idle" />
      </SectionBlock>

      <SectionBlock label="AI RECOMMENDATION" accent={accent}>
        {atRiskClients.length > 0 && (
          <RecommendationCard
            text={`${atRiskClients.length} client(s) inactive >90 days with declining contact frequency. Send a check-in or maintenance proposal before churn risk escalates.`}
            impact={`Retain ${fmt$(atRiskClients.reduce((s, t) => s + t.lifetimeValue * 0.3, 0))} projected revenue`}
            accent={accent}
          />
        )}
        {stormClients.length > 0 && (
          <RecommendationCard
            text={`${stormClients.length} client(s) in "storm" status (open RFIs or payment issues). Resolve RFIs and follow up on overdue invoices immediately.`}
            impact="Prevents churn of existing accounts"
            accent={accent}
          />
        )}
        {upsellOpps.length > 0 && (
          <RecommendationCard
            text={`${upsellOpps.length} high-value client(s) are healthy and between projects — prime for upsell. Offer panel upgrades, EV charger installs, or annual maintenance plans.`}
            impact={`+${fmt$(upsellOpps.reduce((s, t) => s + t.lifetimeValue * 0.15, 0))} estimated upsell`}
            accent={accent}
          />
        )}
        {recentCancels > 0 && (
          <RecommendationCard
            text={`${recentCancels} subscriber cancellation(s) in last 30 days. Review cancellation reasons and trigger re-engagement sequences with feature highlights.`}
            impact="Reduce churn by 20–30% with timely outreach"
            accent={accent}
          />
        )}
        {atRiskClients.length === 0 && stormClients.length === 0 && upsellOpps.length === 0 && recentCancels === 0 && (
          <RecommendationCard
            text="Client retention health is strong. Focus on deepening relationships with your top 3 clients through proactive planning sessions."
            impact="+20% lifetime value per top client"
            accent={accent}
          />
        )}
      </SectionBlock>

      <SectionBlock label="PROJECTED IMPACT" accent={accent}>
        <MetricRow
          label="Re-engage At-Risk"
          value={fmt$(atRiskClients.reduce((s, t) => s + t.lifetimeValue * 0.3, 0))}
          sub="projected retention"
        />
        <MetricRow
          label="Upsell to Idle Clients"
          value={fmt$(upsellOpps.reduce((s, t) => s + t.lifetimeValue * 0.15, 0))}
          sub="upsell potential"
        />
        <MetricRow
          label="Reduce Subscriber Churn"
          value={hubSubscriberCount > 0 ? `${hubSubscriberCount}+ subs` : '—'}
          sub="retained at monthly rate"
        />
      </SectionBlock>
    </div>
  )
}

// ── Animated feedback loop arrows ─────────────────────────────────────────────

const FLOW_NODES = [
  { id: 'SPARK',     icon: '⚡', color: '#ff6644', desc: 'Captures leads from live calls' },
  { id: 'BLUEPRINT', icon: '🗺', color: '#44aaff', desc: 'Converts leads to project plans' },
  { id: 'LEDGER',    icon: '📒', color: '#ffcc44', desc: 'Generates invoices from blueprints' },
  { id: 'PULSE',     icon: '◎',  color: '#00ff88', desc: 'Aggregates financial health signals' },
  { id: 'NEXUS',     icon: '🧠', color: '#cc88ff', desc: 'Routes AI decisions to all agents' },
]

function FeedbackLoopsTab() {
  const accent = '#00e5cc'
  const [activeNode, setActiveNode] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setActiveNode(n => (n + 1) % FLOW_NODES.length)
    }, 1200)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  return (
    <div>
      <SectionBlock label="AGENT DATA FLOW" accent={accent}>
        <div style={{ fontFamily: 'sans-serif', fontSize: 11, color: 'rgba(255,255,255,0.6)', lineHeight: 1.6, marginBottom: 10 }}>
          Each agent feeds structured data back into the system, creating a self-improving intelligence loop.
        </div>

        {/* Animated circular flow */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {FLOW_NODES.map((node, i) => {
            const isActive = i === activeNode
            const isNext = i === (activeNode + 1) % FLOW_NODES.length

            return (
              <div key={node.id}>
                {/* Node */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 10px',
                  borderRadius: 6,
                  border: `1px solid ${isActive ? node.color : 'rgba(255,255,255,0.08)'}`,
                  background: isActive ? `${node.color}18` : 'rgba(255,255,255,0.02)',
                  transition: 'all 0.3s ease',
                  marginBottom: 0,
                }}>
                  <span style={{
                    fontSize: 18,
                    filter: isActive ? `drop-shadow(0 0 6px ${node.color})` : 'none',
                    transition: 'filter 0.3s ease',
                  }}>
                    {node.icon}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{
                      fontSize: 11,
                      fontFamily: 'monospace',
                      letterSpacing: 1.5,
                      color: isActive ? node.color : 'rgba(255,255,255,0.5)',
                      fontWeight: isActive ? 700 : 400,
                      transition: 'color 0.3s ease',
                    }}>
                      {node.id}
                    </div>
                    <div style={{
                      fontSize: 10,
                      color: 'rgba(255,255,255,0.35)',
                      fontFamily: 'sans-serif',
                      marginTop: 1,
                    }}>
                      {node.desc}
                    </div>
                  </div>
                  {isActive && (
                    <div style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: node.color,
                      boxShadow: `0 0 8px ${node.color}`,
                      animation: 'nw-blink 0.8s ease infinite',
                    }} />
                  )}
                </div>

                {/* Arrow connector */}
                {i < FLOW_NODES.length - 1 && (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: 20,
                    color: isNext ? accent : 'rgba(255,255,255,0.15)',
                    fontSize: 14,
                    transition: 'color 0.3s ease',
                  }}>
                    ↓
                  </div>
                )}
              </div>
            )
          })}

          {/* Loop-back arrow */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 10px',
            borderRadius: 5,
            background: 'rgba(0,229,204,0.08)',
            border: '1px dashed rgba(0,229,204,0.3)',
            marginTop: 4,
          }}>
            <span style={{ fontSize: 14, color: accent }}>↺</span>
            <span style={{ fontSize: 10, color: 'rgba(0,229,204,0.7)', fontFamily: 'monospace', letterSpacing: 0.5 }}>
              NEXUS insights loop back to SPARK — closing the intelligence cycle
            </span>
          </div>
        </div>
      </SectionBlock>

      <SectionBlock label="LOOP HEALTH SIGNALS" accent={accent}>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', fontFamily: 'sans-serif', lineHeight: 1.6 }}>
          A healthy feedback loop requires:
        </div>
        {[
          { label: 'Daily field logs → LEDGER accuracy', signal: 'Field logs feed invoice generation timing' },
          { label: 'SPARK calls → BLUEPRINT projects', signal: 'Every captured lead becomes a structured project' },
          { label: 'LEDGER invoices → PULSE cashflow', signal: 'Invoice data powers the financial health meter' },
          { label: 'PULSE signals → NEXUS routing', signal: 'Revenue health informs AI query priority' },
          { label: 'NEXUS responses → SPARK prompts', signal: 'Decisions improve future call scripts' },
        ].map(item => (
          <div key={item.label} style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            marginTop: 8,
            paddingTop: 8,
            borderTop: '1px solid rgba(255,255,255,0.05)',
          }}>
            <span style={{ color: accent, fontSize: 12, flexShrink: 0 }}>✓</span>
            <div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.65)', fontFamily: 'monospace', fontWeight: 600 }}>
                {item.label}
              </div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', fontFamily: 'sans-serif', marginTop: 2 }}>
                {item.signal}
              </div>
            </div>
          </div>
        ))}
      </SectionBlock>
    </div>
  )
}

// ── Main StrategyPanel ─────────────────────────────────────────────────────────

export interface StrategyPanelProps {
  open: boolean
  onClose: () => void
}

export function StrategyPanel({ open, onClose }: StrategyPanelProps) {
  const [activeTab, setActiveTab] = useState<StrategyTab>('expansion')
  const [worldData, setWorldData] = useState<NWWorldData | null>(null)

  // Subscribe to DataBridge
  useEffect(() => {
    const unsub = subscribeWorldData((data) => setWorldData(data))
    return unsub
  }, [])

  if (!open) return null

  // Loading state
  if (!worldData || worldData.lastFetched === 0) {
    return (
      <div style={{
        position: 'absolute',
        top: 0,
        right: 0,
        width: 380,
        height: '100%',
        zIndex: 40,
        background: 'rgba(4,8,20,0.92)',
        backdropFilter: 'blur(16px)',
        borderLeft: '1px solid rgba(160,80,255,0.25)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: 12,
      }}>
        <div style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: '#c080ff',
          boxShadow: '0 0 10px #c080ff',
          animation: 'nw-blink 1.2s ease infinite',
        }} />
        <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'rgba(192,128,255,0.7)', letterSpacing: 1.5 }}>
          LOADING DATA…
        </div>
      </div>
    )
  }

  const currentTab = TABS.find(t => t.id === activeTab)!

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        width: 380,
        height: '100%',
        zIndex: 40,
        display: 'flex',
        flexDirection: 'column',
        background: 'rgba(4,8,20,0.92)',
        backdropFilter: 'blur(16px)',
        borderLeft: '1px solid rgba(160,80,255,0.25)',
        boxShadow: '-8px 0 32px rgba(0,0,0,0.6)',
      }}
    >
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '14px 16px 10px',
        borderBottom: '1px solid rgba(160,80,255,0.15)',
        flexShrink: 0,
      }}>
        <div>
          <div style={{
            fontSize: 12,
            fontFamily: 'monospace',
            letterSpacing: 2.5,
            color: '#c080ff',
            fontWeight: 700,
            textShadow: '0 0 8px rgba(192,128,255,0.4)',
          }}>
            🧠 AI STRATEGY PANEL
          </div>
          <div style={{
            fontSize: 9,
            fontFamily: 'monospace',
            letterSpacing: 1.5,
            color: 'rgba(255,255,255,0.3)',
            marginTop: 2,
          }}>
            LIVE SUPABASE DATA · AUTO-REFRESH
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            width: 28,
            height: 28,
            borderRadius: 6,
            border: '1px solid rgba(255,255,255,0.12)',
            background: 'rgba(255,255,255,0.05)',
            color: 'rgba(255,255,255,0.5)',
            cursor: 'pointer',
            fontSize: 14,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          ✕
        </button>
      </div>

      {/* ── Tab bar ─────────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex',
        gap: 2,
        padding: '8px 10px 0',
        flexWrap: 'wrap',
        flexShrink: 0,
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        paddingBottom: 8,
      }}>
        {TABS.map(tab => {
          const isActive = tab.id === activeTab
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: '4px 8px',
                borderRadius: 4,
                border: isActive
                  ? `1px solid ${tab.color}88`
                  : '1px solid rgba(255,255,255,0.08)',
                background: isActive ? `${tab.color}18` : 'rgba(255,255,255,0.02)',
                color: isActive ? tab.color : 'rgba(255,255,255,0.35)',
                cursor: 'pointer',
                fontSize: 9,
                fontFamily: 'monospace',
                letterSpacing: 0.8,
                fontWeight: isActive ? 700 : 400,
                transition: 'all 0.15s',
                whiteSpace: 'nowrap',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          )
        })}
      </div>

      {/* ── Active tab label ─────────────────────────────────────────────────── */}
      <div style={{
        padding: '8px 16px 4px',
        flexShrink: 0,
      }}>
        <span style={{
          fontSize: 10,
          fontFamily: 'monospace',
          letterSpacing: 2,
          color: currentTab.color,
          fontWeight: 700,
          opacity: 0.85,
        }}>
          {currentTab.icon} {currentTab.label}
        </span>
      </div>

      {/* ── Scrollable content ───────────────────────────────────────────────── */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '4px 12px 20px',
        scrollbarWidth: 'thin',
        scrollbarColor: 'rgba(160,80,255,0.3) transparent',
      }}>
        {activeTab === 'expansion'  && <ExpansionTab data={worldData} />}
        {activeTab === 'revenue'    && <RevenueTab data={worldData} />}
        {activeTab === 'data'       && <DataCollectionTab data={worldData} />}
        {activeTab === 'market'     && <MarketOwnershipTab data={worldData} />}
        {activeTab === 'retention'  && <RetentionTab data={worldData} />}
        {activeTab === 'feedback'   && <FeedbackLoopsTab />}
      </div>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <div style={{
        padding: '8px 16px',
        borderTop: '1px solid rgba(255,255,255,0.07)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <div style={{ fontSize: 9, fontFamily: 'monospace', color: 'rgba(255,255,255,0.2)', letterSpacing: 0.8 }}>
          {worldData.projects.length} PROJECTS · {worldData.invoices.length} INVOICES · {worldData.fieldLogs.length} LOGS
        </div>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
        }}>
          <div style={{
            width: 5,
            height: 5,
            borderRadius: '50%',
            background: '#c080ff',
            boxShadow: '0 0 5px #c080ff',
            animation: 'nw-blink 1.8s ease infinite',
          }} />
          <span style={{ fontSize: 9, fontFamily: 'monospace', color: 'rgba(192,128,255,0.5)', letterSpacing: 1 }}>
            NEXUS
          </span>
        </div>
      </div>
    </div>
  )
}
