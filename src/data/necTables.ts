/**
 * necTables.ts — Pre-built NEC lookup data for offline use.
 *
 * All data is stored as TypeScript constants — no network required.
 * Sources: NEC 2023 (NFPA 70)
 *
 * Tables included:
 *  1. Conduit fill (NEC Chapter 9, Table 1)
 *  2. Burial depth (NEC 300.5)
 *  3. Box fill (NEC 314.16)
 *  4. Minimum circuit ampacity by load type
 *  5. GFCI / AFCI requirements by location
 */

// ─── 1. CONDUIT FILL ─────────────────────────────────────────────────────────
// NEC Chapter 9, Table 1 — Maximum fill percentages
// 1 conductor = 53%, 2 conductors = 31%, 3+ conductors = 40%

export type ConduitType = 'EMT' | 'IMC' | 'RMC' | 'ENT' | 'PVC-40' | 'PVC-80' | 'FMC' | 'LFMC'

// Internal area in square inches per conduit size
// Source: NEC Chapter 9, Table 4
export const CONDUIT_INTERNAL_AREA: Record<ConduitType, Record<string, number>> = {
  EMT: {
    '1/2': 0.304, '3/4': 0.533, '1': 0.864, '1-1/4': 1.496,
    '1-1/2': 2.036, '2': 3.356, '2-1/2': 5.858, '3': 8.846,
    '3-1/2': 11.545, '4': 14.753,
  },
  IMC: {
    '1/2': 0.342, '3/4': 0.586, '1': 0.959, '1-1/4': 1.647,
    '1-1/2': 2.225, '2': 3.630, '2-1/2': 6.285, '3': 9.449,
    '3-1/2': 12.566, '4': 15.994,
  },
  RMC: {
    '1/2': 0.314, '3/4': 0.549, '1': 0.887, '1-1/4': 1.526,
    '1-1/2': 2.071, '2': 3.408, '2-1/2': 5.596, '3': 8.411,
    '3-1/2': 10.979, '4': 14.101,
  },
  ENT: {
    '1/2': 0.285, '3/4': 0.508, '1': 0.832, '1-1/4': 1.453,
    '1-1/2': 1.986, '2': 3.291,
  },
  'PVC-40': {
    '1/2': 0.285, '3/4': 0.508, '1': 0.832, '1-1/4': 1.453,
    '1-1/2': 1.986, '2': 3.291, '2-1/2': 5.453, '3': 8.085,
    '3-1/2': 10.694, '4': 13.631,
  },
  'PVC-80': {
    '1/2': 0.217, '3/4': 0.409, '1': 0.688, '1-1/4': 1.237,
    '1-1/2': 1.711, '2': 2.874, '2-1/2': 4.795, '3': 7.268,
    '3-1/2': 9.737, '4': 12.554,
  },
  FMC: {
    '3/8': 0.116, '1/2': 0.317, '3/4': 0.533, '1': 0.817,
    '1-1/4': 1.277, '1-1/2': 1.858, '2': 3.317,
  },
  LFMC: {
    '3/8': 0.116, '1/2': 0.317, '3/4': 0.533, '1': 0.817,
    '1-1/4': 1.277, '1-1/2': 1.858, '2': 3.317,
  },
}

// Wire cross-section area in square inches (THHN/THWN — NEC Chapter 9, Table 5)
export const WIRE_AREA_THHN: Record<string, number> = {
  '14': 0.0097,
  '12': 0.0133,
  '10': 0.0211,
  '8':  0.0366,
  '6':  0.0507,
  '4':  0.0824,
  '3':  0.0973,
  '2':  0.1158,
  '1':  0.1562,
  '1/0': 0.1855,
  '2/0': 0.2223,
  '3/0': 0.2660,
  '4/0': 0.3237,
  '250': 0.3970,
  '300': 0.4608,
  '350': 0.5242,
  '400': 0.5863,
  '500': 0.7073,
  '600': 0.8676,
  '700': 0.9887,
  '750': 1.0496,
}

export interface ConduitFillResult {
  conduitArea: number
  wireArea: number
  totalFillArea: number
  maxFillArea: number
  fillPct: number
  maxFillPct: number
  pass: boolean
  note: string
}

