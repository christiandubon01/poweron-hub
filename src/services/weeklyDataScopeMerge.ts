/**
 * weeklyDataScopeMerge.ts — finance.weeklyData scoped merge helpers (Phase 6S-B).
 *
 * Protects the top-level BackupData.weeklyData[] array — a PERSISTED DERIVED
 * financial cache that drives MoneyPanel, Cash Flow, Business Overview, and the
 * pulse fallback charts — from broad-save overwrite by stale local state.
 *
 * weeklyData is NOT project.payments. The source of truth for project payments is
 * logs[].collected (owned by project.logs / project.payments). weeklyData is a
 * recalculated/imported historical weekly-row store; a "row" is one week keyed by
 * `wk`. Rows may be manually overridden (manualOverride === true), in which case
 * they must never be clobbered by a derived recalculation.
 *
 * This mirrors the project/service scoped-merge pattern (item-level, LWW onto a
 * freshly-fetched remote snapshot) but is kept entirely separate from
 * projectScopeMerge.ts and serviceScopeMerge.ts so those remain untouched. Pure
 * module: no React, localStorage, Supabase client, or side effects.
 *
 * Phase 6S-B intentionally does NOT touch: projects[], logs[], serviceLogs[],
 * project.finance, any project scope, or any service scope. Only weeklyData[] is
 * reconciled; everything else is carried through from the remote snapshot.
 */
import type { BackupData } from './backupDataService'

// ── Timestamp helpers ──────────────────────────────────────────────────────────

function isValidDateString(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!trimmed) return false
  return !Number.isNaN(Date.parse(trimmed))
}

function comparableMs(value: unknown): number {
  if (typeof value !== 'string') return Number.NEGATIVE_INFINITY
  const trimmed = value.trim()
  if (!trimmed) return Number.NEGATIVE_INFINITY
  const ms = Date.parse(trimmed)
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim()
}

function shortStableHash(input: string): string {
  let hash = 2166136261
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36).padStart(6, '0').slice(0, 8)
}

// ── Identity ────────────────────────────────────────────────────────────────────

/**
 * Stable identity for a weekly row.
 *  - Prefer the week number `wk` (the canonical weekly identity).
 *  - Fall back to `start` (week start date) when wk is missing.
 *  - Fall back to a deterministic compact fingerprint only when both are missing.
 * Never generates random ids.
 */
export function getWeeklyDataIdentity(row: any): string {
  if (row == null) return 'weekly:null'
  const wk = row?.wk
  if (wk !== undefined && wk !== null && String(wk).trim() !== '') return `wk:${String(wk)}`
  const start = normalizeText(row?.start)
  if (start) return `start:${start}`
  const parts = [row?.svc, row?.proj, row?.accum, row?.unbilled, row?.pendingInv, row?.totalExposure]
    .map(value => normalizeText(value))
  return `legacy:weekly:${shortStableHash(parts.join('|'))}`
}

// ── Normalization ────────────────────────────────────────────────────────────────

/**
 * Return a copy of `row` that preserves every existing field (known and unknown)
 * and, when a `timestamp` is supplied for an explicit update/recalculation:
 *  - coerces manualOverride to a real boolean when present,
 *  - stamps derivedAt on NON-manual rows (marks them as freshly recalculated),
 *  - stamps weeklyUpdatedAt on explicitly-updated rows.
 * Manual rows are never stamped by a recalculation timestamp — their own edits
 * own weeklyUpdatedAt. Unknown fields are never erased.
 */
export function normalizeWeeklyRow(row: any, timestamp?: string): any {
  if (!row || typeof row !== 'object') return row
  const next: any = { ...row }
  if ('manualOverride' in next) next.manualOverride = next.manualOverride === true
  const isManual = next.manualOverride === true
  if (timestamp && isValidDateString(timestamp)) {
    if (!isManual) {
      next.derivedAt = timestamp
      next.weeklyUpdatedAt = timestamp
    }
  }
  return next
}

// ── Merge ────────────────────────────────────────────────────────────────────────

/** Best available "freshness" timestamp for a non-manual row. */
function nonManualFreshnessMs(row: any): number {
  return Math.max(comparableMs(row?.derivedAt), comparableMs(row?.weeklyUpdatedAt))
}

