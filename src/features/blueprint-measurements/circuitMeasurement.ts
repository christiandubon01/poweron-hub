import type {
  CalibrationData,
  CalibrationUnit,
  DetectedScaleResult,
  EffectiveCalibrationResult,
  MeasuredLength,
  NormalizedPoint,
  PageSizeInches,
  SegmentMeasurementResult,
  WireQuantityUnit,
} from './types'

export const CIRCUIT_ARC_LENGTH_SAMPLES = 24

export function getPageSizeInchesFromPts(pageWidthPts: number, pageHeightPts: number): PageSizeInches {
  return {
    pageWidthInches: pageWidthPts / 72,
    pageHeightInches: pageHeightPts / 72,
  }
}

export function isValidPageSizeInches(size: PageSizeInches | null | undefined): size is PageSizeInches {
  return !!size
    && Number.isFinite(size.pageWidthInches)
    && Number.isFinite(size.pageHeightInches)
    && size.pageWidthInches > 0
    && size.pageHeightInches > 0
}

export function isFiniteNormalizedPoint(point: unknown): point is NormalizedPoint {
  return !!point
    && typeof point === 'object'
    && Number.isFinite(Number((point as NormalizedPoint).x))
    && Number.isFinite(Number((point as NormalizedPoint).y))
}

export function normalizeMeasurementPoint(point: unknown): NormalizedPoint | null {
  if (!isFiniteNormalizedPoint(point)) return null
  return { x: Number(point.x), y: Number(point.y) }
}

export function getLegacyScaleForPage(cal: CalibrationData): number {
  return cal.normDistance / Math.max(0.001, cal.realWorldValue)
}

export function resolveUnitsPerSheetInch(cal: CalibrationData, pageSize: PageSizeInches | null): number | null {
  if (cal.unitsPerSheetInch != null && Number.isFinite(cal.unitsPerSheetInch) && cal.unitsPerSheetInch > 0) {
    return cal.unitsPerSheetInch
  }
  if (cal.sheetDistanceInches != null && cal.sheetDistanceInches > 0) {
    return cal.realWorldValue / cal.sheetDistanceInches
  }
  if (isValidPageSizeInches(pageSize) && Math.abs(cal.normDistance - 1.0) < 0.0001) {
    return cal.realWorldValue / pageSize.pageWidthInches
  }
  return null
}

export function getNormSegmentSheetDistanceInches(
  p1: NormalizedPoint,
  p2: NormalizedPoint,
  pageSize: PageSizeInches,
): number {
  const dxSheetInches = (p2.x - p1.x) * pageSize.pageWidthInches
  const dySheetInches = (p2.y - p1.y) * pageSize.pageHeightInches
  return Math.hypot(dxSheetInches, dySheetInches)
}

export function buildScaleCalibration(
  pageNumber: number,
  realWidthFeet: number,
  pageSize: PageSizeInches | null,
  savedAt: string,
  kind: 'auto-scale' | 'selected-scale',
): CalibrationData {
  const cal: CalibrationData = {
    pageNumber,
    normDistance: 1.0,
    realWorldValue: realWidthFeet,
    realWorldUnit: 'ft',
    savedAt,
    calibrationKind: kind,
  }
  if (isValidPageSizeInches(pageSize)) {
    cal.pageWidthInches = pageSize.pageWidthInches
    cal.pageHeightInches = pageSize.pageHeightInches
    cal.sheetDistanceInches = pageSize.pageWidthInches
    cal.unitsPerSheetInch = realWidthFeet / pageSize.pageWidthInches
  }
  return cal
}

export function buildManualKnownDistanceCalibration(
  pageNumber: number,
  p1: NormalizedPoint,
  p2: NormalizedPoint,
  realWorldValue: number,
  realWorldUnit: CalibrationUnit,
  pageSize: PageSizeInches | null,
): CalibrationData {
  const normDist = Math.hypot(p2.x - p1.x, p2.y - p1.y)
  const cal: CalibrationData = {
    pageNumber,
    normDistance: normDist,
    realWorldValue,
    realWorldUnit,
    savedAt: new Date().toISOString(),
    calibrationKind: 'manual-known-distance',
  }
  if (isValidPageSizeInches(pageSize) && normDist > 0) {
    const sheetDistanceInches = getNormSegmentSheetDistanceInches(p1, p2, pageSize)
    cal.pageWidthInches = pageSize.pageWidthInches
    cal.pageHeightInches = pageSize.pageHeightInches
    cal.sheetDistanceInches = sheetDistanceInches
    cal.unitsPerSheetInch = realWorldValue / sheetDistanceInches
  }
  return cal
}

export function buildAutoCalibrationForPage(
  pageNumber: number,
  detectedResult: DetectedScaleResult | null | undefined,
  pageSize: PageSizeInches | null,
): CalibrationData | null {
  if (!detectedResult || detectedResult.ambiguous || detectedResult.candidates.length !== 1) return null
  const c = detectedResult.candidates[0]
  if (!Number.isFinite(c.realWidthFeet) || c.realWidthFeet <= 0) return null
  return buildScaleCalibration(pageNumber, c.realWidthFeet, pageSize, detectedResult.detectedAt, 'auto-scale')
}