/**
 * Calculate conduit fill per NEC Chapter 9, Table 1.
 * maxFillPct: 1 wire = 53%, 2 wires = 31%, 3+ wires = 40%
 */
export function calcConduitFill(
  conduitType: ConduitType,
  conduitSize: string,
  wireGauge: string,
  wireCount: number,
): ConduitFillResult {
  const conduitArea = CONDUIT_INTERNAL_AREA[conduitType]?.[conduitSize] ?? 0
  const singleWireArea = WIRE_AREA_THHN[wireGauge] ?? 0
  const totalFillArea = singleWireArea * wireCount
  const maxFillPct = wireCount === 1 ? 53 : wireCount === 2 ? 31 : 40
  const maxFillArea = conduitArea * (maxFillPct / 100)
  const fillPct = conduitArea > 0 ? (totalFillArea / conduitArea) * 100 : 0
  const pass = fillPct <= maxFillPct

  return {
    conduitArea,
    wireArea: singleWireArea,
    totalFillArea,
    maxFillArea,
    fillPct: Math.round(fillPct * 10) / 10,
    maxFillPct,
    pass,
    note: pass
      ? `✅ Fill OK — ${fillPct.toFixed(1)}% of ${maxFillPct}% max`
      : `❌ OVERFILL — ${fillPct.toFixed(1)}% exceeds ${maxFillPct}% max (NEC Ch. 9, Table 1)`,
  }
}

// ─── 2. BURIAL DEPTH ─────────────────────────────────────────────────────────
// NEC 300.5 — Minimum cover requirements (inches)

export type WiringMethod =
  | 'UF-cable'
  | 'direct-buried-conductors'
  | 'RMC'
  | 'IMC'
  | 'PVC-40'
  | 'PVC-80'
  | 'EMT'
  | 'LFMC'

export type LocationType =
  | 'general'
  | 'under-concrete'
  | 'under-building'
  | 'one-family-driveway'
  | '120v-gfci-20a-or-less'
  | 'airport-runway'
  | 'irrigation-landscape'

export interface BurialDepthResult {
  minDepthIn: number
  minDepthFt: string
  necRef: string
  note: string
}

// Depth in inches [location → depth]
// Source: NEC 2023, Table 300.5
const BURIAL_DEPTH_TABLE: Record<WiringMethod, Partial<Record<LocationType, number>>> = {
  'direct-buried-conductors': {
    general: 24,
    'under-concrete': 18,
    'one-family-driveway': 18,
    '120v-gfci-20a-or-less': 12,
    'airport-runway': 24,
    'irrigation-landscape': 6,
  },
  'UF-cable': {
    general: 24,
    'under-concrete': 18,
    'one-family-driveway': 18,
    '120v-gfci-20a-or-less': 12,
    'airport-runway': 24,
    'irrigation-landscape': 6,
  },
  RMC: {
    general: 6,
    'under-concrete': 6,
    'under-building': 0,
    'one-family-driveway': 6,
    '120v-gfci-20a-or-less': 6,
    'airport-runway': 6,
    'irrigation-landscape': 6,
  },
  IMC: {
    general: 6,
    'under-concrete': 6,
    'under-building': 0,
    'one-family-driveway': 6,
    '120v-gfci-20a-or-less': 6,
    'airport-runway': 6,
    'irrigation-landscape': 6,
  },
  'PVC-40': {
    general: 18,
    'under-concrete': 12,
    'under-building': 0,
    'one-family-driveway': 18,
    '120v-gfci-20a-or-less': 12,
    'airport-runway': 18,
    'irrigation-landscape': 6,
  },
  'PVC-80': {
    general: 6,
    'under-concrete': 6,
    'under-building': 0,
    'one-family-driveway': 6,
    '120v-gfci-20a-or-less': 6,
    'airport-runway': 6,
    'irrigation-landscape': 6,
  },
  EMT: {
    general: 18,
    'under-concrete': 12,
    'under-building': 0,
    'one-family-driveway': 18,
    '120v-gfci-20a-or-less': 12,
    'airport-runway': 18,
    'irrigation-landscape': 6,
  },
  LFMC: {
    general: 12,
    'under-concrete': 12,
    'under-building': 0,
    'one-family-driveway': 12,
    '120v-gfci-20a-or-less': 12,
    'airport-runway': 12,
    'irrigation-landscape': 6,
  },
}

