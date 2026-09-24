// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import TowerWorkspace from '../app-brain/control-tower/TowerWorkspace'
import { CONTROL_TOWER_SCENARIOS } from '../app-brain/control-tower/controlTowerPreview'
import { mapRunSnapshotRow } from '@/features/control-tower/controlTowerAdapter'
import type { TowerSession } from '../app-brain/control-tower/sessionPresentation'

vi.mock('../V15rAppBrainScene', () => ({ default: (props: { activityNodeIds: string[]; failedNodeIds: string[] }) => <div data-testid="brain" data-active={props.activityNodeIds.join(',')} data-failed={props.failedNodeIds.join(',')} /> }))
let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); container = document.createElement('div'); document.body.append(container); root = createRoot(container) })
afterEach(() => { act(() => root.unmount()); container.remove() })
const base: TowerSession = { ...CONTROL_TOWER_SCENARIOS.working, provenance: 'Live', runId: 'test', publishedAt: '', tasks: CONTROL_TOWER_SCENARIOS.working.tasks.map(task => ({ ...task, plannedAreas: ['src/components/layout/AppShell.tsx'] })) }
function render(run: TowerSession, selectedTaskId: string | null = null) { act(() => root.render(<TowerWorkspace run={run} sessions={[run]} selectedTaskId={selectedTaskId} onSelectRun={() => {}} onSelectTask={() => {}} />)) }
it('drives mapped activity from the running task even when a passed task is inspected', () => {
  render(base, base.tasks[0].id)
  expect(container.querySelector('[data-testid="brain"]')?.getAttribute('data-active')).toBe('app-shell')
})
it.each(['completed', 'failed', 'cancelled', 'paused'] as const)('stops activity on %s even if a published task retains its running state', runState => {
  render({ ...base, runState })
  expect(container.querySelector('[data-testid="brain"]')?.getAttribute('data-active')).toBe('')
})
it('does not infer an architecture association from task title or owner scope', () => {
  render({ ...base, scope: 'App Shell', tasks: base.tasks.map(task => ({ ...task, title: 'App Shell work', plannedAreas: [] })) })
  expect(container.querySelector('[data-testid="brain"]')?.getAttribute('data-active')).toBe('')
})
it('does not paint every architecture node as failed for a repository-wide verification scope', () => {
  const task = { ...base.tasks[0], state: 'failed' as const, plannedAreas: ['src'] }
  render({ ...base, runState: 'failed', tasks: [task] })
  expect(container.querySelector('[data-testid="brain"]')?.getAttribute('data-failed')).toBe('')
})
it('maps only published timing and candidate metadata without inventing provider identity', () => {
  const view = mapRunSnapshotRow({ run_id: 'run', repo_key: 'repo', objective: 'Owner scope', status: 'completed', published_at: '', updated_at: '2026-09-22T12:00:00Z', snapshot: {
    run: { title: 'Published title', status: 'completed', startedAt: '2026-09-22T11:00:00Z', completedAt: '2026-09-22T12:00:00Z' },
    tasks: [{ taskId: 't', clientTaskKey: 't', title: 'Work', role: 'implementer', status: 'passed', dependencies: [], plannedAreas: [] }],
    attempts: [{ taskId: 't', ordinal: 1, status: 'passed', requestedModel: 'requested-model', reportedModel: null }],
    changeset: { ready: true, changeCount: 1, safePaths: ['src/example.ts'] },
  } })!
  expect(view.title).toBe('Published title')
  expect(view.attemptCount).toBe(1)
  expect(view.candidatePaths).toEqual(['src/example.ts'])
  expect(view.completedAt).toBe('2026-09-22T12:00:00Z')
  expect(view.tasks[0].reported).toEqual({ state: 'unreported' })
  expect(view.tasks[0].requested.provider).toBeUndefined()
})
