/**
 * src/services/hunter/HunterScoringEngine.ts
 * HUNTER Lead Scoring Engine — HT3
 *
 * Scores inbound leads 0–100 using 8 weighted factors.
 * Weights are self-improving: every 10 hunter_debriefs, adjustWeightsFromOutcomes()
 * recalculates factor weights based on which factors predicted wins vs losses.
 *
 * PUBLIC API:
 *   scoreLead(leadData, operationalData)  → LeadScore
 *   adjustWeightsFromOutcomes()           → Promise<void>
 *   getCurrentWeights()                  → FactorWeights
 *
 * Supabase tables consumed:
 *   field_logs          — job type win history
 *   invoices            — payment speed by client type
 *   hunter_debriefs     — outcome feedback (won vs lost)
 *
 * Score tiers:
 *   90+      → Elite
 *   75–89    → Strong
 *   60–74    → Qualified
 *   40–59    → Expansion
 *   < 40     → Archived
 */

import { supabase } from '@/lib/supabase';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type ScoreTier = 'Elite' | 'Strong' | 'Qualified' | 'Expansion' | 'Archived';

export interface FactorWeights {
  estimatedJobValue: number;
  profitMargin: number;
  closeProbability: number;
  leadFreshness: number;
  contactQuality: number;
  jobTypeMatch: number;
  distanceEfficiency: number;
  competitorGap: number;
}

export interface LeadData {
  /** Estimated job value in dollars */
  estimatedValue: number;
  /** Lead type / job type label */
  jobType: string;
  /** ISO timestamp when the lead was captured */
  capturedAt: string;
  /** Contact role: 'owner' | 'manager' | 'gc' | 'cold' */
  contactRole: 'owner' | 'manager' | 'gc' | 'cold' | string;
  /** Urgency signals: permit expiring, code violation, deadline, etc. */
  urgencySignals?: string[];
  /** Drive time from home base in minutes */
  driveTimeMinutes?: number;
  /** Whether the area has been flagged as underserved or competitor went dark */
  competitorGapDetected?: boolean;
  /** Optional quoted price for margin calculation */
  quotedPrice?: number;
  /** Estimated material cost */
  estimatedMaterialCost?: number;
  /** Estimated labor hours */
  estimatedLaborHours?: number;
}

export interface OperationalData {
  /** Labor billing rate per hour from VAULT / settings */
  laborRate: number;
  /** Known profitable job types from field_logs history */
  profitableJobTypes?: string[];
  /** Average margin by job type from historical invoices */
  jobTypeMargins?: Record<string, number>;
  /** Average payment speed by contact type (days) */
  paymentSpeedByContactType?: Record<string, number>;
}

export interface FactorBreakdown {
  estimatedJobValue: number;
  profitMargin: number;
  closeProbability: number;
  leadFreshness: number;
  contactQuality: number;
  jobTypeMatch: number;
  distanceEfficiency: number;
  competitorGap: number;
}

export interface LeadScore {
  /** Final composite score 0–100 */
  score: number;
  /** Score tier label */
  tier: ScoreTier;
  /** Per-factor raw scores (each 0–100) */
  factorBreakdown: FactorBreakdown;
  /** Factor weights used for this score */
  weightsUsed: FactorWeights;
  /** Timestamp of scoring */
  scoredAt: string;
}

export interface HunterDebrief {
  id: string;
  lead_id: string;
  outcome: 'won' | 'lost';
  factor_scores: FactorBreakdown;
  final_score: number;
  created_at: string;
}

// ─── Default Weights ───────────────────────────────────────────────────────────

const DEFAULT_WEIGHTS: FactorWeights = {
  estimatedJobValue: 20,
  profitMargin: 18,
  closeProbability: 15,
  leadFreshness: 10,
  contactQuality: 10,
  jobTypeMatch: 12,
  distanceEfficiency: 8,
  competitorGap: 7,
};

// In-memory working weights — updated by adjustWeightsFromOutcomes()
let _activeWeights: FactorWeights = { ...DEFAULT_WEIGHTS };

// Minimum weight floor to prevent any factor from being zeroed out
const WEIGHT_FLOOR = 2;
const TOTAL_WEIGHT_POOL = 100;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

function totalWeight(w: FactorWeights): number {
  return Object.values(w).reduce((sum, v) => sum + v, 0);
}

function assignTier(score: number): ScoreTier {
  if (score >= 90) return 'Elite';
  if (score >= 75) return 'Strong';
  if (score >= 60) return 'Qualified';
  if (score >= 40) return 'Expansion';
  return 'Archived';
}

