/**
 * ProgressiveDiscovery.ts
 * V4-OB2 — Progressive feature-unlock system driven by real usage benchmarks.
 *
 * Features unlock progressively as the user demonstrates adoption.
 * No manual tutorial — AI guides discovery through usage.
 *
 * Benchmarks:
 *   1. First project created      → unlocks Charts Panel
 *   2. First invoice generated    → unlocks AR Aging View
 *   3. 5 projects completed       → unlocks Profitability Trends
 *   4. 10 voice captures used     → unlocks Voice Sessions (tier-gated)
 *   5. 3 months active            → unlocks Advanced Analytics + SCOUT Recommendations
 *
 * Storage: Supabase `user_benchmarks` table
 */

import { supabase } from '@/lib/supabase';

// ── Types ──────────────────────────────────────────────────────────────────────

export type BenchmarkId =
  | 'first_project'
  | 'first_invoice'
  | 'five_projects_completed'
  | 'ten_voice_captures'
  | 'three_months_active';

export type FeatureId =
  | 'charts_panel'
  | 'ar_aging_view'
  | 'profitability_trends'
  | 'voice_sessions'
  | 'advanced_analytics'
  | 'scout_recommendations';

export interface BenchmarkDefinition {
  id: BenchmarkId;
  label: string;
  description: string;
  /** Feature(s) that unlock when this benchmark is reached */
  unlocks: FeatureId[];
  /** Progress threshold required (e.g. 5 projects) */
  threshold: number;
  /** Human-readable unit for the progress bar */
  unit: string;
  /** Hint shown to user to guide them toward this benchmark */
  hint: string;
  /** Whether a paid-tier check is required before unlocking */
  tierGated: boolean;
}

export interface FeatureDefinition {
  id: FeatureId;
  label: string;
  description: string;
  /** Short teaser shown when the feature is still locked */
  teaser: string;
}

export interface BenchmarkProgress {
  benchmark: BenchmarkDefinition;
  currentValue: number;
  reached: boolean;
  reachedAt: string | null;
}

export interface UnlockedFeature {
  featureId: FeatureId;
  unlockedAt: string;
  benchmarkId: BenchmarkId;
}

export interface BenchmarkRecord {
  id?: string;
  user_id: string;
  benchmark_id: BenchmarkId;
  reached: boolean;
  reached_at: string | null;
  current_value: number;
  created_at?: string;
  updated_at?: string;
}

// ── Static Definitions ─────────────────────────────────────────────────────────

export const BENCHMARK_DEFINITIONS: BenchmarkDefinition[] = [
  {
    id: 'first_project',
    label: 'First Project Created',
    description: 'Create your first project in PowerOn Hub.',
    unlocks: ['charts_panel'],
    threshold: 1,
    unit: 'project',
    hint: 'Head to the Projects tab and create your first job to unlock the Charts Panel.',
    tierGated: false,
  },
  {
    id: 'first_invoice',
    label: 'First Invoice Generated',
    description: 'Generate your first invoice for a client.',
    unlocks: ['ar_aging_view'],
    threshold: 1,
    unit: 'invoice',
    hint: 'Generate an invoice from any project to unlock AR Aging View.',
    tierGated: false,
  },
  {
    id: 'five_projects_completed',
    label: '5 Projects Completed',
    description: 'Complete 5 projects from start to finish.',
    unlocks: ['profitability_trends'],
    threshold: 5,
    unit: 'completed projects',
    hint: 'Mark 5 projects as completed to unlock Profitability Trends.',
    tierGated: false,
  },
  {
    id: 'ten_voice_captures',
    label: '10 Voice Captures Used',
    description: 'Use the voice capture feature 10 times.',
    unlocks: ['voice_sessions'],
    threshold: 10,
    unit: 'voice captures',
    hint: 'Use voice capture 10 times in the field to unlock Voice Sessions.',
    tierGated: true,
  },
  {
    id: 'three_months_active',
    label: '3 Months Active',
    description: 'Use PowerOn Hub consistently for 3 months.',
    unlocks: ['advanced_analytics', 'scout_recommendations'],
    threshold: 90,
    unit: 'days active',
    hint: 'Keep using PowerOn Hub for 3 months to unlock Advanced Analytics and SCOUT Recommendations.',
    tierGated: false,
  },
];

