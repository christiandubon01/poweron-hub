/** Owner-facing Apply Candidate labels. Host phases only — no estimated progress. */

export const APPLY_PROGRESS_LABELS: Record<string, string> = {
  'Apply requested': 'Apply requested',
  'Checking candidate': 'Checking candidate…',
  'Checking canonical drift': 'Checking canonical drift…',
  'Applying candidate': 'Applying candidate…',
  'Verifying applied files': 'Verifying…',
  Applied: 'Applied',
  'Conflict detected': 'Conflict detected',
}

const APPLY_FAILURE_REASONS = [
  'Verifier did not pass',
  'Guard blocked candidate',
  'Candidate workspace unavailable',
  'Candidate does not match the verified attempt',
  'Canonical conflict',
  'Unsafe path',
  'Filesystem apply failed',
  'Rollback failed',
  'Verification mismatch',
  'Already applied',
  'No candidate changes to apply',
  'Apply request could not be read.',
]

export interface ApplyNotice {
  kind: 'applied' | 'already' | 'conflict' | 'failed'
  message: string
  paths: string[]
  pathCount: number | null
  rollback: 'PASS' | 'FAIL' | null
}

export function applyProgressLabel(phase: unknown): string | null {
  if (typeof phase !== 'string' || phase.includes('%')) return null
  return APPLY_PROGRESS_LABELS[phase] ?? null
}

export function ownerApplyFailure(error: string | null | undefined): string {
  const text = (error ?? '').trim()
  return APPLY_FAILURE_REASONS.find((reason) => text === reason) ?? 'Filesystem apply failed'
}

export function noticeFromApplyResult(status: string, result: Record<string, unknown> | null, error: string | null): ApplyNotice | null {
  const paths = Array.isArray(result?.conflictPaths) ? result.conflictPaths.filter((entry): entry is string => typeof entry === 'string') : []
  const pathCount = typeof result?.pathCount === 'number' ? result.pathCount : null
  const rollback = result?.rollback === 'PASS' || result?.rollback === 'FAIL' ? result.rollback : null
  if (status === 'completed' && result?.outcome === 'already-applied') {
    return { kind: 'already', message: 'Already applied', paths: [], pathCount, rollback: null }
  }
  if (status === 'completed' && result?.outcome === 'applied') {
    return { kind: 'applied', message: 'Candidate applied', paths: [], pathCount, rollback: null }
  }
  if (status === 'failed') {
    const message = ownerApplyFailure(error)
    return { kind: message === 'Canonical conflict' ? 'conflict' : 'failed', message, paths, pathCount, rollback }
  }
  return null
}
