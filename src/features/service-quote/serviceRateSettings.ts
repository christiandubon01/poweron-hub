/**
 * serviceRateSettings.ts — COST-1.5A (eliminate silent cost fallbacks)
 *
 * Single source of truth for whether the pricing-rate settings a Service Quote
 * needs are actually SET. Pure — no React, no storage — so it is unit-testable in
 * the node test environment. The Service Estimate / Service Call modals and the
 * Service Log ledger all resolve their required rates through here, so a missing
 * value can never be silently replaced by an invented number (the old
 * `settings.opCost || 42.45` / `|| 43` / `billRate || 75` behaviour).
 *
 * Zero handling is PER FIELD, not uniform (COST-1.5A Decision 2). Whether a
 * stored 0 is a real business value differs by field:
 *
 *   tax      0 → PRESENT, no warning   (untaxed work is legitimate)
 *   mileRate 0 → PRESENT, no warning   (not billing mileage is legitimate)
 *   opCost   0 → treated as MISSING    ($0/hr labor is degenerate)
 *   billRate 0 → treated as MISSING    ($0/hr billing is degenerate)
 *
 * The opCost=0 rule specifically guards the post-"reset EVERYTHING" state, where
 * V15rSettingsPanel writes `opCost: 0`. Under a uniform "0 = present" rule that
 * would render a quote at $0 cost / 100% margin with no warning — the exact
 * failure this phase exists to prevent — and it is handled here WITHOUT touching
 * V15rSettingsPanel, so scope stays locked.
 */

export type ServiceRateKey = 'billRate' | 'mileRate' | 'opCost' | 'tax'

/** How the displayed quote is being priced. Only 'legacy' pulls opCost/billRate
 *  from settings; 'crew' reads those from the Team crew instead. 'frozen' uses a
 *  saved snapshot and needs no settings check at all (handled by the caller). */
export type ServiceQuoteMode = 'legacy' | 'crew' | 'frozen'

export interface RateFieldPolicy {
  key: ServiceRateKey
  /** Human label shown in the blocking panel and ledger warning. */
  label: string
  /** True when a stored 0 is a legitimate business value (no warning). */
  zeroIsValid: boolean
  /** 'always' = required in every priced mode; 'legacy' = only required when the
   *  quote uses the legacy single-rate path (crew mode reads these from Team). */
  requiredIn: 'always' | 'legacy'
  /** What the owner should do to set it — shown after the label. */
  remedy: string
}

/**
 * The explicit per-field policy map. See the file header for the reasoning behind
 * each `zeroIsValid` choice. Do not scatter these decisions across call sites.
 */
export const RATE_FIELD_POLICY: Record<ServiceRateKey, RateFieldPolicy> = {
  mileRate: {
    key: 'mileRate',
    label: 'Mile Rate ($/mi)',
    zeroIsValid: true, // not billing mileage is a legitimate choice
    requiredIn: 'always',
    remedy: 'Set it in Settings → Pricing Defaults.',
  },
  tax: {
    key: 'tax',
    label: 'Tax Rate (%)',
    zeroIsValid: true, // untaxed work is legitimate
    requiredIn: 'always',
    remedy: 'Set it in Settings → Pricing Defaults (enter 0 if you don’t charge tax).',
  },
  opCost: {
    key: 'opCost',
    label: 'Operating Cost ($/hr)',
    zeroIsValid: false, // $0/hr labor is degenerate — guards the post-reset opCost:0
    requiredIn: 'legacy',
    remedy:
      "This record is priced in Legacy mode. Click 'Upgrade to Crew Costing' above to price it from your Team's actual rates instead.",
  },
  billRate: {
    key: 'billRate',
    label: 'Default Bill Rate ($/hr)',
    zeroIsValid: false, // $0/hr billing is degenerate
    requiredIn: 'legacy',
    remedy: 'Set it in Settings → Pricing Defaults.',
  },
}

export interface MissingRate {
  key: ServiceRateKey
  label: string
  remedy: string
}

export interface ResolvedRateField {
  /** Numeric value (0 when not provided). */
  value: number
  /** True when the value is usable for pricing per this field's zero policy. */
  present: boolean
}

/**
 * A raw setting value counts as "provided" when it is a finite number, or a
 * non-empty string that parses to a finite number. `undefined` / `null` / empty
 * string / `NaN` are not provided. Note: provided is NOT the same as present — a
 * provided 0 is still absent for a field where zero is not valid (see
 * {@link resolveRateField}).
 */
export function isRateProvided(raw: unknown): boolean {
  if (typeof raw === 'number') return Number.isFinite(raw)
  if (typeof raw === 'string') {
    if (raw.trim() === '') return false
    return Number.isFinite(Number(raw))
  }
  return false
}

/**
 * Resolve one rate field against its policy. `present` is false when the value is
 * not provided, or is 0 for a field where zero is not a valid value.
 */
export function resolveRateField(key: ServiceRateKey, raw: unknown): ResolvedRateField {
  const policy = RATE_FIELD_POLICY[key]
  const provided = isRateProvided(raw)
  const value = provided ? Number(raw) : 0
  const present = provided && (policy.zeroIsValid || value !== 0)
  return { value, present }
}

export interface ResolvedServiceRates {
  billRate: number
  mileRate: number
  opCost: number
  taxRatePct: number
  /** Required-but-missing fields for the requested mode. Empty === quote is safe
   *  to display. */
  missing: MissingRate[]
}

/**
 * Resolve every rate the displayed quote needs for `mode`, plus the list of
 * required fields that are missing.
 *
 * In 'crew' mode only the always-required fields (mileRate, tax) are checked —
 * opCost and billRate come from the Team crew, so a missing settings.opCost must
 * NOT block a valid crew quote. In 'legacy' mode all four are required.
 */
export function resolveRequiredServiceRates(
  settings: Record<string, unknown> | null | undefined,
  opts: { mode: 'legacy' | 'crew' },
): ResolvedServiceRates {
  const s = (settings ?? {}) as Record<string, unknown>
  const billRate = resolveRateField('billRate', s.billRate)
  const mileRate = resolveRateField('mileRate', s.mileRate)
  const opCost = resolveRateField('opCost', s.opCost)
  const tax = resolveRateField('tax', s.tax)

  const needsLegacyFields = opts.mode === 'legacy'
  const missing: MissingRate[] = []
  const flag = (field: ResolvedRateField, key: ServiceRateKey) => {
    const policy = RATE_FIELD_POLICY[key]
    const required = policy.requiredIn === 'always' || needsLegacyFields
    if (required && !field.present) {
      missing.push({ key, label: policy.label, remedy: policy.remedy })
    }
  }
  // Legacy-only fields first so their mode-specific remedy leads the list.
  flag(opCost, 'opCost')
  flag(billRate, 'billRate')
  flag(mileRate, 'mileRate')
  flag(tax, 'tax')

  return {
    billRate: billRate.value,
    mileRate: mileRate.value,
    opCost: opCost.value,
    taxRatePct: tax.value,
    missing,
  }
}
