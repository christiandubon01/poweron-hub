// @ts-nocheck
/**
 * GuardianDashboard — GUARDIAN Compliance Command Center
 *
 * Displays all six compliance KPI cards, open alerts (sorted by severity),
 * a real-time activity feed, and CSLB protection status across three categories.
 *
 * Data sources:
 *   - GuardianMetricsService (KPI calculations from backup state)
 *   - GuardianAgentConnections (audit log alerts)
 *   - No Supabase calls — all local-first
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  Users,
  ArrowUpRight,
  ArrowDownRight,
  RefreshCw,
  Bell,
  Activity,
  ChevronDown,
  ChevronUp,
  XCircle,
  AlertCircle,
} from 'lucide-react'
import {
  calculateCallbackRate,
  calculateRFIResponseTime,
  calculateDocCompletionRate,
  calculateViolationFrequency,
  calculateSoloCompliance,
  calculateChangeOrderConversion,
  getCSLBReadinessScore,
  type CallbackRateResult,
  type RFIResponseTimeResult,
  type DocCompletionResult,
  type ViolationFrequencyResult,
  type SoloComplianceResult,
  type ChangeOrderConversionResult,
  type CSLBReadinessScore,
} from '@/services/guardian/GuardianMetricsService'
import {
  getOpenAlerts,
  getAuditLog,
  resolveAlert,
  acknowledgeAlert,
  escalateAlert,
  type GuardianAuditEntry,
} from '@/services/guardian/GuardianAgentConnections'

// ── Types ────────────────────────────────────────────────────────────────────

interface MetricsState {
  callback: CallbackRateResult
  rfi: RFIResponseTimeResult
  docComp: DocCompletionResult
  violations: ViolationFrequencyResult
  solo: SoloComplianceResult
  changeOrders: ChangeOrderConversionResult
  cslb: CSLBReadinessScore
  lastRefreshed: Date
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function statusColor(status: 'green' | 'amber' | 'red'): string {
  switch (status) {
    case 'green': return 'text-emerald-400'
    case 'amber': return 'text-amber-400'
    case 'red':   return 'text-red-400'
  }
}

function statusBg(status: 'green' | 'amber' | 'red'): string {
  switch (status) {
    case 'green': return 'bg-emerald-900/20 border-emerald-700/30'
    case 'amber': return 'bg-amber-900/20 border-amber-700/30'
    case 'red':   return 'bg-red-900/20 border-red-700/30'
  }
}

function statusDot(status: 'green' | 'amber' | 'red'): string {
  switch (status) {
    case 'green': return 'bg-emerald-400'
    case 'amber': return 'bg-amber-400'
    case 'red':   return 'bg-red-400'
  }
}

function severityColor(severity: GuardianAuditEntry['severity']): string {
  switch (severity) {
    case 'critical': return 'text-red-400 border-red-700/40 bg-red-900/15'
    case 'high':     return 'text-orange-400 border-orange-700/40 bg-orange-900/15'
    case 'medium':   return 'text-amber-400 border-amber-700/40 bg-amber-900/15'
    case 'low':      return 'text-yellow-400 border-yellow-700/40 bg-yellow-900/10'
  }
}

function severityBadge(severity: GuardianAuditEntry['severity']): string {
  switch (severity) {
    case 'critical': return 'bg-red-500/20 text-red-300 border border-red-600/30'
    case 'high':     return 'bg-orange-500/20 text-orange-300 border border-orange-600/30'
    case 'medium':   return 'bg-amber-500/20 text-amber-300 border border-amber-600/30'
    case 'low':      return 'bg-yellow-500/20 text-yellow-300 border border-yellow-600/30'
  }
}

function categoryIcon(category: GuardianAuditEntry['category']) {
  switch (category) {
    case 'cslb':          return <Shield className="w-3 h-3" />
    case 'safety':        return <ShieldAlert className="w-3 h-3" />
    case 'financial':     return <AlertCircle className="w-3 h-3" />
    case 'documentation': return <FileText className="w-3 h-3" />
    case 'compliance':    return <ShieldX className="w-3 h-3" />
  }
}

function formatTs(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
  } catch {
    return iso
  }
}

function loadMetrics(): MetricsState {
  return {
    callback:     calculateCallbackRate(),
    rfi:          calculateRFIResponseTime(),
    docComp:      calculateDocCompletionRate(),
    violations:   calculateViolationFrequency(),
    solo:         calculateSoloCompliance(),
    changeOrders: calculateChangeOrderConversion(),
    cslb:         getCSLBReadinessScore(),
    lastRefreshed: new Date(),
  }
}

// ── Sub-Components ────────────────────────────────────────────────────────────

interface MetricCardProps {
  label: string
  value: string
  subtitle: string
  status: 'green' | 'amber' | 'red'
  trend?: 'up' | 'down' | 'stable'
  trendLabel?: string
  icon: React.ReactNode
}

function MetricCard({ label, value, subtitle, status, trend, trendLabel, icon }: MetricCardProps) {
  return (
    <div className={`rounded-xl border p-4 flex flex-col gap-2 ${statusBg(status)}`}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className={statusColor(status)}>{icon}</span>
          <span className="text-xs text-gray-400 font-medium uppercase tracking-wider">{label}</span>
        </div>
        {trend && (
          <span className={`flex items-center gap-0.5 text-xs font-medium ${
            trend === 'up' ? 'text-red-400' : trend === 'down' ? 'text-emerald-400' : 'text-gray-500'
          }`}>
            {trend === 'up' ? <TrendingUp className="w-3 h-3" /> : trend === 'down' ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
            {trendLabel}
          </span>
        )}
      </div>
      <div className={`text-2xl font-bold ${statusColor(status)}`}>{value}</div>
      <div className="text-xs text-gray-500">{subtitle}</div>
    </div>
  )
}

// ── Alert Card ────────────────────────────────────────────────────────────────

interface AlertCardProps {
  entry: GuardianAuditEntry
  onAcknowledge: (id: string) => void
  onResolve: (id: string) => void
  onEscalate: (id: string) => void
}

function AlertCard({ entry, onAcknowledge, onResolve, onEscalate }: AlertCardProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className={`rounded-xl border p-4 flex flex-col gap-3 ${severityColor(entry.severity)}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 flex-1 min-w-0">
          <span className="mt-0.5 flex-shrink-0">{categoryIcon(entry.category)}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-xs px-2 py-0.5 rounded font-semibold uppercase tracking-wide ${severityBadge(entry.severity)}`}>
                {entry.severity}
              </span>
              <span className="text-xs text-gray-500 capitalize">{entry.category}</span>
              <span className="text-xs text-gray-600">{formatTs(entry.timestamp)}</span>
            </div>
            <p className="text-sm font-medium mt-1 leading-snug">{entry.message}</p>
            {entry.projectId && (
              <p className="text-xs text-gray-500 mt-0.5">Project: {entry.projectId}</p>
            )}
          </div>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex-shrink-0 text-gray-600 hover:text-gray-400 transition-colors"
          aria-label="Toggle details"
        >
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* 5-step summary */}
      {expanded && (
        <div className="bg-black/20 rounded-lg p-3 space-y-1.5 text-xs text-gray-400">
          <div><span className="text-gray-500 font-medium">① Detect: </span>{entry.step1_detect}</div>
          <div><span className="text-gray-500 font-medium">② Evaluate: </span>{entry.step2_evaluate}</div>
          <div><span className="text-gray-500 font-medium">③ Classify: </span>{entry.step3_classify}</div>
          <div><span className="text-gray-500 font-medium">④ Record: </span>{entry.step4_record}</div>
          <div><span className="text-gray-500 font-medium">⑤ Alert: </span>{entry.step5_alert}</div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => onAcknowledge(entry.id)}
          className="text-xs px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white border border-gray-700/40 transition-colors"
        >
          Acknowledge
        </button>
        <button
          onClick={() => onResolve(entry.id)}
          className="text-xs px-3 py-1.5 rounded-lg bg-emerald-900/30 hover:bg-emerald-900/50 text-emerald-400 border border-emerald-700/30 transition-colors"
        >
          Resolve
        </button>
        <button
          onClick={() => onEscalate(entry.id)}
          className="text-xs px-3 py-1.5 rounded-lg bg-red-900/20 hover:bg-red-900/40 text-red-400 border border-red-700/30 transition-colors"
        >
          Escalate
        </button>
      </div>
    </div>
  )
}

