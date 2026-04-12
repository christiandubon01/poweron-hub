// @ts-nocheck
/**
 * HunterOutcomeStats.tsx
 * Analytics sub-panel showing outcome statistics
 *
 * Displays:
 * - Win rate percentage (large number, green)
 * - Average revenue per won lead
 * - Top loss reasons (bar chart or ranked list)
 * - Win rate by source (which lead sources produce wins)
 * - Win rate by pitch angle (which angles convert)
 * - Trend: win rate over time (last 30/60/90 days)
 */

import React, { useEffect, useState } from 'react'
import { TrendingUp, TrendingDown, AlertCircle } from 'lucide-react'
import clsx from 'clsx'
import {
  getOutcomeStats,
  getOutcomesBySource,
  getOutcomesByPitchAngle,
  getTopLossReasons,
  getOutcomeTrend,
  type OutcomeStats,
  type OutcomeBySource,
  type OutcomeByPitchAngle,
  type TopLossReasons,
  type OutcomeTrend,
} from '@/services/hunter/HunterOutcomeTracker'

export interface HunterOutcomeStatsProps {
  userId?: string
  refreshTrigger?: number // increment to force refresh
  compact?: boolean // true for card view, false for full panel
}

export function HunterOutcomeStats({
  userId,
  refreshTrigger,
  compact = false,
}: HunterOutcomeStatsProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<OutcomeStats | null>(null)
  const [bySource, setBySource] = useState<OutcomeBySource[]>([])
  const [byAngle, setByAngle] = useState<OutcomeByPitchAngle[]>([])
  const [topLosses, setTopLosses] = useState<TopLossReasons[]>([])
  const [trends, setTrends] = useState<OutcomeTrend[]>([])
  const [trendDays, setTrendDays] = useState(30)

  useEffect(() => {
    loadData()
  }, [refreshTrigger])

  const loadData = async () => {
    setLoading(true)
    setError(null)
    try {
      const [statsData, sourceData, angleData, lossesData, trendsData] = await Promise.all([
        getOutcomeStats(),
        getOutcomesBySource(),
        getOutcomesByPitchAngle(),
        getTopLossReasons(),
        getOutcomeTrend(trendDays),
      ])

      setStats(statsData)
      setBySource(sourceData)
      setByAngle(angleData)
      setTopLosses(lossesData)
      setTrends(trendsData)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load statistics')
      console.error('[HunterOutcomeStats] Error:', err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-gray-700 border-t-blue-500 rounded-full animate-spin mx-auto mb-2" />
          <p className="text-sm text-gray-400">Loading statistics...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center gap-3 p-4 bg-red-900/20 border border-red-700/30 rounded-lg">
        <AlertCircle size={18} className="text-red-400 flex-shrink-0" />
        <p className="text-sm text-red-200">{error}</p>
      </div>
    )
  }

  if (!stats) {
    return <div className="text-center py-8 text-gray-400">No data available</div>
  }

  if (compact) {
    return <CompactView stats={stats} onRefresh={loadData} />
  }

  return (
    <div className="space-y-6 p-6">
      {/* Key Metrics Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Win Rate Card */}
        <div className="bg-gray-800/50 border border-gray-700/30 rounded-lg p-4">
          <p className="text-sm text-gray-400 mb-2">Win Rate</p>
          <div className="flex items-end gap-3">
            <div className="text-4xl font-bold text-green-400">{stats.winRate.toFixed(1)}%</div>
            <p className="text-xs text-gray-500 mb-1">
              {stats.wonCount} / {stats.wonCount + stats.lostCount}
            </p>
          </div>
        </div>

        {/* Avg Revenue Per Win */}
        <div className="bg-gray-800/50 border border-gray-700/30 rounded-lg p-4">
          <p className="text-sm text-gray-400 mb-2">Avg Revenue Per Win</p>
          <div className="text-3xl font-bold text-blue-400">
            ${stats.avgRevenuePerWin.toLocaleString('en-US', { maximumFractionDigits: 0 })}
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Total: ${stats.totalRevenueWon.toLocaleString('en-US', { maximumFractionDigits: 0 })}
          </p>
        </div>

        {/* Total Leads */}
        <div className="bg-gray-800/50 border border-gray-700/30 rounded-lg p-4">
          <p className="text-sm text-gray-400 mb-2">Pipeline Status</p>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-300">Active:</span>
              <span className="font-medium text-white">{stats.totalLeads - stats.archivedCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-300">Archived:</span>
              <span className="font-medium text-gray-400">{stats.archivedCount}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Win/Loss Breakdown */}
      <div className="bg-gray-800/50 border border-gray-700/30 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-200 mb-4">Outcome Breakdown</h3>
        <div className="grid grid-cols-4 gap-3">
          <div className="bg-gray-900/50 rounded p-3 text-center">
            <p className="text-2xl font-bold text-green-400">{stats.wonCount}</p>
            <p className="text-xs text-gray-400 mt-1">Won</p>
          </div>
          <div className="bg-gray-900/50 rounded p-3 text-center">
            <p className="text-2xl font-bold text-red-400">{stats.lostCount}</p>
            <p className="text-xs text-gray-400 mt-1">Lost</p>
          </div>
          <div className="bg-gray-900/50 rounded p-3 text-center">
            <p className="text-2xl font-bold text-yellow-400">{stats.deferredCount}</p>
            <p className="text-xs text-gray-400 mt-1">Deferred</p>
          </div>
          <div className="bg-gray-900/50 rounded p-3 text-center">
            <p className="text-2xl font-bold text-gray-400">{stats.archivedCount}</p>
            <p className="text-xs text-gray-400 mt-1">Archived</p>
          </div>
        </div>
      </div>

      {/* Win Rate by Source */}
      {bySource.length > 0 && (
        <div className="bg-gray-800/50 border border-gray-700/30 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-200 mb-4">Win Rate by Source</h3>
          <div className="space-y-3">
            {bySource.map((source) => (
              <div key={source.source}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-gray-300 capitalize">{source.source}</span>
                  <span className="text-sm font-semibold text-white">{source.winRate.toFixed(1)}%</span>
                </div>
                <div className="w-full bg-gray-900 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-blue-500 to-cyan-400"
                    style={{ width: `${source.winRate}%` }}
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {source.wonCount} won, {source.lostCount} lost
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Win Rate by Pitch Angle */}
      {byAngle.length > 0 && (
        <div className="bg-gray-800/50 border border-gray-700/30 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-200 mb-4">Win Rate by Pitch Angle</h3>
          <div className="space-y-3">
            {byAngle.slice(0, 5).map((angle) => (
              <div key={angle.pitchAngle}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-gray-300 capitalize">
                    {angle.pitchAngle.replace(/_/g, ' ')}
                  </span>
                  <span className="text-sm font-semibold text-white">{angle.winRate.toFixed(1)}%</span>
                </div>
                <div className="w-full bg-gray-900 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-purple-500 to-pink-400"
                    style={{ width: `${angle.winRate}%` }}
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {angle.wonCount} / {angle.totalLeads} leads
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top Loss Reasons */}
      {topLosses.length > 0 && (
        <div className="bg-gray-800/50 border border-gray-700/30 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-200 mb-4">Top Loss Reasons</h3>
          <div className="space-y-3">
            {topLosses.map((loss) => (
              <div key={loss.reason}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-gray-300 capitalize">{loss.reason}</span>
                  <span className="text-sm font-semibold text-white">{loss.count}</span>
                </div>
                <div className="w-full bg-gray-900 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-orange-500 to-red-400"
                    style={{ width: `${loss.percentage}%` }}
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">{loss.percentage.toFixed(1)}% of losses</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Win Rate Trend */}
      {trends.length > 0 && (
        <div className="bg-gray-800/50 border border-gray-700/30 rounded-lg p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-200">Win Rate Trend</h3>
            <div className="flex gap-1">
              {[30, 60, 90].map((days) => (
                <button
                  key={days}
                  onClick={() => {
                    setTrendDays(days)
                    getOutcomeTrend(days).then(setTrends)
                  }}
                  className={clsx(
                    'px-2 py-1 text-xs rounded transition-colors',
                    trendDays === days
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-900 text-gray-400 hover:text-gray-200'
                  )}
                >
                  {days}d
                </button>
              ))}
            </div>
          </div>

          {/* Mini Chart */}
          <div className="h-40 flex items-end justify-between gap-1 px-2">
            {trends.map((trend, idx) => {
              const maxRate = Math.max(...trends.map((t) => t.winRate), 100);
              const height = (trend.winRate / maxRate) * 100;
              return (
                <div key={idx} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full bg-gradient-to-t from-blue-500 to-cyan-400 rounded-t opacity-70 hover:opacity-100 transition-opacity" style={{ height: `${height}%`, minHeight: '4px' }} />
                  <span className="text-xs text-gray-500">{trend.winRate.toFixed(0)}%</span>
                </div>
              );
            })}
          </div>

          <p className="text-xs text-gray-500 mt-3 text-center">
            Weekly win rate over last {trendDays} days
          </p>
        </div>
      )}

      {/* Refresh Button */}
      <button
        onClick={loadData}
        className="w-full px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg transition-colors text-sm font-medium"
      >
        Refresh Statistics
      </button>
    </div>
  )
}

// ─── Compact Card View ─────────────────────────────────────────────────────

function CompactView({
  stats,
  onRefresh,
}: {
  stats: OutcomeStats
  onRefresh: () => void
}) {
  return (
    <div className="bg-gray-800/50 border border-gray-700/30 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-200">Outcome Stats</h3>
        <button
          onClick={onRefresh}
          className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
        >
          ↻
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className="text-xs text-gray-400">Win Rate</p>
          <p className="text-2xl font-bold text-green-400">{stats.winRate.toFixed(1)}%</p>
        </div>
        <div>
          <p className="text-xs text-gray-400">Avg Revenue</p>
          <p className="text-2xl font-bold text-blue-400">
            ${Math.round(stats.avgRevenuePerWin / 1000)}k
          </p>
        </div>
      </div>

      <div className="flex gap-2 text-xs">
        <div className="flex-1 text-center py-1 bg-gray-900/50 rounded">
          <p className="text-green-400 font-semibold">{stats.wonCount}</p>
          <p className="text-gray-500">Won</p>
        </div>
        <div className="flex-1 text-center py-1 bg-gray-900/50 rounded">
          <p className="text-red-400 font-semibold">{stats.lostCount}</p>
          <p className="text-gray-500">Lost</p>
        </div>
        <div className="flex-1 text-center py-1 bg-gray-900/50 rounded">
          <p className="text-yellow-400 font-semibold">{stats.deferredCount}</p>
          <p className="text-gray-500">Deferred</p>
        </div>
      </div>
    </div>
  )
}
