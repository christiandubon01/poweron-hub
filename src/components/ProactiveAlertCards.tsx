// @ts-nocheck
/**
 * ProactiveAlertCards — B12 Proactive NEXUS Alerts
 *
 * Horizontal scrollable row of proactive alert cards shown at the dashboard top,
 * alongside the ConclusionCards row.
 *
 * Severity color coding:
 * - critical → red border/badge
 * - warning  → yellow/amber border/badge
 * - info     → blue border/badge
 *
 * Dismissed alerts vanish immediately and won't re-surface for 24 hours.
 */

import { useState, useEffect, useCallback } from 'react'
import { AlertTriangle, AlertCircle, Info, X, RefreshCw } from 'lucide-react'
import {
  getActiveAlerts,
  dismissAlert,
  initAlertEngine,
  type ProactiveAlert,
  type AlertSeverity,
} from '../services/proactiveAlertService'
import { logDismissedAlert } from '../services/feedbackLoopService'

// ── Style maps ────────────────────────────────────────────────────────────────

const SEVERITY_STYLES: Record<AlertSeverity, {
  border: string
  bg: string
  badge: string
  badgeBg: string
  icon: string
  dimBorder: string
}> = {
  critical: {
    border: '#7f1d1d55',
    bg: '#120809',
    badge: '#f87171',
    badgeBg: '#7f1d1d22',
    icon: '#f87171',
    dimBorder: '#7f1d1d33',
  },
  warning: {
    border: '#78350f55',
    bg: '#120f06',
    badge: '#fbbf24',
    badgeBg: '#78350f22',
    icon: '#fbbf24',
    dimBorder: '#78350f33',
  },
  info: {
    border: '#1e3a5f55',
    bg: '#060d14',
    badge: '#60a5fa',
    badgeBg: '#1e3a5f22',
    icon: '#60a5fa',
    dimBorder: '#1e3a5f33',
  },
}

function SeverityIcon({ severity, size = 14 }: { severity: AlertSeverity; size?: number }) {
  const color = SEVERITY_STYLES[severity].icon
  if (severity === 'critical') return <AlertCircle size={size} style={{ color }} />
  if (severity === 'warning') return <AlertTriangle size={size} style={{ color }} />
  return <Info size={size} style={{ color }} />
}

function SeverityBadge({ severity }: { severity: AlertSeverity }) {
  const s = SEVERITY_STYLES[severity]
  const label = severity.toUpperCase()
  return (
    <span
      className="text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wider"
      style={{ backgroundColor: s.badgeBg, borderColor: s.border, color: s.badge }}
    >
      {label}
    </span>
  )
}

// ── Single alert card ─────────────────────────────────────────────────────────

function AlertCard({
  alert,
  onDismiss,
}: {
  alert: ProactiveAlert
  onDismiss: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [dismissing, setDismissing] = useState(false)
  const s = SEVERITY_STYLES[alert.severity]

  function handleDismiss(e: React.MouseEvent) {
    e.stopPropagation()
    if (dismissing) return
    setDismissing(true)
    dismissAlert(alert.id)
    // T1 — passive feedback: log silent dismissal to audit_decisions
    logDismissedAlert({
      agent: 'NEXUS',
      alert_content: alert.message,
    })
    onDismiss(alert.id)
  }

  return (
    <div
      className="flex-shrink-0 rounded-xl border flex flex-col gap-2 cursor-pointer select-none"
      style={{
        width: '230px',
        backgroundColor: s.bg,
        borderColor: s.border,
        padding: '12px 14px',
        transition: 'border-color 0.15s, background-color 0.15s',
        opacity: dismissing ? 0.4 : 1,
      }}
      onClick={() => setExpanded(v => !v)}
      role="button"
      aria-expanded={expanded}
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && setExpanded(v => !v)}
    >
      {/* Header: severity badge + dismiss */}
      <div className="flex items-center justify-between">
        <SeverityBadge severity={alert.severity} />
        <button
          className="flex items-center justify-center rounded opacity-50 hover:opacity-100 transition-opacity"
          style={{ color: s.icon, padding: '2px' }}
          onClick={handleDismiss}
          title="Dismiss for 24 hours"
          aria-label="Dismiss alert"
        >
          <X size={12} />
        </button>
      </div>

      {/* Alert icon + message */}
      <div className="flex items-start gap-2">
        <div className="flex-shrink-0 mt-0.5">
          <SeverityIcon severity={alert.severity} size={13} />
        </div>
        <p
          className="text-xs leading-relaxed"
          style={{
            color: '#d1d5db',
            ...(expanded
              ? {}
              : {
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }),
          }}
        >
          {alert.message}
        </p>
      </div>

      {/* Entity label */}
      {alert.entityLabel && (
        <span
          className="text-[10px] font-medium px-1.5 py-0.5 rounded border self-start"
          style={{
            backgroundColor: s.badgeBg,
            borderColor: s.dimBorder,
            color: s.badge,
          }}
        >
          {alert.entityLabel}
        </span>
      )}
    </div>
  )
}

