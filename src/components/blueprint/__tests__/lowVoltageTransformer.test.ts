import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { buildElectricalSymbolCountResult } from '@/features/blueprint-symbol-counts'
import {
  inferRouteBuilderDefaultChannel,
  inferRouteBuilderNodeRoles,
  isRouteBuilderDeviceKind,
  isRouteBuilderLoadKind,
  isRouteBuilderSourceKind,
  ROUTE_BUILDER_LOAD_KINDS,
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
  DESKTOP_LIGHTING_KINDS,
  shouldShowElectricalSymbolInDesktopMainGrid,
  shouldShowElectricalSymbolInLegacyNonDesktopToolbar,
} from '../desktopElectricalToolCategories'

function symbolAnnotation(id: string, shapeKind: string): BlueprintAnnotation {
  const meta = { shapeKind, ...getElectricalSymbolMetadataStamp(shapeKind) }
  return {
    id,
    projectId: 'project-1',
    blueprintSetId: 'set-1',
    pageNumber: 1,
    type: 'shape',
    color: '#67e8f9',
    rect: { x: 0.2, y: 0.2, w: 0.05, h: 0.05 },
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
    selectedAnnotationIds,
    itemRefs: [],
    visible: true,
    isolated: false,
    createdAt: '2026-07-27T00:00:00.000Z',
    updatedAt: '2026-07-27T00:00:00.000Z',
  } as unknown as BlueprintScopeLayer
}

describe('Low Voltage Transformer lighting symbol', () => {
  it('registers exact metadata as a non-rotatable, non-light-output Lighting symbol', () => {
    expect(getElectricalSymbolMetadata('electrical-low-voltage-transformer')).toMatchObject({
      symbolKind: 'electrical-low-voltage-transformer',
      displayName: 'Low Voltage Transformer',
      shortLabel: 'LVT',
      category: 'lighting',
      countValue: 1,
      defaultPhase: 'electrical',
      materialKey: 'electrical-low-voltage-transformer',
      laborKey: 'electrical-low-voltage-transformer',
      isElectricalSymbol: true,
    })
    expect(getElectricalSymbolMetadataStamp('electrical-low-voltage-transformer')).toEqual({
      symbolCategory: 'lighting',
      countValue: 1,
      materialKey: 'electrical-low-voltage-transformer',
      laborKey: 'electrical-low-voltage-transformer',
    })
    expect(isLightOutputShapeKind('electrical-low-voltage-transformer')).toBe(false)
    expect(isRotatableElectricalShapeKind('electrical-low-voltage-transformer')).toBe(false)
  })

  it('has a distinct LVT glyph and identity from the Electrical Panels transformer', () => {
    const style = {
      borderColor: '#67e8f9',
      borderThickness: 2,
      borderStyle: 'solid' as const,
      fillColor: 'transparent',
      fillOpacity: 0,
      labelsVisible: true,
    }
    const lvtMarkup = renderToStaticMarkup(React.createElement('svg', { viewBox: '0 0 100 100' }, renderElectricalSymbolSvg('electrical-low-voltage-transformer', {}, style)))
    const xfmrMarkup = renderToStaticMarkup(React.createElement('svg', { viewBox: '0 0 100 100' }, renderElectricalSymbolSvg('electrical-transformer', {}, style)))

    expect(lvtMarkup).toContain('LVT')
    expect(lvtMarkup).not.toContain('XFMR')
    expect(xfmrMarkup).toContain('XFMR')
    expect(xfmrMarkup).not.toContain('LVT')
    expect(lvtMarkup).not.toEqual(xfmrMarkup)
    expect(getElectricalSymbolMetadata('electrical-transformer')).toMatchObject({
      displayName: 'Transformer',
      shortLabel: 'XFMR',
      category: 'power',
      materialKey: 'electrical-transformer',
      laborKey: 'electrical-transformer',
    })
  })

  it('is the sixth Lighting child, desktop-category-only, and hidden on legacy non-desktop', () => {
    expect(DESKTOP_LIGHTING_KINDS[5]).toBe('electrical-low-voltage-transformer')
    expect(shouldShowElectricalSymbolInDesktopMainGrid('electrical-low-voltage-transformer')).toBe(false)
    expect(shouldShowElectricalSymbolInLegacyNonDesktopToolbar('electrical-low-voltage-transformer')).toBe(false)
  })

  it('stays animation-neutral and separate from all route device classifications', () => {
    expect(isRouteBuilderSourceKind('electrical-low-voltage-transformer')).toBe(true)
    expect(isRouteBuilderLoadKind('electrical-low-voltage-transformer')).toBe(false)
    expect(isRouteBuilderDeviceKind('electrical-low-voltage-transformer')).toBe(true)
    expect(inferRouteBuilderNodeRoles('electrical-low-voltage-transformer')).toEqual([])
    expect(inferRouteBuilderDefaultChannel('electrical-low-voltage-transformer')).toBe('generic-route')
    expect(ROUTE_BUILDER_LOAD_KINDS).not.toContain('electrical-low-voltage-transformer')
  })

  it('produces an independent count row and Work Package row from electrical-transformer', () => {
    const lvt = symbolAnnotation('lvt-1', 'electrical-low-voltage-transformer')
    const xfmr = symbolAnnotation('xfmr-1', 'electrical-transformer')
    const result = buildElectricalSymbolCountResult({
      projectId: 'project-1',
      blueprintSetId: 'set-1',
      annotations: [lvt, xfmr],
      workPackages: [pkg(['lvt-1', 'xfmr-1'])],
    })
    expect(result.symbolTotals.map((total) => [total.shapeKind, total.displayName, total.count])).toEqual(expect.arrayContaining([
      ['electrical-low-voltage-transformer', 'Low Voltage Transformer', 1],
      ['electrical-transformer', 'Transformer', 1],
    ]))
    expect(result.packageRollups[0].totals.map((total) => total.shapeKind)).toEqual(expect.arrayContaining([
      'electrical-low-voltage-transformer',
      'electrical-transformer',
    ]))
  })
})
