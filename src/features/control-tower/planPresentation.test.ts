import { describe, expect, it } from 'vitest'
import type { PlanReviewModel } from './controlTowerAdapter'
import { elevatedChanges, formatArchitectElapsed, formatPlanningElapsed, planFactChips, planSummaryLines } from './planPresentation'
import { planningStatusLine } from './useControlTowerReal'

function plan(overrides: Partial<PlanReviewModel> = {}): PlanReviewModel {
  return {
    planId: 'plan-1',
    planHash: 'hash-1',
    objective: 'Reconcile the capacity planner.',
    constraints: [],
    riskSummary: 'The discovery budget can require Deep / Reconcile.',
    tasks: [
      {
        clientTaskKey: 't1',
        title: 'Reconcile capacity planner',
        goal: 'Keep the typed plan contract.',
        role: 'Implementer',
        dependencies: [],
        authorizedWritePaths: ['agent-host/control/capacity.ts'],
        plannedAreas: ['agent-host/control'],
        validationRequirements: ['capacity tests pass'],
        provider: 'claude',
        requestedModel: null,
      },
      {
        clientTaskKey: 't2',
        title: 'Verify capacity planner',
        goal: 'Check the contract.',
        role: 'Verifier',
        dependencies: ['t1'],
        authorizedWritePaths: [],
        plannedAreas: ['agent-host/control'],
        validationRequirements: ['read-only check'],
        provider: 'claude',
        requestedModel: null,
      },
    ],
    architect: null,
    ...overrides,
  }
}

describe('CT-LIVE-0B plan presentation', () => {
  it('builds a short summary, factual chips, and no elevated changes for an ordinary edit', () => {
    const summary = planSummaryLines(plan())
    expect(summary.length).toBeGreaterThanOrEqual(3)
    expect(summary.length).toBeLessThanOrEqual(5)
    expect(summary[0]).toContain('capacity planner')
    expect(planFactChips(plan())).toEqual([
      '2 tasks',
      '0 local migrations',
      'No dependency manifest changes',
      'No protected paths',
      'Verifier read-only',
    ])
    expect(elevatedChanges(plan())).toEqual([])
  })

  it('surfaces only real elevated changes', () => {
    const elevated = elevatedChanges(plan({
      tasks: [
        {
          clientTaskKey: 't1',
          title: 'Add migration',
          goal: 'Add a local migration and a dependency.',
          role: 'Implementer',
          dependencies: [],
          authorizedWritePaths: ['supabase/migrations/138_example.sql', 'package.json', 'src/store/authStore.ts', 'netlify.toml'],
          plannedAreas: ['supabase/migrations'],
          validationRequirements: [],
          provider: 'claude',
          requestedModel: null,
        },
      ],
      approval: { canApproveImplementation: false, requiresOwnerReview: true, requiresStaleAcknowledgment: false, reason: null },
    }))
    expect(elevated).toEqual([
      'Migration',
      'New dependency',
      'Protected-path touch',
      'Authentication/security change',
      'Remote mutation',
      'Owner decision required',
    ])
  })

  it('formats elapsed time without a percentage or an ETA', () => {
    expect(formatPlanningElapsed(18_000)).toBe('Planning · 18s')
    expect(formatPlanningElapsed(102_000)).toBe('Planning · 1m 42s')
    expect(formatArchitectElapsed(5_000)).toBe('Architect working · 5s')
    expect(formatPlanningElapsed(18_000).includes('%')).toBe(false)
    expect(planningStatusLine({ planningStatus: 'Using cached repo map' })).toBe('Using cached repo map')
    expect(planningStatusLine({ planningStatus: 'Found 6 candidate files' })).toBe('Found 6 candidate files')
    expect(planningStatusLine({ planningStatus: 'Inspecting 6 relevant files' })).toBe('Inspecting 6 relevant files')
    expect(planningStatusLine({ planningStatus: 'Plan format needs correction' })).toBe('Plan format needs correction')
    expect(planningStatusLine({ planningStatus: '50%' })).toBeNull()
    expect(planningStatusLine({ planningStatus: 'ETA 2 minutes' })).toBeNull()
  })
})
