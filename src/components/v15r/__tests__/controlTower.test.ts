// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import V15rAppBrainTab from '../V15rAppBrainTab'
import ControlTower from '../app-brain/control-tower/ControlTower'
import { sessionDuration } from '../app-brain/control-tower/sessionPresentation'
import { CONTROL_TOWER_SCENARIOS } from '../app-brain/control-tower/controlTowerPreview'
import { AttentionItem, ChangesetSummary, ConnectionFreshness, EvidenceProvenance, ProviderModelBadge, RetryIndicator, RoleBadge, RunStatus, TaskRow, VerifierState } from '../app-brain/control-tower/ControlTowerPrimitives'
import { CONTROL_TOWER_PREVIEW as preview } from '../app-brain/control-tower/controlTowerPreview'
import type { AttentionKind, EvidenceKind, Freshness, RunState, TaskState } from '../app-brain/control-tower/controlTowerTypes'

vi.mock('../V15rAppBrainScene', () => ({ default: () => React.createElement('div', { 'data-testid': 'existing-scene' }, 'Architecture scene') }))
/* CT-CORE-1: the live Control Tower hangs its polls on a never-resolving fake
 * service — the preview-only tests below never observe live state changes. */
vi.mock('@/features/control-tower/controlTowerService', () => ({
  resolveControlTowerContext: () => new Promise(() => {}),
  fetchHostPresenceRows: () => new Promise(() => {}),
  insertControlRequest: () => new Promise(() => {}),
  fetchControlRequest: () => new Promise(() => {}),
  fetchRunSnapshotRows: () => new Promise(() => {}),
  fetchScopePackRows: () => new Promise(() => {}),
}))
let container: HTMLDivElement
let root: Root
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove() })
function render(element: React.ReactElement) { act(() => root.render(element)) }
function button(label: string) {
  const found = Array.from(container.querySelectorAll('button')).find(item => item.textContent === label)
  if (!found) throw new Error(`Missing button: ${label}`)
  return found
}
function click(element: HTMLElement) { act(() => element.click()) }
function scenario(value: string) {
 const select=container.querySelector<HTMLSelectElement>('[aria-label="Preview snapshot"]')!
 act(()=>{select.value=`preview-${value}`;select.dispatchEvent(new Event('change',{bubbles:true}))})
}

describe('Control Tower destinations', () => {
  it('opens Control Tower by default and preserves Architecture state across switches', () => {
    render(React.createElement(V15rAppBrainTab))
    const architecture = container.querySelector<HTMLElement>('[data-destination="architecture"]')!
    expect(architecture.hidden).toBe(true)
    click(button('Architecture'))
    for (const label of ['Architecture Map', 'Import Graph', 'Active Work']) expect(architecture.textContent).toContain(label)
    const scene = architecture.querySelector('[data-testid="existing-scene"]')
    const input = architecture.querySelector('input')!
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, 'blueprint')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    click(button('Import Graph'))
    const importGraphStyle = button('Import Graph').getAttribute('style')
    click(button('Control Tower'))
    expect(architecture.hidden).toBe(true)
    expect(container.querySelector('[aria-label="Control Tower"]')).not.toBeNull() // CT-CORE-1: live shell by default
    click(button('Preview'))
    expect(container.querySelector('[aria-label="Control Tower preview"]')).not.toBeNull() // preview stays available, explicitly
    click(button('Architecture'))
    expect(architecture.hidden).toBe(false)
    expect(architecture.querySelector('[data-testid="existing-scene"]')).toBe(scene)
    expect(architecture.querySelector('input')).toBe(input)
    expect(input.value).toBe('blueprint')
    expect(button('Import Graph').getAttribute('style')).toBe(importGraphStyle)
  })
})