// ─── Factor Scorers (each returns 0–100) ──────────────────────────────────────

/**
 * Factor 1 — Estimated Job Value (weight: 20)
 * Scores higher for larger jobs. Calibrated against a $15,000 "excellent job" baseline.
 * <$500 → 5, $500–$2k → 30, $2k–$7k → 60, $7k–$15k → 85, $15k+ → 100
 */
function scoreEstimatedJobValue(estimatedValue: number): number {
  if (estimatedValue >= 15000) return 100;
  if (estimatedValue >= 7000) return 70 + clamp(((estimatedValue - 7000) / 8000) * 30, 0, 30);
  if (estimatedValue >= 2000) return 45 + clamp(((estimatedValue - 2000) / 5000) * 25, 0, 25);
  if (estimatedValue >= 500) return 20 + clamp(((estimatedValue - 500) / 1500) * 25, 0, 25);
  return clamp((estimatedValue / 500) * 20, 0, 20);
}

/**
 * Factor 2 — Profit Margin (weight: 18)
 * Uses real VAULT rates from operationalData to estimate margin.
 * margin = (quotedPrice - totalCost) / quotedPrice
 * If no quote available, estimates from labor rate.
 */
function scoreProfitMargin(lead: LeadData, ops: OperationalData): number {
  let margin = 0;

  if (lead.quotedPrice && lead.quotedPrice > 0) {
    const laborHours = lead.estimatedLaborHours ?? 0;
    const laborCost = laborHours * ops.laborRate;
    const truckCost = laborHours * 8;
    const overheadCost = laborHours * 12;
    const materialCost = lead.estimatedMaterialCost ?? 0;
    const totalCost = laborCost + truckCost + overheadCost + materialCost;
    margin = (lead.quotedPrice - totalCost) / lead.quotedPrice;
  } else if (ops.jobTypeMargins && ops.jobTypeMargins[lead.jobType] !== undefined) {
    margin = ops.jobTypeMargins[lead.jobType];
  } else {
    // Estimate margin from job value alone — assume 35% baseline margin
    margin = 0.35;
  }

  // Score: < 0% → 0, 0–15% → 10–35, 15–30% → 35–65, 30–45% → 65–85, 45%+ → 85–100
  if (margin < 0) return 0;
  if (margin >= 0.45) return clamp(85 + ((margin - 0.45) / 0.15) * 15, 0, 100);
  if (margin >= 0.30) return clamp(65 + ((margin - 0.30) / 0.15) * 20, 0, 85);
  if (margin >= 0.15) return clamp(35 + ((margin - 0.15) / 0.15) * 30, 0, 65);
  return clamp((margin / 0.15) * 35, 0, 35);
}

/**
 * Factor 3 — Close Probability (weight: 15)
 * Urgency signals (permit expiring, code violation) boost score significantly.
 * Base score without urgency: 40.
 * Each recognized urgency signal adds 15 points (capped at 100).
 */
const URGENCY_BOOST_SIGNALS = [
  'permit expiring',
  'permit expired',
  'code violation',
  'inspection due',
  'deadline',
  'urgent',
  'emergency',
  'insurance requirement',
  'tenant complaint',
  'safety hazard',
];

function scoreCloseProbability(lead: LeadData): number {
  const base = 40;
  if (!lead.urgencySignals || lead.urgencySignals.length === 0) return base;

  const normalizedSignals = lead.urgencySignals.map((s) => s.toLowerCase());
  let boostCount = 0;
  for (const boostSignal of URGENCY_BOOST_SIGNALS) {
    if (normalizedSignals.some((s) => s.includes(boostSignal))) {
      boostCount++;
    }
  }

  return clamp(base + boostCount * 15);
}

/**
 * Factor 4 — Lead Freshness (weight: 10)
 * Scores highest for leads captured today. Decays linearly over 30 days.
 * Day 0: 100, Day 15: 50, Day 30+: 0
 */
function scoreLeadFreshness(capturedAt: string): number {
  const capturedMs = new Date(capturedAt).getTime();
  const nowMs = Date.now();
  const ageMs = nowMs - capturedMs;
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  if (ageDays <= 0) return 100;
  if (ageDays >= 30) return 0;
  return clamp(100 - (ageDays / 30) * 100);
}

/**
 * Factor 5 — Contact Quality (weight: 10)
 * Direct owner or manager = highest value leads.
 * Cold GC contacts = lowest.
 */
const CONTACT_QUALITY_MAP: Record<string, number> = {
  owner: 100,
  manager: 80,
  gc: 45,
  cold: 20,
};

