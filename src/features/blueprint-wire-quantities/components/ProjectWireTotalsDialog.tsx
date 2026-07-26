import { X } from 'lucide-react'
import { WireQuantitySummary } from './WireQuantitySummary'
import type { WireQuantityResult } from '../types'

export function ProjectWireTotalsDialog({
  result,
  onClose,
}: {
  result: WireQuantityResult
  onClose(): void
}) {
  const duplicateCount = result.diagnostics.filter((diagnostic) => diagnostic.type === 'duplicate-package-membership').length
  const unpackagedCount = result.contributions.filter((contribution) => contribution.isUnpackaged).length
  const calibrationCount = result.diagnostics.filter((diagnostic) => (
    diagnostic.type === 'uncalibrated-segment'
    || diagnostic.type === 'not-to-scale-page'
    || diagnostic.type === 'ambiguous-scale-page'
  )).length

  return (
    <div className="fixed inset-0 z-[100002] flex items-center justify-center bg-black/70 px-4" onMouseDown={(e) => e.stopPropagation()}>
      <div className="max-h-[88vh] w-full max-w-5xl overflow-hidden rounded-xl border border-gray-700 bg-[#111827] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-gray-800 px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-gray-100">Project Wire Totals</div>
            <div className="mt-0.5 text-xs text-gray-500">Current blueprint set</div>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-white/10 hover:text-gray-200" title="Close" aria-label="Close project wire totals">
            <X size={14} />
          </button>
        </div>
        <div className="max-h-[calc(88vh-58px)] space-y-3 overflow-auto p-4">
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded border border-gray-800 bg-gray-950/40 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-gray-500">Unpackaged</div>
              <div className="mt-1 text-lg font-semibold text-gray-100">{unpackagedCount}</div>
            </div>
            <div className="rounded border border-gray-800 bg-gray-950/40 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-gray-500">Calibration issues</div>
              <div className="mt-1 text-lg font-semibold text-gray-100">{calibrationCount}</div>
            </div>
            <div className="rounded border border-gray-800 bg-gray-950/40 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-gray-500">Duplicate packages</div>
              <div className="mt-1 text-lg font-semibold text-gray-100">{duplicateCount}</div>
            </div>
          </div>
          <WireQuantitySummary totals={result.projectTotals} contributions={result.contributions} diagnostics={result.diagnostics} title="Current Blueprint Set Totals" />
          {result.unpackagedTotals.length > 0 && (
            <WireQuantitySummary totals={result.unpackagedTotals} contributions={result.contributions.filter((contribution) => contribution.isUnpackaged)} title="Unpackaged Contributions" compact />
          )}
        </div>
      </div>
    </div>
  )
}
