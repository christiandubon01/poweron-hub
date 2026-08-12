/**
 * ServiceCallModalLayout.tsx — SERVICE-CALL-UI-2B
 *
 * ONE shared dual-compartment shell for the New / Edit Service Call modal.
 * New and Edit already open the same canonical form (SERVICE-LOG-1), so this
 * component is the single shell both modes render — there is no second copy to
 * drift from.
 *
 * It owns ONLY the shell:
 *   overlay (backdrop-click close, dialog semantics)
 *   modal card in the Service ORANGE identity
 *   header (orange clipboard chip, title, subtitle, close ✕)
 *   the LEFT / RIGHT compartment grid and their scroll regions
 *   the single shared footer (Cancel · Save/Update Service Call)
 *
 * It owns NO service quote math, NO payment math, NO crew costing, NO form
 * state and NO persistence. Callers pass their existing entry JSX as `left` and
 * their existing costing/pricing JSX as `right`; the layout never inspects
 * either, and never writes.
 *
 * Deliberately NOT ProjectLogModalLayout: Service is a separate workflow with
 * its own orange identity, its own header copy, a backdrop-click close and a
 * disable-able primary action. Only the VISUAL CONTRACT (width, proportions,
 * pinned chrome, independent pane scrolling, stacked narrow layout) is shared,
 * and it is shared by matching it — not by importing Project semantics.
 *
 * Scroll contract: on wide layouts the two compartments scroll independently
 * (the body itself does not scroll), so reading the costing side never moves
 * the form and vice versa. Below the breakpoint the compartments stack and the
 * body owns the single scrollbar. Header and footer are flex-none in both
 * cases, so Save/Update is always reachable.
 */

import React from 'react'
import { ClipboardList } from 'lucide-react'

/** Both modes share one subtitle — the mode is carried by the title alone. */
export const SERVICE_CALL_MODAL_SUBTITLE =
  'Work performed and collected — Total Quoted is the customer amount'

export default function ServiceCallModalLayout({
  mode,
  onClose,
  onSave,
  saveDisabled = false,
  saveTitle,
  left,
  right,
}: {
  mode: 'new' | 'edit'
  onClose: () => void
  onSave: () => void
  saveDisabled?: boolean
  saveTitle?: string
  left: React.ReactNode
  right: React.ReactNode
}) {
  const isEdit = mode === 'edit'
  const title = isEdit ? 'Edit Service Call' : 'New Service Call'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      data-testid="service-call-modal"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{ backgroundColor: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="relative flex flex-col rounded-2xl shadow-2xl"
        style={{
          // Matches the Project Log dual-compartment benchmark: substantially
          // wider than the old single column, never edge-to-edge.
          width: 'min(94vw, 1560px)',
          maxHeight: '92vh',
          backgroundColor: 'var(--bg-card)',
          border: '1px solid rgba(249,115,22,0.35)',
          overflow: 'hidden',
        }}
      >
        {/* ── HEADER — spans the full modal width ─────────────────────────── */}
        <div
          className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-orange-700/30 flex-shrink-0"
          data-testid="service-call-modal-header"
        >
          <div className="flex items-center gap-3 min-w-0">
            <span
              className="flex items-center justify-center w-9 h-9 rounded-xl flex-shrink-0"
              style={{ backgroundColor: 'rgba(249,115,22,0.15)', border: '1px solid rgba(249,115,22,0.35)' }}
            >
              <ClipboardList size={18} style={{ color: '#f97316' }} />
            </span>
            <div className="min-w-0">
              <h2 className="text-lg sm:text-xl font-bold text-white truncate">{title}</h2>
              <p className="text-xs sm:text-sm text-gray-400 mt-0.5">{SERVICE_CALL_MODAL_SUBTITLE}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-gray-500 hover:text-white transition-colors text-lg leading-none px-2"
          >✕</button>
        </div>

        {/* ── BODY — two compartments side by side on wide, stacked below ─── */}
        <div
          className="relative flex min-h-0 flex-1 flex-col overflow-y-auto xl:flex-row xl:overflow-hidden"
          data-testid="service-call-modal-body"
        >
          <div
            className="flex-none px-4 sm:px-6 py-5 space-y-4 xl:min-h-0 xl:w-[44%] xl:overflow-y-auto"
            data-testid="service-call-modal-left"
          >
            {left}
          </div>

          <div
            className="flex-none border-t border-orange-700/30 px-4 sm:px-6 py-5 space-y-4 xl:min-h-0 xl:w-[56%] xl:overflow-y-auto xl:border-l xl:border-t-0"
            data-testid="service-call-modal-right"
          >
            {right}
          </div>
        </div>

        {/* ── FOOTER — one shared footer, always visible ──────────────────── */}
        <div
          className="flex items-center justify-between px-4 sm:px-8 py-4 border-t border-orange-700/30 flex-shrink-0"
          style={{ backgroundColor: 'var(--bg-secondary)' }}
          data-testid="service-call-modal-footer"
        >
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs text-gray-400 hover:text-white border border-gray-600 hover:border-gray-400 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={saveDisabled}
            title={saveTitle}
            data-testid="save-service-call"
            className={`flex items-center gap-2 px-5 py-2 rounded-lg text-white text-xs font-bold transition-colors shadow-lg ${saveDisabled ? 'bg-gray-600 opacity-50 cursor-not-allowed' : 'bg-orange-600 hover:bg-orange-500'}`}
          >
            {isEdit ? '✓ Update Service Call' : '✓ Save Service Call'}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Section heading for either compartment. Keeps the two sides visually parallel
 * without inventing a new panel language — same orange rule the modal already
 * uses, at a readable 10px cap-height label.
 */
export function ServiceCallSection({
  title,
  note,
  children,
}: {
  title: string
  note?: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-gray-700/50 p-3 sm:p-4 space-y-3" style={{ backgroundColor: 'var(--bg-input)' }}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-[10px] font-bold uppercase tracking-[0.16em] text-orange-300/80">{title}</h3>
        {note && <span className="text-[10px] text-gray-500">{note}</span>}
      </div>
      {children}
    </section>
  )
}
