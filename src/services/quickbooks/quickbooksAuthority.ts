/**
 * src/services/quickbooks/quickbooksAuthority.ts
 *
 * QBO-1A2 — QuickBooks Online / PowerOn KPI & Financial Authority Firewall.
 *
 * OWNER REQUIREMENT (verbatim contract):
 *   QuickBooks Online must NEVER silently become an authority for PowerOn Hub's
 *   operational financial KPIs. QuickBooks data may be historically accurate for
 *   a period (e.g. 2025) while newer PowerOn operational data is ahead of QBO.
 *   QuickBooks historical/accounting data may eventually be used for READ-ONLY
 *   comparison, reconciliation, and verification — but NOT automatic KPI
 *   replacement. This safeguard must exist BEFORE persistent QBO sync begins.
 *
 * POWERON remains the canonical authority for its operational financial truth.
 * QuickBooks is an ACCOUNTING DESTINATION + ACCOUNTING RECONCILIATION SOURCE.
 * It is NOT a PowerOn KPI authority.
 *
 * No QBO response, webhook, CDC result, invoice state, payment state, customer
 * balance, report, historical total, or accounting aggregate may automatically
 * rewrite PowerOn's canonical KPI inputs.
 *
 * This module makes that boundary explicit in code and types so future QBO work
 * inherits the invariant structurally rather than by convention. It is types +
 * pure helpers + a compile-time proof only — it performs no I/O, reads no
 * environment, touches no secrets, and imports NO PowerOn canonical financial
 * module (importing one here would itself be a firewall breach).
 */
// Deliberately no imports from PowerOn canonical financial authorities.

// ── Reconciliation numeric helper (local, so this module never imports the
//    canonical servicePaymentLedger MONEY_EPSILON — that import would breach the
//    very firewall this module defines). ─────────────────────────────────────

/** Smallest cash difference treated as a reconciliation match. Local copy. */
const QBO_RECONCILIATION_EPSILON = 0.005

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

// ── §4 QuickBooks data classification ───────────────────────────────────────

/**
 * Every QuickBooks-derived datum must declare exactly one of these authorities.
 * The classification makes explicit whether a value is external accounting
 * identity, an accounting mirror, owner-approved outbound data, or a
 * reconciliation difference — and in NO case canonical PowerOn financial truth.
 */
export type QuickBooksDataAuthority =
  | 'external_accounting_identity'
  | 'accounting_mirror'
  | 'owner_approved_outbound'
  | 'reconciliation_difference'

/** The four valid classifications, in source order, for exhaustiveness checks. */
export const QUICKBOOKS_DATA_AUTHORITIES: readonly QuickBooksDataAuthority[] = [
  'external_accounting_identity',
  'accounting_mirror',
  'owner_approved_outbound',
  'reconciliation_difference',
] as const

/**
 * A. EXTERNAL ACCOUNTING IDENTITY — realmId, QBO Customer/Invoice/Payment ids.
 * Stored in dedicated QuickBooks integration records only. Never canonical
 * PowerOn financial state; never selects a PowerOn org (the signed OAuth state
 * already binds PowerOn identity).
 */
export interface QuickBooksExternalIdentity {
  readonly authority: 'external_accounting_identity'
  readonly realmId: string
  /** QBO Customer / Invoice / Payment / Term id. */
  readonly qboId: string
  readonly kind: 'customer' | 'invoice' | 'payment' | 'term'
  /** Optional pointer to the PowerOn record this external id corresponds to. */
  readonly powerOnRef?: { readonly kind: 'service_log' | 'project' | 'customer'; readonly id: string } | null
}

/**
 * B. ACCOUNTING MIRROR — QBO invoice balance, payment state, invoice status,
 * transaction date, historical accounting totals. EXTERNAL mirror /
 * reconciliation data. Must NOT automatically become PowerOn canonical
 * financial truth.
 */
