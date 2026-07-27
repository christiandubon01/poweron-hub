import { getLiveWorkPackages, sortWorkPackages } from '@/features/blueprint-work-packages'
import {
  ELECTRICAL_SYMBOL_CATEGORY_ORDER,
  ELECTRICAL_SYMBOL_KIND_ORDER,
  ELECTRICAL_SYMBOL_METADATA,
  getElectricalSymbolMetadata,
  isElectricalShapeKind,
  type ElectricalSymbolCategory,
  type ElectricalSymbolKind,
} from '@/components/blueprint/electricalSymbolRegistry'
import {
  type ElectricalSymbolCategoryTotal,
  type ElectricalSymbolContribution,
  type ElectricalSymbolCountDiagnostic,
  type ElectricalSymbolCountDiagnosticType,
  type ElectricalSymbolCountEngineInput,
  type ElectricalSymbolCountResult,
  type ElectricalSymbolTypeTotal,
  type PackageElectricalSymbolRollup,
} from './types'

function getAnnotationMeta(annotation: { meta?: Record<string, unknown>; metadata?: Record<string, unknown> }) {
  return annotation.meta || annotation.metadata || {}
}

function cleanId(value: unknown): string {
  return String(value || '').trim()
}

function pageNumberOf(value: unknown): number {
  return Math.max(1, Math.floor(Number(value) || 1))
}

function makeDiagnostic(type: ElectricalSymbolCountDiagnosticType, message: string, patch: Partial<ElectricalSymbolCountDiagnostic> = {}): ElectricalSymbolCountDiagnostic {
  return { type, message, ...patch }
}

function activePackageAnnotationIds(pkg: { selectedAnnotationIds?: string[] }) {
  const ids = new Set<string>()
  ;(pkg.selectedAnnotationIds || []).forEach((id) => {
    const clean = cleanId(id)
    if (clean) ids.add(clean)
  })
  return ids
}

function compareSymbolKinds(a: ElectricalSymbolKind, b: ElectricalSymbolKind): number {
  const aMeta = ELECTRICAL_SYMBOL_METADATA[a]
  const bMeta = ELECTRICAL_SYMBOL_METADATA[b]
  const category = ELECTRICAL_SYMBOL_CATEGORY_ORDER.indexOf(aMeta.category) - ELECTRICAL_SYMBOL_CATEGORY_ORDER.indexOf(bMeta.category)
  if (category) return category
  const order = (ELECTRICAL_SYMBOL_KIND_ORDER.get(a) ?? Number.POSITIVE_INFINITY) - (ELECTRICAL_SYMBOL_KIND_ORDER.get(b) ?? Number.POSITIVE_INFINITY)
  if (order) return order
  const name = aMeta.displayName.localeCompare(bMeta.displayName)
  return name || a.localeCompare(b)
}

function compareTotals(a: ElectricalSymbolTypeTotal, b: ElectricalSymbolTypeTotal): number {
  return compareSymbolKinds(a.shapeKind, b.shapeKind)
}

function collectLiveAnnotations(input: ElectricalSymbolCountEngineInput) {
  const annotationsById = new Map<string, typeof input.annotations[number]>()
  const knownElectricalAnnotationsById = new Map<string, typeof input.annotations[number]>()
  const diagnostics: ElectricalSymbolCountDiagnostic[] = []

  for (const annotation of input.annotations) {
    const annotationId = cleanId(annotation.id)
    const pageNumber = pageNumberOf(annotation.pageNumber)
    const diagnosticBase = {
      projectId: input.projectId,
      blueprintSetId: input.blueprintSetId,
      pageNumber,
      annotationId: annotationId || undefined,
      shapeKind: String(getAnnotationMeta(annotation).shapeKind || ''),
    }
    if (annotationId && annotation.type === 'shape' && isElectricalShapeKind(getAnnotationMeta(annotation).shapeKind)) {
      knownElectricalAnnotationsById.set(annotationId, annotation)
    }

    if (!annotationId) {
      if (annotation.type === 'shape') {
        diagnostics.push(makeDiagnostic('missing-annotation-id', 'Shape annotation has no stable annotation ID.', diagnosticBase))
      }
      continue
    }
    if (annotation.deletedAt) continue
    if (annotation.projectId !== input.projectId || annotation.blueprintSetId !== input.blueprintSetId) {
      if (annotation.type === 'shape' && isElectricalShapeKind(getAnnotationMeta(annotation).shapeKind)) {
        diagnostics.push(makeDiagnostic('scope-mismatch', 'Electrical symbol annotation is outside the requested project or blueprint set.', diagnosticBase))
      }
      continue
    }
    if (annotationsById.has(annotationId)) {
      diagnostics.push(makeDiagnostic('duplicate-live-annotation-id', 'Live annotations share one stable annotation ID; counted once.', diagnosticBase))
      continue
    }
    annotationsById.set(annotationId, annotation)
  }

  return { annotationsById, diagnostics, knownElectricalAnnotationsById }
}

