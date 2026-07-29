export type BlueprintSnapshotCanvasLabelKind = 'symbol' | 'measurement' | 'circuit' | 'unknown-electrical'

export type BlueprintSnapshotCanvasLabelStyle = {
  kind: BlueprintSnapshotCanvasLabelKind
  fontFamily: string
  fontSize: number
  fontWeight: number
  textColor: string
  backgroundColor: string
  backgroundOpacity: number
  borderColor: string
  borderOpacity: number
  borderWidth: number
  borderRadius: number
  minWidth: number
  height: number
  paddingX: number
}

const LIVE_SYMBOL_LABEL_SCALE_MIN = 0.5
const LIVE_SYMBOL_LABEL_SCALE_MAX = 5

export function resolveBlueprintSnapshotSymbolLabelScale(value: unknown): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 1
  return Math.max(LIVE_SYMBOL_LABEL_SCALE_MIN, Math.min(LIVE_SYMBOL_LABEL_SCALE_MAX, numeric))
}

export function resolveBlueprintSnapshotCanvasLabelStyle(input: {
  kind: BlueprintSnapshotCanvasLabelKind
  textColor: string
  borderColor?: string
  fillColor?: string
  labelScale?: unknown
}): BlueprintSnapshotCanvasLabelStyle {
  if (input.kind === 'symbol') {
    const labelScale = resolveBlueprintSnapshotSymbolLabelScale(input.labelScale)
    return {
      kind: input.kind,
      fontFamily: 'monospace',
      fontSize: 9.5 * labelScale,
      fontWeight: 800,
      textColor: input.textColor,
      backgroundColor: input.fillColor || '#0b1020',
      backgroundOpacity: 0.82,
      borderColor: input.borderColor || input.textColor,
      borderOpacity: 0.95,
      borderWidth: 1.2,
      borderRadius: 4 * labelScale,
      minWidth: 22 * labelScale,
      height: 16 * labelScale,
      paddingX: 4 * labelScale,
    }
  }

  if (input.kind === 'circuit') {
    return {
      kind: input.kind,
      fontFamily: 'monospace',
      fontSize: 10,
      fontWeight: 400,
      textColor: input.textColor,
      backgroundColor: '#0a0d16',
      backgroundOpacity: 0.9,
      borderColor: input.borderColor || input.textColor,
      borderOpacity: 0,
      borderWidth: 0,
      borderRadius: 3,
      minWidth: 0,
      height: 16,
      paddingX: 6,
    }
  }

  if (input.kind === 'measurement') {
    return {
      kind: input.kind,
      fontFamily: 'monospace',
      fontSize: 11,
      fontWeight: 400,
      textColor: input.textColor,
      backgroundColor: '#0a0d16',
      backgroundOpacity: 0.88,
      borderColor: input.borderColor || input.textColor,
      borderOpacity: 0,
      borderWidth: 0,
      borderRadius: 3,
      minWidth: 0,
      height: 16,
      paddingX: 5,
    }
  }

  return {
    kind: input.kind,
    fontFamily: 'monospace',
    fontSize: 9,
    fontWeight: 700,
    textColor: input.textColor,
    backgroundColor: '#ffffff',
    backgroundOpacity: 0.76,
    borderColor: input.borderColor || input.textColor,
    borderOpacity: 0.72,
    borderWidth: 0.8,
    borderRadius: 3,
    minWidth: 0,
    height: 14,
    paddingX: 4,
  }
}

export function resolveBlueprintSnapshotSymbolLabelBox(input: {
  textWidth: number
  labelScale?: unknown
  symbolUnit?: number
}): { width: number; height: number; x: number; y: number; radius: number } {
  const symbolUnit = Number.isFinite(Number(input.symbolUnit)) && Number(input.symbolUnit) > 0 ? Number(input.symbolUnit) : 1
  const labelScale = resolveBlueprintSnapshotSymbolLabelScale(input.labelScale)
  const textWidthInSymbolSpace = Number(input.textWidth) / symbolUnit
  const width = Math.max(22 * labelScale, textWidthInSymbolSpace + 8 * labelScale)
  const height = 16 * labelScale
  return {
    width,
    height,
    x: 96 - width,
    y: 78,
    radius: 4 * labelScale,
  }
}
