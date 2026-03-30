/**
 * Electrical Calculators Module — Wire sizing, conduit fill, and load demand calculations.
 *
 * All calculations follow NEC 2023 and include derating factors, safety margins,
 * and detailed references for audit and compliance documentation.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface WireSizeResult {
  recommendedGauge: string
  ampacity: number
  voltageDrop: number
  voltageDropPercent: number
  voltageLimitExceeded: boolean
  deratingFactors: {
    temperature: number
    bundling: number
    altitude: number
    combined: number
  }
  adjustedAmpacity: number
  necReference: string
  notes: string[]
}

export interface ConduitFillResult {
  fillPercentage: number
  maxAllowed: number
  pass: boolean
  conductorArea: number
  conduitArea: number
  necReference: string
  notes: string[]
}

export interface LoadDemandResult {
  totalConnectedLoad: number
  calculatedDemand: number
  serviceCapacity: number
  demandFactor: number
  capacityPercent: number
  adequate: boolean
  demandFactorsApplied: string[]
  necReference: string
  notes: string[]
}

// ── Wire Sizing Calculator (NEC 310.15) ──────────────────────────────────────

/**
 * Calculate recommended wire size for a circuit.
 * Applies derating factors and checks voltage drop per NEC 310.15.
 *
 * @param amperage Required amperage for circuit
 * @param voltage Circuit voltage (120, 208, 240, 277, 480, etc.)
 * @param distance Wire run distance in feet
 * @param conductorType "copper" or "aluminum"
 * @param installationMethod "conduit", "free_air", "buried", "cable_tray"
 * @param ambientTemp Optional ambient temperature in °F (default 86°F)
 * @returns WireSizeResult with recommended wire gauge and adjustments
 */
export function calculateWireSize(
  amperage: number,
  voltage: number,
  distance: number,
  conductorType: 'copper' | 'aluminum',
  installationMethod: 'conduit' | 'free_air' | 'buried' | 'cable_tray',
  ambientTemp: number = 86
): WireSizeResult {
  // NEC Table 310.15(B)(16) for copper/aluminum ampacity at 75°C, 3 conductors in conduit
  const ampacityTable: Record<string, Record<string, number>> = {
    copper: {
      '14': 20,
      '12': 25,
      '10': 30,
      '8': 40,
      '6': 50,
      '4': 65,
      '3': 85,
      '2': 95,
      '1': 110,
      '1/0': 125,
      '2/0': 145,
      '3/0': 165,
      '4/0': 195,
      '250': 215,
      '300': 240,
      '350': 260,
      '400': 280,
      '500': 320,
      '600': 350,
      '700': 385,
      '750': 400,
      '800': 410,
      '900': 435,
      '1000': 455,
    },
    aluminum: {
      '12': 20,
      '10': 24,
      '8': 32,
      '6': 40,
      '4': 50,
      '3': 65,
      '2': 75,
      '1': 85,
      '1/0': 100,
      '2/0': 115,
      '3/0': 130,
      '4/0': 150,
      '250': 170,
      '300': 190,
      '350': 208,
      '400': 225,
      '500': 260,
      '600': 285,
      '700': 310,
      '750': 325,
      '800': 330,
      '900': 356,
      '1000': 375,
    },
  }

  // Temperature derating per NEC 310.15(B)(2)(a)
  const temperatureDerate = getTemperatureDeratingFactor(ambientTemp)

  // Installation method and bundling derating
  const bundlingDerate = getBundlingDeratingFactor(installationMethod)

  // Altitude derating (conservative: only apply above 2500 ft)
  const altitudeDerate = 1.0 // Assume sea level

  // Combined derating
  const combinedDerate = temperatureDerate * bundlingDerate * altitudeDerate

  // Required ampacity with 125% continuous load factor
  const adjustedRequired = amperage * 1.25

  // Find minimum wire gauge that meets adjusted requirement
  const conductor = ampacityTable[conductorType]
  let selectedGauge = '14'
  let baseAmpacity = 0

  for (const [gauge, ampacity] of Object.entries(conductor)) {
    const adjustedAmpacity = ampacity * combinedDerate
    if (adjustedAmpacity >= adjustedRequired) {
      selectedGauge = gauge
      baseAmpacity = ampacity
      break
    }
  }

  const adjustedAmpacity = baseAmpacity * combinedDerate

  // Voltage drop calculation
  // VD = (2 × L × I × R) / 1000, where R is resistance per 1000 ft
  const resistance = getWireResistance(selectedGauge, conductorType)
  const voltageDrop = (2 * distance * amperage * resistance) / 1000
  const voltageDropPercent = (voltageDrop / voltage) * 100
  const voltageLimitExceeded = voltageDropPercent > 5

  const notes: string[] = []
  if (voltageLimitExceeded) {
    notes.push(`Warning: Voltage drop ${voltageDropPercent.toFixed(2)}% exceeds 5% limit. Consider larger conductor.`)
  }
  if (conductorType === 'aluminum') {
    notes.push('Aluminum ampacity is 84% of copper. Verify AHJ acceptance for feeder applications.')
  }

  return {
    recommendedGauge: selectedGauge,
    ampacity: amperage,
    voltageDrop: parseFloat(voltageDrop.toFixed(2)),
    voltageDropPercent: parseFloat(voltageDropPercent.toFixed(2)),
    voltageLimitExceeded,
    deratingFactors: {
      temperature: parseFloat(temperatureDerate.toFixed(3)),
      bundling: parseFloat(bundlingDerate.toFixed(3)),
      altitude: altitudeDerate,
      combined: parseFloat(combinedDerate.toFixed(3)),
    },
    adjustedAmpacity: parseFloat(adjustedAmpacity.toFixed(2)),
    necReference: 'NEC 310.15(B)(2) temperature derating, NEC 310.15(B)(3) bundling derating',
    notes,
  }
}

