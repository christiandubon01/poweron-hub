import type { SolarEstimateData } from './SolarEstimateTypes'

export const SOLAR_ESTIMATE_SETTINGS_STORAGE_KEY = 'poweron.solarTraining.solarEstimateSettings'
export const SOLAR_ESTIMATE_SETTINGS_CHANGED_EVENT = 'poweron:solarEstimateSettingsChanged'

export type LaborFormulaMode = 'hourlyCrew' | 'panelRate'

export type HardwareEntry = {
  id: string
  title: string
  supplier: string
  wattageSpec: string
  price: string
}

export type HardwareIndexData = {
  solarModules: HardwareEntry[]
  hardware: {
    flashings: HardwareEntry[]
    legs: HardwareEntry[]
    rail: HardwareEntry[]
    spacers: HardwareEntry[]
    endCaps: HardwareEntry[]
  }
  electricalEquipment: {
    combinerBox: HardwareEntry[]
    disconnects: HardwareEntry[]
    mainElectricalPanels: HardwareEntry[]
  }
}

export const DEFAULT_HARDWARE_INDEX: HardwareIndexData = {
  solarModules: [],
  hardware: {
    flashings: [],
    legs: [],
    rail: [],
    spacers: [],
    endCaps: [],
  },
  electricalEquipment: {
    combinerBox: [],
    disconnects: [],
    mainElectricalPanels: [],
  },
}

export type SolarEstimateSettings = {
  installer1HourlyRate: number
  installer2HourlyRate: number
  crewLeadHourlyRate: number
  panelInstallLaborCost: number
  baseMobilityCost: number
  mobilityCostPerMile: number
  mobilityFreeMiles: number
  smallPermitCost: number
  mediumPermitCost: number
  largePermitCost: number
  smallBlueprintCost: number
  mediumBlueprintCost: number
  largeBlueprintCost: number
  flatDeliveryCost: number
  deliveryCostPerMile: number
  mainPanelUpgradeCost: number
  evChargerAdditionCost: number
  laborFormulaMode: LaborFormulaMode
  laborHoursSmall: number
  laborHoursMedium: number
  laborHoursLarge: number
  hardwareCostSmall: number
  hardwareCostMedium: number
  hardwareCostLarge: number
  hardwareIndex: HardwareIndexData
}

export type SolarEstimateCostBreakdown = {
  panelCount: number
  systemSizeTier: 'small' | 'medium' | 'large'
  panelLaborCost: number
  permitCost: number
  blueprintCost: number
  mobilityCost: number
  deliveryCost: number
  mainPanelUpgradeCost: number
  evChargerAdditionCost: number
  totalEstimatedInstallCost: number
  combinedHourlyLaborRate: number
  distanceMiles: number | null
  mobilityLabel: string
  deliveryLabel: string
}

export const DEFAULT_SOLAR_ESTIMATE_SETTINGS: SolarEstimateSettings = {
  installer1HourlyRate: 35,
  installer2HourlyRate: 35,
  crewLeadHourlyRate: 48,
  panelInstallLaborCost: 95,
  baseMobilityCost: 275,
  mobilityCostPerMile: 0,
  mobilityFreeMiles: 0,
  smallPermitCost: 450,
  mediumPermitCost: 650,
  largePermitCost: 850,
  smallBlueprintCost: 350,
  mediumBlueprintCost: 525,
  largeBlueprintCost: 725,
  flatDeliveryCost: 300,
  deliveryCostPerMile: 0,
  mainPanelUpgradeCost: 2500,
  evChargerAdditionCost: 1500,
  laborFormulaMode: 'panelRate',
  laborHoursSmall: 16,
  laborHoursMedium: 32,
  laborHoursLarge: 48,
  hardwareCostSmall: 2500,
  hardwareCostMedium: 4500,
  hardwareCostLarge: 7500,
  hardwareIndex: DEFAULT_HARDWARE_INDEX,
}

export function getCombinedHourlyLaborRate(settings: SolarEstimateSettings): number {
  return settings.installer1HourlyRate + settings.installer2HourlyRate + settings.crewLeadHourlyRate
}

export function getSolarSystemSizeTier(systemSizeKw: number): SolarEstimateCostBreakdown['systemSizeTier'] {
  if (systemSizeKw <= 6) return 'small'
  if (systemSizeKw <= 12) return 'medium'
  return 'large'
}

function safeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

function safeLaborFormulaMode(value: unknown): LaborFormulaMode {
  return value === 'hourlyCrew' || value === 'panelRate' ? value : DEFAULT_SOLAR_ESTIMATE_SETTINGS.laborFormulaMode
}

