/**
 * COST-1.5A — serviceRateSettings behavioural contract.
 *
 * These assert the actual decisions the resolver makes (present vs missing,
 * per-field zero policy, mode-aware required set), not source text. The Service
 * Estimate / Service Call modals consume this exact resolver, so proving the
 * resolver proves the gate's decision logic. The rendered blocking panel itself
 * has no node harness and is covered by the manual verification script.
 */
import { describe, expect, it } from 'vitest'
import {
  isRateProvided,
  parseSettingInput,
  resolveRateField,
  resolveRequiredServiceRates,
  RATE_FIELD_POLICY,
} from '../serviceRateSettings'

describe('isRateProvided', () => {
  it('finite numbers (including 0) are provided', () => {
    expect(isRateProvided(0)).toBe(true)
    expect(isRateProvided(42.45)).toBe(true)
    expect(isRateProvided(-5)).toBe(true)
  })
  it('non-empty numeric strings are provided', () => {
    expect(isRateProvided('0')).toBe(true)
    expect(isRateProvided('0.66')).toBe(true)
  })
  it('undefined / null / empty / NaN / non-numeric are NOT provided', () => {
    expect(isRateProvided(undefined)).toBe(false)
    expect(isRateProvided(null)).toBe(false)
    expect(isRateProvided('')).toBe(false)
    expect(isRateProvided('   ')).toBe(false)
    expect(isRateProvided(NaN)).toBe(false)
    expect(isRateProvided('abc')).toBe(false)
  })
})

describe('resolveRateField — per-field zero policy (Decision 2)', () => {
  it('tax: 0 is PRESENT (untaxed work is legitimate)', () => {
    expect(resolveRateField('tax', 0)).toEqual({ value: 0, present: true })
    expect(resolveRateField('tax', '0')).toEqual({ value: 0, present: true })
  })
  it('mileRate: 0 is PRESENT (not billing mileage is legitimate)', () => {
    expect(resolveRateField('mileRate', 0)).toEqual({ value: 0, present: true })
  })
  it('opCost: 0 is MISSING ($0/hr labor is degenerate — guards post-reset opCost:0)', () => {
    expect(resolveRateField('opCost', 0)).toEqual({ value: 0, present: false })
    expect(resolveRateField('opCost', '0')).toEqual({ value: 0, present: false })
  })
  it('billRate: 0 is MISSING ($0/hr billing is degenerate)', () => {
    expect(resolveRateField('billRate', 0)).toEqual({ value: 0, present: false })
  })
  it('a real positive value is present and carries through for every field', () => {
    expect(resolveRateField('opCost', 45)).toEqual({ value: 45, present: true })
    expect(resolveRateField('billRate', 75)).toEqual({ value: 75, present: true })
    expect(resolveRateField('mileRate', 0.66)).toEqual({ value: 0.66, present: true })
    expect(resolveRateField('tax', 8.75)).toEqual({ value: 8.75, present: true })
  })
  it('an unset value is missing for every field', () => {
    for (const key of Object.keys(RATE_FIELD_POLICY) as (keyof typeof RATE_FIELD_POLICY)[]) {
      expect(resolveRateField(key, undefined).present).toBe(false)
    }
  })
})

