// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import TowerWorkspace from '../app-brain/control-tower/TowerWorkspace'
import ControlTower from '../app-brain/control-tower/ControlTower'
import { CONTROL_TOWER_SCENARIOS } from '../app-brain/control-tower/controlTowerPreview'
import { buildAgentTeamTopology, TEAM_PARTY_ANCHORS } from '../app-brain/control-tower/agentTeamTopology'
import {
  OPERATIONAL_CAMERA_LOOK_AT,
  OPERATIONAL_CAMERA_POSITION,
  OPERATIONAL_CAMERA_Z,
  OPERATIONAL_HUB_RING_SCALE,
  OPERATIONAL_LABEL_SCALE,
  OPERATIONAL_LABEL_WEIGHT_SCALE,
  OPERATIONAL_NODE_LAYOUT,
  OPERATIONAL_NODE_SCALE_CAP,
  operationalCentroid,
  operationalEdgeControl,
  operationalEdgeOpacity,
  operationalEdgeSamples,
  operationalLabelScale,
  operationalLabelWorldScale,
  operationalZExtent,
} from '../app-brain/control-tower/operationalBrainLayout'
import { APP_BRAIN_EDGES, APP_BRAIN_NODES } from '../appBrainMap'
import type { TowerSession } from '../app-brain/control-tower/sessionPresentation'

vi.mock('../V15rAppBrainScene', () => ({ default: (props: { activityNodeIds: string[]; motionMode?: string }) => (
  <div data-testid="brain" data-active={props.activityNodeIds.join(',')} data-motion={props.motionMode ?? ''} />
) }))

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); container = document.createElement('div'); document.body.append(container); root = createRoot(container) })
afterEach(() => { act(() => root.unmount()); container.remove() })

const session = (scenario: keyof typeof CONTROL_TOWER_SCENARIOS, overrides: Partial<TowerSession> = {}): TowerSession =>
  ({ ...CONTROL_TOWER_SCENARIOS[scenario], runId: `test-${scenario}`, publishedAt: '', ...overrides })

it('uses the ATB-6 desktop workspace class with a larger Brain stage', () => {
  act(() => root.render(<ControlTower />))
  expect(container.querySelector('.ct-workspace-atb6')).toBeTruthy()
  expect(container.querySelector('.ct-brain-stage')).toBeTruthy()
  const css = readFileSync(join(process.cwd(), 'src/components/v15r/app-brain/control-tower/controlTower.css'), 'utf8')
  expect(css).not.toMatch(/\.ct-container\s*\{[^}]*max-width:\s*1560px/)
  expect(css).not.toMatch(/\.ct-destinations\s*\{[^}]*max-width:\s*1560px/)
  expect(css).toMatch(/minmax\(240px,\s*260px\)/)
  expect(css).toMatch(/minmax\(328px,\s*360px\)/)
  expect(css).toMatch(/minmax\(360px,\s*400px\)/)
  expect(css).toMatch(/min-height:\s*620px/)
  expect(css).toMatch(/@container control-tower \(min-width: 1680px\)/)
  const scene = readFileSync(join(process.cwd(), 'src/components/v15r/V15rAppBrainScene.tsx'), 'utf8')
  expect(scene).toMatch(/operationalNodePosition/)
  expect(scene).toMatch(/operationalLabelWorldScale/)
  expect(scene).toMatch(/operationalEdgeControl/)
  expect(scene).toMatch(/applyOperationalCamera/)
  expect(scene).toMatch(/sizeAttenuation:\s*true/)
  expect(scene).toMatch(/OPERATIONAL_NODE_SCALE_CAP/)
  expect(scene).toMatch(/antialias:\s*true/)
  expect(scene).toMatch(/canvas\.width = 1024/)
  expect(scene).toMatch(/canvas\.height = 256/)
  expect(scene).toMatch(/prefers-reduced-motion: reduce/)
  expect(container.querySelector('.ct-history')).toBeTruthy()
  expect(container.querySelector('.ct-map-frame')).toBeTruthy()
  expect(container.querySelector('.ct-intelligence')).toBeTruthy()
  const workspace = container.querySelector('.ct-workspace-atb6')!
  expect(workspace.children[0].className).toContain('ct-history')
  expect(workspace.children[1].className).toContain('ct-map-frame')
  expect(workspace.children[2].className).toContain('ct-intelligence')
})