function buildMembership(
  input: ElectricalSymbolCountEngineInput,
  annotationsById: Map<string, unknown>,
  knownElectricalAnnotationsById: Map<string, { pageNumber?: number; meta?: Record<string, unknown>; metadata?: Record<string, unknown> }>,
) {
  const packageIdsByAnnotationId = new Map<string, Set<string>>()
  const packageNameById = new Map<string, string>()
  const diagnostics: ElectricalSymbolCountDiagnostic[] = []
  const livePackages = sortWorkPackages(getLiveWorkPackages(input.workPackages))

  for (const pkg of livePackages) {
    packageNameById.set(pkg.id, pkg.name)
    for (const annotationId of activePackageAnnotationIds(pkg)) {
      if (!annotationsById.has(annotationId)) {
        const knownElectricalAnnotation = knownElectricalAnnotationsById.get(annotationId)
        if (knownElectricalAnnotation) {
          diagnostics.push(makeDiagnostic('stale-package-reference', 'Work Package references a deleted or out-of-scope electrical symbol.', {
            projectId: input.projectId,
            blueprintSetId: input.blueprintSetId,
            annotationId,
            packageId: pkg.id,
            packageNames: [pkg.name],
            pageNumber: pageNumberOf(knownElectricalAnnotation.pageNumber),
            shapeKind: String(getAnnotationMeta(knownElectricalAnnotation).shapeKind || ''),
          }))
        }
        continue
      }
      const set = packageIdsByAnnotationId.get(annotationId) || new Set<string>()
      set.add(pkg.id)
      packageIdsByAnnotationId.set(annotationId, set)
    }
  }

  return { packageIdsByAnnotationId, packageNameById, diagnostics, livePackages }
}

function emptySymbolTotal(shapeKind: ElectricalSymbolKind): ElectricalSymbolTypeTotal {
  const metadata = getElectricalSymbolMetadata(shapeKind)
  if (!metadata) {
    throw new Error(`Missing electrical symbol metadata for ${shapeKind}`)
  }
  return {
    shapeKind,
    displayName: metadata.displayName,
    shortLabel: metadata.shortLabel,
    category: metadata.category,
    count: 0,
    annotationIds: [],
    pages: [],
    packageIds: [],
    diagnostics: [],
  }
}

function aggregateSymbolTotals(contributions: readonly ElectricalSymbolContribution[], diagnostics: readonly ElectricalSymbolCountDiagnostic[] = []): ElectricalSymbolTypeTotal[] {
  const totals = new Map<ElectricalSymbolKind, ElectricalSymbolTypeTotal>()
  const diagnosticsByAnnotationId = new Map<string, ElectricalSymbolCountDiagnostic[]>()
  diagnostics.forEach((diagnostic) => {
    if (!diagnostic.annotationId) return
    const list = diagnosticsByAnnotationId.get(diagnostic.annotationId) || []
    list.push(diagnostic)
    diagnosticsByAnnotationId.set(diagnostic.annotationId, list)
  })

  for (const contribution of contributions) {
    const total = totals.get(contribution.shapeKind) || emptySymbolTotal(contribution.shapeKind)
    total.count += 1
    total.annotationIds.push(contribution.annotationId)
    total.pages.push(contribution.pageNumber)
    total.packageIds.push(...contribution.packageIds)
    total.diagnostics.push(...(diagnosticsByAnnotationId.get(contribution.annotationId) || []))
    totals.set(contribution.shapeKind, total)
  }

  return [...totals.values()].map((total) => ({
    ...total,
    annotationIds: [...new Set(total.annotationIds)].sort(),
    pages: [...new Set(total.pages)].sort((a, b) => a - b),
    packageIds: [...new Set(total.packageIds)].sort(),
  })).sort(compareTotals)
}