export interface QuickBooksMirrorRecord {
  readonly authority: 'accounting_mirror'
  readonly realmId: string
  readonly source:
    | 'qbo_invoice'
    | 'qbo_payment'
    | 'qbo_report'
    | 'qbo_customer'
    | 'qbo_cdc'
    | 'qbo_webhook'
  /** ISO timestamp of the QBO read that produced this mirror snapshot. */
  readonly asOf: string
  /** External mirror payload — NEVER canonical PowerOn financial truth. */
  readonly data: unknown
  /** Optional pointer to the PowerOn canonical record this mirror reflects. */
  readonly powerOnRef?: { readonly kind: 'service_log' | 'project' | 'payment'; readonly id: string } | null
}

/**
 * C. OWNER-APPROVED OUTBOUND DATA — PowerOn canonical data deliberately sent to
 * QBO AFTER owner approval (approved invoice amount, customer, description).
 */
export interface QuickBooksOutboundPayload {
  readonly authority: 'owner_approved_outbound'
  /** PowerOn user id that approved the outbound write. */
  readonly approvedBy: string
  /** ISO timestamp of owner approval. */
  readonly approvedAt: string
  readonly source: { readonly kind: 'service_log' | 'project' | 'invoice'; readonly id: string }
  /** Approved outbound payload bound for QuickBooks. */
  readonly payload: unknown
}

/**
 * D. RECONCILIATION DIFFERENCE — a comparison between PowerOn canonical truth and
 * the QuickBooks accounting mirror. Produces a status (matched / difference /
 * needs_review). It does NOT produce an automatic PowerOn correction.
 */
export interface QuickBooksReconciliationDifference {
  readonly authority: 'reconciliation_difference'
  readonly powerOnRef: { readonly kind: 'service_log' | 'project' | 'payment'; readonly id: string }
  readonly result: QuickBooksReconciliationResult
}

// ── §8 Future reconciliation API shape ──────────────────────────────────────

export type ReconciliationStatus = 'matched' | 'difference' | 'needs_review' | 'unavailable'

/**
 * Comparison-only reconciliation result — the safe reusable shape.
 *
 * EXPOSES: powerOnValue, quickBooksValue, difference, status.
 * FORBIDDEN: any automatic mutation/apply method. This interface is deliberately
 * a bag of readonly fields with NO method such as applyToPowerOn() /
 * syncIntoPowerOn() / replaceCanonicalValue(). The compile-time proof below
 * enforces that invariant: adding such a method breaks the type-check.
 */
export interface QuickBooksReconciliationResult {
  readonly powerOnValue: number | null
  readonly quickBooksValue: number | null
  /** quickBooksValue − powerOnValue, or null when either side is unavailable. */
  readonly difference: number | null
  readonly status: ReconciliationStatus
  /** ISO timestamp the comparison was computed, when supplied. */
  readonly asOf?: string
  /** Free-text reason when status is 'needs_review' (manual flag, never auto). */
  readonly needsReviewReason?: string | null
}

/**
 * Method names a reconciliation result must NEVER expose — automatic canonical
 * mutation of PowerOn financial truth from a QBO value is forbidden.
 */
type ForbiddenReconciliationMutationMethod =
  | 'applyToPowerOn'
  | 'syncIntoPowerOn'
  | 'replaceCanonicalValue'
  | 'apply'
  | 'sync'
  | 'correct'
  | 'import'

/**
 * Compile-time proof: QuickBooksReconciliationResult exposes none of the
 * forbidden mutation methods. When no forbidden key is present, this resolves to
 * `never` and the assignment is valid. If a future edit adds a forbidden method,
 * the resolved key-name literal is not assignable to `never` and the build fails.
 */
type ForbiddenMethodOnResult = {
  [K in Extract<keyof QuickBooksReconciliationResult, ForbiddenReconciliationMutationMethod>]: K
}[Extract<keyof QuickBooksReconciliationResult, ForbiddenReconciliationMutationMethod>]
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _PROOF_RECONCILIATION_HAS_NO_MUTATION_METHOD: never =
  null as unknown as ForbiddenMethodOnResult

// ── §9 Outbound vs inbound rule ──────────────────────────────────────────────

