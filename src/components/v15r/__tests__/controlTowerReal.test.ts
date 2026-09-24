// @vitest-environment happy-dom
/**
 * CT-CORE-1 §36: the required fake-backed Control Tower test cases.
 *
 * Every case here is fake-backed (no Supabase, no network, no provider calls,
 * no fixture fallback in the live surface). The real Supabase service module is
 * replaced by an injectable fake; the fixture preview is only ever reached
 * through the explicit Preview toggle.
 *
 * The two §36 cases that live at the Host boundary — "real binding delegates
 * through AttemptExecutor" and "snapshot excludes secrets" — are covered by
 * agent-host/control/control.test.ts (ProductionExecutionPort delegation and
 * the buildRunSnapshot whitelist), which runs under agent-host:test.
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ControlTowerReal from '../app-brain/control-tower/ControlTowerReal'
import { CONTROL_TOWER_PREVIEW as previewFixture } from '../app-brain/control-tower/controlTowerPreview'
import { computeHostPresence, mapRunSnapshotRow, matchNodesForPlannedAreas } from '@/features/control-tower/controlTowerAdapter'
import { useControlTowerReal, type ControlTowerServiceApi } from '@/features/control-tower/useControlTowerReal'
import type { AppBrainNode } from '../appBrainMap'
import type { ControlRequestRow, ControlTowerContext, HostPresenceRow, RunSnapshotRow } from '@/features/control-tower/controlTowerService'

vi.mock('../V15rAppBrainScene', () => ({
  default: (props: { staticPresentation?: boolean }) => React.createElement('div', { 'data-testid': 'scene', 'data-static': String(props.staticPresentation) }),
}))

/* Injectable fake service — the ONLY data source in these tests. */
const holder = vi.hoisted(() => ({ service: undefined as undefined | ControlTowerServiceApi }))
vi.mock('@/features/control-tower/controlTowerService', () => ({
  resolveControlTowerContext: () => holder.service!.resolveContext(),
  fetchHostPresenceRows: (organizationId: string) => holder.service!.fetchHostPresenceRows(organizationId),
  insertControlRequest: (input: Parameters<ControlTowerServiceApi['insertControlRequest']>[0]) => holder.service!.insertControlRequest(input),
  fetchControlRequest: (organizationId: string, clientRequestId: string) => holder.service!.fetchControlRequest(organizationId, clientRequestId),
  fetchRunSnapshotRows: (organizationId: string, limit?: number) => holder.service!.fetchRunSnapshotRows(organizationId, limit),
  fetchScopePackRows: (organizationId: string, repoKey: string) => holder.service!.fetchScopePackRows?.(organizationId, repoKey) ?? Promise.resolve([]),
}))

type FakeInsertInput = Parameters<ControlTowerServiceApi['insertControlRequest']>[0]

class FakeService implements ControlTowerServiceApi {
  context: ControlTowerContext = { userId: 'user-1', organizationId: 'org-1' }
  presenceRows: HostPresenceRow[] = []
  snapshots: RunSnapshotRow[] = []
  inserted: FakeInsertInput[] = []
  private requests = new Map<string, ControlRequestRow>()

  resolveContext(): Promise<ControlTowerContext> { return Promise.resolve(this.context) }
  fetchHostPresenceRows(): Promise<HostPresenceRow[]> { return Promise.resolve(this.presenceRows) }
  insertControlRequest(input: FakeInsertInput): Promise<ControlRequestRow> {
    this.inserted.push(input)
    const row: ControlRequestRow = {
      id: `row-${this.inserted.length}`,
      request_type: input.requestType,
      client_request_id: input.clientRequestId,
      repo_key: input.repoKey,
      status: 'pending',
      payload: input.payload,
      result: null,
      error: null,
      created_at: '2026-09-16T00:00:00Z',
    }
    this.requests.set(input.clientRequestId, row)
    return Promise.resolve(row)
  }
  fetchControlRequest(_organizationId: string, clientRequestId: string): Promise<ControlRequestRow | null> {
    return Promise.resolve(this.requests.get(clientRequestId) ?? null)
  }
  fetchRunSnapshotRows(): Promise<RunSnapshotRow[]> { return Promise.resolve(this.snapshots) }
  fetchScopePackRows(): Promise<[]> { return Promise.resolve([]) }