export function getBurialDepth(
  wiringMethod: WiringMethod,
  locationType: LocationType,
): BurialDepthResult {
  const depthIn = BURIAL_DEPTH_TABLE[wiringMethod]?.[locationType] ?? 24
  const ft = Math.floor(depthIn / 12)
  const inches = depthIn % 12
  const minDepthFt = ft > 0 ? `${ft}′ ${inches > 0 ? inches + '″' : ''}`.trim() : `${inches}″`

  return {
    minDepthIn: depthIn,
    minDepthFt,
    necRef: 'NEC 300.5, Table 300.5',
    note: `Minimum cover: ${depthIn}" (${minDepthFt}) for ${wiringMethod} in ${locationType.replace(/-/g, ' ')} conditions`,
  }
}

// ─── 3. BOX FILL ─────────────────────────────────────────────────────────────
// NEC 314.16 — Box fill calculations

// Volume per conductor in cubic inches (NEC Table 314.16(B))
export const CONDUCTOR_VOLUME: Record<string, number> = {
  '14': 2.0,
  '12': 2.25,
  '10': 2.5,
  '8':  3.0,
  '6':  5.0,
}

export interface BoxFillInput {
  boxVolumeCuIn: number       // marked volume on box
  conductorGauge: string      // largest gauge in box
  conductorCount: number      // all current-carrying conductors + neutrals
  groundCount: number         // all equipment grounding conductors (count as 1)
  deviceCount: number         // switches / receptacles (yoke count × 2 × largest conductor volume)
  internalClampCount: number  // each clamp set = 1 conductor volume
}

export interface BoxFillResult {
  requiredVolumeCuIn: number
  boxVolumeCuIn: number
  pass: boolean
  breakdown: string
  necRef: string
}

/**
 * NEC 314.16(B) box fill calculation.
 * Each device (switch/receptacle) counts as 2 conductors of the largest size.
 * All grounds together count as 1 conductor.
 * Each internal clamp set counts as 1 conductor.
 */
export function calcBoxFill(input: BoxFillInput): BoxFillResult {
  const volPerConductor = CONDUCTOR_VOLUME[input.conductorGauge] ?? 2.0
  const conductorVol = input.conductorCount * volPerConductor
  const groundVol = input.groundCount > 0 ? 1 * volPerConductor : 0
  const deviceVol = input.deviceCount * 2 * volPerConductor
  const clampVol = input.internalClampCount > 0 ? input.internalClampCount * volPerConductor : 0
  const totalRequired = conductorVol + groundVol + deviceVol + clampVol
  const pass = totalRequired <= input.boxVolumeCuIn

  const breakdown = [
    `Conductors: ${input.conductorCount} × ${volPerConductor} = ${conductorVol.toFixed(2)} in³`,
    input.groundCount > 0 ? `Grounds (all count as 1): 1 × ${volPerConductor} = ${groundVol.toFixed(2)} in³` : null,
    input.deviceCount > 0 ? `Devices: ${input.deviceCount} × 2 × ${volPerConductor} = ${deviceVol.toFixed(2)} in³` : null,
    input.internalClampCount > 0 ? `Clamps: ${input.internalClampCount} × ${volPerConductor} = ${clampVol.toFixed(2)} in³` : null,
  ].filter(Boolean).join('\n')

  return {
    requiredVolumeCuIn: Math.round(totalRequired * 100) / 100,
    boxVolumeCuIn: input.boxVolumeCuIn,
    pass,
    breakdown,
    necRef: 'NEC 314.16(B)',
  }
}

// ─── 4. MINIMUM CIRCUIT AMPACITY ─────────────────────────────────────────────

export type LoadType =
  | 'general-lighting'
  | 'small-appliance'
  | 'laundry'
  | 'dishwasher'
  | 'garbage-disposal'
  | 'microwave'
  | 'range'
  | 'dryer'
  | 'water-heater'
  | 'hvac'
  | 'ev-charger-level2'
  | 'motor-1hp'
  | 'motor-2hp'
  | 'motor-5hp'
  | 'welding-receptacle'
  | 'refrigerator'

