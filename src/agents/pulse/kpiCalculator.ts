// @ts-nocheck
/**
 * KPI Calculator — Core financial metrics for PULSE agent
 *
 * Functions:
 * - calculateWeeklyKPIs: Revenue, projects, AR analysis, margins
 * - calculateARaging: Aged invoice breakdown by bucket
 * - generateCashFlowForecast: 12-week income/expense projection
 * - getHistoricalRevenue: 12-week revenue + target history
 */

import { supabase } from '@/lib/supabase'

// ── Types ────────────────────────────────────────────────────────────────────

export interface ARAgingBucket {
  bucket: '0-30' | '30-60' | '60-90' | '90+'
  invoice_count: number
  total_amount: number
  pct_of_total: number
}

export interface WeeklyKPIs {
  revenue_received: number
  revenue_pending: number
  active_projects: number
  ar_aging_buckets: ARAgingBucket[]
  avg_margin_pct: number
  dso_days: number
  overdue_amount: number
  overdue_count: number
}

export interface CashFlowWeek {
  week_start: string
  week_end: string
  projected_income: number
  projected_expenses: number
  projected_net: number
  confidence: number // 0-1
}

export interface HistoricalRevenue {
  week: string
  revenue: number
  target: number
  margin_pct: number
}

// ── KPI Calculator ──────────────────────────────────────────────────────────

/**
 * Calculate weekly KPIs: revenue, AR aging, margins
 * Returns: received revenue, pending revenue, active projects, AR buckets, avg margin
 */
export async function calculateWeeklyKPIs(orgId: string): Promise<WeeklyKPIs> {
  try {
    // Fetch invoices for AR analysis
    const { data: invoices, error: invoiceError } = await supabase
      .from('invoices')
      .select('id, status, total, balance_due, due_date, days_overdue, paid_at, created_at')
      .eq('org_id', orgId)

    if (invoiceError) throw invoiceError

    // Fetch projects for margin analysis
    const { data: projects, error: projectError } = await supabase
      .from('projects')
      .select('id, status, contract_value, actual_cost')
      .eq('org_id', orgId)
      .in('status', ['in_progress', 'punch_list', 'closeout'])

    if (projectError) throw projectError

    // Calculate revenue metrics
    let revenue_received = 0
    let revenue_pending = 0
    const arInvoices: (typeof invoices)[0][] = []

    if (invoices && Array.isArray(invoices)) {
      invoices.forEach(inv => {
        if (inv.status === 'paid') {
          revenue_received += inv.total ?? 0
        } else if (['sent', 'viewed', 'partial', 'overdue'].includes(inv.status)) {
          revenue_pending += inv.balance_due ?? 0
          arInvoices.push(inv)
        }
      })
    }

    // Calculate AR aging buckets
    const ar_aging_buckets = calculateARBuckets(arInvoices)

    // Calculate average margin
    let total_margin = 0
    let margin_count = 0
    if (projects && Array.isArray(projects)) {
      projects.forEach(proj => {
        if (proj.contract_value && proj.actual_cost) {
          const margin = ((proj.contract_value - proj.actual_cost) / proj.contract_value) * 100
          total_margin += margin
          margin_count += 1
        }
      })
    }

    const avg_margin_pct = margin_count > 0 ? total_margin / margin_count : 0

    // Calculate DSO (Days Sales Outstanding)
    const total_ar = ar_aging_buckets.reduce((sum, b) => sum + b.total_amount, 0)
    const dso_days = calculateDSO(arInvoices)

    // Identify overdue invoices
    const overdue = arInvoices.filter(inv => inv.days_overdue && inv.days_overdue > 0)
    const overdue_amount = overdue.reduce((sum, inv) => sum + (inv.balance_due ?? 0), 0)

    // Count active projects
    const active_projects = projects?.length ?? 0

    return {
      revenue_received,
      revenue_pending,
      active_projects,
      ar_aging_buckets,
      avg_margin_pct: parseFloat(avg_margin_pct.toFixed(2)),
      dso_days: parseFloat(dso_days.toFixed(1)),
      overdue_amount: parseFloat(overdue_amount.toFixed(2)),
      overdue_count: overdue.length,
    }
  } catch (error) {
    console.error('[PULSE] calculateWeeklyKPIs error:', error)
    throw error
  }
}

/**
 * Calculate AR aging buckets from outstanding invoices
 */
