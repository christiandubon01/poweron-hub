import type { BankEvidenceView } from './bankEvidenceView'
import type { SpendingHierarchy } from './bankSpendingHierarchy'
export interface CategoryRevision {
  category: string | null; relationship: string[]; ignored: string | null
  amountMinor: number; pending: boolean; removed: boolean; date: string; accountRef: string; name: string | null; merchantName: string | null
}
export type RelatedRow = BankEvidenceView & { removed?: boolean; revision: CategoryRevision }
export interface RelatedResult {
  rows: RelatedRow[]; complete: boolean; reason: string | null; total: number | null
  identity: string; grouping: 'merchant' | 'description'; historical: boolean; from: string; to: string; accounts: string; account?: string
  hierarchy: SpendingHierarchy; batchAvailable: boolean
}
export interface CategorySelection { id: string; expected: CategoryRevision }
export interface CategoryPreview { id: string; row?: RelatedRow; proposed: string; eligible: boolean; reason: string | null }
export interface CategoryBatchResult { id: string; outcome: 'created' | 'changed' | 'unchanged' | 'excluded' | 'conflict' | 'failed'; reason?: string }
export const descriptionIdentity = (name: string): string => {
  const normalized=name.trim().replace(/\s+/g,' ').toUpperCase()
  // Explicit fee-description families only. Never a bank-account identity or generic bank name.
  if (/\bOVERDRAFT(?: ITEM)? FEE\b/.test(normalized)) return 'Description pattern: overdraft fee'
  if (/\b(?:NSF|INSUFFICIENT FUNDS) FEE\b/.test(normalized)) return 'Description pattern: insufficient-funds fee'
  return `Exact description: ${normalized}`
}
export const merchantIdentity = (name: string | null | undefined): string | null => name?.trim().replace(/\s+/g,' ').toUpperCase() || null