export const FEATURE_DEFINITIONS: FeatureDefinition[] = [
  {
    id: 'charts_panel',
    label: 'Charts Panel',
    description: 'Visual dashboards showing project health, cash flow, and KPI trends.',
    teaser: 'Create your first project to unlock real-time visual charts.',
  },
  {
    id: 'ar_aging_view',
    label: 'AR Aging View',
    description: 'Track outstanding invoices by age bucket — 0-30, 31-60, 61-90+ days.',
    teaser: 'Generate your first invoice to unlock accounts receivable aging.',
  },
  {
    id: 'profitability_trends',
    label: 'Profitability Trends',
    description: 'Historical profitability curves across completed projects and service calls.',
    teaser: 'Complete 5 projects to unlock cross-job profitability trends.',
  },
  {
    id: 'voice_sessions',
    label: 'Voice Sessions',
    description: 'Full AI-powered voice sessions with transcription, tagging, and memory.',
    teaser: 'Use voice capture 10 times to unlock full Voice Sessions.',
  },
  {
    id: 'advanced_analytics',
    label: 'Advanced Analytics',
    description: 'Deep-dive analytics — revenue vs. cost, margin by job type, seasonal patterns.',
    teaser: '3 months of data unlocks advanced analytics dashboards.',
  },
  {
    id: 'scout_recommendations',
    label: 'SCOUT Recommendations',
    description: 'AI-driven opportunity gap detection and business growth suggestions from SCOUT.',
    teaser: '3 months of active use unlocks personalized SCOUT intelligence.',
  },
];

// ── Helpers ─────────────────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString();
}

/** Returns the benchmark definition for a given id (throws if not found). */
function getBenchmarkDef(id: BenchmarkId): BenchmarkDefinition {
  const def = BENCHMARK_DEFINITIONS.find((b) => b.id === id);
  if (!def) throw new Error(`Unknown benchmark: ${id}`);
  return def;
}

/** Returns the feature definition for a given id (throws if not found). */
export function getFeatureDef(id: FeatureId): FeatureDefinition {
  const def = FEATURE_DEFINITIONS.find((f) => f.id === id);
  if (!def) throw new Error(`Unknown feature: ${id}`);
  return def;
}

// ── Live value resolvers ───────────────────────────────────────────────────────
// These query Supabase to determine the user's current progress value for each
// benchmark. They are intentionally lightweight — no heavy joins.

async function resolveProjectCount(userId: string): Promise<number> {
  try {
    const { count } = await supabase
      .from('projects')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);
    return count ?? 0;
  } catch {
    return 0;
  }
}

async function resolveInvoiceCount(userId: string): Promise<number> {
  try {
    const { count } = await supabase
      .from('invoices')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);
    return count ?? 0;
  } catch {
    return 0;
  }
}

async function resolveCompletedProjectCount(userId: string): Promise<number> {
  try {
    const { count } = await supabase
      .from('projects')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'completed');
    return count ?? 0;
  } catch {
    return 0;
  }
}

async function resolveVoiceCaptureCount(userId: string): Promise<number> {
  try {
    const { count } = await supabase
      .from('journal_entries')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('source', 'voice');
    return count ?? 0;
  } catch {
    return 0;
  }
}

async function resolveActiveDays(userId: string): Promise<number> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from('profiles')
      .select('created_at')
      .eq('id', userId)
      .single();
    if (!data?.created_at) return 0;
    const created = new Date(data.created_at as string);
    const now = new Date();
    return Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
  } catch {
    return 0;
  }
}

async function resolveCurrentValue(
  benchmarkId: BenchmarkId,
  userId: string
): Promise<number> {
  switch (benchmarkId) {
    case 'first_project':
      return resolveProjectCount(userId);
    case 'first_invoice':
      return resolveInvoiceCount(userId);
    case 'five_projects_completed':
      return resolveCompletedProjectCount(userId);
    case 'ten_voice_captures':
      return resolveVoiceCaptureCount(userId);
    case 'three_months_active':
      return resolveActiveDays(userId);
    default:
      return 0;
  }
}

// ── Tier check ─────────────────────────────────────────────────────────────────

async function userMeetsTierRequirement(userId: string): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from('profiles')
      .select('subscription_tier')
      .eq('id', userId)
      .single();
    // Any tier above 'free' qualifies for tier-gated features
    const tier = (data as { subscription_tier?: string } | null)?.subscription_tier;
    return tier != null && tier !== 'free';
  } catch {
    // Default to true so tier issues don't block the whole discovery system
    return true;
  }
}

// ── Supabase persistence ──────────────────────────────────────────────────────

async function fetchBenchmarkRecords(userId: string): Promise<BenchmarkRecord[]> {
  try {
    // user_benchmarks is a V4 table — cast to any until types are regenerated
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from('user_benchmarks')
      .select('*')
      .eq('user_id', userId);
    return (data as BenchmarkRecord[]) ?? [];
  } catch {
    return [];
  }
}

