/** Sanitized bank-evidence read DTO; no persistence or financial posting. */
interface Target { type:string | null; id:string | null; label:string | null }
export interface BankEvidenceView {
  id: string; date: string; name: string; merchant: string; amountMinor: number; direction: 'money_out' | 'money_in' | 'zero'; pending: boolean
  account: { ref: string; label: string; mask: string | null; ownership: 'business' | 'personal' | null; mappedTo: string | null; mapped: boolean; environment: 'sandbox' | 'production' | null; financialAccountId?: string | null }
  bucket: { key: string | null; label: string | null; state: 'confirmed' | 'suggested' | 'none'; confidence: 'high' | 'possible' | 'low' | null; reasons: string[]; basis?: string; mixed?: boolean }
  relationship: { kind: string; label: string; target: Target | null; state: 'confirmed' | 'suggested' | 'none'; confidence: 'high' | 'possible' | 'low' | null; reasons: string[] }
  review: 'suggested' | 'confirmed' | 'needs_review' | 'ignored'
  scope: { value: 'business' | 'personal' | 'unclear'; source: 'owner' | 'account' | 'none' }
  unassigned: boolean; repeatedPattern: boolean; pattern: { cadence: string; occurrences: number; kind: 'obligation_like' | 'spending_pattern' } | null
}
