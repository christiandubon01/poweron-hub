import { CheckSquare, ChevronDown, ChevronRight, Square, Zap } from 'lucide-react'
import { Fragment, useMemo, useState } from 'react'
import { describeContributionKind, formatTotalRow, formatWireLength } from '../formatting'
import { groupUnassignedWireQuantityContributions, type WireProfileAssignmentSelection } from '../wireQuantityAssignment'
import type { WireProfileQuantityTotal, WireQuantityContribution, WireQuantityDiagnostic } from '../types'

function statusLabel(total: WireProfileQuantityTotal) {
  if (total.profileStatus === 'archived') return 'Archived'
  if (total.groupKind === 'missing-profile') return 'Missing Profile'
  if (total.groupKind === 'cross-project-profile') return 'Cross-project'
  if (total.groupKind === 'unassigned') return 'Unassigned'
  if (total.groupKind === 'uncalibrated') return 'Uncalibrated'
  return 'Active'
}

function selectionKey(selection: WireProfileAssignmentSelection): string {
  return selection.mode === 'annotation-default'
    ? `route:${selection.annotationId}`
    : `segment:${selection.annotationId}:${selection.quantityLineId}`
}

export interface WireQuantityAssignmentControls {
  selections: WireProfileAssignmentSelection[]
  onSelectionChange(selection: WireProfileAssignmentSelection, selected: boolean): void
  onSelectMany(selections: WireProfileAssignmentSelection[], selected: boolean): void
  onOpenDialog(): void
  selectedCount: number
  disabled?: boolean
}

