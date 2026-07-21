import { useEffect, useMemo } from 'react'
import { AlertTriangle, Check, ChevronDown, ChevronUp, GitBranch, Loader2, RotateCcw, Trash2, X } from 'lucide-react'
import {
  ROUTE_BUILDER_CHANNEL_OPTIONS,
  clearPackageAnimationRouteDraft,
  finishPackageAnimationRouteBranch,
  getPackageAnimationBranchList,
  getPackageAnimationRouteList,
  movePackageAnimationRouteTransition,
  removePackageAnimationRouteTransition,
  removePackageAnimationRouteBranch,
  resolvePackageAnimationRouteDraft,
  setPackageAnimationRouteBranchMode,
  startPackageAnimationRouteBranch,
  undoPackageAnimationRouteSelection,
  updatePackageAnimationRouteChannel,
  validatePackageAnimationRouteDraft,
  type PackageAnimationRouteDraft,
} from './routeBuilderModel'
import type { BlueprintAnimationChannelType } from './types'

export interface PackageAnimationRouteConflict {
  message: string
  latestRevision?: number
}

export interface PackageAnimationRouteBuilderProps {
  draft: PackageAnimationRouteDraft
  saving: boolean
  conflict?: PackageAnimationRouteConflict
  onDraftChange(draft: PackageAnimationRouteDraft): void
  onCancel(): void
  onSave(): void
  onReloadLatest?(): void
  onKeepDraftOpen?(): void
}

function confirmDiscard(draft: PackageAnimationRouteDraft): boolean {
  return !draft.dirty || typeof window === 'undefined' || window.confirm('Discard the unsaved animation route changes?')
}