it('insets agent cards so the team surrounds the application constellation', () => {
  expect(TEAM_PARTY_ANCHORS.host).toEqual({ x: 50, y: 7.5 })
  expect(TEAM_PARTY_ANCHORS.architect.x).toBeGreaterThanOrEqual(12)
  expect(TEAM_PARTY_ANCHORS.architect.x).toBeLessThanOrEqual(16)
  expect(TEAM_PARTY_ANCHORS.implementer.x).toBeGreaterThanOrEqual(12)
  expect(TEAM_PARTY_ANCHORS.implementer.x).toBeLessThanOrEqual(16)
  expect(TEAM_PARTY_ANCHORS.guard.x).toBeGreaterThanOrEqual(84)
  expect(TEAM_PARTY_ANCHORS.guard.x).toBeLessThanOrEqual(88)
  expect(TEAM_PARTY_ANCHORS.verifier.x).toBeGreaterThanOrEqual(84)
  expect(TEAM_PARTY_ANCHORS.verifier.x).toBeLessThanOrEqual(88)
  expect(TEAM_PARTY_ANCHORS.owner.y).toBeGreaterThanOrEqual(93)
  expect(TEAM_PARTY_ANCHORS.owner.y).toBeLessThanOrEqual(96)
})

it('places the operational brain as an asymmetric neural cloud without changing semantic edges', () => {
  const ids = APP_BRAIN_NODES.map((node) => node.id)
  expect(Object.keys(OPERATIONAL_NODE_LAYOUT).sort()).toEqual([...ids].sort())
  expect(APP_BRAIN_EDGES.map((edge) => [edge.from, edge.to, edge.strength])).toEqual([
    ['app-shell', 'v15r-layout', 1],
    ['app-shell', 'admin-tools', 0.8],
    ['app-shell', 'shared-systems', 0.9],
    ['v15r-layout', 'projects', 0.9],
    ['v15r-layout', 'field-log', 0.9],
    ['v15r-layout', 'material-takeoff', 0.75],
    ['v15r-layout', 'app-brain', 0.7],
    ['admin-tools', 'ai-nexus', 0.85],
    ['admin-tools', 'app-brain', 0.65],
    ['app-brain', 'shared-systems', 0.65],
    ['projects', 'field-log', 0.8],
    ['projects', 'blueprint', 0.7],
    ['projects', 'data-persistence', 0.85],
    ['field-log', 'data-persistence', 0.85],
    ['field-log', 'ai-nexus', 0.6],
    ['blueprint', 'material-takeoff', 0.75],
    ['blueprint', 'data-persistence', 0.8],
    ['material-takeoff', 'shared-systems', 0.55],
    ['ai-nexus', 'shared-systems', 0.7],
    ['shared-systems', 'data-persistence', 0.75],
  ])
  expect(APP_BRAIN_NODES.find((node) => node.id === 'app-brain')?.position).toEqual([0.35, -0.1, 1.35])
  expect(APP_BRAIN_NODES.find((node) => node.id === 'shared-systems')?.position).toEqual([-0.35, 1.95, -0.95])
  expect(APP_BRAIN_NODES.find((node) => node.id === 'data-persistence')?.position).toEqual([0.05, -2.35, -0.05])

  const positions = Object.values(OPERATIONAL_NODE_LAYOUT)
  const xs = positions.map((position) => position[0])
  const ys = positions.map((position) => position[1])
  const [cx, cy, cz] = operationalCentroid()
  const brain = OPERATIONAL_NODE_LAYOUT['app-brain']
  expect(Math.hypot(brain[0] - cx, brain[1] - cy, brain[2] - cz)).toBeLessThan(0.45)
  expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThanOrEqual(5)
  expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(6)
  expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThanOrEqual(3.5)
  expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(4.5)
  const z = operationalZExtent()
  expect(z.span).toBeGreaterThanOrEqual(1.4)
  expect(z.span).toBeLessThanOrEqual(2)
  expect(positions.some((position) => position[2] > 0.3)).toBe(true)
  expect(positions.some((position) => position[2] < -0.3)).toBe(true)

  const byHeight = ids
    .map((id) => ({ id, y: OPERATIONAL_NODE_LAYOUT[id][1], x: OPERATIONAL_NODE_LAYOUT[id][0] }))
    .sort((left, right) => right.y - left.y)
  expect(byHeight[0].y - byHeight[1].y).toBeLessThan(0.45)
  expect(Math.abs(byHeight[0].x - cx)).toBeGreaterThan(0.8)
  expect(byHeight[0].id).not.toBe('app-brain')
  const byDepth = [...byHeight].sort((left, right) => left.y - right.y)
  expect(byDepth[0].id).not.toBe('data-persistence')
  expect(byDepth[1].y - byDepth[0].y).toBeLessThan(0.5)
  expect(Math.abs(byDepth[0].x - cx)).toBeGreaterThan(0.6)
  expect(OPERATIONAL_NODE_LAYOUT['shared-systems'][1]).toBeLessThan(Math.max(...ys) + 0.001)
  expect(OPERATIONAL_NODE_LAYOUT['shared-systems'][0]).not.toBe(0)

  let mirror = 0
  for (const position of positions) {
    const reflectedX = 2 * cx - position[0]
    let nearest = Number.POSITIVE_INFINITY
    for (const other of positions) nearest = Math.min(nearest, Math.hypot(other[0] - reflectedX, other[1] - position[1]))
    mirror += nearest
  }
  expect(mirror / positions.length).toBeGreaterThan(0.45)
  const radii = positions.map((position) => Math.hypot(position[0] - cx, position[1] - cy))
  const meanRadius = radii.reduce((sum, radius) => sum + radius, 0) / radii.length
  const radiusSpread = Math.sqrt(radii.reduce((sum, radius) => sum + (radius - meanRadius) ** 2, 0) / radii.length)
  expect(radiusSpread).toBeGreaterThan(0.35)

  const workTier = ['projects', 'material-takeoff', 'field-log', 'blueprint'].map((id) => OPERATIONAL_NODE_LAYOUT[id][1])
  expect(Math.max(...workTier) - Math.min(...workTier)).toBeGreaterThan(0.8)

  expect(OPERATIONAL_NODE_SCALE_CAP).toBeLessThanOrEqual(1.5)
  expect(OPERATIONAL_HUB_RING_SCALE).toBeGreaterThan(1)
  expect(OPERATIONAL_HUB_RING_SCALE).toBeLessThan(1.3)
  expect(OPERATIONAL_LABEL_SCALE[0]).toBeCloseTo(0.42, 2)
  expect(OPERATIONAL_LABEL_SCALE[1]).toBeCloseTo(0.105, 3)
  expect(OPERATIONAL_LABEL_WEIGHT_SCALE.primary).toBeCloseTo(1.12, 2)
  expect(OPERATIONAL_LABEL_WEIGHT_SCALE.normal).toBe(1)
  expect(OPERATIONAL_LABEL_WEIGHT_SCALE.quiet).toBeCloseTo(0.93, 2)
  expect(operationalLabelScale('primary')[0]).toBeCloseTo(OPERATIONAL_LABEL_SCALE[0] * 1.12, 3)
  expect(operationalLabelScale('quiet')[0]).toBeLessThan(operationalLabelScale('normal')[0])
  expect(OPERATIONAL_CAMERA_POSITION[0]).not.toBe(0)
  expect(OPERATIONAL_CAMERA_POSITION[1]).toBeGreaterThan(0.2)
  expect(OPERATIONAL_CAMERA_LOOK_AT[2]).not.toBe(0)
  expect(OPERATIONAL_CAMERA_Z).toBe(OPERATIONAL_CAMERA_POSITION[2])
  const near = operationalLabelWorldScale('normal', 6.7, 0.8)
  const far = operationalLabelWorldScale('normal', 6.7, -0.88)
  expect(near[0]).toBeGreaterThan(far[0])
  expect(near[0] / 6.7).toBeLessThan(OPERATIONAL_LABEL_SCALE[0] * 1.15)

  const signs = APP_BRAIN_EDGES.map((edge) => {
    const from = OPERATIONAL_NODE_LAYOUT[edge.from]
    const to = OPERATIONAL_NODE_LAYOUT[edge.to]
    const control = operationalEdgeControl(edge.from, edge.to, from, to, edge.strength)
    const mid = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]
    return Math.sign((to[0] - from[0]) * (control[1] - mid[1]) - (to[1] - from[1]) * (control[0] - mid[0]))
  })
  expect(signs.some((sign) => sign > 0)).toBe(true)
  expect(signs.some((sign) => sign < 0)).toBe(true)
  const chord: [number, number, number] = [0, 0, 0]
  const end: [number, number, number] = [2, 0.2, 0.1]
  const strong = operationalEdgeControl('same', 'edge', chord, end, 1)
  const quiet = operationalEdgeControl('same', 'edge', chord, end, 0.55)
  const bow = (point: [number, number, number]) => Math.hypot(point[0] - 1, point[1] - 0.1, point[2] - 0.05)
  expect(bow(quiet)).toBeGreaterThan(bow(strong))
  expect(operationalEdgeOpacity(1)).toBeGreaterThan(operationalEdgeOpacity(0.55))
  expect(operationalEdgeOpacity(0.55)).toBeGreaterThan(operationalEdgeOpacity(0))
  const samples = operationalEdgeSamples(chord, strong, end, 8)
  expect(samples).toHaveLength(9)
  expect(samples[0]).toEqual(chord)
  expect(samples[8][0]).toBeCloseTo(end[0], 5)
  expect(Math.hypot(samples[4][0] - 1, samples[4][1] - 0.1)).toBeGreaterThan(0.02)
})

