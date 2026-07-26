import { getLiveWorkPackages, sortWorkPackages } from '@/features/blueprint-work-packages'
import {
  measureCircuitRoute,
  resolveEffectiveCalibration,
  type WireQuantityUnit,
} from '@/features/blueprint-measurements'
import type { WireProfile } from '@/features/blueprint-wire-profiles'
import { resolveSegmentWireProfile } from './profileResolver'
import type {
  PackageWireQuantityRollup,
  WireProfileQuantityTotal,
  WireQuantityContribution,
  WireQuantityDiagnostic,
  WireQuantityEngineInput,
  WireQuantityResult,
} from './types'

function getAnnotationMeta(annotation: { meta?: Record<string, unknown>; metadata?: Record<string, unknown> }) {
  return annotation.meta || annotation.metadata || {}
}

function cleanId(value: unknown): string {
  return String(value || '').trim()
}

function activePackageAnnotationIds(pkg: { selectedAnnotationIds?: string[] }) {
  const ids = new Set<string>()
  ;(pkg.selectedAnnotationIds || []).forEach((id) => { const clean = cleanId(id); if (clean) ids.add(clean) })
  return ids
}

function makeDiagnostic(type: WireQuantityDiagnostic['type'], message: string, patch: Partial<WireQuantityDiagnostic> = {}): WireQuantityDiagnostic {
  return { type, message, ...patch }
}

function stableSegmentId(meta: Record<string, unknown>, annotationId: string, index: number): { id: string; legacy: boolean } {
  const ids = Array.isArray(meta.segmentIds) ? meta.segmentIds : []
  const raw = ids[index]
  const id = typeof raw === 'string' && raw.trim() ? raw.trim() : `legacy:${annotationId}:${index}`
  return { id, legacy: id.startsWith('legacy:') }
}

function quantityLineId(parts: {
  projectId: string
  blueprintSetId: string
  pageNumber: number
  annotationId: string
  segmentId: string
}) {
  return [parts.projectId, parts.blueprintSetId, parts.pageNumber, parts.annotationId, encodeURIComponent(parts.segmentId)].join('|')
}

function sanitizeWastePercent(profile: WireProfile): number {
  const value = Number(profile.wastePercent)
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, value))
}

function totalKeyForContribution(contribution: WireQuantityContribution): string {
  const unit = contribution.unit || 'uncalibrated'
  const resolution = contribution.profileResolution
  if (resolution.status === 'active' || resolution.status === 'archived') return `${contribution.projectId}:${resolution.wireProfileId}:${unit}`
  if (resolution.status === 'missing-profile') return `missing:${resolution.wireProfileId}:${unit}`
  if (resolution.status === 'cross-project-profile') return `cross-project:${resolution.wireProfileId}:${unit}`
  if (contribution.calibrationStatus === 'uncalibrated') return `uncalibrated:${unit}`
  return `unassigned:${unit}`
}

function createEmptyTotal(contribution: WireQuantityContribution): WireProfileQuantityTotal {
  const resolution = contribution.profileResolution
  if (contribution.calibrationStatus === 'uncalibrated') {
    return unresolvedTotal(contribution, 'uncalibrated', 'Uncalibrated')
  }
  if (resolution.status === 'active' || resolution.status === 'archived') {
    return {
      key: totalKeyForContribution(contribution),
      groupKind: 'profile',
      wireProfileId: resolution.wireProfileId,
      profile: resolution.profile,
      profileStatus: resolution.status,
      displayName: resolution.profile.name,
      unit: contribution.unit,
      measuredLength: 0,
      wastePercent: sanitizeWastePercent(resolution.profile),
      wasteLength: 0,
      purchaseLength: 0,
      contributionIds: [],
      diagnostics: [],
    }
  }
  if (resolution.status === 'missing-profile') {
    return unresolvedTotal(contribution, 'missing-profile', `Missing Profile ${resolution.wireProfileId}`)
  }
  if (resolution.status === 'cross-project-profile') {
    return unresolvedTotal(contribution, 'cross-project-profile', `Cross-project Profile ${resolution.wireProfileId}`)
  }
  return unresolvedTotal(contribution, 'unassigned', 'Unassigned')
}

function unresolvedTotal(
  contribution: WireQuantityContribution,
  groupKind: WireProfileQuantityTotal['groupKind'],
  displayName: string,
): WireProfileQuantityTotal {
  return {
    key: totalKeyForContribution(contribution),
    groupKind,
    wireProfileId: contribution.profileResolution.wireProfileId,
    displayName,
    unit: contribution.unit,
    measuredLength: 0,
    wastePercent: null,
    wasteLength: null,
    purchaseLength: null,
    contributionIds: [],
    diagnostics: [],
  }
}

