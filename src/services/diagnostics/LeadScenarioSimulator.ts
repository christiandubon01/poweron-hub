/**
 * src/services/diagnostics/LeadScenarioSimulator.ts
 * DIAG1 — Lead Scenario Simulator
 *
 * Runs full financial projections for 10-20 leads.
 * Models SOLO / WITH_CREW / WITH_PD scenarios and BEST / WORST / BASE variants.
 * Produces per-lead projections, batch summaries, and a 90-day cash-flow timeline.
 *
 * PUBLIC API:
 *   simulateLead(lead, variables)          → LeadProjection[]   (one per scenario mode)
 *   simulateBatch(leads, variables)        → BatchResult
 *   modelCashFlowTimeline(leads, start)    → CashFlowTimeline
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/** Christian's solo billable hourly rate (labor cost to the business) */
const SOLO_HOURLY_RATE = 85;

/** Crew member cost rate per hour (loaded: wages + payroll burden) */
const CREW_MEMBER_HOURLY_RATE = 38;

/** Project Director cost per month (salary + burden prorated per job) */
const PD_MONTHLY_COST = 6_500;

/** Average jobs handled per month when PD is in place */
const AVG_JOBS_PER_MONTH_WITH_PD = 6;

/** Per-job PD overhead allocation */
const PD_PER_JOB_COST = PD_MONTHLY_COST / AVG_JOBS_PER_MONTH_WITH_PD;

/** Vehicle/gas/insurance overhead per billable hour */
const TRUCK_COST_PER_HOUR = 8;

/** General overhead per billable hour (insurance, license, tools) */
const OVERHEAD_PER_HOUR = 12;

/** Drive time rate — same as solo rate because it is Christian's time */
const DRIVE_TIME_RATE = SOLO_HOURLY_RATE;

/** Average drive speed (mph) used to convert distance to hours */
const AVG_DRIVE_SPEED_MPH = 35;

/** Default material markup applied when VAULT price is not available */
const MATERIAL_MARKUP = 1.15;

/** Scope-creep factor for WORST_CASE (20 %) */
const WORST_SCOPE_CREEP = 0.2;

/** Payment delay for WORST_CASE: 30 extra days */
const WORST_PAYMENT_DELAY_DAYS = 30;

/** Material price inflation for WORST_CASE (10 %) */
const WORST_MATERIAL_INFLATION = 0.1;

/** Default job duration assumption (days on site) used for cash-flow timing */
const DEFAULT_JOB_DURATION_DAYS = 3;

/** Default payment terms (days after job completion) */
const DEFAULT_PAYMENT_TERMS_DAYS = 14;

/** Minimum acceptable margin percent before flagging as bad deal */
const MIN_ACCEPTABLE_MARGIN_PCT = 15;

// ─── Types ────────────────────────────────────────────────────────────────────

export type ScenarioMode = 'SOLO' | 'WITH_CREW' | 'WITH_PD';
export type ScenarioVariant = 'BASE' | 'BEST_CASE' | 'WORST_CASE';

/**
 * Minimal lead shape accepted by the simulator.
 * Compatible with HunterLead but does not require it —
 * manual entry leads only need the fields below.
 */
export interface SimulatorLead {
  id: string;
  contact_name?: string;
  company_name?: string;
  description?: string;
  lead_type?: string;
  estimated_value?: number;   // gross revenue estimate ($)
  urgency_level?: number;     // 1-5
  estimated_hours?: number;   // override if known
  estimated_material?: number; // override if known
  distance_miles?: number;     // round-trip miles to job site
  address?: string;
}

/**
 * Variable overrides passed by the caller.
 */
export interface SimulatorVariables {
  hasCrew: boolean;
  hasProjectDirector: boolean;
  cashFlowBuffer: number;  // current cash on hand ($)
  currentAR: number;       // current open AR balance ($)
}

/**
 * Full cost breakdown for one lead under one scenario.
 */
