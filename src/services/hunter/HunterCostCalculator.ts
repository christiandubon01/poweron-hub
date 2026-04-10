/**
 * src/services/hunter/HunterCostCalculator.ts
 * HUNTER Cost Calculator — HT3
 *
 * Computes real job costs for margin calculation in the HUNTER scoring engine.
 * Uses actual overhead rates (truck, insurance, tools) per billable hour.
 *
 * PUBLIC API:
 *   calculateRealCost(hours, rate, materials)  → JobCostBreakdown
 *   estimateJobCost(leadType, estimatedValue)  → Promise<EstimatedJobCost>
 *
 * Cost formula (per job):
 *   labor    = hours × rate
 *   truck    = hours × 8   (vehicle/gas/insurance per hour)
 *   overhead = hours × 12  (insurance, license, tools per hour)
 *   total    = labor + truck + overhead + materials
 *   margin   = (quotedPrice - total) / quotedPrice
 *
 * estimateJobCost reads VAULT price book data from Supabase to estimate
 * hours and materials for common job types.
 */

import { supabase } from '@/lib/supabase';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Vehicle/gas/insurance cost per billable hour */
const TRUCK_COST_PER_HOUR = 8;

/** Insurance, license, tools, misc overhead per billable hour */
const OVERHEAD_COST_PER_HOUR = 12;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface JobCostBreakdown {
  /** Hours worked */
  hours: number;
  /** Hourly labor rate used */
  hourlyRate: number;
  /** Labor cost = hours × rate */
  laborCost: number;
  /** Truck/vehicle cost = hours × 8 */
  truckCost: number;
  /** Overhead cost = hours × 12 */
  overheadCost: number;
  /** Raw material cost */
  materialCost: number;
  /** Total cost = labor + truck + overhead + materials */
  totalCost: number;
  /**
   * Profit margin = (quotedPrice - totalCost) / quotedPrice
   * undefined if no quotedPrice was supplied
   */
  margin?: number;
  /** Quoted price if provided */
  quotedPrice?: number;
}

export interface EstimatedJobCost extends JobCostBreakdown {
  /** Job type used for estimation */
  jobType: string;
  /** Estimated value provided */
  estimatedValue: number;
  /** Whether estimate used VAULT price book data (true) or built-in heuristics (false) */
  usedVaultData: boolean;
}

/** VAULT price book item shape (subset needed for estimation) */
interface VaultPriceBookItem {
  name: string;
  cost: number;
  unit: string;
  category?: string;
}

// ─── Built-in Job Type Heuristics ─────────────────────────────────────────────
// Baseline estimates for common job types when VAULT data is unavailable.
// Format: { laborHoursPerKDollar: number, materialPctOfJobValue: number }

interface JobTypeHeuristic {
  /** Estimated labor hours per $1,000 of job value */
  laborHoursPerKDollar: number;
  /** Material cost as a fraction of job value (0.0–1.0) */
  materialPctOfJobValue: number;
}

const JOB_TYPE_HEURISTICS: Record<string, JobTypeHeuristic> = {
  'service call': { laborHoursPerKDollar: 2.5, materialPctOfJobValue: 0.10 },
  'troubleshoot': { laborHoursPerKDollar: 2.5, materialPctOfJobValue: 0.05 },
  'panel upgrade': { laborHoursPerKDollar: 1.8, materialPctOfJobValue: 0.30 },
  'panel replacement': { laborHoursPerKDollar: 1.8, materialPctOfJobValue: 0.30 },
  'lighting': { laborHoursPerKDollar: 2.0, materialPctOfJobValue: 0.20 },
  'outlet': { laborHoursPerKDollar: 2.2, materialPctOfJobValue: 0.12 },
  'receptacle': { laborHoursPerKDollar: 2.2, materialPctOfJobValue: 0.12 },
  'gfci': { laborHoursPerKDollar: 2.0, materialPctOfJobValue: 0.15 },
  'ev charger': { laborHoursPerKDollar: 1.5, materialPctOfJobValue: 0.25 },
  'ceiling fan': { laborHoursPerKDollar: 1.8, materialPctOfJobValue: 0.08 },
  'rough in': { laborHoursPerKDollar: 1.6, materialPctOfJobValue: 0.35 },
  'rough-in': { laborHoursPerKDollar: 1.6, materialPctOfJobValue: 0.35 },
  'new construction': { laborHoursPerKDollar: 1.5, materialPctOfJobValue: 0.35 },
  'remodel': { laborHoursPerKDollar: 1.8, materialPctOfJobValue: 0.25 },
  'commercial': { laborHoursPerKDollar: 1.4, materialPctOfJobValue: 0.30 },
  'solar': { laborHoursPerKDollar: 1.2, materialPctOfJobValue: 0.45 },
  'generator': { laborHoursPerKDollar: 1.3, materialPctOfJobValue: 0.40 },
  'low voltage': { laborHoursPerKDollar: 2.2, materialPctOfJobValue: 0.20 },
  'default': { laborHoursPerKDollar: 2.0, materialPctOfJobValue: 0.20 },
};

// ─── Core Cost Functions ──────────────────────────────────────────────────────

/**
 * calculateRealCost
 *
 * Computes the full cost breakdown for a job given hours, rate, and materials.
 * Optionally accepts quotedPrice to compute margin.
 *
 * @param hours        — billable labor hours
 * @param rate         — hourly labor billing rate (from VAULT settings)
 * @param materials    — raw material cost in dollars
 * @param quotedPrice  — optional quoted price to compute margin
 */
