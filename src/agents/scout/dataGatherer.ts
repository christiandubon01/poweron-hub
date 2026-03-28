/**
 * SCOUT Data Gatherer — pulls analysis snapshots from Supabase.
 *
 * Queries multiple domain tables and returns a single structured object
 * that gets passed to Claude for pattern detection and proposal generation.
 */

import { supabase } from '@/lib/supabase'

// ── Types ───────────────────────────────────────────────────────────────────

export interface ScoutDataSnapshot {
  gatheredAt:        string
  orgId:             string
  fieldLogs:         FieldLogSummary[]
  activeProjects:    ProjectSummary[]
  outdatedPricing:   OutdatedPriceItem[]
  overdueItems:      OverdueCoordination[]
  costVariances:     CostVariance[]
  dormantGCs:        DormantGC[]
  weeklyTracker:     WeeklyEntry[]
  openInvoices:      OpenInvoice[]
}

interface FieldLogSummary {
  project_id:    string
  project_name?: string
  log_date:      string
  employee_id:   string
  hours:         number
  material_cost: number
  pay_status:    string
  notes?:        string
}

interface ProjectSummary {
  id:              string
  name:            string
  status:          string
  type:            string
  phase:           string | null
  priority:        string
  estimated_value: number | null
  contract_value:  number | null
  updated_at:      string
}

interface OutdatedPriceItem {
  id:            string
  name:          string
  unit_cost:     number
  unit:          string
  supplier:      string | null
  category_name: string | null
  updated_at:    string
  days_stale:    number
}

interface OverdueCoordination {
  id:         string
  project_id: string
  category:   string
  title:      string
  status:     string
  due_date:   string
  days_overdue: number
}

interface CostVariance {
  project_id:        string
  project_name:      string
  est_labor_cost:    number
  est_material_cost: number
  est_overhead_cost: number
  actual_hours:      number
  actual_material:   number
  variance_pct:      number | null
}

interface DormantGC {
  id:              string
  company:         string
  pipeline_phase:  string
  fit_score:       number | null
  payment_rating:  string | null
  bids_sent:       number
  bids_awarded:    number
  win_rate:        number | null
  last_activity:   string | null
  days_dormant:    number
}

interface WeeklyEntry {
  week_number:      number
  active_projects:  number
  service_revenue:  number
  project_revenue:  number
  unbilled_amount:  number
  ytd_revenue:      number
}

interface OpenInvoice {
  id:             string
  invoice_number: string
  status:         string
  total:          number
  balance_due:    number
  due_date:       string
  days_overdue:   number
}


// ── Date helpers ────────────────────────────────────────────────────────────

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().split('T')[0]
}

function daysBetween(dateStr: string): number {
  const d = new Date(dateStr)
  return Math.floor((Date.now() - d.getTime()) / 86_400_000)
}


// ── Gatherer ────────────────────────────────────────────────────────────────

/**
 * Gather a comprehensive data snapshot for SCOUT analysis.
 * Each query is independently caught so partial data still enables analysis.
 */
