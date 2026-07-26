import { describe, expect, it } from 'vitest'
import {
  CIRCUIT_DRAW_GROUP_TOOL_ORDER,
  CIRCUIT_MEASUREMENT_LABELS_DEFAULT_VISIBLE,
  shouldRenderCircuitMeasurementLabel,
} from '../OperationsBlueprintPdfViewer'

const pathMeta = Object.freeze({
  shapeKind: 'circuit-path',
  distanceLabel: '12 ft 6 in',
  totalDistance: 12.5,
  points: Object.freeze([{ x: 0.1, y: 0.2 }, { x: 0.4, y: 0.2 }]),
})

const arcMeta = Object.freeze({
  shapeKind: 'circuit-arc',
  distanceLabel: '9 ft 3 in',
  totalDistance: 9.25,
  points: Object.freeze([{ x: 0.2, y: 0.3 }, { x: 0.6, y: 0.5 }]),
  arcCtrls: Object.freeze([{ x: 0.4, y: 0.2 }]),
})

describe('UX-CIRCUIT-LABELS-DEFAULT-OFF circuit measurement labels', () => {
  it('defaults Circuit Labels visibility off', () => {
    expect(CIRCUIT_MEASUREMENT_LABELS_DEFAULT_VISIBLE).toBe(false)
  })

  it('hides Circuit Path and Circuit Arc labels when the toggle is off', () => {
    expect(shouldRenderCircuitMeasurementLabel({
      labelsVisible: false,
      shapeKind: pathMeta.shapeKind,
      distanceLabel: pathMeta.distanceLabel,
      localPointCount: pathMeta.points.length,
    })).toBe(false)
    expect(shouldRenderCircuitMeasurementLabel({
      labelsVisible: false,
      shapeKind: arcMeta.shapeKind,
      distanceLabel: arcMeta.distanceLabel,
      localPointCount: arcMeta.points.length,
    })).toBe(false)
  })

  it('shows Circuit Path and Circuit Arc labels when the toggle is on, then hides both again', () => {
    let labelsVisible = CIRCUIT_MEASUREMENT_LABELS_DEFAULT_VISIBLE
    const path = () => shouldRenderCircuitMeasurementLabel({
      labelsVisible,
      shapeKind: pathMeta.shapeKind,
      distanceLabel: pathMeta.distanceLabel,
      localPointCount: pathMeta.points.length,
    })
    const arc = () => shouldRenderCircuitMeasurementLabel({
      labelsVisible,
      shapeKind: arcMeta.shapeKind,
      distanceLabel: arcMeta.distanceLabel,
      localPointCount: arcMeta.points.length,
    })

    expect(path()).toBe(false)
    expect(arc()).toBe(false)

    labelsVisible = true
    expect(path()).toBe(true)
    expect(arc()).toBe(true)

    labelsVisible = false
    expect(path()).toBe(false)
    expect(arc()).toBe(false)
  })

  it('does not broaden visibility to non-circuit measurements or mutate measurement metadata', () => {
    const beforePath = JSON.stringify(pathMeta)
    const beforeArc = JSON.stringify(arcMeta)

    expect(shouldRenderCircuitMeasurementLabel({
      labelsVisible: true,
      shapeKind: 'measure-distance',
      distanceLabel: '5 ft',
      localPointCount: 2,
    })).toBe(false)
    expect(shouldRenderCircuitMeasurementLabel({
      labelsVisible: true,
      shapeKind: 'measure-perimeter',
      distanceLabel: '22 ft',
      localPointCount: 4,
    })).toBe(false)

    expect(JSON.stringify(pathMeta)).toBe(beforePath)
    expect(JSON.stringify(arcMeta)).toBe(beforeArc)
  })

  it('respects an explicit visible state supplied by the current viewer session', () => {
    expect(shouldRenderCircuitMeasurementLabel({
      labelsVisible: true,
      shapeKind: 'circuit-path',
      distanceLabel: '18 ft',
      localPointCount: 2,
    })).toBe(true)
  })

  it('keeps draw-group order as Circuit Path, Circuit Arc, Circuit Labels', () => {
    expect([...CIRCUIT_DRAW_GROUP_TOOL_ORDER]).toEqual(['circuit-path', 'circuit-arc', 'circuit-labels'])
  })
})