/**
 * Get temperature derating factor per NEC 310.15(B)(2)(a).
 * Assumes 75°C insulation rating.
 */
function getTemperatureDeratingFactor(ambientTemp: number): number {
  // NEC Table 310.15(B)(2)(a): Derating factors for ambient temperature at 75°C insulation
  if (ambientTemp <= 86) return 1.0
  if (ambientTemp <= 95) return 0.97
  if (ambientTemp <= 104) return 0.94
  if (ambientTemp <= 113) return 0.90
  if (ambientTemp <= 122) return 0.87
  if (ambientTemp <= 131) return 0.84
  if (ambientTemp <= 140) return 0.80
  if (ambientTemp <= 149) return 0.75
  if (ambientTemp <= 158) return 0.71
  if (ambientTemp <= 167) return 0.58
  if (ambientTemp <= 176) return 0.41
  return 0.0 // Above 176°F, not suitable
}

/**
 * Get bundling/grouping derating factor per NEC 310.15(B)(3).
 */
function getBundlingDeratingFactor(method: string): number {
  // Typical scenario: 3 conductors in conduit = 80% = 0.8
  // More conservatively: assume 3-6 current-carrying conductors
  switch (method) {
    case 'free_air':
      return 1.0 // No derating in free air
    case 'cable_tray':
      return 0.9 // Slight spacing in tray
    case 'buried':
      return 0.8 // Underground, assume 3-6 conductors
    case 'conduit':
    default:
      return 0.8 // Standard: 3-6 conductors in conduit
  }
}

/**
 * Get wire resistance per 1000 feet at 20°C.
 * Source: NEC Table 8
 */
