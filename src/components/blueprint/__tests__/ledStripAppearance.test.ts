import { describe, expect, it } from 'vitest'
import {
  LED_STRIP_RGB_FLOW_DURATION,
  getLedStripAppearanceMetrics,
  resolveLedStripLightColorMode,
  sanitizeLedStripSvgId,
} from '../ledStripAppearance'

const base = {
  kelvinColor: '#ffa64d',
  baseStrokeWidth: 2,
}

describe('LED Strip appearance metrics', () => {
  it('reads the existing lightIntensity field, defaults to 1, and clamps to 0.25..20', () => {
    const missing = getLedStripAppearanceMetrics(base)
    const below = getLedStripAppearanceMetrics({ ...base, lightIntensity: -10 })
    const min = getLedStripAppearanceMetrics({ ...base, lightIntensity: 0.25 })
    const above = getLedStripAppearanceMetrics({ ...base, lightIntensity: 200 })
    const max = getLedStripAppearanceMetrics({ ...base, lightIntensity: 20 })

    expect(missing.normalizedOutput).toBeGreaterThan(min.normalizedOutput)
    expect(below).toMatchObject(min)
    expect(above).toMatchObject(max)
  })

  it('maps lower output to dimmer path glow and higher output to brighter path glow', () => {
    const low = getLedStripAppearanceMetrics({ ...base, lightIntensity: 0.25 })
    const normal = getLedStripAppearanceMetrics({ ...base, lightIntensity: 1 })
    const high = getLedStripAppearanceMetrics({ ...base, lightIntensity: 20 })

    expect(low.outerOpacity).toBeLessThan(normal.outerOpacity)
    expect(normal.outerOpacity).toBeLessThan(high.outerOpacity)
    expect(low.coreOpacity).toBeLessThan(normal.coreOpacity)
    expect(normal.coreOpacity).toBeLessThan(high.coreOpacity)
    expect(high.outerStrokeWidth).toBeLessThanOrEqual(16)
    expect(normal.outerStrokeWidth).toBeCloseTo(12, 0)
    expect(normal.middleStrokeWidth).toBeCloseTo(7, 0)
    expect(normal.coreOpacity).toBeGreaterThan(0.75)
  })

  it('uses one mode field with Kelvin fallback and a stable RGB speed', () => {
    expect(resolveLedStripLightColorMode(undefined)).toBe('kelvin')
    expect(resolveLedStripLightColorMode('bogus')).toBe('kelvin')
    expect(resolveLedStripLightColorMode('rgb-flow')).toBe('rgb-flow')

    const rgbLow = getLedStripAppearanceMetrics({ ...base, lightIntensity: 0.25, lightColorMode: 'rgb-flow', preview: true })
    const rgbHigh = getLedStripAppearanceMetrics({ ...base, lightIntensity: 20, lightColorMode: 'rgb-flow', preview: true })
    expect(rgbLow.colorMode).toBe('rgb-flow')
    expect(rgbHigh.outerOpacity).toBeGreaterThan(rgbLow.outerOpacity)
    expect(rgbHigh.animationDuration).toBe(LED_STRIP_RGB_FLOW_DURATION)
    expect(rgbLow.animationDuration).toBe(rgbHigh.animationDuration)
  })

  it('subdues off-state output and disables flow without changing speed policy', () => {
    const off = getLedStripAppearanceMetrics({ ...base, lightIntensity: 20, lightColorMode: 'rgb-flow', energized: false, preview: true })
    const on = getLedStripAppearanceMetrics({ ...base, lightIntensity: 20, lightColorMode: 'rgb-flow', energized: true, preview: true })

    expect(off.outerOpacity).toBeLessThan(on.outerOpacity)
    expect(off.coreOpacity).toBeLessThan(on.coreOpacity)
    expect(off.animationEnabled).toBe(false)
    expect(on.animationEnabled).toBe(true)
    expect(off.animationDuration).toBe(on.animationDuration)
  })

  it('sanitizes stable annotation identity for SVG ids without render-time randomness', () => {
    expect(sanitizeLedStripSvgId('page 1/ann:abc')).toBe('page-1-ann-abc')
    expect(sanitizeLedStripSvgId('')).toBe('draft')
    expect(sanitizeLedStripSvgId('page-1-ann-a')).not.toBe(sanitizeLedStripSvgId('page-1-ann-b'))
  })
})