export function isUsableCalibration(cal: CalibrationData | null | undefined): cal is CalibrationData {
  if (!cal) return false
  if (!Number.isFinite(cal.realWorldValue) || cal.realWorldValue <= 0) return false
  if (!Number.isFinite(cal.normDistance) || cal.normDistance <= 0) return false
  return cal.realWorldUnit === 'ft' || cal.realWorldUnit === 'm' || cal.realWorldUnit === 'in' || cal.realWorldUnit === 'cm' || cal.realWorldUnit === 'mm'
}

function detectedScaleIsNotToScale(result: DetectedScaleResult | null | undefined): boolean {
  if (!result) return false
  return result.hasNts === true || String(result.reason || '').toLowerCase().includes('nts') || String(result.reason || '').toLowerCase().includes('not-to-scale')
}

export function resolveEffectiveCalibration(params: {
  pageNumber: number
  savedCalibrations?: Record<number, CalibrationData | undefined>
  detectedScales?: Record<number, DetectedScaleResult | undefined>
  pageSize: PageSizeInches | null
}): EffectiveCalibrationResult {
  const manual = params.savedCalibrations?.[params.pageNumber] ?? null
  const detected = params.detectedScales?.[params.pageNumber] ?? null
  if (manual && isUsableCalibration(manual)) {
    return { status: 'calibrated', source: 'manual', calibration: manual }
  }
  if (detectedScaleIsNotToScale(detected)) return { status: 'uncalibrated', reason: 'not-to-scale' }
  if (detected?.ambiguous) return { status: 'uncalibrated', reason: 'ambiguous' }
  const auto = buildAutoCalibrationForPage(params.pageNumber, detected, params.pageSize)
  if (auto) return { status: 'calibrated', source: 'auto', calibration: auto }
  if (manual) return { status: 'uncalibrated', reason: 'invalid' }
  return { status: 'uncalibrated', reason: 'missing' }
}

export function canonicalLengthFromCalibration(value: number, unit: CalibrationUnit): MeasuredLength | null {
  if (!Number.isFinite(value)) return null
  if (unit === 'ft') return { value, unit: 'ft' }
  if (unit === 'in') return { value: value / 12, unit: 'ft' }
  if (unit === 'm') return { value, unit: 'm' }
  if (unit === 'cm') return { value: value / 100, unit: 'm' }
  if (unit === 'mm') return { value: value / 1000, unit: 'm' }
  return null
}

export function convertMeasuredDistance(
  p1: NormalizedPoint,
  p2: NormalizedPoint,
  cal: CalibrationData,
  pageSize: PageSizeInches | null,
): number {
  const unitsPerSheetInch = resolveUnitsPerSheetInch(cal, pageSize)
  if (isValidPageSizeInches(pageSize) && unitsPerSheetInch != null) {
    return getNormSegmentSheetDistanceInches(p1, p2, pageSize) * unitsPerSheetInch
  }
  const normDist = Math.hypot(p2.x - p1.x, p2.y - p1.y)
  return normDist / getLegacyScaleForPage(cal)
}

export function convertMeasuredPolylineLength(
  points: NormalizedPoint[],
  cal: CalibrationData,
  pageSize: PageSizeInches | null,
): number {
  const unitsPerSheetInch = resolveUnitsPerSheetInch(cal, pageSize)
  if (isValidPageSizeInches(pageSize) && unitsPerSheetInch != null) {
    let sheetLen = 0
    for (let i = 1; i < points.length; i++) {
      sheetLen += getNormSegmentSheetDistanceInches(points[i - 1], points[i], pageSize)
    }
    return sheetLen * unitsPerSheetInch
  }
  let normLen = 0
  for (let i = 1; i < points.length; i++) {
    normLen += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
  }
  return normLen / getLegacyScaleForPage(cal)
}

export function convertMeasuredPolygonArea(
  points: NormalizedPoint[],
  cal: CalibrationData,
  pageSize: PageSizeInches | null,
): number {
  let normArea = 0
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length
    normArea += points[i].x * points[j].y - points[j].x * points[i].y
  }
  normArea = Math.abs(normArea) / 2
  const unitsPerSheetInch = resolveUnitsPerSheetInch(cal, pageSize)
  if (isValidPageSizeInches(pageSize) && unitsPerSheetInch != null) {
    const sheetAreaSquareInches = normArea * pageSize.pageWidthInches * pageSize.pageHeightInches
    return sheetAreaSquareInches * unitsPerSheetInch * unitsPerSheetInch
  }
  const scaleForPage = getLegacyScaleForPage(cal)
  return normArea / (scaleForPage * scaleForPage)
}

