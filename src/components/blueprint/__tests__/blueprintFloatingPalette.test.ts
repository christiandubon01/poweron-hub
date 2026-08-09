import { describe, expect, it } from 'vitest'
import { clampPaletteGeom } from '../BlueprintFloatingPalette'

describe('clampPaletteGeom', () => {
  it('enforces minimum width and height floor', () => {
    const result = clampPaletteGeom({ x: 100, y: 100, w: 50, h: 50 })
    expect(result.w).toBe(220)
    expect(result.h).toBe(160)
  })

  it('clamps negative position to zero', () => {
    const result = clampPaletteGeom({ x: -100, y: -200, w: 280, h: 360 })
    expect(result.x).toBe(0)
    expect(result.y).toBe(0)
  })

  it('clamps large position to keep palette in viewport', () => {
    const result = clampPaletteGeom({ x: 9999, y: 9999, w: 280, h: 360 })
    expect(result.x).toBe(1000)
    expect(result.y).toBe(440)
  })

  it('passes through valid geometry unchanged', () => {
    const result = clampPaletteGeom({ x: 60, y: 80, w: 280, h: 360 })
    expect(result).toEqual({ x: 60, y: 80, w: 280, h: 360 })
  })
})

describe.skip('BlueprintFloatingPalette pointer lifecycle regression', () => {
  it('needs a DOM runtime such as jsdom to render the component and dispatch pointer events', () => {})
})