  /** Test seam: the local Host completes a claimed request and publishes its result. */
  completeRequest(clientRequestId: string, result: Record<string, unknown>): void {
    const row = this.requests.get(clientRequestId)
    if (!row) throw new Error(`No fake request ${clientRequestId}`)
    row.status = 'completed'
    row.result = result
  }
}

/* ── Render harness (same conventions as controlTower.test.ts) ─────────────── */
let container: HTMLDivElement
let root: Root
let fake: FakeService
beforeEach(() => {
  vi.useFakeTimers()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  fake = new FakeService()
  holder.service = fake
})
afterEach(() => { act(() => root.unmount()); container.remove(); holder.service = undefined; vi.useRealTimers() })
function render(element: React.ReactElement) { act(() => root.render(element)) }
function button(label: string) {
  const found = Array.from(container.querySelectorAll('button')).find(item => item.textContent === label)
  if (!found) throw new Error(`Missing button: ${label}`)
  return found
}
function click(element: HTMLElement) { act(() => element.click()) }
function setControlValue(element: HTMLTextAreaElement | HTMLInputElement, value: string) {
  act(() => {
    const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!
    setter.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function settle() { for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve() }) }
async function renderLive() {
  render(React.createElement(ControlTowerReal, { pollIntervalMs: 15 }))
  await settle()
}
async function waitForPoll() {
  await settle()
  await act(async () => { await vi.advanceTimersByTimeAsync(40) })
  await settle()
}

/* ── Fixtures: §29 whitelist wire data, mirrored from agent-host/control/types.ts ── */
const NOW = '2026-09-16T12:00:00.000Z'

function presenceRow(lastSeen: Date): HostPresenceRow {
  return { repo_key: 'repo-key-1', host_instance_id: 'host-1', status: 'online', host_version: '0.1.0', providers: ['claude'], last_seen_at: lastSeen.toISOString() }
}

function wireSnapshot(overrides?: {
  runId?: string
  runStatus?: string
  taskStatuses?: [string, string]
  verification?: { verdict: 'pass' | 'fail' | 'unknown'; summary: string | null } | null
  changeset?: { ready: boolean; changeCount: number; safePaths: string[] } | null
}): RunSnapshotRow {
  const [t1, t2] = overrides?.taskStatuses ?? ['running', 'pending']
  const runId = overrides?.runId ?? 'run-9'
  const runStatus = overrides?.runStatus ?? 'running'
  const snapshot = {
    schemaVersion: 1,
    run: { runId, title: 'Smoke marker run', objective: 'Create the smoke marker file', status: runStatus, createdAt: NOW, updatedAt: NOW, startedAt: NOW, completedAt: null },
    tasks: [
      { taskId: 'task-1', clientTaskKey: 'T1', title: 'Create marker file', role: 'implementer', status: t1, position: 1, dependencies: [], plannedAreas: ['agent-host/smoke'], permissionProfile: 'isolated-implementer' },
      { taskId: 'task-2', clientTaskKey: 'T2', title: 'Verify marker file', role: 'verifier', status: t2, position: 2, dependencies: ['T1'], plannedAreas: [], permissionProfile: 'read-only-verifier' },
    ],
    attempts: [{ attemptId: 'attempt-1', taskId: 'task-1', ordinal: 1, status: 'running', requestedModel: 'requested-model-x', reportedModel: null, reportedModelSource: null }],
    gate: null,
    changeset: overrides?.changeset ?? null,
    verification: overrides?.verification ?? null,
  }
  return { run_id: runId, repo_key: 'repo-key-1', objective: 'Create the smoke marker file', status: runStatus, snapshot, published_at: NOW, updated_at: NOW }
}

const PLAN_ID = 'plan-9f2a1b'
const PLAN_HASH = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2'
function planResult(): Record<string, unknown> {
  return {
    planId: PLAN_ID,
    planHash: PLAN_HASH,
    plan: {
      objective: 'Create the smoke marker file with exact contents',
      constraints: ['Do not modify any other file'],
      riskSummary: 'Single file in the isolated workspace.',
      tasks: [
        { clientTaskKey: 'T1', title: 'Create marker file', goal: 'Write the file with the exact required contents', role: 'implementer', dependencies: [], authorizedWritePaths: ['agent-host/smoke/control-tower-ui-e2e.txt'], plannedAreas: ['agent-host/smoke'], validationRequirements: [], provider: 'claude', requestedModel: 'requested-model-x' },
        { clientTaskKey: 'T2', title: 'Verify marker file', goal: 'Check the file contents match exactly', role: 'verifier', dependencies: ['T1'], authorizedWritePaths: [], plannedAreas: ['agent-host/smoke'], validationRequirements: ['exact contents match'], provider: 'claude', requestedModel: 'requested-model-x' },
      ],
    },
    architect: { provider: 'claude', requestedModel: 'requested-model-x', reportedModel: 'reported-real-model', reportedModelSource: 'provider' },
  }
}

/** Walk the full lifecycle through the real UI: compose → plan → review. Returns the create_plan request. */
async function driveToPlanReview(): Promise<FakeInsertInput> {
  fake.presenceRows = [presenceRow(new Date())]
  await renderLive()
  click(button('New Run'))
  setControlValue(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Owner scope"]')!, 'Create the smoke marker file')
  setControlValue(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Owner constraints"]')!, 'Do not modify any other file.')
  click(button('Request plan'))
  await settle()
  const request = fake.inserted[0]
  fake.completeRequest(request.clientRequestId, planResult())
  await waitForPoll()
  return request
}

/* ── §36 1: fresh / stale / unavailable Host ──────────────────────────────── */
describe('CT-CORE-1 host presence honesty', () => {
  it('reports fresh, stale, and unavailable Hosts honestly from presence rows', () => {
    const now = 1_000_000_000_000
    const fresh = computeHostPresence([presenceRow(new Date(now - 5_000))], now)
    expect(fresh.state).toBe('connected')
    expect(fresh.repoKey).toBe('repo-key-1')
    expect(fresh.providers).toEqual(['claude'])
    const stale = computeHostPresence([presenceRow(new Date(now - 60_000))], now)
    expect(stale.state).toBe('stale')
    const unavailable = computeHostPresence([], now)
    expect(unavailable.state).toBe('unavailable')
    expect(unavailable.repoKey).toBeNull()
  })
})

/* ── Restart bug: multiple presence rows for one org+repo (newest-wins) ────── */
describe('CT-CORE-1 host presence — multiple rows after Host restart', () => {
  const NOW_MS = Date.parse('2026-09-16T20:35:00.000Z')
  const presenceAt = (opts: { repo?: string; instance?: string; ageMs: number }): HostPresenceRow => ({
    repo_key: opts.repo ?? 'repo-key-1',
    host_instance_id: opts.instance ?? 'host-1',
    status: 'connected',
    host_version: '0.1.0',
    providers: ['claude'],
    last_seen_at: new Date(NOW_MS - opts.ageMs).toISOString(),
  })

  it('1) an old stale Host row + a newer fresh Host row => CONNECTED (fresh wins, either order)', () => {
    // Each restart writes a new host_instance_id row; the old row never updates again.
    const staleOld = presenceAt({ instance: 'OLD', ageMs: 90_000 })
    const freshNew = presenceAt({ instance: 'NEW', ageMs: 4_000 })
    for (const rows of [[staleOld, freshNew], [freshNew, staleOld]]) {
      const view = computeHostPresence(rows, NOW_MS)
      expect(view.state).toBe('connected')
      expect(view.hostInstanceId).toBe('NEW')
      expect(view.lastSeenAt).toBe(freshNew.last_seen_at)
    }
  })

  it('2) several stale rows and no fresh row => STALE (an old row can never report CONNECTED)', () => {
    const rows = [
      presenceAt({ instance: 'A', ageMs: 60_000 }),
      presenceAt({ instance: 'B', ageMs: 120_000 }),
      presenceAt({ instance: 'C', ageMs: 45_000 }),
    ]
    const view = computeHostPresence(rows, NOW_MS)
    expect(view.state).toBe('stale')
    expect(view.hostInstanceId).toBe('C') // still the newest of the stale rows
  })

  it('3) the newest Host row itself becoming stale flips the derived state to STALE', () => {
    expect(computeHostPresence([presenceAt({ instance: 'A', ageMs: 40_000 }), presenceAt({ instance: 'B', ageMs: 5_000 })], NOW_MS).state).toBe('connected')
    expect(computeHostPresence([presenceAt({ instance: 'A', ageMs: 40_000 }), presenceAt({ instance: 'B', ageMs: 31_000 })], NOW_MS).state).toBe('stale')
  })

  it('4) org/repo isolation: repo context follows the FRESHEST host, and the query is organization-scoped', () => {
    // The query returns only this org's rows; across repo_keys the freshest wins,
    // so a stale other-repo row never sets the repo context or masks a live Host.
    const rows = [
      presenceAt({ repo: 'repo-STALE', instance: 'S', ageMs: 90_000 }),
      presenceAt({ repo: 'repo-FRESH', instance: 'F', ageMs: 3_000 }),
    ]
    const view = computeHostPresence(rows, NOW_MS)
    expect(view.state).toBe('connected')
    expect(view.repoKey).toBe('repo-FRESH')

    // The live presence read filters strictly by organization_id (RLS + explicit eq).
    const serviceSrc = readFileSync('src/features/control-tower/controlTowerService.ts', 'utf8')
    const fnSrc = serviceSrc.slice(serviceSrc.indexOf('export async function fetchHostPresenceRows'))
    expect(fnSrc).toMatch(/\.eq\('organization_id', organizationId\)/)
  })

  it('a fresh, newest heartbeat AT or just AHEAD of the reader clock stays CONNECTED (skew-guard regression)', () => {
    // Regression for the ageMs >= 0 guard: a live heartbeat must never read as stale
    // merely because its timestamp is at/ahead of the browser clock (forward skew).
    expect(computeHostPresence([presenceAt({ instance: 'N', ageMs: 0 })], NOW_MS).state).toBe('connected')
    expect(computeHostPresence([presenceAt({ instance: 'N', ageMs: -5_000 })], NOW_MS).state).toBe('connected')
    // A genuinely fresh newer row still wins over an older stale row under skew.
    const rows = [presenceAt({ instance: 'OLD', ageMs: 120_000 }), presenceAt({ instance: 'NEW', ageMs: -2_000 })]
    const view = computeHostPresence(rows, NOW_MS)
    expect(view.state).toBe('connected')
    expect(view.hostInstanceId).toBe('NEW')
  })

  it('ignores an unparseable last_seen_at instead of reporting STALE from it', () => {
    const bad = { repo_key: 'repo-key-1', host_instance_id: 'BAD', status: 'connected', host_version: '0.1.0', providers: ['claude'], last_seen_at: 'not-a-date' } as HostPresenceRow
    const good = presenceAt({ instance: 'GOOD', ageMs: 4_000 })
    const view = computeHostPresence([bad, good], NOW_MS)
    expect(view.state).toBe('connected')
    expect(view.hostInstanceId).toBe('GOOD')
    // All-invalid rows are honestly unavailable, never a fabricated connected/stale.
    expect(computeHostPresence([bad], NOW_MS).state).toBe('unavailable')
  })
})

/* ── §36 2-5: composer, scope capture, typed request, no fake plan ───────── */
describe('CT-CORE-1 new run composer', () => {
  it('opens the composer from the live shell with the Host repository read-only', async () => {
    fake.presenceRows = [presenceRow(new Date())]
    await renderLive()
    click(button('New Run'))
    expect(container.querySelector('.ct-composer')).not.toBeNull()
    expect(container.querySelector('textarea[aria-label="Owner scope"]')).not.toBeNull()
    expect(container.textContent).toContain('repo-key-1')
    expect(container.textContent).toContain('Set by the local Host. You cannot choose a different repository here.')
  })

  it('captures the owner scope and constraints exactly as entered (trimmed, one per line)', async () => {
    fake.presenceRows = [presenceRow(new Date())]
    await renderLive()
    click(button('New Run'))
    setControlValue(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Owner scope"]')!, '  Create the smoke marker file  ')
    setControlValue(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Owner constraints"]')!, 'Do not modify any other file.\nDo not commit or push.')
    click(button('Request plan'))
  await settle()
    expect(fake.inserted).toHaveLength(1)
    expect(fake.inserted[0].payload).toEqual({
      scope: 'Create the smoke marker file',
      constraints: ['Do not modify any other file.', 'Do not commit or push.'],
    })
  })

  it('submits a typed create_plan request with the Host repo key and org context', async () => {
    fake.presenceRows = [presenceRow(new Date())]
    await renderLive()
    click(button('New Run'))
    setControlValue(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Owner scope"]')!, 'Create the smoke marker file')
    click(button('Request plan'))
  await settle()
    expect(fake.inserted).toHaveLength(1)
    const request = fake.inserted[0]
    expect(request.requestType).toBe('create_plan')
    expect(request.organizationId).toBe('org-1')
    expect(request.repoKey).toBe('repo-key-1')
    expect(typeof request.clientRequestId).toBe('string')
    expect(request.clientRequestId.length).toBeGreaterThan(0)
  })

  it('prevents any plan request when no Host is connected — no fake plan, no stale plan', async () => {
    await renderLive() // no presence rows: unavailable
    expect(button('New Run').disabled).toBe(true)
    expect(container.querySelector('.ct-composer')).toBeNull()
    expect(container.textContent).toContain('No local Host is connected for this repository')
    fake.presenceRows = [presenceRow(new Date(Date.now() - 60_000))] // stale heartbeat
    await waitForPoll()
    expect(button('New Run').disabled).toBe(true)
    expect(fake.inserted).toHaveLength(0)
  })
})

/* ── §36 6-9: plan review, no execution before approval, exact approval ──── */
describe('CT-CORE-1 plan review and approval', () => {
  it('renders the completed real Architect plan for review with honest model truth', async () => {
    await driveToPlanReview()
    expect(container.querySelector('.ct-plan-review')).not.toBeNull()
    expect(container.textContent).toContain('Nothing has executed yet')
    expect(container.textContent).toContain('Create the smoke marker file with exact contents')
    expect(container.textContent).toContain(`Plan · ${PLAN_ID}`)
    expect(container.textContent).toContain('reported-real-model')
    expect(container.textContent).toContain('Requested configuration is never reported as the model used.')
    expect(container.textContent).toContain('Read-only — no writes') // verifier has no write paths
    expect(container.textContent).toContain('agent-host/smoke/control-tower-ui-e2e.txt') // implementer authorized path
  })

  it('executes nothing before the owner approves — no run, no second request', async () => {
    await driveToPlanReview()
    expect(fake.inserted.map(request => request.requestType)).toEqual(['create_plan'])
    expect(container.querySelector('.ct-run')).toBeNull()
    expect(container.textContent).toContain('Nothing has executed yet')
    expect(container.textContent).not.toContain('Run starting')
  })

  it('approves the exact plan by planId and planHash', async () => {
    await driveToPlanReview()
    click(button('Approve Run'))
    expect(fake.inserted).toHaveLength(2)
    const approval = fake.inserted[1]
    expect(approval.requestType).toBe('approve_plan')
    expect(approval.payload).toEqual({ planId: PLAN_ID, planHash: PLAN_HASH })
    expect(approval.repoKey).toBe('repo-key-1')
    await settle()
    expect(container.textContent).toContain('Run starting')
  })

  it('shows the Run only after the approved plan starts it via the Host', async () => {
    await driveToPlanReview()
    click(button('Approve Run'))
    const approval = fake.inserted[1]
    await settle()
    expect(container.querySelector('.ct-run')).toBeNull() // approving — not started yet
    fake.completeRequest(approval.clientRequestId, { runId: 'run-9' })
    await waitForPoll()
    expect(container.querySelector('.ct-run')).toBeNull() // Host created the Run, but no snapshot yet — nothing to show
    fake.snapshots = [wireSnapshot({ runId: 'run-9' })]
    await waitForPoll()
    expect(container.querySelector('.ct-run')).not.toBeNull()
    expect(container.querySelector('.ct-run h2')?.textContent).toContain('Smoke marker run')
  })
})

/* ── §36 10 + 12: snapshot mapping, dependencies, and secret exclusion ───── */
describe('CT-CORE-1 run snapshot mapping', () => {
  it('maps the published tasks and their dependencies without fabrication', () => {
    const view = mapRunSnapshotRow(wireSnapshot())!
    expect(view).not.toBeNull()
    expect(view.tasks.map(task => [task.id, task.role, task.state])).toEqual([
      ['T1', 'Implementer', 'running'],
      ['T2', 'Verifier', 'pending-waiting'],
    ])
    expect(view.tasks[1].dependencies).toBe('T1')
    expect(view.currentRole).toBe('Implementer')
    expect(view.verification).toBe('not-started') // verifier is still waiting, not active
    expect(view.changeset).toBe('none')
    expect(view.runState).toBe('running')
  })

  it('renders the real task rail with the implementer → verifier dependency', async () => {
    fake.presenceRows = [presenceRow(new Date())]
    fake.snapshots = [wireSnapshot()]
    await renderLive()
    click(container.querySelector<HTMLButtonElement>('.ct-session-expand')!)
    const rows = container.querySelectorAll('.ct-session-task-list button')
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('Create marker file')
    expect(rows[1].textContent).toContain('Verify marker file')
    expect(container.querySelector('.ct-stage-progress')?.textContent).toContain('Implementer→Verifier')
    click(rows[1] as HTMLElement)
    const inspector = container.querySelector('.ct-inspector')!
    expect(inspector.textContent).toContain('T1') // verifier depends on T1
    expect(inspector.textContent).toContain('Requested configuration is never reported as the model used.')
  })

  it('never surfaces prompt or secret fields from the snapshot payload', () => {
    const row = wireSnapshot()
    row.snapshot = { ...row.snapshot, prompt: 'SECRET PROMPT TEXT', stderr: 'secret provider tail' }
    const view = mapRunSnapshotRow(row)!
    expect(JSON.stringify(view)).not.toContain('SECRET PROMPT TEXT')
    expect(JSON.stringify(view)).not.toContain('secret provider tail')
  })
})

/* ── §36 16-17: fail-closed repo key, completed ≠ applied ─────────────────── */
describe('CT-CORE-1 fail-closed and completion truth', () => {
  it('fails closed when the repo key is unknown — no request is inserted', async () => {
    render(React.createElement(HookHarness, { pollIntervalMs: 0 }))
    await settle()
    expect(latest!.presence.state).toBe('unavailable')
    expect(latest!.presence.repoKey).toBeNull()
    await act(async () => {
      await expect(latest!.submitScope({ scope: 'Create the smoke marker file', constraints: [], requestedRouting: null })).rejects.toThrow('No connected Host repository.')
    })
    await act(async () => {
      await expect(latest!.approvePlan()).rejects.toThrow('No plan to approve.')
    })
    expect(fake.inserted).toHaveLength(0)
  })

  it('keeps Run completed and Changes not applied distinct — completion never implies applied', async () => {
    const view = mapRunSnapshotRow(wireSnapshot({
      runStatus: 'completed',
      taskStatuses: ['passed', 'passed'],
      verification: { verdict: 'pass', summary: 'Marker file matches exactly.' },
      changeset: { ready: true, changeCount: 1, safePaths: ['agent-host/smoke/control-tower-ui-e2e.txt'] },
    }))!
    expect(view.runState).toBe('completed')
    expect(view.verification).toBe('passed')
    expect(view.changeset).toBe('not-applied')
    expect(view.phase).toContain('Run completed')
    expect(view.phase).toContain('changes not applied')

    fake.presenceRows = [presenceRow(new Date())]
    fake.snapshots = [wireSnapshot({
      runStatus: 'completed',
      taskStatuses: ['passed', 'passed'],
      verification: { verdict: 'pass', summary: 'Marker file matches exactly.' },
      changeset: { ready: true, changeCount: 1, safePaths: ['agent-host/smoke/control-tower-ui-e2e.txt'] },
    })]
    await renderLive()
    expect(container.querySelector('.ct-run-state-completed')).not.toBeNull()
    expect(container.textContent).toContain('Run completed')
    expect(container.textContent).toContain('Changes not applied')
    expect(container.querySelector('.ct-command')?.textContent).toContain('Changes not applied')
    expect(container.textContent).toContain('2/2 tasks passed')
  })
})

/* ── §36 13-14 + 18: no fixture fallback, preview still works, live map ───── */
describe('CT-CORE-1 live surface truth', () => {
  it('never falls back to the fixture preview in live mode', async () => {
    await renderLive()
    expect(container.querySelector('[aria-label="Control Tower"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="Control Tower preview"]')).toBeNull()
    expect(container.textContent).not.toContain(previewFixture.tasks[0].title)
    expect(container.textContent).not.toContain(previewFixture.objective)
    expect(container.textContent).toContain('No local Host is connected for this repository')
  })

  it('keeps the fixture preview working as an explicit, clearly-labeled Preview', async () => {
    await renderLive()
    click(button('Preview'))
    expect(container.querySelector('[aria-label="Control Tower preview"]')).not.toBeNull()
    expect(container.textContent).toContain('Preview · demo data')
    click(button('Live'))
    expect(container.querySelector('[aria-label="Control Tower preview"]')).toBeNull()
    expect(container.querySelector('[aria-label="Control Tower"]')).not.toBeNull()
  })

  it('keeps the App Brain scene animated and honest in live mode (map regression, §31-§32)', async () => {
    fake.presenceRows = [presenceRow(new Date())]
    fake.snapshots = [wireSnapshot()]
    await renderLive()
    expect(container.querySelector('[data-testid="scene"]')?.getAttribute('data-static')).toBe('false') // live keeps orbit/animation
    expect(container.textContent).toContain('Host connected')
    click(container.querySelector<HTMLButtonElement>('.ct-session-expand')!)
    click(container.querySelectorAll('.ct-session-task-list button')[0] as HTMLElement) // T1 carries real planned areas
    expect(container.querySelector('.ct-map-bottom')?.textContent).toContain('planned areas') // honest association note
    click(button('Preview'))
    expect(container.querySelector('[data-testid="scene"]')?.getAttribute('data-static')).toBe('false') // Preview uses the same orbit interaction; fixture activity is explicitly labelled
  })

  it('matches map nodes only from real planned areas (§31 — no fake association)', () => {
    const nodes: AppBrainNode[] = [
      { id: 'node-a', label: 'A', relatedFiles: ['agent-host/smoke/marker.ts'] },
      { id: 'node-b', label: 'B', relatedFiles: ['src/lib/supabase.ts'] },
    ] as AppBrainNode[]
    expect(matchNodesForPlannedAreas(nodes, ['agent-host/smoke'])).toEqual(['node-a'])
    expect(matchNodesForPlannedAreas(nodes, ['docs/unmapped'])).toEqual([])
    expect(matchNodesForPlannedAreas(nodes, [])).toEqual([])
  })
})

/* ── Hook harness for fail-closed service-guard cases (§36 16) ────────────── */
let latest: ReturnType<typeof useControlTowerReal> | null = null
function HookHarness({ pollIntervalMs }: { pollIntervalMs?: number }) {
  latest = useControlTowerReal({ service: fake, pollIntervalMs })
  return null
}
