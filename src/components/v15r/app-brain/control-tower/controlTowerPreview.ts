import type { ControlTowerPreview } from './controlTowerTypes'

/** Local illustration only. Never persisted, merged with generated work, or reported as Host truth. */
export const CONTROL_TOWER_PREVIEW: ControlTowerPreview = {
  provenance: 'Preview',
  freshness: 'Snapshot',
  objective: 'Add invoice draft editing without changing the existing approval flow.',
  runState: 'paused',
  phase: 'Waiting at a scope gate',
  currentRole: 'Implementer',
  verification: 'not-started',
  changeset: 'none',
  scope: 'Invoice draft editing · planned scope only',
  source: 'Local invoice-draft fixture · no Host connection',
  attention: [
    { id: 'scope-gate', kind: 'gate', title: 'Resolve the approval-flow boundary', consequence: 'Draft editing is blocked. Authorization and resume are unavailable in this preview.', taskId: 'edit-draft' },
    { id: 'plan-review', kind: 'plan-review', title: 'Inspect the draft-editing plan', consequence: 'The plan preserves the existing approval flow. Reviewing this example does not authorize implementation.' },
  ],
  tasks: [
    { id: 'edit-draft', title: 'Add draft editing', role: 'Implementer', state: 'blocked', summary: 'Attempt 1 stopped at scope gate', detail: 'Confirm that editing cannot bypass approval. No authorization or resume is available in this shell.', attempt: 'Attempt 1 · stopped at scope gate (preview)', retry: 'none', dependencies: 'None · Architect plan prepared in this fixture', requested: { state: 'requested', provider: 'OpenAI', model: 'gpt-5.5' }, reported: { state: 'unreported' } },
    { id: 'validation', title: 'Protect approval behavior', role: 'Implementer', state: 'pending-waiting', summary: 'Waiting for Add draft editing', detail: 'Add validation around the existing approval boundary. This does not authorize changing protected approval logic.', attempt: 'No Attempt started', retry: 'none', dependencies: 'T1 · Add draft editing', requested: { state: 'requested', provider: 'OpenAI', model: 'gpt-5.5' }, reported: { state: 'unreported' } },
    { id: 'verify', title: 'Independently verify draft editing', role: 'Verifier', state: 'pending-waiting', summary: 'Waiting for both implementation tasks', detail: 'Independently verify draft editing and the existing approval flow.', attempt: 'No Attempt started', retry: 'none', dependencies: 'T1 and T2 must pass', requested: { state: 'unavailable' }, reported: { state: 'unreported' } },
  ],
}

export type PreviewScenario = 'working' | 'gate' | 'completed'
const working: ControlTowerPreview = {
  ...CONTROL_TOWER_PREVIEW, runState: 'running', phase: 'Protecting the approval boundary', attention: [],
  tasks: CONTROL_TOWER_PREVIEW.tasks.map((task, index) => index === 0
    ? { ...task, state: 'passed', summary: 'Attempt 1 passed · Snapshot', detail: 'Draft editing is prepared in this illustrative plan. Approval behavior remains unchanged.', attempt: 'Attempt 1 · passed at snapshot' }
    : index === 1 ? { ...task, state: 'running', summary: 'Attempt 1 active at snapshot · T1 passed', attempt: 'Attempt 1 · active at snapshot' }
    : task),
}
const completed: ControlTowerPreview = {
  ...working, runState: 'completed', phase: 'Verification passed · review candidate', currentRole: 'Verifier', verification: 'passed', changeset: 'not-applied',
  tasks: working.tasks.map(task => ({ ...task, state: 'passed', summary: 'Attempt 1 passed · Snapshot', attempt: 'Attempt 1 · passed at snapshot' })),
}
export const CONTROL_TOWER_SCENARIOS: Record<PreviewScenario, ControlTowerPreview> = { working, gate: CONTROL_TOWER_PREVIEW, completed }
