/**
 * src/services/hunter/HunterScoreLearning.ts
 * HUNTER Score Learning Engine — HT11
 *
 * Makes HUNTER's scoring weights self-improving by correlating 8 factor scores
 * against actual win/loss outcomes logged in hunter_debriefs.
 *
 * Every 10 new debriefs, recalculates factor weights based on which factors
 * most strongly predicted wins vs losses.
 *
 * Weight Guards (applied every adjustment cycle):
 *   - No single factor may exceed 30% of total weight pool
 *   - No factor may fall below 3%
 *   - Changes are capped at ±3 points per cycle (prevents wild swings)
 *
 * Confidence Labels (based on sample size):
 *   < 10 debriefs  → "Low confidence — using default weights"
 *   10–30 debriefs → "Medium confidence — weights calibrating"
 *   30+ debriefs   → "High confidence — weights tuned to your data"
 *
 * PUBLIC API:
 *   analyzeOutcomes()               → Promise<AnalysisResult>
 *   adjustWeights(correlations)     → FactorWeights
 *   saveWeightHistory(entry)        → void
 *   getWeightHistory()              → WeightHistoryEntry[]
 *   triggerCheck()                  → Promise<void>
 *   getCurrentWeights()             → Promise<WeightedResult>
 *
 * Storage:
 *   localStorage — primary (local-first, matches app architecture)
 *   Keys: hunter_learning_weights, hunter_weight_history, hunter_debrief_check_count
 */

import { supabase } from '@/lib/supabase';
import {
  type FactorWeights,
  getCurrentWeights as getEngineScoringWeights,
} from './HunterScoringEngine';

// ─── Constants ─────────────────────────────────────────────────────────────────

/** Maximum any single factor weight may reach (as % of pool) */
const MAX_WEIGHT_PCT = 30;

/** Minimum any single factor weight may reach (as % of pool) */
const MIN_WEIGHT_PCT = 3;

/** Maximum points a weight may change per adjustment cycle */
const MAX_DELTA_PER_CYCLE = 3;

/** How many new debriefs must accumulate before a re-calibration runs */
const DEBRIEFS_PER_CHECK = 10;

const TOTAL_WEIGHT_POOL = 100;

// localStorage keys
const LS_LEARNING_WEIGHTS = 'hunter_learning_weights';
const LS_WEIGHT_HISTORY   = 'hunter_weight_history';
const LS_DEBRIEF_COUNT    = 'hunter_debrief_check_count';

// ─── Factor Roster ─────────────────────────────────────────────────────────────

const FACTOR_KEYS: ReadonlyArray<keyof FactorWeights> = [
  'estimatedJobValue',
  'profitMargin',
  'closeProbability',
  'leadFreshness',
  'contactQuality',
  'jobTypeMatch',
  'distanceEfficiency',
  'competitorGap',
] as const;

// ─── Types ─────────────────────────────────────────────────────────────────────

/** Confidence tier label driven by debrief sample size */
export type ConfidenceLevel = 'low' | 'medium' | 'high';

/**
 * Per-factor win/loss differential.
 * Positive = this factor scored higher on won leads (predictive of wins).
 * Negative = this factor scored lower on won leads (not predictive).
 */
export type CorrelationMap = Record<keyof FactorWeights, number>;

/** A single weight-adjustment event stored in history */
export interface WeightHistoryEntry {
  /** Unique identifier for this adjustment */
  id: string;
  /** ISO timestamp of when this adjustment was made */
  adjustedAt: string;
  /** Number of debriefs analyzed to produce this adjustment */
  sampleSize: number;
  /** Factor weights before this cycle */
  oldWeights: FactorWeights;
  /** Factor weights after this cycle */
  newWeights: FactorWeights;
  /** Raw win/loss differential per factor that drove the change */
  correlations: CorrelationMap;
  /** Factor with the strongest positive win correlation this cycle */
  topFactor: keyof FactorWeights;
  /** Factor with the weakest (or negative) win correlation this cycle */
  weakestFactor: keyof FactorWeights;
}

/** Return shape of getCurrentWeights() */
export interface WeightedResult {
  weights: FactorWeights;
  confidence: ConfidenceLevel;
  confidenceLabel: string;
  sampleSize: number;
}

/** Return shape of analyzeOutcomes() */
export interface AnalysisResult {
  correlations: CorrelationMap;
  sampleSize: number;
  wonCount: number;
  lostCount: number;
  topFactor: keyof FactorWeights;
  weakestFactor: keyof FactorWeights;
}

