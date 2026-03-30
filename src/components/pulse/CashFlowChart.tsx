/**
 * Cash Flow Chart — Combined bar + line chart for cash flow forecast
 *
 * Features:
 * - Projected income (bars)
 * - Projected expenses (line)
 * - Net cash flow visualization
 * - Confidence indicators
 * - Dark theme with emerald/red/cyan colors
 * - Responsive design
 * - Uses recharts library
 */

import { useMemo } from 'react'
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'

// ── Types ────────────────────────────────────────────────────────────────────

interface CashFlowDataPoint {
  week_start: string
  week_end: string
  projected_income: number
  projected_expenses: number
  projected_net: number
  confidence: number
}

interface CashFlowChartProps {
  data?: CashFlowDataPoint[]
}

// ── Component ────────────────────────────────────────────────────────────────

export function CashFlowChart({ data: externalData }: CashFlowChartProps) {
  // Use provided data or show minimal empty-state placeholder
  const data: CashFlowDataPoint[] = useMemo(
    () => externalData && externalData.length > 0
      ? externalData
      : [
          { week_start: new Date().toISOString().split('T')[0], week_end: new Date().toISOString().split('T')[0], projected_income: 0, projected_expenses: 0, projected_net: 0, confidence: 0 },
        ],
    [externalData]
  )

  // G1 debug: log dataset before render to confirm data is reaching chart
  if (data && data.length > 0) {
    console.log('[CashFlowChart] dataset sample (first 3):', data.slice(0, 3))
  }

  // Show empty state when no real data
  if (!externalData || externalData.length === 0) {
    return (
      <div className="flex items-center justify-center h-[300px] bg-gray-800/30 rounded-lg border border-gray-700 text-gray-500 text-sm">
        No cash flow data yet. Log field entries to see projections.
      </div>
    )
  }

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const point = payload[0]?.payload as CashFlowDataPoint | undefined
      if (!point) return null

      const weekStart = new Date(point.week_start)
      const weekLabel = `Week of ${weekStart.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      })}`

      return (
        <div className="rounded-lg bg-gray-900 border border-gray-700 p-3 shadow-lg">
          <p className="text-xs text-gray-300 font-semibold">{weekLabel}</p>
          <p className="text-xs text-emerald-400 mt-1">
            Income: ${point.projected_income.toLocaleString()}
          </p>
          <p className="text-xs text-red-400">
            Expenses: ${point.projected_expenses.toLocaleString()}
          </p>
          <p className="text-xs text-cyan-400 font-semibold mt-1">
            Net: ${point.projected_net.toLocaleString()}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            Confidence: {(point.confidence * 100).toFixed(0)}%
          </p>
        </div>
      )
    }
    return null
  }

  // Calculate max value for axis scaling
  const maxValue = Math.max(...data.map(d => Math.max(d.projected_income, d.projected_expenses)))
  const yAxisMax = Math.ceil(maxValue / 2000) * 2000

  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart
        data={data}
        margin={{ top: 5, right: 30, left: 0, bottom: 5 }}
      >
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="#374151"
          vertical={false}
        />
        <XAxis
          dataKey={(item) => {
            // G1 fix: use proper month/day label instead of broken division formula
            if (!item.week_start) return '—'
            const date = new Date(item.week_start + 'T00:00:00')
            if (isNaN(date.getTime())) return '—'
            return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          }}
          stroke="#9CA3AF"
          style={{ fontSize: '11px' }}
          axisLine={{ stroke: '#4B5563' }}
          tickLine={{ stroke: '#4B5563' }}
          interval="preserveStartEnd"
        />
        <YAxis
          stroke="#9CA3AF"
          style={{ fontSize: '12px' }}
          axisLine={{ stroke: '#4B5563' }}
          tickLine={{ stroke: '#4B5563' }}
          domain={[0, yAxisMax]}
          tickFormatter={(value) => {
            // G1 fix: toFixed(0) for whole dollars, toLocaleString for large numbers
            const n = Number(value)
            if (isNaN(n)) return '$0'
            if (n >= 1000) return `$${(n / 1000).toFixed(0)}k`
            return `$${n.toFixed(0)}`
          }}
        />
        <Tooltip content={<CustomTooltip />} />
        <Legend
          wrapperStyle={{ paddingTop: '20px' }}
          formatter={(value) => <span className="text-sm text-gray-300">{value}</span>}
        />
        <Bar
          dataKey="projected_income"
          fill="#10b981"
          opacity={0.8}
          radius={[4, 4, 0, 0]}
          name="Projected Income"
        />
        <Line
          type="monotone"
          dataKey="projected_expenses"
          stroke="#ef4444"
          strokeWidth={2}
          dot={{ fill: '#ef4444', r: 3 }}
          activeDot={{ r: 5 }}
          isAnimationActive={false}
          name="Projected Expenses"
        />
        <Line
          type="monotone"
          dataKey="projected_net"
          stroke="#06b6d4"
          strokeWidth={2}
          strokeDasharray="5 5"
          dot={{ fill: '#06b6d4', r: 3 }}
          activeDot={{ r: 5 }}
          isAnimationActive={false}
          name="Net Cash Flow"
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
