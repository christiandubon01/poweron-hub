// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import PlanReview from '../app-brain/control-tower/PlanReview'
import type { PlanReviewModel } from '@/features/control-tower/controlTowerAdapter'

const plan: PlanReviewModel = {
  planId: 'plan-1',
  planHash: 'abcdef1234567890',
  objective: 'Reconcile the capacity planner.',
  constraints: ['Do not change the plan contract.'],
  riskSummary: 'A bounded search can miss a file.',
  tasks: [
    {
      clientTaskKey: 't1',
      title: 'Reconcile capacity planner',
      goal: 'Keep the typed plan contract and the full task objective.',
      role: 'Implementer',
      dependencies: [],
      authorizedWritePaths: ['agent-host/control/capacity.ts'],
      plannedAreas: ['agent-host/control'],
      validationRequirements: ['capacity tests pass'],
      provider: 'claude',
      requestedModel: 'claude-opus-4-8',
    },
  ],
  architect: null,
  planningEvidence: { usedCache: true, candidateFiles: 1, inspectedFiles: ['agent-host/control/capacity.ts'] },
  planRevision: { version: 2, changes: ['tasks: REQUIREMENTS_INVALID'] },
}

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

describe('CT-LIVE-0B plan review', () => {
  it('keeps tasks, verification, and inspected files collapsed, with sticky actions and a revision note', () => {
    act(() => { root.render(<PlanReview plan={plan} busy={false} onApprove={() => {}} onEditScope={() => {}} onCancel={() => {}} />) })
    expect(container.textContent).toContain('No elevated changes')
    expect(container.textContent).toContain('Plan v2')
    expect(container.textContent).toContain('What changed')
    expect(container.textContent).toContain('tasks: REQUIREMENTS_INVALID')
    expect(container.textContent).toContain('Architect inspected 1 relevant file')
    const details = [...container.querySelectorAll('details')]
    expect(details.length).toBeGreaterThan(0)
    expect(details.every(item => item.open === false)).toBe(true)
    const task = container.querySelector('.ct-plan-task details')
    expect(task).not.toBeNull()
    act(() => { task!.querySelector('summary')!.click() })
    expect((task as HTMLDetailsElement).open).toBe(true)
    expect(container.textContent).toContain('Keep the typed plan contract and the full task objective.')
    expect(container.textContent).toContain('claude-opus-4-8')
    const actions = container.querySelector('.ct-plan-actions')
    expect(actions?.textContent).toContain('Approve Run')
    expect(actions?.textContent).toContain('Edit Scope')
    expect(actions?.textContent).toContain('Cancel')
    const css = readFileSync(path.join(process.cwd(), 'src/components/v15r/app-brain/control-tower/controlTower.css'), 'utf8')
    expect(css).toMatch(/\.ct-plan-actions\s*\{[^}]*position:\s*sticky/)
  })
})