describe('durable states and truth boundaries', () => {
  it.each<RunState>(['pending', 'running', 'paused', 'completed', 'failed', 'cancelled'])('renders Run %s with text and icon', state => {
    render(React.createElement(RunStatus, { state }))
    expect(container.textContent).toBe(`Run ${state}`)
    expect(container.querySelector('svg')).not.toBeNull()
  })
  it.each<TaskState>(['pending-ready', 'pending-waiting', 'running', 'passed', 'blocked', 'failed', 'cancelled'])('renders task %s distinctly and can select it', state => {
    const onSelect = vi.fn()
    render(React.createElement(TaskRow, { task: { ...preview.tasks[0], state }, selected: true, onSelect }))
    expect(container.textContent?.toLowerCase()).toContain(state.replace('-', ' · '))
    expect(container.querySelector('button')?.getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector('svg')).not.toBeNull()
    click(container.querySelector('button')!)
    expect(onSelect).toHaveBeenCalledOnce()
  })
  it('does not fill missing reported model from requested configuration', () => {
    render(React.createElement(React.Fragment, null,
      React.createElement(ProviderModelBadge, { identity: { state: 'requested', provider: 'OpenAI', model: 'requested-example' } }),
      React.createElement(ProviderModelBadge, { identity: { state: 'reported', provider: 'OpenAI' } }),
      React.createElement(ProviderModelBadge, { identity: { state: 'unreported', model: 'must-not-leak' } }),
      React.createElement(ProviderModelBadge, { identity: { state: 'unavailable' } })))
    expect(container.textContent).toContain('Reported · Provider: OpenAI · Model: unreported')
    expect(container.textContent).toContain('Model unreported')
    expect(container.textContent).toContain('Model unavailable')
    expect(container.textContent).not.toContain('must-not-leak')
  })
  it('represents completed Run and unapplied changes independently', () => {
    render(React.createElement(React.Fragment, null, React.createElement(RunStatus, { state: 'completed' }), React.createElement(ChangesetSummary, { state: 'not-applied' })))
    expect(container.textContent).toContain('Run completed')
    expect(container.textContent).toContain('Changes not applied')
  })
  it.each<EvidenceKind>(['Planned scope', 'Task active in area', 'Reported activity', 'Confirmed changed files', 'Verifier activity'])('labels evidence %s with source and freshness', kind => {
    render(React.createElement(EvidenceProvenance, { kind, source: 'Preview fixture', freshness: 'Snapshot' }))
    expect(container.textContent).toContain(kind)
    expect(container.textContent).toContain('Snapshot')
    expect(container.textContent).toContain('Preview fixture')
  })
  it.each<Freshness>(['Snapshot', 'Last reported', 'Current feed', 'Stale', 'Unavailable'])('supports freshness %s', freshness => {
    render(React.createElement(ConnectionFreshness, { freshness }))
    expect(container.textContent).toBe(freshness)
  })
  it.each<AttentionKind>(['gate', 'plan-review', 'exhausted', 'verifier-rejected', 'review-available'])('supports attention %s as an inspectable preview', kind => {
    const onInspect = vi.fn()
    render(React.createElement(AttentionItem, { item: { id: kind, kind, title: 'Inspect boundary', consequence: 'Work cannot continue.' }, onInspect }))
    expect(container.textContent).toContain('Preview')
    click(button(kind === 'gate' ? 'Inspect proposed change' : 'Inspect'))
    expect(onInspect).toHaveBeenCalledOnce()
  })
  it('separates scheduled retry from active Attempt and labels verifier responsibility', () => {
    render(React.createElement(React.Fragment, null,
      React.createElement(RetryIndicator, { state: 'scheduled' }), React.createElement(RetryIndicator, { state: 'attempt-active' }),
      React.createElement(RoleBadge, { role: 'Verifier' }), React.createElement(VerifierState, { state: 'active' })))
    expect(container.textContent).toContain('Retry scheduled · no active Attempt')
    expect(container.textContent).toContain('Attempt active')
    expect(container.textContent).toContain('Verifier · Active')
  })
})