// ── CSLB Status Row ───────────────────────────────────────────────────────────

interface CSLBRowProps {
  label: string
  status: 'green' | 'amber' | 'red'
  score: number
  details: string[]
}

function CSLBRow({ label, status, score, details }: CSLBRowProps) {
  const [open, setOpen] = useState(false)
  const Icon = status === 'green' ? ShieldCheck : status === 'amber' ? ShieldAlert : ShieldX

  return (
    <div className={`rounded-xl border p-4 ${statusBg(status)}`}>
      <div
        className="flex items-center justify-between cursor-pointer"
        onClick={() => setOpen(!open)}
      >
        <div className="flex items-center gap-3">
          <Icon className={`w-5 h-5 ${statusColor(status)}`} />
          <div>
            <p className="text-sm font-semibold text-gray-200">{label}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <div className={`w-2 h-2 rounded-full ${statusDot(status)}`} />
              <span className={`text-xs font-medium ${statusColor(status)} capitalize`}>{status}</span>
              <span className="text-xs text-gray-500">Score: {score}/100</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Score bar */}
          <div className="w-20 h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                status === 'green' ? 'bg-emerald-400' : status === 'amber' ? 'bg-amber-400' : 'bg-red-400'
              }`}
              style={{ width: `${score}%` }}
            />
          </div>
          {open ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
        </div>
      </div>
      {open && (
        <ul className="mt-3 space-y-1">
          {details.map((d, i) => (
            <li key={i} className="flex items-center gap-2 text-xs text-gray-400">
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusDot(status)}`} />
              {d}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── Activity Feed Item ────────────────────────────────────────────────────────