export function calculateRealCost(
  hours: number,
  rate: number,
  materials: number,
  quotedPrice?: number
): JobCostBreakdown {
  const laborCost = hours * rate;
  const truckCost = hours * TRUCK_COST_PER_HOUR;
  const overheadCost = hours * OVERHEAD_COST_PER_HOUR;
  const totalCost = laborCost + truckCost + overheadCost + materials;

  const result: JobCostBreakdown = {
    hours,
    hourlyRate: rate,
    laborCost: round2(laborCost),
    truckCost: round2(truckCost),
    overheadCost: round2(overheadCost),
    materialCost: round2(materials),
    totalCost: round2(totalCost),
  };

  if (quotedPrice !== undefined && quotedPrice > 0) {
    result.quotedPrice = quotedPrice;
    result.margin = round4((quotedPrice - totalCost) / quotedPrice);
  }

  return result;
}

// ─── VAULT Price Book Integration ────────────────────────────────────────────

/**
 * fetchVaultPriceBookForJobType
 *
 * Queries Supabase `price_book` table for items matching the lead type.
 * Returns a filtered list of relevant price book entries.
 * Falls back to empty array if Supabase is unavailable.
 */
async function fetchVaultPriceBookForJobType(
  jobType: string
): Promise<VaultPriceBookItem[]> {
  try {
    // Normalize job type into a category keyword for fuzzy matching
    const keyword = jobType.toLowerCase().trim().split(' ')[0];

    const { data, error } = await (supabase as any)
      .from('price_book')
      .select('name, cost, unit, category')
      .ilike('category', `%${keyword}%`)
      .limit(30);

    if (error) {
      console.warn('[HunterCostCalculator] VAULT price book fetch error:', error.message);
      return [];
    }

    return (data ?? []) as VaultPriceBookItem[];
  } catch (err) {
    console.warn('[HunterCostCalculator] VAULT price book unavailable:', err);
    return [];
  }
}

/**
 * estimateMaterialCostFromVault
 *
 * Given a list of VAULT price book items and an estimated job value,
 * estimates total material cost by scaling the average item costs
 * against a typical bill-of-materials quantity assumption.
 *
 * This is a heuristic — real accuracy requires a full MTO.
 */
function estimateMaterialCostFromVault(
  items: VaultPriceBookItem[],
  estimatedValue: number
): number {
  if (items.length === 0) return 0;

  // Average cost per item from VAULT
  const avgCost = items.reduce((sum, i) => sum + (i.cost ?? 0), 0) / items.length;

  // Estimate quantity based on job value — rough rule: 1 item per $200 of job value
  const estimatedQty = Math.ceil(estimatedValue / 200);

  // Cap at number of distinct items to avoid overestimation
  const cappedQty = Math.min(estimatedQty, items.length * 3);

  return round2(avgCost * cappedQty);
}

// ─── estimateJobCost ──────────────────────────────────────────────────────────

/**
 * estimateJobCost
 *
 * Estimates labor hours and material cost for a given job type and estimated value.
 * Attempts to use VAULT price book data from Supabase first.
 * Falls back to built-in job type heuristics if VAULT data is unavailable.
 *
 * NOTE: The labor rate used is from the HUNTER default (set in operationalData or
 * passed directly). The caller should pass the VAULT billRate for accuracy.
 *
 * @param jobType        — job type label (e.g. "Panel Upgrade", "Service Call")
 * @param estimatedValue — estimated job value in dollars
 * @param laborRate      — hourly labor rate (from VAULT settings; default: 95)
 * @returns EstimatedJobCost — full cost breakdown with estimation metadata
 */
export async function estimateJobCost(
  jobType: string,
  estimatedValue: number,
  laborRate = 95
): Promise<EstimatedJobCost> {
  const normalizedType = jobType.toLowerCase().trim();

  // Step 1: Attempt VAULT price book data fetch
  const vaultItems = await fetchVaultPriceBookForJobType(jobType);
  const usedVaultData = vaultItems.length > 0;

  let estimatedHours: number;
  let estimatedMaterials: number;

  if (usedVaultData) {
    // Use VAULT data to estimate materials
    estimatedMaterials = estimateMaterialCostFromVault(vaultItems, estimatedValue);

    // Still use heuristics for labor hours (VAULT doesn't store labor time)
    const heuristic = getHeuristicForJobType(normalizedType);
    estimatedHours = round2((estimatedValue / 1000) * heuristic.laborHoursPerKDollar);
  } else {
    // Full heuristic fallback
    const heuristic = getHeuristicForJobType(normalizedType);
    estimatedHours = round2((estimatedValue / 1000) * heuristic.laborHoursPerKDollar);
    estimatedMaterials = round2(estimatedValue * heuristic.materialPctOfJobValue);
  }

  // Enforce reasonable floor/ceiling on hours
  estimatedHours = Math.max(0.5, Math.min(estimatedHours, 400));

  const costBreakdown = calculateRealCost(
    estimatedHours,
    laborRate,
    estimatedMaterials,
    estimatedValue
  );

  return {
    ...costBreakdown,
    jobType,
    estimatedValue,
    usedVaultData,
  };
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

function getHeuristicForJobType(normalizedType: string): JobTypeHeuristic {
  // Exact match first
  if (JOB_TYPE_HEURISTICS[normalizedType]) {
    return JOB_TYPE_HEURISTICS[normalizedType];
  }

  // Partial match — find first heuristic whose key appears in the job type string
  const partialKey = Object.keys(JOB_TYPE_HEURISTICS).find(
    (key) => key !== 'default' && normalizedType.includes(key)
  );

  return partialKey
    ? JOB_TYPE_HEURISTICS[partialKey]
    : JOB_TYPE_HEURISTICS['default'];
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
