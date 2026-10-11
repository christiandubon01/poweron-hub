/**
 * src/finance/bankMatchReview.ts
 *
 * Browser-safe DTO types for the Cash OS "Matches" review (PLAID-3B): the shapes the server sends and the browser renders. Types only, no logic, no imports.
 * The server builds them (see the spending read model); the browser never imports server modules, so the contract lives here, like bankEvidenceView.
 */
export type PairKind = 'internal_transfer' | 'card_payment'
/** Why a proposed pair is held at "possible" even though the amounts match. Shown to the owner. */
export type PairCap = 'no_signal' | 'class_unknown' | 'cross_scope' | 'identical_group'
export type MatchAccountClass = 'bank_cash' | 'credit_card' | 'loan' | 'investment' | 'other'

/** Every state below is DERIVED from what the database really holds (evidence + the owner's decision rows); none is invented by the screen. */
export type MatchState = 'suggested' | 'waiting' | 'ambiguous' | 'confirmed' | 'rejected' | 'reversed' | 'evidence_changed'
export type MatchAction = 'confirm' | 'reject' | 'reverse' | 'reconfirm'

export interface MatchAccountInfo { ref: string; label: string; mask: string | null; ownership: 'business' | 'personal' | null; accountClass: MatchAccountClass | null; institution?: string | null }
export interface MatchLeg {
  id: string; date: string | null; name: string | null; merchant: string | null; amountMinor: number | null; pending: boolean
  /** The transaction is not in the loaded evidence (removed by the bank, or outside the loaded history). */
  missing: boolean
  account: MatchAccountInfo | null
}
export interface MatchHistoryEvent { at: string | null; event: 'confirmed' | 'rejected' | 'reversed' | 'reconfirmed' | 'completed' | 'superseded' }
export interface MatchItem {
  key: string
  state: MatchState
  kind: PairKind
  confidence: 'high' | 'possible' | null
  needsReview: boolean
  outflow: MatchLeg
  inflow: MatchLeg
  amountMinor: number
  daysApart: number | null
  reasons: string[]
  caps: PairCap[]
  crossScope: boolean
  /** The CURRENT evidence this item rests on; a confirm / reject must send it back unchanged. */
  fingerprint: string | null
  decision: { at: string | null; legacy: boolean } | null
  /** What changed since the decision was made (only for evidence_changed). */
  changes: string[]
  history: MatchHistoryEvent[]
  actions: MatchAction[]
}
export interface AmbiguousCandidate { outflowId: string; inflowId: string; kind: PairKind; daysApart: number; confidence: 'high' | 'possible'; crossScope: boolean; fingerprint: string }
export interface AmbiguousGroup { key: string; outflows: MatchLeg[]; inflows: MatchLeg[]; reasons: string[]; candidates: AmbiguousCandidate[] }
export interface RefundMatch { key: string; state: 'suggested' | 'confirmed' | 'rejected'; confidence: 'high' | 'possible' | 'ambiguous' | null; refund: MatchLeg; original: MatchLeg | null; candidates: MatchLeg[]; reasons: string[] }
export type MatchCounts = Record<MatchState, number> & { needsReview: number; refunds: number }