export function WireQuantitySummary({
  totals,
  contributions,
  diagnostics = [],
  title = 'Wire Quantities',
  emptyText = 'No measurable circuit routes.',
  compact = false,
  assignment,
}: {
  totals: WireProfileQuantityTotal[]
  contributions: WireQuantityContribution[]
  diagnostics?: WireQuantityDiagnostic[]
  title?: string
  emptyText?: string
  compact?: boolean
  assignment?: WireQuantityAssignmentControls
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const contributionById = new Map(contributions.map((contribution) => [contribution.quantityLineId, contribution]))
  const unassignedGroups = useMemo(() => groupUnassignedWireQuantityContributions(contributions), [contributions])
  const routeSelections = useMemo(
    () => unassignedGroups.map((group) => ({ mode: 'annotation-default' as const, annotationId: group.annotationId })),
    [unassignedGroups],
  )
  const selectedKeys = useMemo(() => new Set((assignment?.selections || []).map(selectionKey)), [assignment?.selections])
  const hasUnassignedTotals = totals.some((total) => total.groupKind === 'unassigned')

  return (
    <section className="rounded-lg border border-cyan-900/40 bg-cyan-950/15 p-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-cyan-200">{title}</h3>
        {diagnostics.length > 0 && (
          <span className="rounded-full border border-amber-500/40 bg-amber-950/30 px-1.5 py-0.5 text-[9px] font-semibold text-amber-200">
            {diagnostics.length} diagnostics
          </span>
        )}
      </div>
      {totals.length === 0 ? (
        <div className="mt-2 rounded border border-gray-800 bg-gray-950/40 px-2 py-2 text-[10px] italic text-gray-500">{emptyText}</div>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full table-fixed text-left text-[10px]">
            <thead className="text-gray-500">
              <tr className="border-b border-gray-800">
                <th className="w-[34%] py-1 pr-2 font-medium">Profile</th>
                <th className="w-[17%] py-1 pr-2 font-medium">Measured</th>
                <th className="w-[13%] py-1 pr-2 font-medium">Waste %</th>
                <th className="w-[17%] py-1 pr-2 font-medium">Waste length</th>
                <th className="w-[19%] py-1 font-medium">Purchase length</th>
              </tr>
            </thead>
            <tbody>
              {totals.map((total) => {
                const row = formatTotalRow(total)
                const isExpanded = !!expanded[total.key]
                const rowContributions = total.contributionIds.map((id) => contributionById.get(id)).filter(Boolean) as WireQuantityContribution[]
                const showAssignmentControls = !!assignment && total.groupKind === 'unassigned'
                return (
                  <Fragment key={total.key}>
                    <tr className="border-b border-gray-900/80 text-gray-300">
                      <td className="py-1.5 pr-2 align-top">
                        <button
                          type="button"
                          onClick={() => setExpanded((prev) => ({ ...prev, [total.key]: !prev[total.key] }))}
                          className="flex max-w-full items-center gap-1 text-left text-gray-100 hover:text-cyan-200"
                          aria-expanded={isExpanded}
                          aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${row.name} contribution details`}
                        >
                          {isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                          <span className="min-w-0 truncate">{row.name}</span>
                        </button>
                        <span className="mt-0.5 inline-flex rounded-full border border-gray-700 px-1 py-0.5 text-[8px] uppercase text-gray-400">{statusLabel(total)}</span>
                      </td>
                      <td className="py-1.5 pr-2 align-top tabular-nums">{row.measured}</td>
                      <td className="py-1.5 pr-2 align-top tabular-nums">{row.wastePercent}</td>
                      <td className="py-1.5 pr-2 align-top tabular-nums">{row.wasteLength}</td>
                      <td className="py-1.5 align-top tabular-nums">{row.purchaseLength}</td>
                    </tr>
                    {isExpanded && (
                      <tr className="border-b border-gray-900/80">
                        <td colSpan={5} className="bg-gray-950/35 px-2 py-2">
                          {showAssignmentControls && (
                            <div className="mb-2 rounded border border-cyan-900/50 bg-cyan-950/20 p-2">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="text-[10px] font-semibold text-cyan-100">Assign Unassigned quantities</div>
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <button type="button" onClick={() => assignment.onSelectMany(routeSelections, true)} disabled={assignment.disabled || routeSelections.length === 0} className="inline-flex items-center gap-1 rounded border border-cyan-700/60 px-2 py-1 text-[9px] font-semibold text-cyan-100 hover:bg-cyan-900/30 disabled:cursor-not-allowed disabled:border-gray-800 disabled:text-gray-600">
                                    <CheckSquare size={11} /> Select all routes
                                  </button>
                                  <button type="button" onClick={() => assignment.onSelectMany(routeSelections, false)} disabled={assignment.disabled || assignment.selectedCount === 0} className="inline-flex items-center gap-1 rounded border border-gray-700 px-2 py-1 text-[9px] font-semibold text-gray-300 hover:bg-white/5 disabled:cursor-not-allowed disabled:text-gray-600">
                                    <Square size={11} /> Clear
                                  </button>
                                  <button type="button" onClick={assignment.onOpenDialog} disabled={assignment.disabled || assignment.selectedCount === 0} className="inline-flex items-center gap-1 rounded bg-cyan-600 px-2 py-1 text-[9px] font-semibold text-white hover:bg-cyan-500 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-400">
                                    <Zap size={11} /> Assign Wire Profile ({assignment.selectedCount})
                                  </button>
                                </div>
                              </div>
                            </div>
                          )}
                          <div className={`grid gap-1 ${compact ? '' : 'md:grid-cols-2'}`}>
                            {showAssignmentControls ? unassignedGroups.map((group) => {
                              const routeSelected = selectedKeys.has(`route:${group.annotationId}`)
                              return (
                                <div key={group.annotationId} className="rounded border border-gray-800 bg-gray-950/50 px-2 py-1 text-[10px] text-gray-400">
                                  <label className="flex cursor-pointer items-start gap-2 text-gray-200">
                                    <input type="checkbox" checked={routeSelected} disabled={assignment.disabled} onChange={(event) => assignment.onSelectionChange({ mode: 'annotation-default', annotationId: group.annotationId }, event.target.checked)} className="mt-0.5 h-3 w-3 rounded border-gray-700 bg-gray-950 text-cyan-500" />
                                    <span className="min-w-0 flex-1">
                                      <span className="block font-semibold">Pg {group.pageNumber} - {group.shapeKind === 'circuit-arc' ? 'Circuit Arc' : 'Circuit Path'} route</span>
                                      <span className="block truncate text-gray-500">Annotation {group.annotationId} - {group.packageIds.length ? group.packageIds.join(', ') : 'Unpackaged'}</span>
                                    </span>
                                  </label>
                                  <div className="mt-1 space-y-1 border-t border-gray-800 pt-1">
                                    {group.contributions.map((contribution) => {
                                      const segmentSelected = selectedKeys.has(`segment:${contribution.annotationId}:${contribution.quantityLineId}`)
                                      return (
                                        <label key={contribution.quantityLineId} className="flex cursor-pointer items-center gap-2 text-gray-400">
                                          <input
                                            type="checkbox"
                                            checked={!routeSelected && segmentSelected}
                                            disabled={assignment.disabled || routeSelected}
                                            onChange={(event) => assignment.onSelectionChange({
                                              mode: 'segment-override',
                                              annotationId: contribution.annotationId,
                                              quantityLineId: contribution.quantityLineId,
                                              segmentId: contribution.segmentId,
                                              segmentIndex: contribution.segmentIndex,
                                            }, event.target.checked)}
                                            className="h-3 w-3 rounded border-gray-700 bg-gray-950 text-cyan-500 disabled:opacity-40"
                                          />
                                          <span className="min-w-0 flex-1 truncate">Segment {contribution.segmentIndex + 1} - {contribution.segmentId}</span>
                                          <span className="tabular-nums text-cyan-200">{formatWireLength(contribution.measuredLength, contribution.unit)}</span>
                                        </label>
                                      )
                                    })}
                                  </div>
                                </div>
                              )
                            }) : rowContributions.map((contribution) => (
                              <div key={contribution.quantityLineId} className="rounded border border-gray-800 bg-gray-950/50 px-2 py-1 text-[10px] text-gray-400">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-semibold text-gray-200">Pg {contribution.pageNumber} - {describeContributionKind(contribution)} - Segment {contribution.segmentIndex + 1}</span>
                                  <span className="tabular-nums text-cyan-200">{formatWireLength(contribution.measuredLength, contribution.unit)}</span>
                                </div>
                                <div className="mt-0.5 truncate">Annotation {contribution.annotationId} - {contribution.segmentId}</div>
                                <div className="mt-0.5 truncate">Packages: {contribution.packageIds.length ? contribution.packageIds.join(', ') : 'Unpackaged'} - Source: {contribution.profileResolution.source}</div>
                                {contribution.diagnostics.length > 0 && (
                                  <div className="mt-1 flex flex-wrap gap-1">
                                    {contribution.diagnostics.map((diagnostic, index) => (
                                      <span key={`${diagnostic.type}-${index}`} className="rounded border border-amber-700/40 bg-amber-950/30 px-1 py-0.5 text-[8px] uppercase text-amber-200">{diagnostic.type}</span>
                                    ))}
                                  </div>
                                )}
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
      {assignment && hasUnassignedTotals && !Object.values(expanded).some(Boolean) && (
        <div className="mt-2 text-[10px] text-cyan-300">Expand Unassigned to assign Wire Profiles.</div>
      )}
    </section>
  )
}