function scoreContactQuality(contactRole: string): number {
  const normalized = contactRole.toLowerCase().trim();
  return CONTACT_QUALITY_MAP[normalized] ?? 35;
}

/**
 * Factor 6 — Job Type Match (weight: 12)
 * Matches against historically profitable job types from field_logs.
 * If job type is in the profitable list: 90+.
 * If operationalData has no history yet: return 50 (neutral).
 */
function scoreJobTypeMatch(lead: LeadData, ops: OperationalData): number {
  if (!ops.profitableJobTypes || ops.profitableJobTypes.length === 0) return 50;

  const normalizedJobType = lead.jobType.toLowerCase().trim();
  const match = ops.profitableJobTypes.some(
    (t) => t.toLowerCase().trim() === normalizedJobType
  );

  if (match) {
    // Also boost by how strong the associated margin is for this type
    const typeMargin = ops.jobTypeMargins?.[lead.jobType];
    if (typeMargin !== undefined && typeMargin >= 0.35) return 95;
    return 85;
  }

  // Partial match (job type contains a known type or vice versa)
  const partial = ops.profitableJobTypes.some(
    (t) =>
      normalizedJobType.includes(t.toLowerCase()) ||
      t.toLowerCase().includes(normalizedJobType)
  );
  return partial ? 60 : 30;
}

/**
 * Factor 7 — Distance Efficiency (weight: 8)
 * Drive time vs job value ratio. More drive time for less job value = lower score.
 * If no drive time provided, returns 70 (slightly positive).
 * Formula: efficiency = estimatedValue / driveTimeMinutes
 * < $50/min → 30, $50–$150 → 50–70, $150–$300 → 70–85, $300+ → 85–100
 */
function scoreDistanceEfficiency(lead: LeadData): number {
  if (!lead.driveTimeMinutes || lead.driveTimeMinutes <= 0) return 70;

  const efficiency = lead.estimatedValue / lead.driveTimeMinutes;

  if (efficiency >= 300) return 100;
  if (efficiency >= 150) return clamp(70 + ((efficiency - 150) / 150) * 30, 0, 100);
  if (efficiency >= 50) return clamp(50 + ((efficiency - 50) / 100) * 20, 0, 70);
  return clamp((efficiency / 50) * 30, 0, 50);
}

/**
 * Factor 8 — Competitor Gap (weight: 7)
 * If area is detected as underserved or a competitor went dark: 90.
 * Otherwise: 40 (neutral — no intel available).
 */
function scoreCompetitorGap(lead: LeadData): number {
  if (lead.competitorGapDetected === true) return 90;
  return 40;
}

// ─── Core Scoring Function ────────────────────────────────────────────────────

/**
 * scoreLead
 *
 * Computes a composite 0–100 score for an inbound lead using 8 weighted factors.
 * Each factor is scored 0–100, multiplied by its weight, summed, then divided
 * by the total weight to normalize to 0–100.
 *
 * @param leadData       — all known data about the inbound lead
 * @param operationalData — VAULT rates, field_log history, invoice patterns
 * @returns LeadScore — composite score, tier, factor breakdown, weights used
 */
export function scoreLead(leadData: LeadData, operationalData: OperationalData): LeadScore {
  const weights = { ..._activeWeights };

  const factorBreakdown: FactorBreakdown = {
    estimatedJobValue: scoreEstimatedJobValue(leadData.estimatedValue),
    profitMargin: scoreProfitMargin(leadData, operationalData),
    closeProbability: scoreCloseProbability(leadData),
    leadFreshness: scoreLeadFreshness(leadData.capturedAt),
    contactQuality: scoreContactQuality(leadData.contactRole),
    jobTypeMatch: scoreJobTypeMatch(leadData, operationalData),
    distanceEfficiency: scoreDistanceEfficiency(leadData),
    competitorGap: scoreCompetitorGap(leadData),
  };

  const weightedSum =
    factorBreakdown.estimatedJobValue * weights.estimatedJobValue +
    factorBreakdown.profitMargin * weights.profitMargin +
    factorBreakdown.closeProbability * weights.closeProbability +
    factorBreakdown.leadFreshness * weights.leadFreshness +
    factorBreakdown.contactQuality * weights.contactQuality +
    factorBreakdown.jobTypeMatch * weights.jobTypeMatch +
    factorBreakdown.distanceEfficiency * weights.distanceEfficiency +
    factorBreakdown.competitorGap * weights.competitorGap;

  const tw = totalWeight(weights);
  const score = clamp(Math.round(weightedSum / tw));
  const tier = assignTier(score);

  return {
    score,
    tier,
    factorBreakdown,
    weightsUsed: weights,
    scoredAt: new Date().toISOString(),
  };
}