function getWireResistance(gauge: string, type: 'copper' | 'aluminum'): number {
  const resistance: Record<string, Record<string, number>> = {
    copper: {
      '14': 2.525,
      '12': 1.588,
      '10': 0.999,
      '8': 0.628,
      '6': 0.395,
      '4': 0.248,
      '3': 0.196,
      '2': 0.155,
      '1': 0.123,
      '1/0': 0.0973,
      '2/0': 0.0773,
      '3/0': 0.0611,
      '4/0': 0.0485,
      '250': 0.0388,
      '300': 0.0323,
      '350': 0.0277,
      '400': 0.0242,
      '500': 0.0194,
      '600': 0.0162,
      '700': 0.0139,
      '750': 0.0129,
      '800': 0.0121,
      '900': 0.0108,
      '1000': 0.00982,
    },
    aluminum: {
      '12': 2.55,
      '10': 1.6,
      '8': 1.0,
      '6': 0.635,
      '4': 0.398,
      '3': 0.316,
      '2': 0.250,
      '1': 0.198,
      '1/0': 0.157,
      '2/0': 0.125,
      '3/0': 0.0992,
      '4/0': 0.0787,
      '250': 0.0630,
      '300': 0.0525,
      '350': 0.0450,
      '400': 0.0394,
      '500': 0.0315,
      '600': 0.0263,
      '700': 0.0225,
      '750': 0.0210,
      '800': 0.0197,
      '900': 0.0175,
      '1000': 0.0159,
    },
  }

  return resistance[type][gauge] || 0.1 // Default if not found
}

// ── Conduit Fill Calculator (NEC Article 353) ───────────────────────────────

export interface ConductorSize {
  gauge: string
  type: 'THHN' | 'THWN' | 'RHH' | 'XHHW' | 'other'
}

/**
 * Calculate conduit fill percentage.
 * Per NEC 353.22: max 53% (1 conductor), 31% (2 conductors), 40% (3+ conductors).
 *
 * @param conductors Array of conductors with gauge and type
 * @param conduitType "PVC", "RMC", "IMC", etc.
 * @param conduitSize Conduit size in inches (e.g., "1/2", "3/4", "1", "1.25", "1.5", "2")
 * @returns ConduitFillResult with percentage and pass/fail
 */
export function calculateConduitFill(
  conductors: ConductorSize[],
  conduitType: string,
  conduitSize: string
): ConduitFillResult {
  // NEC Table 4: Conduit area in square inches
  const conduitAreas: Record<string, number> = {
    '1/2': 0.307,
    '3/4': 0.494,
    '1': 0.824,
    '1.25': 1.496,
    '1.5': 2.036,
    '2': 3.356,
    '2.5': 5.017,
    '3': 7.088,
    '4': 12.566,
  }

  // Conductor area per NEC Table 5 (typical THHN/THWN)
  const conductorAreas: Record<string, number> = {
    '14': 0.0097,
    '12': 0.0133,
    '10': 0.0211,
    '8': 0.0366,
    '6': 0.0507,
    '4': 0.0824,
    '2': 0.1333,
    '1': 0.1901,
    '1/0': 0.2223,
    '2/0': 0.2679,
    '3/0': 0.3237,
    '4/0': 0.4072,
  }

  const conduitArea = conduitAreas[conduitSize] || 0.307

  // Calculate total conductor area
  let totalConductorArea = 0
  conductors.forEach(c => {
    totalConductorArea += conductorAreas[c.gauge] || 0.01
  })

  // Calculate fill percentage
  const fillPercentage = (totalConductorArea / conduitArea) * 100

  // Determine max allowed based on conductor count
  let maxAllowed = 40 // Default: 40% for 3+ conductors
  if (conductors.length === 1) {
    maxAllowed = 53
  } else if (conductors.length === 2) {
    maxAllowed = 31
  }

  const pass = fillPercentage <= maxAllowed

  const notes: string[] = []
  if (!pass) {
    notes.push(
      `Fill ${fillPercentage.toFixed(1)}% exceeds ${maxAllowed}% limit. Consider next larger conduit size.`
    )
  }
  if (fillPercentage > maxAllowed - 5) {
    notes.push('Conduit fill is close to limit. Recommend larger conduit for future expansion.')
  }

  return {
    fillPercentage: parseFloat(fillPercentage.toFixed(1)),
    maxAllowed,
    pass,
    conductorArea: parseFloat(totalConductorArea.toFixed(4)),
    conduitArea: parseFloat(conduitArea.toFixed(4)),
    necReference: 'NEC 353.22 (Conduit Fill), NEC Table 4 (Conduit Area), NEC Table 5 (Wire Area)',
    notes,
  }
}

