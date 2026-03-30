/**
 * Revenue Chart — Line chart comparing actual revenue vs target
 *
 * Features:
 * - 12-week historical revenue data
 * - Comparison with weekly targets
 * - Dark theme with emerald/gray colors
 * - Responsive design
 * - Uses recharts library
 */

import { useMemo } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'

// ── Types ────────────────────────────────────────────────────────────────────

interface ChartDataPoint {
  week: string
  revenue: number
  target: number
  margin_pct: number
}

// ── Component ────────────────────────────────────────────────────────────────

export interface RevenueChartProps {
  data?: ChartDataPoint[]
}

export function RevenueChart({ data: externalData }: RevenueChartProps = {}) {
  // Use provided data or show empty-state placeholder
  const data: ChartDataPoint[] = useMemo(
    () => externalData && externalData.length > 0
      ? externalData
      : [
          { week: 'W1', revenue: 0, target: 10000, margin_pct: 0 },
          { week: 'W2', revenue: 0, target: 10000, margin_pct: 0 },
          { week: 'W3', revenue: 0, target: 10000, margin_pct: 0 },
        ],
    [externalData]
  )

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload as ChartDataPoint
      return (
        <div className="rounded-lg bg-gray-900 border border-gray-700 p-3 shadow-lg">
          <p className="text-xs text-gray-300 font-semibold">{data.week}</p>
          <p className="text-xs text-emerald-400 mt-1">
            Actual: ${data.revenue.toLocaleString()}
          </p>
          <p className="text-xs text-cyan-400">
            Target: ${data.target.toLocaleString()}
          </p>
          <p className="text-xs text-yellow-400 mt-1">
            Margin: {data.margin_pct}%
          </p>
        </div>
      )
    }
    return null
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart
        data={data}
        margin={{ top: 5, right: 30, left: 0, bottom: 5 }}
      >
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="#374151"
          vertical={false}
        />
        <XAxis
          dataKey="week"
          stroke="#9CA3AF"
          style={{ fontSize: '12px' }}
          axisLine={{ stroke: '#4B5563' }}
          tickLine={{ stroke: '#4B5563' }}
        />
        <YAxis
          stroke="#9CA3AF"
          style={{ fontSize: '12px' }}
          axisLine={{ stroke: '#4B5563' }}
          tickLine={{ stroke: '#4B5563' }}
          tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
        />
        <Tooltip content={<CustomTooltip />} />
        <Legend
          wrapperStyle={{ paddingTop: '20px' }}
          iconType="line"
          formatter={(value) => <span className="text-sm text-gray-300">{value}</span>}
        />
        <Line
          type="monotone"
          dataKey="revenue"
          stroke="#10b981"
          strokeWidth={3}
          dot={{ fill: '#10b981', r: 4 }}
          activeDot={{ r: 6 }}
          isAnimationActive={false}
          name="Actual Revenue"
        />
        <Line
          type="monotone"
          dataKey="target"
          stroke="#06b6d4"
          strokeWidth={2}
          strokeDasharray="5 5"
          dot={{ fill: '#06b6d4', r: 3 }}
          activeDot={{ r: 5 }}
          isAnimationActive={false}
          name="Target"
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