// ─── Weight Access ────────────────────────────────────────────────────────────

/**
 * getCurrentWeights
 * Returns the currently active factor weights (may differ from defaults
 * after self-improvement has run).
 */
export function getCurrentWeights(): FactorWeights {
  return { ..._activeWeights };
}

// ─── Self-Improvement: adjustWeightsFromOutcomes ──────────────────────────────

/**
 * adjustWeightsFromOutcomes
 *
 * Reads hunter_debriefs from Supabase. Every time this accumulates a new
 * batch of 10+ debriefs, it recalculates factor weights by comparing
 * which factors were most predictive of wins vs losses.
 *
 * Algorithm:
 *   1. Fetch all hunter_debriefs (outcome = 'won' | 'lost').
 *   2. Compute average factor score for won leads vs lost leads per factor.
 *   3. Predictive power = average(won factor score) - average(lost factor score).
 *      Higher differential = this factor is more discriminating.
 *   4. Normalize predictive powers to sum to TOTAL_WEIGHT_POOL.
 *   5. Apply WEIGHT_FLOOR to prevent any factor from dropping to zero.
 *   6. Update _activeWeights in memory.
 *
 * Called automatically when a debrief is saved. Also callable manually.
 */
export async function adjustWeightsFromOutcomes(): Promise<void> {
  try {
    const { data, error } = await (supabase as any)
      .from('hunter_debriefs')
      .select('outcome, factor_scores, final_score')
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) {
      console.warn('[HunterScoringEngine] Failed to fetch debriefs:', error.message);
      return;
    }

    const debriefs = (data ?? []) as HunterDebrief[];
    if (debriefs.length < 10) {
      // Not enough data yet — keep current weights
      return;
    }

    const won = debriefs.filter((d) => d.outcome === 'won');
    const lost = debriefs.filter((d) => d.outcome === 'lost');

    if (won.length === 0 || lost.length === 0) return;

    const factors = Object.keys(DEFAULT_WEIGHTS) as (keyof FactorBreakdown)[];

    // Compute average factor score for won vs lost
    const avgWon: Record<string, number> = {};
    const avgLost: Record<string, number> = {};

    for (const factor of factors) {
      avgWon[factor] =
        won.reduce((sum, d) => sum + (d.factor_scores?.[factor] ?? 50), 0) / won.length;
      avgLost[factor] =
        lost.reduce((sum, d) => sum + (d.factor_scores?.[factor] ?? 50), 0) / lost.length;
    }

    // Predictive power: how much higher was the avg won score vs avg lost score
    const predictivePower: Record<string, number> = {};
    let totalPower = 0;

    for (const factor of factors) {
      const diff = avgWon[factor] - avgLost[factor];
      // Treat negative differentials as minimal (the factor didn't help predict wins)
      predictivePower[factor] = Math.max(WEIGHT_FLOOR, diff);
      totalPower += predictivePower[factor];
    }

    if (totalPower <= 0) return;

    // Normalize to TOTAL_WEIGHT_POOL
    const newWeights = { ...DEFAULT_WEIGHTS };
    let assignedTotal = 0;

    for (const factor of factors) {
      const raw = (predictivePower[factor] / totalPower) * TOTAL_WEIGHT_POOL;
      newWeights[factor as keyof FactorWeights] = Math.max(
        WEIGHT_FLOOR,
        Math.round(raw)
      );
      assignedTotal += newWeights[factor as keyof FactorWeights];
    }

    // Adjust rounding drift back to TOTAL_WEIGHT_POOL via the highest-weight factor
    const drift = TOTAL_WEIGHT_POOL - assignedTotal;
    if (drift !== 0) {
      const topFactor = factors.reduce((a, b) =>
        newWeights[a as keyof FactorWeights] >= newWeights[b as keyof FactorWeights] ? a : b
      );
      newWeights[topFactor as keyof FactorWeights] += drift;
    }

    _activeWeights = newWeights;

    console.info(
      `[HunterScoringEngine] Weights updated from ${debriefs.length} debriefs:`,
      _activeWeights
    );
  } catch (err) {
    console.warn('[HunterScoringEngine] adjustWeightsFromOutcomes error:', err);
  }
}

/**
 * resetWeightsToDefault
 * Restores factory default weights. Useful for debugging or admin reset.
 */
export function resetWeightsToDefault(): void {
  _activeWeights = { ...DEFAULT_WEIGHTS };
}
