// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import NewRunComposer from '../app-brain/control-tower/NewRunComposer'
import ScopePackReview from '../app-brain/control-tower/ScopePackReview'
import ControlTower from '../app-brain/control-tower/ControlTower'
import { PREVIEW_SCOPE_PACK, PREVIEW_SCOPE_PACK_LABEL, isPreviewScopePackId } from '@/features/control-tower/scopePack/preview'
import { QBO_HANDOFF_FIXTURE, parseHandoffDocument } from '@/features/control-tower/scopePack/handoffParser'
import type { HostPresenceView } from '@/features/control-tower/controlTowerAdapter'
import type { ScopePackRow } from '@/features/control-tower/controlTowerService'

vi.mock('../../V15rAppBrainScene', () => ({ default: () => React.createElement('div') }))
vi.mock('@/features/control-tower/controlTowerService', () => ({
  resolveControlTowerContext: () => new Promise(() => {}),
  fetchHostPresenceRows: () => new Promise(() => {}),
  insertControlRequest: () => new Promise(() => {}),
  fetchControlRequest: () => new Promise(() => {}),
  fetchRunSnapshotRows: () => new Promise(() => {}),
  fetchScopePackRows: () => new Promise(() => {}),
}))

const presence: HostPresenceView = {
  state: 'connected', repoKey: '0123456789abcdef', providers: ['claude'], providerFleet: [], hostVersion: '0.1.0', lastSeenAt: '2026-09-22T00:00:00Z', hostInstanceId: 'host-1',
}

const liveRow: ScopePackRow = {
  id: 'pack-live-1',
  title: 'Live QBO pack',
  source_filename: 'qbo.md',
  source_hash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  pack: {
    historicalCheckpoint: '9f3c2ab',
    intent: 'PowerOn remains source of truth',
    foundationClaims: [{ claimId: 'claim-1', claim: 'PowerOn is truth', state: 'CURRENT', evidenceRefs: [], reconciliationSummary: 'ok' }],
    lockedRules: ['No silent QuickBooks create/update'],
    doNotTouch: ['src/store/authStore.ts'],
    roadmapPhases: [{ id: 'QBO-4B0', title: 'QBO-4B0 — Open Estimates Truth Audit', goal: 'NO IMPLEMENTATION', status: 'not-started', executionIntent: 'audit' }],
    acceptanceCriteria: ['Runtime verification required'],
    runtimeAcceptanceRequired: true,
    ownerDecisions: [],
    supersededDecisions: [],
    knownRisks: [],
    relatedAppAreas: [],
  },
  reconciliation_state: 'current',
  current_phase_id: 'QBO-4B0',
  version: 1,
  created_at: '2026-09-22T00:00:00Z',
  updated_at: '2026-09-22T00:00:00Z',
  last_reconciled_at: '2026-09-22T01:00:00Z',
  repo_key: '0123456789abcdef',
}

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

