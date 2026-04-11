// @ts-nocheck
/**
 * AbsoluteDashboardView.tsx — NAV1 | Absolute Dashboard
 *
 * Every key number across all tools in one place.
 * No scrolling. Scannable in 10 seconds.
 *
 * Layout: Card grid — numbers and status only (no charts in first build).
 * Desktop: 3 columns | Tablet: 2 columns | Mobile: 1 column.
 *
 * Includes Agent System Map (moved from COMMAND).
 */

import React, { useState, useEffect, lazy, Suspense } from 'react'
import {
  DollarSign, Users, ShieldCheck, FileText, Clock, AlertTriangle,
  Activity, CheckCircle, Circle, RefreshCw, BarChart3
} from 'lucide-react'
import { getBackupData } from '@/services/backupDataService'

const AgentSystemMapView = lazy(() => import('./AgentSystemMapView'))

// ─── Seed data for agent intelligence counts ───────────────────────────────────

const AGENT_VISION = [
  { name: 'NEXUS', vision: 90 }, { name: 'SPARK', vision: 90 },
  { name: 'HUNTER', vision: 100 }, { name: 'VAULT', vision: 70 },
  { name: 'PULSE', vision: 85 }, { name: 'BLUEPRINT', vision: 80 },
  { name: 'LEDGER', vision: 80 }, { name: 'CHRONO', vision: 75 },
  { name: 'ATLAS', vision: 0 }, { name: 'OHM', vision: 0 },
  { name: 'ECHO', vision: 80 }, { name: 'SCOUT', vision: 75 },
  { name: 'GUARDIAN', vision: 100 }, { name: 'SENTINEL', vision: 0 },
]

// ─── Metric Card ──────────────────────────────────────────────────────────────

interface MetricCardProps {
  title: string
  value: string | number
  sublabel: string
  status: 'live' | 'partial' | 'disconnected'
  icon?: React.ReactNode
  onClick?: () => void
}

function MetricCard({ title, value, sublabel, status, icon, onClick }: MetricCardProps) {
  const dotColor = status === 'live' ? '#22c55e' : status === 'partial' ? '#f59e0b' : '#6b7280'
  const borderColor = status === 'live' ? 'rgba(34,197,94,0.2)' : status === 'partial' ? 'rgba(245,158,11,0.2)' : 'rgba(107,114,128,0.15)'
  const bgColor = status === 'live' ? 'rgba(34,197,94,0.04)' : status === 'partial' ? 'rgba(245,158,11,0.03)' : 'rgba(107,114,128,0.03)'

  return (
    <div
      onClick={onClick}
      style={{
        backgroundColor: bgColor,
        border: `1px solid ${borderColor}`,
        borderRadius: 10,
        padding: '14px 16px',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'border-color 0.15s',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        minHeight: 100,
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {icon && <span style={{ color: '#6b7280' }}>{icon}</span>}
          <span style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'monospace' }}>
            {title}
          </span>
        </div>
        <div style={{
          width: 7, height: 7, borderRadius: '50%',
          backgroundColor: dotColor,
          boxShadow: status === 'live' ? '0 0 4px rgba(34,197,94,0.5)' : 'none',
        }} />
      </div>

      {/* Value */}
      <div style={{ fontSize: 22, fontWeight: 700, color: '#f9fafb', letterSpacing: '-0.02em', lineHeight: 1 }}>
        {value}
      </div>

      {/* Sub-label */}
      <div style={{ fontSize: 10, color: '#6b7280', lineHeight: 1.3 }}>
        {sublabel}
      </div>
    </div>
  )
}

// ─── Section Header ────────────────────────────────────────────────────────────

function SectionHeader({ label }: { label: string }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      marginBottom: 12,
      marginTop: 4,
    }}>
      <span style={{
        fontFamily: 'monospace',
        fontSize: 9,
        fontWeight: 800,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: '#4b5563',
      }}>
        {label}
      </span>
      <div style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.05)' }} />
    </div>
  )
}

// ─── Main Component ────────────────────────────────────────────────────────────