/** Shape of a row fetched from hunter_debriefs (relevant fields only) */
interface DebriefRow {
  outcome: 'won' | 'lost';
  factor_scores: Partial<Record<keyof FactorWeights, number>> | null;
}

// ─── In-Memory State & Local Persistence ──────────────────────────────────────

function _readStoredWeights(): FactorWeights | null {
  try {
    const raw = localStorage.getItem(LS_LEARNING_WEIGHTS);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FactorWeights>;
    if (FACTOR_KEYS.every((k) => typeof parsed[k] === 'number')) {
      return parsed as FactorWeights;
    }
    return null;
  } catch {
    return null;
  }
}

function _persistWeights(w: FactorWeights): void {
  try {
    localStorage.setItem(LS_LEARNING_WEIGHTS, JSON.stringify(w));
  } catch {
    // Quota pressure — swallow silently (local-first app pattern)
  }
}

/**
 * Module-level working weights.
 * Initialized from localStorage on first module load, falling back to the
 * scoring engine's current defaults.
 */
let _learningWeights: FactorWeights = _readStoredWeights() ?? { ...getEngineScoringWeights() };

// ─── Debrief Counter ───────────────────────────────────────────────────────────

function _getDebriefCount(): number {
  try {
    const raw = localStorage.getItem(LS_DEBRIEF_COUNT);
    return raw ? (parseInt(raw, 10) || 0) : 0;
  } catch {
    return 0;
  }
}

function _setDebriefCount(count: number): void {
  try {
    localStorage.setItem(LS_DEBRIEF_COUNT, String(count));
  } catch {
    // Safe to swallow
  }
}

// ─── Weight History ────────────────────────────────────────────────────────────

/**
 * saveWeightHistory
 *
 * Prepends a WeightHistoryEntry to the persistent log.
 * Keeps at most 50 entries to prevent localStorage bloat.
 */
export function saveWeightHistory(entry: WeightHistoryEntry): void {
  const history = getWeightHistory();
  history.unshift(entry);               // Newest first
  const trimmed = history.slice(0, 50); // Cap at 50 entries
  try {
    localStorage.setItem(LS_WEIGHT_HISTORY, JSON.stringify(trimmed));
  } catch {
    // Quota pressure — skip silently
  }
}

/**
 * getWeightHistory
 *
 * Returns all saved weight adjustment events, newest first.
 * Returns an empty array if no history exists or if parsing fails.
 */
export function getWeightHistory(): WeightHistoryEntry[] {
  try {
    const raw = localStorage.getItem(LS_WEIGHT_HISTORY);
    if (!raw) return [];
    return JSON.parse(raw) as WeightHistoryEntry[];
  } catch {
    return [];
  }
}

// ─── Outcome Correlation Analysis ─────────────────────────────────────────────

/**
 * analyzeOutcomes
 *
 * Reads all hunter_debriefs from Supabase that carry factor_scores.
 * Computes per-factor win correlation:
 *
 *   correlation[factor] = avgScore(won leads)[factor]
 *                       - avgScore(lost leads)[factor]
 *
 * Higher positive value = factor was reliably higher on won leads
 *                       → stronger predictor of winning.
 *
 * Returns AnalysisResult with correlation map, counts, and top/weakest factors.
 */
