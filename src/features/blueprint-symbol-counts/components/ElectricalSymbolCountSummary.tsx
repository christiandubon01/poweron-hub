import { ChevronDown, ChevronRight } from 'lucide-react'
import { Fragment, useState } from 'react'
import { ElectricalSymbolGlyph } from './ElectricalSymbolGlyph'
import type { ElectricalSymbolContribution, ElectricalSymbolTypeTotal } from '../types'

function formatPages(pages: readonly number[]) {
  return pages.length ? pages.map((page) => `Pg ${page}`).join(', ') : 'No pages'
}

export function ElectricalSymbolCountSummary({
  totals,
  contributions,
  title = 'Electrical Symbol Counts',
  emptyText = 'No registered electrical symbols are attributed.',
  copy = 'Package attribution only. Current blueprint-set totals count each annotation once.',
  compact = false,
}: {
  totals: ElectricalSymbolTypeTotal[]
  contributions: ElectricalSymbolContribution[]
  title?: string
  emptyText?: string
  copy?: string
  compact?: boolean
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const contributionById = new Map(contributions.map((contribution) => [contribution.annotationId, contribution]))

  return (
    <section className="rounded-lg border border-emerald-900/40 bg-emerald-950/15 p-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-emerald-200">{title}</h3>
        {totals.length > 0 && (
          <span className="rounded-full border border-emerald-500/40 bg-emerald-950/30 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-200">
            {totals.reduce((sum, total) => sum + total.count, 0)} symbols
          </span>
        )}
      </div>
      <div className="mt-1 text-[10px] text-emerald-100/70">{copy}</div>
      {totals.length === 0 ? (
        <div className="mt-2 rounded border border-gray-800 bg-gray-950/40 px-2 py-2 text-[10px] italic text-gray-500">{emptyText}</div>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="min-w-[420px] w-full table-fixed text-left text-[10px]">
            <thead className="text-gray-500">
              <tr className="border-b border-gray-800">
                <th className="w-[60%] py-1 pr-3 font-medium">Symbol</th>
                <th className="w-[16%] py-1 pr-3 font-medium">Count</th>
                <th className="w-[24%] py-1 font-medium">Pages</th>
              </tr>
            </thead>
            <tbody>
              {totals.map((total) => {
                const isExpanded = !!expanded[total.shapeKind]
                const rowContributions = total.annotationIds.map((id) => contributionById.get(id)).filter(Boolean) as ElectricalSymbolContribution[]
                return (
                  <Fragment key={total.shapeKind}>
                    <tr className="border-b border-gray-900/80 text-gray-300">
                      <td className="py-1.5 pr-3 align-top">
                        <button
                          type="button"
                          onClick={() => setExpanded((prev) => ({ ...prev, [total.shapeKind]: !prev[total.shapeKind] }))}
                          className="flex max-w-full items-center gap-1.5 text-left text-gray-100 hover:text-emerald-200"
                          aria-expanded={isExpanded}
                          aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${total.displayName} symbol details`}
                        >
                          {isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                          <ElectricalSymbolGlyph shapeKind={total.shapeKind} size={compact ? 22 : 26} />
                          <span className="min-w-0 truncate">{total.displayName}</span>
                        </button>
                      </td>
                      <td className="py-1.5 pr-3 align-top tabular-nums text-gray-100">{total.count}</td>
                      <td className="py-1.5 align-top text-gray-400">{formatPages(total.pages)}</td>
                    </tr>
                    {isExpanded && (
                      <tr className="border-b border-gray-900/80">
                        <td colSpan={3} className="bg-gray-950/35 px-2 py-2">
                          <div className={`grid gap-1 ${compact ? '' : 'md:grid-cols-2'}`}>
                            {rowContributions.map((contribution) => (
                              <div key={contribution.annotationId} className="rounded border border-gray-800 bg-gray-950/50 px-2 py-1 text-[10px] text-gray-400">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-semibold text-gray-200">Pg {contribution.pageNumber} - {contribution.displayName}</span>
                                  <span className="tabular-nums text-emerald-200">1</span>
                                </div>
                                <div className="mt-0.5 truncate">Packages: {contribution.packageNames.length ? contribution.packageNames.join(', ') : 'Unpackaged'}</div>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