function calculateARBuckets(invoices: Array<{ days_overdue?: number | null; balance_due?: number | null }>): ARAgingBucket[] {
  const buckets = {
    '0-30': { count: 0, amount: 0 },
    '30-60': { count: 0, amount: 0 },
    '60-90': { count: 0, amount: 0 },
    '90+': { count: 0, amount: 0 },
  }

  const total_ar = invoices.reduce((sum, inv) => sum + (inv.balance_due ?? 0), 0)

  invoices.forEach(inv => {
    const daysOverdue = inv.days_overdue ?? 0
    const amount = inv.balance_due ?? 0

    if (daysOverdue <= 30) {
      buckets['0-30'].count += 1
      buckets['0-30'].amount += amount
    } else if (daysOverdue <= 60) {
      buckets['30-60'].count += 1
      buckets['30-60'].amount += amount
    } else if (daysOverdue <= 90) {
      buckets['60-90'].count += 1
      buckets['60-90'].amount += amount
    } else {
      buckets['90+'].count += 1
      buckets['90+'].amount += amount
    }
  })

  return [
    {
      bucket: '0-30',
      invoice_count: buckets['0-30'].count,
      total_amount: parseFloat(buckets['0-30'].amount.toFixed(2)),
      pct_of_total: total_ar > 0 ? parseFloat(((buckets['0-30'].amount / total_ar) * 100).toFixed(1)) : 0,
    },
    {
      bucket: '30-60',
      invoice_count: buckets['30-60'].count,
      total_amount: parseFloat(buckets['30-60'].amount.toFixed(2)),
      pct_of_total: total_ar > 0 ? parseFloat(((buckets['30-60'].amount / total_ar) * 100).toFixed(1)) : 0,
    },
    {
      bucket: '60-90',
      invoice_count: buckets['60-90'].count,
      total_amount: parseFloat(buckets['60-90'].amount.toFixed(2)),
      pct_of_total: total_ar > 0 ? parseFloat(((buckets['60-90'].amount / total_ar) * 100).toFixed(1)) : 0,
    },
    {
      bucket: '90+',
      invoice_count: buckets['90+'].count,
      total_amount: parseFloat(buckets['90+'].amount.toFixed(2)),
      pct_of_total: total_ar > 0 ? parseFloat(((buckets['90+'].amount / total_ar) * 100).toFixed(1)) : 0,
    },
  ]
}

/**
 * Calculate Days Sales Outstanding (DSO) from AR invoices
 */
function calculateDSO(invoices: Array<{ days_overdue?: number | null }>): number {
  if (invoices.length === 0) return 0

  const total_days = invoices.reduce((sum, inv) => sum + (inv.days_overdue ?? 0), 0)
  return total_days / invoices.length
}

/**
 * Calculate AR aging breakdown
 * Returns 0-30, 30-60, 60-90, 90+ day buckets
 */
export async function calculateARaging(orgId: string): Promise<ARAgingBucket[]> {
  try {
    const { data: invoices, error } = await supabase
      .from('invoices')
      .select('id, status, balance_due, days_overdue')
      .eq('org_id', orgId)
      .in('status', ['sent', 'viewed', 'partial', 'overdue'])

    if (error) throw error

    const outstandingInvoices = (invoices ?? []).filter(inv => (inv.balance_due ?? 0) > 0)

    return calculateARBuckets(outstandingInvoices)
  } catch (error) {
    console.error('[PULSE] calculateARaging error:', error)
    throw error
  }
}

/**
 * Generate 12-week cash flow forecast
 * Projects income based on outstanding invoices + historical payment timing
 * Returns array of {week_start, week_end, projected_income, projected_expenses, projected_net, confidence}
 */
