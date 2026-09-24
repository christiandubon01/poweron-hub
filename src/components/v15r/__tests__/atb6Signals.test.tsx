// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it } from 'vitest'
import SignalsMode from '../app-brain/control-tower/intelligence/SignalsMode'
import { clusterSignals, filterSignals } from '@/features/control-tower/signalGrouping'
import { CONTROL_TOWER_SCENARIOS } from '../app-brain/control-tower/controlTowerPreview'
import type { SignalView } from '../app-brain/control-tower/controlTowerTypes'
import type { TowerSession } from '../app-brain/control-tower/sessionPresentation'

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); container = document.createElement('div'); document.body.append(container); root = createRoot(container) })
afterEach(() => { act(() => root.unmount()); container.remove() })

const base: TowerSession = { ...CONTROL_TOWER_SCENARIOS.working, runId: 'sig', publishedAt: '' }

it('groups by severity and defaults to open signals', () => {
  act(() => root.render(<SignalsMode run={base} onSelectRole={() => {}} onSelectNode={() => {}} />))
  expect(container.textContent).toContain('WARNING')
  expect(container.textContent).toContain('unplanned-area')
  expect(container.querySelector('[aria-selected="true"]')?.textContent).toBe('Open')
})

it('filters resolved vs open and surfaces ownerActionRequired', () => {
  const run: TowerSession = {
    ...base,
    signals: [
      ...(base.signals ?? []),
      { signalId: 'resolved', category: 'policy-gate', severity: 'notice', source: 'guard', taskId: null, attemptId: null, message: 'Resolved policy note', evidenceCount: 1, evidenceRefs: [], firstSeen: '2026-09-22T10:00:00Z', lastSeen: '2026-09-22T10:01:00Z', resolvedAt: '2026-09-22T10:02:00Z', ownerActionRequired: false },
      { signalId: 'owner', category: 'human-gate', severity: 'critical', source: 'guard', taskId: 't-edit', attemptId: null, message: 'Owner must decide', evidenceCount: 2, evidenceRefs: [], firstSeen: '2026-09-22T10:00:00Z', lastSeen: '2026-09-22T10:03:00Z', resolvedAt: null, ownerActionRequired: true },
    ],
  }
  act(() => root.render(<SignalsMode run={run} onSelectRole={() => {}} onSelectNode={() => {}} />))
  expect(container.textContent).toContain('Owner')
  act(() => { [...container.querySelectorAll('button')].find((item) => item.textContent === 'Resolved')!.click() })
  expect(container.textContent).toContain('Resolved policy note')
  expect(container.textContent).not.toContain('Owner must decide')
})

it('selects Guard when a signal row is clicked', () => {
  let role: string | null = null
  act(() => root.render(<SignalsMode run={base} onSelectRole={(next) => { role = next }} onSelectNode={() => {}} />))
  act(() => { container.querySelector<HTMLButtonElement>('.ct-signal-row')!.click() })
  expect(role).toBe('guard')
})

it('shows an empty state and aggregates duplicate visual storm', () => {
  act(() => root.render(<SignalsMode run={{ ...base, signals: [] }} onSelectRole={() => {}} onSelectNode={() => {}} />))
  expect(container.textContent).toContain('No open signals.')
  const dupes: SignalView[] = Array.from({ length: 6 }, (_, index) => ({
    signalId: `d-${index}`, category: 'unplanned-area', severity: 'warning', source: 'guard', taskId: 't-validate', attemptId: 'a',
    message: 'Same problem', evidenceCount: 1, evidenceRefs: [], firstSeen: '2026-09-22T10:00:00Z', lastSeen: '2026-09-22T10:41:00Z', resolvedAt: null, ownerActionRequired: false,
  }))
  expect(clusterSignals(dupes)).toHaveLength(1)
  expect(clusterSignals(dupes)[0].count).toBe(6)
  expect(filterSignals(dupes, 'resolved')).toHaveLength(0)
})
