import type React from 'react'

export type ElectricalSymbolKind =
  | 'can-light-2'
  | 'can-light-4'
  | 'can-light-6'
  | 'canless-light-2'
  | 'canless-light-4'
  | 'canless-light-6'
  | 'canless-light-10'
  | 'electrical-switch'
  | 'electrical-switch-3way'
  | 'electrical-switch-4way'
  | 'electrical-dimmer'
  | 'electrical-recessed-light'
  | 'electrical-pendant-light'
  | 'electrical-sconce'
  | 'electrical-emergency-exit-sign'
  | 'electrical-led-panel-2x2'
  | 'electrical-led-panel-2x4'
  | 'electrical-panel'
  | 'electrical-gfci'
  | 'electrical-gfci-wp'
  | 'electrical-receptacle'
  | 'electrical-receptacle-240v'
  | 'electrical-single-receptacle'
  | 'electrical-half-hot-receptacle'
  | 'electrical-timer-control'
  | 'electrical-photocell'
  | 'electrical-ceiling-occupancy-sensor'
  | 'electrical-wall-occupancy-sensor'
  | 'electrical-smoke-alarm'
  | 'electrical-co-alarm'
  | 'electrical-hdmi'
  | 'electrical-data'

export type ElectricalSymbolCategory = 'lighting' | 'switching' | 'power' | 'control'

export type ElectricalSymbolMetadata = {
  symbolKind: ElectricalSymbolKind
  displayName: string
  shortLabel: string
  category: ElectricalSymbolCategory
  countValue: number
  defaultPhase: string
  materialKey: string
  laborKey: string
  isElectricalSymbol: true
}

