// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import NewRunComposer from '../app-brain/control-tower/NewRunComposer'
import ScopePackReview from '../app-brain/control-tower/ScopePackReview'
import ControlTower from '../app-brain/control-tower/ControlTower'
import { PREVIEW_SCOPE_PACK, PREVIEW_SCOPE_PACK_LABEL, isPreviewScopePackId } from '@/features/control-tower/scopePack/preview'
import { approximateTokenCount, CREATE_PLAN_MAX_PAYLOAD_BYTES, estimateArchitectContextTokens } from '@/features/control-tower/capacity'
import { PREVIEW_PROVIDER_FLEET } from '@/features/control-tower/previewFleet'
import type { NextRunRouting } from '@/features/control-tower/nextRunRouting'
import { QBO_HANDOFF_FIXTURE, parseHandoffDocument } from '@/features/control-tower/scopePack/handoffParser'
import type { HostPresenceView } from '@/features/control-tower/controlTowerAdapter'
import type { ScopePackRow } from '@/features/control-tower/controlTowerService'

vi.mock('../../V15rAppBrainScene', () => ({ default: () => React.createElement('div') }))
vi.mock('@/features/control-tower/controlTowerService', () => ({
  resolveControlTowerContext: () => new Promise(() => {}),
  fetchHostPresenceRows: () => new Promise(() => {}),
  insertControlRequest: () => new Promise(() => {}),
  fetchControlRequest: () => new Promise(() => {}),
  fetchRecentControlRequests: () => new Promise(() => {}),
  fetchRunSnapshotRows: () => new Promise(() => {}),
  fetchScopePackRows: () => new Promise(() => {}),
}))

const presence: HostPresenceView = {
  state: 'healthy', repoKey: '0123456789abcdef', providers: ['claude'], providerFleet: [], hostVersion: '0.1.0', lastSeenAt: '2026-09-22T00:00:00Z', hostInstanceId: 'host-1',
  restartRequired: false, restartDetectedAt: null, hostHealth: null,
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

describe('CT-LIVE-0B1 planning mode placement', () => {
  it('shows Fast above Owner Scope, keeps that scope when switching to Deep, and submits the selected mode', () => {
    const submitted: unknown[] = []
    render(React.createElement(NewRunComposer, {
      presence, busy: false, draft: { scope: '', constraints: [], requestedRouting: null },
      onSubmit: (draft) => submitted.push(draft), onCancel: () => {},
    }))
    const mode = container.querySelector<HTMLElement>('[aria-label="Planning mode"]')
    const scope = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Owner scope"]')
    const advanced = container.querySelector('summary')
    expect(mode).not.toBeNull()
    expect(scope).not.toBeNull()
    expect(mode!.compareDocumentPosition(scope!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(advanced?.textContent).toContain('Advanced · Next Run Routing')
    expect(mode!.compareDocumentPosition(advanced!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(container.querySelector('[aria-label="Planning mode"] button[aria-pressed="true"]')?.textContent).toBe('Fast')
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      setter.call(scope, 'Keep this scope')
      scope!.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => button('Deep / Reconcile').click())
    expect(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Owner scope"]')?.value).toBe('Keep this scope')
    expect(container.querySelector('[aria-label="Planning mode"] button[aria-pressed="true"]')?.textContent).toBe('Deep / Reconcile')
    act(() => button('Request plan').click())
    expect(submitted).toEqual([{ scope: 'Keep this scope', constraints: [], planningMode: 'deep', requestedRouting: null }])
  })
})

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
    expect(submitted).toEqual([{ scope: 'Create a file', constraints: [], planningMode: 'fast', requestedRouting: null }])
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

function setArea(label: string, value: string) {
  const area = container.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${label}"]`)
  if (!area) throw new Error(`Missing textarea: ${label}`)
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    setter.call(area, value)
    area.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('CT-LIVE-0A composer capacity', () => {
  it('accepts text beyond 8000 characters and shows approximate tokens', () => {
    const submitted: Array<{ scope: string }> = []
    const scope = `BEGIN ${'A'.repeat(9_000)} END`
    render(React.createElement(NewRunComposer, {
      presence, busy: false, draft: { scope: '', constraints: [], requestedRouting: null },
      onSubmit: (draft) => submitted.push(draft), onCancel: () => {},
    }))
    setArea('Owner scope', scope)
    expect(container.textContent).not.toMatch(/\/\s*8000/)
    expect(container.querySelector('textarea[aria-label="Owner scope"]')?.getAttribute('maxlength')).toBeNull()
    expect(container.querySelector('textarea.ct-composer-scope')).not.toBeNull()
    expect(container.textContent).toContain(`Owner input: ${scope.length} chars · ~${approximateTokenCount(scope)} tokens`)
    expect(container.textContent).toContain(`Estimated Architect context: ~${estimateArchitectContextTokens(scope, [])} tokens`)
    expect(container.textContent).toContain('Provider limit not reported')
    expect((button('Request plan') as HTMLButtonElement).disabled).toBe(false)
    act(() => button('Request plan').click())
    expect(submitted[0]?.scope).toBe(scope)
    expect(submitted[0]?.scope.startsWith('BEGIN ')).toBe(true)
    expect(submitted[0]?.scope.endsWith(' END')).toBe(true)
  })

  it('counts multibyte characters separately from the approximate token estimate', () => {
    render(React.createElement(NewRunComposer, {
      presence, busy: false, draft: { scope: '你你', constraints: [], requestedRouting: null },
      onSubmit: () => {}, onCancel: () => {},
    }))
    expect(container.textContent).toContain('Owner input: 2 chars · ~2 tokens')
  })

  it('blocks Request Plan when the create_plan payload exceeds the envelope', () => {
    const submitted: unknown[] = []
    render(React.createElement(NewRunComposer, {
      presence, busy: false, draft: { scope: '', constraints: [], requestedRouting: null },
      onSubmit: (draft) => submitted.push(draft), onCancel: () => {},
    }))
    setArea('Owner scope', 'A'.repeat(CREATE_PLAN_MAX_PAYLOAD_BYTES))
    expect(container.textContent).toContain('safety envelope')
    expect(container.textContent).toContain('UTF-8 bytes')
    expect((button('Request plan') as HTMLButtonElement).disabled).toBe(true)
    act(() => button('Request plan').click())
    expect(submitted).toEqual([])
  })

  it('shows a reported model context only when the fleet provides one', () => {
    const fleet = structuredClone(PREVIEW_PROVIDER_FLEET)
    fleet[0].models[0].contextWindow = 123456
    const routing: NextRunRouting = {
      architect: { providerId: 'claude', modelId: fleet[0].models[0].modelId, effort: 'high', customModel: null },
      implementer: { providerId: 'codex', modelId: 'gpt-test', effort: 'medium', customModel: null },
      verifier: { providerId: 'ollama', modelId: null, effort: null, customModel: null },
    }
    render(React.createElement(NewRunComposer, {
      presence: { ...presence, providerFleet: fleet },
      busy: false,
      draft: { scope: 'Create a file', constraints: [], requestedRouting: null },
      routing,
      onSubmit: () => {},
      onCancel: () => {},
    }))
    expect(container.textContent).toContain('Provider context: 123,456 tokens')
    expect(container.textContent).toContain('Architect: claude · claude-sonnet-5 · high')
    expect(container.textContent).toContain('Implementer: codex · gpt-test · medium')
    expect(container.textContent).toContain('Verifier: ollama · unset · default')
  })
})
