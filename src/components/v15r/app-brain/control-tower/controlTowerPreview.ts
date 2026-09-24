import type { ControlTowerPreview } from './controlTowerTypes'

/** Local illustration only. Never persisted, merged with generated work, or reported as Host truth.
 *  ATB-3 §21: fixtures exercise the honest team states — active Architect /
 *  Implementer / Verifier, Watch, Needs Owner, Guard warning, a failed handoff,
 *  and a completed Run. Preview data can never reach Live (separate store). */
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
    { id: 'draft-plan', taskId: 't-plan', title: 'Prepare the draft-editing plan', role: 'Architect', state: 'passed', summary: 'Attempt 1 passed · Snapshot', detail: 'Plan prepared in this fixture. Editing cannot bypass the approval boundary.', attempt: 'Attempt 1 · passed at snapshot', retry: 'none', dependencies: 'None', requested: { state: 'requested', provider: 'Anthropic', model: 'claude-sonnet-5' }, reported: { state: 'unreported' }, provider: 'claude', effort: 'high' },
    { id: 'edit-draft', taskId: 't-edit', title: 'Add draft editing', role: 'Implementer', state: 'blocked', summary: 'Attempt 1 stopped at scope gate', detail: 'Confirm that editing cannot bypass approval. No authorization or resume is available in this shell.', attempt: 'Attempt 1 · stopped at scope gate (preview)', retry: 'none', dependencies: 'Architect plan prepared in this fixture', requested: { state: 'requested', provider: 'OpenAI', model: 'gpt-5.5' }, reported: { state: 'unreported' }, provider: 'codex', effort: 'extra-high', plannedAreas: ['src/components/v15r/V15rProjectsPanel.tsx'] },
    { id: 'validation', taskId: 't-validate', title: 'Protect approval behavior', role: 'Implementer', state: 'pending-waiting', summary: 'Waiting for Add draft editing', detail: 'Add validation around the existing approval boundary. This does not authorize changing protected approval logic.', attempt: 'No Attempt started', retry: 'none', dependencies: 'T2 · Add draft editing', requested: { state: 'requested', provider: 'Anthropic', model: 'claude-sonnet-5' }, reported: { state: 'unreported' }, provider: 'claude', effort: 'high', plannedAreas: ['src/services/backupDataService.ts'] },
    { id: 'verify', taskId: 't-verify', title: 'Independently verify draft editing', role: 'Verifier', state: 'pending-waiting', summary: 'Waiting for both implementation tasks', detail: 'Independently verify draft editing and the existing approval flow.', attempt: 'No Attempt started', retry: 'none', dependencies: 'T2 and T3 must pass', requested: { state: 'unavailable' }, reported: { state: 'unreported' }, provider: 'claude', effort: 'high', plannedAreas: ['src/components/v15r/V15rProjectsPanel.tsx'] },
  ],
  interimVerdicts: [
    { verdictId: 'v-plan-pass', role: 'architect', taskId: 't-plan', attemptId: 'a-plan', state: 'PASS', summary: 'Plan keeps the approval flow untouched.', evidenceRefs: [], evidenceCount: 3, severity: 'info', recommendedAction: 'none', mayContinue: true, timestamp: '2026-09-22T09:04:00Z' },
    { verdictId: 'v-edit-blocked', role: 'implementer', taskId: 't-edit', attemptId: 'a-edit', state: 'BLOCKED', summary: 'Editing stopped at the approval-flow scope gate. The draft edit plan touches the approval boundary.', evidenceRefs: [], evidenceCount: 2, severity: 'notice', recommendedAction: 'approve-gate', mayContinue: false, timestamp: '2026-09-22T09:18:00Z' },
  ],
  handoffs: [
    { handoffId: 'h-plan', from: 'architect', to: 'implementer', taskId: 't-plan', payloadType: 'plan', summary: 'Draft-editing plan delivered', evidenceCount: 1, status: 'accepted', timestamp: '2026-09-22T09:05:00Z', latencyMs: 400, resultingVerdict: 'CONTINUE' },
    { handoffId: 'h-gate', from: 'guard', to: 'owner', taskId: 't-edit', payloadType: 'gate', summary: 'Scope gate raised — owner decision required', evidenceCount: 2, status: 'blocked', timestamp: '2026-09-22T09:17:00Z', latencyMs: null, resultingVerdict: 'NEEDS_OWNER' },
  ],
  signals: [
    { signalId: 's-gate', category: 'human-gate', severity: 'warning', source: 'guard', taskId: 't-edit', attemptId: 'a-edit', message: 'Implementation reached the protected approval-flow boundary. Owner review required before continuing.', evidenceCount: 2, evidenceRefs: [], firstSeen: '2026-09-22T09:17:00Z', lastSeen: '2026-09-22T09:18:00Z', resolvedAt: null, ownerActionRequired: true },
  ],
}

