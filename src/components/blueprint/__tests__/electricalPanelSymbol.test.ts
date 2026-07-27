import { describe, expect, it } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  buildElectricalPanelLabelCommit,
  buildElectricalPanelLabelPatch,
  buildBlueprintScopeItemRef,
  cloneBlueprintAnnotationForPaste,
  ELECTRICAL_SYMBOL_OPTIONS,
  ElectricalPanelLabelControl,
  getElectricalSymbolMetadata,
  getElectricalSymbolMetadataStamp,
  getElectricalSymbolVisualBounds,
  isElectricalShapeKind,
  isLightOutputShapeKind,
  isRotatableElectricalShapeKind,
  renderElectricalSymbolSvg,
} from '../OperationsBlueprintPdfViewer'
import {
  inferRouteBuilderDefaultChannel,
  inferRouteBuilderNodeRoles,
  isRouteBuilderLoadKind,
  isRouteBuilderSourceKind,
  ROUTE_BUILDER_SENSOR_KINDS,
} from '@/features/blueprint-animation/routeBuilderModel'
import { regenerateCircuitTopologyIds, translateNormalizedPoints } from '@/features/blueprint-animation/routeGeometry'

const EQUIPMENT_EXPECTATIONS = [
  ['electrical-sub-panel', 'Sub Panel', 'SP', 'electrical-sub-panel'],
  ['electrical-switchboard', 'Switchboard', 'SWBD', 'electrical-switchboard'],
  ['electrical-switchgear', 'Switchgear', 'SWGR', 'electrical-switchgear'],
  ['electrical-ats', 'ATS', 'ATS', 'electrical-ats'],
  ['electrical-transformer', 'Transformer', 'XFMR', 'electrical-transformer'],
] as const

function markupFor(kind: string) {
  return renderToStaticMarkup(
    React.createElement(
      'svg',
      { viewBox: '0 0 100 100' },
      renderElectricalSymbolSvg(kind as any, {}, {
        borderColor: '#38bdf8',
        borderThickness: 2,
        borderStyle: 'solid',
        fillColor: 'transparent',
        fillOpacity: 1,
        labelsVisible: true,
      }),
    ),
  )
}

const panelAnnotation = {
  id: 'panel-1',
  blueprintSetId: 'blueprint-1',
  projectId: 'project-1',
  pageNumber: 2,
  type: 'shape',
  text: 'Subpanel',
  color: '#38bdf8',
  rect: { x: 0.1, y: 0.2, w: 0.04, h: 0.05 },
  meta: { shapeKind: 'electrical-panel' },
  metadata: { shapeKind: 'electrical-panel' },
  createdAt: '2026-07-24T00:00:00.000Z',
  updatedAt: '2026-07-24T00:00:00.000Z',
} as any

