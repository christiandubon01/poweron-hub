import { ChevronDown, ChevronRight, X } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { ElectricalSymbolCountSummary } from './ElectricalSymbolCountSummary'
import { ElectricalSymbolGlyph } from './ElectricalSymbolGlyph'
import type { ElectricalSymbolContribution, ElectricalSymbolCountDiagnostic, ElectricalSymbolCountResult } from '../types'

function formatCategory(category: string) {
  return category.charAt(0).toUpperCase() + category.slice(1)
}

export function createElectricalSymbolTotalsEscapeHandler(onClose: () => void) {
  return (event: Pick<KeyboardEvent, 'key'>) => {
    if (event.key === 'Escape') onClose()
  }
}

export function getElectricalSymbolDiagnosticCounts(diagnostics: readonly ElectricalSymbolCountDiagnostic[]) {
  const duplicateCount = diagnostics.filter((diagnostic) => diagnostic.type === 'duplicate-package-membership').length
  const staleCount = diagnostics.filter((diagnostic) => diagnostic.type === 'stale-package-reference').length
  return {
    duplicateCount,
    staleCount,
    otherCount: diagnostics.length - duplicateCount - staleCount,
    totalCount: diagnostics.length,
  }
}

function diagnosticPackageNames(diagnostic: ElectricalSymbolCountDiagnostic) {
  return [...new Set((diagnostic.packageNames || []).map((name) => name.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

export function getGroupedDuplicateMembershipDiagnostics(
  diagnostics: readonly ElectricalSymbolCountDiagnostic[],
  contributions: readonly ElectricalSymbolContribution[],
) {
  const contributionById = new Map(contributions.map((contribution) => [contribution.annotationId, contribution]))
  const grouped = new Map<string, {
    annotationId: string
    displayName: string
    pageNumber?: number
    packageNames: string[]
    shapeKind?: ElectricalSymbolContribution['shapeKind']
    representedCount: number
  }>()

  diagnostics
    .filter((diagnostic) => diagnostic.type === 'duplicate-package-membership')
    .forEach((diagnostic) => {
      const packageNames = diagnosticPackageNames(diagnostic)
      const key = `${diagnostic.annotationId || 'unknown'}::${packageNames.join('|')}`
      const contribution = diagnostic.annotationId ? contributionById.get(diagnostic.annotationId) : undefined
      const existing = grouped.get(key)
      if (existing) {
        existing.representedCount += 1
        return
      }
      grouped.set(key, {
        annotationId: diagnostic.annotationId || 'unknown',
        displayName: contribution?.displayName || diagnostic.shapeKind || 'Electrical symbol',
        pageNumber: contribution?.pageNumber || diagnostic.pageNumber,
        packageNames,
        shapeKind: contribution?.shapeKind,
        representedCount: 1,
      })
    })

  return [...grouped.values()].sort((a, b) => {
    const page = (a.pageNumber || 0) - (b.pageNumber || 0)
    if (page) return page
    const name = a.displayName.localeCompare(b.displayName)
    if (name) return name
    return a.annotationId.localeCompare(b.annotationId)
  })
}

export function getGroupedStaleReferenceDiagnostics(diagnostics: readonly ElectricalSymbolCountDiagnostic[]) {
  return diagnostics
    .filter((diagnostic) => diagnostic.type === 'stale-package-reference')
    .map((diagnostic, index) => ({
      key: `${diagnostic.annotationId || 'unknown'}-${diagnostic.packageId || index}`,
      packageName: diagnostic.packageNames?.[0] || diagnostic.packageId || 'Unknown Work Package',
      pageNumber: diagnostic.pageNumber,
      message: diagnostic.message,
    }))
    .sort((a, b) => a.packageName.localeCompare(b.packageName) || (a.pageNumber || 0) - (b.pageNumber || 0) || a.key.localeCompare(b.key))
}

export function ElectricalSymbolTotalsDialog({
  result,
  onClose,
}: {
  result: ElectricalSymbolCountResult
  onClose(): void
}) {
  const [diagnosticsExpanded, setDiagnosticsExpanded] = useState(false)
  const diagnosticsDetailsId = useId()
  const { duplicateCount, staleCount, otherCount, totalCount } = getElectricalSymbolDiagnosticCounts(result.diagnostics)
  const duplicateDiagnostics = getGroupedDuplicateMembershipDiagnostics(result.diagnostics, result.contributions)
  const staleDiagnostics = getGroupedStaleReferenceDiagnostics(result.diagnostics)

  useEffect(() => {
    const handleKeyDown = createElectricalSymbolTotalsEscapeHandler(onClose)
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[100002] flex items-center justify-center bg-black/70 px-4" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="electrical-symbol-totals-title" tabIndex={-1}>
      <div className="max-h-[88vh] w-full max-w-5xl overflow-hidden rounded-xl border border-gray-700 bg-[#111827] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-gray-800 px-4 py-3">
          <div>
            <div id="electrical-symbol-totals-title" className="text-sm font-semibold text-gray-100">Electrical Symbol Totals</div>
            <div className="mt-0.5 text-xs text-gray-500">Current blueprint set</div>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-white/10 hover:text-gray-200" title="Close" aria-label="Close electrical symbol totals">
            <X size={14} />
          </button>
        </div>
        <div className="max-h-[calc(88vh-58px)] space-y-3 overflow-auto p-4">
          <div className="grid gap-2 sm:grid-cols-4">
            <div className="rounded border border-gray-800 bg-gray-950/40 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-gray-500">Unique symbols</div>
              <div className="mt-1 text-lg font-semibold text-gray-100">{result.overallCount}</div>
            </div>
            <div className="rounded border border-gray-800 bg-gray-950/40 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-gray-500">Symbol types</div>
              <div className="mt-1 text-lg font-semibold text-gray-100">{result.symbolTotals.length}</div>
            </div>
            <div className="rounded border border-gray-800 bg-gray-950/40 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-gray-500">Duplicate packages</div>
              <div className="mt-1 text-lg font-semibold text-gray-100">{duplicateCount}</div>
            </div>
            <div className="rounded border border-gray-800 bg-gray-950/40 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-gray-500">Stale references</div>
              <div className="mt-1 text-lg font-semibold text-gray-100">{staleCount}</div>
            </div>
          </div>

          <section className="rounded-lg border border-gray-800 bg-gray-950/25 p-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-300">Category Subtotals</h3>
            {result.categoryTotals.length === 0 ? (
              <div className="mt-2 rounded border border-gray-800 bg-gray-950/40 px-2 py-2 text-[10px] italic text-gray-500">No registered electrical symbols in this blueprint set.</div>
            ) : (
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {result.categoryTotals.map((total) => (
                  <div key={total.category} className="rounded border border-gray-800 bg-gray-950/40 px-2 py-1.5">
                    <div className="text-[10px] uppercase text-gray-500">{formatCategory(total.category)}</div>
                    <div className="text-sm font-semibold text-gray-100">{total.count}</div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <ElectricalSymbolCountSummary
            totals={result.symbolTotals}
            contributions={result.contributions}
            title="Exact Symbol Totals"
            emptyText="No registered electrical symbols in this blueprint set."
            copy="Current blueprint-set totals count each annotation once, even when it appears in multiple Work Packages."
          />

          <section className="rounded-lg border border-amber-700/40 bg-amber-950/20 p-2 text-[10px] text-amber-100">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-semibold uppercase tracking-wide">Diagnostics</h3>
                {totalCount === 0 ? (
                  <div className="mt-1 text-amber-100/70">No issues detected</div>
                ) : (
                  <div className="mt-1 text-amber-100/75">
                    {totalCount} total warnings - {duplicateCount} duplicate memberships - {staleCount} stale references
                    {otherCount > 0 ? ` - ${otherCount} other diagnostics` : ''}
                  </div>
                )}
              </div>
              {totalCount > 0 && (
                <button
                  type="button"
                  onClick={() => setDiagnosticsExpanded((expanded) => !expanded)}
                  className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-950/35 px-2 py-1 text-[10px] font-semibold text-amber-100 hover:bg-amber-900/35"
                  aria-expanded={diagnosticsExpanded}
                  aria-controls={diagnosticsDetailsId}
                  aria-label={`${diagnosticsExpanded ? 'Collapse' : 'Expand'} electrical symbol diagnostics details`}
                >
                  {diagnosticsExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  {diagnosticsExpanded ? 'Collapse' : 'Expand'}
                </button>
              )}
            </div>
            {diagnosticsExpanded && totalCount > 0 && (
              <div id={diagnosticsDetailsId} className="mt-2 max-h-64 space-y-2 overflow-auto pr-1">
                {duplicateDiagnostics.map((diagnostic) => (
                  <div key={`${diagnostic.annotationId}-${diagnostic.packageNames.join('|')}`} className="rounded border border-amber-800/50 bg-gray-950/35 px-2 py-2 text-amber-100/85">
                    <div className="flex items-start gap-2">
                      {diagnostic.shapeKind && <ElectricalSymbolGlyph shapeKind={diagnostic.shapeKind} size={24} />}
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-amber-50">{diagnostic.displayName}</div>
                        <div className="mt-0.5 text-amber-100/70">{diagnostic.pageNumber ? `Page ${diagnostic.pageNumber}` : 'Page unknown'}</div>
                        <div className="mt-1 break-words">Shared in: {diagnostic.packageNames.length ? diagnostic.packageNames.join(', ') : 'Unknown Work Packages'}</div>
                        {diagnostic.representedCount > 1 && (
                          <div className="mt-1 text-amber-100/60">{diagnostic.representedCount} duplicate warnings represented</div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                {staleDiagnostics.map((diagnostic) => (
                  <div key={diagnostic.key} className="rounded border border-amber-800/50 bg-gray-950/35 px-2 py-2 text-amber-100/85">
                    <div className="font-semibold text-amber-50">Stale electrical reference</div>
                    <div className="mt-0.5 break-words">Work Package: {diagnostic.packageName}</div>
                    {diagnostic.pageNumber && <div className="mt-0.5 text-amber-100/70">Page {diagnostic.pageNumber}</div>}
                    <div className="mt-1 text-amber-100/70">{diagnostic.message}</div>
                  </div>
                ))}
                {otherCount > 0 && (
                  <div className="rounded border border-amber-800/50 bg-gray-950/35 px-2 py-2 text-amber-100/85">
                    <div className="font-semibold text-amber-50">Other diagnostics</div>
                    <div className="mt-0.5">{otherCount} diagnostics are available for engineering review.</div>
                  </div>
                )}
              </div>
            )}
            </section>
        </div>
      </div>
    </div>
  )
}
