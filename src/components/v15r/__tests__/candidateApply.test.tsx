// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import CandidateApplyPanel from '../app-brain/control-tower/CandidateApplyPanel'
import { mapRunSnapshotRow } from '@/features/control-tower/controlTowerAdapter'
import { applyProgressLabel, noticeFromApplyResult, ownerApplyFailure } from '@/features/control-tower/applyCandidateView'
import { assertApplyCandidatePayload } from '@/features/control-tower/controlTowerService'
import type { RunSnapshotRow } from '@/features/control-tower/controlTowerService'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => { root.unmount() })
  container.remove()
})

const changes = [
  { path: 'notes/modified.txt', kind: 'modify' as const },
  { path: 'notes/added.txt', kind: 'add' as const },
  { path: 'notes/removed.txt', kind: 'delete' as const },
]

async function render(node: React.ReactNode) {
  await act(async () => { root.render(node) })
}

describe('owner apply candidate', () => {
  it('shows review, the exact change list, and a confirmation that does not commit', async () => {
    await render(<CandidateApplyPanel changeCount={3} changes={changes} eligible reason={null} applied={false} busy={false} progress={null} notice={null} onApply={() => undefined} />)
    expect(container.textContent).toContain('Candidate verified')
    expect(container.textContent).toContain('3 changes')
    const review = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Review Candidate')
    expect(review).toBeTruthy()
    await act(async () => { review!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(container.textContent).toContain('Modified')
    expect(container.textContent).toContain('notes/modified.txt')
    expect(container.textContent).toContain('Added')
    expect(container.textContent).toContain('notes/added.txt')
    expect(container.textContent).toContain('Deleted')
    expect(container.textContent).toContain('notes/removed.txt')
    const apply = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Apply Candidate')
    await act(async () => { apply!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(container.textContent).toContain('Apply 3 verified candidate changes to the canonical working tree?')
    expect(container.textContent).toContain('This will NOT:')
    expect(container.textContent).toContain('commit')
    expect(container.textContent).toContain('push')
    expect(container.textContent).toContain('deploy')
    expect(container.textContent).toContain('run migrations')
  })

  it('submits once from the confirmation and shows host progress, conflict, and applied states', async () => {
    let calls = 0
    await render(<CandidateApplyPanel changeCount={1} changes={[changes[0]!]} eligible reason={null} applied={false} busy={false} progress={null} notice={null} onApply={() => { calls += 1 }} />)
    const open = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Apply Candidate')
    await act(async () => { open!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    const confirms = [...container.querySelectorAll('button')].filter((button) => button.textContent === 'Apply Candidate')
    const confirm = confirms[confirms.length - 1]
    await act(async () => {
      confirm!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      confirm!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(calls).toBe(1)

    await render(<CandidateApplyPanel changeCount={1} changes={[changes[0]!]} eligible reason={null} applied={false} busy progress="Checking canonical drift…" notice={null} onApply={() => undefined} />)
    expect(container.textContent).toContain('Checking canonical drift…')

    await render(<CandidateApplyPanel changeCount={1} changes={[changes[0]!]} eligible={false} reason={null} applied={false} busy={false} progress={null} notice={{ kind: 'conflict', message: 'Canonical conflict', paths: ['notes/modified.txt'], pathCount: null, rollback: null }} onApply={() => undefined} />)
    expect(container.textContent).toContain('Candidate not applied')
    expect(container.textContent).toContain('Canonical changed since this run')
    expect(container.textContent).toContain('notes/modified.txt')

    await render(<CandidateApplyPanel changeCount={1} changes={[changes[0]!]} eligible={false} reason={null} applied busy={false} progress={null} notice={null} onApply={() => undefined} />)
    expect(container.textContent).toContain('Candidate applied')
    expect(container.textContent).toContain('1 files applied to canonical working tree.')
    expect(container.textContent).toContain('Not committed')
    expect(container.textContent).toContain('Not pushed')
    expect(container.textContent).toContain('Not deployed')
    expect([...container.querySelectorAll('button')].some((button) => button.textContent === 'Apply Candidate')).toBe(false)

    await render(<CandidateApplyPanel changeCount={1} changes={[]} eligible={false} reason="Guard blocked candidate" applied={false} busy={false} progress={null} notice={null} onApply={() => undefined} />)
    expect(container.textContent).toContain('Guard blocked candidate')
    expect([...container.querySelectorAll('button')].some((button) => button.textContent === 'Apply Candidate')).toBe(false)

    await render(<CandidateApplyPanel changeCount={0} changes={[]} eligible={false} reason="No candidate changes to apply" applied={false} busy={false} progress={null} notice={null} onApply={() => undefined} />)
    expect(container.textContent).toContain('No candidate changes to apply')
  })

  it('maps host phases and safe failure reasons without accepting percentages', () => {
    expect(applyProgressLabel('Applying candidate')).toBe('Applying candidate…')
    expect(applyProgressLabel('Verifying applied files')).toBe('Verifying…')
    expect(applyProgressLabel('50%')).toBeNull()
    expect(ownerApplyFailure('Unsafe path')).toBe('Unsafe path')
    expect(ownerApplyFailure('stack C:\\secret\\file.ts')).toBe('Filesystem apply failed')
    expect(noticeFromApplyResult('failed', { phase: 'Conflict detected', conflictPaths: ['notes/a.txt'], rollback: 'PASS' }, 'Canonical conflict')?.kind).toBe('conflict')
    expect(noticeFromApplyResult('completed', { outcome: 'already-applied', pathCount: 2 }, null)?.message).toBe('Already applied')
  })

  it('rejects apply payloads that carry paths or candidate bytes', () => {
    expect(assertApplyCandidatePayload({ runId: 'run-1', attemptId: 'attempt-1' }).ok).toBe(true)
    expect(assertApplyCandidatePayload({ runId: 'run-1', attemptId: 'attempt-1', path: 'notes/a.txt' }).ok).toBe(false)
    expect(assertApplyCandidatePayload({ runId: '../x', attemptId: 'attempt-1' }).ok).toBe(false)
  })

  it('maps a verified snapshot into review fields and an applied snapshot into the applied state', () => {
    const row = (snapshot: Record<string, unknown>): RunSnapshotRow => ({
      run_id: 'run-1', repo_key: 'repo-key-1', objective: 'objective', status: 'completed', snapshot, published_at: '2026-09-25T00:00:00.000Z', updated_at: '2026-09-25T00:00:00.000Z',
    })
    const core = {
      schemaVersion: 1,
      run: { runId: 'run-1', title: 'run', objective: 'objective', status: 'completed', createdAt: '2026-09-25T00:00:00.000Z', updatedAt: '2026-09-25T00:00:01.000Z', startedAt: null, completedAt: '2026-09-25T00:00:02.000Z' },
      tasks: [{ taskId: 't-1', clientTaskKey: 'impl', title: 'Implement', role: 'implementer', status: 'passed', position: 0, dependencies: [], plannedAreas: [], permissionProfile: 'task-implementer' }],
      attempts: [],
      gate: null,
      changeset: { ready: true, changeCount: 1, safePaths: ['notes/modified.txt'] },
      verification: { verdict: 'pass', summary: 'VERDICT: PASS' },
    }
    const eligible = mapRunSnapshotRow(row({
      ...core,
      candidateApply: { eligible: true, reason: null, attemptId: 'attempt-1', changeCount: 1, changes: [{ path: 'notes/modified.txt', kind: 'modify' }], applied: false },
    }))
    expect(eligible?.candidateEligible).toBe(true)
    expect(eligible?.candidateChanges).toEqual([{ path: 'notes/modified.txt', kind: 'modify' }])
    expect(eligible?.changeset).toBe('not-applied')
    const applied = mapRunSnapshotRow(row({
      ...core,
      candidateApply: { eligible: false, reason: 'Already applied', attemptId: 'attempt-1', changeCount: 1, changes: [{ path: 'notes/modified.txt', kind: 'modify' }], applied: true, pathCount: 1 },
    }))
    expect(applied?.candidateApplied).toBe(true)
    expect(applied?.changeset).toBe('applied')
    expect(applied?.phase).toBe('Candidate applied')
  })
})
