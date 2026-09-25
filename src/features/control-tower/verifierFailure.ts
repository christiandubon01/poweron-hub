/**
 * Presentation of an already-published verifier FAIL.
 * Reads the run view only — no second evidence store.
 */
import type { InterimVerdictView, PreviewTask, SignalView, VerificationState } from '@/components/v15r/app-brain/control-tower/controlTowerTypes'

export interface VerifierFailureSource {
  verification: VerificationState
  verificationSummary?: string | null
  interimVerdicts?: InterimVerdictView[]
  tasks: Array<Pick<PreviewTask, 'id' | 'taskId' | 'role' | 'title' | 'state' | 'provider' | 'reported'>>
  candidateCount?: number | null
  signals?: SignalView[]
}

export interface VerifierFailureDiagnostics {
  summary: string | null
  failedChecks: string[]
  evidenceRefs: string[]
  /** Null when the snapshot did not publish owner-facing evidence. */
  evidenceCount: number | null
  attemptId: string | null
  verifierTaskTitle: string | null
  verifierTaskKey: string | null
  /** Passed means the provider attempt completed; it is not the verification verdict. */
  execution: 'passed' | 'failed' | null
  provider: string | null
  reportedModel: string | null
  candidateCount: number | null
  guardSummary: string | null
  disagreement: string | null
}

const GENERIC_FAIL_SUMMARY = /^(?:verifier verdict|verdict)\s*:\s*fail$/i

export function diagnosticVerifierSummary(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || GENERIC_FAIL_SUMMARY.test(trimmed)) return null
  return trimmed
}

function latestFail(verdicts: InterimVerdictView[]): InterimVerdictView | null {
  let latest: InterimVerdictView | null = null
  let latestMs = Number.NEGATIVE_INFINITY
  for (const verdict of verdicts) {
    if (verdict.role !== 'verifier' || verdict.state !== 'FAIL') continue
    const ms = Date.parse(verdict.timestamp)
    const rank = Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY
    if (latest === null || rank >= latestMs) {
      latest = verdict
      latestMs = rank
    }
  }
  return latest
}

function latestGuardSummary(verdicts: InterimVerdictView[]): string | null {
  let latest: InterimVerdictView | null = null
  let latestMs = Number.NEGATIVE_INFINITY
  for (const verdict of verdicts) {
    if (verdict.role !== 'guard') continue
    const ms = Date.parse(verdict.timestamp)
    const rank = Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY
    if (latest === null || rank >= latestMs) {
      latest = verdict
      latestMs = rank
    }
  }
  const summary = latest?.summary?.trim()
  return summary ? summary : null
}

export function countPhrase(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`
}

export function verifierFailureDiagnostics(source: VerifierFailureSource): VerifierFailureDiagnostics | null {
  if (source.verification !== 'rejected') return null
  const verdicts = source.interimVerdicts ?? []
  const fail = latestFail(verdicts)
  const verdictSummary = diagnosticVerifierSummary(fail?.summary)
  const publishedSummary = diagnosticVerifierSummary(source.verificationSummary)
  const summary = verdictSummary ?? publishedSummary

  const attemptId = fail?.attemptId ?? null
  const rawRefs = fail?.evidenceRefs ?? []
  const ownerRefs = rawRefs.filter((ref) => ref.trim().length > 0 && ref !== attemptId)
  const fallbackOnly = rawRefs.length > 0 && ownerRefs.length === 0 && attemptId != null && rawRefs.every((ref) => ref === attemptId)
  const evidenceRefs = ownerRefs
  const evidenceCount = ownerRefs.length > 0
    ? ownerRefs.length
    : !fail || fallbackOnly
      ? null
      : fail.evidenceCount > 0
        ? fail.evidenceCount
        : null

  const verifierTask = fail?.taskId
    ? source.tasks.find((task) => task.role === 'Verifier' && (task.taskId === fail.taskId || task.id === fail.taskId))
    : undefined
  const task = verifierTask ?? source.tasks.find((task) => task.role === 'Verifier') ?? null
  const disagreement = (source.signals ?? []).find((signal) => signal.category === 'verifier-implementer-disagreement')

  return {
    summary,
    failedChecks: fail?.failedChecks?.filter((check) => check.trim().length > 0) ?? [],
    evidenceRefs,
    evidenceCount,
    attemptId,
    verifierTaskTitle: task?.title ?? null,
    verifierTaskKey: task?.id ?? null,
    execution: task?.state === 'passed' ? 'passed' : task?.state === 'failed' ? 'failed' : null,
    provider: task?.provider ?? (task?.reported.state === 'reported' ? task.reported.provider ?? null : null),
    reportedModel: task?.reported.state === 'reported' ? task.reported.model ?? null : null,
    candidateCount: typeof source.candidateCount === 'number' ? source.candidateCount : null,
    guardSummary: latestGuardSummary(verdicts),
    disagreement: disagreement?.message?.trim() ? disagreement.message.trim() : null,
  }
}

export function verifierRejectionConsequence(diagnostics: VerifierFailureDiagnostics): string {
  if (!diagnostics.summary && diagnostics.failedChecks.length === 0 && diagnostics.evidenceCount == null) {
    return 'Verifier rejected the candidate. Detailed verifier evidence was not recorded for this run.'
  }
  return diagnostics.summary ?? 'Verifier rejected the candidate. Detailed verifier evidence was not recorded for this run.'
}

export function taskProducedVerifierFailure(
  task: Pick<PreviewTask, 'id' | 'taskId' | 'role'>,
  diagnostics: VerifierFailureDiagnostics,
): boolean {
  if (task.role !== 'Verifier') return false
  if (!diagnostics.verifierTaskKey && !diagnostics.attemptId) return true
  if (diagnostics.verifierTaskKey && (task.id === diagnostics.verifierTaskKey || task.taskId === diagnostics.verifierTaskKey)) return true
  return diagnostics.verifierTaskKey == null
}
