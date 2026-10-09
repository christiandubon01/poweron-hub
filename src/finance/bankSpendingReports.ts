import type { BankEvidenceView } from './bankEvidenceView'
import type { SpendingHierarchy } from './bankSpendingHierarchy'
export const REPORT_MODES = ['all_money', 'business', 'unassigned'] as const
/** Owner-approved: ignored evidence remains actual account cash movement. */
export interface ReportingPolicy { ignoredCashMovement: 'include' | 'exclude' }
export const APPROVED_REPORTING_POLICY: ReportingPolicy = { ignoredCashMovement: 'include' }
export type ReportMode = typeof REPORT_MODES[number]
export interface ReportScope { from: string; to: string; accounts: 'mapped' | 'all'; environment: 'sandbox' | 'production'; account?: string }
export type ReportRow = BankEvidenceView & { removed?: boolean; activity: string; reportParent: string; reportLeaf: string; unresolved: boolean }
export interface ReportSlot { key: string; label: string; color: string | null; count: number; postedCount: number; outMinor: number; inMinor: number; children: ReportSlot[] }
export interface SpendingReport {
  mode: ReportMode; scope: ReportScope; coverage: { complete: boolean; reason: string | null }; hierarchy: SpendingHierarchy;
  summary: { count: number; postedCount: number; outMinor: number; inMinor: number; netMovementMinor: number; pendingCount: number; ignoredCount: number; ignoredPostedCount: number; ignoredOutMinor: number; ignoredInMinor: number; removedCount: number; unresolvedCount: number } | null;
  groups: ReportSlot[]; rows: ReportRow[];
}
