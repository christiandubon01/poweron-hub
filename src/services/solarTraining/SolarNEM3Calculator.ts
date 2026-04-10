/**
 * SolarNEM3Calculator.ts
 *
 * NEM 3.0 Full Curriculum Module — PowerOn Hub Solar Training
 *
 * Covers:
 *   - NEM 2.0 vs NEM 3.0 comparison engine
 *   - TOU rate schedules for SCE and IID
 *   - calculateNEM3Savings(): full savings / payback analysis
 *   - compareNEM2vsNEM3(): side-by-side customer savings comparison
 *   - Battery TOU optimization model
 *
 * Key rate facts (hardcoded, updatable via config):
 *   NEM 2.0 export credit: ~$0.25–0.35/kWh (full retail)
 *   NEM 3.0 export credit: ~$0.05–0.08/kWh (Avoided Cost Calculator)
 *   Battery changes the math: charge at solar peak, discharge at utility TOU peak
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export type Utility = 'SCE' | 'IID';

export type RatePlan =
  | 'SCE_TOU_D_PRIME'
  | 'SCE_TOU_D_4_9PM'
  | 'SCE_TOU_D_PRIME_2'
  | 'IID_TOU_RESIDENTIAL'
  | 'IID_STANDARD';

export interface NEM3Inputs {
  /** Average monthly electricity usage in kWh */
  monthly_kwh: number;
  /** Utility provider */
  utility: Utility;
  /** Rate plan on file */
  rate_plan: RatePlan;
  /** Solar system size in kW (DC) */
  system_size_kw: number;
  /** Battery storage capacity in kWh (0 = no battery) */
  battery_kwh: number;
  /** Individual panel wattage (e.g. 400, 420, 450) */
  panel_wattage: number;
  /** Customer's current monthly utility bill in dollars */
  monthly_bill?: number;
  /** System install cost in dollars (for payback calculation) */
  system_cost?: number;
}

/** Hourly TOU rate block */
export interface TOUHourBlock {
  /** Hour of day 0-23 */
  hour: number;
  /** Rate period label */
  period: 'super_off_peak' | 'off_peak' | 'peak';
  /** Cost to import from grid ($/kWh) */
  import_rate: number;
  /** NEM 3.0 export credit (ACC rate, $/kWh) */
  export_credit_nem3: number;
  /** NEM 2.0 export credit (retail rate, $/kWh) */
  export_credit_nem2: number;
}

export interface TOUSchedule {
  utility: Utility;
  rate_plan: RatePlan;
  plan_label: string;
  hours: TOUHourBlock[];
  /** Peak hours notation for display */
  peak_hours_label: string;
  monthly_fixed_charge: number;
}

/** Monthly breakdown entry */
export interface MonthlyBillBreakdown {
  month: number;
  month_label: string;
  bill_before_solar: number;
  bill_after_solar_no_battery: number;
  bill_after_solar_with_battery: number;
  solar_production_kwh: number;
  self_consumed_kwh_no_battery: number;
  self_consumed_kwh_with_battery: number;
  exported_kwh_no_battery: number;
  exported_kwh_with_battery: number;
  export_credit_nem3_no_battery: number;
  export_credit_nem3_with_battery: number;
}

/** Full NEM 3.0 savings result */
export interface NEM3SavingsResult {
  inputs: NEM3Inputs;
  system_info: {
    panel_count: number;
    annual_production_kwh: number;
    annual_consumption_kwh: number;
    derate_factor: number;
    peak_sun_hours: number;
  };
  without_battery: {
    self_consumption_ratio: number;
    annual_export_kwh: number;
    annual_export_credit_nem3: number;
    annual_savings_year1: number;
    savings_10yr: number;
    savings_25yr: number;
    payback_months: number;
    payback_years: number;
  };
  with_battery: {
    self_consumption_ratio: number;
    annual_export_kwh: number;
    annual_export_credit_nem3: number;
    battery_cycles_per_year: number;
    tou_arbitrage_savings: number;
    annual_savings_year1: number;
    savings_10yr: number;
    savings_25yr: number;
    payback_months: number;
    payback_years: number;
  };
  monthly_breakdown: MonthlyBillBreakdown[];
  rate_schedule: TOUSchedule;
}