describe('ATB-5 New Run Scope Pack composer', () => {
  it('keeps ordinary New Run working without a pack', () => {
    const submitted: unknown[] = []
    render(React.createElement(NewRunComposer, {
      presence, busy: false, draft: { scope: 'Create a file', constraints: [], requestedRouting: null },
      onSubmit: (draft) => submitted.push(draft), onCancel: () => {},
    }))
    expect(container.textContent).toContain('Scope Pack')
    expect(container.textContent).toContain('ordinary New Run')
    act(() => button('Request plan').click())
    expect(submitted).toEqual([{ scope: 'Create a file', constraints: [], requestedRouting: null }])
  })

  it('rejects unsupported file types before parse', async () => {
    render(React.createElement(NewRunComposer, {
      presence, busy: false, draft: { scope: '', constraints: [], requestedRouting: null },
      onSubmit: () => {}, onCancel: () => {}, onImportScopePack: async () => null,
    }))
    act(() => button('Import handoff').click())
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Import handoff file"]')!
    const file = new File(['%PDF'], 'notes.pdf', { type: 'application/pdf' })
    await act(async () => {
      Object.defineProperty(input, 'files', { value: { 0: file, length: 1, item: () => file } })
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(container.textContent).toContain('.md and .txt files only')
  })

  it('parses a handoff into an editable import preview and saves an import request', async () => {
    const imported: unknown[] = []
    render(React.createElement(NewRunComposer, {
      presence, busy: false, draft: { scope: '', constraints: [], requestedRouting: null },
      onSubmit: () => {}, onCancel: () => {},
      onImportScopePack: async (draft) => { imported.push(draft); return { packId: 'pack-new', duplicate: false } },
    }))
    act(() => button('Import handoff').click())
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Import handoff file"]')!
    const file = new File([QBO_HANDOFF_FIXTURE], 'qbo-handoff.md', { type: 'text/markdown' })
    await act(async () => {
      Object.defineProperty(input, 'files', { value: { 0: file, length: 1, item: () => file } })
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(container.querySelector('[aria-label="Import preview"]')).not.toBeNull()
    expect(container.textContent).toContain('QBO-4B0')
    expect(container.textContent).toContain('Secret Appendix')
    const title = container.querySelector<HTMLInputElement>('input[aria-label="Imported title"]')!
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(title, 'Edited QBO pack')
      title.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { button('Save Scope Pack').click() })
    expect(imported).toHaveLength(1)
    expect((imported[0] as { title: string }).title).toBe('Edited QBO pack')
  })

  it('lists packs, selects a phase, and reviews CURRENT/STALE/CONFLICT/UNVERIFIED', () => {
    const packs = [
      { packId: 'pack-live-1', title: 'Live QBO pack', currentPhaseId: 'QBO-4B0', currentPhaseTitle: 'QBO-4B0 — Open Estimates Truth Audit', reconciliationState: 'current' as const, historicalCheckpoint: '9f3c2ab', lastReconciledAt: '2026-09-22T01:00:00Z', version: 1, sourceFilename: 'qbo.md', sourceHash: liveRow.source_hash },
    ]
    render(React.createElement(NewRunComposer, {
      presence, busy: false, draft: { scope: 'Audit estimates', constraints: [], requestedRouting: null },
      onSubmit: () => {}, onCancel: () => {}, scopePacks: packs, scopePackRows: [liveRow],
    }))
    expect(container.querySelector('[aria-label="Scope Pack list"]')?.textContent).toContain('Live QBO pack')
    const select = container.querySelector<HTMLSelectElement>('select[aria-label="Select Scope Pack"]')!
    act(() => { select.value = 'pack-live-1'; select.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(container.textContent).toContain('Select phase')
    const phase = container.querySelector<HTMLSelectElement>('select[aria-label="Select Scope Pack phase"]')!
    act(() => { phase.value = 'QBO-4B0'; phase.dispatchEvent(new Event('change', { bubbles: true })) })
    act(() => button('Review pack').click())
    expect(container.querySelector('[aria-label="Scope Pack review"]')?.textContent).toContain('CURRENT')

    for (const state of ['stale', 'conflict', 'unverified'] as const) {
      render(React.createElement(ScopePackReview, { pack: { ...PREVIEW_SCOPE_PACK, packId: `live-${state}`, reconciliationState: state, title: `${state} pack` } }))
      expect(container.textContent).toContain(state.toUpperCase())
    }
  })

  it('never leaks the Preview fixture into Live', () => {
    render(React.createElement(NewRunComposer, {
      presence, busy: false, draft: { scope: '', constraints: [], requestedRouting: null },
      onSubmit: () => {}, onCancel: () => {},
      scopePacks: [{ packId: PREVIEW_SCOPE_PACK.packId, title: PREVIEW_SCOPE_PACK.title, currentPhaseId: 'QBO-4B0', currentPhaseTitle: 'x', reconciliationState: 'unverified', historicalCheckpoint: null, lastReconciledAt: null, version: 1, sourceFilename: 'x.md', sourceHash: PREVIEW_SCOPE_PACK.sourceHash }],
      surface: 'live',
    }))
    expect(container.textContent).not.toContain(PREVIEW_SCOPE_PACK_LABEL)
    expect(container.textContent).not.toContain(PREVIEW_SCOPE_PACK.title)
    expect(isPreviewScopePackId(PREVIEW_SCOPE_PACK.packId)).toBe(true)
  })
})

describe('ATB-5 Preview isolation', () => {
  it('shows one labeled example Scope Pack only in Preview', () => {
    render(React.createElement(ControlTower))
    act(() => button('SCOPE').click())
    expect(container.textContent).toContain(PREVIEW_SCOPE_PACK_LABEL)
    expect(container.querySelector('[aria-label="Scope"]')).not.toBeNull()
  })
})

describe('ATB-5 parser fixture still proves the QBO handoff shape', () => {
  it('extracts QBO-4B0 as a read-only audit phase', () => {
    const parsed = parseHandoffDocument({
      filename: 'qbo.md',
      sourceHash: 'c'.repeat(64),
      text: QBO_HANDOFF_FIXTURE,
      byteLength: new TextEncoder().encode(QBO_HANDOFF_FIXTURE).byteLength,
    })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.draft.roadmapPhases[0]?.executionIntent).toBe('audit')
    expect(JSON.stringify(parsed.draft)).not.toContain('must never be stored')
  })
})