export function PackageAnimationRouteBuilder({
  draft,
  saving,
  conflict,
  onDraftChange,
  onCancel,
  onSave,
  onReloadLatest,
  onKeepDraftOpen,
}: PackageAnimationRouteBuilderProps) {
  const entries = useMemo(() => getPackageAnimationRouteList(draft), [draft])
  const branchEntries = useMemo(() => getPackageAnimationBranchList(draft), [draft])
  const resolved = useMemo(() => resolvePackageAnimationRouteDraft(draft), [draft])
  const validation = useMemo(() => validatePackageAnimationRouteDraft(draft), [draft])
  const blocking = validation.filter((entry) => entry.severity === 'error')
  const warnings = validation.filter((entry) => entry.severity === 'warning')
  const readOnly = !!draft.readOnlyReason
  const instruction = readOnly
    ? draft.readOnlyReason
    : !draft.source
      ? 'Select one supported control or sensor on the blueprint.'
      : draft.branch?.editing
        ? 'Select the alternate branch in travel order until it rejoins a later primary-route node.'
        : 'Select connected Circuit Path/Arc segments in travel order, or select a package device for a confirmed direct transition.'

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const target = event.target as HTMLElement | null
      if (target?.tagName === 'INPUT' || target?.tagName === 'SELECT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) return
      event.preventDefault()
      event.stopPropagation()
      if (confirmDiscard(draft)) onCancel()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [draft, onCancel])

  const cancel = () => {
    if (confirmDiscard(draft)) onCancel()
  }

  const clearDraft = () => {
    if (draft.source && typeof window !== 'undefined' && !window.confirm('Clear the entire route draft, including its source?')) return
    onDraftChange(clearPackageAnimationRouteDraft(draft))
  }

  const move = (selectionId: string, direction: 'up' | 'down') => {
    onDraftChange(movePackageAnimationRouteTransition(draft, selectionId, direction).draft)
  }

  return (
    <aside
      className="fixed inset-x-2 bottom-2 z-[100003] flex max-h-[46dvh] flex-col rounded-xl border border-cyan-500/45 bg-[#0b1220]/[0.98] shadow-2xl backdrop-blur-sm lg:inset-x-auto lg:bottom-4 lg:right-4 lg:top-20 lg:w-[370px] lg:max-h-none"
      aria-label="Package animation route builder"
      aria-live="polite"
    >
      <div className="flex items-start justify-between gap-3 border-b border-gray-800 px-3 py-2.5">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-cyan-300">Animation Route</div>
          <div className="truncate text-sm font-semibold text-gray-100">{draft.packageName}</div>
          <div className="mt-1 text-[11px] leading-4 text-gray-400">{instruction}</div>
        </div>
        <button type="button" onClick={cancel} className="rounded p-1.5 text-gray-400 hover:bg-white/10 hover:text-white" aria-label="Cancel animation route builder">
          <X size={15} />
        </button>
      </div>

      {draft.notice && (
        <div className={`mx-3 mt-2 rounded border px-2 py-1.5 text-[11px] ${draft.notice.severity === 'error' ? 'border-red-700/60 bg-red-950/45 text-red-200' : 'border-amber-600/60 bg-amber-950/40 text-amber-200'}`} role="status">
          {draft.notice.message}
        </div>
      )}

      {conflict && (
        <div className="mx-3 mt-2 rounded border border-amber-500/60 bg-amber-950/45 p-2 text-[11px] text-amber-100" role="alert">
          <div className="flex items-start gap-1.5"><AlertTriangle size={13} className="mt-0.5 shrink-0" /><span>{conflict.message}{conflict.latestRevision != null ? ` Latest known revision: ${conflict.latestRevision}.` : ''}</span></div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {onReloadLatest && <button type="button" onClick={onReloadLatest} className="rounded border border-amber-400/50 px-2 py-1 font-semibold hover:bg-amber-500/15">Reload Latest</button>}
            {onKeepDraftOpen && <button type="button" onClick={onKeepDraftOpen} className="rounded border border-gray-600 px-2 py-1 text-gray-200 hover:bg-white/5">Keep Draft Open</button>}
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-3">
        <section className="rounded-lg border border-gray-800 bg-gray-950/45 p-2">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Source</div>
              <div className={`mt-0.5 text-xs ${draft.source ? 'text-gray-100' : 'italic text-gray-500'}`}>
                {entries[0]?.isSource ? entries[0].label : 'Not selected'}
              </div>
            </div>
            {draft.source && !readOnly && (
              <div className="flex gap-1">
                {!draft.branch && draft.transitions.length > 0 && <button type="button" onClick={() => onDraftChange(startPackageAnimationRouteBranch(draft, 'source'))} className="inline-flex items-center gap-1 rounded border border-cyan-700 px-2 py-1 text-[10px] text-cyan-200 hover:bg-cyan-950/50"><GitBranch size={10} /> Branch here</button>}
                <button type="button" onClick={clearDraft} className="rounded border border-gray-700 px-2 py-1 text-[10px] text-gray-300 hover:bg-white/5" aria-label="Clear source and route">Clear Source</button>
              </div>
            )}
          </div>
        </section>

        <section className="flex min-h-0 flex-1 flex-col rounded-lg border border-gray-800 bg-gray-950/35">
          <div className="flex items-center justify-between border-b border-gray-800 px-2 py-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Ordered Route</div>
            <span className="rounded-full bg-cyan-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-cyan-200">{draft.transitions.length} steps</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2 overscroll-contain">
            {draft.transitions.length === 0 && <div className="py-4 text-center text-[11px] italic text-gray-600">No route segments selected yet.</div>}
            <div className="space-y-1.5">
              {entries.filter((entry) => !entry.isSource).map((entry, index) => (
                <div key={entry.id} className="rounded border border-gray-800 bg-gray-900/55 p-2">
                  <div className="flex items-start gap-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-cyan-500 text-[10px] font-bold text-cyan-950">{index + 2}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[11px] font-medium text-gray-100">{entry.label}</div>
                      <div className="text-[9px] text-gray-500">{entry.typeLabel}</div>
                    </div>
                    {!readOnly && (
                      <div className="flex shrink-0 items-center gap-0.5">
                        {!draft.branch && index < draft.transitions.length - 1 && <button type="button" onClick={() => onDraftChange(startPackageAnimationRouteBranch(draft, entry.id))} className="rounded p-1 text-cyan-300 hover:bg-cyan-950/50" aria-label={`Start branch after ${entry.label}`}><GitBranch size={12} /></button>}
                        <button type="button" onClick={() => move(entry.id, 'up')} disabled={index === 0} className="rounded p-1 text-gray-400 hover:bg-white/10 disabled:opacity-25" aria-label={`Move ${entry.label} up`}><ChevronUp size={12} /></button>
                        <button type="button" onClick={() => move(entry.id, 'down')} disabled={index === draft.transitions.length - 1} className="rounded p-1 text-gray-400 hover:bg-white/10 disabled:opacity-25" aria-label={`Move ${entry.label} down`}><ChevronDown size={12} /></button>
                        <button type="button" onClick={() => onDraftChange(removePackageAnimationRouteTransition(draft, entry.id))} className="rounded p-1 text-red-400 hover:bg-red-950/50" aria-label={`Remove ${entry.label}`}><Trash2 size={12} /></button>
                      </div>
                    )}
                  </div>
                  <label className="mt-1.5 flex items-center gap-2 text-[9px] text-gray-500">
                    Channel
                    <select
                      value={entry.channel}
                      disabled={readOnly}
                      onChange={(event) => onDraftChange(updatePackageAnimationRouteChannel(draft, entry.id, event.target.value as BlueprintAnimationChannelType))}
                      className="min-w-0 flex-1 rounded border border-gray-700 bg-gray-950 px-1.5 py-1 text-[10px] text-gray-200 outline-none focus:border-cyan-500 disabled:opacity-60"
                      aria-label={`Electrical channel for ${entry.label}`}
                    >
                      {ROUTE_BUILDER_CHANNEL_OPTIONS.map((channel) => <option key={channel.value} value={channel.value}>{channel.label}</option>)}
                    </select>
                  </label>
                </div>
              ))}
            </div>
          </div>
        </section>

        {draft.branch && (
          <section className="rounded-lg border border-cyan-800/70 bg-cyan-950/20 p-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-300"><GitBranch size={12} /> Alternate branch</div>
              <button type="button" onClick={() => onDraftChange(removePackageAnimationRouteBranch(draft))} className="rounded p-1 text-red-400 hover:bg-red-950/50" aria-label="Remove alternate branch"><Trash2 size={12} /></button>
            </div>
            <label className="mt-2 flex items-center gap-2 text-[9px] text-gray-400">
              Schedule
              <select value={draft.branch.mode} disabled={readOnly} onChange={(event) => onDraftChange(setPackageAnimationRouteBranchMode(draft, event.target.value as 'simultaneous' | 'sequential'))} className="min-w-0 flex-1 rounded border border-gray-700 bg-gray-950 px-1.5 py-1 text-[10px] text-gray-200">
                <option value="simultaneous">Together</option>
                <option value="sequential">Sequential</option>
              </select>
            </label>
            <div className="mt-2 space-y-1">
              {branchEntries.length === 0 && <div className="py-2 text-center text-[10px] italic text-gray-500">Select the first alternate segment on the canvas.</div>}
              {branchEntries.map((entry) => (
                <div key={entry.id} className="flex items-center gap-2 rounded border border-gray-800 bg-gray-950/60 p-1.5">
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-cyan-700 text-[9px] font-bold text-white">{entry.number}</span>
                  <div className="min-w-0 flex-1"><div className="truncate text-[10px] text-gray-100">{entry.label}</div><div className="text-[9px] text-gray-500">{entry.typeLabel}</div></div>
                  <button type="button" onClick={() => onDraftChange(removePackageAnimationRouteTransition(draft, entry.id))} className="rounded p-1 text-red-400 hover:bg-red-950/50" aria-label={`Remove ${entry.label}`}><Trash2 size={11} /></button>
                </div>
              ))}
            </div>
            {draft.branch.editing ? (
              <button type="button" disabled={!resolved.branchConvergenceNodeId} onClick={() => onDraftChange(finishPackageAnimationRouteBranch(draft))} className="mt-2 w-full rounded border border-cyan-600 px-2 py-1.5 text-[10px] font-semibold text-cyan-100 hover:bg-cyan-900/40 disabled:opacity-35">Finish branch after rejoin</button>
            ) : (
              <div className="mt-2 flex items-center gap-1 text-[10px] text-emerald-300"><Check size={11} /> Rejoins the primary route</div>
            )}
          </section>
        )}

        <section className={`rounded-lg border p-2 ${blocking.length > 0 ? 'border-red-800/60 bg-red-950/25' : 'border-emerald-800/50 bg-emerald-950/20'}`} aria-live="assertive">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide">
            {blocking.length > 0 ? <><AlertTriangle size={12} className="text-red-400" /><span className="text-red-300">Needs attention</span></> : <><Check size={12} className="text-emerald-400" /><span className="text-emerald-300">Valid</span></>}
          </div>
          {(blocking.length > 0 || warnings.length > 0) && (
            <ul className="mt-1 max-h-20 space-y-0.5 overflow-y-auto pl-4 text-[10px] leading-4 text-gray-300">
              {[...blocking, ...warnings].slice(0, 8).map((entry, index) => <li key={`${entry.code}-${index}`} className={entry.severity === 'error' ? 'text-red-200' : 'text-amber-200'}>{entry.message}</li>)}
            </ul>
          )}
        </section>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-800 px-3 py-2.5">
        <div className="flex gap-1.5">
          <button type="button" onClick={() => onDraftChange(undoPackageAnimationRouteSelection(draft))} disabled={readOnly || (!draft.source && draft.transitions.length === 0)} className="inline-flex min-h-9 items-center gap-1 rounded border border-gray-700 px-2 text-[10px] text-gray-300 hover:bg-white/5 disabled:opacity-35"><RotateCcw size={11} /> Undo Last</button>
          <button type="button" onClick={clearDraft} disabled={readOnly || (!draft.source && draft.transitions.length === 0)} className="min-h-9 rounded border border-gray-700 px-2 text-[10px] text-gray-300 hover:bg-white/5 disabled:opacity-35">Clear Draft</button>
        </div>
        <div className="flex gap-1.5">
          <button type="button" onClick={cancel} className="min-h-9 rounded border border-gray-700 px-3 text-[10px] text-gray-300 hover:bg-white/5">Cancel</button>
          <button type="button" onClick={onSave} disabled={readOnly || saving || blocking.length > 0} className="inline-flex min-h-9 items-center gap-1.5 rounded bg-cyan-600 px-3 text-[10px] font-semibold text-white hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-40">
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Save Route
          </button>
        </div>
      </div>
    </aside>
  )
}

export default PackageAnimationRouteBuilder
