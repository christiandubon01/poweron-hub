import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { buildManualKnownDistanceCalibration } from '@/features/blueprint-measurements'
import { buildElectricalSymbolCountResult } from '@/features/blueprint-symbol-counts'
import { buildWireQuantityResult } from '@/features/blueprint-wire-quantities'
import { supportsWireProfileAssignment } from '@/features/blueprint-wire-profiles'
import {
  inferRouteBuilderDefaultChannel,
  inferRouteBuilderNodeRoles,
  isRouteBuilderLoadKind,
  isRouteBuilderSourceKind,
} from '@/features/blueprint-animation/routeBuilderModel'
import type { BlueprintAnnotation, BlueprintScopeLayer } from '@/services/blueprintLibraryService'
import {
  getElectricalSymbolMetadata,
  getElectricalSymbolMetadataStamp,
  isLightOutputShapeKind,
  isRotatableElectricalShapeKind,
  renderElectricalSymbolSvg,
} from '../electricalSymbolRegistry'
import {
  DESKTOP_ELECTRICAL_TOOL_CATEGORIES,
  DESKTOP_LIGHTING_CATEGORY_ID,
  DESKTOP_LIGHTING_KINDS,
  shouldShowElectricalSymbolInDesktopMainGrid,
  shouldShowElectricalSymbolInLegacyNonDesktopToolbar,
} from '../desktopElectricalToolCategories'

const viewerSource = readFileSync(
  join(process.cwd(), 'src/components/blueprint/OperationsBlueprintPdfViewer.tsx'),
  'utf8',
)

function ledStripAnnotation(id = 'led-strip-1', points = [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.1 }, { x: 0.7, y: 0.3 }]): BlueprintAnnotation {
  const meta = {
    shapeKind: 'electrical-led-strip',
    points,
    pathType: 'led-strip',
    closed: false,
    ...getElectricalSymbolMetadataStamp('electrical-led-strip'),
  }
  return {
    id,
    projectId: 'project-1',
    blueprintSetId: 'set-1',
    pageNumber: 1,
    type: 'shape',
    color: '#fbbf24',
    rect: { x: 0.1, y: 0.1, w: 0.6, h: 0.2 },
    meta,
    metadata: meta,
    createdAt: '2026-07-27T00:00:00.000Z',
    updatedAt: '2026-07-27T00:00:00.000Z',
  } as BlueprintAnnotation
}

function pkg(selectedAnnotationIds: string[]): BlueprintScopeLayer {
  return {
    id: 'pkg-1',
    name: 'Package 1',
    description: '',
    color: '#fbbf24',
    selectedAnnotationIds,
    itemRefs: [],
    roughInHours: 0,
    trimHours: 0,
    testingHours: 0,
    cleanupHours: 0,
    crewNotes: '',
    proposalSummary: '',
    createdAt: '2026-07-27T00:00:00.000Z',
    updatedAt: '2026-07-27T00:00:00.000Z',
    visible: true,
    isolated: false,
  } as BlueprintScopeLayer
}

