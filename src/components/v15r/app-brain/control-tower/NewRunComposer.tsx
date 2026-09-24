import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { TowerPanel } from './ControlTowerPrimitives'
import ScopePackReview from './ScopePackReview'
import type { HostPresenceView, ScopeDraft } from '@/features/control-tower/useControlTowerReal'
import type { ScopePackContract, ScopePackImportDraft, ScopePackListItem } from '@/features/control-tower/scopePack/types'
import type { ScopePackRow } from '@/features/control-tower/controlTowerService'
import { parseHandoffDocument, rejectScopePackSource } from '@/features/control-tower/scopePack/handoffParser'
import { sha256Hex } from '@/features/control-tower/scopePack/hash'
import { SCOPE_PACK_MAX_SOURCE_BYTES } from '@/features/control-tower/scopePack/bounds'
import { isPreviewScopePackId, PREVIEW_SCOPE_PACK, PREVIEW_SCOPE_PACK_LABEL } from '@/features/control-tower/scopePack/preview'
import { EMPTY_NEXT_RUN_ROUTING, toRequestedRouting, type NextRunRouting } from '@/features/control-tower/nextRunRouting'
import NextRunRoutingControls from './intelligence/NextRunRoutingControls'
import { PREVIEW_PROVIDER_FLEET } from '@/features/control-tower/previewFleet'

export const SCOPE_MAX_CHARS = 8_000
export const CONSTRAINT_MAX_CHARS = 1_000
export const CONSTRAINTS_MAX = 16
export const PLAN_PROVIDER_OPTIONS = ['claude', 'codex', 'ollama'] as const

interface Props {
  presence: HostPresenceView
  busy: boolean
  draft: ScopeDraft
  onSubmit: (draft: ScopeDraft) => void
  onCancel: () => void
  scopePacks?: ScopePackListItem[]
  scopePackRows?: ScopePackRow[]
  importWarning?: string | null
  importing?: boolean
  onImportScopePack?: (draft: ScopePackImportDraft) => Promise<{ packId: string; duplicate: boolean } | null>
  surface?: 'live' | 'preview'
  routing?: NextRunRouting
  onRoutingChange?: (next: NextRunRouting) => void
}

export function rowToContract(row: ScopePackRow): ScopePackContract {
  const pack = row.pack ?? {}
  return {
    packId: row.id,
    orgId: '',
    repoKey: row.repo_key,
    title: row.title,
    sourceFilename: row.source_filename,
    sourceHash: row.source_hash,
    importedAt: row.created_at,
    updatedAt: row.updated_at,
    historicalCheckpoint: typeof pack.historicalCheckpoint === 'string' ? pack.historicalCheckpoint : null,
    intent: typeof pack.intent === 'string' ? pack.intent : '',
    foundationClaims: Array.isArray(pack.foundationClaims) ? pack.foundationClaims as ScopePackContract['foundationClaims'] : [],
    lockedRules: Array.isArray(pack.lockedRules) ? pack.lockedRules as string[] : [],
    doNotTouch: Array.isArray(pack.doNotTouch) ? pack.doNotTouch as string[] : [],
    roadmapPhases: Array.isArray(pack.roadmapPhases) ? pack.roadmapPhases as ScopePackContract['roadmapPhases'] : [],
    currentPhaseId: row.current_phase_id,
    acceptanceCriteria: Array.isArray(pack.acceptanceCriteria) ? pack.acceptanceCriteria as string[] : [],
    runtimeAcceptanceRequired: pack.runtimeAcceptanceRequired === true,
    ownerDecisions: Array.isArray(pack.ownerDecisions) ? pack.ownerDecisions as string[] : [],
    supersededDecisions: Array.isArray(pack.supersededDecisions) ? pack.supersededDecisions as string[] : [],
    knownRisks: Array.isArray(pack.knownRisks) ? pack.knownRisks as string[] : [],
    relatedAppAreas: Array.isArray(pack.relatedAppAreas) ? pack.relatedAppAreas as string[] : [],
    reconciliationState: row.reconciliation_state,
    reconciliationSummary: typeof pack.reconciliationSummary === 'string' ? pack.reconciliationSummary : null,
    lastReconciledAt: row.last_reconciled_at,
    version: row.version,
  }
}

