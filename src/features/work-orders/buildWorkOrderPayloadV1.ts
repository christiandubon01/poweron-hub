import type { BlueprintAnnotation, BlueprintLibraryItem, BlueprintScopeLayer } from '@/services/blueprintLibraryService'
import { buildElectricalSymbolCountResult } from '@/features/blueprint-symbol-counts'
import { buildWireQuantityResult } from '@/features/blueprint-wire-quantities'
import type { CalibrationData, DetectedScaleResult, PageSizeInches } from '@/features/blueprint-measurements'
import type { WireProfile } from '@/features/blueprint-wire-profiles'
import {
  getPackageAnimationBranchSummaries,
  getPackageAnimationRouteList,
  loadPackageAnimationRouteDraft,
} from '@/features/blueprint-animation/routeBuilderModel'
import type { WorkOrderPayloadV1, WorkOrderPayloadV1Draft, WorkOrderServerIdentity } from './types'

const MAX_PAYLOAD_BYTES = 512000

export interface BuildWorkOrderPayloadV1DraftInput {
  projectId: string
  projectName: string
  blueprintSetId: string
  blueprintTitle?: string
  workPackage: BlueprintScopeLayer
  blueprint?: Pick<BlueprintLibraryItem, 'updatedAt'>
  annotations?: readonly BlueprintAnnotation[]
  wireProfiles?: readonly WireProfile[]
  savedCalibrations?: Record<number, CalibrationData | undefined>
  detectedScales?: Record<number, DetectedScaleResult | undefined>
  getPageSizeInches?: (pageNumber: number) => PageSizeInches | null
}

export function buildWorkOrderPayloadV1Draft(input: BuildWorkOrderPayloadV1DraftInput): WorkOrderPayloadV1Draft {
  const workPackage = input.workPackage
  const annotations = Array.isArray(input.annotations) ? input.annotations : []
  const sourceRevision = finiteNonNegative((workPackage as any).animationSceneRevision, 0)

  return {
    identity: {
      projectId: cleanRequiredText(input.projectId, 200),
      projectName: cleanRequiredText(input.projectName, 200),
      workPackageId: cleanRequiredText(workPackage.id, 200),
      blueprintSetId: cleanRequiredText(input.blueprintSetId, 200),
      ...(cleanOptionalText(input.blueprintTitle, 200) ? { blueprintTitle: cleanOptionalText(input.blueprintTitle, 200) } : {}),
      ...(Number.isFinite(workPackage.pageNumber) && Number(workPackage.pageNumber) > 0
        ? { sourcePageNumber: Math.floor(Number(workPackage.pageNumber)) }
        : {}),
    },
    source: {
      ...(cleanOptionalText(workPackage.updatedAt, 100) ? { workPackageUpdatedAt: cleanOptionalText(workPackage.updatedAt, 100) } : {}),
      ...(sourceRevision > 0 ? { animationSceneRevision: sourceRevision } : {}),
      sourceFingerprint: buildSourceFingerprint({
        workPackageId: workPackage.id,
        workPackageUpdatedAt: workPackage.updatedAt,
        animationSceneRevision: sourceRevision,
        blueprintSetId: input.blueprintSetId,
      }),
    },
    scope: {
      title: cleanRequiredText(workPackage.name, 200),
      description: cleanText(workPackage.description, 4000),
      crewNotes: cleanText(workPackage.crewNotes, 4000),
    },
    labor: normalizeLabor(workPackage),
    items: normalizeItems(workPackage.itemRefs),
    electricalSymbols: buildElectricalSymbols({
      projectId: input.projectId,
      blueprintSetId: input.blueprintSetId,
      workPackage,
      annotations,
    }),
    wireQuantities: buildWireQuantities({
      projectId: input.projectId,
      blueprintSetId: input.blueprintSetId,
      workPackage,
      annotations,
      wireProfiles: input.wireProfiles ?? [],
      savedCalibrations: input.savedCalibrations ?? {},
      detectedScales: input.detectedScales ?? {},
      getPageSizeInches: input.getPageSizeInches,
    }),
    animationRoute: buildAnimationRoute(workPackage, annotations),
  }
}

