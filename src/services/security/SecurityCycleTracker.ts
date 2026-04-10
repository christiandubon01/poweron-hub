/**
 * SecurityCycleTracker.ts
 *
 * SEC6 — Monthly Security Cycle Tracking
 *
 * Persists every security test cycle to Supabase `security_cycles` table.
 * Provides history queries, next-cycle date calculation, and cross-cycle
 * improvement/regression analysis.
 *
 * MONTHLY CYCLE CONTRACT
 * ──────────────────────
 *   Month 1  : Level 1 (baseline)
 *   Month 2  : Level 2 + regression on Level 1
 *   Month 3  : Level 3 + regression on Levels 1–2
 *   …
 *   Each month: run new level + regression on ALL previous levels.
 *   If any regression fails → CRITICAL alert, block level increase.
 */

import { supabase } from '@/lib/supabase';
import type { LevelTestSummary } from './DifficultyEscalation';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CycleRecord {
  id: string;
  cycle_number: number;
  level: number;
  started_at: string;
  completed_at: string | null;
  status: 'in_progress' | 'passed' | 'failed' | 'blocked';
  /** Aggregate pass/fail counts for the primary level */
  primary_total: number;
  primary_passed: number;
  primary_failed: number;
  /** Full per-level regression breakdown stored as JSON */
  regression_results: LevelTestSummary[];
  /** True if all levels (including regressions) passed */
  all_passed: boolean;
  /** Human-readable notes / error messages */
  notes: string | null;
}

export interface CycleHistoryEntry {
  cycleNumber: number;
  level: number;
  startedAt: string;
  completedAt: string | null;
  status: CycleRecord['status'];
  allPassed: boolean;
  primaryPassed: number;
  primaryFailed: number;
  regressionResults: LevelTestSummary[];
  notes: string | null;
}

export interface CrossCycleAnalysis {
  totalCycles: number;
  cyclesPassed: number;
  cyclesFailed: number;
  cyclesBlocked: number;
  /** Level each cycle operated at */
  levelsReached: number[];
  /** Progression direction: 'improving' | 'stable' | 'regressing' */
  trend: 'improving' | 'stable' | 'regressing';
  /** Percentage of tests passed in the most recent cycle */
  latestPassRate: number;
  /** Percentage of tests passed in the cycle before the latest */
  previousPassRate: number;
  /** Delta: positive = improvement, negative = regression */
  passRateDelta: number;
  summary: string;
}

// ── Table constants ───────────────────────────────────────────────────────────

const TABLE = 'security_cycles';

// ── Helpers ───────────────────────────────────────────────────────────────────

function mapRow(row: Record<string, unknown>): CycleHistoryEntry {
  const regressionResults: LevelTestSummary[] = (() => {
    if (!row.regression_results) return [];
    if (typeof row.regression_results === 'string') {
      try {
        return JSON.parse(row.regression_results) as LevelTestSummary[];
      } catch {
        return [];
      }
    }
    if (Array.isArray(row.regression_results)) {
      return row.regression_results as LevelTestSummary[];
    }
    return [];
  })();

  return {
    cycleNumber: Number(row.cycle_number ?? 0),
    level: Number(row.level ?? 1),
    startedAt: String(row.started_at ?? ''),
    completedAt: row.completed_at ? String(row.completed_at) : null,
    status: (row.status as CycleRecord['status']) ?? 'in_progress',
    allPassed: Boolean(row.all_passed),
    primaryPassed: Number(row.primary_passed ?? 0),
    primaryFailed: Number(row.primary_failed ?? 0),
    regressionResults,
    notes: row.notes ? String(row.notes) : null,
  };
}

// ── Core API ──────────────────────────────────────────────────────────────────

/**
 * Log a completed security cycle to the `security_cycles` table.
 *
 * @param level            Difficulty level that was tested
 * @param results          Array of per-level summaries (primary + regressions)
 * @param notes            Optional free-text notes (error messages, block reasons)
 */
export async function trackCycle(
  level: number,
  results: LevelTestSummary[],
  notes?: string
): Promise<CycleHistoryEntry> {
  // Derive the next cycle_number
  let cycleNumber = 1;
  try {
    const { data: latest } = await (supabase as any)
      .from(TABLE)
      .select('cycle_number')
      .order('cycle_number', { ascending: false })
      .limit(1)
      .single();

    if (latest?.cycle_number) {
      cycleNumber = Number(latest.cycle_number) + 1;
    }
  } catch {
    // First cycle or empty table — default to 1
  }

  const primarySummary = results.find((r) => r.level === level);
  const allPassed = results.every((r) => r.allPassed);

  const status: CycleRecord['status'] = (() => {
    if (!primarySummary) return 'in_progress';
    if (allPassed) return 'passed';
    const locked = results.some((r) => !r.allPassed && r.level < level);
    if (locked) return 'blocked';
    return 'failed';
  })();

  const now = new Date().toISOString();

  const payload: Omit<CycleRecord, 'id'> = {
    cycle_number: cycleNumber,
    level,
    started_at: now,
    completed_at: now,
    status,
    primary_total: primarySummary?.totalTests ?? 0,
    primary_passed: primarySummary?.passedTests ?? 0,
    primary_failed: primarySummary?.failedTests ?? 0,
    regression_results: results,
    all_passed: allPassed,
    notes: notes ?? null,
  };

  const { data, error } = await (supabase as any)
    .from(TABLE)
    .insert(payload)
    .select()
    .single();

  if (error) {
    console.error('[SecurityCycleTracker] Failed to write cycle record:', error.message);
    // Return a local-only entry so callers don't crash
    return {
      cycleNumber,
      level,
      startedAt: now,
      completedAt: now,
      status,
      allPassed,
      primaryPassed: payload.primary_passed,
      primaryFailed: payload.primary_failed,
      regressionResults: results,
      notes: notes ?? null,
    };
  }

  return mapRow(data as Record<string, unknown>);
}

