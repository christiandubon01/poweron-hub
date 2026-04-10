/**
 * SolarRetentionHeatmap.tsx
 * 
 * Visual grid showing retention strength per topic over time
 * - Rows: modules/lessons/topics
 * - Columns: time periods (this week, last week, 2 weeks ago, month ago)
 * - Cell colors:
 *   - Green (tested recently, high score, 80+%)
 *   - Amber (fading, score 50-79%, not tested in 7-14 days)
 *   - Red (overdue or low score, <50% or not tested 14+ days)
 *   - Gray (not yet reached / no data)
 * - Tap any cell to start a quiz on that topic
 */

import React, { useState } from 'react';
import { RetentionMetrics } from '../../services/solarTraining/SolarQuizEngine';

export interface SolarRetentionHeatmapProps {
  topics: string[];
  periods: Array<{ label: string; daysAgo: number }>;
  data: Array<Array<RetentionMetrics | null>>;
  onCellTap?: (topic: string, periodDaysAgo: number) => void;
}

interface CellStyle {
  bg: string;
  border: string;
  text: string;
  hoverBg: string;
}

/**
 * Get color styling based on retention metrics
 */
function getRetentionColor(metrics: RetentionMetrics | null): CellStyle {
  if (!metrics) {
    return {
      bg: 'bg-slate-100 dark:bg-slate-800',
      border: 'border-slate-200 dark:border-slate-700',
      text: 'text-slate-400 dark:text-slate-600',
      hoverBg: 'hover:bg-slate-200 dark:hover:bg-slate-700',
    };
  }

  // Green: Strong (tested recently, high score)
  if (metrics.retention_score >= 80 && metrics.days_since_last_test <= 7) {
    return {
      bg: 'bg-green-500 dark:bg-green-600',
      border: 'border-green-600 dark:border-green-700',
      text: 'text-white font-bold',
      hoverBg: 'hover:bg-green-600 dark:hover:bg-green-700',
    };
  }

  // Amber: Fading (medium score or getting older)
  if ((metrics.retention_score >= 50 && metrics.retention_score < 80) ||
      (metrics.days_since_last_test > 7 && metrics.days_since_last_test <= 14)) {
    return {
      bg: 'bg-amber-400 dark:bg-amber-600',
      border: 'border-amber-500 dark:border-amber-700',
      text: 'text-white font-semibold',
      hoverBg: 'hover:bg-amber-500 dark:hover:bg-amber-700',
    };
  }

  // Red: Overdue or poor score
  if (metrics.retention_score < 50 || metrics.days_since_last_test > 14) {
    return {
      bg: 'bg-red-500 dark:bg-red-700',
      border: 'border-red-600 dark:border-red-800',
      text: 'text-white font-bold',
      hoverBg: 'hover:bg-red-600 dark:hover:bg-red-800',
    };
  }

  return {
    bg: 'bg-slate-200 dark:bg-slate-700',
    border: 'border-slate-300 dark:border-slate-600',
    text: 'text-slate-700 dark:text-slate-200',
    hoverBg: 'hover:bg-slate-300 dark:hover:bg-slate-600',
  };
}

/**
 * Format retention score for display
 */
function formatScore(metrics: RetentionMetrics | null): string {
  if (!metrics) return '—';
  return `${metrics.retention_score}%`;
}

/**
 * Get tooltip text for a cell
 */
function getCellTooltip(metrics: RetentionMetrics | null, topic: string, period: string): string {
  if (!metrics) {
    return `${topic} • ${period} • No data yet`;
  }

  const parts = [
    `${topic}`,
    `${period}`,
    `Score: ${metrics.retention_score}%`,
    `${metrics.correct_attempts}/${metrics.total_attempts} correct`,
    `Avg attempts: ${metrics.average_attempts.toFixed(1)}`,
    `Last test: ${metrics.days_since_last_test}d ago`,
    `Status: ${metrics.decay_status}`,
  ];

  return parts.join(' • ');
}