describe('final operations console', () => {
  it('uses one session history for independent completed and failed filters', () => {
    render(React.createElement(ControlTower))
    const filters = container.querySelector('.ct-history-filters')!
    const filter = (label: string) => click([...filters.querySelectorAll('button')].find(el => el.textContent?.startsWith(label))!)
    filter('Completed Runs')
    expect(container.querySelectorAll('.ct-session')).toHaveLength(1)
    expect(container.querySelector('.ct-session')?.textContent).toContain('Run completed')
    filter('Failed Runs')
    expect(container.querySelectorAll('.ct-session')).toHaveLength(1)
    expect(container.querySelector('.ct-session')?.textContent).toContain('approval boundary check did not pass')
    click(container.querySelector<HTMLButtonElement>('.ct-session-select')!)
    expect(container.querySelector('.ct-command')?.textContent).toContain('Run failed')
    expect(container.querySelector('.ct-command')?.textContent).toContain('Invoice validation review')
  })
  it('opens tasks inside a session and returns from context to intelligence', () => {
    render(React.createElement(ControlTower))
    click(container.querySelector<HTMLButtonElement>('.ct-session-expand')!)
    const rows = container.querySelectorAll<HTMLButtonElement>('.ct-session-task-list button')
    expect(rows).toHaveLength(4)
    click(rows[2])
    expect(container.querySelector('.ct-intelligence')?.textContent).toContain('Protect approval behavior')
    expect(container.querySelector('.ct-intelligence')?.textContent).toContain('T2 · Add draft editing')
    click(button('Intelligence'))
    expect(container.querySelector('.ct-intelligence h2')?.textContent).toBe('Intelligence')
  })
  it('keeps preview explicit, usage unavailable, and execution controls absent', () => {
    render(React.createElement(ControlTower))
    expect(container.textContent).toContain('Preview · demo data')
    click(button('MODELS'))
    click(container.querySelector<HTMLButtonElement>('[data-provider="claude"] button')!)
    expect(container.textContent).toContain('Not exposed by provider CLI')
    expect(container.textContent).toContain('CLI does not enumerate available models')
    expect(container.textContent).not.toContain('No model published')
    expect(container.textContent).not.toContain('Time until reset')
    expect(container.querySelectorAll('progress')).toHaveLength(0)
    expect([...container.querySelectorAll('button')].some(el => /Approve|Cancel Run|New Run/.test(el.textContent ?? ''))).toBe(false)
  })
  it('settles completed and failed states without claiming active execution', () => {
    render(React.createElement(ControlTower))
    scenario('completed')
    expect(container.querySelector('.ct-command')?.textContent).toContain('4/4 tasks passed')
    expect(container.querySelector('.ct-command')?.textContent).toContain('Changes not applied')
    expect(container.querySelector('.ct-map-toolbar')?.textContent).toContain('Completed · at rest')
    expect(container.querySelector('.ct-intelligence')?.textContent).toContain('No active execution')
    scenario('failed')
    expect(container.querySelector('.ct-command')?.textContent).toContain('Run failed')
    expect(container.querySelector('.ct-map-toolbar')?.textContent).toContain('Run failed · at rest')
  })
  it('selects architecture nodes through the keyboard-accessible area control', () => {
    render(React.createElement(ControlTower))
    const select = container.querySelector<HTMLSelectElement>('[aria-label="Architecture area"]')!
    act(() => { select.value = 'app-shell'; select.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(container.querySelector('.ct-intelligence h2')?.textContent).toBe('Architecture detail')
    expect(container.querySelector('.ct-intelligence')?.textContent).toContain('App Shell')
    click(button('Reset view'))
    expect(container.querySelector('.ct-intelligence h2')?.textContent).toBe('Intelligence')
  })
  it('does not keep a terminal duration running when completion time is absent', () => {
    const run = { ...CONTROL_TOWER_SCENARIOS.completed, runId: 'fixture', publishedAt: '', startedAt: '2026-09-16T12:00:00Z' }
    expect(sessionDuration(run)).toBeNull()
    expect(sessionDuration({ ...run, completedAt: '2026-09-16T12:03:15Z' })).toBe('3m 15s')
  })
  it('retains Diagnostics as a secondary destination', () => {
    render(React.createElement(V15rAppBrainTab))
    click(container.querySelector<HTMLButtonElement>('.ct-diagnostics-access')!)
    expect(container.querySelector<HTMLElement>('[data-destination="diagnostics"]')?.hidden).toBe(false)
    expect(container.querySelector('[data-destination="diagnostics"]')?.textContent).toContain('Context Hub')
  })
})