/**
 * Retrieve all past security cycles, most recent first.
 */
export async function getCycleHistory(): Promise<CycleHistoryEntry[]> {
  const { data, error } = await (supabase as any)
    .from(TABLE)
    .select('*')
    .order('cycle_number', { ascending: false });

  if (error) {
    console.warn('[SecurityCycleTracker] Could not fetch cycle history:', error.message);
    return [];
  }

  if (!Array.isArray(data)) return [];

  return data.map((row: Record<string, unknown>) => mapRow(row));
}

/**
 * Get the latest completed cycle entry.
 */
export async function getLatestCycle(): Promise<CycleHistoryEntry | null> {
  const { data, error } = await (supabase as any)
    .from(TABLE)
    .select('*')
    .order('cycle_number', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) return null;
  return mapRow(data as Record<string, unknown>);
}

/**
 * Calculate the date of the next scheduled cycle escalation.
 * Each cycle runs on a ~28-day cadence (monthly).
 *
 * Returns an ISO string representing the next cycle's due date.
 */
export async function getNextCycleDate(): Promise<string> {
  const latest = await getLatestCycle();

  if (!latest?.completedAt) {
    // No prior cycle — the next cycle is due now
    return new Date().toISOString();
  }

  const completedTs = new Date(latest.completedAt).getTime();
  const nextTs = completedTs + 28 * 24 * 60 * 60 * 1000; // + 28 days
  return new Date(nextTs).toISOString();
}

/**
 * Determine whether a new cycle is overdue (i.e., >= 28 days since last cycle).
 */
export async function isCycleDue(): Promise<boolean> {
  const nextDate = await getNextCycleDate();
  return Date.now() >= new Date(nextDate).getTime();
}

/**
 * Compare metrics across all completed cycles to identify improvement or regression.
 *
 * Trend logic:
 *   - 'improving'  : latest pass rate > previous pass rate
 *   - 'regressing' : latest pass rate < previous pass rate
 *   - 'stable'     : rates are equal (or only one cycle exists)
 */
export async function compareAcrossCycles(): Promise<CrossCycleAnalysis> {
  const history = await getCycleHistory();

  const totalCycles = history.length;
  const cyclesPassed = history.filter((c) => c.status === 'passed').length;
  const cyclesFailed = history.filter((c) => c.status === 'failed').length;
  const cyclesBlocked = history.filter((c) => c.status === 'blocked').length;
  const levelsReached = history.map((c) => c.level);

  // Pass rate = primaryPassed / (primaryPassed + primaryFailed) for each cycle
  const passRateFor = (c: CycleHistoryEntry): number => {
    const total = c.primaryPassed + c.primaryFailed;
    if (total === 0) return c.allPassed ? 1 : 0;
    return c.primaryPassed / total;
  };

  // History is newest-first
  const latestPassRate = history.length > 0 ? passRateFor(history[0]) : 0;
  const previousPassRate = history.length > 1 ? passRateFor(history[1]) : latestPassRate;
  const passRateDelta = latestPassRate - previousPassRate;

  let trend: CrossCycleAnalysis['trend'] = 'stable';
  if (history.length > 1) {
    if (passRateDelta > 0.01) trend = 'improving';
    else if (passRateDelta < -0.01) trend = 'regressing';
  }

  const latestPct = Math.round(latestPassRate * 100);
  const deltaPct = Math.round(Math.abs(passRateDelta) * 100);
  const trendLabel =
    trend === 'improving'
      ? `⬆ +${deltaPct}% improvement`
      : trend === 'regressing'
      ? `⬇ -${deltaPct}% regression`
      : '→ stable';

  const summary =
    totalCycles === 0
      ? 'No cycles recorded yet.'
      : `${totalCycles} cycle(s) completed. Latest pass rate: ${latestPct}%. Trend: ${trendLabel}. ` +
        `Passed: ${cyclesPassed}, Failed: ${cyclesFailed}, Blocked: ${cyclesBlocked}.`;

  return {
    totalCycles,
    cyclesPassed,
    cyclesFailed,
    cyclesBlocked,
    levelsReached,
    trend,
    latestPassRate,
    previousPassRate,
    passRateDelta,
    summary,
  };
}

/**
 * Fetch cycle records filtered by difficulty level.
 */
export async function getCyclesByLevel(level: number): Promise<CycleHistoryEntry[]> {
  const { data, error } = await (supabase as any)
    .from(TABLE)
    .select('*')
    .eq('level', level)
    .order('cycle_number', { ascending: false });

  if (error) {
    console.warn(`[SecurityCycleTracker] Could not fetch cycles for level ${level}:`, error.message);
    return [];
  }

  if (!Array.isArray(data)) return [];
  return data.map((row: Record<string, unknown>) => mapRow(row));
}
