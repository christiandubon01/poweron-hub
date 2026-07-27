import { describe, expect, it } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  ELECTRICAL_SYMBOL_OPTIONS,
  getElectricalSymbolMetadata,
  isLightOutputShapeKind,
  renderElectricalSymbolSvg,
} from '../electricalSymbolRegistry'
import {
  DESKTOP_ELECTRICAL_TOOL_CATEGORIES,
  DESKTOP_RECESSED_LIGHT_CATEGORY_ID,
  DESKTOP_RECESSED_LIGHT_KINDS,
  isDesktopRecessedLightKind,
  shouldShowElectricalSymbolInDesktopMainGrid,
  shouldShowElectricalSymbolInLegacyNonDesktopToolbar,
} from '../desktopElectricalToolCategories'
import {
  inferRouteBuilderNodeRoles,
  isRouteBuilderLoadKind,
  isRouteBuilderSourceKind,
  ROUTE_BUILDER_SENSOR_KINDS,
} from '@/features/blueprint-animation/routeBuilderModel'

const RECESSED_LIGHT_EXPECTATIONS = [
  ['can-light-2', '2" Can Light', '2"', 'can-light-2', 'can-light'],
  ['canless-light-2', '2" Canless', '2" CL', 'canless-light-2', 'canless-light'],
  ['can-light-4', '4" Can Light', '4"', 'can-light-4', 'can-light'],
  ['canless-light-4', '4" Canless Light', '4" CL', 'canless-light-4', 'canless-light'],
  ['can-light-6', '6" Can Light', '6"', 'can-light-6', 'can-light'],
  ['canless-light-6', '6" Canless Light', '6" CL', 'canless-light-6', 'canless-light'],
  ['canless-light-10', '10" Canless Light', '10" CL', 'canless-light-10', 'canless-light'],
] as const

describe('desktop recessed light registered variants', () => {
  it('registers the seven locked child kinds with exact owner-facing metadata', () => {
    expect(DESKTOP_RECESSED_LIGHT_KINDS).toEqual(RECESSED_LIGHT_EXPECTATIONS.map(([kind]) => kind))

    for (const [kind, displayName, shortLabel, materialKey, laborKey] of RECESSED_LIGHT_EXPECTATIONS) {
      expect(ELECTRICAL_SYMBOL_OPTIONS).toContainEqual({ value: kind, label: displayName, shortLabel })
      expect(getElectricalSymbolMetadata(kind)).toMatchObject({
        symbolKind: kind,
        displayName,
        shortLabel,
        category: 'lighting',
        countValue: 1,
        materialKey,
        laborKey,
        isElectricalSymbol: true,
      })
    }
  })

  it('renders authoritative can and canless glyphs without image assets', () => {
    for (const [kind, , shortLabel] of RECESSED_LIGHT_EXPECTATIONS) {
      const markup = renderToStaticMarkup(
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
      expect(markup).toContain('<circle')
      expect(markup).toContain(shortLabel.replace(/"/g, '&quot;'))
      expect(markup).not.toContain('<image')
    }
  })

  it('classifies all seven variants as lighting loads only', () => {
    for (const [kind] of RECESSED_LIGHT_EXPECTATIONS) {
      expect(isLightOutputShapeKind(kind)).toBe(true)
      expect(isRouteBuilderLoadKind(kind)).toBe(true)
      expect(inferRouteBuilderNodeRoles(kind)).toEqual(['load'])
      expect(isRouteBuilderSourceKind(kind)).toBe(false)
      expect(ROUTE_BUILDER_SENSOR_KINDS).not.toContain(kind)
    }
  })

  it('keeps desktop category organization separate from legacy non-desktop toolbar visibility', () => {
    expect(DESKTOP_ELECTRICAL_TOOL_CATEGORIES).toEqual([
      {
        id: DESKTOP_RECESSED_LIGHT_CATEGORY_ID,
        label: 'Recessed Lights',
        children: DESKTOP_RECESSED_LIGHT_KINDS,
      },
    ])

    for (const [kind] of RECESSED_LIGHT_EXPECTATIONS) {
      expect(isDesktopRecessedLightKind(kind)).toBe(true)
      expect(shouldShowElectricalSymbolInDesktopMainGrid(kind)).toBe(false)
    }
    expect(shouldShowElectricalSymbolInDesktopMainGrid('electrical-recessed-light')).toBe(false)
    expect(shouldShowElectricalSymbolInDesktopMainGrid('electrical-receptacle')).toBe(true)

    expect(shouldShowElectricalSymbolInLegacyNonDesktopToolbar('can-light-4')).toBe(true)
    expect(shouldShowElectricalSymbolInLegacyNonDesktopToolbar('can-light-6')).toBe(true)
    expect(shouldShowElectricalSymbolInLegacyNonDesktopToolbar('electrical-recessed-light')).toBe(true)
    expect(shouldShowElectricalSymbolInLegacyNonDesktopToolbar('can-light-2')).toBe(false)
    expect(shouldShowElectricalSymbolInLegacyNonDesktopToolbar('canless-light-2')).toBe(false)
    expect(shouldShowElectricalSymbolInLegacyNonDesktopToolbar('canless-light-4')).toBe(false)
    expect(shouldShowElectricalSymbolInLegacyNonDesktopToolbar('canless-light-6')).toBe(false)
    expect(shouldShowElectricalSymbolInLegacyNonDesktopToolbar('canless-light-10')).toBe(false)
  })
})