function totalSortRank(total: WireProfileQuantityTotal): number {
  if (total.groupKind === 'profile' && total.profileStatus === 'active') return 0
  if (total.groupKind === 'profile') return 1
  if (total.groupKind === 'unassigned') return 2
  if (total.groupKind === 'missing-profile') return 3
  if (total.groupKind === 'cross-project-profile') return 4
  return 5
}

function sortTotals(totals: WireProfileQuantityTotal[], profileOrder: Map<string, number>) {
  return totals.sort((a, b) => {
    const rank = totalSortRank(a) - totalSortRank(b)
    if (rank) return rank
    const aOrder = a.wireProfileId ? profileOrder.get(a.wireProfileId) ?? Number.POSITIVE_INFINITY : Number.POSITIVE_INFINITY
    const bOrder = b.wireProfileId ? profileOrder.get(b.wireProfileId) ?? Number.POSITIVE_INFINITY : Number.POSITIVE_INFINITY
    if (aOrder !== bOrder) return aOrder - bOrder
    const name = a.displayName.localeCompare(b.displayName)
    if (name) return name
    return String(a.unit || '').localeCompare(String(b.unit || ''))
  })
}

function aggregateTotals(contributions: readonly WireQuantityContribution[], profileOrder: Map<string, number>): WireProfileQuantityTotal[] {
  const totals = new Map<string, WireProfileQuantityTotal>()
  for (const contribution of contributions) {
    const key = totalKeyForContribution(contribution)
    const total = totals.get(key) || createEmptyTotal(contribution)
    if (contribution.measuredLength != null && contribution.unit) total.measuredLength += contribution.measuredLength
    total.contributionIds.push(contribution.quantityLineId)
    total.diagnostics.push(...contribution.diagnostics)
    totals.set(key, total)
  }
  const rows = [...totals.values()]
  for (const total of rows) {
    total.contributionIds.sort()
    if (total.wastePercent != null) {
      total.wasteLength = total.measuredLength * total.wastePercent / 100
      total.purchaseLength = total.measuredLength + total.wasteLength
    }
  }
  return sortTotals(rows, profileOrder)
}

function profileDisplayOrder(profiles: readonly WireProfile[]) {
  return new Map([...profiles]
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .map((profile, index) => [profile.id, index]))
}

function buildMembership(params: WireQuantityEngineInput, annotationsById: Map<string, unknown>) {
  const packageIdsByAnnotationId = new Map<string, Set<string>>()
  const diagnostics: WireQuantityDiagnostic[] = []
  const livePackages = sortWorkPackages(getLiveWorkPackages(params.workPackages))
  for (const pkg of livePackages) {
    for (const annotationId of activePackageAnnotationIds(pkg)) {
      if (!annotationsById.has(annotationId)) {
        diagnostics.push(makeDiagnostic('stale-package-reference', 'Work Package references a missing annotation.', {
          projectId: params.projectId,
          blueprintSetId: params.blueprintSetId,
          annotationId,
          packageId: pkg.id,
        }))
        continue
      }
      const set = packageIdsByAnnotationId.get(annotationId) || new Set<string>()
      set.add(pkg.id)
      packageIdsByAnnotationId.set(annotationId, set)
    }
  }
  return { packageIdsByAnnotationId, diagnostics, livePackages }
}

function diagnosticForResolution(contribution: WireQuantityContribution): WireQuantityDiagnostic | null {
  const base = {
    projectId: contribution.projectId,
    blueprintSetId: contribution.blueprintSetId,
    pageNumber: contribution.pageNumber,
    annotationId: contribution.annotationId,
    segmentId: contribution.segmentId,
    segmentIndex: contribution.segmentIndex,
    quantityLineId: contribution.quantityLineId,
    wireProfileId: contribution.profileResolution.wireProfileId,
    unit: contribution.unit,
  }
  switch (contribution.profileResolution.status) {
    case 'unassigned':
      return makeDiagnostic('unassigned-profile', 'Circuit segment has no Wire Profile.', base)
    case 'missing-profile':
      return makeDiagnostic('missing-profile', 'Circuit segment references a missing Wire Profile.', base)
    case 'cross-project-profile':
      return makeDiagnostic('cross-project-profile', 'Circuit segment references a Wire Profile from another project.', base)
    default:
      return null
  }
}