export const ELECTRICAL_SYMBOL_METADATA: Record<ElectricalSymbolKind, ElectricalSymbolMetadata> = {
  'can-light-2': {
    symbolKind: 'can-light-2',
    displayName: '2" Can Light',
    shortLabel: '2"',
    category: 'lighting',
    countValue: 1,
    defaultPhase: 'electrical',
    materialKey: 'can-light-2',
    laborKey: 'can-light',
    isElectricalSymbol: true,
  },
  'canless-light-2': {
    symbolKind: 'canless-light-2',
    displayName: '2" Canless',
    shortLabel: '2" CL',
    category: 'lighting',
    countValue: 1,
    defaultPhase: 'electrical',
    materialKey: 'canless-light-2',
    laborKey: 'canless-light',
    isElectricalSymbol: true,
  },
  'can-light-4': {
    symbolKind: 'can-light-4',
    displayName: '4" Can Light',
    shortLabel: '4"',
    category: 'lighting',
    countValue: 1,
    defaultPhase: 'electrical',
    materialKey: 'can-light-4',
    laborKey: 'can-light',
    isElectricalSymbol: true,
  },
  'canless-light-4': {
    symbolKind: 'canless-light-4',
    displayName: '4" Canless Light',
    shortLabel: '4" CL',
    category: 'lighting',
    countValue: 1,
    defaultPhase: 'electrical',
    materialKey: 'canless-light-4',
    laborKey: 'canless-light',
    isElectricalSymbol: true,
  },
  'can-light-6': {
    symbolKind: 'can-light-6',
    displayName: '6" Can Light',
    shortLabel: '6"',
    category: 'lighting',
    countValue: 1,
    defaultPhase: 'electrical',
    materialKey: 'can-light-6',
    laborKey: 'can-light',
    isElectricalSymbol: true,
  },
  'canless-light-6': {
    symbolKind: 'canless-light-6',
    displayName: '6" Canless Light',
    shortLabel: '6" CL',
    category: 'lighting',
    countValue: 1,
    defaultPhase: 'electrical',
    materialKey: 'canless-light-6',
    laborKey: 'canless-light',
    isElectricalSymbol: true,
  },
  'canless-light-10': {
    symbolKind: 'canless-light-10',
    displayName: '10" Canless Light',
    shortLabel: '10" CL',
    category: 'lighting',
    countValue: 1,
    defaultPhase: 'electrical',
    materialKey: 'canless-light-10',
    laborKey: 'canless-light',
    isElectricalSymbol: true,
  },
  'electrical-switch': {
    symbolKind: 'electrical-switch',
    displayName: 'Switch',
    shortLabel: 'S',
    category: 'switching',
    countValue: 1,
    defaultPhase: 'electrical',
    materialKey: 'switch',
    laborKey: 'switch',
    isElectricalSymbol: true,
  },
  'electrical-switch-3way': {
    symbolKind: 'electrical-switch-3way',
    displayName: '3-Way Switch',
    shortLabel: 'S3',
    category: 'switching',
    countValue: 1,
    defaultPhase: 'electrical',
    materialKey: 'switch-3way',
    laborKey: 'switch-3way',
    isElectricalSymbol: true,
  },
  'electrical-switch-4way': {
    symbolKind: 'electrical-switch-4way',
    displayName: '4-Way Switch',
    shortLabel: 'S4',
    category: 'switching',
    countValue: 1,
    defaultPhase: 'electrical',
    materialKey: 'switch-4way',
    laborKey: 'switch-4way',
    isElectricalSymbol: true,
  },
  'electrical-dimmer': {
    symbolKind: 'electrical-dimmer',
    displayName: 'Dimmer',
    shortLabel: 'DIM',
    category: 'switching',
    countValue: 1,
    defaultPhase: 'electrical',
    materialKey: 'dimmer',
    laborKey: 'dimmer',
    isElectricalSymbol: true,
  },
  'electrical-recessed-light': {
    symbolKind: 'electrical-recessed-light',
    displayName: 'Recessed Light',
    shortLabel: 'RL',
    category: 'lighting',
    countValue: 1,
    defaultPhase: 'electrical',
    materialKey: 'recessed-light',
    laborKey: 'recessed-light',
    isElectricalSymbol: true,
  },
  'electrical-pendant-light': {
    symbolKind: 'electrical-pendant-light',
    displayName: 'Pendant Light',
    shortLabel: 'P',
    category: 'lighting',
    countValue: 1,
    defaultPhase: 'electrical',
    materialKey: 'pendant-light',
    laborKey: 'pendant-light',
    isElectricalSymbol: true,
  },
  'electrical-sconce': {
    symbolKind: 'electrical-sconce',
    displayName: 'Sconce',
    shortLabel: 'SC',
    category: 'lighting',
    countValue: 1,
    defaultPhase: 'electrical',
    materialKey: 'sconce',
    laborKey: 'sconce',
    isElectricalSymbol: true,
  },
  'electrical-emergency-exit-sign': {
    symbolKind: 'electrical-emergency-exit-sign',
    displayName: 'Emergency Exit Sign',
    shortLabel: 'EXIT',
    category: 'lighting',
    countValue: 1,
    defaultPhase: 'electrical',
    materialKey: 'emergency-exit-sign',
    laborKey: 'emergency-exit-sign',
    isElectricalSymbol: true,
  },
  'electrical-led-panel-2x2': {
    symbolKind: 'electrical-led-panel-2x2',
    displayName: '2x2 LED Panel',
    shortLabel: '2x2',
    category: 'lighting',
    countValue: 1,
    defaultPhase: 'electrical',
    materialKey: 'led-panel-2x2',
    laborKey: 'led-panel-2x2',
    isElectricalSymbol: true,
  },
  'electrical-led-panel-2x4': {
    symbolKind: 'electrical-led-panel-2x4',
    displayName: '2x4 LED Panel',
    shortLabel: '2x4',
    category: 'lighting',
    countValue: 1,
    defaultPhase: 'electrical',
    materialKey: 'led-panel-2x4',
    laborKey: 'led-panel-2x4',
    isElectricalSymbol: true,
  },
  'electrical-panel': {
    symbolKind: 'electrical-panel',
    displayName: 'Electrical Panel',
    shortLabel: 'PNL',
    category: 'power',
    countValue: 1,
    defaultPhase: 'electrical',
    materialKey: 'electrical-panel',
    laborKey: 'electrical-panel',
    isElectricalSymbol: true,
  },
  'electrical-gfci': {
    symbolKind: 'electrical-gfci',
    displayName: 'GFCI',
    shortLabel: 'GFCI',
    category: 'power',
    countValue: 1,
    defaultPhase: 'electrical',
    materialKey: 'gfci',
    laborKey: 'gfci',
    isElectricalSymbol: true,
  },
  'electrical-receptacle': {
    symbolKind: 'electrical-receptacle',
    displayName: 'Duplex Receptacle',
    shortLabel: 'REC',
    category: 'power',
    countValue: 1,
    defaultPhase: 'electrical',
    materialKey: 'receptacle',
    laborKey: 'receptacle',
    isElectricalSymbol: true,
  },
  'electrical-gfci-wp': {
    symbolKind: 'electrical-gfci-wp',
    displayName: 'GFCI WP',
    shortLabel: 'GFCI-WP',
    category: 'power',
    countValue: 1,
    defaultPhase: 'electrical',
    materialKey: 'gfci',
    laborKey: 'gfci',
    isElectricalSymbol: true,
  },
  'electrical-receptacle-240v': {
    symbolKind: 'electrical-receptacle-240v',
    displayName: '240V Receptacle',
    shortLabel: '240V',
    category: 'power',
    countValue: 1,
    defaultPhase: 'electrical',
    materialKey: 'receptacle-240v',
    laborKey: 'receptacle-240v',
    isElectricalSymbol: true,
  },
  'electrical-single-receptacle': {
    symbolKind: 'electrical-single-receptacle',
    displayName: 'Single Receptacle',
    shortLabel: 'SR',
    category: 'power',
    countValue: 1,
    defaultPhase: 'electrical',
    materialKey: 'receptacle',
    laborKey: 'receptacle',
    isElectricalSymbol: true,
  },
  'electrical-half-hot-receptacle': {
    symbolKind: 'electrical-half-hot-receptacle',
    displayName: 'Half-Hot Receptacle',
    shortLabel: 'HH',
    category: 'power',
    countValue: 1,
    defaultPhase: 'electrical',
    materialKey: 'receptacle',
    laborKey: 'receptacle',
    isElectricalSymbol: true,
  },
  'electrical-timer-control': {
    symbolKind: 'electrical-timer-control',
    displayName: 'Timer Control Box',
    shortLabel: 'TMR',
    category: 'control',
    countValue: 1,
    defaultPhase: 'electrical',
    materialKey: 'timer-control',
    laborKey: 'timer-control',
    isElectricalSymbol: true,
  },
  'electrical-photocell': {
    symbolKind: 'electrical-photocell',
    displayName: 'Photocell',
    shortLabel: 'PC',
    category: 'control',
    countValue: 1,
    defaultPhase: 'electrical',
    materialKey: 'photocell',
    laborKey: 'photocell',
    isElectricalSymbol: true,
  },
  'electrical-ceiling-occupancy-sensor': {
    symbolKind: 'electrical-ceiling-occupancy-sensor',
    displayName: 'Ceiling Occupancy Sensor',
    shortLabel: 'OS-C',
    category: 'control',
    countValue: 1,
    defaultPhase: 'electrical',
    materialKey: 'switch',
    laborKey: 'switch',
    isElectricalSymbol: true,
  },
  'electrical-wall-occupancy-sensor': {
    symbolKind: 'electrical-wall-occupancy-sensor',
    displayName: 'Wall Occupancy Sensor',
    shortLabel: 'OS-W',
    category: 'control',
    countValue: 1,
    defaultPhase: 'electrical',
    materialKey: 'switch',
    laborKey: 'switch',
    isElectricalSymbol: true,
  },
  'electrical-smoke-alarm': {
    symbolKind: 'electrical-smoke-alarm',
    displayName: 'Smoke Alarm',
    shortLabel: 'SA',
    category: 'control',
    countValue: 1,
    defaultPhase: 'electrical',
    materialKey: 'smoke-alarm',
    laborKey: 'smoke-alarm',
    isElectricalSymbol: true,
  },
  'electrical-co-alarm': {
    symbolKind: 'electrical-co-alarm',
    displayName: 'CO Alarm',
    shortLabel: 'CO',
    category: 'control',
    countValue: 1,
    defaultPhase: 'electrical',
    materialKey: 'co-alarm',
    laborKey: 'co-alarm',
    isElectricalSymbol: true,
  },
  'electrical-hdmi': {
    symbolKind: 'electrical-hdmi',
    displayName: 'HDMI',
    shortLabel: 'HDMI',
    category: 'power',
    countValue: 1,
    defaultPhase: 'low-voltage',
    materialKey: 'hdmi',
    laborKey: 'hdmi',
    isElectricalSymbol: true,
  },
  'electrical-data': {
    symbolKind: 'electrical-data',
    displayName: 'Data',
    shortLabel: 'DATA',
    category: 'power',
    countValue: 1,
    defaultPhase: 'low-voltage',
    materialKey: 'data',
    laborKey: 'data',
    isElectricalSymbol: true,
  },
}

