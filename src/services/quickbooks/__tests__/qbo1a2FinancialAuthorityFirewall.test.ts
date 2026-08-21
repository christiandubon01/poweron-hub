/**
 * QBO-1A2 focused tests — QuickBooks / PowerOn KPI & Financial Authority Firewall.
 *
 * Proves:
 *  QBO-KPI-1   QBO modules classify accounting financial data as external mirror /
 *              reconciliation data, not canonical PowerOn data.
 *  QBO-KPI-2   No QBO module directly updates PowerOn canonical payment records.
 *  QBO-KPI-3   No QBO module directly updates PowerOn collected-cash authority.
 *  QBO-KPI-4   No QBO module directly updates PowerOn KPI calculation state.
 *  QBO-KPI-5   No QBO module directly updates Annual Target / Daily Target authority.
 *  QBO-KPI-6   Outbound approved PowerOn → QBO architecture remains permitted.
 *  QBO-KPI-7   Inbound QBO → comparison architecture remains permitted.
 *  QBO-KPI-8   Inbound QBO → automatic PowerOn replacement is explicitly forbidden.
 *  QBO-KPI-9   Reconciliation result exposes PowerOn value, QBO value, difference, status.
 *  QBO-KPI-10  Reconciliation result has no automatic mutation/apply method.
 *  QBO-KPI-11  Future webhook/CDC contract permits mirror refresh but not canonical mutation.
 *  QBO-KPI-12  A historical 2025 QBO value can be compared without mutating PowerOn.
 *  GUARD-1     No migration created.
 *  GUARD-2     Referral files untouched.
 *  GUARD-3     package.json untouched.
 *  GUARD-4     deno.lock untouched.
 *
 * The import-boundary proofs (QBO-KPI-2..5) statically scan every non-test
 * module under src/services/quickbooks/** and netlify/functions/quickbooks/**
 * and assert none imports a protected PowerOn canonical financial authority
 * module or its mutation symbols. NOTE: src/services/quickbooksImportService.ts
 * is the pre-existing legacy owner-approved PDF/CSV importer — it is NOT an OAuth
 * module and is intentionally outside this firewall's scan surface.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  POWERON_CANONICAL_FINANCIAL_AUTHORITIES,
  QBO_MIRROR_REFRESH_SURFACES,
  QUICKBOOKS_DATA_AUTHORITIES,
  QboAuthorityViolationError,
  assertMirrorReadOnly,
  assertQboReadOnlyFinancialBoundary,
  assertWebhookCdcMutationBoundary,
  classifyQuickBooksRecord,
  compareForReconciliation,
} from '../quickbooksAuthority'
import type { QuickBooksDataAuthority, QuickBooksReconciliationResult } from '../quickbooksAuthority'

const ROOT = process.cwd()
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8')
const exists = (p: string): boolean => existsSync(join(ROOT, p))

// ── Static import-boundary scanner ───────────────────────────────────────────

interface ParsedImport {
  modulePath: string
  bindings: string[]
}

/** Recursively list non-test .ts source files under a dir. */
function listSourceFiles(dir: string, out: string[] = []): string[] {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === '__tests__') continue
      listSourceFiles(join(dir, ent.name), out)
    } else if (ent.isFile() && ent.name.endsWith('.ts')) {
      if (/\.test\.ts$/.test(ent.name)) continue
      if (ent.name.endsWith('.d.ts')) continue
      out.push(join(dir, ent.name))
    }
  }
  return out
}

/**
 * Parse ES-module import statements out of source text. Captures:
 *  - static `import ... from '...'` (incl. multi-line, `import type`, default, namespace, named)
 *  - side-effect `import '...'`
 *  - dynamic `import('...')`
 * Returns the imported module path plus the named/default binding identifiers.
 * Comments and registry string literals are NOT matched (the regex is anchored on
 * the `import` keyword / call form), so listing a protected path as a string
 * literal inside quickbooksAuthority.ts is not a false positive.
 */
