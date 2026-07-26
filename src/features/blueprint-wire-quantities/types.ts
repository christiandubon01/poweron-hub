import type { BlueprintAnnotation, BlueprintScopeLayer } from '@/services/blueprintLibraryService'
import type { CalibrationData, DetectedScaleResult, PageSizeInches, WireQuantityUnit } from '@/features/blueprint-measurements'
import type { WireProfile } from '@/features/blueprint-wire-profiles'

export type WireProfileResolution =
  | { status: 'active'; source: 'segment-override' | 'annotation-default'; wireProfileId: string; profile: WireProfile }
  | { status: 'archived'; source: 'segment-override' | 'annotation-default'; wireProfileId: string; profile: WireProfile }
  | { status: 'unassigned'; source: 'unassigned'; wireProfileId: null }
  | { status: 'missing-profile'; source: 'segment-override' | 'annotation-default'; wireProfileId: string }
  | { status: 'cross-project-profile'; source: 'segment-override' | 'annotation-default'; wireProfileId: string }

export type WireQuantityDiagnosticType =
  | 'uncalibrated-segment'
  | 'not-to-scale-page'
  | 'ambiguous-scale-page'
  | 'invalid-geometry'
  | 'zero-length-segment'
  | 'missing-page-dimensions'
  | 'legacy-segment-identity'
  | 'unassigned-profile'
  | 'missing-profile'
  | 'cross-project-profile'
  | 'unpackaged-contribution'
  | 'duplicate-package-membership'
  | 'stale-package-reference'
  | 'mixed-units-for-profile'

export interface WireQuantityDiagnostic {
  type: WireQuantityDiagnosticType
  message: string
  projectId?: string
  blueprintSetId?: string
  pageNumber?: number
  annotationId?: string
  segmentId?: string
  segmentIndex?: number
  quantityLineId?: string
  packageId?: string
  packageIds?: string[]
  wireProfileId?: string | null
  unit?: WireQuantityUnit | null
}

export interface WireQuantityContribution {
  quantityLineId: string
  projectId: string
  blueprintSetId: string
  pageNumber: number
  annotationId: string
  segmentId: string
  segmentIndex: number
  shapeKind: 'circuit-path' | 'circuit-arc'
  packageIds: string[]
  isUnpackaged: boolean
  profileResolution: WireProfileResolution
  measuredLength: number | null
  unit: WireQuantityUnit | null
  calibrationStatus: 'calibrated' | 'uncalibrated'
  diagnostics: WireQuantityDiagnostic[]
}

export interface WireProfileQuantityTotal {
  key: string
  groupKind: 'profile' | 'unassigned' | 'missing-profile' | 'cross-project-profile' | 'uncalibrated'
  wireProfileId: string | null
  profile?: WireProfile
  profileStatus?: 'active' | 'archived'
  displayName: string
  unit: WireQuantityUnit | null
  measuredLength: number
  wastePercent: number | null
  wasteLength: number | null
  purchaseLength: number | null
  contributionIds: string[]
  diagnostics: WireQuantityDiagnostic[]
}

export interface PackageWireQuantityRollup {
  packageId: string
  packageName: string
  totals: WireProfileQuantityTotal[]
  contributionIds: string[]
  diagnostics: WireQuantityDiagnostic[]
}

export interface WireQuantityResult {
  contributions: WireQuantityContribution[]
  projectTotals: WireProfileQuantityTotal[]
  packageRollups: PackageWireQuantityRollup[]
  unpackagedTotals: WireProfileQuantityTotal[]
  diagnostics: WireQuantityDiagnostic[]
}

export interface WireQuantityEngineInput {
  projectId: string
  blueprintSetId: string
  annotations: readonly BlueprintAnnotation[]
  workPackages: readonly BlueprintScopeLayer[]
  wireProfiles: readonly WireProfile[]
  savedCalibrations: Record<number, CalibrationData | undefined>
  detectedScales: Record<number, DetectedScaleResult | undefined>
  getPageSizeInches(pageNumber: number): PageSizeInches | null
}
