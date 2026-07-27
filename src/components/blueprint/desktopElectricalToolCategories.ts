import type { ElectricalSymbolKind } from './electricalSymbolRegistry'

export const DESKTOP_RECESSED_LIGHT_CATEGORY_ID = 'recessed-lights'

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
const LEGACY_NON_DESKTOP_HIDDEN_KIND_SET = new Set<ElectricalSymbolKind>([
  'can-light-2',
  'canless-light-2',
  'canless-light-4',
  'canless-light-6',
  'canless-light-10',
])

export type DesktopElectricalToolCategory = {
  id: typeof DESKTOP_RECESSED_LIGHT_CATEGORY_ID
  label: string
  children: readonly ElectricalSymbolKind[]
}

export const DESKTOP_ELECTRICAL_TOOL_CATEGORIES: readonly DesktopElectricalToolCategory[] = [
  {
    id: DESKTOP_RECESSED_LIGHT_CATEGORY_ID,
    label: 'Recessed Lights',
    children: DESKTOP_RECESSED_LIGHT_KINDS,
  },
]

export function isDesktopRecessedLightKind(kind: unknown): kind is (typeof DESKTOP_RECESSED_LIGHT_KINDS)[number] {
  return typeof kind === 'string' && DESKTOP_RECESSED_LIGHT_KIND_SET.has(kind as ElectricalSymbolKind)
}

export function shouldShowElectricalSymbolInDesktopMainGrid(kind: ElectricalSymbolKind) {
  return !isDesktopRecessedLightKind(kind) && kind !== 'electrical-recessed-light'
}

export function shouldShowElectricalSymbolInLegacyNonDesktopToolbar(kind: ElectricalSymbolKind) {
  return !LEGACY_NON_DESKTOP_HIDDEN_KIND_SET.has(kind)
}
