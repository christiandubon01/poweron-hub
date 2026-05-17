/**
 * SolarEstimateTypes.ts
 *
 * Local types, interfaces, and constants for the Solar Estimate interview flow.
 * All data is local-only / non-persistent in Phases 3–4.
 * Rate plan IDs align with SolarNEM3Calculator.ts to allow future integration.
 *
 * Maps/autocomplete: app already has @react-google-maps/api + VITE_GOOGLE_MAPS_BROWSER_KEY
 * + Places library loaded via googleMapsLoader.ts. Phase 4 may wire it using the same
 * pattern as MileageProjectAddress.tsx (Places autocomplete + dark-style GoogleMap).
 *
 * Rate data: SolarNEM3Calculator.ts already has full TOU schedules for SCE and IID.
 * Phase 5 may import calculateNEM3Savings() directly from that service.
 */

// ============================================================================
// PRIMITIVE TYPES
// ============================================================================

export type SolarEstimateUtility = 'SCE' | 'IID';

/** Rate plan IDs match SolarNEM3Calculator RatePlan for future integration. */
export type SolarEstimateRatePlan =
  | 'SCE_TOU_D_PRIME'
  | 'SCE_TOU_D_4_9PM'
  | 'SCE_TOU_D_PRIME_2'
  | 'IID_TOU_RESIDENTIAL'
  | 'IID_STANDARD';

export type ShadingLevel = 'none' | 'some' | 'heavy';

export type OwnershipStatus = 'own' | 'rent';

export type PropertyType =
  | 'single_family'
  | 'condo_apartment'
  | 'mobile_home'
  | 'commercial';

export type MainBreakerSize = '100A' | '125A' | '150A' | '200A' | '225A' | '400A' | 'unknown';

export type SolarEstimateAppliance =
  | 'ac_unit'
  | 'microwave'
  | 'hot_tub'
  | 'ev_charger'
  | 'electric_stove'
  | 'dryer'
  | 'washer'
  | 'furnace'
  | 'pool_equipment'
  | 'extra_heavy_load';

export interface SolarEstimateSelectedAppliance {
  id: SolarEstimateAppliance;
  amps?: number;
}

export type ConsumptionMethod = 'average_bill' | 'home_size';

export type SystemMode = 'solar_only' | 'solar_plus_battery';

export type EstimateStep =
  | 'address'
  | 'home_details'
  | 'energy_use'
  | 'system_config'
  | 'estimate_summary';

// ============================================================================
// INTERVIEW DATA SHAPE
// ============================================================================

export interface SolarEstimateData {
  // Address
  addressText: string;
  selectedAddressLabel: string;
  /** Google Places placeId — available when Places autocomplete is wired in Phase 4. */
  placeId: string | null;
  latitude: number | null;
  longitude: number | null;

  // Home details
  shading: ShadingLevel | null;
  ownership: OwnershipStatus | null;
  propertyType: PropertyType | null;
  mainBreakerSize: MainBreakerSize;
  selectedAppliances: SolarEstimateSelectedAppliance[];

  // Energy use
  utilityProvider: SolarEstimateUtility | null;
  ratePlan: SolarEstimateRatePlan | null;
  consumptionMethod: ConsumptionMethod;
  /** Monthly electric bill in dollars — used when consumptionMethod is 'average_bill'. */
  averageMonthlyBill: number | null;
  /** Home size in sq ft — used when consumptionMethod is 'home_size'. */
  homeSizeSqft: number | null;
  /** Derived monthly kWh — filled after user enters bill or home size. */
  estimatedMonthlyKwh: number | null;

  // System config
  systemMode: SystemMode;
  /** Target solar offset as a percentage (0–100). Default 100 = full offset. */
  targetOffset: number;
  monthlyUsageKwh: number;
  systemSizeKw: number;
  panelWattage: number;
  batterySizeKwh: number;
  installCost: number;
  mainPanelUpgradeNeeded: boolean;
  evChargerAddition: boolean;

  // Navigation
  currentStep: EstimateStep;
}

// ============================================================================
// SAFE DEFAULTS
// ============================================================================

export const DEFAULT_ESTIMATE_DATA: SolarEstimateData = {
  addressText: '',
  selectedAddressLabel: '',
  placeId: null,
  latitude: null,
  longitude: null,
  shading: null,
  ownership: null,
  propertyType: null,
  mainBreakerSize: 'unknown',
  selectedAppliances: [],
  utilityProvider: null,
  ratePlan: null,
  consumptionMethod: 'average_bill',
  averageMonthlyBill: null,
  homeSizeSqft: null,
  estimatedMonthlyKwh: null,
  systemMode: 'solar_only',
  targetOffset: 100,
  monthlyUsageKwh: 900,
  systemSizeKw: 8,
  panelWattage: 420,
  batterySizeKwh: 13.5,
  installCost: 28000,
  mainPanelUpgradeNeeded: false,
  evChargerAddition: false,
  currentStep: 'address',
};

