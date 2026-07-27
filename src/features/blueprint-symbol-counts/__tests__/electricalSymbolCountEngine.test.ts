import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { BlueprintAnnotation, BlueprintScopeLayer } from '@/services/blueprintLibraryService'
import {
  ELECTRICAL_SYMBOL_METADATA,
  ELECTRICAL_SYMBOL_OPTIONS,
  getElectricalSymbolMetadata,
  renderElectricalSymbolSvg,
  buildElectricalSymbolCountResult,
  type ElectricalSymbolKind,
} from '..'

function ann(id: string, shapeKind: string, patch: Partial<BlueprintAnnotation> = {}): BlueprintAnnotation {
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
    ...patch,
  } as BlueprintAnnotation
}

function pkg(id: string, selectedAnnotationIds: string[], patch: Partial<BlueprintScopeLayer> = {}): BlueprintScopeLayer {
  return {
    id,
    name: id,
    description: '',
    color: '#38bdf8',
    selectedAnnotationIds,
    itemRefs: [],
    roughInHours: 0,
    trimHours: 0,
    testingHours: 0,
    cleanupHours: 0,
    crewNotes: '',
    proposalSummary: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    visible: true,
    isolated: false,
    ...patch,
  }
}

function run(params: { annotations?: BlueprintAnnotation[]; workPackages?: BlueprintScopeLayer[] } = {}) {
  return buildElectricalSymbolCountResult({
    projectId: 'project-1',
    blueprintSetId: 'set-1',
    annotations: params.annotations || [ann('a1', 'electrical-receptacle')],
    workPackages: params.workPackages || [],
  })
}

