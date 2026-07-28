export type LedStripLightColorMode = 'kelvin' | 'rgb-flow'

export interface LedStripAppearanceMetrics {
  colorMode: LedStripLightColorMode
  normalizedOutput: number
  kelvinColor: string
  outerStrokeWidth: number
  outerOpacity: number
  middleStrokeWidth: number
  middleOpacity: number
  coreStrokeWidth: number
  coreOpacity: number
  diodeOpacity: number
  animationEnabled: boolean
  animationDuration: string
}

export const LED_STRIP_RGB_FLOW_DURATION = '7s'

const LIGHT_OUTPUT_MIN = 0.25
const LIGHT_OUTPUT_BASE = 1
const LIGHT_OUTPUT_MAX = 20

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min))
}

function normalizeLightOutput(lightIntensity: unknown): number {
  const clamped = clamp(Number(lightIntensity ?? LIGHT_OUTPUT_BASE), LIGHT_OUTPUT_MIN, LIGHT_OUTPUT_MAX)
  return (clamped - LIGHT_OUTPUT_MIN) / (LIGHT_OUTPUT_MAX - LIGHT_OUTPUT_MIN)
}

function easeOutput(value: number): number {
  return Math.pow(clamp(value, 0, 1), 0.42)
}

export function resolveLedStripLightColorMode(value: unknown): LedStripLightColorMode {
  return value === 'rgb-flow' ? 'rgb-flow' : 'kelvin'
}

export function getLedStripAppearanceMetrics(options: {
  lightIntensity?: unknown
  lightColorMode?: unknown
  kelvinColor: string
  baseStrokeWidth: number
  energized?: boolean
  preview?: boolean
}): LedStripAppearanceMetrics {
  const output = easeOutput(normalizeLightOutput(options.lightIntensity))
  const baseStrokeWidth = Math.max(0, Number(options.baseStrokeWidth) || 0)
  const energized = options.energized !== false
  const offCeiling = energized ? 1 : 0.34
  const visibleOutput = output * offCeiling
  const brightness = Math.pow(visibleOutput, 0.22)

  return {
    colorMode: resolveLedStripLightColorMode(options.lightColorMode),
    normalizedOutput: output,
    kelvinColor: options.kelvinColor,
    outerStrokeWidth: Math.min(16, Math.max(8, baseStrokeWidth * 4.5 + visibleOutput * 12)),
    outerOpacity: 0.04 + brightness * 0.17,
    middleStrokeWidth: Math.min(9, Math.max(5, baseStrokeWidth * 2.75 + visibleOutput * 6)),
    middleOpacity: 0.11 + brightness * 0.28,
    coreStrokeWidth: Math.max(2.2, baseStrokeWidth * 0.85),
    coreOpacity: 0.28 + brightness * 0.66,
    diodeOpacity: 0.34 + brightness * 0.54,
    animationEnabled: options.preview === true && energized,
    animationDuration: LED_STRIP_RGB_FLOW_DURATION,
  }
}

export function sanitizeLedStripSvgId(value: unknown): string {
  const safe = String(value || 'draft')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return safe || 'draft'
}