describe('resolveRequiredServiceRates — legacy mode', () => {
  const full = { billRate: 75, mileRate: 0.66, opCost: 45, tax: 8.75 }

  it('a fully-configured tenant has no missing fields', () => {
    const r = resolveRequiredServiceRates(full, { mode: 'legacy' })
    expect(r.missing).toEqual([])
    expect(r).toMatchObject({ billRate: 75, mileRate: 0.66, opCost: 45, taxRatePct: 8.75 })
  })

  it('missing mileRate is reported and names the field', () => {
    const r = resolveRequiredServiceRates({ ...full, mileRate: undefined }, { mode: 'legacy' })
    expect(r.missing.map((m) => m.key)).toEqual(['mileRate'])
    expect(r.missing[0].label).toBe('Mile Rate ($/mi)')
    expect(r.missing[0].remedy).toContain('Pricing Defaults')
  })

  it('a real 0% tax is NOT flagged (usable without warning)', () => {
    const r = resolveRequiredServiceRates({ ...full, tax: 0 }, { mode: 'legacy' })
    expect(r.missing).toEqual([])
    expect(r.taxRatePct).toBe(0)
  })

  it('an UNSET tax IS flagged (indistinguishable-from-0 problem, Decision c)', () => {
    const r = resolveRequiredServiceRates({ ...full, tax: undefined }, { mode: 'legacy' })
    expect(r.missing.map((m) => m.key)).toEqual(['tax'])
  })

  it('opCost of 0 blocks in legacy mode (post-"reset EVERYTHING" guard)', () => {
    const r = resolveRequiredServiceRates({ ...full, opCost: 0 }, { mode: 'legacy' })
    expect(r.missing.map((m) => m.key)).toEqual(['opCost'])
    expect(r.missing[0].remedy).toContain('Upgrade to Crew Costing')
  })

  it('reports every missing field at once', () => {
    const r = resolveRequiredServiceRates({}, { mode: 'legacy' })
    expect(r.missing.map((m) => m.key).sort()).toEqual(['billRate', 'mileRate', 'opCost', 'tax'])
  })
})

describe('resolveRequiredServiceRates — crew mode (mode-aware required set)', () => {
  it('opCost and billRate are NOT required in crew mode (they come from Team)', () => {
    // opCost/billRate absent, mileRate + tax present → crew quote is valid.
    const r = resolveRequiredServiceRates({ mileRate: 0.66, tax: 8.75 }, { mode: 'crew' })
    expect(r.missing).toEqual([])
  })

  it('the SAME missing opCost that blocks legacy does NOT block crew', () => {
    const settings = { mileRate: 0.66, tax: 8.75, opCost: 0, billRate: 0 }
    expect(resolveRequiredServiceRates(settings, { mode: 'crew' }).missing).toEqual([])
    expect(
      resolveRequiredServiceRates(settings, { mode: 'legacy' }).missing.map((m) => m.key).sort(),
    ).toEqual(['billRate', 'opCost'])
  })

  it('mileRate and tax are still required in crew mode', () => {
    const r = resolveRequiredServiceRates({ opCost: 45, billRate: 75 }, { mode: 'crew' })
    expect(r.missing.map((m) => m.key).sort()).toEqual(['mileRate', 'tax'])
  })
})

// ── COST-1.5B — Settings inputs accept empty and zero ────────────────────────
describe('isRateProvided — null reads as not-provided (COST-1.5B store-null path)', () => {
  it('null, undefined, empty and non-numeric are all not-provided', () => {
    // The Settings inputs store explicit null for "cleared"; on the next render
    // that null must read back as not-provided so the field shows empty, not the
    // stale literal.
    expect(isRateProvided(null)).toBe(false)
    expect(isRateProvided(undefined)).toBe(false)
    expect(isRateProvided('')).toBe(false)
    expect(isRateProvided('abc')).toBe(false)
  })
})

describe('parseSettingInput — what a Settings input persists', () => {
  it('empty / whitespace / non-numeric → undefined (caller stores null = absent)', () => {
    expect(parseSettingInput('')).toBeUndefined()
    expect(parseSettingInput('   ')).toBeUndefined()
    expect(parseSettingInput('abc')).toBeUndefined()
  })
  it('a typed 0 persists as a real 0, never coerced to a literal', () => {
    expect(parseSettingInput('0')).toBe(0)
    expect(parseSettingInput('0.0')).toBe(0)
  })
  it('a normal value persists unchanged', () => {
    expect(parseSettingInput('95')).toBe(95)
    expect(parseSettingInput('0.66')).toBe(0.66)
    expect(parseSettingInput('8.75')).toBe(8.75)
  })
  it('round-trips with isRateProvided: a stored 0 is provided, a stored null is not', () => {
    // Mirrors the Settings display: value stored → shown vs blank.
    const storedZero = parseSettingInput('0')            // 0
    const storedCleared = parseSettingInput('') ?? null  // null (what the input writes)
    expect(isRateProvided(storedZero)).toBe(true)
    expect(isRateProvided(storedCleared)).toBe(false)
  })
})
