import type { ElectricalSymbolKind } from './electricalSymbolRegistry'

export const DESKTOP_RECESSED_LIGHT_CATEGORY_ID = 'recessed-lights'
export const DESKTOP_SWITCHES_CATEGORY_ID = 'switches'
export const DESKTOP_CEILING_DEVICES_CATEGORY_ID = 'ceiling-devices'
export const DESKTOP_LIGHTING_CONTROLS_CATEGORY_ID = 'lighting-controls'
export const DESKTOP_RECEPTACLES_CATEGORY_ID = 'receptacles'
export const DESKTOP_LOW_VOLTAGE_CATEGORY_ID = 'low-voltage'

export const DESKTOP_RECESSED_LIGHT_KINDS = [
  'can-light-2',
  'canless-light-2',
  'can-light-4',
  'canless-light-4',
  'can-light-6',
  'canless-light-6',
  'canless-light-10',
] as const satisfies readonly ElectricalSymbolKind[]

const DESKTOP_RECESSED_LIGHT_KIND_SET = new Set<ElectricalSymbolKind>(DESKTOP_RECESSED_LIGHT_KINDS)
export const DESKTOP_SWITCH_KINDS = [
  'electrical-switch',
  'electrical-switch-3way',
  'electrical-switch-4way',
  'electrical-dimmer',
] as const satisfies readonly ElectricalSymbolKind[]

const DESKTOP_SWITCH_KIND_SET = new Set<ElectricalSymbolKind>(DESKTOP_SWITCH_KINDS)
export const DESKTOP_CEILING_DEVICE_KINDS = [
  'electrical-co-alarm',
  'electrical-smoke-alarm',
  'electrical-emergency-exit-sign',
] as const satisfies readonly ElectricalSymbolKind[]

const DESKTOP_CEILING_DEVICE_KIND_SET = new Set<ElectricalSymbolKind>(DESKTOP_CEILING_DEVICE_KINDS)
export const DESKTOP_LIGHTING_CONTROL_KINDS = [
  'electrical-ceiling-occupancy-sensor',
  'electrical-wall-occupancy-sensor',
  'electrical-photocell',
  'electrical-timer-control',
] as const satisfies readonly ElectricalSymbolKind[]

const DESKTOP_LIGHTING_CONTROL_KIND_SET = new Set<ElectricalSymbolKind>(DESKTOP_LIGHTING_CONTROL_KINDS)
export const DESKTOP_RECEPTACLE_KINDS = [
  'electrical-receptacle',
  'electrical-gfci',
  'electrical-gfci-wp',
  'electrical-receptacle-240v',
  'electrical-single-receptacle',
  'electrical-half-hot-receptacle',
] as const satisfies readonly ElectricalSymbolKind[]

const DESKTOP_RECEPTACLE_KIND_SET = new Set<ElectricalSymbolKind>(DESKTOP_RECEPTACLE_KINDS)
export const DESKTOP_LOW_VOLTAGE_KINDS = [
  'electrical-hdmi',
  'electrical-data',
] as const satisfies readonly ElectricalSymbolKind[]

const DESKTOP_LOW_VOLTAGE_KIND_SET = new Set<ElectricalSymbolKind>(DESKTOP_LOW_VOLTAGE_KINDS)
const LEGACY_NON_DESKTOP_HIDDEN_KIND_SET = new Set<ElectricalSymbolKind>([
  'can-light-2',
  'canless-light-2',
  'canless-light-4',
  'canless-light-6',
  'canless-light-10',
  'electrical-gfci-wp',
  'electrical-single-receptacle',
  'electrical-half-hot-receptacle',
])

export type DesktopElectricalToolCategory = {
  id:
    | typeof DESKTOP_RECESSED_LIGHT_CATEGORY_ID
    | typeof DESKTOP_SWITCHES_CATEGORY_ID
    | typeof DESKTOP_CEILING_DEVICES_CATEGORY_ID
    | typeof DESKTOP_LIGHTING_CONTROLS_CATEGORY_ID
    | typeof DESKTOP_RECEPTACLES_CATEGORY_ID
    | typeof DESKTOP_LOW_VOLTAGE_CATEGORY_ID
  label: string
  children: readonly ElectricalSymbolKind[]
}

