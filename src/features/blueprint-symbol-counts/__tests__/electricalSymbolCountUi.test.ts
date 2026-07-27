import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ScopeLayerTotalsControls } from '@/components/blueprint/OperationsBlueprintPdfViewer'
import { ElectricalSymbolCountSummary, ElectricalSymbolGlyph, ElectricalSymbolTotalsDialog, buildElectricalSymbolCountResult, createElectricalSymbolTotalsEscapeHandler, ELECTRICAL_SYMBOL_OPTIONS, getElectricalSymbolDiagnosticCounts, getGroupedDuplicateMembershipDiagnostics, getGroupedStaleReferenceDiagnostics } from '..'
import type { BlueprintAnnotation } from '@/services/blueprintLibraryService'

function ann(id: string, shapeKind: string): BlueprintAnnotation {
  return {
    id,
    projectId: 'project-1',
    blueprintSetId: 'set-1',
    pageNumber: 1,
    type: 'shape',
    color: '#38bdf8',
    meta: { shapeKind },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as BlueprintAnnotation
}

function element(type: React.ElementType, props: Record<string, unknown> = {}) {
  return React.createElement(type, props)
}

function textContent(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textContent).join('')
  if (React.isValidElement(node)) return textContent(node.props.children)
  return ''
}

function findElements(node: React.ReactNode, predicate: (element: React.ReactElement) => boolean): React.ReactElement[] {
  const found: React.ReactElement[] = []
  function visit(current: React.ReactNode) {
    if (Array.isArray(current)) {
      current.forEach(visit)
      return
    }
    if (!React.isValidElement(current)) return
    if (predicate(current)) found.push(current)
    React.Children.forEach(current.props.children, visit)
  }
  visit(node)
  return found
}

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1
}

