/**
 * src/services/spending/types.ts
 * Plain data shapes for the BANK-5 interpretation engine. Everything here is provider-neutral: the engine sees "evidence", never Plaid.
 */
import type { BucketKey, Confidence, Direction, RelationshipKind, ReviewState } from './taxonomy'

/** One provider transaction as evidence (already allowlisted by BANK-4). Amount: provider convention, positive = money OUT. */
export interface EvidenceTx {
  id: string
  providerAccountRef: string
  date: string
  name: string | null
  merchantName: string | null
  amountMinor: number
  pending: boolean
  removed: boolean
  category: { primary: string; detailed: string | null; confidence: string | null } | null
}

export interface AccountContext {
  providerAccountRef: string
  label: string
  mask: string | null
  /** Ownership of the MAPPED Cash OS account. Context only: it never decides what a transaction is. */
  ownership: 'business' | 'personal' | null
  financialAccountId: string | null
  financialAccountName: string | null
  /** Environment of the Item this account belongs to. Undefined only in pure-engine tests / pre-migration data (treated as sandbox by the service). */
  environment?: 'sandbox' | 'production'
}

/** A thing Cash OS already knows is coming (a recurring bill occurrence or a one-off commitment) that a transaction might belong to. */
export interface KnownBillCandidate {
  type: 'obligation' | 'commitment'
  /** obligation id, or cash commitment id */
  id: string
  label: string
  expectedDate: string
  amountMinor: number
  estimatedMinMinor: number | null
  estimatedMaxMinor: number | null
  /** Cash OS financial account the bill is normally paid from, when the owner recorded one. */
  financialAccountId: string | null
}
export interface DebtOption { id: string; label: string; accountType: string }
export interface ProjectOption { id: string; name: string }

export type DecisionKind = 'category' | 'ignored' | RelationshipKind
/** A persisted owner decision (interpretation row): confirmed, or rejected (kept so the same suggestion is not repeated). */
export interface Decision {
  id: string
  txId: string
  kind: DecisionKind
  status: 'confirmed' | 'rejected'
  category: string | null
  projectId: string | null
  obligationId: string | null
  commitmentId: string | null
  debtAccountId: string | null
  counterpartTxId: string | null
  confidence: Confidence | null
  source: 'owner' | 'system_suggestion' | 'rule'
  decidedAt: string | null
}

export interface BucketSuggestion {
  bucket: BucketKey
  confidence: Confidence
  reasons: string[]
  /** How it was derived, for the explanation only. */
  basis: 'owner_rule' | 'owner_history' | 'merchant_rule' | 'provider_category' | 'fee_rule' | 'transfer' | 'payroll' | 'relationship'
  /**
   * BANK-6B: the merchant is one that serves more than one purpose (retail, grocery, fuel, food, Apple...). Such a suggestion is never approved
   * in bulk unless the owner explicitly picks the category (or has remembered a rule for the merchant).
   */
  mixed?: boolean
}
export interface RelationshipTarget { type: 'obligation' | 'commitment' | 'debt_account' | 'project' | 'counterpart_tx' | null; id: string | null; label: string | null }
export interface RelationshipSuggestion { kind: RelationshipKind; target: RelationshipTarget; confidence: Confidence; reasons: string[] }
export interface TxSuggestion { bucket: BucketSuggestion | null; relationship: RelationshipSuggestion | null }

export interface ExplorerRow {
  id: string
  date: string
  name: string
  merchant: string
  merchantKey: string
  amountMinor: number
  direction: Direction
  pending: boolean
  account: { ref: string; label: string; mask: string | null; ownership: 'business' | 'personal' | null; mappedTo: string | null; /** true only when the owner explicitly mapped this provider account to a Cash OS account */ mapped: boolean; environment: 'sandbox' | 'production' | null; /** BANK-6D: the mapped Cash OS financial account id (read-only, for display colors); null when unmapped */ financialAccountId: string | null }
  bucket: { key: BucketKey | null; label: string | null; state: 'confirmed' | 'suggested' | 'none'; confidence: Confidence | null; reasons: string[]; /** how a SUGGESTION was derived (absent for confirmed/none) */ basis?: BucketSuggestion['basis']; /** mixed-purpose merchant: needs an explicit category before bulk approval */ mixed?: boolean }
  relationship: {
    kind: RelationshipKind | 'unknown'
    label: string
    target: RelationshipTarget | null
    state: 'confirmed' | 'suggested' | 'none'
    confidence: Confidence | null
    reasons: string[]
  }
  review: ReviewState
  scope: { value: 'business' | 'personal' | 'unclear'; source: 'owner' | 'account' | 'none' }
  /** Counted as unassigned spending (the money-bleed population). */
  unassigned: boolean
  /** Unassigned AND part of a repeated pattern of the same merchant (cadence + amount similarity). A repeated spending pattern is NOT a recurring obligation. */
  repeatedPattern: boolean
  /**
   * The deterministic cadence detector's finding. kind 'obligation_like' only when the bucket/relationship context reasonably supports a
   * bill or subscription (a matched known bill/debt/payroll, or a software/insurance bucket); otherwise 'spending_pattern' (habit).
   */
  pattern: { cadence: 'weekly' | 'biweekly' | 'monthly'; occurrences: number; kind: 'obligation_like' | 'spending_pattern' } | null
}