describe('ANIM-5.4 electrical panel symbol', () => {
  it('registers electrical-panel with Main Panel / PNL / power metadata', () => {
    expect(isElectricalShapeKind('electrical-panel')).toBe(true)
    expect(ELECTRICAL_SYMBOL_OPTIONS).toContainEqual({
      label: 'Main Panel',
      value: 'electrical-panel',
      shortLabel: 'PNL',
    })
    expect(getElectricalSymbolMetadata('electrical-panel')).toMatchObject({
      symbolKind: 'electrical-panel',
      displayName: 'Main Panel',
      shortLabel: 'PNL',
      category: 'power',
      defaultPhase: 'electrical',
      countValue: 1,
      materialKey: 'electrical-panel',
      laborKey: 'electrical-panel',
      isElectricalSymbol: true,
    })
    expect(getElectricalSymbolMetadataStamp('electrical-panel')).toMatchObject({
      symbolCategory: 'power',
      countValue: 1,
      materialKey: 'electrical-panel',
      laborKey: 'electrical-panel',
    })
    expect(isRotatableElectricalShapeKind('electrical-panel')).toBe(false)
    expect(isLightOutputShapeKind('electrical-panel')).toBe(false)
    expect(isElectricalShapeKind('electrical-main-panel')).toBe(false)
  })

  it('registers new electrical equipment symbols with locked power metadata', () => {
    for (const [kind, displayName, shortLabel, key] of EQUIPMENT_EXPECTATIONS) {
      expect(isElectricalShapeKind(kind)).toBe(true)
      expect(ELECTRICAL_SYMBOL_OPTIONS).toContainEqual({ value: kind, label: displayName, shortLabel })
      expect(getElectricalSymbolMetadata(kind)).toMatchObject({
        symbolKind: kind,
        displayName,
        shortLabel,
        category: 'power',
        defaultPhase: 'electrical',
        countValue: 1,
        materialKey: key,
        laborKey: key,
        isElectricalSymbol: true,
      })
      expect(getElectricalSymbolMetadataStamp(kind)).toEqual({
        symbolCategory: 'power',
        countValue: 1,
        materialKey: key,
        laborKey: key,
      })
      expect(isRotatableElectricalShapeKind(kind)).toBe(false)
      expect(isLightOutputShapeKind(kind)).toBe(false)
    }
  })

  it('renders a stable inline SVG panelboard glyph with compact PNL artwork', () => {
    const markup = markupFor('electrical-panel')
    expect(markup).toContain('<rect')
    expect(markup).toContain('PNL')
    expect(markup).not.toContain('<image')
  })

  it('renders distinct inline SVG glyphs for the five new equipment symbols', () => {
    const glyphs = EQUIPMENT_EXPECTATIONS.map(([kind, , shortLabel]) => {
      const markup = markupFor(kind)
      expect(markup).toContain(shortLabel)
      expect(markup).not.toContain('<image')
      return markup
    })
    expect(new Set(glyphs).size).toBe(glyphs.length)
    expect(glyphs[0]).not.toBe(markupFor('electrical-panel'))
  })

  it('uses tight panel visual bounds without changing other electrical symbol bounds', () => {
    expect(getElectricalSymbolVisualBounds('electrical-panel' as any)).toEqual({ x: 8, y: 7, w: 84, h: 86 })
    expect(getElectricalSymbolVisualBounds('electrical-sub-panel' as any)).toEqual({ x: 17, y: 15, w: 66, h: 70 })
    expect(getElectricalSymbolVisualBounds('electrical-switchboard' as any)).toEqual({ x: 8, y: 24, w: 84, h: 52 })
    expect(getElectricalSymbolVisualBounds('electrical-switchgear' as any)).toEqual({ x: 12, y: 12, w: 76, h: 76 })
    expect(getElectricalSymbolVisualBounds('electrical-ats' as any)).toEqual({ x: 16, y: 16, w: 68, h: 68 })
    expect(getElectricalSymbolVisualBounds('electrical-transformer' as any)).toEqual({ x: 13, y: 16, w: 74, h: 66 })
    expect(getElectricalSymbolVisualBounds('electrical-receptacle' as any)).toEqual({ x: 25, y: 9, w: 50, h: 74 })
  })

  it('draws the outer panelboard border across most of the viewBox with readable centered PNL text', () => {
    const markup = renderToStaticMarkup(
      React.createElement(
        'svg',
        { viewBox: '0 0 100 100' },
        renderElectricalSymbolSvg('electrical-panel' as any, {}, {
          borderColor: '#38bdf8',
          borderThickness: 2,
          borderStyle: 'solid',
          fillColor: 'transparent',
          fillOpacity: 1,
          labelsVisible: true,
        }),
      ),
    )

    expect(markup).toContain('x="8"')
    expect(markup).toContain('y="7"')
    expect(markup).toContain('width="84"')
    expect(markup).toContain('height="86"')
    expect(markup).toContain('x="50"')
    expect(markup).toContain('y="52"')
    expect(markup).toContain('font-size="20"')
  })

  it('exposes a panel label input and trims label patches for annotation.text at commit time', () => {
    const markup = renderToStaticMarkup(
      React.createElement(ElectricalPanelLabelControl, {
        value: 'Subpanel',
        onChange: () => undefined,
        onBlur: () => undefined,
        onKeyDown: () => undefined,
      }),
    )
    expect(markup).toContain('Main panel label')
    expect(markup).toContain('Subpanel')
    expect(buildElectricalPanelLabelPatch(' MDP ')).toEqual({ text: 'MDP' })
    expect(buildElectricalPanelLabelPatch('   ')).toEqual({ text: undefined })
    const updated = { ...panelAnnotation, ...buildElectricalPanelLabelPatch(' Panel A ') }
    expect(updated.id).toBe(panelAnnotation.id)
    expect(updated.text).toBe('Panel A')
    expect(updated.meta).toEqual(panelAnnotation.meta)
  })

  it('keeps multi-word panel label drafts local until blur or Enter commits', () => {
    const persisted = { id: 'panel-1', text: undefined as string | undefined }
    const persistenceCalls: Array<{ text?: string }> = []
    let draft = ''

    for (const value of ['P', 'Pa', 'Pan', 'Pane', 'Panel', 'Panel ', 'Panel A']) {
      draft = value
      expect(persistenceCalls).toEqual([])
    }

    const commit = buildElectricalPanelLabelCommit(persisted.id, draft, persisted.text)
    if (commit.changed && commit.patch) persistenceCalls.push(commit.patch)
    expect(persistenceCalls).toEqual([{ text: 'Panel A' }])
  })

  it('normalizes blur and Enter commits without collapsing internal spaces', () => {
    expect(buildElectricalPanelLabelCommit('panel-1', ' Panel A ', undefined)).toMatchObject({
      changed: true,
      patch: { text: 'Panel A' },
    })
    expect(buildElectricalPanelLabelCommit('panel-1', 'Sub Panel', undefined)).toMatchObject({
      changed: true,
      patch: { text: 'Sub Panel' },
    })
    expect(buildElectricalPanelLabelCommit('panel-1', '   ', 'Panel A')).toMatchObject({
      changed: true,
      patch: { text: undefined },
    })
    expect(buildElectricalPanelLabelCommit('panel-1', 'Panel A', 'Panel A')).toMatchObject({
      changed: false,
    })
  })

  it('cancels drafts and resets drafts when switching panel annotations', () => {
    const persistedById = new Map([
      ['panel-a', 'Panel A'],
      ['panel-b', 'Panel B'],
    ])
    const persistenceCalls: Array<{ annotationId: string; text?: string }> = []
    let draft = persistedById.get('panel-a')!
    draft = 'MDP'

    const escapeRestoredDraft = persistedById.get('panel-a')!
    expect(escapeRestoredDraft).toBe('Panel A')
    expect(persistenceCalls).toEqual([])

    draft = 'Panel A unsaved'
    const selectedAnnotationId = 'panel-b'
    draft = persistedById.get(selectedAnnotationId)!
    expect(draft).toBe('Panel B')
    expect(persistenceCalls).toEqual([])
  })

  it('retains custom text through the real copied-annotation template and package item refs', () => {
    const copied = cloneBlueprintAnnotationForPaste(panelAnnotation)
    const pasted = {
      ...panelAnnotation,
      ...copied,
      id: 'panel-copy',
      createdAt: '2026-07-24T00:01:00.000Z',
      updatedAt: '2026-07-24T00:01:00.000Z',
    }

    expect(pasted.id).not.toBe(panelAnnotation.id)
    expect(pasted.text).toBe('Subpanel')
    expect(pasted.meta).toEqual({ shapeKind: 'electrical-panel' })
    expect(pasted.rect).toEqual(panelAnnotation.rect)
    expect(pasted.color).toBe(panelAnnotation.color)
    expect(panelAnnotation.id).toBe('panel-1')
    expect(panelAnnotation.text).toBe('Subpanel')

    expect(buildBlueprintScopeItemRef(panelAnnotation)).toMatchObject({
      annotationId: 'panel-1',
      pageNumber: 2,
      label: 'Main Panel',
      shapeKind: 'electrical-panel',
      category: 'power',
      countValue: 1,
    })
  })

  it('preserves Main Panel animation behavior and keeps new equipment animation-neutral', () => {
    expect(isRouteBuilderSourceKind('electrical-panel')).toBe(true)
    expect(isRouteBuilderLoadKind('electrical-panel')).toBe(false)
    expect(inferRouteBuilderNodeRoles('electrical-panel', { selectedAsSource: true })).toEqual(['source'])
    expect(inferRouteBuilderNodeRoles('electrical-panel')).toEqual([])
    expect(inferRouteBuilderDefaultChannel('electrical-panel')).toBe('constant-line-voltage')

    for (const [kind] of EQUIPMENT_EXPECTATIONS) {
      expect(isRouteBuilderSourceKind(kind)).toBe(false)
      expect(isRouteBuilderLoadKind(kind)).toBe(false)
      expect(inferRouteBuilderNodeRoles(kind)).toEqual([])
      expect(inferRouteBuilderDefaultChannel(kind)).toBe('generic-route')
      expect(ROUTE_BUILDER_SENSOR_KINDS).not.toContain(kind)
    }
  })

  it('keeps the panel source anchor at the annotation center', () => {
    const rect = panelAnnotation.rect
    expect(rect.x + rect.w / 2).toBeCloseTo(0.12)
    expect(rect.y + rect.h / 2).toBeCloseTo(0.225)
  })

  it('preserves circuit wire profiles through copy while regenerating topology identity', () => {
    const source = {
      ...panelAnnotation,
      id: 'circuit-source',
      type: 'shape',
      color: '#a855f7',
      meta: {
        shapeKind: 'circuit-path',
        points: [{ x: 0.1, y: 0.1 }, { x: 0.4, y: 0.1 }, { x: 0.4, y: 0.5 }],
        pointIds: ['p1', 'p2', 'p3'],
        segmentIds: ['s1', 's2'],
        wireProfileId: 'wire_profile_default',
        segmentWireProfileIds: [null, 'wire_profile_override'],
      },
    } as any
    const template = cloneBlueprintAnnotationForPaste(source)
    const movedPoints = translateNormalizedPoints(template.meta.points, 0.05, 0.05)
    let serial = 0
    const topology = regenerateCircuitTopologyIds(movedPoints, (kind) => `${kind}-copy-${++serial}`)
    const pasted: any = {
      ...template,
      id: 'circuit-copy',
      meta: {
        ...template.meta,
        points: movedPoints,
        pointIds: topology.pointIds,
        segmentIds: topology.segmentIds,
      },
    }

    expect(pasted.id).not.toBe(source.id)
    expect(pasted.meta.pointIds).not.toEqual(source.meta.pointIds)
    expect(pasted.meta.segmentIds).not.toEqual(source.meta.segmentIds)
    expect(pasted.meta.wireProfileId).toBe('wire_profile_default')
    expect(pasted.meta.segmentWireProfileIds).toEqual([null, 'wire_profile_override'])
  })

  it('preserves circuit profile metadata across geometry and appearance edits', () => {
    const source = {
      ...panelAnnotation,
      id: 'circuit-edit',
      type: 'shape',
      color: '#facc15',
      meta: {
        shapeKind: 'circuit-arc',
        points: [{ x: 0.1, y: 0.1 }, { x: 0.4, y: 0.5 }],
        arcCtrls: [{ x: 0.25, y: 0.05 }],
        segmentIds: ['s1'],
        wireProfileId: 'wire_profile_arc',
        segmentWireProfileIds: ['wire_profile_arc_override'],
      },
    } as any

    const moved = {
      ...source,
      meta: {
        ...source.meta,
        points: translateNormalizedPoints(source.meta.points, 0.1, 0.1),
      },
    }
    const controlEdited = {
      ...moved,
      meta: {
        ...moved.meta,
        arcCtrls: [{ x: 0.3, y: 0.08 }],
      },
    }
    const colorEdited = { ...controlEdited, color: '#ef4444' }

    expect(colorEdited.meta.wireProfileId).toBe('wire_profile_arc')
    expect(colorEdited.meta.segmentWireProfileIds).toEqual(['wire_profile_arc_override'])
    expect(colorEdited.color).toBe('#ef4444')
  })
})