it('keeps architect, implementer, verifier, and guard app mappings against the neural layout', () => {
  const workingTopo = buildAgentTeamTopology(session('working'))
  expect(workingTopo.appLinks.implementerAreas).toContain('src/services/backupDataService.ts')
  expect(workingTopo.appLinks.architectAreas).toEqual([])
  expect(workingTopo.appLinks.verifierAreas).toEqual([])
  expect(workingTopo.appLinks.guardAreas).toContain('src/services/backupDataService.ts')
  const verifyTopo = buildAgentTeamTopology(session('verify'))
  expect(verifyTopo.appLinks.verifierAreas).toContain('src/components/v15r/V15rProjectsPanel.tsx')
  expect(verifyTopo.appLinks.implementerAreas).toEqual([])
  const completedTopo = buildAgentTeamTopology(session('completed'))
  expect(completedTopo.runActive).toBe(false)
  expect(completedTopo.appLinks.implementerAreas).toEqual([])
  expect(completedTopo.appLinks.verifierAreas).toEqual([])
  expect(completedTopo.edges.every((edge) => edge.traveling === false)).toBe(true)
})

it('renders five role nodes and selects a role into TEAM', () => {
  act(() => root.render(<TowerWorkspace run={session('working')} sessions={[session('working')]} selectedTaskId={null} onSelectRun={() => {}} onSelectTask={() => {}} preview />))
  expect(container.querySelectorAll('.ct-team-node')).toHaveLength(5)
  act(() => { container.querySelector<HTMLButtonElement>('.ct-team-node--architect')!.click() })
  expect(container.querySelector('.ct-intelligence h2')?.textContent).toBe('Team detail')
})

