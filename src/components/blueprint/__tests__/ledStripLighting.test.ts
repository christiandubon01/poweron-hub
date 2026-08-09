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
} from '../desktopElectricalToolCategories'

const viewerSource = readFileSync(
  join(process.cwd(), 'src/components/blueprint/OperationsBlueprintPdfViewer.tsx'),
  'utf8',
)

const playbackControlsSource = readFileSync(
  join(process.cwd(), 'src/features/blueprint-animation/PackageAnimationPlaybackControls.tsx'),
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

  it('is the fifth Lighting child and desktop-category-only', () => {
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
  })

  it('uses the open multipoint path architecture without circuit, measurement, or wire identity', () => {
    expect(viewerSource).toContain("kind === 'polyline' || kind === 'circuit-path' || kind === 'circuit-arc' || kind === 'electrical-led-strip'")
    expect(viewerSource).toContain("pathType: shapeKind === 'electrical-led-strip' ? 'led-strip'")
    expect(viewerSource).toContain("closed: false")
    expect(viewerSource).toContain('shouldDeactivateAfterMultiPointFinalize(shapeKind)')
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
    expect(viewerSource).toContain("resolveLedStripLightColorMode(meta.lightColorMode)")
    expect(helperSource).toContain('getLedStripAppearanceMetrics({')
    expect(helperSource).not.toContain('Z')
    expect(helperSource).toContain("strokeLinecap=\"round\"")
    expect(helperSource).toContain("strokeLinejoin=\"round\"")
    expect(helperSource).toContain("style={{ pointerEvents: 'none' }}")

    const ledBranchStart = viewerSource.indexOf("const isLedStrip = kind === 'electrical-led-strip'")
    const ledBranchEnd = viewerSource.indexOf('{isCircuit && localPts.map', ledBranchStart)
    const ledBranchSource = viewerSource.slice(ledBranchStart, ledBranchEnd)
    expect(ledBranchSource).toContain('renderLedStripPathGlowSvg(svgPts, glowMetrics, ledStripGlowVisible, borderThickness, ledStripGradientId)')
    expect(ledBranchSource).not.toContain('renderLightOutputGlowSvg')
    expect(ledBranchSource).toContain("strokeWidth={18}")
    expect(ledBranchSource).toContain("pointerEvents: 'stroke'")
    expect(ledBranchSource).toContain("style={{ pointerEvents: 'none' }}")

    expect(viewerSource).toContain("const isCircuit = kind === 'circuit-path'")
    expect(viewerSource).toContain("if (isCanLightShape(a))")
    expect(viewerSource).toContain('renderLightOutputGlowSvg(glowId, glowMetrics, lightingEffectsVisible && !animationPlaybackAnnotationIds.has(a.id))')
  })

  it('uses Light Output for bounded Kelvin and RGB path appearance without touching geometry or hit testing', () => {
    expect(viewerSource).toContain('meta.lightIntensity ?? LIGHT_OUTPUT_BASE')
    expect(viewerSource).toContain('LIGHT_OUTPUT_MIN, LIGHT_OUTPUT_MAX')
    expect(viewerSource).toContain('outerStrokeWidth')
    expect(viewerSource).toContain('middleOpacity')
    expect(viewerSource).toContain('coreOpacity')
    expect(viewerSource).toContain('diodeOpacity')
    expect(viewerSource).toContain('strokeWidth={18}')
    expect(viewerSource).not.toContain('ledStripIntensity')
    expect(viewerSource).not.toContain('glowIntensity')
    expect(viewerSource).not.toContain('rgbIntensity')
  })

  it('adds LED Strip-only RGB Flow mode while preserving Kelvin metadata', () => {
    expect(viewerSource).toContain("lightColorMode: resolveLedStripLightColorMode(meta.lightColorMode)")
    expect(viewerSource).toContain("currentKind === 'electrical-led-strip' ? 'Color / Temperature' : 'Color Temperature'")
    expect(viewerSource).toContain("data-led-strip-rgb-flow-option={selected ? 'selected' : 'available'}")
    expect(viewerSource).toContain("persistEditAnnotationMeta({ lightColorMode: 'rgb-flow' })")
    expect(viewerSource).toContain("persistEditAnnotationMeta(currentKind === 'electrical-led-strip' ? { lightColorMode: 'kelvin', lightKelvin: k } : { lightKelvin: k })")
    expect(viewerSource).toContain('RGB Flow')
    expect(viewerSource).not.toContain('lightKelvin: 0')
    expect(viewerSource).not.toContain('lightKelvin: -1')
    expect(viewerSource).not.toContain('lightKelvin: 9999')
  })

  it('renders RGB Flow as animated open-path SVG layers with stable per-annotation ids', () => {
    const helperStart = viewerSource.indexOf('function renderLedStripPathGlowSvg(')
    const helperEnd = viewerSource.indexOf('function hexWithAlpha', helperStart)
    const helperSource = viewerSource.slice(helperStart, helperEnd)
    expect(helperSource).toContain("appearance.colorMode === 'rgb-flow'")
    expect(helperSource).toContain('linearGradient id={gradientId}')
    expect(helperSource).toContain('gradientUnits="userSpaceOnUse"')
    expect(helperSource).toContain('spreadMethod="repeat"')
    expect(helperSource).toContain('animateTransform')
    expect(helperSource).toContain('dur={appearance.animationDuration}')
    expect(helperSource).toContain('data-led-strip-rgb-layer="outer"')
    expect(helperSource).toContain('data-led-strip-rgb-layer="middle"')
    expect(helperSource).toContain('data-led-strip-rgb-layer="core"')
    expect(helperSource).not.toContain('<rect')
    expect(helperSource).not.toContain('<circle')
    expect(helperSource).not.toContain('requestAnimationFrame')

    expect(viewerSource).toContain("`led-strip-rgb-${sanitizeLedStripSvgId(`${currentPage}-${a.id}`)}`")
    expect(viewerSource).toContain("points={svgPts}")
    expect(viewerSource).not.toContain('points={`${svgPts} ${svgPts.split')
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

  it('is an animation load with annotation-center anchoring semantics', () => {
    expect(isRouteBuilderLoadKind('electrical-led-strip')).toBe(true)
    expect(isRouteBuilderSourceKind('electrical-led-strip')).toBe(true)
    expect(inferRouteBuilderNodeRoles('electrical-led-strip')).toEqual(['load'])
    expect(inferRouteBuilderDefaultChannel('electrical-led-strip')).toBe('generic-route')
  })

  it('keeps animation route logic isolated while giving energized RGB strips a path overlay', () => {
    expect(viewerSource).toContain('ledStrip: {')
    expect(viewerSource).toContain('points: ledStripPoints')
    expect(viewerSource).toContain("gradientId: `playback-led-strip-rgb-${sanitizeLedStripSvgId(`${annotation.pageNumber}-${annotation.id}`)}`")
    expect(playbackControlsSource).toContain('const ledStrip = (appearance as')
    expect(playbackControlsSource).toContain("preserveAspectRatio={ledStrip ? 'none' : 'xMidYMid meet'}")
    expect(playbackControlsSource).toContain('data-playback-led-strip-layer="outer"')
    expect(playbackControlsSource).toContain('data-playback-led-strip-layer="middle"')
    expect(playbackControlsSource).toContain('data-playback-led-strip-layer="core"')
    expect(playbackControlsSource).toContain('visual.glowOpacity')
  })

  it('deactivates the LED Strip tool after Space or Finish/Stop finalization without duplicating the strip', () => {
    const helperStart = viewerSource.indexOf('function shouldDeactivateAfterMultiPointFinalize(')
    const helperEnd = viewerSource.indexOf('//', helperStart)
    const helperSource = viewerSource.slice(helperStart, helperEnd)
    expect(helperSource).toContain("return kind === 'electrical-led-strip'")
    expect(helperSource).not.toContain("kind === 'circuit-path'")
    expect(helperSource).not.toContain("kind === 'circuit-arc'")

    const finalizeStart = viewerSource.indexOf('const finalizePathDraft = useCallback(() => {')
    const finalizeEnd = viewerSource.indexOf('// ── Spacebar finishes a multi-point shape draft', finalizeStart)
    const finalizeSource = viewerSource.slice(finalizeStart, finalizeEnd)
    expect(finalizeSource).toContain('const points = [...pathDraftRef.current]')
    expect(finalizeSource).toContain('if (points.length < 2 || !blueprint)')
    expect(finalizeSource).toContain('const ann: BlueprintAnnotation = {')
    expect(finalizeSource).toContain('setAllAnnotations((prev) => [...prev, ann])')
    expect((finalizeSource.match(/setAllAnnotations\(\(prev\) => \[\.\.\.prev, ann\]\)/g) ?? []).length).toBe(1)
    expect(finalizeSource).toContain('pathDraftRef.current = []')
    expect(finalizeSource).toContain('setPathDraftPoints([])')
    expect(finalizeSource).toContain('setPathCursorPx(null)')
    expect(finalizeSource).toContain("pathType: shapeKind === 'electrical-led-strip' ? 'led-strip'")
    expect(finalizeSource).toContain("setToolMode('select')")
    expect(finalizeSource).toContain('clearActiveQuickAccessSession()')

    const spaceStart = viewerSource.indexOf('// ── Spacebar finishes a multi-point shape draft')
    const spaceEnd = viewerSource.indexOf('// Recomputes a Circuit Arc', spaceStart)
    const spaceSource = viewerSource.slice(spaceStart, spaceEnd)
    expect(spaceSource).toContain("if (e.key !== ' ' && e.code !== 'Space') return")
    expect(spaceSource).toContain('if (pathDraftRef.current.length < 2) return')
    expect(spaceSource).toContain('finalizePathDraft()')
  })

  it('cancels incomplete LED Strip drafts into select mode while preserving unrelated multipoint behavior', () => {
    expect(viewerSource).toContain("const deactivateLedStrip = effectiveTool === 'shape' && shouldDeactivateAfterMultiPointFinalize(shapeKind)")
    expect(viewerSource).toContain('pathDraftRef.current = []')
    expect(viewerSource).toContain('setPathDraftPoints([])')
    expect(viewerSource).toContain('setPathCursorPx(null)')
    expect(viewerSource).toContain("if (deactivateLedStrip) setToolMode('select')")

    const stopPillStart = viewerSource.indexOf('{/* Circuit Path / Polyline active-mode Stop button')
    const stopPillEnd = viewerSource.indexOf('{/* Multi-Point Measure (Perimeter) active-mode Stop button', stopPillStart)
    const stopPillSource = viewerSource.slice(stopPillStart, stopPillEnd)
    expect(stopPillSource).toContain('onClick={finalizePathDraft}')
    expect(stopPillSource).toContain('disabled={pathDraftPoints.length < 2}')
    expect(stopPillSource).toContain('if (shouldDeactivateAfterMultiPointFinalize(shapeKind)) setToolMode(\'select\')')
    expect(stopPillSource).not.toContain("setOpenDesktopElectricalCategory(null)")
  })
})
