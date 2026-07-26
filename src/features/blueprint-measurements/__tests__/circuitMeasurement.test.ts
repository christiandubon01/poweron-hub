import { describe, expect, it } from 'vitest'
import {
  buildManualKnownDistanceCalibration,
  buildScaleCalibration,
  isValidPageSizeInches,
  measureCircuitRoute,
  resolveEffectiveCalibration,
  sampleCircuitArcPolyline,
  type DetectedScaleResult,
} from '..'

const pageSize = { pageWidthInches: 10, pageHeightInches: 10 }
const manual = buildManualKnownDistanceCalibration(1, { x: 0, y: 0 }, { x: 1, y: 0 }, 100, 'ft', pageSize)
const metricManual = buildManualKnownDistanceCalibration(1, { x: 0, y: 0 }, { x: 1, y: 0 }, 30, 'm', pageSize)
const autoResult: DetectedScaleResult = {
  pageNumber: 1,
  candidates: [{ parsedScale: '1/8" = 1\'-0"', realWidthFeet: 80, confidence: 0.9, sourceText: 'scale' }],
  ambiguous: false,
  detectedAt: '2026-01-01T00:00:00.000Z',
}

describe('blueprint-measurements circuitMeasurement', () => {
  it('measures Circuit Path one segment and multiple segments', () => {
    const calibration = { status: 'calibrated' as const, source: 'manual' as const, calibration: manual }
    expect(measureCircuitRoute({ points: [{ x: 0, y: 0 }, { x: 0.5, y: 0 }], shapeKind: 'circuit-path', calibration, pageSize })[0]).toMatchObject({
      status: 'measured',
      length: { value: 50, unit: 'ft' },
    })
    expect(measureCircuitRoute({ points: [{ x: 0, y: 0 }, { x: 0.25, y: 0 }, { x: 0.25, y: 0.25 }], shapeKind: 'circuit-path', calibration, pageSize }).map((r) => r.status)).toEqual(['measured', 'measured'])
  })

  it('measures Circuit Arc one segment, multiple segments, and mixed path/arc without expanding samples into material lines', () => {
    const calibration = { status: 'calibrated' as const, source: 'manual' as const, calibration: manual }
    const one = measureCircuitRoute({
      points: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      arcCtrls: [{ x: 0.5, y: 0.5 }],
      shapeKind: 'circuit-arc',
      calibration,
      pageSize,
    })
    expect(one).toHaveLength(1)
    expect(one[0].status).toBe('measured')
    expect(one[0].sampledPoints).toHaveLength(25)
    expect(sampleCircuitArcPolyline([{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 1, y: 0 }], [{ x: 0.25, y: 0.2 }, { x: 0.75, y: 0.2 }])).toHaveLength(49)
    expect(measureCircuitRoute({ points: [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 1, y: 0 }], arcCtrls: [], shapeKind: 'circuit-arc', calibration, pageSize })).toHaveLength(2)
  })

  it('resolves calibration precedence and excludes missing, NTS, and ambiguous auto scales', () => {
    const autoCalibration = buildScaleCalibration(1, 80, pageSize, '2026-01-01T00:00:00.000Z', 'auto-scale')
    expect(resolveEffectiveCalibration({ pageNumber: 1, savedCalibrations: { 1: manual }, detectedScales: { 1: autoResult }, pageSize })).toMatchObject({ status: 'calibrated', source: 'manual' })
    expect(resolveEffectiveCalibration({ pageNumber: 1, savedCalibrations: {}, detectedScales: { 1: autoResult }, pageSize })).toEqual({ status: 'calibrated', source: 'auto', calibration: autoCalibration })
    expect(resolveEffectiveCalibration({ pageNumber: 1, savedCalibrations: {}, detectedScales: {}, pageSize })).toEqual({ status: 'uncalibrated', reason: 'missing' })
    expect(resolveEffectiveCalibration({ pageNumber: 1, savedCalibrations: {}, detectedScales: { 1: { ...autoResult, ambiguous: true } }, pageSize })).toEqual({ status: 'uncalibrated', reason: 'ambiguous' })
    expect(resolveEffectiveCalibration({ pageNumber: 1, savedCalibrations: {}, detectedScales: { 1: { ...autoResult, hasNts: true } }, pageSize })).toEqual({ status: 'uncalibrated', reason: 'not-to-scale' })
    expect(resolveEffectiveCalibration({ pageNumber: 1, savedCalibrations: { 1: { ...manual, realWorldValue: 0 } }, detectedScales: { 1: autoResult }, pageSize })).toMatchObject({ status: 'calibrated', source: 'auto' })
  })

  it('normalizes metric, recomputes after calibration changes, ignores stored labels, and handles invalid geometry', () => {
    const metric = { status: 'calibrated' as const, source: 'manual' as const, calibration: metricManual }
    expect(measureCircuitRoute({ points: [{ x: 0, y: 0 }, { x: 0.5, y: 0 }], shapeKind: 'circuit-path', calibration: metric, pageSize })[0]).toMatchObject({
      status: 'measured',
      length: { value: 15, unit: 'm' },
    })
    const changed = buildManualKnownDistanceCalibration(1, { x: 0, y: 0 }, { x: 1, y: 0 }, 50, 'ft', pageSize)
    expect(measureCircuitRoute({ points: [{ x: 0, y: 0 }, { x: 0.5, y: 0 }], shapeKind: 'circuit-path', calibration: { status: 'calibrated', source: 'manual', calibration: changed }, pageSize })[0]).toMatchObject({
      length: { value: 25, unit: 'ft' },
    })
    expect(measureCircuitRoute({ points: [{ x: 0, y: 0 }, { x: 0, y: 0 }], shapeKind: 'circuit-path', calibration: metric, pageSize })[0].status).toBe('zero-length')
    expect(measureCircuitRoute({ points: [{ x: 0, y: Number.NaN }, { x: 1, y: 0 }], shapeKind: 'circuit-path', calibration: metric, pageSize })[0].status).toBe('invalid-geometry')
    expect(measureCircuitRoute({ points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], shapeKind: 'circuit-path', calibration: { status: 'uncalibrated', reason: 'missing' }, pageSize })[0].status).toBe('uncalibrated')
  })

  it('validates page dimensions and refuses wire measurement without them', () => {
    const calibration = { status: 'calibrated' as const, source: 'manual' as const, calibration: manual }
    expect(isValidPageSizeInches({ pageWidthInches: 20, pageHeightInches: 10 })).toBe(true)
    expect(isValidPageSizeInches(null)).toBe(false)
    expect(isValidPageSizeInches({ pageWidthInches: 0, pageHeightInches: 10 })).toBe(false)
    expect(isValidPageSizeInches({ pageWidthInches: 10, pageHeightInches: Number.NaN })).toBe(false)
    expect(measureCircuitRoute({ points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], shapeKind: 'circuit-path', calibration, pageSize: null })[0].status).toBe('missing-page-dimensions')
  })
})
