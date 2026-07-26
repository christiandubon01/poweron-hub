import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ProjectWireTotalsDialog, WireQuantitySummary } from '../components'
import type { WireQuantityContribution, WireQuantityResult } from '../types'

const contribution: WireQuantityContribution = {
  quantityLineId: 'q1',
  projectId: 'project-1',
  blueprintSetId: 'set-1',
  pageNumber: 1,
  annotationId: 'ann-1',
  segmentId: 'seg-1',
  segmentIndex: 0,
  shapeKind: 'circuit-path',
  packageIds: ['pkg-1', 'pkg-2'],
  isUnpackaged: false,
  profileResolution: { status: 'unassigned', source: 'unassigned', wireProfileId: null },
  measuredLength: 12.345,
  unit: 'ft',
  calibrationStatus: 'calibrated',
  diagnostics: [{ type: 'duplicate-package-membership', message: 'Duplicate', quantityLineId: 'q1' }],
}

const result: WireQuantityResult = {
  contributions: [contribution],
  projectTotals: [{
    key: 'unassigned:ft',
    groupKind: 'unassigned',
    wireProfileId: null,
    displayName: 'Unassigned',
    unit: 'ft',
    measuredLength: 12.345,
    wastePercent: null,
    wasteLength: null,
    purchaseLength: null,
    contributionIds: ['q1'],
    diagnostics: contribution.diagnostics,
  }],
  packageRollups: [],
  unpackagedTotals: [],
  diagnostics: contribution.diagnostics,
}

describe('blueprint-wire-quantities UI helpers', () => {
  it('renders scope, columns, statuses, not-configured state, diagnostics, and drill-down affordance without labor or pricing', () => {
    const html = renderToStaticMarkup(createElement(ProjectWireTotalsDialog, { result, onClose: () => {} }))
    expect(html).toContain('Current blueprint set')
    expect(html).toContain('Measured')
    expect(html).toContain('Waste %')
    expect(html).toContain('Waste length')
    expect(html).toContain('Purchase length')
    expect(html).toContain('Unassigned')
    expect(html).toContain('Not configured')
    expect(html).toContain('Duplicate packages')
    expect(html).not.toMatch(/labor/i)
    expect(html).not.toMatch(/pricing|price/i)
  })

  it('renders active, archived, missing, uncalibrated, empty, and contribution-ready rows without combining mixed units', () => {
    const totals = [
      { ...result.projectTotals[0], key: 'a-ft', groupKind: 'profile' as const, displayName: 'Active A', wireProfileId: 'a', profileStatus: 'active' as const, wastePercent: 5, wasteLength: 1, purchaseLength: 13.345 },
      { ...result.projectTotals[0], key: 'a-m', groupKind: 'profile' as const, displayName: 'Active A', wireProfileId: 'a', profileStatus: 'active' as const, unit: 'm' as const },
      { ...result.projectTotals[0], key: 'arch', groupKind: 'profile' as const, displayName: 'Archived B', wireProfileId: 'b', profileStatus: 'archived' as const },
      { ...result.projectTotals[0], key: 'missing', groupKind: 'missing-profile' as const, displayName: 'Missing Profile raw-id', wireProfileId: 'raw-id' },
      { ...result.projectTotals[0], key: 'uncal', groupKind: 'uncalibrated' as const, displayName: 'Uncalibrated', unit: null, measuredLength: 0 },
    ]
    const html = renderToStaticMarkup(createElement(WireQuantitySummary, { totals, contributions: [contribution], diagnostics: result.diagnostics }))
    expect(html).toContain('Active A')
    expect(html).toContain('Archived')
    expect(html).toContain('Missing Profile')
    expect(html).toContain('Uncalibrated')
    expect(html).toContain('12.35 ft')
    expect(html).toContain('12.35 m')
    const empty = renderToStaticMarkup(createElement(WireQuantitySummary, { totals: [], contributions: [] }))
    expect(empty).toContain('No measurable circuit routes.')
  })
})
