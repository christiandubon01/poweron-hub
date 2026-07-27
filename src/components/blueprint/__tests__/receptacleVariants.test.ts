import { describe, expect, it } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  ELECTRICAL_SYMBOL_OPTIONS,
  getElectricalSymbolMetadata,
  getElectricalSymbolMetadataStamp,
  getElectricalSymbolVisualBounds,
  isLightOutputShapeKind,
  isRotatableElectricalShapeKind,
  renderElectricalSymbolSvg,
  type ElectricalSymbolKind,
} from '../electricalSymbolRegistry'
import {
  DESKTOP_RECEPTACLE_KINDS,
  DESKTOP_RECEPTACLES_CATEGORY_ID,
  DESKTOP_ELECTRICAL_TOOL_CATEGORIES,
  isDesktopElectricalCategoryChildKind,
  isDesktopReceptacleKind,
  shouldShowElectricalSymbolInDesktopMainGrid,
  shouldShowElectricalSymbolInLegacyNonDesktopToolbar,
} from '../desktopElectricalToolCategories'
import {
  inferRouteBuilderDefaultChannel,
  inferRouteBuilderNodeRoles,
  isRouteBuilderLoadKind,
  isRouteBuilderSourceKind,
  ROUTE_BUILDER_SENSOR_KINDS,
} from '@/features/blueprint-animation/routeBuilderModel'

const RECEPTACLE_KINDS = [
  'electrical-receptacle',
  'electrical-gfci',
  'electrical-gfci-wp',
  'electrical-receptacle-240v',
  'electrical-single-receptacle',
  'electrical-half-hot-receptacle',
] as const satisfies readonly ElectricalSymbolKind[]

function markupFor(kind: ElectricalSymbolKind) {
  return renderToStaticMarkup(
    React.createElement(
      'svg',
      { viewBox: '0 0 100 100' },
      renderElectricalSymbolSvg(kind, {}, {
        borderColor: '#67e8f9',
        borderThickness: 2,
        borderStyle: 'solid',
        fillColor: 'transparent',
        fillOpacity: 0,
        labelsVisible: true,
      }),
    ),
  )
}