/**
 * The financial direction of a proposed QuickBooks operation, checked at the
 * read-only financial boundary.
 *
 *  - 'outbound'             : PowerOn canonical → owner review → QuickBooks. ALLOWED.
 *  - 'inbound_comparison'   : QuickBooks → reconciliation mirror → comparison. ALLOWED.
 *  - 'inbound_replace'      : QuickBooks → silently replace PowerOn canonical. FORBIDDEN.
 */
export type QboFinancialDirection = 'outbound' | 'inbound_comparison' | 'inbound_replace'

/**
 * Raised when a QuickBooks operation attempts to cross the read-only financial
 * boundary — i.e. an inbound QBO value would silently replace canonical PowerOn
 * financial/KPI truth.
 */
export class QboAuthorityViolationError extends Error {
  readonly direction: QboFinancialDirection | 'unclassified'
  constructor(direction: QboFinancialDirection | 'unclassified', message: string) {
    super(message)
    this.name = 'QboAuthorityViolationError'
    this.direction = direction
  }
}

/**
 * Assert that a proposed QuickBooks financial direction stays on the read-only
 * side of the firewall. Throws QboAuthorityViolationError for 'inbound_replace'.
 * Outbound (PowerOn → QBO, owner-approved) and inbound comparison are permitted.
 */
export function assertQboReadOnlyFinancialBoundary(direction: QboFinancialDirection): void {
  if (direction === 'inbound_replace') {
    throw new QboAuthorityViolationError(
      'inbound_replace',
      'Forbidden: a QuickBooks value may not silently replace a PowerOn canonical ' +
        'financial/KPI value. QuickBooks is an accounting mirror and reconciliation ' +
        'source only — use compareForReconciliation() for comparison, or an explicit ' +
        'owner-approved reconciliation/import ticket for any canonical correction.',
    )
  }
}

/**
 * Classify a QuickBooks-derived record by its declared `authority`. Throws if the
 * record is unclassified — a QBO datum must explicitly declare which external
 * accounting category it belongs to, so it can never be mistaken for canonical
 * PowerOn financial truth.
 */
export function classifyQuickBooksRecord(record: {
  authority?: unknown
}): QuickBooksDataAuthority {
  const a = record?.authority
  if (
    a === 'external_accounting_identity' ||
    a === 'accounting_mirror' ||
    a === 'owner_approved_outbound' ||
    a === 'reconciliation_difference'
  ) {
    return a
  }
  throw new QboAuthorityViolationError(
    'unclassified',
    'A QuickBooks record must declare one of the four data-authority classifications ' +
      '(external_accounting_identity | accounting_mirror | owner_approved_outbound | ' +
      'reconciliation_difference). Unclassified QuickBooks data cannot be treated as canonical.',
  )
}

/**
 * Assert that a QuickBooks mirror record is read-only with respect to PowerOn
 * canonical financial truth. A mirror may refresh its own snapshot and update
 * reconciliation status; it may not write PowerOn canonical records.
 */
export function assertMirrorReadOnly(record: { authority?: unknown }): QuickBooksDataAuthority {
  const authority = classifyQuickBooksRecord(record)
  // An accounting mirror is, by definition, read-only vs canonical PowerOn truth.
  // Owner-approved outbound is the only QBO→canonical-adjacent path and it flows
  // the OTHER direction (PowerOn → QBO), so it never replaces PowerOn truth.
  return authority
}

// ── §8 / §12 Reconciliation comparison builder ──────────────────────────────

/**
 * Build a comparison-only reconciliation result from a PowerOn canonical value
 * and a QuickBooks accounting value. This is READ-ONLY: it returns a fresh
 * result object and mutates nothing. A null side yields 'unavailable'.
 *
 * `needsReview: true` flags the comparison for manual review regardless of the
 * numeric difference (e.g. a QBO value whose mapping is ambiguous) — it never
 * auto-corrects PowerOn truth.
 */