describe('blueprint-symbol-counts engine', () => {
  it('counts one registered electrical symbol once and ignores meta.countValue', () => {
    const result = run({ annotations: [ann('a1', 'electrical-receptacle', { meta: { shapeKind: 'electrical-receptacle', countValue: 12 } })] })
    expect(result.overallCount).toBe(1)
    expect(result.symbolTotals).toMatchObject([{ shapeKind: 'electrical-receptacle', count: 1, annotationIds: ['a1'] }])
  })

  it('counts multiple annotations of one type and keeps exact symbol types separate', () => {
    const result = run({ annotations: [ann('a1', 'electrical-receptacle'), ann('a2', 'electrical-receptacle'), ann('a3', 'electrical-gfci')] })
    expect(result.overallCount).toBe(3)
    expect(result.symbolTotals.map((total) => [total.shapeKind, total.count])).toEqual([
      ['electrical-gfci', 1],
      ['electrical-receptacle', 2],
    ])
  })

  it('counts every shared registered electrical kind, including can lights, through registry iteration', () => {
    const annotations = ELECTRICAL_SYMBOL_OPTIONS.map((option, index) => ann(`a${index}`, option.value))
    const result = run({ annotations })
    expect(result.overallCount).toBe(ELECTRICAL_SYMBOL_OPTIONS.length)
    expect(new Set(result.symbolTotals.map((total) => total.shapeKind))).toEqual(new Set(ELECTRICAL_SYMBOL_OPTIONS.map((option) => option.value)))
    expect(result.symbolTotals.map((total) => total.category).slice(0, 8)).toEqual(['lighting', 'lighting', 'lighting', 'lighting', 'lighting', 'lighting', 'lighting', 'lighting'])
    expect(result.symbolTotals.find((total) => total.shapeKind === 'can-light-4')).toMatchObject({ displayName: '4" Can Light', count: 1 })
    expect(result.symbolTotals.find((total) => total.shapeKind === 'can-light-6')).toMatchObject({ displayName: '6" Can Light', count: 1 })
  })

  it('keeps EST-1E countability tied to the shared registry instead of a local metadata copy', () => {
    const source = readFileSync('src/features/blueprint-symbol-counts/types.ts', 'utf8')
    expect(source).not.toContain('ELECTRICAL_SYMBOL_METADATA')
    expect(source).not.toContain('export type ElectricalSymbolKind =')
    expect(source).not.toContain('ELECTRICAL_SYMBOL_OPTIONS')
    expect(new Set(Object.keys(ELECTRICAL_SYMBOL_METADATA))).toEqual(new Set(ELECTRICAL_SYMBOL_OPTIONS.map((option) => option.value)))
  })

  it('preserves can light registration, counting, metadata, and shared rendering', () => {
    for (const kind of ['can-light-4', 'can-light-6'] as const) {
      const metadata = getElectricalSymbolMetadata(kind)
      expect(metadata).toMatchObject({ category: 'lighting', countValue: 1 })
      expect(renderElectricalSymbolSvg(kind, {}, {
        borderColor: '#67e8f9',
        borderThickness: 2,
        borderStyle: 'solid',
        fillColor: 'transparent',
        fillOpacity: 0,
        labelsVisible: false,
      })).toBeTruthy()
    }
    const result = run({ annotations: [ann('can2', 'can-light-2'), ann('canless2', 'canless-light-2'), ann('can4', 'can-light-4'), ann('canless4', 'canless-light-4'), ann('can6', 'can-light-6'), ann('canless6', 'canless-light-6'), ann('canless10', 'canless-light-10')] })
    expect(result.symbolTotals.map((total) => [total.shapeKind, total.count])).toEqual([
      ['can-light-2', 1],
      ['canless-light-2', 1],
      ['can-light-4', 1],
      ['canless-light-4', 1],
      ['can-light-6', 1],
      ['canless-light-6', 1],
      ['canless-light-10', 1],
    ])
  })

  it('excludes circuit paths, measurements, generic shapes, deleted, other project, and other set annotations', () => {
    const result = run({
      annotations: [
        ann('circuit-path', 'circuit-path'),
        ann('circuit-arc', 'circuit-arc'),
        { ...ann('distance', 'electrical-receptacle'), type: 'measure-distance' as any },
        { ...ann('perimeter', 'electrical-receptacle'), type: 'measure-perimeter' as any },
        ann('square', 'square'),
        ann('deleted', 'electrical-receptacle', { deletedAt: '2026-01-02T00:00:00.000Z' } as any),
        ann('other-project', 'electrical-receptacle', { projectId: 'project-2' }),
        ann('other-set', 'electrical-receptacle', { blueprintSetId: 'set-2' }),
        ann('kept', 'electrical-receptacle', { pageNumber: 2 }),
      ],
    })
    expect(result.overallCount).toBe(1)
    expect(result.contributions[0]).toMatchObject({ annotationId: 'kept', pageNumber: 2 })
  })

  it('uses selectedAnnotationIds for package rollups and never sums packages into global totals', () => {
    const result = run({
      annotations: [ann('shared', 'electrical-receptacle')],
      workPackages: [pkg('pkg-b', ['shared']), pkg('pkg-a', ['shared'])],
    })
    expect(result.overallCount).toBe(1)
    expect(result.packageRollups.map((rollup) => [rollup.packageId, rollup.totals[0]?.count])).toEqual([
      ['pkg-a', 1],
      ['pkg-b', 1],
    ])
    expect(result.diagnostics.find((diagnostic) => diagnostic.type === 'duplicate-package-membership')).toMatchObject({
      annotationId: 'shared',
      packageIds: ['pkg-a', 'pkg-b'],
    })
  })

  it('dedupes repeated selected IDs, ignores itemRefs-only references, and omits unknown stale IDs from electrical warnings', () => {
    const result = run({
      annotations: [ann('a1', 'electrical-receptacle')],
      workPackages: [
        pkg('pkg-a', ['a1', 'a1']),
        pkg('pkg-b', [], { itemRefs: [{ annotationId: 'a1', pageNumber: 1, label: 'Receptacle' }] }),
        pkg('pkg-c', ['missing']),
      ],
    })
    expect(result.packageRollups.find((rollup) => rollup.packageId === 'pkg-a')?.totals[0].count).toBe(1)
    expect(result.packageRollups.find((rollup) => rollup.packageId === 'pkg-b')?.totals).toEqual([])
    expect(result.diagnostics.some((diagnostic) => diagnostic.type === 'stale-package-reference')).toBe(false)
  })

  it('emits electrical duplicate and safely-classified stale diagnostics without counting non-electrical package members', () => {
    const annotations = [
      ann('electrical', 'electrical-receptacle'),
      ann('path', 'circuit-path'),
      ann('arc', 'circuit-arc'),
      ann('generic', 'square'),
      ann('deleted-electrical', 'electrical-gfci', { deletedAt: '2026-01-02T00:00:00.000Z' } as any),
    ]
    const result = run({
      annotations,
      workPackages: [
        pkg('pkg-a', ['electrical', 'path', 'arc', 'generic', 'deleted-electrical']),
        pkg('pkg-b', ['electrical', 'path', 'arc', 'generic']),
      ],
    })
    const duplicateDiagnostics = result.diagnostics.filter((diagnostic) => diagnostic.type === 'duplicate-package-membership')
    const staleDiagnostics = result.diagnostics.filter((diagnostic) => diagnostic.type === 'stale-package-reference')
    expect(duplicateDiagnostics).toHaveLength(1)
    expect(duplicateDiagnostics[0]).toMatchObject({
      annotationId: 'electrical',
      packageIds: ['pkg-a', 'pkg-b'],
      packageNames: ['pkg-a', 'pkg-b'],
    })
    expect(staleDiagnostics).toEqual([
      expect.objectContaining({
        annotationId: 'deleted-electrical',
        packageId: 'pkg-a',
        shapeKind: 'electrical-gfci',
      }),
    ])
  })

  it('dedupes duplicate live annotation IDs, excludes missing IDs, and remains immutable', () => {
    const annotations = Object.freeze([
      ann('dup', 'electrical-receptacle'),
      ann('dup', 'electrical-gfci'),
      ann('', 'electrical-receptacle'),
    ]) as unknown as BlueprintAnnotation[]
    const before = JSON.stringify(annotations)
    const result = run({ annotations })
    expect(result.overallCount).toBe(1)
    expect(result.diagnostics.map((diagnostic) => diagnostic.type)).toEqual(expect.arrayContaining(['duplicate-live-annotation-id', 'missing-annotation-id']))
    expect(JSON.stringify(annotations)).toBe(before)
  })

  it('builds category totals and deterministic ordering independent of annotation and package order', () => {
    const annotations = [
      ann('a3', 'electrical-switch-3way'),
      ann('a1', 'can-light-4'),
      ann('a2', 'electrical-receptacle'),
    ]
    const first = run({ annotations, workPackages: [pkg('pkg-b', ['a2']), pkg('pkg-a', ['a1'])] })
    const second = run({ annotations: [...annotations].reverse(), workPackages: [pkg('pkg-a', ['a1']), pkg('pkg-b', ['a2'])] })
    expect(first.symbolTotals.map((total) => total.shapeKind)).toEqual(['can-light-4', 'electrical-switch-3way', 'electrical-receptacle'])
    expect(second.symbolTotals.map((total) => total.shapeKind)).toEqual(first.symbolTotals.map((total) => total.shapeKind))
    expect(first.categoryTotals.map((total) => [total.category, total.count])).toEqual([
      ['lighting', 1],
      ['switching', 1],
      ['power', 1],
    ])
  })

  it('models copy, appearance edit, shape kind edit, and delete as pure current-state derivations', () => {
    expect(run({ annotations: [ann('a1', 'electrical-receptacle'), ann('a2', 'electrical-receptacle')] }).overallCount).toBe(2)
    expect(run({ annotations: [ann('a1', 'electrical-receptacle', { color: '#ef4444' })] }).symbolTotals[0].count).toBe(1)
    expect(run({ annotations: [ann('a1', 'electrical-gfci')] }).symbolTotals[0].shapeKind).toBe('electrical-gfci')
    expect(run({ annotations: [ann('a1', 'electrical-receptacle', { deletedAt: '2026-01-02T00:00:00.000Z' } as any)] }).overallCount).toBe(0)
  })

  it('diagnoses safely detectable unregistered electrical kinds without crashing', () => {
    const result = run({ annotations: [ann('a1', 'electrical-future-widget'), ann('a2', 'not-electrical-widget')] })
    expect(result.overallCount).toBe(0)
    expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'unregistered-electrical-shape-kind', annotationId: 'a1' })]))
  })

  it('keeps the registered kind type usable for representative exact rows', () => {
    const exactKinds: ElectricalSymbolKind[] = ['electrical-receptacle', 'electrical-gfci', 'electrical-receptacle-240v', 'electrical-switch-3way', 'electrical-switch-4way', 'electrical-dimmer', 'electrical-timer-control', 'electrical-photocell', 'electrical-ceiling-occupancy-sensor', 'electrical-wall-occupancy-sensor', 'can-light-2', 'canless-light-2', 'can-light-4', 'canless-light-4', 'can-light-6', 'canless-light-6', 'canless-light-10', 'electrical-emergency-exit-sign', 'electrical-smoke-alarm', 'electrical-co-alarm']
    const result = run({ annotations: exactKinds.map((kind, index) => ann(`a${index}`, kind)) })
    expect(result.symbolTotals).toHaveLength(exactKinds.length)
  })
})
