/**
 * utils/pipelineCalc.ts — Single source of truth for pipeline calculation.
 *
 * Correct formula (B31 audit): Pipeline = sum of all quoted (contract) amounts
 * on active and coming-up projects only.
 *
 * Callers that also include service revenue should add that on top of calcPipeline().
 */

/** Minimal shape required — intentionally loose so callers need no extra imports. */
interface PipelineProject {
  status?: string
  contract?: number | string | null
}

/** Safe numeric coercion — mirrors the num() utility in backupDataService. */
function numSafe(v: unknown): number {
  const n = Number(v)
  return isNaN(n) ? 0 : n
}

/**
 * Returns the sum of contract amounts across all projects whose status is
 * 'active' or 'coming' (coming-up / pre-start).
 *
 * This is the canonical PowerOn pipeline formula.
 */
export function calcPipeline(projects: PipelineProject[]): number {
  return projects
    .filter(p => {
      const s = (p.status || '').toLowerCase()
      return s === 'active' || s === 'coming'
    })
    .reduce((s, p) => s + numSafe(p.contract), 0)
}