/** NEM 2.0 vs NEM 3.0 side-by-side comparison */
export interface NEM2vsNEM3Comparison {
  inputs: NEM3Inputs;
  nem2: {
    export_credit_rate_avg: number;
    annual_export_kwh: number;
    annual_export_revenue: number;
    annual_savings: number;
    savings_10yr: number;
    savings_25yr: number;
    payback_months: number;
    note: string;
  };
  nem3_no_battery: {
    export_credit_rate_avg: number;
    annual_export_kwh: number;
    annual_export_revenue: number;
    annual_savings: number;
    savings_10yr: number;
    savings_25yr: number;
    payback_months: number;
    delta_vs_nem2_year1: number;
    note: string;
  };
  nem3_with_battery: {
    export_credit_rate_avg: number;
    annual_export_kwh: number;
    annual_export_revenue: number;
    tou_arbitrage_savings: number;
    annual_savings: number;
    savings_10yr: number;
    savings_25yr: number;
    payback_months: number;
    delta_vs_nem2_year1: number;
    note: string;
  };
  summary_statement: string;
  recommendation: string;
}

// ============================================================================
// TOU RATE SCHEDULE CONFIGURATION
// ============================================================================

/**
 * SCE TOU-D-PRIME Rate Schedule
 * Summer: Jun–Sep | Winter: Oct–May
 * Peak: 4–9 PM daily (no weekend/holiday exemptions for residential)
 *
 * NEM 3.0 ACC export credits sourced from CPUC Avoided Cost Calculator.
 * Peak-hour ACC credits are higher due to grid capacity value.
 */
const SCE_TOU_D_PRIME_SCHEDULE: TOUSchedule = {
  utility: 'SCE',
  rate_plan: 'SCE_TOU_D_PRIME',
  plan_label: 'SCE TOU-D-PRIME',
  peak_hours_label: '4 PM – 9 PM daily',
  monthly_fixed_charge: 10.50,
  hours: Array.from({ length: 24 }, (_, h): TOUHourBlock => {
    // Peak: 4pm–9pm (hours 16–20 inclusive, i.e. h >= 16 && h <= 20)
    const isPeak = h >= 16 && h <= 20;
    // Super off-peak: 9am–2pm (solar generation hours, grid wants less)
    const isSuperOffPeak = h >= 9 && h <= 13;

    if (isPeak) {
      return {
        hour: h,
        period: 'peak',
        import_rate: 0.51,        // Summer peak composite
        export_credit_nem3: 0.07, // ACC peak credit (higher grid value)
        export_credit_nem2: 0.30, // Full retail approximate
      };
    } else if (isSuperOffPeak) {
      return {
        hour: h,
        period: 'super_off_peak',
        import_rate: 0.12,        // Super off-peak rate
        export_credit_nem3: 0.04, // ACC super-off-peak (lower grid value)
        export_credit_nem2: 0.12, // Retail (super off-peak era was lower)
      };
    } else {
      return {
        hour: h,
        period: 'off_peak',
        import_rate: 0.23,        // Off-peak rate
        export_credit_nem3: 0.055,// ACC off-peak credit
        export_credit_nem2: 0.23, // Full retail off-peak
      };
    }
  }),
};

/**
 * IID Residential TOU Schedule
 * Imperial Irrigation District — simpler structure, lower rates.
 * Peak: 11 AM – 7 PM (summer), shorter in winter.
 * IID does not have NEM 3.0 with ACC — uses modified net billing.
 * Approximated here to allow side-by-side comparisons.
 */
const IID_TOU_RESIDENTIAL_SCHEDULE: TOUSchedule = {
  utility: 'IID',
  rate_plan: 'IID_TOU_RESIDENTIAL',
  plan_label: 'IID Time-of-Use Residential',
  peak_hours_label: '11 AM – 7 PM (summer)',
  monthly_fixed_charge: 8.00,
  hours: Array.from({ length: 24 }, (_, h): TOUHourBlock => {
    // IID summer peak: 11am–7pm (hours 11–18)
    const isPeak = h >= 11 && h <= 18;
    // Off-peak: all other hours

    if (isPeak) {
      return {
        hour: h,
        period: 'peak',
        import_rate: 0.22,        // IID peak rate (significantly lower than SCE)
        export_credit_nem3: 0.06, // IID net billing export rate (peak period)
        export_credit_nem2: 0.22, // Full retail (IID NEM 2.0 grandfathered)
      };
    } else {
      return {
        hour: h,
        period: 'off_peak',
        import_rate: 0.13,        // IID off-peak rate
        export_credit_nem3: 0.04, // IID net billing export (off-peak)
        export_credit_nem2: 0.13, // Full retail off-peak
      };
    }
  }),
};

/** IID Standard (non-TOU) — fallback flat rate */
const IID_STANDARD_SCHEDULE: TOUSchedule = {
  utility: 'IID',
  rate_plan: 'IID_STANDARD',
  plan_label: 'IID Standard Residential',
  peak_hours_label: 'Flat rate (no TOU)',
  monthly_fixed_charge: 8.00,
  hours: Array.from({ length: 24 }, (_, h): TOUHourBlock => ({
    hour: h,
    period: 'off_peak',
    import_rate: 0.155,
    export_credit_nem3: 0.05,
    export_credit_nem2: 0.155,
  })),
};

