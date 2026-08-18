/** LEAD-SRC-6 — Source Performance public surface. */

export type {
  SourcePerformanceReport,
  SourcePerformanceRow,
  SourcePerformanceTotals,
} from './sourcePerformanceTypes'
export {
  computeSourcePerformance,
  applyExactPortalCategoryRecovery,
  isLegacyCollapsedPortalLead,
  resolveSourcePerformanceBucket,
  formatConversionRate,
  formatConvertedValue,
} from './sourcePerformanceCalculations'
export { fetchPortalCategoryByLeadId } from './sourcePerformancePortalRecovery'
export {
  default as SourcePerformancePanel,
  type SourcePerformancePanelProps,
} from './SourcePerformancePanel'
