// @ts-nocheck
/**
 * usePulseChartData — Fetches real revenue and cash flow data from Supabase
 *
 * Replaces the hardcoded mock data arrays in RevenueChart and CashFlowChart
 * with live queries against field_logs and projects.
 */

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '@/lib/supabase'

// ── Types ────────────────────────────────────────────────────────────────────

interface RevenuePoint {
  week: string
  revenue: number
  target: number
  margin_pct: number
}

interface CashFlowPoint {
  week_start: string
  week_end: string
  projected_income: number
  projected_expenses: number
  projected_net: number
  confidence: number
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getWeekStart(date: Date): Date {
  const d = new Date(date)
  d.setDate(d.getDate() - d.getDay())
  d.setHours(0, 0, 0, 0)
  return d
}

function getWeekEnd(start: Date): Date {
  const d = new Date(start)
  d.setDate(d.getDate() + 6)
  return d
}

function fmtDate(d: Date): string {
  return d.toISOString().split('T')[0]
}

// ── Revenue Hook ─────────────────────────────────────────────────────────────

export function useRevenueData(orgId: string | undefined, weeks = 12) {
  const [data, setData] = useState<RevenuePoint[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!orgId) return

    async function fetchRevenue() {
      setLoading(true)

      // Get last N weeks of field_logs, grouped by week
      const weeksAgo = new Date()
      weeksAgo.setDate(weeksAgo.getDate() - weeks * 7)

      const { data: logs, error } = await supabase
        .from('field_logs' as never)
        .select('log_date, collected, profit, quoted_amount, material_cost, hours')
        .eq('org_id', orgId)
        .gte('log_date', fmtDate(weeksAgo))
        .order('log_date', { ascending: true })

      if (error || !logs) {
        console.warn('[pulse] Revenue fetch failed:', error?.message)
        setData([])
        setLoading(false)
        return
      }

      // Group by week
      const weekMap = new Map<string, { revenue: number; cost: number; target: number }>()

      for (const log of logs as any[]) {
        const logDate = new Date(log.log_date)
        const ws = getWeekStart(logDate)
        const key = fmtDate(ws)

        if (!weekMap.has(key)) {
          weekMap.set(key, { revenue: 0, cost: 0, target: 0 })
        }
        const bucket = weekMap.get(key)!
        bucket.revenue += Number(log.collected) || 0
        bucket.cost += (Number(log.material_cost) || 0) + (Number(log.hours) || 0) * 65 // $65/hr labor
        bucket.target += Number(log.quoted_amount) || 0
      }

      // Convert to array sorted by date
      const sorted = Array.from(weekMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, val], i) => {
          const margin = val.revenue > 0
            ? Math.round(((val.revenue - val.cost) / val.revenue) * 100)
            : 0
          return {
            week: `W${i + 1}`,
            revenue: Math.round(val.revenue),
            target: Math.round(val.target / 4), // weekly target = quoted / 4 weeks
            margin_pct: margin,
          }
        })

      setData(sorted.length > 0 ? sorted : [])
      setLoading(false)
    }

    fetchRevenue()
  }, [orgId, weeks])

  return { data, loading }
}

// ── Cash Flow Hook ───────────────────────────────────────────────────────────

export function useCashFlowData(orgId: string | undefined, weeks = 12) {
  const [data, setData] = useState<CashFlowPoint[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!orgId) return

    async function fetchCashFlow() {
      setLoading(true)

      const weeksAgo = new Date()
      weeksAgo.setDate(weeksAgo.getDate() - weeks * 7)

      const { data: logs, error } = await supabase
        .from('field_logs' as never)
        .select('log_date, collected, material_cost, hours, miles_round_trip, profit')
        .eq('org_id', orgId)
        .gte('log_date', fmtDate(weeksAgo))
        .order('log_date', { ascending: true })

      if (error || !logs) {
        console.warn('[pulse] Cash flow fetch failed:', error?.message)
        setData([])
        setLoading(false)
        return
      }

      // Group by week
      const weekMap = new Map<string, { income: number; expenses: number; logCount: number }>()

      for (const log of logs as any[]) {
        const logDate = new Date(log.log_date)
        const ws = getWeekStart(logDate)
        const key = fmtDate(ws)

        if (!weekMap.has(key)) {
          weekMap.set(key, { income: 0, expenses: 0, logCount: 0 })
        }
        const bucket = weekMap.get(key)!
        bucket.income += Number(log.collected) || 0
        bucket.expenses += (Number(log.material_cost) || 0) +
                           (Number(log.hours) || 0) * 65 +
                           (Number(log.miles_round_trip) || 0) * 0.67
        bucket.logCount += 1
      }

      const sorted = Array.from(weekMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, val]) => {
          const ws = new Date(key)
          const we = getWeekEnd(ws)
          return {
            week_start: fmtDate(ws),
            week_end: fmtDate(we),
            projected_income: Math.round(val.income),
            projected_expenses: Math.round(val.expenses),
            projected_net: Math.round(val.income - val.expenses),
            confidence: Math.min(0.95, 0.6 + val.logCount * 0.05), // more logs = higher confidence
          }
        })

      setData(sorted.length > 0 ? sorted : [])
      setLoading(false)
    }

    fetchCashFlow()
  }, [orgId, weeks])

  return { data, loading }
}
