/**
 * CT-REL-3 A5 + A4: the pure cancel-status and queued-status derivations used by
 * the Control Tower hook. Both are driven ONLY by real control-request rows:
 *   - cancel status never produces "Cancelled" (that comes from run state),
 *   - queued status only surfaces the Host's factual per-request line.
 */
import { describe, expect, it } from 'vitest'
import { cancelStatusForRow, queuedStatusLine } from './useControlTowerReal'
import type { ControlRequestRow } from './controlTowerService'

function row(overrides: Partial<ControlRequestRow>): ControlRequestRow {
  return {
    id: 'req-1',
    request_type: 'cancel_run',
    client_request_id: 'client-1',
    repo_key: 'repo-key-1',
    status: 'pending',
    payload: { runId: 'run-1' },
    result: null,
    error: null,
    created_at: '2026-09-27T10:00:00.000Z',
    ...overrides,
  }
}

describe('cancelStatusForRow (A5)', () => {
  it('maps pending → "Cancel requested"', () => {
    expect(cancelStatusForRow(row({ status: 'pending' }))).toBe('Cancel requested')
  })

  it('maps claimed → "Cancelling"', () => {
    expect(cancelStatusForRow(row({ status: 'claimed' }))).toBe('Cancelling')
  })

  it('surfaces the safe failure reason on failed (never silently clears)', () => {
    const reason = 'RUN_ALREADY_TERMINAL: run-1 is completed.'
    expect(cancelStatusForRow(row({ status: 'failed', error: reason }))).toBe(reason)
  })

  it('falls back to a safe message when a failed row carries no error text', () => {
    expect(cancelStatusForRow(row({ status: 'failed', error: null }))).toBe('The Host could not cancel this run.')
  })

  it('never emits "Cancelled" itself — completed clears the transient status (run state drives it)', () => {
    expect(cancelStatusForRow(row({ status: 'completed' }))).toBeNull()
    expect(cancelStatusForRow(row({ status: 'cancelled' }))).toBeNull()
  })
})

describe('queuedStatusLine (A4)', () => {
  it('returns the Host-published queued line when present', () => {
    expect(queuedStatusLine({ queuedStatus: 'Queued — waiting for the current run to finish' }))
      .toBe('Queued — waiting for the current run to finish')
  })

  it('returns null when there is no queued status', () => {
    expect(queuedStatusLine(null)).toBeNull()
    expect(queuedStatusLine({})).toBeNull()
    expect(queuedStatusLine({ queuedStatus: '' })).toBeNull()
    expect(queuedStatusLine({ queuedStatus: 42 as unknown as string })).toBeNull()
  })
})
