/** Display projection of a COMPLETE server population. No relationship inference or financial posting. */
import type { ReportRow, ReportSlot, SpendingReport } from '@/finance/bankSpendingReports'
import type { Filters } from './useSpendingExplorer'
export function projectReport(report: SpendingReport, keep: (row: ReportRow) => boolean): SpendingReport {
  if (!report.coverage.complete || !report.summary) return report
  const rows = report.rows.filter(keep)
  const monetary = (r: ReportRow) => !r.pending && !r.removed
  const amounts = (rs: ReportRow[]) => ({ count:rs.length,postedCount:rs.filter(monetary).length,outMinor:rs.filter(monetary).reduce((n,r)=>n+Math.max(0,r.amountMinor),0),inMinor:rs.filter(monetary).reduce((n,r)=>n+Math.max(0,-r.amountMinor),0) })
  const groups: ReportSlot[] = report.groups.map(g=>({ ...g,...amounts(rows.filter(r=>r.reportParent===g.key)),children:g.children.map(c=>({ ...c,...amounts(rows.filter(r=>r.reportParent===g.key && r.reportLeaf===c.key)) })).filter(c=>c.count>0) })).filter(g=>g.count>0)
  const a=amounts(rows), ignored=rows.filter(r=>r.review==='ignored'), i=amounts(ignored)
  return { ...report,rows,groups,summary:{ ...a,netMovementMinor:a.inMinor-a.outMinor,pendingCount:rows.filter(r=>r.pending).length,removedCount:rows.filter(r=>r.removed).length,unresolvedCount:rows.filter(r=>r.unresolved).length,ignoredCount:i.count,ignoredPostedCount:i.postedCount,ignoredOutMinor:i.outMinor,ignoredInMinor:i.inMinor } }
}
export function matchesExplorerFilters(r: ReportRow, f: Filters): boolean {
  const search=f.search.trim().toLowerCase(), amount=Math.abs(r.amountMinor)
  const minimum=Number(f.min), maximum=Number(f.max)
  const hasMin=!!f.min.trim() && Number.isFinite(minimum) && minimum>=0, hasMax=!!f.max.trim() && Number.isFinite(maximum) && maximum>=0
  return (!f.bucket || (r.review!=='ignored' && r.bucket.key===f.bucket)) && (!f.scope || r.scope.value===f.scope) && (!f.review || r.review===f.review)
    && (!f.confidence || (r.bucket.confidence===f.confidence || r.relationship.confidence===f.confidence)) && (!f.project || r.relationship.kind==='project' && r.relationship.target?.id===f.project)
    && (!search || `${r.merchant} ${r.name}`.toLowerCase().includes(search)) && (!hasMin || amount>=Math.round(minimum*100)) && (!hasMax || amount<=Math.round(maximum*100))
}