describe('LED Strip lighting symbol', () => {
  it('registers exact owner-facing metadata and glyph as a non-rotatable light-output symbol', () => {
    expect(getElectricalSymbolMetadata('electrical-led-strip')).toMatchObject({
      symbolKind: 'electrical-led-strip',
      displayName: 'LED Strip',
      shortLabel: 'LED',
      category: 'lighting',
      countValue: 1,
      defaultPhase: 'electrical',
      materialKey: 'led-strip',
      laborKey: 'led-strip',
      isElectricalSymbol: true,
    })
    expect(getElectricalSymbolMetadataStamp('electrical-led-strip')).toEqual({
      symbolCategory: 'lighting',
      countValue: 1,
      materialKey: 'led-strip',
      laborKey: 'led-strip',
    })
    expect(isLightOutputShapeKind('electrical-led-strip')).toBe(true)
    expect(isRotatableElectricalShapeKind('electrical-led-strip')).toBe(false)

    const markup = renderToStaticMarkup(
      React.createElement('svg', { viewBox: '0 0 100 100' }, renderElectricalSymbolSvg('electrical-led-strip', {}, {
        borderColor: '#fbbf24',
        borderThickness: 2,
        borderStyle: 'solid',
        fillColor: 'transparent',
        fillOpacity: 0,
        labelsVisible: true,
      })),
    )
    expect(markup).toContain('LED')
    expect(markup).toContain('<circle')
    expect(markup).not.toContain('<image')
    expect(markup).not.toContain('XFMR')
  })

  it('is the fifth Lighting child, desktop-category-only, and hidden on legacy non-desktop', () => {
    expect(DESKTOP_LIGHTING_KINDS).toEqual([
      'electrical-led-panel-2x2',
      'electrical-led-panel-2x4',
      'electrical-sconce',
      'electrical-pendant-light',
      'electrical-led-strip',
      'electrical-low-voltage-transformer',
    ])
    expect(DESKTOP_LIGHTING_KINDS[4]).toBe('electrical-led-strip')
    expect(DESKTOP_ELECTRICAL_TOOL_CATEGORIES[6]).toMatchObject({ id: DESKTOP_LIGHTING_CATEGORY_ID, label: 'Lighting' })
    expect(DESKTOP_ELECTRICAL_TOOL_CATEGORIES[7]).toMatchObject({ label: 'Electrical Panels' })
    expect(shouldShowElectricalSymbolInDesktopMainGrid('electrical-led-strip')).toBe(false)
    expect(shouldShowElectricalSymbolInLegacyNonDesktopToolbar('electrical-led-strip')).toBe(false)
  })

  it('uses the open multipoint path architecture without circuit, measurement, or wire identity', () => {
    expect(viewerSource).toContain("kind === 'polyline' || kind === 'circuit-path' || kind === 'circuit-arc' || kind === 'electrical-led-strip'")
    expect(viewerSource).toContain("pathType: shapeKind === 'electrical-led-strip' ? 'led-strip'")
    expect(viewerSource).toContain("closed: false")
    expect(viewerSource).toContain("if (shapeKind !== 'electrical-led-strip') setToolMode('select')")
    expect(viewerSource).toContain("getMultiPointDraftLabel(kind: ShapeKind)")
    expect(viewerSource).toContain("if (kind === 'electrical-led-strip') return 'LED Strip'")
    expect(viewerSource).toContain("getMultiPointStopLabel(kind: ShapeKind)")
    expect(viewerSource).toContain("if (kind === 'electrical-led-strip') return 'Stop LED Strip'")
    expect(viewerSource).toContain("const isCircuit = kind === 'circuit-path'")
    expect(viewerSource).toContain("const isLedStrip = kind === 'electrical-led-strip'")
    expect(viewerSource).toContain('strokeWidth={18}')
    expect(viewerSource).toContain("pointerEvents: 'stroke'")
    expect(viewerSource).not.toContain("segmentWireProfileIds: ['electrical-led-strip'")
  })

  it('renders illumination as layered open path strokes without bounds-centered LED Strip glow', () => {
    const helperStart = viewerSource.indexOf('function renderLedStripPathGlowSvg(')
    const helperEnd = viewerSource.indexOf('function hexWithAlpha', helperStart)
    const helperSource = viewerSource.slice(helperStart, helperEnd)
    expect(helperStart).toBeGreaterThan(-1)
    expect(helperSource).toContain('points={points}')
    expect((helperSource.match(/<polyline/g) ?? []).length).toBeGreaterThanOrEqual(4)
    expect(helperSource).not.toContain('<circle')
    expect(helperSource).not.toContain('url(#')
    expect(helperSource).not.toContain('Z')
    expect(helperSource).toContain("strokeLinecap=\"round\"")
    expect(helperSource).toContain("strokeLinejoin=\"round\"")
    expect(helperSource).toContain("style={{ pointerEvents: 'none' }}")

    const ledBranchStart = viewerSource.indexOf("const isLedStrip = kind === 'electrical-led-strip'")
    const ledBranchEnd = viewerSource.indexOf('{isCircuit && localPts.map', ledBranchStart)
    const ledBranchSource = viewerSource.slice(ledBranchStart, ledBranchEnd)
    expect(ledBranchSource).toContain('renderLedStripPathGlowSvg(svgPts, glowMetrics, ledStripGlowVisible, borderThickness)')
    expect(ledBranchSource).not.toContain('renderLightOutputGlowSvg')
    expect(ledBranchSource).toContain("strokeWidth={18}")
    expect(ledBranchSource).toContain("pointerEvents: 'stroke'")
    expect(ledBranchSource).toContain("style={{ pointerEvents: 'none' }}")

    expect(viewerSource).toContain("const isCircuit = kind === 'circuit-path'")
    expect(viewerSource).toContain("if (isCanLightShape(a))")
    expect(viewerSource).toContain('renderLightOutputGlowSvg(glowId, glowMetrics, lightingEffectsVisible && !animationPlaybackAnnotationIds.has(a.id))')
  })

  it('counts once per finalized annotation and never contributes wire quantities', () => {
    const strip = ledStripAnnotation()
    const copied = ledStripAnnotation('led-strip-copy')
    const countResult = buildElectricalSymbolCountResult({
      projectId: 'project-1',
      blueprintSetId: 'set-1',
      annotations: [strip, copied],
      workPackages: [pkg(['led-strip-1'])],
    })
    expect(countResult.symbolTotals.find((total) => total.shapeKind === 'electrical-led-strip')).toMatchObject({
      displayName: 'LED Strip',
      count: 2,
      annotationIds: ['led-strip-1', 'led-strip-copy'],
    })
    expect(countResult.packageRollups[0].totals.find((total) => total.shapeKind === 'electrical-led-strip')?.count).toBe(1)

    const calibration = buildManualKnownDistanceCalibration(1, { x: 0, y: 0 }, { x: 1, y: 0 }, 100, 'ft', { pageWidthInches: 10, pageHeightInches: 10 })
    const wireResult = buildWireQuantityResult({
      projectId: 'project-1',
      blueprintSetId: 'set-1',
      annotations: [strip],
      workPackages: [pkg(['led-strip-1'])],
      wireProfiles: [],
      savedCalibrations: { 1: calibration },
      detectedScales: {},
      getPageSizeInches: () => ({ pageWidthInches: 10, pageHeightInches: 10 }),
    })
    expect(wireResult.contributions).toEqual([])
    expect(JSON.stringify(wireResult)).not.toContain('LED Strip')
    expect(supportsWireProfileAssignment({ toolType: 'shape', toolVariant: 'electrical-led-strip' })).toBe(false)
  })

  it('is an animation load with annotation-center anchoring semantics, not a source', () => {
    expect(isRouteBuilderLoadKind('electrical-led-strip')).toBe(true)
    expect(isRouteBuilderSourceKind('electrical-led-strip')).toBe(false)
    expect(inferRouteBuilderNodeRoles('electrical-led-strip')).toEqual(['load'])
    expect(inferRouteBuilderDefaultChannel('electrical-led-strip')).toBe('generic-route')
  })
})