export interface LeadCostBreakdown {
  grossRevenue: number;
  laborCost: number;
  materialCost: number;
  overheadCost: number;     // truck + general overhead
  driveTimeCost: number;
  pdCost: number;           // project director allocation (0 if not applicable)
  totalCost: number;
  netMargin: number;
  marginPct: number;
}

/**
 * Cash-flow timing for one lead.
 */
export interface LeadCashFlowTiming {
  /** Estimated day (ISO date string) when costs start hitting */
  costsStartDate: string;
  /** Estimated day when revenue arrives (payment received) */
  revenueArrivalDate: string;
  /** Net cash-flow impact at time of payment */
  netAtPayment: number;
  /** Days between cost start and payment receipt */
  floatDays: number;
}

/**
 * Full projection for one lead under one scenario + variant.
 */
export interface LeadProjection {
  leadId: string;
  leadLabel: string;
  scenario: ScenarioMode;
  variant: ScenarioVariant;
  breakdown: LeadCostBreakdown;
  cashFlow: LeadCashFlowTiming;
  arExposure: number;       // how much this job adds to open AR
  flags: string[];          // warnings (low margin, high AR, etc.)
  isLowMargin: boolean;     // margin < MIN_ACCEPTABLE_MARGIN_PCT
}

/**
 * Batch result across all leads.
 */
export interface BatchResult {
  /** All projections, one per lead × mode (BASE variant only) */
  projections: LeadProjection[];
  /** Projections sorted by margin % descending */
  sortedByMargin: LeadProjection[];
  /** Total pipeline gross revenue */
  totalPipelineValue: number;
  /** Total estimated cost across all leads */
  totalCost: number;
  /** Total net margin */
  totalNetMargin: number;
  /** Margin % across the whole batch */
  totalMarginPct: number;
  /** Cumulative AR exposure if all leads close */
  totalARExposure: number;
  /** Human-readable summary sentence */
  summary: string;
  /** Leads with margin < 15 % */
  flaggedLeads: LeadProjection[];
  /** Scenario comparison table (SOLO vs WITH_CREW vs WITH_PD, BASE variant) */
  scenarioComparison: ScenarioComparison[];
}

/**
 * Side-by-side comparison row for one lead across all three scenario modes.
 */
export interface ScenarioComparison {
  leadId: string;
  leadLabel: string;
  solo: LeadCostBreakdown;
  withCrew: LeadCostBreakdown;
  withPD: LeadCostBreakdown;
}

/**
 * Single week in the 90-day cash-flow timeline.
 */
export interface CashFlowWeek {
  weekNumber: number;         // 1-13
  startDate: string;          // ISO date
  endDate: string;            // ISO date
  inflow: number;             // revenue arriving this week
  outflow: number;            // costs going out this week
  net: number;                // inflow - outflow
  cumulativeNet: number;      // running total from week 1
  jobsReceivingPayment: string[];
  jobsIncurringCosts: string[];
  flags: string[];
}

/**
 * Full 90-day cash-flow timeline.
 */
