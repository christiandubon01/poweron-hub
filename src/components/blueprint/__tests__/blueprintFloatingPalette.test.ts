import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { clampPaletteGeom } from '../BlueprintFloatingPalette'

const source = readFileSync(
  join(process.cwd(), 'src/components/blueprint/BlueprintFloatingPalette.tsx'),
  'utf8',
)

function countOccurrences(haystack: string, needle: string) {
  return haystack.split(needle).length - 1
}

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

describe('BlueprintFloatingPalette source structure', () => {
  it('uses a single shared localStorage key for all palettes', () => {
    expect(source).toContain("const PALETTES_STORAGE_KEY = 'poweron.bp.palettes'")
  })

  it('applies touch-action none only to the drag header and resize handle', () => {
    expect(countOccurrences(source, "touchAction: 'none'")).toBe(2)
  })

  it('stops pointer propagation on the outer div to isolate from annotation overlay', () => {
    expect(source).toContain('onPointerDown={(e) => e.stopPropagation()}')
  })

  it('pairs releasePointerCapture on both pointerup and pointercancel for the drag handle', () => {
    const upStart = source.indexOf('handleHeaderPointerUp')
    const cancelStart = source.indexOf('handleHeaderPointerCancel')
    const upSource = source.slice(upStart, cancelStart)
    const cancelSource = source.slice(cancelStart, source.indexOf('handleResizePointerDown'))
    expect(upSource).toContain('releasePointerCapture')
    expect(cancelSource).toContain('releasePointerCapture')
  })

  it('pairs releasePointerCapture on both pointerup and pointercancel for the resize handle', () => {
    const upStart = source.indexOf('handleResizePointerUp')
    const cancelStart = source.indexOf('handleResizePointerCancel')
    const upSource = source.slice(upStart, cancelStart)
    const cancelSource = source.slice(cancelStart, source.indexOf('return (', cancelStart))
    expect(upSource).toContain('releasePointerCapture')
    expect(cancelSource).toContain('releasePointerCapture')
  })

  it('clamps geometry on both resize and orientationchange viewport events', () => {
    expect(source).toContain("window.addEventListener('resize', clamp)")
    expect(source).toContain("window.addEventListener('orientationchange', clamp)")
  })

  it('persists geometry to a single shared localStorage key', () => {
    expect(source).toContain('writePaletteStore')
    expect(source).toContain('readPaletteStore')
    expect(countOccurrences(source, 'PALETTES_STORAGE_KEY')).toBeGreaterThanOrEqual(2)
  })
})