function addMixedUnitDiagnostics(contributions: WireQuantityContribution[], diagnostics: WireQuantityDiagnostic[]) {
  const unitsByProfile = new Map<string, Set<WireQuantityUnit>>()
  for (const contribution of contributions) {
    const resolution = contribution.profileResolution
    if ((resolution.status === 'active' || resolution.status === 'archived') && contribution.unit) {
      const units = unitsByProfile.get(resolution.wireProfileId) || new Set<WireQuantityUnit>()
      units.add(contribution.unit)
      unitsByProfile.set(resolution.wireProfileId, units)
    }
  }
  for (const [wireProfileId, units] of unitsByProfile) {
    if (units.size < 2) continue
    diagnostics.push(makeDiagnostic('mixed-units-for-profile', 'Wire Profile has measured contributions in multiple units.', {
      projectId: contributions[0]?.projectId,
      blueprintSetId: contributions[0]?.blueprintSetId,
      wireProfileId,
    }))
  }
}

export function buildWireQuantityResult(input: WireQuantityEngineInput): WireQuantityResult {
  const annotations = [...input.annotations]
    .filter((annotation) => !annotation.deletedAt && annotation.projectId === input.projectId && annotation.blueprintSetId === input.blueprintSetId)
    .sort((a, b) => Number(a.pageNumber) - Number(b.pageNumber) || a.id.localeCompare(b.id))
  const annotationsById = new Map(annotations.map((annotation) => [annotation.id, annotation]))
  const { packageIdsByAnnotationId, diagnostics, livePackages } = buildMembership(input, annotationsById)
  const contributions: WireQuantityContribution[] = []

  for (const annotation of annotations) {
    if (annotation.type !== 'shape') continue
    const meta = getAnnotationMeta(annotation)
    const shapeKind = meta.shapeKind === 'circuit-arc' ? 'circuit-arc' : meta.shapeKind === 'circuit-path' ? 'circuit-path' : null
    if (!shapeKind) continue
    const pageNumber = Math.max(1, Math.floor(Number(annotation.pageNumber) || 1))
    const pageSize = input.getPageSizeInches(pageNumber)
    const calibration = resolveEffectiveCalibration({
      pageNumber,
      savedCalibrations: input.savedCalibrations,
      detectedScales: input.detectedScales,
      pageSize,
    })
    const measurements = measureCircuitRoute({ points: meta.points, shapeKind, arcCtrls: meta.arcCtrls, calibration, pageSize })
    const packageIds = [...(packageIdsByAnnotationId.get(annotation.id) || new Set<string>())].sort()

    measurements.forEach((measurement, index) => {
      const identity = stableSegmentId(meta, annotation.id, index)
      const qid = quantityLineId({ projectId: input.projectId, blueprintSetId: input.blueprintSetId, pageNumber, annotationId: annotation.id, segmentId: identity.id })
      const contributionDiagnostics: WireQuantityDiagnostic[] = []
      if (identity.legacy) {
        contributionDiagnostics.push(makeDiagnostic('legacy-segment-identity', 'Circuit segment uses a deterministic legacy identity.', {
          projectId: input.projectId, blueprintSetId: input.blueprintSetId, pageNumber, annotationId: annotation.id, segmentId: identity.id, segmentIndex: index, quantityLineId: qid,
        }))
      }
      if (measurement.status === 'invalid-geometry') {
        contributionDiagnostics.push(makeDiagnostic('invalid-geometry', 'Circuit segment geometry is invalid.', {
          projectId: input.projectId, blueprintSetId: input.blueprintSetId, pageNumber, annotationId: annotation.id, segmentId: identity.id, segmentIndex: index, quantityLineId: qid,
        }))
      }
      if (measurement.status === 'zero-length') {
        contributionDiagnostics.push(makeDiagnostic('zero-length-segment', 'Circuit segment has zero measurable length.', {
          projectId: input.projectId, blueprintSetId: input.blueprintSetId, pageNumber, annotationId: annotation.id, segmentId: identity.id, segmentIndex: index, quantityLineId: qid,
        }))
      }
      if (measurement.status === 'uncalibrated') {
        const type = measurement.reason === 'not-to-scale'
          ? 'not-to-scale-page'
          : measurement.reason === 'ambiguous'
            ? 'ambiguous-scale-page'
            : 'uncalibrated-segment'
        contributionDiagnostics.push(makeDiagnostic(type, 'Circuit segment cannot be measured until its page has a usable scale.', {
          projectId: input.projectId, blueprintSetId: input.blueprintSetId, pageNumber, annotationId: annotation.id, segmentId: identity.id, segmentIndex: index, quantityLineId: qid,
        }))
      }
      if (measurement.status === 'missing-page-dimensions') {
        contributionDiagnostics.push(makeDiagnostic('missing-page-dimensions', 'Circuit segment cannot be measured because page dimensions are missing or invalid.', {
          projectId: input.projectId, blueprintSetId: input.blueprintSetId, pageNumber, annotationId: annotation.id, segmentId: identity.id, segmentIndex: index, quantityLineId: qid,
        }))
      }

      const contribution: WireQuantityContribution = {
        quantityLineId: qid,
        projectId: input.projectId,
        blueprintSetId: input.blueprintSetId,
        pageNumber,
        annotationId: annotation.id,
        segmentId: identity.id,
        segmentIndex: index,
        shapeKind,
        packageIds,
        isUnpackaged: packageIds.length === 0,
        profileResolution: resolveSegmentWireProfile({
          projectId: input.projectId,
          annotationMeta: meta,
          stableSegmentId: identity.id,
          wireProfiles: input.wireProfiles,
        }),
        measuredLength: measurement.status === 'measured' ? measurement.length.value : null,
        unit: measurement.status === 'measured' ? measurement.length.unit : null,
        calibrationStatus: measurement.status === 'measured' ? 'calibrated' : 'uncalibrated',
        diagnostics: contributionDiagnostics,
      }

      const resolutionDiagnostic = diagnosticForResolution(contribution)
      if (resolutionDiagnostic) contribution.diagnostics.push(resolutionDiagnostic)
      if (contribution.isUnpackaged) {
        contribution.diagnostics.push(makeDiagnostic('unpackaged-contribution', 'Circuit segment is not referenced by any active Work Package.', {
          projectId: input.projectId, blueprintSetId: input.blueprintSetId, pageNumber, annotationId: annotation.id, segmentId: identity.id, segmentIndex: index, quantityLineId: qid,
        }))
      }
      if (contribution.packageIds.length > 1) {
        contribution.diagnostics.push(makeDiagnostic('duplicate-package-membership', 'Circuit segment appears in multiple active Work Packages.', {
          projectId: input.projectId, blueprintSetId: input.blueprintSetId, pageNumber, annotationId: annotation.id, segmentId: identity.id, segmentIndex: index, quantityLineId: qid, packageIds: contribution.packageIds,
        }))
      }
      contributions.push(contribution)
    })
  }

  contributions.sort((a, b) => a.pageNumber - b.pageNumber || a.annotationId.localeCompare(b.annotationId) || a.segmentIndex - b.segmentIndex || a.segmentId.localeCompare(b.segmentId))
  const allDiagnostics = [...diagnostics, ...contributions.flatMap((contribution) => contribution.diagnostics)]
  addMixedUnitDiagnostics(contributions, allDiagnostics)
  const order = profileDisplayOrder(input.wireProfiles)
  const projectTotals = aggregateTotals(contributions, order)
  const unpackaged = contributions.filter((contribution) => contribution.isUnpackaged)
  const packageRollups: PackageWireQuantityRollup[] = livePackages.map((pkg) => {
    const ids = activePackageAnnotationIds(pkg)
    const packageContributions = contributions.filter((contribution) => ids.has(contribution.annotationId))
    return {
      packageId: pkg.id,
      packageName: pkg.name,
      totals: aggregateTotals(packageContributions, order),
      contributionIds: packageContributions.map((contribution) => contribution.quantityLineId).sort(),
      diagnostics: packageContributions.flatMap((contribution) => contribution.diagnostics),
    }
  })
  return {
    contributions,
    projectTotals,
    packageRollups,
    unpackagedTotals: aggregateTotals(unpackaged, order),
    diagnostics: allDiagnostics,
  }
}

export function buildEffectiveWorkPackagesForPreview<T extends {
  id: string
  deletedAt?: string
  selectedAnnotationIds: string[]
}>(params: {
  workPackages: readonly T[]
  draftPackage: T
}): T[] {
  const draftId = cleanId(params.draftPackage.id)
  const live = getLiveWorkPackages(params.workPackages)
  let replaced = false
  const next = live.map((pkg) => {
    if (cleanId(pkg.id) !== draftId) return pkg
    replaced = true
    return params.draftPackage
  })
  if (!replaced) next.push(params.draftPackage)
  return next
}