export interface CashFlowTimeline {
  weeks: CashFlowWeek[];
  gaps: Array<{
    weekNumber: number;
    deficit: number;
    recommendation: string;
  }>;
  summary: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function fmt$(n: number): string {
  return '$' + Math.round(n).toLocaleString();
}

/**
 * Estimate labor hours from a job value if the lead doesn't supply them.
 * Uses a simple heuristic: ~$150/hr blended value (labor + material blended rate).
 */
function estimateHours(jobValue: number): number {
  return Math.max(2, Math.round(jobValue / 150));
}

/**
 * Estimate material cost from job value if not supplied.
 * Rule of thumb: materials ≈ 30 % of job value for residential electrical.
 */
function estimateMaterial(jobValue: number): number {
  return jobValue * 0.3;
}

/**
 * Build cost breakdown for one lead under one scenario mode and variant.
 */
function buildBreakdown(
  lead: SimulatorLead,
  mode: ScenarioMode,
  variant: ScenarioVariant,
): LeadCostBreakdown {
  const rawRevenue = lead.estimated_value ?? 0;
  const rawMaterial = lead.estimated_material ?? estimateMaterial(rawRevenue);
  const rawHours = lead.estimated_hours ?? estimateHours(rawRevenue);
  const distanceMiles = lead.distance_miles ?? 0;

  // ── Variant adjustments ────────────────────────────────────────────────────
  let revenueMultiplier = 1;
  let materialMultiplier = 1;
  let hoursMultiplier = 1;

  if (variant === 'BEST_CASE') {
    // Job goes perfectly, paid on time — no adjustments to revenue or cost
    revenueMultiplier = 1;
  } else if (variant === 'WORST_CASE') {
    // Scope creep adds cost, materials inflate
    hoursMultiplier = 1 + WORST_SCOPE_CREEP;
    materialMultiplier = 1 + WORST_MATERIAL_INFLATION;
    // Revenue stays the same (scope creep not billed)
  }

  const grossRevenue = rawRevenue * revenueMultiplier;
  const hours = rawHours * hoursMultiplier;
  const materialCost = rawMaterial * materialMultiplier * MATERIAL_MARKUP;

  // ── Drive time ─────────────────────────────────────────────────────────────
  const driveHours = distanceMiles / AVG_DRIVE_SPEED_MPH;
  const driveTimeCost = driveHours * DRIVE_TIME_RATE;

  // ── Labor cost ─────────────────────────────────────────────────────────────
  let laborCost = 0;
  if (mode === 'SOLO') {
    // Christian does all the work
    laborCost = hours * SOLO_HOURLY_RATE;
  } else if (mode === 'WITH_CREW') {
    // Christian + 1 crew member — Christian manages/helps, crew does bulk
    laborCost = hours * (SOLO_HOURLY_RATE * 0.5 + CREW_MEMBER_HOURLY_RATE);
  } else {
    // WITH_PD — Christian sells, crew executes, PD manages
    laborCost = hours * (CREW_MEMBER_HOURLY_RATE * 1.5); // crew + half-lead
  }

  // ── Overhead (truck + general) ─────────────────────────────────────────────
  const overheadCost = hours * (TRUCK_COST_PER_HOUR + OVERHEAD_PER_HOUR);

  // ── Project director allocation ────────────────────────────────────────────
  const pdCost = mode === 'WITH_PD' ? PD_PER_JOB_COST : 0;

  // ── Totals ─────────────────────────────────────────────────────────────────
  const totalCost = laborCost + materialCost + overheadCost + driveTimeCost + pdCost;
  const netMargin = grossRevenue - totalCost;
  const marginPct = grossRevenue > 0 ? (netMargin / grossRevenue) * 100 : 0;

  return {
    grossRevenue,
    laborCost,
    materialCost,
    overheadCost,
    driveTimeCost,
    pdCost,
    totalCost,
    netMargin,
    marginPct,
  };
}

/**
 * Compute cash-flow timing for one lead.
 */
function buildCashFlowTiming(
  lead: SimulatorLead,
  variant: ScenarioVariant,
  startDate: string,
  jobIndex: number,
): LeadCashFlowTiming {
  // Stagger job starts so 10 leads don't all begin Day 1
  const jobStartOffset = jobIndex * 5; // 5 days apart
  const costsStartDate = addDays(startDate, jobStartOffset);

  const paymentDelay =
    DEFAULT_JOB_DURATION_DAYS +
    DEFAULT_PAYMENT_TERMS_DAYS +
    (variant === 'WORST_CASE' ? WORST_PAYMENT_DELAY_DAYS : 0);

  const revenueArrivalDate = addDays(costsStartDate, paymentDelay);
  const floatDays = paymentDelay;
  const netAtPayment = (lead.estimated_value ?? 0) * 0.7; // rough net

  return { costsStartDate, revenueArrivalDate, netAtPayment, floatDays };
}

/**
 * Build flags for a projection.
 */
function buildFlags(
  breakdown: LeadCostBreakdown,
  lead: SimulatorLead,
  cumulativeAR: number,
): string[] {
  const flags: string[] = [];

  if (breakdown.marginPct < MIN_ACCEPTABLE_MARGIN_PCT) {
    flags.push(`⚠ Low margin: ${breakdown.marginPct.toFixed(1)}% (target ≥${MIN_ACCEPTABLE_MARGIN_PCT}%)`);
  }
  if (cumulativeAR > 50_000) {
    flags.push(`⚠ High AR exposure: ${fmt$(cumulativeAR)} total open`);
  }
  if ((lead.distance_miles ?? 0) > 40) {
    flags.push(`🚗 Long drive: ${lead.distance_miles} mi RT — adds ${fmt$((lead.distance_miles ?? 0) / AVG_DRIVE_SPEED_MPH * DRIVE_TIME_RATE)} drive cost`);
  }
  if ((lead.urgency_level ?? 3) >= 4) {
    flags.push('🔥 Urgent lead — prioritize quote response');
  }
  if (breakdown.grossRevenue < 1_500) {
    flags.push('💡 Small job — consider minimum service call pricing');
  }

  return flags;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * simulateLead
 * Runs one lead through all three scenario modes × three variants.
 * Returns 9 projections (3 modes × 3 variants).
 *
 * @param lead          Lead data (from HUNTER or manual entry)
 * @param variables     Variable overrides (crew, PD, cash buffer, AR)
 * @param startDate     Reference date for cash-flow timing (ISO string, defaults to today)
 * @param jobIndex      Position in batch — used to stagger cash-flow dates
 */
export function simulateLead(
  lead: SimulatorLead,
  variables: SimulatorVariables,
  startDate: string = new Date().toISOString().slice(0, 10),
  jobIndex = 0,
): LeadProjection[] {
  const modes: ScenarioMode[] = ['SOLO', 'WITH_CREW', 'WITH_PD'];
  const variants: ScenarioVariant[] = ['BASE', 'BEST_CASE', 'WORST_CASE'];
  const projections: LeadProjection[] = [];

  for (const mode of modes) {
    for (const variant of variants) {
      const breakdown = buildBreakdown(lead, mode, variant);
      const cashFlow = buildCashFlowTiming(lead, variant, startDate, jobIndex);
      const arExposure = variables.currentAR + (lead.estimated_value ?? 0);
      const flags = buildFlags(breakdown, lead, arExposure);

      projections.push({
        leadId: lead.id,
        leadLabel: lead.contact_name ?? lead.company_name ?? `Lead ${lead.id}`,
        scenario: mode,
        variant,
        breakdown,
        cashFlow,
        arExposure,
        flags,
        isLowMargin: breakdown.marginPct < MIN_ACCEPTABLE_MARGIN_PCT,
      });
    }
  }

  return projections;
}

/**
 * simulateBatch
 * Runs 10-20 leads through the simulator and returns a full batch result.
 * Uses BASE variant for batch totals; all variants are available in projections.
 *
 * @param leads      Array of 10-20 leads
 * @param variables  Variable overrides
 * @param startDate  Reference date for cash-flow
 */
export function simulateBatch(
  leads: SimulatorLead[],
  variables: SimulatorVariables,
  startDate: string = new Date().toISOString().slice(0, 10),
): BatchResult {
  // Determine active mode from variables
  const mode: ScenarioMode = variables.hasProjectDirector
    ? 'WITH_PD'
    : variables.hasCrew
    ? 'WITH_CREW'
    : 'SOLO';

  const allProjections: LeadProjection[] = [];
  const baseProjections: LeadProjection[] = [];
  const scenarioComparison: ScenarioComparison[] = [];

  let runningAR = variables.currentAR;

  leads.forEach((lead, idx) => {
    const leadProjections = simulateLead(lead, { ...variables, currentAR: runningAR }, startDate, idx);
    allProjections.push(...leadProjections);

    // Extract BASE variant for the active mode
    const baseProj = leadProjections.find(p => p.scenario === mode && p.variant === 'BASE');
    if (baseProj) {
      baseProjections.push(baseProj);
      runningAR += lead.estimated_value ?? 0;
    }

    // Build scenario comparison (BASE variant, all three modes)
    const solo = leadProjections.find(p => p.scenario === 'SOLO' && p.variant === 'BASE');
    const withCrew = leadProjections.find(p => p.scenario === 'WITH_CREW' && p.variant === 'BASE');
    const withPD = leadProjections.find(p => p.scenario === 'WITH_PD' && p.variant === 'BASE');

    if (solo && withCrew && withPD) {
      scenarioComparison.push({
        leadId: lead.id,
        leadLabel: solo.leadLabel,
        solo: solo.breakdown,
        withCrew: withCrew.breakdown,
        withPD: withPD.breakdown,
      });
    }
  });

  // Batch totals from BASE projections in active mode
  const totalPipelineValue = baseProjections.reduce((sum, p) => sum + p.breakdown.grossRevenue, 0);
  const totalCost = baseProjections.reduce((sum, p) => sum + p.breakdown.totalCost, 0);
  const totalNetMargin = baseProjections.reduce((sum, p) => sum + p.breakdown.netMargin, 0);
  const totalMarginPct = totalPipelineValue > 0 ? (totalNetMargin / totalPipelineValue) * 100 : 0;
  const totalARExposure = variables.currentAR + totalPipelineValue;

  const flaggedLeads = baseProjections.filter(p => p.isLowMargin);
  const sortedByMargin = [...baseProjections].sort(
    (a, b) => b.breakdown.marginPct - a.breakdown.marginPct,
  );

  const summary =
    `If you close all ${leads.length} leads: ` +
    `${fmt$(totalPipelineValue)} gross revenue, ` +
    `${fmt$(totalCost)} total cost, ` +
    `${fmt$(totalNetMargin)} net margin (${totalMarginPct.toFixed(1)}%), ` +
    `AR reaches ${fmt$(totalARExposure)}. ` +
    (flaggedLeads.length > 0
      ? `⚠ ${flaggedLeads.length} lead(s) below ${MIN_ACCEPTABLE_MARGIN_PCT}% margin — review before accepting.`
      : `✅ All leads are above minimum margin threshold.`);

  return {
    projections: baseProjections,
    sortedByMargin,
    totalPipelineValue,
    totalCost,
    totalNetMargin,
    totalMarginPct,
    totalARExposure,
    summary,
    flaggedLeads,
    scenarioComparison,
  };
}

/**
 * modelCashFlowTimeline
 * Projects cash flow over 90 days for a batch of leads.
 * Shows when each job's revenue arrives vs when costs hit.
 * Identifies cash-flow gaps and flags danger weeks.
 *
 * @param leads      Array of leads (same as used for batch)
 * @param startDate  Starting date for the 90-day window (ISO string)
 * @param variables  Variable overrides (needed for cost estimates)
 */
export function modelCashFlowTimeline(
  leads: SimulatorLead[],
  startDate: string = new Date().toISOString().slice(0, 10),
  variables: SimulatorVariables = {
    hasCrew: false,
    hasProjectDirector: false,
    cashFlowBuffer: 0,
    currentAR: 0,
  },
): CashFlowTimeline {
  const mode: ScenarioMode = variables.hasProjectDirector
    ? 'WITH_PD'
    : variables.hasCrew
    ? 'WITH_CREW'
    : 'SOLO';

  // Build 13 weeks
  const weeks: CashFlowWeek[] = Array.from({ length: 13 }, (_, i) => {
    const weekStart = addDays(startDate, i * 7);
    const weekEnd = addDays(weekStart, 6);
    return {
      weekNumber: i + 1,
      startDate: weekStart,
      endDate: weekEnd,
      inflow: 0,
      outflow: 0,
      net: 0,
      cumulativeNet: 0,
      jobsReceivingPayment: [],
      jobsIncurringCosts: [],
      flags: [],
    };
  });

  // For each lead, figure out which week costs land and which week payment lands
  leads.forEach((lead, idx) => {
    const breakdown = buildBreakdown(lead, mode, 'BASE');
    const timing = buildCashFlowTiming(lead, 'BASE', startDate, idx);
    const label = lead.contact_name ?? lead.company_name ?? `Lead ${lead.id}`;

    // Costs go out on costs start date
    const costsDate = new Date(timing.costsStartDate);
    const startRef = new Date(startDate);
    const costsDayOffset = Math.max(0, Math.floor((costsDate.getTime() - startRef.getTime()) / 86_400_000));
    const costsWeekIdx = Math.min(12, Math.floor(costsDayOffset / 7));

    weeks[costsWeekIdx].outflow += breakdown.totalCost;
    weeks[costsWeekIdx].jobsIncurringCosts.push(label);

    // Revenue arrives on revenue date
    const revenueDate = new Date(timing.revenueArrivalDate);
    const revenueDayOffset = Math.floor((revenueDate.getTime() - startRef.getTime()) / 86_400_000);
    if (revenueDayOffset >= 0 && revenueDayOffset < 91) {
      const revenueWeekIdx = Math.min(12, Math.floor(revenueDayOffset / 7));
      weeks[revenueWeekIdx].inflow += breakdown.grossRevenue;
      weeks[revenueWeekIdx].jobsReceivingPayment.push(label);
    }
  });

  // Compute net and cumulative
  let cumulative = variables.cashFlowBuffer;
  for (const week of weeks) {
    week.net = week.inflow - week.outflow;
    cumulative += week.net;
    week.cumulativeNet = cumulative;

    if (week.net < 0) {
      week.flags.push(`⛔ Net negative ${fmt$(Math.abs(week.net))} this week`);
    }
    if (cumulative < 0) {
      week.flags.push(`🔴 Cumulative cash negative: ${fmt$(cumulative)}`);
    }
  }

  // Find gaps
  const gaps = weeks
    .filter(w => w.net < 0)
    .map(w => {
      const jobsPaying = weeks
        .filter(fw => fw.weekNumber > w.weekNumber && fw.jobsReceivingPayment.length > 0)
        .slice(0, 1);
      const nextPayingJob = jobsPaying.length > 0
        ? ` — ${jobsPaying[0].jobsReceivingPayment[0]} pays in week ${jobsPaying[0].weekNumber}`
        : '';

      return {
        weekNumber: w.weekNumber,
        deficit: w.net,
        recommendation:
          `Week ${w.weekNumber} you're ${fmt$(Math.abs(w.net))} negative${nextPayingJob}. ` +
          `Request a deposit from an upcoming job or draw from cash buffer.`,
      };
    });

  const gapCount = gaps.length;
  const summary =
    gapCount === 0
      ? `✅ 90-day cash flow is positive across all ${weeks.length} weeks with ${fmt$(variables.cashFlowBuffer)} starting buffer.`
      : `⚠ ${gapCount} week(s) with negative cash flow detected. Starting buffer: ${fmt$(variables.cashFlowBuffer)}. ` +
        `Worst gap: Week ${gaps.sort((a, b) => a.deficit - b.deficit)[0].weekNumber} ` +
        `(${fmt$(Math.abs(gaps[0].deficit))} deficit).`;

  return { weeks, gaps, summary };
}
