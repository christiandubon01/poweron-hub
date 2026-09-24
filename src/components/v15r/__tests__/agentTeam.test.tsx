// @vitest-environment happy-dom
// ATB-3 §31 tests A–R: the live Agent Team topology is a pure projection of
// real ATB-1/ATB-2 session data. No live model calls anywhere in this suite.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import TowerWorkspace from '../app-brain/control-tower/TowerWorkspace'
import { CONTROL_TOWER_SCENARIOS } from '../app-brain/control-tower/controlTowerPreview'
import { buildAgentTeamTopology, teamNodeByRole } from '../app-brain/control-tower/agentTeamTopology'
import type { TowerSession } from '../app-brain/control-tower/sessionPresentation'

vi.mock('../V15rAppBrainScene', () => ({ default: (props: { activityNodeIds: string[]; failedNodeIds: string[]; verifierNodeIds?: string[]; plannedNodeIds?: string[] }) => (
  <div data-testid="brain" data-active={props.activityNodeIds.join(',')} data-failed={props.failedNodeIds.join(',')} data-verifier={(props.verifierNodeIds ?? []).join(',')} data-planned={(props.plannedNodeIds ?? []).join(',')} />
) }))

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); container = document.createElement('div'); document.body.append(container); root = createRoot(container) })
afterEach(() => { act(() => root.unmount()); container.remove() })

const session = (scenario: keyof typeof CONTROL_TOWER_SCENARIOS, overrides: Partial<TowerSession> = {}): TowerSession =>
  ({ ...CONTROL_TOWER_SCENARIOS[scenario], runId: `test-${scenario}`, publishedAt: '', ...overrides })
function render(run: TowerSession) {
  act(() => root.render(<TowerWorkspace run={run} sessions={[run]} selectedTaskId={null} onSelectRun={() => {}} onSelectTask={() => {}} />))
  return run
}
const node = (role: string) => container.querySelector<HTMLButtonElement>(`.ct-team-node--${role}`)!
const brain = () => container.querySelector('[data-testid="brain"]')!
const click = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
/** dt → dd map of the first facts grid (selected-role model truth). */
function facts(): Record<string, string> {
  const map: Record<string, string> = {}
  for (const row of container.querySelectorAll('.ct-model-facts > div')) {
    const dt = row.querySelector('dt')?.textContent ?? ''
    map[dt] = row.querySelector('dd')?.textContent ?? ''
  }
  return map
}

/* A — the locked five-member team always renders. */
it('renders all five role nodes for a session', () => {
  render(session('working'))
  expect(container.querySelectorAll('.ct-team-node')).toHaveLength(5)
  for (const role of ['host', 'architect', 'implementer', 'verifier', 'guard']) {
    expect(node(role), role).toBeTruthy()
  }
})

/* B — Host and Guard are deterministic machinery, never model-backed agents. */
it('marks Host and Guard as deterministic and shows no model for them', () => {
  render(session('working'))
  expect(node('host').getAttribute('aria-label')).toContain('deterministic orchestration')
  expect(node('guard').getAttribute('aria-label')).toContain('deterministic orchestration')
  expect(node('host').querySelector('.ct-team-chip')).toBeNull()
  expect(node('guard').querySelector('.ct-team-chip')).toBeNull()
  click(node('host'))
  expect(facts()['Provider']).toBe('Not applicable')
  expect(facts()['Model']).toBe('Not applicable')
})

/* C — model-backed roles show only the truth the snapshot published. */
it('shows provider, requested, and honestly-unreported model for a model-backed role', () => {
  render(session('working'))
  click(node('implementer'))
  const model = facts()
  expect(model['Provider']).toBe('claude')
  expect(model['Requested model']).toBe('claude-sonnet-5')
  // Codex-style honesty: requested is NEVER copied into the reported slot.
  expect(model['Reported model']).toBe('Not reported')
  expect(model['Effort']).toBe('high')
})
it('shows the real reported model when the Host actually published one', () => {
  const run = session('working', {
    tasks: session('working').tasks.map(task => task.state === 'running' ? { ...task, reported: { state: 'reported' as const, model: 'gpt-5.6-sol', provider: 'codex' } } : task),
  })
  render(run)
  click(node('implementer'))
  expect(facts()['Reported model']).toBe('gpt-5.6-sol')
})