export function finalizeWorkOrderPayloadV1(
  draft: WorkOrderPayloadV1Draft,
  identity: WorkOrderServerIdentity,
): WorkOrderPayloadV1 {
  const payload: WorkOrderPayloadV1 = {
    ...draft,
    schemaVersion: 1,
    workOrderVersion: 1,
    identity: {
      ...draft.identity,
      assignmentId: identity.assignmentId,
      orgId: identity.orgId,
      createdAt: identity.createdAt,
      createdBy: identity.createdBy,
    },
  }
  assertPayloadSize(payload)
  return payload
}

export function buildSourceFingerprint(input: {
  workPackageId: string
  workPackageUpdatedAt?: string
  animationSceneRevision?: number
  blueprintSetId: string
}): string {
  return [
    cleanRequiredText(input.workPackageId, 200),
    cleanText(input.workPackageUpdatedAt, 100),
    String(finiteNonNegative(input.animationSceneRevision, 0)),
    cleanRequiredText(input.blueprintSetId, 200),
  ].join('|')
}

export function getWorkOrderPayloadByteLength(payload: unknown): number {
  return new TextEncoder().encode(JSON.stringify(payload)).length
}

function assertPayloadSize(payload: unknown) {
  if (getWorkOrderPayloadByteLength(payload) > MAX_PAYLOAD_BYTES) {
    throw new Error('Work Order payload is too large')
  }
}

function normalizeLabor(layer: Pick<BlueprintScopeLayer, 'roughInHours' | 'trimHours' | 'testingHours' | 'cleanupHours'>): WorkOrderPayloadV1['labor'] {
  const roughInHours = round2(finiteNonNegative(layer.roughInHours, 0))
  const trimHours = round2(finiteNonNegative(layer.trimHours, 0))
  const testingHours = round2(finiteNonNegative(layer.testingHours, 0))
  const cleanupHours = round2(finiteNonNegative(layer.cleanupHours, 0))
  return {
    roughInHours,
    trimHours,
    testingHours,
    cleanupHours,
    totalHours: round2(roughInHours + trimHours + testingHours + cleanupHours),
  }
}

function normalizeItems(itemRefs: BlueprintScopeLayer['itemRefs'] | undefined): WorkOrderPayloadV1['items'] {
  return (Array.isArray(itemRefs) ? itemRefs : [])
    .filter(Boolean)
    .map((item) => ({
      ...(cleanOptionalText(item.annotationId, 200) ? { sourceId: cleanOptionalText(item.annotationId, 200) } : {}),
      name: cleanRequiredText(item.label || item.shapeKind || 'Item', 200),
      quantity: round2(finiteNonNegative(item.countValue, 1)),
      ...(Number.isFinite(item.pageNumber) && Number(item.pageNumber) > 0 ? { pageNumber: Math.floor(Number(item.pageNumber)) } : {}),
    }))
    .sort((a, b) =>
      (a.pageNumber ?? 0) - (b.pageNumber ?? 0) ||
      a.name.localeCompare(b.name) ||
      (a.sourceId ?? '').localeCompare(b.sourceId ?? '')
    )
}

function buildElectricalSymbols(input: {
  projectId: string
  blueprintSetId: string
  workPackage: BlueprintScopeLayer
  annotations: readonly BlueprintAnnotation[]
}): WorkOrderPayloadV1['electricalSymbols'] {
  const result = buildElectricalSymbolCountResult({
    projectId: input.projectId,
    blueprintSetId: input.blueprintSetId,
    annotations: input.annotations,
    workPackages: [input.workPackage],
  })
  const rollup = result.packageRollups.find((entry) => entry.packageId === input.workPackage.id)
  return (rollup?.totals ?? [])
    .map((total) => ({
      shapeKind: cleanRequiredText(total.shapeKind, 200),
      name: cleanRequiredText(total.displayName, 200),
      ...(cleanOptionalText(total.category, 200) ? { category: cleanOptionalText(total.category, 200) } : {}),
      quantity: round2(finiteNonNegative(total.count, 0)),
    }))
    .sort((a, b) =>
      (a.category ?? '').localeCompare(b.category ?? '') ||
      a.name.localeCompare(b.name) ||
      a.shapeKind.localeCompare(b.shapeKind)
    )
}