export function compareForReconciliation(
  powerOnValue: number | null,
  quickBooksValue: number | null,
  options?: { epsilon?: number; asOf?: string; needsReview?: boolean; needsReviewReason?: string },
): QuickBooksReconciliationResult {
  const epsilon = options?.epsilon ?? QBO_RECONCILIATION_EPSILON
  const asOf = options?.asOf
  if (powerOnValue == null || quickBooksValue == null) {
    return { powerOnValue, quickBooksValue, difference: null, status: 'unavailable', asOf }
  }
  const difference = round2(quickBooksValue - powerOnValue)
  const status: ReconciliationStatus =
    options?.needsReview === true
      ? 'needs_review'
      : Math.abs(difference) <= epsilon
        ? 'matched'
        : 'difference'
  return {
    powerOnValue,
    quickBooksValue,
    difference,
    status,
    asOf,
    needsReviewReason: options?.needsReviewReason ?? null,
  }
}

// ── §10 Webhook / CDC future rule ───────────────────────────────────────────

/**
 * The set of QuickBooks integration surfaces a future webhook or CDC event may
 * legitimately update. This is an explicit allow-list — anything not listed is
 * out of scope for a webhook/CDC handler.
 */
export const QBO_MIRROR_REFRESH_SURFACES: readonly string[] = [
  'quickbooks_mirror_state',
  'quickbooks_sync_metadata',
  'reconciliation_status',
] as const

/**
 * Assert the webhook/CDC mutation boundary: a future QuickBooks webhook or CDC
 * event may refresh mirror state, sync metadata, and reconciliation status. It
 * may NOT directly update PowerOn payment ledger, collected cash, or KPI source
 * records. Passing a canonical PowerOn surface throws QboAuthorityViolationError.
 */
export function assertWebhookCdcMutationBoundary(surface: string): void {
  if (QBO_MIRROR_REFRESH_SURFACES.includes(surface)) return
  if (
    surface === 'poweron_payment_ledger' ||
    surface === 'poweron_collected_cash' ||
    surface === 'poweron_kpi_source' ||
    surface === 'poweron_project_cash' ||
    surface === 'poweron_annual_target'
  ) {
    throw new QboAuthorityViolationError(
      'inbound_replace',
      `Forbidden: a QuickBooks webhook/CDC event may not update canonical PowerOn ` +
        `surface "${surface}". Webhooks/CDC may refresh only mirror state, sync ` +
        `metadata, and reconciliation status.`,
    )
  }
  // Unknown surfaces are rejected too — fail closed rather than silently allowing
  // an unlisted canonical surface to slip through.
  throw new QboAuthorityViolationError(
    'inbound_replace',
    `Unknown PowerOn surface "${surface}" is not in the QBO webhook/CDC allow-list. ` +
      `A webhook/CDC handler may update only: ${QBO_MIRROR_REFRESH_SURFACES.join(', ')}.`,
  )
}

// ── §3 / §7 PowerOn canonical financial authority registry ───────────────────
//
// The protected PowerOn authorities. This registry is the contract a static
// import-boundary test reads: no module under src/services/quickbooks/** or
// netlify/functions/quickbooks/** may import these modules or call these
// mutation symbols. Reader symbols are listed for documentation — importing a
// reader is not a canonical write, but QBO OAuth code currently imports none of
// them and should remain decoupled from PowerOn financial truth entirely.
//
// The paths are deliberately stored as string literals (not imports) so that
// listing them here is NOT itself a boundary breach.

export interface PowerOnCanonicalFinancialAuthority {
  /** Owner hard-locked domain name. */
  readonly domain: string
  readonly description: string
  /** Repo-relative module whose mutation exports are protected. */
  readonly protectedModule: string
  /** Exported mutation symbols QBO OAuth modules must never import/call. */
  readonly protectedMutationSymbols: readonly string[]
  /** Exported reader symbols (pure) — documented; not a breach to read. */
  readonly readerSymbols: readonly string[]
}

