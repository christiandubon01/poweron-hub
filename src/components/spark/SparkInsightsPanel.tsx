import React, { useState, useEffect } from 'react'
import {
  ConversionFunnelMetrics,
  WeeklyInsightReport,
  PatternInsight,
  ActionItem,
  getLatestInsightReport,
  analyzeConversionFunnel,
  loadConversationLogs,
  triggerPatternAnalysis,
} from '@/services/sparkLiveCall/SparkPatternEngine'

interface SparkInsightsPanelProps {
  className?: string
}

/**
 * SparkInsightsPanel
 * React component showing pattern analysis, conversion funnel, opening effectiveness,
 * and weekly trend cards.
 */
export const SparkInsightsPanel: React.FC<SparkInsightsPanelProps> = ({
  className = '',
}) => {
  const [report, setReport] = useState<WeeklyInsightReport | null>(null)
  const [funnel, setFunnel] = useState<ConversionFunnelMetrics | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadInsights()
  }, [])

  const loadInsights = () => {
    setLoading(true)
    try {
      const latestReport = getLatestInsightReport()
      setReport(latestReport)

      const logs = loadConversationLogs()
      const funnelData = analyzeConversionFunnel(logs)
      setFunnel(funnelData)

      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load insights')
    } finally {
      setLoading(false)
    }
  }

  const handleRefresh = () => {
    const updated = triggerPatternAnalysis()
    if (updated) {
      setReport(updated)
    }
  }

  if (loading) {
    return (
      <div className={`p-4 text-center text-gray-500 ${className}`}>
        <div className="animate-pulse">Loading insights...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={`p-4 text-red-500 ${className}`}>
        <div className="font-semibold">Error loading insights</div>
        <div className="text-sm">{error}</div>
        <button
          onClick={loadInsights}
          className="mt-2 px-3 py-1 bg-red-500 text-white rounded text-sm hover:bg-red-600"
        >
          Retry
        </button>
      </div>
    )
  }

  if (!report) {
    return (
      <div className={`p-6 text-center text-gray-400 ${className}`}>
        <div className="mb-4">
          <svg
            className="w-12 h-12 mx-auto opacity-50"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
            />
          </svg>
        </div>
        <div className="font-semibold mb-2">No insights yet</div>
        <div className="text-sm mb-4">
          Accumulate 10+ conversations to unlock pattern analysis.
        </div>
        <button
          onClick={handleRefresh}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Check Now
        </button>
      </div>
    )
  }

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
          SPARK Pattern Analysis
        </h2>
        <button
          onClick={handleRefresh}
          className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Refresh
        </button>
      </div>

      {/* FEATURED: Week Insight */}
      <FeaturedInsightCard report={report} />

      {/* CONVERSION FUNNEL VISUALIZATION */}
      {funnel && <ConversionFunnelVisualization funnel={funnel} />}

      {/* TOP WORKING + TOP ISSUES */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <InsightGroup title="✅ Top 3 Working" insights={report.topWorking} />
        <InsightGroup title="⚠️ Top 3 to Fix" insights={report.topIssues} />
      </div>

      {/* ACTIONABLE ITEMS */}
      {report.actionable.length > 0 && <ActionItemsList items={report.actionable} />}

      {/* METADATA */}
      <div className="text-xs text-gray-500 dark:text-gray-400">
        Week ending {report.weekEnding} · {report.conversationCount} conversations analyzed
      </div>
    </div>
  )
}

/**
 * Featured Insight Card — prominent display of the key insight.
 */
const FeaturedInsightCard: React.FC<{ report: WeeklyInsightReport }> = ({ report }) => {
  const topInsight = report.topWorking[0]
  if (!topInsight) return null

  return (
    <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900 dark:to-indigo-900 border-l-4 border-blue-500 p-6 rounded-lg">
      <div className="flex items-start justify-between mb-3">
        <div className="text-sm font-semibold text-blue-600 dark:text-blue-300 uppercase tracking-wide">
          ⭐ INSIGHT OF THE WEEK
        </div>
        <div className="text-xs font-semibold text-blue-500 bg-white dark:bg-blue-800 px-2 py-1 rounded">
          {Math.round(topInsight.confidence * 100)}% confidence
        </div>
      </div>
      <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
        {topInsight.finding}
      </h3>
      <p className="text-sm text-gray-700 dark:text-gray-300 mb-4">{report.nextWeekFocus}</p>
      <div className="text-xs text-blue-600 dark:text-blue-300">
        <strong>Action:</strong> {report.actionable[0]?.title || 'Focus on this pattern'}
      </div>
    </div>
  )
}

/**
 * Conversion Funnel Visualization — simple SVG bar chart.
 */
