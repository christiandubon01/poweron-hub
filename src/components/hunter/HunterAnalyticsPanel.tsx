// @ts-nocheck
/**
 * HunterAnalyticsPanel — Source Analytics Dashboard for HUNTER
 *
 * Features:
 * - Source performance table (name, lead count, win rate, avg revenue, ROI)
 * - Win rate by source bar chart (simple SVG bars, no chart library)
 * - Pitch angle effectiveness by source type
 * - Time heatmap (day × hour grid showing effectiveness)
 * - AI recommendation card with action items
 * - Date range filter (7 days, 30 days, 90 days, all time)
 * - Export button (CSV of analytics data)
 * - Empty state when < 10 leads tracked
 */

import React, { useState, useEffect } from 'react';
import { Download, RefreshCw, TrendingUp, TrendingDown } from 'lucide-react';
import clsx from 'clsx';
import hunterSourceAnalytics, {
  SourceAnalysis,
  PitchAnglePerformance,
  TimePattern,
  HeatmapEntry,
} from '@/services/hunter/HunterSourceAnalytics';
import { useHunterStore } from '@/store/hunterStore';

type DateRange = '7days' | '30days' | '90days' | 'all';

interface AnalyticsState {
  sourceAnalysis: SourceAnalysis[];
  pitchPerformance: PitchAnglePerformance[];
  timePatterns: TimePattern[];
  recommendation: string;
  loading: boolean;
  error?: string;
}