function parseImports(src: string): ParsedImport[] {
  const imports: ParsedImport[] = []

  // Strip block comments first so a prose word like "import" inside a JSDoc
  // header can never span across to a later real `from '...'` and produce a
  // bogus match. Line comments are intentionally NOT stripped (naive // removal
  // would corrupt URL string literals such as 'https://...'); the QBO files have
  // no line comment containing a standalone `import` token before a real import.
  const cleaned = src.replace(/\/\*[\s\S]*?\*\//g, ' ')

  // Static imports: import [type] <clause> from 'path'
  const staticRe = /\bimport\b(?:\s+type\b)?\s*([\s\S]*?)\bfrom\b\s*['"]([^'"]+)['"]/g
  for (let m = staticRe.exec(cleaned); m !== null; m = staticRe.exec(cleaned)) {
    const clause = m[1] ?? ''
    const modulePath = m[2]
    // Strip braces/commas/keywords and collect identifiers from the clause.
    const bindings = (clause.replace(/[{}*,]/g, ' ').replace(/\b(?:as|type|default)\b/g, ' ').match(/[A-Za-z_$][\w$]*/g) ?? [])
    imports.push({ modulePath, bindings })
  }

  // Side-effect imports: import 'path'  (no `from`)
  const sideEffectRe = /\bimport\s*['"]([^'"]+)['"]/g
  for (let m = sideEffectRe.exec(cleaned); m !== null; m = sideEffectRe.exec(cleaned)) {
    // Avoid double-counting the `from` form already captured above.
    const idx = m.index
    const tail = cleaned.slice(idx, idx + 200)
    if (/\bfrom\b/.test(tail.slice(0, tail.indexOf(m[1])))) continue
    imports.push({ modulePath: m[1], bindings: [] })
  }

  // Dynamic imports: import('path')
  const dynamicRe = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  for (let m = dynamicRe.exec(cleaned); m !== null; m = dynamicRe.exec(cleaned)) {
    imports.push({ modulePath: m[1], bindings: [] })
  }

  return imports
}

/** Basename without extension, used to match a protected module in any import path. */
function protectedBasename(modulePath: string): string {
  const base = modulePath.split(/[/\\]/).pop() ?? modulePath
  return base.replace(/\.ts$/, '')
}

/** All QBO OAuth source files on the firewall scan surface. */
const QBO_SCAN_DIRS = ['src/services/quickbooks', 'netlify/functions/quickbooks']
const qboFiles: Array<{ rel: string; src: string; imports: ParsedImport[] }> = []
for (const dir of QBO_SCAN_DIRS) {
  if (!exists(dir)) continue
  for (const abs of listSourceFiles(join(ROOT, dir))) {
    const rel = abs.replace(ROOT + sep, '').replace(/\\/g, '/')
    const src = readFileSync(abs, 'utf8')
    qboFiles.push({ rel, src, imports: parseImports(src) })
  }
}

/** Every protected module basename + the full set of protected mutation symbols. */
const protectedBasenames = POWERON_CANONICAL_FINANCIAL_AUTHORITIES.map((a) => protectedBasename(a.protectedModule))
const protectedMutationSymbols = new Set(POWERON_CANONICAL_FINANCIAL_AUTHORITIES.flatMap((a) => a.protectedMutationSymbols))

/** A QBO OAuth file breaches the firewall if it imports a protected module path
 *  or imports any protected mutation symbol by name. */
function findBoundaryBreaches(): Array<{ rel: string; reason: string }> {
  const breaches: Array<{ rel: string; reason: string }> = []
  for (const f of qboFiles) {
    for (const imp of f.imports) {
      const hitBasename = protectedBasenames.find((b) => b.length > 0 && imp.modulePath.includes(b))
      if (hitBasename) {
        breaches.push({ rel: f.rel, reason: `imports protected canonical module "${hitBasename}" via "${imp.modulePath}"` })
      }
      for (const b of imp.bindings) {
        if (protectedMutationSymbols.has(b)) {
          breaches.push({ rel: f.rel, reason: `imports protected mutation symbol "${b}" via "${imp.modulePath}"` })
        }
      }
    }
  }
  return breaches
}

// ── QBO-KPI-1: classification ────────────────────────────────────────────────

describe('QBO-1A2 KPI firewall — QBO-KPI-1 classification', () => {
  it('QBO-KPI-1: QBO data is classified as external mirror/reconciliation, not canonical PowerOn', () => {
    // Exactly the four external classifications exist.
    expect(QUICKBOOKS_DATA_AUTHORITIES).toEqual([
      'external_accounting_identity',
      'accounting_mirror',
      'owner_approved_outbound',
      'reconciliation_difference',
    ])
    // None of the classifications is a "canonical_poweron" authority.
    for (const a of QUICKBOOKS_DATA_AUTHORITIES) {
      expect(a).not.toMatch(/canonical|poweron_truth|kpi_authority/i)
    }
    // A mirror record declares its external authority explicitly.
    const mirror = {
      authority: 'accounting_mirror' as const,
      realmId: 'realm-1',
      source: 'qbo_invoice' as const,
      asOf: '2025-12-31T00:00:00.000Z',
      data: { balance: 100 },
    }
    expect(classifyQuickBooksRecord(mirror)).toBe('accounting_mirror')
    // An unclassified QBO datum is rejected — it can never be assumed canonical.
    expect(() => classifyQuickBooksRecord({ authority: 'canonical_poweron' })).toThrow(QboAuthorityViolationError)
    expect(() => classifyQuickBooksRecord({})).toThrow(QboAuthorityViolationError)
  })
})

// ── QBO-KPI-2..5: static import boundary ─────────────────────────────────────

describe('QBO-1A2 KPI firewall — static import boundary (QBO-KPI-2..5)', () => {
  it('QBO scan surface covers the QBO OAuth source modules (not the legacy importer)', () => {
    const rels = qboFiles.map((f) => f.rel)
    // The OAuth modules are on the scan surface.
    expect(rels.some((r) => r.endsWith('src/services/quickbooks/quickbooksOAuth.ts'))).toBe(true)
    expect(rels.some((r) => r.endsWith('netlify/functions/quickbooks/qbo-callback.ts'))).toBe(true)
    // The legacy PDF/CSV importer is NOT on the scan surface (it is owner-approved
    // outbound import, not OAuth, and lives outside src/services/quickbooks/).
    expect(rels.some((r) => r.includes('quickbooksImportService.ts'))).toBe(false)
  })

  it('QBO-KPI-2: no QBO module directly updates PowerOn canonical payment records', () => {
    const breaches = findBoundaryBreaches()
    // The service payment ledger module + its mutation symbols are protected.
    const ledger = POWERON_CANONICAL_FINANCIAL_AUTHORITIES.find((a) => a.domain === 'service_payment_ledger')!
    expect(protectedBasenames).toContain(protectedBasename(ledger.protectedModule))
    expect(ledger.protectedMutationSymbols).toContain('recordServicePayment')
    expect(breaches.filter((b) => /servicePaymentLedger|recordServicePayment|buildServiceLogWithPayment/.test(b.reason))).toEqual([])
  })

  it('QBO-KPI-3: no QBO module directly updates PowerOn collected-cash authority', () => {
    const breaches = findBoundaryBreaches()
    const collected = POWERON_CANONICAL_FINANCIAL_AUTHORITIES.find((a) => a.domain === 'collected_cash_authority')!
    expect(collected.protectedModule).toBe('src/services/collectedRevenueRange.ts')
    expect(filterBreaches(breaches, /collectedRevenueRange|backupDataService|saveBackupData/)).toEqual([])
  })

  it('QBO-KPI-4: no QBO module directly updates PowerOn KPI calculation state', () => {
    const breaches = findBoundaryBreaches()
    expect(filterBreaches(breaches, /weeklyFinancialPolicy|financialTimelineRange|businessGoalTruth|recalculateWeeklyData/)).toEqual([])
  })

  it('QBO-KPI-5: no QBO module directly updates Annual Target / Daily Target authority', () => {
    const breaches = findBoundaryBreaches()
    const annual = POWERON_CANONICAL_FINANCIAL_AUTHORITIES.find((a) => a.domain === 'annual_daily_target')!
    expect(annual.protectedModule).toBe('src/services/businessGoalTruth.ts')
    expect(filterBreaches(breaches, /businessGoalTruth|revenueTimelineQueries/)).toEqual([])
  })

  it('QBO-KPI-2..5 full breach report: no QBO OAuth file imports any protected canonical authority', () => {
    // The catch-all: the entire protected registry is unimported by QBO OAuth code.
    const breaches = findBoundaryBreaches()
    expect(breaches).toEqual([])
  })
})

/** Helper to keep the per-domain assertions readable (hoisted; does not collide
 *  with the local `breaches` array inside each `it`). */
function filterBreaches(all: Array<{ rel: string; reason: string }>, pattern: RegExp): Array<{ rel: string; reason: string }> {
  return all.filter((b) => pattern.test(b.reason))
}

// ── QBO-KPI-6 / 7 / 8: outbound vs inbound rule ───────────────────────────────

describe('QBO-1A2 KPI firewall — outbound / inbound rule (QBO-KPI-6..8)', () => {
  it('QBO-KPI-6: outbound approved PowerOn → QBO remains permitted', () => {
    expect(() => assertQboReadOnlyFinancialBoundary('outbound')).not.toThrow()
    const outbound = {
      authority: 'owner_approved_outbound' as const,
      approvedBy: 'owner-1',
      approvedAt: '2025-12-31T00:00:00.000Z',
      source: { kind: 'invoice' as const, id: 'inv-1' },
      payload: { amount: 500 },
    }
    expect(classifyQuickBooksRecord(outbound)).toBe('owner_approved_outbound')
    expect(assertMirrorReadOnly(outbound)).toBe('owner_approved_outbound')
  })

  it('QBO-KPI-7: inbound QBO → comparison remains permitted', () => {
    expect(() => assertQboReadOnlyFinancialBoundary('inbound_comparison')).not.toThrow()
    const mirror = {
      authority: 'accounting_mirror' as const,
      realmId: 'realm-1',
      source: 'qbo_payment' as const,
      asOf: '2025-12-31T00:00:00.000Z',
      data: { total: 500 },
    }
    expect(assertMirrorReadOnly(mirror)).toBe('accounting_mirror')
    // Comparison is the permitted inbound consumption of a mirror.
    const result = compareForReconciliation(500, 500)
    expect(result.status).toBe('matched')
  })

  it('QBO-KPI-8: inbound QBO → automatic PowerOn replacement is forbidden', () => {
    expect(() => assertQboReadOnlyFinancialBoundary('inbound_replace')).toThrow(QboAuthorityViolationError)
    try {
      assertQboReadOnlyFinancialBoundary('inbound_replace')
    } catch (err) {
      expect((err as QboAuthorityViolationError).direction).toBe('inbound_replace')
    }
  })
})

// ── QBO-KPI-9 / 10: reconciliation result shape ──────────────────────────────

describe('QBO-1A2 KPI firewall — reconciliation result shape (QBO-KPI-9..10)', () => {
  it('QBO-KPI-9: reconciliation result exposes powerOnValue, quickBooksValue, difference, status', () => {
    const matched = compareForReconciliation(500, 500)
    expect(matched).toMatchObject({ powerOnValue: 500, quickBooksValue: 500, difference: 0, status: 'matched' })

    const diff = compareForReconciliation(500, 600)
    expect(diff).toMatchObject({ powerOnValue: 500, quickBooksValue: 600, difference: 100, status: 'difference' })

    const unavailable = compareForReconciliation(500, null)
    expect(unavailable).toMatchObject({ powerOnValue: 500, quickBooksValue: null, difference: null, status: 'unavailable' })

    const needsReview = compareForReconciliation(500, 500, { needsReview: true, needsReviewReason: 'ambiguous mapping' })
    expect(needsReview.status).toBe('needs_review')
    expect(needsReview.needsReviewReason).toBe('ambiguous mapping')
    // needs_review never auto-corrects; the values are still exposed for review.
    expect(needsReview.powerOnValue).toBe(500)
  })

  it('QBO-KPI-10: reconciliation result has no automatic mutation/apply method', () => {
    const result: QuickBooksReconciliationResult = compareForReconciliation(500, 600)
    const keys = Object.keys(result) as Array<keyof QuickBooksReconciliationResult>
    // These names are deliberately NOT keys of the result — that is the proof.
    // Typed as string[] (not keyof Result) so the assignment compiles; the runtime
    // not.toContain below plus the module's compile-time proof enforce the invariant.
    const forbidden: readonly string[] = [
      'applyToPowerOn',
      'syncIntoPowerOn',
      'replaceCanonicalValue',
      'apply',
      'sync',
      'correct',
      'import',
    ]
    for (const f of forbidden) {
      expect(keys).not.toContain(f)
    }
    // And the result exposes no function-valued member at all — it is a bag of data.
    for (const v of Object.values(result)) {
      expect(typeof v).not.toBe('function')
    }
    // Compile-time proof lives in the module (_PROOF_RECONCILIATION_HAS_NO_MUTATION_METHOD);
    // importing it here would be unused — its presence is enforced by tsc --noEmit.
  })

  it('QBO-KPI-10b: a reconciliation difference record carries the result, not an applier', () => {
    const result = compareForReconciliation(500, 600)
    const diffRecord = {
      authority: 'reconciliation_difference' as const,
      powerOnRef: { kind: 'service_log' as const, id: 'svc-1' },
      result,
    }
    expect(classifyQuickBooksRecord(diffRecord)).toBe('reconciliation_difference')
    expect(diffRecord.result.status).toBe('difference')
    // The difference record exposes no mutation method either.
    expect(typeof (diffRecord as unknown as Record<string, unknown>).applyToPowerOn).toBe('undefined')
  })
})

// ── QBO-KPI-11: webhook / CDC boundary ───────────────────────────────────────

describe('QBO-1A2 KPI firewall — webhook / CDC boundary (QBO-KPI-11)', () => {
  it('QBO-KPI-11: future webhook/CDC permits mirror refresh but not canonical mutation', () => {
    // Mirror refresh surfaces are explicitly allowed.
    expect(QBO_MIRROR_REFRESH_SURFACES).toEqual([
      'quickbooks_mirror_state',
      'quickbooks_sync_metadata',
      'reconciliation_status',
    ])
    for (const surface of QBO_MIRROR_REFRESH_SURFACES) {
      expect(() => assertWebhookCdcMutationBoundary(surface)).not.toThrow()
    }
    // Canonical PowerOn surfaces are forbidden for a webhook/CDC handler.
    const forbidden = [
      'poweron_payment_ledger',
      'poweron_collected_cash',
      'poweron_kpi_source',
      'poweron_project_cash',
      'poweron_annual_target',
    ]
    for (const surface of forbidden) {
      expect(() => assertWebhookCdcMutationBoundary(surface)).toThrow(QboAuthorityViolationError)
    }
    // Unknown surfaces are rejected too (fail closed).
    expect(() => assertWebhookCdcMutationBoundary('poweron_something_new')).toThrow(QboAuthorityViolationError)
  })
})

// ── QBO-KPI-12: historical 2025 comparison without mutation ──────────────────

describe('QBO-1A2 KPI firewall — historical 2025 comparison (QBO-KPI-12)', () => {
  it('QBO-KPI-12: a historical 2025 QBO value can be compared without mutating PowerOn', () => {
    const powerOn2025Collected = 123_456.78
    const qbo2025Payments = 120_000.0
    // The PowerOn snapshot is an opaque object the comparison never touches.
    const powerOnSnapshot = { collected: powerOn2025Collected, untouched: true }
    const snapshotBefore = JSON.parse(JSON.stringify(powerOnSnapshot))

    const result = compareForReconciliation(powerOn2025Collected, qbo2025Payments, {
      asOf: '2025-12-31T00:00:00.000Z',
    })

    // The comparison is read-only: the PowerOn snapshot is byte-for-byte unchanged.
    expect(powerOnSnapshot).toEqual(snapshotBefore)
    // The result is comparison-only data.
    expect(result).toMatchObject({
      powerOnValue: 123_456.78,
      quickBooksValue: 120_000.0,
      difference: -3_456.78,
      status: 'difference',
      asOf: '2025-12-31T00:00:00.000Z',
    })
    // No action named Sync/Import/Repair/Correct silently overwrites PowerOn —
    // the result exposes no mutation method (QBO-KPI-10) and inbound_replace throws
    // (QBO-KPI-8), so a 2025 comparison can never become an automatic correction.
    expect(() => assertQboReadOnlyFinancialBoundary('inbound_replace')).toThrow(QboAuthorityViolationError)
  })
})

// ── GUARD-1..4: scope guardrails ─────────────────────────────────────────────

describe('QBO-1A2 guardrails (GUARD-1..4)', () => {
  it('GUARD-1: no Supabase migration was created by QBO-1A2', () => {
    const migrations = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql'))
    // QBO-3A owns 132; QBO-4A.2 owns 133; QBO-4A.6 owns 134 (TEXT identity correction).
    // No OTHER qbo/quickbooks/intuit-named migration exists. (Concurrent referral work
    // may advance the highest migration number — that is not QBO-1A2 work.)
    const qboNamed = migrations.filter((f) => /qbo|quickbooks|intuit/i.test(f))
    expect(qboNamed).toEqual([
      '132_quickbooks_connections_and_oauth_states.sql',
      '133_quickbooks_customer_mappings.sql',
      '134_quickbooks_customer_mapping_text_identity.sql',
    ])
    const numbers = migrations.map((f) => parseInt(f.split('_')[0], 10)).filter((n) => Number.isFinite(n))
    const max = numbers.length ? Math.max(...numbers) : 0
    expect(max).toBeLessThanOrEqual(134)
  })

  it('GUARD-2: referral files untouched — none imports the QBO authority module or OAuth surface', () => {
    const referralFiles = [
      'src/services/referral/referralService.ts',
      'src/components/salesIntel/tabs/ReferralsTab.tsx',
      'src/__tests__/leadSrc4hUnlinkedReferrer.test.ts',
      'src/__tests__/leadSrc4iReferralProfiles.test.ts',
      'supabase/migrations/129_referral_unlinked_confirmation.sql',
    ]
    for (const f of referralFiles) {
      if (exists(f)) {
        const src = read(f)
        expect(src).not.toContain('services/quickbooks/quickbooksAuthority')
        expect(src).not.toContain('services/quickbooks/')
        expect(src).not.toContain('netlify/functions/quickbooks')
      }
    }
  })

  it('GUARD-3: package.json untouched by QBO-1A2 (no QuickBooks/Intuit dependency added)', () => {
    const pkg = read('package.json').toLowerCase()
    expect(pkg).not.toContain('intuit')
    expect(pkg).not.toMatch(/"(intuit|@intuit|quickbooks)[^"]*"\s*:\s*"\^?\d/)
  })

  it('GUARD-4: deno.lock untouched by QBO-1A2 (no Intuit entry added)', () => {
    if (exists('deno.lock')) {
      expect(read('deno.lock').toLowerCase()).not.toContain('intuit')
    }
  })
})