export interface AmpacityResult {
  minAmpacity: number
  recommendedWireGauge: string
  recommendedBreakerSize: number
  necRef: string
  note: string
}

// Pre-computed ampacity requirements
// Wire gauge ampacity at 60°C/75°C per NEC Table 310.12 / 310.16
const AMPACITY_TABLE: Record<LoadType, AmpacityResult> = {
  'general-lighting': {
    minAmpacity: 15,
    recommendedWireGauge: '14 AWG',
    recommendedBreakerSize: 15,
    necRef: 'NEC 210.19, 210.23',
    note: '15A general lighting circuit. Max 12 outlets per circuit recommended.',
  },
  'small-appliance': {
    minAmpacity: 20,
    recommendedWireGauge: '12 AWG',
    recommendedBreakerSize: 20,
    necRef: 'NEC 210.11(C)(1)',
    note: 'Kitchen small appliance circuits — minimum two 20A circuits required.',
  },
  'laundry': {
    minAmpacity: 20,
    recommendedWireGauge: '12 AWG',
    recommendedBreakerSize: 20,
    necRef: 'NEC 210.11(C)(2)',
    note: 'Dedicated 20A laundry circuit required.',
  },
  'dishwasher': {
    minAmpacity: 20,
    recommendedWireGauge: '12 AWG',
    recommendedBreakerSize: 20,
    necRef: 'NEC 210.19',
    note: 'Dedicated 20A circuit. Typically 120V.',
  },
  'garbage-disposal': {
    minAmpacity: 20,
    recommendedWireGauge: '12 AWG',
    recommendedBreakerSize: 20,
    necRef: 'NEC 210.19',
    note: 'Dedicated 20A circuit. May share with dishwasher per local code.',
  },
  'microwave': {
    minAmpacity: 20,
    recommendedWireGauge: '12 AWG',
    recommendedBreakerSize: 20,
    necRef: 'NEC 210.19',
    note: 'Dedicated 20A circuit recommended for built-in microwaves.',
  },
  'range': {
    minAmpacity: 40,
    recommendedWireGauge: '8 AWG',
    recommendedBreakerSize: 50,
    necRef: 'NEC 210.19(A)(3)',
    note: '240V range circuit. Use 8 AWG copper for 40A draw, 50A breaker per NEC 210.19(A)(3) demand factor.',
  },
  'dryer': {
    minAmpacity: 30,
    recommendedWireGauge: '10 AWG',
    recommendedBreakerSize: 30,
    necRef: 'NEC 210.19, 220.54',
    note: '240V dryer circuit. 30A circuit with 10 AWG copper.',
  },
  'water-heater': {
    minAmpacity: 30,
    recommendedWireGauge: '10 AWG',
    recommendedBreakerSize: 30,
    necRef: 'NEC 422.13',
    note: 'Electric water heater — dedicated 30A 240V circuit. Size at 125% of nameplate.',
  },
  'hvac': {
    minAmpacity: 30,
    recommendedWireGauge: '10 AWG',
    recommendedBreakerSize: 40,
    necRef: 'NEC 440.22, 210.19',
    note: 'Size circuit at 125% of compressor FLA + other loads. Verify equipment nameplate MOCP.',
  },
  'ev-charger-level2': {
    minAmpacity: 40,
    recommendedWireGauge: '8 AWG',
    recommendedBreakerSize: 50,
    necRef: 'NEC 625.41, 625.42',
    note: '240V Level 2 EVSE — 50A circuit for 40A continuous load (125% rule). 6 AWG if run >100 ft.',
  },
  'motor-1hp': {
    minAmpacity: 20,
    recommendedWireGauge: '12 AWG',
    recommendedBreakerSize: 20,
    necRef: 'NEC 430.52, Table 430.250',
    note: '1HP 240V motor FLA ≈ 8A; circuit at 125% = 10A. 20A breaker with time-delay fuse.',
  },
  'motor-2hp': {
    minAmpacity: 20,
    recommendedWireGauge: '12 AWG',
    recommendedBreakerSize: 25,
    necRef: 'NEC 430.52, Table 430.250',
    note: '2HP 240V motor FLA ≈ 12A; circuit at 125% = 15A. Breaker ≤ 250% FLA.',
  },
  'motor-5hp': {
    minAmpacity: 30,
    recommendedWireGauge: '10 AWG',
    recommendedBreakerSize: 60,
    necRef: 'NEC 430.52, Table 430.250',
    note: '5HP 240V motor FLA ≈ 28A; circuit at 125% = 35A. Breaker ≤ 250% FLA.',
  },
  'welding-receptacle': {
    minAmpacity: 50,
    recommendedWireGauge: '6 AWG',
    recommendedBreakerSize: 50,
    necRef: 'NEC 630.11',
    note: '240V 50A welder receptacle. Size to nameplate input amperes × duty cycle factor.',
  },
  'refrigerator': {
    minAmpacity: 15,
    recommendedWireGauge: '14 AWG',
    recommendedBreakerSize: 15,
    necRef: 'NEC 210.52(B)',
    note: 'Dedicated 15A or 20A circuit recommended for refrigerator per kitchen code.',
  },
}