export const SolarRetentionHeatmap: React.FC<SolarRetentionHeatmapProps> = ({
  topics,
  periods,
  data,
  onCellTap,
}) => {
  const [hoveredCell, setHoveredCell] = useState<{ row: number; col: number } | null>(null);
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);

  const handleCellClick = (topicIndex: number, periodIndex: number) => {
    const topic = topics[topicIndex];
    const period = periods[periodIndex];
    setSelectedTopic(topic);
    
    if (onCellTap) {
      onCellTap(topic, period.daysAgo);
    }
  };

  return (
    <div className="w-full bg-white dark:bg-slate-900 rounded-lg shadow-lg p-6">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
          📊 Retention Heatmap
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Your learning progress over time. Tap any cell to start a quiz on that topic.
        </p>
      </div>

      {/* Legend */}
      <div className="mb-6 p-4 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-green-500 rounded"></div>
            <span className="text-slate-700 dark:text-slate-300">
              Strong (80%+, recent)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-amber-400 rounded"></div>
            <span className="text-slate-700 dark:text-slate-300">
              Fading (50-79%)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-red-500 rounded"></div>
            <span className="text-slate-700 dark:text-slate-300">
              Overdue (&lt;50%)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-slate-200 dark:bg-slate-700 rounded"></div>
            <span className="text-slate-600 dark:text-slate-400">
              Not tested
            </span>
          </div>
        </div>
      </div>

      {/* Heatmap Grid */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          {/* Column Headers */}
          <thead>
            <tr>
              <th className="text-left p-3 font-semibold text-slate-700 dark:text-slate-300 border-b-2 border-slate-300 dark:border-slate-600">
                Topic
              </th>
              {periods.map((period, idx) => (
                <th
                  key={idx}
                  className="text-center p-3 font-semibold text-slate-700 dark:text-slate-300 border-b-2 border-slate-300 dark:border-slate-600 min-w-[100px]"
                >
                  <div className="text-xs">{period.label}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {period.daysAgo === 0 ? 'Today' : `${period.daysAgo}d ago`}
                  </div>
                </th>
              ))}
            </tr>
          </thead>

          {/* Data Rows */}
          <tbody>
            {topics.map((topic, topicIdx) => (
              <tr
                key={topicIdx}
                className="hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              >
                {/* Topic Name */}
                <td className="text-left p-3 font-semibold text-slate-900 dark:text-white border-b border-slate-200 dark:border-slate-700">
                  <div className="max-w-xs break-words">
                    {topic}
                  </div>
                  {selectedTopic === topic && (
                    <div className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                      ✓ Selected
                    </div>
                  )}
                </td>

                {/* Metric Cells */}
                {periods.map((period, periodIdx) => {
                  const metrics = data[topicIdx]?.[periodIdx];
                  const style = getRetentionColor(metrics);

                  return (
                    <td
                      key={periodIdx}
                      className={`text-center p-2 border border-slate-200 dark:border-slate-700 cursor-pointer transition-all ${style.bg} ${style.hoverBg}`}
                      onClick={() => handleCellClick(topicIdx, periodIdx)}
                      onMouseEnter={() => setHoveredCell({ row: topicIdx, col: periodIdx })}
                      onMouseLeave={() => setHoveredCell(null)}
                      title={getCellTooltip(metrics, topic, period.label)}
                    >
                      <div className={`${style.text} text-sm`}>
                        {formatScore(metrics)}
                      </div>
                      {metrics && (
                        <div className="text-xs text-opacity-75 opacity-75">
                          {metrics.correct_attempts}/{metrics.total_attempts}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Summary Stats */}
      {data.length > 0 && (
        <div className="mt-6 p-4 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700">
          <h3 className="font-semibold text-slate-900 dark:text-white mb-3">
            Overall Metrics
          </h3>
          
          {(() => {
            const allMetrics = data.flat().filter((m) => m !== null);
            if (allMetrics.length === 0) {
              return (
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  No quiz data yet. Start a quiz to begin tracking your retention.
                </p>
              );
            }

            const avgRetention = Math.round(
              allMetrics.reduce((sum, m) => sum + (m?.retention_score || 0), 0) /
              allMetrics.length
            );
            const totalAttempts = allMetrics.reduce(
              (sum, m) => sum + (m?.total_attempts || 0),
              0
            );
            const correctAttempts = allMetrics.reduce(
              (sum, m) => sum + (m?.correct_attempts || 0),
              0
            );
            const overallAccuracy = Math.round(
              (correctAttempts / totalAttempts) * 100
            );

            const fadingTopics = allMetrics.filter(
              (m) => m?.decay_status === 'fading'
            ).length;
            const overdueTopics = allMetrics.filter(
              (m) => m?.decay_status === 'overdue'
            ).length;

            return (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                    {avgRetention}%
                  </div>
                  <div className="text-xs text-slate-600 dark:text-slate-400">
                    Avg Retention
                  </div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                    {overallAccuracy}%
                  </div>
                  <div className="text-xs text-slate-600 dark:text-slate-400">
                    Overall Accuracy
                  </div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                    {fadingTopics}
                  </div>
                  <div className="text-xs text-slate-600 dark:text-slate-400">
                    Fading Topics
                  </div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                    {overdueTopics}
                  </div>
                  <div className="text-xs text-slate-600 dark:text-slate-400">
                    Overdue Topics
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Call to Action */}
      {data.every(row => row.every(cell => cell === null)) && (
        <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-400 rounded">
          <p className="text-sm text-blue-900 dark:text-blue-100">
            💡 <strong>Get Started:</strong> Take your first solar training quiz to populate this heatmap and start tracking your learning journey.
          </p>
        </div>
      )}
    </div>
  );
};

export default SolarRetentionHeatmap;
