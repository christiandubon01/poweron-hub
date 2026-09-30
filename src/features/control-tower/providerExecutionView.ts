import { useEffect, useState } from 'react'

/** Keep identical to agent-host/providers/executionLimits.ts formatOwnerDuration. */
export function formatOwnerDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes === 0) return `${seconds}s`
  return `${minutes}m ${seconds}s`
}

/** Format an ISO timestamp in the viewer's local timezone for compact UI copy. */
export function formatShortLocalDateTime(value: string): string | null {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return null
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(timestamp))
}

export function providerWorkingLabel(elapsedMs: number): string {
  return `Provider working · ${formatOwnerDuration(elapsedMs)}`
}

export interface TerminalEvidenceView {
  elapsedMs?: number | null
  lastActivityAt?: string | null
  limitFired?: 'startup' | 'inactivity' | 'ceiling' | 'none'
  limitMs?: number | null
  changedFileCount?: number | null
}

const SAFE_FAILURE_COPY: Record<string, string> = {
  PROVIDER_NOT_INSTALLED: 'Provider is not installed on this Host.',
  PROVIDER_UNAVAILABLE: 'Provider is unavailable.',
  MODEL_UNAVAILABLE: 'Requested model is unavailable.',
  PROCESS_SPAWN_FAILED: 'Provider could not start.',
  PROCESS_EXIT_NONZERO: 'Provider exited with an error.',
  PROVIDER_PROCESS_FAILED: 'Provider exited with an error.',
  PROTOCOL_ERROR: 'Provider returned an invalid result.',
  PROVIDER_ERROR: 'Provider reported an error.',
  EXECUTION_CANCELLED: 'Provider attempt was cancelled.',
  EXECUTION_CANCELLED_BY_OWNER: 'Provider attempt was cancelled by the owner.',
  OUTPUT_LIMIT_EXCEEDED: 'Provider output exceeded the safety limit.',
  WORKING_DIRECTORY_INVALID: 'Provider workspace is invalid.',
  POLICY_REJECTED: 'Provider changes did not pass workspace policy.',
  EXECUTION_TIMEOUT: 'Provider execution timed out.',
}

/** Derive all visible failure text from fixed copy and typed evidence. */
export function ownerTerminalReason(errorCode: string | null | undefined, _storedMessage: string | null | undefined, evidence: TerminalEvidenceView = {}): string {
  let reason = errorCode ? SAFE_FAILURE_COPY[errorCode] ?? 'Provider attempt failed.' : 'Provider attempt failed.'
  if (evidence.limitFired === 'startup') reason = 'Stopped — provider never started responding.'
  else if (evidence.limitFired === 'inactivity' || errorCode === 'PROVIDER_INACTIVITY_TIMEOUT') {
    reason = `Stopped — no provider activity for ${typeof evidence.limitMs === 'number' ? formatOwnerDuration(evidence.limitMs) : 'the inactivity limit'}.`
  } else if (evidence.limitFired === 'ceiling' || errorCode === 'PROVIDER_ABSOLUTE_TIMEOUT') {
    reason = `Stopped — reached ${typeof evidence.limitMs === 'number' ? formatOwnerDuration(evidence.limitMs) : 'the'} safety limit.`
  }
  const details: string[] = [reason]
  if (typeof evidence.elapsedMs === 'number' && Number.isFinite(evidence.elapsedMs) && evidence.elapsedMs >= 0) details.push(`Elapsed: ${formatOwnerDuration(evidence.elapsedMs)}`)
  if (typeof evidence.lastActivityAt === 'string') {
    const lastActivity = formatShortLocalDateTime(evidence.lastActivityAt)
    if (lastActivity) details.push(`Last activity: ${lastActivity}`)
  }
  if (typeof evidence.changedFileCount === 'number' && Number.isSafeInteger(evidence.changedFileCount) && evidence.changedFileCount >= 0) details.push(`${evidence.changedFileCount} ${evidence.changedFileCount === 1 ? 'file' : 'files'} changed in isolated workspace — not verified, not applied`)
  return details.join(' · ')
}

/** Live elapsed label while a provider attempt is running. Null when start time is absent. */
export function useProviderWorkingLabel(startedAt: string | null | undefined): string | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!startedAt) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [startedAt])
  if (!startedAt) return null
  const elapsed = now - Date.parse(startedAt)
  if (!Number.isFinite(elapsed) || elapsed < 0) return null
  return providerWorkingLabel(elapsed)
}