export function getMinAmpacity(loadType: LoadType): AmpacityResult {
  return AMPACITY_TABLE[loadType] ?? {
    minAmpacity: 20,
    recommendedWireGauge: '12 AWG',
    recommendedBreakerSize: 20,
    necRef: 'NEC 210.19',
    note: 'Default 20A circuit. Verify load requirements.',
  }
}

export const ALL_LOAD_TYPES: LoadType[] = Object.keys(AMPACITY_TABLE) as LoadType[]

// ─── 5. GFCI / AFCI REQUIREMENTS ─────────────────────────────────────────────
// NEC 210.8 (GFCI) and 210.12 (AFCI)

export type RoomType =
  | 'bathroom'
  | 'kitchen'
  | 'garage'
  | 'outdoor'
  | 'crawl-space'
  | 'unfinished-basement'
  | 'boat-dock'
  | 'pool-spa'
  | 'laundry-room'
  | 'dishwasher'
  | 'hvac-equipment'
  | 'bedroom'
  | 'living-room'
  | 'dining-room'
  | 'hallway'
  | 'stairway'
  | 'office'
  | 'commercial-kitchen'
  | 'rooftop'
  | 'elevator'

export type CircuitType = '120v-15a' | '120v-20a' | '240v' | 'dedicated'

export interface ProtectionResult {
  gfciRequired: boolean
  afciRequired: boolean
  bothRequired: boolean
  gfciRef: string
  afciRef: string
  note: string
}

