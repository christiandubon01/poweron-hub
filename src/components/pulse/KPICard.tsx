/**
 * KPI Card — Reusable component for displaying key performance indicators
 *
 * Features:
 * - Label and value display
 * - Trend indicator (up/down/flat with percentage)
 * - Optional warning state (red styling)
 * - Subtext for context
 * - Dark theme with emerald/red accents
 */

import { TrendingUp, TrendingDown, Minus, AlertTriangle } from 'lucide-react'
import { clsx } from 'clsx'

// ── Types ────────────────────────────────────────────────────────────────────

interface KPICardProps {
  label: string
  value: string | number
  subtext?: string
  trend?: 'up' | 'down' | 'flat'
  trendPercent?: number
  warning?: boolean
  icon?: React.ReactNode
  onClick?: () => void
}

// ── Component ────────────────────────────────────────────────────────────────

export function KPICard({
  label,
  value,
  subtext,
  trend = 'flat',
  trendPercent = 0,
  warning = false,
  icon,
  onClick,
}: KPICardProps) {
  const getTrendIcon = () => {
    switch (trend) {
      case 'up':
        return <TrendingUp size={16} className="text-emerald-400" />
      case 'down':
        return <TrendingDown size={16} className="text-red-400" />
      default:
        return <Minus size={16} className="text-gray-400" />
    }
  }

  const getTrendColor = () => {
    if (warning) return 'text-red-400'
    switch (trend) {
      case 'up':
        return 'text-emerald-400'
      case 'down':
        return 'text-red-400'
      default:
        return 'text-gray-400'
    }
  }

  const getBgColor = () => {
    if (warning) return 'bg-red-900/20 border-red-700/50'
    return 'bg-gray-800/50 border-gray-700/50 hover:bg-gray-800/70 hover:border-gray-600/50'
  }

  return (
    <div
      onClick={onClick}
      className={clsx(
        'rounded-lg border p-6 transition-all',
        getBgColor(),
        onClick && 'cursor-pointer'
      )}
    >
      {/* Header: Label + Warning Icon */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <h3 className="text-sm font-medium text-gray-300">{label}</h3>
        </div>
        {warning && <AlertTriangle size={18} className="text-red-400 flex-shrink-0" />}
      </div>

      {/* Main Value */}
      <div className="mb-4">
        <p className="text-2xl font-bold text-gray-100 break-words">{value}</p>
      </div>

      {/* Footer: Subtext + Trend */}
      <div className="flex items-center justify-between pt-3 border-t border-gray-700/50">
        <p className="text-xs text-gray-400">{subtext || '—'}</p>

        {trendPercent !== 0 && (
          <div className={clsx('flex items-center gap-1', getTrendColor())}>
            {getTrendIcon()}
            <span className="text-xs font-semibold">
              {trendPercent > 0 ? '+' : ''}{trendPercent}%
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