export type PreviewScenario = 'working' | 'gate' | 'verify' | 'completed'
const working: ControlTowerPreview = {
  ...CONTROL_TOWER_PREVIEW, runState: 'running', phase: 'Protecting the approval boundary', attention: [],
  tasks: CONTROL_TOWER_PREVIEW.tasks.map((task) =>
    task.id === 'draft-plan' ? task
    : task.id === 'edit-draft' ? { ...task, state: 'passed', summary: 'Attempt 1 passed · Snapshot', detail: 'Draft editing is prepared in this illustrative plan. Approval behavior remains unchanged.', attempt: 'Attempt 1 · passed at snapshot' }
    : task.id === 'validation' ? { ...task, state: 'running', summary: 'Attempt 1 active at snapshot · editing passed', attempt: 'Attempt 1 · active at snapshot' }
    : task),
  interimVerdicts: [
    { verdictId: 'w-arch-pass', role: 'architect', taskId: 't-plan', attemptId: 'a-plan', state: 'PASS', summary: 'Plan accepted by the Implementer.', evidenceRefs: [], evidenceCount: 4, severity: 'info', recommendedAction: 'none', mayContinue: true, timestamp: '2026-09-22T10:04:00Z' },
    { verdictId: 'w-edit-pass', role: 'implementer', taskId: 't-edit', attemptId: 'a-edit', state: 'PASS', summary: 'Draft editing added; approval flow untouched.', evidenceRefs: [], evidenceCount: 6, severity: 'info', recommendedAction: 'none', mayContinue: true, timestamp: '2026-09-22T10:26:00Z' },
    { verdictId: 'w-validate-continue', role: 'implementer', taskId: 't-validate', attemptId: 'a-validate', state: 'CONTINUE', summary: 'Validation wiring in progress; boundary checks still passing.', evidenceRefs: [], evidenceCount: 3, severity: 'info', recommendedAction: 'none', mayContinue: true, timestamp: '2026-09-22T10:41:00Z' },
    { verdictId: 'w-verify-watch', role: 'verifier', taskId: 't-edit', attemptId: 'a-edit', state: 'WATCH', summary: 'Approval-boundary regression checks have not been observed yet.', evidenceRefs: [], evidenceCount: 2, severity: 'warning', recommendedAction: 'watch', mayContinue: true, timestamp: '2026-09-22T10:39:00Z' },
  ],
  handoffs: [
    { handoffId: 'w-h-plan', from: 'architect', to: 'implementer', taskId: 't-plan', payloadType: 'plan', summary: 'Plan accepted', evidenceCount: 1, status: 'accepted', timestamp: '2026-09-22T10:05:00Z', latencyMs: 380, resultingVerdict: 'CONTINUE' },
    { handoffId: 'w-h-ready', from: 'implementer', to: 'verifier', taskId: 't-edit', payloadType: 'task-ready', summary: 'Draft editing ready for pre-verification review', evidenceCount: 1, status: 'queued', timestamp: '2026-09-22T10:42:00Z', latencyMs: null, resultingVerdict: null },
    { handoffId: 'w-h-reject', from: 'verifier', to: 'implementer', taskId: 't-edit', payloadType: 'verification', summary: 'First review pass rejected — boundary tests not shown', evidenceCount: 3, status: 'rejected', timestamp: '2026-09-22T10:20:00Z', latencyMs: 900, resultingVerdict: 'WATCH' },
    { handoffId: 'w-h-guard', from: 'guard', to: 'host', taskId: null, payloadType: 'policy-finding', summary: 'Unplanned-area warning delivered', evidenceCount: 2, status: 'delivered', timestamp: '2026-09-22T10:38:00Z', latencyMs: 120, resultingVerdict: null },
  ],
  signals: [
    { signalId: 'w-s-unplanned', category: 'unplanned-area', severity: 'warning', source: 'guard', taskId: 't-validate', attemptId: 'a-validate', message: 'One touched file sits outside the published planned areas. Kept under watch; no protected path involved.', evidenceCount: 2, evidenceRefs: [], firstSeen: '2026-09-22T10:37:00Z', lastSeen: '2026-09-22T10:41:00Z', resolvedAt: null, ownerActionRequired: false },
  ],
}
const verify: ControlTowerPreview = {
  ...working, phase: 'Independent verification active', currentRole: 'Verifier', verification: 'active',
  tasks: working.tasks.map(task => task.id === 'validation' ? { ...task, state: 'passed', summary: 'Attempt 1 passed · Snapshot', attempt: 'Attempt 1 · passed at snapshot' } : task.id === 'verify' ? { ...task, state: 'running', summary: 'Attempt 1 active at snapshot', attempt: 'Attempt 1 · active at snapshot' } : task),
  interimVerdicts: [
    ...working.interimVerdicts!.filter(verdict => verdict.verdictId !== 'w-verify-watch'),
    { verdictId: 'vf-verify-continue', role: 'verifier', taskId: 't-verify', attemptId: 'a-verify', state: 'CONTINUE', summary: 'Independent verification running; approval boundary holds so far.', evidenceRefs: [], evidenceCount: 5, severity: 'info', recommendedAction: 'none', mayContinue: true, timestamp: '2026-09-22T11:12:00Z' },
  ],
  handoffs: [
    ...working.handoffs!.filter(handoff => handoff.handoffId !== 'w-h-ready' && handoff.handoffId !== 'w-h-reject'),
    { handoffId: 'vf-h-verify', from: 'implementer', to: 'verifier', taskId: 't-verify', payloadType: 'changeset', summary: 'Candidate changes handed to the Verifier', evidenceCount: 2, status: 'delivered', timestamp: '2026-09-22T11:02:00Z', latencyMs: 260, resultingVerdict: 'CONTINUE' },
  ],
  signals: [
    { ...working.signals![0], signalId: 'vf-s-unplanned', resolvedAt: '2026-09-22T10:58:00Z', lastSeen: '2026-09-22T10:58:00Z', message: 'Touched file reconciled with the published plan. Resolved.' },
  ],
}
const completed: ControlTowerPreview = {
  ...verify, runState: 'completed', phase: 'Verification passed · review candidate', verification: 'passed', changeset: 'not-applied',
  tasks: verify.tasks.map(task => ({ ...task, state: 'passed', summary: 'Attempt 1 passed · Snapshot', attempt: 'Attempt 1 · passed at snapshot' })),
  interimVerdicts: [
    { verdictId: 'c-arch-pass', role: 'architect', taskId: 't-plan', attemptId: 'a-plan', state: 'PASS', summary: 'Plan delivered and honored.', evidenceRefs: [], evidenceCount: 4, severity: 'info', recommendedAction: 'none', mayContinue: true, timestamp: '2026-09-22T10:04:00Z' },
    { verdictId: 'c-edit-pass', role: 'implementer', taskId: 't-edit', attemptId: 'a-edit', state: 'PASS', summary: 'Draft editing implemented; approval flow untouched.', evidenceRefs: [], evidenceCount: 7, severity: 'info', recommendedAction: 'none', mayContinue: true, timestamp: '2026-09-22T10:52:00Z' },
    { verdictId: 'c-validate-pass', role: 'implementer', taskId: 't-validate', attemptId: 'a-validate', state: 'PASS', summary: 'Approval-boundary validation passed.', evidenceRefs: [], evidenceCount: 5, severity: 'info', recommendedAction: 'none', mayContinue: true, timestamp: '2026-09-22T10:58:00Z' },
    { verdictId: 'c-verify-pass', role: 'verifier', taskId: 't-verify', attemptId: 'a-verify', state: 'PASS', summary: 'Independent verification passed. Candidate changes ready for review.', evidenceRefs: [], evidenceCount: 9, severity: 'info', recommendedAction: 'none', mayContinue: true, timestamp: '2026-09-22T11:31:00Z' },
  ],
  handoffs: [
    { handoffId: 'c-h-plan', from: 'architect', to: 'implementer', taskId: 't-plan', payloadType: 'plan', summary: 'Plan accepted', evidenceCount: 1, status: 'accepted', timestamp: '2026-09-22T10:05:00Z', latencyMs: 380, resultingVerdict: 'CONTINUE' },
    { handoffId: 'c-h-verify', from: 'implementer', to: 'verifier', taskId: 't-verify', payloadType: 'changeset', summary: 'Candidate changes verified', evidenceCount: 2, status: 'accepted', timestamp: '2026-09-22T11:02:00Z', latencyMs: 260, resultingVerdict: 'PASS' },
    { handoffId: 'c-h-result', from: 'verifier', to: 'owner', taskId: 't-verify', payloadType: 'run-result', summary: 'Run complete — candidate ready for owner review', evidenceCount: 1, status: 'delivered', timestamp: '2026-09-22T11:32:00Z', latencyMs: 140, resultingVerdict: 'PASS' },
  ],
  signals: [
    { ...verify.signals![0], signalId: 'c-s-unplanned', resolvedAt: '2026-09-22T10:58:00Z', lastSeen: '2026-09-22T10:58:00Z' },
  ],
}
export const CONTROL_TOWER_SCENARIOS: Record<PreviewScenario, ControlTowerPreview> = { working, gate: CONTROL_TOWER_PREVIEW, verify, completed }