// NEC 2023 protection requirements by room
const PROTECTION_TABLE: Record<RoomType, ProtectionResult> = {
  'bathroom': {
    gfciRequired: true,
    afciRequired: false,
    bothRequired: false,
    gfciRef: 'NEC 210.8(A)(1)',
    afciRef: '',
    note: 'All 125V, 15A and 20A receptacles in bathrooms require GFCI.',
  },
  'kitchen': {
    gfciRequired: true,
    afciRequired: true,
    bothRequired: true,
    gfciRef: 'NEC 210.8(A)(6)',
    afciRef: 'NEC 210.12(A)',
    note: 'Kitchen receptacles within 6 ft of sink require GFCI. All bedroom-serving circuits require AFCI. Dual-function AFCI/GFCI breakers recommended.',
  },
  'garage': {
    gfciRequired: true,
    afciRequired: false,
    bothRequired: false,
    gfciRef: 'NEC 210.8(A)(2)',
    afciRef: '',
    note: 'All 125V, 15A/20A receptacles in garages require GFCI. Includes unfinished areas.',
  },
  'outdoor': {
    gfciRequired: true,
    afciRequired: false,
    bothRequired: false,
    gfciRef: 'NEC 210.8(A)(3)',
    afciRef: '',
    note: 'All outdoor receptacles require GFCI protection.',
  },
  'crawl-space': {
    gfciRequired: true,
    afciRequired: false,
    bothRequired: false,
    gfciRef: 'NEC 210.8(A)(4)',
    afciRef: '',
    note: 'At or below grade level crawl spaces require GFCI.',
  },
  'unfinished-basement': {
    gfciRequired: true,
    afciRequired: false,
    bothRequired: false,
    gfciRef: 'NEC 210.8(A)(5)',
    afciRef: '',
    note: 'Unfinished basements require GFCI. Finished basements require AFCI.',
  },
  'boat-dock': {
    gfciRequired: true,
    afciRequired: false,
    bothRequired: false,
    gfciRef: 'NEC 553.4, 210.8',
    afciRef: '',
    note: 'Boat docks and marinas require GFCI. Also see NEC 553 for marina wiring.',
  },
  'pool-spa': {
    gfciRequired: true,
    afciRequired: false,
    bothRequired: false,
    gfciRef: 'NEC 680.22, 680.43',
    afciRef: '',
    note: 'All receptacles within 20 ft of pool/spa require GFCI. Equipment circuits require GFCI per NEC 680.',
  },
  'laundry-room': {
    gfciRequired: true,
    afciRequired: true,
    bothRequired: true,
    gfciRef: 'NEC 210.8(A)(10)',
    afciRef: 'NEC 210.12(A)',
    note: 'Laundry areas require GFCI per NEC 2023. AFCI required for branch circuits in dwelling units.',
  },
  'dishwasher': {
    gfciRequired: true,
    afciRequired: false,
    bothRequired: false,
    gfciRef: 'NEC 210.8(D)',
    afciRef: '',
    note: 'Dishwasher branch circuit requires GFCI protection per NEC 2020/2023.',
  },
  'hvac-equipment': {
    gfciRequired: false,
    afciRequired: false,
    bothRequired: false,
    gfciRef: '',
    afciRef: '',
    note: 'HVAC equipment circuits generally not required to be GFCI. Check equipment listing and local amendments.',
  },
  'bedroom': {
    gfciRequired: false,
    afciRequired: true,
    bothRequired: false,
    gfciRef: '',
    afciRef: 'NEC 210.12(A)',
    note: 'All 120V branch circuits in bedrooms require AFCI protection.',
  },
  'living-room': {
    gfciRequired: false,
    afciRequired: true,
    bothRequired: false,
    gfciRef: '',
    afciRef: 'NEC 210.12(A)',
    note: 'All 120V, 15A/20A circuits in dwelling unit living areas require AFCI.',
  },
  'dining-room': {
    gfciRequired: false,
    afciRequired: true,
    bothRequired: false,
    gfciRef: '',
    afciRef: 'NEC 210.12(A)',
    note: 'Dining room circuits in dwelling units require AFCI.',
  },
  'hallway': {
    gfciRequired: false,
    afciRequired: true,
    bothRequired: false,
    gfciRef: '',
    afciRef: 'NEC 210.12(A)',
    note: 'Hallway circuits in dwelling units require AFCI.',
  },
  'stairway': {
    gfciRequired: false,
    afciRequired: true,
    bothRequired: false,
    gfciRef: '',
    afciRef: 'NEC 210.12(A)',
    note: 'Stairway circuits in dwelling units require AFCI.',
  },
  'office': {
    gfciRequired: false,
    afciRequired: true,
    bothRequired: false,
    gfciRef: '',
    afciRef: 'NEC 210.12(A)',
    note: 'Home office circuits in dwelling units require AFCI. Commercial offices — check local code.',
  },
  'commercial-kitchen': {
    gfciRequired: true,
    afciRequired: false,
    bothRequired: false,
    gfciRef: 'NEC 210.8(B)',
    afciRef: '',
    note: 'Commercial kitchens require GFCI for 15A/20A receptacles within 6 ft of sinks.',
  },
  'rooftop': {
    gfciRequired: true,
    afciRequired: false,
    bothRequired: false,
    gfciRef: 'NEC 210.8(A)(3)',
    afciRef: '',
    note: 'Rooftop receptacles (outdoor) require GFCI.',
  },
  'elevator': {
    gfciRequired: false,
    afciRequired: false,
    bothRequired: false,
    gfciRef: '',
    afciRef: '',
    note: 'Elevator circuits follow NEC 620. No standard GFCI/AFCI required — see NEC 620.85.',
  },
}

export function getProtectionRequirements(
  roomType: RoomType,
  _circuitType?: CircuitType,
): ProtectionResult {
  return PROTECTION_TABLE[roomType] ?? {
    gfciRequired: false,
    afciRequired: false,
    bothRequired: false,
    gfciRef: '',
    afciRef: '',
    note: 'Verify with local AHJ for specific requirements.',
  }
}