export const ELECTRICAL_SYMBOL_OPTIONS: Array<{ label: string; value: ElectricalSymbolKind; shortLabel: string }> =
  Object.values(ELECTRICAL_SYMBOL_METADATA).map((symbol) => ({
    label: symbol.displayName,
    value: symbol.symbolKind,
    shortLabel: symbol.shortLabel,
  }))

export const ELECTRICAL_SYMBOL_KIND_ORDER = new Map<ElectricalSymbolKind, number>(
  ELECTRICAL_SYMBOL_OPTIONS.map((option, index) => [option.value, index]),
)

export const ELECTRICAL_SYMBOL_CATEGORY_ORDER: ElectricalSymbolCategory[] = Array.from(
  new Set(ELECTRICAL_SYMBOL_OPTIONS.map((option) => ELECTRICAL_SYMBOL_METADATA[option.value].category)),
)

export function isElectricalShapeKind(shapeKind: unknown): shapeKind is ElectricalSymbolKind {
  return typeof shapeKind === 'string' && shapeKind in ELECTRICAL_SYMBOL_METADATA
}

export function isCanLightShapeKind(shapeKind: unknown): shapeKind is 'can-light-2' | 'can-light-4' | 'can-light-6' {
  return shapeKind === 'can-light-2' || shapeKind === 'can-light-4' || shapeKind === 'can-light-6'
}

export function getElectricalSymbolMetadata(shapeKind: unknown): ElectricalSymbolMetadata | null {
  return isElectricalShapeKind(shapeKind) ? ELECTRICAL_SYMBOL_METADATA[shapeKind] : null
}

export function getElectricalSymbolDisplayName(shapeKind: unknown, meta: Record<string, any> = {}) {
  const symbol = getElectricalSymbolMetadata(shapeKind)
  if (!symbol) return null
  return shapeKind === 'electrical-recessed-light' && meta.emergency
    ? `${symbol.displayName} · EM`
    : symbol.displayName
}

export function getElectricalSymbolCountValue(shapeKind: unknown) {
  return getElectricalSymbolMetadata(shapeKind)?.countValue ?? 0
}

export function getElectricalSymbolMetadataStamp(shapeKind: unknown) {
  const symbol = getElectricalSymbolMetadata(shapeKind)
  if (!symbol) return {}
  return {
    symbolCategory: symbol.category,
    countValue: symbol.countValue,
    materialKey: symbol.materialKey,
    laborKey: symbol.laborKey,
  }
}

export function formatElectricalSymbolCategory(category: ElectricalSymbolCategory) {
  return category.charAt(0).toUpperCase() + category.slice(1)
}

const LIGHT_OUTPUT_SHAPE_KINDS = new Set<ElectricalSymbolKind>([
  'can-light-2',
  'canless-light-2',
  'can-light-4',
  'canless-light-4',
  'can-light-6',
  'canless-light-6',
  'canless-light-10',
  'electrical-recessed-light',
  'electrical-pendant-light',
  'electrical-sconce',
  'electrical-emergency-exit-sign',
  'electrical-led-panel-2x2',
  'electrical-led-panel-2x4',
])

export function isLightOutputShapeKind(shapeKind: unknown): shapeKind is ElectricalSymbolKind {
  return isElectricalShapeKind(shapeKind) && LIGHT_OUTPUT_SHAPE_KINDS.has(shapeKind)
}