export const DESKTOP_ELECTRICAL_TOOL_CATEGORIES: readonly DesktopElectricalToolCategory[] = [
  {
    id: DESKTOP_RECESSED_LIGHT_CATEGORY_ID,
    label: 'Recessed Lights',
    children: DESKTOP_RECESSED_LIGHT_KINDS,
  },
  {
    id: DESKTOP_SWITCHES_CATEGORY_ID,
    label: 'Switches',
    children: DESKTOP_SWITCH_KINDS,
  },
  {
    id: DESKTOP_CEILING_DEVICES_CATEGORY_ID,
    label: 'Ceiling Devices',
    children: DESKTOP_CEILING_DEVICE_KINDS,
  },
  {
    id: DESKTOP_LIGHTING_CONTROLS_CATEGORY_ID,
    label: 'Lighting Controls',
    children: DESKTOP_LIGHTING_CONTROL_KINDS,
  },
  {
    id: DESKTOP_RECEPTACLES_CATEGORY_ID,
    label: 'Receptacles',
    children: DESKTOP_RECEPTACLE_KINDS,
  },
  {
    id: DESKTOP_LOW_VOLTAGE_CATEGORY_ID,
    label: 'Low Voltage',
    children: DESKTOP_LOW_VOLTAGE_KINDS,
  },
]

export function isDesktopRecessedLightKind(kind: unknown): kind is (typeof DESKTOP_RECESSED_LIGHT_KINDS)[number] {
  return typeof kind === 'string' && DESKTOP_RECESSED_LIGHT_KIND_SET.has(kind as ElectricalSymbolKind)
}

export function isDesktopSwitchKind(kind: unknown): kind is (typeof DESKTOP_SWITCH_KINDS)[number] {
  return typeof kind === 'string' && DESKTOP_SWITCH_KIND_SET.has(kind as ElectricalSymbolKind)
}

export function isDesktopCeilingDeviceKind(kind: unknown): kind is (typeof DESKTOP_CEILING_DEVICE_KINDS)[number] {
  return typeof kind === 'string' && DESKTOP_CEILING_DEVICE_KIND_SET.has(kind as ElectricalSymbolKind)
}

export function isDesktopLightingControlKind(kind: unknown): kind is (typeof DESKTOP_LIGHTING_CONTROL_KINDS)[number] {
  return typeof kind === 'string' && DESKTOP_LIGHTING_CONTROL_KIND_SET.has(kind as ElectricalSymbolKind)
}

export function isDesktopReceptacleKind(kind: unknown): kind is (typeof DESKTOP_RECEPTACLE_KINDS)[number] {
  return typeof kind === 'string' && DESKTOP_RECEPTACLE_KIND_SET.has(kind as ElectricalSymbolKind)
}

export function isDesktopLowVoltageKind(kind: unknown): kind is (typeof DESKTOP_LOW_VOLTAGE_KINDS)[number] {
  return typeof kind === 'string' && DESKTOP_LOW_VOLTAGE_KIND_SET.has(kind as ElectricalSymbolKind)
}

export function isDesktopElectricalCategoryChildKind(kind: unknown): kind is ElectricalSymbolKind {
  return isDesktopRecessedLightKind(kind) || isDesktopSwitchKind(kind) || isDesktopCeilingDeviceKind(kind) || isDesktopLightingControlKind(kind) || isDesktopReceptacleKind(kind) || isDesktopLowVoltageKind(kind)
}

export function shouldShowElectricalSymbolInDesktopMainGrid(kind: ElectricalSymbolKind) {
  return !isDesktopElectricalCategoryChildKind(kind) && kind !== 'electrical-recessed-light'
}

export function shouldShowElectricalSymbolInLegacyNonDesktopToolbar(kind: ElectricalSymbolKind) {
  return !LEGACY_NON_DESKTOP_HIDDEN_KIND_SET.has(kind)
}
