import type { BlueprintAnnotation, BlueprintScopeLayer } from '@/services/blueprintLibraryService'
import type { ElectricalSymbolCategory, ElectricalSymbolKind } from '@/components/blueprint/electricalSymbolRegistry'

export type ElectricalSymbolCountDiagnosticType =
  | 'duplicate-package-membership'
  | 'stale-package-reference'
  | 'missing-annotation-id'
  | 'duplicate-live-annotation-id'
  | 'unregistered-electrical-shape-kind'
  | 'scope-mismatch'
  | 'missing-symbol-metadata'

export interface ElectricalSymbolCountDiagnostic {
  type: ElectricalSymbolCountDiagnosticType
  message: string
  projectId?: string
  blueprintSetId?: string
  pageNumber?: number
  annotationId?: string
  packageId?: string
  packageIds?: string[]
  packageNames?: string[]
  shapeKind?: string
}

export interface ElectricalSymbolContribution {
  annotationId: string
  projectId: string
  blueprintSetId: string
  pageNumber: number
  shapeKind: ElectricalSymbolKind
  displayName: string
  shortLabel: string
  category: ElectricalSymbolCategory
  packageIds: string[]
  packageNames: string[]
}

export interface ElectricalSymbolTypeTotal {
  shapeKind: ElectricalSymbolKind
  displayName: string
  shortLabel: string
  category: ElectricalSymbolCategory
  count: number
  annotationIds: string[]
  pages: number[]
  packageIds: string[]
  diagnostics: ElectricalSymbolCountDiagnostic[]
}

export interface ElectricalSymbolCategoryTotal {
  category: ElectricalSymbolCategory
  count: number
  shapeKinds: ElectricalSymbolKind[]
  annotationIds: string[]
}

export interface PackageElectricalSymbolRollup {
  packageId: string
  packageName: string
  totals: ElectricalSymbolTypeTotal[]
  contributionIds: string[]
  diagnostics: ElectricalSymbolCountDiagnostic[]
}

export interface ElectricalSymbolCountResult {
  contributions: ElectricalSymbolContribution[]
  symbolTotals: ElectricalSymbolTypeTotal[]
  categoryTotals: ElectricalSymbolCategoryTotal[]
  packageRollups: PackageElectricalSymbolRollup[]
  overallCount: number
  diagnostics: ElectricalSymbolCountDiagnostic[]
}

export interface ElectricalSymbolCountEngineInput {
  projectId: string
  blueprintSetId: string
  annotations: readonly BlueprintAnnotation[]
  workPackages: readonly BlueprintScopeLayer[]
}