const ROTATABLE_ELECTRICAL_SHAPE_KINDS = new Set<ElectricalSymbolKind>([
  'electrical-receptacle',
  'electrical-gfci-wp',
  'electrical-receptacle-240v',
  'electrical-single-receptacle',
  'electrical-half-hot-receptacle',
  'electrical-switch',
  'electrical-switch-3way',
  'electrical-switch-4way',
  'electrical-dimmer',
  'electrical-sconce',
  'electrical-emergency-exit-sign',
  'electrical-gfci',
  'electrical-photocell',
  'electrical-timer-control',
  'electrical-wall-occupancy-sensor',
])

export function isRotatableElectricalShapeKind(shapeKind: unknown): shapeKind is ElectricalSymbolKind {
  return isElectricalShapeKind(shapeKind) && ROTATABLE_ELECTRICAL_SHAPE_KINDS.has(shapeKind)
}

const ELECTRICAL_SYMBOL_VISUAL_BOUNDS: Partial<Record<ElectricalSymbolKind, { x: number; y: number; w: number; h: number }>> = {
  'electrical-switch': { x: 30, y: 15, w: 40, h: 68 },
  'electrical-switch-3way': { x: 30, y: 15, w: 40, h: 68 },
  'electrical-switch-4way': { x: 30, y: 15, w: 40, h: 68 },
  'electrical-dimmer': { x: 13, y: 15, w: 74, h: 64 },
  'electrical-receptacle': { x: 25, y: 9, w: 50, h: 74 },
  'electrical-gfci-wp': { x: 22, y: 7, w: 56, h: 78 },
  'electrical-receptacle-240v': { x: 25, y: 9, w: 50, h: 74 },
  'electrical-single-receptacle': { x: 25, y: 16, w: 50, h: 58 },
  'electrical-half-hot-receptacle': { x: 25, y: 9, w: 50, h: 74 },
  'electrical-panel': { x: 8, y: 7, w: 84, h: 86 },
  'electrical-gfci': { x: 25, y: 9, w: 50, h: 74 },
  'electrical-sconce': { x: 15, y: 15, w: 47, h: 68 },
  'electrical-emergency-exit-sign': { x: 12, y: 28, w: 76, h: 38 },
  'electrical-photocell': { x: 14, y: 11, w: 78, h: 68 },
  'electrical-timer-control': { x: 13, y: 13, w: 68, h: 64 },
  'electrical-ceiling-occupancy-sensor': { x: 20, y: 17, w: 56, h: 56 },
  'electrical-wall-occupancy-sensor': { x: 26, y: 15, w: 44, h: 60 },
}

export function getElectricalSymbolVisualBounds(kind: unknown) {
  return isElectricalShapeKind(kind) ? ELECTRICAL_SYMBOL_VISUAL_BOUNDS[kind] ?? null : null
}

export type ElectricalSymbolRenderStyle = {
  borderColor: string
  borderThickness: number
  borderStyle: 'solid' | 'dashed' | 'dotted'
  fillColor: string
  fillOpacity: number
  labelsVisible: boolean
  labelScale?: number
  labelCustomColorsEnabled?: boolean
  labelTextColor?: string
  labelBorderColor?: string
  labelFillColor?: string
}

