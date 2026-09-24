// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it } from 'vitest'
import ScopeMode from '../app-brain/control-tower/intelligence/ScopeMode'
import { PREVIEW_SCOPE_PACK, PREVIEW_SCOPE_PACK_LABEL } from '@/features/control-tower/scopePack/preview'
import { SCOPE_STORAGE_PENDING_MESSAGE } from '@/features/control-tower/scopeStorage'
import type { ScopePackContract } from '@/features/control-tower/scopePack/types'

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); container = document.createElement('div'); document.body.append(container); root = createRoot(container) })
afterEach(() => { act(() => root.unmount()); container.remove() })

const pack = (state: ScopePackContract['foundationClaims'][number]['state'], recon: ScopePackContract['reconciliationState'] = 'unverified'): ScopePackContract => ({
  ...PREVIEW_SCOPE_PACK,
  packId: `live-${state.toLowerCase()}`,
  reconciliationState: recon,
  foundationClaims: [{ claimId: 'c1', claim: `${state} foundation`, state, evidenceRefs: ['e1'], reconciliationSummary: `${state} summary` }],
  lockedRules: ['Locked A'],
  doNotTouch: ['Do not touch A'],
  acceptanceCriteria: ['Accept A'],
})

it('renders CURRENT STALE CONFLICT and UNVERIFIED claim states', () => {
  for (const state of ['CURRENT', 'STALE', 'CONFLICT', 'UNVERIFIED'] as const) {
    act(() => root.render(<ScopeMode pack={pack(state, state === 'CURRENT' ? 'current' : state === 'STALE' ? 'stale' : state === 'CONFLICT' ? 'conflict' : 'unverified')} storage="ready" preview={false} />))
    expect(container.textContent).toContain(state)
    expect(container.querySelector(`.ct-claim-state-${state.toLowerCase()}`)).toBeTruthy()
  }
})

it('shows phase, phase intent, locked rules, do-not-touch, and acceptance', () => {
  act(() => root.render(<ScopeMode pack={pack('CURRENT', 'current')} selectedPhaseId="QBO-4B0" storage="ready" preview={false} />))
  expect(container.textContent).toContain('QBO-4B0')
  expect(container.textContent).toContain('audit')
  expect(container.textContent).toContain('Locked rules')
  expect(container.textContent).toContain('Do not touch')
  expect(container.textContent).toContain('Acceptance')
})

it('shows the migration-pending Live state without a Preview fixture', () => {
  act(() => root.render(<ScopeMode pack={null} storage="pending" preview={false} />))
  expect(container.textContent).toContain(SCOPE_STORAGE_PENDING_MESSAGE)
  expect(container.textContent).not.toContain(PREVIEW_SCOPE_PACK_LABEL)
})

it('isolates the Preview Scope fixture from Live', () => {
  act(() => root.render(<ScopeMode pack={null} storage="ready" preview />))
  expect(container.textContent).toContain(PREVIEW_SCOPE_PACK_LABEL)
  expect(container.textContent).toContain(PREVIEW_SCOPE_PACK.title)
  act(() => root.render(<ScopeMode pack={null} storage="ready" preview={false} />))
  expect(container.textContent).not.toContain(PREVIEW_SCOPE_PACK_LABEL)
  expect(container.textContent).toContain('No Scope Pack is bound')
})