/* D — a verdict colors exactly the role that issued it. */
it('maps a WATCH verdict to the Verifier and a PASS verdict to the Architect', () => {
  render(session('working'))
  expect(node('verifier').className).toContain('ct-team-node-state-warning')
  expect(node('verifier').getAttribute('aria-label')).toContain('Watch')
  expect(node('architect').className).toContain('ct-team-node-state-pass')
})

/* E — the newest verdict wins, whatever order the feed delivers them. */
it('keeps only the latest verdict per role', () => {
  const run = session('working', {
    interimVerdicts: [
      { verdictId: 'early', role: 'implementer', taskId: 't-validate', attemptId: 'a', state: 'CONTINUE', summary: 'early', evidenceRefs: [], evidenceCount: 1, severity: 'info', recommendedAction: 'none', mayContinue: true, timestamp: '2026-09-22T10:00:00Z' },
      { verdictId: 'late', role: 'implementer', taskId: 't-validate', attemptId: 'a', state: 'FAIL', summary: 'late', evidenceRefs: [], evidenceCount: 1, severity: 'critical', recommendedAction: 'cancel', mayContinue: false, timestamp: '2026-09-22T10:30:00Z' },
    ],
  })
  render(run)
  expect(node('implementer').className).toContain('ct-team-node-state-fail')
  expect(teamNodeByRole(buildAgentTeamTopology(run), 'implementer')!.verdict!.verdictId).toBe('late')
})

/* F — handoff edges come only from real handoff records. */
it('draws one edge per real handoff party pair', () => {
  render(session('working'))
  const lines = container.querySelectorAll('.ct-team-edge')
  expect(lines).toHaveLength(4) // architect→implementer, implementer→verifier, verifier→implementer, guard→host
  expect(container.querySelector('.ct-team-edge--queued')).toBeTruthy()
  expect(container.querySelector('.ct-team-edge--rejected')).toBeTruthy()
})

/* G + L + N — settled runs never animate. */
it('settles every handoff edge once the run is completed', () => {
  const run = session('completed')
  render(run)
  for (const line of container.querySelectorAll('.ct-team-edge')) {
    expect(line.getAttribute('data-traveling')).toBe('false')
    expect(line.className).not.toContain('ct-team-edge--traveling')
  }
  expect(container.querySelector('.ct-team-node--engaged')).toBeNull()
  expect(brain().getAttribute('data-active')).toBe('')
})
it('marks the whole completed topology as not running and not engaged', () => {
  const topology = buildAgentTeamTopology(session('completed'))
  expect(topology.runActive).toBe(false)
  expect(topology.nodes.every(n => !n.engaged)).toBe(true)
  expect(topology.edges.every(e => !e.traveling)).toBe(true)
  expect(teamNodeByRole(topology, 'host')!.state).toBe('PASS')
})

/* H — warning/critical signals belong to the Guard. */
it('surfaces guard signals on the Guard node and its detail', () => {
  render(session('gate'))
  expect(node('guard').className).toContain('ct-team-node-state-waiting-owner')
  click(node('guard'))
  expect(container.querySelector('.ct-team-signal-list')).toBeTruthy()
  expect(container.querySelector('.ct-team-signal-category')?.textContent).toBe('human-gate')
  expect(container.querySelector('.ct-team-signal-severity--warning')).toBeTruthy()
  expect(container.textContent).toContain('Required') // ownerActionRequired surfaced
})

/* I — task/attempt-scoped signals badge the corresponding agent node. */
it('badges the Implementer for a signal scoped to its task without duplicating full text', () => {
  render(session('working'))
  const badge = node('implementer').querySelector('.ct-team-badge')
  expect(badge?.textContent).toBe('1')
  expect(node('guard').querySelector('.ct-team-badge')).toBeNull() // guard shows the count in its sub-line
  expect(badge?.textContent).not.toContain('unplanned-area')
})

/* J — planned areas map roles onto real app nodes. */
it('links the running Verifier task to its mapped app node via the read-only path', () => {
  render(session('verify'))
  expect(brain().getAttribute('data-verifier')).toBe('projects')
  expect(brain().getAttribute('data-active')).toBe('projects') // running task drives activity
  expect(brain().getAttribute('data-planned')).toBe('') // no running Architect task
})

/* K — unmapped work never fabricates a connection. */
it('fabricates no app links when planned areas are unmapped or absent', () => {
  const run = session('verify', { tasks: session('verify').tasks.map(task => ({ ...task, plannedAreas: [] })) })
  render(run)
  expect(brain().getAttribute('data-active')).toBe('')
  expect(brain().getAttribute('data-verifier')).toBe('')
  const topology = buildAgentTeamTopology(run)
  expect(topology.appLinks.verifierAreas).toEqual([])
})