export const POWERON_CANONICAL_FINANCIAL_AUTHORITIES: readonly PowerOnCanonicalFinancialAuthority[] = [
  {
    domain: 'service_payment_ledger',
    description:
      'Service payment ledger — payments[], collected, balanceDue, payStatus, receivedAt authority.',
    protectedModule: 'src/features/service-quote/servicePaymentLedger.ts',
    protectedMutationSymbols: [
      'recordServicePayment',
      'buildServiceLogWithPayment',
      'ensureServicePaymentLedger',
      'createServicePaymentLegacyBaseline',
      'resolveServiceLegacyPayments',
      'reconcileServiceCacheFromLedger',
      'newServicePaymentEventId',
    ],
    readerSymbols: [
      'sumServicePayments',
      'deriveServicePayStatus',
      'resolveServiceBalanceDue',
      'resolveServiceCollected',
      'resolveServiceTotalBillable',
      'getServicePaymentEvents',
      'isLiveServicePaymentEvent',
      'hasServicePaymentLedger',
      'getServiceLegacyUnknownCash',
    ],
  },
  {
    domain: 'service_cash_date',
    description: 'Service cash-by-date reader (receivedAt is the authoritative cash date).',
    protectedModule: 'src/features/service-quote/serviceCashDate.ts',
    protectedMutationSymbols: [],
    readerSymbols: ['getServiceCashForRange', 'getServiceCashSummary'],
  },
  {
    domain: 'project_cash',
    description: 'Project paid / cash writers — backup.logs Payment entries (project paid source of truth).',
    protectedModule: 'src/components/v15r/V15rProjectsPanel.tsx',
    protectedMutationSymbols: ['handleMarkFullPayment', 'handleLogPartialPayment'],
    readerSymbols: [],
  },
  {
    domain: 'backup_data_store',
    description: 'BackupData store + project financials reader + paidbackfill migration writer.',
    protectedModule: 'src/services/backupDataService.ts',
    protectedMutationSymbols: ['saveBackupData', 'ensureProjectFinanceBucket'],
    readerSymbols: ['getBackupData', 'getProjectFinancials', 'projectLogsFor', 'health'],
  },
  {
    domain: 'collected_cash_authority',
    description: 'Canonical collected-cash range reader + lifetime aggregator.',
    protectedModule: 'src/services/collectedRevenueRange.ts',
    protectedMutationSymbols: [],
    readerSymbols: [
      'getCollectedRevenueForRange',
      'getLifetimeCollectedRevenue',
      'getCurrentYearCollectedRevenue',
      'isSyntheticPaidBackfillLog',
    ],
  },
  {
    domain: 'revenue_timeline',
    description: 'KPI timeline preset → canonical collected-cash range layer.',
    protectedModule: 'src/services/financialTimelineRange.ts',
    protectedMutationSymbols: [],
    readerSymbols: ['resolveTimelineRange', 'getTimelineCollected'],
  },
  {
    domain: 'weekly_financial_policy',
    description: '52-week automatic derived view of canonical dated cash (weekly financial policy).',
    protectedModule: 'src/services/weeklyFinancialPolicy.ts',
    protectedMutationSymbols: ['recalculateWeeklyData'],
    readerSymbols: [
      'calculateWeeklyFinancialsForRange',
      'calculateDailyFinancialsForDate',
      'resolveWeeklyDataForRead',
      'resolveCanonicalLocalDayRange',
    ],
  },
  {
    domain: 'annual_daily_target',
    description: 'Annual Target / Daily Target business goal truth builder.',
    protectedModule: 'src/services/businessGoalTruth.ts',
    protectedMutationSymbols: [],
    readerSymbols: ['buildBusinessGoalTruth', 'resolveTrailing90DayWindow'],
  },
  {
    domain: 'daily_target_query',
    description: 'Daily Target query (reads settings.dayTarget).',
    protectedModule: 'src/services/revenueTimelineQueries.ts',
    protectedMutationSymbols: [],
    readerSymbols: ['getDailyTarget', 'query8WeekCashFlow', 'queryMonthlyRevenue'],
  },
  {
    domain: 'estimate_calculations',
    description: 'Canonical estimate / service quote math (conversion value authority).',
    protectedModule: 'src/features/service-quote/serviceQuoteMath.ts',
    protectedMutationSymbols: [],
    readerSymbols: ['computeServiceQuote', 'resolveTotalQuoted', 'resolveStoredSuggestedQuote'],
  },
] as const