const ConversionFunnelVisualization: React.FC<{ funnel: ConversionFunnelMetrics }> = ({
  funnel,
}) => {
  const { totalCalls, conversationsOverTwoMin, scheduledVisits } = funnel

  if (totalCalls === 0) return null

  const pct1 = (conversationsOverTwoMin / totalCalls) * 100
  const pct2 = scheduledVisits > 0 ? (scheduledVisits / conversationsOverTwoMin) * 100 : 0

  return (
    <div className="bg-white dark:bg-gray-800 p-6 rounded-lg border border-gray-200 dark:border-gray-700">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-6">
        Conversion Funnel
      </h3>
      <div className="space-y-4">
        {/* Stage 1: Total Calls */}
        <FunnelStage
          label="Total Calls"
          value={totalCalls}
          percentage={100}
          color="bg-blue-500"
        />

        {/* Stage 2: Conversations > 2 min */}
        <FunnelStage
          label="Conversations > 2 min"
          value={conversationsOverTwoMin}
          percentage={pct1}
          color="bg-indigo-500"
        />

        {/* Stage 3: Scheduled Visits */}
        <FunnelStage
          label="Scheduled Visits"
          value={scheduledVisits}
          percentage={pct2}
          color="bg-green-500"
        />
      </div>

      {/* Conversion Rate Summary */}
      <div className="mt-6 p-4 bg-gray-50 dark:bg-gray-700 rounded">
        <div className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
          Overall Conversion Rate
        </div>
        <div className="text-2xl font-bold text-gray-900 dark:text-white">
          {(funnel.conversionRate * 100).toFixed(1)}%
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          scheduled visits / 2+ min conversations
        </div>
      </div>
    </div>
  )
}

/**
 * Individual funnel stage bar.
 */
const FunnelStage: React.FC<{
  label: string
  value: number
  percentage: number
  color: string
}> = ({ label, value, percentage, color }) => (
  <div>
    <div className="flex justify-between mb-2">
      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</span>
      <span className="text-sm font-semibold text-gray-900 dark:text-white">{value}</span>
    </div>
    <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-2 overflow-hidden">
      <div
        className={`h-full ${color} transition-all duration-300`}
        style={{ width: `${Math.max(percentage, 5)}%` }}
      />
    </div>
    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{percentage.toFixed(1)}%</div>
  </div>
)

/**
 * Group of insights (Top Working / Top Issues).
 */
const InsightGroup: React.FC<{
  title: string
  insights: PatternInsight[]
}> = ({ title, insights }) => (
  <div className="bg-white dark:bg-gray-800 p-6 rounded-lg border border-gray-200 dark:border-gray-700">
    <h3 className="font-semibold text-gray-900 dark:text-white mb-4">{title}</h3>
    <div className="space-y-4">
      {insights.length === 0 ? (
        <div className="text-sm text-gray-500 dark:text-gray-400">No data yet</div>
      ) : (
        insights.map((insight, idx) => (
          <InsightCard key={idx} insight={insight} />
        ))
      )}
    </div>
  </div>
)

/**
 * Individual insight card.
 */
const InsightCard: React.FC<{ insight: PatternInsight }> = ({ insight }) => (
  <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded border-l-2 border-indigo-500">
    <div className="flex justify-between items-start mb-2">
      <div className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 uppercase">
        {insight.category}
      </div>
      <div className="text-xs font-semibold text-gray-600 dark:text-gray-400">
        {typeof insight.metric === 'number'
          ? insight.metric.toFixed(1)
          : insight.metric}
      </div>
    </div>
    <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">{insight.finding}</p>
    {insight.comparative && (
      <div className="text-xs text-gray-500 dark:text-gray-400">
        <em>{insight.comparative}</em>
      </div>
    )}
  </div>
)

/**
 * Actionable items list.
 */
const ActionItemsList: React.FC<{ items: ActionItem[] }> = ({ items }) => (
  <div className="bg-white dark:bg-gray-800 p-6 rounded-lg border border-gray-200 dark:border-gray-700">
    <h3 className="font-semibold text-gray-900 dark:text-white mb-4">
      🎯 Actionable This Week
    </h3>
    <div className="space-y-4">
      {items.map((item, idx) => (
        <ActionItemCard key={idx} item={item} />
      ))}
    </div>
  </div>
)

/**
 * Individual action item card.
 */
const ActionItemCard: React.FC<{ item: ActionItem }> = ({ item }) => {
  const priorityColor =
    item.priority === 'high'
      ? 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200'
      : item.priority === 'medium'
        ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200'
        : 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200'

  return (
    <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded border-l-2 border-yellow-500">
      <div className="flex items-start justify-between mb-2">
        <h4 className="font-semibold text-gray-900 dark:text-white">{item.title}</h4>
        <span
          className={`text-xs font-semibold px-2 py-1 rounded capitalize ${priorityColor}`}
        >
          {item.priority}
        </span>
      </div>
      <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">{item.description}</p>
      <div className="text-xs text-gray-600 dark:text-gray-400">
        <strong>Impact:</strong> {item.estimatedImpact}
      </div>
    </div>
  )
}

export default SparkInsightsPanel