async function upsertBenchmarkRecord(record: BenchmarkRecord): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from('user_benchmarks')
      .upsert(
        { ...record, updated_at: nowIso() },
        { onConflict: 'user_id,benchmark_id' }
      );
  } catch {
    // Non-fatal — progress can be re-evaluated on next call
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Evaluates all benchmarks for a user, persists any newly reached benchmarks,
 * and returns the list of features currently unlocked.
 *
 * @param userId  Supabase auth user id
 * @returns       Array of UnlockedFeature objects
 */
export async function checkBenchmarks(userId: string): Promise<UnlockedFeature[]> {
  const existingRecords = await fetchBenchmarkRecords(userId);
  const recordMap = new Map<BenchmarkId, BenchmarkRecord>(
    existingRecords.map((r) => [r.benchmark_id, r])
  );

  const unlocked: UnlockedFeature[] = [];
  const tierOk = await userMeetsTierRequirement(userId);

  for (const def of BENCHMARK_DEFINITIONS) {
    // If tier-gated and user doesn't meet tier, skip unlock (but still track progress)
    const canUnlock = !def.tierGated || tierOk;

    const existingRecord = recordMap.get(def.id);
    const currentValue = await resolveCurrentValue(def.id, userId);
    const reached = currentValue >= def.threshold && canUnlock;
    const reachedAt =
      reached && !existingRecord?.reached ? nowIso() : (existingRecord?.reached_at ?? null);

    // Persist the updated record
    await upsertBenchmarkRecord({
      user_id: userId,
      benchmark_id: def.id,
      reached,
      reached_at: reachedAt,
      current_value: currentValue,
    });

    if (reached) {
      for (const featureId of def.unlocks) {
        unlocked.push({
          featureId,
          unlockedAt: reachedAt ?? nowIso(),
          benchmarkId: def.id,
        });
      }
    }
  }

  return unlocked;
}

/**
 * Returns detailed progress toward each benchmark without mutating any state.
 *
 * @param userId  Supabase auth user id
 * @returns       Array of BenchmarkProgress objects (one per benchmark)
 */
export async function getBenchmarkProgress(userId: string): Promise<BenchmarkProgress[]> {
  const existingRecords = await fetchBenchmarkRecords(userId);
  const recordMap = new Map<BenchmarkId, BenchmarkRecord>(
    existingRecords.map((r) => [r.benchmark_id, r])
  );

  const progress: BenchmarkProgress[] = [];

  for (const def of BENCHMARK_DEFINITIONS) {
    const record = recordMap.get(def.id);
    // Use persisted value if available (avoids re-querying all tables)
    const currentValue = record?.current_value ?? 0;
    const reached = record?.reached ?? false;

    progress.push({
      benchmark: def,
      currentValue,
      reached,
      reachedAt: record?.reached_at ?? null,
    });
  }

  return progress;
}

/**
 * Returns an AI-generated (deterministic) hint for the next benchmark the
 * user has not yet reached.  Ordered by benchmark sequence.
 *
 * @param userId  Supabase auth user id (used to identify next unmet benchmark)
 * @returns       A hint string, or a congratulatory message if all unlocked
 */
export async function getNextBenchmarkHint(userId: string): Promise<string> {
  const progress = await getBenchmarkProgress(userId);
  const next = progress.find((p) => !p.reached);

  if (!next) {
    return "🎉 You've unlocked every feature in PowerOn Hub. You're a true platform master — ask SCOUT what to tackle next.";
  }

  const { benchmark, currentValue } = next;
  const remaining = benchmark.threshold - currentValue;
  const pct = Math.min(100, Math.round((currentValue / benchmark.threshold) * 100));

  return (
    `💡 ${benchmark.hint} ` +
    `You're ${pct}% there — ${remaining} more ${benchmark.unit}${remaining !== 1 ? 's' : ''} to go. ` +
    `Unlocks: ${benchmark.unlocks.map((f) => getFeatureDef(f).label).join(', ')}.`
  );
}

/**
 * Convenience helper — returns only the FeatureId values that are currently
 * unlocked for a user (based on persisted benchmark records).
 *
 * @param userId  Supabase auth user id
 * @returns       Set of unlocked FeatureId strings
 */
export async function getUnlockedFeatureIds(userId: string): Promise<Set<FeatureId>> {
  const unlocked = await checkBenchmarks(userId);
  return new Set(unlocked.map((u) => u.featureId));
}
