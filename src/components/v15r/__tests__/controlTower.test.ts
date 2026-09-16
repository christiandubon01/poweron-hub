// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import V15rAppBrainTab from '../V15rAppBrainTab'
import ControlTower from '../app-brain/control-tower/ControlTower'
import TaskInspector from '../app-brain/control-tower/TaskInspector'
import { AttentionItem, ChangesetSummary, ConnectionFreshness, EvidenceProvenance, ProviderModelBadge, RetryIndicator, RoleBadge, RunStatus, TaskRow, VerifierState } from '../app-brain/control-tower/ControlTowerPrimitives'
import { CONTROL_TOWER_PREVIEW as preview } from '../app-brain/control-tower/controlTowerPreview'
import type { AttentionKind, EvidenceKind, Freshness, RunState, TaskState } from '../app-brain/control-tower/controlTowerTypes'

vi.mock('../V15rAppBrainScene', () => ({ default: () => React.createElement('div', { 'data-testid': 'existing-scene' }, 'Architecture scene') }))
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
 act(()=>{select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}))})
}

describe('Control Tower destinations', () => {
  it('renders Architecture by default and preserves its mounted structure and state across peer switches', () => {
    render(React.createElement(V15rAppBrainTab))
    const architecture = container.querySelector<HTMLElement>('[data-destination="architecture"]')!
    expect(architecture.hidden).toBe(false)
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
    click(button('Control Tower Preview'))
    expect(architecture.hidden).toBe(true)
    expect(container.querySelector('[aria-label="Control Tower preview"]')).not.toBeNull()
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

describe('preview workspace interactions', () => {
  it('exposes Work / Map / Details structure and keeps task selection in a single inspector', () => {
    render(React.createElement(ControlTower))
    const inspector = container.querySelector('.ct-inspector')
    for (const mode of ['Work', 'Map', 'Details']) expect(container.querySelector(`[aria-label="Control Tower workspace modes"]`)?.textContent).toContain(mode)
    click(button('Map'))
    expect(container.querySelector('.ct-shell')?.getAttribute('data-mode')).toBe('map')
    click(container.querySelector<HTMLButtonElement>('.ct-task-row')!)
    expect(container.querySelector('.ct-inspector')).toBe(inspector)
    expect(container.querySelectorAll('.ct-inspector')).toHaveLength(1)
    expect(inspector?.textContent).toContain(preview.tasks[0].title)
    expect(container.querySelector('.ct-shell')?.getAttribute('data-mode')).toBe('details')
    click(button('Run overview'))
    expect(inspector?.textContent).toContain('Select a task')
  })
  it('switches inspector sections without replacing its shell', () => {
    render(React.createElement(TaskInspector, { task: preview.tasks[0], onClear: vi.fn() }))
    const inspector = container.querySelector('.ct-inspector')
    click(button('Attempt'))
    expect(container.textContent).toContain('Attempt 1 · stopped at scope gate (preview)')
    click(button('Evidence'))
    expect(container.textContent).toContain('No candidate changes reported')
    expect(container.querySelector('.ct-inspector')).toBe(inspector)
  })
  it('shows consequence-first attention with view all and an inspectable plan preview', () => {
    render(React.createElement(ControlTower))
    scenario('gate')
    expect(container.querySelectorAll('.ct-attention-item')).toHaveLength(1)
    expect(container.querySelector('.ct-attention-item')?.getAttribute('data-kind')).toBe('gate')
    click(button('View all (2)'))
    expect(container.querySelectorAll('.ct-attention-item')).toHaveLength(2)
    click(container.querySelector<HTMLButtonElement>('[data-kind="plan-review"] button')!)
    expect(container.querySelector('.ct-inspector')?.textContent).toContain('Selected Run')
  })
  it('labels fixture content and leaves future capabilities unavailable', () => {
    render(React.createElement(ControlTower))
    expect(container.textContent).toContain('Preview')
    expect(container.textContent).toContain('Snapshot')
    expect(container.textContent).not.toMatch(/\bLive\b|Current feed/i)
    expect(button('New Run').disabled).toBe(true)
    expect(button('Focus task').disabled).toBe(true)
    expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')?.disabled).toBe(true)
    expect(container.textContent).toContain('Future capabilities')
    expect(Array.from(container.querySelectorAll('button')).some(item => /^(Pause|Resume|Apply|Commit|Push|Deploy)$/.test(item.textContent ?? ''))).toBe(false)
  })
  it('expands the existing map and restores focus with Escape', () => {
    render(React.createElement(ControlTower))
    const expand = button('Expand')
    click(expand)
    expect(container.querySelector('[role="dialog"]')?.getAttribute('aria-modal')).toBe('true')
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(expand)
  })
})


describe('CT-IMP-1R owner composition', () => {
 it('demotes preserved panels to Diagnostics and qualifies seed states immediately', () => {
  render(React.createElement(V15rAppBrainTab))
  const architecture=container.querySelector<HTMLElement>('[data-destination="architecture"]')!
  const diagnostics=container.querySelector<HTMLElement>('[data-destination="diagnostics"]')!
  expect(architecture.textContent).not.toContain('Context Hub')
  expect(diagnostics.hidden).toBe(true)
  click(button('Diagnostics'))
  expect(diagnostics.hidden).toBe(false)
  for(const label of ['Live Work','Context Hub','Directory Brain','File Profile','Watch Mode Contract','Snapshot state: active','Snapshot state: pending','Snapshot · Healthy','Snapshot · Typecheck pass rate']) expect(diagnostics.textContent).toContain(label)
  click(button('Control Tower Preview'))
  expect(diagnostics.hidden).toBe(true)
  const tower=container.querySelector('[aria-label="Control Tower preview"]')!
  expect(tower.textContent).not.toContain('Context Hub')
  expect(tower.querySelector('.ct-run .ct-eyebrow')?.textContent).toContain('Run · Snapshot')
  for(const label of ['Other active Runs','Recent work']) expect(tower.textContent).toContain(label)
 })
 it('starts with a coherent passed/running/waiting plan and explicit inspector evidence', () => {
  render(React.createElement(ControlTower))
  const rows=container.querySelectorAll('.ct-task-row')
  expect(rows[0].textContent).toContain('Passed')
  expect(rows[1].textContent).toContain('Running')
  expect(rows[2].textContent).toContain('Pending · waiting')
  const inspector=container.querySelector('.ct-inspector')!
  for(const label of ['Protect approval behavior','Running · Snapshot','Dependencies','T1 · Add draft editing','Attempt 1 · active at snapshot','Planned scope','No retry scheduled','What this means']) expect(inspector.textContent).toContain(label)
  expect(inspector.textContent).not.toContain('Requested · Provider: OpenAI') // machine evidence lives in the Evidence tab
  click(button('Evidence'))
  for(const label of ['Requested · Provider: OpenAI','Model unreported','No task ids, timestamps, or usage figures are supplied in this snapshot']) expect(inspector.textContent).toContain(label)
 })
 it('previews completion and unapplied changes in the selected Run shell consistently', () => {
  render(React.createElement(ControlTower))
  const inspector=container.querySelector('.ct-inspector')
  scenario('completed')
  expect(container.querySelector('.ct-run')?.textContent).toContain('Run completed')
  expect(container.querySelector('.ct-run')?.textContent).toContain('Changes not applied')
  expect(container.querySelector('.ct-run')?.textContent).toContain('3/3 tasks passed')
  click(button('Evidence'))
  expect(inspector?.textContent).toContain('Changes not applied')
  scenario('gate')
  expect(container.querySelector('.ct-inspector')).toBe(inspector)
  expect(container.querySelector('.ct-run')?.textContent).toContain('Run paused')
  expect(container.querySelector('.ct-run')?.textContent).not.toContain('Changes not applied')
 })
 it('opens proposed scope and task evidence without authorizing a gate', () => {
  render(React.createElement(ControlTower))
  scenario('gate')
  click(button('Open task evidence'))
  const inspector=container.querySelector('.ct-inspector')!
  expect(inspector.textContent).toContain('No candidate diff supplied')
  expect(inspector.querySelector('button[aria-pressed="true"]')?.textContent).toBe('Evidence')
  click(button('Inspect proposed change'))
  expect(inspector.querySelector('button[aria-pressed="true"]')?.textContent).toBe('Details')
  expect(inspector.textContent).toContain('Blocked · Snapshot')
  expect(Array.from(container.querySelectorAll('button')).some(item=>/^(Approve|Resume|Continue)$/.test(item.textContent??''))).toBe(false)
 })
})

describe('CT-IMP-1HF frozen CT-3F composition', () => {
 it('orders the workspace Task → App Brain → Inspector', () => {
  render(React.createElement(ControlTower))
  const workspace=container.querySelector('.ct-workspace')!
  const children=[...workspace.children]
  expect(children).toHaveLength(3)
  expect(children[0].className).toContain('ct-col-tasks')
  expect(children[1].className).toContain('ct-map-frame')
  expect(children[2].className).toContain('ct-inspector')
 })
 it('binds one selection across the Task rail, App Brain, and Inspector', () => {
  render(React.createElement(ControlTower))
  const mapFrame=container.querySelector('.ct-map-frame')!
  expect(mapFrame.className).toContain('ct-focus-active') // 'validation' is the default selection
  click(container.querySelectorAll<HTMLButtonElement>('.ct-task-row')[0])
  expect(container.querySelector('.ct-inspector h3')?.textContent).toContain('Add draft editing')
  expect(mapFrame.className).toContain('ct-focus-passed')
  expect(container.querySelector('.ct-breadcrumb')?.textContent).toContain('Implementer')
  expect(container.querySelector('.ct-breadcrumb')?.textContent).toContain('Add draft editing')
  click(button('Run overview'))
  expect(mapFrame.className).toContain('ct-focus-scope')
 })
 it('carries the run command bar as the single owner control surface', () => {
  render(React.createElement(ControlTower))
  const bar=container.querySelector('.ct-run-bar')!
  expect(bar.querySelector('select[aria-label="Preview snapshot"]')).not.toBeNull() // switcher moved into the bar
  expect(bar.querySelector<HTMLButtonElement>('.ct-new-run button')?.disabled).toBe(true) // New Run moved into the bar
  expect(bar.querySelector('h2')?.textContent).toContain(preview.objective)
  expect(container.querySelectorAll('.ct-relay .ct-role')).toHaveLength(3)
  expect(container.querySelector('.ct-relay-current .ct-role')?.textContent).toBe('Implementer')
  expect(container.querySelectorAll('.ct-node-running')).toHaveLength(1)
  expect(container.querySelector('.ct-handoff')?.textContent).toBe('Implementer → Verifier')
 })
 it('replaces the empty attention block with a quiet run-bar indicator', () => {
  render(React.createElement(ControlTower))
  expect(container.querySelector('.ct-attention')).toBeNull()
  expect(container.textContent).not.toContain('Nothing needs your attention')
  expect(container.querySelector('.ct-run-bar .ct-clear')?.textContent).toContain('Clear · nothing needs you')
 })
 it('shows the conditional authority ribbon above the run bar only when attention exists', () => {
  render(React.createElement(ControlTower))
  scenario('gate')
  const ribbon=container.querySelector('.ct-attention')!
  expect(ribbon.textContent).toContain('Paused — your authority is required.')
  const shell=container.querySelector('.ct-shell')!
  const order=[...shell.children]
  expect(order.findIndex(el=>el.classList.contains('ct-attention'))).toBeLessThan(order.findIndex(el=>el.classList.contains('ct-run')))
  expect(container.querySelector('.ct-run-bar .ct-clear')).toBeNull()
  scenario('completed')
  expect(container.querySelector('.ct-attention')).toBeNull()
 })
 it('keeps the completed state calm and the not-applied truth separate', () => {
  render(React.createElement(ControlTower))
  scenario('completed')
  const bar=container.querySelector('.ct-run-bar')!
  expect(bar.className).toContain('ct-run-state-completed')
  expect(bar.textContent).toContain('Verifier · Passed')
  expect(container.querySelector('.ct-relay-current .ct-role')?.textContent).toBe('Verifier')
  expect(bar.textContent).toContain('Changes not applied')
  const rail=container.querySelector('.ct-task-list')!
  expect(rail.querySelectorAll('.ct-node-passed')).toHaveLength(3)
  expect(rail.querySelectorAll('.ct-spine-dashed')).toHaveLength(0)
 })
})