describe('desktop receptacle variants', () => {
  it('keeps the existing receptacle stable kind while renaming the owner-facing label', () => {
    const metadata = getElectricalSymbolMetadata('electrical-receptacle')
    expect(metadata).toMatchObject({
      symbolKind: 'electrical-receptacle',
      displayName: 'Duplex Receptacle',
      shortLabel: 'REC',
      category: 'power',
      countValue: 1,
      materialKey: 'receptacle',
      laborKey: 'receptacle',
      isElectricalSymbol: true,
    })
    expect(ELECTRICAL_SYMBOL_OPTIONS).toContainEqual({
      value: 'electrical-receptacle',
      label: 'Duplex Receptacle',
      shortLabel: 'REC',
    })
    expect(getElectricalSymbolMetadataStamp('electrical-receptacle')).toEqual({
      symbolCategory: 'power',
      countValue: 1,
      materialKey: 'receptacle',
      laborKey: 'receptacle',
    })
  })

  it('registers GFCI WP, Single Receptacle, and Half-Hot Receptacle with locked metadata', () => {
    expect(getElectricalSymbolMetadata('electrical-gfci-wp')).toMatchObject({
      displayName: 'GFCI WP',
      shortLabel: 'GFCI-WP',
      category: 'power',
      countValue: 1,
      materialKey: 'gfci',
      laborKey: 'gfci',
    })
    expect(getElectricalSymbolMetadata('electrical-single-receptacle')).toMatchObject({
      displayName: 'Single Receptacle',
      shortLabel: 'SR',
      category: 'power',
      countValue: 1,
      materialKey: 'receptacle',
      laborKey: 'receptacle',
    })
    expect(getElectricalSymbolMetadata('electrical-half-hot-receptacle')).toMatchObject({
      displayName: 'Half-Hot Receptacle',
      shortLabel: 'HH',
      category: 'power',
      countValue: 1,
      materialKey: 'receptacle',
      laborKey: 'receptacle',
    })

    for (const kind of RECEPTACLE_KINDS) {
      expect(isRotatableElectricalShapeKind(kind)).toBe(true)
      expect(isLightOutputShapeKind(kind)).toBe(false)
      expect(getElectricalSymbolVisualBounds(kind)).toBeTruthy()
    }
  })

  it('renders all receptacle glyphs through the shared SVG renderer without image assets', () => {
    for (const kind of RECEPTACLE_KINDS) {
      const markup = markupFor(kind)
      expect(markup).toBeTruthy()
      expect(markup).not.toContain('<image')
    }

    const gfciWp = markupFor('electrical-gfci-wp')
    expect(gfciWp).toContain('WP')
    expect(gfciWp).toContain('width="56"')
    expect(gfciWp).toContain('GFCI-WP')

    const single = markupFor('electrical-single-receptacle')
    expect(single).toContain('SR')
    expect(single).toContain('x1="43"')
    expect(single).toContain('x1="57"')
    expect(single).not.toContain('cx="50" cy="35" r="9"')
    expect(single).not.toContain('x1="38" y1="30"')

    const halfHot = markupFor('electrical-half-hot-receptacle')
    expect(halfHot).toContain('HH')
    expect(halfHot).toContain('fill-opacity="0.14"')
    expect(halfHot).toContain('M38 26 L62 44')
    expect(halfHot).toContain('cx="50" cy="35" r="9"')
    expect(halfHot).toContain('cx="50" cy="58" r="9"')
  })

  it('adds the locked Receptacles category as the fifth desktop category', () => {
    expect(DESKTOP_RECEPTACLE_KINDS).toEqual(RECEPTACLE_KINDS)
    expect(DESKTOP_ELECTRICAL_TOOL_CATEGORIES.map((category) => category.id)).toEqual([
      'recessed-lights',
      'switches',
      'ceiling-devices',
      'lighting-controls',
      DESKTOP_RECEPTACLES_CATEGORY_ID,
      'low-voltage',
      'lighting',
      'electrical-panels',
    ])
    expect(DESKTOP_ELECTRICAL_TOOL_CATEGORIES[4]).toEqual({
      id: DESKTOP_RECEPTACLES_CATEGORY_ID,
      label: 'Receptacles',
      children: RECEPTACLE_KINDS,
    })
    expect(DESKTOP_RECEPTACLE_KINDS).not.toContain('electrical-hdmi')
    expect(DESKTOP_RECEPTACLE_KINDS).not.toContain('electrical-data')

    const categorizedChildren = DESKTOP_ELECTRICAL_TOOL_CATEGORIES.flatMap((category) => category.children)
    expect(new Set(categorizedChildren).size).toBe(categorizedChildren.length)
    for (const kind of RECEPTACLE_KINDS) {
      expect(isDesktopReceptacleKind(kind)).toBe(true)
      expect(isDesktopElectricalCategoryChildKind(kind)).toBe(true)
      expect(shouldShowElectricalSymbolInDesktopMainGrid(kind)).toBe(false)
    }
  })

  it('keeps existing receptacles legacy-visible and hides only new desktop-only receptacles', () => {
    expect(shouldShowElectricalSymbolInLegacyNonDesktopToolbar('electrical-receptacle')).toBe(true)
    expect(shouldShowElectricalSymbolInLegacyNonDesktopToolbar('electrical-gfci')).toBe(true)
    expect(shouldShowElectricalSymbolInLegacyNonDesktopToolbar('electrical-receptacle-240v')).toBe(true)
    expect(shouldShowElectricalSymbolInLegacyNonDesktopToolbar('electrical-gfci-wp')).toBe(false)
    expect(shouldShowElectricalSymbolInLegacyNonDesktopToolbar('electrical-single-receptacle')).toBe(false)
    expect(shouldShowElectricalSymbolInLegacyNonDesktopToolbar('electrical-half-hot-receptacle')).toBe(false)
  })

  it('classifies all receptacles as downstream load endpoints only', () => {
    for (const kind of RECEPTACLE_KINDS) {
      expect(isRouteBuilderLoadKind(kind)).toBe(true)
      expect(inferRouteBuilderNodeRoles(kind)).toEqual(['load'])
      expect(isRouteBuilderSourceKind(kind)).toBe(false)
      expect(ROUTE_BUILDER_SENSOR_KINDS).not.toContain(kind)
      expect(inferRouteBuilderDefaultChannel(kind)).toBe('generic-route')
      expect(isLightOutputShapeKind(kind)).toBe(false)
    }
  })
})