export function renderElectricalSymbolSvg(kind: unknown, meta: Record<string, any>, style: ElectricalSymbolRenderStyle, rotationDeg: number = 0, showCompactSelectionBox: boolean = false) {
  if (!isElectricalShapeKind(kind)) return null
  const { borderColor, borderThickness, borderStyle, fillColor, fillOpacity, labelsVisible } = style
  const labelScale = Number.isFinite(style.labelScale) ? Math.max(0.5, Math.min(5, style.labelScale as number)) : 1
  const labelColorsEnabled = !!style.labelCustomColorsEnabled
  const customLabelTextColor = style.labelTextColor
  const customLabelBorderColor = style.labelBorderColor
  const customLabelFillColor = style.labelFillColor
  const dash = borderStyle === 'dashed' ? '8 5' : borderStyle === 'dotted' ? '2 5' : undefined
  const symbolFill = fillColor === 'transparent' ? 'none' : fillColor
  const textFill = borderColor
  const commonText = {
    textAnchor: 'middle' as const,
    dominantBaseline: 'middle' as const,
    fontFamily: 'monospace',
    fontWeight: 800,
    fill: textFill,
  }
  const fineStroke = Math.max(1.4, borderThickness * 0.7)
  const symbolStroke = Math.max(2, borderThickness)
  const externalLabel = (label: string) => {
    if (!labelsVisible) return null
    const labelWidth = Math.max(22, label.length * 7 + 8) * labelScale
    const labelHeight = 16 * labelScale
    const labelX = 96 - labelWidth
    const labelTop = 78
    const labelTextFill = labelColorsEnabled && customLabelTextColor ? customLabelTextColor : textFill
    const labelBorder = labelColorsEnabled && customLabelBorderColor ? customLabelBorderColor : borderColor
    const labelFill = labelColorsEnabled && customLabelFillColor ? customLabelFillColor : '#0b1020'
    return (
      <g>
        <rect x={labelX} y={labelTop} width={labelWidth} height={labelHeight} rx={4 * labelScale} fill={labelFill} fillOpacity="0.82" stroke={labelBorder} strokeWidth="1.2" opacity="0.95" />
        <text x={labelX + labelWidth / 2} y={labelTop + labelHeight / 2} fontSize={9.5 * labelScale} {...commonText} fill={labelTextFill}>{label}</text>
      </g>
    )
  }
  const badge = kind === 'electrical-recessed-light' && meta.emergency ? externalLabel('EM') : null

  let body: React.ReactNode = null
  let label: React.ReactNode = null
  const switchBody = (
    <>
      <text x="50" y="52" fontSize="52" {...commonText}>S</text>
      <line x1="50" y1="20" x2="50" y2="78" stroke={borderColor} strokeWidth={symbolStroke} strokeLinecap="round" strokeDasharray={dash} />
    </>
  )

  if (kind === 'can-light-2' || kind === 'can-light-4' || kind === 'can-light-6') {
    const aperture = kind === 'can-light-2' ? 7 : kind === 'can-light-4' ? 10 : 13
    const labelText = getElectricalSymbolMetadata(kind)?.shortLabel ?? ''
    body = (
      <>
        <circle cx="50" cy="50" r="24" fill="none" stroke={borderColor} strokeWidth={Math.max(0.8, borderThickness * 0.65)} strokeDasharray={dash} />
        <line x1="31" y1="50" x2="69" y2="50" stroke={borderColor} strokeWidth={Math.max(1, borderThickness * 0.45)} opacity="0.55" />
        <line x1="50" y1="31" x2="50" y2="69" stroke={borderColor} strokeWidth={Math.max(1, borderThickness * 0.45)} opacity="0.55" />
        <circle cx="50" cy="50" r={aperture} fill={symbolFill} stroke={borderColor} strokeWidth={fineStroke} />
        <text x="50" y="87" fontSize="14" {...commonText}>{labelText}</text>
      </>
    )
  } else if (kind === 'canless-light-2' || kind === 'canless-light-4' || kind === 'canless-light-6' || kind === 'canless-light-10') {
    const metaLabel = getElectricalSymbolMetadata(kind)?.shortLabel ?? ''
    const size = kind === 'canless-light-10' ? 10 : kind === 'canless-light-6' ? 6 : kind === 'canless-light-4' ? 4 : 2
    const innerRadius = size === 10 ? 17 : size === 6 ? 14 : size === 4 ? 11 : 8
    body = (
      <>
        <circle cx="50" cy="50" r="24" fill={symbolFill} fillOpacity="0.16" stroke={borderColor} strokeWidth={Math.max(1.1, borderThickness * 0.8)} strokeDasharray={dash} />
        <circle cx="50" cy="50" r="19" fill="none" stroke={borderColor} strokeWidth={Math.max(1, borderThickness * 0.42)} opacity="0.45" />
        <path d="M32 39 Q50 29 68 39 M32 61 Q50 71 68 61" fill="none" stroke={borderColor} strokeWidth={Math.max(1, borderThickness * 0.45)} opacity="0.7" strokeLinecap="round" />
        <circle cx="50" cy="50" r={innerRadius} fill="none" stroke={borderColor} strokeWidth={fineStroke} opacity="0.9" />
        <circle cx="50" cy="50" r="3" fill={borderColor} opacity="0.8" />
        <text x="50" y="87" fontSize="12" {...commonText}>{metaLabel}</text>
      </>
    )
  } else if (kind === 'electrical-switch') {
    body = switchBody
  } else if (kind === 'electrical-switch-3way') {
    body = switchBody
    label = externalLabel('S3')
  } else if (kind === 'electrical-switch-4way') {
    body = switchBody
    label = externalLabel('S4')
  } else if (kind === 'electrical-dimmer') {
    const dimmerLabel = getElectricalSymbolMetadata(kind)?.shortLabel ?? 'DIM'
    body = (
      <>
        <text x="46" y="50" fontSize="48" {...commonText}>S</text>
        <line x1="46" y1="20" x2="46" y2="74" stroke={borderColor} strokeWidth={symbolStroke} strokeLinecap="round" strokeDasharray={dash} />
        <path d="M72 28 L84 28 M74 37 L84 37 M76 46 L84 46" fill="none" stroke={borderColor} strokeWidth={fineStroke} strokeLinecap="round" opacity="0.75" />
      </>
    )
    label = externalLabel(dimmerLabel)
  } else if (kind === 'electrical-recessed-light') {
    body = (
      <>
        <circle cx="48" cy="45" r="34" fill={symbolFill} stroke={borderColor} strokeWidth={borderThickness} strokeDasharray={dash} />
        <circle cx="48" cy="45" r="17" fill="none" stroke={borderColor} strokeWidth={fineStroke} />
        <line x1="18" y1="45" x2="78" y2="45" stroke={borderColor} strokeWidth={Math.max(1, borderThickness * 0.5)} opacity="0.65" />
        <line x1="48" y1="15" x2="48" y2="75" stroke={borderColor} strokeWidth={Math.max(1, borderThickness * 0.5)} opacity="0.65" />
      </>
    )
    label = badge
  } else if (kind === 'electrical-pendant-light') {
    body = (
      <>
        <circle cx="50" cy="16" r="6" fill={symbolFill} stroke={borderColor} strokeWidth={fineStroke} />
        <line x1="50" y1="22" x2="50" y2="52" stroke={borderColor} strokeWidth={symbolStroke} strokeLinecap="round" />
        <path d="M30 54 Q50 72 70 54" fill={symbolFill} stroke={borderColor} strokeWidth={borderThickness} strokeDasharray={dash} strokeLinecap="round" />
        <circle cx="50" cy="62" r="13" fill="none" stroke={borderColor} strokeWidth={fineStroke} />
      </>
    )
  } else if (kind === 'electrical-sconce') {
    body = (
      <>
        <line x1="24" y1="20" x2="24" y2="78" stroke={borderColor} strokeWidth={symbolStroke} strokeLinecap="round" />
        <path d="M26 30 A24 20 0 0 1 26 70" fill="none" stroke={borderColor} strokeWidth={borderThickness} strokeDasharray={dash} strokeLinecap="round" />
        <path d="M26 38 L58 28 M26 62 L58 72" fill="none" stroke={borderColor} strokeWidth={fineStroke} strokeLinecap="round" opacity="0.7" />
        <circle cx="42" cy="50" r="7" fill={symbolFill} stroke={borderColor} strokeWidth={fineStroke} />
      </>
    )
  } else if (kind === 'electrical-emergency-exit-sign') {
    body = (
      <>
        <rect x="12" y="28" width="76" height="38" rx="3" fill={symbolFill} stroke={borderColor} strokeWidth={borderThickness} strokeDasharray={dash} />
        <text x="50" y="48" fontSize="20" letterSpacing="0" {...commonText}>EXIT</text>
      </>
    )
  } else if (kind === 'electrical-led-panel-2x2' || kind === 'electrical-led-panel-2x4') {
    const isLong = kind === 'electrical-led-panel-2x4'
    const panelLabel = getElectricalSymbolMetadata(kind)?.shortLabel ?? (isLong ? '2x4' : '2x2')
    body = (
      <>
        <rect x={isLong ? 10 : 18} y={isLong ? 22 : 14} width={isLong ? 78 : 58} height={isLong ? 40 : 58} rx="3" fill={symbolFill} stroke={borderColor} strokeWidth={borderThickness} strokeDasharray={dash} />
        <line x1={isLong ? 49 : 18} y1={isLong ? 22 : 43} x2={isLong ? 49 : 76} y2={isLong ? 62 : 43} stroke={borderColor} strokeWidth={fineStroke} opacity="0.65" />
        <line x1={isLong ? 10 : 47} y1={isLong ? 42 : 14} x2={isLong ? 88 : 47} y2={isLong ? 42 : 72} stroke={borderColor} strokeWidth={fineStroke} opacity="0.65" />
        <line x1={isLong ? 14 : 24} y1={isLong ? 26 : 20} x2={isLong ? 84 : 70} y2={isLong ? 58 : 66} stroke={borderColor} strokeWidth={Math.max(1, fineStroke * 0.8)} opacity="0.35" />
        <line x1={isLong ? 84 : 70} y1={isLong ? 26 : 20} x2={isLong ? 14 : 24} y2={isLong ? 58 : 66} stroke={borderColor} strokeWidth={Math.max(1, fineStroke * 0.8)} opacity="0.35" />
      </>
    )
    label = externalLabel(panelLabel)
  } else if (kind === 'electrical-panel') {
    body = (
      <>
        <rect x="8" y="7" width="84" height="86" rx="5" fill={symbolFill} stroke={borderColor} strokeWidth={borderThickness} strokeDasharray={dash} />
        <rect x="18" y="18" width="64" height="64" rx="3" fill="none" stroke={borderColor} strokeWidth={fineStroke} opacity="0.72" />
        <line x1="28" y1="30" x2="72" y2="30" stroke={borderColor} strokeWidth={Math.max(1, fineStroke * 0.8)} strokeLinecap="round" opacity="0.55" />
        <line x1="28" y1="70" x2="72" y2="70" stroke={borderColor} strokeWidth={Math.max(1, fineStroke * 0.8)} strokeLinecap="round" opacity="0.55" />
        <text x="50" y="52" fontSize="20" letterSpacing="0" {...commonText}>PNL</text>
      </>
    )
  } else if (kind === 'electrical-gfci' || kind === 'electrical-gfci-wp' || kind === 'electrical-receptacle') {
    const symbolLabel = getElectricalSymbolMetadata(kind)?.shortLabel ?? (kind === 'electrical-gfci' ? 'GFCI' : 'REC')
    const isWeatherproof = kind === 'electrical-gfci-wp'
    body = (
      <>
        {isWeatherproof && (
          <>
            <rect x="22" y="14" width="56" height="66" rx="7" fill="none" stroke={borderColor} strokeWidth={fineStroke} strokeDasharray={dash} opacity="0.85" />
            <path d="M28 20 L72 20 M28 74 L72 74" fill="none" stroke={borderColor} strokeWidth={Math.max(1, fineStroke * 0.75)} strokeLinecap="round" opacity="0.7" />
          </>
        )}
        <path d="M30 24 Q50 12 70 24 L70 66 Q50 78 30 66 Z" fill={symbolFill} stroke={borderColor} strokeWidth={borderThickness} strokeDasharray={dash} />
        <circle cx="50" cy="35" r="9" fill="none" stroke={borderColor} strokeWidth={fineStroke} />
        <circle cx="50" cy="58" r="9" fill="none" stroke={borderColor} strokeWidth={fineStroke} />
        <line x1="45" y1="35" x2="55" y2="35" stroke={borderColor} strokeWidth={fineStroke} />
        <line x1="45" y1="58" x2="55" y2="58" stroke={borderColor} strokeWidth={fineStroke} />
        {(kind === 'electrical-gfci' || isWeatherproof) && <line x1="39" y1="47" x2="61" y2="47" stroke={borderColor} strokeWidth={fineStroke} opacity="0.75" />}
        {isWeatherproof && <text x="50" y="20" fontSize="8" {...commonText}>WP</text>}
      </>
    )
    label = externalLabel(symbolLabel)
  } else if (kind === 'electrical-receptacle-240v') {
    const v240Label = getElectricalSymbolMetadata(kind)?.shortLabel ?? '240V'
    const heavyStroke = Math.max(3, borderThickness * 1.4)
    body = (
      <>
        <path d="M28 22 Q50 10 72 22 L72 68 Q50 80 28 68 Z" fill={symbolFill} stroke={borderColor} strokeWidth={heavyStroke} strokeDasharray={dash} />
        <line x1="38" y1="30" x2="48" y2="42" stroke={borderColor} strokeWidth={symbolStroke} strokeLinecap="round" />
        <line x1="62" y1="30" x2="52" y2="42" stroke={borderColor} strokeWidth={symbolStroke} strokeLinecap="round" />
        <circle cx="50" cy="58" r="7" fill="none" stroke={borderColor} strokeWidth={fineStroke} />
      </>
    )
    label = externalLabel(v240Label)
  } else if (kind === 'electrical-single-receptacle') {
    const singleLabel = getElectricalSymbolMetadata(kind)?.shortLabel ?? 'SR'
    body = (
      <>
        <path d="M30 26 Q50 14 70 26 L70 62 Q50 74 30 62 Z" fill={symbolFill} stroke={borderColor} strokeWidth={borderThickness} strokeDasharray={dash} />
        <line x1="43" y1="42" x2="43" y2="54" stroke={borderColor} strokeWidth={fineStroke} strokeLinecap="round" />
        <line x1="57" y1="42" x2="57" y2="54" stroke={borderColor} strokeWidth={fineStroke} strokeLinecap="round" />
        <circle cx="50" cy="60" r="4" fill="none" stroke={borderColor} strokeWidth={Math.max(1, fineStroke * 0.9)} />
      </>
    )
    label = externalLabel(singleLabel)
  } else if (kind === 'electrical-half-hot-receptacle') {
    const halfHotLabel = getElectricalSymbolMetadata(kind)?.shortLabel ?? 'HH'
    const switchedFill = symbolFill === 'none' ? borderColor : symbolFill
    body = (
      <>
        <path d="M30 24 Q50 12 70 24 L70 66 Q50 78 30 66 Z" fill={symbolFill} stroke={borderColor} strokeWidth={borderThickness} strokeDasharray={dash} />
        <path d="M31 25 Q50 14 69 25 L69 46 L31 46 Z" fill={switchedFill} fillOpacity={symbolFill === 'none' ? 0.14 : Math.max(0.18, Math.min(0.5, fillOpacity))} stroke="none" />
        <circle cx="50" cy="35" r="9" fill="none" stroke={borderColor} strokeWidth={fineStroke} />
        <circle cx="50" cy="58" r="9" fill="none" stroke={borderColor} strokeWidth={fineStroke} />
        <line x1="45" y1="35" x2="55" y2="35" stroke={borderColor} strokeWidth={fineStroke} />
        <line x1="45" y1="58" x2="55" y2="58" stroke={borderColor} strokeWidth={fineStroke} />
        <path d="M38 26 L62 44 M45 25 L66 41" fill="none" stroke={borderColor} strokeWidth={Math.max(1, fineStroke * 0.85)} strokeLinecap="round" opacity="0.85" />
        <line x1="34" y1="47" x2="66" y2="47" stroke={borderColor} strokeWidth={Math.max(1, fineStroke * 0.75)} opacity="0.65" />
      </>
    )
    label = externalLabel(halfHotLabel)
  } else if (kind === 'electrical-timer-control') {
    const timerLabel = getElectricalSymbolMetadata(kind)?.shortLabel ?? 'TMR'
    body = (
      <>
        <rect x="18" y="18" width="58" height="54" rx="5" fill={symbolFill} stroke={borderColor} strokeWidth={borderThickness} strokeDasharray={dash} />
        <circle cx="47" cy="43" r="15" fill="none" stroke={borderColor} strokeWidth={fineStroke} />
        <line x1="47" y1="43" x2="47" y2="33" stroke={borderColor} strokeWidth={fineStroke} strokeLinecap="round" />
        <line x1="47" y1="43" x2="57" y2="49" stroke={borderColor} strokeWidth={fineStroke} strokeLinecap="round" />
        <circle cx="27" cy="27" r="2.5" fill={borderColor} />
        <circle cx="67" cy="27" r="2.5" fill={borderColor} />
      </>
    )
    label = externalLabel(timerLabel)
  } else if (kind === 'electrical-photocell') {
    const photocellLabel = getElectricalSymbolMetadata(kind)?.shortLabel ?? 'PC'
    body = (
      <>
        <circle cx="46" cy="45" r="27" fill={symbolFill} stroke={borderColor} strokeWidth={borderThickness} strokeDasharray={dash} />
        <path d="M25 45 Q46 26 67 45 Q46 64 25 45 Z" fill="none" stroke={borderColor} strokeWidth={fineStroke} />
        <circle cx="46" cy="45" r="6" fill={borderColor} />
        <path d="M72 23 L80 15 M76 44 L88 44 M72 65 L80 73" fill="none" stroke={borderColor} strokeWidth={fineStroke} strokeLinecap="round" opacity="0.75" />
      </>
    )
    label = externalLabel(photocellLabel)
  } else if (kind === 'electrical-ceiling-occupancy-sensor') {
    const sensorLabel = getElectricalSymbolMetadata(kind)?.shortLabel ?? 'OS-C'
    body = (
      <>
        <circle cx="48" cy="45" r="28" fill={symbolFill} stroke={borderColor} strokeWidth={borderThickness} strokeDasharray={dash} />
        <path d="M48 26 A19 19 0 0 1 64.5 35.5 M64.5 54.5 A19 19 0 0 1 48 64 M31.5 54.5 A19 19 0 0 1 31.5 35.5" fill="none" stroke={borderColor} strokeWidth={fineStroke} strokeLinecap="round" opacity="0.78" />
        <circle cx="48" cy="45" r="7" fill={borderColor} />
        <circle cx="48" cy="45" r="3" fill={symbolFill} />
      </>
    )
    label = externalLabel(sensorLabel)
  } else if (kind === 'electrical-wall-occupancy-sensor') {
    const sensorLabel = getElectricalSymbolMetadata(kind)?.shortLabel ?? 'OS-W'
    body = (
      <>
        <rect x="26" y="15" width="44" height="60" rx="5" fill={symbolFill} stroke={borderColor} strokeWidth={borderThickness} strokeDasharray={dash} />
        <path d="M34 34 Q48 23 62 34 Q48 45 34 34 Z" fill="none" stroke={borderColor} strokeWidth={fineStroke} strokeLinejoin="round" />
        <circle cx="48" cy="34" r="4" fill={borderColor} />
        <path d="M39 52 Q48 59 57 52 M35 57 Q48 68 61 57" fill="none" stroke={borderColor} strokeWidth={fineStroke} strokeLinecap="round" opacity="0.78" />
      </>
    )
    label = externalLabel(sensorLabel)
  } else if (kind === 'electrical-smoke-alarm') {
    const smokeLabel = getElectricalSymbolMetadata(kind)?.shortLabel ?? 'SA'
    body = (
      <>
        <circle cx="48" cy="45" r="30" fill={symbolFill} stroke={borderColor} strokeWidth={borderThickness} strokeDasharray={dash} />
        <circle cx="48" cy="45" r="21" fill="none" stroke={borderColor} strokeWidth={fineStroke} opacity="0.5" />
        <path d="M35 53 q6.5 -7 13 0 t13 0" fill="none" stroke={borderColor} strokeWidth={fineStroke} strokeLinecap="round" />
        <path d="M35 45 q6.5 -7 13 0 t13 0" fill="none" stroke={borderColor} strokeWidth={fineStroke} strokeLinecap="round" />
        <path d="M35 37 q6.5 -7 13 0 t13 0" fill="none" stroke={borderColor} strokeWidth={fineStroke} strokeLinecap="round" opacity="0.8" />
      </>
    )
    label = externalLabel(smokeLabel)
  } else if (kind === 'electrical-co-alarm') {
    const coLabel = getElectricalSymbolMetadata(kind)?.shortLabel ?? 'CO'
    body = (
      <>
        <circle cx="48" cy="45" r="30" fill={symbolFill} stroke={borderColor} strokeWidth={borderThickness} strokeDasharray={dash} />
        <circle cx="48" cy="45" r="18" fill="none" stroke={borderColor} strokeWidth={fineStroke} />
        <path d="M40 38 L56 38 M38 45 L58 45 M40 52 L56 52" fill="none" stroke={borderColor} strokeWidth={fineStroke} strokeLinecap="round" opacity="0.7" />
      </>
    )
    label = externalLabel(coLabel)
  } else if (kind === 'electrical-hdmi') {
    const hdmiLabel = getElectricalSymbolMetadata(kind)?.shortLabel ?? 'HDMI'
    body = (
      <>
        <rect x="22" y="26" width="52" height="38" rx="4" fill={symbolFill} stroke={borderColor} strokeWidth={borderThickness} strokeDasharray={dash} />
        <path d="M34 40 L62 40 L58 52 L38 52 Z" fill="none" stroke={borderColor} strokeWidth={fineStroke} strokeLinejoin="round" />
        <path d="M40 44 L56 44" stroke={borderColor} strokeWidth={Math.max(1, fineStroke * 0.8)} strokeLinecap="round" opacity="0.7" />
      </>
    )
    label = externalLabel(hdmiLabel)
  } else if (kind === 'electrical-data') {
    const dataLabel = getElectricalSymbolMetadata(kind)?.shortLabel ?? 'DATA'
    body = (
      <>
        <rect x="24" y="26" width="48" height="40" rx="4" fill={symbolFill} stroke={borderColor} strokeWidth={borderThickness} strokeDasharray={dash} />
        <path d="M36 38 L60 38 L60 52 L54 52 L54 57 L42 57 L42 52 L36 52 Z" fill="none" stroke={borderColor} strokeWidth={fineStroke} strokeLinejoin="round" />
        <path d="M41 42 L41 48 M48 42 L48 48 M55 42 L55 48" stroke={borderColor} strokeWidth={Math.max(1, fineStroke * 0.75)} strokeLinecap="round" opacity="0.65" />
      </>
    )
    label = externalLabel(dataLabel)
  }

  if (!body) return null
  const visualBounds = showCompactSelectionBox ? getElectricalSymbolVisualBounds(kind) : null
  const compactSelectionBox = visualBounds ? (
    <rect x={visualBounds.x} y={visualBounds.y} width={visualBounds.w} height={visualBounds.h} rx="4" fill="none" stroke="#ffffff" strokeWidth="2" strokeOpacity="0.85" vectorEffect="non-scaling-stroke" />
  ) : null
  const bodyWithSelectionBox = compactSelectionBox ? <>{body}{compactSelectionBox}</> : body
  const rotatedBody = rotationDeg ? <g transform={`rotate(${rotationDeg} 50 50)`}>{bodyWithSelectionBox}</g> : bodyWithSelectionBox
  return (
    <>
      {rotatedBody}
      {label}
    </>
  )
}