export function getCircuitArcControl(
  arcCtrls: unknown,
  a: NormalizedPoint,
  b: NormalizedPoint,
  i: number,
): NormalizedPoint {
  const raw = Array.isArray(arcCtrls) ? arcCtrls[i] : null
  const ctrl = normalizeMeasurementPoint(raw)
  if (ctrl) return ctrl
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

export function sampleCircuitArcSegment(
  p0: NormalizedPoint,
  p1: NormalizedPoint,
  control: NormalizedPoint,
): NormalizedPoint[] {
  const out: NormalizedPoint[] = [p0]
  for (let s = 1; s <= CIRCUIT_ARC_LENGTH_SAMPLES; s++) {
    const t = s / CIRCUIT_ARC_LENGTH_SAMPLES
    const mt = 1 - t
    out.push({
      x: mt * mt * p0.x + 2 * mt * t * control.x + t * t * p1.x,
      y: mt * mt * p0.y + 2 * mt * t * control.y + t * t * p1.y,
    })
  }
  return out
}

export function sampleCircuitArcPolyline(points: NormalizedPoint[], arcCtrls: unknown): NormalizedPoint[] {
  if (points.length < 2) return [...points]
  const out: NormalizedPoint[] = [points[0]]
  for (let i = 1; i < points.length; i++) {
    const sampled = sampleCircuitArcSegment(points[i - 1], points[i], getCircuitArcControl(arcCtrls, points[i - 1], points[i], i - 1))
    out.push(...sampled.slice(1))
  }
  return out
}

function unitForCalibration(cal: CalibrationData): WireQuantityUnit | null {
  return canonicalLengthFromCalibration(0, cal.realWorldUnit)?.unit ?? null
}

export function measureCircuitSegment(params: {
  points: NormalizedPoint[]
  calibration: EffectiveCalibrationResult
  pageSize: PageSizeInches | null
}): SegmentMeasurementResult {
  if (params.points.length < 2 || params.points.some((point) => !isFiniteNormalizedPoint(point))) {
    return { status: 'invalid-geometry', sampledPoints: params.points }
  }
  if (params.calibration.status !== 'calibrated') {
    return { status: 'uncalibrated', reason: params.calibration.reason, sampledPoints: params.points }
  }
  if (!isValidPageSizeInches(params.pageSize)) {
    return { status: 'missing-page-dimensions', sampledPoints: params.points }
  }
  const rawLength = convertMeasuredPolylineLength(params.points, params.calibration.calibration, params.pageSize)
  const unit = unitForCalibration(params.calibration.calibration)
  const canonical = canonicalLengthFromCalibration(rawLength, params.calibration.calibration.realWorldUnit)
  if (!unit || !canonical || !Number.isFinite(canonical.value)) return { status: 'invalid-geometry', sampledPoints: params.points }
  if (canonical.value <= 0) return { status: 'zero-length', sampledPoints: params.points }
  return { status: 'measured', length: canonical, sampledPoints: params.points }
}

export function measureCircuitRoute(params: {
  points: unknown
  shapeKind: 'circuit-path' | 'circuit-arc'
  arcCtrls?: unknown
  calibration: EffectiveCalibrationResult
  pageSize: PageSizeInches | null
}): SegmentMeasurementResult[] {
  const points = Array.isArray(params.points) ? params.points.map(normalizeMeasurementPoint) : []
  if (points.length < 2 || points.some((point) => point == null)) {
    return [{ status: 'invalid-geometry', sampledPoints: [] }]
  }
  const normalized = points as NormalizedPoint[]
  const results: SegmentMeasurementResult[] = []
  for (let i = 1; i < normalized.length; i++) {
    const segmentPoints = params.shapeKind === 'circuit-arc'
      ? sampleCircuitArcSegment(normalized[i - 1], normalized[i], getCircuitArcControl(params.arcCtrls, normalized[i - 1], normalized[i], i - 1))
      : [normalized[i - 1], normalized[i]]
    results.push(measureCircuitSegment({
      points: segmentPoints,
      calibration: params.calibration,
      pageSize: params.pageSize,
    }))
  }
  return results
}

export function formatArchitecturalLength(value: number, unit: string): string {
  const u = String(unit || '').toLowerCase()
  if (!Number.isFinite(value)) return `0 ${unit}`
  if (u !== 'ft' && u !== 'in') return `${value.toFixed(2)} ${unit}`
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  const totalInches = u === 'ft' ? abs * 12 : abs
  const sixteenths = Math.round(totalInches * 16)
  const wholeInches = Math.floor(sixteenths / 16)
  const remSixteenths = sixteenths % 16
  const gcd = (x: number, y: number): number => (y === 0 ? x : gcd(y, x % y))
  const g = remSixteenths > 0 ? gcd(remSixteenths, 16) : 1
  const fracStr = remSixteenths > 0 ? `${remSixteenths / g}/${16 / g}` : ''
  if (u === 'in') {
    if (wholeInches > 0 && fracStr) return `${sign}${wholeInches}-${fracStr}"`
    if (wholeInches > 0) return `${sign}${wholeInches}"`
    if (fracStr) return `${sign}${fracStr}"`
    return '0"'
  }
  const feet = Math.floor(wholeInches / 12)
  const inches = wholeInches % 12
  const inchStr = fracStr ? `${inches} ${fracStr}` : `${inches}`
  return `${sign}${feet}'-${inchStr}"`
}
