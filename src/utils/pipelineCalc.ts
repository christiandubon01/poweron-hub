/**
 * utils/pipelineCalc.ts — Single source of truth for pipeline calculation.
 *
 * BUG 2 FIX:
 *   Pipeline = SUM(contract) WHERE status = 'active' ONLY
 *   - Excludes: 'coming', 'pending', 'completed', 'cancelled', 'estimate', 'deleted', 'lost', 'rejected'
 *   - Service calls added as a SEPARATE bucket, accumulated into combined total
 *
 * Before this fix, calcPipeline() included 'coming' (coming-up) projects AND
 * all service calls (even fully-collected ones), causing iPad to show $104K
 * while Windows showed $64.8K depending on which data was cached.
 *
 * Callers should use:
 *   calcActivePipeline(projects, serviceLogs) — combined active pipeline
 *   calcPipeline(projects)                   — project-only active pipeline
 *   calcServicePipeline(serviceLogs)         — service-only open balance
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/** Minimal project shape required. */
interface PipelineProject {
  status?: string
  contract?: number | string | null
}

/** Minimal service log shape required. */
interface PipelineServiceLog {
  quoted?: number | string | null
  collected?: number | string | null
  adjustments?: Array<{ type?: string; amount?: number | string | null }>
}

// ── Safe numeric coercion ─────────────────────────────────────────────────────

function numSafe(v: unknown): number {
  const n = Number(v)
  return isNaN(n) ? 0 : n
}

// ── Project pipeline — ACTIVE ONLY ───────────────────────────────────────────

/**
 * calcPipeline — returns the sum of contract amounts for ACTIVE projects only.
 *
 * Includes ONLY:  status === 'active'
 * Excludes:       'coming', 'pending', 'completed', 'cancelled', 'estimate',
 *                 'deleted', 'lost', 'rejected'
 *
 * This is the canonical project pipeline formula (fixed from including 'coming').
 */
export function calcPipeline(projects: PipelineProject[]): number {
  return projects
    .filter(p => (p.status || '').toLowerCase().trim() === 'active')
    .reduce((s, p) => s + numSafe(p.contract), 0)
}

// ── Service pipeline — open balance only ─────────────────────────────────────

/**
 * calcServicePipeline — returns the sum of outstanding (uncollected) balances
 * across all service calls.
 *
 * Formula per service log:
 *   totalBillable = quoted + sum(income adjustments)
 *   openBalance   = max(0, totalBillable − collected)
 *
 * Fully-collected service calls contribute $0 to the pipeline.
 * This is a SEPARATE bucket that gets added to the combined total.
 */
export function calcServicePipeline(serviceLogs: PipelineServiceLog[]): number {
  return (serviceLogs || []).reduce((sum, l) => {
    const quoted = numSafe(l.quoted)
    const collected = numSafe(l.collected)
    const adjustments = Array.isArray(l.adjustments) ? l.adjustments : []
    const addIncome = adjustments
      .filter(a => a && a.type === 'income')
      .reduce((s, a) => s + numSafe(a.amount), 0)
    const totalBillable = quoted + addIncome
    return sum + Math.max(0, totalBillable - collected)
  }, 0)
}

// ── Combined pipeline ─────────────────────────────────────────────────────────

/**
 * calcActivePipeline — combined active pipeline:
 *   Active project contracts + open service call balances.
 *
 * This is the number that should appear in ALL pipeline displays:
 *   - Home top bar
 *   - Graph Dashboard
 *   - Money Panel
 *   - Any panel showing pipeline
 */
export function calcActivePipeline(
  projects: PipelineProject[],
  serviceLogs: PipelineServiceLog[]
): number {
  return calcPipeline(projects) + calcServicePipeline(serviceLogs)
}
