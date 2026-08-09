import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  join(process.cwd(), 'src/components/blueprint/OperationsBlueprintPdfViewer.tsx'),
  'utf8',
)

function countOccurrences(haystack: string, needle: string) {
  return haystack.split(needle).length - 1
}

/** The whole two-row action tray on a Work Package / Scope Layer card. */
function traySource() {
  const start = source.indexOf('data-testid="work-package-action-tray"')
  const end = source.indexOf('{layer.description &&', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

/** Row 1: reorder up / reorder down / show / hide. */
function primaryRowSource() {
  const tray = traySource()
  const start = tray.indexOf('data-testid="work-package-action-row-primary"')
  const end = tray.indexOf('data-testid="work-package-action-row-secondary"', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return tray.slice(start, end)
}

/** Row 2: Edit / Delete. */
function secondaryRowSource() {
  const tray = traySource()
  const start = tray.indexOf('data-testid="work-package-action-row-secondary"')
  expect(start).toBeGreaterThan(-1)
  return tray.slice(start)
}

describe('work package action tray layout', () => {
  it('keeps a reorder-up control wired to moveScopeLayer', () => {
    const row = primaryRowSource()

    expect(row).toContain("onClick={() => moveScopeLayer(layer.id, 'up')}")
    expect(row).toContain('title="Move package up"')
    expect(row).toContain('aria-label="Move package up"')
    expect(row).toContain('<ChevronUp size={14} />')
  })

  it('keeps a reorder-down control wired to moveScopeLayer', () => {
    const row = primaryRowSource()

    expect(row).toContain("onClick={() => moveScopeLayer(layer.id, 'down')}")
    expect(row).toContain('title="Move package down"')
    expect(row).toContain('aria-label="Move package down"')
    expect(row).toContain('<ChevronDown size={14} />')
  })

  it('keeps the show/visible-set control wired to toggleScopeLayerIsolation', () => {
    const row = primaryRowSource()

    expect(row).toContain('onClick={() => toggleScopeLayerIsolation(layer.id)}')
    expect(row).toContain('<Eye size={14} />')
    expect(row).toContain("title={isLayerIsolated ? 'Remove this package from the visible set' : 'Show this package on canvas (add to visible set)'}")
  })

  it('keeps the hide-from-general-view control wired to toggleScopeLayerHidden', () => {
    const row = primaryRowSource()

    expect(row).toContain('onClick={() => toggleScopeLayerHidden(layer.id)}')
    expect(row).toContain('<EyeOff size={14} />')
    expect(row).toContain("title={isLayerHidden ? 'Show this package annotations in general view' : 'Hide this package annotations from general view'}")
  })

  it('keeps the Edit control wired to openEditScopeLayerModal', () => {
    const row = secondaryRowSource()

    expect(row).toContain('onClick={() => openEditScopeLayerModal(layer)}')
    expect(row).toMatch(/>\s*Edit\s*<\/button>/)
  })

  it('keeps the Delete control wired to requestScopeLayerDelete', () => {
    const row = secondaryRowSource()

    expect(row).toContain('onClick={() => requestScopeLayerDelete(layer)}')
    expect(row).toMatch(/>\s*Delete\s*<\/button>/)
  })

  it('puts up, down, show, and hide in one top row in that order', () => {
    const row = primaryRowSource()
    const upIndex = row.indexOf("moveScopeLayer(layer.id, 'up')")
    const downIndex = row.indexOf("moveScopeLayer(layer.id, 'down')")
    const showIndex = row.indexOf('toggleScopeLayerIsolation(layer.id)')
    const hideIndex = row.indexOf('toggleScopeLayerHidden(layer.id)')

    expect(upIndex).toBeGreaterThan(-1)
    expect(downIndex).toBeGreaterThan(upIndex)
    expect(showIndex).toBeGreaterThan(downIndex)
    expect(hideIndex).toBeGreaterThan(showIndex)
    expect(countOccurrences(row, '<button')).toBe(4)

    // Up and Down are no longer stacked in their own vertical column.
    expect(row).not.toContain('grid grid-cols-1')
    expect(source).toContain('<div className="flex items-center gap-1" data-testid="work-package-action-row-primary">')
  })

  it('puts Edit and Delete in a separate second row', () => {
    const row = secondaryRowSource()

    expect(countOccurrences(row, '<button')).toBe(2)
    expect(source).toContain('<div className="flex items-center gap-1" data-testid="work-package-action-row-secondary">')
    expect(row.indexOf('openEditScopeLayerModal(layer)')).toBeLessThan(row.indexOf('requestScopeLayerDelete(layer)'))
    expect(row).not.toContain('moveScopeLayer(layer.id')
    expect(row).not.toContain('toggleScopeLayerIsolation(layer.id)')
    expect(row).not.toContain('toggleScopeLayerHidden(layer.id)')
  })

  it('drops the oversized 44px presentation and the fixed 252px tray cap', () => {
    const tray = traySource()

    expect(tray).not.toContain('min-h-11')
    expect(tray).not.toContain('min-w-11')
    expect(source).not.toContain('max-w-[252px]')
    expect(source).toContain('<div className="flex flex-shrink-0 flex-col items-end gap-1" data-testid="work-package-action-tray">')
  })

  it('keeps controls comfortably clickable at 40px rather than regressing to tiny icons', () => {
    const tray = traySource()

    // Four 40x40 icon buttons in row 1.
    expect(countOccurrences(primaryRowSource(), 'h-10 w-10')).toBe(4)
    // Edit/Delete keep the same 40px height but stay label-width compact.
    expect(countOccurrences(secondaryRowSource(), 'inline-flex h-10 items-center justify-center rounded border')).toBe(2)
    expect(secondaryRowSource()).toContain('px-3')

    for (const tiny of ['h-6 w-6', 'h-7 w-7', 'h-8 w-8', 'min-h-6', 'min-h-7']) {
      expect(tray).not.toContain(tiny)
    }
  })

  it('preserves the reorder disabled states', () => {
    const row = primaryRowSource()

    expect(row).toContain('disabled={!moveState.canMoveUp}')
    expect(row).toContain('disabled={!moveState.canMoveDown}')
    expect(countOccurrences(row, 'disabled:cursor-not-allowed disabled:border-gray-800 disabled:text-gray-700')).toBe(2)
    expect(source).toContain('const moveState = getVisibleWorkPackageMoveState({')
    expect(source).toContain('busy: isScopeLayerOrderSaving,')
  })

  it('preserves hidden-package and isolated-package appearance', () => {
    const row = primaryRowSource()
    const cardStart = source.indexOf('const isLayerHidden = hiddenWorkPackageIds.has(layer.id)')
    const cardSource = source.slice(cardStart, source.indexOf('data-testid="work-package-action-tray"', cardStart))

    expect(row).toContain("isLayerHidden ? 'border-rose-400/50 bg-rose-500/15 text-rose-200'")
    expect(row).toContain("isLayerIsolated ? 'border-amber-400/50 bg-amber-500/15 text-amber-200'")
    expect(cardSource).toContain('const isLayerHidden = hiddenWorkPackageIds.has(layer.id)')
    expect(cardSource).toContain('uppercase tracking-wide text-rose-200">Hidden</span>')
    expect(cardSource).toContain("layer.visible ? '' : 'opacity-55'")
  })

  it('does not narrow the package name/description column', () => {
    const cardStart = source.indexOf('const isLayerHidden = hiddenWorkPackageIds.has(layer.id)')
    const cardSource = source.slice(cardStart, source.indexOf('data-testid="work-package-action-tray"', cardStart))

    expect(cardSource).toContain('<div className="flex min-w-0 items-start gap-1.5">')
    expect(cardSource).toContain('<div className="min-w-0">')
    expect(cardSource).toContain('aria-label="Drag to reorder"')
  })

  it('leaves work package animation controls and counts untouched', () => {
    expect(source).toContain('<PackageAnimationPlaybackControls')
    expect(source).toContain('openPackageAnimationRouteBuilder(layer)')
    expect(source).toContain("{layer.itemRefs.length} {layer.itemRefs.length === 1 ? 'item' : 'items'}")
  })
})