/**
 * Overlay `top`'s defined fields onto `base`. Undefined values in `top` never
 * wipe a value already present in `base` — this guarantees we never blank out a
 * remote row's field with an undefined incoming field.
 */
function overlayDefined(base: any, top: any): any {
  const out: any = { ...base }
  for (const key of Object.keys(top || {})) {
    if (top[key] !== undefined) out[key] = top[key]
  }
  return out
}

/**
 * Pick the winning row for one wk identity.
 *  - manualOverride === true beats a non-manual derived row.
 *  - both manual → newer weeklyUpdatedAt wins; tie/missing → remote wins
 *    (never overwrite manual data on a tie).
 *  - neither manual → newer derivedAt/weeklyUpdatedAt wins; tie/missing → incoming
 *    wins (explicit weeklyData recalculation saves should apply).
 * The winner's defined fields overlay the remote row so no remote field is wiped
 * by an undefined incoming field.
 */
function pickWeeklyWinner(remote: any, incoming: any): any {
  const rMan = remote?.manualOverride === true
  const iMan = incoming?.manualOverride === true

  let winner: any
  if (rMan && !iMan) {
    winner = remote
  } else if (iMan && !rMan) {
    winner = incoming
  } else if (rMan && iMan) {
    winner = comparableMs(incoming?.weeklyUpdatedAt) > comparableMs(remote?.weeklyUpdatedAt)
      ? incoming
      : remote
  } else {
    // Neither manual: newer derived/updated wins; exact tie/missing → incoming.
    winner = nonManualFreshnessMs(incoming) >= nonManualFreshnessMs(remote) ? incoming : remote
  }

  return overlayDefined(remote, winner)
}

/**
 * Merge two weeklyData[] arrays by `wk` identity (delete-safe LWW with
 * manualOverride precedence). Rows present on only one side are preserved. Result
 * is sorted by wk ascending when wk is present (rows without wk are appended).
 *
 * Tie semantics are directional: for two non-manual rows an exact-tie resolves to
 * `incomingRows`. Callers that want the OPPOSITE (remote wins ties, e.g. the
 * broad-save preservation guard) simply pass the row set they want to win as
 * `incomingRows`.
 */
export function mergeWeeklyRowsByWk(remoteRows: any[], incomingRows: any[]): any[] {
  const remote = (Array.isArray(remoteRows) ? remoteRows : []).map(r => normalizeWeeklyRow(r))
  const incoming = (Array.isArray(incomingRows) ? incomingRows : []).map(r => normalizeWeeklyRow(r))

  const remoteById = new Map<string, any>()
  for (const row of remote) remoteById.set(getWeeklyDataIdentity(row), row)

  const result: any[] = []
  const used = new Set<string>()

  // Incoming order first (preserves local ordering intent), then remote-only rows.
  for (const inc of incoming) {
    const id = getWeeklyDataIdentity(inc)
    if (used.has(id)) continue
    used.add(id)
    const rem = remoteById.get(id)
    result.push(rem ? pickWeeklyWinner(rem, inc) : inc)
  }
  for (const rem of remote) {
    const id = getWeeklyDataIdentity(rem)
    if (used.has(id)) continue
    used.add(id)
    result.push(rem)
  }

  // Sort by wk ascending when numeric wk exists; rows without a numeric wk keep
  // their relative order and sink to the end.
  const wkOf = (row: any): number => {
    const n = Number(row?.wk)
    return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY
  }
  result.sort((a, b) => wkOf(a) - wkOf(b))
  return result
}

/**
 * Merge the weeklyData[] from incomingBackup into a fresh clone of remoteBackup.
 * ONLY weeklyData[] is reconciled; projects[], logs[], serviceLogs[],
 * project.finance, project scopes, service scopes, and every other key are carried
 * through from the remote snapshot untouched.
 */