function buildWireQuantities(input: {
  projectId: string
  blueprintSetId: string
  workPackage: BlueprintScopeLayer
  annotations: readonly BlueprintAnnotation[]
  wireProfiles: readonly WireProfile[]
  savedCalibrations: Record<number, CalibrationData | undefined>
  detectedScales: Record<number, DetectedScaleResult | undefined>
  getPageSizeInches?: (pageNumber: number) => PageSizeInches | null
}): WorkOrderPayloadV1['wireQuantities'] {
  if (!input.getPageSizeInches) return []
  try {
    const result = buildWireQuantityResult({
      projectId: input.projectId,
      blueprintSetId: input.blueprintSetId,
      annotations: input.annotations,
      workPackages: [input.workPackage],
      wireProfiles: input.wireProfiles,
      savedCalibrations: input.savedCalibrations,
      detectedScales: input.detectedScales,
      getPageSizeInches: input.getPageSizeInches,
    })
    const rollup = result.packageRollups.find((entry) => entry.packageId === input.workPackage.id)
    return (rollup?.totals ?? [])
      .filter((total) => Number.isFinite(total.measuredLength) && total.measuredLength > 0 && !!total.unit)
      .map((total) => ({
        ...(cleanOptionalText(total.wireProfileId, 200) ? { wireProfileId: cleanOptionalText(total.wireProfileId, 200) } : {}),
        profileName: cleanRequiredText(total.displayName, 200),
        ...(cleanOptionalText((total.profile as any)?.materialDescription, 400) ? { materialDescription: cleanOptionalText((total.profile as any)?.materialDescription, 400) } : {}),
        length: round2(total.measuredLength),
        unit: cleanRequiredText(total.unit || 'ft', 20),
      }))
      .sort((a, b) =>
        a.profileName.localeCompare(b.profileName) ||
        (a.wireProfileId ?? '').localeCompare(b.wireProfileId ?? '')
      )
  } catch {
    return []
  }
}

function buildAnimationRoute(
  workPackage: BlueprintScopeLayer,
  annotations: readonly BlueprintAnnotation[],
): WorkOrderPayloadV1['animationRoute'] {
  if (!workPackage.animationScene) return null
  try {
    const draft = loadPackageAnimationRouteDraft({
      packageId: workPackage.id,
      packageName: workPackage.name,
      packageAnnotationIds: Array.isArray(workPackage.selectedAnnotationIds) ? workPackage.selectedAnnotationIds : [],
      annotations: annotations as any,
      scene: workPackage.animationScene,
      expectedBaseRevision: finiteNonNegative(workPackage.animationSceneRevision, 0),
    })
    if ((draft as any).readOnlyReason) return null
    const routeEntries = getPackageAnimationRouteList(draft)
    if (routeEntries.length === 0) return null
    const branches = getPackageAnimationBranchSummaries(draft)
    const branchByOrigin = new Map(branches.map((branch) => [branch.originNumber, branch]))
    const steps = routeEntries
      .map((entry, index) => ({
        order: finiteNonNegative(entry.number, index + 1),
        label: cleanRequiredText(entry.label, 200),
        ...(cleanOptionalText(entry.typeLabel, 200) ? { deviceType: cleanOptionalText(entry.typeLabel, 200) } : {}),
        ...(branchByOrigin.has(entry.number ?? 0) ? { branch: cleanRequiredText(branchByOrigin.get(entry.number ?? 0)?.endpointLabel || 'Alternate branch', 200) } : {}),
      }))
      .sort((a, b) => a.order - b.order)
    const terminalLabels = uniqueSorted(
      branches.map((branch) => branch.endpointLabel).filter(Boolean).map((label) => cleanRequiredText(label, 200)),
    )
    return {
      name: cleanRequiredText(workPackage.name, 200),
      sourceLabel: steps[0]?.label,
      steps,
      ...(terminalLabels.length > 0 ? { terminalLabels } : {}),
    }
  } catch {
    return null
  }
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((value) => cleanRequiredText(value, 200)).filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

function finiteNonNegative(value: unknown, fallback: number): number {
  const next = Number(value)
  if (!Number.isFinite(next)) return fallback
  return Math.max(0, next)
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function cleanRequiredText(value: unknown, max: number): string {
  return cleanText(value, max)
}

function cleanOptionalText(value: unknown, max: number): string | undefined {
  const text = cleanText(value, max)
  return text ? text : undefined
}

function cleanText(value: unknown, max: number): string {
  const text = value == null ? '' : String(value)
  return text.trim().replace(/\s+/g, ' ').slice(0, max)
}