// ── ProactiveAlertCards ───────────────────────────────────────────────────────

export default function ProactiveAlertCards() {
  const [alerts, setAlerts] = useState<ProactiveAlert[]>([])
  const [collapsed, setCollapsed] = useState(false)

  // Initialize engine + load alerts on mount
  useEffect(() => {
    const cleanup = initAlertEngine()

    // Small delay so engine has time to run initial check
    const tid = setTimeout(() => {
      setAlerts(getActiveAlerts())
    }, 50)

    // Re-read alerts after data-saved events (engine re-runs inside)
    function handleDataSaved() {
      setAlerts(getActiveAlerts())
    }
    window.addEventListener('poweron-data-saved', handleDataSaved)

    return () => {
      clearTimeout(tid)
      cleanup()
      window.removeEventListener('poweron-data-saved', handleDataSaved)
    }
  }, [])

  const handleDismiss = useCallback((id: string) => {
    setAlerts(prev => prev.filter(a => a.id !== id))
  }, [])

  // Don't render if no active alerts
  if (alerts.length === 0) return null

  // ── Collapsed: show pill ──────────────────────────────────────────────────

  if (collapsed) {
    const critCount = alerts.filter(a => a.severity === 'critical').length
    const hasCrit = critCount > 0
    return (
      <div className="px-6 py-2 flex-shrink-0">
        <button
          onClick={() => setCollapsed(false)}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors"
          style={{
            borderColor: hasCrit ? '#7f1d1d55' : '#78350f55',
            color: hasCrit ? '#f87171' : '#fbbf24',
            backgroundColor: hasCrit ? '#12080944' : '#120f0644',
          }}
        >
          {hasCrit ? <AlertCircle size={11} /> : <AlertTriangle size={11} />}
          Active alerts
          <span
            className="ml-1 text-xs font-bold px-1.5 py-0.5 rounded-full"
            style={{
              backgroundColor: hasCrit ? '#7f1d1d44' : '#78350f44',
              color: hasCrit ? '#f87171' : '#fbbf24',
            }}
          >
            {alerts.length}
          </span>
        </button>
      </div>
    )
  }

  // ── Expanded: full row ────────────────────────────────────────────────────

  return (
    <div
      className="flex-shrink-0 border-b"
      style={{ borderColor: '#1a1c23', backgroundColor: '#08090c' }}
    >
      {/* Header row */}
      <div className="flex items-center justify-between px-6 pt-3 pb-1">
        <div className="flex items-center gap-2">
          <div
            className="w-1.5 h-1.5 rounded-full animate-pulse"
            style={{ backgroundColor: '#f87171' }}
          />
          <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#6b7280' }}>
            NEXUS Alerts
          </span>
          <span
            className="text-xs px-1.5 py-0.5 rounded-full font-bold"
            style={{ backgroundColor: '#7f1d1d33', color: '#f87171' }}
          >
            {alerts.length}
          </span>
        </div>

        <button
          onClick={() => setCollapsed(true)}
          className="text-xs transition-colors hover:text-gray-400"
          style={{ color: '#4b5563' }}
          title="Collapse"
        >
          ✕
        </button>
      </div>

      {/* Scrollable card row */}
      <div
        className="flex gap-3 px-6 pb-3 overflow-x-auto"
        style={{ scrollbarWidth: 'thin', scrollbarColor: '#1e2128 transparent' }}
      >
        {alerts.map(alert => (
          <AlertCard
            key={alert.id}
            alert={alert}
            onDismiss={handleDismiss}
          />
        ))}
      </div>
    </div>
  )
}