/**
 * CT-CORE-1 New Run composer (§34-§35) + ATB-5 optional Scope Pack.
 * Repository is READ-ONLY. Importing a handoff does not create a Run.
 */
export default function NewRunComposer({
  presence, busy, draft, onSubmit, onCancel,
  scopePacks = [], scopePackRows = [], importWarning, importing = false,   onImportScopePack,
  surface = 'live',
  routing = EMPTY_NEXT_RUN_ROUTING,
  onRoutingChange,
}: Props) {
  const [scope, setScope] = useState(draft.scope)
  const [constraintsText, setConstraintsText] = useState(draft.constraints.join('\n'))
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [nextRouting, setNextRouting] = useState<NextRunRouting>(() => {
    if (routing.architect.providerId || routing.architect.modelId) return routing
    if (draft.requestedRouting?.provider || draft.requestedRouting?.requestedModel) {
      return {
        ...routing,
        architect: {
          ...routing.architect,
          providerId: draft.requestedRouting.provider ?? null,
          modelId: draft.requestedRouting.requestedModel ?? null,
        },
      }
    }
    return routing
  })
  const [selectedPackId, setSelectedPackId] = useState(draft.scopePackId ?? '')
  const [selectedPhaseId, setSelectedPhaseId] = useState(draft.scopePackPhaseId ?? '')
  const [reviewOpen, setReviewOpen] = useState(false)
  const [importMode, setImportMode] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [parsedDraft, setParsedDraft] = useState<ScopePackImportDraft | null>(null)
  const [unmapped, setUnmapped] = useState<string[]>([])
  const [fileLabel, setFileLabel] = useState('')
  const [staleAck, setStaleAck] = useState(false)

  const visiblePacks = useMemo(() => {
    if (surface === 'preview') return [{
      packId: PREVIEW_SCOPE_PACK.packId,
      title: PREVIEW_SCOPE_PACK.title,
      currentPhaseId: PREVIEW_SCOPE_PACK.currentPhaseId,
      currentPhaseTitle: PREVIEW_SCOPE_PACK.roadmapPhases[0]?.title ?? null,
      reconciliationState: PREVIEW_SCOPE_PACK.reconciliationState,
      historicalCheckpoint: PREVIEW_SCOPE_PACK.historicalCheckpoint,
      lastReconciledAt: PREVIEW_SCOPE_PACK.lastReconciledAt,
      version: PREVIEW_SCOPE_PACK.version,
      sourceFilename: PREVIEW_SCOPE_PACK.sourceFilename,
      sourceHash: PREVIEW_SCOPE_PACK.sourceHash,
    }]
    return scopePacks.filter(pack => !isPreviewScopePackId(pack.packId))
  }, [scopePacks, surface])

  const selectedRow = scopePackRows.find(row => row.id === selectedPackId)
  const selectedPack = surface === 'preview' && selectedPackId === PREVIEW_SCOPE_PACK.packId
    ? PREVIEW_SCOPE_PACK
    : selectedRow ? rowToContract(selectedRow) : null
  const selectedList = visiblePacks.find(pack => pack.packId === selectedPackId) ?? null
  const constraints = constraintsText.split('\n').map(line => line.trim()).filter(line => line.length > 0)
  const scopeError = scope.trim().length === 0 ? 'Describe the work you want done.' : scope.length > SCOPE_MAX_CHARS ? `Scope is limited to ${SCOPE_MAX_CHARS} characters.` : null
  const constraintsError = constraints.length > CONSTRAINTS_MAX ? `At most ${CONSTRAINTS_MAX} constraints.` : constraints.some(line => line.length > CONSTRAINT_MAX_CHARS) ? `Each constraint is limited to ${CONSTRAINT_MAX_CHARS} characters.` : null
  const phaseRequired = Boolean(selectedPackId) && !selectedPhaseId
  const canSubmit = !scopeError && !constraintsError && !busy && !phaseRequired && surface === 'live'

  const submit = () => {
    if (!canSubmit) return
    onSubmit({
      scope: scope.trim(),
      constraints,
      requestedRouting: toRequestedRouting(nextRouting),
      ...(selectedPack
        ? {
            scopePackId: selectedPack.packId,
            scopePackVersion: selectedPack.version,
            scopePackPhaseId: selectedPhaseId || selectedPack.currentPhaseId || undefined,
            staleAcknowledged: staleAck || undefined,
          }
        : {}),
    })
  }

  const chooseFile = async (file: File | undefined) => {
    setImportError(null)
    setParsedDraft(null)
    if (!file) return
    const rejected = rejectScopePackSource({ filename: file.name, byteLength: file.size })
    if (rejected) {
      setImportError(rejected.message)
      return
    }
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (bytes.byteLength > SCOPE_PACK_MAX_SOURCE_BYTES) {
      setImportError(`Handoff files must be ${SCOPE_PACK_MAX_SOURCE_BYTES / 1024} KB or smaller.`)
      return
    }
    const hash = await sha256Hex(bytes)
    const text = new TextDecoder().decode(bytes)
    const parsed = parseHandoffDocument({ filename: file.name, sourceHash: hash, text, byteLength: bytes.byteLength })
    if (!parsed.ok) {
      setImportError(parsed.message)
      return
    }
    setFileLabel(file.name)
    setParsedDraft(parsed.draft)
    setUnmapped(parsed.unmappedSectionNames)
  }

  const saveImport = async () => {
    if (!parsedDraft || !onImportScopePack) return
    const result = await onImportScopePack(parsedDraft)
    if (result?.packId) {
      setSelectedPackId(result.packId)
      setSelectedPhaseId(parsedDraft.currentPhaseId ?? parsedDraft.roadmapPhases[0]?.id ?? '')
      setImportMode(false)
      setParsedDraft(null)
    }
  }

  return <div className="ct-composer">
    <TowerPanel title="New Run" className="ct-composer-panel" modal action={<button type="button" className="ct-composer-cancel" onClick={onCancel}>Cancel</button>}>
      <p className="ct-composer-intro">Describe the work. The local Host Architect reads this repository and proposes a plan for your review. Nothing executes until you approve the plan.</p>
      <section className="ct-scope-pack" aria-label="Scope Pack">
        <span className="ct-eyebrow">Scope Pack · optional</span>
        {surface === 'preview' && <p className="ct-preview-scope-label">{PREVIEW_SCOPE_PACK_LABEL}</p>}
        <div className="ct-scope-pack-actions">
          <label className="ct-composer-field">
            <span className="ct-eyebrow">Select existing</span>
            <select aria-label="Select Scope Pack" value={selectedPackId} onChange={event => {
              setSelectedPackId(event.target.value)
              const next = visiblePacks.find(pack => pack.packId === event.target.value)
              setSelectedPhaseId(next?.currentPhaseId ?? '')
              setReviewOpen(false)
            }}>
              <option value="">None — ordinary New Run</option>
              {visiblePacks.map(pack => <option key={pack.packId} value={pack.packId}>{pack.title} · v{pack.version} · {pack.reconciliationState}</option>)}
            </select>
          </label>
          {surface === 'live' && <button type="button" className="ct-secondary" onClick={() => { setImportMode(open => !open); setImportError(null) }}>Import handoff</button>}
        </div>
        {visiblePacks.length > 0 && <ul className="ct-scope-pack-list" aria-label="Scope Pack list">
          {visiblePacks.map(pack => <li key={pack.packId}>
            <strong>{pack.title}</strong>
            <span>{pack.currentPhaseTitle ?? 'No phase'} · {pack.reconciliationState} · {pack.historicalCheckpoint ?? 'no checkpoint'} · {pack.lastReconciledAt ? pack.lastReconciledAt.slice(0, 10) : 'never reconciled'} · v{pack.version}</span>
          </li>)}
        </ul>}
        {importWarning && <p className="ct-scope-warning" role="status">{importWarning}</p>}
        {importMode && <div className="ct-scope-import">
          <label className="ct-composer-field">
            <span className="ct-eyebrow">Choose .md or .txt</span>
            <input aria-label="Import handoff file" type="file" accept=".md,.txt,text/markdown,text/plain" onChange={event => { void chooseFile(event.target.files?.[0]) }} />
            <span className="ct-field-note">Parsed locally. Raw file text is never stored. Max {SCOPE_PACK_MAX_SOURCE_BYTES / 1024} KB.</span>
          </label>
          {importError && <p className="ct-scope-error" role="alert">{importError}</p>}
          {parsedDraft && <div className="ct-scope-preview" aria-label="Import preview">
            <p><strong>Title</strong> <input aria-label="Imported title" value={parsedDraft.title} onChange={event => setParsedDraft({ ...parsedDraft, title: event.target.value })} /></p>
            <p><strong>Historical checkpoint</strong> {parsedDraft.historicalCheckpoint ?? 'None'}</p>
            <p><strong>Product goal</strong></p>
            <textarea aria-label="Imported intent" value={parsedDraft.intent} onChange={event => setParsedDraft({ ...parsedDraft, intent: event.target.value })} rows={3} />
            <p>Foundation claims · {parsedDraft.foundationClaims.length}</p>
            <p><strong>Locked rules</strong></p>
            <textarea aria-label="Imported locked rules" value={parsedDraft.lockedRules.join('\n')} onChange={event => setParsedDraft({ ...parsedDraft, lockedRules: event.target.value.split('\n').map(line => line.trim()).filter(Boolean) })} rows={3} />
            <p><strong>Do-not-touch</strong></p>
            <textarea aria-label="Imported do-not-touch" value={parsedDraft.doNotTouch.join('\n')} onChange={event => setParsedDraft({ ...parsedDraft, doNotTouch: event.target.value.split('\n').map(line => line.trim()).filter(Boolean) })} rows={3} />
            <p><strong>Roadmap phases</strong></p>
            {parsedDraft.roadmapPhases.map((phase, index) => <label key={phase.id} className="ct-composer-field">
              <span>{phase.id}</span>
              <input aria-label={`Phase title ${phase.id}`} value={phase.title} onChange={event => {
                const roadmapPhases = parsedDraft.roadmapPhases.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item)
                setParsedDraft({ ...parsedDraft, roadmapPhases })
              }} />
              <textarea aria-label={`Phase goal ${phase.id}`} value={phase.goal} onChange={event => {
                const roadmapPhases = parsedDraft.roadmapPhases.map((item, itemIndex) => itemIndex === index ? { ...item, goal: event.target.value } : item)
                setParsedDraft({ ...parsedDraft, roadmapPhases })
              }} rows={2} />
            </label>)}
            <p>Acceptance · {parsedDraft.acceptanceCriteria.length}{parsedDraft.runtimeAcceptanceRequired ? ' · runtime required' : ''}</p>
            {unmapped.length > 0 && <p className="ct-field-note">Unmapped sections (preview only): {unmapped.join(', ')}</p>}
            <p className="ct-field-note">{fileLabel} · SHA-256 {parsedDraft.sourceHash.slice(0, 12)}…</p>
            <div className="ct-scope-import-actions">
              <button type="button" className="ct-secondary" onClick={() => { setImportMode(false); setParsedDraft(null) }}>Cancel import</button>
              <button type="button" className="ct-primary" disabled={importing || !onImportScopePack} onClick={() => { void saveImport() }}>Save Scope Pack</button>
            </div>
          </div>}
        </div>}
        {selectedList && <div className="ct-scope-summary" aria-label="Selected Scope Pack summary">
          <p><strong>{selectedList.title}</strong></p>
          <p>Phase · {selectedList.currentPhaseTitle ?? 'Select a phase'} · {selectedList.reconciliationState} · {selectedList.historicalCheckpoint ?? 'no checkpoint'} · {selectedPack?.lockedRules.length ?? 0} locked · {selectedPack?.doNotTouch.length ?? 0} do-not-touch · last {selectedList.lastReconciledAt ? selectedList.lastReconciledAt.slice(0, 10) : 'never'}</p>
          {selectedPack && <label className="ct-composer-field">
            <span className="ct-eyebrow">Select phase</span>
            <select aria-label="Select Scope Pack phase" value={selectedPhaseId} onChange={event => setSelectedPhaseId(event.target.value)}>
              <option value="">Choose a phase</option>
              {selectedPack.roadmapPhases.map(phase => <option key={phase.id} value={phase.id}>{phase.title} · {phase.executionIntent}</option>)}
            </select>
          </label>}
          {selectedPack?.reconciliationState === 'stale' && <label className="ct-scope-ack"><input type="checkbox" aria-label="Acknowledge stale Scope Pack" checked={staleAck} onChange={event => setStaleAck(event.target.checked)} /> Acknowledge stale foundation before implementation.</label>}
          <div className="ct-scope-pack-actions">
            <button type="button" className="ct-secondary" onClick={() => setReviewOpen(open => !open)}>Review pack</button>
          </div>
          {reviewOpen && selectedPack && <ScopePackReview pack={selectedPack} selectedPhaseId={selectedPhaseId} />}
        </div>}
      </section>
      <label className="ct-composer-field">
        <span className="ct-eyebrow">Owner scope</span>
        <textarea aria-label="Owner scope" value={scope} onChange={event => setScope(event.target.value)} rows={5} maxLength={SCOPE_MAX_CHARS + 1} placeholder="Example: Create a candidate file at agent-host/smoke/control-tower-ui-e2e.txt with exact contents CONTROL_TOWER_UI_E2E_OK v1. Do not modify any other file." />
        <span className="ct-field-note">{scopeError ?? `${scope.length}/${SCOPE_MAX_CHARS} characters`}</span>
      </label>
      <label className="ct-composer-field">
        <span className="ct-eyebrow">Constraints · one per line (optional)</span>
        <textarea aria-label="Owner constraints" value={constraintsText} onChange={event => setConstraintsText(event.target.value)} rows={3} placeholder={'Do not modify any other file.\nDo not commit or push.'} />
        <span className="ct-field-note">{constraintsError ?? `${constraints.length}/${CONSTRAINTS_MAX} constraints`}</span>
      </label>
      <div className="ct-composer-rogrid">
        <div className="ct-composer-readonly">
          <span className="ct-eyebrow">Repository · read-only</span>
          <p className="ct-repo-key" title="Host-reported repository key">{presence.repoKey ?? 'No connected Host'}</p>
          <span className="ct-field-note">Set by the local Host. You cannot choose a different repository here.</span>
        </div>
        <div className="ct-composer-team">
          <span className="ct-eyebrow">Team roles</span>
          <ul>
            <li><strong>Architect</strong> reads the repository and proposes the plan (read-only).</li>
            <li><strong>Implementer</strong> executes approved tasks in an isolated copy.</li>
            <li><strong>Verifier</strong> independently checks the result (read-only).</li>
          </ul>
          <span className="ct-field-note">The fixed relay — provider preference does not change these roles.</span>
        </div>
      </div>
      <details className="ct-composer-advanced" open={advancedOpen} onToggle={event => setAdvancedOpen((event.target as HTMLDetailsElement).open)}>
        <summary>Advanced · Next Run Routing</summary>
        <div className="ct-composer-advanced-body">
          <NextRunRoutingControls
            fleet={surface === 'preview' ? PREVIEW_PROVIDER_FLEET : presence.providerFleet}
            routing={nextRouting}
            onChange={(next) => { setNextRouting(next); onRoutingChange?.(next) }}
          />
        </div>
      </details>
      <div className="ct-composer-actions">
        <button type="button" className="ct-primary" disabled={!canSubmit} onClick={submit} aria-label="Request plan"><Plus size={14} aria-hidden="true" />Request plan</button>
        <span className="ct-field-note">{presence.state === 'connected' ? (selectedPackId ? 'Reconcile / Continue to plan using the selected Scope Pack.' : 'Sent to the local Host as a typed create_plan request.') : 'Waiting for a connected local Host.'}</span>
      </div>
    </TowerPanel>
  </div>
}