function ActivityItem({ entry }: { entry: GuardianAuditEntry }) {
  return (
    <div className="flex items-start gap-3 py-2 border-b border-gray-800/60 last:border-0">
      <div className={`mt-0.5 flex-shrink-0 w-2 h-2 rounded-full ${statusDot(
        entry.severity === 'critical' || entry.severity === 'high' ? 'red' :
        entry.severity === 'medium' ? 'amber' : 'green'
      )}`} />
      <div className="flex-1 min-w-0">
        <p className="text-xs text-gray-300 leading-snug">{entry.message}</p>
        <p className="text-xs text-gray-600 mt-0.5">
          {entry.agentSource.toUpperCase()} · {formatTs(entry.timestamp)}
          {entry.projectId ? ` · ${entry.projectId}` : ''}
        </p>
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function GuardianDashboard() {
  const [metrics, setMetrics] = useState<MetricsState | null>(null)
  const [alerts, setAlerts] = useState<GuardianAuditEntry[]>([])
  const [activity, setActivity] = useState<GuardianAuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [showAllActivity, setShowAllActivity] = useState(false)

  const refresh = useCallback(() => {
    setLoading(true)
    try {
      const m = loadMetrics()
      setMetrics(m)

      const openAlerts = getOpenAlerts()
      setAlerts(openAlerts)

      // Activity feed: all entries from today
      const today = new Date().toISOString().slice(0, 10)
      const all = getAuditLog()
        .filter((e) => e.timestamp.startsWith(today))
        .reverse()
      setActivity(all)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 30_000)
    return () => clearInterval(interval)
  }, [refresh])

  function handleAcknowledge(id: string) {
    acknowledgeAlert(id)
    refresh()
  }

  function handleResolve(id: string) {
    resolveAlert(id)
    refresh()
  }

  function handleEscalate(id: string) {
    escalateAlert(id)
    refresh()
  }

  if (loading || !metrics) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-gray-500">
          <RefreshCw className="w-5 h-5 animate-spin" />
          <span className="text-sm">Loading GUARDIAN metrics…</span>
        </div>
      </div>
    )
  }

  const displayedActivity = showAllActivity ? activity : activity.slice(0, 8)

  return (
    <div className="flex flex-col gap-6 p-4 max-w-5xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-xl ${statusBg(metrics.cslb.overallStatus)}`}>
            <Shield className={`w-6 h-6 ${statusColor(metrics.cslb.overallStatus)}`} />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">GUARDIAN Dashboard</h1>
            <p className="text-xs text-gray-500">
              Compliance Command Center · Last refreshed {metrics.lastRefreshed.toLocaleTimeString()}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-semibold ${statusBg(metrics.cslb.overallStatus)} ${statusColor(metrics.cslb.overallStatus)}`}>
            <div className={`w-2 h-2 rounded-full ${statusDot(metrics.cslb.overallStatus)}`} />
            CSLB Score: {metrics.cslb.overallScore}/100
          </div>
          <button
            onClick={refresh}
            className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white border border-gray-700/40 transition-colors"
            title="Refresh metrics"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Metrics Cards */}
      <div>
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
          Compliance KPIs
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <MetricCard
            label="Callback Rate"
            value={`${metrics.callback.rate.toFixed(1)}%`}
            subtitle={`${metrics.callback.callbacks} callbacks / ${metrics.callback.total} completed jobs · Target <4%`}
            status={metrics.callback.status}
            icon={<ArrowUpRight className="w-4 h-4" />}
          />
          <MetricCard
            label="RFI Response Time"
            value={`${metrics.rfi.avgDays} days avg`}
            subtitle={`${metrics.rfi.openCount} open RFIs · By GC: ${
              Object.entries(metrics.rfi.byGC)
                .map(([gc, d]) => `${gc}: ${d}d`)
                .slice(0, 2)
                .join(', ') || 'No data'
            }`}
            status={metrics.rfi.avgDays <= 3 ? 'green' : metrics.rfi.avgDays <= 7 ? 'amber' : 'red'}
            icon={<Clock className="w-4 h-4" />}
          />
          <MetricCard
            label="Phase Doc Completion"
            value={`${metrics.docComp.rate.toFixed(0)}%`}
            subtitle={`${metrics.docComp.completePhases} of ${metrics.docComp.totalPhases} phases with pre/post docs`}
            status={metrics.docComp.rate >= 75 ? 'green' : metrics.docComp.rate >= 50 ? 'amber' : 'red'}
            icon={<FileText className="w-4 h-4" />}
          />
          <MetricCard
            label="Boundary Violations"
            value={`${metrics.violations.perMonth}/mo`}
            subtitle={`Last month: ${metrics.violations.lastMonth} · Trend: ${metrics.violations.trend}`}
            status={metrics.violations.perMonth === 0 ? 'green' : metrics.violations.perMonth <= 3 ? 'amber' : 'red'}
            trend={metrics.violations.trend}
            trendLabel={metrics.violations.trend === 'up' ? '+' + (metrics.violations.thisMonth - metrics.violations.lastMonth) : metrics.violations.trend === 'down' ? '-' + (metrics.violations.lastMonth - metrics.violations.thisMonth) : ''}
            icon={<AlertTriangle className="w-4 h-4" />}
          />
          <MetricCard
            label="Solo Work Check-In"
            value={`${metrics.solo.rate.toFixed(0)}%`}
            subtitle={`${metrics.solo.compliantSessions} of ${metrics.solo.totalSessions} solo sessions with completed protocol`}
            status={metrics.solo.rate >= 80 ? 'green' : metrics.solo.rate >= 60 ? 'amber' : 'red'}
            icon={<Users className="w-4 h-4" />}
          />
          <MetricCard
            label="Change Order Conversion"
            value={`${metrics.changeOrders.rate.toFixed(0)}%`}
            subtitle={`${metrics.changeOrders.converted} of ${metrics.changeOrders.detected} verbal scope changes written`}
            status={metrics.changeOrders.rate >= 80 ? 'green' : metrics.changeOrders.rate >= 60 ? 'amber' : 'red'}
            icon={<CheckCircle2 className="w-4 h-4" />}
          />
        </div>
      </div>

      {/* Open Alerts */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-orange-400" />
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Open Alerts
            </h2>
            {alerts.length > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-red-900/30 border border-red-700/30 text-red-400 text-xs font-semibold">
                {alerts.length}
              </span>
            )}
          </div>
        </div>
        {alerts.length === 0 ? (
          <div className="rounded-xl border border-emerald-700/20 bg-emerald-900/10 p-6 text-center">
            <ShieldCheck className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
            <p className="text-sm text-emerald-400 font-semibold">No open alerts</p>
            <p className="text-xs text-gray-500 mt-1">All compliance checkpoints clear</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {alerts.map((alert) => (
              <AlertCard
                key={alert.id}
                entry={alert}
                onAcknowledge={handleAcknowledge}
                onResolve={handleResolve}
                onEscalate={handleEscalate}
              />
            ))}
          </div>
        )}
      </div>

      {/* Recent Activity Feed */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Activity className="w-4 h-4 text-blue-400" />
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Today's GUARDIAN Activity
          </h2>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
          {activity.length === 0 ? (
            <p className="text-xs text-gray-600 text-center py-4">No GUARDIAN actions recorded today.</p>
          ) : (
            <>
              {displayedActivity.map((entry) => (
                <ActivityItem key={entry.id} entry={entry} />
              ))}
              {activity.length > 8 && (
                <button
                  onClick={() => setShowAllActivity(!showAllActivity)}
                  className="mt-2 text-xs text-blue-400 hover:text-blue-300 transition-colors w-full text-center"
                >
                  {showAllActivity ? 'Show less' : `Show ${activity.length - 8} more`}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* CSLB Protection Status */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Shield className="w-4 h-4 text-purple-400" />
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            CSLB Protection Status
          </h2>
          <span className={`text-xs font-semibold px-2 py-0.5 rounded ${
            metrics.cslb.overallStatus === 'green' ? 'bg-emerald-900/30 text-emerald-400' :
            metrics.cslb.overallStatus === 'amber' ? 'bg-amber-900/30 text-amber-400' :
            'bg-red-900/30 text-red-400'
          }`}>
            {metrics.cslb.overallScore}/100 Overall
          </span>
        </div>
        <div className="flex flex-col gap-3">
          <CSLBRow
            label={metrics.cslb.customerComplaint.label}
            status={metrics.cslb.customerComplaint.status}
            score={metrics.cslb.customerComplaint.score}
            details={metrics.cslb.customerComplaint.details}
          />
          <CSLBRow
            label={metrics.cslb.workerComplaint.label}
            status={metrics.cslb.workerComplaint.status}
            score={metrics.cslb.workerComplaint.score}
            details={metrics.cslb.workerComplaint.details}
          />
          <CSLBRow
            label={metrics.cslb.permitViolation.label}
            status={metrics.cslb.permitViolation.status}
            score={metrics.cslb.permitViolation.score}
            details={metrics.cslb.permitViolation.details}
          />
        </div>
      </div>

    </div>
  )
}
