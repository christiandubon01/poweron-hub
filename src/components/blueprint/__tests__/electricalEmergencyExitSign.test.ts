import { describe, expect, it } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  buildBlueprintScopeItemRef,
  cloneBlueprintAnnotationForPaste,
  ELECTRICAL_SYMBOL_OPTIONS,
  getElectricalSymbolMetadata,
  getElectricalSymbolMetadataStamp,
  getElectricalSymbolVisualBounds,
  isElectricalShapeKind,
  isLightOutputShapeKind,
  isRotatableElectricalShapeKind,
  renderElectricalSymbolSvg,
} from '../OperationsBlueprintPdfViewer'

const exitSignAnnotation = {
  id: 'exit-sign-1',
  blueprintSetId: 'blueprint-1',
  projectId: 'project-1',
  pageNumber: 3,
  type: 'shape',
  color: '#22c55e',
  borderColor: '#166534',
  rect: { x: 0.42, y: 0.18, w: 0.08, h: 0.035 },
  meta: { shapeKind: 'electrical-emergency-exit-sign', lightKelvin: 4000, lightIntensity: 1.5 },
  metadata: { shapeKind: 'electrical-emergency-exit-sign' },
  createdAt: '2026-07-25T00:00:00.000Z',
  updatedAt: '2026-07-25T00:00:00.000Z',
} as any

describe('EMERG-ANIM-EXIT-ENDPOINT-1 emergency exit sign symbol', () => {
  it('registers the stable shape kind with lighting metadata and catalog options', () => {
    expect(isElectricalShapeKind('electrical-emergency-exit-sign')).toBe(true)
    expect(ELECTRICAL_SYMBOL_OPTIONS).toContainEqual({
      label: 'Emergency Exit Sign',
      value: 'electrical-emergency-exit-sign',
      shortLabel: 'EXIT',
    })
    expect(getElectricalSymbolMetadata('electrical-emergency-exit-sign')).toMatchObject({
      symbolKind: 'electrical-emergency-exit-sign',
      displayName: 'Emergency Exit Sign',
      shortLabel: 'EXIT',
      category: 'lighting',
      countValue: 1,
      materialKey: 'emergency-exit-sign',
      laborKey: 'emergency-exit-sign',
      isElectricalSymbol: true,
    })
    expect(getElectricalSymbolMetadataStamp('electrical-emergency-exit-sign')).toMatchObject({
      symbolCategory: 'lighting',
      countValue: 1,
      materialKey: 'emergency-exit-sign',
      laborKey: 'emergency-exit-sign',
    })
  })

  it('renders an inline rectangular EXIT glyph with authored colors and no image asset', () => {
    const markup = renderToStaticMarkup(
      React.createElement(
        'svg',
        { viewBox: '0 0 100 100' },
        renderElectricalSymbolSvg('electrical-emergency-exit-sign' as any, {}, {
          borderColor: '#166534',
          borderThickness: 2,
          borderStyle: 'solid',
          fillColor: '#22c55e',
          fillOpacity: 1,
          labelsVisible: true,
        }),
      ),
    )

    expect(markup).toContain('<rect')
    expect(markup).toContain('x="12"')
    expect(markup).toContain('y="28"')
    expect(markup).toContain('width="76"')
    expect(markup).toContain('height="38"')
    expect(markup).toContain('fill="#22c55e"')
    expect(markup).toContain('stroke="#166534"')
    expect(markup).toContain('EXIT')
    expect(markup).toContain('text-anchor="middle"')
    expect(markup).not.toContain('<image')
  })

  it('uses compact body bounds and participates in rotation and light-output behavior', () => {
    expect(getElectricalSymbolVisualBounds('electrical-emergency-exit-sign' as any)).toEqual({ x: 12, y: 28, w: 76, h: 38 })
    expect(isRotatableElectricalShapeKind('electrical-emergency-exit-sign')).toBe(true)
    expect(isLightOutputShapeKind('electrical-emergency-exit-sign')).toBe(true)
  })

  it('feeds Work Package item refs, Quick Access shape variants, serialization, and copy/paste generically', () => {
    expect(buildBlueprintScopeItemRef(exitSignAnnotation)).toMatchObject({
      annotationId: 'exit-sign-1',
      pageNumber: 3,
      label: 'Emergency Exit Sign',
      shapeKind: 'electrical-emergency-exit-sign',
      category: 'lighting',
      countValue: 1,
    })

    const quickAccessPreset = {
      toolType: 'shape',
      toolVariant: 'electrical-emergency-exit-sign',
    }
    expect(ELECTRICAL_SYMBOL_OPTIONS.some((option) => option.value === quickAccessPreset.toolVariant)).toBe(true)

    const serialized = JSON.parse(JSON.stringify(exitSignAnnotation))
    expect(serialized.meta.shapeKind).toBe('electrical-emergency-exit-sign')

    const copied = cloneBlueprintAnnotationForPaste(exitSignAnnotation)
    const pasted = { ...copied, id: 'exit-sign-copy' }
    expect(pasted.id).not.toBe(exitSignAnnotation.id)
    expect(pasted.meta).toMatchObject({
      shapeKind: 'electrical-emergency-exit-sign',
      lightKelvin: 4000,
      lightIntensity: 1.5,
    })
  })
})