export async function analyzeOutcomes(): Promise<AnalysisResult> {
  const { data, error } = await (supabase as any)
    .from('hunter_debriefs')
    .select('outcome, factor_scores')
    .in('outcome', ['won', 'lost'])
    .order('created_at', { ascending: false })
    .limit(300);

  if (error) {
    console.warn('[HunterScoreLearning] analyzeOutcomes fetch error:', error.message);
    throw new Error(`analyzeOutcomes: Supabase fetch failed — ${error.message}`);
  }

  const rows = (data ?? []) as DebriefRow[];
  const wonRows  = rows.filter((r) => r.outcome === 'won');
  const lostRows = rows.filter((r) => r.outcome === 'lost');

  // Build correlation map — neutral 50 used when a factor_score is missing
  const NEUTRAL_FACTOR_SCORE = 50;
  const correlations: CorrelationMap = {} as CorrelationMap;

  for (const key of FACTOR_KEYS) {
    const avgWon = wonRows.length > 0
      ? wonRows.reduce((sum, r) => sum + (r.factor_scores?.[key] ?? NEUTRAL_FACTOR_SCORE), 0)
        / wonRows.length
      : NEUTRAL_FACTOR_SCORE;

    const avgLost = lostRows.length > 0
      ? lostRows.reduce((sum, r) => sum + (r.factor_scores?.[key] ?? NEUTRAL_FACTOR_SCORE), 0)
        / lostRows.length
      : NEUTRAL_FACTOR_SCORE;

    correlations[key] = avgWon - avgLost;
  }

  // Identify the factor most predictive of wins (highest positive differential)
  const topFactor = FACTOR_KEYS.reduce<keyof FactorWeights>((best, k) =>
    correlations[k] >= correlations[best] ? k : best,
    FACTOR_KEYS[0]
  );

  // Identify the factor least predictive of wins (lowest / most negative differential)
  const weakestFactor = FACTOR_KEYS.reduce<keyof FactorWeights>((worst, k) =>
    correlations[k] <= correlations[worst] ? k : worst,
    FACTOR_KEYS[0]
  );

  return {
    correlations,
    sampleSize: rows.length,
    wonCount: wonRows.length,
    lostCount: lostRows.length,
    topFactor,
    weakestFactor,
  };
}

// ─── Weight Adjustment ─────────────────────────────────────────────────────────

/**
 * adjustWeights
 *
 * Given a CorrelationMap, computes new factor weights that reward factors
 * predictive of wins and reduce factors that aren't, then applies all guards:
 *
 *   Step 1: Normalize correlations → proposed weights (sum to 100)
 *   Step 2: Cap each change at ±3 vs the current weight (swing limiter)
 *   Step 3: Enforce 3% floor and 30% ceiling on every factor
 *   Step 4: Re-normalize to exactly 100 (rounding correction)
 *
 * Updates the module-level _learningWeights and persists to localStorage.
 * Returns the new FactorWeights.
 */
export function adjustWeights(correlations: CorrelationMap): FactorWeights {
  const current = { ..._learningWeights };

  // ── Step 1: Convert correlations to raw proposed weights ──
  // Shift all values positive before normalizing so even negative-correlating
  // factors retain the MIN_WEIGHT_PCT floor rather than being zeroed out.
  const rawMap: Record<string, number> = {};
  let rawTotal = 0;

  for (const key of FACTOR_KEYS) {
    const shifted = Math.max(MIN_WEIGHT_PCT, correlations[key] + MIN_WEIGHT_PCT + 1);
    rawMap[key] = shifted;
    rawTotal   += shifted;
  }

  const proposed: FactorWeights = {} as FactorWeights;
  let proposedTotal = 0;

  for (const key of FACTOR_KEYS) {
    const normalized = Math.round((rawMap[key] / rawTotal) * TOTAL_WEIGHT_POOL);
    proposed[key]    = normalized;
    proposedTotal   += normalized;
  }

  // Fix rounding drift in proposed
  const proposedDrift = TOTAL_WEIGHT_POOL - proposedTotal;
  if (proposedDrift !== 0) {
    const topKey = FACTOR_KEYS.reduce<keyof FactorWeights>(
      (a, b) => proposed[a] >= proposed[b] ? a : b,
      FACTOR_KEYS[0]
    );
    proposed[topKey] += proposedDrift;
  }

  // ── Step 2: Apply ±MAX_DELTA_PER_CYCLE cap ──
  const afterDelta: FactorWeights = {} as FactorWeights;
  for (const key of FACTOR_KEYS) {
    const delta      = proposed[key] - current[key];
    const cappedDelta = Math.max(-MAX_DELTA_PER_CYCLE, Math.min(MAX_DELTA_PER_CYCLE, delta));
    afterDelta[key]  = current[key] + cappedDelta;
  }

  // ── Step 3: Enforce MIN/MAX bounds ──
  const afterBounds: FactorWeights = {} as FactorWeights;
  for (const key of FACTOR_KEYS) {
    afterBounds[key] = Math.max(MIN_WEIGHT_PCT, Math.min(MAX_WEIGHT_PCT, afterDelta[key]));
  }

  // ── Step 4: Re-normalize to 100 ──
  const boundsTotal = FACTOR_KEYS.reduce((sum, k) => sum + afterBounds[k], 0);
  const final: FactorWeights = {} as FactorWeights;
  let finalTotal = 0;

  for (const key of FACTOR_KEYS) {
    final[key]  = Math.round((afterBounds[key] / boundsTotal) * TOTAL_WEIGHT_POOL);
    finalTotal += final[key];
  }

  // Fix any residual rounding drift
  const finalDrift = TOTAL_WEIGHT_POOL - finalTotal;
  if (finalDrift !== 0) {
    const topKey = FACTOR_KEYS.reduce<keyof FactorWeights>(
      (a, b) => final[a] >= final[b] ? a : b,
      FACTOR_KEYS[0]
    );
    final[topKey] = Math.max(
      MIN_WEIGHT_PCT,
      Math.min(MAX_WEIGHT_PCT, final[topKey] + finalDrift)
    );
  }

  // Commit to in-memory state and persist
  _learningWeights = final;
  _persistWeights(final);

  return final;
}