it('keeps historical handoffs settled and rest motion distinct from active execution', () => {
  act(() => root.render(<TowerWorkspace run={session('completed')} sessions={[session('completed')]} selectedTaskId={null} onSelectRun={() => {}} onSelectTask={() => {}} preview />))
  expect(container.querySelector('.ct-brain-stage')?.getAttribute('data-motion-mode')).toBe('rest')
  expect(container.querySelector('.ct-brain-stage')?.getAttribute('data-ambient')).toBe('true')
  expect(container.querySelector('.ct-team-edge--traveling')).toBeNull()
  const topology = buildAgentTeamTopology(session('working'))
  expect(topology.runActive).toBe(true)
  expect(topology.edges.some((edge) => edge.traveling)).toBe(true)
})

it('halts execution travel on failed and owner-gate runs while leaving ambient on', () => {
  act(() => root.render(<TowerWorkspace run={session('gate')} sessions={[session('gate')]} selectedTaskId={null} onSelectRun={() => {}} onSelectTask={() => {}} preview />))
  expect(container.querySelector('.ct-brain-stage')?.getAttribute('data-motion-mode')).toBe('halted')
  expect(container.querySelector('.ct-brain-stage')?.getAttribute('data-ambient')).toBe('true')
})

it('does not map app nodes without published planned areas', () => {
  const run = session('working', { tasks: session('working').tasks.map((task) => ({ ...task, plannedAreas: [] })) })
  act(() => root.render(<TowerWorkspace run={run} sessions={[run]} selectedTaskId={null} onSelectRun={() => {}} onSelectTask={() => {}} preview />))
  expect(container.querySelector('[data-testid="brain"]')?.getAttribute('data-active')).toBe('')
})

it('keeps preview overlay flagged so fixtures cannot leak into Live', () => {
  act(() => root.render(<TowerWorkspace run={session('working')} sessions={[session('working')]} selectedTaskId={null} onSelectRun={() => {}} onSelectTask={() => {}} preview />))
  expect(container.querySelector('.ct-team-overlay')!.className).toContain('ct-team-overlay--preview')
})

it('disables nonessential motion under prefers-reduced-motion', () => {
  const css = readFileSync(join(process.cwd(), 'src/components/v15r/app-brain/control-tower/controlTower.css'), 'utf8')
  expect(css).toMatch(/prefers-reduced-motion: reduce/)
  expect(css).toMatch(/\.ct-team-edge--traveling\s*\{\s*animation:\s*none/)
})