export async function gatherScoutData(orgId: string): Promise<ScoutDataSnapshot> {
  const snapshot: ScoutDataSnapshot = {
    gatheredAt:      new Date().toISOString(),
    orgId,
    fieldLogs:       [],
    activeProjects:  [],
    outdatedPricing: [],
    overdueItems:    [],
    costVariances:   [],
    dormantGCs:      [],
    weeklyTracker:   [],
    openInvoices:    [],
  }

  // ── 1. Field logs — last 30 days ────────────────────────────────────────
  try {
    const { data } = await supabase
      .from('field_logs' as never)
      .select('project_id, log_date, employee_id, hours, material_cost, pay_status, notes')
      .eq('org_id', orgId)
      .gte('log_date', daysAgo(30))
      .order('log_date', { ascending: false })
      .limit(200)

    if (data) snapshot.fieldLogs = data as FieldLogSummary[]
  } catch (err) {
    console.warn('[Scout:gather] field_logs failed:', err)
  }

  // ── 2. Active projects with phase status ────────────────────────────────
  try {
    const { data } = await supabase
      .from('projects')
      .select('id, name, status, type, phase, priority, estimated_value, contract_value, updated_at')
      .eq('org_id', orgId)
      .in('status', ['lead', 'estimate', 'pending', 'approved', 'in_progress', 'on_hold', 'punch_list'])
      .order('updated_at', { ascending: false })
      .limit(50)

    if (data) snapshot.activeProjects = data as ProjectSummary[]
  } catch (err) {
    console.warn('[Scout:gather] projects failed:', err)
  }

  // ── 3. Outdated price book entries (>60 days since update) ──────────────
  try {
    const { data } = await supabase
      .from('price_book_items' as never)
      .select('id, name, unit_cost, unit, supplier, category_name, updated_at')
      .eq('org_id', orgId)
      .lt('updated_at', new Date(Date.now() - 60 * 86_400_000).toISOString())
      .limit(50)

    if (data) {
      snapshot.outdatedPricing = (data as Array<Record<string, unknown>>).map(item => ({
        ...item,
        days_stale: daysBetween(item.updated_at as string),
      })) as OutdatedPriceItem[]
    }
  } catch (err) {
    console.warn('[Scout:gather] price_book_items failed:', err)
  }

  // ── 4. Coordination items past due date ─────────────────────────────────
  try {
    const today = new Date().toISOString().split('T')[0]
    const { data } = await supabase
      .from('coordination_items' as never)
      .select('id, project_id, category, title, status, due_date')
      .eq('org_id', orgId)
      .in('status', ['open', 'in_progress'])
      .lt('due_date', today)
      .order('due_date', { ascending: true })
      .limit(30)

    if (data) {
      snapshot.overdueItems = (data as Array<Record<string, unknown>>).map(item => ({
        ...item,
        days_overdue: daysBetween(item.due_date as string),
      })) as OverdueCoordination[]
    }
  } catch (err) {
    console.warn('[Scout:gather] coordination_items failed:', err)
  }

  // ── 5. Cost variances (estimates vs actuals) ────────────────────────────
  try {
    // Get cost summaries
    const { data: costSummaries } = await supabase
      .from('project_cost_summary' as never)
      .select('*')
      .eq('org_id', orgId)
      .limit(20)

    if (costSummaries) {
      // For each project with a cost summary, compute variance against field logs
      const variances: CostVariance[] = []

      for (const cs of costSummaries as Array<Record<string, unknown>>) {
        const projectId = cs.project_id as string

        // Sum actual hours and materials from field logs
        const projectLogs = snapshot.fieldLogs.filter(fl => fl.project_id === projectId)
        const actualHours    = projectLogs.reduce((sum, fl) => sum + (fl.hours || 0), 0)
        const actualMaterial = projectLogs.reduce((sum, fl) => sum + (fl.material_cost || 0), 0)

        const estLabor    = (cs.est_labor_cost    as number) || 0
        const estMaterial = (cs.est_material_cost  as number) || 0
        const estOverhead = (cs.est_overhead_cost  as number) || 0
        const estTotal    = estLabor + estMaterial + estOverhead

        // Rough variance: (actual / estimated - 1) * 100
        const actualTotal = (actualHours * 85) + actualMaterial // Assume ~$85/hr labor rate
        const variancePct = estTotal > 0 ? ((actualTotal / estTotal) - 1) * 100 : null

        variances.push({
          project_id:        projectId,
          project_name:      (cs.project_name as string) || 'Unknown',
          est_labor_cost:    estLabor,
          est_material_cost: estMaterial,
          est_overhead_cost: estOverhead,
          actual_hours:      actualHours,
          actual_material:   actualMaterial,
          variance_pct:      variancePct !== null ? Math.round(variancePct * 10) / 10 : null,
        })
      }

      snapshot.costVariances = variances.filter(v => v.variance_pct !== null)
    }
  } catch (err) {
    console.warn('[Scout:gather] cost variances failed:', err)
  }

  // ── 6. GC relationships with no recent activity (90+ days) ──────────────
  try {
    const { data: gcs } = await supabase
      .from('gc_contacts' as never)
      .select('id, company, pipeline_phase, fit_score, payment_rating, bids_sent, bids_awarded, win_rate, updated_at')
      .eq('org_id', orgId)
      .limit(50)

    if (gcs) {
      // For each GC, check last activity
      const dormant: DormantGC[] = []

      for (const gc of gcs as Array<Record<string, unknown>>) {
        const { data: lastActivity } = await supabase
          .from('gc_activity_log' as never)
          .select('created_at')
          .eq('gc_contact_id', gc.id as string)
          .order('created_at', { ascending: false })
          .limit(1)

        const lastDate = (lastActivity as Array<Record<string, unknown>>)?.[0]?.created_at as string | undefined
        const daysDormant = lastDate ? daysBetween(lastDate) : daysBetween(gc.updated_at as string)

        if (daysDormant >= 90) {
          dormant.push({
            id:             gc.id as string,
            company:        gc.company as string,
            pipeline_phase: gc.pipeline_phase as string,
            fit_score:      gc.fit_score as number | null,
            payment_rating: gc.payment_rating as string | null,
            bids_sent:      gc.bids_sent as number,
            bids_awarded:   gc.bids_awarded as number,
            win_rate:       gc.win_rate as number | null,
            last_activity:  lastDate || null,
            days_dormant:   daysDormant,
          })
        }
      }

      snapshot.dormantGCs = dormant
    }
  } catch (err) {
    console.warn('[Scout:gather] gc_contacts failed:', err)
  }

  // ── 7. Weekly tracker — last 12 weeks ───────────────────────────────────
  try {
    const { data } = await supabase
      .from('weekly_tracker' as never)
      .select('week_number, active_projects, service_revenue, project_revenue, unbilled_amount, ytd_revenue')
      .eq('org_id', orgId)
      .order('week_number', { ascending: false })
      .limit(12)

    if (data) snapshot.weeklyTracker = data as WeeklyEntry[]
  } catch (err) {
    console.warn('[Scout:gather] weekly_tracker failed:', err)
  }

  // ── 8. Open invoices ────────────────────────────────────────────────────
  try {
    const { data } = await supabase
      .from('invoices')
      .select('id, invoice_number, status, total, balance_due, due_date, days_overdue')
      .eq('org_id', orgId)
      .in('status', ['sent', 'viewed', 'partial', 'overdue'])
      .order('days_overdue', { ascending: false })
      .limit(20)

    if (data) snapshot.openInvoices = data as OpenInvoice[]
  } catch (err) {
    console.warn('[Scout:gather] invoices failed:', err)
  }

  return snapshot
}