function safeHardwareEntry(value: unknown): HardwareEntry {
  const e = (value !== null && typeof value === 'object' ? value : {}) as Partial<HardwareEntry>
  return {
    id: typeof e.id === 'string' && e.id ? e.id : Math.random().toString(36).slice(2, 10),
    title: typeof e.title === 'string' ? e.title : '',
    supplier: typeof e.supplier === 'string' ? e.supplier : '',
    wattageSpec: typeof e.wattageSpec === 'string' ? e.wattageSpec : '',
    price: typeof e.price === 'string' ? e.price : '',
  }
}

function safeEntries(value: unknown): HardwareEntry[] {
  return Array.isArray(value) ? value.map(safeHardwareEntry) : []
}

function safeHardwareIndex(value: unknown): HardwareIndexData {
  const raw = (value !== null && typeof value === 'object' ? value : {}) as Partial<HardwareIndexData>
  const hw = (raw.hardware !== null && typeof raw.hardware === 'object' ? raw.hardware : {}) as Partial<HardwareIndexData['hardware']>
  const el = (raw.electricalEquipment !== null && typeof raw.electricalEquipment === 'object' ? raw.electricalEquipment : {}) as Partial<HardwareIndexData['electricalEquipment']>
  return {
    solarModules: safeEntries(raw.solarModules),
    hardware: {
      flashings: safeEntries(hw.flashings),
      legs: safeEntries(hw.legs),
      rail: safeEntries(hw.rail),
      spacers: safeEntries(hw.spacers),
      endCaps: safeEntries(hw.endCaps),
    },
    electricalEquipment: {
      combinerBox: safeEntries(el.combinerBox),
      disconnects: safeEntries(el.disconnects),
      mainElectricalPanels: safeEntries(el.mainElectricalPanels),
    },
  }
}

export function normalizeSolarEstimateSettings(value: Partial<SolarEstimateSettings> | null | undefined): SolarEstimateSettings {
  const raw = value ?? {}
  return {
    installer1HourlyRate: safeNumber(raw.installer1HourlyRate, DEFAULT_SOLAR_ESTIMATE_SETTINGS.installer1HourlyRate),
    installer2HourlyRate: safeNumber(raw.installer2HourlyRate, DEFAULT_SOLAR_ESTIMATE_SETTINGS.installer2HourlyRate),
    crewLeadHourlyRate: safeNumber(raw.crewLeadHourlyRate, DEFAULT_SOLAR_ESTIMATE_SETTINGS.crewLeadHourlyRate),
    panelInstallLaborCost: safeNumber(raw.panelInstallLaborCost, DEFAULT_SOLAR_ESTIMATE_SETTINGS.panelInstallLaborCost),
    baseMobilityCost: safeNumber(raw.baseMobilityCost, DEFAULT_SOLAR_ESTIMATE_SETTINGS.baseMobilityCost),
    mobilityCostPerMile: safeNumber(raw.mobilityCostPerMile, DEFAULT_SOLAR_ESTIMATE_SETTINGS.mobilityCostPerMile),
    mobilityFreeMiles: safeNumber(raw.mobilityFreeMiles, DEFAULT_SOLAR_ESTIMATE_SETTINGS.mobilityFreeMiles),
    smallPermitCost: safeNumber(raw.smallPermitCost, DEFAULT_SOLAR_ESTIMATE_SETTINGS.smallPermitCost),
    mediumPermitCost: safeNumber(raw.mediumPermitCost, DEFAULT_SOLAR_ESTIMATE_SETTINGS.mediumPermitCost),
    largePermitCost: safeNumber(raw.largePermitCost, DEFAULT_SOLAR_ESTIMATE_SETTINGS.largePermitCost),
    smallBlueprintCost: safeNumber(raw.smallBlueprintCost, DEFAULT_SOLAR_ESTIMATE_SETTINGS.smallBlueprintCost),
    mediumBlueprintCost: safeNumber(raw.mediumBlueprintCost, DEFAULT_SOLAR_ESTIMATE_SETTINGS.mediumBlueprintCost),
    largeBlueprintCost: safeNumber(raw.largeBlueprintCost, DEFAULT_SOLAR_ESTIMATE_SETTINGS.largeBlueprintCost),
    flatDeliveryCost: safeNumber(raw.flatDeliveryCost, DEFAULT_SOLAR_ESTIMATE_SETTINGS.flatDeliveryCost),
    deliveryCostPerMile: safeNumber(raw.deliveryCostPerMile, DEFAULT_SOLAR_ESTIMATE_SETTINGS.deliveryCostPerMile),
    mainPanelUpgradeCost: safeNumber(raw.mainPanelUpgradeCost, DEFAULT_SOLAR_ESTIMATE_SETTINGS.mainPanelUpgradeCost),
    evChargerAdditionCost: safeNumber(raw.evChargerAdditionCost, DEFAULT_SOLAR_ESTIMATE_SETTINGS.evChargerAdditionCost),
    laborFormulaMode: safeLaborFormulaMode(raw.laborFormulaMode),
    laborHoursSmall: safeNumber(raw.laborHoursSmall, DEFAULT_SOLAR_ESTIMATE_SETTINGS.laborHoursSmall),
    laborHoursMedium: safeNumber(raw.laborHoursMedium, DEFAULT_SOLAR_ESTIMATE_SETTINGS.laborHoursMedium),
    laborHoursLarge: safeNumber(raw.laborHoursLarge, DEFAULT_SOLAR_ESTIMATE_SETTINGS.laborHoursLarge),
    hardwareCostSmall: safeNumber(raw.hardwareCostSmall, DEFAULT_SOLAR_ESTIMATE_SETTINGS.hardwareCostSmall),
    hardwareCostMedium: safeNumber(raw.hardwareCostMedium, DEFAULT_SOLAR_ESTIMATE_SETTINGS.hardwareCostMedium),
    hardwareCostLarge: safeNumber(raw.hardwareCostLarge, DEFAULT_SOLAR_ESTIMATE_SETTINGS.hardwareCostLarge),
    hardwareIndex: safeHardwareIndex(raw.hardwareIndex),
  }
}

