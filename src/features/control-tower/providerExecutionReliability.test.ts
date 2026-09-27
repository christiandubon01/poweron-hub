// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { TaskRow } from '@/components/v15r/app-brain/control-tower/ControlTowerPrimitives'
import type { PreviewTask } from '@/components/v15r/app-brain/control-tower/controlTowerTypes'
import { computeHostPresence, mapRunSnapshotRow } from './controlTowerAdapter'
import HostRestartNotice from './HostRestartNotice'
import { hostRestartRequired, HOST_RESTART_REQUIRED_MESSAGE, readHostSourceFingerprint } from './hostCodeWarning'
import { formatOwnerDuration, providerWorkingLabel } from './providerExecutionView'
import type { RunSnapshotRow } from './controlTowerService'

const STARTED = '2026-09-25T21:58:56.000Z'
const TWELVE_MINUTES = (12 * 60 + 18) * 1000

function row(status: string, attempt: Record<string, unknown>): RunSnapshotRow {
  return {
    run_id: 'run-1',
    repo_key: 'abcdef0123456789',
    objective: 'scope',
    status,
    published_at: STARTED,
    updated_at: STARTED,
    snapshot: {
      schemaVersion: 1,
      run: {
        runId: 'run-1', title: 'Run', objective: 'scope', status,
        createdAt: STARTED, updatedAt: STARTED, startedAt: STARTED, completedAt: null,
      },
      tasks: [{
        taskId: 'task-1', clientTaskKey: 'projection', title: 'Projection', role: 'implementer',
        status, position: 0, dependencies: [], plannedAreas: [], permissionProfile: 'task-implementer',
      }],
      attempts: [{
        attemptId: 'attempt-1', taskId: 'task-1', ordinal: 1, status,
        requestedModel: 'claude-opus-4-8', reportedModel: 'claude-opus-4-8', reportedModelSource: 'protocol-message',
        startedAt: STARTED,
        ...attempt,
      }],
      gate: null,
      changeset: null,
      verification: null,
    },
  }
}

const failedTask = (): PreviewTask => ({
  id: 'projection',
  title: 'Projection',
  role: 'Implementer',
  state: 'failed',
  summary: 'Attempt 1 · failed',
  detail: 'Provider reached the absolute execution safety limit.',
  attempt: 'Provider reached the absolute execution safety limit.',
  failureReason: 'Provider reached the absolute execution safety limit.',
  retry: 'none',
  dependencies: 'None',
  requested: { state: 'requested', model: 'claude-opus-4-8' },
  reported: { state: 'reported', model: 'claude-opus-4-8' },
})

describe('provider execution reliability view', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null
  afterEach(() => {
    act(() => root?.unmount())
    host?.remove()
    root = null
    host = null
  })

  it('formats a long active run without a percentage or ETA', () => {
    expect(formatOwnerDuration(TWELVE_MINUTES)).toBe('12m 18s')
    expect(providerWorkingLabel(TWELVE_MINUTES)).toBe('Provider working · 12m 18s')
    expect(providerWorkingLabel(TWELVE_MINUTES).includes('%')).toBe(false)
  })

  it('shows the working clock from the attempt start', () => {
    const view = mapRunSnapshotRow(row('running', {}), Date.parse(STARTED) + TWELVE_MINUTES)
    expect(view?.tasks[0].attempt).toBe('Provider working · 12m 18s')
    expect(view?.phase).toBe('Provider working · 12m 18s')
    expect(view?.tasks[0].executionStartedAt).toBe(STARTED)
  })

  it('shows the safe terminal reason on a failed implementer', () => {
    const view = mapRunSnapshotRow(row('failed', {
      terminalErrorCode: 'PROVIDER_INACTIVITY_TIMEOUT',
      terminalErrorMessage: 'SECRET provider transcript must never appear',
      elapsedMs: 510_000,
      lastActivityAt: STARTED,
      limitFired: 'inactivity',
      limitMs: 480_000,
      changedFileCount: 2,
    }), Date.parse(STARTED) + TWELVE_MINUTES)
    expect(view?.tasks[0].failureReason).toContain('Stopped — no provider activity for 8m 0s.')
    expect(view?.tasks[0].detail).toContain('Elapsed: 8m 30s')
    expect(view?.tasks[0].detail).toContain(`Last activity: ${STARTED}`)
    expect(view?.tasks[0].detail).toContain('2 files changed in isolated workspace — not verified, not applied')
    expect(JSON.stringify(view)).not.toContain('SECRET provider transcript')
    expect(view?.tasks[0].attempt.includes('%')).toBe(false)
  })

  it('never renders stored provider text for an unknown failure code', () => {
    const view = mapRunSnapshotRow(row('failed', {
      terminalErrorCode: 'NEW_PROVIDER_CODE',
      terminalErrorMessage: 'SECRET raw provider output',
      elapsedMs: 4_000,
      changedFileCount: 0,
    }), Date.parse(STARTED) + TWELVE_MINUTES)
    expect(view?.tasks[0].failureReason).toContain('Provider attempt failed.')
    expect(view?.tasks[0].failureReason).toContain('0 files changed in isolated workspace — not verified, not applied')
    expect(JSON.stringify(view)).not.toContain('SECRET raw provider output')
  })

  it('renders the failure on the task row', () => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => { root?.render(React.createElement(TaskRow, { task: failedTask(), selected: true, onSelect: () => undefined })) })
    expect(host.textContent).toContain('Provider reached the absolute execution safety limit.')
  })

  it('warns only when the connected Host fingerprint differs', () => {
    const current = 'a'.repeat(64)
    const older = 'b'.repeat(64)
    expect(hostRestartRequired(current, current)).toBe(false)
    expect(hostRestartRequired(older, current)).toBe(true)
    expect(hostRestartRequired(null, current)).toBe(false)
    expect(hostRestartRequired(older, null)).toBe(false)
    const fleet = [{ providerId: 'claude', providerDisplayName: 'Claude' }, { sourceFingerprint: older }]
    expect(readHostSourceFingerprint(fleet)).toBe(older)
    const presence = computeHostPresence([{
      repo_key: 'abcdef0123456789',
      host_instance_id: 'host-1',
      status: 'connected',
      host_version: '0.1.0',
      providers: fleet,
      last_seen_at: new Date().toISOString(),
    }], Date.now())
    expect(presence.providerFleet.map((provider) => provider.providerId)).toEqual(['claude'])
    expect(presence.sourceFingerprint).toBe(older)
  })

  it('renders the restart warning and does not offer a restart control', () => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => { root?.render(React.createElement(HostRestartNotice, { required: true })) })
    expect(host.textContent).toContain(HOST_RESTART_REQUIRED_MESSAGE)
    expect(host.querySelector('button')).toBeNull()
    act(() => { root?.render(React.createElement(HostRestartNotice, { required: false })) })
    expect(host.textContent).toBe('')
  })
})