type ActiveTab = 'dashboard' | 'agent-map'

export default function AbsoluteDashboardView() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard')
  const [backupData, setBackupData] = useState<any>(null)
  const [syncTime, setSyncTime] = useState<string>(new Date().toISOString())
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  function loadData() {
    setLoading(true)
    try {
      const data = getBackupData()
      setBackupData(data)
    } catch {
      setBackupData(null)
    }
    setSyncTime(new Date().toISOString())
    setLoading(false)
  }

  // ── Derive metrics from backup data ──────────────────────────────────────────

  const projects = backupData?.projects ?? []
  const activeProjects = projects.filter((p: any) => p.status === 'active' || p.status === 'coming')
  const openRFIs = activeProjects.reduce((sum: number, p: any) => sum + (p.rfis?.filter((r: any) => !r.resolved)?.length ?? 0), 0)

  // Pipeline / money metrics
  const pipelineTotal = activeProjects.reduce((sum: number, p: any) => sum + (Number(p.contract) || 0), 0)
  const paidTotal = activeProjects.reduce((sum: number, p: any) => sum + (Number(p.paid) || 0), 0)
  const billedTotal = activeProjects.reduce((sum: number, p: any) => sum + (Number(p.billed) || 0), 0)
  const exposure = billedTotal - paidTotal

  // Service net (from serviceLogs if available)
  const serviceLogs = backupData?.serviceLogs ?? []
  const serviceNet = serviceLogs.reduce((sum: number, log: any) => sum + (Number(log.total) || Number(log.charge) || 0), 0)

  // EVO unbilled (projects billed < contract)
  const evoUnbilled = activeProjects.reduce((sum: number, p: any) => {
    const unbilled = (Number(p.contract) || 0) - (Number(p.billed) || 0)
    return sum + (unbilled > 0 ? unbilled : 0)
  }, 0)

  // Agent intelligence counts
  const agentsActive = AGENT_VISION.filter(a => a.vision > 0).length
  const agentsPartial = AGENT_VISION.filter(a => a.vision > 0 && a.vision < 100).length
  const agentsNotWired = AGENT_VISION.filter(a => a.vision === 0).length

  function fmt$(n: number) {
    if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`
    if (n >= 1000) return `$${(n / 1000).toFixed(0)}k`
    return `$${Math.round(n).toLocaleString()}`
  }

  function fmtSync(iso: string) {
    try { return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) } catch { return '—' }
  }

  const TABS: { id: ActiveTab; label: string }[] = [
    { id: 'dashboard', label: 'Absolute Dashboard' },
    { id: 'agent-map', label: 'Agent System Map' },
  ]

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      minHeight: 0,
      color: '#e5e7eb',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      {/* Tab bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 0,
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        paddingLeft: 20,
        flexShrink: 0,
      }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '10px 16px',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: activeTab === tab.id ? 700 : 500,
              color: activeTab === tab.id ? '#f9fafb' : '#6b7280',
              borderBottom: activeTab === tab.id ? '2px solid #22c55e' : '2px solid transparent',
              transition: 'color 0.15s, border-color 0.15s',
              marginBottom: -1,
              whiteSpace: 'nowrap',
            }}
          >
            {tab.label}
          </button>
        ))}

        {/* Sync info */}
        <div style={{ marginLeft: 'auto', marginRight: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={loadData}
            title="Refresh"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#4b5563', padding: 4, display: 'flex',
            }}
          >
            <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          </button>
          <span style={{ fontSize: 9, color: '#374151', fontFamily: 'monospace' }}>
            SYNC {fmtSync(syncTime)}
          </span>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {activeTab === 'dashboard' && (
          <div style={{ padding: '20px 24px', maxWidth: 1400 }}>

            {/* ROW 1 — Pipeline & Money */}
            <SectionHeader label="Pipeline & Money" />
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: 10,
              marginBottom: 28,
            }}>
              <MetricCard
                title="Pipeline Total"
                value={fmt$(pipelineTotal)}
                sublabel="Active + Coming contract value"
                status={pipelineTotal > 0 ? 'live' : 'disconnected'}
                icon={<DollarSign size={13} />}
              />
              <MetricCard
                title="Paid Total"
                value={fmt$(paidTotal)}
                sublabel="Payments received on active projects"
                status={paidTotal > 0 ? 'live' : 'disconnected'}
                icon={<CheckCircle size={13} />}
              />
              <MetricCard
                title="Exposure"
                value={fmt$(exposure)}
                sublabel="Billed but not yet paid"
                status={exposure > 0 ? 'partial' : 'live'}
                icon={<AlertTriangle size={13} />}
              />
              <MetricCard
                title="EVO Unbilled"
                value={fmt$(evoUnbilled)}
                sublabel="Contract value not yet billed"
                status={evoUnbilled > 0 ? 'partial' : 'live'}
                icon={<FileText size={13} />}
              />
              <MetricCard
                title="Open Projects"
                value={activeProjects.length}
                sublabel="Active + Coming status"
                status={activeProjects.length > 0 ? 'live' : 'disconnected'}
                icon={<BarChart3 size={13} />}
              />
              <MetricCard
                title="Open RFIs"
                value={openRFIs}
                sublabel="Unresolved across all active projects"
                status={openRFIs > 0 ? 'partial' : 'live'}
                icon={<AlertTriangle size={13} />}
              />
              <MetricCard
                title="Service Net"
                value={fmt$(serviceNet)}
                sublabel="Total service charges logged"
                status={serviceNet > 0 ? 'live' : 'partial'}
                icon={<DollarSign size={13} />}
              />
            </div>

            {/* ROW 2 — Agent Status */}
            <SectionHeader label="Agent Status" />
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: 10,
              marginBottom: 28,
            }}>
              <MetricCard
                title="Cash Position"
                value="Connect PULSE"
                sublabel="Wire PULSE agent to enable"
                status="disconnected"
                icon={<DollarSign size={13} />}
              />
              <MetricCard
                title="Active Leads"
                value="Connect HUNTER"
                sublabel="HUNTER tables not yet wired"
                status="disconnected"
                icon={<Users size={13} />}
              />
              <MetricCard
                title="Floor Price Status"
                value="Connect VAULT"
                sublabel="VAULT price enforcement not set"
                status="disconnected"
                icon={<ShieldCheck size={13} />}
              />
              <MetricCard
                title="Open Invoices"
                value="Connect LEDGER"
                sublabel="AR total — wire LEDGER tables"
                status="disconnected"
                icon={<FileText size={13} />}
              />
              <MetricCard
                title="Active Crew"
                value="Connect CHRONO"
                sublabel="Hours today — wire CHRONO"
                status="disconnected"
                icon={<Clock size={13} />}
              />
              <MetricCard
                title="Compliance Flags"
                value="0"
                sublabel="Open GUARDIAN flags"
                status="live"
                icon={<AlertTriangle size={13} />}
              />
            </div>

            {/* ROW 3 — System Health */}
            <SectionHeader label="System Health" />
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: 10,
              marginBottom: 28,
            }}>
              <MetricCard
                title="Agents Active"
                value={agentsActive}
                sublabel="vision_completion > 0"
                status="live"
                icon={<Activity size={13} />}
              />
              <MetricCard
                title="Agents Partial"
                value={agentsPartial}
                sublabel="vision > 0 and < 100%"
                status="partial"
                icon={<Circle size={13} />}
              />
              <MetricCard
                title="Agents Not Wired"
                value={agentsNotWired}
                sublabel="vision_completion = 0"
                status="disconnected"
                icon={<Circle size={13} />}
              />
              <MetricCard
                title="Last System Sync"
                value={fmtSync(syncTime)}
                sublabel="Dashboard data timestamp"
                status="live"
                icon={<RefreshCw size={13} />}
              />
            </div>

          </div>
        )}

        {activeTab === 'agent-map' && (
          <Suspense fallback={
            <div style={{ padding: 40, color: '#6b7280', textAlign: 'center' }}>Loading agent map...</div>
          }>
            <AgentSystemMapView />
          </Suspense>
        )}
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