function aggregateCategoryTotals(contributions: readonly ElectricalSymbolContribution[]): ElectricalSymbolCategoryTotal[] {
  const totals = new Map<ElectricalSymbolCategory, ElectricalSymbolCategoryTotal>()
  for (const contribution of contributions) {
    const total = totals.get(contribution.category) || {
      category: contribution.category,
      count: 0,
      shapeKinds: [],
      annotationIds: [],
    }
    total.count += 1
    total.shapeKinds.push(contribution.shapeKind)
    total.annotationIds.push(contribution.annotationId)
    totals.set(contribution.category, total)
  }
  return [...totals.values()].map((total) => ({
    ...total,
    shapeKinds: [...new Set(total.shapeKinds)].sort(compareSymbolKinds),
    annotationIds: [...new Set(total.annotationIds)].sort(),
  })).sort((a, b) => ELECTRICAL_SYMBOL_CATEGORY_ORDER.indexOf(a.category) - ELECTRICAL_SYMBOL_CATEGORY_ORDER.indexOf(b.category))
}

export function buildElectricalSymbolCountResult(input: ElectricalSymbolCountEngineInput): ElectricalSymbolCountResult {
  const { annotationsById, diagnostics, knownElectricalAnnotationsById } = collectLiveAnnotations(input)
  const { packageIdsByAnnotationId, packageNameById, diagnostics: membershipDiagnostics, livePackages } = buildMembership(input, annotationsById, knownElectricalAnnotationsById)
  diagnostics.push(...membershipDiagnostics)

  const contributions: ElectricalSymbolContribution[] = []
  for (const annotation of annotationsById.values()) {
    if (annotation.type !== 'shape') continue
    const annotationId = cleanId(annotation.id)
    if (!annotationId) continue
    const meta = getAnnotationMeta(annotation)
    const shapeKind = meta.shapeKind
    if (!shapeKind) continue
    if (!isElectricalShapeKind(shapeKind)) {
      if (typeof shapeKind === 'string' && shapeKind.startsWith('electrical-')) {
        diagnostics.push(makeDiagnostic('unregistered-electrical-shape-kind', 'Shape kind looks electrical but is not registered.', {
          projectId: input.projectId,
          blueprintSetId: input.blueprintSetId,
          pageNumber: pageNumberOf(annotation.pageNumber),
          annotationId,
          shapeKind,
        }))
      }
      continue
    }
    const metadata = getElectricalSymbolMetadata(shapeKind)
    if (!metadata) {
      diagnostics.push(makeDiagnostic('missing-symbol-metadata', 'Registered electrical symbol is missing metadata.', {
        projectId: input.projectId,
        blueprintSetId: input.blueprintSetId,
        pageNumber: pageNumberOf(annotation.pageNumber),
        annotationId,
        shapeKind,
      }))
      continue
    }
    const packageIds = [...(packageIdsByAnnotationId.get(annotationId) || new Set<string>())].sort()
    contributions.push({
      annotationId,
      projectId: input.projectId,
      blueprintSetId: input.blueprintSetId,
      pageNumber: pageNumberOf(annotation.pageNumber),
      shapeKind,
      displayName: metadata.displayName,
      shortLabel: metadata.shortLabel,
      category: metadata.category,
      packageIds,
      packageNames: packageIds.map((packageId) => packageNameById.get(packageId) || packageId),
    })
  }

  for (const contribution of contributions) {
    if (contribution.packageIds.length <= 1) continue
    diagnostics.push(makeDiagnostic('duplicate-package-membership', 'Electrical symbol appears in multiple active Work Packages.', {
      projectId: input.projectId,
      blueprintSetId: input.blueprintSetId,
      annotationId: contribution.annotationId,
      pageNumber: contribution.pageNumber,
      packageIds: contribution.packageIds,
      packageNames: contribution.packageNames,
      shapeKind: contribution.shapeKind,
    }))
  }

  contributions.sort((a, b) => compareSymbolKinds(a.shapeKind, b.shapeKind) || a.pageNumber - b.pageNumber || a.annotationId.localeCompare(b.annotationId))

  const packageRollups: PackageElectricalSymbolRollup[] = livePackages.map((pkg) => {
    const ids = activePackageAnnotationIds(pkg)
    const packageContributions = contributions.filter((contribution) => ids.has(contribution.annotationId))
    return {
      packageId: pkg.id,
      packageName: pkg.name,
      totals: aggregateSymbolTotals(packageContributions, diagnostics),
      contributionIds: packageContributions.map((contribution) => contribution.annotationId).sort(),
      diagnostics: diagnostics.filter((diagnostic) => diagnostic.packageId === pkg.id || diagnostic.packageIds?.includes(pkg.id)),
    }
  })

  return {
    contributions,
    symbolTotals: aggregateSymbolTotals(contributions, diagnostics),
    categoryTotals: aggregateCategoryTotals(contributions),
    packageRollups,
    overallCount: contributions.length,
    diagnostics,
  }
}