/* M — a failed run marks only the role that actually failed. */
it('marks only the truthful failed role on a failed run', () => {
  const completed = session('completed')
  const run: TowerSession = {
    ...completed, runState: 'failed', verification: 'rejected',
    tasks: completed.tasks.map(task => task.role === 'Verifier' ? { ...task, state: 'failed' as const } : task),
    interimVerdicts: [{ verdictId: 'vf', role: 'verifier', taskId: 't-verify', attemptId: 'a', state: 'FAIL', summary: 'Boundary violated', evidenceRefs: [], evidenceCount: 4, severity: 'critical', recommendedAction: 'cancel', mayContinue: false, timestamp: '2026-09-22T11:31:00Z' }],
  }
  render(run)
  expect(node('verifier').className).toContain('ct-team-node-state-fail')
  expect(node('implementer').className).toContain('ct-team-node-state-pass')
  expect(node('architect').className).toContain('ct-team-node-state-pass')
  expect(container.querySelectorAll('.ct-team-node-state-fail')).toHaveLength(2) // Verifier + Host run state, never more
})

/* O — preview fixtures can never present as live. */
it('flags preview topology so fixtures can never leak into Live', () => {
  expect(buildAgentTeamTopology(session('working')).preview).toBe(true)
  expect(buildAgentTeamTopology(session('working', { provenance: 'Live' })).preview).toBe(false)
  render(session('working'))
  expect(container.querySelector('.ct-team-overlay')!.className).toContain('ct-team-overlay--preview')
})
it('marks a live session overlay as live', () => {
  render(session('working', { provenance: 'Live' }))
  expect(container.querySelector('.ct-team-overlay')!.className).not.toContain('ct-team-overlay--preview')
})

/* P — legacy snapshots without any telemetry still render safely. */
it('renders a safe team when the snapshot carries no telemetry', () => {
  const run = session('verify', { interimVerdicts: undefined, handoffs: undefined, signals: undefined })
  render(run)
  expect(container.querySelectorAll('.ct-team-node')).toHaveLength(5)
  expect(container.querySelectorAll('.ct-team-edge')).toHaveLength(0)
  expect(node('guard').className).toContain('ct-team-node-state-idle')
  expect(node('implementer').className).toContain('ct-team-node-state-pass') // still honest from task state
})

/* Q — role nodes are keyboard-selectable context. */
it('selects a role node as Control Tower context and shows its team detail', () => {
  render(session('working'))
  const implementer = node('implementer')
  expect(implementer.tagName).toBe('BUTTON') // inherently keyboard focusable
  act(() => { implementer.focus() })
  expect(document.activeElement).toBe(implementer)
  click(implementer)
  expect(implementer.getAttribute('aria-pressed')).toBe('true')
  expect(container.textContent).toContain('Team detail')
  expect(container.querySelector('.ct-team-handoff-history')).toBeTruthy()
  // Handoff history is textual, not only visual (§27).
  expect(container.querySelector('.ct-team-handoff-history')!.textContent).toContain('Architect')
  click(implementer) // toggles back
  expect(implementer.getAttribute('aria-pressed')).toBe('false')
})

/* §7/§9 — the selected-role detail carries the verdict and handoff truth. */
it('reveals verdict summary, action, evidence and handoff history in the right panel', () => {
  render(session('working'))
  click(node('verifier'))
  expect(container.textContent).toContain('Approval-boundary regression checks have not been observed yet.')
  expect(container.textContent).toContain('Watch and continue')
  expect(container.textContent).toContain('2 references')
  const history = container.querySelectorAll('.ct-team-handoff-history li')
  expect(history.length).toBeGreaterThan(0)
  expect([...history].some(li => li.textContent!.includes('Implementer → Verifier'))).toBe(true)
})

/* R — reduced motion disables the traveling handoff animation. */
it('disables traveling-edge animation under prefers-reduced-motion', () => {
  const css = readFileSync(join(process.cwd(), 'src/components/v15r/app-brain/control-tower/controlTower.css'), 'utf8')
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
  expect(reduced).toContain('.ct-team-edge--traveling')
  expect(reduced).toMatch(/\.ct-team-edge--traveling\s*\{\s*animation:\s*none/)
})