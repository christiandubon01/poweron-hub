// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { TaskRow } from '@/components/v15r/app-brain/control-tower/ControlTowerPrimitives'
import type { PreviewTask } from '@/components/v15r/app-brain/control-tower/controlTowerTypes'
import { computeHostPresence, mapRunSnapshotRow, readHostStatusMarker } from './controlTowerAdapter'
import HostRestartNotice, { HOST_RESTART_REQUIRED_MESSAGE } from './HostRestartNotice'
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

  it('reads restartRequired only from the Host presence marker, never by comparing fingerprints', () => {
    const fleet = [
      { providerId: 'claude', providerDisplayName: 'Claude Code' },
      {
        kind: 'host-status',
        sourceFingerprint: 'b'.repeat(64),
        restartRequired: true,
        restartDetectedAt: '2026-09-27T10:00:00.000Z',
        health: { state: 'healthy', consecutiveFailures: 0, lastFailureAt: null },
      },
    ]
    // The browser never computes staleness itself: the marker is the ONLY source.
    expect(readHostStatusMarker(fleet)).toEqual({
      restartRequired: true,
      restartDetectedAt: '2026-09-27T10:00:00.000Z',
      health: { state: 'healthy', consecutiveFailures: 0, lastFailureAt: null },
    })
    const presence = computeHostPresence([{
      repo_key: 'abcdef0123456789',
      host_instance_id: 'host-1',
      status: 'connected',
      host_version: '0.1.0',
      providers: fleet,
      last_seen_at: new Date().toISOString(),
    }], Date.now())
    expect(presence.restartRequired).toBe(true)
    expect(presence.restartDetectedAt).toBe('2026-09-27T10:00:00.000Z')
    expect(presence.hostHealth).toEqual({ state: 'healthy', consecutiveFailures: 0, lastFailureAt: null })
    // Amendment 6: the namespaced host-status marker NEVER renders as a provider.
    expect(presence.providerFleet.map((provider) => provider.providerId)).toEqual(['claude'])
    expect(presence.providers).toEqual(['Claude Code'])
  })

  it('shows healthy, delayed, degraded, and offline states honestly by heartbeat age and Host health', () => {
    const marker = (health: { state: string; consecutiveFailures: number; lastFailureAt: string | null }, restartRequired = false): unknown[] => [
      { providerId: 'claude', providerDisplayName: 'Claude Code' },
      { kind: 'host-status', restartRequired, restartDetectedAt: null, health },
    ]
    const presenceAt = (providers: unknown[], ageMs: number) => computeHostPresence([{
      repo_key: 'r', host_instance_id: 'h', status: 'connected', host_version: '0.1.0',
      providers, last_seen_at: new Date(Date.now() - ageMs).toISOString(),
    }], Date.now())
    expect(presenceAt(marker({ state: 'healthy', consecutiveFailures: 0, lastFailureAt: null }), 5_000).state).toBe('healthy')
    // Amendment 1: 20s-30s old heartbeat → "Host heartbeat delayed" (still usable).
    expect(presenceAt(marker({ state: 'healthy', consecutiveFailures: 0, lastFailureAt: null }), 25_000).state).toBe('delayed')
    // Offline at >= HOST_STALE_MS (30s) regardless of what the marker says.
    expect(presenceAt(marker({ state: 'healthy', consecutiveFailures: 0, lastFailureAt: null }), 40_000).state).toBe('offline')
    // Host-reported >= 3 consecutive control-plane failures → degraded.
    const degraded = presenceAt(marker({ state: 'degraded', consecutiveFailures: 4, lastFailureAt: '2026-09-27T10:00:00.000Z' }), 5_000)
    expect(degraded.state).toBe('degraded')
    expect(degraded.hostHealth?.state).toBe('degraded')
    expect(degraded.hostHealth?.consecutiveFailures).toBe(4)
    // No rows at all → offline, honestly.
    expect(computeHostPresence([], Date.now()).state).toBe('offline')
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
