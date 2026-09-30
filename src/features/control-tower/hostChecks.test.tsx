import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import TeamMode from '@/components/v15r/app-brain/control-tower/intelligence/TeamMode'
import { mapRunSnapshotRow } from './controlTowerAdapter'
import type { RunSnapshotRow } from './controlTowerService'

describe('Verifier Host check presentation', () => {
  it('maps the latest attempt and renders results, bounded output, and the trust warning', () => {
    const row = {
      run_id: 'run-1', repo_key: 'repo', objective: 'verify', status: 'failed',
      published_at: '2026-09-29T00:00:00Z', updated_at: '2026-09-29T00:00:00Z',
      snapshot: {
        schemaVersion: 1,
        run: { runId: 'run-1', title: 'Verify', objective: 'verify', status: 'failed', createdAt: '2026-09-29T00:00:00Z', updatedAt: '2026-09-29T00:00:00Z', startedAt: null, completedAt: null },
        tasks: [{ taskId: 'verify', clientTaskKey: 'verify', title: 'Verify', role: 'verifier', status: 'failed', position: 1, dependencies: [], plannedAreas: [], permissionProfile: 'verifier' }],
        attempts: [{ attemptId: 'a1', taskId: 'verify', ordinal: 1, status: 'failed', requestedModel: null, reportedModel: null, reportedModelSource: null, canonicalModified: true,
          hostChecks: [{ command: 'npm.cmd run typecheck', baselineExitCode: 0, candidateExitCode: 1, baselineTimedOut: false, candidateTimedOut: false, newFailureCount: 1, boundedOutput: 'candidate error' }] }],
        gate: null, changeset: null, verification: { verdict: 'fail', summary: 'Host detected a project change' },
        candidateApply: { eligible: false, reason: 'Your project was modified while checks were running — review before continuing.' },
      },
    } as RunSnapshotRow
    const run = mapRunSnapshotRow(row)
    expect(run?.tasks[0].canonicalModified).toBe(true)
    expect(run?.tasks[0].hostChecks?.[0].newFailureCount).toBe(1)
    const html = renderToStaticMarkup(createElement(TeamMode, { run: null, task: run!.tasks[0], nodeId: null, team: null, selectedRoleId: null, onSelectRole: () => undefined }))
    expect(html).toContain('npm.cmd run typecheck')
    expect(html).toContain('candidate error')
    expect(html).toContain('Your project was modified while checks were running')
    expect(html).toContain('the Host detects but cannot prevent writes')
  })
})