const HunterAnalyticsPanel: React.FC = () => {
  const leads = useHunterStore((state) => state.leads);
  const [dateRange, setDateRange] = useState<DateRange>('30days');
  const [analytics, setAnalytics] = useState<AnalyticsState>({
    sourceAnalysis: [],
    pitchPerformance: [],
    timePatterns: [],
    recommendation: '',
    loading: false,
  });

  // Filter leads by date range
  const getFilteredLeads = (range: DateRange) => {
    const now = new Date();
    let startDate: Date;

    switch (range) {
      case '7days':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30days':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case '90days':
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(0);
    }

    return leads.filter((lead) => {
      const leadDate = new Date(lead.discovered_at || 0);
      return leadDate >= startDate;
    });
  };

  // Load analytics
  const loadAnalytics = async () => {
    setAnalytics((prev) => ({ ...prev, loading: true }));
    try {
      const [analysis, pitch, time, rec] = await Promise.all([
        hunterSourceAnalytics.analyzeSourcePerformance(),
        hunterSourceAnalytics.getPitchAnglePerformance(),
        hunterSourceAnalytics.getTimePatterns(),
        hunterSourceAnalytics.generateSourceRecommendation(),
      ]);

      setAnalytics({
        sourceAnalysis: analysis,
        pitchPerformance: pitch,
        timePatterns: time,
        recommendation: rec,
        loading: false,
      });
    } catch (error) {
      console.error('Failed to load analytics:', error);
      setAnalytics((prev) => ({
        ...prev,
        loading: false,
        error: 'Failed to load analytics',
      }));
    }
  };

  // Load analytics on mount and when date range changes
  useEffect(() => {
    loadAnalytics();
  }, [dateRange, leads.length]);

  // Empty state
  if (leads.length < 10) {
    return (
      <div className="flex flex-col items-center justify-center p-12 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-lg border border-slate-700 min-h-96">
        <div className="text-center max-w-sm">
          <TrendingUp className="w-16 h-16 mx-auto mb-4 text-slate-500" />
          <h3 className="text-lg font-semibold text-slate-200 mb-2">
            Track 10+ leads to unlock source analytics
          </h3>
          <p className="text-sm text-slate-400 mb-6">
            Once you've logged enough leads with outcomes (won/lost), detailed analytics will appear here showing which sources convert best.
          </p>
          <div className="text-xs text-slate-500">
            Current leads: {leads.length}/10
          </div>
        </div>
      </div>
    );
  }

  // Main UI
  return (
    <div className="space-y-6">
      {/* Header with controls */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-100">Source Analytics</h2>
        <div className="flex gap-3">
          {/* Date range filter */}
          <div className="flex gap-1 bg-slate-800 rounded-lg p-1 border border-slate-700">
            {(['7days', '30days', '90days', 'all'] as DateRange[]).map((range) => (
              <button
                key={range}
                onClick={() => setDateRange(range)}
                className={clsx(
                  'px-3 py-1.5 rounded text-sm font-medium transition',
                  dateRange === range
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                )}
              >
                {range === 'all' ? 'All time' : range}
              </button>
            ))}
          </div>

          {/* Refresh button */}
          <button
            onClick={loadAnalytics}
            disabled={analytics.loading}
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition disabled:opacity-50"
            title="Refresh analytics"
          >
            <RefreshCw
              className={clsx('w-4 h-4', analytics.loading && 'animate-spin')}
            />
          </button>

          {/* Export button */}
          <button
            onClick={() => exportAnalyticsCSV(analytics, dateRange)}
            className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium flex items-center gap-2 transition"
          >
            <Download className="w-4 h-4" />
            Export
          </button>
        </div>
      </div>

      {/* AI Recommendation Card */}
      {analytics.recommendation && (
        <div className="p-4 rounded-lg bg-gradient-to-r from-amber-900/20 to-orange-900/20 border border-amber-800/50">
          <div className="flex gap-3">
            <div className="flex-shrink-0 w-1 bg-gradient-to-b from-amber-500 to-orange-500 rounded-full"></div>
            <div className="flex-1">
              <h3 className="font-semibold text-amber-100 mb-2">
                AI Recommendation
              </h3>
              <p className="text-sm text-amber-50 whitespace-pre-wrap">
                {analytics.recommendation}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Source Performance Table */}
      {analytics.sourceAnalysis.length > 0 && (
        <div className="rounded-lg border border-slate-700 overflow-hidden">
          <div className="bg-slate-900 px-4 py-3 border-b border-slate-700">
            <h3 className="font-semibold text-slate-100">Source Performance</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-800/50 border-b border-slate-700">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-slate-300">
                    Source
                  </th>
                  <th className="px-4 py-2 text-right font-medium text-slate-300">
                    Leads
                  </th>
                  <th className="px-4 py-2 text-right font-medium text-slate-300">
                    Won
                  </th>
                  <th className="px-4 py-2 text-right font-medium text-slate-300">
                    Win Rate
                  </th>
                  <th className="px-4 py-2 text-right font-medium text-slate-300">
                    Avg Revenue
                  </th>
                  <th className="px-4 py-2 text-right font-medium text-slate-300">
                    ROI
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {analytics.sourceAnalysis.map((source) => (
                  <tr
                    key={source.source}
                    className="hover:bg-slate-800/30 transition"
                  >
                    <td className="px-4 py-3 text-slate-100 font-medium">
                      {source.source}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-400">
                      {source.totalLeads}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-400">
                      {source.won}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span
                        className={clsx(
                          'inline-flex items-center px-2 py-1 rounded-full text-xs font-medium',
                          source.winRate >= 30
                            ? 'bg-green-900/30 text-green-300'
                            : source.winRate >= 15
                              ? 'bg-amber-900/30 text-amber-300'
                              : 'bg-red-900/30 text-red-300'
                        )}
                      >
                        {source.winRate}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-400">
                      ${Math.round(source.avgRevenuePerWon)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span
                        className={clsx(
                          'font-medium flex items-center gap-1 justify-end',
                          source.roi >= 100
                            ? 'text-green-400'
                            : source.roi >= 0
                              ? 'text-blue-400'
                              : 'text-red-400'
                        )}
                      >
                        {source.roi > 0 && <TrendingUp className="w-3 h-3" />}
                        {source.roi < 0 && <TrendingDown className="w-3 h-3" />}
                        {source.roi}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Win Rate Chart */}
      {analytics.sourceAnalysis.length > 0 && (
        <div className="rounded-lg border border-slate-700 overflow-hidden">
          <div className="bg-slate-900 px-4 py-3 border-b border-slate-700">
            <h3 className="font-semibold text-slate-100">Win Rate by Source</h3>
          </div>
          <div className="p-4 space-y-2">
            {analytics.sourceAnalysis.slice(0, 8).map((source) => (
              <div key={source.source} className="space-y-1">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-300">{source.source}</span>
                  <span className="text-slate-400">{source.winRate}%</span>
                </div>
                <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                  <div
                    className={clsx(
                      'h-full rounded-full transition-all',
                      source.winRate >= 30
                        ? 'bg-green-500'
                        : source.winRate >= 15
                          ? 'bg-amber-500'
                          : 'bg-red-500'
                    )}
                    style={{ width: `${Math.min(100, source.winRate)}%` }}
                  ></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pitch Angle Effectiveness */}
      {analytics.pitchPerformance.length > 0 && (
        <div className="rounded-lg border border-slate-700 overflow-hidden">
          <div className="bg-slate-900 px-4 py-3 border-b border-slate-700">
            <h3 className="font-semibold text-slate-100">
              Pitch Angle Effectiveness
            </h3>
          </div>
          <div className="divide-y divide-slate-700">
            {analytics.pitchPerformance.slice(0, 5).map((perf, idx) => (
              <div
                key={idx}
                className="p-4 hover:bg-slate-800/30 transition"
              >
                <div className="flex items-start justify-between gap-4 mb-2">
                  <div>
                    <p className="font-medium text-slate-200">
                      {perf.pitchAngle} angle
                    </p>
                    <p className="text-xs text-slate-500">
                      {perf.source} → {perf.leadType}
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-green-400">
                    {perf.winRate}% win rate
                  </span>
                </div>
                <p className="text-sm text-slate-400">{perf.insight}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Time Patterns */}
      {analytics.timePatterns.length > 0 && (
        <div className="rounded-lg border border-slate-700 overflow-hidden">
          <div className="bg-slate-900 px-4 py-3 border-b border-slate-700">
            <h3 className="font-semibold text-slate-100">Best Times to Contact</h3>
          </div>
          <div className="divide-y divide-slate-700">
            {analytics.timePatterns.map((pattern) => (
              <div
                key={pattern.dayOfWeek}
                className="p-4 hover:bg-slate-800/30 transition"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-slate-200">
                      {pattern.dayOfWeek}
                    </p>
                    <p className="text-xs text-slate-500">
                      Best hour: {pattern.bestHour}:00 • {pattern.avgTimeToContact}h avg time to contact
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-slate-200">
                      {pattern.leadsContacted} contacted
                    </p>
                    <p className="text-xs text-green-400">
                      {pattern.wonLeads} won ({pattern.winRate}%)
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Helper Functions ──────────────────────────────────────────────────────

/**
 * Export analytics data to CSV
 */
function exportAnalyticsCSV(analytics: AnalyticsState, dateRange: DateRange) {
  const headers = [
    'Source',
    'Total Leads',
    'Contacted',
    'Quoted',
    'Won',
    'Lost',
    'Deferred',
    'Win Rate %',
    'Conversion Rate %',
    'Avg Revenue Per Win',
    'Total Revenue',
    'Avg Time to Close (days)',
    'Cost Per Lead',
    'ROI %',
  ];

  const rows = analytics.sourceAnalysis.map((source) => [
    source.source,
    source.totalLeads,
    source.contacted,
    source.quoted,
    source.won,
    source.lost,
    source.deferred,
    source.winRate,
    source.conversionRate,
    Math.round(source.avgRevenuePerWon),
    Math.round(source.totalRevenueFromSource),
    source.avgTimeToClose,
    Math.round(source.costPerLead),
    source.roi,
  ]);

  const csv = [
    headers.join(','),
    ...rows.map((row) => row.map((cell) => `"${cell}"`).join(',')),
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `hunter-analytics-${dateRange}-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  window.URL.revokeObjectURL(url);
}

export default HunterAnalyticsPanel;