// ─── Trigger Check ─────────────────────────────────────────────────────────────

/**
 * triggerCheck
 *
 * Increments the rolling debrief counter.
 * Every DEBRIEFS_PER_CHECK (10) new debriefs, calls analyzeOutcomes(),
 * applies adjustWeights(), and writes a WeightHistoryEntry.
 *
 * Call this whenever a new hunter_debrief is saved.
 */
export async function triggerCheck(): Promise<void> {
  const newCount = _getDebriefCount() + 1;
  _setDebriefCount(newCount);

  // Only run on every 10th debrief
  if (newCount % DEBRIEFS_PER_CHECK !== 0) return;

  console.info(
    `[HunterScoreLearning] ${newCount} debriefs accumulated — triggering weight recalibration`
  );

  let analysis: AnalysisResult;
  try {
    analysis = await analyzeOutcomes();
  } catch (err) {
    console.warn('[HunterScoreLearning] triggerCheck: analyzeOutcomes failed', err);
    return;
  }

  // Need at least DEBRIEFS_PER_CHECK samples and representation from both sides
  if (analysis.sampleSize < DEBRIEFS_PER_CHECK) return;
  if (analysis.wonCount === 0 || analysis.lostCount === 0) {
    console.info('[HunterScoreLearning] Skipping adjustment — only one outcome type present');
    return;
  }

  const oldWeights = { ..._learningWeights };
  const newWeights = adjustWeights(analysis.correlations);

  const entry: WeightHistoryEntry = {
    id:           `wh-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    adjustedAt:   new Date().toISOString(),
    sampleSize:   analysis.sampleSize,
    oldWeights,
    newWeights,
    correlations: analysis.correlations,
    topFactor:    analysis.topFactor,
    weakestFactor: analysis.weakestFactor,
  };

  saveWeightHistory(entry);

  console.info('[HunterScoreLearning] Weight calibration complete:', {
    sampleSize: analysis.sampleSize,
    topFactor:  analysis.topFactor,
    newWeights,
  });
}

// ─── Current Weights With Confidence ──────────────────────────────────────────

/**
 * getCurrentWeights
 *
 * Returns the active learning weights paired with a confidence level derived
 * from the total debrief sample size in Supabase.
 *
 * Confidence levels:
 *   < 10 debriefs  → low    → "Low confidence — using default weights"
 *   10–30 debriefs → medium → "Medium confidence — weights calibrating"
 *   30+ debriefs   → high   → "High confidence — weights tuned to your data"
 */
export async function getCurrentWeights(): Promise<WeightedResult> {
  let sampleSize = 0;

  try {
    const { count, error } = await (supabase as any)
      .from('hunter_debriefs')
      .select('id', { count: 'exact', head: true });

    if (!error && typeof count === 'number') {
      sampleSize = count;
    }
  } catch {
    // Fallback: use latest history entry's sample size
    const history = getWeightHistory();
    sampleSize = history.length > 0 ? history[0].sampleSize : 0;
  }

  let confidence: ConfidenceLevel;
  let confidenceLabel: string;

  if (sampleSize < 10) {
    confidence      = 'low';
    confidenceLabel = 'Low confidence — using default weights';
  } else if (sampleSize < 30) {
    confidence      = 'medium';
    confidenceLabel = 'Medium confidence — weights calibrating';
  } else {
    confidence      = 'high';
    confidenceLabel = 'High confidence — weights tuned to your data';
  }

  return {
    weights: { ..._learningWeights },
    confidence,
    confidenceLabel,
    sampleSize,
  };
}