export function loadSolarEstimateSettings(): SolarEstimateSettings {
  try {
    const raw = localStorage.getItem(SOLAR_ESTIMATE_SETTINGS_STORAGE_KEY)
    return normalizeSolarEstimateSettings(raw ? JSON.parse(raw) : null)
  } catch {
    return DEFAULT_SOLAR_ESTIMATE_SETTINGS
  }
}

export function saveSolarEstimateSettings(settings: SolarEstimateSettings): SolarEstimateSettings {
  const normalized = normalizeSolarEstimateSettings(settings)
  try {
    localStorage.setItem(SOLAR_ESTIMATE_SETTINGS_STORAGE_KEY, JSON.stringify(normalized))
    window.dispatchEvent(new CustomEvent(SOLAR_ESTIMATE_SETTINGS_CHANGED_EVENT, { detail: normalized }))
  } catch {}
  return normalized
}

export function calculateSolarEstimateInstallCost(
  data: Pick<SolarEstimateData, 'systemSizeKw' | 'panelWattage' | 'mainPanelUpgradeNeeded' | 'evChargerAddition'>,
  settings: SolarEstimateSettings,
  distanceMiles: number | null = null
): SolarEstimateCostBreakdown {
  const panelCount = Math.ceil((data.systemSizeKw * 1000) / data.panelWattage)
  const tier = getSolarSystemSizeTier(data.systemSizeKw)
  const mileageCost =
    distanceMiles == null
      ? 0
      : Math.max(0, distanceMiles - settings.mobilityFreeMiles) * settings.mobilityCostPerMile
  const deliveryMileageCost = distanceMiles == null ? 0 : distanceMiles * settings.deliveryCostPerMile
  const permitCost =
    tier === 'small' ? settings.smallPermitCost : tier === 'medium' ? settings.mediumPermitCost : settings.largePermitCost
  const blueprintCost =
    tier === 'small'
      ? settings.smallBlueprintCost
      : tier === 'medium'
      ? settings.mediumBlueprintCost
      : settings.largeBlueprintCost
  const laborHours =
    tier === 'small' ? settings.laborHoursSmall : tier === 'medium' ? settings.laborHoursMedium : settings.laborHoursLarge
  const panelLaborCost =
    settings.laborFormulaMode === 'hourlyCrew'
      ? getCombinedHourlyLaborRate(settings) * laborHours
      : panelCount * settings.panelInstallLaborCost
  const mobilityCost = settings.baseMobilityCost + mileageCost
  const deliveryCost = settings.flatDeliveryCost + deliveryMileageCost
  const mainPanelUpgradeCost = data.mainPanelUpgradeNeeded ? settings.mainPanelUpgradeCost : 0
  const evChargerAdditionCost = data.evChargerAddition ? settings.evChargerAdditionCost : 0
  const totalEstimatedInstallCost = Math.round(
    panelLaborCost + permitCost + blueprintCost + mobilityCost + deliveryCost + mainPanelUpgradeCost + evChargerAdditionCost
  )

  return {
    panelCount,
    systemSizeTier: tier,
    panelLaborCost,
    permitCost,
    blueprintCost,
    mobilityCost,
    deliveryCost,
    mainPanelUpgradeCost,
    evChargerAdditionCost,
    totalEstimatedInstallCost,
    combinedHourlyLaborRate: getCombinedHourlyLaborRate(settings),
    distanceMiles,
    mobilityLabel: distanceMiles == null ? 'Base mobility only; distance not inferred' : `${distanceMiles.toFixed(1)} miles modeled`,
    deliveryLabel: distanceMiles == null ? 'Flat delivery only; distance not inferred' : `${distanceMiles.toFixed(1)} miles modeled`,
  }
}
