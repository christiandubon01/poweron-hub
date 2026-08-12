/**
 * ProjectLogModalLayout.tsx — PROJECT-LOG-UI-2B
 *
 * ONE shared dual-compartment shell for BOTH the New Project Log modal
 * (V15rFieldLogPanel) and the Edit Project Log modal (V15rProjectLogsTab).
 * Neither caller keeps its own copy of the overlay, header, grid or footer, so
 * the two modes cannot drift structurally.
 *
 * It owns ONLY the shell:
 *   overlay + modal card + glare
 *   header (clipboard icon, title, subtitle, close X)
 *   the LEFT / RIGHT compartment grid and their scroll regions
 *   the single shared footer (Cancel · Save/Update)
 *
 * It owns NO financial formula and NO form state. Callers pass their existing
 * field-entry content as `left` and the shared ProjectLogFinancialPanel as
 * `right`; the layout never inspects either.
 *
 * Scroll contract: on wide layouts the two compartments scroll independently
 * (the body itself does not scroll), so inspecting financial detail never moves
 * the form and vice versa. Below the breakpoint the compartments stack and the
 * body owns the single scrollbar. Header and footer are flex-none in both
 * cases, so Save/Update is always reachable.
 */

import React from 'react'
import { ClipboardList, X } from 'lucide-react'

/** Both modes share one subtitle — the mode is carried by the title alone. */
export const PROJECT_LOG_MODAL_SUBTITLE =
  'Log labor, materials, mileage, collection, and work performed.'

export default function ProjectLogModalLayout({
  mode,
  onClose,
  onSave,
  left,
  right,
}: {
  mode: 'new' | 'edit'
  onClose: () => void
  onSave: () => void
  left: React.ReactNode
  right: React.ReactNode
}) {
  const isEdit = mode === 'edit'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
      data-testid="project-log-modal"
    >
      <div
        className="relative flex flex-col overflow-hidden rounded-2xl shadow-2xl"
        style={{
          // Substantially wider than the old single column, but never
          // edge-to-edge — 3vw of backdrop stays visible on each side.
          width: 'min(94vw, 1560px)',
          maxHeight: '92vh',
          background: 'linear-gradient(145deg, rgba(15,23,42,0.98) 0%, rgba(8,31,47,0.98) 48%, rgba(2,16,28,0.99) 100%)',
          border: '1px solid rgba(45,212,191,0.28)',
          boxShadow: '0 28px 80px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.06), inset 0 0 70px rgba(20,184,166,0.08)',
        }}
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-50"
          style={{
            background: 'linear-gradient(115deg, transparent 0%, rgba(45,212,191,0.07) 32%, transparent 58%)',
            animation: 'projectLogModalGlare 9s ease-in-out infinite',
          }}
        />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-cyan-300/10 to-transparent" />

        {/* ── HEADER — spans the full modal width ─────────────────────────── */}
        <div
          className="relative flex flex-shrink-0 items-center justify-between border-b border-cyan-300/10 px-6 py-5"
          data-testid="project-log-modal-header"
        >
          <div className="flex items-center gap-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-emerald-300/25 bg-emerald-400/10 text-emerald-300 shadow-lg shadow-emerald-950/30">
              <ClipboardList size={20} />
            </div>
            <div>
              <h2 className="text-2xl font-bold tracking-normal text-white">
                {isEdit ? 'Edit Project Log' : 'New Project Log'}
              </h2>
              <p className="mt-1 text-sm text-cyan-100/58">{PROJECT_LOG_MODAL_SUBTITLE}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg border border-white/10 bg-white/5 p-2 text-slate-400 transition-colors hover:border-cyan-300/30 hover:bg-cyan-300/10 hover:text-white"
            aria-label="Close project log modal"
          >
            <X size={18} />
          </button>
        </div>

        {/* ── BODY — two compartments side by side on wide, stacked below ─── */}
        <div
          className="relative flex min-h-0 flex-1 flex-col overflow-y-auto xl:flex-row xl:overflow-hidden"
          data-testid="project-log-modal-body"
        >
          <div
            className="flex-none px-5 py-5 xl:min-h-0 xl:w-[44%] xl:overflow-y-auto"
            data-testid="project-log-modal-left"
          >
            <div className="space-y-4">{left}</div>
          </div>

          <div
            className="flex-none border-t border-cyan-300/10 px-5 py-5 xl:min-h-0 xl:w-[56%] xl:overflow-y-auto xl:border-l xl:border-t-0"
            data-testid="project-log-modal-right"
          >
            {right}
          </div>
        </div>

        {/* ── FOOTER — one shared footer, always visible ──────────────────── */}
        <div
          className="relative flex flex-shrink-0 items-center justify-between border-t border-cyan-300/10 bg-slate-950/70 px-8 py-5 shadow-[0_-18px_34px_rgba(2,6,23,0.35)]"
          data-testid="project-log-modal-footer"
        >
          <button
            onClick={onClose}
            className="rounded-lg border border-white/12 bg-white/[0.03] px-4 py-2 text-xs font-semibold text-slate-300 transition-colors hover:border-white/25 hover:bg-white/[0.06] hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            className="flex items-center gap-2 rounded-lg border border-emerald-300/35 bg-gradient-to-r from-emerald-600 to-teal-500 px-5 py-2 text-xs font-bold text-white shadow-lg shadow-emerald-950/35 transition-all hover:from-emerald-500 hover:to-teal-400"
          >
            {isEdit ? 'Update Log' : 'Save Log'}
          </button>
        </div>

        <style>{`
          @keyframes projectLogModalGlare {
            0%, 100% { transform: translateX(-22%); opacity: 0.28; }
            50% { transform: translateX(18%); opacity: 0.48; }
          }
        `}</style>
      </div>
    </div>
  )
}