export const ALL_ROOM_TYPES: RoomType[] = Object.keys(PROTECTION_TABLE) as RoomType[]

// ─── Friendly label maps (for UI) ────────────────────────────────────────────

export const CONDUIT_TYPE_LABELS: Record<ConduitType, string> = {
  EMT: 'EMT (Electrical Metallic Tubing)',
  IMC: 'IMC (Intermediate Metal Conduit)',
  RMC: 'RMC (Rigid Metal Conduit)',
  ENT: 'ENT (Electrical Non-metallic Tubing)',
  'PVC-40': 'PVC Schedule 40',
  'PVC-80': 'PVC Schedule 80',
  FMC: 'FMC (Flexible Metal Conduit)',
  LFMC: 'LFMC (Liquid-tight Flexible Metal)',
}

export const WIRING_METHOD_LABELS: Record<WiringMethod, string> = {
  'UF-cable': 'UF Cable (Underground Feeder)',
  'direct-buried-conductors': 'Direct Buried Conductors',
  RMC: 'RMC (Rigid Metal Conduit)',
  IMC: 'IMC (Intermediate Metal Conduit)',
  'PVC-40': 'PVC Conduit Schedule 40',
  'PVC-80': 'PVC Conduit Schedule 80',
  EMT: 'EMT (Electrical Metallic Tubing)',
  LFMC: 'LFMC (Liquid-tight Flexible)',
}

export const LOCATION_TYPE_LABELS: Record<LocationType, string> = {
  general: 'General (open ground)',
  'under-concrete': 'Under Concrete Slab',
  'under-building': 'Under Building (in conduit)',
  'one-family-driveway': 'One-family Dwelling Driveway',
  '120v-gfci-20a-or-less': '120V GFCI-protected 20A or less',
  'airport-runway': 'Airport Runway / Taxiway',
  'irrigation-landscape': 'Landscape / Irrigation Lighting (low voltage)',
}

export const LOAD_TYPE_LABELS: Record<LoadType, string> = {
  'general-lighting': 'General Lighting',
  'small-appliance': 'Small Appliance (Kitchen)',
  'laundry': 'Laundry',
  'dishwasher': 'Dishwasher',
  'garbage-disposal': 'Garbage Disposal',
  'microwave': 'Microwave',
  'range': 'Electric Range / Oven',
  'dryer': 'Electric Dryer',
  'water-heater': 'Electric Water Heater',
  'hvac': 'HVAC / AC Condenser',
  'ev-charger-level2': 'EV Charger (Level 2)',
  'motor-1hp': 'Motor 1HP',
  'motor-2hp': 'Motor 2HP',
  'motor-5hp': 'Motor 5HP',
  'welding-receptacle': 'Welding Receptacle (50A)',
  'refrigerator': 'Refrigerator',
}

export const ROOM_TYPE_LABELS: Record<RoomType, string> = {
  'bathroom': 'Bathroom',
  'kitchen': 'Kitchen',
  'garage': 'Garage',
  'outdoor': 'Outdoor / Exterior',
  'crawl-space': 'Crawl Space',
  'unfinished-basement': 'Unfinished Basement',
  'boat-dock': 'Boat Dock / Marina',
  'pool-spa': 'Pool / Spa',
  'laundry-room': 'Laundry Room',
  'dishwasher': 'Dishwasher Circuit',
  'hvac-equipment': 'HVAC Equipment',
  'bedroom': 'Bedroom',
  'living-room': 'Living Room',
  'dining-room': 'Dining Room',
  'hallway': 'Hallway',
  'stairway': 'Stairway',
  'office': 'Home Office',
  'commercial-kitchen': 'Commercial Kitchen',
  'rooftop': 'Rooftop',
  'elevator': 'Elevator',
}

export const CONDUIT_SIZES = ['3/8', '1/2', '3/4', '1', '1-1/4', '1-1/2', '2', '2-1/2', '3', '3-1/2', '4'] as const
export const WIRE_GAUGES = ['14', '12', '10', '8', '6', '4', '3', '2', '1', '1/0', '2/0', '3/0', '4/0', '250', '300', '350', '400', '500'] as const