// ============================================================================
// STEP ORDER
// ============================================================================

export const ESTIMATE_STEPS: EstimateStep[] = [
  'address',
  'energy_use',
  'home_details',
  'system_config',
  'estimate_summary',
];

// ============================================================================
// OPTION CONSTANTS — used by Phase 4 form UI
// ============================================================================

export const UTILITY_PROVIDERS: Array<{ id: SolarEstimateUtility; label: string }> = [
  { id: 'SCE', label: 'Southern California Edison Co' },
  { id: 'IID', label: 'Imperial Irrigation District' },
];

/** Rate plans per utility. Labels match SCE/IID public plan names. */
export const RATE_PLANS_BY_UTILITY: Record<
  SolarEstimateUtility,
  Array<{ id: SolarEstimateRatePlan; label: string }>
> = {
  SCE: [
    { id: 'SCE_TOU_D_PRIME', label: 'TOU-D-PRIME (Recommended for solar + NEM 3.0)' },
    { id: 'SCE_TOU_D_4_9PM', label: 'TOU-D-4-9PM' },
    { id: 'SCE_TOU_D_PRIME_2', label: 'TOU-D-PRIME-2' },
  ],
  IID: [
    { id: 'IID_TOU_RESIDENTIAL', label: 'TOU Residential' },
    { id: 'IID_STANDARD', label: 'Standard Residential' },
  ],
};

export const SHADING_OPTIONS: Array<{
  id: ShadingLevel;
  label: string;
  detail: string;
}> = [
  { id: 'none', label: 'No shade on my roof', detail: 'Full sun exposure most of the day' },
  { id: 'some', label: 'A little shade on my roof', detail: 'Some shading from trees or structures' },
  { id: 'heavy', label: 'A lot of shade on my roof', detail: 'Significant shading that reduces production' },
];

export const OWNERSHIP_OPTIONS: Array<{ id: OwnershipStatus; label: string }> = [
  { id: 'own', label: 'I own my home' },
  { id: 'rent', label: 'I rent my home' },
];

export const PROPERTY_TYPES: Array<{ id: PropertyType; label: string }> = [
  { id: 'single_family', label: 'Single family home' },
  { id: 'condo_apartment', label: 'Condo/apartment' },
  { id: 'mobile_home', label: 'Mobile home' },
  { id: 'commercial', label: 'Commercial' },
];

export const MAIN_BREAKER_SIZE_OPTIONS: Array<{ id: MainBreakerSize; label: string }> = [
  { id: '100A', label: '100A' },
  { id: '125A', label: '125A' },
  { id: '150A', label: '150A' },
  { id: '200A', label: '200A' },
  { id: '225A', label: '225A' },
  { id: '400A', label: '400A' },
  { id: 'unknown', label: 'Unknown' },
];

export const APPLIANCE_OPTIONS: Array<{ id: SolarEstimateAppliance; label: string }> = [
  { id: 'ac_unit', label: 'AC unit' },
  { id: 'microwave', label: 'Microwave' },
  { id: 'hot_tub', label: 'Hot tub' },
  { id: 'ev_charger', label: 'EV charger' },
  { id: 'electric_stove', label: 'Electric stove' },
  { id: 'dryer', label: 'Dryer' },
  { id: 'washer', label: 'Washer' },
  { id: 'furnace', label: 'Furnace' },
  { id: 'pool_equipment', label: 'Pool equipment' },
  { id: 'extra_heavy_load', label: 'Extra heavy load appliance' },
];

export const CONSUMPTION_METHODS: Array<{
  id: ConsumptionMethod;
  label: string;
  detail: string;
}> = [
  { id: 'average_bill', label: 'Average electric bill', detail: 'Enter a typical monthly bill amount' },
  { id: 'home_size', label: 'Home size', detail: 'Enter square footage — we estimate usage from it' },
];

export const SYSTEM_MODES: Array<{ id: SystemMode; label: string; detail: string }> = [
  { id: 'solar_only', label: 'Solar Only', detail: 'Grid-tied solar without battery storage' },
  { id: 'solar_plus_battery', label: 'Solar Plus Battery', detail: 'Solar with battery for backup and TOU optimization' },
];
