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
  renderElectricalSymbolSvg,
} from '../OperationsBlueprintPdfViewer'

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
  it('registers electrical-panel with Electrical Panel / PNL / power metadata', () => {
    expect(isElectricalShapeKind('electrical-panel')).toBe(true)
    expect(ELECTRICAL_SYMBOL_OPTIONS).toContainEqual({
      label: 'Electrical Panel',
      value: 'electrical-panel',
      shortLabel: 'PNL',
    })
    expect(getElectricalSymbolMetadata('electrical-panel')).toMatchObject({
      symbolKind: 'electrical-panel',
      displayName: 'Electrical Panel',
      shortLabel: 'PNL',
      category: 'power',
      isElectricalSymbol: true,
    })
    expect(getElectricalSymbolMetadataStamp('electrical-panel')).toMatchObject({
      symbolCategory: 'power',
      countValue: 1,
      materialKey: 'electrical-panel',
      laborKey: 'electrical-panel',
    })
  })

  it('renders a stable inline SVG panelboard glyph with compact PNL artwork', () => {
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
    expect(markup).toContain('<rect')
    expect(markup).toContain('PNL')
    expect(markup).not.toContain('<image')
  })

  it('uses tight panel visual bounds without changing other electrical symbol bounds', () => {
    expect(getElectricalSymbolVisualBounds('electrical-panel' as any)).toEqual({ x: 8, y: 7, w: 84, h: 86 })
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
    expect(markup).toContain('Electrical panel label')
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
      label: 'Electrical Panel',
      shapeKind: 'electrical-panel',
      category: 'power',
      countValue: 1,
    })
  })

  it('keeps the panel source anchor at the annotation center', () => {
    const rect = panelAnnotation.rect
    expect(rect.x + rect.w / 2).toBeCloseTo(0.12)
    expect(rect.y + rect.h / 2).toBeCloseTo(0.225)
  })
})