describe('blueprint-symbol-counts UI', () => {
  it('renders a compact decorative glyph for every registered kind through the authoritative renderer', () => {
    for (const option of ELECTRICAL_SYMBOL_OPTIONS) {
      const markup = renderToStaticMarkup(element(ElectricalSymbolGlyph, { shapeKind: option.value }))
      expect(markup).toContain(`data-electrical-symbol-glyph="${option.value}"`)
      expect(markup).toContain('aria-hidden="true"')
      expect(markup).not.toContain('<image')
    }
  })

  it('renders specific symbol glyph content for exit signs, sensors, and can lights', () => {
    expect(renderToStaticMarkup(element(ElectricalSymbolGlyph, { shapeKind: 'electrical-emergency-exit-sign' }))).toContain('EXIT')
    expect(renderToStaticMarkup(element(ElectricalSymbolGlyph, { shapeKind: 'electrical-ceiling-occupancy-sensor' }))).toContain('A19 19')
    expect(renderToStaticMarkup(element(ElectricalSymbolGlyph, { shapeKind: 'electrical-wall-occupancy-sensor' }))).toContain('width="44"')
    expect(renderToStaticMarkup(element(ElectricalSymbolGlyph, { shapeKind: 'can-light-4' }))).toContain('4&quot;')
    expect(renderToStaticMarkup(element(ElectricalSymbolGlyph, { shapeKind: 'can-light-6' }))).toContain('6&quot;')
  })

  it('shows Work Package summary glyph, visible name, count, copy, and empty state without labor or pricing', () => {
    const result = buildElectricalSymbolCountResult({
      projectId: 'project-1',
      blueprintSetId: 'set-1',
      annotations: [ann('a1', 'electrical-receptacle')],
      workPackages: [{ id: 'pkg-a', name: 'Package A', selectedAnnotationIds: ['a1'], itemRefs: [], visible: true } as any],
    })
    const rollup = result.packageRollups[0]
    const markup = renderToStaticMarkup(element(ElectricalSymbolCountSummary, { totals: rollup.totals, contributions: result.contributions }))
    expect(markup).toContain('Electrical Symbol Counts')
    expect(markup).toContain('Package attribution only')
    expect(markup).toContain('Receptacle')
    expect(markup).toContain('data-electrical-symbol-glyph="electrical-receptacle"')
    expect(markup).not.toMatch(/labor|pricing/i)

    const empty = renderToStaticMarkup(element(ElectricalSymbolCountSummary, { totals: [], contributions: [] }))
    expect(empty).toContain('No registered electrical symbols are attributed')
  })

  it('renders the totals dialog with collapsed diagnostics, summary counts, rows, pages, and empty states', () => {
    const result = buildElectricalSymbolCountResult({
      projectId: 'project-1',
      blueprintSetId: 'set-1',
      annotations: [ann('a1', 'electrical-receptacle'), ann('a2', 'can-light-4')],
      workPackages: [
        { id: 'pkg-a', name: 'Package A', selectedAnnotationIds: ['a1', 'missing'], itemRefs: [], visible: true } as any,
        { id: 'pkg-b', name: 'Package B', selectedAnnotationIds: ['a1'], itemRefs: [], visible: true } as any,
      ],
    })
    const markup = renderToStaticMarkup(element(ElectricalSymbolTotalsDialog, { result, onClose: () => {} }))
    expect(markup).toContain('Electrical Symbol Totals')
    expect(markup).toContain('Current blueprint set')
    expect(markup).toContain('Unique symbols')
    expect(markup).toContain('Category Subtotals')
    expect(markup).toContain('4-inch Can Light')
    expect(markup).toContain('Receptacle')
    expect(markup).toContain('Pg 1')
    expect(markup).toContain('1 total warnings - 1 duplicate memberships - 0 stale references')
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).toContain('aria-controls=')
    expect(markup).toContain('Expand electrical symbol diagnostics details')
    expect(markup).not.toContain('Shared in: Package A, Package B')
    expect(markup).not.toContain('Stale selectedAnnotationId references')

    const emptyResult = buildElectricalSymbolCountResult({ projectId: 'project-1', blueprintSetId: 'set-1', annotations: [], workPackages: [] })
    const empty = renderToStaticMarkup(element(ElectricalSymbolTotalsDialog, { result: emptyResult, onClose: () => {} }))
    expect(empty).toContain('No registered electrical symbols in this blueprint set')
    expect(empty).toContain('No issues detected')
    expect(empty).not.toContain('aria-controls=')
    expect(empty).not.toContain('Expand electrical symbol diagnostics details')
  })

  it('builds grouped diagnostics without changing duplicate or stale diagnostic counts', () => {
    const result = buildElectricalSymbolCountResult({
      projectId: 'project-1',
      blueprintSetId: 'set-1',
      annotations: [ann('a1', 'electrical-receptacle'), ann('a2', 'can-light-4')],
      workPackages: [
        { id: 'pkg-a', name: 'Package A', selectedAnnotationIds: ['a1', 'missing'], itemRefs: [], visible: true } as any,
        { id: 'pkg-b', name: 'Package B', selectedAnnotationIds: ['a1'], itemRefs: [], visible: true } as any,
      ],
    })
    const duplicated = result.diagnostics.find((diagnostic) => diagnostic.type === 'duplicate-package-membership')
    const staleLikeDuplicate = duplicated && { ...duplicated }
    const diagnostics = staleLikeDuplicate ? [...result.diagnostics, staleLikeDuplicate] : result.diagnostics
    const counts = getElectricalSymbolDiagnosticCounts(diagnostics)
    const duplicateRows = getGroupedDuplicateMembershipDiagnostics(diagnostics, result.contributions)
    const staleRows = getGroupedStaleReferenceDiagnostics(diagnostics)

    expect(counts.duplicateCount).toBe(2)
    expect(counts.staleCount).toBe(0)
    expect(duplicateRows).toHaveLength(1)
    expect(duplicateRows[0]).toMatchObject({
      displayName: 'Receptacle',
      pageNumber: 1,
      packageNames: ['Package A', 'Package B'],
      representedCount: 2,
    })
    expect(staleRows).toHaveLength(0)
  })

  it('summarizes stale reference diagnostics with Work Package names', () => {
    const result = buildElectricalSymbolCountResult({
      projectId: 'project-1',
      blueprintSetId: 'set-1',
      annotations: [{ ...ann('missing', 'electrical-receptacle'), deletedAt: '2026-01-02T00:00:00.000Z' } as BlueprintAnnotation],
      workPackages: [{ id: 'pkg-a', name: 'Package A', selectedAnnotationIds: ['missing'], itemRefs: [], visible: true } as any],
    })
    const counts = getElectricalSymbolDiagnosticCounts(result.diagnostics)
    const staleRows = getGroupedStaleReferenceDiagnostics(result.diagnostics)

    expect(counts.duplicateCount).toBe(0)
    expect(counts.staleCount).toBe(1)
    expect(staleRows).toEqual([
      expect.objectContaining({
        packageName: 'Package A',
        message: 'Work Package references a deleted or out-of-scope electrical symbol.',
      }),
    ])
  })

  it('renders one totals control, opens one dialog, closes it, and keeps the package summary present', () => {
    let projectWireOpenCount = 0
    let electricalDialogOpen = false
    let pageScopeToggled = false
    const result = buildElectricalSymbolCountResult({
      projectId: 'project-1',
      blueprintSetId: 'set-1',
      annotations: [ann('a1', 'electrical-receptacle')],
      workPackages: [{ id: 'pkg-a', name: 'Package A', selectedAnnotationIds: ['a1'], itemRefs: [], visible: true } as any],
    })

    const controls = ScopeLayerTotalsControls({
      onOpenProjectWireTotals: () => { projectWireOpenCount += 1 },
      onOpenElectricalSymbolTotals: () => { electricalDialogOpen = true },
      scopeLayerShowAllPages: false,
      onToggleScopeLayerPages: () => { pageScopeToggled = true },
    })
    const controlsMarkup = renderToStaticMarkup(controls)
    expect(countOccurrences(controlsMarkup, 'Project Wire Totals')).toBe(1)
    expect(countOccurrences(controlsMarkup, 'Electrical Symbol Totals')).toBe(1)

    const buttons = findElements(controls, (candidate) => candidate.type === 'button')
    const projectWireButton = buttons.find((candidate) => textContent(candidate) === 'Project Wire Totals')
    const electricalButton = buttons.find((candidate) => textContent(candidate) === 'Electrical Symbol Totals')
    const pageScopeButton = buttons.find((candidate) => textContent(candidate).startsWith('Showing:'))
    expect(projectWireButton).toBeTruthy()
    expect(electricalButton).toBeTruthy()
    expect(pageScopeButton).toBeTruthy()

    projectWireButton?.props.onClick()
    pageScopeButton?.props.onClick()
    expect(projectWireOpenCount).toBe(1)
    expect(pageScopeToggled).toBe(true)

    expect(electricalDialogOpen).toBe(false)
    electricalButton?.props.onClick()
    expect(electricalDialogOpen).toBe(true)

    const dialog = element(ElectricalSymbolTotalsDialog, {
      result,
      onClose: () => { electricalDialogOpen = false },
    })
    const dialogMarkup = renderToStaticMarkup(dialog)
    expect(dialogMarkup).toContain('role="dialog"')
    expect(countOccurrences(dialogMarkup, 'Electrical Symbol Totals')).toBe(1)

    const escapeHandler = createElectricalSymbolTotalsEscapeHandler(() => { electricalDialogOpen = false })
    escapeHandler({ key: 'Escape' } as KeyboardEvent)
    expect(electricalDialogOpen).toBe(false)

    const rollup = result.packageRollups[0]
    const packageSummaryMarkup = renderToStaticMarkup(element(ElectricalSymbolCountSummary, {
      totals: rollup.totals,
      contributions: result.contributions,
    }))
    expect(packageSummaryMarkup).toContain('Electrical Symbol Counts')
    expect(packageSummaryMarkup).toContain('Package attribution only')
  })
})