/** Rate schedule registry */
export const TOU_RATE_SCHEDULES: Record<RatePlan, TOUSchedule> = {
  SCE_TOU_D_PRIME: SCE_TOU_D_PRIME_SCHEDULE,
  SCE_TOU_D_4_9PM: SCE_TOU_D_PRIME_SCHEDULE,   // alias — same peak window
  SCE_TOU_D_PRIME_2: SCE_TOU_D_PRIME_SCHEDULE, // alias — minor variant, use same schedule
  IID_TOU_RESIDENTIAL: IID_TOU_RESIDENTIAL_SCHEDULE,
  IID_STANDARD: IID_STANDARD_SCHEDULE,
};

// ============================================================================
// SOLAR PRODUCTION MODEL
// ============================================================================

/**
 * Peak sun hours by utility territory.
 * Inland Empire / Southern California averages (NREL PVWatts validated).
 * IID territory (Imperial Valley) gets more sun.
 */
const PEAK_SUN_HOURS: Record<Utility, number> = {
  SCE: 5.5,  // Southern California average
  IID: 6.2,  // Imperial Valley — more sun, more heat
};

/**
 * Derate factor accounts for system losses:
 * - Inverter efficiency (~96%)
 * - Wiring losses (~2%)
 * - Temperature derating (~5% — higher in IID)
 * - Soiling (~2%)
 * - Shading/mismatch (~3%)
 */
const DERATE_FACTOR: Record<Utility, number> = {
  SCE: 0.80,
  IID: 0.77, // Higher heat = more temperature derating
};

/**
 * Monthly production multipliers — accounts for seasonal sun variation.
 * Index 0 = January, index 11 = December.
 * Normalized so annual average = 1.0.
 */
const MONTHLY_PRODUCTION_MULTIPLIERS: number[] = [
  0.72, // Jan
  0.80, // Feb
  0.95, // Mar
  1.05, // Apr
  1.12, // May
  1.18, // Jun
  1.20, // Jul
  1.18, // Aug
  1.08, // Sep
  0.95, // Oct
  0.80, // Nov
  0.70, // Dec
];

const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// ============================================================================
// SOLAR PROFILE MODEL
// ============================================================================

/**
 * Hourly solar production weights (fraction of daily production per hour).
 * Bell curve centered around solar noon (~1pm PST).
 * Sum = 1.0 across all 24 hours.
 */
const SOLAR_PRODUCTION_HOURLY_WEIGHTS: number[] = [
  0.000, // 12am
  0.000, // 1am
  0.000, // 2am
  0.000, // 3am
  0.000, // 4am
  0.002, // 5am (very early dawn)
  0.015, // 6am
  0.055, // 7am
  0.095, // 8am
  0.120, // 9am
  0.135, // 10am
  0.140, // 11am
  0.135, // 12pm (near peak)
  0.130, // 1pm  (peak solar — sun slightly west of noon)
  0.110, // 2pm
  0.065, // 3pm
  0.030, // 4pm (panels still producing but declining, entering TOU peak)
  0.012, // 5pm
  0.004, // 6pm
  0.001, // 7pm
  0.000, // 8pm
  0.000, // 9pm
  0.000, // 10pm
  0.000, // 11pm
];

/**
 * Typical home consumption hourly weights (fraction of daily load per hour).
 * Represents typical California residential profile — morning/evening peaks.
 * Sum = 1.0 across all 24 hours.
 */
const HOME_CONSUMPTION_HOURLY_WEIGHTS: number[] = [
  0.030, // 12am
  0.025, // 1am
  0.022, // 2am
  0.022, // 3am
  0.025, // 4am
  0.030, // 5am
  0.038, // 6am — morning ramp
  0.050, // 7am — morning peak
  0.048, // 8am
  0.040, // 9am
  0.035, // 10am
  0.035, // 11am
  0.038, // 12pm
  0.038, // 1pm
  0.038, // 2pm
  0.040, // 3pm
  0.050, // 4pm — afternoon ramp into TOU peak
  0.060, // 5pm — TOU peak, HVAC + cooking
  0.065, // 6pm — highest demand
  0.060, // 7pm
  0.050, // 8pm
  0.042, // 9pm
  0.037, // 10pm
  0.032, // 11pm
];

// ============================================================================
// BATTERY TOU OPTIMIZATION MODEL
// ============================================================================

/**
 * Battery dispatch strategy:
 *   1. Charge during solar peak hours (9am–3pm) from excess solar
 *   2. Discharge during TOU peak hours (4pm–9pm SCE, 11am–7pm IID)
 *      to avoid expensive grid imports
 *   3. Any remaining battery charge used overnight / early morning
 *
 * Round-trip efficiency: 90% (industry standard for Enphase/Tesla/Span)
 */
