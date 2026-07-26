export type CalibrationUnit = 'ft' | 'm' | 'in' | 'cm' | 'mm'
export type CalibrationKind = 'auto-scale' | 'selected-scale' | 'manual-known-distance' | 'legacy'

export type WireQuantityUnit = 'ft' | 'm'

export interface PageSizeInches {
  pageWidthInches: number
  pageHeightInches: number
}

export interface CalibrationData {
  pageNumber: number
  normDistance: number
  realWorldValue: number
  realWorldUnit: CalibrationUnit
  savedAt: string
  pageWidthInches?: number
  pageHeightInches?: number
  sheetDistanceInches?: number
  unitsPerSheetInch?: number
  calibrationKind?: CalibrationKind
}

export interface DetectedScaleCandidate {
  parsedScale: string
  realWidthFeet: number
  confidence: number
  sourceText: string
}

export interface DetectedScaleResult {
  pageNumber: number
  candidates: DetectedScaleCandidate[]
  ambiguous: boolean
  detectedAt: string
  hasNts?: boolean
  reason?: string
}

export type EffectiveCalibrationResult =
  | {
      status: 'calibrated'
      source: 'manual' | 'auto'
      calibration: CalibrationData
    }
  | {
      status: 'uncalibrated'
      reason: 'missing' | 'ambiguous' | 'not-to-scale' | 'invalid'
    }

export type NormalizedPoint = { x: number; y: number }

export type MeasuredLength = {
  value: number
  unit: WireQuantityUnit
}

export type SegmentMeasurementResult =
  | {
      status: 'measured'
      length: MeasuredLength
      sampledPoints: NormalizedPoint[]
    }
  | {
      status: 'uncalibrated' | 'invalid-geometry' | 'zero-length' | 'missing-page-dimensions'
      reason?: 'missing' | 'ambiguous' | 'not-to-scale' | 'invalid'
      sampledPoints: NormalizedPoint[]
    }
