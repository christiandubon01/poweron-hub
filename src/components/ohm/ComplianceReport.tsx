// @ts-nocheck
/**
 * ComplianceReport — Compliance check results display.
 *
 * Features:
 * - Overall compliance status (pass/fail)
 * - Issues grouped by severity (error/warning/info)
 * - Recommendations with actionable guidance
 * - NEC article references
 * - Project and jurisdiction context
 */

import { useState, useEffect } from 'react'
import { AlertCircle, CheckCircle, AlertTriangle, Info, Loader2, RefreshCw } from 'lucide-react'
import { clsx } from 'clsx'
import { useAuth } from '@/hooks/useAuth'
import type { ComplianceCheckResult } from '@/agents/ohm/complianceChecker'
import { processOhmRequest } from '@/agents/ohm'

// ── Types ────────────────────────────────────────────────────────────────────

export interface ComplianceReportProps {
  projectId: string
  projectName?: string
  jurisdiction?: string
  onRefresh?: () => void
  autoLoad?: boolean
}

// ── Component ────────────────────────────────────────────────────────────────

export function ComplianceReport({
  projectId,
  projectName = 'Untitled Project',
  jurisdiction = 'California',
  onRefresh,
  autoLoad = true,
}: ComplianceReportProps) {
  const { user, org } = useAuth()
  const [result, setResult] = useState<ComplianceCheckResult | null>(null)
  const [loading, setLoading] = useState(autoLoad)
  const [error, setError] = useState('')
  const [expandedIssues, setExpandedIssues] = useState<Set<string>>(new Set())

  // ── Load Compliance Check ────────────────────────────────────────────────

  const loadComplianceCheck = async () => {
    if (!user || !org) return

    setLoading(true)
    setError('')

    try {
      const response = await processOhmRequest({
        action: 'compliance_check',
        orgId: org.id,
        userId: user.id,
        payload: {
          projectId,
          jurisdiction,
        },
      })

      if (!response.success) {
        throw new Error(response.error || 'Compliance check failed')
      }

      setResult(response.data as ComplianceCheckResult)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load compliance check'
      setError(message)
      console.error('[ComplianceReport] Load error:', err)
    } finally {
      setLoading(false)
    }
  }

  // ── Auto-load on mount ───────────────────────────────────────────────────

  useEffect(() => {
    if (autoLoad) {
      loadComplianceCheck()
    }
  }, [projectId, user, org])

  // ── Toggle Issue Expansion ───────────────────────────────────────────────

  const toggleIssueExpanded = (issueCode: string) => {
    const newExpanded = new Set(expandedIssues)
    if (newExpanded.has(issueCode)) {
      newExpanded.delete(issueCode)
    } else {
      newExpanded.add(issueCode)
    }
    setExpandedIssues(newExpanded)
  }

  // ── Render Status Badge ──────────────────────────────────────────────────

  const renderStatusBadge = () => {
    if (!result) return null

    if (result.compliant) {
      return (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-900/30
          text-emerald-300 rounded-lg border border-emerald-700/50">
          <CheckCircle size={16} />
          <span className="font-semibold text-sm">COMPLIANT</span>
        </div>
      )
    }

    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-red-900/30
        text-red-300 rounded-lg border border-red-700/50">
        <AlertCircle size={16} />
        <span className="font-semibold text-sm">NON-COMPLIANT</span>
      </div>
    )
  }

  // ── Render Severity Icon ────────────────────────────────────────────────

  const renderSeverityIcon = (severity: 'info' | 'warning' | 'error') => {
    switch (severity) {
      case 'error':
        return <AlertCircle size={16} className="text-red-400" />
      case 'warning':
        return <AlertTriangle size={16} className="text-amber-400" />
      case 'info':
        return <Info size={16} className="text-blue-400" />
    }
  }

  // ── Render Severity Badge ───────────────────────────────────────────────

  const renderSeverityBadge = (severity: 'info' | 'warning' | 'error') => {
    const baseClass = 'px-2 py-0.5 text-xs font-semibold rounded'
    switch (severity) {
      case 'error':
        return <span className={clsx(baseClass, 'bg-red-900/30 text-red-300')}>ERROR</span>
      case 'warning':
        return <span className={clsx(baseClass, 'bg-amber-900/30 text-amber-300')}>WARNING</span>
      case 'info':
        return <span className={clsx(baseClass, 'bg-blue-900/30 text-blue-300')}>INFO</span>
    }
  }

  // ── Render Severity Count ───────────────────────────────────────────────

  const renderSeverityCounts = () => {
    if (!result) return null

    return (
      <div className="flex gap-4 text-sm">
        {result.severityCount.error > 0 && (
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded
            bg-red-900/20 text-red-300 border border-red-700/30">
            <AlertCircle size={14} />
            <span className="font-semibold">{result.severityCount.error} Error</span>
            {result.severityCount.error > 1 && 's'}
          </div>
        )}
        {result.severityCount.warning > 0 && (
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded
            bg-amber-900/20 text-amber-300 border border-amber-700/30">
            <AlertTriangle size={14} />
            <span className="font-semibold">{result.severityCount.warning} Warning</span>
            {result.severityCount.warning > 1 && 's'}
          </div>
        )}
        {result.severityCount.info > 0 && (
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded
            bg-blue-900/20 text-blue-300 border border-blue-700/30">
            <Info size={14} />
            <span className="font-semibold">{result.severityCount.info} Info</span>
            {result.severityCount.info > 1 && 's'}
          </div>
        )}
      </div>
    )
  }

  // ── Render Issues Grouped by Severity ────────────────────────────────────

  const renderIssues = () => {
    if (!result || result.issues.length === 0) {
      return (
        <div className="p-4 text-center text-gray-400">
          <p>No compliance issues detected</p>
        </div>
      )
    }

    // Group by severity
    const byError = result.issues.filter(i => i.severity === 'error')
    const byWarning = result.issues.filter(i => i.severity === 'warning')
    const byInfo = result.issues.filter(i => i.severity === 'info')

    return (
      <div className="space-y-4">
        {/* Errors */}
        {byError.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold text-red-300 mb-3 flex items-center gap-2">
              <AlertCircle size={16} />
              Critical Issues ({byError.length})
            </h4>
            <div className="space-y-2">
              {byError.map(issue => renderIssueCard(issue))}
            </div>
          </div>
        )}

        {/* Warnings */}
        {byWarning.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold text-amber-300 mb-3 flex items-center gap-2">
              <AlertTriangle size={16} />
              Warnings ({byWarning.length})
            </h4>
            <div className="space-y-2">
              {byWarning.map(issue => renderIssueCard(issue))}
            </div>
          </div>
        )}

        {/* Info */}
        {byInfo.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold text-blue-300 mb-3 flex items-center gap-2">
              <Info size={16} />
              Additional Information ({byInfo.length})
            </h4>
            <div className="space-y-2">
              {byInfo.map(issue => renderIssueCard(issue))}
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── Render Single Issue Card ─────────────────────────────────────────────

  const renderIssueCard = (issue: any) => {
    const isExpanded = expandedIssues.has(issue.code)

    return (
      <div
        key={issue.code}
        className="p-3 bg-gray-800/50 border border-gray-700 rounded-lg
          hover:border-gray-600 transition-colors cursor-pointer"
        onClick={() => toggleIssueExpanded(issue.code)}
      >
        <div className="flex items-start gap-3">
          {renderSeverityIcon(issue.severity)}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h5 className="font-semibold text-gray-200 text-sm">{issue.title}</h5>
              {renderSeverityBadge(issue.severity)}
            </div>
            <p className="text-gray-400 text-sm mb-2">{issue.description}</p>

            {/* Expanded Details */}
            {isExpanded && (
              <div className="mt-3 pt-3 border-t border-gray-700 space-y-2">
                <div>
                  <p className="text-xs font-semibold text-gray-400 mb-1">NEC Articles:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {issue.necArticles.map((article: string) => (
                      <span
                        key={article}
                        className="px-2 py-0.5 bg-gray-700/50 text-cyan-300 text-xs rounded"
                      >
                        NEC {article}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-400 mb-1">Recommendation:</p>
                  <p className="text-gray-300 text-sm">{issue.recommendation}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ── Render Recommendations ───────────────────────────────────────────────

  const renderRecommendations = () => {
    if (!result || result.recommendations.length === 0) {
      return null
    }

    return (
      <div className="p-4 bg-cyan-900/20 border border-cyan-700/30 rounded-lg">
        <h4 className="text-sm font-semibold text-cyan-300 mb-3">Recommendations</h4>
        <ul className="space-y-2">
          {result.recommendations.map((rec, idx) => (
            <li key={idx} className="flex items-start gap-2.5 text-sm text-gray-300">
              <span className="text-cyan-400 font-bold mt-0.5">•</span>
              <span>{rec}</span>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  // ── Main Render ──────────────────────────────────────────────────────────

  if (loading && !result) {
    return (
      <div className="flex items-center justify-center h-32 bg-gray-900 text-gray-100">
        <div className="flex items-center gap-2 text-gray-400">
          <Loader2 size={20} className="animate-spin" />
          <span>Running compliance check...</span>
        </div>
      </div>
    )
  }

  if (error && !result) {
    return (
      <div className="p-4 bg-gray-900 text-gray-100">
        <div className="p-3 bg-red-900/20 border border-red-700 rounded
          flex items-start gap-3 text-red-200 text-sm mb-4">
          <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold mb-1">Error</p>
            <p>{error}</p>
          </div>
        </div>
        <button
          onClick={loadComplianceCheck}
          className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700
            text-white text-sm rounded font-medium transition-colors"
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="h-full bg-gray-900 text-gray-100 overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 p-4 border-b border-gray-800 bg-gray-900/95 backdrop-blur-sm">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <h2 className="text-lg font-semibold mb-1">{projectName}</h2>
            <p className="text-sm text-gray-400">Jurisdiction: {jurisdiction}</p>
          </div>
          <button
            onClick={loadComplianceCheck}
            disabled={loading}
            className="p-2 hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-50"
            title="Refresh compliance check"
          >
            <RefreshCw size={16} className={clsx(loading && 'animate-spin')} />
          </button>
        </div>
        <div className="flex items-center gap-3 justify-between">
          {renderStatusBadge()}
          {renderSeverityCounts()}
        </div>
      </div>

      {/* Content */}
      <div className="p-4 space-y-4">
        {/* Issues */}
        {result && (
          <div className="bg-gray-800/30 border border-gray-700 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-200 mb-4">Issues & Findings</h3>
            {renderIssues()}
          </div>
        )}

        {/* Recommendations */}
        {result && renderRecommendations()}

        {/* Last Checked */}
        {result && (
          <p className="text-xs text-gray-500 text-center pt-2">
            Last checked: {new Date(result.checkedAt).toLocaleString()}
          </p>
        )}
      </div>
    </div>
  )
}