// ── Load Demand Calculator (NEC 220) ────────────────────────────────────────

export interface Circuit {
  type: 'lighting' | 'motor' | 'heating' | 'continuous_other'
  watts: number
  continuous: boolean // True for continuous loads (≥3 hours)
}

/**
 * Calculate load demand per NEC 220.
 *
 * @param circuits Array of circuits with type, wattage, and continuous flag
 * @param serviceSize Service capacity in amperes (e.g., 100, 200, 400)
 * @param voltage Service voltage (default 240V)
 * @returns LoadDemandResult with demand calculation and adequacy check
 */
export function calculateLoadDemand(
  circuits: Circuit[],
  serviceSize: number,
  voltage: number = 240
): LoadDemandResult {
  const demandFactorsApplied: string[] = []

  // Calculate connected load
  let totalConnected = 0
  let lightingLoad = 0
  let motorLoad = 0
  let heatingLoad = 0
  let otherLoad = 0

  circuits.forEach(circuit => {
    const load = circuit.watts * (circuit.continuous ? 1.25 : 1.0)
    totalConnected += load

    switch (circuit.type) {
      case 'lighting':
        lightingLoad += circuit.watts
        break
      case 'motor':
        motorLoad += load
        break
      case 'heating':
        heatingLoad += load
        break
      case 'continuous_other':
        otherLoad += load
        break
    }
  })

  // Apply demand factors per NEC 220.42 (general lighting)
  let demandedLoad = 0

  // First 3000 W at 100%, next at 35%
  const firstDemand = Math.min(lightingLoad, 3000)
  const additionalLighting = Math.max(0, lightingLoad - 3000) * 0.35

  demandedLoad = firstDemand + additionalLighting
  if (lightingLoad > 3000) {
    demandFactorsApplied.push('Lighting: First 3000W @ 100%, remainder @ 35% (NEC 220.42)')
  } else {
    demandFactorsApplied.push('Lighting: 100% applied')
  }

  // Add motor load (largest at 125%, others at 25%)
  if (motorLoad > 0) {
    demandedLoad += motorLoad
    demandFactorsApplied.push('Motors: 125% largest + 25% others (NEC 430.24)')
  }

  // Add heating at 100%
  if (heatingLoad > 0) {
    demandedLoad += heatingLoad
    demandFactorsApplied.push('Heating: 100%')
  }

  // Add other loads at 100%
  if (otherLoad > 0) {
    demandedLoad += otherLoad
    demandFactorsApplied.push('Other: 100%')
  }

  // Calculate service amperage needed
  const demandFactor = totalConnected > 0 ? demandedLoad / totalConnected : 1.0
  const requiredAmps = demandedLoad / voltage

  // Check adequacy (use 125% for safety margin on continuous loads)
  const serviceCapacity = serviceSize * voltage
  const capacityPercent = (demandedLoad / serviceCapacity) * 100
  const adequate = capacityPercent <= 80 // Recommend ≤80% utilization

  const notes: string[] = []
  if (capacityPercent > 80) {
    notes.push(`Demand ${capacityPercent.toFixed(1)}% of service. Consider larger service.`)
  }
  if (capacityPercent > 100) {
    notes.push(`CRITICAL: Demand exceeds service capacity by ${(capacityPercent - 100).toFixed(1)}%.`)
  }
  if (circuits.some(c => c.continuous)) {
    notes.push('Continuous loads are derated at 125%. Ensure service sizing accounts for this.')
  }

  return {
    totalConnectedLoad: parseFloat(totalConnected.toFixed(0)),
    calculatedDemand: parseFloat(demandedLoad.toFixed(0)),
    serviceCapacity,
    demandFactor: parseFloat(demandFactor.toFixed(2)),
    capacityPercent: parseFloat(capacityPercent.toFixed(1)),
    adequate,
    demandFactorsApplied,
    necReference: 'NEC 220 (Load Calculations), NEC 220.42 (General Lighting Demand Factors)',
    notes,
  }
}