export async function generateCashFlowForecast(orgId: string, weeks: number = 12): Promise<CashFlowWeek[]> {
  try {
    // Fetch outstanding invoices
    const { data: invoices, error: invoiceError } = await supabase
      .from('invoices')
      .select('id, status, balance_due, due_date, days_overdue')
      .eq('org_id', orgId)
      .in('status', ['sent', 'viewed', 'partial', 'overdue'])

    if (invoiceError) throw invoiceError

    // Calculate average payment collection delay
    const { data: paidInvoices, error: paidError } = await supabase
      .from('invoices')
      .select('id, due_date, paid_at')
      .eq('org_id', orgId)
      .eq('status', 'paid')
      .limit(50)

    if (paidError) throw paidError

    let avgCollectionDelay = 7 // default 7 days
    if (paidInvoices && paidInvoices.length > 0) {
      const delays = paidInvoices
        .filter(inv => inv.due_date && inv.paid_at)
        .map(inv => {
          const dueDate = new Date(inv.due_date!).getTime()
          const paidDate = new Date(inv.paid_at!).getTime()
          return (paidDate - dueDate) / (1000 * 60 * 60 * 24)
        })

      if (delays.length > 0) {
        avgCollectionDelay = Math.max(0, delays.reduce((a, b) => a + b) / delays.length)
      }
    }

    // Fetch projects for expense estimates
    const { data: projects, error: projectError } = await supabase
      .from('projects')
      .select('id, status, estimated_cost, actual_cost')
      .eq('org_id', orgId)
      .in('status', ['in_progress', 'punch_list', 'closeout'])

    if (projectError) throw projectError

    // Build forecast
    const forecast: CashFlowWeek[] = []
    const today = new Date()

    for (let i = 0; i < weeks; i++) {
      const weekStart = new Date(today.getTime() + i * 7 * 24 * 60 * 60 * 1000)
      const weekEnd = new Date(weekStart.getTime() + 6 * 24 * 60 * 60 * 1000)

      // Project income: invoices due to be paid this week
      let projected_income = 0
      let invoiceCount = 0
      if (invoices && Array.isArray(invoices)) {
        invoices.forEach(inv => {
          if (inv.balance_due && inv.due_date) {
            const dueDate = new Date(inv.due_date).getTime()
            const expectedPaymentDate = dueDate + avgCollectionDelay * 24 * 60 * 60 * 1000

            if (expectedPaymentDate >= weekStart.getTime() && expectedPaymentDate <= weekEnd.getTime()) {
              projected_income += inv.balance_due
              invoiceCount += 1
            }
          }
        })
      }

      // Project expenses: rough estimate based on active projects
      let projected_expenses = 0
      if (projects && Array.isArray(projects)) {
        projects.forEach(proj => {
          const estCost = proj.estimated_cost ?? 0
          const actualCost = proj.actual_cost ?? 0
          const remaining = Math.max(0, estCost - actualCost)
          projected_expenses += remaining / weeks
        })
      }

      const projected_net = projected_income - projected_expenses
      const confidence = invoiceCount > 0 ? Math.min(1, 0.7 + (invoiceCount * 0.1)) : 0.3

      forecast.push({
        week_start: weekStart.toISOString().split('T')[0],
        week_end: weekEnd.toISOString().split('T')[0],
        projected_income: parseFloat(projected_income.toFixed(2)),
        projected_expenses: parseFloat(projected_expenses.toFixed(2)),
        projected_net: parseFloat(projected_net.toFixed(2)),
        confidence: parseFloat(confidence.toFixed(2)),
      })
    }

    return forecast
  } catch (error) {
    console.error('[PULSE] generateCashFlowForecast error:', error)
    throw error
  }
}

/**
 * Get historical revenue for 12 weeks
 * Returns array of {week, revenue, target} for trending analysis
 */
export async function getHistoricalRevenue(orgId: string, weeks: number = 12): Promise<HistoricalRevenue[]> {
  try {
    // Fetch weekly_tracker (or create dummy data if not available)
    const { data: weeklyData, error } = await supabase
      .from('weekly_tracker' as never)
      .select('*')
      .eq('org_id', orgId)
      .order('week_number', { ascending: false })
      .limit(weeks)

    if (error && error.code !== 'PGRST116') throw error // 416 = "not found", which is ok

    const historical: HistoricalRevenue[] = []

    if (weeklyData && Array.isArray(weeklyData)) {
      weeklyData.reverse().forEach(week => {
        const revenue = (week.service_revenue ?? 0) + (week.project_revenue ?? 0)
        const target = (week.ytd_target ?? 0) / (week.week_number ?? 1) // rough estimate

        historical.push({
          week: `Week ${week.week_number ?? 0}`,
          revenue: parseFloat(revenue.toFixed(2)),
          target: parseFloat(target.toFixed(2)),
          margin_pct: 18, // placeholder - would need project cost data for precision
        })
      })
    }

    // If no historical data, return empty array
    if (historical.length === 0) {
      return Array.from({ length: weeks }, (_, i) => ({
        week: `Week ${i + 1}`,
        revenue: 0,
        target: 10000,
        margin_pct: 0,
      }))
    }

    return historical
  } catch (error) {
    console.error('[PULSE] getHistoricalRevenue error:', error)
    throw error
  }
}