export function mergeWeeklyDataIntoRemote(
  remoteBackup: BackupData,
  incomingBackup: BackupData,
): BackupData {
  const merged = JSON.parse(JSON.stringify(remoteBackup)) as BackupData
  const remoteRows = Array.isArray(merged.weeklyData) ? merged.weeklyData : []
  const incomingRows = Array.isArray(incomingBackup?.weeklyData) ? incomingBackup.weeklyData : []
  merged.weeklyData = mergeWeeklyRowsByWk(remoteRows, incomingRows) as any
  return merged
}

/**
 * FORENSIC-KPI-2B2-2F — build the outgoing blob for a Money → 52-Week
 * "Recalculate from my data" action WITHOUT adopting remote canonical arrays.
 *
 * The weeklyData recalculation is a REPORTING action: it rebuilds the derived
 * weekly-row cache from current source truth. It must NOT change canonical
 * business truth (projects[], logs[], serviceLogs[], settings, employees[], …)
 * because the Header KPIs (Pipeline / Paid YTD / Exposure / Service Unbilled /
 * Open Projects / Open RFIs) read canonical source arrays via getKPIs, and a
 * chart recalculation is not a business transaction.
 *
 * Previously the handler built `mergeWeeklyDataIntoRemote(remote, local)` and
 * passed the whole result to saveBackupWithRemoteBaselineSync. That result is a
 * clone of the REMOTE snapshot with only weeklyData swapped, so its canonical
 * arrays are remote's. saveBackupWithRemoteBaselineSync →
 * mergeScopedIncomingIntoLocal then folded those remote canonical arrays into
 * local (it ignores _scopes), so after the post-save reload the Header KPIs
 * changed to reflect remote canonical. That is the defect.
 *
 * This helper produces the SAME weeklyData the remote branch already produced
 * (mergeWeeklyRowsByWk(remote.weeklyData, recalced): remote manualOverride rows
 * preserved, derived rows recalculated, non-manual ties go to the recalced side)
 * but pairs it with LOCAL canonical via a shallow clone of localBackup. The
 * caller then passes this local-canonical blob to saveBackupWithRemoteBaselineSync,
 * so mergeScopedIncomingIntoLocal(local, outgoing) merges local→local for every
 * canonical key (a no-op under prefer-newer id merge) and only weeklyData moves.
 *
 * Pure: no React, localStorage, Supabase, or side effects. Returns a new object;
 * the weeklyData array is a fresh merge result, the canonical arrays are the same
 * references the caller already holds (shallow clone — mergeScopedIncomingIntoLocal
 * does not mutate them in place).
 */
export function buildWeeklyRecalcOutgoing(
  localBackup: BackupData,
  remoteBackup: BackupData | null | undefined,
  recalcedWeeklyData: any[],
): BackupData {
  let outgoingWeeklyData = recalcedWeeklyData
  if (remoteBackup) {
    // Reuse the exact weeklyData merge the remote branch already used: base the
    // merge on the remote snapshot, take ONLY the reconciled weeklyData array,
    // and discard the remote canonical base.
    outgoingWeeklyData = mergeWeeklyDataIntoRemote(remoteBackup, {
      ...localBackup,
      weeklyData: recalcedWeeklyData,
    }).weeklyData
  }
  return { ...localBackup, weeklyData: outgoingWeeklyData }
}

/**
 * Fold newer REMOTE weeklyData[] into a fresh clone of `outgoingBackup` when the
 * outgoing save is NOT a weeklyData save. This prevents an unrelated broad save
 * from pushing stale local weeklyData over newer remote weeklyData. Remote rows
 * win ties (they are passed as the tie-winning side), while manualOverride rules
 * still apply so a genuine local manual row is not lost. No other key is touched.
 */
export function mergeRemoteWeeklyDataIntoOutgoing(
  outgoingBackup: BackupData,
  remoteBackup: BackupData,
): BackupData {
  const merged = JSON.parse(JSON.stringify(outgoingBackup)) as BackupData
  const outgoingRows = Array.isArray(merged.weeklyData) ? merged.weeklyData : []
  const remoteRows = Array.isArray(remoteBackup?.weeklyData) ? remoteBackup.weeklyData : []
  // Pass remote as `incomingRows` so remote wins non-manual ties (protect remote).
  merged.weeklyData = mergeWeeklyRowsByWk(outgoingRows, remoteRows) as any
  return merged
}