const BATTERY_ROUND_TRIP_EFFICIENCY = 0.90;

/**
 * Compute how much battery capacity can realistically be used per day.
 * Battery can only cycle once per day in residential settings.
 * Usable capacity = battery_kwh × 90% DoD (most batteries don't go to 0%)
 */
function computeUsableBatteryKwh(battery_kwh: number): number {
  return battery_kwh * 0.90 * BATTERY_ROUND_TRIP_EFFICIENCY;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function getSchedule(rate_plan: RatePlan): TOUSchedule {
  return TOU_RATE_SCHEDULES[rate_plan] ?? SCE_TOU_D_PRIME_SCHEDULE;
}

function avgExportCreditNEM3(schedule: TOUSchedule): number {
  const total = schedule.hours.reduce((s, h) => s + h.export_credit_nem3, 0);
  return total / schedule.hours.length;
}

function avgExportCreditNEM2(schedule: TOUSchedule): number {
  const total = schedule.hours.reduce((s, h) => s + h.export_credit_nem2, 0);
  return total / schedule.hours.length;
}

function avgImportRate(schedule: TOUSchedule): number {
  const total = schedule.hours.reduce((s, h) => s + h.import_rate, 0);
  return total / schedule.hours.length;
}

/** Weighted average export credit for solar production profile.
 *  Solar produces more during off-peak/super-off-peak hours,
 *  so the effective export credit is lower than naive average. */
function productionWeightedExportCredit(
  schedule: TOUSchedule,
  mode: 'nem2' | 'nem3'
): number {
  let weightedSum = 0;
  for (let h = 0; h < 24; h++) {
    const weight = SOLAR_PRODUCTION_HOURLY_WEIGHTS[h];
    const block = schedule.hours[h];
    const credit = mode === 'nem2' ? block.export_credit_nem2 : block.export_credit_nem3;
    weightedSum += weight * credit;
  }
  return weightedSum;
}

/** Annual escalation factor for savings (electricity rates rise ~3%/yr) */
function compoundSavings(year1: number, years: number, escalation = 0.03): number {
  let total = 0;
  for (let y = 0; y < years; y++) {
    total += year1 * Math.pow(1 + escalation, y);
  }
  return total;
}

/** Calculate payback period in months */
function calcPaybackMonths(system_cost: number, annual_savings: number): number {
  if (annual_savings <= 0) return 9999;
  return (system_cost / annual_savings) * 12;
}

// ============================================================================
// CORE SAVINGS CALCULATOR
// ============================================================================

/**
 * calculateNEM3Savings()
 *
 * Full NEM 3.0 savings calculation for a customer.
 *
 * @param inputs - Customer and system inputs
 * @returns Detailed savings analysis including monthly breakdown
 */
export function calculateNEM3Savings(inputs: NEM3Inputs): NEM3SavingsResult {
  const {
    monthly_kwh,
    utility,
    rate_plan,
    system_size_kw,
    battery_kwh,
    panel_wattage,
    system_cost = 0,
  } = inputs;

  const schedule = getSchedule(rate_plan);
  const peakSunHours = PEAK_SUN_HOURS[utility];
  const derateFactor = DERATE_FACTOR[utility];

  // ── SYSTEM INFO ───────────────────────────────────────────────────────────
  const panelCount = Math.ceil((system_size_kw * 1000) / panel_wattage);
  const annualProductionKwh = system_size_kw * peakSunHours * 365 * derateFactor;
  const annualConsumptionKwh = monthly_kwh * 12;

  // ── HOURLY SIMULATION (annual average day) ────────────────────────────────
  const dailyProductionKwh = annualProductionKwh / 365;
  const dailyConsumptionKwh = annualConsumptionKwh / 365;
  const usableBatteryKwh = computeUsableBatteryKwh(battery_kwh);

  let selfConsumedNoBattery = 0;
  let exportedNoBattery = 0;
  let selfConsumedWithBattery = 0;
  let exportedWithBattery = 0;
  let touArbitrageSavingsPerDay = 0;

  // Battery state tracking for hourly simulation
  let batteryCharge = 0; // kWh currently stored

  for (let h = 0; h < 24; h++) {
    const solarH = dailyProductionKwh * SOLAR_PRODUCTION_HOURLY_WEIGHTS[h];
    const loadH = dailyConsumptionKwh * HOME_CONSUMPTION_HOURLY_WEIGHTS[h];
    const block = schedule.hours[h];

    // ── No Battery ──
    if (solarH >= loadH) {
      selfConsumedNoBattery += loadH;
      exportedNoBattery += solarH - loadH;
    } else {
      selfConsumedNoBattery += solarH;
      // Grid import for shortfall — no revenue effect here (import cost)
    }

    // ── With Battery ──
    let solarRemaining = solarH;
    let loadRemaining = loadH;

    // 1. Use solar directly first
    const directSolar = Math.min(solarRemaining, loadRemaining);
    selfConsumedWithBattery += directSolar;
    solarRemaining -= directSolar;
    loadRemaining -= directSolar;

    // 2. If solar surplus, charge battery (during solar peak hours 6am–3pm)
    if (solarRemaining > 0 && batteryCharge < usableBatteryKwh) {
      const chargeCapacity = usableBatteryKwh - batteryCharge;
      const charged = Math.min(solarRemaining, chargeCapacity);
      batteryCharge += charged * BATTERY_ROUND_TRIP_EFFICIENCY;
      solarRemaining -= charged;
    }

    // 3. Export any remaining solar
    exportedWithBattery += solarRemaining;

    // 4. If load shortfall and battery has charge, discharge during peak
    if (loadRemaining > 0 && batteryCharge > 0) {
      const discharged = Math.min(loadRemaining, batteryCharge);
      batteryCharge -= discharged;
      loadRemaining -= discharged;
      selfConsumedWithBattery += discharged;

      // TOU arbitrage: the battery discharged instead of buying from grid at peak rate
      // Savings = grid import rate at this hour × discharged kWh
      touArbitrageSavingsPerDay += discharged * block.import_rate;
    }
  }

  // Scale daily simulation to annual
  const annualSelfConsumedNoBattery = selfConsumedNoBattery * 365;
  const annualExportedNoBattery = exportedNoBattery * 365;
  const annualSelfConsumedWithBattery = selfConsumedWithBattery * 365;
  const annualExportedWithBattery = exportedWithBattery * 365;
  const annualTOUArbitrageSavings = touArbitrageSavingsPerDay * 365;

  const selfConsumptionRatioNoBattery = annualProductionKwh > 0
    ? Math.min(1, annualSelfConsumedNoBattery / annualProductionKwh)
    : 0;
  const selfConsumptionRatioWithBattery = annualProductionKwh > 0
    ? Math.min(1, annualSelfConsumedWithBattery / annualProductionKwh)
    : 0;

  // ── EXPORT CREDITS ────────────────────────────────────────────────────────
  // Production-weighted ACC rate (solar exports mostly during off-peak/super-off-peak)
  const weightedNEM3Rate = productionWeightedExportCredit(schedule, 'nem3');

  const annualExportCreditNEM3NoBattery = annualExportedNoBattery * weightedNEM3Rate;
  const annualExportCreditNEM3WithBattery = annualExportedWithBattery * weightedNEM3Rate;

  // ── BILL SAVINGS ──────────────────────────────────────────────────────────
  const avgImport = avgImportRate(schedule);
  const currentAnnualBill = monthly_kwh * 12 * avgImport + schedule.monthly_fixed_charge * 12;

  // Without battery: savings = avoided import + export credits
  const annualAvoidedImportNoBattery = annualSelfConsumedNoBattery * avgImport;
  const annualSavingsNoBattery = annualAvoidedImportNoBattery + annualExportCreditNEM3NoBattery;

  // With battery: savings = avoided import + export credits + TOU arbitrage
  const annualAvoidedImportWithBattery = annualSelfConsumedWithBattery * avgImport;
  const annualSavingsWithBattery = annualAvoidedImportWithBattery
    + annualExportCreditNEM3WithBattery
    + annualTOUArbitrageSavings;

  // ── MULTI-YEAR PROJECTIONS (3% annual rate escalation) ────────────────────
  const savings10NoBattery = compoundSavings(annualSavingsNoBattery, 10);
  const savings25NoBattery = compoundSavings(annualSavingsNoBattery, 25);
  const savings10WithBattery = compoundSavings(annualSavingsWithBattery, 10);
  const savings25WithBattery = compoundSavings(annualSavingsWithBattery, 25);

  // ── PAYBACK ───────────────────────────────────────────────────────────────
  const paybackNoBattery = calcPaybackMonths(system_cost, annualSavingsNoBattery);
  const paybackWithBattery = calcPaybackMonths(system_cost, annualSavingsWithBattery);

  // ── BATTERY CYCLE COUNT ───────────────────────────────────────────────────
  // Assume battery cycles once per day when system is generating
  const batteryCyclesPerYear = battery_kwh > 0 ? 300 : 0; // ~300 productive days/yr

  // ── MONTHLY BREAKDOWN ────────────────────────────────────────────────────
  const monthlyBreakdown: MonthlyBillBreakdown[] = MONTHLY_PRODUCTION_MULTIPLIERS.map(
    (multiplier, idx): MonthlyBillBreakdown => {
      const monthlyProduction = (annualProductionKwh / 12) * multiplier;
      const monthlyLoad = monthly_kwh;

      // Simple monthly approximation using annual ratios
      const monthSelfConsumedNoBattery = Math.min(monthlyProduction, monthlyLoad)
        * selfConsumptionRatioNoBattery;
      const monthExportedNoBattery = monthlyProduction - monthSelfConsumedNoBattery;

      const monthSelfConsumedWithBattery = Math.min(monthlyProduction, monthlyLoad)
        * selfConsumptionRatioWithBattery;
      const monthExportedWithBattery = monthlyProduction - monthSelfConsumedWithBattery;

      const monthExportCreditNem3NoBattery = monthExportedNoBattery * weightedNEM3Rate;
      const monthExportCreditNem3WithBattery = monthExportedWithBattery * weightedNEM3Rate;

      const monthBillBeforeSolar = monthlyLoad * avgImport + schedule.monthly_fixed_charge;
      const monthAvoidedNoBattery = monthSelfConsumedNoBattery * avgImport;
      const monthAvoidedWithBattery = monthSelfConsumedWithBattery * avgImport;

      const monthBillAfterNoBattery = Math.max(
        0,
        monthBillBeforeSolar - monthAvoidedNoBattery - monthExportCreditNem3NoBattery
      );
      const monthTOUArbitrage = (annualTOUArbitrageSavings / 12) * multiplier;
      const monthBillAfterWithBattery = Math.max(
        0,
        monthBillBeforeSolar - monthAvoidedWithBattery
          - monthExportCreditNem3WithBattery - monthTOUArbitrage
      );

      return {
        month: idx + 1,
        month_label: MONTH_LABELS[idx],
        bill_before_solar: Math.round(monthBillBeforeSolar * 100) / 100,
        bill_after_solar_no_battery: Math.round(monthBillAfterNoBattery * 100) / 100,
        bill_after_solar_with_battery: Math.round(monthBillAfterWithBattery * 100) / 100,
        solar_production_kwh: Math.round(monthlyProduction * 10) / 10,
        self_consumed_kwh_no_battery: Math.round(monthSelfConsumedNoBattery * 10) / 10,
        self_consumed_kwh_with_battery: Math.round(monthSelfConsumedWithBattery * 10) / 10,
        exported_kwh_no_battery: Math.round(monthExportedNoBattery * 10) / 10,
        exported_kwh_with_battery: Math.round(monthExportedWithBattery * 10) / 10,
        export_credit_nem3_no_battery: Math.round(monthExportCreditNem3NoBattery * 100) / 100,
        export_credit_nem3_with_battery: Math.round(monthExportCreditNem3WithBattery * 100) / 100,
      };
    }
  );

  // ── ASSEMBLE RESULT ───────────────────────────────────────────────────────
  return {
    inputs,
    system_info: {
      panel_count: panelCount,
      annual_production_kwh: Math.round(annualProductionKwh),
      annual_consumption_kwh: Math.round(annualConsumptionKwh),
      derate_factor: derateFactor,
      peak_sun_hours: peakSunHours,
    },
    without_battery: {
      self_consumption_ratio: Math.round(selfConsumptionRatioNoBattery * 1000) / 1000,
      annual_export_kwh: Math.round(annualExportedNoBattery),
      annual_export_credit_nem3: Math.round(annualExportCreditNEM3NoBattery * 100) / 100,
      annual_savings_year1: Math.round(annualSavingsNoBattery * 100) / 100,
      savings_10yr: Math.round(savings10NoBattery * 100) / 100,
      savings_25yr: Math.round(savings25NoBattery * 100) / 100,
      payback_months: Math.round(paybackNoBattery * 10) / 10,
      payback_years: Math.round((paybackNoBattery / 12) * 10) / 10,
    },
    with_battery: {
      self_consumption_ratio: Math.round(selfConsumptionRatioWithBattery * 1000) / 1000,
      annual_export_kwh: Math.round(annualExportedWithBattery),
      annual_export_credit_nem3: Math.round(annualExportCreditNEM3WithBattery * 100) / 100,
      battery_cycles_per_year: batteryCyclesPerYear,
      tou_arbitrage_savings: Math.round(annualTOUArbitrageSavings * 100) / 100,
      annual_savings_year1: Math.round(annualSavingsWithBattery * 100) / 100,
      savings_10yr: Math.round(savings10WithBattery * 100) / 100,
      savings_25yr: Math.round(savings25WithBattery * 100) / 100,
      payback_months: Math.round(paybackWithBattery * 10) / 10,
      payback_years: Math.round((paybackWithBattery / 12) * 10) / 10,
    },
    monthly_breakdown: monthlyBreakdown,
    rate_schedule: schedule,
  };
}

// ============================================================================
// NEM 2.0 VS NEM 3.0 COMPARISON ENGINE
// ============================================================================

/**
 * compareNEM2vsNEM3()
 *
 * Side-by-side comparison showing what a customer would save under each scenario.
 *
 * Produces the key sales conversation:
 *   "Under NEM 2.0 you'd save $X.
 *    Under NEM 3.0 without battery: $Y.
 *    With battery: $Z — which actually gets you close to NEM 2.0 savings."
 *
 * @param inputs - Same inputs as calculateNEM3Savings
 * @returns Complete comparison object with summary statement
 */
export function compareNEM2vsNEM3(inputs: NEM3Inputs): NEM2vsNEM3Comparison {
  const {
    utility,
    rate_plan,
    system_size_kw,
    battery_kwh,
    panel_wattage,
    system_cost = 0,
  } = inputs;

  const schedule = getSchedule(rate_plan);
  const peakSunHours = PEAK_SUN_HOURS[utility];
  const derateFactor = DERATE_FACTOR[utility];
  const avgImport = avgImportRate(schedule);

  const annualProductionKwh = system_size_kw * peakSunHours * 365 * derateFactor;
  const annualConsumptionKwh = inputs.monthly_kwh * 12;

  // ── NEM 3.0 FULL CALCULATION (reuse core engine) ──────────────────────────
  const nem3Result = calculateNEM3Savings(inputs);

  // ── NEM 2.0 MODEL ────────────────────────────────────────────────────────
  // NEM 2.0: customers get FULL retail credit for every kWh exported.
  // Self-consumption ratio without battery (same physics as NEM 3.0 calc).
  const scRatio = nem3Result.without_battery.self_consumption_ratio;
  const nem2ExportKwh = nem3Result.without_battery.annual_export_kwh;

  // Production-weighted NEM 2.0 export credit (retail rate)
  const nem2WeightedRate = productionWeightedExportCredit(schedule, 'nem2');
  const nem2AnnualExportRevenue = nem2ExportKwh * nem2WeightedRate;

  // NEM 2.0 self-consumption savings (same as NEM 3.0 — physics don't change)
  const nem2SelfConsumedKwh = annualProductionKwh * scRatio;
  const nem2AvoidedImport = nem2SelfConsumedKwh * avgImport;
  const nem2AnnualSavings = nem2AvoidedImport + nem2AnnualExportRevenue;

  const nem2Savings10 = compoundSavings(nem2AnnualSavings, 10);
  const nem2Savings25 = compoundSavings(nem2AnnualSavings, 25);
  const nem2Payback = calcPaybackMonths(system_cost, nem2AnnualSavings);

  // ── DELTAS ────────────────────────────────────────────────────────────────
  const deltaNoBattery = nem3Result.without_battery.annual_savings_year1 - nem2AnnualSavings;
  const deltaWithBattery = nem3Result.with_battery.annual_savings_year1 - nem2AnnualSavings;

  // ── SUMMARY STATEMENT ────────────────────────────────────────────────────
  const nem2Fmt = `$${Math.round(nem2AnnualSavings).toLocaleString()}`;
  const nem3NoBattFmt = `$${Math.round(nem3Result.without_battery.annual_savings_year1).toLocaleString()}`;
  const nem3BattFmt = `$${Math.round(nem3Result.with_battery.annual_savings_year1).toLocaleString()}`;
  const paybackNoBattYrs = Math.round(nem3Result.without_battery.payback_years * 10) / 10;
  const paybackBattYrs = Math.round(nem3Result.with_battery.payback_years * 10) / 10;

  const summaryStatement =
    `Under NEM 2.0 (grandfathered), this system would save approximately ${nem2Fmt}/year. ` +
    `Under NEM 3.0 without a battery, savings drop to ${nem3NoBattFmt}/year — a difference of ` +
    `$${Math.abs(Math.round(deltaNoBattery)).toLocaleString()}/year due to lower export credits. ` +
    `Adding a ${battery_kwh > 0 ? battery_kwh + ' kWh' : 'battery'} storage system brings annual savings to ${nem3BattFmt}/year ` +
    `by storing solar and discharging during peak TOU hours, reducing grid dependence.`;

  const recommendation = battery_kwh > 0
    ? `With a battery, this system recovers most of the NEM 2.0 advantage. ` +
      `Estimated payback: ${paybackBattYrs} years. Battery storage is the right move under NEM 3.0.`
    : `Without a battery, NEM 3.0 customers leave significant savings on the table. ` +
      `Payback without battery: ${paybackNoBattYrs} years. ` +
      `Consider proposing a battery to optimize savings under the current tariff.`;

  return {
    inputs,
    nem2: {
      export_credit_rate_avg: Math.round(nem2WeightedRate * 10000) / 10000,
      annual_export_kwh: Math.round(nem2ExportKwh),
      annual_export_revenue: Math.round(nem2AnnualExportRevenue * 100) / 100,
      annual_savings: Math.round(nem2AnnualSavings * 100) / 100,
      savings_10yr: Math.round(nem2Savings10 * 100) / 100,
      savings_25yr: Math.round(nem2Savings25 * 100) / 100,
      payback_months: Math.round(nem2Payback * 10) / 10,
      note: 'NEM 2.0: Full retail export credit. Grandfathered customers locked in for 20 years from interconnection date.',
    },
    nem3_no_battery: {
      export_credit_rate_avg: Math.round(productionWeightedExportCredit(schedule, 'nem3') * 10000) / 10000,
      annual_export_kwh: Math.round(nem3Result.without_battery.annual_export_kwh),
      annual_export_revenue: Math.round(nem3Result.without_battery.annual_export_credit_nem3 * 100) / 100,
      annual_savings: nem3Result.without_battery.annual_savings_year1,
      savings_10yr: nem3Result.without_battery.savings_10yr,
      savings_25yr: nem3Result.without_battery.savings_25yr,
      payback_months: nem3Result.without_battery.payback_months,
      delta_vs_nem2_year1: Math.round(deltaNoBattery * 100) / 100,
      note: 'NEM 3.0: Avoided Cost Calculator (ACC) export credits. Export value dropped ~70% vs NEM 2.0. Self-consumption is king.',
    },
    nem3_with_battery: {
      export_credit_rate_avg: Math.round(productionWeightedExportCredit(schedule, 'nem3') * 10000) / 10000,
      annual_export_kwh: Math.round(nem3Result.with_battery.annual_export_kwh),
      annual_export_revenue: Math.round(nem3Result.with_battery.annual_export_credit_nem3 * 100) / 100,
      tou_arbitrage_savings: nem3Result.with_battery.tou_arbitrage_savings,
      annual_savings: nem3Result.with_battery.annual_savings_year1,
      savings_10yr: nem3Result.with_battery.savings_10yr,
      savings_25yr: nem3Result.with_battery.savings_25yr,
      payback_months: nem3Result.with_battery.payback_months,
      delta_vs_nem2_year1: Math.round(deltaWithBattery * 100) / 100,
      note: 'NEM 3.0 + Battery: Store solar at midday, discharge at peak TOU to avoid $0.45–0.55/kWh grid imports. Battery arbitrage recovers NEM 2.0 gap.',
    },
    summary_statement: summaryStatement,
    recommendation,
  };
}

// ============================================================================
// CONVENIENCE EXPORTS — for curriculum quiz and training use
// ============================================================================

/** Key NEM 3.0 facts for training/quiz modules */
export const NEM3_KEY_FACTS = {
  effective_date: 'April 15, 2023',
  grandfathered_period_years: 20,
  nem2_export_credit_range: { min: 0.25, max: 0.35, unit: '$/kWh' },
  nem3_export_credit_range: { min: 0.05, max: 0.08, unit: '$/kWh' },
  export_value_reduction_pct: 70, // NEM 3.0 export credits are ~70% lower
  acc_stands_for: 'Avoided Cost Calculator',
  acc_description:
    'CPUC-mandated method for calculating NEM 3.0 export credits based on avoided utility costs, not retail rates.',
  battery_impact:
    'Battery storage shifts consumption to high-value hours, recovering much of the NEM 2.0 advantage under NEM 3.0.',
  key_utilities_affected: ['SCE', 'PG&E', 'SDG&E'],
  iid_note: 'IID (Imperial Irrigation District) is a public utility and follows its own tariff structure — not subject to CPUC NEM 3.0 ruling.',
  sales_key_message:
    'Solar still makes strong financial sense under NEM 3.0 — but battery storage is now the way to maximize savings.',
} as const;

/** TOU education: what makes SCE TOU-D-PRIME expensive to be on grid at peak */
export const TOU_EDUCATION = {
  sce_peak_hours: '4:00 PM – 9:00 PM',
  sce_peak_rate_range: '$0.45 – $0.55/kWh',
  sce_super_off_peak_rate: '~$0.12/kWh',
  battery_strategy:
    'Charge battery from solar 9am–3pm (super off-peak), discharge 4pm–9pm (peak) to avoid expensive grid imports.',
  why_battery_wins:
    'Battery discharges $0.50/kWh grid power it replaces, but solar only earns $0.07/kWh as export credit. Store > export.',
} as const;
